using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// Finance reports (bridge-spec §5.8) and the monthly report (§5.10).

/// <summary>Args for period reports; <c>companyId</c> defaults to the player.</summary>
public sealed record CompanyPeriodArgs(PeriodArgs? Period = null, int? CompanyId = null, bool ByMonth = false);

/// <summary>Accrual income statement over a period.</summary>
public sealed record IncomeStatementDto(
    PeriodDto Period,
    int CompanyId,
    decimal Revenue,
    decimal ProductSales,
    decimal ExportSales,
    decimal RoyaltyIncome,
    decimal Cogs,
    decimal GrossProfit,
    decimal Opex,
    decimal OperatingCosts,
    decimal Advertising,
    decimal RoyaltyExpense,
    decimal NetIncome,
    double? GrossMargin,
    double? NetMargin,
    IReadOnlyList<IncomeMonthDto>? Months = null,
    decimal? Depreciation = null,
    decimal? InterestExpense = null,
    decimal? IncomeTax = null,
    decimal? OtherIncome = null);

/// <summary>One month of an income statement.</summary>
public sealed record IncomeMonthDto(DateDto Month, decimal Revenue, decimal Cogs, decimal Opex, decimal NetIncome);

/// <summary>Args for <c>balanceSheet</c>.</summary>
public sealed record BalanceSheetArgs(int? CompanyId = null, bool Drilldown = false);

/// <summary>
/// Balance sheet at now (econ-audit §4.15). <c>buildingValue</c> is PP&amp;E at net book value
/// (construction + upgrades − depreciation; equal to <c>engineBuildingValue</c> now that the engine
/// capitalises upgrades); <c>drift</c> cross-checks equity against paid-in capital + net income.
/// EXT (finance, E2): <c>landValue</c>, <c>accumulatedDepreciation</c>, <c>cip</c>, <c>grossPpe</c>,
/// <c>termLoans</c>, <c>revolver</c> and the loan <c>liabilityLines</c>; null when the finance rules are off.
/// </summary>
public sealed record BalanceSheetDto(
    DateDto AsOf,
    int CompanyId,
    decimal Cash,
    decimal InventoryValue,
    decimal BuildingValue,
    decimal TotalAssets,
    decimal Liabilities,
    decimal Equity,
    decimal StartingCapital,
    decimal RetainedEarnings,
    decimal EngineBuildingValue,
    decimal Drift,
    bool BooksClose,
    IReadOnlyList<BuildingValueDto>? Buildings = null,
    IReadOnlyList<BuildingInventoryDto>? InventoryByBuilding = null,
    IReadOnlyList<LiabilityLineDto>? LiabilityLines = null,
    decimal? LandValue = null,
    decimal? AccumulatedDepreciation = null,
    decimal? Cip = null,
    decimal? GrossPpe = null,
    decimal? TermLoans = null,
    decimal? Revolver = null);

/// <summary>One building's book value.</summary>
public sealed record BuildingValueDto(int BuildingId, string TypeName, string CityId, decimal ConstructionCost, decimal UpgradeCost, decimal BookValue);

/// <summary>One building's inventory.</summary>
public sealed record BuildingInventoryDto(int BuildingId, string TypeName, string CityId, IReadOnlyList<InventoryRowDto> Rows, decimal Total);

/// <summary>EXT (loans): one liability line.</summary>
public sealed record LiabilityLineDto(string Kind, string Label, decimal Amount);

/// <summary>Cash-flow statement; <c>netChange == operating + investing + financing</c> and <c>reconciles</c> checks the ledger.</summary>
public sealed record CashFlowDto(
    PeriodDto Period,
    int CompanyId,
    decimal BeginningCash,
    CashFlowSectionDto Operating,
    CashFlowSectionDto Investing,
    CashFlowSectionDto Financing,
    decimal NetChange,
    decimal EndingCash,
    bool Reconciles);

/// <summary>One cash-flow section.</summary>
public sealed record CashFlowSectionDto(IReadOnlyList<CashFlowLineDto> Lines, decimal Net);

/// <summary>One cash-flow line (a ledger category in camelCase, or the spec's line name).</summary>
public sealed record CashFlowLineDto(string Category, decimal Amount);

/// <summary>Per-product P&amp;L over a period.</summary>
public sealed record ProductProfitabilityDto(PeriodDto Period, IReadOnlyList<ProductPnlRowDto> Rows);

/// <summary>One product's P&amp;L.</summary>
public sealed record ProductPnlRowDto(
    string ProductId,
    string Name,
    decimal Revenue,
    decimal Cogs,
    decimal GrossMargin,
    decimal Marketing,
    decimal NetMargin,
    double? NetMarginPct,
    double UnitsSold);

/// <summary>Exports over a period, with exact units (from COGS), by product and by building.</summary>
public sealed record ExportsDto(
    PeriodDto Period,
    decimal TotalRevenue,
    double TotalUnits,
    IReadOnlyList<ExportProductRowDto> ByProduct,
    IReadOnlyList<ExportBuildingRowDto> ByBuilding);

/// <summary>Exports of one product.</summary>
public sealed record ExportProductRowDto(
    string ProductId,
    decimal Revenue,
    double Units,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? AvgPrice);

/// <summary>Exports of one building.</summary>
public sealed record ExportBuildingRowDto(int BuildingId, string TypeId, string CityId, decimal Revenue, double Units);

/// <summary>Args for <c>ledger</c> (player only; newest first).</summary>
public sealed record LedgerArgs(
    PeriodArgs? Period = null,
    IReadOnlyList<string>? Categories = null,
    int? BuildingId = null,
    string? ProductId = null,
    int Offset = 0,
    int Limit = 200);

/// <summary>One page of ledger rows.</summary>
public sealed record LedgerPageDto(int Total, int Offset, IReadOnlyList<LedgerRowDto> Rows);

/// <summary>One ledger entry; <c>seq</c> is its index in the engine ledger.</summary>
public sealed record LedgerRowDto(long Seq, DateDto Date, string Category, decimal Amount, string? Memo, string? ProductId, int? BuildingId);

/// <summary>Args for <c>explainNetIncome</c> (default: last month vs this month).</summary>
public sealed record ExplainArgs(PeriodArgs? Base = null, PeriodArgs? Compare = null);

/// <summary>Net-income variance between two periods, split by driver; drivers sum exactly to the change.</summary>
public sealed record ExplainDto(PeriodDto Base, PeriodDto Compare, decimal BaseNetIncome, decimal CompareNetIncome, IReadOnlyList<VarianceLineDto> Drivers);

/// <summary>
/// One variance driver: <c>volume</c> | <c>price</c> | <c>unitCost</c> | <c>opexExisting</c> |
/// <c>opexNewBuildings</c> | <c>advertising</c> | <c>exports</c> | <c>royalties</c> | <c>other</c>.
/// </summary>
public sealed record VarianceLineDto(string Driver, string? ProductId, int? BuildingId, decimal Amount);

/// <summary>Args for <c>monthlyReport</c> (default: the last 12 months).</summary>
public sealed record MonthlyReportArgs(DateDto? From = null, DateDto? To = null);

/// <summary>Month-by-month summaries (replay view).</summary>
public sealed record MonthlyReportDto(IReadOnlyList<MonthSummaryDto> Months);

/// <summary>One month's summary for the player.</summary>
public sealed record MonthSummaryDto(
    DateDto Month,
    decimal Revenue,
    decimal Expenses,
    decimal NetCash,
    decimal Cogs,
    decimal Royalties,
    decimal NetIncome,
    double UnitsSold,
    int NewBuildings,
    int AdCampaigns,
    decimal CumulativeCash,
    decimal CumulativeNetIncome,
    IReadOnlyList<BuildingNiDto> TopBuildings,
    IReadOnlyList<NoteworthyDto> Noteworthy);

/// <summary>A building's net income in a month.</summary>
public sealed record BuildingNiDto(int BuildingId, string TypeName, string CityId, decimal NetIncome);

/// <summary>A large ledger entry (|amount| ≥ $250,000).</summary>
public sealed record NoteworthyDto(long Seq, string Category, string? ProductId, decimal Amount);
