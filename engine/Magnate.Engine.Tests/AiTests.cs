using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class AiTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    [Fact]
    public void Ai_builds_a_supermarket_on_first_month()
    {
        var world = NewWorld();
        var ai = world.CreateCompany("RivalCo", 15_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        world.AdvanceMonth();

        var aiBuildings = world.Buildings.Values.Where(b => b.Owner == ai.Id).ToList();
        Assert.Single(aiBuildings);
        Assert.Single(aiBuildings[0].RetailSlots);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Ai_targets_the_biggest_unmet_demand_first()
    {
        // Bread (3.575M units) has the largest finished-goods demand in Metropolis.
        var world = ClassicWorld();
        var ai = world.CreateCompany("RivalCo", 15_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        world.AdvanceMonth();

        var slot = world.Buildings.Values.Single(b => b.Owner == ai.Id).RetailSlots.Single();
        Assert.Equal(new ProductId("bread"), slot.Product);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Ai_undercuts_an_existing_competitor_price()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // Set a deliberately high bread price so undercut clearly beats the wholesale floor.
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 4.00m, restockTarget: 500_000);

        var ai = world.CreateCompany("RivalCo", 15_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        world.AdvanceMonth();

        var aiSlot = world.Buildings.Values.Single(b => b.Owner == ai.Id).RetailSlots.Single();
        Assert.Equal(new ProductId("bread"), aiSlot.Product);
        Assert.True(aiSlot.Price < 4.00m, $"expected AI price < $4.00, got {aiSlot.Price}");
        Assert.True(aiSlot.Price >= 2.50m * 1.05m, $"expected AI price >= wholesale floor, got {aiSlot.Price}");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Ai_eventually_serves_multiple_products_over_several_months()
    {
        // With 4 cities the AI fills bread across all cities before moving to soft_drink,
        // then t_shirt. Needs ~10 months to reach the third product type.
        var world = ClassicWorld();
        var ai = world.CreateCompany("RivalCo", 60_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        for (var i = 0; i < 10; i++) world.AdvanceMonth();

        var distinctProducts = world.Buildings.Values
            .Where(b => b.Owner == ai.Id)
            .SelectMany(b => b.RetailSlots)
            .Select(s => s.Product)
            .Distinct()
            .Count();

        Assert.True(distinctProducts >= 3, $"expected >= 3 distinct products, got {distinctProducts}");
    }

    [Fact]
    public void Ai_skips_action_when_cushion_unaffordable()
    {
        var world = NewWorld();
        // Just enough to create a company but nowhere near the supermarket cushion.
        var ai = world.CreateCompany("BrokeCo", 100_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        world.AdvanceMonth();

        Assert.DoesNotContain(world.Buildings.Values, b => b.Owner == ai.Id);
    }

    [Fact]
    public void Player_and_ai_split_the_market_when_both_sell_same_product()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 4_000_000);

        var ai = world.CreateCompany("RivalCo", 15_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());

        world.AdvanceMonth();

        var acmeSales = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);
        var aiSales = world.Ledger.EntriesFor(ai.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);

        Assert.True(acmeSales > 0, "Acme should still sell something");
        Assert.True(aiSales > 0, "AI should sell something");
    }

    [Fact]
    public void Ai_decisions_are_deterministic_for_same_seed()
    {
        var a = RunAiOnly(seed: 7);
        var b = RunAiOnly(seed: 7);
        Assert.Equal(a, b);
    }

    private static (decimal cash, int buildingCount) RunAiOnly(int seed)
    {
        var catalog = TestContent.Live;
        var world = new World(catalog, seed, new GameDate(2026, 1));
        var ai = world.CreateCompany("RivalCo", 30_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy());
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        return (ai.Cash, world.Buildings.Values.Count(b => b.Owner == ai.Id));
    }
}
