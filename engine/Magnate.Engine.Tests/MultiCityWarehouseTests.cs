using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class MultiCityWarehouseTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ========================================================== Multi-city catalog

    [Fact]
    public void All_five_cities_load()
    {
        var world = NewWorld();
        Assert.True(world.Catalog.Cities.ContainsKey(new CityId("metropolis")));
        Assert.True(world.Catalog.Cities.ContainsKey(new CityId("riverside")));
        Assert.True(world.Catalog.Cities.ContainsKey(new CityId("hilltown")));
        Assert.True(world.Catalog.Cities.ContainsKey(new CityId("portbay")));
        Assert.True(world.Catalog.Cities.ContainsKey(new CityId("eastside")));
    }

    [Fact]
    public void Demand_in_each_city_scales_with_population_and_demographics()
    {
        var world = NewWorld();

        var bread = world.Catalog.Product(new ProductId("bread"));
        double Demand(string cityId)
        {
            var c = world.Catalog.City(new CityId(cityId));
            double total = 0;
            foreach (var (b, share) in c.Demographics)
            {
                var pc = bread.BaseDemandPerCapita.TryGetValue(b, out var v) ? v : 0;
                total += c.Population * share * pc;
            }
            return total;
        }

        // Metropolis (largest pop) > Riverside > Portbay > Hilltown for bread.
        Assert.True(Demand("metropolis") > Demand("riverside"));
        Assert.True(Demand("riverside")  > Demand("portbay"));
        Assert.True(Demand("portbay")    > Demand("hilltown"));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Stores_in_different_cities_dont_compete_for_demand()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 30_000_000m);

        var metStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(metStore.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 5_000_000);

        var hillStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("hilltown"));
        world.ConfigureRetailSlot(hillStore.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 5_000_000);

        world.AdvanceMonth();

        // Each store gets only its own city's demand (no leakage).
        // Metropolis bread demand ≈ 3.575M; Hilltown bread demand ≈ 640k.
        var metSold = SoldUnits(world, metStore.Id, "bread");
        var hillSold = SoldUnits(world, hillStore.Id, "bread");

        Assert.InRange(metSold, 3_500_000, 3_650_000);
        Assert.InRange(hillSold, 600_000, 700_000);
    }

    // ========================================================== Warehouses

    [Fact]
    public void Warehouse_stocks_from_world_market_when_no_internal_supply()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var wh = world.Construct(acme.Id, new BuildingTypeId("warehouse_small"), new CityId("metropolis"));
        world.ConfigureWarehouseSlot(wh.Id, 0, new ProductId("steel"), targetStock: 1_000);

        world.AdvanceMonth();

        Assert.Equal(1_000, wh.Inventory.Get(new ProductId("steel")));
        Assert.Contains(world.Ledger.EntriesFor(acme.Id),
            e => e.Category == LedgerCategory.InputPurchase && e.Product == new ProductId("steel"));
    }

    [Fact]
    public void Warehouse_keeps_stock_across_months_no_auto_export()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var wh = world.Construct(acme.Id, new BuildingTypeId("warehouse_small"), new CityId("metropolis"));
        world.ConfigureWarehouseSlot(wh.Id, 0, new ProductId("steel"), targetStock: 1_000);

        for (var i = 0; i < 3; i++) world.AdvanceMonth();

        // Still exactly 1,000 — warehouse top-up keeps the level fixed and doesn't auto-export.
        Assert.Equal(1_000, wh.Inventory.Get(new ProductId("steel")));
    }

    [Fact]
    public void Retailer_pulls_from_warehouse_in_same_city()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var wh = world.Construct(acme.Id, new BuildingTypeId("warehouse_small"), new CityId("metropolis"));
        world.ConfigureWarehouseSlot(wh.Id, 0, new ProductId("soft_drink"), targetStock: 5_000_000);

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        // Restock should be free from store's perspective — it pulled from warehouse, not market.
        var storeRestockEntries = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.RetailRestock
                     && (e.Memo ?? "").Contains($"{store.Id}"))
            .ToList();
        Assert.Empty(storeRestockEntries);

        // And a transfer warehouse → store must exist.
        Assert.Contains(world.TransferLog.EntriesFor(acme.Id),
            t => t.From == wh.Id && t.To == store.Id && t.Product == new ProductId("soft_drink"));
    }

    [Fact]
    public void ConfigureWarehouseSlot_rejects_non_warehouse_buildings()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));

        Assert.Throws<System.InvalidOperationException>(() =>
            world.ConfigureWarehouseSlot(factory.Id, 0, new ProductId("steel"), targetStock: 1000));
    }

    // ========================================================== Inter-city shipping

    [Fact]
    public void Inter_city_pull_charges_shipping()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        // Iron mine in Riverside (mineral-rich), warehouse in Riverside, factory in Metropolis.
        var mine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("riverside"));
        world.ConfigureExtractionSlot(mine.Id, 0, new ProductId("iron_ore"));
        // Disable auto-export so the mine retains stock for the inter-city pull.
        mine.AutoExport = false;

        var steelPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(steelPlant.Id, 0, new ProductId("steel"));

        world.AdvanceMonth();

        // Steel plant should have pulled iron_ore from Riverside mine, paying shipping.
        var shipping = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ShippingCost
                     && e.Product == new ProductId("iron_ore"))
            .ToList();
        Assert.NotEmpty(shipping);
    }

    [Fact]
    public void Same_city_pull_does_not_charge_shipping()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        var mine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(mine.Id, 0, new ProductId("iron_ore"));

        var steelPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(steelPlant.Id, 0, new ProductId("steel"));

        world.AdvanceMonth();

        var shipping = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ShippingCost)
            .ToList();
        Assert.Empty(shipping);
    }

    [Fact]
    public void Same_city_source_is_preferred_over_other_city_source()
    {
        // Acme has iron mines in BOTH Metropolis (low id) and Riverside.
        // Steel plant in Metropolis should pull from local mine first — no shipping.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 300_000_000m);

        var localMine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("metropolis"));
        // Two slots = 600 t/mo, comfortably exceeding the steel plant's 400 t/mo need.
        world.ConfigureExtractionSlot(localMine.Id, 0, new ProductId("iron_ore"));
        world.ConfigureExtractionSlot(localMine.Id, 1, new ProductId("iron_ore"));
        localMine.AutoExport = false;

        var farMine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("riverside"));
        world.ConfigureExtractionSlot(farMine.Id, 0, new ProductId("iron_ore"));
        farMine.AutoExport = false;

        var steelPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(steelPlant.Id, 0, new ProductId("steel"));

        world.AdvanceMonth();

        // No shipping charged — local mine had enough.
        var shipping = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ShippingCost)
            .ToList();
        Assert.Empty(shipping);
    }

    // ========================================================== helpers

    private static double SoldUnits(World world, BuildingInstanceId building, string productId)
    {
        var owner = world.Buildings[building].Owner;
        var product = new ProductId(productId);
        var slot = world.Buildings[building].RetailSlots.Single(s => s.Product == product);
        return world.Ledger.Entries
            .Where(e => e.Company == owner
                     && e.Category == LedgerCategory.ProductSale
                     && e.Product == product
                     && (e.Memo ?? "").Contains($"@ {building}"))
            .Sum(e => (double)(e.Amount / slot.Price));
    }
}
