using System;
using System.Collections.Generic;
using System.Linq;

namespace Magnate.Bridge;

/// <summary>
/// The persisted activity feed (bridge-spec §4.2, §7.2): a ring buffer of every
/// event with priority ≥ 1, newest last, plus the monotonic event sequence.
/// Priority-0 events (per-building sales popups, month-close markers) travel
/// only in the response that produced them.
/// </summary>
internal sealed class ActivityFeed
{
    /// <summary>Default ring capacity.</summary>
    public const int DefaultCapacity = 2000;

    private readonly LinkedList<GameEventDto> _events = new();

    public int Capacity { get; private set; } = DefaultCapacity;

    /// <summary>Sequence of the most recent event (0 before any).</summary>
    public long LatestSeq { get; private set; }

    /// <summary>Stamp <paramref name="e"/> with the next sequence and its month; persist it when priority ≥ 1.</summary>
    public GameEventDto Publish(GameEventDto e, DateDto month)
    {
        LatestSeq++;
        var stamped = e with { Seq = LatestSeq, Month = e.Month ?? month };
        if (stamped.Priority >= 1)
        {
            _events.AddLast(stamped);
            while (_events.Count > Capacity) _events.RemoveFirst();
        }
        return stamped;
    }

    /// <summary>Feed page: events after <paramref name="sinceSeq"/>, filtered, at most <paramref name="limit"/> (newest kept).</summary>
    public FeedDto Query(long? sinceSeq, int limit, IReadOnlyList<string>? kinds, string? search)
    {
        limit = Math.Clamp(limit, 1, 1000);
        var kindSet = kinds is { Count: > 0 } ? new HashSet<string>(kinds, StringComparer.Ordinal) : null;
        IEnumerable<GameEventDto> query = _events;
        if (sinceSeq is long since) query = query.Where(e => e.Seq > since);
        if (kindSet is not null) query = query.Where(e => kindSet.Contains(e.Kind));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var needle = search.Trim();
            query = query.Where(e => e.Message.Contains(needle, StringComparison.OrdinalIgnoreCase));
        }
        var list = query.ToList();
        if (list.Count > limit) list = list.GetRange(list.Count - limit, limit);
        return new FeedDto(list, LatestSeq);
    }

    public FeedStateDto Save() => new(LatestSeq, Capacity, _events.ToList());

    public void Restore(FeedStateDto? state)
    {
        _events.Clear();
        if (state is null) return;
        Capacity = state.Capacity > 0 ? state.Capacity : DefaultCapacity;
        LatestSeq = Math.Max(0, state.Seq);
        foreach (var e in state.Events ?? Array.Empty<GameEventDto>())
        {
            _events.AddLast(e);
            if (e.Seq > LatestSeq) LatestSeq = e.Seq;
        }
        while (_events.Count > Capacity) _events.RemoveFirst();
    }
}

/// <summary>Persisted feed (save sidecar).</summary>
public sealed record FeedStateDto(long Seq, int Capacity, IReadOnlyList<GameEventDto>? Events);
