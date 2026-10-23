using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Land;

/// <summary>What a site search optimises.</summary>
public enum SitePreference : byte
{
    /// <summary>The category default (<see cref="AutoSiter.DefaultPreference"/>).</summary>
    Auto = 0,

    /// <summary>Highest customer traffic (retail footfall), cheaper first on ties.</summary>
    MaxTraffic = 1,

    /// <summary>Lowest land plus redevelopment cost.</summary>
    Cheapest = 2,

    /// <summary>Highest-quality deposit, cheaper first on ties (extraction).</summary>
    BestDeposit = 3,

    /// <summary>Closest to the CBD.</summary>
    NearCbd = 4,

    /// <summary>Closest to the port land (freight); falls back to <see cref="Cheapest"/> inland.</summary>
    NearPort = 5,

    /// <summary>Most traffic per dollar of total capex (construction + land + redevelopment).</summary>
    BestValue = 6,
}

/// <summary>A ranked, valid site.</summary>
/// <param name="Placement">The validated placement (always <see cref="PlacementResult.Ok"/>), facing its best road.</param>
/// <param name="Score">Ranking score (lower is better; comparable only within one search).</param>
public sealed record SiteCandidate(PlacementResult Placement, double Score)
{
    /// <summary>North-west plot x of the footprint.</summary>
    public int Px => Placement.Footprint.Px;

    /// <summary>North-west plot z of the footprint.</summary>
    public int Pz => Placement.Footprint.Pz;

    /// <summary>Rotation in degrees (the front faces the best adjacent road, or the sea for a seaport).</summary>
    public int Rotation => Placement.Rotation;
}

/// <summary>
/// Finds and ranks valid sites for a building type — for the AI's expansion and
/// the UI's "suggest a site". Every candidate returned passes
/// <see cref="PlacementValidator.Validate"/>; candidates never overlap each other.
/// </summary>
public static class AutoSiter
{
    /// <summary>Largest number of candidates one search returns.</summary>
    public const int MaxCount = 50;

    /// <summary>The preference <see cref="SitePreference.Auto"/> resolves to for a building type.</summary>
    public static SitePreference DefaultPreference(BuildingType type)
    {
        ArgumentNullException.ThrowIfNull(type);
        return SiteRules.For(type).Class switch
        {
            SiteClass.Retail or SiteClass.Media or SiteClass.Office or SiteClass.Hotel => SitePreference.BestValue,
            SiteClass.Extraction => SitePreference.BestDeposit,
            SiteClass.Industry or SiteClass.Logistics => SitePreference.NearPort,
            _ => SitePreference.Cheapest,
        };
    }

    /// <summary>
    /// Up to <paramref name="count"/> non-overlapping valid sites for
    /// <paramref name="type"/>, best first. Empty when the city cannot host the
    /// type at all (a seaport inland, a farm in a non-arable city, an oil well
    /// without oil) or when every eligible plot is taken. With a <paramref name="land"/>
    /// context, plots another company holds are unavailable, the buyer's own plots and
    /// cleared parcels cost nothing extra (see <see cref="PlacementValidator.Validate"/>).
    /// </summary>
    public static IReadOnlyList<SiteCandidate> FindSites(
        CityLayout layout,
        IPlotOccupancy occupancy,
        BuildingType type,
        SitePreference preference = SitePreference.Auto,
        int count = 5,
        CityFields? fields = null,
        LandContext? land = null)
    {
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(occupancy);
        ArgumentNullException.ThrowIfNull(type);
        count = Math.Clamp(count, 0, MaxCount);
        var rule = SiteRules.For(type);
        if (count == 0 || rule.Class == SiteClass.None || type.Footprint.Width <= 0 || type.Footprint.Height <= 0) return Array.Empty<SiteCandidate>();
        if (!CityCanHost(layout, type, rule)) return Array.Empty<SiteCandidate>();
        fields ??= layout.Fields;
        if (preference == SitePreference.Auto) preference = DefaultPreference(type);

        var grid = new SearchGrid(layout, occupancy, rule, type, fields, land);
        var portDistance = preference == SitePreference.NearPort ? grid.PortDistance() : null;
        if (preference == SitePreference.NearPort && portDistance is null) preference = SitePreference.Cheapest;

        var scored = new List<(double Score, PlotRect Rect)>();
        var orientations = type.Footprint.Width == type.Footprint.Height
            ? new[] { (type.Footprint.Width, type.Footprint.Height) }
            : new[] { (type.Footprint.Width, type.Footprint.Height), (type.Footprint.Height, type.Footprint.Width) };
        foreach (var (w, h) in orientations)
        {
            for (var pz = 0; pz + h <= layout.Height; pz++)
            {
                for (var px = 0; px + w <= layout.Width; px++)
                {
                    var rect = new PlotRect(px, pz, w, h);
                    if (!grid.Feasible(rect)) continue;
                    scored.Add((Score(grid, rect, preference, type, portDistance), rect));
                }
            }
        }
        scored.Sort((a, b) =>
        {
            var c = a.Score.CompareTo(b.Score);
            if (c != 0) return c;
            c = a.Rect.Pz.CompareTo(b.Rect.Pz);
            if (c != 0) return c;
            c = a.Rect.Px.CompareTo(b.Rect.Px);
            return c != 0 ? c : a.Rect.W.CompareTo(b.Rect.W);
        });

        var result = new List<SiteCandidate>();
        var taken = new List<PlotRect>();
        foreach (var (score, rect) in scored)
        {
            if (result.Count >= count) break;
            var overlaps = false;
            foreach (var t in taken)
            {
                if (t.Intersects(rect))
                {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) continue;
            var rotation = BestRotation(layout, rect, type.Footprint, rule.NeedsCoast);
            var placement = PlacementValidator.Validate(layout, occupancy, type, rect.Px, rect.Pz, rotation, fields, land);
            if (!placement.Ok) continue; // the pre-filter mirrors the validator; this is a safety net
            taken.Add(rect);
            result.Add(new SiteCandidate(placement, score));
        }
        return result;
    }

    /// <summary>
    /// The rotation (degrees) whose front faces the best adjacent road (art §5.3:
    /// arterial 3, street 2, highway 1; ties S, E, N, W), or the sea for seaports,
    /// among the two rotations that give the rectangle its size.
    /// </summary>
    public static int BestRotation(CityLayout layout, PlotRect rect, Footprint footprint, bool faceWater = false)
    {
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(footprint);
        var swapped = rect.W != rect.H && rect.W == footprint.Height && rect.H == footprint.Width;
        // Facing S (0) / N (180) keep the declared size; E (90) / W (270) swap it.
        var options = rect.W == rect.H ? new[] { 0, 90, 180, 270 } : swapped ? new[] { 90, 270 } : new[] { 0, 180 };
        var best = options[0];
        var bestScore = -1;
        foreach (var rotation in options)
        {
            var score = SideScore(layout, rect, rotation / 90, faceWater);
            if (score > bestScore)
            {
                bestScore = score;
                best = rotation;
            }
        }
        return best;
    }

    private static int SideScore(CityLayout layout, PlotRect rect, int facing, bool faceWater)
    {
        var score = 0;
        int count = facing is 0 or 2 ? rect.W : rect.H;
        for (var k = 0; k < count; k++)
        {
            var (x, z) = facing switch
            {
                0 => (rect.Px + k, rect.Bottom),
                1 => (rect.Right, rect.Pz + k),
                2 => (rect.Px + k, rect.Pz - 1),
                _ => (rect.Px - 1, rect.Pz + k),
            };
            if (!layout.InBounds(x, z)) continue;
            if (faceWater && layout.KindAt(x, z) == PlotKind.Water && layout.WaterAt(x, z) == WaterKind.Sea)
            {
                score = Math.Max(score, 10);
                continue;
            }
            var s = layout.RoadAt(x, z) switch
            {
                RoadClass.Arterial => 3,
                RoadClass.Collector or RoadClass.Local => 2,
                RoadClass.Highway => 1,
                _ => 0,
            };
            score = Math.Max(score, s);
        }
        return score;
    }

    private static bool CityCanHost(CityLayout layout, BuildingType type, SiteRule rule)
    {
        var city = layout.Geography;
        var geo = type.GeographyRequirement;
        if ((rule.NeedsCoast || geo?.Coastal == true) && !city.Coastal) return false;
        if ((rule.Deposit == DepositKind.Iron || geo?.MineralRich == true) && !city.MineralRich) return false;
        if ((rule.Deposit == DepositKind.Oil || geo?.OilRich == true) && !city.OilRich) return false;
        if (rule.NeedsArable && !city.Arable) return false;
        return true;
    }

    private static double Score(SearchGrid grid, PlotRect rect, SitePreference preference, BuildingType type, int[]? portDistance)
    {
        // Primary criterion plus a vanishing cost term that only breaks ties
        // (site costs stay below $10^9, so the term stays below 10^-4).
        var siteCost = grid.SiteCost(rect);
        const double tie = 1e-13;
        return preference switch
        {
            SitePreference.MaxTraffic => -grid.MeanTraffic(rect) + tie * siteCost,
            SitePreference.BestDeposit => -grid.DepositQuality(rect) + tie * siteCost,
            SitePreference.NearCbd => grid.CbdDistance(rect) + tie * siteCost,
            SitePreference.NearPort => grid.MinOver(rect, portDistance!) + tie * siteCost,
            SitePreference.BestValue => -grid.LocationFactor(rect) * (double)Math.Max(1m, type.ConstructionCost)
                / ((double)Math.Max(1m, type.ConstructionCost) + siteCost),
            _ => siteCost,
        };
    }

    /// <summary>Per-plot eligibility and summed-area tables for one search.</summary>
    private sealed class SearchGrid
    {
        private readonly CityLayout _layout;
        private readonly CityFields _fields;
        private readonly SiteRule _rule;
        private readonly int _w;
        private readonly int[] _badSat;
        private readonly int[] _collectorSat;
        private readonly int[] _steepSat;
        private readonly double[] _trafficSat;
        private readonly double[] _valueSat;
        private readonly decimal[] _redevelopment;
        private readonly int _area;
        private readonly LandContext? _land;

        public SearchGrid(CityLayout layout, IPlotOccupancy occupancy, SiteRule rule, BuildingType type, CityFields fields, LandContext? land)
        {
            _layout = layout;
            _land = land;
            _fields = fields;
            _rule = rule;
            _w = layout.Width;
            _area = type.Footprint.Width * type.Footprint.Height;
            var n = layout.PlotCount;
            var bad = new bool[n];
            var collector = new bool[n];
            var steep = new bool[n];
            for (var pz = 0; pz < layout.Height; pz++)
            {
                for (var px = 0; px < layout.Width; px++)
                {
                    var i = pz * _w + px;
                    bad[i] = !Eligible(px, pz, occupancy, out var zone);
                    collector[i] = zone is { MinFrontage: >= RoadClass.Collector };
                    var slope = layout.SlopeAt(px, pz);
                    steep[i] = slope >= 3 || (slope == 2 && _area > 4);
                }
            }
            _badSat = Sat(bad);
            _collectorSat = Sat(collector);
            _steepSat = Sat(steep);
            var traffic = new double[n];
            var value = new double[n];
            for (var i = 0; i < n; i++)
            {
                traffic[i] = fields.Traffic[i];
                value[i] = land is not null && land.OwnTitle(i % _w, i / _w) ? 0 : (double)fields.LandValues[i];
            }
            _trafficSat = Sat(traffic);
            _valueSat = Sat(value);
            _redevelopment = new decimal[layout.Parcels.Count + 1];
            foreach (var p in layout.Parcels) _redevelopment[p.Id] = land is null ? PlacementValidator.RedevelopmentValue(p) : land.Redevelopment(p);
        }

        private bool Eligible(int px, int pz, IPlotOccupancy occupancy, out SiteZone? zone)
        {
            zone = null;
            if (_layout.KindAt(px, pz) != PlotKind.Parcel || occupancy.BuildingAt(px, pz) is not null) return false;
            if (_land is not null && _land.ForeignTitle(px, pz)) return false;
            var district = _layout.DistrictAt(px, pz);
            var parcel = _layout.ParcelAt(px, pz)!;
            if (parcel.Landmark is not null || district is District.Civic or District.Park) return false;
            zone = _rule.ZoneFor(district);
            if (zone is null || _area > zone.MaxArea) return false;
            var deposit = _layout.DepositAt(px, pz);
            var onshore = deposit is { Offshore: false } ? deposit : null;
            if (_rule.Deposit != DepositKind.None ? onshore is null || onshore.Resource != _rule.Deposit : onshore is not null) return false;
            if (_rule.NeedsForest && parcel.Ambient?.Kind != AmbientKind.Forest) return false;
            return true;
        }

        public bool Feasible(PlotRect rect)
        {
            if (Count(_badSat, rect) != 0 || Count(_steepSat, rect) != 0) return false;
            var required = Count(_collectorSat, rect) > 0 ? RoadClass.Collector : RoadClass.Local;
            var frontage = PlacementValidator.Frontage(_layout, rect, out var sea);
            if (frontage == RoadClass.None || frontage < required) return false;
            if (_rule.NeedsCoast && sea < Math.Min(rect.W, rect.H)) return false;
            if (_rule.Deposit != DepositKind.None)
            {
                // One deposit per site: every plot must belong to the same deposit.
                var id = _layout.DepositAt(rect.Px, rect.Pz)!.Id;
                for (var z = rect.Pz; z < rect.Bottom; z++)
                {
                    for (var x = rect.Px; x < rect.Right; x++)
                    {
                        if (_layout.DepositAt(x, z)!.Id != id) return false;
                    }
                }
            }
            return true;
        }

        public double MeanTraffic(PlotRect rect) => Sum(_trafficSat, rect) / rect.Area;

        public double LocationFactor(PlotRect rect) => _fields.LocationFactor(MeanTraffic(rect));

        public double CbdDistance(PlotRect rect)
        {
            var dx = rect.Px + rect.W / 2.0 - _layout.CbdX;
            var dz = rect.Pz + rect.H / 2.0 - _layout.CbdZ;
            return Math.Sqrt(dx * dx + dz * dz);
        }

        public double DepositQuality(PlotRect rect) => _layout.DepositAt(rect.Px, rect.Pz)?.Quality ?? 0;

        public double SiteCost(PlotRect rect)
        {
            var cost = Sum(_valueSat, rect);
            Span<int> seen = stackalloc int[rect.Area];
            var count = 0;
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++)
                {
                    var id = _layout.ParcelIds[z * _w + x];
                    var dup = false;
                    for (var k = 0; k < count && !dup; k++) dup = seen[k] == id;
                    if (dup || id == 0) continue;
                    seen[count++] = id;
                    cost += (double)_redevelopment[id];
                }
            }
            return cost;
        }

        public double MinOver(PlotRect rect, int[] values)
        {
            var best = double.MaxValue;
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++) best = Math.Min(best, values[z * _w + x]);
            }
            return best;
        }

        /// <summary>4-neighbour BFS distance (in plots, over any terrain) to the nearest port-district plot; null without port land.</summary>
        public int[]? PortDistance()
        {
            var n = _layout.PlotCount;
            var dist = new int[n];
            Array.Fill(dist, int.MaxValue);
            var queue = new int[n];
            int head = 0, tail = 0;
            for (var i = 0; i < n; i++)
            {
                if (_layout.Districts[i] != District.Port) continue;
                dist[i] = 0;
                queue[tail++] = i;
            }
            if (tail == 0) return null;
            while (head < tail)
            {
                var c = queue[head++];
                var x = c % _w;
                var z = c / _w;
                Visit(x + 1, z, c);
                Visit(x - 1, z, c);
                Visit(x, z + 1, c);
                Visit(x, z - 1, c);
            }
            return dist;

            void Visit(int x, int z, int from)
            {
                if (!_layout.InBounds(x, z)) return;
                var i = z * _w + x;
                if (dist[i] != int.MaxValue) return;
                dist[i] = dist[from] + 1;
                queue[tail++] = i;
            }
        }

        private int[] Sat(bool[] flags)
        {
            var w1 = _w + 1;
            var sat = new int[w1 * (_layout.Height + 1)];
            for (var z = 0; z < _layout.Height; z++)
            {
                var row = 0;
                for (var x = 0; x < _w; x++)
                {
                    if (flags[z * _w + x]) row++;
                    sat[(z + 1) * w1 + x + 1] = sat[z * w1 + x + 1] + row;
                }
            }
            return sat;
        }

        private double[] Sat(double[] values)
        {
            var w1 = _w + 1;
            var sat = new double[w1 * (_layout.Height + 1)];
            for (var z = 0; z < _layout.Height; z++)
            {
                var row = 0.0;
                for (var x = 0; x < _w; x++)
                {
                    row += values[z * _w + x];
                    sat[(z + 1) * w1 + x + 1] = sat[z * w1 + x + 1] + row;
                }
            }
            return sat;
        }

        private int Count(int[] sat, PlotRect r)
        {
            var w1 = _w + 1;
            return sat[r.Bottom * w1 + r.Right] - sat[r.Pz * w1 + r.Right] - sat[r.Bottom * w1 + r.Px] + sat[r.Pz * w1 + r.Px];
        }

        private double Sum(double[] sat, PlotRect r)
        {
            var w1 = _w + 1;
            return sat[r.Bottom * w1 + r.Right] - sat[r.Pz * w1 + r.Right] - sat[r.Bottom * w1 + r.Px] + sat[r.Pz * w1 + r.Px];
        }
    }
}
