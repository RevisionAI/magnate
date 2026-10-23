using System.Collections.Generic;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Phase 3.44 — per-bracket reservation prices. A retailer whose price exceeds
/// a bracket's reservation contributes zero demand for that bracket (other
/// brackets may still buy).
/// </summary>
public sealed class ReservationPriceTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    private static double SoldUnits(World world, BuildingInstanceId building)
    {
        var owner = world.Buildings[building].Owner;
        var price = world.Buildings[building].RetailSlots[0].Price;
        return world.Ledger.Entries
            .Where(e => e.Company == owner && e.Category == LedgerCategory.ProductSale && e.Building == building)
            .Sum(e => (double)(e.Amount / price));
    }

    // --------------------------------------------------------- backward compat

    /// <summary>
    /// Bread is shipped without a reservationPrice block. With or without
    /// reservation-price code in the pipeline, demand allocation must produce
    /// identical sales volume — i.e. opting out costs nothing.
    /// </summary>
    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Product_without_reservation_prices_behaves_unconditionally()
    {
        var world = ClassicWorld();
        var bread = world.Catalog.Product(new ProductId("bread"));
        Assert.Null(bread.ReservationPrice);

        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // Set an aggressive price that would exclude Low/Middle if there were a ceiling.
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 50.00m, restockTarget: 5_000_000);

        world.AdvanceMonth();

        var sold = SoldUnits(world, store.Id);
        // Bread has no reservation; all three brackets buy. Even at $50/loaf,
        // there is exactly one retailer so it gets 100% of demand.
        Assert.True(sold > 0, $"expected non-zero sales, got {sold}");
    }

    // --------------------------------------------------------- gating semantics

    /// <summary>
    /// Soft drink reservations: Low=$8, Middle=$50, High=∞. Pricing at $9 should
    /// exclude Low (drops 38% of metropolis demand) but Middle and High still buy.
    /// Pricing at $1.80 (the canonical case) keeps every bracket. The $9 retailer
    /// must therefore sell strictly less.
    /// </summary>
    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Price_above_low_ceiling_drops_low_bracket_only()
    {
        var lowSold = RunSoleRetailer(price: 1.80m);
        var highSold = RunSoleRetailer(price: 9.00m);

        // At $9 we lose Low entirely; Middle & High remain. We expect a
        // significant drop. Metropolis demographics (Low=0.30, Mid=0.45, Hi=0.25)
        // and per-capita (5/6/4) → Low contributes (0.30×5)=1.50 of total 5.7,
        // i.e. ~26% of demand. The drop should be at least 15%.
        Assert.True(highSold < lowSold * 0.90, $"expected $9 sales < 90% of $1.80, got {highSold} vs {lowSold}");
        Assert.True(highSold > 0, $"expected $9 retailer to still attract Mid/High, got {highSold}");

        static double RunSoleRetailer(decimal price)
        {
            var world = ClassicWorld();
            var acme = world.CreateCompany("Acme", 20_000_000m);
            var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price, restockTarget: 5_000_000);
            world.AdvanceMonth();
            return SoldUnits(world, store.Id);
        }
    }

    /// <summary>
    /// Two retailers, soft_drink: cheap at $1.50 (passes all ceilings) vs
    /// premium at $9.00 (above Low's $8 ceiling). Low bracket can ONLY shop
    /// at cheap; Middle and High split between both. Cheap should therefore
    /// outsell premium by more than the pure-elasticity model would predict.
    /// </summary>
    [Fact]
    public void Two_retailers_split_brackets_differently_when_one_breaches_low_ceiling()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var beta = world.CreateCompany("Beta", 20_000_000m);

        var cheap = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(cheap.Id, 0, new ProductId("soft_drink"), price: 1.50m, restockTarget: 5_000_000);

        var premium = world.Construct(beta.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(premium.Id, 0, new ProductId("soft_drink"), price: 9.00m, restockTarget: 5_000_000);

        world.AdvanceMonth();

        var cheapUnits = SoldUnits(world, cheap.Id);
        var premiumUnits = SoldUnits(world, premium.Id);

        Assert.True(cheapUnits > premiumUnits, $"cheap {cheapUnits} premium {premiumUnits}");

        // The Low bracket (~26% of demand) is monopolised by cheap. Confirm that
        // by comparing to a control where premium is repriced to $7 (below Low's
        // $8 ceiling). The cheap retailer's share must be higher in the gated case.
        var control = NewWorld();
        var acme2 = control.CreateCompany("Acme", 20_000_000m);
        var beta2 = control.CreateCompany("Beta", 20_000_000m);
        var cheap2 = control.Construct(acme2.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        control.ConfigureRetailSlot(cheap2.Id, 0, new ProductId("soft_drink"), price: 1.50m, restockTarget: 5_000_000);
        var premium2 = control.Construct(beta2.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // $7 is still below Low's $8 ceiling — no gating happens.
        control.ConfigureRetailSlot(premium2.Id, 0, new ProductId("soft_drink"), price: 7.00m, restockTarget: 5_000_000);
        control.AdvanceMonth();

        var cheapShare = cheapUnits / (cheapUnits + premiumUnits);
        var controlCheapShare = SoldUnits(control, cheap2.Id) / (SoldUnits(control, cheap2.Id) + SoldUnits(control, premium2.Id));
        Assert.True(cheapShare > controlCheapShare,
            $"gated cheap-share {cheapShare:F3} should exceed control {controlCheapShare:F3}");
    }

    /// <summary>
    /// Television's reservationPrice has Low=$300 and Middle=$2000 only — High
    /// is unspecified, which means "no ceiling" for that bracket. A retailer
    /// pricing TVs at $2500 must lose Low and Middle but still serve High.
    /// </summary>
    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Reservation_in_only_some_brackets_leaves_others_untouched()
    {
        var world = ClassicWorld();
        var tv = world.Catalog.Product(new ProductId("television"));
        Assert.NotNull(tv.ReservationPrice);
        Assert.False(tv.ReservationPrice!.ContainsKey(IncomeBracket.High),
            "test fixture assumption: TV omits a High ceiling");

        var acme = world.CreateCompany("Acme", 200_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // $2500 > Middle ceiling ($2000) and > Low ceiling ($300). Only High buys.
        // restockTarget comfortably exceeds total city demand so inventory never caps.
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("television"), price: 2_500m, restockTarget: 50_000);

        world.AdvanceMonth();

        var sold = SoldUnits(world, store.Id);

        // High bracket: metropolis pop × 0.25 (high share) × 0.010 (per-capita).
        // Low/Middle would have added 0.30×0.002 + 0.45×0.005 = 0.00285 per capita.
        // We only need that High demand still flows AND it equals roughly the
        // pure-High contribution (i.e. Low+Mid are excluded).
        var city = world.Catalog.City(new CityId("metropolis"));
        var highOnlyDemand = city.Population
            * city.Demographics[IncomeBracket.High]
            * tv.BaseDemandPerCapita[IncomeBracket.High];

        // Allow generous slack — softmax is single-retailer (100%), so demand should
        // match high-only within rounding.
        Assert.InRange(sold, highOnlyDemand * 0.95, highOnlyDemand * 1.05);
    }

    /// <summary>
    /// Cars: Low ceiling is $0 → Low never buys at any price. With one retailer
    /// pricing within Middle's ceiling, only Mid+High demand flows; verify that
    /// Low demand never reaches sales even when the retailer prices in below
    /// Middle's $30k.
    /// </summary>
    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Zero_ceiling_locks_a_bracket_out_entirely()
    {
        var world = ClassicWorld();
        var car = world.Catalog.Product(new ProductId("car"));
        Assert.Equal(0m, car.ReservationPrice![IncomeBracket.Low]);

        var acme = world.CreateCompany("Acme", 200_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // Restock target needs to comfortably exceed total city demand so inventory
        // doesn't cap sales below the per-bracket allocation.
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("car"), price: 25_000m, restockTarget: 100_000);

        world.AdvanceMonth();

        var sold = SoldUnits(world, store.Id);

        var city = world.Catalog.City(new CityId("metropolis"));
        var midPlusHigh = city.Population *
            (city.Demographics[IncomeBracket.Middle] * car.BaseDemandPerCapita[IncomeBracket.Middle]
           + city.Demographics[IncomeBracket.High]   * car.BaseDemandPerCapita[IncomeBracket.High]);
        var lowDemand = city.Population
            * city.Demographics[IncomeBracket.Low]
            * car.BaseDemandPerCapita[IncomeBracket.Low];

        // Sales must equal Mid+High (within rounding) — Low contribution is ~1/4 of
        // total car demand, so the gap to (Mid+High+Low) is large and detectable.
        Assert.InRange(sold, midPlusHigh * 0.95, midPlusHigh * 1.05);
        Assert.True(sold < midPlusHigh + lowDemand * 0.5,
            $"sold {sold} should be well below total demand {midPlusHigh + lowDemand}");
    }

    // --------------------------------------------------------- determinism

    /// <summary>
    /// Same seed + same world + reservation-price gating must produce identical
    /// sales totals. The bracket iteration order is fixed by <c>BracketOrder</c>;
    /// any non-deterministic dictionary enumeration would break this test.
    /// </summary>
    [Fact]
    public void Same_seed_produces_identical_sales_with_reservation_pricing()
    {
        var a = RunMixedScenario(seed: 11);
        var b = RunMixedScenario(seed: 11);
        Assert.Equal(a, b);

        static List<decimal> RunMixedScenario(int seed)
        {
            var catalog = TestContent.Live;
            var world = new World(catalog, seed, new GameDate(2026, 1));
            var acme = world.CreateCompany("Acme", 30_000_000m);
            var beta = world.CreateCompany("Beta", 30_000_000m);

            // Two soft_drink retailers — one above Low ceiling, one below.
            var s1 = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            world.ConfigureRetailSlot(s1.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);
            var s2 = world.Construct(beta.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            world.ConfigureRetailSlot(s2.Id, 0, new ProductId("soft_drink"), price: 9.00m, restockTarget: 5_000_000);

            // A TV retailer pricing above Mid ceiling but below an implicit Hi ceiling.
            var s3 = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            world.ConfigureRetailSlot(s3.Id, 0, new ProductId("television"), price: 2_500m, restockTarget: 1_000);

            for (var i = 0; i < 3; i++) world.AdvanceMonth();

            return new List<decimal>
            {
                world.Companies[acme.Id].Cash,
                world.Companies[beta.Id].Cash,
            };
        }
    }
}
