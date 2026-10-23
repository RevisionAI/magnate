using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>Kind of a non-cash accounting entry (econ-audit §4.15).</summary>
public enum AccrualKind
{
    /// <summary>Monthly depreciation charge on a building's PP&amp;E: income-statement D&amp;A, raises accumulated depreciation.</summary>
    Depreciation,

    /// <summary>Gain (positive) or loss (negative) on disposing of an asset versus its book value. Below EBIT.</summary>
    DisposalGainLoss,

    /// <summary>Construction-in-progress written off when a project is cancelled. Below EBIT.</summary>
    ConstructionWriteOff,

    /// <summary>Spoilage or obsolescence write-down of inventory. Reported in COGS (P1).</summary>
    InventoryWriteDown,
}

/// <summary>
/// One non-cash accounting entry. <see cref="Amount"/> is the effect on net income: negative for
/// an expense or loss (every depreciation charge), positive for a gain. Cash never moves — the
/// matching cash flow (if any) is in the <see cref="Ledger"/>.
/// </summary>
/// <param name="Date">Month the entry is recognised.</param>
/// <param name="Company">Company whose books it belongs to.</param>
/// <param name="Kind">What the entry is.</param>
/// <param name="Amount">Signed effect on net income.</param>
/// <param name="Memo">Free text for reports.</param>
/// <param name="Building">The building the entry concerns (depreciation, disposal, write-off).</param>
/// <param name="Product">The product concerned (inventory write-downs).</param>
public sealed record AccrualEntry(
    GameDate Date,
    CompanyId Company,
    AccrualKind Kind,
    decimal Amount,
    string? Memo,
    BuildingInstanceId? Building = null,
    ProductId? Product = null);

/// <summary>
/// Append-only journal of non-cash accounting entries (depreciation, disposal gains and
/// losses, write-offs), the accrual counterpart of the cash <see cref="Ledger"/> and the
/// <see cref="CogsLog"/>. Statements are pure functions of the three logs plus inventories and
/// building book values. Empty for every Classic world. Persisted from schema v10.
/// </summary>
public sealed class AccrualJournal
{
    private readonly List<AccrualEntry> _entries = new();
    private readonly ChronologicalIndex _index = new();

    /// <summary>Every entry in recording order (chronological).</summary>
    public IReadOnlyList<AccrualEntry> Entries => _entries;

    /// <summary>Append an entry. Callers inside the engine use <c>World.RecordAccrual</c>.</summary>
    public void Record(AccrualEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _index.Observe(entry.Date);
        _entries.Add(entry);
    }

    /// <summary>All entries of one company, in recording order.</summary>
    public IEnumerable<AccrualEntry> EntriesFor(CompanyId company)
    {
        foreach (var e in _entries)
        {
            if (e.Company == company) yield return e;
        }
    }

    /// <summary>Entries of one company dated within <c>[from, toInclusive]</c>, in recording order.</summary>
    public IEnumerable<AccrualEntry> EntriesInRange(CompanyId company, GameDate from, GameDate toInclusive)
        => _index.Range(_entries, e => e.Date, e => e.Company == company, from, toInclusive);
}
