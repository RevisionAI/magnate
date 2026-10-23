using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>Bridge-spec §9 engine change requests implemented by E0 (E1, E2, E3, E6, E7, E8, E11, E17).</summary>
public sealed class EngineChangeRequestTests
{
    private static readonly CityId Metropolis = new("metropolis");
    private static readonly CityId Hilltown = new("hilltown");
    private static readonly CityId Portbay = new("portbay");

    // ------------------------------------------------------------------ E2: AI registry

    [Theory]
    [InlineData("simple", typeof(SimpleRetailerStrategy), "simple")]
    [InlineData("Retailer", typeof(SimpleRetailerStrategy), "simple")]
    [InlineData("adaptive", typeof(AdaptiveStrategy), "adaptive")]
    [InlineData("vertical", typeof(VerticalIntegrator), "verticalIntegrator")]
    [InlineData("VerticalIntegrator", typeof(VerticalIntegrator), "verticalIntegrator")]
    [InlineData("tech", typeof(TechLeader), "techLeader")]
    [InlineData("techLeader", typeof(TechLeader), "techLeader")]
    public void Registry_creates_and_names_every_strategy(string name, Type type, string canonical)
    {
        var strategy = AiStrategies.Create(name);
        Assert.IsType(type, strategy);
        Assert.Equal(canonical, AiStrategies.NameOf(strategy));
        Assert.Contains(canonical, AiStrategies.Names);
    }

    [Fact]
    public void Registry_rejects_unknown_names()
    {
        Assert.Throws<ArgumentException>(() => AiStrategies.Create("chaos"));
        Assert.False(AiStrategies.TryCreate("chaos", null, out _));
    }

    [Fact]
    public void Registry_config_round_trips_every_tunable()
    {
        var strategies = new IAiStrategy[]
        {
            new SimpleRetailerStrategy(soloMarkup: 1.3m, undercutFactor: 0.9m, cushionMonths: 4, retailerTypeId: "convenience_store"),
            new AdaptiveStrategy(adBudgetPerCity: 12_345m, cushionMonths: 3, priceUndercut: 0.91m, soloMarkup: 1.4m, priceFloorMultiplier: 1.07m, minCashForAdsMultiplier: 9),
            new VerticalIntegrator(cushionMonths: 5, priceUndercut: 0.93m, soloMarkup: 1.15m, priceFloorMultiplier: 1.03m, adBudgetPerCity: 1_000m),
            new TechLeader(rdCentersTarget: 3, maxRetailersPerCity: 1, maxCities: 4, premiumMultiplier: 1.5m, priceFloorMultiplier: 1.2m, adBudgetPerCityHero: 1m, minHighBracketShare: 0.33),
        };

        foreach (var original in strategies)
        {
            var config = AiStrategies.ConfigOf(original);
            Assert.NotNull(config);
            var copy = AiStrategies.Create(AiStrategies.NameOf(original), config);
            Assert.Equal(config, AiStrategies.ConfigOf(copy));
        }

        Assert.Null(AiStrategies.ConfigOf(new SimpleRetailerStrategy()));
    }

    [Fact]
    public void Simple_strategy_tunables_survive_save_and_load()
    {
        var world = Worlds.Live();
        var ai = world.CreateCompany("Discount", 5_000_000m);
        world.RegisterAi(ai.Id, new SimpleRetailerStrategy(soloMarkup: 1.5m, cushionMonths: 2));

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        Assert.True(loaded.TryGetAiStrategy(ai.Id, out var strategy));
        var simple = Assert.IsType<SimpleRetailerStrategy>(strategy);
        Assert.Equal(1.5m, simple.SoloMarkup);
        Assert.Equal(2, simple.CushionMonths);
    }

    [Fact]
    public void Ai_can_be_read_and_unregistered()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        Assert.False(world.TryGetAiStrategy(acme.Id, out _));
        world.RegisterAi(acme.Id, new AdaptiveStrategy());
        Assert.True(world.TryGetAiStrategy(acme.Id, out var strategy));
        Assert.IsType<AdaptiveStrategy>(strategy);

        Assert.True(world.UnregisterAi(acme.Id));
        Assert.False(world.UnregisterAi(acme.Id));
        world.AdvanceMonth();
        Assert.Empty(world.Buildings);
    }

    // ------------------------------------------------------------------ E3: validated slot commands

    [Fact]
    public void Slot_setters_validate_and_apply()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), 3m, 1_000);
        var depot = world.Construct(acme.Id, new BuildingTypeId("warehouse_small"), Metropolis);
        world.ConfigureWarehouseSlot(depot.Id, 1, new ProductId("flour"), 500);

        world.SetRetailPrice(store.Id, 0, 2.75m);
        world.SetRestockTarget(store.Id, 0, 2_000);
        world.SetWarehouseTarget(depot.Id, 1, 750);
        world.SetAutoExport(depot.Id, false);
        Assert.Equal(2.75m, store.RetailSlots[0].Price);
        Assert.Equal(2_000, store.RetailSlots[0].RestockTarget);
        Assert.Equal(750, depot.WarehouseSlots[0].TargetStock);
        Assert.False(depot.AutoExport);

        Assert.Throws<ArgumentException>(() => world.SetRetailPrice(store.Id, 0, 0m));
        Assert.Throws<ArgumentException>(() => world.SetRestockTarget(store.Id, 0, double.NaN));
        Assert.Throws<ArgumentException>(() => world.SetWarehouseTarget(depot.Id, 1, -5));
        Assert.Throws<InvalidOperationException>(() => world.SetRetailPrice(store.Id, 3, 1m));
        Assert.Throws<InvalidOperationException>(() => world.SetWarehouseTarget(depot.Id, 0, 1));
        Assert.Throws<KeyNotFoundException>(() => world.SetAutoExport(new BuildingInstanceId(999), true));
        Assert.Equal(2.75m, store.RetailSlots[0].Price);
    }

    [Fact]
    public void Clear_slot_removes_any_slot_kind_and_keeps_stock()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), 3m, 1_000);
        world.AdvanceMonth();
        var stock = store.Inventory.Get(new ProductId("bread"));

        Assert.True(world.ClearSlot(store.Id, 0));
        Assert.Empty(store.RetailSlots);
        Assert.False(world.ClearSlot(store.Id, 0));
        Assert.Equal(stock, store.Inventory.Get(new ProductId("bread")));
    }

    // ------------------------------------------------------------------ E6: geography

    [Fact]
    public void Geography_requirement_query_matches_content()
    {
        var world = Worlds.Live();
        Assert.False(world.MeetsGeographyRequirement(new BuildingTypeId("oil_well"), Hilltown));
        Assert.True(world.MeetsGeographyRequirement(new BuildingTypeId("oil_well"), Portbay));
        Assert.False(world.MeetsGeographyRequirement(new BuildingTypeId("small_farm"), Portbay));
        Assert.True(world.MeetsGeographyRequirement(new BuildingTypeId("supermarket"), Hilltown));
    }

    [Fact]
    public void Classic_still_builds_anywhere_but_realistic_enforces_geography()
    {
        var classic = Worlds.Live();
        var a = classic.CreateCompany("Acme", 10_000_000m);
        classic.Construct(a.Id, new BuildingTypeId("oil_well"), Hilltown); // pre-overhaul behaviour

        var realistic = Worlds.Realistic();
        var b = realistic.CreateCompany("Acme", 10_000_000m);
        var ex = Assert.Throws<InvalidOperationException>(() => realistic.Construct(b.Id, new BuildingTypeId("oil_well"), Hilltown));
        Assert.Contains("geography", ex.Message);
        Assert.Equal(10_000_000m, b.Cash);
        Assert.Empty(realistic.Buildings);
        realistic.Construct(b.Id, new BuildingTypeId("oil_well"), Portbay);
    }

    // ------------------------------------------------------------------ E7: retail tier rules

    [Fact]
    public void Realistic_retail_slots_accept_finished_goods_only()
    {
        var realistic = Worlds.Realistic();
        var acme = realistic.CreateCompany("Acme", 10_000_000m);
        var store = realistic.Construct(acme.Id, new BuildingTypeId("supermarket"), Metropolis);
        Assert.Throws<InvalidOperationException>(() => realistic.ConfigureRetailSlot(store.Id, 0, new ProductId("steel"), 400m, 10));
        realistic.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), 3m, 10);

        var classic = Worlds.Live();
        var c = classic.CreateCompany("Acme", 10_000_000m);
        var classicStore = classic.Construct(c.Id, new BuildingTypeId("supermarket"), Metropolis);
        classic.ConfigureRetailSlot(classicStore.Id, 0, new ProductId("steel"), 400m, 10); // Classic accepts any tier
    }

    // ------------------------------------------------------------------ E8: range lookups

    [Fact]
    public void Range_lookups_match_a_linear_scan()
    {
        var world = GoldenScenarios.Get("soft_drink_war_auto_24").Run().World;
        foreach (var company in world.Companies.Keys)
        {
            for (var start = new GameDate(2026, 1); start <= world.Clock.Now; start = start.AddMonth())
            {
                var to = start.AddMonth().AddMonth();
                Assert.Equal(
                    world.Ledger.Entries.Where(e => e.Company == company && e.Date >= start && e.Date <= to),
                    world.Ledger.EntriesInRange(company, start, to));
                Assert.Equal(
                    world.CogsLog.Entries.Where(e => e.Company == company && e.Date >= start && e.Date <= to),
                    world.CogsLog.EntriesInRange(company, start, to));
            }
        }
    }

    [Fact]
    public void Range_lookups_stay_correct_for_out_of_order_logs()
    {
        var ledger = new Ledger();
        var c = new CompanyId(1);
        ledger.Record(new LedgerEntry(new GameDate(2026, 5), c, LedgerCategory.ProductSale, 1m, null));
        ledger.Record(new LedgerEntry(new GameDate(2026, 2), c, LedgerCategory.ProductSale, 2m, null));
        ledger.Record(new LedgerEntry(new GameDate(2026, 3), c, LedgerCategory.ProductSale, 3m, null));
        Assert.Equal(new[] { 2m, 3m }, ledger.EntriesInRange(c, new GameDate(2026, 1), new GameDate(2026, 4)).Select(e => e.Amount));
    }

    // ------------------------------------------------------------------ E1: compact UTF-8 saves

    [Fact]
    public void Utf8_saves_are_compact_and_load_identically()
    {
        var world = GoldenScenarios.Get("events_ads_media_36").Run().World;
        var compact = WorldSaver.SaveToUtf8(world, "events", new CompanyId(1));
        var indented = WorldSaver.SaveToUtf8(world, "events", new CompanyId(1), indented: true);
        Assert.True(compact.Length < indented.Length);
        Assert.Equal(WorldSaver.SaveToString(world, "events", new CompanyId(1)), System.Text.Encoding.UTF8.GetString(indented));

        var loaded = WorldLoader.Load(world.Catalog, compact);
        Assert.Equal("events", loaded.ScenarioId);
        Assert.Equal(new CompanyId(1), loaded.PlayerId);
        Assert.Equal(StateDigest.Of(world), StateDigest.Of(loaded.World));
    }
}
