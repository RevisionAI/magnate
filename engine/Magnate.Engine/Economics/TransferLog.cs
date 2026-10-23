using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// One internal goods movement between two same-owner buildings. Has no cash
/// impact (transfers don't touch the cash ledger) but provides visibility for
/// production / supply-chain reporting.
/// </summary>
public sealed record TransferEntry(
    GameDate Date,
    CompanyId Company,
    BuildingInstanceId From,
    BuildingInstanceId To,
    ProductId Product,
    double Quantity);

/// <summary>Append-only log of internal building→building transfers.</summary>
public sealed class TransferLog
{
    private readonly List<TransferEntry> _entries = new();
    private readonly ChronologicalIndex _index = new();

    /// <summary>Every entry in recording order (chronological).</summary>
    public IReadOnlyList<TransferEntry> Entries => _entries;

    /// <summary>Append an entry.</summary>
    public void Record(TransferEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _index.Observe(entry.Date);
        _entries.Add(entry);
    }

    /// <summary>All entries of one company, in recording order.</summary>
    public IEnumerable<TransferEntry> EntriesFor(CompanyId company)
        => _entries.Where(e => e.Company == company);

    /// <summary>The company's entries dated within <c>[from, toInclusive]</c>, in recording order (O(log n + k)).</summary>
    public IEnumerable<TransferEntry> EntriesInRange(CompanyId company, GameDate from, GameDate toInclusive)
        => _index.Range(_entries, e => e.Date, e => e.Company == company, from, toInclusive);
}
