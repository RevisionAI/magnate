using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Land.Generation;

/// <summary>A straight road run produced by a generation stage (inclusive range along one axis).</summary>
internal sealed class RoadSpan
{
    public RoadSpan(bool vertical, int fixedCoord, int from, int to, RoadClass roadClass)
    {
        Vertical = vertical;
        Fixed = fixedCoord;
        From = Math.Min(from, to);
        To = Math.Max(from, to);
        Class = roadClass;
    }

    /// <summary>True for a north–south run (fixed x, varying z).</summary>
    public bool Vertical { get; }

    /// <summary>The fixed coordinate (x for vertical runs, z for horizontal ones).</summary>
    public int Fixed { get; }

    public int From { get; set; }

    public int To { get; set; }

    public RoadClass Class { get; set; }

    public int X(int t) => Vertical ? Fixed : t;

    public int Z(int t) => Vertical ? t : Fixed;
}

/// <summary>What a reservation is for.</summary>
internal enum ReservationUse : byte
{
    Park,
    Civic,
    Deposit,
    Port,
    Retail,
    Industry,
}

/// <summary>A rectangle set aside before streets and lots are laid out (park, campus, stadium, deposit…).</summary>
internal sealed class Reservation
{
    public required int Id { get; init; }
    public required PlotRect Rect { get; init; }
    public required ReservationUse Use { get; init; }
    public LandmarkKind? Landmark { get; init; }
    public CivicKind Civic { get; init; }
    public int DepositIndex { get; init; } = -1;
}

/// <summary>An onshore or offshore deposit before ids are frozen.</summary>
internal sealed class DepositDraft
{
    public required DepositKind Resource { get; init; }
    public required PlotRect Rect { get; init; }
    public required int Quality { get; init; }
    public required double Reserve { get; init; }
    public required bool Offshore { get; init; }
}

/// <summary>A lot before parcel ids are frozen.</summary>
internal sealed class LotDraft
{
    public LotDraft(PlotRect rect, District district)
    {
        Rect = rect;
        District = district;
    }

    public PlotRect Rect { get; set; }
    public District District { get; set; }
    public Reservation? Reservation { get; set; }
    public LandmarkKind? Landmark { get; set; }
    public CivicKind Civic { get; set; }
    public AmbientBuilding? Ambient { get; set; }
    public bool ForSale { get; set; }
    public int DepositIndex { get; set; } = -1;
}

/// <summary>
/// Plot indices sorted by a per-plot key, walked outward from a target value in
/// order of increasing |key − target| — so a search for "the site nearest to
/// ρ = 0.55" can stop as soon as no remaining plot can beat the best found.
/// </summary>
internal sealed class PlotOrder
{
    private readonly int[] _cells;
    private readonly double[] _keys;
    private int _lo;
    private int _hi;
    private double _target;

    public PlotOrder(double[] keyPerPlot)
    {
        _cells = new int[keyPerPlot.Length];
        for (var i = 0; i < _cells.Length; i++) _cells[i] = i;
        _keys = (double[])keyPerPlot.Clone();
        Array.Sort(_keys, _cells); // deterministic for equal input
    }

    /// <summary>Starts a walk outward from <paramref name="target"/>.</summary>
    public void Start(double target)
    {
        _target = target;
        var lo = 0;
        var hi = _keys.Length;
        while (lo < hi)
        {
            var mid = (lo + hi) >> 1;
            if (_keys[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        _hi = lo;
        _lo = lo - 1;
    }

    /// <summary>The next plot of the walk and its distance |key − target|; false when exhausted.</summary>
    public bool Next(out int cell, out double gap)
    {
        var hasLo = _lo >= 0;
        var hasHi = _hi < _keys.Length;
        if (!hasLo && !hasHi)
        {
            cell = -1;
            gap = double.MaxValue;
            return false;
        }
        var gapLo = hasLo ? _target - _keys[_lo] : double.MaxValue;
        var gapHi = hasHi ? _keys[_hi] - _target : double.MaxValue;
        if (gapLo <= gapHi)
        {
            cell = _cells[_lo--];
            gap = gapLo;
        }
        else
        {
            cell = _cells[_hi++];
            gap = gapHi;
        }
        return true;
    }
}

/// <summary>A connected area of buildable land enclosed by the arterial network (or the coast and the map edge).</summary>
internal sealed class Block
{
    public required int Id { get; init; }
    public required PlotRect Bounds { get; init; }
    public required int Cells { get; init; }
}

/// <summary>
/// Mutable working state of one generation run. Stages are split across the
/// <c>LayoutBuilder.*.cs</c> partial files in pipeline order; every stage draws
/// from its own seeded stream (<see cref="Rng"/>), iterates in row-major order
/// and never depends on hash-set or dictionary ordering, so the output is a pure
/// function of (city, seed, profile).
/// </summary>
internal sealed partial class LayoutBuilder
{
    // Neighbour offsets in the art §3.2 facing order: S, E, N, W.
    private static readonly int[] Dx = [0, 1, 0, -1];
    private static readonly int[] Dz = [1, 0, -1, 0];

    private readonly ulong _root;

    public LayoutBuilder(City city, int seed, CityProfile profile)
    {
        if (city.Grid.Width < 16 || city.Grid.Height < 16 || city.Grid.Width > 256 || city.Grid.Height > 256)
        {
            throw new ArgumentOutOfRangeException(nameof(city), $"city grid {city.Grid.Width}x{city.Grid.Height} must be within 16..256");
        }

        City = city;
        P = profile;
        Seed = seed;
        W = city.Grid.Width;
        H = city.Grid.Height;
        N = W * H;
        _root = LayoutSeeds.Root(seed, city.Id.Value);

        Water = new WaterKind[N];
        Road = new RoadClass[N];
        Dist = new District[N];
        Beach = new bool[N];
        Reserve = new int[N];
        Rho = new double[N];
        Slope = new byte[N];
        DepositOf = new int[N];
        LotOf = new int[N];
        Forest = new bool[N];
        BlockOf = new int[N];
        Quay = new bool[N];
    }

    public City City { get; }
    public CityProfile P { get; }
    public int Seed { get; }
    public int W { get; }
    public int H { get; }
    public int N { get; }

    // ---- per-plot state
    public WaterKind[] Water { get; }
    public RoadClass[] Road { get; }
    public District[] Dist { get; }
    public bool[] Beach { get; }
    public int[] Reserve { get; }
    public double[] Rho { get; }
    public byte[] Slope { get; }
    public float[]? Corners { get; private set; }
    public int[] DepositOf { get; }
    public int[] LotOf { get; }
    public bool[] Forest { get; }
    public int[] BlockOf { get; }

    /// <summary>Quay land: dry plots of a port window within <c>QuayDepth</c> of the sea. Only port lots may use it.</summary>
    public bool[] Quay { get; }

    // ---- geometry
    public double CbdX { get; private set; }
    public double CbdZ { get; private set; }

    /// <summary>Urban radius R_u (geometric mean of the two semi-axes), in plots.</summary>
    public double Ru { get; private set; }

    /// <summary>Semi-axis of the urban ellipse along x.</summary>
    public double Rx { get; private set; }

    /// <summary>Semi-axis of the urban ellipse along z.</summary>
    public double Rz { get; private set; }

    public List<RoadSpan> Spans { get; } = new();
    public List<Reservation> Reservations { get; } = new();
    public List<DepositDraft> DepositDrafts { get; } = new();
    public List<LotDraft> Lots { get; } = new();
    public List<Block> Blocks { get; } = new();

    public LayoutRandom Rng(string stage) => new(LayoutSeeds.Stream(_root, stage));

    public ulong NoiseSeed(string stage) => LayoutSeeds.Stream(_root, "noise:" + stage);

    public int Idx(int x, int z) => z * W + x;

    public bool In(int x, int z) => (uint)x < (uint)W && (uint)z < (uint)H;

    public bool IsLand(int i) => Water[i] == WaterKind.None;

    public bool IsRoad(int i) => Road[i] != RoadClass.None;

    /// <summary>Land that can still take streets or lots: dry, not a road, beach or reservation.</summary>
    public bool IsFree(int i) => Water[i] == WaterKind.None && Road[i] == RoadClass.None && !Beach[i] && Reserve[i] == 0;

    public static bool IsUrban(District d) => d is District.Cbd or District.Commercial or District.Mixed or District.Apartments
        or District.Houses or District.Industrial or District.Port;

    public static double Distance(double x, double z, double x2, double z2)
    {
        var dx = x - x2;
        var dz = z - z2;
        return Math.Sqrt(dx * dx + dz * dz);
    }

    /// <summary>Distance from a plot centre to the CBD centre, in plots.</summary>
    public double CbdDistance(int x, int z) => Distance(x + 0.5, z + 0.5, CbdX, CbdZ);

    /// <summary>Bearing from the CBD to a point, degrees in [0, 360): 0 east, 90 south.</summary>
    public double Bearing(double x, double z)
    {
        var deg = Math.Atan2(z - CbdZ, x - CbdX) * 180.0 / Math.PI;
        return deg < 0 ? deg + 360 : deg;
    }

    /// <summary>Summed-area table of a per-plot flag, size (W+1)·(H+1).</summary>
    public int[] Sat(bool[] flags)
    {
        var w1 = W + 1;
        var sat = new int[w1 * (H + 1)];
        for (var z = 0; z < H; z++)
        {
            var row = 0;
            var o = z * W;
            for (var x = 0; x < W; x++)
            {
                if (flags[o + x]) row++;
                sat[(z + 1) * w1 + x + 1] = sat[z * w1 + x + 1] + row;
            }
        }
        return sat;
    }

    /// <summary>Number of flagged plots inside <paramref name="r"/> (which must lie on the grid).</summary>
    public int SatCount(int[] sat, PlotRect r)
    {
        var w1 = W + 1;
        return sat[r.Bottom * w1 + r.Right] - sat[r.Pz * w1 + r.Right] - sat[r.Bottom * w1 + r.Px] + sat[r.Pz * w1 + r.Px];
    }

    /// <summary>True when a 4-neighbour of plot <paramref name="i"/> is a road of at least <paramref name="min"/>.</summary>
    public bool HasFrontage(int i, RoadClass min)
    {
        var x = i % W;
        var z = i / W;
        for (var k = 0; k < 4; k++)
        {
            var nx = x + Dx[k];
            var nz = z + Dz[k];
            if (!In(nx, nz)) continue;
            var c = Road[Idx(nx, nz)];
            if (c != RoadClass.None && c >= min) return true;
        }
        return false;
    }

    public static double AngleDiff(double a, double b)
    {
        var d = Math.Abs(a - b) % 360.0;
        return d > 180 ? 360 - d : d;
    }

    internal static double SmoothStep(double e0, double e1, double x)
    {
        var t = Math.Clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    /// <summary>Runs the whole pipeline.</summary>
    public CityLayout Build()
    {
        // 1. Natural geography and the urban footprint.
        EstimateUrbanRadius();
        BuildRiver();
        BuildTerrain();
        BuildSea();
        MarkQuays();
        PlaceCore();
        ComputeSlopes();

        // 2. Trunk network and land use.
        BuildArterials();
        BuildWaterfrontRoads();
        AssignDistricts();
        FindBlocks();
        PlaceReservations();
        PlaceDeposits();

        // 3. Local streets, coast and countryside.
        BuildLocalStreets();
        MarkBeaches();
        MarkForest();
        SplitDeepBlocks();
        EnsureReservationAccess();
        RepairConnectivity();
        UnifyBridgeClasses();

        // 4. Lots, development and the frozen layout.
        BuildLots();
        AssignDevelopment();
        return Freeze();
    }
}
