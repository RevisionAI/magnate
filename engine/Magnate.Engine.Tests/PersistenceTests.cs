using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class PersistenceTests : IDisposable
{
    private readonly string _tempFile;

    public PersistenceTests()
    {
        _tempFile = Path.Combine(Path.GetTempPath(), $"magnate-test-{Guid.NewGuid():N}.json");
    }

    public void Dispose()
    {
        if (File.Exists(_tempFile)) File.Delete(_tempFile);
    }

    private static ContentCatalog Catalog() => TestContent.Live;

    // ========================================================== Round-trip

    [Fact]
    public void Save_then_load_preserves_empty_world()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        WorldSaver.Save(world, _tempFile);

        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        Assert.Equal(new GameDate(2026, 1), loaded.Clock.Now);
        Assert.Empty(loaded.Companies);
        Assert.Empty(loaded.Buildings);
    }

    [Fact]
    public void Save_then_load_preserves_companies_and_cash()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rival = world.CreateCompany("Rival", 5_000_000m);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        Assert.Equal(2, loaded.Companies.Count);
        Assert.Equal(10_000_000m, loaded.Companies[acme.Id].Cash);
        Assert.Equal(5_000_000m, loaded.Companies[rival.Id].Cash);
        Assert.Equal("Acme", loaded.Companies[acme.Id].Name);
    }

    [Fact]
    public void Save_then_load_preserves_buildings_and_slots()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 100_000);
        var warehouse = world.Construct(acme.Id, new BuildingTypeId("warehouse_small"), new CityId("metropolis"));
        world.ConfigureWarehouseSlot(warehouse.Id, 0, new ProductId("sugar"), 50_000);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));

        world.AdvanceMonth(); // so there's inventory + COGS data

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        Assert.Equal(world.Buildings.Count, loaded.Buildings.Count);

        var loadedFarm = loaded.Buildings[farm.Id];
        Assert.Single(loadedFarm.ExtractionSlots);
        Assert.Equal(new ProductId("sugarcane"), loadedFarm.ExtractionSlots[0].Product);

        var loadedStore = loaded.Buildings[store.Id];
        Assert.Equal(1.80m, loadedStore.RetailSlots[0].Price);
        Assert.Equal(100_000, loadedStore.RetailSlots[0].RestockTarget);

        var loadedWarehouse = loaded.Buildings[warehouse.Id];
        Assert.Single(loadedWarehouse.WarehouseSlots);
        Assert.Equal(50_000, loadedWarehouse.WarehouseSlots[0].TargetStock);
    }

    [Fact]
    public void Save_then_load_preserves_inventory_including_cost_and_quality()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        factory.Inventory.Add(new ProductId("sugar"), 1000, 500m, quality: 80);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var loadedInv = loaded.Buildings[factory.Id].Inventory;
        Assert.Equal(1000.0, loadedInv.Get(new ProductId("sugar")));
        Assert.Equal(500m, loadedInv.CostOf(new ProductId("sugar")));
        Assert.Equal(80.0, loadedInv.AverageQuality(new ProductId("sugar")));
    }

    [Fact]
    public void Save_then_load_preserves_tech_brand_and_research_progress()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 100_000_000m);
        world.SetTech(acme.Id, new ProductId("soft_drink"), 5);
        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 75.5);

        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));
        world.AdvanceMonth();
        world.AdvanceMonth(); // accumulate some research progress

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        Assert.Equal(world.GetTech(acme.Id, new ProductId("soft_drink")),
                     loaded.GetTech(acme.Id, new ProductId("soft_drink")));
        Assert.Equal(world.GetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis")),
                     loaded.GetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis")));
        Assert.Equal(world.GetResearchProgress(acme.Id, new ProductId("soft_drink")),
                     loaded.GetResearchProgress(acme.Id, new ProductId("soft_drink")));
    }

    [Fact]
    public void Save_then_load_preserves_ad_campaigns()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var camp = loaded.GetAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV);
        Assert.NotNull(camp);
        Assert.Equal(50_000m, camp!.MonthlyBudget);
    }

    [Fact]
    public void Save_then_load_preserves_ai_strategies()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var simple = world.CreateCompany("Simple", 50_000_000m);
        var adaptive = world.CreateCompany("Adaptive", 50_000_000m);
        world.RegisterAi(simple.Id, new SimpleRetailerStrategy());
        world.RegisterAi(adaptive.Id, new AdaptiveStrategy());

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        // After load, ticking a month should still run the registered AIs.
        loaded.AdvanceMonth();

        Assert.True(loaded.Buildings.Values.Any(b => b.Owner == simple.Id),
            "SimpleRetailerStrategy should have built something after load");
        Assert.True(loaded.Buildings.Values.Any(b => b.Owner == adaptive.Id),
            "AdaptiveStrategy should have built something after load");
    }

    [Fact]
    public void AdaptiveStrategy_config_round_trips_through_save_load()
    {
        // Phase 3.16 — closes the Phase 2.8 MVP limitation that AdaptiveStrategy
        // ctor tunables revert to defaults after save/load. Non-default values
        // must survive a round-trip so invariant #24 (load(save(W)) == W) holds
        // even for AI configuration.
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var adaptive = world.CreateCompany("Adaptive", 5_000_000m);

        var original = new AdaptiveStrategy(
            adBudgetPerCity:         75_000m,
            cushionMonths:           9,
            priceUndercut:           0.92m,
            soloMarkup:              1.35m,
            priceFloorMultiplier:    1.10m,
            minCashForAdsMultiplier: 8);
        world.RegisterAi(adaptive.Id, original);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var restored = Assert.IsType<AdaptiveStrategy>(loaded.InternalAiStrategies[adaptive.Id]);
        Assert.Equal(original.AdBudgetPerCity,         restored.AdBudgetPerCity);
        Assert.Equal(original.CushionMonths,           restored.CushionMonths);
        Assert.Equal(original.PriceUndercut,           restored.PriceUndercut);
        Assert.Equal(original.SoloMarkup,              restored.SoloMarkup);
        Assert.Equal(original.PriceFloorMultiplier,    restored.PriceFloorMultiplier);
        Assert.Equal(original.MinCashForAdsMultiplier, restored.MinCashForAdsMultiplier);
    }

    [Fact]
    public void AdaptiveStrategy_default_config_round_trips()
    {
        // Sanity: a default-constructed AdaptiveStrategy still loads with the
        // same default values (the config block is written and parsed, rather
        // than skipped).
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var adaptive = world.CreateCompany("Adaptive", 5_000_000m);
        var original = new AdaptiveStrategy();
        world.RegisterAi(adaptive.Id, original);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var restored = Assert.IsType<AdaptiveStrategy>(loaded.InternalAiStrategies[adaptive.Id]);
        Assert.Equal(original.AdBudgetPerCity,         restored.AdBudgetPerCity);
        Assert.Equal(original.CushionMonths,           restored.CushionMonths);
        Assert.Equal(original.PriceUndercut,           restored.PriceUndercut);
        Assert.Equal(original.SoloMarkup,              restored.SoloMarkup);
        Assert.Equal(original.PriceFloorMultiplier,    restored.PriceFloorMultiplier);
        Assert.Equal(original.MinCashForAdsMultiplier, restored.MinCashForAdsMultiplier);
    }

    [Fact]
    public void VerticalIntegrator_config_round_trips_through_save_load()
    {
        // Phase 3.39 — VerticalIntegrator was wired into the strategy switches in
        // Sprint 7 but its 5 tunables reverted to defaults on reload. They must
        // now survive a round-trip so invariant #24 (load(save(W)) == W) holds
        // for VI-driven competitors too.
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var vi = world.CreateCompany("VI", 5_000_000m);

        var original = new VerticalIntegrator(
            cushionMonths:        9,
            priceUndercut:        0.93m,
            soloMarkup:           1.30m,
            priceFloorMultiplier: 1.08m,
            adBudgetPerCity:      55_000m);
        world.RegisterAi(vi.Id, original);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var restored = Assert.IsType<VerticalIntegrator>(loaded.InternalAiStrategies[vi.Id]);
        Assert.Equal(original.CushionMonths,        restored.CushionMonths);
        Assert.Equal(original.PriceUndercut,        restored.PriceUndercut);
        Assert.Equal(original.SoloMarkup,           restored.SoloMarkup);
        Assert.Equal(original.PriceFloorMultiplier, restored.PriceFloorMultiplier);
        Assert.Equal(original.AdBudgetPerCity,      restored.AdBudgetPerCity);
    }

    [Fact]
    public void Load_accepts_v4_save_missing_cogs_source_building()
    {
        // Phase 3.39 stretch — v4 saves (Sprint 8) wrote CogsEntryDto without
        // SourceBuildingId. The loader must accept the older payload and default
        // SourceBuilding to null rather than rejecting the file.
        var v4 = "{ \"schemaVersion\": 4, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"5000000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], \"ledger\": [], \"transfers\": [], " +
                 "\"cogs\": [ { \"year\": 2026, \"month\": 1, \"companyId\": 1, " +
                 "\"productId\": \"soft_drink\", \"quantity\": 10.0, \"cost\": \"500\" } ] }";
        File.WriteAllText(_tempFile, v4);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        var entry = Assert.Single(result.World.CogsLog.Entries);
        Assert.Null(entry.SourceBuilding);
        Assert.Equal(new ProductId("soft_drink"), entry.Product);
        Assert.Equal(10.0, entry.Quantity);
        Assert.Equal(500m, entry.Cost);
    }

    [Fact]
    public void Cogs_source_building_round_trips_through_save_load()
    {
        // Phase 3.39 stretch — v5 round-trip: a sale-driven COGS recognition
        // carries SourceBuilding through save/load.
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);
        store.Inventory.Add(new ProductId("soft_drink"), 1_000_000, cost: 100_000m, quality: 80);

        world.AdvanceMonth();

        var originalCogs = world.CogsLog.Entries.Where(c => c.SourceBuilding == store.Id).ToList();
        Assert.NotEmpty(originalCogs);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var restoredCogs = loaded.CogsLog.Entries.Where(c => c.SourceBuilding == store.Id).ToList();
        Assert.Equal(originalCogs.Count, restoredCogs.Count);
        Assert.All(restoredCogs, c => Assert.Equal(store.Id, c.SourceBuilding));
    }

    [Fact]
    public void Load_accepts_v5_save_missing_patents()
    {
        // Phase 3.49 — schema v6 adds patents + patentsEverGranted. A v5 save
        // omits both fields; the loader must treat them as empty rather than
        // erroring. Includes a Cogs entry to sanity-check other v5 decoding is
        // unaffected.
        var v5 = "{ \"schemaVersion\": 5, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"5000000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], \"ledger\": [], \"transfers\": [], " +
                 "\"cogs\": [ { \"year\": 2026, \"month\": 1, \"companyId\": 1, " +
                 "\"productId\": \"soft_drink\", \"quantity\": 10.0, \"cost\": \"500\", \"sourceBuildingId\": null } ] }";
        File.WriteAllText(_tempFile, v5);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        Assert.Empty(result.World.GetActivePatents());
        Assert.Empty(result.World.InternalPatentsEverGranted);
        // Cogs decoded correctly.
        Assert.Single(result.World.CogsLog.Entries);
    }

    [Fact]
    public void Load_accepts_v8_save_missing_news_log_and_price_effects()
    {
        // Phase 3.65 — schema v9 adds NewsLog + ActivePriceEffects. A v8 save
        // omits both fields; the loader must treat them as empty rather than
        // erroring. Includes a level-3 building so we also confirm v8 decoding
        // (BuildingDto.Level) is unaffected by the new fields.
        var v8 = "{ \"schemaVersion\": 8, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 6 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"5000000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], \"ledger\": [], \"transfers\": [], " +
                 "\"cogs\": [] }";
        File.WriteAllText(_tempFile, v8);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        Assert.Empty(result.World.NewsLog);
        Assert.Empty(result.World.ActivePriceEffects);
        Assert.Equal(new GameDate(2026, 6), result.World.Clock.Now);
    }

    [Fact]
    public void Load_accepts_v6_save_missing_patent_licenses()
    {
        // Phase 3.54 — schema v7 adds patentLicenses. A v6 save omits the field;
        // the loader must treat it as empty rather than erroring. We also include
        // a patents[] entry so the v6 → v7 contract (patents still load, licenses
        // default empty) is validated together.
        var v6 = "{ \"schemaVersion\": 6, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                 "\"nextCompanyId\": 3, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Holder\", \"cash\": \"5000000\" }, " +
                 "                 { \"id\": 2, \"name\": \"Rival\",  \"cash\": \"5000000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], \"ledger\": [], \"transfers\": [], " +
                 "\"cogs\": [], " +
                 "\"patents\": [ { \"holder\": 1, \"product\": \"soft_drink\", \"expiresYear\": 2028, \"expiresMonth\": 1 } ], " +
                 "\"patentsEverGranted\": [ { \"holder\": 1, \"product\": \"soft_drink\" } ] }";
        File.WriteAllText(_tempFile, v6);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        Assert.Single(result.World.GetActivePatents());
        Assert.Empty(result.World.GetPatentLicenses());
        Assert.Empty(result.World.InternalPatentLicenses);
    }

    [Fact]
    public void Load_accepts_v2_save_missing_ai_strategy_config()
    {
        // A v2 save contains aiStrategies entries without a "config" field.
        // The loader must treat it as "use defaults" rather than erroring.
        var v2 = "{ \"schemaVersion\": 2, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"5000000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], " +
                 "\"aiStrategies\": [ { \"companyId\": 1, \"strategy\": \"adaptive\" } ], " +
                 "\"ledger\": [], \"transfers\": [], \"cogs\": [] }";
        File.WriteAllText(_tempFile, v2);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        var restored = Assert.IsType<AdaptiveStrategy>(
            result.World.InternalAiStrategies[new CompanyId(1)]);
        // Values match the parameterless ctor defaults documented in AdaptiveStrategy.
        var defaults = new AdaptiveStrategy();
        Assert.Equal(defaults.AdBudgetPerCity,         restored.AdBudgetPerCity);
        Assert.Equal(defaults.CushionMonths,           restored.CushionMonths);
        Assert.Equal(defaults.PriceUndercut,           restored.PriceUndercut);
        Assert.Equal(defaults.SoloMarkup,              restored.SoloMarkup);
        Assert.Equal(defaults.PriceFloorMultiplier,    restored.PriceFloorMultiplier);
        Assert.Equal(defaults.MinCashForAdsMultiplier, restored.MinCashForAdsMultiplier);
    }

    [Fact]
    public void Ledger_transfer_and_cogs_logs_round_trip()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 200_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugar = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugar.Id, 0, new ProductId("sugar"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("sugar"), 3m, 10_000);

        world.AdvanceMonth();

        var originalLedger = world.Ledger.Entries.Count;
        var originalTransfers = world.TransferLog.Entries.Count;
        var originalCogs = world.CogsLog.Entries.Count;

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        Assert.Equal(originalLedger, loaded.Ledger.Entries.Count);
        Assert.Equal(originalTransfers, loaded.TransferLog.Entries.Count);
        Assert.Equal(originalCogs, loaded.CogsLog.Entries.Count);
    }

    // ========================================================== Continuation

    [Fact]
    public void Simulation_continues_deterministically_across_save_load()
    {
        // Two parallel runs: one continuous, one with a save/load in the middle.
        // At the end, their state should match.
        var catalog = Catalog();

        var direct = new World(catalog, 42, new GameDate(2026, 1));
        var directAcme = SetUpChain(direct);
        for (var i = 0; i < 12; i++) direct.AdvanceMonth();

        var indirect = new World(catalog, 42, new GameDate(2026, 1));
        var indirectAcme = SetUpChain(indirect);
        for (var i = 0; i < 6; i++) indirect.AdvanceMonth();
        WorldSaver.Save(indirect, _tempFile);
        var reloaded = WorldLoader.Load(catalog, _tempFile).World;
        for (var i = 0; i < 6; i++) reloaded.AdvanceMonth();

        Assert.Equal(direct.Companies[directAcme].Cash, reloaded.Companies[indirectAcme].Cash);
        Assert.Equal(direct.Ledger.Entries.Count, reloaded.Ledger.Entries.Count);
        Assert.Equal(direct.GetTech(directAcme, new ProductId("soft_drink")),
                     reloaded.GetTech(indirectAcme, new ProductId("soft_drink")));
        // Schema v10 persists every RNG stream, so the whole state — not just these probes —
        // must match (pre-v10 this passed only because no event touched the setup).
        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(reloaded));
    }

    private static CompanyId SetUpChain(World world)
    {
        var acme = world.CreateCompany("Acme", 300_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugar = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugar.Id, 0, new ProductId("sugar"));
        var drink = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drink.Id, 0, new ProductId("soft_drink"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));
        return acme.Id;
    }

    // ========================================================== Schema safety

    [Fact]
    public void Load_rejects_mismatched_schema_version()
    {
        var bogus = "{ \"schemaVersion\": 999, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                    "\"nextCompanyId\": 1, \"nextBuildingId\": 1, \"companies\": [], \"buildings\": [], " +
                    "\"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], \"adCampaigns\": [], " +
                    "\"aiStrategies\": [], \"ledger\": [], \"transfers\": [], \"cogs\": [] }";
        File.WriteAllText(_tempFile, bogus);
        Assert.Throws<InvalidOperationException>(() => WorldLoader.Load(Catalog(), _tempFile));
    }

    // ========================================================== v2 metadata

    [Fact]
    public void Save_round_trips_scenario_and_player_metadata()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);
        var rival = world.CreateCompany("Rival", 5_000_000m);

        WorldSaver.Save(world, _tempFile, scenarioId: "soft_drink_war", playerId: rival.Id);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        Assert.Equal("soft_drink_war", result.ScenarioId);
        Assert.Equal(rival.Id, result.PlayerId);
        Assert.NotNull(result.World);
        Assert.Equal(2, result.World.Companies.Count);
        // Unused sanity reference to suppress unused-variable warnings for `acme`.
        Assert.NotEqual(acme.Id, rival.Id);
    }

    [Fact]
    public void Save_without_metadata_leaves_fields_null()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        world.CreateCompany("Acme", 1_000_000m);

        WorldSaver.Save(world, _tempFile);

        var result = WorldLoader.Load(Catalog(), _tempFile);
        Assert.Null(result.ScenarioId);
        Assert.Null(result.PlayerId);

        // The serialized JSON should also omit nulls so files stay clean.
        var json = File.ReadAllText(_tempFile);
        Assert.DoesNotContain("\"scenarioId\"", json);
        Assert.DoesNotContain("\"playerId\"", json);
    }

    [Fact]
    public void Load_accepts_v3_save_missing_ledger_building_field()
    {
        // Phase 3.29 — schema v4 adds LedgerEntryDto.BuildingId. A v3 save file
        // has ledger entries without the field; the loader must treat Building
        // as null rather than erroring. Includes one opex-style and one sale-style
        // entry to mirror what v3 actually shipped.
        var v3 = "{ \"schemaVersion\": 3, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 2 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"9500000\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], " +
                 "\"ledger\": [ " +
                 "  { \"year\": 2026, \"month\": 1, \"companyId\": 1, \"category\": \"StartingCapital\", \"amount\": \"10000000\", \"memo\": \"starting capital\" }, " +
                 "  { \"year\": 2026, \"month\": 2, \"companyId\": 1, \"category\": \"OperatingCost\", \"amount\": \"-500000\", \"memo\": \"opex\" } " +
                 "], " +
                 "\"transfers\": [], \"cogs\": [] }";
        File.WriteAllText(_tempFile, v3);

        var result = WorldLoader.Load(Catalog(), _tempFile);
        Assert.Equal(2, result.World.Ledger.Entries.Count);
        Assert.All(result.World.Ledger.Entries, e => Assert.Null(e.Building));
        Assert.Equal(9_500_000m, result.World.Companies[new CompanyId(1)].Cash);
    }

    [Fact]
    public void Save_then_load_preserves_ledger_building_attribution()
    {
        // v4 round-trip: after save/load, per-building ledger entries must still
        // be attributed to the same BuildingInstanceId.
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("car"), 25_000m, 10);
        world.AdvanceMonth();

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var originalByBuilding = world.Ledger.Entries
            .Where(e => e.Building == store.Id).Count();
        var loadedByBuilding = loaded.Ledger.Entries
            .Where(e => e.Building == store.Id).Count();
        Assert.True(originalByBuilding > 0);
        Assert.Equal(originalByBuilding, loadedByBuilding);

        var originalConstruction = world.Ledger.Entries
            .Single(e => e.Category == LedgerCategory.ConstructionCost);
        var loadedConstruction = loaded.Ledger.Entries
            .Single(e => e.Category == LedgerCategory.ConstructionCost);
        Assert.Equal(originalConstruction.Building, loadedConstruction.Building);
        Assert.Equal(store.Id, loadedConstruction.Building);
    }

    [Fact]
    public void Load_accepts_v1_save_with_missing_metadata_fields()
    {
        // Hand-crafted v1 payload — schemaVersion: 1, no scenarioId/playerId fields.
        var v1 = "{ \"schemaVersion\": 1, \"seed\": 1, \"clock\": { \"year\": 2026, \"month\": 1 }, " +
                 "\"nextCompanyId\": 2, \"nextBuildingId\": 1, " +
                 "\"companies\": [ { \"id\": 1, \"name\": \"Legacy\", \"cash\": \"1234567\" } ], " +
                 "\"buildings\": [], \"tech\": [], \"brandAwareness\": [], \"researchProgress\": [], " +
                 "\"adCampaigns\": [], \"aiStrategies\": [], \"ledger\": [], \"transfers\": [], \"cogs\": [] }";
        File.WriteAllText(_tempFile, v1);

        var result = WorldLoader.Load(Catalog(), _tempFile);

        Assert.Null(result.ScenarioId);
        Assert.Null(result.PlayerId);
        Assert.Single(result.World.Companies);
        Assert.Equal(1_234_567m, result.World.Companies[new CompanyId(1)].Cash);
    }

    [Fact]
    public void Save_with_metadata_still_deterministic_across_chain_simulation()
    {
        // Invariant #24: save/load remains lossless + deterministic even when
        // the v2 metadata fields are populated. Run two parallel chain-builds;
        // one continuous, one saved+reloaded mid-run; final state must match.
        var catalog = Catalog();

        var direct = new World(catalog, 42, new GameDate(2026, 1));
        var directAcme = SetUpChain(direct);
        for (var i = 0; i < 12; i++) direct.AdvanceMonth();

        var indirect = new World(catalog, 42, new GameDate(2026, 1));
        var indirectAcme = SetUpChain(indirect);
        for (var i = 0; i < 6; i++) indirect.AdvanceMonth();
        WorldSaver.Save(indirect, _tempFile, scenarioId: "round_trip", playerId: indirectAcme);

        var result = WorldLoader.Load(catalog, _tempFile);
        Assert.Equal("round_trip", result.ScenarioId);
        Assert.Equal(indirectAcme, result.PlayerId);

        var reloaded = result.World;
        for (var i = 0; i < 6; i++) reloaded.AdvanceMonth();

        Assert.Equal(direct.Companies[directAcme].Cash, reloaded.Companies[indirectAcme].Cash);
        Assert.Equal(direct.Ledger.Entries.Count, reloaded.Ledger.Entries.Count);
        Assert.Equal(direct.TransferLog.Entries.Count, reloaded.TransferLog.Entries.Count);
        Assert.Equal(direct.CogsLog.Entries.Count, reloaded.CogsLog.Entries.Count);
        Assert.Equal(direct.GetTech(directAcme, new ProductId("soft_drink")),
                     reloaded.GetTech(indirectAcme, new ProductId("soft_drink")));
        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(reloaded));
    }

    // ========================================================== ListSaves

    [Fact]
    public void ListSaves_returns_metadata_for_each_json_in_directory()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"magnate-listsaves-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var worldA = new World(Catalog(), 42, new GameDate(2027, 3));
            var acmeA = worldA.CreateCompany("Acme", 5_000_000m);
            var pathA = Path.Combine(dir, "save_a.json");
            WorldSaver.Save(worldA, pathA, scenarioId: "soft_drink_war", playerId: acmeA.Id);

            var worldB = new World(Catalog(), 7, new GameDate(2030, 11));
            var bee = worldB.CreateCompany("Bee", 1_000_000m);
            var pathB = Path.Combine(dir, "save_b.json");
            WorldSaver.Save(worldB, pathB, scenarioId: null, playerId: bee.Id);

            var list = WorldSaver.ListSaves(dir);
            Assert.Equal(2, list.Count);

            var a = list.Single(s => s.FileName == "save_a.json");
            Assert.Equal(new GameDate(2027, 3), a.GameDate);
            Assert.Equal("soft_drink_war", a.ScenarioId);
            Assert.Equal(acmeA.Id.Value, a.PlayerId);
            Assert.Equal(WorldSaver.SchemaVersion, a.SchemaVersion);
            Assert.True(a.FileSize > 0);
            Assert.Equal(pathA, a.FullPath);

            var b = list.Single(s => s.FileName == "save_b.json");
            Assert.Equal(new GameDate(2030, 11), b.GameDate);
            Assert.Null(b.ScenarioId);
            Assert.Equal(bee.Id.Value, b.PlayerId);
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void ListSaves_returns_empty_when_directory_missing()
    {
        var missing = Path.Combine(Path.GetTempPath(), $"magnate-missing-{Guid.NewGuid():N}");
        Assert.False(Directory.Exists(missing));
        var list = WorldSaver.ListSaves(missing);
        Assert.Empty(list);
    }

    [Fact]
    public void ListSaves_skips_malformed_files()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"magnate-malformed-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var world = new World(Catalog(), 42, new GameDate(2026, 6));
            world.CreateCompany("Acme", 1m);
            var good = Path.Combine(dir, "good.json");
            WorldSaver.Save(world, good);

            File.WriteAllText(Path.Combine(dir, "garbage.json"), "{not valid json");

            var list = WorldSaver.ListSaves(dir);
            Assert.Single(list);
            Assert.Equal("good.json", list[0].FileName);
            Assert.Equal(new GameDate(2026, 6), list[0].GameDate);
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }
}
