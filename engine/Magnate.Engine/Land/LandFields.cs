using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land;

/// <summary>
/// A point that pulls customer traffic to the plots around it (caplab §5.4
/// <c>serviceFirmBoost</c> / <c>mallBoost</c>): the boost falls linearly from
/// <see cref="Boost"/> at the centre to 0 at <see cref="Radius"/> plots.
/// </summary>
/// <param name="Px">Centre plot x (may be fractional for multi-plot buildings).</param>
/// <param name="Pz">Centre plot z.</param>
/// <param name="Radius">Reach in plots.</param>
/// <param name="Boost">Traffic points added at the centre.</param>
public readonly record struct TrafficAttractor(double Px, double Pz, double Radius, double Boost);

/// <summary>
/// A snapshot of a city's land-value and customer-traffic fields. The layout
/// carries the generated snapshot (<see cref="CityLayout.Fields"/>); the World
/// recomputes it monthly once company buildings change the land uses (Wave 2)
/// and hands the current snapshot to placement and siting.
/// </summary>
public sealed class CityFields
{
    private readonly decimal[] _landValue;
    private readonly double[] _traffic;

    internal CityFields(int width, int height, decimal[] landValue, double[] traffic, double medianUrbanTraffic)
    {
        if (landValue.Length != width * height || traffic.Length != width * height)
        {
            throw new ArgumentException("one land value and one traffic value per plot are required");
        }
        Width = width;
        Height = height;
        _landValue = landValue;
        _traffic = traffic;
        MedianUrbanTraffic = medianUrbanTraffic;
    }

    /// <summary>Grid width in plots.</summary>
    public int Width { get; }

    /// <summary>Grid height in plots.</summary>
    public int Height { get; }

    /// <summary>
    /// Median traffic index over urban parcel plots. The econ location factor is
    /// <c>L = clamp(Traffic / MedianUrbanTraffic, 0.3, 2.5)</c> (econ-audit §4.3).
    /// </summary>
    public double MedianUrbanTraffic { get; }

    /// <summary>Per-plot land value in whole dollars; 0 on roads, water and beaches (row-major).</summary>
    public ReadOnlySpan<decimal> LandValues => _landValue;

    /// <summary>Per-plot customer-traffic index 0–100 (row-major).</summary>
    public ReadOnlySpan<double> Traffic => _traffic;

    /// <summary>Land value of a plot in whole dollars.</summary>
    public decimal LandValueAt(int px, int pz) => _landValue[Index(px, pz)];

    /// <summary>Customer-traffic index of a plot, 0–100.</summary>
    public double TrafficAt(int px, int pz) => _traffic[Index(px, pz)];

    /// <summary>The econ-audit §4.3 location factor <c>clamp(T / median, 0.3, 2.5)</c> of a plot.</summary>
    public double LocationFactorAt(int px, int pz) => LocationFactor(TrafficAt(px, pz));

    /// <summary>The location factor for a traffic index (mean over a footprint, for example).</summary>
    public double LocationFactor(double traffic)
        => MedianUrbanTraffic <= 0 ? 1.0 : Math.Clamp(traffic / MedianUrbanTraffic, 0.3, 2.5);

    /// <summary>
    /// Recomputes both fields for a layout with the given per-plot land uses (the
    /// World overrides the plots its buildings cover, <see cref="LandUses.ForCategory"/>)
    /// and optional traffic attractors (malls, service firms). Deterministic.
    /// </summary>
    public static CityFields Compute(CityLayout layout, ReadOnlySpan<LandUse> uses, IReadOnlyList<TrafficAttractor>? attractors = null)
    {
        ArgumentNullException.ThrowIfNull(layout);
        if (uses.Length != layout.PlotCount) throw new ArgumentException("one land use per plot is required", nameof(uses));
        var geometry = FieldGeometry.From(layout);
        var useArray = uses.ToArray();
        var traffic = TrafficModel.Compute(geometry, useArray, attractors);
        var landValue = LandValueModel.Compute(geometry, useArray, traffic);
        return new CityFields(layout.Width, layout.Height, landValue, traffic, MedianUrban(layout.Kinds, layout.Districts, traffic));
    }

    /// <summary>Traffic boost of an ambient strip mall (caplab §5.4 <c>mallBoost</c>): +8 at the centre, fading to 0 at 4 plots.</summary>
    public static TrafficAttractor StripMallAttractor(PlotRect rect) => new(rect.Px + rect.W / 2.0, rect.Pz + rect.H / 2.0, 4, 8);

    /// <summary>
    /// The attractors of the layout's ambient development (its strip malls), in
    /// parcel order. Pass them, minus any that were redeveloped and plus company
    /// malls and service firms, to <see cref="Compute"/>.
    /// </summary>
    public static IReadOnlyList<TrafficAttractor> AmbientAttractors(CityLayout layout)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var list = new List<TrafficAttractor>();
        foreach (var p in layout.Parcels)
        {
            if (p.Ambient?.Kind == AmbientKind.StripMall) list.Add(StripMallAttractor(p.Rect));
        }
        return list;
    }

    /// <summary>Median traffic over parcel plots of the urban districts.</summary>
    internal static double MedianUrban(ReadOnlySpan<PlotKind> kinds, ReadOnlySpan<District> districts, double[] traffic)
    {
        var values = new List<double>();
        for (var i = 0; i < traffic.Length; i++)
        {
            if (kinds[i] == PlotKind.Parcel && districts[i] is District.Cbd or District.Commercial or District.Mixed
                or District.Apartments or District.Houses or District.Industrial or District.Port)
            {
                values.Add(traffic[i]);
            }
        }
        if (values.Count == 0) return 0;
        values.Sort();
        return values[values.Count / 2];
    }

    private int Index(int px, int pz)
    {
        if ((uint)px >= (uint)Width || (uint)pz >= (uint)Height) throw new ArgumentOutOfRangeException(nameof(px), $"plot ({px},{pz}) is outside {Width}x{Height}");
        return pz * Width + px;
    }
}

/// <summary>The static geometry the field models read (grid, roads, water, districts, slopes, deposits, CBD).</summary>
internal sealed class FieldGeometry
{
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required RoadClass[] Road { get; init; }
    public required WaterKind[] Water { get; init; }
    public required District[] District { get; init; }
    public required PlotKind[] Kind { get; init; }
    public required byte[] Slope { get; init; }
    public required int[] DepositQuality { get; init; }
    public required DepositKind[] DepositResource { get; init; }
    public required double CbdX { get; init; }
    public required double CbdZ { get; init; }
    public required double UrbanRadius { get; init; }
    public required decimal BaseLandPrice { get; init; }
    public required bool HillViews { get; init; }

    public static FieldGeometry From(CityLayout layout)
    {
        var n = layout.PlotCount;
        var quality = new int[n];
        var resource = new DepositKind[n];
        var ids = layout.DepositIds;
        for (var i = 0; i < n; i++)
        {
            if (ids[i] == 0) continue;
            var d = layout.Deposits[ids[i] - 1];
            if (d.Offshore) continue;
            quality[i] = d.Quality;
            resource[i] = d.Resource;
        }
        return new FieldGeometry
        {
            Width = layout.Width,
            Height = layout.Height,
            Road = layout.RoadClasses.ToArray(),
            Water = layout.WaterKinds.ToArray(),
            District = layout.Districts.ToArray(),
            Kind = layout.Kinds.ToArray(),
            Slope = layout.SlopeClasses.ToArray(),
            DepositQuality = quality,
            DepositResource = resource,
            CbdX = layout.CbdX,
            CbdZ = layout.CbdZ,
            UrbanRadius = layout.UrbanRadius,
            BaseLandPrice = layout.BaseLandPrice,
            HillViews = layout.Terrain == TerrainStyle.Plateau,
        };
    }

    /// <summary>Summed-area table over a per-plot value (size (W+1)·(H+1)).</summary>
    public double[] Sat(Func<int, double> value)
    {
        var w1 = Width + 1;
        var sat = new double[w1 * (Height + 1)];
        for (var z = 0; z < Height; z++)
        {
            var row = 0.0;
            for (var x = 0; x < Width; x++)
            {
                row += value(z * Width + x);
                sat[(z + 1) * w1 + x + 1] = sat[z * w1 + x + 1] + row;
            }
        }
        return sat;
    }

    /// <summary>Sum over the window [x0, x1] × [z0, z1] (inclusive, clamped to the grid).</summary>
    public double Window(double[] sat, int x0, int z0, int x1, int z1)
    {
        x0 = Math.Max(0, x0);
        z0 = Math.Max(0, z0);
        x1 = Math.Min(Width - 1, x1);
        z1 = Math.Min(Height - 1, z1);
        if (x1 < x0 || z1 < z0) return 0;
        var w1 = Width + 1;
        return sat[(z1 + 1) * w1 + x1 + 1] - sat[z0 * w1 + x1 + 1] - sat[(z1 + 1) * w1 + x0] + sat[z0 * w1 + x0];
    }
}

/// <summary>
/// The customer-traffic index (0–100 per plot) of caplab-brief §5.4:
/// <code>
/// T = clamp(100·[0.50·exp(−(d/(0.35·R_u))²) + 0.20·RoadClass + 0.30·Density_r4], 0, 100) + attractor boosts
/// </code>
/// then a 3×3 blur. <c>RoadClass</c> is the plot's own class on roads and the
/// best adjacent class on land (arterial 1.0, highway 0.8, collector 0.6, local
/// 0.3); <c>Density_r4</c> is the weighted share of developed land within 4 plots
/// (office/retail 1.0, apartment 0.8, civic 0.6, parking 0.5, house 0.4,
/// industry 0.2, park 0.15, extraction 0.1, farm/forest/vacant 0). Deterministic.
/// </summary>
public static class TrafficModel
{
    /// <summary>Radius of the density window (plots, Chebyshev).</summary>
    public const int DensityRadius = 4;

    /// <summary>The boost cap from attractors on one plot (caplab: 15 service + 20 mall).</summary>
    public const double MaxBoost = 35;

    /// <summary>Recomputes the field for a layout with the given per-plot land uses (Wave 2: company buildings override plots).</summary>
    public static double[] Compute(CityLayout layout, ReadOnlySpan<LandUse> uses, IReadOnlyList<TrafficAttractor>? attractors = null)
    {
        ArgumentNullException.ThrowIfNull(layout);
        if (uses.Length != layout.PlotCount) throw new ArgumentException("one land use per plot is required", nameof(uses));
        return Compute(FieldGeometry.From(layout), uses.ToArray(), attractors);
    }

    /// <summary>Road-class factor of caplab §5.4.</summary>
    public static double RoadFactor(RoadClass c) => c switch
    {
        RoadClass.Arterial => 1.0,
        RoadClass.Highway => 0.8,
        RoadClass.Collector => 0.6,
        RoadClass.Local => 0.3,
        _ => 0.0,
    };

    /// <summary>Development weight of a land use in <c>Density_r4</c>.</summary>
    public static double DensityWeight(LandUse use) => use switch
    {
        LandUse.Office or LandUse.Retail => 1.0,
        LandUse.Apartment => 0.8,
        LandUse.Civic => 0.6,
        LandUse.Parking => 0.5,
        LandUse.House => 0.4,
        LandUse.Factory or LandUse.Warehouse => 0.2,
        LandUse.Park => 0.15,
        LandUse.Extraction => 0.1,
        _ => 0.0,
    };

    internal static double[] Compute(FieldGeometry g, LandUse[] uses, IReadOnlyList<TrafficAttractor>? attractors)
    {
        var w = g.Width;
        var h = g.Height;
        var n = w * h;
        var ru = Math.Max(1.0, g.UrbanRadius);
        var isLand = new bool[n];
        for (var i = 0; i < n; i++) isLand[i] = g.Water[i] == WaterKind.None && g.Road[i] == RoadClass.None && g.Kind[i] != PlotKind.Beach;

        var weightSat = g.Sat(i => isLand[i] ? DensityWeight(uses[i]) : 0);
        var landSat = g.Sat(i => isLand[i] ? 1 : 0);

        var raw = new double[n];
        var r = DensityRadius;
        for (var z = 0; z < h; z++)
        {
            for (var x = 0; x < w; x++)
            {
                var i = z * w + x;
                if (g.Water[i] != WaterKind.None && g.Road[i] == RoadClass.None) continue;
                var dx = x + 0.5 - g.CbdX;
                var dz = z + 0.5 - g.CbdZ;
                var d = Math.Sqrt(dx * dx + dz * dz);
                var q = d / (0.35 * ru);
                var kernel = Math.Exp(-q * q);

                double road;
                if (g.Road[i] != RoadClass.None)
                {
                    road = RoadFactor(g.Road[i]);
                }
                else
                {
                    road = 0;
                    if (x > 0) road = Math.Max(road, RoadFactor(g.Road[i - 1]));
                    if (x < w - 1) road = Math.Max(road, RoadFactor(g.Road[i + 1]));
                    if (z > 0) road = Math.Max(road, RoadFactor(g.Road[i - w]));
                    if (z < h - 1) road = Math.Max(road, RoadFactor(g.Road[i + w]));
                }

                var landCount = g.Window(landSat, x - r, z - r, x + r, z + r);
                var density = landCount > 0 ? g.Window(weightSat, x - r, z - r, x + r, z + r) / landCount : 0;

                var t = 100 * (0.50 * kernel + 0.20 * road + 0.30 * density);
                t = Math.Clamp(t, 0, 100);

                if (attractors is not null && attractors.Count > 0)
                {
                    var boost = 0.0;
                    foreach (var a in attractors)
                    {
                        var ax = x + 0.5 - a.Px;
                        var az = z + 0.5 - a.Pz;
                        var ad = Math.Sqrt(ax * ax + az * az);
                        if (ad < a.Radius) boost += a.Boost * (1 - ad / a.Radius);
                    }
                    t += Math.Min(MaxBoost, boost);
                }
                raw[i] = t;
            }
        }

        // 3×3 blur over plots that are not open water.
        var result = new double[n];
        for (var z = 0; z < h; z++)
        {
            for (var x = 0; x < w; x++)
            {
                var i = z * w + x;
                if (g.Water[i] != WaterKind.None && g.Road[i] == RoadClass.None) continue;
                var sum = 0.0;
                var count = 0;
                for (var bz = Math.Max(0, z - 1); bz <= Math.Min(h - 1, z + 1); bz++)
                {
                    for (var bx = Math.Max(0, x - 1); bx <= Math.Min(w - 1, x + 1); bx++)
                    {
                        var j = bz * w + bx;
                        if (g.Water[j] != WaterKind.None && g.Road[j] == RoadClass.None) continue;
                        sum += raw[j];
                        count++;
                    }
                }
                result[i] = Math.Round(Math.Clamp(sum / Math.Max(1, count), 0, 100), 1);
            }
        }
        return result;
    }
}

/// <summary>
/// Land value per plot in whole 2026 dollars (caplab-brief §5.4, reconciled with
/// econ-audit §4.3/§4.7 and MASTER-PLAN D4):
/// <code>
/// LV = BaseLandPrice·1,000 · C(d) · Z(zone) · (1 + 0.004·Traffic) · N · W · S  [+ deposit premium]
/// C(d) = 0.25 + 2.75·exp(−(d/(0.45·R_u))²)
/// N    = clamp(1 + Σ_{plots within 4} w(use)/16, 0.7, 1.6)
/// </code>
/// <c>BaseLandPrice</c> is read as $ thousands per 24 m plot at C = Z = 1; at the
/// median urban location that is about the content value in $/m² of an
/// economic lot (econ §4.3). Metropolis, seed 1 (medians per plot): CBD ≈ $625k
/// (peak ≈ $700k; caplab ≈ $790k), commercial ≈ $430k, houses ≈ $41k, industry
/// ≈ $34k (the wedge sits further out than caplab's mid-distance $58k row),
/// farmland ≈ $5.8k. See docs/overhaul/status/e3a-citygen.md for the calibration table.
/// </summary>
public static class LandValueModel
{
    /// <summary>Radius of the neighbourhood-development window (plots).</summary>
    public const int NeighbourhoodRadius = 4;

    /// <summary>Recomputes the field for a layout with the given land uses and traffic (Wave 2 monthly update).</summary>
    public static decimal[] Compute(CityLayout layout, ReadOnlySpan<LandUse> uses, ReadOnlySpan<double> traffic)
    {
        ArgumentNullException.ThrowIfNull(layout);
        if (uses.Length != layout.PlotCount || traffic.Length != layout.PlotCount)
        {
            throw new ArgumentException("one land use and one traffic value per plot are required");
        }
        return Compute(FieldGeometry.From(layout), uses.ToArray(), traffic.ToArray());
    }

    /// <summary>The CBD-centrality factor C(d) (3.0 at the CBD, 0.25 far out).</summary>
    public static double Centrality(double distancePlots, double urbanRadius)
    {
        var q = distancePlots / (0.45 * Math.Max(1.0, urbanRadius));
        return 0.25 + 2.75 * Math.Exp(-q * q);
    }

    /// <summary>Zone factor Z by district and land use (rural land covers differ).</summary>
    public static double ZoneFactor(District district, LandUse use) => district switch
    {
        District.Cbd or District.Commercial or District.Mixed => 1.0,
        District.Apartments => 0.9,
        District.Houses => 0.8,
        District.Industrial => 0.55,
        District.Port => 0.6,
        District.Park or District.Civic => 0.8,
        District.Rural => use switch
        {
            LandUse.Forest => 0.2,
            LandUse.Farm => 0.15,
            _ => 0.1,
        },
        _ => 0.5,
    };

    /// <summary>Neighbourhood weight w of caplab §5.4 (offices and homes raise value, industry lowers it).</summary>
    public static double NeighbourhoodWeight(LandUse use) => use switch
    {
        LandUse.Office => 0.06,
        LandUse.Apartment => 0.05,
        LandUse.Civic or LandUse.Park => 0.05,
        LandUse.Retail => 0.04,
        LandUse.House => 0.02,
        LandUse.Parking => 0.01,
        LandUse.Warehouse => -0.01,
        LandUse.Factory => -0.03,
        LandUse.Extraction => -0.05,
        _ => 0.0,
    };

    internal static decimal[] Compute(FieldGeometry g, LandUse[] uses, double[] traffic)
    {
        var w = g.Width;
        var h = g.Height;
        var n = w * h;
        var ru = Math.Max(1.0, g.UrbanRadius);
        var scale = (double)g.BaseLandPrice * 1000.0;
        var nSat = g.Sat(i => NeighbourhoodWeight(uses[i]));
        var waterSat = g.Sat(i => g.Water[i] != WaterKind.None && g.Road[i] == RoadClass.None ? 1 : 0);
        var r = NeighbourhoodRadius;

        var values = new decimal[n];
        for (var z = 0; z < h; z++)
        {
            for (var x = 0; x < w; x++)
            {
                var i = z * w + x;
                if (g.Road[i] != RoadClass.None || g.Water[i] != WaterKind.None || g.Kind[i] == PlotKind.Beach) continue;

                var dx = x + 0.5 - g.CbdX;
                var dz = z + 0.5 - g.CbdZ;
                var c = Centrality(Math.Sqrt(dx * dx + dz * dz), ru);
                var zone = ZoneFactor(g.District[i], uses[i]);
                var t = 1 + 0.004 * traffic[i];
                var nf = Math.Clamp(1 + g.Window(nSat, x - r, z - r, x + r, z + r) / 16.0, 0.7, 1.6);
                var nearWater = g.Window(waterSat, x - 2, z - 2, x + 2, z + 2) > 0;
                var wf = nearWater && g.District[i] is not (District.Industrial or District.Port) ? 1.2 : 1.0;
                var sf = 1 - 0.1 * g.Slope[i];
                if (g.HillViews && g.Slope[i] >= 1 && g.District[i] is District.Houses or District.Apartments) sf += 0.1;

                var value = scale * c * zone * t * nf * wf * sf;
                if (g.DepositQuality[i] > 0)
                {
                    var resourceFactor = g.DepositResource[i] == DepositKind.Oil ? 1.2 : 1.0;
                    value += scale * (0.5 + 1.5 * g.DepositQuality[i] / 100.0) * resourceFactor;
                }
                values[i] = Math.Round((decimal)value, 0, MidpointRounding.ToEven);
            }
        }
        return values;
    }
}
