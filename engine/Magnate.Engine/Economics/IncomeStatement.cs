using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// Accrual-basis P&amp;L for a company over a date range (econ-audit §4.15):
/// <code>
///   GrossProfit  = Revenue − CostOfGoodsSold
///   EBITDA       = GrossProfit − (OperatingExpenses − Depreciation)
///   EBIT         = GrossProfit − OperatingExpenses
///   PreTaxIncome = EBIT + NonOperatingIncome
///                = EBIT − InterestExpense + InterestIncome + OtherGains
///   NetIncome    = PreTaxIncome − IncomeTax
/// </code>
/// Each line is a pure function of the cash ledger (classified by
/// <see cref="LedgerCategoryInfo"/>), the COGS log and the accrual journal. Capital flows
/// (owner equity, debt principal, capex) and inventory acquisitions are excluded — they are
/// balance-sheet movements; capitalised purchases surface later as COGS.
/// For a Classic world <see cref="Depreciation"/>, <see cref="NonOperatingIncome"/> and
/// <see cref="IncomeTax"/> are always zero, so <c>NetIncome = GrossProfit − OperatingExpenses</c>
/// exactly as before the overhaul.
/// </summary>
/// <param name="From">First month of the period.</param>
/// <param name="ToInclusive">Last month of the period.</param>
/// <param name="Revenue">Retail sales, exports and royalty income.</param>
/// <param name="CostOfGoodsSold">Cost basis of goods sold or exported, plus inventory write-downs.</param>
/// <param name="OperatingExpenses">Everything above EBIT: cash operating expenses plus <see cref="Depreciation"/>.</param>
/// <param name="Depreciation">Non-cash depreciation charge (already included in <see cref="OperatingExpenses"/>).</param>
/// <param name="NonOperatingIncome">Net below-EBIT items: interest income − interest expense − distress interest + disposal gains − write-offs.</param>
/// <param name="IncomeTax">Income-tax expense (negative for a refund).</param>
/// <param name="InterestExpense">Interest on loans and the revolver plus distress interest (positive; part of <see cref="NonOperatingIncome"/>).</param>
/// <param name="InterestIncome">Interest earned on cash (part of <see cref="NonOperatingIncome"/>).</param>
/// <param name="OtherGains">Disposal gains/losses and construction write-offs (part of <see cref="NonOperatingIncome"/>).</param>
public sealed record IncomeStatement(
    GameDate From,
    GameDate ToInclusive,
    decimal Revenue,
    decimal CostOfGoodsSold,
    decimal OperatingExpenses,
    decimal Depreciation = 0m,
    decimal NonOperatingIncome = 0m,
    decimal IncomeTax = 0m,
    decimal InterestExpense = 0m,
    decimal InterestIncome = 0m,
    decimal OtherGains = 0m)
{
    /// <summary>Revenue − COGS.</summary>
    public decimal GrossProfit => Revenue - CostOfGoodsSold;

    /// <summary>Earnings before interest, tax, depreciation and amortisation.</summary>
    public decimal Ebitda => GrossProfit - (OperatingExpenses - Depreciation);

    /// <summary>Operating profit: GrossProfit − OperatingExpenses.</summary>
    public decimal Ebit => GrossProfit - OperatingExpenses;

    /// <summary>EBIT + net non-operating income.</summary>
    public decimal PreTaxIncome => Ebit + NonOperatingIncome;

    /// <summary>The bottom line.</summary>
    public decimal NetIncome => PreTaxIncome - IncomeTax;

    /// <summary>Interest income − interest expense.</summary>
    public decimal NetInterest => InterestIncome - InterestExpense;
}
