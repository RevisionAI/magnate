using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// News, activity feed, history, stats (bridge-spec §5.10), goals and advisor (§5.11).

/// <summary>Args for <c>news</c>; pass <c>sinceSeq</c> to fetch only newer entries.</summary>
public sealed record NewsArgs(long? SinceSeq = null, int Limit = 50);

/// <summary>World news plus the price effects currently in flight.</summary>
public sealed record NewsDto(IReadOnlyList<NewsEntryDto> Entries, long LatestSeq, IReadOnlyList<PriceEffectDto> ActivePriceEffects);

/// <summary>One news item; <c>seq</c> is its index in the engine news log.</summary>
public sealed record NewsEntryDto(
    long Seq,
    DateDto Date,
    string EventId,
    string Headline,
    string Description,
    string Severity,
    IReadOnlyList<EffectDto> Effects);

/// <summary>One mechanical effect of a news event: <c>priceMultiplier</c> | <c>brandShift</c> | <c>headline</c>.</summary>
public sealed record EffectDto(string Kind, string? ProductId, string? CityId, decimal? Multiplier, int? Months, int? Delta);

/// <summary>An in-flight world-price multiplier.</summary>
public sealed record PriceEffectDto(
    string ProductId,
    decimal Multiplier,
    int RemainingMonths,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal BasePrice,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal EffectivePrice);

/// <summary>Args for <c>activityFeed</c>.</summary>
public sealed record FeedArgs(long? SinceSeq = null, int Limit = 200, IReadOnlyList<string>? Kinds = null, string? Search = null);

/// <summary>A page of the persisted activity feed (newest last).</summary>
public sealed record FeedDto(IReadOnlyList<GameEventDto> Events, long LatestSeq);

/// <summary>
/// Args for <c>history</c>: series names are <c>cash</c>, <c>revenue</c>, <c>netIncome</c>,
/// <c>corporateValue</c>, <c>totalAssets</c>, <c>equity</c>, <c>inventoryValue</c>,
/// <c>buildingValue</c>, <c>buildings</c>, <c>topBrand</c>, <c>topTech</c>.
/// </summary>
public sealed record HistoryArgs(IReadOnlyList<string> Series, IReadOnlyList<int>? CompanyIds = null, DateDto? From = null, DateDto? To = null);

/// <summary>Dense monthly series per company.</summary>
public sealed record HistoryDto(DateDto Start, int Months, IReadOnlyList<CompanySeriesDto> Companies);

/// <summary>One company's series; <c>missingBefore</c> marks series that start late (legacy loads).</summary>
public sealed record CompanySeriesDto(
    int CompanyId,
    IReadOnlyDictionary<string, IReadOnlyList<decimal?>> Series,
    IReadOnlyDictionary<string, DateDto> MissingBefore);

/// <summary>The statistics dashboard.</summary>
public sealed record StatsDashboardDto(
    decimal Cash,
    decimal CorporateValue,
    decimal TotalAssets,
    decimal NetIncomeThisMonth,
    SeriesDto CorporateValueSeries,
    ShareHeatmapDto ShareHeatmap,
    IReadOnlyList<TechBoardDto> RdLeaderboard,
    IReadOnlyList<BrandBoardDto> BrandTop,
    IReadOnlyList<BuildingMoneyDto> TopByRevenue,
    IReadOnlyList<BuildingMoneyDto> TopByOpex);

/// <summary>Player realised share per (city, product); <c>null</c> where there is no market.</summary>
public sealed record ShareHeatmapDto(IReadOnlyList<string> CityIds, IReadOnlyList<string> ProductIds, IReadOnlyList<IReadOnlyList<double?>> Share);

/// <summary>Tech levels per company on one product.</summary>
public sealed record TechBoardDto(string ProductId, int MaxTech, IReadOnlyList<CompanyValueDto> Rows);

/// <summary>Top brands on one product.</summary>
public sealed record BrandBoardDto(string ProductId, IReadOnlyList<BrandRowDto> Rows);

/// <summary>A company's brand in a city.</summary>
public sealed record BrandRowDto(int CompanyId, string CityId, double Brand);

/// <summary>A (company, value) pair.</summary>
public sealed record CompanyValueDto(int CompanyId, double Value);

/// <summary>A building with a money figure.</summary>
public sealed record BuildingMoneyDto(int BuildingId, string TypeId, string CityId, decimal Amount);

/// <summary>
/// Live goal state. <c>achieved</c> is "met right now"; <c>achievedAt</c> is the
/// latch (D11: goals are reach-once). <c>description</c>/<c>detail</c> are
/// deprecated in the HUD (bridge-spec §5.3 size budget): a later release omits them
/// there and clients join the text from <c>listScenarios[].goalDetails</c> on <c>id</c>;
/// <c>goals</c> always returns them. <c>current</c>/<c>target</c> keep 4 decimals so
/// ratio goals (market share) stay exact to 0.01%.
/// </summary>
public sealed record GoalDto(
    string? Description,
    bool Achieved,
    double Progress,
    string? Detail,
    string Id,
    int Index,
    string Kind,
    string Metric,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Current,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Target,
    string Unit,
    DateDto? AchievedAt,
    string? ProductId,
    string? CityId,
    string? Category,
    string Mode = "reachOnce");

/// <summary>Goals, outcome and deadline.</summary>
public sealed record GoalsDto(IReadOnlyList<GoalDto> Goals, OutcomeDto Outcome, DateDto? Deadline, int? MonthsRemaining, string? NextGoalId);

/// <summary>The advisor: one priority and ranked hints.</summary>
public sealed record AdvisorDto(AdvisorItemDto Priority, IReadOnlyList<AdvisorItemDto> Hints);

/// <summary>
/// One advisor item. The client localises from <c>code</c> + <c>params</c>
/// (strings, ready to interpolate); <c>message</c> is the English fallback.
/// <c>impactPerMonth</c> estimates the $/month at stake; <c>fix</c> is a one-click bridge call.
/// </summary>
public sealed record AdvisorItemDto(
    string Code,
    string Severity,
    string Message,
    IReadOnlyDictionary<string, string> Params,
    IReadOnlyList<int>? BuildingIds = null,
    string? CityId = null,
    string? ProductId = null,
    decimal? ImpactPerMonth = null,
    AdvisorFixDto? Fix = null);

/// <summary>A one-click fix: call <c>method</c> with <c>argsJson</c>.</summary>
public sealed record AdvisorFixDto(string Method, string ArgsJson, string Label);
