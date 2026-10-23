using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

// Reserved extension DTOs (bridge-spec §8.2–§8.6). The methods that return them
// are registered in GameSession.Ext.cs and answer `feature_unavailable` until the
// engine feature lands and its flag turns on. City layout / plots DTOs (§8.1)
// belong to the city-generator workstream (GameSession.CityLayout.cs).

/// <summary>Args for <c>parcels</c> (EXT landMarket).</summary>
public sealed record ParcelsArgs(string CityId, string? Filter = null);

/// <summary>Args for <c>buyLand</c> / <c>sellLand</c> (EXT landMarket).</summary>
public sealed record ParcelRefArgs(string CityId, int ParcelId);

/// <summary>
/// EXT (loans, E2 finance): the player's credit standing (econ-audit §4.10) — the Bank tab of the
/// finance overlay (UX §6.10).
/// <list type="bullet">
///   <item><c>rating</c>: reported rating ("NR" while unrated, younger than the seasoning period);
///         <c>pricingRating</c> is what loans are priced at meanwhile.</item>
///   <item><c>creditLimit</c>: total debt lenders will carry; <c>newLoanMax</c>: the largest new
///         term loan now (limit − debt outstanding); <c>outstanding</c>: term loans + revolver.</item>
///   <item><c>interestRate</c>: weighted annual rate on the debt outstanding (the revolver rate when
///         there is none); rates are decimal fractions (0.072 = 7.2 %).</item>
///   <item><c>debtToEquity</c> is null when book equity ≤ 0 with debt outstanding;
///         <c>interestCoverage</c> (EBIT ÷ interest, trailing 12 months) is null without interest.</item>
///   <item>The revolving credit line draws automatically instead of negative cash and is swept down
///         when cash is plentiful (<c>revolverDrawn</c> / <c>revolverLimit</c> / <c>revolverRate</c>).</item>
///   <item><c>solvency</c>: <c>solvent</c> | <c>distress</c> | <c>bankrupt</c>; in distress
///         <c>cureMonthsLeft</c> month closes remain before bankruptcy (econ-audit §4.14).</item>
/// </list>
/// </summary>
public sealed record CreditProfileDto(
    string Rating,
    decimal CreditLimit,
    decimal Outstanding,
    double InterestRate,
    double? DebtToEquity,
    double? InterestCoverage,
    DateDto NextReview,
    string PricingRating,
    bool Seasoned,
    decimal TermDebt,
    decimal RevolverDrawn,
    decimal RevolverLimit,
    double RevolverRate,
    decimal NewLoanMax,
    int MinTermMonths,
    int MaxTermMonths,
    double PolicyRate,
    decimal EbitdaTtm,
    decimal NextPayment,
    string Solvency,
    double TaxRate,
    decimal LossCarryForward,
    decimal TaxPaidYtd,
    decimal BookEquity,
    decimal CompanyValue,
    double? NetDebtToEbitda = null,
    DateDto? LastReview = null,
    int? CureMonthsLeft = null);

/// <summary>Args for <c>loanOffers</c> (EXT loans). <c>amount</c> defaults to the largest loan available and is capped at it.</summary>
public sealed record LoanOffersArgs(decimal? Amount = null);

/// <summary>
/// EXT (loans): a term-loan offer at today's pricing. <c>offerId</c> encodes term and amount
/// (<c>"60m-500000000"</c>, cents) and is accepted by <c>takeLoan</c> while the terms still hold.
/// </summary>
public sealed record LoanOfferDto(
    string OfferId,
    decimal Amount,
    int TermMonths,
    double AnnualRate,
    decimal MonthlyPayment,
    string Rating,
    decimal TotalInterest);

/// <summary>EXT (loans): an outstanding amortising term loan (fixed rate, level monthly payments).</summary>
public sealed record LoanDto(
    int LoanId,
    decimal Principal,
    decimal Outstanding,
    double AnnualRate,
    int TermMonths,
    int MonthsRemaining,
    decimal MonthlyPayment,
    DateDto Taken,
    bool InDefault,
    int MissedPayments);

/// <summary>Args for <c>takeLoan</c> (EXT loans): an offer id, or an amount and term.</summary>
public sealed record TakeLoanArgs(string? OfferId = null, decimal? Amount = null, int? TermMonths = null);

/// <summary>Args for <c>repayLoan</c> (EXT loans).</summary>
public sealed record RepayLoanArgs(int LoanId, decimal Amount);

/// <summary>EXT (stockMarket): a company's quote.</summary>
public sealed record StockQuoteDto(
    int CompanyId,
    string Ticker,
    bool Listed,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal SharePrice,
    long SharesOutstanding,
    decimal MarketCap,
    double? Pe,
    double DividendYield,
    double ChangePctMonth,
    SeriesDto PriceHistory);

/// <summary>EXT (stockMarket): a shareholder.</summary>
public sealed record HolderDto(int? CompanyId, string Name, long Shares, double Pct);

/// <summary>Args for <c>holdings</c> (EXT stockMarket).</summary>
public sealed record HoldingsArgs(int? CompanyId = null);

/// <summary>Args for <c>ipo</c> / <c>issueShares</c> (EXT stockMarket).</summary>
public sealed record IpoArgs(long Shares, [property: JsonConverter(typeof(Money4ConverterFactory))] decimal Price);

/// <summary>Args for <c>buybackShares</c> (EXT stockMarket).</summary>
public sealed record BuybackArgs(long Shares);

/// <summary>Args for <c>tradeShares</c> (EXT stockMarket); <c>side</c> is <c>buy</c> | <c>sell</c>.</summary>
public sealed record TradeSharesArgs(int CompanyId, long Shares, string Side);

/// <summary>Args for <c>setDividend</c> (EXT stockMarket).</summary>
public sealed record DividendArgs([property: JsonConverter(typeof(Money4ConverterFactory))] decimal PerShareQuarterly);

/// <summary>EXT (macro): the macro economy.</summary>
public sealed record MacroDto(
    double GdpIndex,
    double Inflation,
    double InterestRate,
    double Unemployment,
    string Phase,
    IReadOnlyList<CityMacroDto> Cities,
    SeriesDto GdpHistory);

/// <summary>EXT (macro): one city's macro state.</summary>
public sealed record CityMacroDto(string CityId, long Population, double IncomeIndex, double LandPriceIndex, double GrowthRate);
