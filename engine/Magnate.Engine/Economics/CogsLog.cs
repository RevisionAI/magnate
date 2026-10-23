using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// Accrual-side recognition of Cost of Goods Sold. Recorded when goods leave a
/// company's inventory via sale or export. <see cref="Cost"/> is the cost basis
/// that flowed out (weighted-average from the inventory at the moment of sale)
/// and is NOT a cash event — the corresponding cash already moved when the goods
/// were originally purchased and capitalized to inventory.
/// <see cref="SourceBuilding"/> (Phase 3.39 / schema v5) attributes the COGS
/// recognition to the building whose inventory was drawn from, enabling per-building
/// accrual P&amp;amp;L. Null for older saves that pre-date the field, or for any
/// future call site that doesn't have a single attributable source building.
/// </summary>
public sealed record CogsEntry(
    GameDate Date,
    CompanyId Company,
    ProductId Product,
    double Quantity,
    decimal Cost,
    BuildingInstanceId? SourceBuilding = null);

/// <summary>Append-only log of COGS recognitions, used for accrual reporting.</summary>
public sealed class CogsLog
{
    private readonly List<CogsEntry> _entries = new();
    private readonly ChronologicalIndex _index = new();

    /// <summary>Every entry in recording order (chronological).</summary>
    public IReadOnlyList<CogsEntry> Entries => _entries;

    /// <summary>Append an entry.</summary>
    public void Record(CogsEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _index.Observe(entry.Date);
        _entries.Add(entry);
    }

    /// <summary>All entries of one company, in recording order.</summary>
    public IEnumerable<CogsEntry> EntriesFor(CompanyId company)
        => _entries.Where(e => e.Company == company);

    /// <summary>The company's entries dated within <c>[from, toInclusive]</c>, in recording order (O(log n + k)).</summary>
    public IEnumerable<CogsEntry> EntriesInRange(CompanyId company, GameDate from, GameDate toInclusive)
        => _index.Range(_entries, e => e.Date, e => e.Company == company, from, toInclusive);
}
