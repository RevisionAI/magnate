using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class EventTests : IDisposable
{
    private readonly string _tempFile;

    public EventTests()
    {
        _tempFile = Path.Combine(Path.GetTempPath(), $"magnate-event-test-{Guid.NewGuid():N}.json");
    }

    public void Dispose()
    {
        if (File.Exists(_tempFile)) File.Delete(_tempFile);
    }

    private static ContentCatalog Catalog() => TestContent.Live;

    /// <summary>
    /// Build a catalog whose <c>data/events/</c> directory does not exist, by
    /// copying just enough of the real content tree (products, buildings,
    /// cities) into a temp directory. Phase 3.65 backward-compat check.
    /// </summary>
    private static (string root, ContentCatalog catalog) CatalogWithoutEvents()
    {
        var realRoot = TestContent.LiveRoot;
        var temp = Path.Combine(Path.GetTempPath(), $"magnate-noevents-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(temp, "data"));
        // Mirror everything under data/ except events/.
        var realData = Path.Combine(realRoot, "data");
        foreach (var sub in Directory.EnumerateDirectories(realData))
        {
            var name = Path.GetFileName(sub);
            if (name == "events") continue;
            var dest = Path.Combine(temp, "data", name);
            Directory.CreateDirectory(dest);
            foreach (var file in Directory.EnumerateFiles(sub, "*.json"))
            {
                File.Copy(file, Path.Combine(dest, Path.GetFileName(file)));
            }
        }
        var cat = ContentLoader.Load(temp);
        return (temp, cat);
    }

    private static GameDate AddMonths(GameDate date, int months)
    {
        var d = date;
        for (var i = 0; i < months; i++) d = d.AddMonth();
        return d;
    }

    // ============================================================ Catalog loading

    [Fact]
    public void Loading_content_with_no_events_directory_yields_empty_events()
    {
        // Backward compat: a v3.64 content tree (no /data/events/) must still load.
        var (root, catalog) = CatalogWithoutEvents();
        try
        {
            Assert.Empty(catalog.Events);
            // Sanity: products still load.
            Assert.NotEmpty(catalog.Products);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Seed_events_load_at_least_eight_definitions()
    {
        var catalog = Catalog();
        Assert.True(catalog.Events.Count >= 8,
            $"expected ≥8 seed events, got {catalog.Events.Count}");
        // Spot-check the well-known IDs the spec calls out.
        var ids = catalog.Events.Select(e => e.Id).ToHashSet();
        Assert.Contains("cocoa_blight", ids);
        Assert.Contains("oil_glut", ids);
        Assert.Contains("viral_ad_spot", ids);
        Assert.Contains("tariff_announcement", ids);
        Assert.Contains("tech_breakthrough", ids);
    }

    // ============================================================ Determinism

    [Fact]
    public void RollAndApply_is_deterministic_given_same_seed()
    {
        var catalog = Catalog();
        var w1 = new World(catalog, seed: 12345, new GameDate(2026, 1));
        var w2 = new World(catalog, seed: 12345, new GameDate(2026, 1));

        // Run 24 rolls each; the fired-event sequence must match exactly.
        var seq1 = new List<string?>();
        var seq2 = new List<string?>();
        for (var i = 0; i < 24; i++)
        {
            seq1.Add(EventEngine.RollAndApply(w1, catalog.Events, w1.Rng)?.Id);
            seq2.Add(EventEngine.RollAndApply(w2, catalog.Events, w2.Rng)?.Id);
        }

        Assert.Equal(seq1, seq2);
        // And we should have actually fired *something* across 24 rolls at p=0.20.
        Assert.Contains(seq1, id => id is not null);
    }

    // ============================================================ Price multiplier effect

    [Fact]
    public void Price_multiplier_event_changes_effective_world_price_for_duration()
    {
        var catalog = Catalog();
        var world = new World(catalog, 42, new GameDate(2026, 1));

        // Construct a synthetic event so we don't depend on dice — directly apply
        // its effects through the public engine call by using a single-event
        // catalog that *will* fire (probability gate uses world.Rng).
        var product = new ProductId("steel");
        var basePrice = (decimal)catalog.Product(product).BaseWorldMarketPrice;
        Assert.Equal(basePrice, world.GetEffectiveWorldPrice(product));

        // Apply directly via internal helper to keep the assertion crisp.
        world.SetActivePriceEffect(new ActivePriceEffect("steel", 1.5m, 6));
        Assert.Equal(basePrice * 1.5m, world.GetEffectiveWorldPrice(product));

        // Tick four months of duration decrement; effect still active at month 2.
        for (var i = 0; i < 2; i++) world.TickActivePriceEffects();
        Assert.Equal(basePrice * 1.5m, world.GetEffectiveWorldPrice(product));
    }

    [Fact]
    public void Price_effect_expires_after_duration_months()
    {
        var catalog = Catalog();
        var world = new World(catalog, 42, new GameDate(2026, 1));
        var product = new ProductId("steel");
        var basePrice = (decimal)catalog.Product(product).BaseWorldMarketPrice;

        world.SetActivePriceEffect(new ActivePriceEffect("steel", 2.0m, 3));
        Assert.Equal(basePrice * 2.0m, world.GetEffectiveWorldPrice(product));

        // Decrement three months — after the third tick the effect should be
        // removed and the price reverts to base.
        world.TickActivePriceEffects();
        world.TickActivePriceEffects();
        world.TickActivePriceEffects();

        Assert.Equal(basePrice, world.GetEffectiveWorldPrice(product));
        Assert.Empty(world.ActivePriceEffects);
    }

    // ============================================================ Brand-shift effect

    [Fact]
    public void Brand_shift_event_mutates_brand_awareness_within_cap()
    {
        var catalog = Catalog();
        var world = new World(catalog, 42, new GameDate(2026, 1));

        var acme = world.CreateCompany("Acme", 5_000_000m);
        var rival = world.CreateCompany("Rival", 5_000_000m);
        var product = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Seed brands so the shift has someone to act on.
        world.SetBrandAwareness(acme.Id, product, city, 50.0);
        world.SetBrandAwareness(rival.Id, product, city, 95.0);
        // Different city — must NOT be touched.
        var otherCity = new CityId("eastside");
        world.SetBrandAwareness(acme.Id, product, otherCity, 30.0);

        var ev = new EventDefinition(
            "test_brand",
            "test brand pop",
            string.Empty,
            new RandomTrigger(),
            new List<EventEffect> { new BrandShiftEffect("soft_drink", "metropolis", 10) },
            Weight: 1,
            Severity: EventSeverity.Notable);

        // Single-event catalog with weight 1 — re-roll until it fires (or apply
        // directly through the helper). Simpler: apply via the public engine
        // helper repeatedly; it will fire deterministically eventually.
        EventDefinition? fired = null;
        for (var i = 0; i < 100 && fired is null; i++)
        {
            fired = EventEngine.RollAndApply(world, new[] { ev }, world.Rng);
        }
        Assert.NotNull(fired);

        Assert.Equal(60.0, world.GetBrandAwareness(acme.Id, product, city));
        // Capped at 100.
        Assert.Equal(100.0, world.GetBrandAwareness(rival.Id, product, city));
        // Other city untouched.
        Assert.Equal(30.0, world.GetBrandAwareness(acme.Id, product, otherCity));
    }

    // ============================================================ Headline-only

    [Fact]
    public void Headline_only_event_appends_news_with_no_other_state_change()
    {
        var catalog = Catalog();
        var world = new World(catalog, 42, new GameDate(2026, 1));

        var headline = new EventDefinition(
            "test_headline",
            "Big news in finance",
            "no mechanical effect",
            new RandomTrigger(),
            new List<EventEffect> { new HeadlineEffect() },
            Weight: 1,
            Severity: EventSeverity.Major);

        // Snapshot non-news state before — only the news log should change.
        var preActiveEffects = world.ActivePriceEffects.Count;
        var preNewsLog = world.NewsLog.Count;

        EventDefinition? fired = null;
        for (var i = 0; i < 100 && fired is null; i++)
        {
            fired = EventEngine.RollAndApply(world, new[] { headline }, world.Rng);
        }
        Assert.NotNull(fired);

        Assert.Equal(preActiveEffects, world.ActivePriceEffects.Count);
        Assert.Equal(preNewsLog + 1, world.NewsLog.Count);
        var entry = world.NewsLog[^1];
        Assert.Equal("test_headline", entry.EventId);
        Assert.Equal("Big news in finance", entry.Headline);
        Assert.Equal(EventSeverity.Major, entry.Severity);
    }

    // ============================================================ Save/load

    [Fact]
    public void NewsLog_and_active_effects_round_trip_save_load()
    {
        var catalog = Catalog();
        var world = new World(catalog, seed: 99, new GameDate(2026, 1));

        // Build up some state.
        world.SetActivePriceEffect(new ActivePriceEffect("oil", 0.7m, 5));
        // Run a few months so the news log has some real entries from random firings.
        var acme = world.CreateCompany("Acme", 5_000_000m);
        for (var i = 0; i < 24; i++) world.AdvanceMonth();

        var beforeNews = world.NewsLog.ToList();
        var beforeEffects = world.ActivePriceEffects.ToList();
        var beforeCash = world.Companies[acme.Id].Cash;
        var beforeClock = world.Clock.Now;

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(catalog, _tempFile).World;

        Assert.Equal(beforeClock, loaded.Clock.Now);
        Assert.Equal(beforeCash, loaded.Companies[acme.Id].Cash);
        Assert.Equal(beforeNews.Count, loaded.NewsLog.Count);
        for (var i = 0; i < beforeNews.Count; i++)
        {
            Assert.Equal(beforeNews[i].EventId, loaded.NewsLog[i].EventId);
            Assert.Equal(beforeNews[i].Headline, loaded.NewsLog[i].Headline);
            Assert.Equal(beforeNews[i].Severity, loaded.NewsLog[i].Severity);
            Assert.Equal(beforeNews[i].Date, loaded.NewsLog[i].Date);
        }
        Assert.Equal(beforeEffects.Count, loaded.ActivePriceEffects.Count);
        for (var i = 0; i < beforeEffects.Count; i++)
        {
            Assert.Equal(beforeEffects[i].ProductId, loaded.ActivePriceEffects[i].ProductId);
            Assert.Equal(beforeEffects[i].Multiplier, loaded.ActivePriceEffects[i].Multiplier);
            Assert.Equal(beforeEffects[i].RemainingMonths, loaded.ActivePriceEffects[i].RemainingMonths);
        }

        // Continuation: with the events stream persisted (v10) the loaded world draws the same
        // events as the original for as long as both run.
        for (var i = 0; i < 36; i++)
        {
            world.AdvanceMonth();
            loaded.AdvanceMonth();
        }
        Assert.True(world.NewsLog.Count > beforeNews.Count, "seed 99 fires events in months 25-60");
        Assert.Equal(
            world.NewsLog.Select(n => (n.Date, n.EventId)),
            loaded.NewsLog.Select(n => (n.Date, n.EventId)));
        Assert.Equal(StateDigest.Of(world), StateDigest.Of(loaded));
    }

    // ============================================================ Tick integration

    [Fact]
    public void Active_price_effect_changes_market_buy_cost()
    {
        // Verifies the GetEffectiveWorldPrice path is wired through MaterialProcurement.
        // Set a 2x multiplier on sugar; a retailer that has to import will spend twice
        // as much capitalising the inventory.
        var catalog = Catalog();
        var worldBase = new World(catalog, 42, new GameDate(2026, 1));
        var worldShock = new World(catalog, 42, new GameDate(2026, 1));

        foreach (var w in new[] { worldBase, worldShock })
        {
            var c = w.CreateCompany("Acme", 20_000_000m);
            var store = w.Construct(c.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            w.ConfigureRetailSlot(store.Id, 0, new ProductId("sugar"), 5m, 1_000);
        }

        // Apply a 2× multiplier to the shock world.
        worldShock.SetActivePriceEffect(new ActivePriceEffect("sugar", 2.0m, 12));

        // Tick once each — restock pulls from the world market because the world
        // has no extraction or factory.
        worldBase.AdvanceMonth();
        worldShock.AdvanceMonth();

        // Both companies started with the same cash; the shock world should have
        // less cash after the more-expensive restock.
        var baseCash = worldBase.Companies.Values.Single().Cash;
        var shockCash = worldShock.Companies.Values.Single().Cash;
        Assert.True(shockCash < baseCash,
            $"shock cash ({shockCash}) should be < base cash ({baseCash}) after 2x sugar import");
    }
}
