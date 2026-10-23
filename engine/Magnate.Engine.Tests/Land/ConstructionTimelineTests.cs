using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// Construction under Realistic land rules (econ-audit §4.12): land bought at the site's value,
/// a deposit up front, monthly instalments into construction in progress, completion moving CIP
/// into PP&amp;E, pauses when unfunded, cancellation, and the instant-construction knob — with the
/// books closed every month.
/// </summary>
public sealed class ConstructionTimelineTests
{
    [Fact]
    public void Supermarket_pays_land_and_deposit_then_instalments_and_completes_on_schedule()
    {
        var (world, company) = LandWorlds.Realistic();
        var quote = LandWorlds.Site(world, company, "supermarket", "metropolis");
        var type = world.Catalog.BuildingType(LandWorlds.Type("supermarket"));
        var schedule = world.GetConstructionSchedule(type.Id);
        Assert.Equal(4, schedule.Months);
        Assert.Equal(type.ConstructionCost * 0.20m, schedule.Deposit);
        Assert.Equal(type.ConstructionCost, schedule.Deposit + schedule.Instalment * (schedule.Months - 1) + schedule.FinalInstalment);

        var cashBefore = world.Companies[company].Cash;
        var b = world.Construct(company, type.Id, LandWorlds.City("metropolis"), quote.At);

        // Order month: land + buy-out + deposit, nothing else.
        Assert.Equal(cashBefore - quote.SiteCost - schedule.Deposit, world.Companies[company].Cash);
        Assert.Equal(quote.SiteCost, world.GetLandCost(b.Id));
        Assert.Equal(schedule.Deposit, world.GetConstructionInProgress(b.Id));
        Assert.Equal(0m, b.CapitalizedCost);
        Assert.True(b.IsUnderConstruction);
        Assert.False(b.IsOperational);
        Assert.Equal(0m, world.GetMonthlyOpex(b));
        Assert.True(world.GetOperatingOpex(b) > 0m);
        Assert.Equal(quote.At, b.Placement);
        var started = world.Clock.Now;
        Assert.Equal(ConstructionState.AddMonths(started, 4), b.Construction!.CompletesAt);
        Assert.Equal(-quote.SiteCost, world.Ledger.Entries.Where(e => e.Building == b.Id && e.Category == LedgerCategory.LandPurchase).Sum(e => e.Amount));
        Invariants.AssertAll(world);

        for (var month = 1; month <= 4; month++)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
            var paid = schedule.Deposit + schedule.Instalment * Math.Min(month, 3) + (month == 4 ? schedule.FinalInstalment : 0m);
            if (month < 4)
            {
                Assert.True(b.IsUnderConstruction, $"month {month}");
                Assert.Equal(paid, world.GetConstructionInProgress(b.Id));
                Assert.Equal(paid, b.Construction!.CostPaid);
                Assert.Equal(type.ConstructionCost - paid, b.Construction.CostRemaining);
                Assert.Equal(month / 4.0, b.Construction.Progress, 6);
            }
        }

        Assert.True(b.IsOperational);
        Assert.Null(b.Construction);
        Assert.Equal(type.ConstructionCost, b.CapitalizedCost);
        Assert.Equal(0m, world.GetConstructionInProgress(b.Id));
        Assert.Equal(ConstructionState.AddMonths(started, 4), b.BuiltAt);
        // Depreciation (E2) starts the month after completion: nothing charged yet.
        Assert.Equal(quote.SiteCost + type.ConstructionCost, world.GetLandCost(b.Id) + b.StructureBookValue);
        Assert.Equal(type.ConstructionCost, b.StructureBookValue);
        var payments = world.Ledger.Entries.Where(e => e.Building == b.Id && e.Category == LedgerCategory.ConstructionPayment).ToList();
        Assert.Equal(5, payments.Count);
        Assert.Equal(-type.ConstructionCost, payments.Sum(e => e.Amount));
        Assert.True(world.GetMonthlyOpex(b) > 0m);
    }

    [Fact]
    public void Every_building_type_schedule_pays_exactly_its_cost()
    {
        foreach (var type in TestContent.Live.BuildingTypes.Values.OrderBy(t => t.Id.Value, StringComparer.Ordinal))
        {
            var s = ConstructionSchedule.For(type, EconomyRules.Realistic.Land);
            Assert.True(s.Months > 0, type.Id.Value);
            Assert.Equal(type.ConstructionCost, s.Deposit + s.Instalment * (s.Months - 1) + s.FinalInstalment);
            Assert.True(s.FinalInstalment >= 0m && s.Instalment >= 0m, type.Id.Value);
            Assert.Equal(decimal.Round(s.Instalment, 2), s.Instalment);
            if (LandRules.DefaultBuildMonths.TryGetValue(type.Id.Value, out var listed)) Assert.Equal(listed, s.Months);
        }
    }

    [Fact]
    public void Fallback_duration_follows_the_footprint_and_the_time_scale()
    {
        var rules = EconomyRules.Realistic.Land with { BuildMonths = null };
        var supermarket = TestContent.Live.BuildingType(new BuildingTypeId("supermarket")); // retail 3x3: ceil(1.3*3)
        Assert.Equal(4, ConstructionSchedule.MonthsFor(supermarket, rules));
        Assert.Equal(10, ConstructionSchedule.MonthsFor(supermarket, rules with { ConstructionTimeScale = 2.5m }));
        Assert.Equal(7, ConstructionSchedule.MonthsFor(supermarket, rules with { ConstructionMonths = 7 }));
        Assert.Equal(0, ConstructionSchedule.MonthsFor(supermarket, rules with { ConstructionTime = false }));
        var mine = TestContent.Live.BuildingType(new BuildingTypeId("iron_mine")); // extraction 3x3: ceil(3.3*3)
        Assert.Equal(10, ConstructionSchedule.MonthsFor(mine, rules));
    }

    [Fact]
    public void Instant_knob_builds_at_once_but_still_buys_the_land()
    {
        var (world, company) = LandWorlds.Realistic(rules: LandWorlds.Instant);
        var quote = LandWorlds.Site(world, company, "supermarket", "metropolis");
        var cost = world.Catalog.BuildingType(LandWorlds.Type("supermarket")).ConstructionCost;
        var before = world.Companies[company].Cash;

        var b = world.Construct(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"), quote.At);

        Assert.True(b.IsOperational);
        Assert.Equal(cost, b.CapitalizedCost);
        Assert.Equal(before - quote.SiteCost - cost, world.Companies[company].Cash);
        Assert.Single(world.Ledger.Entries, e => e.Building == b.Id && e.Category == LedgerCategory.ConstructionCost);
        Assert.DoesNotContain(world.Ledger.Entries, e => e.Category == LedgerCategory.ConstructionPayment);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Unfunded_instalment_pauses_the_project_and_it_resumes_when_cash_returns()
    {
        // Without the revolver: since the E2 integration construction may also draw on undrawn
        // credit (econ-audit §4.12), so "unfunded" means no cash and no credit line.
        var (world, company) = LandWorlds.Realistic(cash: 500_000_000m, rules: LandWorlds.NoCredit);
        var b = LandWorlds.BuildAt(world, company, "factory_large", "metropolis");
        var completes = b.Construction!.CompletesAt;
        var instalment = b.Construction.Instalment;

        // Drain the cash below one instalment (an owner withdrawal is not modelled; spend it on land).
        DrainTo(world, company, instalment / 2m);
        var cip = world.GetConstructionInProgress(b.Id);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.Equal(cip, world.GetConstructionInProgress(b.Id));
        Assert.Equal(1, b.Construction!.PausedMonths);
        Assert.Equal(completes.AddMonth(), b.Construction.CompletesAt);
        Assert.Equal(b.Construction.MonthsTotal, b.Construction.MonthsRemaining);

        // A cash injection lets it resume.
        world.RecordCashChange(company, LedgerCategory.StartingCapital, 100_000_000m, "top-up");
        LandWorlds.Run(world, b.Construction.MonthsTotal);
        Assert.True(b.IsOperational);
        Assert.Equal(completes.AddMonth(), b.BuiltAt);
    }

    [Fact]
    public void Cancelling_recovers_half_the_works_sells_the_site_and_retires_the_building()
    {
        var (world, company) = LandWorlds.Realistic();
        var b = LandWorlds.BuildAt(world, company, "department_store", "metropolis");
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("television"), 500m, 100);
        LandWorlds.Run(world, 2);
        var cip = world.GetConstructionInProgress(b.Id);
        var land = world.GetLandCost(b.Id);
        var site = b.Placement!.Value;
        var city = b.City;
        var rev = world.GetLayoutRevision(city);
        var cash = world.Companies[company].Cash;

        var result = world.CancelConstruction(b.Id);

        Assert.Equal(cip, result.ConstructionInProgress);
        Assert.Equal(Math.Round(cip / 2m, 2), result.Recovered);
        Assert.Equal(cip - result.Recovered, result.WrittenOff);
        Assert.Equal(land, result.LandCost);
        Assert.Equal(cash + result.Proceeds, world.Companies[company].Cash);
        Assert.True(b.IsRetired);
        Assert.False(b.IsOperational);
        Assert.Equal(0m, b.BookValue);
        Assert.Empty(b.RetailSlots);
        Assert.DoesNotContain(b.Id, world.Companies[company].OwnedBuildings);
        Assert.Null(world.BuildingAtPlot(city, site.Px, site.Pz));
        Assert.True(world.GetLayoutRevision(city) > rev);
        Assert.Single(world.AccrualJournal.Entries, e => e.Kind == AccrualKind.ConstructionWriteOff && e.Amount == -result.WrittenOff);
        Invariants.AssertAll(world);
        // One retirement model (E2 x E3b integration): the building left the world for the retired
        // registry, so commands on it fail as for any unknown building.
        Assert.False(world.Buildings.ContainsKey(b.Id));
        Assert.True(world.RetiredBuildings.ContainsKey(b.Id));
        Assert.Throws<System.Collections.Generic.KeyNotFoundException>(() => world.CancelConstruction(b.Id));
        Assert.Throws<System.Collections.Generic.KeyNotFoundException>(() => world.ConfigureRetailSlot(b.Id, 0, new ProductId("television"), 500m, 100));

        // The freed site can be built on again and the retired building never operates.
        world.Construct(company, LandWorlds.Type("department_store"), city, site);
        LandWorlds.Run(world, 8);
        Assert.Equal(0m, world.Ledger.Entries.Where(e => e.Building == b.Id && e.Date > result.WouldHaveCompletedAt.AddMonth().AddMonth()).Sum(e => e.Amount));
    }

    [Fact]
    public void Slots_can_be_configured_during_construction_but_upgrades_wait()
    {
        var (world, company) = LandWorlds.Realistic();
        var b = LandWorlds.BuildAt(world, company, "supermarket", "metropolis");
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), 2m, 1000);
        Assert.Single(b.RetailSlots);
        Assert.Throws<InvalidOperationException>(() => world.UpgradeBuilding(b.Id));
        LandWorlds.Run(world, 4);
        world.UpgradeBuilding(b.Id);
        Assert.Equal(2, b.Level);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void A_preconfigured_store_neither_trades_nor_costs_anything_until_it_opens()
    {
        var (world, company) = LandWorlds.Realistic();
        var b = LandWorlds.BuildAt(world, company, "supermarket", "metropolis");
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), 2m, 50_000);

        static bool Operating(LedgerCategory c) => c is LedgerCategory.ProductSale or LedgerCategory.RetailRestock
            or LedgerCategory.OperatingCost or LedgerCategory.ShippingCost or LedgerCategory.InputPurchase;
        for (var month = 1; month <= 3; month++)
        {
            world.AdvanceMonth();
            Assert.True(b.IsUnderConstruction, $"month {month}");
            Assert.DoesNotContain(world.Ledger.Entries, e => e.Building == b.Id && Operating(e.Category));
            Assert.Equal(0.0, b.Inventory.Get(new ProductId("soft_drink")));
        }

        // The month the last instalment is paid the store opens and trades in the same tick.
        world.AdvanceMonth();
        Assert.True(b.IsOperational);
        var now = world.Clock.Now;
        Assert.Contains(world.Ledger.Entries, e => e.Building == b.Id && e.Date == now && e.Category == LedgerCategory.RetailRestock);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Construct_at_an_invalid_site_throws_with_the_reasons_and_moves_no_money()
    {
        var (world, company) = LandWorlds.Realistic();
        var layout = world.GetCityLayout(LandWorlds.City("metropolis"));
        var road = Enumerable.Range(0, layout.PlotCount).First(i => layout.Kinds[i] == PlotKind.Road);
        var at = new PlotRef(road % layout.Width, road / layout.Width);
        var ledger = world.Ledger.Entries.Count;

        var ex = Assert.Throws<PlacementRejectedException>(() => world.Construct(company, LandWorlds.Type("convenience_store"), LandWorlds.City("metropolis"), at));
        Assert.Contains(ex.Quote.Placement.Issues, i => i.Code == PlacementCode.Road);
        Assert.Equal(ledger, world.Ledger.Entries.Count);
        Assert.Empty(world.Buildings);
    }

    [Fact]
    public void Construct_needs_the_up_front_cash()
    {
        var (world, company) = LandWorlds.Realistic(cash: 1_000m);
        var quote = LandWorlds.Site(world, company, "supermarket", "metropolis");
        Assert.Throws<InvalidOperationException>(() => world.Construct(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"), quote.At));
        Assert.Empty(world.Buildings);
    }

    [Fact]
    public void Plots_need_land_rules()
    {
        var world = Worlds.Live();
        var company = world.CreateCompany("C", 10_000_000m).Id;
        Assert.Throws<InvalidOperationException>(() => world.Construct(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"), new PlotRef(1, 1)));
        Assert.Throws<InvalidOperationException>(() => world.QuoteConstruction(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"), new PlotRef(1, 1)));

        // The Classic path is untouched: no site, no land, instant, operational.
        var b = world.Construct(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"));
        Assert.Null(b.Placement);
        Assert.True(b.IsOperational);
        Assert.Equal(0m, world.GetLandCost(b.Id));
        Assert.Equal(CityLayoutGenerator.DefaultSeed, world.LayoutSeed);
    }

    /// <summary>Pay the cash out to the owner down to <paramref name="target"/>.</summary>
    internal static void DrainTo(World world, CompanyId company, decimal target)
    {
        var excess = world.Companies[company].Cash - target;
        if (excess <= 0m) return;
        world.RecordCashChange(company, LedgerCategory.DividendPaid, -excess, "test: owner withdrawal");
    }
}
