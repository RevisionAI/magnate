using System.Collections.Generic;

namespace Magnate.Engine.Domain;

public sealed record Footprint(int Width, int Height);

public sealed record HeadcountRange(int Min, int Max);

public sealed record GeographyRequirement(
    bool? Coastal,
    bool? Arable,
    bool? MineralRich,
    bool? OilRich);

/// <summary>
/// Per-level configuration for an upgradeable building (Phase 3.59). A
/// <see cref="BuildingType"/> whose <see cref="BuildingType.Levels"/> list is
/// non-null exposes a progression Level 1 → 2 → 3 where each tier offers more
/// slot capacity and lower per-month opex. <see cref="UpgradeCost"/> is the
/// one-shot capex paid to <em>reach</em> this level — for Level 1 it's
/// informational only (construction is paid via
/// <see cref="BuildingType.ConstructionCost"/>) and callers ignore it.
/// </summary>
public sealed record BuildingLevelConfig(
    int Level,
    int Capacity,
    decimal MonthlyOperatingCost,
    decimal UpgradeCost);

// Levels (last param, optional): null = no upgrade path; non-null entries must be
// ordered ascending starting at Level 1, with L1 mirroring MaxUnits + MonthlyOperatingCost
// so pre-upgrade behaviour is unchanged. Phase 3.59. See BuildingLevelConfig.
public sealed record BuildingType(
    BuildingTypeId Id,
    string Name,
    string Category,
    decimal ConstructionCost,
    decimal MonthlyOperatingCost,
    Footprint Footprint,
    int MaxUnits,
    IReadOnlyList<ProductTier> ProducibleTiers,
    bool Retail,
    HeadcountRange? TargetHeadcount,
    GeographyRequirement? GeographyRequirement,
    IReadOnlyList<BuildingLevelConfig>? Levels = null)
{
    /// <summary>
    /// Staffing model (econ-audit §4.5): fixed staff plus staff per active slot, each with a
    /// wage role. Resolved by the content loader (category defaults when omitted).
    /// </summary>
    public BuildingStaffing Staffing { get; init; } = BuildingStaffing.None;

    /// <summary>
    /// Retail format (econ-audit §4.3): throughput per slot and draw per retail category. Null
    /// for non-retail types; resolved with defaults for every retail type.
    /// </summary>
    public RetailFormat? RetailFormat { get; init; }

    /// <summary>
    /// Maximum stock value per warehouse slot at world price (econ-audit §4.7). Null = no cap.
    /// </summary>
    public decimal? StorageValuePerSlot { get; init; }

    /// <summary>
    /// Construction duration in months (econ-audit §4.12, game-compressed). Content data for
    /// the land/construction workstream; null when the content omits it.
    /// </summary>
    public int? BuildMonths { get; init; }
}
