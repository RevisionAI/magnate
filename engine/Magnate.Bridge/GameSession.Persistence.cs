using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Saves (bridge-spec §5.12, §6.3). The string methods serve tests and the dev
// console; the browser uses the binary entry points (gzip inside .NET, written to
// IndexedDB by the worker) exposed through web/engine-host as JSExports.
public sealed partial class GameSession
{
    /// <summary>The error envelope of the last failed <see cref="SaveBinary"/> (JSON), or null.</summary>
    public string? LastErrorJson { get; private set; }

    /// <summary>
    /// The <see cref="SaveMetaDto"/> (JSON, with raw and compressed sizes) of the last successful
    /// <see cref="SaveBinary"/>, or null. Lets the worker list the slot without a second serialization.
    /// </summary>
    public string? LastSaveMetaJson { get; private set; }

    /// <summary>Wall time per phase of the last binary save (engine, meta, sidecar, envelope, gzip), for <c>debugStats</c>.</summary>
    internal IReadOnlyDictionary<string, double>? LastSavePhasesMs { get; private set; }

    /// <summary>Wall time per phase of the last load (gunzip, scan, engine, install, sidecar, snapshot), for <c>debugStats</c>.</summary>
    internal IReadOnlyDictionary<string, double>? LastLoadPhasesMs { get; private set; }

    /// <summary>
    /// Serialize the current game as a web save envelope (engine JSON + bridge
    /// sidecar). Dev/tests only: a 10-year save is megabytes of JSON.
    /// </summary>
    [BridgeMethod("saveGame")]
    public SaveGameResult SaveGame(SaveArgs args)
    {
        var game = Game;
        var (raw, meta) = WriteSave(game, args);
        var player = game.World.Companies[game.Player];
        return new SaveGameResult(
            Data: Encoding.UTF8.GetString(raw),
            SchemaVersion: WorldSaver.SchemaVersion,
            ScenarioId: game.ScenarioId,
            ScenarioName: game.Scenario?.Name,
            CompanyName: player.Name,
            Date: Months.Dto(game.Now),
            Cash: player.Cash,
            Meta: meta with { RawBytes = raw.Length });
    }

    /// <summary>
    /// Replace the current game with one loaded from <see cref="LoadGameArgs.Data"/>:
    /// a web save envelope (restores the bridge sidecar) or a legacy engine save
    /// (schema v1–v9; history is backfilled from the ledger).
    /// </summary>
    [BridgeMethod("loadGame", Mutates = true, RequiresGame = false)]
    public SnapshotDto LoadGame(LoadGameArgs args)
    {
        var data = Guard.Required(args.Data, "data");
        return LoadBytes(Encoding.UTF8.GetBytes(data), new LoadArgs());
    }

    /// <summary>The engine part of the save in the legacy (Godot-compatible, schema v9) format. Dev.</summary>
    [BridgeMethod("exportEngineJson")]
    public EngineJsonDto ExportEngineJson()
    {
        var game = Game;
        return new EngineJsonDto(WorldSaver.SaveToString(game.World, game.ScenarioId, game.Player));
    }

    // ------------------------------------------------------------------ binary entry points (JSExport)

    /// <summary>
    /// gzip(web save envelope) for <see cref="SaveArgs"/> JSON. Never throws: on
    /// failure returns an empty array and <see cref="LastErrorJson"/> holds the error envelope.
    /// </summary>
    public byte[] SaveBinary(string? argsJson)
    {
        LastErrorJson = null;
        LastSaveMetaJson = null;
        try
        {
            var args = ParseSaveArgs(argsJson);
            var phases = new PhaseTimer();
            phases.Start();
            var (raw, meta) = WriteSave(Game, args, phases: phases);
            var compressed = WebSave.Compress(raw);
            phases.Lap("gzip");
            LastSavePhasesMs = phases.Totals();
            LastSaveMetaJson = JsonSerializer.Serialize(meta with { RawBytes = raw.Length, CompressedBytes = compressed.Length }, BridgeJson.Options);
            return compressed;
        }
        catch (Exception ex)
        {
            LastErrorJson = JsonSerializer.Serialize(new ErrorEnvelopeDto(false, ToErrorBody(ex), Revision), BridgeJson.Options);
            return Array.Empty<byte>();
        }
    }

    private static SaveArgs ParseSaveArgs(string? argsJson)
    {
        SaveArgs? args;
        try
        {
            args = string.IsNullOrWhiteSpace(argsJson) ? null : JsonSerializer.Deserialize<SaveArgs>(argsJson, BridgeJson.Options);
        }
        catch (JsonException ex)
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest, "The save arguments are malformed.", null, new ErrorDetailsDto(DevMessage: ex.Message));
        }
        return args ?? new SaveArgs();
    }

    /// <summary>Save metadata for the bytes <see cref="SaveBinary"/> would write (for the worker's save list).</summary>
    public string SaveMeta(string? argsJson)
        => Execute("saveMeta", mutates: false, requiresGame: true, typeof(SaveMetaDto), argsJson, () =>
        {
            var (raw, meta) = WriteSave(Game, ParseSaveArgs(argsJson), publishAutosave: false);
            return meta with { RawBytes = raw.Length, CompressedBytes = WebSave.Compress(raw).Length };
        });

    /// <summary>Load gzip or plain save bytes. Returns the <c>loadGame</c> envelope (a <see cref="SnapshotDto"/>).</summary>
    public string LoadBinary(byte[] data, string? argsJson)
        => Execute("loadGame", mutates: true, requiresGame: false, typeof(SnapshotDto), null, () =>
        {
            var args = string.IsNullOrWhiteSpace(argsJson) ? new LoadArgs() : JsonSerializer.Deserialize<LoadArgs>(argsJson, BridgeJson.Options) ?? new LoadArgs();
            return LoadBytes(data ?? Array.Empty<byte>(), args);
        });

    /// <summary>Read a save's metadata and loadability without loading it. Returns an <see cref="InspectResultDto"/> envelope.</summary>
    public string InspectSave(byte[] data)
        => Execute("inspectSave", mutates: false, requiresGame: false, typeof(InspectResultDto), null, () => Inspect(data ?? Array.Empty<byte>()));

    // ------------------------------------------------------------------ implementation

    private (byte[] Raw, SaveMetaDto Meta) WriteSave(ActiveGame game, SaveArgs args, bool publishAutosave = true, PhaseTimer? phases = null)
    {
        var slotKind = args.SlotKind is "manual" or "autosave" or "quicksave" ? args.SlotKind : "manual";
        if (args.Client is { } client && Encoding.UTF8.GetByteCount(client) > SaveArgs.MaxClientBytes)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, "The client save data is too large.", "client",
                new ErrorDetailsDto(Max: SaveArgs.MaxClientBytes));
        }
        if (slotKind == "autosave" && publishAutosave)
        {
            game.MonthsSinceAutosave = 0;
            game.Feed.Publish(new GameEventDto(EventKinds.Autosaved, EventKinds.Info, "Game autosaved.", Priority: 1), Months.Dto(game.Now));
        }
        // Compact UTF-8 straight from the engine (E1/E14): no indented string, no re-encode.
        var engineUtf8 = WorldSaver.SaveToUtf8(game.World, game.ScenarioId, game.Player);
        phases?.Lap("engine");
        var meta = BuildMeta(game, slotKind, args.Label, args.CreatedAtIso);
        phases?.Lap("meta");
        var sidecar = BuildSidecar(game);
        phases?.Lap("sidecar");
        var raw = WebSave.Write(engineUtf8, meta, sidecar, _contentHash, args.Client);
        phases?.Lap("envelope");
        if (publishAutosave) game.Journal.Clear();
        return (raw, meta);
    }

    private SaveMetaDto BuildMeta(ActiveGame game, string slotKind, string? label, string? createdAtIso)
    {
        var world = game.World;
        var player = world.Companies[game.Player];
        var now = game.Now;
        var financials = Financials.Compute(world, game.Index, now, game.StartMonth)[game.Player.Value];
        var byCategory = world.Buildings.Values
            .Where(b => b.Owner == game.Player)
            .GroupBy(b => world.Catalog.BuildingType(b.TypeId).Category, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new IdCountDto(g.Key, g.Count()))
            .ToList();
        var topProducts = game.Index.ProductsOf(game.Player.Value)
            .Select(p =>
            {
                decimal revenue = 0m;
                for (var m = game.StartMonth; m <= now; m++)
                {
                    if (game.Index.Product(game.Player.Value, p, m) is { } pm) revenue += pm.Sales + pm.Exports;
                }
                return new ProductRevenueDto(p, revenue);
            })
            .Where(r => r.Revenue > 0m)
            .OrderByDescending(r => r.Revenue)
            .ThenBy(r => r.ProductId, StringComparer.Ordinal)
            .Take(3)
            .ToList();
        return new SaveMetaDto(
            FormatVersion: WebSave.FormatVersion,
            EngineSchemaVersion: WorldSaver.SchemaVersion,
            GameId: game.GameId,
            ScenarioId: game.ScenarioId,
            ScenarioName: game.Scenario?.Name,
            CompanyName: player.Name,
            Date: Months.Dto(now),
            ElapsedMonths: Math.Max(0, now - game.StartMonth),
            Cash: player.Cash,
            StartingCapital: game.Index.CategorySum(game.Player.Value, LedgerCategory.StartingCapital, game.Index.FirstMonth(game.Player.Value) ?? now, now),
            CorporateValue: financials.CorporateValue,
            BuildingsByCategory: byCategory,
            TopProducts: topProducts,
            GoalsAchieved: game.Goals.AchievedCount,
            GoalsTotal: game.Goals.Definitions.Count,
            OutcomeStatus: game.Goals.Status,
            ContentHash: _contentHash,
            Label: string.IsNullOrWhiteSpace(label) ? null : label.Trim(),
            SlotKind: slotKind,
            CreatedAtIso: createdAtIso,
            RawBytes: 0,
            CompressedBytes: 0);
    }

    private static BridgeSidecarDto BuildSidecar(ActiveGame game) => new(
        GameId: game.GameId,
        Seed: game.Seed,
        StartDate: Months.Dto(game.StartMonth),
        ScenarioId: game.ScenarioId,
        Custom: game.Custom,
        CreatedAtIso: game.CreatedAtIso,
        // Informational: the engine save is the source of truth for registrations (E2).
        Autopilot: game.Autopilot,
        AiStrategies: game.World.Companies.Keys
            .Where(id => id != game.Player)
            .OrderBy(id => id.Value)
            .Select(id => (Id: id.Value, Name: game.StrategyOf(id.Value)))
            .Where(t => t.Name is not null)
            .ToDictionary(t => t.Id.ToString(CultureInfo.InvariantCulture), t => t.Name!, StringComparer.Ordinal),
        History: game.History.Save(),
        Goals: game.Goals.Save(),
        Events: game.Detector.Save(),
        Feed: game.Feed.Save(),
        Placement: game.Placement.Save(),
        Settings: new SettingsDto(game.LowCashThreshold, game.AutosaveEveryMonths, game.Goals.GraceMonths, game.Feed.Capacity),
        Journal: game.Journal.ToList(),
        MonthsSinceAutosave: game.MonthsSinceAutosave);

    /// <summary>
    /// Load order (bridge-spec §6.3): decompress → check versions → check content ids →
    /// rebuild the world → restore the sidecar → rebuild the ledger index → snapshot.
    /// The previous game stays installed if any step fails.
    /// </summary>
    private SnapshotDto LoadBytes(byte[] data, LoadArgs args)
    {
        var catalog = Catalog;
        if (data.Length == 0) throw WebSave.Corrupt("The save is empty.", null);
        var phases = new PhaseTimer();
        phases.Start();
        var utf8 = WebSave.IsGzip(data) ? WebSave.Decompress(data) : data;
        phases.Lap("gunzip");
        var parsed = WebSave.Parse(utf8, catalog, args.TrustContent ? _contentHash : null);
        phases.Lap("scan");

        if (parsed.Facts.Missing.Count > 0)
        {
            throw new BridgeException(BridgeErrorCodes.SaveContentMismatch,
                "This save uses content that is not installed.", null, new ErrorDetailsDto(Missing: parsed.Facts.Missing.ToList()));
        }
        if (args.ExpectedGameId is { } expected && parsed.Sidecar is { } sc && sc.GameId != expected)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, "That save belongs to a different game.", "expectedGameId");
        }

        WorldLoadResult loaded;
        try
        {
            loaded = WorldLoader.Load(catalog, parsed.Engine.Span);
        }
        catch (Exception ex) when (ex is not BridgeException)
        {
            throw WebSave.Corrupt("The save's game data could not be read.", ex);
        }
        phases.Lap("engine");

        var world = loaded.World;
        var playerId = loaded.PlayerId ?? new CompanyId(1);
        if (!world.Companies.ContainsKey(playerId)) throw WebSave.Corrupt("The save has no player company.", null);

        var sidecar = parsed.Sidecar;
        var scenarioId = sidecar?.ScenarioId ?? loaded.ScenarioId;
        Scenario? scenario = null;
        if (sidecar?.Custom is { } custom) scenario = BuildCustomScenario(custom);
        else if (scenarioId is not null && _scenarios.TryGetValue(scenarioId, out var s)) scenario = s;

        var now = world.Clock.Now.AsMonthIndex();
        // The ledger is date-monotonic, so its first entry (starting capital) dates the game's start.
        var firstLedgerMonth = world.Ledger.Entries.Count > 0 ? world.Ledger.Entries[0].Date.AsMonthIndex() : now;
        var start = sidecar is not null
            ? Months.Index(sidecar.StartDate)
            : scenario?.StartDate.AsMonthIndex() ?? Math.Min(firstLedgerMonth, now);
        var seed = sidecar?.Seed ?? 0;
        var gameId = sidecar?.GameId ?? NewGameId(seed, scenarioId, null, start);

        var game = new ActiveGame(world, playerId, scenario, start, seed, gameId, Rules)
        {
            ScenarioId = scenarioId,
            Custom = sidecar?.Custom,
            CreatedAtIso = sidecar?.CreatedAtIso,
        };

        if (sidecar is not null)
        {
            if (sidecar.Settings is { } settings)
            {
                game.LowCashThreshold = settings.LowCashThreshold > 0m ? settings.LowCashThreshold : game.LowCashThreshold;
                game.AutosaveEveryMonths = Math.Clamp(settings.AutosaveEveryMonths, 0, 120);
            }
            game.MonthsSinceAutosave = Math.Max(0, sidecar.MonthsSinceAutosave);
            game.Feed.Restore(sidecar.Feed);
            game.Goals.Restore(sidecar.Goals);
            game.Detector.Restore(sidecar.Events);
            game.Placement.Restore(world, sidecar.Placement);
            game.History.Restore(sidecar.History);
            if (sidecar.Journal is { } journal) game.Journal.AddRange(journal);
        }

        phases.Lap("sidecar");
        MarkDirty();
        InstallGame(game, freshStart: false);
        phases.Lap("install");
        if (sidecar is null)
        {
            // Legacy save: rebuild what the sidecar would have held.
            game.History.Backfill(world, game.Index, now);
            game.History.Append(world, Financials.Compute(world, game.Index, now, game.StartMonth), now);
            game.Detector.Prime(world, game.Player, game.Index, game.StartMonth, now, game.LowCashThreshold,
                parsed.Facts.PatentsEverGranted.Where(p => p.Holder == playerId.Value).Select(p => p.Product));
            phases.Lap("backfill");
        }
        var snapshot = BuildSnapshot();
        phases.Lap("snapshot");
        LastLoadPhasesMs = phases.Totals();
        return snapshot;
    }

    private InspectResultDto Inspect(byte[] data)
    {
        var catalog = Catalog;
        if (data.Length == 0) throw WebSave.Corrupt("The save is empty.", null);
        var compressed = data.LongLength;
        var utf8 = WebSave.IsGzip(data) ? WebSave.Decompress(data) : data;
        try
        {
            var parsed = WebSave.Parse(utf8, catalog);
            var loadable = parsed.Facts.Missing.Count == 0;
            var meta = (parsed.Meta ?? LegacyMeta(parsed.Facts, _scenarios)) with { RawBytes = utf8.LongLength, CompressedBytes = compressed };
            var contentChanged = parsed.ContentHash is { Length: > 0 } hash && hash != _contentHash;
            return new InspectResultDto(meta, loadable, loadable ? null : BridgeErrorCodes.SaveContentMismatch, parsed.Client, contentChanged);
        }
        catch (BridgeException ex) when (ex.Code is BridgeErrorCodes.SaveVersionUnsupported)
        {
            var empty = new SaveMetaDto(0, 0, "", null, null, "", new DateDto(0, 1), 0, 0m, 0m, 0m,
                Array.Empty<IdCountDto>(), Array.Empty<ProductRevenueDto>(), 0, 0, Outcomes.Playing, "", null, "manual", null,
                utf8.LongLength, compressed);
            return new InspectResultDto(empty, false, ex.Code);
        }
    }

    /// <summary>
    /// Metadata of a legacy (engine-only) save, from the facts its scan gathered. Values that need
    /// the world (corporate value, goals) are unknown until it is loaded and read as zero.
    /// </summary>
    private static SaveMetaDto LegacyMeta(EngineFacts facts, IReadOnlyDictionary<string, Scenario> scenarios)
    {
        var playerId = facts.PlayerId ?? 1;
        var (name, cashText) = facts.Companies.TryGetValue(playerId, out var c) ? c : ("", "0");
        decimal.TryParse(cashText, NumberStyles.Number | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var cash);
        var scenario = facts.ScenarioId is { } id && scenarios.TryGetValue(id, out var s) ? s : null;
        var date = facts.Clock ?? new DateDto(2026, 1);
        var elapsed = scenario is null ? 0 : Math.Max(0, Months.Index(date) - scenario.StartDate.AsMonthIndex());
        return new SaveMetaDto(0, facts.SchemaVersion, "", facts.ScenarioId, scenario?.Name, name, date, elapsed, cash, 0m, 0m,
            Array.Empty<IdCountDto>(), Array.Empty<ProductRevenueDto>(), 0, 0, Outcomes.Playing, "", null, "manual", null, 0, 0);
    }
}
