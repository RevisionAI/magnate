using System;
using Magnate.Engine.Economics;

namespace Magnate.Engine.Finance;

/// <summary>
/// Fundamental equity value of a private company (econ-audit §4.11, the residual-income /
/// value-driver model), applied to the operating business and with cash at face value:
/// <code>
///   NetCash    = Cash − Debt
///   Operating  = Equity − NetCash            (inventory + PP&amp;E + land + CIP)
///   RF10       = i + 0.75 %     ERP = 4.5 %     βU = 0.80
///   r          = RF10 + βU·ERP + (TotalAssets &lt; $250M ? 1 % : 0)          (unlevered cost of capital)
///   g          = min(r − 2 %, clamp(0.5·RevenueCAGR + 0.5·3 %, −2 %, 8 %))
///   ROIC       = EBIT_TTM·(1 − tax) / average quarter-end operating assets, clamped to [−50 %, 60 %]
///   M          = clamp((ROIC − g) / (r − g), 0.25, 8)                       (value per $ of operating assets)
///   Value      = NetCash + Operating·M
///   Equity ≤ 0 (or Value ≤ 0): max(0.01·shares, 0.25·max(0, 6·EBITDA_TTM − NetDebt))
/// </code>
/// <para>
/// <b>Why the operating split (a documented refinement of §4.11).</b> The spec capitalises the
/// whole book equity at P/B = f(ROE). For a game company that is mostly cash at the start, that
/// formula reads idle cash as a low-ROE business and marks it down toward 0.25×, so building the
/// first store would appear to destroy a third of the company's value. Valuing the operating
/// assets with the same value-driver multiple (on after-tax ROIC and the unlevered cost of
/// capital — the enterprise-value form of the same model) and adding net cash at face value keeps
/// the spec's behaviour for the business (P/E 6–35, P/B 0.25–8, rate sensitivity) without the
/// cash drag. Leverage enters through the debt subtracted in <c>NetCash</c>.
/// </para>
/// <para>
/// <b>Seasoning.</b> With fewer than 12 months of results the multiple blends linearly from 1
/// (book value) toward the model's M — a fresh company is worth its book equity.
/// </para>
/// Ratios are computed in <see cref="double"/> (deterministic per runtime, D18); the value is
/// rounded to cents.
/// </summary>
public static class Valuation
{
    /// <summary>Shares every company is founded with (econ-audit §4.11).</summary>
    public const decimal FoundingShares = 10_000_000m;

    private const double TermPremium10y = 0.0075;
    private const double EquityRiskPremium = 0.045;
    private const double UnleveredBeta = 0.80;
    private const double SmallCompanyPremium = 0.01;
    private const decimal SmallCompanyAssets = 250_000_000m;
    private const double LongRunGrowth = 0.03;

    /// <summary>Fundamental value of a company from its balance sheet and finance history.</summary>
    /// <param name="bs">Balance sheet now.</param>
    /// <param name="finance">The company's finance state (null before its first tick).</param>
    /// <param name="policyRate">Central-bank policy rate.</param>
    /// <param name="taxRate">Corporate income-tax rate (NOPAT).</param>
    public static CompanyValuation Fundamental(BalanceSheet bs, CompanyFinance? finance, decimal policyRate, decimal taxRate)
    {
        ArgumentNullException.ThrowIfNull(bs);
        var equity = bs.Equity;
        var netCash = bs.Cash - bs.Liabilities;
        var operating = equity - netCash;
        var windows = finance?.History.Count ?? 0;

        var rf10 = (double)policyRate + TermPremium10y;
        var costOfCapital = rf10 + UnleveredBeta * EquityRiskPremium + (bs.TotalAssets < SmallCompanyAssets ? SmallCompanyPremium : 0.0);
        var growth = Math.Min(costOfCapital - 0.02, Math.Clamp(0.5 * RevenueCagr(finance) + 0.5 * LongRunGrowth, -0.02, 0.08));

        double roic = 0;
        if (windows > 0)
        {
            var months = Math.Min(12, windows);
            var nopat = (double)finance!.Trailing(p => p.Ebit, months) * 12.0 / months * (1.0 - (double)taxRate);
            var avgOperating = AverageOperatingAssets(finance, operating);
            roic = avgOperating > 0 ? Math.Clamp(nopat / avgOperating, -0.5, 0.6) : 0;
        }

        var spread = costOfCapital - growth;
        var modelMultiple = spread > 1e-9 ? Math.Clamp((roic - growth) / spread, 0.25, 8.0) : 8.0;
        var seasoning = Math.Min(1.0, windows / 12.0);
        var multiple = operating > 0m ? 1.0 + seasoning * (modelMultiple - 1.0) : 1.0;

        var value = netCash + operating * (decimal)multiple;
        if (equity <= 0m || value <= 0m)
        {
            var ebitda = finance?.Trailing(p => p.Ebitda) ?? 0m;
            value = Math.Max(0.01m * FoundingShares, 0.25m * Math.Max(0m, 6m * ebitda + netCash));
        }

        return new CompanyValuation(FinanceMath.Cents(value), ValuationMethod.Fundamental, equity, netCash, operating,
            multiple, costOfCapital, growth, roic);
    }

    private static double AverageOperatingAssets(CompanyFinance finance, decimal current)
    {
        if (finance.QuarterOperatingAssets.Count == 0) return (double)current;
        decimal sum = 0m;
        foreach (var e in finance.QuarterOperatingAssets) sum += e;
        return (double)(sum / finance.QuarterOperatingAssets.Count);
    }

    /// <summary>
    /// Annual revenue growth from the window history: TTM revenue now against TTM revenue two
    /// years earlier (one year while the history is shorter than three); 0 with less than two
    /// years of history.
    /// </summary>
    public static double RevenueCagr(CompanyFinance? finance)
    {
        if (finance is null) return 0;
        var h = finance.History;
        var years = h.Count >= 36 ? 2 : h.Count >= 24 ? 1 : 0;
        if (years == 0) return 0;
        decimal now = 0m, then = 0m;
        for (var i = h.Count - 12; i < h.Count; i++) now += h[i].Revenue;
        var start = h.Count - 12 * (years + 1);
        for (var i = start; i < start + 12; i++) then += h[i].Revenue;
        if (now <= 0m || then <= 0m) return 0;
        return Math.Pow((double)(now / then), 1.0 / years) - 1.0;
    }
}
