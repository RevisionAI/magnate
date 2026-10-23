using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// Session, scenarios, catalog, HUD and time (bridge-spec §5.3–§5.4, §7.1).

/// <summary>Args for <c>init</c>.</summary>
public sealed record InitArgs(string ContentRoot, string? ScenarioDir = null);

/// <summary>Result of <c>init</c>.</summary>
public sealed record InitResult(
    string EngineVersion,
    int ProtocolVersion,
    int Products,
    int BuildingTypes,
    int Cities,
    int Scenarios,
    IReadOnlyList<string> Methods,
    FeatureFlagsDto Features,
    string ContentHash,
    int SaveFormatVersion,
    int EngineSchemaVersion);

/// <summary>Engine feature switches (bridge-spec §8). EXT methods return <c>feature_unavailable</c> while off.</summary>
public sealed record FeatureFlagsDto(
    bool Plots = false,
    bool LandMarket = false,
    bool ConstructionTime = false,
    bool Demolish = false,
    bool Loans = false,
    bool StockMarket = false,
    bool Macro = false,
    bool ProductionLog = false,
    bool DomainEvents = false,
    bool DemandModel = false);

/// <summary>Result of <c>ping</c>.</summary>
public sealed record PingResult(string Pong, long Revision, bool HasGame);

/// <summary>Scenario card data for the scenario-select screen.</summary>
public sealed record ScenarioSummaryDto(
    string Id,
    string Name,
    string Description,
    DateDto StartDate,
    DateDto? EndDate,
    string PlayerName,
    decimal StartingCash,
    IReadOnlyList<ScenarioCompetitorDto> Competitors,
    IReadOnlyList<string> Goals,
    int Difficulty,
    string DifficultyBucket,
    int? DurationMonths,
    bool IsSandbox,
    IReadOnlyList<ScenarioGoalDto> GoalDetails,
    int SortKey,
    string Briefing);

/// <summary>An AI rival on a scenario card; <c>strategy</c> is one of the four canonical names.</summary>
public sealed record ScenarioCompetitorDto(string Name, decimal StartingCash, string Strategy);

/// <summary>A scenario goal's static definition (joined to live <see cref="GoalDto"/> by <c>id</c>).</summary>
public sealed record ScenarioGoalDto(
    string Id,
    int Index,
    string Kind,
    string Metric,
    string Description,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Target,
    string Unit,
    string? ProductId,
    string? CityId,
    string? Category,
    string Mode);

/// <summary>Static content catalog (fetch once per session).</summary>
public sealed record CatalogDto(
    IReadOnlyList<ProductDto> Products,
    IReadOnlyList<BuildingTypeDto> BuildingTypes,
    IReadOnlyList<CityDto> Cities,
    IReadOnlyList<AdChannelDto> AdChannels,
    SimConstantsDto Constants,
    IReadOnlyList<EventDefDto> Events,
    IReadOnlyList<StarterPlanDto> StarterPlans,
    string ContentHash);

/// <summary>A product definition plus derived planning numbers.</summary>
public sealed record ProductDto(
    string Id,
    string Name,
    string Tier,
    string Category,
    string Unit,
    double BaseWorldMarketPrice,
    int MaxTechLevel,
    RecipeDto? Recipe,
    string? ExtractedAt,
    double PriceElasticity,
    BracketValuesDto BaseDemandPerCapita,
    BracketValuesDto? ReservationPrice,
    double? YieldPerSlotPerMonth,
    double? OutputPerSlotPerMonth,
    IReadOnlyList<string> FeedsInto,
    bool AffectsRetailDemand);

/// <summary>A production recipe (per cycle; a slot runs 200 cycles a month).</summary>
public sealed record RecipeDto(double OutputQuantity, IReadOnlyList<RecipeInputDto> Inputs, double LaborUnits = 0);

/// <summary>One recipe input (per cycle and per slot-month).</summary>
public sealed record RecipeInputDto(string ProductId, double Quantity, double PerSlotPerMonth = 0);

/// <summary>A value per income bracket; a missing bracket is omitted.</summary>
public sealed record BracketValuesDto(double? Low, double? Middle, double? High);

/// <summary>A building type definition plus derived slot rules and level ladder.</summary>
public sealed record BuildingTypeDto(
    string Id,
    string Name,
    string Category,
    decimal ConstructionCost,
    decimal MonthlyOperatingCost,
    int FootprintWidth,
    int FootprintHeight,
    int MaxUnits,
    bool Retail,
    IReadOnlyList<string> ProducibleTiers,
    int MaxLevel,
    string SlotKind,
    IReadOnlyList<string> EligibleProductIds,
    IReadOnlyList<LevelDto> Levels,
    GeographyReqDto? Geography,
    HeadcountDto? Headcount,
    string BuildMenuGroup,
    string? MediaChannel,
    decimal? MediaBonus);

/// <summary>One rung of a building's level ladder (non-upgradeable types get one synthetic level).</summary>
public sealed record LevelDto(int Level, int Capacity, decimal MonthlyOperatingCost, decimal UpgradeCost);

/// <summary>A building type's geography requirement (only the required flags are present).</summary>
public sealed record GeographyReqDto(bool? Coastal, bool? Arable, bool? MineralRich, bool? OilRich);

/// <summary>Target headcount range per configured slot.</summary>
public sealed record HeadcountDto(int Min, int Max);

/// <summary>A city definition plus potential demand per finished product (units/month).</summary>
public sealed record CityDto(
    string Id,
    string Name,
    long Population,
    int GridWidth,
    int GridHeight,
    bool Coastal,
    bool Arable,
    bool MineralRich,
    bool OilRich,
    decimal BaseLandPrice,
    IReadOnlyDictionary<string, double> Demographics,
    IReadOnlyDictionary<string, double> PotentialDemand);

/// <summary>An advertising channel: cost per brand point and the media building that boosts it.</summary>
public sealed record AdChannelDto(string Id, decimal CostPerPoint, string? MediaBuildingTypeId, decimal OwnershipBonus);

/// <summary>Simulation constants the UI needs for previews and explanations.</summary>
public sealed record SimConstantsDto(
    int CyclesPerSlotPerMonth,
    decimal InterCityShippingFraction,
    double WorldMarketQuality,
    double ExtractionQuality,
    int BaseTechLevel,
    double ResearchPointsPerSlotPerMonth,
    double BaseResearchThreshold,
    int PatentDurationMonths,
    decimal PatentRoyaltyRate,
    double BrandDecayRate,
    decimal EventBaseProbabilityPerMonth,
    int BankruptcyGraceMonths,
    decimal DefaultLowCashThreshold);

/// <summary>A random-event definition (for the encyclopedia and news effects).</summary>
public sealed record EventDefDto(string Id, string Name, string Description, string Severity);

/// <summary>A one-click starter build (construct + first slot) in the most populous city.</summary>
public sealed record StarterPlanDto(
    string Id,
    string Label,
    string TypeId,
    string ProductId,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? Price,
    double? Target,
    string CitySelector);

/// <summary>Args for <c>newGame</c>.</summary>
public sealed record NewGameArgs(
    string ScenarioId,
    int? Seed = null,
    string? Autopilot = null,
    string? CompanyName = null,
    CustomGameDto? Custom = null,
    string? CreatedAtIso = null);

/// <summary>A custom game definition (required iff <c>scenarioId == "custom"</c>).</summary>
public sealed record CustomGameDto(
    DateDto StartDate,
    DateDto? EndDate,
    decimal PlayerCash,
    IReadOnlyList<ScenarioCompetitorDto> Competitors);

/// <summary>The HUD: compact, cheap state returned by <c>snapshot</c> and as <c>hud</c> on mutating envelopes.</summary>
public sealed record SnapshotDto(
    DateDto Date,
    int MonthIndex,
    int PlayerId,
    IReadOnlyList<CompanySummaryDto> Companies,
    ActiveScenarioDto? Scenario,
    long Revision,
    string GameId,
    DateDto StartDate,
    int ElapsedMonths,
    PlayerHudDto Player,
    OutcomeDto Outcome,
    AlertsDto Alerts,
    long NewsSeq,
    long FeedSeq,
    string? Autopilot,
    bool Faulted,
    MacroHudDto? Macro = null);

/// <summary>One company's headline numbers (all companies are visible, CapLab-style).</summary>
public sealed record CompanySummaryDto(
    int Id,
    string Name,
    bool IsPlayer,
    decimal Cash,
    decimal TotalAssets,
    decimal Equity,
    decimal RevenueThisMonth,
    decimal NetIncomeThisMonth,
    int BuildingCount,
    string Color,
    decimal CorporateValue,
    decimal NetIncomeLast12,
    int ColorIndex,
    string? AiStrategy,
    decimal? MarketCap = null,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? SharePrice = null);

/// <summary>The active scenario and live goal progress.</summary>
public sealed record ActiveScenarioDto(
    string Id,
    string Name,
    DateDto? EndDate,
    IReadOnlyList<GoalDto> Goals,
    int? MonthsRemaining,
    int GoalsAchieved,
    string? NextGoalId);

/// <summary>The player's HUD numbers.</summary>
public sealed record PlayerHudDto(
    int CompanyId,
    string Name,
    decimal Cash,
    decimal CashFlowThisMonth,
    decimal RevenueThisMonth,
    decimal NetIncomeThisMonth,
    decimal NetIncomeLast12,
    decimal TotalAssets,
    decimal Equity,
    decimal CorporateValue,
    int Buildings,
    int IdleBuildings,
    int ActiveCampaigns,
    double? CashRunwayMonths,
    string? CreditRating = null);

/// <summary>Scenario outcome: <c>playing</c> | <c>won</c> | <c>lost</c>; reason <c>allGoals</c> | <c>bankruptcy</c> | <c>deadline</c>.</summary>
public sealed record OutcomeDto(string Status, string? Reason = null, DateDto? At = null);

/// <summary>Standing alerts for the HUD (low cash, insolvency countdown).</summary>
public sealed record AlertsDto(bool LowCash, int NegativeCashMonths, int? BankruptcyInMonths, int BankruptcyGraceMonths);

/// <summary>EXT (macro): HUD macro chip. Reserved; omitted while <c>features.macro</c> is off.</summary>
public sealed record MacroHudDto(string Phase, double InterestRate);

/// <summary>Session settings (persisted in the save).</summary>
public sealed record SettingsDto(decimal LowCashThreshold, int AutosaveEveryMonths, int BankruptcyGraceMonths, int FeedCapacity);

/// <summary>Args for <c>updateSettings</c> (null = unchanged).</summary>
public sealed record UpdateSettingsArgs(decimal? LowCashThreshold = null, int? AutosaveEveryMonths = null);

/// <summary>Args for <c>setAutopilot</c>; <c>strategy: null</c> turns the autopilot off.</summary>
public sealed record AutopilotArgs(string? Strategy);

/// <summary>Args for <c>advance</c>.</summary>
public sealed record AdvanceArgs(
    int Months = 1,
    IReadOnlyList<string>? StopOn = null,
    string? ViewCityId = null,
    long? ViewSince = null);

/// <summary>Result of <c>advance</c>.</summary>
public sealed record TickResultDto(
    int Months,
    IReadOnlyList<GameEventDto> Events,
    SnapshotDto Snapshot,
    IReadOnlyList<MonthCloseDto> MonthSummaries,
    IReadOnlyList<BuildingActivityDto> PlayerActivity,
    CityViewDto? CityView = null,
    string? StoppedBy = null,
    bool AutosaveDue = false,
    double EngineMs = 0,
    double BridgeMs = 0);

/// <summary>The player's numbers for one closed month.</summary>
public sealed record MonthCloseDto(
    DateDto Month,
    decimal Revenue,
    decimal Cogs,
    decimal Opex,
    decimal NetIncome,
    decimal CashStart,
    decimal CashEnd,
    double UnitsSold,
    double ExportUnits);

/// <summary>One player building's activity in the last closed month (drives "+$X" world popups).</summary>
public sealed record BuildingActivityDto(int BuildingId, string CityId, decimal Revenue, double UnitsSold, double ExportUnits, decimal NetIncome);

/// <summary>
/// Something noteworthy that happened (tick or command). Flat and source-gen
/// friendly: which optional fields are set depends on <see cref="Kind"/>
/// (bridge-spec §7.2). Priority: 0 ambient, 1 feed, 2 toast-worthy, 3 interrupt.
/// </summary>
public sealed record GameEventDto(
    string Kind,
    string Severity,
    string Message,
    decimal? Amount = null,
    int? BuildingId = null,
    string? CityId = null,
    string? ProductId = null,
    long Seq = 0,
    DateDto? Month = null,
    int Priority = 1,
    int? CompanyId = null,
    bool? IsPlayer = null,
    double? Units = null,
    int? Level = null,
    int? MaxLevel = null,
    string? TypeId = null,
    string? GoalId = null,
    long? NewsSeq = null,
    string? Reason = null,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? OldValue = null,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? NewValue = null,
    decimal? Threshold = null,
    int? Months = null,
    PlacementDto? Placement = null);
