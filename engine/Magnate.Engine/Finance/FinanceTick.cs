using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>
/// The monthly finance mechanics (econ-audit §4.16 steps 13–17), called by the tick steps of the
/// same names. Companies are processed in ascending id order; bankrupt companies are skipped.
/// </summary>
internal static class FinanceTick
{
    private static IEnumerable<Company> LiveCompanies(World world)
        => world.Companies.Values.Where(c => !world.IsBankrupt(c.Id)).OrderBy(c => c.Id.Value).ToList();

    // ------------------------------------------------------------------ step 13: finance

    /// <summary>
    /// Interest and scheduled amortisation: distress interest on a negative balance, revolver
    /// interest on the opening balance, then each term loan's instalment. An instalment the
    /// company cannot fund from cash plus revolver headroom is missed (a default trigger).
    /// </summary>
    public static void Interest(World world, GameDate now)
    {
        var rules = world.Rules.Finance;
        foreach (var company in LiveCompanies(world))
        {
            var f = world.FinanceOf(company.Id);
            f.MissedPaymentThisTick = false;

            if (f.InDistress && company.Cash < 0m && rules.DistressMonthlyRate > 0m)
            {
                var penalty = FinanceMath.Cents(-company.Cash * rules.DistressMonthlyRate);
                if (penalty > 0m) world.RecordCashChange(company.Id, LedgerCategory.DistressInterest, -penalty, "distress interest on overdrawn cash");
            }

            if (f.RevolverDrawn <= 0m && f.Loans.Count == 0) continue;

            var metrics = world.CreditInputs(company.Id, f);
            var pricing = world.PricingRating(f, metrics, forInterest: true);
            if (f.RevolverDrawn > 0m)
            {
                var interest = FinanceMath.MonthlyInterest(f.RevolverDrawn, world.RevolverRate(pricing));
                if (interest > 0m) world.RecordCashChange(company.Id, LedgerCategory.InterestExpense, -interest, "revolver interest");
            }

            if (f.Loans.Count == 0) continue;
            var capacity = world.DebtCapacity(f, metrics);
            var limit = world.RevolverLimit(capacity, f.TermDebt, metrics.TotalAssets);
            foreach (var loan in f.Loans.ToList())
            {
                var interest = FinanceMath.MonthlyInterest(loan.Outstanding, loan.AnnualRate);
                var principal = loan.MonthsRemaining <= 1 ? loan.Outstanding : Math.Min(loan.Outstanding, Math.Max(0m, loan.MonthlyPayment - interest));
                var due = interest + principal;
                var headroom = rules.Revolver ? Math.Max(0m, limit - f.RevolverDrawn) : 0m;
                if (rules.Solvency && company.Cash + headroom < due)
                {
                    loan.MissedPayments++;
                    f.MissedPaymentThisTick = true;
                    world.AddFinanceEvent(company.Id, FinanceEventKind.LoanPaymentMissed,
                        $"Missed the {due:N0} payment on loan #{loan.Id}", due, loanId: loan.Id);
                    continue;
                }

                if (interest > 0m) world.RecordCashChange(company.Id, LedgerCategory.InterestExpense, -interest, $"interest on term loan #{loan.Id}");
                if (principal > 0m) world.RecordCashChange(company.Id, LedgerCategory.LoanRepayment, -principal, $"amortisation of term loan #{loan.Id}");
                loan.Outstanding -= principal;
                loan.MonthsRemaining = Math.Max(0, loan.MonthsRemaining - 1);
                if (loan.Outstanding <= 0m)
                {
                    loan.Outstanding = 0m;
                    f.Loans.Remove(loan);
                    world.AddFinanceEvent(company.Id, FinanceEventKind.LoanRepaid, $"Loan #{loan.Id} repaid in full", loan.Principal, loanId: loan.Id);
                }
            }
        }
    }

    // ------------------------------------------------------------------ step 14: depreciation

    /// <summary>
    /// Straight-line depreciation (§4.8): schedule any newly capitalised cost, then book each
    /// building's monthly charge as one <see cref="AccrualKind.Depreciation"/> entry.
    /// </summary>
    public static void Depreciation(World world, IReadOnlyList<BuildingInstance> buildings, GameDate now)
    {
        var month = now.AsMonthIndex();
        var register = world.AssetRegister;
        foreach (var building in buildings)
        {
            if (!world.Buildings.ContainsKey(building.Id) || world.IsBankrupt(building.Owner)) continue;
            register.Reconcile(building, world.Catalog.BuildingType(building.TypeId), month);
            var record = register.Find(building.Id);
            if (record is null || record.Components.Count == 0) continue;

            decimal total = 0m;
            foreach (var component in record.Components)
            {
                var charge = component.ChargeFor(month);
                if (charge <= 0m) continue;
                component.Accumulated += charge;
                total += charge;
            }

            if (total > 0m)
            {
                world.RecordAccrual(building.Owner, AccrualKind.Depreciation, -total, $"depreciation {building.TypeId} ({building.Id})", building.Id);
            }
        }
    }

    // ------------------------------------------------------------------ step 15: tax

    /// <summary>
    /// Fold every P&amp;L entry recognised since the last tax step into one window per company, settle
    /// income tax year to date (§4.9), and append the window to the company's history.
    /// </summary>
    public static void Tax(World world, GameDate now)
    {
        var state = world.FinanceState;
        var windows = new Dictionary<CompanyId, Window>();
        Window W(CompanyId c)
        {
            if (!windows.TryGetValue(c, out var w))
            {
                w = new Window();
                windows[c] = w;
            }

            return w;
        }

        var ledger = world.Ledger.Entries;
        for (var i = state.LedgerCursor; i < ledger.Count; i++)
        {
            var e = ledger[i];
            switch (LedgerCategoryInfo.Of(e.Category).Section)
            {
                case StatementSection.Revenue:
                    W(e.Company).Revenue += e.Amount;
                    break;
                case StatementSection.OperatingExpense:
                    W(e.Company).Opex += -e.Amount;
                    break;
                case StatementSection.NonOperating:
                    if (e.Category == LedgerCategory.InterestIncome) W(e.Company).OtherNonOperating += e.Amount;
                    else W(e.Company).Interest += -e.Amount;
                    break;
                case StatementSection.IncomeTax:
                    W(e.Company).Tax += -e.Amount;
                    break;
            }
        }

        var cogs = world.CogsLog.Entries;
        for (var i = state.CogsCursor; i < cogs.Count; i++) W(cogs[i].Company).Cogs += cogs[i].Cost;

        var accruals = world.AccrualJournal.Entries;
        for (var i = state.AccrualCursor; i < accruals.Count; i++)
        {
            var a = accruals[i];
            switch (a.Kind)
            {
                case AccrualKind.Depreciation:
                    W(a.Company).Depreciation += -a.Amount;
                    break;
                case AccrualKind.InventoryWriteDown:
                    W(a.Company).Cogs += -a.Amount;
                    break;
                default:
                    W(a.Company).OtherNonOperating += a.Amount;
                    break;
            }
        }

        var rules = world.Rules.Finance;
        foreach (var company in LiveCompanies(world))
        {
            var f = world.FinanceOf(company.Id);
            var w = windows.TryGetValue(company.Id, out var found) ? found : new Window();
            if (f.TaxYear != now.Year)
            {
                // A year boundary the December roll did not see (first window of a legacy save).
                f.TaxYear = now.Year;
                f.TaxableIncomeYtd = 0m;
                f.TaxPaidYtd = 0m;
            }

            var preTax = w.PreTax;
            f.TaxableIncomeYtd += preTax;
            var payment = 0m;
            if (rules.IncomeTaxRate > 0m)
            {
                var positive = Math.Max(0m, f.TaxableIncomeYtd);
                var nolUse = Math.Min(f.NolOpen, rules.LossCarryForwardCap * positive);
                var due = FinanceMath.Cents(rules.IncomeTaxRate * Math.Max(0m, f.TaxableIncomeYtd - nolUse));
                payment = due - f.TaxPaidYtd;
                if (payment != 0m)
                {
                    world.RecordCashChange(company.Id, LedgerCategory.IncomeTax, -payment,
                        payment > 0m ? $"income tax {now.Year} (year to date)" : $"income tax refund {now.Year} (year to date)");
                    f.TaxPaidYtd += payment;
                }

                if (now.Month == 12) f.NolOpen = f.NolOpen - nolUse + Math.Max(0m, -f.TaxableIncomeYtd);
            }

            if (now.Month == 12)
            {
                f.TaxYear = now.Year + 1;
                f.TaxableIncomeYtd = 0m;
                f.TaxPaidYtd = 0m;
            }

            f.AppendHistory(new PeriodResult(
                now.AsMonthIndex(),
                w.Revenue,
                w.Ebitda,
                w.Ebit,
                w.Interest,
                preTax,
                w.Tax + payment,
                w.Opex));
        }

        state.LedgerCursor = world.Ledger.Entries.Count;
        state.CogsCursor = world.CogsLog.Entries.Count;
        state.AccrualCursor = world.AccrualJournal.Entries.Count;
    }

    private sealed class Window
    {
        public decimal Revenue;
        public decimal Cogs;
        public decimal Opex;
        public decimal Depreciation;
        public decimal Interest;
        public decimal OtherNonOperating;
        public decimal Tax;

        public decimal Ebitda => Revenue - Cogs - Opex;

        public decimal Ebit => Ebitda - Depreciation;

        public decimal PreTax => Ebit - Interest + OtherNonOperating;
    }

    // ------------------------------------------------------------------ step 16: quarter end

    /// <summary>Quarterly credit review (§4.10) and the quarter-end operating-asset snapshot for ROIC.</summary>
    public static void QuarterEnd(World world, GameDate now)
    {
        var rules = world.Rules.Finance;
        foreach (var company in LiveCompanies(world))
        {
            var f = world.FinanceOf(company.Id);
            var bs = world.GetBalanceSheet(company.Id);
            f.AppendQuarterOperatingAssets(bs.Equity - (bs.Cash - bs.Liabilities));
            if (!rules.CreditRating) continue;
            Review(world, f, now);
        }
    }

    /// <summary>One rating review: compute, cap the move, publish a change.</summary>
    internal static void Review(World world, CompanyFinance f, GameDate now)
    {
        var rules = world.Rules.Finance;
        var m = world.CreditInputs(f.Company, f);
        var month = now.AsMonthIndex();
        var before = f.Rating;
        if (m.AgeMonths < rules.SeasoningMonths)
        {
            return;
        }

        var computed = Compute(world, f, m);
        if (f.RatingCapUntil is int until && month < until) computed = CreditRatings.Worse(computed, CreditRating.BMinus);
        if (f.UnderlyingRating is { } previous && rules.MaxRatingMovePerQuarter > 0)
        {
            var delta = Math.Clamp((int)computed - (int)previous, -rules.MaxRatingMovePerQuarter, rules.MaxRatingMovePerQuarter);
            computed = CreditRatings.Shift(previous, delta);
        }

        f.UnderlyingRating = computed;
        f.RatedAt = month;
        if (f.InDistress) return; // reported rating stays D until the cure

        f.Rating = computed;
        if (before != computed)
        {
            var oldLabel = before is { } b ? CreditRatings.Label(b) : "NR";
            var newLabel = CreditRatings.Label(computed);
            var direction = before is null ? "first rating" : (int)computed < (int)before ? "upgrade" : "downgrade";
            world.AddFinanceEvent(f.Company, FinanceEventKind.CreditRatingChanged,
                $"Credit rating {oldLabel} → {newLabel} ({direction})", oldRating: oldLabel, newRating: newLabel);
        }
    }

    /// <summary>
    /// The unconstrained rating (§4.10 steps 1–5): worst of interest cover, leverage, size cap and
    /// the negative-equity cap, one notch worse when cash plus revolver headroom is below a month
    /// of fixed costs.
    /// </summary>
    internal static CreditRating Compute(World world, CompanyFinance f, World.CreditMetrics m)
    {
        var netDebt = m.Debt - m.Cash;
        var rating = CreditRatings.FromInterestCoverage(m.EbitTtm, m.InterestTtm);
        rating = CreditRatings.Worse(rating, CreditRatings.FromLeverage(netDebt, m.EbitdaTtm, m.EbitTtm, m.InterestTtm));
        rating = CreditRatings.Worse(rating, CreditRatings.SizeCap(m.TotalAssets));
        if (m.Equity <= 0m) rating = CreditRatings.Worse(rating, CreditRating.CCC);

        var capacity = world.DebtCapacity(f, m);
        var limit = world.RevolverLimit(capacity, f.TermDebt, m.TotalAssets);
        var headroom = Math.Max(0m, limit - f.RevolverDrawn);
        if (m.Cash + headroom < m.FixedCosts) rating = CreditRatings.Shift(rating, 1);
        return rating;
    }

    // ------------------------------------------------------------------ step 17: solvency

    /// <summary>
    /// The liquidity waterfall (§4.10, §4.14): the revolver draws to cover negative cash (up to its
    /// limit), is paid down when over its limit, and sweeps surplus cash. Then the default test:
    /// negative cash with the revolver exhausted, or a missed instalment, puts the company in
    /// distress; a clean month cures it; an uncured default after the cure window — or equity
    /// below −20 % of assets at a quarter-end — is bankruptcy.
    /// </summary>
    public static void Solvency(World world, GameDate now, bool quarterEnd)
    {
        var rules = world.Rules.Finance;
        foreach (var company in LiveCompanies(world))
        {
            var f = world.FinanceOf(company.Id);
            if (rules.Revolver) Waterfall(world, company, f);
            if (!rules.Solvency) continue;

            var defaulted = company.Cash < 0m || f.MissedPaymentThisTick;
            f.MissedPaymentThisTick = false;
            switch (f.State)
            {
                case SolvencyState.Solvent when defaulted:
                    EnterDistress(world, company, f, now);
                    break;
                case SolvencyState.Distress when !defaulted:
                    Cure(world, company, f, now);
                    break;
                case SolvencyState.Distress:
                    f.DistressMonths++;
                    if (f.DistressMonths >= rules.CureMonths)
                    {
                        Liquidation.Run(world, company, f, now, "it could not cure its default within the cure window");
                        continue;
                    }

                    break;
            }

            if (quarterEnd && rules.BankruptcyEquityToAssets < 0m)
            {
                var bs = world.GetBalanceSheet(company.Id);
                if (bs.TotalAssets > 0m && bs.Equity < rules.BankruptcyEquityToAssets * bs.TotalAssets)
                {
                    Liquidation.Run(world, company, f, now, "its liabilities exceeded its assets by more than the lenders tolerate");
                }
            }
        }
    }

    private static void Waterfall(World world, Company company, CompanyFinance f)
    {
        var m = world.CreditInputs(company.Id, f);
        var capacity = world.DebtCapacity(f, m);
        var limit = world.RevolverLimit(capacity, f.TermDebt, m.TotalAssets);
        if (company.Cash < 0m)
        {
            var draw = Math.Min(-company.Cash, Math.Max(0m, limit - f.RevolverDrawn));
            if (draw > 0m)
            {
                world.RecordCashChange(company.Id, LedgerCategory.RevolverDraw, draw, "revolver draw (covers overdrawn cash)");
                f.RevolverDrawn += draw;
            }

            return;
        }

        if (f.RevolverDrawn <= 0m) return;
        var repay = 0m;
        if (f.RevolverDrawn > limit) repay = Math.Min(f.RevolverDrawn - limit, company.Cash);
        var buffer = world.Rules.Finance.RevolverSweepBufferMonths * m.FixedCosts;
        var surplus = company.Cash - repay - buffer;
        if (surplus > 0m) repay += Math.Min(surplus, f.RevolverDrawn - repay);
        repay = FinanceMath.Cents(Math.Min(repay, f.RevolverDrawn));
        if (repay > 0m)
        {
            world.RecordCashChange(company.Id, LedgerCategory.RevolverRepay, -repay, "revolver repayment (cash sweep)");
            f.RevolverDrawn -= repay;
        }
    }

    private static void EnterDistress(World world, Company company, CompanyFinance f, GameDate now)
    {
        f.State = SolvencyState.Distress;
        f.DistressSince = now.AsMonthIndex();
        f.DistressMonths = 0;
        var old = f.Rating is { } r ? CreditRatings.Label(r) : "NR";
        f.Rating = CreditRating.D;
        var shortfall = company.Cash < 0m ? -company.Cash : (decimal?)null;
        var cure = world.Rules.Finance.CureMonths;
        world.AddFinanceEvent(company.Id, FinanceEventKind.DistressEntered,
            $"{company.Name} defaulted: cash is overdrawn and the credit line is exhausted. {cure} months to cure before bankruptcy.",
            shortfall);
        world.AddFinanceEvent(company.Id, FinanceEventKind.CreditRatingChanged, $"Credit rating {old} → D (default)", oldRating: old, newRating: "D");
        world.PublishFinanceNews("finance_default", $"{company.Name} defaults on its lenders", EventSeverity.Notable);
    }

    private static void Cure(World world, Company company, CompanyFinance f, GameDate now)
    {
        var rules = world.Rules.Finance;
        f.State = SolvencyState.Solvent;
        f.DistressSince = null;
        f.DistressMonths = 0;
        var m = world.CreditInputs(company.Id, f);
        var rating = CreditRatings.Worse(Compute(world, f, m), CreditRating.CCC);
        f.Rating = rating;
        f.UnderlyingRating = rating;
        f.RatedAt = now.AsMonthIndex();
        f.RatingCapUntil = now.AsMonthIndex() + rules.PostCureRatingCapMonths;
        world.AddFinanceEvent(company.Id, FinanceEventKind.DistressCured, $"{company.Name} cured its default");
        world.AddFinanceEvent(company.Id, FinanceEventKind.CreditRatingChanged,
            $"Credit rating D → {CreditRatings.Label(rating)} (default cured)", oldRating: "D", newRating: CreditRatings.Label(rating));
    }
}
