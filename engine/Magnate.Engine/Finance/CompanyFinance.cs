using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>Where a company stands with its lenders (econ-audit §4.14).</summary>
public enum SolvencyState
{
    /// <summary>Normal.</summary>
    Solvent,

    /// <summary>Defaulted: rating D, penalty interest, investment blocked, cure clock running.</summary>
    Distress,

    /// <summary>Liquidated. The company keeps its history but no longer operates.</summary>
    Bankrupt,
}

/// <summary>
/// The profit and loss recognised in one tick window (from the previous tax step to this one),
/// the unit of the trailing-twelve-month figures the rating, borrowing capacity and valuation
/// read. Recorded by the tax step, so every P&amp;L entry lands in exactly one window.
/// </summary>
/// <param name="Month">Month index of the tick that closed the window.</param>
/// <param name="Revenue">Revenue.</param>
/// <param name="Ebitda">Revenue − COGS − cash operating expenses.</param>
/// <param name="Ebit">EBITDA − depreciation.</param>
/// <param name="InterestExpense">Gross interest expense, including distress interest (positive).</param>
/// <param name="PreTaxIncome">EBIT + net non-operating items.</param>
/// <param name="IncomeTax">Income-tax expense booked for the window (positive = expense).</param>
/// <param name="OperatingCosts">Cash operating expenses (positive): the fixed-cost base.</param>
public sealed record PeriodResult(
    int Month,
    decimal Revenue,
    decimal Ebitda,
    decimal Ebit,
    decimal InterestExpense,
    decimal PreTaxIncome,
    decimal IncomeTax,
    decimal OperatingCosts)
{
    /// <summary>Net income of the window.</summary>
    public decimal NetIncome => PreTaxIncome - IncomeTax;
}

/// <summary>
/// Per-company finance state (econ-audit §4.19): loans, revolver, rating, tax position, solvency
/// and the trailing history the rating and valuation read. Persisted in the finance save section.
/// </summary>
public sealed class CompanyFinance
{
    /// <summary>Months of <see cref="History"/> kept (three years: TTM and the 3-year revenue CAGR).</summary>
    public const int HistoryMonths = 36;

    /// <summary>Quarter-end operating-asset snapshots kept for the average-capital ROIC.</summary>
    public const int QuarterSnapshots = 4;

    /// <summary>Create the state of a company founded in <paramref name="foundedMonth"/>.</summary>
    public CompanyFinance(CompanyId company, int foundedMonth)
    {
        Company = company;
        FoundedMonth = foundedMonth;
    }

    /// <summary>The company described.</summary>
    public CompanyId Company { get; }

    /// <summary>Month index the company was founded (its first ledger entry).</summary>
    public int FoundedMonth { get; internal set; }

    /// <summary>Term loans, oldest first (repaid loans are dropped).</summary>
    public List<TermLoan> Loans { get; } = new();

    /// <summary>Revolving-credit balance drawn.</summary>
    public decimal RevolverDrawn { get; internal set; }

    /// <summary>Term loans ever taken (goal and tutorial support).</summary>
    public int LoansTaken { get; internal set; }

    /// <summary>Reported rating (D while in distress); null while unrated (younger than the seasoning period).</summary>
    public CreditRating? Rating { get; internal set; }

    /// <summary>
    /// The rating of the last quarterly review, ignoring a default (the reported
    /// <see cref="Rating"/> shows D in distress). Lenders size the credit line on it.
    /// </summary>
    public CreditRating? UnderlyingRating { get; internal set; }

    /// <summary>Month index of the last rating review (null before the first).</summary>
    public int? RatedAt { get; internal set; }

    /// <summary>After a cure the rating is capped at B− until this month index (exclusive).</summary>
    public int? RatingCapUntil { get; internal set; }

    // ------------------------------------------------------------------ tax (§4.9)

    /// <summary>Brought-forward tax losses at the start of the year.</summary>
    public decimal NolOpen { get; internal set; }

    /// <summary>Taxable income recognised year to date.</summary>
    public decimal TaxableIncomeYtd { get; internal set; }

    /// <summary>Tax paid (net of refunds) year to date.</summary>
    public decimal TaxPaidYtd { get; internal set; }

    /// <summary>Calendar year the YTD tax figures belong to.</summary>
    public int TaxYear { get; internal set; }

    // ------------------------------------------------------------------ solvency (§4.14)

    /// <summary>Solvency state.</summary>
    public SolvencyState State { get; internal set; }

    /// <summary>Month index distress began (null when solvent).</summary>
    public int? DistressSince { get; internal set; }

    /// <summary>Month closes spent in distress without curing.</summary>
    public int DistressMonths { get; internal set; }

    /// <summary>Month index of bankruptcy (null unless bankrupt).</summary>
    public int? BankruptAt { get; internal set; }

    /// <summary>Why the company went bankrupt ("uncured default", "negative equity").</summary>
    public string? BankruptcyReason { get; internal set; }

    /// <summary>A scheduled loan payment was missed this tick (default trigger).</summary>
    internal bool MissedPaymentThisTick { get; set; }

    // ------------------------------------------------------------------ history

    /// <summary>Tick-window P&amp;L, oldest first, at most <see cref="HistoryMonths"/> entries.</summary>
    public List<PeriodResult> History { get; } = new();

    /// <summary>Operating assets (equity − net cash) at the last quarter-ends, oldest first, at most <see cref="QuarterSnapshots"/>.</summary>
    public List<decimal> QuarterOperatingAssets { get; } = new();

    /// <summary>Σ term-loan principal outstanding.</summary>
    public decimal TermDebt => Loans.Count == 0 ? 0m : Loans.Sum(l => l.Outstanding);

    /// <summary>Term debt + revolver.</summary>
    public decimal TotalDebt => TermDebt + RevolverDrawn;

    /// <summary>True while defaulted.</summary>
    public bool InDistress => State == SolvencyState.Distress;

    /// <summary>True once liquidated.</summary>
    public bool IsBankrupt => State == SolvencyState.Bankrupt;

    /// <summary>Sum of a field over the most recent <paramref name="months"/> windows.</summary>
    public decimal Trailing(Func<PeriodResult, decimal> field, int months = 12)
    {
        decimal total = 0m;
        var from = Math.Max(0, History.Count - months);
        for (var i = from; i < History.Count; i++) total += field(History[i]);
        return total;
    }

    internal void AppendHistory(PeriodResult result)
    {
        History.Add(result);
        if (History.Count > HistoryMonths) History.RemoveAt(0);
    }

    internal void AppendQuarterOperatingAssets(decimal operatingAssets)
    {
        QuarterOperatingAssets.Add(operatingAssets);
        if (QuarterOperatingAssets.Count > QuarterSnapshots) QuarterOperatingAssets.RemoveAt(0);
    }
}
