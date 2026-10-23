using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Term loans and borrowing capacity (econ-audit §4.10, R10).</summary>
public sealed class LoanTests
{
    [Fact]
    public void A_company_without_collateral_cannot_borrow()
    {
        var world = World();
        var c = world.CreateCompany("Cashbox", 50_000_000m);
        var profile = world.GetCreditProfile(c.Id);
        Assert.Equal(0m, profile.NewTermLoanMax);
        Assert.Equal(0m, profile.RevolverLimit);
        var ex = Assert.Throws<FinanceException>(() => world.TakeLoan(c.Id, 1_000_000m, 36));
        Assert.Equal(FinanceErrorCode.CreditLimitExceeded, ex.Code);
        Assert.Equal(0m, ex.Limit);
    }

    [Fact]
    public void A_young_company_borrows_half_its_collateral_priced_as_unrated_bbb()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        var profile = world.GetCreditProfile(c.Id);

        // Unscheduled store cost counts as structure (60 % advance), half of it for a young company.
        Assert.Equal(FinanceMath.Cents(0.60m * store.CapitalizedCost), profile.Collateral);
        Assert.Equal(FinanceMath.Cents(0.5m * profile.Collateral), profile.DebtCapacity);
        Assert.False(profile.Seasoned);
        Assert.Null(profile.Rating);
        Assert.Equal(CreditRating.BBB, profile.PricingRating);
        Assert.Equal("NR", profile.RatingLabel);
        Assert.True(profile.NewTermLoanMax > 0m);
    }

    [Fact]
    public void Taking_a_loan_books_drawdown_and_liability_and_amortises_monthly()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var amount = FinanceMath.Cents(world.GetCreditProfile(c.Id).NewTermLoanMax / 2m);
        var cashBefore = c.Cash;

        var loan = world.TakeLoan(c.Id, amount, 36);
        Assert.Equal(cashBefore + amount, c.Cash);
        Assert.Equal(world.TermLoanRate(CreditRating.BBB, 36), loan.AnnualRate);
        Assert.Equal(FinanceMath.AnnuityPayment(amount, loan.AnnualRate, 36), loan.MonthlyPayment);
        var bs = world.GetBalanceSheet(c.Id);
        Assert.Equal(amount, bs.Liabilities);
        Assert.Equal(amount, bs.TermLoans);
        Assert.Equal(1, world.GetCompanyFinance(c.Id)!.LoansTaken);
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.LoanTaken && e.LoanId == loan.Id);

        var expectedInterest = FinanceMath.MonthlyInterest(amount, loan.AnnualRate);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.Equal(-expectedInterest, Sum(world, c.Id, LedgerCategory.InterestExpense));
        Assert.Equal(-(loan.MonthlyPayment - expectedInterest), Sum(world, c.Id, LedgerCategory.LoanRepayment));
        Assert.Equal(35, loan.MonthsRemaining);
        Assert.Equal(world.GetBalanceSheet(c.Id).Liabilities, loan.Outstanding);
    }

    [Fact]
    public void A_loan_is_repaid_exactly_by_its_schedule()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var amount = FinanceMath.Cents(world.GetCreditProfile(c.Id).NewTermLoanMax / 3m);
        var loan = world.TakeLoan(c.Id, amount, 12);
        for (var i = 0; i < 12; i++)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }

        Assert.True(loan.IsRepaid);
        Assert.Empty(world.GetLoans(c.Id));
        Assert.Equal(-amount, Sum(world, c.Id, LedgerCategory.LoanRepayment));
        Assert.Equal(0m, world.GetBalanceSheet(c.Id).TermLoans);
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.LoanRepaid && e.LoanId == loan.Id);
    }

    [Fact]
    public void Prepayment_reamortises_and_full_prepayment_closes_the_loan()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var amount = FinanceMath.Cents(world.GetCreditProfile(c.Id).NewTermLoanMax / 2m);
        var loan = world.TakeLoan(c.Id, amount, 60);
        var before = loan.MonthlyPayment;
        world.RepayLoan(c.Id, loan.Id, 1_000m);
        Assert.Equal(amount - 1_000m, loan.Outstanding);
        Assert.True(loan.MonthlyPayment < before);
        world.RepayLoan(c.Id, loan.Id, 10_000_000m);
        Assert.True(loan.IsRepaid);
        Assert.Empty(world.GetLoans(c.Id));
        Assert.Equal(0m, world.GetBalanceSheet(c.Id).Liabilities);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Repaying_an_unknown_loan_or_without_cash_is_refused()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        Assert.Equal(FinanceErrorCode.LoanNotFound, Assert.Throws<FinanceException>(() => world.RepayLoan(c.Id, 99, 1m)).Code);
        var loan = world.TakeLoan(c.Id, 10_000m, 24);
        Assert.Equal(FinanceErrorCode.InvalidArgument, Assert.Throws<FinanceException>(() => world.RepayLoan(c.Id, loan.Id, 0m)).Code);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(241)]
    public void Terms_outside_the_allowed_range_are_refused(int months)
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var quote = world.QuoteLoan(c.Id, 10_000m, months);
        Assert.False(quote.Allowed);
        Assert.Equal(FinanceErrorCode.InvalidArgument, quote.Refusal);
    }

    [Fact]
    public void Classic_rules_offer_no_credit()
    {
        var world = Worlds.Live();
        var c = world.CreateCompany("Old", 10_000_000m);
        world.Construct(c.Id, Supermarket, Metropolis);
        Assert.Equal(FinanceErrorCode.FeatureDisabled, Assert.Throws<FinanceException>(() => world.TakeLoan(c.Id, 1m, 12)).Code);
        Assert.Equal(0m, world.GetCreditProfile(c.Id).RevolverLimit);
    }

    [Fact]
    public void Quote_reports_total_interest_and_the_rate_ladder_by_term()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var shortQ = world.QuoteLoan(c.Id, 100_000m, 12);
        var longQ = world.QuoteLoan(c.Id, 100_000m, 120);
        Assert.True(shortQ.Allowed);
        Assert.True(longQ.AnnualRate > shortQ.AnnualRate);
        Assert.True(longQ.TotalInterest > shortQ.TotalInterest);
        Assert.InRange(longQ.TotalInterest, longQ.MonthlyPayment * 120 - 100_000m - 1m, longQ.MonthlyPayment * 120 - 100_000m + 1m);
    }

    [Fact]
    public void Queries_never_create_finance_state()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        _ = world.GetCreditProfile(c.Id);
        _ = world.QuoteLoan(c.Id, 1m, 12);
        _ = world.GetCorporateValue(c.Id);
        _ = world.GetSolvency(c.Id);
        _ = world.GetTaxPosition(c.Id);
        Assert.Null(world.GetCompanyFinance(c.Id));
    }

    [Fact]
    public void Term_loans_can_be_switched_off_independently()
    {
        var world = World(FinanceOnly(FinanceRules.Realistic with { TermLoans = false }));
        var (c, _) = CompanyWithStore(world);
        Assert.Equal(0m, world.GetCreditProfile(c.Id).NewTermLoanMax);
        Assert.True(world.GetCreditProfile(c.Id).RevolverLimit > 0m);
        Assert.Equal(FinanceErrorCode.FeatureDisabled, Assert.Throws<FinanceException>(() => world.TakeLoan(c.Id, 1m, 12)).Code);
        Assert.DoesNotContain(world.Ledger.Entries, e => e.Category == LedgerCategory.LoanDrawdown);
        _ = world.Companies.Values.Single();
    }
}
