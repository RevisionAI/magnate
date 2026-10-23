using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>
/// An amortising term loan (econ-audit §4.10): fixed rate set at origination, level monthly
/// annuity payment, the final instalment rounded so the principal repays exactly.
/// </summary>
public sealed class TermLoan
{
    /// <summary>Create a loan (engine code goes through <c>World.TakeLoan</c>).</summary>
    internal TermLoan(int id, CompanyId company, decimal principal, decimal annualRate, int termMonths, decimal monthlyPayment, GameDate originated)
    {
        Id = id;
        Company = company;
        Principal = principal;
        Outstanding = principal;
        AnnualRate = annualRate;
        TermMonths = termMonths;
        MonthsRemaining = termMonths;
        MonthlyPayment = monthlyPayment;
        Originated = originated;
    }

    /// <summary>World-unique loan id (monotonic, never reused).</summary>
    public int Id { get; }

    /// <summary>Borrower.</summary>
    public CompanyId Company { get; }

    /// <summary>Amount originally borrowed.</summary>
    public decimal Principal { get; }

    /// <summary>Principal still owed.</summary>
    public decimal Outstanding { get; internal set; }

    /// <summary>Fixed annual interest rate (decimal fraction).</summary>
    public decimal AnnualRate { get; }

    /// <summary>Original tenor in months.</summary>
    public int TermMonths { get; }

    /// <summary>Scheduled instalments left.</summary>
    public int MonthsRemaining { get; internal set; }

    /// <summary>Level monthly payment (interest + principal). Recomputed after a partial prepayment.</summary>
    public decimal MonthlyPayment { get; internal set; }

    /// <summary>Month the loan was drawn.</summary>
    public GameDate Originated { get; }

    /// <summary>Scheduled payments missed so far.</summary>
    public int MissedPayments { get; internal set; }

    /// <summary>True once fully repaid.</summary>
    public bool IsRepaid => Outstanding <= 0m;
}
