using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence.Sections;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence;

/// <summary>
/// Result of loading a save file. Includes the rehydrated <see cref="World"/>
/// plus optional v2 metadata (scenario id + player company id). Metadata fields
/// are null when loading a v1 save or a v2 save that omitted them.
/// </summary>
public sealed record WorldLoadResult(World World, string? ScenarioId, CompanyId? PlayerId);

/// <summary>
/// Rehydrates a <see cref="World"/> from a JSON save file produced by <see cref="WorldSaver"/>.
/// The content catalog must be supplied (saves don't embed it — content is
/// assumed to be the canonical game data).
/// </summary>
public static class WorldLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Load a save file and return the world plus v2 metadata. Accepts any
    /// schema version in <c>[MinSupportedSchemaVersion, SchemaVersion]</c>;
    /// v1 saves simply return null metadata.
    /// </summary>
    public static WorldLoadResult Load(ContentCatalog catalog, string path)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(path);
        if (!File.Exists(path)) throw new FileNotFoundException("save not found", path);

        using var stream = File.OpenRead(path);
        var save = JsonSerializer.Deserialize<WorldSaveFile>(stream, JsonOptions)
            ?? throw new InvalidOperationException($"{path}: deserialized to null");

        if (save.SchemaVersion < WorldSaver.MinSupportedSchemaVersion
            || save.SchemaVersion > WorldSaver.SchemaVersion)
        {
            throw new InvalidOperationException(
                $"save file schema version {save.SchemaVersion} unsupported " +
                $"(engine accepts {WorldSaver.MinSupportedSchemaVersion}..{WorldSaver.SchemaVersion})");
        }

        var world = Rebuild(catalog, save);
        var playerId = save.PlayerId is int pid ? (CompanyId?)new CompanyId(pid) : null;
        return new WorldLoadResult(world, save.ScenarioId, playerId);
    }

    /// <summary>
    /// Load a world from UTF-8 JSON bytes produced by <see cref="WorldSaver.SaveToUtf8"/> (or the
    /// bytes of a save file, compact or indented). Same validation as the file overload.
    /// </summary>
    public static WorldLoadResult Load(ContentCatalog catalog, ReadOnlySpan<byte> utf8Json)
    {
        ArgumentNullException.ThrowIfNull(catalog);

        var save = JsonSerializer.Deserialize<WorldSaveFile>(utf8Json, JsonOptions)
            ?? throw new InvalidOperationException("save data deserialized to null");

        if (save.SchemaVersion < WorldSaver.MinSupportedSchemaVersion
            || save.SchemaVersion > WorldSaver.SchemaVersion)
        {
            throw new InvalidOperationException(
                $"save schema version {save.SchemaVersion} unsupported " +
                $"(engine accepts {WorldSaver.MinSupportedSchemaVersion}..{WorldSaver.SchemaVersion})");
        }

        var world = Rebuild(catalog, save);
        var playerId = save.PlayerId is int pid ? (CompanyId?)new CompanyId(pid) : null;
        return new WorldLoadResult(world, save.ScenarioId, playerId);
    }

    /// <summary>
    /// Load a world from a JSON string produced by <see cref="WorldSaver.SaveToString"/>
    /// (or the contents of a save file). Same validation as <see cref="Load(ContentCatalog, string)"/>.
    /// </summary>
    public static WorldLoadResult LoadFromString(ContentCatalog catalog, string json)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(json);

        var save = JsonSerializer.Deserialize<WorldSaveFile>(json, JsonOptions)
            ?? throw new InvalidOperationException("save data deserialized to null");

        if (save.SchemaVersion < WorldSaver.MinSupportedSchemaVersion
            || save.SchemaVersion > WorldSaver.SchemaVersion)
        {
            throw new InvalidOperationException(
                $"save schema version {save.SchemaVersion} unsupported " +
                $"(engine accepts {WorldSaver.MinSupportedSchemaVersion}..{WorldSaver.SchemaVersion})");
        }

        var world = Rebuild(catalog, save);
        var playerId = save.PlayerId is int pid ? (CompanyId?)new CompanyId(pid) : null;
        return new WorldLoadResult(world, save.ScenarioId, playerId);
    }

    internal static World Rebuild(ContentCatalog catalog, WorldSaveFile save)
    {
        // v10 persists the full rules snapshot; every older save is a Classic game. The RNG
        // streams start from the saved seed (always 0 before v10 — legacy behaviour) and v10
        // then restores each stream's exact state below.
        var rules = save.SchemaVersion >= 10 && save.Rules is not null ? Normalize(save.Rules) : EconomyRules.Classic;
        var world = new World(catalog, save.Seed, save.Clock, rules);

        world.InternalNextCompanyId = save.NextCompanyId;
        world.InternalNextBuildingId = save.NextBuildingId;

        // Companies
        foreach (var c in save.Companies)
        {
            var id = new CompanyId(c.Id);
            var company = BuildCompany(id, c.Name, decimal.Parse(c.Cash, CultureInfo.InvariantCulture));
            world.InternalCompanies[id] = company;
        }

        // Buildings
        var needsCapitalizedCost = new HashSet<BuildingInstanceId>();
        var needsBuiltAt = new HashSet<BuildingInstanceId>();
        foreach (var b in save.Buildings)
        {
            var building = new BuildingInstance(
                new BuildingInstanceId(b.Id),
                new BuildingTypeId(b.TypeId),
                new CompanyId(b.OwnerId),
                new CityId(b.CityId));
            building.AutoExport = b.AutoExport;
            // v8: Level default is 1 on older saves (the DTO default), which matches
            //      the pre-3.59 "everything is L1" invariant.
            building.Level = b.Level < 1 ? 1 : b.Level;

            foreach (var inv in b.Inventory)
            {
                var cost = decimal.Parse(inv.Cost, CultureInfo.InvariantCulture);
                if (inv.QualityMass is double mass)
                {
                    // v10: exact restore, empty entries and order included.
                    building.Inventory.Restore(new ProductId(inv.ProductId), inv.Quantity, cost, mass);
                }
                else
                {
                    building.Inventory.Add(new ProductId(inv.ProductId), inv.Quantity, cost, inv.AverageQuality);
                }
            }

            if (b.CapitalizedCost is not null)
            {
                building.CapitalizedCost = decimal.Parse(b.CapitalizedCost, CultureInfo.InvariantCulture);
            }
            else
            {
                needsCapitalizedCost.Add(building.Id);
            }

            if (b.BuiltYear is int builtYear && b.BuiltMonth is int builtMonth)
            {
                building.BuiltAt = new GameDate(builtYear, builtMonth);
            }
            else
            {
                needsBuiltAt.Add(building.Id);
            }

            foreach (var s in b.ProductionSlots)
                building.ProductionSlots.Add(new ProductionSlot(s.Index, new ProductId(s.ProductId)));
            foreach (var s in b.ExtractionSlots)
                building.ExtractionSlots.Add(new ExtractionSlot(s.Index, new ProductId(s.ProductId)));
            foreach (var s in b.WarehouseSlots)
                building.WarehouseSlots.Add(new WarehouseSlot(s.Index, new ProductId(s.ProductId), s.TargetStock));
            foreach (var s in b.RetailSlots)
                building.RetailSlots.Add(new RetailSlot(
                    s.Index,
                    new ProductId(s.ProductId),
                    decimal.Parse(s.Price, CultureInfo.InvariantCulture),
                    s.RestockTarget));
            foreach (var s in b.ResearchSlots)
                building.ResearchSlots.Add(new ResearchSlot(s.Index, new ProductId(s.ProductId)));

            world.InternalBuildings[building.Id] = building;
            world.InternalCompanies[new CompanyId(b.OwnerId)].OwnedBuildings.Add(building.Id);
        }

        // Tech
        foreach (var t in save.Tech)
        {
            world.InternalTech[(new CompanyId(t.CompanyId), new ProductId(t.ProductId))] = t.Level;
        }

        // Brand awareness
        foreach (var b in save.BrandAwareness)
        {
            world.InternalBrandAwareness[
                (new CompanyId(b.CompanyId), new ProductId(b.ProductId), new CityId(b.CityId))] = b.Value;
        }

        // Research progress
        foreach (var r in save.ResearchProgress)
        {
            world.InternalResearchProgress[
                (new CompanyId(r.CompanyId), new ProductId(r.ProductId))] = r.Progress;
        }

        // Ad campaigns
        foreach (var ad in save.AdCampaigns)
        {
            var channel = Enum.Parse<AdChannel>(ad.Channel, ignoreCase: true);
            var budget = decimal.Parse(ad.MonthlyBudget, CultureInfo.InvariantCulture);
            var campaign = BuildAdCampaign(
                new CompanyId(ad.CompanyId),
                new ProductId(ad.ProductId),
                new CityId(ad.CityId),
                channel,
                budget);
            world.InternalAdCampaigns[(campaign.Company, campaign.Product, campaign.City, campaign.Channel)] = campaign;
        }

        // AI strategies
        foreach (var s in save.AiStrategies)
        {
            world.InternalAiStrategies[new CompanyId(s.CompanyId)] = CreateStrategy(s.Strategy, s.Config);
        }

        // Ledger
        foreach (var e in save.Ledger)
        {
            ProductId? product = e.ProductId is null ? null : new ProductId(e.ProductId);
            // v4: BuildingId is optional — v1/v2/v3 saves won't include it, default to null.
            BuildingInstanceId? building = e.BuildingId is int bid ? new BuildingInstanceId(bid) : null;
            var entry = new LedgerEntry(
                new GameDate(e.Year, e.Month),
                new CompanyId(e.CompanyId),
                Enum.Parse<LedgerCategory>(e.Category),
                decimal.Parse(e.Amount, CultureInfo.InvariantCulture),
                e.Memo,
                product,
                building,
                e.Quantity);
            world.Ledger.Record(entry);
        }

        RestoreCapitalizedCosts(catalog, world, needsCapitalizedCost);
        RestoreBuiltAt(world, needsBuiltAt, save.Clock);

        // Transfer log
        foreach (var t in save.Transfers)
        {
            world.TransferLog.Record(new TransferEntry(
                new GameDate(t.Year, t.Month),
                new CompanyId(t.CompanyId),
                new BuildingInstanceId(t.FromBuildingId),
                new BuildingInstanceId(t.ToBuildingId),
                new ProductId(t.ProductId),
                t.Quantity));
        }

        // COGS log
        foreach (var c in save.Cogs)
        {
            // v5: SourceBuildingId is optional — v1-v4 saves won't include it, default to null.
            BuildingInstanceId? source = c.SourceBuildingId is int sbid ? new BuildingInstanceId(sbid) : null;
            world.CogsLog.Record(new CogsEntry(
                new GameDate(c.Year, c.Month),
                new CompanyId(c.CompanyId),
                new ProductId(c.ProductId),
                c.Quantity,
                decimal.Parse(c.Cost, CultureInfo.InvariantCulture),
                source));
        }

        // v6: patents — null on v1-v5 saves, which load with empty collections.
        if (save.Patents is not null)
        {
            foreach (var p in save.Patents)
            {
                var key = (new CompanyId(p.Holder), new ProductId(p.Product));
                world.InternalPatents[key] = new Patent(
                    key.Item1,
                    key.Item2,
                    new GameDate(p.ExpiresYear, p.ExpiresMonth));
            }
        }

        if (save.PatentsEverGranted is not null)
        {
            foreach (var g in save.PatentsEverGranted)
            {
                world.InternalPatentsEverGranted.Add((new CompanyId(g.Holder), new ProductId(g.Product)));
            }
        }

        // v7: patent licenses — null on v1-v6 saves, which load with no licenses.
        if (save.PatentLicenses is not null)
        {
            foreach (var l in save.PatentLicenses)
            {
                var key = (new CompanyId(l.Holder), new ProductId(l.Product));
                if (!world.InternalPatentLicenses.TryGetValue(key, out var licensees))
                {
                    licensees = new HashSet<CompanyId>();
                    world.InternalPatentLicenses[key] = licensees;
                }
                licensees.Add(new CompanyId(l.Licensee));
            }
        }

        // v9: news log + active price effects. v1-v8 saves omit both fields;
        // the loader treats null as "empty" so older payloads stay compatible.
        if (save.NewsLog is not null)
        {
            foreach (var n in save.NewsLog)
            {
                var severity = Enum.TryParse<EventSeverity>(n.Severity, ignoreCase: true, out var s)
                    ? s
                    : EventSeverity.Info;
                world.InternalNewsLog.Add(new NewsEntry(
                    new GameDate(n.Year, n.Month),
                    n.EventId,
                    n.Headline,
                    severity));
            }
        }

        if (save.ActivePriceEffects is not null)
        {
            foreach (var ape in save.ActivePriceEffects)
            {
                world.InternalActivePriceEffects[new ProductId(ape.ProductId)] = new ActivePriceEffect(
                    ape.ProductId,
                    decimal.Parse(ape.Multiplier, CultureInfo.InvariantCulture),
                    ape.RemainingMonths);
            }
        }

        // v10: accrual journal. Accumulated depreciation is derived from it with the same
        // additions, in the same order, World.RecordAccrual made at runtime.
        if (save.AccrualJournal is not null)
        {
            foreach (var a in save.AccrualJournal)
            {
                var kind = Enum.Parse<AccrualKind>(a.Kind);
                var amount = decimal.Parse(a.Amount, CultureInfo.InvariantCulture);
                BuildingInstanceId? building = a.BuildingId is int abid ? new BuildingInstanceId(abid) : null;
                ProductId? product = a.ProductId is null ? null : new ProductId(a.ProductId);
                world.AccrualJournal.Record(new AccrualEntry(
                    new GameDate(a.Year, a.Month), new CompanyId(a.CompanyId), kind, amount, a.Memo, building, product));
                if (kind == AccrualKind.Depreciation
                    && building is BuildingInstanceId depreciated
                    && world.InternalBuildings.TryGetValue(depreciated, out var target))
                {
                    target.AccumulatedDepreciation -= amount;
                }
            }
        }

        // v10: every RNG stream continues exactly where the save left it.
        if (save.Rng is not null)
        {
            foreach (var stream in save.Rng)
            {
                world.RngStreams.Restore(stream.Name, stream.Algorithm, stream.State);
            }
        }

        // v10 extension sections (owned by the Wave 2/3 workstreams).
        LandSaveSection.Restore(world, save.Land);
        FinanceSaveSection.Restore(world, save.Finance);
        MarketSaveSection.Restore(world, save.Market);
        MacroSaveSection.Restore(world, save.Macro);

        return world;
    }

    /// <summary>
    /// A rules snapshot whose JSON spelled an area out as <c>null</c> gets that area's neutral
    /// defaults (an absent area already deserialises to them).
    /// </summary>
    private static EconomyRules Normalize(EconomyRules rules) => rules with
    {
        Market = rules.Market ?? new MarketRules(),
        Finance = rules.Finance ?? new FinanceRules(),
        Land = rules.Land ?? new LandRules(),
        Macro = rules.Macro ?? new MacroRules(),
    };

    /// <summary>
    /// Rebuild each building's capitalised cost from the ledger: its type's construction cost
    /// plus every <see cref="LedgerCategory.UpgradeCost"/> booked against it, in ledger order —
    /// the same additions <see cref="World.UpgradeBuilding"/> makes at runtime.
    /// </summary>
    private static void RestoreCapitalizedCosts(ContentCatalog catalog, World world, HashSet<BuildingInstanceId> buildings)
    {
        if (buildings.Count == 0) return;

        foreach (var id in buildings)
        {
            var building = world.InternalBuildings[id];
            building.CapitalizedCost = catalog.BuildingType(building.TypeId).ConstructionCost;
        }

        foreach (var entry in world.Ledger.Entries)
        {
            if (entry.Category != LedgerCategory.UpgradeCost || entry.Building is not BuildingInstanceId bid) continue;
            if (buildings.Contains(bid))
            {
                world.InternalBuildings[bid].CapitalizedCost += -entry.Amount;
            }
        }
    }

    /// <summary>
    /// Pre-v10 saves carry no construction month: use the building's first
    /// <see cref="LedgerCategory.ConstructionCost"/> entry, else the save's clock.
    /// </summary>
    private static void RestoreBuiltAt(World world, HashSet<BuildingInstanceId> buildings, GameDate fallback)
    {
        if (buildings.Count == 0) return;

        var pending = new HashSet<BuildingInstanceId>(buildings);
        foreach (var entry in world.Ledger.Entries)
        {
            if (pending.Count == 0) break;
            if (entry.Category != LedgerCategory.ConstructionCost || entry.Building is not BuildingInstanceId bid) continue;
            if (pending.Remove(bid))
            {
                world.InternalBuildings[bid].BuiltAt = entry.Date;
            }
        }

        foreach (var id in pending)
        {
            world.InternalBuildings[id].BuiltAt = fallback;
        }
    }

    /// <summary>
    /// Construct a strategy from its persisted name and optional config through the
    /// <see cref="AiStrategies"/> registry. A null <paramref name="config"/> — whether from a
    /// v1/v2 save or from a strategy at its defaults — yields the strategy's default tunables.
    /// </summary>
    private static IAiStrategy CreateStrategy(string name, IReadOnlyDictionary<string, string>? config)
        => AiStrategies.TryCreate(name, config, out var strategy)
            ? strategy
            : throw new InvalidOperationException($"unknown AI strategy '{name}' in save file");

    private static Company BuildCompany(CompanyId id, string name, decimal cash)
    {
        var company = new Company(id, name);
        company.Cash = cash;
        return company;
    }

    private static AdCampaign BuildAdCampaign(CompanyId c, ProductId p, CityId city, AdChannel ch, decimal budget)
        => new(c, p, city, ch, budget);
}
