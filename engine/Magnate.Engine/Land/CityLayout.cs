using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Land;

/// <summary>
/// The immutable, deterministic layout of one city: a grid of 24 m plots with
/// roads, water, parcels, ambient development, landmarks, resource deposits,
/// terrain and the land-value and traffic fields. Produced by
/// <see cref="CityLayoutGenerator.Generate(Magnate.Engine.Domain.City, int)"/>; identical inputs give a
/// byte-identical layout (<see cref="ComputeHash"/>).
/// </summary>
/// <remarks>
/// Coordinates: plot (0,0) is the north-west corner, <c>px</c> grows east (+X) and
/// <c>pz</c> grows south (+Z). Per-plot arrays are row-major:
/// <c>index = pz * Width + px</c>. Terrain corner heights are
/// <c>(Width+1) × (Height+1)</c>, row-major by corner row.
/// </remarks>
public sealed class CityLayout
{
    /// <summary>Version of the generation algorithm. Bump when output for a given seed changes.</summary>
    public const int GeneratorVersion = 1;

    /// <summary>Edge length of a plot in metres (MASTER-PLAN D12).</summary>
    public const double PlotSizeMetres = 24.0;

    private readonly PlotKind[] _kind;
    private readonly RoadClass[] _road;
    private readonly District[] _district;
    private readonly WaterKind[] _water;
    private readonly int[] _parcelId;
    private readonly int[] _depositId;
    private readonly byte[] _slope;
    private readonly float[]? _corners;
    private readonly LandUse[] _use;

    internal CityLayout(
        City city,
        int seed,
        string profileKey,
        TerrainStyle terrain,
        Climate climate,
        double cbdX,
        double cbdZ,
        double urbanRadius,
        PlotKind[] kind,
        RoadClass[] road,
        District[] district,
        WaterKind[] water,
        int[] parcelId,
        int[] depositId,
        byte[] slope,
        float[]? corners,
        LandUse[] use,
        CityFields fields,
        IReadOnlyList<Road> roads,
        IReadOnlyList<Parcel> parcels,
        IReadOnlyList<WaterRect> waterRects,
        IReadOnlyList<Landmark> landmarks,
        IReadOnlyList<Deposit> deposits)
    {
        CityId = city.Id;
        CityName = city.Name;
        Population = city.Population;
        Geography = city.Geography;
        BaseLandPrice = city.BaseLandPrice;
        Width = city.Grid.Width;
        Height = city.Grid.Height;
        Seed = seed;
        ProfileKey = profileKey;
        Terrain = terrain;
        Climate = climate;
        CbdX = cbdX;
        CbdZ = cbdZ;
        UrbanRadius = urbanRadius;
        _kind = kind;
        _road = road;
        _district = district;
        _water = water;
        _parcelId = parcelId;
        _depositId = depositId;
        _slope = slope;
        _corners = corners;
        _use = use;
        Fields = fields;
        Roads = roads;
        Parcels = parcels;
        Water = waterRects;
        Landmarks = landmarks;
        Deposits = deposits;
    }

    /// <summary>The city this layout belongs to.</summary>
    public CityId CityId { get; }

    /// <summary>Display name of the city.</summary>
    public string CityName { get; }

    /// <summary>Population used to size the urban area.</summary>
    public long Population { get; }

    /// <summary>The city's geography flags (coast, arable, minerals, oil).</summary>
    public CityGeography Geography { get; }

    /// <summary>Content land-price scale: $ thousands per plot at C = Z = 1 (caplab §5.4).</summary>
    public decimal BaseLandPrice { get; }

    /// <summary>Grid width in plots.</summary>
    public int Width { get; }

    /// <summary>Grid height in plots.</summary>
    public int Height { get; }

    /// <summary>The generation seed.</summary>
    public int Seed { get; }

    /// <summary>Identity profile used (the city id for built-in cities, otherwise <c>generic</c>).</summary>
    public string ProfileKey { get; }

    /// <summary>Relief style of the city (flat cities ship no terrain heights).</summary>
    public TerrainStyle Terrain { get; }

    /// <summary>Climate for seasons and vegetation.</summary>
    public Climate Climate { get; }

    /// <summary>CBD centre in plot space (fractional; plot centres sit at +0.5).</summary>
    public double CbdX { get; }

    /// <summary>CBD centre in plot space (fractional; plot centres sit at +0.5).</summary>
    public double CbdZ { get; }

    /// <summary>The CBD plot.</summary>
    public PlotPoint Cbd => new(Math.Clamp((int)Math.Floor(CbdX), 0, Width - 1), Math.Clamp((int)Math.Floor(CbdZ), 0, Height - 1));

    /// <summary>Urban radius R_u in plots (caplab §5.2 step 3).</summary>
    public double UrbanRadius { get; }

    /// <summary>The land-value and traffic fields as generated (no company buildings yet).</summary>
    public CityFields Fields { get; }

    /// <summary>Median traffic index over urban parcel plots of the generated fields (<see cref="CityFields.MedianUrbanTraffic"/>).</summary>
    public double MedianUrbanTraffic => Fields.MedianUrbanTraffic;

    /// <summary>Road segments, ordered by id.</summary>
    public IReadOnlyList<Road> Roads { get; }

    /// <summary>Parcels, ordered by id (<c>Parcels[id - 1]</c>).</summary>
    public IReadOnlyList<Parcel> Parcels { get; }

    /// <summary>Water as rectangles of uniform kind and shore.</summary>
    public IReadOnlyList<WaterRect> Water { get; }

    /// <summary>Named landmarks.</summary>
    public IReadOnlyList<Landmark> Landmarks { get; }

    /// <summary>Resource deposits, ordered by id (<c>Deposits[id - 1]</c>).</summary>
    public IReadOnlyList<Deposit> Deposits { get; }

    /// <summary>True when the layout carries terrain heights (hilly cities); otherwise the ground is flat at 0 m.</summary>
    public bool HasTerrain => _corners is not null;

    /// <summary>Number of plots.</summary>
    public int PlotCount => Width * Height;

    // ------------------------------------------------------------------ bulk views

    /// <summary>Per-plot kinds (row-major).</summary>
    public ReadOnlySpan<PlotKind> Kinds => _kind;

    /// <summary>Per-plot road classes (row-major).</summary>
    public ReadOnlySpan<RoadClass> RoadClasses => _road;

    /// <summary>Per-plot districts (row-major).</summary>
    public ReadOnlySpan<District> Districts => _district;

    /// <summary>Per-plot water kinds (row-major).</summary>
    public ReadOnlySpan<WaterKind> WaterKinds => _water;

    /// <summary>Per-plot parcel ids, 0 = none (row-major).</summary>
    public ReadOnlySpan<int> ParcelIds => _parcelId;

    /// <summary>Per-plot deposit ids, 0 = none (row-major).</summary>
    public ReadOnlySpan<int> DepositIds => _depositId;

    /// <summary>Per-plot slope classes 0–3 (row-major).</summary>
    public ReadOnlySpan<byte> SlopeClasses => _slope;

    /// <summary>Per-plot land use of the generated (ambient) development (row-major).</summary>
    public ReadOnlySpan<LandUse> LandUses => _use;

    /// <summary>Per-plot generated land value in whole dollars; 0 on roads, water and beaches (row-major).</summary>
    public ReadOnlySpan<decimal> LandValues => Fields.LandValues;

    /// <summary>Per-plot generated customer-traffic index 0–100 (row-major).</summary>
    public ReadOnlySpan<double> TrafficValues => Fields.Traffic;

    /// <summary>Terrain corner heights in metres, (Width+1)·(Height+1) row-major; empty when flat.</summary>
    public ReadOnlySpan<float> CornerHeights => _corners;

    // ------------------------------------------------------------------ per-plot queries

    /// <summary>True when (px, pz) lies on the grid.</summary>
    public bool InBounds(int px, int pz) => (uint)px < (uint)Width && (uint)pz < (uint)Height;

    /// <summary>Row-major index of a plot.</summary>
    public int IndexOf(int px, int pz)
    {
        if (!InBounds(px, pz)) throw new ArgumentOutOfRangeException(nameof(px), $"plot ({px},{pz}) is outside {Width}x{Height}");
        return pz * Width + px;
    }

    /// <summary>What occupies the plot.</summary>
    public PlotKind KindAt(int px, int pz) => _kind[IndexOf(px, pz)];

    /// <summary>Road class of the plot (None when not a road).</summary>
    public RoadClass RoadAt(int px, int pz) => _road[IndexOf(px, pz)];

    /// <summary>District of the plot (None on roads, water and beaches).</summary>
    public District DistrictAt(int px, int pz) => _district[IndexOf(px, pz)];

    /// <summary>Bridge-spec zone of the plot.</summary>
    public Zone ZoneAt(int px, int pz) => LandWire.ZoneOf(_district[IndexOf(px, pz)]);

    /// <summary>Water under the plot (bridges are road plots with water under them).</summary>
    public WaterKind WaterAt(int px, int pz) => _water[IndexOf(px, pz)];

    /// <summary>True for a road plot over water.</summary>
    public bool IsBridge(int px, int pz)
    {
        var i = IndexOf(px, pz);
        return _kind[i] == PlotKind.Road && _water[i] != WaterKind.None;
    }

    /// <summary>Slope class 0–3 (caplab §5.2: 3 is unbuildable, 2 takes only footprints up to 2×2).</summary>
    public int SlopeAt(int px, int pz) => _slope[IndexOf(px, pz)];

    /// <summary>Land use of the generated development on the plot.</summary>
    public LandUse LandUseAt(int px, int pz) => _use[IndexOf(px, pz)];

    /// <summary>Generated land value of the plot in whole dollars (0 on roads, water and beaches).</summary>
    public decimal LandValueAt(int px, int pz) => Fields.LandValueAt(px, pz);

    /// <summary>Generated customer-traffic index of the plot, 0–100.</summary>
    public double TrafficAt(int px, int pz) => Fields.TrafficAt(px, pz);

    /// <summary>The econ-audit §4.3 location factor <c>clamp(T / median, 0.3, 2.5)</c> of the generated fields.</summary>
    public double LocationFactorAt(int px, int pz) => Fields.LocationFactorAt(px, pz);

    /// <summary>The parcel covering the plot, or null.</summary>
    public Parcel? ParcelAt(int px, int pz)
    {
        var id = _parcelId[IndexOf(px, pz)];
        return id == 0 ? null : Parcels[id - 1];
    }

    /// <summary>The parcel with the given id.</summary>
    /// <exception cref="KeyNotFoundException">No parcel has that id.</exception>
    public Parcel ParcelById(int id)
        => id >= 1 && id <= Parcels.Count ? Parcels[id - 1] : throw new KeyNotFoundException($"parcel {id} not found in {CityId}");

    /// <summary>The onshore or offshore deposit under the plot, or null.</summary>
    public Deposit? DepositAt(int px, int pz)
    {
        var id = _depositId[IndexOf(px, pz)];
        return id == 0 ? null : Deposits[id - 1];
    }

    /// <summary>Terrain height of a plot corner in metres (0 when the layout is flat).</summary>
    public float CornerHeight(int cx, int cz)
    {
        if ((uint)cx > (uint)Width || (uint)cz > (uint)Height) throw new ArgumentOutOfRangeException(nameof(cx));
        return _corners is null ? 0f : _corners[cz * (Width + 1) + cx];
    }

    /// <summary>Mean terrain height of a plot in metres.</summary>
    public double PlotHeight(int px, int pz)
    {
        _ = IndexOf(px, pz);
        if (_corners is null) return 0;
        var w1 = Width + 1;
        return (_corners[pz * w1 + px] + _corners[pz * w1 + px + 1] + _corners[(pz + 1) * w1 + px] + _corners[(pz + 1) * w1 + px + 1]) / 4.0;
    }

    /// <summary>Distance from the plot centre to the CBD centre, in plots.</summary>
    public double DistanceToCbd(int px, int pz)
    {
        var dx = px + 0.5 - CbdX;
        var dz = pz + 0.5 - CbdZ;
        return Math.Sqrt(dx * dx + dz * dz);
    }

    /// <summary>The highest road class among the plot's four neighbours (None when it has no road frontage).</summary>
    public RoadClass FrontageAt(int px, int pz)
    {
        var best = RoadClass.None;
        if (px > 0) best = Max(best, _road[IndexOf(px - 1, pz)]);
        if (px < Width - 1) best = Max(best, _road[IndexOf(px + 1, pz)]);
        if (pz > 0) best = Max(best, _road[IndexOf(px, pz - 1)]);
        if (pz < Height - 1) best = Max(best, _road[IndexOf(px, pz + 1)]);
        return best;

        static RoadClass Max(RoadClass a, RoadClass b) => a >= b ? a : b;
    }

    /// <summary>
    /// A 64-bit FNV-1a fingerprint of every generated value (grid, lists, fields).
    /// Equal layouts hash equal; used by determinism tests and as a cache check.
    /// </summary>
    public ulong ComputeHash()
    {
        var h = new LayoutHasher();
        h.Add(CityId.Value);
        h.Add(Seed);
        h.Add(GeneratorVersion);
        h.Add(Width);
        h.Add(Height);
        h.Add((int)Climate);
        h.Add((int)Terrain);
        h.Add(CbdX);
        h.Add(CbdZ);
        h.Add(UrbanRadius);
        h.Add(MedianUrbanTraffic);
        for (var i = 0; i < PlotCount; i++)
        {
            h.Add((int)_kind[i] | ((int)_road[i] << 4) | ((int)_district[i] << 8) | ((int)_water[i] << 12) | (_slope[i] << 16) | ((int)_use[i] << 20));
            h.Add(_parcelId[i]);
            h.Add(_depositId[i]);
            h.Add(Fields.LandValues[i]);
            h.Add(Fields.Traffic[i]);
        }
        if (_corners is not null)
        {
            foreach (var c in _corners) h.Add(c);
        }
        foreach (var r in Roads)
        {
            h.Add(r.Id);
            h.Add((int)r.Class);
            h.Add(r.Lanes);
            h.Add(r.Start.Px);
            h.Add(r.Start.Pz);
            h.Add(r.End.Px);
            h.Add(r.End.Pz);
            h.Add(r.Bridge ? 1 : 0);
        }
        foreach (var p in Parcels)
        {
            h.Add(p.Id);
            h.Add(p.Rect.Px);
            h.Add(p.Rect.Pz);
            h.Add(p.Rect.W);
            h.Add(p.Rect.H);
            h.Add((int)p.District);
            h.Add(p.LandValue);
            h.Add(p.Traffic);
            h.Add(p.ForSale ? 1 : 0);
            h.Add(p.Vacant ? 1 : 0);
            h.Add((int)p.Facing);
            h.Add((int)p.Frontage);
            h.Add(p.DepositId);
            h.Add(p.Landmark is { } lk ? (int)lk : -1);
            if (p.Ambient is { } a)
            {
                h.Add((int)a.Kind);
                h.Add(a.Floors);
                h.Add(a.Variant);
                h.Add((int)a.Civic);
                h.Add((int)a.Deposit);
            }
            else
            {
                h.Add(-1);
            }
        }
        foreach (var w in Water)
        {
            h.Add(w.Rect.Px);
            h.Add(w.Rect.Pz);
            h.Add(w.Rect.W);
            h.Add(w.Rect.H);
            h.Add((int)w.Kind);
            h.Add((int)w.Shore);
        }
        foreach (var l in Landmarks)
        {
            h.Add((int)l.Kind);
            h.Add(l.ParcelId);
        }
        foreach (var d in Deposits)
        {
            h.Add(d.Id);
            h.Add((int)d.Resource);
            h.Add(d.Rect.Px);
            h.Add(d.Rect.Pz);
            h.Add(d.Rect.W);
            h.Add(d.Rect.H);
            h.Add(d.Quality);
            h.Add(d.Reserve);
            h.Add(d.Offshore ? 1 : 0);
        }
        return h.Value;
    }
}

/// <summary>Incremental 64-bit FNV-1a over primitive values (little-endian, culture-free).</summary>
internal struct LayoutHasher
{
    private const ulong Offset = 14695981039346656037UL;
    private const ulong Prime = 1099511628211UL;
    private ulong _h;
    private bool _started;

    public readonly ulong Value => _started ? _h : Offset;

    private void Byte(byte b)
    {
        if (!_started)
        {
            _h = Offset;
            _started = true;
        }
        _h ^= b;
        _h *= Prime;
    }

    public void Add(long v)
    {
        for (var i = 0; i < 8; i++) Byte((byte)(v >> (8 * i)));
    }

    public void Add(int v) => Add((long)v);

    public void Add(double v) => Add(BitConverter.DoubleToInt64Bits(v));

    public void Add(float v) => Add(BitConverter.SingleToInt32Bits(v));

    public void Add(decimal v)
    {
        Span<int> bits = stackalloc int[4];
        decimal.GetBits(v, bits);
        foreach (var b in bits) Add(b);
    }

    public void Add(string s)
    {
        Add(s.Length);
        foreach (var c in s) Add((int)c);
    }
}
