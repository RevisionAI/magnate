using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Ai;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence.Sections;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence;

/// <summary>
/// Read-only metadata about a save file. Produced by
/// <see cref="WorldSaver.ListSaves"/> by parsing just enough of the JSON header
/// to populate these fields — the full world is not rebuilt.
/// </summary>
/// <param name="FileName">Base filename (no directory).</param>
/// <param name="FullPath">Absolute path on disk.</param>
/// <param name="Timestamp">File last-write time (UTC-local, from filesystem).</param>
/// <param name="ScenarioId">v2+ metadata; null for v1 saves or when unset.</param>
/// <param name="PlayerId">v2+ metadata; null for v1 saves or when unset.</param>
/// <param name="GameDate">Current in-game date from the save's clock.</param>
/// <param name="SchemaVersion">Schema version embedded in the save.</param>
/// <param name="FileSize">File size in bytes.</param>
public sealed record SaveFileInfo(
    string FileName,
    string FullPath,
    DateTime Timestamp,
    string? ScenarioId,
    int? PlayerId,
    GameDate GameDate,
    int SchemaVersion,
    long FileSize);

/// <summary>
/// Serializes a <see cref="World"/> to a JSON file. See <see cref="WorldLoader"/>
/// for the reverse. The current schema version is <see cref="SchemaVersion"/>.
/// </summary>
public static class WorldSaver
{
    /// <summary>Schema version written by this engine (see <see cref="MinSupportedSchemaVersion"/> for the history).</summary>
    public const int SchemaVersion = 10;

    /// <summary>
    /// Minimum schema version accepted by <see cref="WorldLoader"/>.
    /// <list type="bullet">
    ///   <item>v1: pre-scenario/player metadata.</item>
    ///   <item>v2: adds <c>ScenarioId</c> + <c>PlayerId</c> (missing → null).</item>
    ///   <item>v3: adds <c>AiStrategyDto.Config</c> (missing → strategy falls back to default ctor args).</item>
    ///   <item>v4: adds <c>LedgerEntryDto.BuildingId</c> for per-building P&amp;amp;L attribution (missing → null).</item>
    ///   <item>v5: adds <c>CogsEntryDto.SourceBuildingId</c> for per-building accrual P&amp;amp;L attribution (missing → null).</item>
    ///   <item>v6: adds patents + patentsEverGranted (Phase 3.49, missing → empty).</item>
    ///   <item>v7: adds patentLicenses (Phase 3.54, missing → empty).</item>
    ///   <item>v8: adds <c>BuildingDto.Level</c> for per-building upgrades (Phase 3.59, missing → 1).</item>
    ///   <item>v9: adds <c>NewsLog</c> + <c>ActivePriceEffects</c> for the events/news engine (Phase 3.65, missing → both empty).</item>
    ///   <item>v10: persists the real <c>Seed</c> (was always 0) and adds <c>Rules</c> (full EconomyRules snapshot; missing → Classic),
    ///         <c>Rng</c> (every named stream's state; missing → streams reseeded from <c>Seed</c>), <c>AccrualJournal</c>,
    ///         the nullable extension sections <c>Land</c>/<c>Finance</c>/<c>Market</c>/<c>Macro</c>, per-building
    ///         <c>CapitalizedCost</c>/<c>BuiltYear</c>/<c>BuiltMonth</c>, exact inventory <c>QualityMass</c> and ledger
    ///         <c>Quantity</c>. Slots and inventory entries are written in engine order so a round trip is lossless.</item>
    /// </list>
    /// </summary>
    public const int MinSupportedSchemaVersion = 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions CompactJsonOptions = new(JsonOptions) { WriteIndented = false };

    /// <summary>
    /// Enumerate *.json files in <paramref name="directory"/> and parse only each
    /// save's header fields (schema version, clock, scenarioId, playerId). Intended
    /// for UI save-browsers — no world is rebuilt so this is cheap even with
    /// hundreds of files. Files that fail to parse are silently skipped.
    /// </summary>
    public static IReadOnlyList<SaveFileInfo> ListSaves(string directory)
    {
        ArgumentNullException.ThrowIfNull(directory);
        if (!Directory.Exists(directory)) return Array.Empty<SaveFileInfo>();

        var results = new List<SaveFileInfo>();
        foreach (var path in Directory.EnumerateFiles(directory, "*.json"))
        {
            var info = TryReadHeader(path);
            if (info is not null) results.Add(info);
        }
        // Newest first — UIs almost always want that ordering.
        results.Sort((a, b) => b.Timestamp.CompareTo(a.Timestamp));
        return results;
    }

    private static SaveFileInfo? TryReadHeader(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            using var stream = File.OpenRead(path);
            using var doc = JsonDocument.Parse(stream);
            var root = doc.RootElement;

            var schemaVersion = root.TryGetProperty("schemaVersion", out var sv) && sv.ValueKind == JsonValueKind.Number
                ? sv.GetInt32()
                : 0;

            var gameDate = new GameDate(2026, 1);
            if (root.TryGetProperty("clock", out var clock) && clock.ValueKind == JsonValueKind.Object)
            {
                var year  = clock.TryGetProperty("year",  out var y) && y.ValueKind == JsonValueKind.Number ? y.GetInt32() : 2026;
                var month = clock.TryGetProperty("month", out var m) && m.ValueKind == JsonValueKind.Number ? m.GetInt32() : 1;
                gameDate = new GameDate(year, month);
            }

            string? scenarioId = null;
            if (root.TryGetProperty("scenarioId", out var sid) && sid.ValueKind == JsonValueKind.String)
            {
                scenarioId = sid.GetString();
            }

            int? playerId = null;
            if (root.TryGetProperty("playerId", out var pid) && pid.ValueKind == JsonValueKind.Number)
            {
                playerId = pid.GetInt32();
            }

            return new SaveFileInfo(
                FileName:      fi.Name,
                FullPath:      fi.FullName,
                Timestamp:     fi.LastWriteTime,
                ScenarioId:    scenarioId,
                PlayerId:      playerId,
                GameDate:      gameDate,
                SchemaVersion: schemaVersion,
                FileSize:      fi.Length);
        }
        catch
        {
            // Malformed / unreadable files are skipped rather than aborting the
            // whole listing — matches the SaveBrowser behavior of "show what
            // works, ignore garbage".
            return null;
        }
    }

    /// <summary>
    /// Persist a <see cref="World"/> to disk.
    /// <paramref name="scenarioId"/> / <paramref name="playerId"/> are optional
    /// v2 metadata — the client uses them on load to restore the active scenario
    /// (Goals tab) and the player's company.
    /// </summary>
    public static void Save(World world, string path, string? scenarioId = null, CompanyId? playerId = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(path);

        var snapshot = Snapshot(world, scenarioId, playerId);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        using var stream = File.Create(path);
        JsonSerializer.Serialize(stream, snapshot, JsonOptions);
    }

    /// <summary>
    /// Serialize a <see cref="World"/> to a JSON string (same format as
    /// <see cref="Save"/>). Used by hosts without a real filesystem — the
    /// browser client stores the string in IndexedDB/localStorage.
    /// </summary>
    public static string SaveToString(World world, string? scenarioId = null, CompanyId? playerId = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        return JsonSerializer.Serialize(Snapshot(world, scenarioId, playerId), JsonOptions);
    }

    /// <summary>
    /// Serialize a <see cref="World"/> to UTF-8 JSON bytes (bridge-spec E1). Compact by default —
    /// about a third smaller than the indented file format and the cheapest form to gzip and hand
    /// to the browser host; <paramref name="indented"/> produces exactly <see cref="SaveToString"/>'s
    /// text. Load with <see cref="WorldLoader.Load(Content.ContentCatalog, ReadOnlySpan{byte})"/>.
    /// </summary>
    public static byte[] SaveToUtf8(World world, string? scenarioId = null, CompanyId? playerId = null, bool indented = false)
    {
        ArgumentNullException.ThrowIfNull(world);
        return JsonSerializer.SerializeToUtf8Bytes(Snapshot(world, scenarioId, playerId), indented ? JsonOptions : CompactJsonOptions);
    }

    internal static WorldSaveFile Snapshot(World world, string? scenarioId = null, CompanyId? playerId = null)
    {
        var companies = world.InternalCompanies.Values
            .OrderBy(c => c.Id.Value)
            .Select(c => new CompanyDto(c.Id.Value, c.Name, c.Cash.ToString(CultureInfo.InvariantCulture)))
            .ToList();

        var buildings = world.InternalBuildings.Values
            .OrderBy(b => b.Id.Value)
            .Select(ToBuildingDto)
            .ToList();

        var tech = world.InternalTech
            .OrderBy(kvp => kvp.Key.Company.Value)
            .ThenBy(kvp => kvp.Key.Product.Value, StringComparer.Ordinal)
            .Select(kvp => new TechDto(kvp.Key.Company.Value, kvp.Key.Product.Value, kvp.Value))
            .ToList();

        var brand = world.InternalBrandAwareness
            .OrderBy(kvp => kvp.Key.Company.Value)
            .ThenBy(kvp => kvp.Key.Product.Value, StringComparer.Ordinal)
            .ThenBy(kvp => kvp.Key.City.Value, StringComparer.Ordinal)
            .Select(kvp => new BrandAwarenessDto(kvp.Key.Company.Value, kvp.Key.Product.Value, kvp.Key.City.Value, kvp.Value))
            .ToList();

        var research = world.InternalResearchProgress
            .OrderBy(kvp => kvp.Key.Company.Value)
            .ThenBy(kvp => kvp.Key.Product.Value, StringComparer.Ordinal)
            .Select(kvp => new ResearchProgressDto(kvp.Key.Company.Value, kvp.Key.Product.Value, kvp.Value))
            .ToList();

        var ads = world.InternalAdCampaigns.Values
            .OrderBy(c => c.Company.Value)
            .ThenBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ThenBy(c => (int)c.Channel)
            .Select(c => new AdCampaignDto(
                c.Company.Value,
                c.Product.Value,
                c.City.Value,
                c.Channel.ToString(),
                c.MonthlyBudget.ToString(CultureInfo.InvariantCulture)))
            .ToList();

        var strategies = world.InternalAiStrategies
            .OrderBy(kvp => kvp.Key.Value)
            .Select(kvp => new AiStrategyDto(kvp.Key.Value, StrategyName(kvp.Value), StrategyConfig(kvp.Value)))
            .ToList();

        var ledger = world.Ledger.Entries
            .Select(e => new LedgerEntryDto(
                e.Date.Year,
                e.Date.Month,
                e.Company.Value,
                e.Category.ToString(),
                e.Amount.ToString(CultureInfo.InvariantCulture),
                e.Memo,
                e.Product?.Value,
                e.Building?.Value,
                e.Quantity))
            .ToList();

        var transfers = world.TransferLog.Entries
            .Select(t => new TransferEntryDto(
                t.Date.Year,
                t.Date.Month,
                t.Company.Value,
                t.From.Value,
                t.To.Value,
                t.Product.Value,
                t.Quantity))
            .ToList();

        var cogs = world.CogsLog.Entries
            .Select(c => new CogsEntryDto(
                c.Date.Year,
                c.Date.Month,
                c.Company.Value,
                c.Product.Value,
                c.Quantity,
                c.Cost.ToString(CultureInfo.InvariantCulture),
                c.SourceBuilding?.Value))
            .ToList();

        var patents = world.InternalPatents.Values
            .OrderBy(p => p.Holder.Value)
            .ThenBy(p => p.Product.Value, StringComparer.Ordinal)
            .Select(p => new PatentDto(p.Holder.Value, p.Product.Value, p.ExpiresAt.Year, p.ExpiresAt.Month))
            .ToList();

        var patentsEver = world.InternalPatentsEverGranted
            .OrderBy(k => k.Holder.Value)
            .ThenBy(k => k.Product.Value, StringComparer.Ordinal)
            .Select(k => new PatentEverGrantedDto(k.Holder.Value, k.Product.Value))
            .ToList();

        var patentLicenses = new List<PatentLicenseDto>();
        foreach (var kvp in world.InternalPatentLicenses
                     .OrderBy(kv => kv.Key.Holder.Value)
                     .ThenBy(kv => kv.Key.Product.Value, StringComparer.Ordinal))
        {
            foreach (var licensee in kvp.Value.OrderBy(l => l.Value))
            {
                patentLicenses.Add(new PatentLicenseDto(kvp.Key.Holder.Value, licensee.Value, kvp.Key.Product.Value));
            }
        }

        // v9 — news log and active price effects. NewsLog preserves insertion
        // order (chronological); active price effects are emitted in product-id
        // ordinal order so the JSON is diff-friendly.
        var newsLog = world.InternalNewsLog
            .Select(n => new NewsEntryDto(
                n.Date.Year,
                n.Date.Month,
                n.EventId,
                n.Headline,
                n.Severity.ToString()))
            .ToList();

        var activePriceEffects = world.InternalActivePriceEffects
            .OrderBy(kvp => kvp.Key.Value, StringComparer.Ordinal)
            .Select(kvp => new ActivePriceEffectDto(
                kvp.Value.ProductId,
                kvp.Value.Multiplier.ToString(CultureInfo.InvariantCulture),
                kvp.Value.RemainingMonths))
            .ToList();

        // v10 — RNG streams (ordinal by name), accrual journal (recording order).
        var rng = world.RngStreams.Created
            .Select(r => new RngStreamDto(r.Name, r.Algorithm, r.ExportState()))
            .ToList();

        var accruals = world.AccrualJournal.Entries
            .Select(a => new AccrualEntryDto(
                a.Date.Year,
                a.Date.Month,
                a.Company.Value,
                a.Kind.ToString(),
                a.Amount.ToString(CultureInfo.InvariantCulture),
                a.Memo,
                a.Building?.Value,
                a.Product?.Value))
            .ToList();

        return new WorldSaveFile(
            SchemaVersion,
            Seed: world.Seed,
            Clock: world.Clock.Now,
            NextCompanyId: world.InternalNextCompanyId,
            NextBuildingId: world.InternalNextBuildingId,
            Companies: companies,
            Buildings: buildings,
            Tech: tech,
            BrandAwareness: brand,
            ResearchProgress: research,
            AdCampaigns: ads,
            AiStrategies: strategies,
            Ledger: ledger,
            Transfers: transfers,
            Cogs: cogs,
            ScenarioId: scenarioId,
            PlayerId: playerId?.Value,
            Patents: patents,
            PatentsEverGranted: patentsEver,
            PatentLicenses: patentLicenses,
            NewsLog: newsLog,
            ActivePriceEffects: activePriceEffects,
            Rules: world.Rules,
            Rng: rng,
            AccrualJournal: accruals.Count > 0 ? accruals : null,
            Land: LandSaveSection.Capture(world),
            Finance: FinanceSaveSection.Capture(world),
            Market: MarketSaveSection.Capture(world),
            Macro: MacroSaveSection.Capture(world));
    }

    private static BuildingDto ToBuildingDto(BuildingInstance b)
    {
        // v10: inventory entries and slot lists are written in engine order (not sorted). The
        // tick iterates retail and production slots in list order and sums inventory cost in
        // entry order, so persisting the order is what makes a save/load round trip lossless.
        var inventory = b.Inventory.RawEntries
            .Select(e => new InventoryItemDto(
                e.Product.Value,
                e.Quantity,
                e.Cost.ToString(CultureInfo.InvariantCulture),
                e.Quantity > 0 ? e.QualityMass / e.Quantity : 0.0,
                e.QualityMass))
            .ToList();

        return new BuildingDto(
            b.Id.Value,
            b.TypeId.Value,
            b.Owner.Value,
            b.City.Value,
            b.AutoExport,
            inventory,
            b.ProductionSlots.Select(s => new SlotDto(s.Index, s.Product.Value)).ToList(),
            b.ExtractionSlots.Select(s => new SlotDto(s.Index, s.Product.Value)).ToList(),
            b.WarehouseSlots.Select(s => new WarehouseSlotDto(s.Index, s.Product.Value, s.TargetStock)).ToList(),
            b.RetailSlots.Select(s => new RetailSlotDto(s.Index, s.Product.Value, s.Price.ToString(CultureInfo.InvariantCulture), s.RestockTarget)).ToList(),
            b.ResearchSlots.Select(s => new SlotDto(s.Index, s.Product.Value)).ToList(),
            b.Level,
            b.CapitalizedCost.ToString(CultureInfo.InvariantCulture),
            b.BuiltAt.Year,
            b.BuiltAt.Month);
    }

    private static string StrategyName(IAiStrategy strategy)
        => AiStrategies.TryGetName(strategy, out var name)
            ? name
            : throw new InvalidOperationException($"cannot serialize strategy type {strategy.GetType().Name}");

    /// <summary>
    /// Constructor-arg snapshot for strategies that expose tunables (<see cref="AiStrategies.ConfigOf"/>),
    /// invariant-culture formatted; null (field omitted) when there is nothing to persist.
    /// </summary>
    private static IReadOnlyDictionary<string, string>? StrategyConfig(IAiStrategy strategy) => AiStrategies.ConfigOf(strategy);
}
