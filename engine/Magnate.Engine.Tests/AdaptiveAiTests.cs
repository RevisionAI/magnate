using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class AdaptiveAiTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ========================================================== Retail expansion

    [Fact]
    public void AdaptiveStrategy_builds_retail_on_first_tick()
    {
        var world = NewWorld();
        var ai = world.CreateCompany("AdaptiveCo", 15_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());

        world.AdvanceMonth();

        var retailers = world.Buildings.Values
            .Where(b => b.Owner == ai.Id && b.RetailSlots.Count > 0)
            .ToList();
        Assert.Single(retailers);
    }

    // ========================================================== Ad campaigns

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_starts_tv_ads_in_contested_markets()
    {
        // Seed a competitor in bread Metropolis so the AI sees a contested market
        // and elects to advertise there. (In uncontested markets the AI correctly
        // spends nothing — see AdaptiveStrategy_does_not_advertise_in_monopoly_markets.)
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 500_000);

        var ai = world.CreateCompany("AdaptiveCo", 30_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy(adBudgetPerCity: 50_000m));

        // Month 1: AI builds bread-Metropolis retailer (now contested).
        // Month 2: AI's second plan sees the contested market and starts TV ads.
        world.AdvanceMonth();
        world.AdvanceMonth();

        var campaign = world.GetAdCampaign(ai.Id, new ProductId("bread"), new CityId("metropolis"), AdChannel.TV);
        Assert.NotNull(campaign);
        Assert.Equal(50_000m, campaign!.MonthlyBudget);
    }

    [Fact]
    public void AdaptiveStrategy_does_not_advertise_in_monopoly_markets()
    {
        // When no competitor sells the same product in the same city, the AI
        // shouldn't waste money on ads — every sale is already guaranteed.
        var world = NewWorld();
        var ai = world.CreateCompany("AdaptiveCo", 30_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy(adBudgetPerCity: 50_000m));

        for (var i = 0; i < 3; i++) world.AdvanceMonth();

        Assert.DoesNotContain(world.AdCampaigns, c => c.Company == ai.Id);
    }

    [Fact]
    public void AdaptiveStrategy_skips_ads_when_cash_cushion_inadequate()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 500_000);

        // AI with an absurdly high ad budget → cushion check will never pass.
        var ai = world.CreateCompany("AdaptiveCo", 5_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy(adBudgetPerCity: 10_000_000m));

        for (var i = 0; i < 3; i++) world.AdvanceMonth();

        Assert.DoesNotContain(world.AdCampaigns, c => c.Company == ai.Id);
    }

    // ========================================================== Price adjustments

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_undercuts_existing_competitor()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 4.00m, restockTarget: 500_000);

        var ai = world.CreateCompany("AdaptiveCo", 15_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());

        world.AdvanceMonth();

        var aiStore = world.Buildings.Values.Single(b => b.Owner == ai.Id);
        var aiSlot = aiStore.RetailSlots.Single();
        Assert.Equal(new ProductId("bread"), aiSlot.Product);
        Assert.True(aiSlot.Price < 4.00m, $"expected undercut, got {aiSlot.Price}");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_floors_price_at_wholesale_markup_even_with_aggressive_competitor()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // Predatory price: well below wholesale × 1.05.
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 2.00m, restockTarget: 500_000);

        var ai = world.CreateCompany("AdaptiveCo", 15_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());

        world.AdvanceMonth();

        var aiSlot = world.Buildings.Values.Single(b => b.Owner == ai.Id).RetailSlots.Single();
        var breadWorld = (decimal)world.Catalog.Product(new ProductId("bread")).BaseWorldMarketPrice;
        Assert.True(aiSlot.Price >= breadWorld * 1.05m, $"price {aiSlot.Price} breached floor");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_reprices_existing_slots_when_a_new_competitor_arrives()
    {
        var world = ClassicWorld();
        var ai = world.CreateCompany("AdaptiveCo", 20_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());

        // Solo: AI builds at world × 1.2 = $3.00 for bread.
        world.AdvanceMonth();
        var aiStore = world.Buildings.Values.First(b => b.Owner == ai.Id);
        Assert.Equal(3.00m, aiStore.RetailSlots[0].Price);

        // A competitor suddenly enters the bread market at $2.80.
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("bread"), price: 2.80m, restockTarget: 500_000);

        world.AdvanceMonth();

        // AI should have repriced below $2.80 (specifically, 2.80 × 0.95 = 2.66)
        Assert.InRange(aiStore.RetailSlots[0].Price, 2.65m, 2.67m);
    }

    // ========================================================== R&D

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_builds_research_center_once_retail_is_saturated()
    {
        var world = ClassicWorld();
        // Plenty of cash so the AI can fill every (finished × city) market and still pivot to R&D.
        var ai = world.CreateCompany("AdaptiveCo", 240_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());

        // Time budget scales with content: one month per market plus a 15-month tail
        // for R&D construction. Keeps the test robust as new finished goods are added.
        var finishedCount = world.Catalog.Products.Values.Count(p => p.Tier == ProductTier.Finished);
        var cityCount = world.Catalog.Cities.Count;
        var months = finishedCount * cityCount + 15;
        for (var i = 0; i < months; i++) world.AdvanceMonth();

        var hasRd = world.Buildings.Values
            .Any(b => b.Owner == ai.Id && b.ResearchSlots.Count > 0);
        Assert.True(hasRd, "AI should have built an R&D center after filling all retail markets");
    }

    // ========================================================== Head-to-head

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy()
    {
        // Both AIs fill the same markets. Adaptive spends on ads in contested markets;
        // Simple does not. Neither should dominate — the test just locks in that
        // adaptive is profitable and not catastrophically behind over 18 months of mutual
        // competition. The real dominance shows up against Acme's chain-building setup
        // (see the cockpit scenario).
        var world = ClassicWorld();
        var adaptive = world.CreateCompany("Adaptive", 30_000_000m);
        world.RegisterAi(adaptive.Id, new AdaptiveStrategy());

        var simple = world.CreateCompany("Simple", 30_000_000m);
        world.RegisterAi(simple.Id, new SimpleRetailerStrategy());

        for (var i = 0; i < 18; i++) world.AdvanceMonth();

        var adaptiveIncome = world.GetIncomeStatement(adaptive.Id, new GameDate(2026, 2), world.Clock.Now).NetIncome;
        var simpleIncome = world.GetIncomeStatement(simple.Id, new GameDate(2026, 2), world.Clock.Now).NetIncome;

        Assert.True(adaptiveIncome > 0, $"adaptive should be profitable, got {adaptiveIncome}");
        Assert.True(simpleIncome > 0, $"simple should also be profitable, got {simpleIncome}");
        // Adaptive should be within an order of magnitude of simple (relaxed: >= 0.5×).
        Assert.True(adaptiveIncome * 2 > simpleIncome,
            $"adaptive income {adaptiveIncome} should be at least half simple's {simpleIncome}");
    }

    // ========================================================== Determinism

    [Fact]
    public void AdaptiveStrategy_is_deterministic()
    {
        var a = RunAdaptive(seed: 13);
        var b = RunAdaptive(seed: 13);
        Assert.Equal(a, b);
    }

    private static (decimal cash, int buildings) RunAdaptive(int seed)
    {
        var catalog = TestContent.Live;
        var world = new World(catalog, seed, new GameDate(2026, 1));
        var ai = world.CreateCompany("Adaptive", 25_000_000m);
        world.RegisterAi(ai.Id, new AdaptiveStrategy());
        for (var i = 0; i < 8; i++) world.AdvanceMonth();
        return (ai.Cash, world.Buildings.Values.Count(b => b.Owner == ai.Id));
    }
}
