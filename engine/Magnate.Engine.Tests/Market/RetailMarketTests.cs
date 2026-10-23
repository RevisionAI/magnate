using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Retail under Realistic market rules, run through the monthly tick (econ-audit §4.1–4.3):
/// store lines, throughput capacity, stock caps, store-format draw, location, spill, realised
/// market share, and the exactness of <see cref="World.PreviewDemand"/> (bridge-spec E9).
/// </summary>
[Trait("Area", "Market")]
public sealed class RetailMarketTests
{
    [Fact]
    public void Preview_projects_campaign_lift_and_decay_like_the_tick()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        world.SetBrandAwareness(a.Id, SoftDrink, Metropolis, 40);
        world.RegisterAdCampaign(a.Id, SoftDrink, Metropolis, AdChannel.TV, 100_000m);
        world.RegisterAdCampaign(a.Id, SoftDrink, Metropolis, AdChannel.Radio, 30_000m);
        world.SetBrandAwareness(a.Id, Bread, Metropolis, 0.1);   // decays below 0.1 without a campaign
        var projected = world.GetProjectedBrandAwareness(a.Id, SoftDrink, Metropolis);
        var gone = world.GetProjectedBrandAwareness(a.Id, Bread, Metropolis);
        world.AdvanceMonth();
        Assert.Equal(world.GetBrandAwareness(a.Id, SoftDrink, Metropolis), projected);
        Assert.Equal(world.GetBrandAwareness(a.Id, Bread, Metropolis), gone);
        Assert.Equal(0, gone);
    }

    [Fact]
    public void Preview_predicts_the_next_ticks_sales_exactly()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var b = world.CreateCompany("B", 80_000_000m);
        var cheap = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.70m, 500_000), (Bread, 3.10m, 60_000));
        var dear = Store(world, b.Id, Supermarket, Riverside, (SoftDrink, 1.95m, 120_000));
        world.SetBrandAwareness(b.Id, SoftDrink, Riverside, 70);

        var preview = world.PreviewDemand(Riverside, SoftDrink);
        world.AdvanceMonth();

        Assert.Equal(2, preview.Lines.Count);
        foreach (var line in preview.Lines)
        {
            var report = world.GetRetailLineReport(line.Building!.Value, SoftDrink)!;
            Assert.Equal(line.Sold, report.Sold, 6);
            Assert.Equal(line.Demand, report.Demand, 6);
        }

        // B's brand decays 3 % in the tick's advertising step before sales; the preview projects it.
        Assert.Equal(70 * 0.97, preview.Lines.Single(l => l.Owner == b.Id).Brand, 9);
        var month = world.GetMarketUnits(Riverside, SoftDrink, world.Clock.Now)!.Value;
        Assert.Equal(preview.IncumbentUnits, month.Incumbents, 6);
        Assert.True(cheap.Inventory.Get(SoftDrink) >= 0 && dear.Inventory.Get(SoftDrink) >= 0);
    }

    [Fact]
    public void Duplicate_slots_merge_into_one_offer_with_square_root_attractiveness()
    {
        // F7 / R16: six slots of one product in one store are one line, attractiveness ×√6.
        var world = Realistic();
        var a = world.CreateCompany("A", 200_000_000m);
        var b = world.CreateCompany("B", 80_000_000m);
        var six = Store(world, a.Id, Supermarket, Metropolis, Enumerable.Repeat((SoftDrink, 1.75m, 100_000.0), 6).ToArray());
        var one = Store(world, b.Id, Supermarket, Metropolis, (SoftDrink, 1.75m, 100_000));

        var preview = world.PreviewDemand(Metropolis, SoftDrink);
        Assert.Equal(2, preview.Lines.Count);
        var lineSix = preview.Lines.Single(l => l.Building == six.Id);
        var lineOne = preview.Lines.Single(l => l.Building == one.Id);
        Assert.Equal(Math.Sqrt(6), lineSix.Attractiveness / lineOne.Attractiveness, 9);
        Assert.Equal(6 * lineOne.Capacity, lineSix.Capacity, 6);
        // Same price, brand and quality: demand splits in proportion to attractiveness only.
        Assert.Equal(Math.Sqrt(6), lineSix.Demand / lineOne.Demand, 6);
        Assert.True(lineSix.Share < 0.75, "six slots no longer buy 85.7 % of a two-firm market");

        world.AdvanceMonth();
        var report = world.GetRetailLineReport(six.Id, SoftDrink)!;
        Assert.Equal(6, report.Slots);
    }

    [Fact]
    public void Lines_price_at_their_cheapest_slot()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.95m, 50_000), (SoftDrink, 1.80m, 50_000));
        var line = RetailMarket.LineOf(world, store, SoftDrink)!;
        Assert.Equal(1.80m, line.Price);
        Assert.Equal(100_000, line.RestockTarget);
    }

    [Fact]
    public void Restock_targets_are_clamped_to_one_and_a_half_months_of_capacity()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 200_000_000m);
        var store = Store(world, a.Id, Supermarket, Hilltown, (SoftDrink, 5.00m, 10_000_000));   // overpriced: barely sells
        var capacity = 450_000.0 / 1.75;
        Assert.Equal(capacity, world.GetRetailCapacity(store.Id, SoftDrink), 6);
        Assert.Equal(1.5 * capacity, world.GetStockCap(store.Id, SoftDrink), 6);

        world.AdvanceMonth();
        world.AdvanceMonth();
        var bought = world.Ledger.EntriesFor(a.Id).Where(e => e.Category == LedgerCategory.RetailRestock).Sum(e => e.Quantity ?? 0);
        Assert.True(bought <= 1.5 * capacity + 1e-6 + world.GetRetailLineReport(store.Id, SoftDrink)!.Sold, $"bought {bought:N0}");
        Assert.True(store.Inventory.Get(SoftDrink) <= 1.5 * capacity + 1e-6);
    }

    [Fact]
    public void A_line_never_sells_more_than_its_throughput_capacity()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        world.SetBrandAwareness(a.Id, SoftDrink, Metropolis, 100);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.30m, 400_000));
        world.AdvanceMonth();
        var report = world.GetRetailLineReport(store.Id, SoftDrink)!;
        Assert.True(report.Demand > report.Capacity, "a branded, cheap line wants more than one slot can move");
        Assert.Equal(report.Capacity, report.Sold, 6);
    }

    [Fact]
    public void Store_formats_only_sell_the_categories_they_draw()
    {
        // §4.3: no more cars in a convenience store (F6).
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        Assert.False(world.CanRetail(Convenience, Car));
        Assert.True(world.CanRetail(Dealer, Car));
        Assert.False(world.CanRetail(Dealer, SoftDrink));
        Assert.True(world.CanRetail(Supermarket, TShirt));     // apparel draw 0.35
        Assert.False(world.CanRetail(Supermarket, new ProductId("television")));
        Assert.False(world.CanRetail(Supermarket, new ProductId("flour")));   // not a consumer good

        // A slot configured anyway (legacy path) neither restocks nor sells.
        var store = world.Construct(a.Id, Convenience, Metropolis);
        Assert.Throws<InvalidOperationException>(() => world.ValidateRetailProduct(store, Car));
        world.ConfigureRetailSlot(store.Id, 0, Car, 35_000m, 10);
        world.AdvanceMonth();
        Assert.Equal(0, store.Inventory.Get(Car));
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.ProductSale));
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.RetailRestock));
    }

    [Fact]
    public void Classic_rules_keep_every_retail_type_open_to_every_product()
    {
        var world = Worlds.Live();
        Assert.True(world.CanRetail(Convenience, Car));
        Assert.Equal(0, world.GetIncumbentMass(Metropolis, SoftDrink));
        Assert.Equal(double.PositiveInfinity, world.GetStockCap(world.Construct(world.CreateCompany("A", 5_000_000m).Id, Convenience, Metropolis).Id, SoftDrink));
    }

    [Fact]
    public void A_better_location_draws_more_shoppers()
    {
        var world = Realistic();
        var sites = new Sites();
        world.SiteInfo = sites;
        var a = world.CreateCompany("A", 80_000_000m);
        var b = world.CreateCompany("B", 80_000_000m);
        var prime = Store(world, a.Id, Supermarket, Metropolis, (Bread, 3.20m, 150_000));
        var poor = Store(world, b.Id, Supermarket, Metropolis, (Bread, 3.20m, 150_000));
        sites.Location[prime.Id] = 1.6;
        sites.Location[poor.Id] = 0.6;

        var preview = world.PreviewDemand(Metropolis, Bread);
        var p = preview.Lines.Single(l => l.Building == prime.Id);
        var q = preview.Lines.Single(l => l.Building == poor.Id);
        Assert.Equal(1.6 / 0.6, p.Attractiveness / q.Attractiveness, 9);
        Assert.True(p.Demand > 2 * q.Demand);
    }

    [Fact]
    public void Buildings_under_construction_take_no_part_in_the_market()
    {
        var world = Realistic();
        var sites = new Sites();
        world.SiteInfo = sites;
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.75m, 100_000));
        sites.UnderConstruction.Add(store.Id);

        Assert.Empty(world.PreviewDemand(Metropolis, SoftDrink).Lines);
        world.AdvanceMonth();
        Assert.Equal(0, store.Inventory.Get(SoftDrink));
        Assert.Null(world.GetRetailLineReport(store.Id, SoftDrink));

        sites.UnderConstruction.Clear();
        world.AdvanceMonth();
        Assert.True(world.GetRetailLineReport(store.Id, SoftDrink)!.Sold > 0);
    }

    [Fact]
    public void Stock_outs_spill_to_rivals_instead_of_vanishing()
    {
        // E4: two bread stores at $3.00; A holds only 1,000 loaves. A's unmet demand is re-offered.
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var b = world.CreateCompany("B", 80_000_000m);
        var thin = Store(world, a.Id, Supermarket, Hilltown, (Bread, 3.00m, 1_000));
        var deep = Store(world, b.Id, Supermarket, Hilltown, (Bread, 3.00m, 150_000));
        world.AdvanceMonth();

        var thinReport = world.GetRetailLineReport(thin.Id, Bread)!;
        var deepReport = world.GetRetailLineReport(deep.Id, Bread)!;
        Assert.Equal(1_000, thinReport.Sold, 6);
        Assert.True(thinReport.Demand > 1_000);
        Assert.True(deepReport.Sold > deepReport.Demand, "the deep store picks up part of the thin store's unmet demand");
    }

    [Fact]
    public void Realised_market_share_counts_the_incumbents()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var b = world.CreateCompany("B", 80_000_000m);
        Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.70m, 300_000));
        Store(world, b.Id, Supermarket, Riverside, (SoftDrink, 1.80m, 300_000));
        foreach (var _ in Months(4)) world.AdvanceMonth();

        var (companies, incumbents) = world.GetTrailingMarketUnits(Riverside, SoftDrink);
        var total = companies.Values.Sum() + incumbents;
        Assert.Equal(companies[a.Id] / total, world.GetMarketShare(a.Id, SoftDrink, Riverside), 12);
        Assert.Equal(companies[b.Id] / total, world.GetMarketShare(b.Id, SoftDrink, Riverside), 12);
        var incumbentShare = incumbents / total;
        Assert.Equal(1.0, world.GetMarketShare(a.Id, SoftDrink, Riverside) + world.GetMarketShare(b.Id, SoftDrink, Riverside) + incumbentShare, 12);
        Assert.InRange(incumbentShare, 0.5, 0.99);   // two average stores against a city's local trade
        Assert.Equal(0, world.GetMarketShare(a.Id, SoftDrink, Hilltown));
    }

    private static GameDate Back(GameDate date, int months)
    {
        var index = date.AsMonthIndex() - months;
        return new GameDate(index / 12, index % 12 + 1);
    }

    [Fact]
    public void Incumbent_unit_sales_are_kept_for_windowed_shares_and_survive_a_save()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.75m, 300_000));
        var perMonth = new List<double>();
        foreach (var _ in Months(30))
        {
            world.AdvanceMonth();
            perMonth.Add(world.GetMarketUnits(Riverside, SoftDrink, world.Clock.Now)!.Value.Incumbents);
        }

        var now = world.Clock.Now;
        Assert.Equal(perMonth[^1], world.GetIncumbentUnitsSold(SoftDrink, Riverside, now, now), 9);
        // The trailing three months equal the incumbents' part of GetTrailingMarketUnits.
        var from3 = Back(now, 2);
        Assert.Equal(world.GetTrailingMarketUnits(Riverside, SoftDrink).Incumbents, world.GetIncumbentUnitsSold(SoftDrink, Riverside, from3, now), 6);
        // 24 months are kept: a 12-month window is complete, older months are gone.
        Assert.Equal(perMonth.Skip(18).Sum(), world.GetIncumbentUnitsSold(SoftDrink, Riverside, Back(now, 11), now), 3);
        Assert.Equal(perMonth.Skip(6).Sum(), world.GetIncumbentUnitsSold(SoftDrink, Riverside, Back(now, 40), now), 3);
        // Markets with no store still record the local trade.
        Assert.True(world.GetIncumbentUnitsSold(Bread, Hilltown, now, now) > 0);

        var reloaded = Persistence.WorldLoader.LoadFromString(world.Catalog, Persistence.WorldSaver.SaveToString(world)).World;
        Assert.Equal(world.GetIncumbentUnitsSold(SoftDrink, Riverside, Back(now, 23), now),
            reloaded.GetIncumbentUnitsSold(SoftDrink, Riverside, Back(now, 23), now));
        Assert.Equal(0, Worlds.Live().GetIncumbentUnitsSold(SoftDrink, Riverside, Back(now, 23), now));
    }

    [Fact]
    public void Retail_sales_book_revenue_cogs_and_variable_costs()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.75m, 200_000));
        world.AdvanceMonth();

        var report = world.GetRetailLineReport(store.Id, SoftDrink)!;
        var revenue = Sum(world, a.Id, LedgerCategory.ProductSale);
        Assert.Equal(report.Revenue, revenue);
        Assert.Equal((decimal)report.Sold * 1.75m, revenue);
        Assert.Equal(-revenue * 0.015m, Sum(world, a.Id, LedgerCategory.RetailVariable));
        // Restocked at the landed import price $1.10 × 1.12 = $1.232.
        var cogs = world.CogsLog.EntriesFor(a.Id).Sum(e => e.Cost);
        Assert.Equal((double)(1.232m * (decimal)report.Sold), (double)cogs, 3);
        Invariants.AssertAll(world);
    }
}
