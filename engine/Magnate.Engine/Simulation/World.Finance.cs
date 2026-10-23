using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;

namespace Magnate.Engine.Simulation;

// Corporate finance (econ-audit §4.8–§4.11, §4.14, §4.18): fixed-asset register, term loans,
// the revolver, credit rating and borrowing capacity, tax position, solvency, disposals and the
// single company-value definition. The monthly mechanics live in Finance/FinanceTick.cs and are
// driven by the Finance/Depreciation/Tax/QuarterEnd/Solvency tick steps. Every public query is
// read-only (it never creates state), so asking about a company cannot change a save.
public sealed partial class World
{
    private readonly FinanceState _finance = new();

    /// <summary>The finance area's state (empty in Classic).</summary>
    internal FinanceState FinanceState => _finance;

    /// <summary>Everything noteworthy the finance model did, in order (loans, ratings, distress, disposals).</summary>
    public IReadOnlyList<FinanceEvent> FinanceEvents => _finance.Events;

    /// <summary>
    /// Buildings that have left their owner (sold, demolished, liquidated), keyed by id. Ledger
    /// entries from their working life still name them.
    /// </summary>
    public IReadOnlyDictionary<BuildingInstanceId, BuildingInstance> RetiredBuildings => _finance.Retired;

    /// <summary>The fixed-asset register (land, CIP, depreciation schedules).</summary>
    public AssetRegister AssetRegister => _finance.Assets;

    /// <summary>The company's finance state, or null before the finance model first touched it.</summary>
    public CompanyFinance? GetCompanyFinance(CompanyId company)
    {
        RequireCompany(company);
        return _finance.Companies.TryGetValue(company, out var f) ? f : null;
    }

    /// <summary>The company's finance state, created on first use (mutating paths only).</summary>
    internal CompanyFinance FinanceOf(CompanyId company)
    {
        if (_finance.Companies.TryGetValue(company, out var f)) return f;
        RequireCompany(company);
        var founded = Clock.Now.AsMonthIndex();
        foreach (var e in Ledger.EntriesFor(company))
        {
            founded = e.Date.AsMonthIndex();
            break;
        }

        f = new CompanyFinance(company, founded) { TaxYear = Clock.Now.Year };
        _finance.Companies[company] = f;
        return f;
    }

    // ------------------------------------------------------------------ fixed-asset register API (E3b)

    /// <summary>Land cost recorded for a building (0 when none).</summary>
    public decimal GetLandCost(BuildingInstanceId building) => _finance.Assets.LandOf(building);

    /// <summary>Construction in progress recorded for a building (0 when none).</summary>
    public decimal GetConstructionInProgress(BuildingInstanceId building) => _finance.Assets.CipOf(building);

    /// <summary>
    /// Capitalise land bought for <paramref name="building"/>'s plot (econ-audit §4.8). The caller
    /// books the cash (<see cref="LedgerCategory.LandPurchase"/>); this records the asset so the
    /// balance sheet closes. Land is never depreciated.
    /// </summary>
    internal void CapitalizeLand(BuildingInstanceId building, decimal cost)
    {
        RequireBuilding(building);
        if (cost < 0m) throw new ArgumentOutOfRangeException(nameof(cost), "land cost must be >= 0");
        if (cost == 0m) return;
        _finance.Assets.For(building).Land += cost;
    }

    /// <summary>
    /// Add a construction deposit or progress payment to <paramref name="building"/>'s
    /// construction in progress (econ-audit §4.12). The caller books the cash
    /// (<see cref="LedgerCategory.ConstructionPayment"/>).
    /// </summary>
    internal void AddConstructionInProgress(BuildingInstanceId building, decimal amount)
    {
        RequireBuilding(building);
        if (amount < 0m) throw new ArgumentOutOfRangeException(nameof(amount), "CIP additions must be >= 0");
        if (amount == 0m) return;
        _finance.Assets.For(building).ConstructionInProgress += amount;
    }

    /// <summary>
    /// Construction finished: move the building's CIP into PP&amp;E
    /// (<see cref="BuildingInstance.CapitalizedCost"/>). The next depreciation step splits it into
    /// structure and fixtures components and charges from the following month. Returns the
    /// amount transferred.
    /// </summary>
    internal decimal CompleteConstruction(BuildingInstanceId building)
    {
        var b = RequireBuilding(building);
        var record = _finance.Assets.Find(building);
        if (record is null || record.ConstructionInProgress == 0m) return 0m;
        var cip = record.ConstructionInProgress;
        record.ConstructionInProgress = 0m;
        b.CapitalizedCost += cip;
        // Schedule the components now, starting next month: a building completed inside a tick
        // (construction step) must not take a depreciation charge in that same tick (§4.8).
        _finance.Assets.Reconcile(b, Catalog.BuildingType(b.TypeId), Clock.Now.AsMonthIndex() + 1);
        return cip;
    }

    /// <summary>
    /// Cancelled construction (econ-audit §4.12): the caller books the recovered cash; this
    /// derecognises the CIP and journals the unrecovered part as a
    /// <see cref="AccrualKind.ConstructionWriteOff"/>. Returns the amount written off.
    /// </summary>
    internal decimal WriteOffConstruction(BuildingInstanceId building, decimal recovered)
    {
        var b = RequireBuilding(building);
        var record = _finance.Assets.Find(building);
        var cip = record?.ConstructionInProgress ?? 0m;
        if (recovered < 0m || recovered > cip) throw new ArgumentOutOfRangeException(nameof(recovered), "recovery must be within [0, CIP]");
        if (record is not null) record.ConstructionInProgress = 0m;
        var loss = cip - recovered;
        if (loss != 0m) RecordAccrual(b.Owner, AccrualKind.ConstructionWriteOff, -loss, $"construction cancelled ({building})", building);
        return loss;
    }

    /// <summary>
    /// Capitalise equipment bought for <paramref name="building"/> (production line, fields,
    /// mine or well equipment; ledger <see cref="LedgerCategory.EquipmentPurchase"/>, booked by
    /// the caller). It raises the building's gross PP&amp;E and is depreciated over
    /// <paramref name="lifeMonths"/> (default 10 years) from next month.
    /// </summary>
    internal void CapitalizeEquipment(BuildingInstanceId building, decimal cost, int? lifeMonths = null)
    {
        var b = RequireBuilding(building);
        if (cost < 0m) throw new ArgumentOutOfRangeException(nameof(cost), "equipment cost must be >= 0");
        if (cost == 0m) return;
        var type = Catalog.BuildingType(b.TypeId);
        var month = Clock.Now.AsMonthIndex() + 1;

        // Schedule the building's existing cost first so the equipment is not mistaken for an upgrade.
        _finance.Assets.Reconcile(b, type, month);
        b.CapitalizedCost += cost;
        _finance.Assets.For(building).Components.Add(
            new AssetComponent(AssetClass.Equipment, cost, lifeMonths ?? AssetClasses.DefaultEquipmentLifeMonths, month, "equipment"));
    }

    // ------------------------------------------------------------------ credit (§4.10)

    /// <summary>
    /// The company's credit standing: rating, borrowing capacity, revolver limit, pricing and the
    /// ratios behind them. Read-only.
    /// </summary>
    public CreditProfile GetCreditProfile(CompanyId company)
    {
        var c = RequireCompany(company);
        _finance.Companies.TryGetValue(company, out var f);
        var m = CreditInputs(company, f);
        var rules = Rules.Finance;
        var pricing = PricingRating(f, m, forInterest: true);
        var capacity = DebtCapacity(f, m);
        var termDebt = f?.TermDebt ?? 0m;
        var drawn = f?.RevolverDrawn ?? 0m;
        var revolverLimit = RevolverLimit(capacity, termDebt, m.TotalAssets);
        var newTerm = rules.Enabled && rules.TermLoans ? Math.Max(0m, Math.Floor(capacity - termDebt - drawn)) : 0m;
        var now = Clock.Now;
        var nextReview = now;
        do nextReview = nextReview.AddMonth(); while (nextReview.Month % 3 != 0);
        var nextPayment = f is null ? 0m : f.Loans.Sum(l => Math.Min(l.MonthlyPayment, l.Outstanding + FinanceMath.MonthlyInterest(l.Outstanding, l.AnnualRate)));

        _ = c;
        return new CreditProfile(
            company,
            f?.Rating,
            pricing,
            f?.RatedAt is int r ? FromMonthIndex(r) : null,
            nextReview,
            termDebt,
            drawn,
            revolverLimit,
            capacity,
            newTerm,
            m.Collateral,
            RevolverRate(pricing),
            rules.PolicyRate,
            m.EbitdaTtm,
            m.EbitTtm,
            m.InterestTtm,
            m.InterestTtm > 0m ? Math.Round(m.EbitTtm / m.InterestTtm, 4) : null,
            m.EbitdaTtm > 0m ? Math.Round((m.Debt - m.Cash) / m.EbitdaTtm, 4) : null,
            m.FixedCosts,
            nextPayment,
            m.AgeMonths >= rules.SeasoningMonths);
    }

    /// <summary>Annual rate of a new term loan of <paramref name="termMonths"/> at <paramref name="rating"/>.</summary>
    public decimal TermLoanRate(CreditRating rating, int termMonths)
        => Rules.Finance.PolicyRate + FinanceMath.TermPremium(termMonths) + CreditRatings.Spread(rating) + Rules.Finance.TermLoanMargin;

    /// <summary>Floating revolver rate at <paramref name="rating"/>.</summary>
    public decimal RevolverRate(CreditRating rating)
        => Rules.Finance.PolicyRate + CreditRatings.Spread(rating) + Rules.Finance.RevolverMargin;

    /// <summary>Quote a term loan without taking it.</summary>
    public LoanQuote QuoteLoan(CompanyId company, decimal amount, int termMonths)
    {
        var profile = GetCreditProfile(company);
        var rules = Rules.Finance;
        var rate = TermLoanRate(profile.PricingRating, Math.Max(1, termMonths));
        FinanceErrorCode? refusal = null;
        if (!rules.Enabled || !rules.TermLoans) refusal = FinanceErrorCode.FeatureDisabled;
        else if (!CanInvest(company)) refusal = FinanceErrorCode.Distressed;
        else if (termMonths < Math.Max(1, rules.MinLoanTermMonths) || termMonths > rules.MaxLoanTermMonths || amount <= 0m) refusal = FinanceErrorCode.InvalidArgument;
        else if (amount > profile.NewTermLoanMax) refusal = FinanceErrorCode.CreditLimitExceeded;

        var principal = Math.Max(0m, FinanceMath.Cents(amount));
        var payment = principal > 0m && termMonths > 0 ? FinanceMath.AnnuityPayment(principal, rate, termMonths) : 0m;
        var totalInterest = principal > 0m ? TotalInterest(principal, rate, termMonths, payment) : 0m;
        return new LoanQuote(principal, termMonths, rate, payment, totalInterest, profile.PricingRating, profile.NewTermLoanMax, refusal is null, refusal);
    }

    /// <summary>
    /// Draw an amortising term loan (econ-audit §4.10): fixed rate, level monthly payments from
    /// next month. Ledger <see cref="LedgerCategory.LoanDrawdown"/>.
    /// </summary>
    /// <exception cref="FinanceException">Disabled, distressed, out of range, or above capacity.</exception>
    public TermLoan TakeLoan(CompanyId company, decimal amount, int termMonths)
    {
        var quote = QuoteLoan(company, amount, termMonths);
        if (!quote.Allowed)
        {
            throw quote.Refusal switch
            {
                FinanceErrorCode.CreditLimitExceeded => new FinanceException(FinanceErrorCode.CreditLimitExceeded,
                    $"a {amount:N0} loan exceeds the {quote.MaxAmount:N0} lenders will extend", quote.MaxAmount),
                FinanceErrorCode.Distressed => new FinanceException(FinanceErrorCode.Distressed, "lenders refuse new credit to a company in default"),
                FinanceErrorCode.FeatureDisabled => new FinanceException(FinanceErrorCode.FeatureDisabled, "term loans are not available under these rules"),
                _ => new FinanceException(FinanceErrorCode.InvalidArgument,
                    $"loan amount must be positive and the term between {Rules.Finance.MinLoanTermMonths} and {Rules.Finance.MaxLoanTermMonths} months"),
            };
        }

        var f = FinanceOf(company);
        var loan = new TermLoan(_finance.NextLoanId++, company, quote.Amount, quote.AnnualRate, termMonths, quote.MonthlyPayment, Clock.Now);
        f.Loans.Add(loan);
        f.LoansTaken++;
        RecordCashChange(company, LedgerCategory.LoanDrawdown, loan.Principal, $"term loan #{loan.Id} ({termMonths} mo @ {loan.AnnualRate:P2})");
        AddFinanceEvent(company, FinanceEventKind.LoanTaken,
            $"Borrowed {loan.Principal:N0} over {termMonths} months at {loan.AnnualRate:P2}", loan.Principal, loanId: loan.Id);
        return loan;
    }

    /// <summary>
    /// Prepay <paramref name="amount"/> of a term loan's principal (free in P0). The remaining
    /// balance is re-amortised over the months left. Returns the loan (repaid when outstanding is 0).
    /// </summary>
    /// <exception cref="FinanceException">Unknown loan, bad amount, or not enough cash.</exception>
    public TermLoan RepayLoan(CompanyId company, int loanId, decimal amount)
    {
        RequireCompany(company);
        var f = _finance.Companies.TryGetValue(company, out var found) ? found : null;
        var loan = f?.Loans.FirstOrDefault(l => l.Id == loanId)
            ?? throw new FinanceException(FinanceErrorCode.LoanNotFound, $"company {company} has no loan #{loanId}");
        if (amount <= 0m) throw new FinanceException(FinanceErrorCode.InvalidArgument, "repayment must be positive");
        var pay = Math.Min(FinanceMath.Cents(amount), loan.Outstanding);
        var cash = Companies[company].Cash;
        if (cash < pay) throw new FinanceException(FinanceErrorCode.InsufficientCash, $"repaying {pay:N0} needs cash; the company has {cash:N0}", cash);

        RecordCashChange(company, LedgerCategory.LoanRepayment, -pay, $"prepay term loan #{loan.Id}");
        loan.Outstanding -= pay;
        if (loan.Outstanding <= 0m)
        {
            loan.Outstanding = 0m;
            loan.MonthsRemaining = 0;
            f!.Loans.Remove(loan);
            AddFinanceEvent(company, FinanceEventKind.LoanRepaid, $"Loan #{loan.Id} repaid in full", loan.Principal, loanId: loan.Id);
        }
        else
        {
            loan.MonthlyPayment = FinanceMath.AnnuityPayment(loan.Outstanding, loan.AnnualRate, Math.Max(1, loan.MonthsRemaining));
        }

        return loan;
    }

    /// <summary>The company's outstanding term loans, oldest first.</summary>
    public IReadOnlyList<TermLoan> GetLoans(CompanyId company)
    {
        RequireCompany(company);
        return _finance.Companies.TryGetValue(company, out var f) ? f.Loans.ToList() : Array.Empty<TermLoan>();
    }

    /// <summary>Cash plus undrawn revolver: what the company can spend before it defaults.</summary>
    public decimal GetAvailableLiquidity(CompanyId company)
    {
        var cash = RequireCompany(company).Cash;
        if (!Rules.Finance.Enabled || !Rules.Finance.Revolver) return cash;
        var p = GetCreditProfile(company);
        return cash + p.UndrawnRevolver;
    }

    /// <summary>
    /// Undrawn revolver credit of a company right now (the E1 <see cref="Market.ICreditHeadroom"/>
    /// seam): the revolver limit less what is drawn, 0 under Classic finance or while the company
    /// is in distress (lenders do not extend new credit to a defaulted borrower).
    /// </summary>
    partial void AdjustAvailableFunds(CompanyId company, ref decimal funds)
        => funds += UndrawnRevolverCredit(company);

    internal decimal UndrawnRevolverCredit(CompanyId company)
    {
        if (!Rules.Finance.Enabled || !Rules.Finance.Revolver) return 0m;
        _finance.Companies.TryGetValue(company, out var f);
        if (f is not null && f.InDistress) return 0m;
        var m = CreditInputs(company, f);
        var limit = RevolverLimit(DebtCapacity(f, m), f?.TermDebt ?? 0m, m.TotalAssets);
        return Math.Max(0m, limit - (f?.RevolverDrawn ?? 0m));
    }

    // ------------------------------------------------------------------ solvency (§4.14)

    /// <summary>Distress / bankruptcy standing.</summary>
    public SolvencyStatus GetSolvency(CompanyId company)
    {
        RequireCompany(company);
        if (!_finance.Companies.TryGetValue(company, out var f)) return new SolvencyStatus(SolvencyState.Solvent, null, 0, null, null, null);
        int? left = f.InDistress ? Math.Max(0, Rules.Finance.CureMonths - f.DistressMonths) : null;
        return new SolvencyStatus(
            f.State,
            f.DistressSince is int s ? FromMonthIndex(s) : null,
            f.DistressMonths,
            left,
            f.BankruptAt is int b ? FromMonthIndex(b) : null,
            f.BankruptcyReason);
    }

    /// <summary>True while the company is in distress (rating D).</summary>
    public bool IsInDistress(CompanyId company) => _finance.Companies.TryGetValue(company, out var f) && f.InDistress;

    /// <summary>True once the company has been liquidated.</summary>
    public bool IsBankrupt(CompanyId company) => _finance.Companies.TryGetValue(company, out var f) && f.IsBankrupt;

    /// <summary>
    /// False while the company may not invest: in distress (construction, upgrades and new loans
    /// are blocked, §4.14) or bankrupt.
    /// </summary>
    public bool CanInvest(CompanyId company)
        => !_finance.Companies.TryGetValue(company, out var f) || f.State == SolvencyState.Solvent;

    /// <summary>Throw when <see cref="CanInvest"/> is false (construction and upgrade paths call it).</summary>
    /// <exception cref="FinanceException">The company is in distress or bankrupt.</exception>
    public void EnsureCanInvest(CompanyId company)
    {
        if (!CanInvest(company))
        {
            throw new FinanceException(FinanceErrorCode.Distressed,
                IsBankrupt(company) ? "the company is bankrupt" : "lenders block new investment while the company is in default");
        }
    }

    // ------------------------------------------------------------------ tax (§4.9)

    /// <summary>Income-tax position (rate, losses carried forward, YTD taxable income and tax).</summary>
    public TaxPosition GetTaxPosition(CompanyId company)
    {
        RequireCompany(company);
        var rate = Rules.Finance.Enabled ? Rules.Finance.IncomeTaxRate : 0m;
        if (!_finance.Companies.TryGetValue(company, out var f)) return new TaxPosition(rate, 0m, 0m, 0m);
        return new TaxPosition(rate, f.NolOpen, f.TaxableIncomeYtd, f.TaxPaidYtd);
    }

    // ------------------------------------------------------------------ company value (§4.11, §4.18)

    /// <summary>
    /// The single company-value definition (master plan D10): market cap once listed (Wave 3),
    /// otherwise the fundamental equity value of econ-audit §4.11. Under rules without
    /// <see cref="Rules.FinanceRules.FundamentalValuation"/> (Classic) it is total assets, the
    /// legacy goal metric.
    /// </summary>
    public decimal GetCorporateValue(CompanyId company) => GetValuation(company).Value;

    /// <summary><see cref="GetCorporateValue"/> with its inputs.</summary>
    public CompanyValuation GetValuation(CompanyId company)
    {
        var bs = GetBalanceSheet(company);
        if (!Rules.Finance.Enabled || !Rules.Finance.FundamentalValuation)
        {
            var netCash = bs.Cash - bs.Liabilities;
            return new CompanyValuation(bs.TotalAssets, ValuationMethod.TotalAssets, bs.Equity, netCash, bs.Equity - netCash, 1, 0, 0, 0);
        }

        _finance.Companies.TryGetValue(company, out var f);
        return Valuation.Fundamental(bs, f, Rules.Finance.PolicyRate, Rules.Finance.IncomeTaxRate);
    }

    // ------------------------------------------------------------------ disposals

    /// <summary>What disposing of <paramref name="building"/> would bring in and book, without doing it.</summary>
    public DisposalResult PreviewDisposal(BuildingInstanceId building, DisposalKind kind)
    {
        var b = RequireBuilding(building);
        var rules = Rules.Finance;
        var land = _finance.Assets.LandOf(building);
        var cip = _finance.Assets.CipOf(building);
        var nbv = b.BookValue;
        var inventory = b.Inventory.TotalValue();
        var proceeds = kind switch
        {
            DisposalKind.Sale => land + rules.SaleStructureRecovery * nbv + 0.5m * cip + inventory,
            DisposalKind.Demolition => land + rules.DemolitionInventoryRecovery * inventory,
            _ => rules.FireSaleLand * land + rules.FireSaleStructure * nbv + rules.FireSaleConstruction * cip + rules.FireSaleInventory * inventory,
        };
        return new DisposalResult(building, kind, FinanceMath.Cents(Math.Max(0m, proceeds)), nbv, land, cip, inventory);
    }

    /// <summary>
    /// Sell a building as a going concern (econ-audit §4.8 disposal): land at value, the structure
    /// at 60 % of net book value, stock at cost. Cash is <see cref="LedgerCategory.AssetSale"/>,
    /// the gain or loss goes to the accrual journal, and the building leaves the company.
    /// </summary>
    /// <exception cref="FinanceException">Disposals disabled, or the owner is bankrupt.</exception>
    public DisposalResult SellBuilding(BuildingInstanceId building) => Dispose(building, DisposalKind.Sale);

    /// <summary>
    /// Demolish a building: the cleared land is sold at cost, the structure is scrapped, stock is
    /// cleared at a discount. Booked like <see cref="SellBuilding"/>.
    /// </summary>
    /// <exception cref="FinanceException">Disposals disabled, or the owner is bankrupt.</exception>
    public DisposalResult DemolishBuilding(BuildingInstanceId building) => Dispose(building, DisposalKind.Demolition);

    private DisposalResult Dispose(BuildingInstanceId building, DisposalKind kind)
    {
        var b = RequireBuilding(building);
        if (!Rules.Finance.Enabled || !Rules.Finance.Disposals)
        {
            throw new FinanceException(FinanceErrorCode.FeatureDisabled, "buildings cannot be sold or demolished under these rules");
        }

        if (IsBankrupt(b.Owner)) throw new FinanceException(FinanceErrorCode.InvalidDisposal, "a bankrupt company's assets belong to its creditors");
        if (b.Construction is not null)
        {
            // E3b: a building under construction (or waiting for a site) is cancelled, not sold.
            throw new FinanceException(FinanceErrorCode.InvalidDisposal, "a building under construction cannot be sold or demolished; cancel the construction instead");
        }

        var result = DisposeCore(b, kind, LedgerCategory.AssetSale);
        var verb = kind == DisposalKind.Sale ? "Sold" : "Demolished";
        AddFinanceEvent(b.Owner, FinanceEventKind.BuildingDisposed,
            $"{verb} {Catalog.BuildingType(b.TypeId).Name} in {Catalog.City(b.City).Name} for {result.Proceeds:N0} ({(result.GainOrLoss >= 0m ? "gain" : "loss")} {Math.Abs(result.GainOrLoss):N0})",
            result.Proceeds, buildingId: building.Value);
        return result;
    }

    /// <summary>Book a disposal and retire the building. Shared by sales, demolition and liquidation.</summary>
    internal DisposalResult DisposeCore(BuildingInstance b, DisposalKind kind, LedgerCategory proceedsCategory)
    {
        var result = PreviewDisposal(b.Id, kind);
        var label = kind switch
        {
            DisposalKind.Sale => "sale",
            DisposalKind.Demolition => "demolition",
            _ => "liquidation",
        };
        if (result.Proceeds > 0m)
        {
            RecordCashChange(b.Owner, proceedsCategory, result.Proceeds, $"{label} of {b.TypeId} ({b.Id})", building: b.Id);
        }

        if (result.GainOrLoss != 0m)
        {
            RecordAccrual(b.Owner, AccrualKind.DisposalGainLoss, result.GainOrLoss, $"{label} of {b.TypeId} ({b.Id})", b.Id);
        }

        Retire(b);
        return result;
    }

    /// <summary>
    /// Save migration: a building a pre-integration land save kept in the world as retired
    /// (cancelled construction) moves to the retired registry, with no booking.
    /// </summary>
    internal void RetireLoaded(BuildingInstance b, GameDate at)
    {
        b.RetiredAt = at;
        _buildings.Remove(b.Id);
        if (_companies.TryGetValue(b.Owner, out var owner)) owner.OwnedBuildings.Remove(b.Id);
        _finance.Retired[b.Id] = b;
        _finance.RetiredAt[b.Id] = at.AsMonthIndex();
    }

    /// <summary>Remove a building from the live world, keeping it (and its final book figures) in the retired registry.</summary>
    private void Retire(BuildingInstance b)
    {
        // E3b: free the building's plots (layoutRev bumps) before it leaves the world.
        ReleaseSite(b);
        b.RetiredAt = Clock.Now;
        _buildings.Remove(b.Id);
        if (_companies.TryGetValue(b.Owner, out var owner)) owner.OwnedBuildings.Remove(b.Id);
        _finance.Assets.Remove(b.Id);
        _finance.Retired[b.Id] = b;
        _finance.RetiredAt[b.Id] = Clock.Now.AsMonthIndex();
    }

    // ------------------------------------------------------------------ internals

    internal void AddFinanceEvent(
        CompanyId company,
        FinanceEventKind kind,
        string message,
        decimal? amount = null,
        int? loanId = null,
        string? oldRating = null,
        string? newRating = null,
        int? buildingId = null)
        => _finance.Events.Add(new FinanceEvent(Clock.Now, company, kind, message, amount, loanId, oldRating, newRating, buildingId));

    /// <summary>Publish a finance headline to the news log (defaults, bankruptcies).</summary>
    internal void PublishFinanceNews(string eventId, string headline, EventSeverity severity)
        => _newsLog.Add(new NewsEntry(Clock.Now, eventId, headline, severity));

    internal static GameDate FromMonthIndex(int index) => new(index / 12, index % 12 + 1);

    /// <summary>Inputs of the rating, capacity and pricing formulas for one company now.</summary>
    internal readonly record struct CreditMetrics(
        decimal Cash,
        decimal TotalAssets,
        decimal Equity,
        decimal Debt,
        decimal Collateral,
        decimal EbitdaTtm,
        decimal EbitTtm,
        decimal InterestTtm,
        decimal FixedCosts,
        int AgeMonths);

    internal CreditMetrics CreditInputs(CompanyId company, CompanyFinance? f)
    {
        var bs = GetBalanceSheet(company);
        var collateral = 0m;
        var register = _finance.Assets;
        decimal opexFallback = 0m;
        foreach (var b in _buildings.Values)
        {
            if (b.Owner != company) continue;
            collateral += 0.50m * b.Inventory.TotalValue();
            var record = register.Find(b.Id);
            decimal registered = 0m;
            if (record is not null)
            {
                collateral += 0.70m * record.Land + 0.30m * record.ConstructionInProgress;
                foreach (var c in record.Components)
                {
                    collateral += AssetClasses.AdvanceRate(c.Class) * c.NetBookValue;
                    registered += c.Cost;
                }
            }

            var unscheduled = b.CapitalizedCost - registered;
            if (unscheduled > 0m) collateral += AssetClasses.AdvanceRate(AssetClass.Structure) * unscheduled;
            opexFallback += GetMonthlyOpex(b);
        }

        decimal ebitda = 0m, ebit = 0m, interest = 0m, fixedCosts;
        var debtService = 0m;
        if (f is not null)
        {
            ebitda = f.Trailing(p => p.Ebitda);
            ebit = f.Trailing(p => p.Ebit);
            interest = f.Trailing(p => p.InterestExpense);
            foreach (var l in f.Loans) debtService += l.MonthlyPayment;
        }

        if (f is { History.Count: > 0 })
        {
            var n = Math.Min(3, f.History.Count);
            fixedCosts = f.Trailing(p => p.OperatingCosts, n) / n;
        }
        else
        {
            fixedCosts = opexFallback;
        }

        var age = f is null ? 0 : Clock.Now.AsMonthIndex() - f.FoundedMonth;
        return new CreditMetrics(bs.Cash, bs.TotalAssets, bs.Equity, bs.Liabilities, FinanceMath.Cents(collateral),
            ebitda, ebit, interest, FinanceMath.Cents(fixedCosts + debtService), age);
    }

    /// <summary>
    /// The rating loans are priced at: D in distress (for interest), else the reported rating,
    /// else the unrated rule (BBB when debt ≤ ½ equity, otherwise BB). Capacity uses the last
    /// reviewed rating even in distress, so a default does not yank the credit line on its own.
    /// </summary>
    internal CreditRating PricingRating(CompanyFinance? f, CreditMetrics m, bool forInterest)
    {
        if (f is not null && f.InDistress)
        {
            if (forInterest) return CreditRating.D;
            if (f.UnderlyingRating is { } u) return u;
        }
        else if (f?.Rating is { } r)
        {
            return r;
        }

        return CreditRatings.Unrated(m.Debt, m.Equity);
    }

    /// <summary>
    /// Debt capacity (§4.10): seasoned companies min(collateral, k(rating)·EBITDA_TTM), younger ones
    /// half their collateral. Never negative; zero when finance is off.
    /// </summary>
    internal decimal DebtCapacity(CompanyFinance? f, CreditMetrics m)
    {
        var rules = Rules.Finance;
        if (!rules.Enabled || (!rules.TermLoans && !rules.Revolver)) return 0m;
        if (m.AgeMonths < rules.SeasoningMonths) return FinanceMath.Cents(0.5m * m.Collateral);
        var rating = PricingRating(f, m, forInterest: false);
        var cashFlowCap = CreditRatings.CashFlowMultiple(rating) * m.EbitdaTtm;
        return FinanceMath.Cents(Math.Max(0m, Math.Min(m.Collateral, cashFlowCap)));
    }

    /// <summary>Revolver limit: clamp(capacity − term debt, 0, cap × total assets).</summary>
    internal decimal RevolverLimit(decimal capacity, decimal termDebt, decimal totalAssets)
    {
        var rules = Rules.Finance;
        if (!rules.Enabled || !rules.Revolver) return 0m;
        var cap = Math.Max(0m, rules.RevolverAssetCap * totalAssets);
        return FinanceMath.Cents(Math.Clamp(capacity - termDebt, 0m, cap));
    }

    private static decimal TotalInterest(decimal principal, decimal rate, int months, decimal payment)
    {
        var outstanding = principal;
        var total = 0m;
        for (var i = 0; i < months && outstanding > 0m; i++)
        {
            var interest = FinanceMath.MonthlyInterest(outstanding, rate);
            var repay = i == months - 1 ? outstanding : Math.Min(outstanding, payment - interest);
            total += interest;
            outstanding -= repay;
        }

        return total;
    }
}
