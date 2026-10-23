using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// Marketing (§5.6), research and patents (§5.7), market intelligence (§5.9).

/// <summary>Args for <c>previewAdCampaign</c> / <c>setAdCampaign</c> (budget 0 cancels).</summary>
public sealed record AdCampaignArgs(string ProductId, string CityId, string Channel, decimal MonthlyBudget);

/// <summary>Args naming one campaign.</summary>
public sealed record AdKeyArgs(string ProductId, string CityId, string Channel);

/// <summary>One of the player's campaigns with its brand trajectory.</summary>
public sealed record AdCampaignDto(
    string ProductId,
    string CityId,
    string Channel,
    decimal MonthlyBudget,
    double Brand,
    decimal MediaBonus,
    double ProjectedBrand,
    bool HasRetailPresence);

/// <summary>The player's campaigns.</summary>
public sealed record AdCampaignsDto(IReadOnlyList<AdCampaignDto> Campaigns, decimal TotalMonthlySpend, double BrandDecayRate);

/// <summary>What a campaign would do next month (exactly the engine's formula).</summary>
public sealed record AdPreviewDto(
    double CurrentBrand,
    double ProjectedBrand,
    double Lift,
    decimal CostPerPoint,
    decimal MediaBonus,
    decimal EffectiveBudget,
    double Saturation,
    decimal ExistingBudget,
    bool HasRetailPresence);

/// <summary>Result of <c>cancelAdCampaign</c>.</summary>
public sealed record CancelResultDto(bool Cancelled);

/// <summary>The player's research tree (every product).</summary>
public sealed record ResearchTreeDto(IReadOnlyList<ResearchNodeDto> Nodes, double PointsPerSlotPerMonth, double BaseThreshold);

/// <summary>One product's research state for the player.</summary>
public sealed record ResearchNodeDto(
    string ProductId,
    string Name,
    string Tier,
    int Tech,
    int MaxTech,
    double Progress,
    double Threshold,
    int ResearchingSlots,
    double PointsPerMonth,
    int? EtaMonths,
    int? EtaToMaxMonths,
    bool Blocked,
    PatentRefDto? Patent,
    RivalTechDto? BestRival,
    IReadOnlyList<string> Inputs,
    IReadOnlyList<string> FeedsInto,
    bool AffectsRetailDemand);

/// <summary>An active patent on a product.</summary>
public sealed record PatentRefDto(int HolderId, bool Mine, DateDto ExpiresAt, int MonthsRemaining, bool LicensedToMe);

/// <summary>The most advanced rival on a product.</summary>
public sealed record RivalTechDto(int CompanyId, string Name, int Tech);

/// <summary>Patents held by the player and by rivals.</summary>
public sealed record PatentsDto(IReadOnlyList<MyPatentDto> Mine, IReadOnlyList<RivalPatentDto> Rivals, decimal RoyaltyRate, int DurationMonths);

/// <summary>A patent the player holds: licensees, candidates and royalties earned.</summary>
public sealed record MyPatentDto(
    string ProductId,
    DateDto ExpiresAt,
    int MonthsRemaining,
    IReadOnlyList<CompanyRefDto> Licensees,
    IReadOnlyList<CompanyRefDto> Candidates,
    decimal RoyaltiesLast12);

/// <summary>A patent a rival holds.</summary>
public sealed record RivalPatentDto(
    int HolderId,
    string HolderName,
    string ProductId,
    DateDto ExpiresAt,
    int MonthsRemaining,
    bool LicensedToMe,
    bool BlocksMyResearch);

/// <summary>Args for <c>grantLicense</c> / <c>revokeLicense</c> (the player is the holder).</summary>
public sealed record LicenseArgs(int LicenseeId, string ProductId);

/// <summary>Args for <c>marketIntel</c>; <c>sort</c> is <c>share</c> | <c>price</c> | <c>city</c> | <c>demand</c>.</summary>
public sealed record MarketIntelArgs(
    string? CityId = null,
    string? ProductId = null,
    bool PlayerOnly = false,
    bool CompetitorsOnly = false,
    bool SignificantOnly = false,
    string Sort = "share");

/// <summary>The market grid (one row per city × finished product).</summary>
public sealed record MarketIntelDto(IReadOnlyList<MarketRowDto> Rows);

/// <summary>One market: demand, who sells, the player's model and realised shares.</summary>
public sealed record MarketRowDto(
    string CityId,
    string CityName,
    string ProductId,
    string ProductName,
    double PotentialDemand,
    int RetailerCount,
    bool PlayerPresent,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? PlayerPrice,
    double PlayerModelShare,
    double? PlayerRealisedShare,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? CheapestRivalPrice,
    CompanyShareDto? TopRival,
    int RivalCount,
    double? IncumbentShare = null);

/// <summary>A company's share of a market.</summary>
public sealed record CompanyShareDto(int CompanyId, string Name, double Share);

/// <summary>Args naming one market.</summary>
public sealed record MarketKeyArgs(string CityId, string ProductId);

/// <summary>One market in depth: per-bracket demand, every retailer, share history.</summary>
public sealed record MarketDetailDto(
    string CityId,
    string ProductId,
    double PotentialDemand,
    double Elasticity,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal BaseWorldPrice,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectiveWorldPrice,
    IReadOnlyList<BracketDemandDto> Brackets,
    IReadOnlyList<RetailerRowDto> Retailers,
    SeriesDto PlayerRealisedShareHistory,
    double EngineGoalShare,
    string ModelSource,
    IncumbentDto? Incumbent = null);

/// <summary>
/// The permanent local competition of a market (engine demand model only, econ-audit §4.2): the
/// "white slice" of the market. <c>ModelShare</c> is its share of category demand now;
/// <c>LastMonthUnits</c> what it sold last month.
/// </summary>
public sealed record IncumbentDto(
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price,
    double Mass,
    double ModelUnits,
    double ModelShare,
    double? LastMonthUnits);

/// <summary>One income bracket's demand and price ceiling.</summary>
public sealed record BracketDemandDto(
    string Bracket,
    double Population,
    double PerCapita,
    double Demand,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? ReservationPrice,
    int EligibleRetailers);

/// <summary>One retail slot competing in the market.</summary>
public sealed record RetailerRowDto(
    int BuildingId,
    int SlotIndex,
    int OwnerId,
    string OwnerName,
    bool IsPlayer,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price,
    double Quality,
    int Tech,
    double Brand,
    double Weight,
    double ModelDemandUnits,
    double ModelShare,
    double OnHand,
    double LastMonthUnits,
    decimal LastMonthRevenue,
    double LastMonthRealisedShare,
    IReadOnlyList<string> ExcludedBrackets);

/// <summary>Top markets to enter and to defend.</summary>
public sealed record MarketOpportunitiesDto(IReadOnlyList<EnterOpportunityDto> Enter, IReadOnlyList<DefendPressureDto> Defend);

/// <summary>A market the player is not in yet.</summary>
public sealed record EnterOpportunityDto(
    string CityId,
    string ProductId,
    double PotentialDemand,
    int RivalCount,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? CheapestRivalPrice,
    double Score);

/// <summary>A market where a rival out-sells the player.</summary>
public sealed record DefendPressureDto(string CityId, string ProductId, double PlayerShare, double TopRivalShare, string TopRivalName, double Score);

/// <summary>A price recommendation for one retail slot, with expected units at five price points.</summary>
public sealed record PriceSuggestionDto(
    int BuildingId,
    int SlotIndex,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal UnitCost,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectiveWorldPrice,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? RivalMin,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? RivalMedian,
    IReadOnlyList<CeilingDto> Ceilings,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Suggested,
    IReadOnlyList<PricePointDto> ExpectedUnitsAt,
    string ModelSource);

/// <summary>A bracket's reservation price (selling above it loses that bracket).</summary>
public sealed record CeilingDto(string Bracket, [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price);

/// <summary>The model's forecast at one candidate price.</summary>
public sealed record PricePointDto(
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price,
    double Units,
    decimal Revenue,
    decimal GrossProfit);
