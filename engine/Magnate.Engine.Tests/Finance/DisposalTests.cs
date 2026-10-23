using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Selling and demolishing buildings (econ-audit §4.8 disposal, bridge-spec E16).</summary>
public sealed class DisposalTests
{
    [Fact]
    public void Selling_books_proceeds_and_the_loss_against_book_value_and_retires_the_building()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        world.ConfigureRetailSlot(store.Id, 0, SoftDrink, 2.00m, 10_000);
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        var preview = world.PreviewDisposal(store.Id, DisposalKind.Sale);
        var nbv = store.BookValue;
        var inventory = store.Inventory.TotalValue();
        Assert.Equal(FinanceMath.Cents(0.60m * nbv + inventory), preview.Proceeds);
        var cash = c.Cash;
        var equity = world.GetBalanceSheet(c.Id).Equity;

        var result = world.SellBuilding(store.Id);
        Assert.Equal(preview, result);
        Assert.Equal(cash + result.Proceeds, c.Cash);
        Assert.Equal(equity + result.GainOrLoss, world.GetBalanceSheet(c.Id).Equity);
        Assert.True(result.GainOrLoss < 0m);
        Assert.False(world.Buildings.ContainsKey(store.Id));
        Assert.DoesNotContain(store.Id, c.OwnedBuildings);
        Assert.True(world.RetiredBuildings.ContainsKey(store.Id));
        Assert.Contains(world.AccrualJournal.Entries, a => a.Kind == AccrualKind.DisposalGainLoss && a.Building == store.Id && a.Amount == result.GainOrLoss);
        Assert.Equal(result.GainOrLoss, world.GetIncomeStatement(c.Id, world.Clock.Now, world.Clock.Now).OtherGains);
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.BuildingDisposed && e.BuildingId == store.Id.Value);
        Invariants.AssertAll(world);

        for (var i = 0; i < 3; i++) world.AdvanceMonth();
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Demolition_returns_the_land_and_discounted_stock_only()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        world.RecordCashChange(c.Id, LedgerCategory.LandPurchase, -500_000m, "plot", building: store.Id);
        world.CapitalizeLand(store.Id, 500_000m);
        world.AdvanceMonth();
        var result = world.DemolishBuilding(store.Id);
        Assert.Equal(DisposalKind.Demolition, result.Kind);
        Assert.Equal(500_000m, result.Land);
        Assert.Equal(500_000m, result.Proceeds);
        Assert.Equal(-result.BookValue, result.GainOrLoss);
        Assert.Equal(0m, world.GetBalanceSheet(c.Id).Land);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Disposals_are_refused_under_classic_rules()
    {
        var world = Worlds.Live();
        var c = world.CreateCompany("Old", 10_000_000m);
        var store = world.Construct(c.Id, Supermarket, Metropolis);
        Assert.Equal(FinanceErrorCode.FeatureDisabled, Assert.Throws<FinanceException>(() => world.SellBuilding(store.Id)).Code);
    }

    [Fact]
    public void Retired_buildings_survive_save_and_load()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        var other = world.Construct(c.Id, Supermarket, Metropolis);
        world.AdvanceMonth();
        world.SellBuilding(store.Id);
        world.AdvanceMonth();

        var json = WorldSaver.SaveToString(world);
        var loaded = WorldLoader.LoadFromString(TestContent.Live, json).World;
        Assert.Equal(json, WorldSaver.SaveToString(loaded));
        Assert.True(loaded.RetiredBuildings.ContainsKey(store.Id));
        Assert.Equal(store.CapitalizedCost, loaded.RetiredBuildings[store.Id].CapitalizedCost);
        Assert.Equal(store.AccumulatedDepreciation, loaded.RetiredBuildings[store.Id].AccumulatedDepreciation);
        Assert.True(loaded.Buildings.ContainsKey(other.Id));
        Invariants.AssertAll(loaded);
    }
}
