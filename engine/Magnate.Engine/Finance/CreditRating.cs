using System;
using System.Collections.Generic;

namespace Magnate.Engine.Finance;

/// <summary>
/// Long-term issuer credit rating on the 15-notch scale of econ-audit §4.10 (numeric value =
/// notch: AAA = 0 … C = 13, D = 14). Lower is better. Saved by name.
/// </summary>
public enum CreditRating
{
    /// <summary>Highest quality.</summary>
    AAA = 0,
    /// <summary>Very high quality.</summary>
    AA,
    /// <summary>High quality (A+).</summary>
    APlus,
    /// <summary>High quality.</summary>
    A,
    /// <summary>High quality (A−).</summary>
    AMinus,
    /// <summary>Lowest investment grade.</summary>
    BBB,
    /// <summary>Speculative (BB+).</summary>
    BBPlus,
    /// <summary>Speculative.</summary>
    BB,
    /// <summary>Highly speculative (B+).</summary>
    BPlus,
    /// <summary>Highly speculative.</summary>
    B,
    /// <summary>Highly speculative (B−).</summary>
    BMinus,
    /// <summary>Substantial risk.</summary>
    CCC,
    /// <summary>Extremely speculative.</summary>
    CC,
    /// <summary>Near default.</summary>
    C,
    /// <summary>In default (distress, §4.14). Only the solvency logic assigns it.</summary>
    D,
}

/// <summary>
/// Rating tables (econ-audit §4.10): Damodaran January-2026 default spreads, the large-firm
/// interest-coverage bands, the leverage bands, the size caps and the cash-flow multiples used by
/// borrowing capacity. Pure functions over immutable tables.
/// </summary>
public static class CreditRatings
{
    private static readonly decimal[] Spreads =
    {
        0.0040m, 0.0055m, 0.0070m, 0.0078m, 0.0089m, 0.0111m, 0.0138m, 0.0184m,
        0.0275m, 0.0321m, 0.0509m, 0.0885m, 0.1261m, 0.1600m, 0.1900m,
    };

    private static readonly string[] Labels =
    {
        "AAA", "AA", "A+", "A", "A-", "BBB", "BB+", "BB", "B+", "B", "B-", "CCC", "CC", "C", "D",
    };

    // Damodaran large-firm ICR bands: minimum EBIT/interest for AAA … CC; below the last → C.
    private static readonly (decimal Min, CreditRating Rating)[] IcrBands =
    {
        (8.5m, CreditRating.AAA), (6.5m, CreditRating.AA), (5.5m, CreditRating.APlus), (4.25m, CreditRating.A),
        (3.0m, CreditRating.AMinus), (2.5m, CreditRating.BBB), (2.25m, CreditRating.BBPlus), (2.0m, CreditRating.BB),
        (1.75m, CreditRating.BPlus), (1.5m, CreditRating.B), (1.25m, CreditRating.BMinus), (0.8m, CreditRating.CCC),
        (0.65m, CreditRating.CC),
    };

    // Net debt / EBITDA bands: maximum ratio for AAA … CC; above the last → C.
    private static readonly (decimal Max, CreditRating Rating)[] LeverageBands =
    {
        (0.5m, CreditRating.AAA), (1.0m, CreditRating.AA), (1.5m, CreditRating.APlus), (2.0m, CreditRating.A),
        (2.5m, CreditRating.AMinus), (3.0m, CreditRating.BBB), (3.5m, CreditRating.BBPlus), (4.0m, CreditRating.BB),
        (4.5m, CreditRating.BPlus), (5.5m, CreditRating.B), (6.5m, CreditRating.BMinus), (8m, CreditRating.CCC),
        (10m, CreditRating.CC),
    };

    /// <summary>Every rating, best first.</summary>
    public static IReadOnlyList<CreditRating> All { get; } = (CreditRating[])Enum.GetValues(typeof(CreditRating));

    /// <summary>Default spread over the risk-free rate (decimal fraction, e.g. 0.0111 for BBB).</summary>
    public static decimal Spread(CreditRating rating) => Spreads[(int)rating];

    /// <summary>Display label ("AAA", "A-", "BB+", …).</summary>
    public static string Label(CreditRating rating) => Labels[(int)rating];

    /// <summary>Parse a display label or enum name (case-insensitive). False when unknown.</summary>
    public static bool TryParse(string? text, out CreditRating rating)
    {
        rating = CreditRating.D;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = text.Trim();
        for (var i = 0; i < Labels.Length; i++)
        {
            if (string.Equals(Labels[i], t, StringComparison.OrdinalIgnoreCase))
            {
                rating = (CreditRating)i;
                return true;
            }
        }

        t = t.Replace("−", "-", StringComparison.Ordinal);
        for (var i = 0; i < Labels.Length; i++)
        {
            if (string.Equals(Labels[i], t, StringComparison.OrdinalIgnoreCase))
            {
                rating = (CreditRating)i;
                return true;
            }
        }

        return Enum.TryParse(t, ignoreCase: true, out rating) && Enum.IsDefined(rating);
    }

    /// <summary>The worse (higher-notch) of two ratings.</summary>
    public static CreditRating Worse(CreditRating a, CreditRating b) => a >= b ? a : b;

    /// <summary>Shift by <paramref name="notches"/> (positive = downgrade), clamped to AAA…C (never D).</summary>
    public static CreditRating Shift(CreditRating rating, int notches)
        => (CreditRating)Math.Clamp((int)rating + notches, (int)CreditRating.AAA, (int)CreditRating.C);

    /// <summary>
    /// Interest-coverage notch from TTM EBIT and gross interest expense (a positive number).
    /// No interest expense rates AAA.
    /// </summary>
    public static CreditRating FromInterestCoverage(decimal ebit, decimal interestExpense)
    {
        if (interestExpense <= 0m) return CreditRating.AAA;
        var icr = ebit / interestExpense;
        foreach (var (min, rating) in IcrBands)
        {
            if (icr >= min) return rating;
        }

        return CreditRating.C;
    }

    /// <summary>
    /// Leverage notch from net debt and TTM EBITDA. Net debt ≤ 0 rates AAA; positive net debt
    /// with EBITDA ≤ 0 rates CCC (CC when interest cover is also below 0.65).
    /// </summary>
    public static CreditRating FromLeverage(decimal netDebt, decimal ebitda, decimal ebit, decimal interestExpense)
    {
        if (netDebt <= 0m) return CreditRating.AAA;
        if (ebitda <= 0m)
        {
            var weakCover = interestExpense > 0m && ebit / interestExpense < 0.65m;
            return weakCover ? CreditRating.CC : CreditRating.CCC;
        }

        var leverage = netDebt / ebitda;
        foreach (var (max, rating) in LeverageBands)
        {
            if (leverage <= max) return rating;
        }

        return CreditRating.C;
    }

    /// <summary>Best rating a company of this size can hold (§4.10 step 3).</summary>
    public static CreditRating SizeCap(decimal totalAssets) => totalAssets switch
    {
        < 25_000_000m => CreditRating.BBB,
        < 100_000_000m => CreditRating.AMinus,
        < 500_000_000m => CreditRating.APlus,
        < 2_000_000_000m => CreditRating.AA,
        _ => CreditRating.AAA,
    };

    /// <summary>
    /// Multiple of TTM EBITDA lenders will extend (§4.10 borrowing capacity): AAA…A− 4.0, BBB 3.5,
    /// BB+/BB 3.0, B+…B− 2.5, CCC or worse 0.
    /// </summary>
    public static decimal CashFlowMultiple(CreditRating rating) => rating switch
    {
        <= CreditRating.AMinus => 4.0m,
        CreditRating.BBB => 3.5m,
        <= CreditRating.BB => 3.0m,
        <= CreditRating.BMinus => 2.5m,
        _ => 0m,
    };

    /// <summary>
    /// Rating an unrated (young) company is priced at: BBB when debt ≤ half of equity, otherwise BB.
    /// </summary>
    public static CreditRating Unrated(decimal debt, decimal equity)
        => debt <= 0.5m * equity ? CreditRating.BBB : CreditRating.BB;
}
