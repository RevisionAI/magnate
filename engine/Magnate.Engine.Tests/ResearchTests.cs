using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class ResearchTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // =========================================================== Building config

    [Fact]
    public void ConfigureResearchSlot_rejects_non_rd_buildings()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));

        Assert.Throws<InvalidOperationException>(() =>
            world.ConfigureResearchSlot(factory.Id, 0, new ProductId("soft_drink")));
    }

    [Fact]
    public void ConfigureResearchSlot_succeeds_on_rd_center()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));

        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));

        Assert.Single(rd.ResearchSlots);
        Assert.Equal(new ProductId("soft_drink"), rd.ResearchSlots[0].Product);
    }

    // =========================================================== Progress + level-up

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void One_month_of_research_with_one_slot_reaches_level_two()
    {
        // Baseline tech = 1. Threshold for 1→2 = 100×1 = 100 points.
        // One slot × 1 month = 100 points → level 2 exactly, progress reset to 0.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth();

        Assert.Equal(2, world.GetTech(acme.Id, new ProductId("soft_drink")));
        Assert.Equal(0.0, world.GetResearchProgress(acme.Id, new ProductId("soft_drink")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Progress_accumulates_between_level_ups()
    {
        // Level 2→3 needs 200 points. After 2 months at level 2, we should be AT level 3.
        // After 1 month at level 2 (progress 100), still level 2 with 100 progress.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth(); // → level 2, progress 0
        world.AdvanceMonth(); // → level 2, progress 100 (of 200 needed)

        Assert.Equal(2, world.GetTech(acme.Id, new ProductId("soft_drink")));
        Assert.Equal(100.0, world.GetResearchProgress(acme.Id, new ProductId("soft_drink")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Multiple_slots_advance_tech_faster()
    {
        // Two slots × 1 month = 200 points. That's exactly enough for 1→2 (100)
        // with 100 carryover, which also completes 2→3 (needs 200). No wait —
        // carryover 100 is less than 200, so end state is level 2 + 100 progress.
        // For a cleaner test: two slots over two months = 400 points.
        // Accumulated: level 1→2 at 100pts (300 left), level 2→3 at 200pts (100 left),
        // level 3→4 needs 300 (only 100 left) → end at level 3 with 100 progress.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));
        world.ConfigureResearchSlot(rd.Id, 1, new ProductId("soft_drink"));

        world.AdvanceMonth();
        world.AdvanceMonth();

        Assert.Equal(3, world.GetTech(acme.Id, new ProductId("soft_drink")));
        Assert.Equal(100.0, world.GetResearchProgress(acme.Id, new ProductId("soft_drink")));
    }

    [Fact]
    public void Tech_caps_at_max_and_progress_zeros_out()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        // Pre-set tech to max−1 so one month of research brings it to max.
        world.SetTech(acme.Id, product, maxTech - 1);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, product);

        // Dump many months of research. The threshold for last-level jump is 100×(max-1) points,
        // which is at most 900 for maxTech=10 → 9 months.
        for (var i = 0; i < 20; i++) world.AdvanceMonth();

        Assert.Equal(maxTech, world.GetTech(acme.Id, product));
        Assert.Equal(0.0, world.GetResearchProgress(acme.Id, product));
    }

    [Fact]
    public void Different_companies_research_progress_independently()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var rival = world.CreateCompany("Rival", 100_000_000m);

        var acmeRd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(acmeRd.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth();

        Assert.Equal(2, world.GetTech(acme.Id, new ProductId("soft_drink")));
        Assert.Equal(1, world.GetTech(rival.Id, new ProductId("soft_drink")));
    }

    // =========================================================== Effect on demand

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Researched_company_eventually_wins_share_on_tech_alone()
    {
        // Set up two retailers with equal Q, B, and price. Acme advances tech via R&D;
        // by month ~10 tech should be level 5+, giving Acme a ~2× weight advantage.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 30_000_000m);
        var rival = world.CreateCompany("Rival", 20_000_000m);

        var acmeRd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(acmeRd.Id, 0, new ProductId("soft_drink"));

        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        var rivalStore = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(rivalStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 5_000_000);

        for (var i = 0; i < 10; i++) world.AdvanceMonth();

        var acmeTech = world.GetTech(acme.Id, new ProductId("soft_drink"));
        Assert.True(acmeTech >= 4, $"expected tech ≥ 4 after 10 months, got {acmeTech}");

        var acmeSales = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);
        var rivalSales = world.Ledger.EntriesFor(rival.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);

        Assert.True(acmeSales > rivalSales * 1.3m,
            $"Acme's tech advantage should yield >30% sales lead. acme {acmeSales} rival {rivalSales}");
    }
}
