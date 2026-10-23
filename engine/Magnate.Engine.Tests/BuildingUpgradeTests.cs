using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Phase 3.59 — building upgrade ladder. Verifies Level 1→2→3 progression on
/// upgradeable types (supermarket, factory_small) and the throw-paths on
/// non-upgradeable types (rd_center has no Levels config).
/// </summary>
public sealed class BuildingUpgradeTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    [Fact]
    public void New_buildings_default_to_level_one()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));

        Assert.Equal(1, store.Level);
    }

    [Fact]
    public void Upgrade_charges_cost_and_increments_level()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        var type = world.Catalog.BuildingType(store.TypeId);
        var l2Cost = type.Levels![1].UpgradeCost;
        var cashBefore = world.Companies[acme.Id].Cash;

        world.UpgradeBuilding(store.Id);

        Assert.Equal(2, store.Level);
        Assert.Equal(cashBefore - l2Cost, world.Companies[acme.Id].Cash);

        var upgrade = world.Ledger.Entries.Single(e => e.Category == LedgerCategory.UpgradeCost);
        Assert.Equal(-l2Cost, upgrade.Amount);
        Assert.Equal(store.Id, upgrade.Building);
    }

    [Fact]
    public void Upgrade_progresses_to_max_level_then_throws()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));

        world.UpgradeBuilding(store.Id); // 1 → 2
        world.UpgradeBuilding(store.Id); // 2 → 3
        Assert.Equal(3, store.Level);

        Assert.Throws<InvalidOperationException>(() => world.UpgradeBuilding(store.Id));
    }

    [Fact]
    public void Capacity_and_opex_track_the_current_level()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        var type = world.Catalog.BuildingType(store.TypeId);

        Assert.Equal(type.Levels![0].Capacity, world.GetCapacity(store));
        Assert.Equal(type.Levels![0].MonthlyOperatingCost, world.GetMonthlyOpex(store));

        world.UpgradeBuilding(store.Id);
        Assert.Equal(type.Levels![1].Capacity, world.GetCapacity(store));
        Assert.Equal(type.Levels![1].MonthlyOperatingCost, world.GetMonthlyOpex(store));

        world.UpgradeBuilding(store.Id);
        Assert.Equal(type.Levels![2].Capacity, world.GetCapacity(store));
        Assert.Equal(type.Levels![2].MonthlyOperatingCost, world.GetMonthlyOpex(store));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Monthly_opex_ledger_amount_reflects_level()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        var type = world.Catalog.BuildingType(store.TypeId);

        world.AdvanceMonth();
        var l1Opex = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.OperatingCost && e.Building == store.Id)
            .Last();
        Assert.Equal(-type.Levels![0].MonthlyOperatingCost, l1Opex.Amount);

        world.UpgradeBuilding(store.Id);
        world.AdvanceMonth();
        var l2Opex = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.OperatingCost && e.Building == store.Id)
            .Last();
        Assert.Equal(-type.Levels![1].MonthlyOperatingCost, l2Opex.Amount);
        Assert.NotEqual(l1Opex.Amount, l2Opex.Amount);
    }

    [Fact]
    public void Insufficient_cash_throws_without_mutating_state()
    {
        var world = NewWorld();
        // Give just enough for construction, with leftover below the L2 upgrade cost, so the
        // upgrade-cost throw path fires (derived from the catalog so content rebalancing can't
        // break it — test-map C04).
        var type = world.Catalog.BuildingType(new BuildingTypeId("supermarket"));
        var acme = world.CreateCompany("Acme", type.ConstructionCost + type.Levels![1].UpgradeCost / 2);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));

        var levelBefore = store.Level;
        var cashBefore = world.Companies[acme.Id].Cash;
        var upgradeEntriesBefore = world.Ledger.Entries.Count(e => e.Category == LedgerCategory.UpgradeCost);

        Assert.Throws<InvalidOperationException>(() => world.UpgradeBuilding(store.Id));

        Assert.Equal(levelBefore, store.Level);
        Assert.Equal(cashBefore, world.Companies[acme.Id].Cash);
        Assert.Equal(upgradeEntriesBefore, world.Ledger.Entries.Count(e => e.Category == LedgerCategory.UpgradeCost));
    }

    [Fact]
    public void Non_upgradeable_type_throws()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));

        Assert.Null(world.Catalog.BuildingType(rd.TypeId).Levels);
        Assert.Throws<InvalidOperationException>(() => world.UpgradeBuilding(rd.Id));
    }

    [Fact]
    public void Save_load_round_trips_level_on_v8()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.UpgradeBuilding(store.Id);
        world.UpgradeBuilding(store.Id);
        Assert.Equal(3, store.Level);

        var path = Path.Combine(Path.GetTempPath(), $"magnate-test-upgrade-{Guid.NewGuid():N}.json");
        try
        {
            WorldSaver.Save(world, path);
            var loaded = WorldLoader.Load(world.Catalog, path);
            var loadedStore = loaded.World.Buildings[store.Id];
            Assert.Equal(3, loadedStore.Level);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }
    /// <summary>
    /// test-map D2 / econ F8 / bridge E5: upgrade capex is capitalised into the building's book
    /// value, so equity still equals starting capital plus cumulative net income after
    /// upgrades (pre-fix the gap was exactly −$720,000 for one supermarket upgrade).
    /// </summary>
    [Fact]
    public void Books_close_after_upgrades()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 50_000);
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));

        world.UpgradeBuilding(store.Id);
        world.AdvanceMonth();
        world.UpgradeBuilding(factory.Id);
        world.UpgradeBuilding(store.Id);
        world.AdvanceMonth();

        var type = world.Catalog.BuildingType(new BuildingTypeId("supermarket"));
        Assert.Equal(type.ConstructionCost + type.Levels![1].UpgradeCost + type.Levels[2].UpgradeCost, store.CapitalizedCost);
        Assert.Equal(store.CapitalizedCost, store.BookValue);

        var bs = world.GetBalanceSheet(acme.Id);
        var netIncome = world.GetIncomeStatement(acme.Id, new GameDate(2026, 1), world.Clock.Now).NetIncome;
        Assert.Equal(100_000_000m + netIncome, bs.Equity);
        Assert.Equal(store.CapitalizedCost + factory.CapitalizedCost, bs.BuildingValue);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Capitalised_upgrade_cost_survives_save_and_load()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.UpgradeBuilding(store.Id);
        world.AdvanceMonth();

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        var reloaded = loaded.Buildings[store.Id];
        Assert.Equal(store.CapitalizedCost, reloaded.CapitalizedCost);
        Assert.Equal(world.GetBalanceSheet(acme.Id), loaded.GetBalanceSheet(acme.Id));
        Invariants.AssertAll(loaded);
    }
}
