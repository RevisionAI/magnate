using System;
using System.Collections.Generic;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// Date-range lookups over an append-only, date-ordered log (bridge-spec E8). Every engine log
/// (<see cref="Ledger"/>, <see cref="CogsLog"/>, <see cref="TransferLog"/>,
/// <see cref="AccrualJournal"/>) is appended with <c>Clock.Now</c>, which never goes back, so
/// entries are chronological and a month range is a contiguous slice found by binary search:
/// O(log n + k) instead of O(n). A log that is ever appended out of order (only possible by
/// calling a public <c>Record</c> directly) permanently falls back to the linear scan, so the
/// results are identical either way — same entries, same order.
/// </summary>
internal sealed class ChronologicalIndex
{
    private GameDate _last;
    private bool _hasEntries;

    /// <summary>False once an entry older than its predecessor was recorded.</summary>
    public bool IsChronological { get; private set; } = true;

    /// <summary>Observe the date of an entry about to be appended.</summary>
    public void Observe(GameDate date)
    {
        if (_hasEntries && date < _last) IsChronological = false;
        _last = date;
        _hasEntries = true;
    }

    /// <summary>
    /// Entries of <paramref name="items"/> dated in <c>[from, toInclusive]</c> that match
    /// <paramref name="filter"/>, in log order. Evaluated lazily, like LINQ.
    /// </summary>
    public IEnumerable<T> Range<T>(
        IReadOnlyList<T> items,
        Func<T, GameDate> dateOf,
        Func<T, bool> filter,
        GameDate from,
        GameDate toInclusive)
    {
        if (!IsChronological)
        {
            foreach (var item in items)
            {
                var date = dateOf(item);
                if (date >= from && date <= toInclusive && filter(item)) yield return item;
            }

            yield break;
        }

        // Lower bound: first index whose date is >= from.
        int lo = 0, hi = items.Count;
        while (lo < hi)
        {
            var mid = lo + ((hi - lo) >> 1);
            if (dateOf(items[mid]) < from) lo = mid + 1;
            else hi = mid;
        }

        for (var i = lo; i < items.Count; i++)
        {
            var item = items[i];
            if (dateOf(item) > toInclusive) yield break;
            if (filter(item)) yield return item;
        }
    }
}
