using System.Collections.Generic;

namespace Magnate.Bridge;

// Persistence (bridge-spec §5.12) and dev (§5.13).

/// <summary>Args for <c>loadGame</c>: a web save envelope (JSON) or a legacy engine save (schema v1–v9).</summary>
public sealed record LoadGameArgs(string Data);

/// <summary>
/// Result of <c>saveGame</c> (dev/tests; the web client uses the binary path):
/// <c>data</c> is the web save envelope JSON.
/// </summary>
public sealed record SaveGameResult(
    string Data,
    int SchemaVersion,
    string? ScenarioId,
    string? ScenarioName,
    string CompanyName,
    DateDto Date,
    decimal Cash,
    SaveMetaDto? Meta = null);

/// <summary>
/// Args for saving: slot kind (<c>manual</c> | <c>autosave</c> | <c>quicksave</c>), label, client clock,
/// and <see cref="Client"/>: the client's own presentation state (UI sidecar, thumbnail, play time) as a
/// JSON document. The bridge never interprets it; it travels inside the save envelope (<c>"client"</c>)
/// so an exported file round-trips the whole game, and comes back from <c>InspectSave</c>.
/// At most <see cref="MaxClientBytes"/> UTF-8 bytes.
/// </summary>
public sealed record SaveArgs(string SlotKind = "manual", string? Label = null, string? CreatedAtIso = null, string? Client = null)
{
    /// <summary>Upper bound for <see cref="Client"/> (a thumbnail plus years of UI history fit easily).</summary>
    public const int MaxClientBytes = 2 * 1024 * 1024;
}

/// <summary>
/// Args for binary loads: refuse a save of another game when <c>expectedGameId</c> is set.
/// <c>trustContent</c>: the bytes come from this browser's own save store (written by this bridge,
/// or imported after <c>InspectSave</c> checked them), so a save whose <c>contentHash</c> equals the
/// installed content's skips the content-id scan (bridge-spec §6.3; ≈ 1.5 s of a year-10 WASM load).
/// Files from outside (imports, the string <c>loadGame</c>) are always scanned.
/// </summary>
public sealed record LoadArgs(string? ExpectedGameId = null, bool TrustContent = false);

/// <summary>Save metadata written at save time, so listing saves never parses save bodies.</summary>
public sealed record SaveMetaDto(
    int FormatVersion,
    int EngineSchemaVersion,
    string GameId,
    string? ScenarioId,
    string? ScenarioName,
    string CompanyName,
    DateDto Date,
    int ElapsedMonths,
    decimal Cash,
    decimal StartingCapital,
    decimal CorporateValue,
    IReadOnlyList<IdCountDto> BuildingsByCategory,
    IReadOnlyList<ProductRevenueDto> TopProducts,
    int GoalsAchieved,
    int GoalsTotal,
    string OutcomeStatus,
    string ContentHash,
    string? Label,
    string SlotKind,
    string? CreatedAtIso,
    long RawBytes,
    long CompressedBytes);

/// <summary>A product's revenue (save preview).</summary>
public sealed record ProductRevenueDto(string ProductId, decimal Revenue);

/// <summary>
/// Result of inspecting save bytes without loading them. <see cref="Client"/> is the client JSON stored
/// with <see cref="SaveArgs.Client"/> (null for legacy saves); <see cref="ContentChanged"/> is true when the
/// save was written against different content files (not fatal: the id check decides loadability, §6.2).
/// </summary>
public sealed record InspectResultDto(SaveMetaDto Meta, bool Loadable, string? Problem, string? Client = null, bool ContentChanged = false);

/// <summary>Result of <c>exportEngineJson</c> (dev): a legacy-compatible engine save.</summary>
public sealed record EngineJsonDto(string Json);

/// <summary>Engine/bridge counters for the dev overlay.</summary>
public sealed record DebugStatsDto(
    int LedgerEntries,
    int CogsEntries,
    int TransferEntries,
    int Buildings,
    int Companies,
    double LastTickMs,
    double LastBridgeMs,
    double IndexCatchUpMs,
    long Revision,
    bool Faulted,
    string ProtocolVersion,
    IReadOnlyDictionary<string, double>? LastAdvancePhasesMs = null,
    IReadOnlyDictionary<string, double>? LastSavePhasesMs = null,
    IReadOnlyDictionary<string, double>? LastLoadPhasesMs = null);
