using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence.Sections;

/// <summary>
/// Schema-v10 save section for the finance area (econ-audit §4.19): per-company loans, revolver,
/// rating, tax position, solvency and trailing history; the per-building fixed-asset register
/// (land, CIP, depreciation components); retired buildings; the tax-window cursors and the
/// finance event log. Serialised as the nullable <c>finance</c> property of the save file;
/// <c>null</c> (omitted) when the finance area is off — always the case for Classic worlds — and
/// for saves older than v10. Decimals are exact invariant-culture strings. Every list is written
/// in engine order, so a save → load → save round trip is byte-identical.
/// </summary>
internal sealed record FinanceSaveSection
{
    /// <summary>Per-company state, ascending company id.</summary>
    public IReadOnlyList<CompanyFinanceDto>? Companies { get; init; }

    /// <summary>Fixed-asset register, ascending building id.</summary>
    public IReadOnlyList<BuildingAssetsDto>? Assets { get; init; }

    /// <summary>Retired (disposed) buildings, ascending id.</summary>
    public IReadOnlyList<RetiredBuildingDto>? Retired { get; init; }

    /// <summary>Finance events, in order.</summary>
    public IReadOnlyList<FinanceEventDto>? Events { get; init; }

    /// <summary>Next loan id.</summary>
    public int NextLoanId { get; init; } = 1;

    /// <summary>Ledger entries already folded into a tax window.</summary>
    public int LedgerCursor { get; init; }

    /// <summary>COGS entries already folded into a tax window.</summary>
    public int CogsCursor { get; init; }

    /// <summary>Accrual entries already folded into a tax window.</summary>
    public int AccrualCursor { get; init; }

    /// <summary>
    /// Snapshot the area's state, or return <c>null</c> when the finance area is off (the section
    /// is then omitted from the save).
    /// </summary>
    internal static FinanceSaveSection? Capture(World world)
    {
        // Land rules use the asset register (land, CIP) and the retired registry too (E3b).
        if (!world.Rules.Finance.Enabled && !world.Rules.Land.Enabled) return null;
        var state = world.FinanceState;
        return new FinanceSaveSection
        {
            Companies = state.Companies.Values.OrderBy(c => c.Company.Value).Select(CompanyDto).ToList(),
            Assets = state.Assets.Records.Values.OrderBy(r => r.Building.Value).Select(AssetsDto).ToList(),
            Retired = state.Retired.Values.OrderBy(b => b.Id.Value)
                .Select(b => new RetiredBuildingDto(
                    b.Id.Value, b.TypeId.Value, b.Owner.Value, b.City.Value, b.Level,
                    S(b.CapitalizedCost), S(b.AccumulatedDepreciation), b.BuiltAt.Year, b.BuiltAt.Month,
                    state.RetiredAt.TryGetValue(b.Id, out var at) ? at : 0))
                .ToList(),
            Events = state.Events.Select(e => new FinanceEventDto(
                e.Date.Year, e.Date.Month, e.Company.Value, e.Kind.ToString(), e.Message,
                e.Amount is decimal a ? S(a) : null, e.LoanId, e.OldRating, e.NewRating, e.BuildingId)).ToList(),
            NextLoanId = state.NextLoanId,
            LedgerCursor = state.LedgerCursor,
            CogsCursor = state.CogsCursor,
            AccrualCursor = state.AccrualCursor,
        };
    }

    /// <summary>
    /// Apply a persisted section to a freshly rebuilt world. Called after every core collection
    /// (companies, buildings, logs, RNG) has been restored. A Realistic save without the section
    /// (written before the finance model existed) starts the finance model fresh at the load
    /// point: the tax cursors skip the history so it is not taxed again.
    /// </summary>
    internal static void Restore(World world, FinanceSaveSection? section)
    {
        var state = world.FinanceState;
        if (section is null)
        {
            if (!world.Rules.Finance.Enabled) return;
            state.LedgerCursor = world.Ledger.Entries.Count;
            state.CogsCursor = world.CogsLog.Entries.Count;
            state.AccrualCursor = world.AccrualJournal.Entries.Count;
            return;
        }

        state.NextLoanId = section.NextLoanId;
        state.LedgerCursor = section.LedgerCursor;
        state.CogsCursor = section.CogsCursor;
        state.AccrualCursor = section.AccrualCursor;

        foreach (var dto in section.Companies ?? Array.Empty<CompanyFinanceDto>())
        {
            var id = new CompanyId(dto.CompanyId);
            var f = new CompanyFinance(id, dto.FoundedMonth)
            {
                RevolverDrawn = D(dto.RevolverDrawn),
                LoansTaken = dto.LoansTaken,
                Rating = ParseRating(dto.Rating),
                UnderlyingRating = ParseRating(dto.UnderlyingRating),
                RatedAt = dto.RatedAt,
                RatingCapUntil = dto.RatingCapUntil,
                NolOpen = D(dto.NolOpen),
                TaxableIncomeYtd = D(dto.TaxableIncomeYtd),
                TaxPaidYtd = D(dto.TaxPaidYtd),
                TaxYear = dto.TaxYear,
                State = Enum.Parse<SolvencyState>(dto.State),
                DistressSince = dto.DistressSince,
                DistressMonths = dto.DistressMonths,
                BankruptAt = dto.BankruptAt,
                BankruptcyReason = dto.BankruptcyReason,
            };
            foreach (var l in dto.Loans ?? Array.Empty<TermLoanDto>())
            {
                f.Loans.Add(new TermLoan(l.Id, id, D(l.Principal), D(l.AnnualRate), l.TermMonths, D(l.MonthlyPayment), new GameDate(l.OriginatedYear, l.OriginatedMonth))
                {
                    Outstanding = D(l.Outstanding),
                    MonthsRemaining = l.MonthsRemaining,
                    MissedPayments = l.MissedPayments,
                });
            }

            foreach (var h in dto.History ?? Array.Empty<PeriodResultDto>())
            {
                f.History.Add(new PeriodResult(h.Month, D(h.Revenue), D(h.Ebitda), D(h.Ebit), D(h.InterestExpense), D(h.PreTaxIncome), D(h.IncomeTax), D(h.OperatingCosts)));
            }

            foreach (var q in dto.QuarterOperatingAssets ?? Array.Empty<string>()) f.QuarterOperatingAssets.Add(D(q));
            state.Companies[id] = f;
        }

        foreach (var dto in section.Assets ?? Array.Empty<BuildingAssetsDto>())
        {
            var record = state.Assets.For(new BuildingInstanceId(dto.BuildingId));
            record.Land = D(dto.Land);
            record.ConstructionInProgress = D(dto.Cip);
            foreach (var c in dto.Components ?? Array.Empty<AssetComponentDto>())
            {
                record.Components.Add(new AssetComponent(Enum.Parse<AssetClass>(c.Class), D(c.Cost), c.LifeMonths, c.StartMonth, c.Label)
                {
                    Accumulated = D(c.Accumulated),
                });
            }
        }

        foreach (var dto in section.Retired ?? Array.Empty<RetiredBuildingDto>())
        {
            var b = new BuildingInstance(new BuildingInstanceId(dto.Id), new BuildingTypeId(dto.TypeId), new CompanyId(dto.OwnerId), new CityId(dto.CityId))
            {
                Level = dto.Level,
                CapitalizedCost = D(dto.CapitalizedCost),
                AccumulatedDepreciation = D(dto.AccumulatedDepreciation),
                BuiltAt = new GameDate(dto.BuiltYear, dto.BuiltMonth),
            };
            state.Retired[b.Id] = b;
            state.RetiredAt[b.Id] = dto.RetiredAt;
        }

        foreach (var e in section.Events ?? Array.Empty<FinanceEventDto>())
        {
            state.Events.Add(new FinanceEvent(
                new GameDate(e.Year, e.Month), new CompanyId(e.CompanyId), Enum.Parse<FinanceEventKind>(e.Kind), e.Message,
                e.Amount is null ? null : D(e.Amount), e.LoanId, e.OldRating, e.NewRating, e.BuildingId));
        }
    }

    private static CompanyFinanceDto CompanyDto(CompanyFinance f) => new(
        f.Company.Value,
        f.FoundedMonth,
        f.Loans.Select(l => new TermLoanDto(
            l.Id, S(l.Principal), S(l.Outstanding), S(l.AnnualRate), l.TermMonths, l.MonthsRemaining, S(l.MonthlyPayment),
            l.Originated.Year, l.Originated.Month, l.MissedPayments)).ToList(),
        S(f.RevolverDrawn),
        f.LoansTaken,
        f.Rating?.ToString(),
        f.UnderlyingRating?.ToString(),
        f.RatedAt,
        f.RatingCapUntil,
        S(f.NolOpen),
        S(f.TaxableIncomeYtd),
        S(f.TaxPaidYtd),
        f.TaxYear,
        f.State.ToString(),
        f.DistressSince,
        f.DistressMonths,
        f.BankruptAt,
        f.BankruptcyReason,
        f.History.Select(h => new PeriodResultDto(h.Month, S(h.Revenue), S(h.Ebitda), S(h.Ebit), S(h.InterestExpense), S(h.PreTaxIncome), S(h.IncomeTax), S(h.OperatingCosts))).ToList(),
        f.QuarterOperatingAssets.Select(S).ToList());

    private static BuildingAssetsDto AssetsDto(BuildingAssets r) => new(
        r.Building.Value,
        S(r.Land),
        S(r.ConstructionInProgress),
        r.Components.Select(c => new AssetComponentDto(c.Class.ToString(), S(c.Cost), S(c.Accumulated), c.LifeMonths, c.StartMonth, c.Label)).ToList());

    private static CreditRating? ParseRating(string? text) => text is null ? null : Enum.Parse<CreditRating>(text);

    private static string S(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    private static decimal D(string value) => decimal.Parse(value, NumberStyles.Number | NumberStyles.AllowExponent, CultureInfo.InvariantCulture);
}

/// <summary>Persisted per-company finance state.</summary>
internal sealed record CompanyFinanceDto(
    int CompanyId,
    int FoundedMonth,
    IReadOnlyList<TermLoanDto>? Loans,
    string RevolverDrawn,
    int LoansTaken,
    string? Rating,
    string? UnderlyingRating,
    int? RatedAt,
    int? RatingCapUntil,
    string NolOpen,
    string TaxableIncomeYtd,
    string TaxPaidYtd,
    int TaxYear,
    string State,
    int? DistressSince,
    int DistressMonths,
    int? BankruptAt,
    string? BankruptcyReason,
    IReadOnlyList<PeriodResultDto>? History,
    IReadOnlyList<string>? QuarterOperatingAssets);

/// <summary>Persisted term loan.</summary>
internal sealed record TermLoanDto(
    int Id,
    string Principal,
    string Outstanding,
    string AnnualRate,
    int TermMonths,
    int MonthsRemaining,
    string MonthlyPayment,
    int OriginatedYear,
    int OriginatedMonth,
    int MissedPayments);

/// <summary>Persisted tick-window P&amp;L.</summary>
internal sealed record PeriodResultDto(
    int Month,
    string Revenue,
    string Ebitda,
    string Ebit,
    string InterestExpense,
    string PreTaxIncome,
    string IncomeTax,
    string OperatingCosts);

/// <summary>Persisted fixed-asset record.</summary>
internal sealed record BuildingAssetsDto(int BuildingId, string Land, string Cip, IReadOnlyList<AssetComponentDto>? Components);

/// <summary>Persisted depreciation component.</summary>
internal sealed record AssetComponentDto(string Class, string Cost, string Accumulated, int LifeMonths, int StartMonth, string Label);

/// <summary>Persisted retired building (its final book figures).</summary>
internal sealed record RetiredBuildingDto(
    int Id,
    string TypeId,
    int OwnerId,
    string CityId,
    int Level,
    string CapitalizedCost,
    string AccumulatedDepreciation,
    int BuiltYear,
    int BuiltMonth,
    int RetiredAt);

/// <summary>Persisted finance event.</summary>
internal sealed record FinanceEventDto(
    int Year,
    int Month,
    int CompanyId,
    string Kind,
    string Message,
    string? Amount,
    int? LoanId,
    string? OldRating,
    string? NewRating,
    int? BuildingId);
