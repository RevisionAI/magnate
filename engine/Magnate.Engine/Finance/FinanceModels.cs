using System;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>Why a finance command was refused (the bridge maps these to error codes).</summary>
public enum FinanceErrorCode
{
    /// <summary>The ruleset does not enable the feature (Classic).</summary>
    FeatureDisabled,

    /// <summary>The amount exceeds the company's borrowing capacity.</summary>
    CreditLimitExceeded,

    /// <summary>The company is in distress or bankrupt: new borrowing and investment are blocked.</summary>
    Distressed,

    /// <summary>An argument is out of range (term, amount).</summary>
    InvalidArgument,

    /// <summary>No such loan for this company.</summary>
    LoanNotFound,

    /// <summary>Not enough cash for the payment.</summary>
    InsufficientCash,

    /// <summary>The building cannot be disposed of.</summary>
    InvalidDisposal,
}

/// <summary>A refused finance command. <see cref="InvalidOperationException"/> for legacy callers.</summary>
public sealed class FinanceException : InvalidOperationException
{
    /// <summary>Create the exception.</summary>
    public FinanceException(FinanceErrorCode code, string message, decimal? limit = null)
        : base(message)
    {
        Code = code;
        Limit = limit;
    }

    /// <summary>Machine-readable reason.</summary>
    public FinanceErrorCode Code { get; }

    /// <summary>The relevant limit (borrowing capacity, cash) when the refusal is about one.</summary>
    public decimal? Limit { get; }
}

/// <summary>
/// A company's standing with its lenders (econ-audit §4.10): rating, borrowing capacity, pricing
/// and the ratios behind them. All money in dollars; rates are annual decimal fractions.
/// </summary>
/// <param name="Company">Company described.</param>
/// <param name="Rating">Reported rating; null while unrated (younger than the seasoning period).</param>
/// <param name="PricingRating">Rating loans are priced at (the unrated rule: BBB if debt ≤ ½ equity, else BB).</param>
/// <param name="LastReview">Month of the last quarterly review, if any.</param>
/// <param name="NextReview">Month of the next quarterly review.</param>
/// <param name="TermDebt">Term-loan principal outstanding.</param>
/// <param name="RevolverDrawn">Revolver balance.</param>
/// <param name="RevolverLimit">Revolver limit (the automatic overdraft never exceeds it).</param>
/// <param name="DebtCapacity">Total debt lenders will carry.</param>
/// <param name="NewTermLoanMax">Largest new term loan available now.</param>
/// <param name="Collateral">Lending value of land, buildings, equipment, inventory and CIP.</param>
/// <param name="RevolverRate">Current floating revolver rate.</param>
/// <param name="PolicyRate">Central-bank policy rate.</param>
/// <param name="EbitdaTtm">Trailing-twelve-month EBITDA.</param>
/// <param name="EbitTtm">Trailing-twelve-month EBIT.</param>
/// <param name="InterestTtm">Trailing-twelve-month gross interest expense.</param>
/// <param name="InterestCoverage">EBIT / interest (null without interest expense).</param>
/// <param name="NetDebtToEbitda">Net debt / EBITDA (null when EBITDA ≤ 0).</param>
/// <param name="MonthlyFixedCosts">Average monthly operating costs plus scheduled debt service.</param>
/// <param name="NextPayment">Total scheduled term-loan payment next month.</param>
/// <param name="Seasoned">Old enough to be rated and to borrow against cash flow.</param>
public sealed record CreditProfile(
    CompanyId Company,
    CreditRating? Rating,
    CreditRating PricingRating,
    GameDate? LastReview,
    GameDate NextReview,
    decimal TermDebt,
    decimal RevolverDrawn,
    decimal RevolverLimit,
    decimal DebtCapacity,
    decimal NewTermLoanMax,
    decimal Collateral,
    decimal RevolverRate,
    decimal PolicyRate,
    decimal EbitdaTtm,
    decimal EbitTtm,
    decimal InterestTtm,
    decimal? InterestCoverage,
    decimal? NetDebtToEbitda,
    decimal MonthlyFixedCosts,
    decimal NextPayment,
    bool Seasoned)
{
    /// <summary>Total debt.</summary>
    public decimal TotalDebt => TermDebt + RevolverDrawn;

    /// <summary>Revolver headroom.</summary>
    public decimal UndrawnRevolver => Math.Max(0m, RevolverLimit - RevolverDrawn);

    /// <summary>Display label of the reported rating ("NR" while unrated).</summary>
    public string RatingLabel => Rating is { } r ? CreditRatings.Label(r) : "NR";
}

/// <summary>Terms a lender would offer for a term loan now (econ-audit §4.10).</summary>
/// <param name="Amount">Principal asked for.</param>
/// <param name="TermMonths">Tenor.</param>
/// <param name="AnnualRate">Fixed rate: policy + term premium + rating spread + margin.</param>
/// <param name="MonthlyPayment">Level annuity payment.</param>
/// <param name="TotalInterest">Interest over the life of the loan (payments − principal).</param>
/// <param name="Rating">Rating the loan is priced at.</param>
/// <param name="MaxAmount">Largest loan available now.</param>
/// <param name="Allowed">True when the loan can be taken as quoted.</param>
/// <param name="Refusal">Why not, when <see cref="Allowed"/> is false.</param>
public sealed record LoanQuote(
    decimal Amount,
    int TermMonths,
    decimal AnnualRate,
    decimal MonthlyPayment,
    decimal TotalInterest,
    CreditRating Rating,
    decimal MaxAmount,
    bool Allowed,
    FinanceErrorCode? Refusal);

/// <summary>Solvency standing (econ-audit §4.14).</summary>
/// <param name="State">Solvent, in distress or bankrupt.</param>
/// <param name="DistressSince">Month distress began.</param>
/// <param name="MonthsInDistress">Month closes spent in distress.</param>
/// <param name="CureMonthsLeft">Month closes left to cure before bankruptcy (in distress only).</param>
/// <param name="BankruptAt">Month of bankruptcy.</param>
/// <param name="Reason">Why the company went bankrupt.</param>
public sealed record SolvencyStatus(
    SolvencyState State,
    GameDate? DistressSince,
    int MonthsInDistress,
    int? CureMonthsLeft,
    GameDate? BankruptAt,
    string? Reason);

/// <summary>Income-tax position (econ-audit §4.9).</summary>
/// <param name="Rate">Tax rate.</param>
/// <param name="LossCarryForward">Brought-forward losses available this year.</param>
/// <param name="TaxableIncomeYtd">Taxable income recognised this year.</param>
/// <param name="TaxPaidYtd">Tax paid this year, net of refunds.</param>
public sealed record TaxPosition(decimal Rate, decimal LossCarryForward, decimal TaxableIncomeYtd, decimal TaxPaidYtd);

/// <summary>How <see cref="CompanyValuation.Value"/> was measured.</summary>
public enum ValuationMethod
{
    /// <summary>Legacy (Classic): total assets.</summary>
    TotalAssets,

    /// <summary>Fundamental equity value (residual income, econ-audit §4.11).</summary>
    Fundamental,

    /// <summary>Share price × shares (listed companies, Wave 3).</summary>
    MarketCap,
}

/// <summary>
/// The engine's single company-value definition (master plan D10) with its inputs, for the
/// "Company Value" HUD figure, goals and the valuation breakdown UI.
/// </summary>
/// <param name="Value">Company value.</param>
/// <param name="Method">How it was measured.</param>
/// <param name="BookEquity">Book equity.</param>
/// <param name="NetCash">Cash − debt, valued at face.</param>
/// <param name="OperatingAssets">Book value of the operating business (inventory, PP&amp;E, land, CIP).</param>
/// <param name="OperatingMultiple">Value per dollar of operating assets (1 for young or legacy companies).</param>
/// <param name="CostOfCapital">Unlevered cost of capital r.</param>
/// <param name="Growth">g.</param>
/// <param name="ReturnOnCapital">Normalised after-tax ROIC.</param>
public sealed record CompanyValuation(
    decimal Value,
    ValuationMethod Method,
    decimal BookEquity,
    decimal NetCash,
    decimal OperatingAssets,
    double OperatingMultiple,
    double CostOfCapital,
    double Growth,
    double ReturnOnCapital)
{
    /// <summary>Value ÷ book equity (0 when equity ≤ 0).</summary>
    public double PriceToBook => BookEquity > 0m ? (double)(Value / BookEquity) : 0;
}

/// <summary>How a building leaves the company.</summary>
public enum DisposalKind
{
    /// <summary>Sold as a going concern: land at value, structure at 60 % of book, stock at cost.</summary>
    Sale,

    /// <summary>Demolished: land sold, structure scrapped, stock cleared at a discount.</summary>
    Demolition,

    /// <summary>Fire sale in a bankruptcy liquidation.</summary>
    Liquidation,
}

/// <summary>Result (or preview) of disposing of a building.</summary>
/// <param name="Building">The building.</param>
/// <param name="Kind">How it was disposed of.</param>
/// <param name="Proceeds">Cash received.</param>
/// <param name="BookValue">Net book value of PP&amp;E derecognised.</param>
/// <param name="Land">Land at cost derecognised.</param>
/// <param name="ConstructionInProgress">CIP derecognised.</param>
/// <param name="Inventory">Inventory at cost derecognised.</param>
public sealed record DisposalResult(
    BuildingInstanceId Building,
    DisposalKind Kind,
    decimal Proceeds,
    decimal BookValue,
    decimal Land,
    decimal ConstructionInProgress,
    decimal Inventory)
{
    /// <summary>Everything derecognised.</summary>
    public decimal CarryingAmount => BookValue + Land + ConstructionInProgress + Inventory;

    /// <summary>Proceeds − carrying amount (booked to the accrual journal).</summary>
    public decimal GainOrLoss => Proceeds - CarryingAmount;
}
