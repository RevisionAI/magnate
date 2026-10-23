using System.Collections.Generic;
using Magnate.Engine.Persistence.Sections;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence;

/// <summary>
/// JSON-serialized snapshot of a <see cref="World"/>. Human-readable — easy to
/// diff and debug. Schema version lets us migrate future saves forward.
/// Decimals are stored as strings to preserve exact precision across round-trips.
/// </summary>
internal sealed record WorldSaveFile(
    int SchemaVersion,
    int Seed,
    GameDate Clock,
    int NextCompanyId,
    int NextBuildingId,
    IReadOnlyList<CompanyDto> Companies,
    IReadOnlyList<BuildingDto> Buildings,
    IReadOnlyList<TechDto> Tech,
    IReadOnlyList<BrandAwarenessDto> BrandAwareness,
    IReadOnlyList<ResearchProgressDto> ResearchProgress,
    IReadOnlyList<AdCampaignDto> AdCampaigns,
    IReadOnlyList<AiStrategyDto> AiStrategies,
    IReadOnlyList<LedgerEntryDto> Ledger,
    IReadOnlyList<TransferEntryDto> Transfers,
    IReadOnlyList<CogsEntryDto> Cogs,
    // v2 additions — optional to stay compatible with v1 saves.
    string? ScenarioId = null,
    int? PlayerId = null,
    // v6 additions — patent system (Phase 3.49). Null on v1-v5 saves; loader
    // treats null as "no patents issued yet" (empty collections).
    IReadOnlyList<PatentDto>? Patents = null,
    IReadOnlyList<PatentEverGrantedDto>? PatentsEverGranted = null,
    // v7 addition — patent licensing (Phase 3.54). Null on v1-v6 saves; loader
    // treats null as "no licenses granted yet".
    IReadOnlyList<PatentLicenseDto>? PatentLicenses = null,
    // v9 additions — events / news engine (Phase 3.65). Null on v1-v8 saves;
    // loader treats null as "no news, no active price effects yet".
    IReadOnlyList<NewsEntryDto>? NewsLog = null,
    IReadOnlyList<ActivePriceEffectDto>? ActivePriceEffects = null,
    // v10 additions (E0 foundation). All optional: v1-v9 saves load as Classic with the RNG
    // reseeded from Seed (0 for every pre-v10 save — the legacy behaviour, documented).
    // Rules: full snapshot of the world's EconomyRules, so retuning a preset never changes an
    // existing game. Rng: the state of every named stream created so far (the world seed is
    // the top-level Seed, which v10 finally persists).
    EconomyRules? Rules = null,
    IReadOnlyList<RngStreamDto>? Rng = null,
    IReadOnlyList<AccrualEntryDto>? AccrualJournal = null,
    // v10 extension sections, owned by the Wave 2/3 workstreams (Persistence/Sections/).
    // Null (omitted) when the area has nothing to persist.
    LandSaveSection? Land = null,
    FinanceSaveSection? Finance = null,
    MarketSaveSection? Market = null,
    MacroSaveSection? Macro = null);

internal sealed record CompanyDto(int Id, string Name, string Cash);

internal sealed record BuildingDto(
    int Id,
    string TypeId,
    int OwnerId,
    string CityId,
    bool AutoExport,
    IReadOnlyList<InventoryItemDto> Inventory,
    IReadOnlyList<SlotDto> ProductionSlots,
    IReadOnlyList<SlotDto> ExtractionSlots,
    IReadOnlyList<WarehouseSlotDto> WarehouseSlots,
    IReadOnlyList<RetailSlotDto> RetailSlots,
    IReadOnlyList<SlotDto> ResearchSlots,
    // v8 addition — building upgrade level (Phase 3.59). Missing on v1-v7 saves
    // (JSON deserialiser falls back to the default 1).
    int Level = 1,
    // v10 additions — capitalised cost (construction + upgrades, exact decimal string) and
    // construction month. Missing on v1-v9 saves: rebuilt from the ledger.
    string? CapitalizedCost = null,
    int? BuiltYear = null,
    int? BuiltMonth = null);

/// <summary>
/// Persisted inventory entry. <paramref name="QualityMass"/> (v10) is the exact Σ(quality ×
/// quantity) behind <paramref name="AverageQuality"/>; with it the loader restores the entry
/// bit for bit. Entries are written in the inventory's enumeration order, empty ones included.
/// </summary>
internal sealed record InventoryItemDto(
    string ProductId,
    double Quantity,
    string Cost,
    double AverageQuality,
    double? QualityMass = null);

internal sealed record SlotDto(int Index, string ProductId);

internal sealed record WarehouseSlotDto(int Index, string ProductId, double TargetStock);

internal sealed record RetailSlotDto(int Index, string ProductId, string Price, double RestockTarget);

internal sealed record TechDto(int CompanyId, string ProductId, int Level);

internal sealed record BrandAwarenessDto(int CompanyId, string ProductId, string CityId, double Value);

internal sealed record ResearchProgressDto(int CompanyId, string ProductId, double Progress);

internal sealed record AdCampaignDto(int CompanyId, string ProductId, string CityId, string Channel, string MonthlyBudget);

/// <summary>
/// Persisted AI strategy. <paramref name="Config"/> is schema v3+: a flat
/// invariant-culture-formatted string/string dictionary of strategy ctor
/// arguments. It is null for strategies with no tunables (e.g.
/// <c>SimpleRetailerStrategy</c>) and for v1/v2 saves — loaders must treat a
/// null config as "use defaults" to stay back-compatible.
/// </summary>
internal sealed record AiStrategyDto(
    int CompanyId,
    string Strategy,
    IReadOnlyDictionary<string, string>? Config = null);

internal sealed record LedgerEntryDto(
    int Year,
    int Month,
    int CompanyId,
    string Category,
    string Amount,
    string? Memo,
    string? ProductId,
    // v4 addition — per-building P&L attribution. Null for company-wide flows
    // (starting capital, advertising) and for v1/v2/v3 saves.
    int? BuildingId = null,
    // v10 addition — units behind a per-unit flow (bridge-spec E11). Null otherwise.
    double? Quantity = null);

internal sealed record TransferEntryDto(
    int Year,
    int Month,
    int CompanyId,
    int FromBuildingId,
    int ToBuildingId,
    string ProductId,
    double Quantity);

/// <summary>
/// Persisted active patent (v6+). <paramref name="ExpiresYear"/> /
/// <paramref name="ExpiresMonth"/> carry the absolute expiry game-date so
/// expiration remains stable across save/load independent of the clock's
/// current position.
/// </summary>
internal sealed record PatentDto(int Holder, string Product, int ExpiresYear, int ExpiresMonth);

/// <summary>
/// Persisted ever-granted patent marker (v6+). Lives separately from
/// <see cref="PatentDto"/> so that expired patents still prevent the same
/// (company, product) pair from being re-granted in the future.
/// </summary>
internal sealed record PatentEverGrantedDto(int Holder, string Product);

/// <summary>
/// Persisted patent license (v7+). Pure (holder, licensee, product) triple —
/// there's no separate expiry because licenses ride on the underlying patent's
/// lifetime and are cascaded-removed when the patent is pruned.
/// </summary>
internal sealed record PatentLicenseDto(int Holder, int Licensee, string Product);

/// <summary>
/// Persisted entry in <see cref="World.NewsLog"/> (v9+). Plain
/// (date, eventId, headline, severity) tuple — the originating
/// <see cref="EventDefinition"/> doesn't need to be re-resolved on load.
/// </summary>
internal sealed record NewsEntryDto(
    int Year,
    int Month,
    string EventId,
    string Headline,
    string Severity);

/// <summary>
/// Persisted in-flight world-market price multiplier (v9+). Survives save/load
/// so a fired event's gameplay impact carries through a session quit.
/// </summary>
internal sealed record ActivePriceEffectDto(
    string ProductId,
    string Multiplier,
    int RemainingMonths);

internal sealed record CogsEntryDto(
    int Year,
    int Month,
    int CompanyId,
    string ProductId,
    double Quantity,
    string Cost,
    // v5 addition — per-building accrual P&L attribution. Null for older saves
    // (v1-v4) and for future call sites that don't have a single source building.
    int? SourceBuildingId = null);

/// <summary>
/// Persisted state of one named RNG stream (v10). <paramref name="Algorithm"/> is
/// <c>legacy-net</c> or <c>xoshiro256**</c>; <paramref name="State"/> is the generator's
/// <see cref="RandomStream.ExportState"/> output.
/// </summary>
internal sealed record RngStreamDto(string Name, string Algorithm, IReadOnlyList<string> State);

/// <summary>Persisted accrual-journal entry (v10). Amount is an exact decimal string.</summary>
internal sealed record AccrualEntryDto(
    int Year,
    int Month,
    int CompanyId,
    string Kind,
    string Amount,
    string? Memo,
    int? BuildingId = null,
    string? ProductId = null);
