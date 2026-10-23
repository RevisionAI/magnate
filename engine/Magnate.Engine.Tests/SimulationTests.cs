using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class SimulationTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    [Fact]
    public void World_starts_at_provided_date()
    {
        var world = NewWorld();
        Assert.Equal(new GameDate(2026, 1), world.Clock.Now);
    }

    [Fact]
    public void AdvanceMonth_rolls_year_over_december()
    {
        var world = NewWorld();
        for (var i = 0; i < 12; i++) world.AdvanceMonth();
        Assert.Equal(new GameDate(2027, 1), world.Clock.Now);
    }

    [Fact]
    public void CreateCompany_logs_starting_capital_and_sets_cash()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        Assert.Equal(10_000_000m, acme.Cash);
        var entries = world.Ledger.EntriesFor(acme.Id).ToList();
        Assert.Single(entries);
        Assert.Equal(LedgerCategory.StartingCapital, entries[0].Category);
        Assert.Equal(10_000_000m, entries[0].Amount);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Construct_charges_cost_and_adds_building_to_company()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));

        var type = world.Catalog.BuildingType(new BuildingTypeId("factory_small"));
        Assert.Equal(10_000_000m - type.ConstructionCost, acme.Cash);
        Assert.Contains(factory.Id, acme.OwnedBuildings);
    }

    [Fact]
    public void Construct_rejects_insufficient_cash()
    {
        var world = NewWorld();
        var poor = world.CreateCompany("Poor Inc", 100m);

        Assert.Throws<System.InvalidOperationException>(() =>
            world.Construct(poor.Id, new BuildingTypeId("factory_small"), new CityId("metropolis")));
    }

    [Fact]
    public void ConfigureProductionSlot_rejects_raw_products()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));

        Assert.Throws<System.InvalidOperationException>(() =>
            world.ConfigureProductionSlot(factory.Id, 0, new ProductId("sugarcane")));
    }

    /// <summary>
    /// Core accounting invariant: Company.Cash must equal the signed sum of all
    /// ledger entries for that company. Every cash mutation goes through
    /// RecordCashChange which ties the two together.
    /// </summary>
    [Fact]
    public void Cash_equals_sum_of_ledger_entries_after_simulation()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 500_000);

        for (var i = 0; i < 12; i++) world.AdvanceMonth();

        var ledgerSum = world.Ledger.EntriesFor(acme.Id).Sum(e => e.Amount);
        Assert.Equal(acme.Cash, ledgerSum);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Factory_produces_output_and_exports()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth();

        Assert.Contains(world.Ledger.EntriesFor(acme.Id), e => e.Category == LedgerCategory.InputPurchase);
        Assert.Contains(world.Ledger.EntriesFor(acme.Id), e => e.Category == LedgerCategory.ExportSale);
        Assert.Equal(0, factory.Inventory.Get(new ProductId("soft_drink")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Standalone_factory_is_profitable_over_a_year()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        var cashBeforeOps = acme.Cash; // after construction, before ticks

        for (var i = 0; i < 12; i++) world.AdvanceMonth();

        var twelveMonthPnl = world.GetIncomeStatement(
            acme.Id,
            new GameDate(2026, 2), // first tick advances to Feb 2026
            world.Clock.Now);

        Assert.True(twelveMonthPnl.NetIncome > 0, $"expected profit, got {twelveMonthPnl.NetIncome}");
        Assert.True(acme.Cash > cashBeforeOps, $"expected cash to grow, was {cashBeforeOps}, now {acme.Cash}");
    }

    [Fact]
    public void Retailer_sells_to_city_consumers_and_logs_product_sales()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 3_000_000);

        world.AdvanceMonth();

        var sales = world.Ledger.EntriesFor(acme.Id).Where(e => e.Category == LedgerCategory.ProductSale).ToList();
        Assert.NotEmpty(sales);
        Assert.True(sales.Sum(e => e.Amount) > 0);
    }

    [Fact]
    public void Two_retailers_share_demand_by_inverse_price()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var beta = world.CreateCompany("Beta", 20_000_000m);

        var cheap = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(cheap.Id, 0, new ProductId("soft_drink"), price: 1.50m, restockTarget: 30_000_000);

        var premium = world.Construct(beta.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(premium.Id, 0, new ProductId("soft_drink"), price: 3.00m, restockTarget: 30_000_000);

        world.AdvanceMonth();

        var cheapUnits = UnitsSold(world, cheap.Id);
        var premiumUnits = UnitsSold(world, premium.Id);

        Assert.True(cheapUnits > premiumUnits, $"cheap={cheapUnits}, premium={premiumUnits}");
    }

    [Fact]
    public void Simulation_is_deterministic_for_same_seed()
    {
        var a = RunScenario(seed: 7);
        var b = RunScenario(seed: 7);
        Assert.Equal(a, b);
    }

    private static decimal RunScenario(int seed)
    {
        var catalog = TestContent.Live;
        var world = new World(catalog, seed, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        return acme.Cash;
    }

    private static double UnitsSold(World world, BuildingInstanceId building)
    {
        var owner = world.Buildings[building].Owner;
        var price = world.Buildings[building].RetailSlots[0].Price;
        return world.Ledger.Entries
            .Where(e => e.Company == owner && e.Category == LedgerCategory.ProductSale)
            .Sum(e => (double)(e.Amount / price));
    }

    // ============================================================ Phase 1.3

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Extraction_slot_produces_raw_each_month()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        // Don't auto-export so we can observe inventory build-up.
        farm.AutoExport = false;
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));

        world.AdvanceMonth();

        // sugarcane base yield is 400/slot/month per content/data/products/raws.json
        Assert.Equal(400.0, farm.Inventory.Get(new ProductId("sugarcane")));
    }

    [Fact]
    public void ConfigureExtractionSlot_rejects_mismatched_building_category()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var mine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("metropolis"));

        // sugarcane extracts from a farm, not a mine.
        Assert.Throws<System.InvalidOperationException>(() =>
            world.ConfigureExtractionSlot(mine.Id, 0, new ProductId("sugarcane")));
    }

    [Fact]
    public void ConfigureExtractionSlot_rejects_intermediate_product()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));

        Assert.Throws<System.InvalidOperationException>(() =>
            world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugar")));
    }

    [Fact]
    public void Factory_pulls_inputs_from_own_upstream_factory_in_same_city()
    {
        // Acme owns a sugar factory. The soft_drink factory should pull sugar internally,
        // never spending money on the world market for it.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        var sugarFactory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarFactory.Id, 0, new ProductId("sugar"));

        var drinkFactory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkFactory.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth();

        // Filter pattern "sugar →" matches "sugar" (followed by the arrow in the memo)
        // but NOT "sugarcane" (which the sugar factory legitimately buys from the world market here).
        var sugarMarketBuys = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.InputPurchase && (e.Memo ?? "").Contains("sugar →"))
            .ToList();

        Assert.Empty(sugarMarketBuys);
    }

    [Fact]
    public void Retailer_pulls_inventory_from_own_factory_when_available()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        // Factory produces 200 cycles × 1000 = 200k soft_drink, more than the 100k restock target.
        // Retailer pull should be entirely internal: zero RetailRestock cost.
        var restockCost = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.RetailRestock)
            .Sum(e => -e.Amount);

        Assert.Equal(0m, restockCost);
    }

    [Fact]
    public void Vertical_chain_only_imports_unbacked_inputs_from_world_market()
    {
        // Acme has farm → sugar factory → soft_drink factory → supermarket.
        // Sugarcane and sugar should never hit the world market.
        // Only plastic (no internal supplier) should incur InputPurchase cost.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 300_000_000m);

        // Two farms (six slots) cover a sugar line's monthly cane even with per-unit recipes.
        for (var f = 0; f < 2; f++)
        {
            var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
            for (var slot = 0; slot < 3; slot++) world.ConfigureExtractionSlot(farm.Id, slot, new ProductId("sugarcane"));
        }

        var sugarFactory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarFactory.Id, 0, new ProductId("sugar"));

        var drinkFactory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkFactory.Id, 0, new ProductId("soft_drink"));

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        var inputBuys = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.InputPurchase)
            .ToList();

        // No sugarcane buys — farm covers it.
        Assert.DoesNotContain(inputBuys, e => (e.Memo ?? "").Contains("sugarcane →"));
        // No sugar buys — sugarFactory covers it. (The "→" disambiguates from "sugarcane".)
        Assert.DoesNotContain(inputBuys, e => (e.Memo ?? "").Contains("sugar →"));
        // Plastic IS bought from world (no internal source).
        Assert.Contains(inputBuys, e => (e.Memo ?? "").Contains("plastic →"));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AutoExport_only_dumps_surplus_after_retailers_have_pulled()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 50_000);

        world.AdvanceMonth();

        // Factory makes 200k bottles. Retailer pulls 50k. Surplus 150k is exported.
        // Export ledger entry should reflect 150k × $1.50 = $225,000.
        var exports = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ExportSale)
            .Sum(e => e.Amount);

        Assert.Equal(225_000m, exports);
    }
}
