using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Loans, credit and disposals (bridge-spec §8.4, E16; econ-audit §4.8, §4.10, §4.14) — the
// E2 finance workstream's real implementations of the former EXT stubs. Every method needs
// the game's rules to enable the feature (Realistic does; Classic answers
// `feature_unavailable`), validates its arguments before touching the engine, and maps the
// engine's FinanceException codes to protocol errors. Loan and disposal events
// (loanTaken, loanRepaid, buildingDemolished, …) come from the engine's finance event log
// and are published by GoalTracker after the command, like the tick's own.
public sealed partial class GameSession
{
    /// <summary>Tenors offered by <c>loanOffers</c> (filtered to the rules' min..max).</summary>
    internal static readonly int[] StandardLoanTerms = { 12, 36, 60, 120, 240 };

    /// <summary>The player's credit standing: rating, limits, pricing, ratios, solvency and tax position.</summary>
    [BridgeMethod("creditProfile")]
    public CreditProfileDto CreditProfile()
    {
        var game = Game;
        var world = game.World;
        RequireFinance(world);
        return BuildCreditProfile(world, game.Player);
    }

    /// <summary>Term-loan offers at today's pricing, one per standard tenor, for an amount (default: the most available).</summary>
    [BridgeMethod("loanOffers")]
    public IReadOnlyList<LoanOfferDto> LoanOffers(LoanOffersArgs args)
    {
        var game = Game;
        var world = game.World;
        RequireTermLoans(world);
        var profile = world.GetCreditProfile(game.Player);
        var max = profile.NewTermLoanMax;
        var amount = args.Amount is { } asked ? Guard.PositiveMoney(asked, MaxLoanAmount, "amount") : max;
        amount = Math.Min(amount, max);
        if (amount <= 0m || !world.CanInvest(game.Player)) return Array.Empty<LoanOfferDto>();

        var rules = world.Rules.Finance;
        var offers = new List<LoanOfferDto>();
        foreach (var term in StandardLoanTerms)
        {
            if (term < Math.Max(1, rules.MinLoanTermMonths) || term > rules.MaxLoanTermMonths) continue;
            var quote = world.QuoteLoan(game.Player, amount, term);
            if (!quote.Allowed) continue;
            offers.Add(new LoanOfferDto(OfferId(term, quote.Amount), quote.Amount, term, (double)quote.AnnualRate,
                quote.MonthlyPayment, CreditRatings.Label(quote.Rating), quote.TotalInterest));
        }
        return offers;
    }

    /// <summary>The player's outstanding term loans, oldest first.</summary>
    [BridgeMethod("loans")]
    public IReadOnlyList<LoanDto> Loans()
    {
        var game = Game;
        RequireFinance(game.World);
        return game.World.GetLoans(game.Player).Select(LoanToDto).ToList();
    }

    /// <summary>Draw a term loan: an <c>offerId</c> from <c>loanOffers</c>, or an <c>amount</c> and <c>termMonths</c>.</summary>
    [BridgeMethod("takeLoan", Mutates = true)]
    public LoanDto TakeLoan(TakeLoanArgs args)
    {
        var game = Game;
        var world = game.World;
        RequireTermLoans(world);
        var rules = world.Rules.Finance;

        decimal amount;
        int term;
        if (args.OfferId is { Length: > 0 } offerId)
        {
            if (!TryParseOffer(offerId, out term, out amount))
            {
                throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"'{offerId}' is not a loan offer.", "offerId");
            }
        }
        else
        {
            amount = Guard.PositiveMoney(
                args.Amount ?? throw new BridgeException(BridgeErrorCodes.BadRequest, "'amount' is required.", "amount"),
                MaxLoanAmount, "amount");
            term = args.TermMonths ?? throw new BridgeException(BridgeErrorCodes.BadRequest, "'termMonths' is required.", "termMonths");
        }

        var minTerm = Math.Max(1, rules.MinLoanTermMonths);
        if (term < minTerm || term > rules.MaxLoanTermMonths)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument,
                $"A loan runs between {minTerm} and {rules.MaxLoanTermMonths} months.", "termMonths",
                new ErrorDetailsDto(Min: minTerm, Max: rules.MaxLoanTermMonths));
        }

        // Pre-check with a quote (no state change) so refusals carry typed details.
        var quote = world.QuoteLoan(game.Player, amount, term);
        if (!quote.Allowed) throw QuoteRefusal(quote, amount);

        MarkDirty();
        try
        {
            return LoanToDto(world.TakeLoan(game.Player, amount, term));
        }
        catch (FinanceException ex)
        {
            throw FinanceError(ex, "amount");
        }
    }

    /// <summary>Prepay part or all of a term loan's principal (free); the rest is re-amortised over the months left.</summary>
    [BridgeMethod("repayLoan", Mutates = true)]
    public LoanDto RepayLoan(RepayLoanArgs args)
    {
        var game = Game;
        var world = game.World;
        RequireTermLoans(world);
        var loan = world.GetLoans(game.Player).FirstOrDefault(l => l.Id == args.LoanId)
            ?? throw new BridgeException(BridgeErrorCodes.LoanNotFound, $"You have no loan #{args.LoanId}.", "loanId",
                new ErrorDetailsDto(EntityKind: EntityKinds.Loan, EntityId: args.LoanId.ToString(CultureInfo.InvariantCulture)));
        var amount = Guard.PositiveMoney(args.Amount, MaxLoanAmount, "amount");
        var pay = Math.Min(amount, loan.Outstanding);
        var cash = world.Companies[game.Player].Cash;
        if (pay > cash) throw Guard.InsufficientFunds(pay, cash, $"repaying loan #{loan.Id}");

        MarkDirty();
        try
        {
            return LoanToDto(world.RepayLoan(game.Player, loan.Id, pay));
        }
        catch (FinanceException ex)
        {
            throw FinanceError(ex, "amount");
        }
    }

    /// <summary>What selling or demolishing a building would bring in and book, without doing it.</summary>
    [BridgeMethod("previewDisposal")]
    public DisposalResultDto PreviewDisposal(DisposalPreviewArgs args)
    {
        var game = Game;
        var world = game.World;
        RequireDisposals(world);
        var building = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        RefuseUnderConstruction(world, building);
        var kind = ParseDisposalKind(args.Kind);
        return DisposalToDto(world.PreviewDisposal(building.Id, kind));
    }

    /// <summary>
    /// Sell a building as a going concern: land at value, the structure at a share of its book
    /// value, stock at cost. The gain or loss is booked below the operating line.
    /// </summary>
    [BridgeMethod("sellBuilding", Mutates = true)]
    public DisposalResultDto SellBuilding(BuildingRefArgs args) => Dispose(args.BuildingId, DisposalKind.Sale);

    /// <summary>Demolish a building: the cleared land is sold, the structure scrapped, stock cleared at a discount.</summary>
    [BridgeMethod("demolishBuilding", Mutates = true)]
    public DisposalResultDto DemolishBuilding(BuildingRefArgs args) => Dispose(args.BuildingId, DisposalKind.Demolition);

    // ------------------------------------------------------------------ helpers

    /// <summary>Upper bound accepted for a loan amount or repayment (a sanity cap; credit limits decide).</summary>
    internal const decimal MaxLoanAmount = 1_000_000_000_000m;

    /// <summary>A building under construction is cancelled (<c>cancelConstruction</c>), not sold or demolished (E2 x E3b).</summary>
    private static void RefuseUnderConstruction(World world, BuildingInstance building)
    {
        if (building.Construction is null) return;
        throw new BridgeException(BridgeErrorCodes.UnderConstruction,
            $"The {world.Catalog.BuildingType(building.TypeId).Name} is still under construction: cancel the construction instead.", "buildingId",
            new ErrorDetailsDto(Reason: "underConstruction"));
    }

    private DisposalResultDto Dispose(int buildingId, DisposalKind kind)
    {
        var game = Game;
        var world = game.World;
        RequireDisposals(world);
        var building = Guard.OwnedBuilding(world, game.Player, buildingId);
        RefuseUnderConstruction(world, building);
        MarkDirty();
        DisposalResult result;
        try
        {
            result = kind == DisposalKind.Sale ? world.SellBuilding(building.Id) : world.DemolishBuilding(building.Id);
        }
        catch (FinanceException ex)
        {
            throw FinanceError(ex, "buildingId");
        }

        // The plot is freed by PlacementModel.EnsureAll after the command (retired buildings are pruned).
        return DisposalToDto(result);
    }

    internal static CreditProfileDto BuildCreditProfile(World world, CompanyId company)
    {
        var p = world.GetCreditProfile(company);
        var rules = world.Rules.Finance;
        var bs = world.GetBalanceSheet(company);
        var solvency = world.GetSolvency(company);
        var tax = world.GetTaxPosition(company);
        var loans = world.GetLoans(company);

        var debt = p.TotalDebt;
        var weighted = loans.Sum(l => l.Outstanding * l.AnnualRate) + p.RevolverDrawn * p.RevolverRate;
        var rate = debt > 0m ? weighted / debt : p.RevolverRate;
        double? debtToEquity = debt == 0m ? 0.0 : bs.Equity > 0m ? (double)Math.Round(debt / bs.Equity, 4) : null;

        return new CreditProfileDto(
            Rating: p.RatingLabel,
            CreditLimit: p.DebtCapacity,
            Outstanding: debt,
            InterestRate: (double)Math.Round(rate, 6),
            DebtToEquity: debtToEquity,
            InterestCoverage: p.InterestCoverage is { } icr ? (double)icr : null,
            NextReview: Months.Dto(p.NextReview),
            PricingRating: CreditRatings.Label(p.PricingRating),
            Seasoned: p.Seasoned,
            TermDebt: p.TermDebt,
            RevolverDrawn: p.RevolverDrawn,
            RevolverLimit: p.RevolverLimit,
            RevolverRate: (double)p.RevolverRate,
            NewLoanMax: rules.TermLoans && world.CanInvest(company) ? p.NewTermLoanMax : 0m,
            MinTermMonths: Math.Max(1, rules.MinLoanTermMonths),
            MaxTermMonths: rules.MaxLoanTermMonths,
            PolicyRate: (double)p.PolicyRate,
            EbitdaTtm: p.EbitdaTtm,
            NextPayment: p.NextPayment,
            Solvency: SolvencyId(solvency.State),
            TaxRate: (double)tax.Rate,
            LossCarryForward: tax.LossCarryForward,
            TaxPaidYtd: tax.TaxPaidYtd,
            BookEquity: bs.Equity,
            CompanyValue: world.GetCorporateValue(company),
            NetDebtToEbitda: p.NetDebtToEbitda is { } nd ? (double)nd : null,
            LastReview: p.LastReview is { } last ? Months.Dto(last) : null,
            CureMonthsLeft: solvency.CureMonthsLeft);
    }

    internal static string SolvencyId(SolvencyState state) => state switch
    {
        SolvencyState.Distress => "distress",
        SolvencyState.Bankrupt => "bankrupt",
        _ => "solvent",
    };

    private static LoanDto LoanToDto(TermLoan loan) => new(
        loan.Id,
        loan.Principal,
        loan.Outstanding,
        (double)loan.AnnualRate,
        loan.TermMonths,
        loan.MonthsRemaining,
        loan.IsRepaid ? 0m : loan.MonthlyPayment,
        Months.Dto(loan.Originated),
        loan.MissedPayments > 0,
        loan.MissedPayments);

    private static DisposalResultDto DisposalToDto(DisposalResult r) => new(
        r.Building.Value,
        r.Proceeds,
        r.CarryingAmount,
        r.GainOrLoss,
        r.Kind switch { DisposalKind.Sale => "sale", DisposalKind.Demolition => "demolition", _ => "liquidation" },
        r.BookValue,
        r.Land,
        r.ConstructionInProgress,
        r.Inventory);

    private static DisposalKind ParseDisposalKind(string? kind) => kind switch
    {
        null or "" or "sale" => DisposalKind.Sale,
        "demolition" => DisposalKind.Demolition,
        _ => throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"'{kind}' is not a disposal kind (sale | demolition).", "kind"),
    };

    internal static string OfferId(int termMonths, decimal amount)
        => termMonths.ToString(CultureInfo.InvariantCulture) + "m-"
            + decimal.ToInt64(Math.Round(amount * 100m, MidpointRounding.ToEven)).ToString(CultureInfo.InvariantCulture);

    internal static bool TryParseOffer(string offerId, out int termMonths, out decimal amount)
    {
        termMonths = 0;
        amount = 0m;
        var dash = offerId.IndexOf("m-", StringComparison.Ordinal);
        if (dash <= 0) return false;
        if (!int.TryParse(offerId.AsSpan(0, dash), NumberStyles.None, CultureInfo.InvariantCulture, out termMonths)) return false;
        if (!long.TryParse(offerId.AsSpan(dash + 2), NumberStyles.None, CultureInfo.InvariantCulture, out var cents) || cents <= 0) return false;
        amount = cents / 100m;
        return termMonths > 0;
    }

    private static void RequireFinance(World world)
    {
        if (!world.Rules.Finance.Enabled) throw Unavailable(FeatureNames.Loans);
    }

    private static void RequireTermLoans(World world)
    {
        if (!world.Rules.Finance.Enabled || !world.Rules.Finance.TermLoans) throw Unavailable(FeatureNames.Loans);
    }

    private static void RequireDisposals(World world)
    {
        if (!world.Rules.Finance.Enabled || !world.Rules.Finance.Disposals) throw Unavailable(FeatureNames.Demolish);
    }

    private static BridgeException QuoteRefusal(LoanQuote quote, decimal asked) => quote.Refusal switch
    {
        FinanceErrorCode.CreditLimitExceeded => new BridgeException(BridgeErrorCodes.CreditLimitExceeded,
            $"Lenders will lend at most {Money(quote.MaxAmount)} right now; you asked for {Money(asked)}.", "amount",
            new ErrorDetailsDto(Required: asked, Available: quote.MaxAmount, Max: quote.MaxAmount)),
        FinanceErrorCode.Distressed => new BridgeException(BridgeErrorCodes.InvalidOperation,
            "Lenders refuse new credit while the company is in default.", null, new ErrorDetailsDto(Reason: "distressed")),
        FinanceErrorCode.FeatureDisabled => Unavailable(FeatureNames.Loans),
        _ => new BridgeException(BridgeErrorCodes.InvalidArgument, "The loan amount must be positive.", "amount"),
    };

    /// <summary>Map an engine finance refusal to a protocol error (normally caught by the pre-checks first).</summary>
    private static BridgeException FinanceError(FinanceException ex, string field) => ex.Code switch
    {
        FinanceErrorCode.FeatureDisabled => Unavailable(field == "buildingId" ? FeatureNames.Demolish : FeatureNames.Loans),
        FinanceErrorCode.CreditLimitExceeded => new BridgeException(BridgeErrorCodes.CreditLimitExceeded,
            "That is more than lenders will extend right now.", field, new ErrorDetailsDto(Available: ex.Limit, Max: ex.Limit, DevMessage: ex.Message)),
        FinanceErrorCode.LoanNotFound => new BridgeException(BridgeErrorCodes.LoanNotFound, "There is no such loan.", "loanId",
            new ErrorDetailsDto(EntityKind: EntityKinds.Loan, DevMessage: ex.Message)),
        FinanceErrorCode.InsufficientCash => new BridgeException(BridgeErrorCodes.InsufficientFunds, "Not enough cash for that payment.", field,
            new ErrorDetailsDto(Available: ex.Limit, DevMessage: ex.Message)),
        FinanceErrorCode.Distressed => new BridgeException(BridgeErrorCodes.InvalidOperation,
            "Lenders block new borrowing and investment while the company is in default.", null,
            new ErrorDetailsDto(Reason: "distressed", DevMessage: ex.Message)),
        FinanceErrorCode.InvalidDisposal => new BridgeException(BridgeErrorCodes.InvalidOperation,
            "That building cannot be disposed of now.", field, new ErrorDetailsDto(Reason: "bankrupt", DevMessage: ex.Message)),
        _ => new BridgeException(BridgeErrorCodes.InvalidArgument, "The finance engine rejected an argument.", field,
            new ErrorDetailsDto(DevMessage: ex.Message)),
    };
}
