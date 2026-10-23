using System;

namespace Magnate.Engine.Market;

/// <summary>
/// Standard normal distribution helpers for the willingness-to-pay model (econ-audit §4.1,
/// Appendix A). Φ uses the Abramowitz–Stegun 7.1.26 rational approximation of erfc (absolute
/// error ≤ 1.5·10⁻⁷), evaluated in its complementary form so the upper tail keeps its relative
/// precision. Only <c>+ − × ÷ exp</c>: deterministic on one runtime (master plan D18).
/// </summary>
public static class Normal
{
    private const double InvSqrt2 = 0.70710678118654752440;
    private const double InvSqrt2Pi = 0.39894228040143267794;

    /// <summary>Standard normal density φ(z).</summary>
    public static double Pdf(double z) => InvSqrt2Pi * Math.Exp(-0.5 * z * z);

    /// <summary>Standard normal CDF Φ(z).</summary>
    public static double Cdf(double z) => 1.0 - UpperTail(z);

    /// <summary>Upper tail 1 − Φ(z), computed directly (no cancellation for large z).</summary>
    public static double UpperTail(double z) => 0.5 * Erfc(z * InvSqrt2);

    /// <summary>Complementary error function, Abramowitz–Stegun 7.1.26.</summary>
    public static double Erfc(double x)
    {
        if (double.IsNaN(x)) return double.NaN;
        var ax = Math.Abs(x);
        var t = 1.0 / (1.0 + 0.3275911 * ax);
        var poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
        var tail = poly * Math.Exp(-ax * ax);
        return x >= 0 ? tail : 2.0 - tail;
    }

    /// <summary>
    /// Lognormal survival <c>Surv(x) = 1 − Φ(ln x / σ)</c>: the share of buyers whose willingness
    /// to pay exceeds <paramref name="x"/> times the median. <paramref name="x"/> is floored at 1e-12.
    /// </summary>
    public static double LogSurvival(double x, double sigma) => UpperTail(Math.Log(Math.Max(x, 1e-12)) / sigma);

    /// <summary>
    /// Solve <c>φ(z) / (σ·(1 − Φ(z))) = ε</c> for z by 80 bisection steps on [−8, 4] (Appendix A
    /// <c>zref</c>): the reference point's position on the WTP distribution that gives category
    /// price elasticity ε at the reference price.
    /// </summary>
    public static double ReferenceZ(double elasticity, double sigma)
    {
        double lo = -8.0, hi = 4.0;
        for (var i = 0; i < 80; i++)
        {
            var mid = (lo + hi) / 2;
            if (Pdf(mid) / (sigma * UpperTail(mid)) < elasticity) lo = mid;
            else hi = mid;
        }

        return (lo + hi) / 2;
    }
}
