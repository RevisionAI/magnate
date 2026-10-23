using System;

namespace Magnate.Engine.Finance;

/// <summary>
/// Deterministic money arithmetic for the finance model: cent rounding, the annuity payment
/// and the term structure of econ-audit §4.10. Everything is <see cref="decimal"/> so a given
/// input always produces the same cents on every runtime.
/// </summary>
public static class FinanceMath
{
    /// <summary>Round to whole cents, half away from zero (every cash amount the finance model books).</summary>
    public static decimal Cents(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Term premium over the policy rate (§4.10): ≤ 12 months 0 %, 60 months 0.50 %, 120 months
    /// 0.75 %, 240 months 1.00 %, linear in between.
    /// </summary>
    public static decimal TermPremium(int termMonths)
    {
        if (termMonths <= 12) return 0m;
        if (termMonths <= 60) return 0.0050m * (termMonths - 12) / 48m;
        if (termMonths <= 120) return 0.0050m + 0.0025m * (termMonths - 60) / 60m;
        if (termMonths <= 240) return 0.0075m + 0.0025m * (termMonths - 120) / 120m;
        return 0.0100m;
    }

    /// <summary>
    /// Level monthly payment that amortises <paramref name="principal"/> over
    /// <paramref name="months"/> at <paramref name="annualRate"/>: <c>P·r / (1 − (1 + r)^−n)</c>
    /// with <c>r = rate / 12</c>, rounded to cents. A zero rate repays principal in equal parts.
    /// </summary>
    public static decimal AnnuityPayment(decimal principal, decimal annualRate, int months)
    {
        if (months <= 0) throw new ArgumentOutOfRangeException(nameof(months), "term must be at least one month");
        if (principal <= 0m) return 0m;
        var r = annualRate / 12m;
        if (r == 0m) return Cents(principal / months);

        // (1 + r)^n by repeated squaring on decimals: exact to ~28 significant digits, deterministic.
        var growth = Pow(1m + r, months);
        var payment = principal * r * growth / (growth - 1m);
        return Cents(payment);
    }

    /// <summary>One month's interest on an opening balance at an annual rate, rounded to cents.</summary>
    public static decimal MonthlyInterest(decimal balance, decimal annualRate)
        => balance <= 0m || annualRate == 0m ? 0m : Cents(balance * annualRate / 12m);

    /// <summary><paramref name="value"/>^<paramref name="exponent"/> for a non-negative integer exponent.</summary>
    public static decimal Pow(decimal value, int exponent)
    {
        if (exponent < 0) throw new ArgumentOutOfRangeException(nameof(exponent));
        var result = 1m;
        var b = value;
        var e = exponent;
        while (e > 0)
        {
            if ((e & 1) == 1) result *= b;
            e >>= 1;
            if (e > 0) b *= b;
        }

        return result;
    }
}
