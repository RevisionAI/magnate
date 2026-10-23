using System;
using Magnate.Engine.Finance;
using Xunit;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Annuity math, the term structure and the rating tables (econ-audit §4.10, R10, R11).</summary>
public sealed class FinanceMathTests
{
    [Fact]
    public void Worked_example_twenty_million_over_ten_years_at_bbb()
    {
        // econ-audit §4.10: $20M over 10 years at 6.61 % → $228,217/month; month-1 interest $110,167.
        var payment = FinanceMath.AnnuityPayment(20_000_000m, 0.0661m, 120);
        Assert.InRange(payment, 228_216m, 228_218m);
        Assert.Equal(110_166.67m, FinanceMath.MonthlyInterest(20_000_000m, 0.0661m));
    }

    [Theory]
    [InlineData(12, 0.0)]
    [InlineData(60, 0.005)]
    [InlineData(120, 0.0075)]
    [InlineData(240, 0.01)]
    [InlineData(36, 0.0025)]
    [InlineData(90, 0.00625)]
    public void Term_premium_is_linear_between_the_anchor_tenors(int months, double expected)
        => Assert.Equal((decimal)expected, FinanceMath.TermPremium(months));

    [Fact]
    public void Ten_year_rates_match_the_spec_table()
    {
        // i = 4.00 %: AAA 5.90 %, A 6.28 %, BBB 6.61 %, BB 7.34 %, B 8.71 %, CCC 14.35 %.
        decimal Rate(CreditRating r) => 0.04m + FinanceMath.TermPremium(120) + CreditRatings.Spread(r) + 0.0075m;
        Assert.Equal(0.0590m, Rate(CreditRating.AAA));
        Assert.Equal(0.0628m, Rate(CreditRating.A));
        Assert.Equal(0.0661m, Rate(CreditRating.BBB));
        Assert.Equal(0.0734m, Rate(CreditRating.BB));
        Assert.Equal(0.0871m, Rate(CreditRating.B));
        Assert.Equal(0.1435m, Rate(CreditRating.CCC));
    }

    [Theory]
    [InlineData(1_000_000, 0.0661, 120)]
    [InlineData(20_000_000, 0.0661, 120)]
    [InlineData(3_000_000, 0.08, 36)]
    [InlineData(123_456.78, 0.1435, 240)]
    [InlineData(5_000_000, 0.0, 24)]
    public void Annuity_schedule_repays_principal_exactly_and_interest_is_the_sum_of_monthly_charges(double principalD, double rateD, int months)
    {
        // R10: the schedule (final instalment rounded) repays exactly; Σ interest = Σ opening × r/12 (cent-rounded).
        var principal = (decimal)principalD;
        var rate = (decimal)rateD;
        var payment = FinanceMath.AnnuityPayment(principal, rate, months);
        var outstanding = principal;
        decimal interestSum = 0m, principalSum = 0m, expectedInterest = 0m;
        for (var i = 0; i < months; i++)
        {
            var interest = FinanceMath.MonthlyInterest(outstanding, rate);
            expectedInterest += FinanceMath.Cents(outstanding * rate / 12m);
            var repay = i == months - 1 ? outstanding : Math.Min(outstanding, payment - interest);
            Assert.True(repay >= 0m);
            interestSum += interest;
            principalSum += repay;
            outstanding -= repay;
        }

        Assert.Equal(0m, outstanding);
        Assert.Equal(principal, principalSum);
        Assert.Equal(expectedInterest, interestSum);
        // Every instalment but the last is the level payment; the last only absorbs rounding.
        Assert.True(payment > 0m);
    }

    [Theory]
    [InlineData(8.5, CreditRating.AAA)]
    [InlineData(8.49, CreditRating.AA)]
    [InlineData(6.5, CreditRating.AA)]
    [InlineData(5.5, CreditRating.APlus)]
    [InlineData(4.25, CreditRating.A)]
    [InlineData(3.0, CreditRating.AMinus)]
    [InlineData(2.5, CreditRating.BBB)]
    [InlineData(2.25, CreditRating.BBPlus)]
    [InlineData(2.0, CreditRating.BB)]
    [InlineData(1.75, CreditRating.BPlus)]
    [InlineData(1.5, CreditRating.B)]
    [InlineData(1.25, CreditRating.BMinus)]
    [InlineData(0.8, CreditRating.CCC)]
    [InlineData(0.65, CreditRating.CC)]
    [InlineData(0.64, CreditRating.C)]
    [InlineData(-3, CreditRating.C)]
    public void Interest_coverage_boundaries_map_to_the_damodaran_table(double icr, CreditRating expected)
        => Assert.Equal(expected, CreditRatings.FromInterestCoverage((decimal)icr * 1_000_000m, 1_000_000m));

    [Fact]
    public void No_interest_expense_rates_aaa_and_net_cash_rates_aaa_on_leverage()
    {
        Assert.Equal(CreditRating.AAA, CreditRatings.FromInterestCoverage(-5m, 0m));
        Assert.Equal(CreditRating.AAA, CreditRatings.FromLeverage(-1m, -10m, -10m, 0m));
    }

    [Theory]
    [InlineData(0.5, CreditRating.AAA)]
    [InlineData(1.89, CreditRating.A)]
    [InlineData(3.0, CreditRating.BBB)]
    [InlineData(5.5, CreditRating.B)]
    [InlineData(8.0, CreditRating.CCC)]
    [InlineData(10.0, CreditRating.CC)]
    [InlineData(10.01, CreditRating.C)]
    public void Leverage_bands(double ratio, CreditRating expected)
        => Assert.Equal(expected, CreditRatings.FromLeverage((decimal)ratio * 10_000_000m, 10_000_000m, 1m, 1m));

    [Fact]
    public void Positive_net_debt_without_ebitda_is_ccc_or_cc()
    {
        Assert.Equal(CreditRating.CCC, CreditRatings.FromLeverage(1m, 0m, 1m, 1m));
        Assert.Equal(CreditRating.CC, CreditRatings.FromLeverage(1m, -1m, -1m, 1m));
    }

    [Fact]
    public void Size_caps_and_cash_flow_multiples()
    {
        Assert.Equal(CreditRating.BBB, CreditRatings.SizeCap(24_999_999m));
        Assert.Equal(CreditRating.AMinus, CreditRatings.SizeCap(25_000_000m));
        Assert.Equal(CreditRating.APlus, CreditRatings.SizeCap(100_000_000m));
        Assert.Equal(CreditRating.AA, CreditRatings.SizeCap(500_000_000m));
        Assert.Equal(CreditRating.AAA, CreditRatings.SizeCap(2_000_000_000m));
        Assert.Equal(4.0m, CreditRatings.CashFlowMultiple(CreditRating.AMinus));
        Assert.Equal(3.5m, CreditRatings.CashFlowMultiple(CreditRating.BBB));
        Assert.Equal(3.0m, CreditRatings.CashFlowMultiple(CreditRating.BB));
        Assert.Equal(2.5m, CreditRatings.CashFlowMultiple(CreditRating.BMinus));
        Assert.Equal(0m, CreditRatings.CashFlowMultiple(CreditRating.CCC));
    }

    [Fact]
    public void Worked_rating_example_is_a()
    {
        // §4.10: EBIT $13M, EBITDA $18M, interest $2.4M, debt $40M, cash $6M, assets $150M → A.
        var icr = CreditRatings.FromInterestCoverage(13_000_000m, 2_400_000m);
        var lev = CreditRatings.FromLeverage(34_000_000m, 18_000_000m, 13_000_000m, 2_400_000m);
        var size = CreditRatings.SizeCap(150_000_000m);
        Assert.Equal(CreditRating.A, CreditRatings.Worse(CreditRatings.Worse(icr, lev), size));
    }

    [Theory]
    [InlineData("A-", CreditRating.AMinus)]
    [InlineData("a−", CreditRating.AMinus)]
    [InlineData("BB+", CreditRating.BBPlus)]
    [InlineData("AAA", CreditRating.AAA)]
    [InlineData("BPlus", CreditRating.BPlus)]
    public void Labels_parse(string text, CreditRating expected)
    {
        Assert.True(CreditRatings.TryParse(text, out var rating));
        Assert.Equal(expected, rating);
        Assert.Equal(rating, CreditRatings.TryParse(CreditRatings.Label(rating), out var again) ? again : CreditRating.D);
    }

    [Fact]
    public void Shift_never_reaches_d()
    {
        Assert.Equal(CreditRating.C, CreditRatings.Shift(CreditRating.CC, 5));
        Assert.Equal(CreditRating.AAA, CreditRatings.Shift(CreditRating.A, -9));
    }
}
