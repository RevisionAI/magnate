using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class TechLeaderTests
{
    private static ContentCatalog Catalog() => TestContent.Live;

    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ============================================================ Hero selection

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Hero_product_is_the_highest_base_price_finished_good()
    {
        // Across the canonical catalog, "car" has the highest BaseWorldMarketPrice
        // among finished goods. The TechLeader should pin it deterministically.
        var world = ClassicWorld();
        var ai = world.CreateCompany("Tech", 50_000_000m);
        world.RegisterAi(ai.Id, new TechLeader());

        world.AdvanceMonth();

        // After the first plan, the AI should have either built an R&D center
        // for the hero or not yet — but any retail/RD it spawned must target "car".
        var spawned = world.Buildings.Values.Where(b => b.Owner == ai.Id).ToList();
        Assert.NotEmpty(spawned);

        var heroProductSlots = spawned
            .SelectMany(b => b.RetailSlots.Select(s => s.Product)
                .Concat(b.ResearchSlots.Select(s => s.Product)))
            .ToList();

        Assert.NotEmpty(heroProductSlots);
        Assert.All(heroProductSlots, p => Assert.Equal(new ProductId("car"), p));
    }

    // ============================================================ R&D coverage

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void TechLeader_builds_research_center_for_hero_when_none_exists()
    {
        // Plenty of cash so the R&D center is the very first move.
        var world = ClassicWorld();
        var ai = world.CreateCompany("Tech", 50_000_000m);
        world.RegisterAi(ai.Id, new TechLeader());

        world.AdvanceMonth();

        var rdCenters = world.Buildings.Values
            .Where(b => b.Owner == ai.Id && b.ResearchSlots.Count > 0)
            .ToList();

        Assert.NotEmpty(rdCenters);
        // Every RD slot the AI created should target the hero product.
        Assert.All(rdCenters, b => Assert.All(b.ResearchSlots,
            s => Assert.Equal(new ProductId("car"), s.Product)));
    }

    // ============================================================ Premium pricing

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void TechLeader_prices_hero_at_premium_above_competitor()
    {
        // Seed a competitor in eastside (high-bracket-rich) selling cars cheaply.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("eastside"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("car"), price: 22_000m, restockTarget: 50);

        var ai = world.CreateCompany("Tech", 80_000_000m);
        world.RegisterAi(ai.Id, new TechLeader());

        // Run enough months for TechLeader to (a) build its R&D centers, then
        // (b) move on to retail expansion. RdCentersTarget=2 → ≥3 ticks.
        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var aiCarSlots = world.Buildings.Values
            .Where(b => b.Owner == ai.Id)
            .SelectMany(b => b.RetailSlots.Where(s => s.Product == new ProductId("car")))
            .ToList();

        Assert.NotEmpty(aiCarSlots);
        var aiCarSlot = aiCarSlots[0];
        // Premium multiplier defaults to 1.30. Competitor at 22000 → target ≥ 22000 × 1.30 = 28600.
        // Allow some slack for repricing math/floor edges.
        Assert.True(aiCarSlot.Price >= 22_000m * 1.29m,
            $"expected premium >=1.29x competitor, got {aiCarSlot.Price}");
    }

    // ============================================================ Brand investment

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void TechLeader_runs_ad_campaign_when_hero_retailer_exists()
    {
        var world = ClassicWorld();
        var ai = world.CreateCompany("Tech", 80_000_000m);
        world.RegisterAi(ai.Id, new TechLeader(adBudgetPerCityHero: 80_000m));

        // Tick enough months for the AI to: build 2 R&D, then a retailer for cars,
        // then on the subsequent tick register a TV ad campaign.
        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var heroRetailers = world.Buildings.Values
            .Where(b => b.Owner == ai.Id)
            .Where(b => b.RetailSlots.Any(s => s.Product == new ProductId("car")))
            .ToList();

        Assert.NotEmpty(heroRetailers);
        var heroRetailerCity = heroRetailers[0].City;

        var campaign = world.GetAdCampaign(ai.Id, new ProductId("car"), heroRetailerCity, AdChannel.TV);
        Assert.NotNull(campaign);
        Assert.Equal(80_000m, campaign!.MonthlyBudget);
    }

    // ============================================================ Save/load

    [Fact]
    public void TechLeader_config_round_trips_through_save_load()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"magnate-tl-{Guid.NewGuid():N}.json");
        try
        {
            var world = NewWorld();
            var techCo = world.CreateCompany("Tech", 5_000_000m);

            var original = new TechLeader(
                rdCentersTarget:      4,
                maxRetailersPerCity:  3,
                maxCities:            5,
                premiumMultiplier:    1.45m,
                priceFloorMultiplier: 1.20m,
                adBudgetPerCityHero:  120_000m,
                minHighBracketShare:  0.30);
            world.RegisterAi(techCo.Id, original);

            WorldSaver.Save(world, tempFile);
            var loaded = WorldLoader.Load(Catalog(), tempFile).World;

            var restored = Assert.IsType<TechLeader>(loaded.InternalAiStrategies[techCo.Id]);
            Assert.Equal(original.RdCentersTarget,      restored.RdCentersTarget);
            Assert.Equal(original.MaxRetailersPerCity,  restored.MaxRetailersPerCity);
            Assert.Equal(original.MaxCities,            restored.MaxCities);
            Assert.Equal(original.PremiumMultiplier,    restored.PremiumMultiplier);
            Assert.Equal(original.PriceFloorMultiplier, restored.PriceFloorMultiplier);
            Assert.Equal(original.AdBudgetPerCityHero,  restored.AdBudgetPerCityHero);
            Assert.Equal(original.MinHighBracketShare,  restored.MinHighBracketShare);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    // ============================================================ Determinism

    [Fact]
    public void TechLeader_is_deterministic()
    {
        var a = RunTechLeader(seed: 17);
        var b = RunTechLeader(seed: 17);
        Assert.Equal(a, b);
    }

    private static (decimal cash, int buildings) RunTechLeader(int seed)
    {
        var world = new World(Catalog(), seed, new GameDate(2026, 1));
        var ai = world.CreateCompany("Tech", 60_000_000m);
        world.RegisterAi(ai.Id, new TechLeader());
        for (var i = 0; i < 8; i++) world.AdvanceMonth();
        return (ai.Cash, world.Buildings.Values.Count(b => b.Owner == ai.Id));
    }
}
