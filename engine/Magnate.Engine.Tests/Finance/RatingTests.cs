using System.Linq;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Quarterly credit reviews (econ-audit §4.10, R11).</summary>
public sealed class RatingTests
{
    [Fact]
    public void A_company_is_unrated_for_its_first_year_then_rated_at_a_quarter_end()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 11; i++) world.AdvanceMonth(); // Dec 2026, age 11
        Assert.Null(world.GetCompanyFinance(c.Id)!.Rating);
        for (var i = 0; i < 3; i++) world.AdvanceMonth(); // Mar 2027, age 14
        var f = world.GetCompanyFinance(c.Id)!;
        Assert.NotNull(f.Rating);
        Assert.Equal(new GameDate(2027, 3).AsMonthIndex(), f.RatedAt);
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.CreditRatingChanged && e.OldRating == "NR");
        Assert.True(world.GetCreditProfile(c.Id).Seasoned);
    }

    [Fact]
    public void A_small_debt_free_company_is_capped_by_size()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 14; i++) world.AdvanceMonth();
        var f = world.GetCompanyFinance(c.Id)!;
        var assets = world.GetBalanceSheet(c.Id).TotalAssets;
        Assert.True(f.Rating >= CreditRatings.SizeCap(assets));
    }

    [Fact]
    public void Movement_is_capped_at_two_notches_per_review()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 14; i++) world.AdvanceMonth();
        var f = world.GetCompanyFinance(c.Id)!;

        // Pretend the last review said AAA; a company this size computes far worse.
        f.UnderlyingRating = CreditRating.AAA;
        f.Rating = CreditRating.AAA;
        FinanceTick.Review(world, f, world.Clock.Now);
        Assert.Equal(CreditRating.APlus, f.Rating);
        FinanceTick.Review(world, f, world.Clock.Now);
        Assert.Equal(CreditRating.AMinus, f.Rating);
    }

    [Fact]
    public void The_post_cure_cap_holds_the_rating_at_b_minus()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 14; i++) world.AdvanceMonth();
        var f = world.GetCompanyFinance(c.Id)!;
        f.UnderlyingRating = CreditRating.BMinus;
        f.RatingCapUntil = world.Clock.Now.AsMonthIndex() + 6;
        FinanceTick.Review(world, f, world.Clock.Now);
        Assert.True(f.Rating >= CreditRating.BMinus);
    }

    [Fact]
    public void Ratings_price_loans_and_size_the_credit_line()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 14; i++) world.AdvanceMonth();
        var profile = world.GetCreditProfile(c.Id);
        Assert.Equal(profile.Rating!.Value, profile.PricingRating);
        Assert.Equal(world.TermLoanRate(profile.PricingRating, 60), world.QuoteLoan(c.Id, 1_000m, 60).AnnualRate);
        Assert.Equal(world.RevolverRate(profile.PricingRating), profile.RevolverRate);
        // Seasoned: capacity is bounded by cash-flow capacity too (an EBITDA-negative store gets none).
        Assert.True(profile.DebtCapacity <= profile.Collateral);
        Assert.True(profile.EbitdaTtm > 0m || profile.DebtCapacity == 0m);
        _ = world.FinanceEvents.Count(e => e.Kind == FinanceEventKind.CreditRatingChanged);
    }
}
