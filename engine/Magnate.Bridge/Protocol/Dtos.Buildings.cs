using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// Buildings: lists, inspector detail and commands (bridge-spec §5.5).

/// <summary>Args for <c>buildings</c> (all null = every building of every owner, by id).</summary>
public sealed record BuildingsArgs(string? CityId = null, int? OwnerId = null, string? Sort = null);

/// <summary>A building row for Manage-style tables and the scene's building list.</summary>
public sealed record BuildingSummaryDto(
    int Id,
    string TypeId,
    string Category,
    int OwnerId,
    string CityId,
    int Level,
    int ConfiguredSlots,
    int Capacity,
    string Name,
    string SlotKind,
    string Status,
    IReadOnlyList<string> Products,
    decimal MonthlyOpex,
    decimal CashFlowThisMonth,
    decimal NetIncomeThisMonth,
    IReadOnlyList<ProductQtyDto> TopStock,
    PlacementDto Placement,
    int ColorIndex);

/// <summary>Args naming one building.</summary>
public sealed record BuildingRefArgs(int BuildingId);

/// <summary>Everything the building inspector shows.</summary>
public sealed record BuildingDetailDto(
    int Id,
    string TypeId,
    string TypeName,
    string Category,
    string SlotKind,
    int OwnerId,
    string OwnerName,
    bool IsPlayer,
    string CityId,
    string CityName,
    int Level,
    int MaxLevel,
    int Capacity,
    int SlotsUsed,
    int NextFreeSlotIndex,
    decimal MonthlyOpex,
    decimal ConstructionCost,
    decimal BookValue,
    DateDto? OpenedAt,
    bool AutoExport,
    bool AutoExportApplies,
    UpgradeOptionDto? Upgrade,
    WorkforceDto? Workforce,
    IReadOnlyList<SlotDetailDto> Slots,
    IReadOnlyList<InventoryRowDto> Inventory,
    InventoryTotalsDto InventoryTotals,
    BuildingPnlDto Pnl,
    SupplyDto Supply,
    BuildingActionsDto Actions,
    PlacementDto Placement,
    ConstructionDto? Construction = null,
    BookValueDto? Book = null);

/// <summary>
/// What <see cref="BuildingDetailDto.BookValue"/> is made of (E2 asset register, E3b land):
/// capitalised structure and equipment (construction plus upgrades), less accumulated
/// depreciation, plus land at cost and construction in progress.
/// </summary>
public sealed record BookValueDto(
    decimal GrossPpe,
    decimal AccumulatedDepreciation,
    decimal Land,
    decimal ConstructionInProgress,
    decimal UpgradeCost);

/// <summary>The next upgrade rung, when there is one.</summary>
public sealed record UpgradeOptionDto(int ToLevel, decimal Cost, int Capacity, decimal MonthlyOpex, bool Affordable);

/// <summary>Estimated workforce (target headcount × configured slots).</summary>
public sealed record WorkforceDto(int PerSlotMin, int PerSlotMax, int EstimatedMin, int EstimatedMax);

/// <summary>One configured slot; exactly one of the kind-specific blocks is set.</summary>
public sealed record SlotDetailDto(
    int Index,
    string Kind,
    string ProductId,
    string ProductName,
    string Tier,
    RetailSlotDto? Retail = null,
    WarehouseSlotDto? Warehouse = null,
    ProductionSlotDto? Production = null,
    ExtractionSlotDto? Extraction = null,
    ResearchSlotDto? Research = null,
    string? ReplacedProductId = null);

/// <summary>A retail line: price, stock and last month's sales against the model forecast.</summary>
public sealed record RetailSlotDto(
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price,
    double RestockTarget,
    double OnHand,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal UnitCost,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectiveWorldPrice,
    double LastMonthUnits,
    decimal LastMonthRevenue,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? LastMonthAvgPrice,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? CheapestRivalPrice,
    int RivalCount,
    double ModelDemandUnits,
    bool BelowCost,
    double? LastMonthDemand = null,
    double? LastMonthLostUnits = null);

/// <summary>A warehouse line.</summary>
public sealed record WarehouseSlotDto(
    double TargetStock,
    double OnHand,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal UnitCost);

/// <summary>A production line: recipe throughput, predicted input sources, approximate utilisation.</summary>
public sealed record ProductionSlotDto(
    int CyclesPerMonth,
    double OutputPerMonth,
    IReadOnlyList<InputSupplyDto> Inputs,
    double? LastMonthOutput,
    double? Utilization,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? UnitCost,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectiveWorldPrice,
    bool ExportsAtLoss);

/// <summary>
/// One recipe input and where the engine will source it next month:
/// <c>own</c> (same city), <c>ownOtherCity</c> (adds 10% shipping) or <c>worldMarket</c>.
/// </summary>
public sealed record InputSupplyDto(
    string ProductId,
    double PerMonth,
    double OnHand,
    string Source,
    int? SourceBuildingId,
    string? SourceCityId,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectiveWorldPrice);

/// <summary>An extraction line.</summary>
public sealed record ExtractionSlotDto(double YieldPerMonth, double OnHand, double Quality);

/// <summary>A research line (company-wide progress on the product).</summary>
public sealed record ResearchSlotDto(
    int Tech,
    int MaxTech,
    double Progress,
    double Threshold,
    double CompanyPointsPerMonth,
    int? EtaMonths,
    bool Blocked,
    int? PatentHolderId);

/// <summary>One inventory line (weighted-average cost).</summary>
public sealed record InventoryRowDto(
    string ProductId,
    string Name,
    string Tier,
    double Quantity,
    decimal Cost,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal UnitCost,
    double Quality);

/// <summary>Inventory totals per tier.</summary>
public sealed record InventoryTotalsDto(TierTotalDto Raw, TierTotalDto Intermediate, TierTotalDto Finished);

/// <summary>Units and cost basis of one tier.</summary>
public sealed record TierTotalDto(double Units, decimal Cost);

/// <summary>Per-building accrual P&amp;L windows (advertising is company-scoped and excluded).</summary>
public sealed record BuildingPnlDto(PnlWindowDto ThisMonth, PnlWindowDto Last12, PnlWindowDto SinceOpen, SeriesDto MonthlyNetIncome);

/// <summary>One P&amp;L window.</summary>
public sealed record PnlWindowDto(DateDto From, DateDto To, decimal Revenue, decimal Cogs, decimal GrossProfit, decimal Opex, decimal NetIncome);

/// <summary>Last closed month's goods in and out of the building.</summary>
public sealed record SupplyDto(IReadOnlyList<SupplyLinkDto> Sources, IReadOnlyList<SupplyLinkDto> Destinations);

/// <summary>One supply link: <c>transfer</c> | <c>marketPurchase</c> | <c>export</c> | <c>retailSale</c>.</summary>
public sealed record SupplyLinkDto(
    string Kind,
    string ProductId,
    double? Quantity,
    decimal? Amount,
    int? CounterpartyBuildingId,
    string? CounterpartyCityId);

/// <summary>What the player may do with the building right now.</summary>
public sealed record BuildingActionsDto(
    bool CanUpgrade,
    bool CanAddSlot,
    bool CanConfigure,
    bool CanToggleAutoExport,
    bool CanDemolish,
    IReadOnlyList<string> EligibleProductIds);

/// <summary>Args for <c>construct</c>: optional first slot (atomic) and optional plot.</summary>
public sealed record ConstructArgs(string TypeId, string CityId, SlotConfigArgs? InitialSlot = null, PlotRefDto? At = null);

/// <summary>A slot configuration (kind-specific fields: price/restockTarget for retail, targetStock for warehouses).</summary>
public sealed record SlotConfigArgs(
    string ProductId,
    int? SlotIndex = null,
    decimal? Price = null,
    double? RestockTarget = null,
    double? TargetStock = null);

/// <summary>Args for <c>buildStarterPlan</c>.</summary>
public sealed record StarterPlanArgs(string PlanId);

/// <summary>Args for <c>configureSlot</c>.</summary>
public sealed record ConfigureSlotArgs(
    int BuildingId,
    int SlotIndex,
    string ProductId,
    decimal? Price = null,
    double? RestockTarget = null,
    double? TargetStock = null);

/// <summary>Args naming one slot of one building.</summary>
public sealed record SlotRefArgs(int BuildingId, int SlotIndex);

/// <summary>Args for <c>setRetailPrice</c>.</summary>
public sealed record SetRetailPriceArgs(int BuildingId, int SlotIndex, decimal Price);

/// <summary>Args for <c>setRestockTarget</c>.</summary>
public sealed record SetRestockTargetArgs(int BuildingId, int SlotIndex, double RestockTarget);

/// <summary>Args for <c>setWarehouseTarget</c>.</summary>
public sealed record SetWarehouseTargetArgs(int BuildingId, int SlotIndex, double TargetStock);

/// <summary>Args for <c>setAutoExport</c>.</summary>
public sealed record SetAutoExportArgs(int BuildingId, bool Enabled);

/// <summary>Result of <c>upgradeBuilding</c>.</summary>
public sealed record UpgradeResultDto(int BuildingId, int Level, int Capacity, decimal MonthlyOpex, decimal Cost);

/// <summary>
/// EXT (demolish): result (or preview) of <c>demolishBuilding</c> / <c>sellBuilding</c> /
/// <c>previewDisposal</c>. <c>bookValue</c> is everything derecognised (PP&amp;E at net book value +
/// land + construction in progress + stock at cost) and <c>gainOrLoss = proceeds − bookValue</c>
/// (booked below the operating line). E2 adds <c>kind</c> (<c>sale</c> | <c>demolition</c> |
/// <c>liquidation</c>) and the breakdown.
/// </summary>
public sealed record DisposalResultDto(
    int BuildingId,
    decimal Proceeds,
    decimal BookValue,
    decimal GainOrLoss,
    string? Kind = null,
    decimal? Ppe = null,
    decimal? Land = null,
    decimal? ConstructionInProgress = null,
    decimal? Inventory = null);

/// <summary>Args for <c>previewDisposal</c> (EXT demolish): <c>kind</c> is <c>sale</c> (default) or <c>demolition</c>.</summary>
public sealed record DisposalPreviewArgs(int BuildingId, string? Kind = null);
