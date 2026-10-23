using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class QualityBrandTechTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ======================================================== Quality — plumbing

    [Fact]
    public void Inventory_average_quality_is_weighted_by_quantity()
    {
        var inv = new Inventory();
        var p = new ProductId("sugar");
        inv.Add(p, 1000, 100m, quality: 80);
        inv.Add(p, 1000, 100m, quality: 40);

        // Weighted by qty: (80*1000 + 40*1000) / 2000 = 60
        Assert.Equal(60.0, inv.AverageQuality(p));
    }

    [Fact]
    public void Inventory_take_returns_current_average_quality()
    {
        var inv = new Inventory();
        var p = new ProductId("sugar");
        inv.Add(p, 1000, 100m, quality: 80);
        inv.Add(p, 1000, 100m, quality: 40);

        var draw = inv.Take(p, 500);
        Assert.Equal(60.0, draw.AverageQuality);
        // Remaining inventory still averages 60 (proportional take preserves blend).
        Assert.Equal(60.0, inv.AverageQuality(p));
    }

    [Fact]
    public void Market_bought_goods_carry_world_market_quality()
    {
        var world = NewWorld();
        var softDrink = world.Catalog.Product(new ProductId("soft_drink"));
        var metropolis = world.Catalog.City(new CityId("metropolis"));
        // Restock comfortably above the whole city's demand so leftover remains at end-of-tick
        // (derived from the catalog so content rebalancing can't break it — test-map C03).
        var cityDemand = softDrink.BaseDemandPerCapita.Sum(kv =>
            metropolis.Population * (metropolis.Demographics.TryGetValue(kv.Key, out var share) ? share : 0) * kv.Value);
        var restock = 2 * cityDemand + 1_000;
        var acme = world.CreateCompany("Acme", 10_000_000m + (decimal)restock * (decimal)softDrink.BaseWorldMarketPrice);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, softDrink.Id, price: (decimal)softDrink.BaseWorldMarketPrice * 1.2m, restockTarget: restock);

        world.AdvanceMonth();

        var q = store.Inventory.AverageQuality(new ProductId("soft_drink"));
        Assert.Equal(SimulationConstants.WorldMarketQuality, q);
    }

    [Fact]
    public void Extracted_raws_carry_extraction_quality()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        farm.AutoExport = false;

        world.AdvanceMonth();

        Assert.Equal(SimulationConstants.ExtractionQuality,
            farm.Inventory.AverageQuality(new ProductId("sugarcane")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Production_output_quality_is_weighted_average_of_inputs()
    {
        // Soft_drink recipe: 20 sugar + 5 plastic → 1000 bottles.
        // Pre-seed both inputs in drink plant at known qualities. EnsureAvailable
        // checks on-hand first and only procures the shortfall — with seeded
        // stock matching exactly what 200 cycles need, no procurement runs.
        // Output Q = (80×4000 + 50×1000) / 5000 = 74
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 30_000_000m);

        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkPlant.Id, 0, new ProductId("soft_drink"));
        drinkPlant.AutoExport = false;

        drinkPlant.Inventory.Add(new ProductId("sugar"),   4_000, cost: 8_000m, quality: 80);
        drinkPlant.Inventory.Add(new ProductId("plastic"), 1_000, cost: 3_000m, quality: 50);

        world.AdvanceMonth();

        var softDrinkQ = drinkPlant.Inventory.AverageQuality(new ProductId("soft_drink"));
        Assert.InRange(softDrinkQ, 73.9, 74.1);
    }

    // ======================================================== Tech — storage

    [Fact]
    public void Tech_level_defaults_to_base()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        Assert.Equal(SimulationConstants.BaseTechLevel,
            world.GetTech(acme.Id, new ProductId("soft_drink")));
    }

    [Fact]
    public void Tech_level_cannot_exceed_product_max()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var maxTech = world.Catalog.Product(new ProductId("soft_drink")).MaxTechLevel;

        world.SetTech(acme.Id, new ProductId("soft_drink"), maxTech);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            world.SetTech(acme.Id, new ProductId("soft_drink"), maxTech + 1));
    }

    [Fact]
    public void Tech_level_rejects_below_one()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            world.SetTech(acme.Id, new ProductId("soft_drink"), 0));
    }

    // ======================================================== Brand — storage

    [Fact]
    public void Brand_awareness_defaults_to_zero()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        Assert.Equal(0.0, world.GetBrandAwareness(
            acme.Id, new ProductId("soft_drink"), new CityId("metropolis")));
    }

    [Fact]
    public void Brand_awareness_rejects_out_of_range()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), -1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 101));
    }

    // ======================================================== Demand allocation

    [Fact]
    public void Higher_tech_company_wins_more_share_at_equal_price()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 15_000_000m);
        var rival = world.CreateCompany("Rival", 15_000_000m);

        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        var rivalStore = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(rivalStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        // Acme at tech 5, Rival at tech 1 — both buy from world (same Q), zero brand.
        world.SetTech(acme.Id, new ProductId("soft_drink"), 5);

        world.AdvanceMonth();

        var acmeSold = SoldUnits(world, acmeStore.Id);
        var rivalSold = SoldUnits(world, rivalStore.Id);
        Assert.True(acmeSold > rivalSold, $"acme {acmeSold} rival {rivalSold}");
    }

    [Fact]
    public void Higher_brand_awareness_wins_more_share_at_equal_price_in_that_city()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 15_000_000m);
        var rival = world.CreateCompany("Rival", 15_000_000m);

        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        var rivalStore = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(rivalStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 80);

        world.AdvanceMonth();

        Assert.True(SoldUnits(world, acmeStore.Id) > SoldUnits(world, rivalStore.Id));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Premium_retailer_can_still_win_when_quality_overcomes_price_gap()
    {
        // Acme sells at a 30% premium ($2.34 vs $1.80) but with full brand and tech advantage —
        // high-enough perceived value to outsell the cheap competitor.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 15_000_000m);
        var rival = world.CreateCompany("Rival", 15_000_000m);

        var premium = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(premium.Id, 0, new ProductId("soft_drink"), price: 2.34m, restockTarget: 5_000_000);

        var cheap = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(cheap.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        // Max tech + strong brand for Acme; Rival has defaults.
        world.SetTech(acme.Id, new ProductId("soft_drink"),
            world.Catalog.Product(new ProductId("soft_drink")).MaxTechLevel);
        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 90);

        world.AdvanceMonth();

        Assert.True(SoldUnits(world, premium.Id) > SoldUnits(world, cheap.Id),
            $"premium {SoldUnits(world, premium.Id)} cheap {SoldUnits(world, cheap.Id)}");
    }

    [Fact]
    public void Equal_attributes_and_price_give_equal_shares()
    {
        // Regression: with all-default Q/T/B and matched prices, the new formula should
        // still split the market roughly 50/50 (tiny differences allowed for elasticity math).
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 15_000_000m);
        var rival = world.CreateCompany("Rival", 15_000_000m);

        var a = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(a.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        var b = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        world.AdvanceMonth();

        var aUnits = SoldUnits(world, a.Id);
        var bUnits = SoldUnits(world, b.Id);
        Assert.InRange(aUnits / bUnits, 0.98, 1.02);
    }

    // ======================================================== helpers

    private static double SoldUnits(World world, BuildingInstanceId building)
    {
        var owner = world.Buildings[building].Owner;
        var price = world.Buildings[building].RetailSlots[0].Price;
        return world.Ledger.Entries
            .Where(e => e.Company == owner && e.Category == LedgerCategory.ProductSale)
            .Sum(e => (double)(e.Amount / price));
    }
}
