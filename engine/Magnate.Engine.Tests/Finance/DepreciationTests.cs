using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Straight-line depreciation, land, CIP and the asset register (econ-audit §4.8, §4.12, R12).</summary>
public sealed class DepreciationTests
{
    [Fact]
    public void A_store_splits_into_structure_and_fixtures_and_depreciates_from_the_next_month()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        var cost = store.CapitalizedCost;
        Assert.Equal(0m, store.AccumulatedDepreciation);

        world.AdvanceMonth();
        var record = world.AssetRegister.Find(store.Id)!;
        Assert.Equal(2, record.Components.Count);
        var structure = record.Components.Single(x => x.Class == AssetClass.Structure);
        var fixtures = record.Components.Single(x => x.Class == AssetClass.Fixtures);
        Assert.Equal(FinanceMath.Cents(0.75m * cost), structure.Cost);
        Assert.Equal(cost, structure.Cost + fixtures.Cost);
        Assert.Equal(360, structure.LifeMonths);
        Assert.Equal(120, fixtures.LifeMonths);

        var expected = FinanceMath.Cents(structure.Cost / 360m) + FinanceMath.Cents(fixtures.Cost / 120m);
        Assert.Equal(expected, store.AccumulatedDepreciation);
        Assert.Equal(cost - expected, store.BookValue);
        var statement = world.GetIncomeStatement(c.Id, world.Clock.Now, world.Clock.Now);
        Assert.Equal(expected, statement.Depreciation);
        var bs = world.GetBalanceSheet(c.Id);
        Assert.Equal(cost, bs.GrossPpe);
        Assert.Equal(expected, bs.AccumulatedDepreciation);
        Assert.Equal(bs.GrossPpe - bs.AccumulatedDepreciation, bs.BuildingValue);
        Invariants.AssertAll(world);
    }

    [Theory]
    [InlineData(1_000_000, 360)]
    [InlineData(333_333.33, 120)]
    [InlineData(7, 60)]
    public void Accumulated_depreciation_equals_cost_after_the_life_and_never_exceeds_it(double costD, int life)
    {
        var cost = (decimal)costD;
        var c = new AssetComponent(AssetClass.Structure, cost, life, startMonth: 100, "x");
        Assert.Equal(0m, c.ChargeFor(99));
        for (var m = 100; m < 100 + life + 24; m++)
        {
            var charge = c.ChargeFor(m);
            Assert.True(charge >= 0m);
            c.Accumulated += charge;
            Assert.True(c.NetBookValue >= 0m);
            if (m == 100 + life - 1) Assert.Equal(cost, c.Accumulated);
        }

        Assert.Equal(cost, c.Accumulated);
    }

    [Fact]
    public void Land_is_carried_at_cost_and_never_depreciates()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        world.RecordCashChange(c.Id, LedgerCategory.LandPurchase, -2_000_000m, "plot", building: store.Id);
        world.CapitalizeLand(store.Id, 2_000_000m);
        for (var i = 0; i < 24; i++) world.AdvanceMonth();
        var bs = world.GetBalanceSheet(c.Id);
        Assert.Equal(2_000_000m, bs.Land);
        Assert.Equal(2_000_000m, world.GetLandCost(store.Id));
        Assert.Equal(bs.Cash + bs.InventoryValue + bs.BuildingValue + bs.Land, bs.TotalAssets);
        Assert.DoesNotContain(world.AssetRegister.Find(store.Id)!.Components, x => x.Label.Contains("land"));
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Upgrades_are_capitalised_and_depreciated_over_at_least_ten_years_or_the_remaining_life()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        for (var i = 0; i < 12; i++) world.AdvanceMonth();
        var before = store.CapitalizedCost;
        world.UpgradeBuilding(store.Id);
        var upgradeCost = store.CapitalizedCost - before;
        Assert.True(upgradeCost > 0m);
        world.AdvanceMonth();
        var upgrade = world.AssetRegister.Find(store.Id)!.Components.Single(x => x.Label.StartsWith("upgrade", System.StringComparison.Ordinal));
        Assert.Equal(upgradeCost, upgrade.Cost);
        Assert.Equal(AssetClass.Structure, upgrade.Class);
        Assert.Equal(360 - 12, upgrade.LifeMonths);
        Invariants.AssertAll(world);
        _ = c;
    }

    [Fact]
    public void Construction_in_progress_moves_to_ppe_on_completion_and_depreciates_after()
    {
        // The E3b contract: progress payments are booked as ConstructionPayment and recorded as CIP;
        // completion moves CIP into the building's capitalised cost.
        var world = World();
        var c = world.CreateCompany("Builder", 50_000_000m);
        var store = world.Construct(c.Id, Supermarket, Metropolis);
        world.RecordCashChange(c.Id, LedgerCategory.ConstructionPayment, -1_000_000m, "deposit", building: store.Id);
        world.AddConstructionInProgress(store.Id, 1_000_000m);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.Equal(1_000_000m, world.GetBalanceSheet(c.Id).Cip);
        Assert.Equal(1_000_000m, world.GetConstructionInProgress(store.Id));

        var before = store.CapitalizedCost;
        Assert.Equal(1_000_000m, world.CompleteConstruction(store.Id));
        Assert.Equal(before + 1_000_000m, store.CapitalizedCost);
        Assert.Equal(0m, world.GetBalanceSheet(c.Id).Cip);
        Invariants.AssertAll(world);
        world.AdvanceMonth();
        Assert.Contains(world.AssetRegister.Find(store.Id)!.Components, x => x.Label.StartsWith("upgrade", System.StringComparison.Ordinal) && x.Cost == 1_000_000m);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Cancelled_construction_writes_off_the_unrecovered_cip()
    {
        var world = World();
        var c = world.CreateCompany("Quitter", 50_000_000m);
        var store = world.Construct(c.Id, Supermarket, Metropolis);
        world.RecordCashChange(c.Id, LedgerCategory.ConstructionPayment, -800_000m, "deposit", building: store.Id);
        world.AddConstructionInProgress(store.Id, 800_000m);
        world.RecordCashChange(c.Id, LedgerCategory.AssetSale, 400_000m, "cancel refund", building: store.Id);
        Assert.Equal(400_000m, world.WriteOffConstruction(store.Id, recovered: 400_000m));
        Invariants.AssertAll(world);
        var statement = world.GetIncomeStatement(c.Id, world.Clock.Now, world.Clock.Now);
        Assert.Equal(-400_000m, statement.OtherGains);
    }

    [Fact]
    public void Equipment_is_capitalised_with_its_own_life()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        var gross = store.CapitalizedCost;
        world.RecordCashChange(c.Id, LedgerCategory.EquipmentPurchase, -600_000m, "line", building: store.Id);
        world.CapitalizeEquipment(store.Id, 600_000m, lifeMonths: 60);
        Assert.Equal(gross + 600_000m, store.CapitalizedCost);
        world.AdvanceMonth();
        var equipment = world.AssetRegister.Find(store.Id)!.Components.Single(x => x.Class == AssetClass.Equipment);
        Assert.Equal(10_000m, equipment.Accumulated);
        Assert.Equal(2, world.AssetRegister.Find(store.Id)!.Components.Count(x => x.Class != AssetClass.Equipment));
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Depreciation_can_be_switched_off()
    {
        var world = World(FinanceOnly(FinanceRules.Realistic with { Depreciation = false }));
        var (_, store) = CompanyWithStore(world);
        for (var i = 0; i < 3; i++) world.AdvanceMonth();
        Assert.Equal(0m, store.AccumulatedDepreciation);
        Assert.Empty(world.AccrualJournal.Entries);
    }

    [Fact]
    public void Classic_never_depreciates()
    {
        var world = Worlds.Live();
        var c = world.CreateCompany("Old", 10_000_000m);
        var store = world.Construct(c.Id, Supermarket, Metropolis);
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        Assert.Equal(0m, store.AccumulatedDepreciation);
        Assert.Empty(world.AssetRegister.Records);
        Assert.Null(world.GetCompanyFinance(c.Id));
    }

    [Theory]
    [InlineData("supermarket", AssetClass.Fixtures)]
    [InlineData("factory_small", AssetClass.Structure)]
    [InlineData("rd_center", AssetClass.Equipment)]
    [InlineData("oil_well", AssetClass.Equipment)]
    public void Schedules_by_building_category(string typeId, AssetClass expectedClass)
    {
        var type = TestContent.Live.BuildingType(new BuildingTypeId(typeId));
        var schedule = AssetClasses.ScheduleFor(type);
        Assert.Equal(1m, schedule.Sum(s => s.Share));
        Assert.Contains(schedule, s => s.Class == expectedClass);
    }
}
