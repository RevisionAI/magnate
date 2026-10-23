using System.Collections.Generic;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Phase 3.29 — verifies that every ledger entry produced by the simulation is
/// attributed to a specific building whenever one is causally responsible, and
/// that per-building sums reconcile to per-company totals.
/// </summary>
public sealed class PerBuildingPnLTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    [Fact]
    public void Opex_entries_carry_the_correct_building_id()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));

        world.AdvanceMonth();

        var opex = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.OperatingCost)
            .ToList();

        Assert.NotEmpty(opex);
        Assert.All(opex, e => Assert.NotNull(e.Building));

        var storeOpex = opex.Where(e => e.Building == store.Id).ToList();
        var factoryOpex = opex.Where(e => e.Building == factory.Id).ToList();
        Assert.Single(storeOpex);
        Assert.Single(factoryOpex);

        var storeType = world.Catalog.BuildingType(store.TypeId);
        var factoryType = world.Catalog.BuildingType(factory.TypeId);
        Assert.Equal(-storeType.MonthlyOperatingCost, storeOpex[0].Amount);
        Assert.Equal(-factoryType.MonthlyOperatingCost, factoryOpex[0].Amount);
    }

    [Fact]
    public void Sales_entries_carry_the_retailer_building_id()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);

        // Seed plenty of inventory so the retailer actually sells.
        store.Inventory.Add(new ProductId("soft_drink"), 1_000_000, cost: 100_000m, quality: 80);

        world.AdvanceMonth();

        var sales = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.ProductSale)
            .ToList();

        Assert.NotEmpty(sales);
        Assert.All(sales, e => Assert.Equal(store.Id, e.Building));
    }

    [Fact]
    public void Procurement_entries_carry_the_destination_building_id()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("car"), 25_000m, 10);

        world.AdvanceMonth();

        // Cars come from the world market — RetailRestock entries hit the store.
        var restock = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.RetailRestock)
            .ToList();

        Assert.NotEmpty(restock);
        Assert.All(restock, e => Assert.Equal(store.Id, e.Building));
    }

    [Fact]
    public void Export_sales_carry_the_source_building_id()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        farm.AutoExport = true;

        world.AdvanceMonth();

        var exports = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.ExportSale)
            .ToList();

        Assert.NotEmpty(exports);
        Assert.All(exports, e => Assert.Equal(farm.Id, e.Building));
    }

    [Fact]
    public void Construction_cost_entries_carry_the_new_building_id()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));

        var construction = world.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.ConstructionCost)
            .ToList();

        Assert.Single(construction);
        Assert.Equal(store.Id, construction[0].Building);
    }

    [Fact]
    public void Starting_capital_and_advertising_leave_building_null()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 10_000m);

        world.AdvanceMonth();

        var starting = world.Ledger.Entries.Single(e => e.Category == LedgerCategory.StartingCapital);
        Assert.Null(starting.Building);

        var ads = world.Ledger.Entries.Where(e => e.Category == LedgerCategory.AdvertisingCost).ToList();
        Assert.NotEmpty(ads);
        Assert.All(ads, e => Assert.Null(e.Building));
    }

    [Fact]
    public void Cogs_entries_carry_the_source_building_id()
    {
        // Phase 3.39 stretch — accrual-side per-building P&L. Both sale-driven
        // and export-driven COGS recognitions must point at the building whose
        // inventory was drawn from.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 30_000_000m);

        // Retailer that actually sells.
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);
        store.Inventory.Add(new ProductId("soft_drink"), 1_000_000, cost: 100_000m, quality: 80);

        // Auto-exporting farm.
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        farm.AutoExport = true;

        world.AdvanceMonth();

        var cogs = world.CogsLog.Entries.ToList();
        Assert.NotEmpty(cogs);
        Assert.All(cogs, c => Assert.NotNull(c.SourceBuilding));

        var saleCogs = cogs.Where(c => c.Product == new ProductId("soft_drink")).ToList();
        Assert.NotEmpty(saleCogs);
        Assert.All(saleCogs, c => Assert.Equal(store.Id, c.SourceBuilding));

        var exportCogs = cogs.Where(c => c.Product == new ProductId("sugarcane")).ToList();
        Assert.NotEmpty(exportCogs);
        Assert.All(exportCogs, c => Assert.Equal(farm.Id, c.SourceBuilding));
    }

    [Fact]
    public void Per_building_ledger_sums_reconcile_to_per_company_totals()
    {
        // Invariant: cash = sum of all ledger entries for a company. Adding the
        // optional Building field must not change per-company totals, and the
        // sum of "per-building" slices plus the "null-building" slice must equal
        // the whole company total.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 300_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugar = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugar.Id, 0, new ProductId("sugar"));
        var drink = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drink.Id, 0, new ProductId("soft_drink"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 100_000);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 5_000m);

        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var allEntries = world.Ledger.EntriesFor(acme.Id).ToList();
        var companyTotal = allEntries.Sum(e => e.Amount);

        // Invariant 1: cash equals sum of ledger.
        Assert.Equal(world.Companies[acme.Id].Cash, companyTotal);

        // Invariant 2: slicing by Building covers every entry.
        var byBuilding = allEntries.Where(e => e.Building is not null).Sum(e => e.Amount);
        var unattributed = allEntries.Where(e => e.Building is null).Sum(e => e.Amount);
        Assert.Equal(companyTotal, byBuilding + unattributed);

        // Invariant 3: every expected building has at least one attributed entry.
        var attributedBuildings = allEntries
            .Where(e => e.Building is not null)
            .Select(e => e.Building!.Value)
            .Distinct()
            .ToHashSet();
        Assert.Contains(farm.Id, attributedBuildings);
        Assert.Contains(sugar.Id, attributedBuildings);
        Assert.Contains(drink.Id, attributedBuildings);
        Assert.Contains(store.Id, attributedBuildings);

        // Invariant 4: only company-level categories (engine metadata, econ-audit §4.15)
        // contribute to the null bucket — here StartingCapital and AdvertisingCost.
        var nullBucketCategories = allEntries
            .Where(e => e.Building is null)
            .Select(e => e.Category)
            .Distinct()
            .ToHashSet();
        var allowedNullCategories = LedgerCategoryInfo.All
            .Where(i => i.IsCompanyLevel)
            .Select(i => i.Category)
            .ToHashSet();
        // nullBucketCategories must be a subset of the allowed set.
        Assert.Subset(allowedNullCategories, nullBucketCategories);
        Assert.Contains(LedgerCategory.StartingCapital, nullBucketCategories);
        Assert.Contains(LedgerCategory.AdvertisingCost, nullBucketCategories);
        Assert.DoesNotContain(LedgerCategory.ProductSale, nullBucketCategories);
        Assert.DoesNotContain(LedgerCategory.OperatingCost, nullBucketCategories);
        Assert.DoesNotContain(LedgerCategory.ConstructionCost, nullBucketCategories);
    }
}
