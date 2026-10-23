using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>The revolver, distress, cure and bankruptcy (econ-audit §4.10, §4.14, R14).</summary>
public sealed class SolvencyTests
{
    /// <summary>Overdraw the company far beyond any revolver it could have.</summary>
    private static void Overdraw(World world, Company c, decimal by = 5_000_000m)
        => BookProfit(world, c.Id, -(c.Cash + by + world.GetCreditProfile(c.Id).RevolverLimit * 2m));

    [Fact]
    public void The_revolver_replaces_negative_cash_up_to_its_limit()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var limit = world.GetCreditProfile(c.Id).RevolverLimit;
        Assert.True(limit > 0m);
        BookProfit(world, c.Id, -(c.Cash + limit / 2m));
        world.AdvanceMonth();
        Invariants.AssertAll(world);

        Assert.True(c.Cash >= 0m);
        var f = world.GetCompanyFinance(c.Id)!;
        Assert.True(f.RevolverDrawn > 0m && f.RevolverDrawn <= world.GetCreditProfile(c.Id).RevolverLimit + 0.01m);
        Assert.Equal(SolvencyState.Solvent, f.State);
        Assert.Equal(f.RevolverDrawn, world.GetBalanceSheet(c.Id).Revolver);
        Assert.Equal(world.GetBalanceSheet(c.Id).Liabilities, world.GetBalanceSheet(c.Id).Revolver);

        // Surplus cash sweeps the revolver back down; interest accrues on the opening balance.
        // The sweep keeps RevolverSweepBufferMonths of fixed costs on hand, so the surplus is sized
        // from the content's real running costs (2026-USD content, E1) rather than a literal.
        var profile = world.GetCreditProfile(c.Id);
        var buffer = world.Rules.Finance.RevolverSweepBufferMonths * profile.MonthlyFixedCosts;
        BookProfit(world, c.Id, f.RevolverDrawn + 3m * buffer + 10_000_000m);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.Equal(0m, f.RevolverDrawn);
        Assert.True(Sum(world, c.Id, LedgerCategory.InterestExpense) < 0m);
        Assert.Contains(world.Ledger.EntriesFor(c.Id), e => e.Category == LedgerCategory.RevolverRepay);
    }

    [Fact]
    public void Default_puts_the_company_in_distress_in_the_same_tick()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        Overdraw(world, c);
        world.AdvanceMonth();
        Invariants.AssertAll(world);

        var s = world.GetSolvency(c.Id);
        Assert.Equal(SolvencyState.Distress, s.State);
        Assert.Equal(world.Clock.Now, s.DistressSince);
        Assert.Equal(3, s.CureMonthsLeft);
        Assert.Equal(CreditRating.D, world.GetCompanyFinance(c.Id)!.Rating);
        Assert.Equal(CreditRating.D, world.GetCreditProfile(c.Id).PricingRating);
        Assert.False(world.CanInvest(c.Id));
        Assert.Equal(FinanceErrorCode.Distressed, Assert.Throws<FinanceException>(() => world.EnsureCanInvest(c.Id)).Code);
        Assert.Equal(FinanceErrorCode.Distressed, world.QuoteLoan(c.Id, 1m, 12).Refusal);
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.DistressEntered && e.Company == c.Id);
        Assert.Contains(world.NewsLog, n => n.EventId == "finance_default");

        // Penalty interest on the overdrawn balance next month.
        world.AdvanceMonth();
        Assert.Contains(world.Ledger.EntriesFor(c.Id), e => e.Category == LedgerCategory.DistressInterest);
    }

    [Fact]
    public void A_clean_month_cures_and_caps_the_rating()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        Overdraw(world, c);
        world.AdvanceMonth();
        Assert.True(world.IsInDistress(c.Id));

        BookProfit(world, c.Id, -c.Cash + 50_000_000m);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        var f = world.GetCompanyFinance(c.Id)!;
        Assert.Equal(SolvencyState.Solvent, f.State);
        Assert.True(f.Rating >= CreditRating.CCC);
        Assert.Equal(world.Clock.Now.AsMonthIndex() + 12, f.RatingCapUntil);
        Assert.True(world.CanInvest(c.Id));
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.DistressCured);
    }

    [Fact]
    public void An_uncured_default_is_liquidated_after_the_cure_window()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        world.RegisterAi(c.Id, new AdaptiveStrategy());
        Overdraw(world, c);
        world.AdvanceMonth(); // distress
        world.AdvanceMonth(); // 1
        world.AdvanceMonth(); // 2
        Assert.True(world.IsInDistress(c.Id));
        world.AdvanceMonth(); // 3 → bankrupt
        Invariants.AssertAll(world);

        var s = world.GetSolvency(c.Id);
        Assert.Equal(SolvencyState.Bankrupt, s.State);
        Assert.Equal(world.Clock.Now, s.BankruptAt);
        Assert.Empty(c.OwnedBuildings);
        Assert.DoesNotContain(world.Buildings.Values, b => b.Owner == c.Id);
        Assert.True(world.RetiredBuildings.ContainsKey(store.Id));
        Assert.Contains(world.Ledger.EntriesFor(c.Id), e => e.Category == LedgerCategory.LiquidationProceeds && e.Building == store.Id);
        Assert.False(world.TryGetAiStrategy(c.Id, out _));
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.Bankruptcy && e.Company == c.Id);
        Assert.True(c.Cash >= 0m);

        // The dead company is skipped from now on.
        var entries = world.Ledger.EntriesFor(c.Id).Count();
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        Assert.Equal(entries, world.Ledger.EntriesFor(c.Id).Count());
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Liquidation_repays_the_revolver_before_term_loans_and_leaves_the_shortfall_with_lenders()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var loan = world.TakeLoan(c.Id, FinanceMath.Cents(world.GetCreditProfile(c.Id).NewTermLoanMax / 2m), 60);
        BookProfit(world, c.Id, -c.Cash + 1m);
        world.AdvanceMonth(); // instalment + opex overdraw → revolver draws, likely within limit
        Overdraw(world, c);
        for (var i = 0; i < 4 && !world.IsBankrupt(c.Id); i++) world.AdvanceMonth();
        Assert.True(world.IsBankrupt(c.Id));
        Invariants.AssertAll(world);

        var bankruptMonth = world.GetSolvency(c.Id).BankruptAt!.Value;
        var liquidation = world.Ledger.EntriesFor(c.Id).Where(e => e.Date == bankruptMonth).ToList();
        var firstProceeds = liquidation.FindIndex(e => e.Category == LedgerCategory.LiquidationProceeds);
        var firstRevolverRepay = liquidation.FindLastIndex(e => e.Category == LedgerCategory.RevolverRepay);
        var firstLoanRepay = liquidation.FindIndex(e => e.Category == LedgerCategory.LoanRepayment && e.Memo!.StartsWith("liquidation", System.StringComparison.Ordinal));
        Assert.True(firstProceeds >= 0);
        if (firstLoanRepay >= 0 && firstRevolverRepay >= 0) Assert.True(firstRevolverRepay < firstLoanRepay);

        // Whatever the proceeds did not cover stays as debt; equity carries the loss; books close.
        var bs = world.GetBalanceSheet(c.Id);
        Assert.Equal(0m, bs.Cash);
        Assert.Equal(bs.TermLoans + bs.Revolver, bs.Liabilities);
        Assert.True(bs.Equity <= 0m);
        Assert.True(loan.Outstanding < loan.Principal);
    }

    [Fact]
    public void Negative_equity_at_a_quarter_end_is_bankruptcy()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        var f = world.FinanceOf(c.Id);
        var huge = world.GetBalanceSheet(c.Id).TotalAssets * 3m;
        world.RecordCashChange(c.Id, LedgerCategory.RevolverDraw, huge, "test: unsecured bank debt");
        f.RevolverDrawn += huge;
        BookProfit(world, c.Id, -huge);
        world.AdvanceMonth(); // Feb: not a quarter end
        Assert.False(world.IsBankrupt(c.Id));
        world.AdvanceMonth(); // Mar: quarter end
        Assert.True(world.IsBankrupt(c.Id));
        Assert.Contains("liabilities exceeded", world.GetSolvency(c.Id).Reason);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void A_missed_instalment_is_a_default()
    {
        var world = World(FinanceOnly(FinanceRules.Realistic with { Revolver = false }));
        var (c, _) = CompanyWithStore(world);
        var loan = world.TakeLoan(c.Id, 10_000m, 12);
        BookProfit(world, c.Id, -c.Cash);
        world.AdvanceMonth();
        Assert.Equal(1, loan.MissedPayments);
        Assert.True(world.IsInDistress(c.Id));
        Assert.Contains(world.FinanceEvents, e => e.Kind == FinanceEventKind.LoanPaymentMissed && e.LoanId == loan.Id);
        Assert.DoesNotContain(world.Ledger.EntriesFor(c.Id), e => e.Category == LedgerCategory.LoanRepayment);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Without_solvency_rules_negative_cash_is_tolerated()
    {
        var world = World(FinanceOnly(FinanceRules.Realistic with { Solvency = false, Revolver = false }));
        var (c, _) = CompanyWithStore(world);
        Overdraw(world, c);
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        Assert.True(c.Cash < 0m);
        Assert.Equal(SolvencyState.Solvent, world.GetSolvency(c.Id).State);
    }
}
