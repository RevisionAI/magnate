using System;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// The AI decision rules of econ-audit §4.17 under Realistic market rules (<see cref="MarketAi"/>,
/// <see cref="TechLeader"/>, <see cref="SimpleRetailerStrategy"/>): expected-profit pricing that
/// moves at most ±5 %/month, per-unit cost floors, store-format choice, restock from trailing
/// sales, sell-through repricing and the advertising rule.
/// </summary>
[Trait("Area", "Market")]
public sealed class MarketAiTests
{
    private static readonly ProductId Tv = new("television");
    private static readonly BuildingTypeId Department = new("department_store");

    private static RetailLine Line(World world, BuildingInstance store, ProductId product)
        => MarketAi.OwnLines(world, store.Owner).Single(l => l.Building.Id == store.Id && l.Product == product);

    [Fact]
    public void Each_product_goes_to_the_store_format_that_draws_it_best()
    {
        var world = Realistic();
        BuildingTypeId? For(ProductId p) => MarketAi.StoreTypeFor(world, world.Catalog.Product(p));
        Assert.Equal(Dealer, For(Car));
        Assert.Equal(Department, For(Tv));
        Assert.Equal(Department, For(TShirt));
        Assert.Equal(Supermarket, For(SoftDrink));
        Assert.Equal(Supermarket, For(Bread));
    }

    [Fact]
    public void Price_search_moves_at_most_five_percent_and_converges_on_the_profit_maximum()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 2.60m, 300_000));
        var product = world.Catalog.Product(SoftDrink);
        var landed = world.GetImportPrice(SoftDrink);

        // From 1.49 × Pref the search steps down by exactly one 5 % step.
        Assert.Equal(MarketAi.Cents(2.60m * 0.95m), MarketAi.ChoosePrice(world, Line(world, store, SoftDrink), product));

        // Iterated monthly it settles where the contribution peaks (checked on a fine grid).
        for (var month = 0; month < 24; month++)
        {
            var next = MarketAi.ChoosePrice(world, Line(world, store, SoftDrink), product);
            var current = Line(world, store, SoftDrink).Price;
            Assert.InRange(next, MarketAi.Cents(current * 0.95m), MarketAi.Cents(current * 1.05m));
            world.SetRetailPrice(store.Id, 0, next);
        }

        decimal Value(decimal price)
            => MarketAi.Contribution(world, world.PreviewDemand(Riverside, SoftDrink, new PreviewOffer { Building = store.Id, Price = price }).Hypothetical!.Sold, price, landed);
        var settled = Line(world, store, SoftDrink).Price;
        var best = Enumerable.Range(0, 81).Select(k => MarketAi.Cents(1.40m + 0.01m * k)).OrderByDescending(Value).First();
        Assert.InRange((double)(settled / best), 0.95, 1.05);
        Assert.True(Value(settled) >= 0.99m * Value(best), $"settled {settled}: {Value(settled):N0} vs best {best}: {Value(best):N0}");
    }

    [Fact]
    public void Prices_never_leave_the_cost_floor_and_reference_ceiling()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 0.50m, 300_000));
        var product = world.Catalog.Product(SoftDrink);
        var landed = world.GetImportPrice(SoftDrink);
        var (floor, ceiling) = MarketAi.PriceBounds(world, Riverside, product, landed);
        Assert.Equal(landed * 1.05m, floor);
        Assert.Equal(MarketAi.ReferencePrice(world, Riverside, product) * 1.6m, ceiling);

        // Below the floor (selling at a loss): one step up per month, never a jump.
        Assert.Equal(MarketAi.Cents(0.50m * 1.05m), MarketAi.ChoosePrice(world, Line(world, store, SoftDrink), product));

        // Far above the ceiling: one step down per month.
        world.SetRetailPrice(store.Id, 0, 10.00m);
        Assert.Equal(MarketAi.Cents(9.50m), MarketAi.ChoosePrice(world, Line(world, store, SoftDrink), product));
    }

    [Fact]
    public void Restock_covers_one_point_two_months_of_trailing_sales_within_the_stock_cap()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.75m, 300_000));
        var product = world.Catalog.Product(SoftDrink);
        foreach (var _ in Months(3)) world.AdvanceMonth();

        var trailing = world.GetTrailingLineSales(store.Id, SoftDrink);
        Assert.True(trailing > 0);
        var expected = Math.Min(world.GetStockCap(store.Id, SoftDrink), 1.2 * trailing);
        Assert.Equal(expected, MarketAi.RestockTarget(world, Line(world, store, SoftDrink), product), 9);
    }

    [Fact]
    public void Sell_through_repricing_raises_a_sold_out_line_and_cuts_a_slow_one()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        // A tiny restock sells out; a huge one at a high price leaves most of the stock.
        var tight = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.75m, 1_000));
        var slow = Store(world, a.Id, Supermarket, Hilltown, (Bread, 4.50m, 200_000));
        world.AdvanceMonth();

        var drink = world.Catalog.Product(SoftDrink);
        var bread = world.Catalog.Product(Bread);
        Assert.True(world.GetRetailLineReport(tight.Id, SoftDrink)!.SoldOut);
        Assert.Equal(MarketAi.Cents(1.75m * 1.03m), MarketAi.SellThroughPrice(world, Line(world, tight, SoftDrink), drink));
        var report = world.GetRetailLineReport(slow.Id, Bread)!;
        Assert.True(report.Sold / (report.Sold + report.EndStock) < 0.70);
        Assert.Equal(MarketAi.Cents(4.50m * 0.97m), MarketAi.SellThroughPrice(world, Line(world, slow, Bread), bread));
    }

    [Fact]
    public void Advertising_pays_six_percent_of_revenue_up_to_the_sustain_budget_and_nothing_in_a_marginal_market()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var store = Store(world, a.Id, Supermarket, Riverside, (SoftDrink, 1.75m, 300_000));
        foreach (var _ in Months(2)) world.AdvanceMonth();

        var share = world.GetMarketShare(a.Id, SoftDrink, Riverside);
        Assert.True(share >= MarketAi.AdMinShare);
        var revenue = world.GetRetailLineReport(store.Id, SoftDrink)!.Revenue;
        var sustain = world.GetSustainBudget(a.Id, Riverside, AdChannel.TV, MarketAi.AdSustainAwareness);
        var expected = Math.Round(Math.Min(revenue * MarketAi.AdRevenueShare, sustain), 0, MidpointRounding.ToEven);
        Assert.Equal(expected, MarketAi.AdBudget(world, a.Id, Riverside, SoftDrink, decimal.MaxValue));
        Assert.Equal(Math.Min(expected, 5_000m), MarketAi.AdBudget(world, a.Id, Riverside, SoftDrink, 5_000m));

        // No line in Hilltown: below 2 % share, no campaign.
        Assert.Equal(0m, MarketAi.AdBudget(world, a.Id, Hilltown, SoftDrink, decimal.MaxValue));
    }

    [Fact]
    public void Tech_leader_prices_its_hero_on_value_above_the_per_unit_cost_without_a_rival_spiral()
    {
        var world = Realistic();
        var leader = world.CreateCompany("Leader", 200_000_000m);
        var strategy = new TechLeader();
        var store = Store(world, leader.Id, Department, Metropolis, (Tv, 480m, 1_000));
        // A rival charging 3 × Pref must not drag the hero up (the old "max rival × 1.3" rule).
        var rival = world.CreateCompany("Rival", 200_000_000m);
        Store(world, rival.Id, Department, Metropolis, (Tv, 1_440m, 1_000));

        // Stock bought at $600 a unit: the floor is $660 per unit (F4: not the stock's total cost).
        store.Inventory.Add(Tv, 1_000, 600_000m, 50);
        world.SetRetailPrice(store.Id, 0, 600m);
        var plan = strategy.Plan(world, leader.Id).OfType<SetLinePriceAction>().Single(p => p.Retailer == store.Id);
        Assert.Equal(630m, plan.NewPrice);   // toward the $660 floor, one 5 % step at a time

        // Cheap stock and a strong brand: the price follows Pref · M^0.8, still within ±5 %.
        var cheap = world.CreateCompany("Cheap", 200_000_000m);
        var hero = Store(world, cheap.Id, Department, Riverside, (Tv, 470m, 1_000));
        hero.Inventory.Add(Tv, 1_000, 373_000m, 50);
        world.SetBrandAwareness(cheap.Id, Tv, Riverside, 90);
        world.SetTech(cheap.Id, Tv, world.Catalog.Product(Tv).MaxTechLevel);
        var next = new TechLeader().Plan(world, cheap.Id).OfType<SetLinePriceAction>().Single(p => p.Retailer == hero.Id).NewPrice;
        Assert.Equal(MarketAi.Cents(470m * 1.05m), next);   // value says "dearer": one step up
        Assert.True(next < 1_440m * 1.3m);
    }
}
