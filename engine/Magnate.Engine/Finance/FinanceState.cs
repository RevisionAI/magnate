using System.Collections.Generic;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>Kind of a <see cref="FinanceEvent"/> (bridge-spec §8.4 event names).</summary>
public enum FinanceEventKind
{
    /// <summary>A term loan was drawn.</summary>
    LoanTaken,

    /// <summary>A term loan was repaid in full (scheduled or early).</summary>
    LoanRepaid,

    /// <summary>A scheduled loan payment could not be funded.</summary>
    LoanPaymentMissed,

    /// <summary>The quarterly review moved the rating (or the company defaulted to D).</summary>
    CreditRatingChanged,

    /// <summary>The company defaulted and entered distress (§4.14).</summary>
    DistressEntered,

    /// <summary>The company cured its default.</summary>
    DistressCured,

    /// <summary>The company was declared bankrupt and liquidated.</summary>
    Bankruptcy,

    /// <summary>A building was sold or demolished.</summary>
    BuildingDisposed,
}

/// <summary>
/// Something the finance model did that the UI should hear about. Append-only, persisted, so the
/// bridge can publish what happened since its last cursor.
/// </summary>
/// <param name="Date">Month it happened.</param>
/// <param name="Company">Company concerned.</param>
/// <param name="Kind">What happened.</param>
/// <param name="Message">Plain-words description.</param>
/// <param name="Amount">Money involved (loan amount, missed payment, residual, proceeds), if any.</param>
/// <param name="LoanId">Loan concerned, if any.</param>
/// <param name="OldRating">Rating label before a change.</param>
/// <param name="NewRating">Rating label after a change.</param>
/// <param name="BuildingId">Building concerned (disposals).</param>
public sealed record FinanceEvent(
    GameDate Date,
    CompanyId Company,
    FinanceEventKind Kind,
    string Message,
    decimal? Amount = null,
    int? LoanId = null,
    string? OldRating = null,
    string? NewRating = null,
    int? BuildingId = null);

/// <summary>
/// The finance area's world state (econ-audit §4.19): per-company finance, the fixed-asset
/// register, retired (disposed) buildings, the tax-window cursors and the event log.
/// Empty for a Classic world.
/// </summary>
public sealed class FinanceState
{
    /// <summary>Per-company state, created lazily.</summary>
    public Dictionary<CompanyId, CompanyFinance> Companies { get; } = new();

    /// <summary>Land, CIP and depreciation schedules by building.</summary>
    public AssetRegister Assets { get; } = new();

    /// <summary>
    /// Buildings sold, demolished or liquidated. Their ledger history still names them, so they are
    /// kept (with their final book figures) instead of vanishing.
    /// </summary>
    public Dictionary<BuildingInstanceId, BuildingInstance> Retired { get; } = new();

    /// <summary>Month index each retired building left the company.</summary>
    public Dictionary<BuildingInstanceId, int> RetiredAt { get; } = new();

    /// <summary>Everything noteworthy, in order.</summary>
    public List<FinanceEvent> Events { get; } = new();

    /// <summary>Next term-loan id.</summary>
    public int NextLoanId { get; internal set; } = 1;

    /// <summary>Ledger entries already folded into a tax window.</summary>
    public int LedgerCursor { get; internal set; }

    /// <summary>COGS entries already folded into a tax window.</summary>
    public int CogsCursor { get; internal set; }

    /// <summary>Accrual entries already folded into a tax window.</summary>
    public int AccrualCursor { get; internal set; }
}
