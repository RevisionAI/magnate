using System.Collections.Generic;

namespace Magnate.Bridge;

// City view, world map, supply flows and build preview (bridge-spec §5.5).
// The static city layout (roads, parcels, water, ambient) is the `cityLayout`
// method and its DTOs, owned by the city-generator workstream
// (GameSession.CityLayout.cs); this file deliberately defines none of those names.

/// <summary>Args for <c>cityView</c>: pass the <c>revision</c> of the last view you hold as <c>since</c> to get a delta.</summary>
public sealed record CityViewArgs(string CityId, long? Since = null);

/// <summary>Renderer state for one city: building visuals (full or delta) plus last month's activity.</summary>
public sealed record CityViewDto(
    string CityId,
    long Revision,
    bool Full,
    IReadOnlyList<BuildingVisualDto> Buildings,
    IReadOnlyList<int> RemovedIds,
    CityActivityDto Activity,
    LayoutRevisionDto? Layout = null);

/// <summary>EXT (plots): the city layout revision the view belongs to (TS <c>CityLayoutRefDto</c>).</summary>
public sealed record LayoutRevisionDto(int LayoutRev);

/// <summary>
/// One building as the 3D scene needs it (bridge-spec §5.5 + art §5.3).
/// <c>colorIndex</c> 0 is always the player; <c>visualRev</c> changes only when
/// something visible changes, so the renderer rebuilds meshes only then.
/// </summary>
public sealed record BuildingVisualDto(
    int Id,
    string TypeId,
    string Category,
    string SlotKind,
    int OwnerId,
    bool IsPlayer,
    string Color,
    int ColorIndex,
    int Level,
    int FootprintW,
    int FootprintH,
    PlacementDto Placement,
    string Status,
    IReadOnlyList<string> Products,
    uint VisualRev,
    ConstructionDto? Construction = null);

/// <summary>
/// Last closed month's activity for every building in the city, columnar and
/// aligned to <see cref="Ids"/> (about 20 bytes per building).
/// </summary>
public sealed record CityActivityDto(
    DateDto Month,
    IReadOnlyList<int> Ids,
    IReadOnlyList<decimal> Revenue,
    IReadOnlyList<double> UnitsSold,
    IReadOnlyList<double> ExportUnits,
    IReadOnlyList<decimal> NetIncome,
    IReadOnlyList<double?> Utilization,
    IReadOnlyList<double> TransfersIn,
    IReadOnlyList<double> TransfersOut);

/// <summary>Every city at a glance (minimap, city picker).</summary>
public sealed record WorldMapDto(IReadOnlyList<CityOverviewDto> Cities);

/// <summary>One city's overview: geography, who owns what, the player's realised share and top demand.</summary>
public sealed record CityOverviewDto(
    string CityId,
    string Name,
    long Population,
    IReadOnlyDictionary<string, double> Demographics,
    GeographyDto Geography,
    int GridW,
    int GridH,
    decimal BaseLandPrice,
    IReadOnlyList<OwnerCountDto> BuildingsByOwner,
    int PlayerBuildings,
    int TotalBuildings,
    double PlayerAvgShare,
    IReadOnlyList<ProductQtyDto> TopDemand,
    string? Climate = null,
    int? Seed = null);

/// <summary>A city's resource and terrain flags.</summary>
public sealed record GeographyDto(bool Coastal, bool Arable, bool MineralRich, bool OilRich);

/// <summary>Building count per owner.</summary>
public sealed record OwnerCountDto(int CompanyId, int Count);

/// <summary>Args for <c>supplyFlows</c>: filter to one city or one building (both null = everything).</summary>
public sealed record SupplyFlowsArgs(string? CityId = null, int? BuildingId = null);

/// <summary>Goods movements of the last closed month (trucks, ships, link arcs).</summary>
public sealed record SupplyFlowsDto(DateDto Month, IReadOnlyList<FlowDto> Flows);

/// <summary>
/// One flow: <c>transfer</c> (own building → own building, exact quantity),
/// <c>import</c> (world-market purchase; amount exact, quantity not recorded today),
/// <c>export</c> and <c>retail</c> (amount + exact quantity).
/// </summary>
public sealed record FlowDto(
    string Kind,
    string ProductId,
    int? FromBuildingId,
    int? ToBuildingId,
    string? FromCityId,
    string? ToCityId,
    double? Quantity,
    decimal? Amount);

/// <summary>Args for <c>previewBuild</c>.</summary>
public sealed record PreviewBuildArgs(string TypeId, string CityId, PlotRefDto? At = null);

/// <summary>Everything the build ghost shows: cost, affordability, geography, placement validity.</summary>
public sealed record BuildPreviewDto(
    string TypeId,
    string CityId,
    decimal ConstructionCost,
    decimal? LandCost,
    decimal TotalCost,
    decimal MonthlyOpex,
    int Capacity,
    bool Affordable,
    decimal Shortfall,
    decimal CashAfter,
    double? RunwayMonthsAfter,
    bool GeographyOk,
    IReadOnlyList<string> GeographyIssues,
    IReadOnlyList<string> EligibleProductIds,
    int FootprintW,
    int FootprintH,
    bool PlacementOk,
    string? PlacementIssue,
    PlacementDto? SuggestedPlacement,
    int? ConstructionMonths = null,
    CatchmentDto? Catchment = null,
    // E3b (plots / landMarket / constructionTime): set only under engine land rules.
    decimal? UpfrontCost = null,
    decimal? RedevelopmentCost = null,
    decimal? Deposit = null,
    decimal? MonthlyInstalment = null,
    DateDto? OpensAt = null,
    IReadOnlyList<PlacementIssueDto>? PlacementIssues = null,
    SiteDto? Site = null);

/// <summary>
/// EXT (plots): demand and competition near a plot. E3b adds the product the potential
/// refers to, the site's traffic index and the rival-count radius.
/// </summary>
public sealed record CatchmentDto(
    double Score,
    double PotentialUnitsPerMonth,
    int RivalsWithinRadius,
    string? ProductId = null,
    double? Traffic = null,
    int? RadiusPlots = null);

/// <summary>
/// EXT (constructionTime): construction progress of a building. E3b adds the schedule
/// (months, next instalment, pauses), orders still waiting for a site, and what
/// <c>cancelConstruction</c> would return now.
/// </summary>
public sealed record ConstructionDto(
    DateDto Started,
    DateDto CompletesAt,
    double Progress,
    decimal CostPaid,
    decimal CostRemaining,
    int? MonthsTotal = null,
    int? MonthsRemaining = null,
    decimal? NextInstalment = null,
    bool? AwaitingSite = null,
    int? PausedMonths = null,
    decimal? CancelRefund = null);
