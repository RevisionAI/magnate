using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>Schema v10 (E0): rules snapshot, seed + RNG streams, accrual journal, sections, lossless details.</summary>
public sealed class PersistenceV10Tests
{
    [Fact]
    public void Schema_version_is_ten_and_the_seed_is_persisted()
    {
        Assert.Equal(10, WorldSaver.SchemaVersion);
        var world = Worlds.Live(seed: 42);
        using var doc = JsonDocument.Parse(WorldSaver.SaveToString(world));
        Assert.Equal(10, doc.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(42, doc.RootElement.GetProperty("seed").GetInt32());
        Assert.Equal("classic", doc.RootElement.GetProperty("rules").GetProperty("preset").GetString());
        Assert.Equal("events", doc.RootElement.GetProperty("rng")[0].GetProperty("name").GetString());
    }

    [Fact]
    public void Classic_saves_omit_the_empty_extension_sections_and_journal()
    {
        var world = Worlds.Live();
        world.CreateCompany("Acme", 1_000_000m);
        world.AdvanceMonth();
        using var doc = JsonDocument.Parse(WorldSaver.SaveToString(world));
        foreach (var name in new[] { "land", "finance", "market", "macro", "accrualJournal" })
        {
            Assert.False(doc.RootElement.TryGetProperty(name, out _), $"'{name}' should be omitted");
        }
    }

    [Fact]
    public void Rules_snapshot_round_trips_including_custom_values()
    {
        var custom = EconomyRules.Classic with
        {
            Preset = "custom",
            EconomyScale = 2.5m,
            Market = new MarketRules { Enabled = true },
            Macro = new MacroRules { Enabled = true },
        };
        var world = Worlds.On(TestContent.Live, custom);
        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        Assert.Equal(custom, loaded.Rules);
    }

    [Fact]
    public void Rules_areas_missing_or_null_in_a_save_get_neutral_defaults()
    {
        var world = Worlds.Realistic();
        var json = WorldSaver.SaveToString(world);
        var root = JsonDocument.Parse(json).RootElement;
        var rules = root.GetProperty("rules").EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
        rules["market"] = null;      // explicit null
        rules.Remove("macro");      // absent (e.g. written before the area existed)
        var edited = root.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
        edited["rules"] = rules;

        var loaded = WorldLoader.LoadFromString(world.Catalog, JsonSerializer.Serialize(edited)).World;
        Assert.False(loaded.Rules.Market.Enabled);
        Assert.False(loaded.Rules.Macro.Enabled);
        Assert.True(loaded.Rules.Finance.Enabled);
        Assert.Equal(EconomyRules.RealisticPreset, loaded.Rules.Preset);
    }

    [Fact]
    public void Pre_v10_saves_load_as_classic_with_the_saved_seed()
    {
        var world = Worlds.Realistic(seed: 7);
        world.CreateCompany("Acme", 1_000_000m);
        var json = WorldSaver.SaveToString(world);

        // Rewrite as a v9 save: no rules, no rng, seed 0 (what every v9 saver wrote).
        var v9 = json
            .Replace("\"schemaVersion\": 10", "\"schemaVersion\": 9")
            .Replace("\"seed\": 7", "\"seed\": 0");
        var root = JsonDocument.Parse(v9).RootElement;
        var stripped = JsonSerializer.Serialize(root.EnumerateObject()
            .Where(p => p.Name is not ("rules" or "rng"))
            .ToDictionary(p => p.Name, p => p.Value));

        var loaded = WorldLoader.LoadFromString(world.Catalog, stripped).World;
        Assert.Same(EconomyRules.Classic, loaded.Rules);
        Assert.Equal(0, loaded.Seed);
        // The legacy behaviour: the events stream restarts from the saved seed.
        var reference = new System.Random(0);
        Assert.Equal(reference.NextDouble(), loaded.Rng.NextDouble());
    }

    [Fact]
    public void Accrual_journal_round_trips_and_rebuilds_accumulated_depreciation()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.AdvanceMonth();
        world.RecordAccrual(acme.Id, AccrualKind.Depreciation, -2_500.25m, "depreciation", store.Id);
        world.AdvanceMonth();
        world.RecordAccrual(acme.Id, AccrualKind.Depreciation, -2_500.25m, "depreciation", store.Id);
        world.RecordAccrual(acme.Id, AccrualKind.InventoryWriteDown, -10m, "spoilage", product: new ProductId("bread"));

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        Assert.Equal(world.AccrualJournal.Entries, loaded.AccrualJournal.Entries);
        Assert.Equal(5_000.50m, loaded.Buildings[store.Id].AccumulatedDepreciation);
        Assert.Equal(world.GetBalanceSheet(acme.Id), loaded.GetBalanceSheet(acme.Id));
        Assert.Equal(
            world.GetIncomeStatement(acme.Id, new GameDate(2026, 1), world.Clock.Now),
            loaded.GetIncomeStatement(acme.Id, new GameDate(2026, 1), loaded.Clock.Now));
    }

    [Fact]
    public void Ledger_quantities_and_new_categories_round_trip()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 40_000);
        world.AdvanceMonth();
        world.RecordCashChange(acme.Id, LedgerCategory.LoanDrawdown, 1_000_000m, "loan");

        var sale = world.Ledger.Entries.First(e => e.Category == LedgerCategory.ProductSale);
        Assert.NotNull(sale.Quantity);
        Assert.Equal(sale.Amount, (decimal)sale.Quantity!.Value * 1.80m);
        var restock = world.Ledger.Entries.First(e => e.Category == LedgerCategory.RetailRestock);
        Assert.Equal(40_000, restock.Quantity);

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        Assert.Equal(world.Ledger.Entries, loaded.Ledger.Entries);
        Assert.Equal(1_000_000m, loaded.GetBalanceSheet(acme.Id).Liabilities);
    }

    [Fact]
    public void Inventory_order_and_empty_entries_and_slot_order_round_trip()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        // Configure slots out of index order: the tick iterates retail slots in list order.
        world.ConfigureRetailSlot(store.Id, 2, new ProductId("television"), 450m, 10);
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), 2.9m, 5_000);
        world.AdvanceMonth(); // bread sells out (empty entry remains), televisions partly

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        var original = world.Buildings[store.Id];
        var reloaded = loaded.Buildings[store.Id];
        Assert.Equal(original.RetailSlots.Select(s => s.Index), reloaded.RetailSlots.Select(s => s.Index));
        Assert.Equal(original.Inventory.RawEntries, reloaded.Inventory.RawEntries);
        Assert.Contains(original.Inventory.RawEntries, e => e.Quantity == 0);
    }

    [Fact]
    public void Built_at_is_persisted_and_falls_back_to_the_ledger_for_old_saves()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        world.AdvanceMonth();
        world.AdvanceMonth();
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        Assert.Equal(new GameDate(2026, 3), store.BuiltAt);
        world.AdvanceMonth();

        var json = WorldSaver.SaveToString(world);
        Assert.Equal(new GameDate(2026, 3), WorldLoader.LoadFromString(world.Catalog, json).World.Buildings[store.Id].BuiltAt);

        // A pre-v10 building has no builtYear/builtMonth: the loader uses its first
        // ConstructionCost ledger entry.
        var withoutBuiltAt = json.Replace("\"builtYear\": 2026,", string.Empty).Replace("\"builtMonth\": 3,", string.Empty);
        Assert.DoesNotContain("builtYear", withoutBuiltAt);
        Assert.Equal(new GameDate(2026, 3), WorldLoader.LoadFromString(world.Catalog, withoutBuiltAt).World.Buildings[store.Id].BuiltAt);
    }
}
