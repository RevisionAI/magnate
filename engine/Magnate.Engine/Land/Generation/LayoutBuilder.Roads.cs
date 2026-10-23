using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land.Generation;

// Stage 2/3 — the road network.
//
//  * Trunk network: a lattice of avenues aligned with the CBD at irregular
//    spacing. Every other line is a straight PRIMARY avenue that carries on past
//    the urban edge as a country road (and as a highway where the profile has
//    one); the lines between are SECONDARY avenues that jog sideways at primary
//    crossings and stop near the urban edge — so the plan reads as a city, not a
//    board-game lattice.
//  * Waterfront boulevard, port roads and river embankments.
//  * Local streets laid per block with district-specific patterns and varied
//    block depth (strips of 2–11 plots), cul-de-sac combs in the outer suburbs.
//  * The deep-block splitter (which lays the farm tracks), access roads for
//    reservations and a connectivity repair that guarantees ONE network.
//
// Invariant enforced on every road plot laid: no 2×2 square of road plots. A
// 1-plot street grid never has one; it is the signature of two parallel roads
// running side by side, which renders as a 48 m road with a junction per plot.
internal sealed partial class LayoutBuilder
{
    private readonly List<int> _xLines = new();
    private readonly List<int> _zLines = new();
    private readonly List<(int Index, RoadClass Previous)> _runChanges = new();
    private int _mainX = -1;
    private int _mainZ = -1;

    /// <summary>Longest farm track the splitter lays in one go (plots).</summary>
    private const int RuralLaneMax = 24;

    /// <summary>Depth of the quay land between the water and the port road: a seaport's short side.</summary>
    private const int QuayDepth = 3;

    // ------------------------------------------------------------------ road plumbing

    private int SpanIndex(bool vertical, int fixedCoord, int t) => vertical ? Idx(fixedCoord, t) : Idx(t, fixedCoord);

    /// <summary>True when making (x, z) a road would complete a 2×2 square of road plots.</summary>
    private bool Completes2x2(int x, int z)
    {
        for (var oz = -1; oz <= 0; oz++)
        {
            for (var ox = -1; ox <= 0; ox++)
            {
                var x0 = x + ox;
                var z0 = z + oz;
                if (x0 < 0 || z0 < 0 || x0 + 1 >= W || z0 + 1 >= H) continue;
                var roads = 0;
                for (var dz = 0; dz <= 1; dz++)
                {
                    for (var dx = 0; dx <= 1; dx++)
                    {
                        var cx = x0 + dx;
                        var cz = z0 + dz;
                        if ((cx != x || cz != z) && Road[cz * W + cx] != RoadClass.None) roads++;
                    }
                }
                if (roads == 3) return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Lays the plots <paramref name="from"/>..<paramref name="to"/> of a straight
    /// line one at a time, skipping plots where <paramref name="allowed"/> fails or
    /// where a new road would complete a 2×2 square. Each contiguous laid piece
    /// becomes a span when it is at least <paramref name="minLength"/> long or when
    /// both its ends abut existing roads (a short connector); otherwise it is
    /// rolled back. Returns the number of plots in kept pieces.
    /// </summary>
    private int AddRun(bool vertical, int fixedCoord, int from, int to, RoadClass cls, Func<int, bool> allowed, int minLength = 2)
    {
        var limit = vertical ? H : W;
        if (fixedCoord < 0 || fixedCoord >= (vertical ? W : H)) return 0;
        from = Math.Max(0, from);
        to = Math.Min(limit - 1, to);
        var kept = 0;
        var pieceStart = -1;
        for (var t = from; t <= to + 1; t++)
        {
            if (t <= to)
            {
                var i = SpanIndex(vertical, fixedCoord, t);
                if (allowed(i))
                {
                    var x = vertical ? fixedCoord : t;
                    var z = vertical ? t : fixedCoord;
                    if (Road[i] != RoadClass.None || !Completes2x2(x, z))
                    {
                        if (pieceStart < 0)
                        {
                            pieceStart = t;
                            _runChanges.Clear();
                        }
                        if (Road[i] < cls)
                        {
                            _runChanges.Add((i, Road[i]));
                            Road[i] = cls;
                        }
                        continue;
                    }
                }
            }

            if (pieceStart < 0) continue;
            var length = t - pieceStart;
            var abutLow = pieceStart > 0 && IsRoad(SpanIndex(vertical, fixedCoord, pieceStart - 1));
            var abutHigh = t < limit && IsRoad(SpanIndex(vertical, fixedCoord, t));
            if (_runChanges.Count > 0 && (length >= Math.Max(1, minLength) || (abutLow && abutHigh)))
            {
                Spans.Add(new RoadSpan(vertical, fixedCoord, pieceStart, t - 1, cls));
                kept += length;
            }
            else
            {
                for (var k = _runChanges.Count - 1; k >= 0; k--) Road[_runChanges[k].Index] = _runChanges[k].Previous;
            }
            pieceStart = -1;
        }
        return kept;
    }

    /// <summary>Lays a 4-connected plot path as straight spans (all or nothing: returns false and lays nothing if a plot would complete a 2×2 square).</summary>
    private bool LayPath(List<int> path, RoadClass cls)
    {
        var changes = new List<(int Index, RoadClass Previous)>();
        foreach (var c in path)
        {
            if (Road[c] == RoadClass.None && Completes2x2(c % W, c / W))
            {
                for (var k = changes.Count - 1; k >= 0; k--) Road[changes[k].Index] = changes[k].Previous;
                return false;
            }
            if (Road[c] < cls)
            {
                changes.Add((c, Road[c]));
                Road[c] = cls;
            }
        }

        // Group consecutive collinear plots into spans.
        var start = 0;
        while (start < path.Count)
        {
            var end = start;
            if (start + 1 < path.Count)
            {
                var vertical = path[start + 1] % W == path[start] % W;
                while (end + 1 < path.Count && (vertical ? path[end + 1] % W == path[start] % W : path[end + 1] / W == path[start] / W)) end++;
                var a = path[start];
                var b = path[end];
                Spans.Add(vertical
                    ? new RoadSpan(true, a % W, a / W, b / W, cls)
                    : new RoadSpan(false, a / W, a % W, b % W, cls));
            }
            else
            {
                var a = path[start];
                Spans.Add(new RoadSpan(true, a % W, a / W, a / W, cls));
            }
            start = end + 1;
        }
        return true;
    }

    /// <summary>Re-derives the per-plot road grid from the span list (after spans were removed or merged).</summary>
    private void Rasterize()
    {
        MergeSpans();
        Array.Clear(Road);
        foreach (var s in Spans)
        {
            for (var t = s.From; t <= s.To; t++)
            {
                var i = SpanIndex(s.Vertical, s.Fixed, t);
                if (Road[i] < s.Class) Road[i] = s.Class;
            }
        }
    }

    /// <summary>Merges collinear spans of the same class that overlap or touch.</summary>
    private void MergeSpans()
    {
        Spans.Sort((a, b) =>
        {
            var c = a.Vertical.CompareTo(b.Vertical);
            if (c != 0) return c;
            c = a.Fixed.CompareTo(b.Fixed);
            if (c != 0) return c;
            c = a.Class.CompareTo(b.Class);
            if (c != 0) return c;
            c = a.From.CompareTo(b.From);
            return c != 0 ? c : a.To.CompareTo(b.To);
        });
        var merged = new List<RoadSpan>(Spans.Count);
        foreach (var s in Spans)
        {
            if (merged.Count > 0)
            {
                var last = merged[^1];
                if (last.Vertical == s.Vertical && last.Fixed == s.Fixed && last.Class == s.Class && s.From <= last.To + 1)
                {
                    last.To = Math.Max(last.To, s.To);
                    continue;
                }
            }
            merged.Add(s);
        }
        Spans.Clear();
        Spans.AddRange(merged);
    }

    private bool StreetAllowed(int i) => Water[i] == WaterKind.None && Reserve[i] == 0 && !Beach[i] && !Quay[i];

    private bool UrbanStreetAllowed(int i) => StreetAllowed(i) && IsUrban(Dist[i]);

    // ------------------------------------------------------------------ trunk network

    private void BuildArterials()
    {
        var rng = Rng("arterials");
        PlaceLines(_xLines, CbdX, W, rng);
        PlaceLines(_zLines, CbdZ, H, rng);

        // Lines parallel to a river must not run inside its urban channel.
        if (_riverStart is not null)
        {
            var parallel = P.River == RiverCourse.NorthSouth ? _xLines : _zLines;
            var centre = P.River == RiverCourse.NorthSouth ? CbdZ : CbdX;
            var reach = P.River == RiverCourse.NorthSouth ? Rz : Rx;
            var lo = (int)Math.Floor(centre - 1.25 * reach);
            var hi = (int)Math.Ceiling(centre + 1.25 * reach);
            for (var k = parallel.Count - 1; k >= 0; k--)
            {
                var shifted = ShiftOffRiver(parallel[k], lo, hi);
                if (shifted < 0 || (shifted != parallel[k] && parallel.Contains(shifted))) parallel.RemoveAt(k);
                else parallel[k] = shifted;
            }
        }

        _xLines.Sort();
        _zLines.Sort();
        RemoveCrowded(_xLines, P.ArterialSpacingMin - 3);
        RemoveCrowded(_zLines, P.ArterialSpacingMin - 3);
        _mainX = Nearest(_xLines, CbdX);
        _mainZ = Nearest(_zLines, CbdZ);

        var mainXi = _xLines.IndexOf(_mainX);
        var mainZi = _zLines.IndexOf(_mainZ);
        var primaryX = new List<int>();
        var primaryZ = new List<int>();
        for (var k = 0; k < _xLines.Count; k++)
        {
            if ((k - mainXi) % 2 == 0) primaryX.Add(_xLines[k]);
        }
        for (var k = 0; k < _zLines.Count; k++)
        {
            if ((k - mainZi) % 2 == 0) primaryZ.Add(_zLines[k]);
        }

        // E–W primaries first and straight; the N–S primaries may then jog in the
        // countryside where an E–W country road carries the offset.
        foreach (var z in primaryZ) LayPrimary(false, z, primaryX, rng, jogs: false);
        foreach (var x in primaryX) LayPrimary(true, x, primaryZ, rng, jogs: true);
        for (var k = 0; k < _xLines.Count; k++)
        {
            if ((k - mainXi) % 2 != 0) LaySecondary(true, k, _xLines, primaryZ, rng);
        }
        for (var k = 0; k < _zLines.Count; k++)
        {
            if ((k - mainZi) % 2 != 0) LaySecondary(false, k, _zLines, primaryX, rng);
        }
    }

    private void PlaceLines(List<int> lines, double centre, int size, LayoutRandom rng)
    {
        int Spacing() => rng.Range(P.ArterialSpacingMin, P.ArterialSpacingMax);
        var c0 = Math.Clamp((int)Math.Floor(centre), 2, size - 3);
        lines.Add(c0);
        for (var v = c0 + Spacing(); v < size - 2; v += Spacing()) lines.Add(v);
        for (var v = c0 - Spacing(); v > 1; v -= Spacing()) lines.Add(v);
    }

    /// <summary>
    /// Moves a line that runs parallel to the river out of the river corridor
    /// (keeping two plots of bank for the embankment road); -1 when no nearby
    /// column is clear over the urban stretch [lo, hi].
    /// </summary>
    private int ShiftOffRiver(int line, int lo, int hi)
    {
        var ns = P.River == RiverCourse.NorthSouth;
        var across = ns ? W : H;
        var length = ns ? H : W;
        for (var off = 0; off <= 5; off++)
        {
            foreach (var cand in off == 0 ? new[] { line } : new[] { line + off, line - off })
            {
                if (cand < 2 || cand > across - 3) continue;
                var clear = true;
                for (var t = Math.Max(0, lo); t <= Math.Min(length - 1, hi) && clear; t++)
                {
                    for (var d = -2; d <= 2 && clear; d++)
                    {
                        var a = cand + d;
                        if (a < 0 || a >= across) continue;
                        if (Water[ns ? Idx(a, t) : Idx(t, a)] == WaterKind.River) clear = false;
                    }
                }
                if (clear) return cand;
            }
        }
        return -1;
    }

    private static void RemoveCrowded(List<int> lines, int minGap)
    {
        for (var k = lines.Count - 1; k > 0; k--)
        {
            if (lines[k] - lines[k - 1] < Math.Max(4, minGap)) lines.RemoveAt(k);
        }
    }

    private static int Nearest(List<int> lines, double v)
    {
        var best = lines[0];
        foreach (var l in lines)
        {
            if (Math.Abs(l + 0.5 - v) < Math.Abs(best + 0.5 - v)) best = l;
        }
        return best;
    }

    private bool HasHighway(Compass c)
    {
        foreach (var h in P.Highways)
        {
            if (h == c) return true;
        }
        return false;
    }

    /// <summary>
    /// Plots of a line that a trunk road may not use: the sea, and water crossings
    /// longer than <paramref name="maxBridge"/> plots (a road never runs along a river).
    /// </summary>
    private bool[] TrunkBlocked(bool vertical, int fixedCoord, int maxBridge)
    {
        var length = vertical ? H : W;
        var blocked = new bool[length];
        var t = 0;
        while (t < length)
        {
            var i = SpanIndex(vertical, fixedCoord, t);
            if (Quay[i]) blocked[t] = true; // quays stay whole for seaports
            if (Water[i] == WaterKind.None)
            {
                t++;
                continue;
            }
            var end = t;
            var sea = false;
            while (end < length && Water[SpanIndex(vertical, fixedCoord, end)] != WaterKind.None)
            {
                sea |= Water[SpanIndex(vertical, fixedCoord, end)] == WaterKind.Sea;
                end++;
            }
            if (sea || end - t > maxBridge || t == 0 || end == length)
            {
                for (var k = t; k < end; k++) blocked[k] = true;
            }
            t = end;
        }
        return blocked;
    }

    /// <summary>
    /// A primary avenue: an arterial through the city, then a highway (on the main
    /// line, towards a highway direction) or a country road beyond the urban edge.
    /// Country roads reach the map edge with probability
    /// <see cref="CityProfile.CountryRoadChance"/>, otherwise they end at the first
    /// crossing past the edge; N–S country roads may jog sideways at E–W crossings.
    /// </summary>
    private void LayPrimary(bool vertical, int c, List<int> crossings, LayoutRandom rng, bool jogs)
    {
        var length = vertical ? H : W;
        var across = vertical ? W : H;
        var isMain = vertical ? c == _mainX : c == _mainZ;
        var centre = vertical ? CbdZ : CbdX;
        var hwyLow = isMain && (vertical ? HasHighway(Compass.North) : HasHighway(Compass.West));
        var hwyHigh = isMain && (vertical ? HasHighway(Compass.South) : HasHighway(Compass.East));
        var family = vertical ? _xLines : _zLines;
        var index = family.IndexOf(c);
        var lowNeighbour = index > 0 ? family[index - 1] : int.MinValue / 2;
        var highNeighbour = index + 1 < family.Count ? family[index + 1] : int.MaxValue / 2;

        var classes = new RoadClass[length];
        var urban = 0;
        var wet = 0;
        for (var t = 0; t < length; t++)
        {
            var i = SpanIndex(vertical, c, t);
            var highway = t + 0.5 < centre ? hwyLow : hwyHigh;
            if (highway && Rho[i] > 0.85) classes[t] = RoadClass.Highway;
            else if (Rho[i] <= 1.04) classes[t] = RoadClass.Arterial;
            else if (highway) classes[t] = RoadClass.Highway;
            else classes[t] = RoadClass.Local; // country road
            if (classes[t] == RoadClass.Arterial)
            {
                urban++;
                if (Water[i] == WaterKind.Sea) wet++;
            }
        }

        // Urban avenues that are mostly in the sea are dropped (lines grazing the coast).
        if (!isMain && urban > 0 && wet > 0.3 * urban) return;

        // The urban stretch: the plots between the first and last arterial plot.
        var firstUrban = Array.IndexOf(classes, RoadClass.Arterial);
        var lastUrban = Array.LastIndexOf(classes, RoadClass.Arterial);

        // Country roads that do not reach the map edge stop at the first crossing past the city.
        for (var side = 0; side < 2; side++)
        {
            var high = side == 1;
            if (high ? hwyHigh : hwyLow) continue;
            if (rng.Chance(P.CountryRoadChance)) continue;
            var edge = firstUrban < 0 ? (int)centre : high ? lastUrban : firstUrban;
            var stop = high ? length : -1;
            foreach (var x in crossings)
            {
                if (high && x > edge && x < stop) stop = x;
                if (!high && x < edge && x > stop) stop = x;
            }
            if (high)
            {
                for (var t = Math.Max(edge + 1, stop + 1); t < length; t++) classes[t] = RoadClass.None;
                if (stop == length) for (var t = edge + 1; t < length; t++) classes[t] = RoadClass.None;
            }
            else
            {
                for (var t = Math.Min(edge - 1, stop - 1); t >= 0; t--) classes[t] = RoadClass.None;
                if (stop == -1) for (var t = edge - 1; t >= 0; t--) classes[t] = RoadClass.None;
            }
        }

        // Per-plot fixed coordinate: straight, or jogging at crossings in the countryside.
        var fixedAt = new int[length];
        var jogRow = new bool[length];
        Array.Fill(fixedAt, c);
        if (jogs && !isMain)
        {
            foreach (var high in new[] { false, true })
            {
                var start = (int)Math.Clamp(centre, 0, length - 1);
                var offset = 0;
                for (var t = start; high ? t < length : t >= 0; t += high ? 1 : -1)
                {
                    fixedAt[t] = c + offset;
                    if (classes[t] != RoadClass.Local || !crossings.Contains(t) || !rng.Chance(P.RuralJogChance)) continue;
                    var magnitude = rng.Range(1, 3);
                    var sign = rng.Chance(0.5) ? 1 : -1;
                    foreach (var candidate in new[] { offset + sign * magnitude, offset - sign * magnitude })
                    {
                        var target = c + candidate;
                        if (Math.Abs(candidate) > 3 || target - lowNeighbour < 4 || highNeighbour - target < 4 || target < 1 || target > across - 2) continue;
                        var ok = true;
                        for (var a = Math.Min(c + offset, target); a <= Math.Max(c + offset, target) && ok; a++) ok = IsRoad(SpanIndex(!vertical, t, a));
                        if (!ok) continue;
                        offset = candidate; // the crossing plot itself stays on the old line
                        jogRow[t] = true;
                        break;
                    }
                }
            }
        }

        // Lay maximal runs of equal (fixed coordinate, class). A run that meets a
        // jog also takes the crossing plot on its own line, which the E–W road
        // already covers, so the two pieces stay connected through it.
        var runStart = 0;
        for (var t = 1; t <= length; t++)
        {
            if (t < length && classes[t] == classes[runStart] && fixedAt[t] == fixedAt[runStart]) continue;
            var cls = classes[runStart];
            var fixedCoord = fixedAt[runStart];
            if (cls != RoadClass.None)
            {
                var from = runStart > 0 && jogRow[runStart - 1] && fixedAt[runStart - 1] != fixedCoord ? runStart - 1 : runStart;
                var to = t < length && jogRow[t] && fixedAt[t] != fixedCoord ? t : t - 1;
                var blocked = TrunkBlocked(vertical, fixedCoord, 4);
                AddRun(vertical, fixedCoord, from, to, cls, i => !blocked[vertical ? i / W : i % W] && Reserve[i] == 0, 3);
            }
            runStart = t;
        }
    }

    /// <summary>
    /// A secondary avenue between two primaries: it may jog sideways by 1–2 plots
    /// where it crosses a primary (the primary carries the offset), is an arterial
    /// in the inner city and a collector further out, and ends at the urban edge —
    /// extended as a local road to the next primary when that one is close.
    /// </summary>
    private void LaySecondary(bool vertical, int lineIndex, List<int> family, List<int> primaryCross, LayoutRandom rng)
    {
        var length = vertical ? H : W;
        var across = vertical ? W : H;
        var baseCoord = family[lineIndex];
        var lowNeighbour = lineIndex > 0 ? family[lineIndex - 1] : int.MinValue / 2;
        var highNeighbour = lineIndex + 1 < family.Count ? family[lineIndex + 1] : int.MaxValue / 2;
        var centre = vertical ? CbdZ : CbdX;

        // Interval k spans the plots between primary crossings k−1 and k (both inclusive).
        var crossings = primaryCross;
        var intervals = crossings.Count + 1;
        var home = 0;
        while (home < crossings.Count && crossings[home] + 0.5 < centre) home++;
        var offset = new int[intervals];
        for (var k = home + 1; k < intervals; k++) offset[k] = Jog(offset[k - 1], crossings[k - 1]);
        for (var k = home - 1; k >= 0; k--) offset[k] = Jog(offset[k + 1], crossings[k]);

        int Jog(int previous, int crossing)
        {
            var fixedHere = baseCoord + previous;
            if (fixedHere < 0 || fixedHere >= across) return previous;
            if (Rho[SpanIndex(vertical, fixedHere, crossing)] < 0.3 || !rng.Chance(P.JogChance)) return previous;
            var magnitude = rng.Chance(0.6) ? 1 : 2;
            var sign = rng.Chance(0.5) ? 1 : -1;
            foreach (var candidate in new[] { previous + sign * magnitude, previous - sign * magnitude })
            {
                if (Math.Abs(candidate) > 2) continue;
                var target = baseCoord + candidate;
                if (target - lowNeighbour < 4 || highNeighbour - target < 4 || target < 2 || target > across - 3) continue;
                // The primary must carry the offset: every plot between the two positions is already road.
                var ok = true;
                for (var a = Math.Min(fixedHere, target); a <= Math.Max(fixedHere, target) && ok; a++)
                {
                    ok = IsRoad(SpanIndex(!vertical, crossing, a));
                }
                if (ok) return candidate;
            }
            return previous;
        }

        for (var k = 0; k < intervals; k++)
        {
            var fixedCoord = baseCoord + offset[k];
            if (fixedCoord < 0 || fixedCoord >= across) continue;
            var from = k == 0 ? 0 : crossings[k - 1];
            var to = k == intervals - 1 ? length - 1 : crossings[k];

            // Classes inside the city; plots past the urban edge are trimmed below.
            var classes = new RoadClass[length];
            for (var t = from; t <= to; t++)
            {
                var rho = Rho[SpanIndex(vertical, fixedCoord, t)];
                classes[t] = rho <= 0.6 ? RoadClass.Arterial : rho <= 1.0 ? RoadClass.Collector : RoadClass.None;
            }

            // Ends: an interval that leaves the city stops at its last urban plot,
            // or reaches on to the next primary as a local road when that is near.
            var towardsHigh = k >= home;
            if (k != home)
            {
                var inner = towardsHigh ? from : to;
                var outer = towardsHigh ? to : from;
                var step = towardsHigh ? 1 : -1;
                var last = inner;
                for (var t = inner; t != outer + step; t += step)
                {
                    if (classes[t] == RoadClass.None) break;
                    last = t;
                }
                var reachesCrossing = (towardsHigh && k < intervals - 1) || (!towardsHigh && k > 0);
                var gap = Math.Abs(outer - last);
                for (var t = last + step; t != outer + step; t += step)
                {
                    classes[t] = reachesCrossing && gap <= 8 ? RoadClass.Local : RoadClass.None;
                }
                if (classes[outer] == RoadClass.None && Math.Abs(last - inner) < 4)
                {
                    for (var t = inner; t != outer + step; t += step) classes[t] = RoadClass.None;
                }
            }

            var blocked = TrunkBlocked(vertical, fixedCoord, 4);
            var start = from;
            for (var t = from + 1; t <= to + 1; t++)
            {
                if (t <= to && classes[t] == classes[start]) continue;
                if (classes[start] != RoadClass.None)
                {
                    AddRun(vertical, fixedCoord, start, t - 1, classes[start], i => !blocked[vertical ? i / W : i % W] && Reserve[i] == 0, 2);
                }
                start = t;
            }
        }
    }

    // ------------------------------------------------------------------ waterfront, port and embankment roads

    private void BuildWaterfrontRoads()
    {
        BuildEmbankments();
        if (_coastDepth is null) return;

        // CBD promenade: one plot of plaza along the straight bay head, then a boulevard.
        var head = CoastDepthMax(_cbdWaterT0, _cbdWaterT1);
        LayCoastRoad(_cbdWaterT0, _cbdWaterT1, head + 1, RoadClass.Arterial);
        ReserveCoastStrip(_cbdWaterT0, _cbdWaterT1, head, ReservationUse.Park);

        // Port roads keep every quay lot exactly one seaport deep (QuayDepth) with
        // the water on one side and a collector on the other: one road along the
        // straight quay line and, around a dredged basin, a frame of three roads —
        // one behind each side quay and one behind the head of the basin.
        foreach (var (t0, t1) in _portRanges)
        {
            var quay = CoastDepthMin(t0, t1);
            var deepest = CoastDepthMax(t0, t1);
            if (deepest <= quay + QuayDepth)
            {
                LayCoastRoad(t0, t1, quay + QuayDepth, RoadClass.Collector);
                continue;
            }
            var b0 = t0;
            var b1 = t1;
            while (b0 <= t1 && _coastDepth[b0] < deepest) b0++;
            while (b1 >= t0 && _coastDepth[b1] < deepest) b1--;
            var west = b0 - QuayDepth - 1;
            var east = b1 + QuayDepth + 1;
            LayCoastRoad(t0, west, quay + QuayDepth, RoadClass.Collector);
            LayCoastRoad(east, t1, quay + QuayDepth, RoadClass.Collector);
            LayCoastRoad(west, east, deepest + QuayDepth, RoadClass.Collector);
            LayCoastRoadAcross(west, quay + QuayDepth, deepest + QuayDepth, RoadClass.Collector);
            LayCoastRoadAcross(east, quay + QuayDepth, deepest + QuayDepth, RoadClass.Collector);
        }
    }

    /// <summary>A road perpendicular to the coast at position <paramref name="t"/>, from inland distance <paramref name="u0"/> to <paramref name="u1"/>.</summary>
    private void LayCoastRoadAcross(int t, int u0, int u1, RoadClass cls)
    {
        if (t < 0 || t >= _coastLength) return;
        var (xa, za) = FromCoast(t, u0);
        var (xb, zb) = FromCoast(t, u1);
        if (!In(xa, za) || !In(xb, zb)) return;
        if (CoastAlongX) AddRun(true, xa, Math.Min(za, zb), Math.Max(za, zb), cls, StreetAllowed, 2);
        else AddRun(false, za, Math.Min(xa, xb), Math.Max(xa, xb), cls, StreetAllowed, 2);
    }

    private int CoastDepthMax(int t0, int t1)
    {
        var d = 0;
        for (var t = Math.Max(0, t0); t <= Math.Min(_coastLength - 1, t1); t++) d = Math.Max(d, _coastDepth![t]);
        return d;
    }

    private int CoastDepthMin(int t0, int t1)
    {
        var d = int.MaxValue;
        for (var t = Math.Max(0, t0); t <= Math.Min(_coastLength - 1, t1); t++) d = Math.Min(d, _coastDepth![t]);
        return d == int.MaxValue ? 0 : d;
    }

    /// <summary>A road parallel to the coast at inland distance <paramref name="u"/> over t0..t1.</summary>
    private void LayCoastRoad(int t0, int t1, int u, RoadClass cls)
    {
        t0 = Math.Max(0, t0);
        t1 = Math.Min(_coastLength - 1, t1);
        if (t1 - t0 < 3) return;
        var (xa, za) = FromCoast(t0, u);
        var (xb, zb) = FromCoast(t1, u);
        if (!In(xa, za) || !In(xb, zb)) return;
        if (CoastAlongX) AddRun(false, za, Math.Min(xa, xb), Math.Max(xa, xb), cls, StreetAllowed, 3);
        else AddRun(true, xa, Math.Min(za, zb), Math.Max(za, zb), cls, StreetAllowed, 3);
    }

    /// <summary>Reserves the 1-plot strip at inland distance <paramref name="u"/> (between water and promenade road).</summary>
    private void ReserveCoastStrip(int t0, int t1, int u, ReservationUse use)
    {
        t0 = Math.Max(0, t0);
        t1 = Math.Min(_coastLength - 1, t1);
        var runStart = -1;
        for (var t = t0; t <= t1 + 1; t++)
        {
            var ok = false;
            if (t <= t1)
            {
                var (x, z) = FromCoast(t, u);
                ok = IsFree(Idx(x, z)) && _coastDepth![t] == u;
            }
            if (ok)
            {
                if (runStart < 0) runStart = t;
                continue;
            }
            if (runStart >= 0 && t - runStart >= 2)
            {
                var (xa, za) = FromCoast(runStart, u);
                var (xb, zb) = FromCoast(t - 1, u);
                var rect = new PlotRect(Math.Min(xa, xb), Math.Min(za, zb), Math.Abs(xb - xa) + 1, Math.Abs(zb - za) + 1);
                AddReservation(rect, use, null, CivicKind.None, District.Park);
            }
            runStart = -1;
        }
    }

    /// <summary>Collector roads along both river banks through the city (the river is channelised there).</summary>
    private void BuildEmbankments()
    {
        if (_riverStart is null) return;
        var ns = P.River == RiverCourse.NorthSouth;
        var centre = ns ? CbdZ : CbdX;
        var reach = ns ? Rz : Rx;
        var length = _riverStart.Length;
        var t0 = Math.Max(0, (int)Math.Floor(centre - 0.95 * reach));
        var t1 = Math.Min(length - 1, (int)Math.Ceiling(centre + 0.95 * reach));

        for (var side = 0; side < 2; side++)
        {
            var path = new List<int>();
            var prevA = int.MinValue;
            for (var t = t0; t <= t1; t++)
            {
                var a = side == 0 ? _riverStart[t] - 1 : _riverStart[t] + _riverWidth;
                if (prevA != int.MinValue && a != prevA)
                {
                    // Connect the staircase through whichever corner plot is dry.
                    var corner = BankPlot(ns, t - 1, a) ?? BankPlot(ns, t, prevA);
                    if (corner is { } cc) path.Add(cc);
                    else
                    {
                        FlushBank(path);
                        path.Clear();
                    }
                }
                if (BankPlot(ns, t, a) is { } plot) path.Add(plot);
                else
                {
                    FlushBank(path);
                    path.Clear();
                }
                prevA = a;
            }
            FlushBank(path);
        }
    }

    private int? BankPlot(bool ns, int t, int a)
    {
        var x = ns ? a : t;
        var z = ns ? t : a;
        if (!In(x, z)) return null;
        var i = Idx(x, z);
        return StreetAllowed(i) ? i : null;
    }

    private void FlushBank(List<int> path)
    {
        if (path.Count < 3) return;
        // Lay straight pieces through AddRun so the 2×2 rule applies plot by plot.
        var start = 0;
        while (start < path.Count)
        {
            var end = start;
            var vertical = start + 1 < path.Count && path[start + 1] % W == path[start] % W;
            while (end + 1 < path.Count && (vertical ? path[end + 1] % W == path[start] % W : path[end + 1] / W == path[start] / W)) end++;
            var a = path[start];
            var b = path[end];
            if (vertical) AddRun(true, a % W, a / W, b / W, RoadClass.Collector, StreetAllowed, 1);
            else AddRun(false, a / W, Math.Min(a % W, b % W), Math.Max(a % W, b % W), RoadClass.Collector, StreetAllowed, 1);
            start = end + 1;
        }
    }

    // ------------------------------------------------------------------ blocks

    /// <summary>Labels the connected areas of free land enclosed by the trunk network.</summary>
    private void FindBlocks()
    {
        Array.Clear(BlockOf);
        Blocks.Clear();
        var queue = new int[N];
        for (var s = 0; s < N; s++)
        {
            if (!IsFree(s) || BlockOf[s] != 0) continue;
            var id = Blocks.Count + 1;
            int head = 0, tail = 0;
            queue[tail++] = s;
            BlockOf[s] = id;
            int minX = W, minZ = H, maxX = -1, maxZ = -1;
            while (head < tail)
            {
                var c = queue[head++];
                var x = c % W;
                var z = c / W;
                minX = Math.Min(minX, x);
                maxX = Math.Max(maxX, x);
                minZ = Math.Min(minZ, z);
                maxZ = Math.Max(maxZ, z);
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (!In(nx, nz)) continue;
                    var n = nz * W + nx;
                    if (BlockOf[n] != 0 || !IsFree(n)) continue;
                    BlockOf[n] = id;
                    queue[tail++] = n;
                }
            }
            Blocks.Add(new Block { Id = id, Bounds = new PlotRect(minX, minZ, maxX - minX + 1, maxZ - minZ + 1), Cells = tail });
        }
    }

    // ------------------------------------------------------------------ local streets

    private void BuildLocalStreets()
    {
        var rng = Rng("streets");
        foreach (var block in Blocks) LayBlockStreets(block, rng);
    }

    private void LayBlockStreets(Block block, LayoutRandom rng)
    {
        var rect = block.Bounds;
        if (rect.W < 3 || rect.H < 3) return;
        Span<int> histogram = stackalloc int[16];
        var urban = 0;
        var cells = 0;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                var i = Idx(x, z);
                if (BlockOf[i] != block.Id || Reserve[i] != 0) continue;
                cells++;
                if (!IsUrban(Dist[i])) continue;
                urban++;
                histogram[(int)Dist[i]]++;
            }
        }
        if (cells == 0 || urban < 0.25 * cells) return;

        var dominant = District.Houses;
        var best = -1;
        for (var d = 0; d < histogram.Length; d++)
        {
            if (histogram[d] > best)
            {
                best = histogram[d];
                dominant = (District)d;
            }
        }
        if (dominant == District.Mixed) dominant = District.Commercial;

        // Quay land stays whole: it is exactly one seaport deep between the water and the port road.
        bool Allowed(int i) => BlockOf[i] == block.Id && UrbanStreetAllowed(i) && Dist[i] != District.Port;

        // Houses and apartments: streets run along the block's long side.
        bool horizontal;
        if (dominant is District.Houses or District.Apartments)
        {
            horizontal = rect.W >= rect.H * 1.15 || (rect.H < rect.W * 1.15 && rng.Chance(0.5));
        }
        else
        {
            horizontal = rng.Chance(0.5);
        }

        // Streets that run along x (horizontal) stack their strips along z.
        var crossStart = horizontal ? rect.Pz : rect.Px;
        var crossEnd = horizontal ? rect.Bottom - 1 : rect.Right - 1;
        var primStart = horizontal ? rect.Px : rect.Pz;
        var primEnd = horizontal ? rect.Right - 1 : rect.Bottom - 1;
        var midPrim = (primStart + primEnd) / 2;

        // Outer suburbs: a comb of cul-de-sacs entered from the side facing the CBD.
        var centreRho = Rho[Idx(Math.Min(W - 1, rect.Px + rect.W / 2), Math.Min(H - 1, rect.Pz + rect.H / 2))];
        var culDeSac = dominant == District.Houses && centreRho > 0.68 && rng.Chance(0.55);
        var innerAtStart = horizontal ? CbdX < rect.Px + rect.W / 2.0 : CbdZ < rect.Pz + rect.H / 2.0;

        var streets = new List<int>();
        var pos = crossStart;
        while (true)
        {
            var probe = Math.Min(crossEnd, pos + 2);
            var district = SampleDistrict(horizontal ? midPrim : probe, horizontal ? probe : midPrim, dominant);
            var depth = StripDepth(district, rng);
            var next = pos + depth;
            if (next > crossEnd - MinStripDepth(dominant)) break;
            streets.Add(next);
            pos = next + 1;
        }

        var parallelClass = dominant switch
        {
            District.Cbd or District.Commercial or District.Industrial or District.Port => RoadClass.Collector,
            _ => RoadClass.Local,
        };
        for (var k = 0; k < streets.Count; k++)
        {
            var cls = parallelClass;
            if (dominant == District.Apartments && k % 2 == 1) cls = RoadClass.Collector;
            var from = primStart;
            var to = primEnd;
            if (culDeSac)
            {
                // Stop 2–3 plots short of the far avenue: the dead end becomes a court.
                var stop = rng.Range(2, 3);
                if (innerAtStart) to = primEnd - stop;
                else from = primStart + stop;
            }
            AddRun(!horizontal, streets[k], from, to, cls, Allowed, 3);
        }
        if (culDeSac) return;

        // Cross streets: aligned downtown and in industry, staggered in residential areas.
        var strips = new List<(int A, int B)>();
        var a = crossStart;
        foreach (var s in streets)
        {
            strips.Add((a, s - 1));
            a = s + 1;
        }
        strips.Add((a, crossEnd));

        var aligned = dominant is District.Cbd or District.Commercial or District.Industrial or District.Port;
        if (dominant is District.Industrial or District.Port && rng.Chance(0.4)) return;

        List<int>? shared = null;
        var crossClass = dominant is District.Cbd or District.Commercial ? RoadClass.Collector : RoadClass.Local;
        foreach (var (sa, sb) in strips)
        {
            if (sb < sa) continue;
            var positions = aligned && shared is not null ? shared : CrossPositions(primStart, primEnd, horizontal, (sa + sb) / 2, dominant, rng);
            if (aligned) shared ??= positions;
            foreach (var p in positions) AddRun(horizontal, p, sa, sb, crossClass, Allowed, 2);
        }
    }

    private List<int> CrossPositions(int primStart, int primEnd, bool horizontal, int crossMid, District dominant, LayoutRandom rng)
    {
        var positions = new List<int>();
        var pos = primStart;
        while (true)
        {
            var probe = Math.Min(primEnd, pos + 3);
            var district = SampleDistrict(horizontal ? probe : crossMid, horizontal ? crossMid : probe, dominant);
            var len = BlockLength(district, rng);
            var next = pos + len;
            if (next > primEnd - 3) break;
            positions.Add(next);
            pos = next + 1;
        }
        return positions;
    }

    private District SampleDistrict(int x, int z, District fallback)
    {
        if (!In(x, z)) return fallback;
        var d = Dist[Idx(x, z)];
        return IsUrban(d) ? (d == District.Mixed ? fallback : d) : fallback;
    }

    /// <summary>Depth of a strip of lots between two parallel streets (back-to-back lots), by district.</summary>
    private static int StripDepth(District d, LayoutRandom rng) => d switch
    {
        District.Cbd => rng.Range(4, 6),
        District.Commercial or District.Mixed => rng.Range(4, 5),
        District.Apartments => rng.Range(4, 6),
        District.Houses => 2 + rng.Weighted([0.55, 0.25, 0.2]),
        District.Industrial or District.Port => rng.Range(8, 11),
        _ => rng.Range(4, 6),
    };

    private static int MinStripDepth(District d) => d switch
    {
        District.Houses => 2,
        District.Industrial or District.Port => 4,
        _ => 3,
    };

    /// <summary>Length of a block along its street, by district.</summary>
    private static int BlockLength(District d, LayoutRandom rng) => d switch
    {
        District.Cbd => rng.Range(4, 6),
        District.Commercial or District.Mixed => rng.Range(5, 7),
        District.Apartments => rng.Range(7, 11),
        District.Houses => rng.Range(7, 12),
        District.Industrial or District.Port => rng.Range(10, 15),
        _ => rng.Range(7, 10),
    };

    /// <summary>Maximum distance (in plots, frontage = 1) of any lot plot from a road, by district.</summary>
    private static int MaxDepth(District d) => d switch
    {
        District.Cbd => 4,
        District.Commercial => 3,
        District.Mixed => 2,
        District.Apartments => 3,
        District.Houses => 2,
        District.Industrial => 6,
        District.Port => QuayDepth,
        District.Rural => 7,
        _ => 4,
    };

    // ------------------------------------------------------------------ deep-block splitter

    /// <summary>
    /// Every lot must touch a road, so no plot may be farther from a road than its
    /// district's maximum lot depth. Blocks that are too deep (irregular
    /// leftovers, the urban fringe, the whole rural ring) are split by a straight
    /// street through the deepest plot, along the block's longer run — which is
    /// how the countryside gets its farm tracks. Repeats until every plot is reachable.
    /// </summary>
    private void SplitDeepBlocks()
    {
        var unfixable = new bool[N];
        var dist = new int[N];
        var queue = new int[N];
        var candidates = new List<(int Excess, int Cell)>();
        var rng = Rng("split");
        for (var round = 0; round < N; round++)
        {
            RoadDistances(dist, queue);
            candidates.Clear();
            for (var i = 0; i < N; i++)
            {
                if (unfixable[i] || !IsFree(i)) continue;
                var excess = (dist[i] == int.MaxValue ? 1000 : dist[i]) - MaxDepth(Dist[i]);
                if (excess > 0) candidates.Add((excess, i));
            }
            if (candidates.Count == 0) return;

            // Worst first; later candidates of the batch are re-checked locally,
            // since an earlier split may already have brought them within reach.
            candidates.Sort((a, b) => a.Excess != b.Excess ? b.Excess.CompareTo(a.Excess) : a.Cell.CompareTo(b.Cell));
            var first = true;
            foreach (var (_, cell) in candidates)
            {
                if (unfixable[cell] || !IsFree(cell)) continue;
                if (!first && LocalRoadDistance(cell, MaxDepth(Dist[cell])) <= MaxDepth(Dist[cell])) continue;
                first = false;
                if (SplitThrough(cell, rng)) continue;
                if (dist[cell] == int.MaxValue) MarkComponent(cell, unfixable);
                else unfixable[cell] = true;
            }
        }
    }

    private int[]? _stamp;
    private int[]? _localQueue;
    private int _stampGeneration;

    /// <summary>Road distance of a free plot (frontage = 1) when it is at most <paramref name="limit"/>, else int.MaxValue.</summary>
    private int LocalRoadDistance(int cell, int limit)
    {
        _stamp ??= new int[N];
        _localQueue ??= new int[N];
        var stamp = _stamp;
        var queue = _localQueue;
        var generation = ++_stampGeneration;
        var w = W;
        var h = H;
        int head = 0, tail = 0;
        queue[tail++] = cell;
        stamp[cell] = generation;
        var levelEnd = tail;
        for (var depth = 1; depth <= limit && head < tail; depth++)
        {
            while (head < levelEnd)
            {
                var c = queue[head++];
                var x = c % w;
                var z = c / w;
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if ((uint)nx >= (uint)w || (uint)nz >= (uint)h) continue;
                    var n = nz * w + nx;
                    if (Road[n] != RoadClass.None) return depth;
                    if (stamp[n] == generation || !IsFree(n)) continue;
                    stamp[n] = generation;
                    queue[tail++] = n;
                }
            }
            levelEnd = tail;
        }
        return int.MaxValue;
    }

    /// <summary>Flags every free plot 4-connected to <paramref name="seed"/> (a pocket no road can reach).</summary>
    private void MarkComponent(int seed, bool[] flags)
    {
        var stack = new Stack<int>();
        stack.Push(seed);
        flags[seed] = true;
        while (stack.Count > 0)
        {
            var c = stack.Pop();
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = Idx(nx, nz);
                if (flags[n] || !IsFree(n)) continue;
                flags[n] = true;
                stack.Push(n);
            }
        }
    }

    /// <summary>Multi-source BFS distance from road plots over free land (frontage plots = 1, unreachable = MaxValue).</summary>
    private void RoadDistances(int[] dist, int[] queue)
    {
        Array.Fill(dist, int.MaxValue);
        int head = 0, tail = 0;
        for (var i = 0; i < N; i++)
        {
            if (!IsRoad(i)) continue;
            dist[i] = 0;
            queue[tail++] = i;
        }
        while (head < tail)
        {
            var c = queue[head++];
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = nz * W + nx;
                if (dist[n] != int.MaxValue || !IsFree(n)) continue;
                dist[n] = dist[c] + 1;
                queue[tail++] = n;
            }
        }
    }

    private bool SplitThrough(int cell, LayoutRandom rng)
    {
        var x = cell % W;
        var z = cell / W;
        var (hl, hr) = FreeRun(x, z, 1, 0);
        var (vu, vd) = FreeRun(x, z, 0, 1);

        // Urban leftovers are split along their longer run (more frontage); rural
        // blocks across it, off-centre, so fields come out as a patchwork of
        // squarish lots rather than parallel stripes.
        var rural = Dist[cell] == District.Rural;
        var horizontalFirst = rural ? hr - hl < vd - vu : hr - hl >= vd - vu;
        var jitter = rural ? rng.Range(-2, 2) : 0;

        for (var off = 0; off <= 2; off++)
        {
            for (var pass = 0; pass < 2; pass++)
            {
                var horizontal = pass == 0 ? horizontalFirst : !horizontalFirst;
                foreach (var o in off == 0 ? new[] { jitter } : new[] { jitter + off, jitter - off })
                {
                    var cx = horizontal ? x : x + o;
                    var cz = horizontal ? z + o : z;
                    if (!In(cx, cz) || !IsFree(Idx(cx, cz))) continue;
                    if (TrySplitLine(cx, cz, horizontal)) return true;
                }
            }
        }
        return false;
    }

    private (int Lo, int Hi) FreeRun(int x, int z, int dx, int dz)
    {
        var lo = dx != 0 ? x : z;
        var hi = lo;
        int cx = x - dx, cz = z - dz;
        while (In(cx, cz) && IsFree(Idx(cx, cz)))
        {
            lo--;
            cx -= dx;
            cz -= dz;
        }
        cx = x + dx;
        cz = z + dz;
        while (In(cx, cz) && IsFree(Idx(cx, cz)))
        {
            hi++;
            cx += dx;
            cz += dz;
        }
        return (lo, hi);
    }

    private bool TrySplitLine(int x, int z, bool horizontal)
    {
        var dx = horizontal ? 1 : 0;
        var dz = horizontal ? 0 : 1;
        var (lo, hi) = FreeRun(x, z, dx, dz);
        if (hi - lo < 2) return false;

        // The new street must meet an existing road at one end at least.
        var loConnects = horizontal ? RoadAt(lo - 1, z) : RoadAt(x, lo - 1);
        var hiConnects = horizontal ? RoadAt(hi + 1, z) : RoadAt(x, hi + 1);
        if (!loConnects && !hiConnects) return false;

        var district = Dist[Idx(x, z)];
        var cls = district is District.Industrial or District.Port or District.Cbd or District.Commercial
            ? RoadClass.Collector
            : RoadClass.Local;

        // Farm tracks run at most ~24 plots from the road they leave, so the
        // countryside gets a patchwork of lanes and T-junctions instead of
        // full-length stripes; the remainder is split again later.
        if (district == District.Rural && hi - lo + 1 > RuralLaneMax)
        {
            var target = horizontal ? x : z;
            if (loConnects && (!hiConnects || target - lo <= hi - target)) hi = Math.Max(target, lo + RuralLaneMax - 1);
            else lo = Math.Min(target, hi - RuralLaneMax + 1);
        }

        // Lay from the connected end so a piece cut short by the 2×2 rule still connects.
        var laid = horizontal
            ? AddRun(false, z, lo, hi, cls, IsFreeForStreet)
            : AddRun(true, x, lo, hi, cls, IsFreeForStreet);
        return laid > 0 && !IsFree(Idx(x, z));
    }

    private bool IsFreeForStreet(int i) => IsFree(i) && !Quay[i];

    private bool RoadAt(int x, int z) => In(x, z) && IsRoad(Idx(x, z));

    // ------------------------------------------------------------------ access and connectivity

    /// <summary>Gives every reservation (park, campus, deposit, port) at least one road neighbour, dropping those that cannot get one.</summary>
    private void EnsureReservationAccess()
    {
        for (var k = Reservations.Count - 1; k >= 0; k--)
        {
            var r = Reservations[k];
            if (TouchesRoad(r.Rect)) continue;
            var path = ShortestFreePath(r.Rect, 40);
            if (path is not null && LayPath(path, RoadClass.Local)) continue;
            DropReservation(r);
        }
    }

    /// <summary>Releases a reservation's plots back to ordinary land of the ring they sit in.</summary>
    private void DropReservation(Reservation r)
    {
        for (var z = r.Rect.Pz; z < r.Rect.Bottom; z++)
        {
            for (var x = r.Rect.Px; x < r.Rect.Right; x++)
            {
                var i = Idx(x, z);
                Reserve[i] = 0;
                Dist[i] = BaseDistrict(x, z);
                if (r.Use == ReservationUse.Deposit) DepositOf[i] = 0;
            }
        }
        if (r.Use == ReservationUse.Deposit) _droppedDeposits.Add(r.DepositIndex);
        Reservations.Remove(r);
    }

    private bool TouchesRoad(PlotRect rect)
    {
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (In(nx, nz) && !rect.Contains(nx, nz) && IsRoad(Idx(nx, nz))) return true;
                }
            }
        }
        return false;
    }

    /// <summary>BFS over free land from the plots around <paramref name="rect"/> to the nearest road; returns the free plots of the path.</summary>
    private List<int>? ShortestFreePath(PlotRect rect, int maxLength)
    {
        var prev = new Dictionary<int, int>();
        var queue = new Queue<(int Cell, int Depth)>();
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (!In(nx, nz) || rect.Contains(nx, nz)) continue;
                    var n = Idx(nx, nz);
                    if (!IsFree(n) || Quay[n] || prev.ContainsKey(n) || Completes2x2(nx, nz)) continue;
                    prev[n] = -1;
                    queue.Enqueue((n, 1));
                }
            }
        }
        while (queue.Count > 0)
        {
            var (c, depth) = queue.Dequeue();
            if (depth > maxLength) break;
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = Idx(nx, nz);
                if (IsRoad(n))
                {
                    var path = new List<int>();
                    for (var p = c; p != -1; p = prev[p]) path.Add(p);
                    return path;
                }
                if (!IsFree(n) || Quay[n] || prev.ContainsKey(n) || Completes2x2(nx, nz)) continue;
                prev[n] = c;
                queue.Enqueue((n, depth + 1));
            }
        }
        return null;
    }

    /// <summary>Connects or removes road components so the network is a single 4-connected graph.</summary>
    private void RepairConnectivity()
    {
        Rasterize();
        for (var round = 0; round < 256; round++)
        {
            var comp = RoadComponents(out var sizes);
            if (sizes.Count <= 1) return;
            var main = 0;
            for (var k = 1; k < sizes.Count; k++)
            {
                if (sizes[k] > sizes[main]) main = k;
            }

            // Take the first non-main component in row-major order.
            var target = -1;
            for (var i = 0; i < N && target < 0; i++)
            {
                if (comp[i] >= 0 && comp[i] != main) target = comp[i];
            }
            if (!ConnectComponent(comp, target, main))
            {
                Spans.RemoveAll(s => comp[SpanIndex(s.Vertical, s.Fixed, s.From)] == target);
                Rasterize();
            }
        }
        throw new InvalidOperationException($"city layout {City.Id}: road network did not converge to one component");
    }

    private int[] RoadComponents(out List<int> sizes)
    {
        var comp = new int[N];
        Array.Fill(comp, -1);
        sizes = new List<int>();
        var queue = new int[N];
        for (var s = 0; s < N; s++)
        {
            if (!IsRoad(s) || comp[s] >= 0) continue;
            var id = sizes.Count;
            int head = 0, tail = 0;
            queue[tail++] = s;
            comp[s] = id;
            while (head < tail)
            {
                var c = queue[head++];
                var x = c % W;
                var z = c / W;
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (!In(nx, nz)) continue;
                    var n = Idx(nx, nz);
                    if (!IsRoad(n) || comp[n] >= 0) continue;
                    comp[n] = id;
                    queue[tail++] = n;
                }
            }
            sizes.Add(tail);
        }
        return comp;
    }

    private bool ConnectComponent(int[] comp, int target, int main)
    {
        // BFS from the target component over free land until a main-component road is adjacent.
        var prev = new Dictionary<int, int>();
        var queue = new Queue<(int Cell, int Depth)>();
        for (var i = 0; i < N; i++)
        {
            if (comp[i] != target) continue;
            prev[i] = -1;
            queue.Enqueue((i, 0));
        }
        while (queue.Count > 0)
        {
            var (c, depth) = queue.Dequeue();
            if (depth > 12) break;
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = Idx(nx, nz);
                if (comp[n] == main)
                {
                    var path = new List<int>();
                    for (var p = c; p != -1 && comp[p] != target; p = prev[p]) path.Add(p);
                    if (path.Count == 0 || !LayPath(path, RoadClass.Local)) continue;
                    Rasterize();
                    return true;
                }
                if (prev.ContainsKey(n) || !IsFree(n) || Quay[n] || Completes2x2(nx, nz)) continue;
                prev[n] = c;
                queue.Enqueue((n, depth + 1));
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ bridges

    /// <summary>
    /// Gives every bridge one road class from bank to bank. Spans are laid
    /// independently, so a crossing can otherwise switch class half-way over the
    /// water (an avenue whose last bridge plot belongs to a local street), which
    /// the renderer would draw as a four-lane deck ending in a two-lane span. The
    /// highest class on the wet run wins: its span is stretched over the whole
    /// crossing onto both bank plots, and lower-class spans give up the wet plots.
    /// Only classes change — the set of road plots, and so connectivity, does not.
    /// </summary>
    private void UnifyBridgeClasses()
    {
        var changed = false;
        foreach (var vertical in new[] { false, true })
        {
            var lines = vertical ? W : H;
            var length = vertical ? H : W;
            for (var f = 0; f < lines; f++)
            {
                List<RoadSpan>? onLine = null;
                foreach (var s in Spans)
                {
                    if (s.Vertical == vertical && s.Fixed == f) (onLine ??= new List<RoadSpan>()).Add(s);
                }
                if (onLine is null) continue;

                var t = 0;
                while (t < length)
                {
                    if (!Wet(onLine, vertical, f, t)) { t++; continue; }
                    var a = t;
                    while (t + 1 < length && Wet(onLine, vertical, f, t + 1)) t++;
                    var b = t++;
                    changed |= UnifyCrossing(onLine, vertical, f, a, b, length);
                }
            }
        }
        if (changed) Rasterize();
    }

    /// <summary>True when plot <paramref name="t"/> of the line is water carried by one of its spans.</summary>
    private bool Wet(List<RoadSpan> onLine, bool vertical, int f, int t)
    {
        if (Water[SpanIndex(vertical, f, t)] == WaterKind.None) return false;
        foreach (var s in onLine)
        {
            if (s.From <= t && t <= s.To) return true;
        }
        return false;
    }

    private bool UnifyCrossing(List<RoadSpan> onLine, bool vertical, int f, int a, int b, int length)
    {
        RoadSpan? top = null;
        var mixed = false;
        foreach (var s in onLine)
        {
            if (s.To < a || s.From > b) continue;
            if (top is not null && s.Class != top.Class) mixed = true;
            if (top is null || s.Class > top.Class) top = s;
        }
        if (top is null || (!mixed && top.From < a && top.To > b)) return false;

        // Stretch the top span bank to bank, onto the road plot (often a crossing embankment road) on each shore.
        var lo = a > 0 && IsRoad(SpanIndex(vertical, f, a - 1)) ? a - 1 : a;
        var hi = b + 1 < length && IsRoad(SpanIndex(vertical, f, b + 1)) ? b + 1 : b;
        top.From = Math.Min(top.From, lo);
        top.To = Math.Max(top.To, hi);

        // Lower classes give up the crossing; pieces left wholly on the stretched span vanish.
        foreach (var s in onLine.ToArray())
        {
            if (ReferenceEquals(s, top) || s.Class >= top.Class || s.To < a || s.From > b) continue;
            Spans.Remove(s);
            onLine.Remove(s);
            if (s.From < lo) AddPiece(new RoadSpan(vertical, f, s.From, lo, s.Class));
            if (s.To > hi) AddPiece(new RoadSpan(vertical, f, hi, s.To, s.Class));
        }
        return true;

        void AddPiece(RoadSpan piece)
        {
            Spans.Add(piece);
            onLine.Add(piece);
        }
    }
}
