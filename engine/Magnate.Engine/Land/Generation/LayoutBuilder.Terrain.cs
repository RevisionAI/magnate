using System;

namespace Magnate.Engine.Land.Generation;

// Stage 1 — natural geography: urban radius, river, terrain heights, sea and
// harbour, the CBD centre and the normalised distance field ρ.
internal sealed partial class LayoutBuilder
{
    private double _ru0;
    private int[]? _riverStart;
    private int _riverWidth;

    // Coast in (t, u) space: t runs along the coast side, u is the distance
    // inland from the map edge. Sea covers u < _coastDepth[t].
    private int[]? _coastDepth;
    private int _coastLength;
    private int _cbdWaterT0 = -1;
    private int _cbdWaterT1 = -1;
    private readonly System.Collections.Generic.List<(int T0, int T1)> _portRanges = new();
    private double _hillX;
    private double _hillZ;

    private void EstimateUrbanRadius()
    {
        // caplab §5.2 step 3 sets R_u = R·u(pop) with u = 0.45…0.75 for 100k…500k.
        // Our grids already scale with population (Hilltown 40 … Metropolis 80), so
        // that curve double-counts and leaves small towns as a speck on their map
        // with too little downtown and industry to play in. We keep the shape of the
        // curve (log-linear in population) but lift it to 0.68 at 100k … 0.82 at 500k.
        var t = (Math.Log(Math.Max(10_000, City.Population)) - Math.Log(100_000)) / (Math.Log(500_000) - Math.Log(100_000));
        var u = Math.Clamp(0.68 + 0.14 * t, 0.55, 0.9);
        _ru0 = Math.Min(W, H) / 2.0 * u * P.UrbanScale;
        Ru = Rx = Rz = _ru0;
    }

    // ------------------------------------------------------------------ river

    private void BuildRiver()
    {
        if (P.River == RiverCourse.None) return;

        var rng = Rng("river");
        var ns = P.River == RiverCourse.NorthSouth;
        var length = ns ? H : W;
        var across = ns ? W : H;
        var w = Math.Clamp(P.RiverWidth, 1, 3);
        _riverWidth = w;
        _riverStart = new int[length];

        var c0 = across / 2.0 + rng.Range(-0.05, 0.05) * across;
        var a1 = 0.08 * across;
        var l1 = rng.Range(0.8, 1.2) * length;
        var p1 = rng.Range(0, Math.PI * 2);
        var a2 = 0.03 * across;
        var l2 = rng.Range(0.28, 0.38) * length;
        var p2 = rng.Range(0, Math.PI * 2);
        var mid = length / 2.0;

        // Through the city the river is channelised and straight (bridges and
        // embankments stay axis-aligned); it meanders freely in the countryside.
        var prev = 0;
        for (var t = 0; t < length; t++)
        {
            var wild = SmoothStep(0.95 * _ru0, 1.6 * _ru0, Math.Abs(t + 0.5 - mid));
            var c = c0 + wild * (a1 * (Math.Sin(2 * Math.PI * t / l1 + p1) - Math.Sin(2 * Math.PI * mid / l1 + p1))
                + a2 * (Math.Sin(2 * Math.PI * t / l2 + p2) - Math.Sin(2 * Math.PI * mid / l2 + p2)));
            var start = (int)Math.Round(c - w / 2.0);
            if (t > 0) start = Math.Clamp(start, prev - 1, prev + 1);
            start = Math.Clamp(start, 2, across - 2 - w);
            for (var k = 0; k < w; k++) SetRiver(ns, t, start + k);
            if (t > 0 && w == 1 && start != prev) SetRiver(ns, t, prev); // keep a 1-wide river 4-connected
            _riverStart[t] = start;
            prev = start;
        }
    }

    private void SetRiver(bool ns, int t, int a)
    {
        var i = ns ? Idx(a, t) : Idx(t, a);
        Water[i] = WaterKind.River;
    }

    /// <summary>Centre of the river channel on row/column <paramref name="t"/> (across-axis coordinate), or NaN without a river.</summary>
    private double RiverCentre(int t)
    {
        if (_riverStart is null) return double.NaN;
        t = Math.Clamp(t, 0, _riverStart.Length - 1);
        return _riverStart[t] + _riverWidth / 2.0;
    }

    /// <summary>Distance (plots, across the channel axis) from a point to the river centreline.</summary>
    private double RiverDistance(double x, double z)
    {
        if (_riverStart is null) return double.PositiveInfinity;
        return P.River == RiverCourse.NorthSouth
            ? Math.Abs(x - RiverCentre((int)Math.Floor(z)))
            : Math.Abs(z - RiverCentre((int)Math.Floor(x)));
    }

    // ------------------------------------------------------------------ terrain

    private void BuildTerrain()
    {
        if (P.Terrain == TerrainStyle.Flat || P.Relief <= 0) return;

        var rng = Rng("terrain");
        var seedA = NoiseSeed("terrainA");
        var seedB = NoiseSeed("terrainB");
        var w1 = W + 1;
        var corners = new float[w1 * (H + 1)];
        var half = Math.Min(W, H) / 2.0;

        _hillX = W / 2.0 + rng.Range(-0.04, 0.04) * W;
        _hillZ = H / 2.0 + rng.Range(-0.04, 0.04) * H;

        // Valley hills sit in the direction of the first deposit plan (mines in the hills).
        var bearing = P.Deposits.Count > 0 ? P.Deposits[0].BearingDeg : 315.0;
        var rad = bearing * Math.PI / 180.0;
        var hx = W / 2.0 + Math.Cos(rad) * 0.33 * W;
        var hz = H / 2.0 + Math.Sin(rad) * 0.33 * H;
        var ox = W / 2.0 - Math.Cos(rad + 0.6) * 0.36 * W;
        var oz = H / 2.0 - Math.Sin(rad + 0.6) * 0.36 * H;

        for (var cz = 0; cz <= H; cz++)
        {
            for (var cx = 0; cx <= W; cx++)
            {
                double h;
                if (P.Terrain == TerrainStyle.Plateau)
                {
                    var r = Distance(cx, cz, _hillX, _hillZ);
                    var r0 = 0.9 * _ru0;
                    var r1 = r0 + 0.58 * half;
                    var s = SmoothStep(r0, r1, r);
                    h = P.Relief * (1 - s)
                        + P.Relief * 0.12 * Noise.Signed(seedA, cx, cz, 6.0, 3) * (0.35 + s)
                        + P.Relief * 0.05 * Noise.Signed(seedB, cx, cz, 14.0, 2);
                }
                else
                {
                    var dr = RiverDistance(cx, cz);
                    var valley = double.IsInfinity(dr) ? 0 : Math.Min(7.0, 0.3 * Math.Max(0, dr - _riverWidth / 2.0));
                    var main = Gaussian(cx, cz, hx, hz, 0.15 * W);
                    var minor = Gaussian(cx, cz, ox, oz, 0.12 * W);
                    h = 1.5 + valley + P.Relief * main + 0.35 * P.Relief * minor
                        + 1.4 * Noise.Signed(seedA, cx, cz, 7.0, 3) * (0.4 + main * 2.0);
                }
                corners[cz * w1 + cx] = (float)Math.Max(0.0, h);
            }
        }

        // The water surface is 0 m: river-bed corners sit at 0, banks at least 1.5 m.
        for (var cz = 0; cz <= H; cz++)
        {
            for (var cx = 0; cx <= W; cx++)
            {
                int wet = 0, dry = 0;
                for (var dz = -1; dz <= 0; dz++)
                {
                    for (var dx = -1; dx <= 0; dx++)
                    {
                        var px = cx + dx;
                        var pz = cz + dz;
                        if (!In(px, pz)) continue;
                        if (Water[Idx(px, pz)] != WaterKind.None) wet++;
                        else dry++;
                    }
                }
                ref var c = ref corners[cz * w1 + cx];
                if (wet > 0 && dry == 0) c = 0f;
                else if (wet > 0) c = Math.Max(c, 1.5f);
            }
        }

        // Quantise to 0.1 m so the payload is compact and stable.
        for (var i = 0; i < corners.Length; i++) corners[i] = (float)(Math.Round(corners[i] * 10.0) / 10.0);
        Corners = corners;
    }

    private static double Gaussian(double x, double z, double cx, double cz, double sigma)
    {
        var dx = x - cx;
        var dz = z - cz;
        return Math.Exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
    }

    // ------------------------------------------------------------------ sea

    private bool CoastAlongX => P.Coast is CoastSide.North or CoastSide.South;

    /// <summary>Map (t along the coast, u inland from the edge) to plot coordinates.</summary>
    private (int X, int Z) FromCoast(int t, int u) => P.Coast switch
    {
        CoastSide.North => (t, u),
        CoastSide.South => (t, H - 1 - u),
        CoastSide.West => (u, t),
        _ => (W - 1 - u, t),
    };

    /// <summary>Map plot coordinates to (t, u) coast space.</summary>
    private (int T, int U) ToCoast(int x, int z) => P.Coast switch
    {
        CoastSide.North => (x, z),
        CoastSide.South => (x, H - 1 - z),
        CoastSide.West => (z, x),
        _ => (z, W - 1 - x),
    };

    private void BuildSea()
    {
        if (P.Coast == CoastSide.None) return;

        var rng = Rng("sea");
        var seed = NoiseSeed("coast");
        var length = CoastAlongX ? W : H;
        var depthMax = CoastAlongX ? H : W;
        _coastLength = length;

        var tb = (int)Math.Round(Math.Clamp(P.BayPosition + rng.Range(-0.03, 0.03), 0.15, 0.85) * (length - 1));
        var raw = new double[length];
        var bay = new double[length];
        for (var t = 0; t < length; t++)
        {
            raw[t] = 1.8 * Noise.Line(seed, t, 11.0, 2) + 0.7 * Noise.Line(seed + 17, t, 4.0, 1);
        }

        var headHalf = 0;
        var basinT0 = -1;
        var basinT1 = -1;
        switch (P.Bay)
        {
            case BayStyle.Inlet:
            {
                headHalf = Math.Max(3, (int)Math.Round(P.BayHalfWidth * length));
                var flank = Math.Max(4, (int)Math.Round(0.11 * length));
                var bd = P.BayDepth * depthMax;
                for (var t = 0; t < length; t++)
                {
                    var s = Math.Abs(t - tb);
                    var f = s <= headHalf ? 1.0 : s >= headHalf + flank ? 0.0 : 0.5 * (1 + Math.Cos(Math.PI * (s - headHalf) / flank));
                    bay[t] = bd * f;
                }
                _cbdWaterT0 = tb - headHalf;
                _cbdWaterT1 = tb + headHalf;
                break;
            }
            case BayStyle.Basin:
            {
                var half = Math.Max(3, (int)Math.Round(P.BayHalfWidth * length));
                var bd = Math.Max(4, Math.Round(P.BayDepth * depthMax));
                basinT0 = tb - half;
                basinT1 = tb + half;
                for (var t = Math.Max(0, basinT0); t <= Math.Min(length - 1, basinT1); t++) bay[t] = bd;
                break;
            }
        }

        if (_cbdWaterT0 < 0)
        {
            // CBD waterfront beside the harbour (away from the port) or mid-coast.
            var portCentre = P.PortWindows.Count > 0 ? (P.PortWindows[0].Start + P.PortWindows[0].End) / 2 : 0.5;
            var frac = P.Bay == BayStyle.None ? 0.5 : P.BayPosition + (portCentre <= P.BayPosition ? 0.22 : -0.22);
            if (frac > 0.85 || frac < 0.15) frac = P.BayPosition - (frac - P.BayPosition);
            var tc = (int)Math.Round(Math.Clamp(frac, 0.15, 0.85) * (length - 1));
            var hw = Math.Max(4, (int)Math.Round(0.07 * length));
            _cbdWaterT0 = tc - hw;
            _cbdWaterT1 = tc + hw;
        }
        _cbdWaterT0 = Math.Max(0, _cbdWaterT0);
        _cbdWaterT1 = Math.Min(length - 1, _cbdWaterT1);

        foreach (var pw in P.PortWindows)
        {
            var t0 = (int)Math.Round(Math.Clamp(pw.Start, 0, 1) * (length - 1));
            var t1 = (int)Math.Round(Math.Clamp(pw.End, 0, 1) * (length - 1));
            if (P.Bay == BayStyle.Inlet)
            {
                // Quays need a straight shore: keep the port clear of the inlet's flanks.
                while (t0 <= t1 && bay[t0] > 0.5) t0++;
                while (t1 >= t0 && bay[t1] > 0.5) t1--;
            }
            if (t1 - t0 >= 6) _portRanges.Add((t0, t1));
        }

        // Engineered waterfronts are straight: flatten the noise over the CBD and port windows.
        Flatten(raw, _cbdWaterT0, _cbdWaterT1);
        foreach (var (t0, t1) in _portRanges) Flatten(raw, t0, t1);

        var bayTotal = 0.0;
        foreach (var b in bay) bayTotal += b;
        var target = Math.Clamp(P.SeaShare, 0.04, 0.3) * W * H;
        var baseDepth = Math.Max(2.0, (target - bayTotal) / length);

        _coastDepth = new int[length];
        for (var t = 0; t < length; t++)
        {
            var d = (int)Math.Round(baseDepth + raw[t] + bay[t]);
            _coastDepth[t] = Math.Clamp(d, 1, depthMax / 2);
            for (var u = 0; u < _coastDepth[t]; u++)
            {
                var (x, z) = FromCoast(t, u);
                Water[Idx(x, z)] = WaterKind.Sea;
            }
        }
    }

    /// <summary>
    /// Flags the quay land of the port windows (see <see cref="Quay"/>): dry plots
    /// within <c>QuayDepth</c> of the sea in Chebyshev distance, so the corners
    /// where a basin's side quay meets its head quay belong to the quay too.
    /// </summary>
    private void MarkQuays()
    {
        if (_coastDepth is null || _portRanges.Count == 0) return;
        var dist = new int[N];
        Array.Fill(dist, int.MaxValue);
        var queue = new int[N];
        int head = 0, tail = 0;
        for (var i = 0; i < N; i++)
        {
            if (Water[i] != WaterKind.Sea) continue;
            dist[i] = 0;
            queue[tail++] = i;
        }
        while (head < tail)
        {
            var c = queue[head++];
            if (dist[c] >= QuayDepth) continue;
            var x = c % W;
            var z = c / W;
            for (var dz = -1; dz <= 1; dz++)
            {
                for (var dx = -1; dx <= 1; dx++)
                {
                    var nx = x + dx;
                    var nz = z + dz;
                    if (!In(nx, nz)) continue;
                    var n = nz * W + nx;
                    if (dist[n] != int.MaxValue || !IsLand(n)) continue;
                    dist[n] = dist[c] + 1;
                    queue[tail++] = n;
                }
            }
        }
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                Quay[i] = IsLand(i) && dist[i] <= QuayDepth && InPortWindow(x, z);
            }
        }
    }

    private static void Flatten(double[] raw, int t0, int t1)
    {
        t0 = Math.Max(0, t0);
        t1 = Math.Min(raw.Length - 1, t1);
        if (t1 < t0) return;
        var max = double.MinValue;
        for (var t = t0; t <= t1; t++) max = Math.Max(max, raw[t]);
        for (var t = t0; t <= t1; t++) raw[t] = max;
    }

    /// <summary>True when the plot lies in a port window (coast space), any distance inland.</summary>
    private bool InPortWindow(int x, int z, int margin = 0)
    {
        if (_coastDepth is null) return false;
        var (t, _) = ToCoast(x, z);
        foreach (var (t0, t1) in _portRanges)
        {
            if (t >= t0 - margin && t <= t1 + margin) return true;
        }
        return false;
    }

    /// <summary>True when the plot lies in the CBD waterfront window (coast space).</summary>
    private bool InCbdWaterfront(int x, int z)
    {
        if (_coastDepth is null) return false;
        var (t, _) = ToCoast(x, z);
        return t >= _cbdWaterT0 && t <= _cbdWaterT1;
    }

    // ------------------------------------------------------------------ CBD and ρ

    private void PlaceCore()
    {
        var rng = Rng("core");
        var cbdR = Math.Max(1.5, P.CbdRho * _ru0);

        if (_coastDepth is not null)
        {
            var tc = (_cbdWaterT0 + _cbdWaterT1) / 2;
            var depth = _coastDepth[tc];
            for (var t = _cbdWaterT0; t <= _cbdWaterT1; t++) depth = Math.Max(depth, _coastDepth[t]);
            var u = depth + cbdR + 1.0;
            var (x, z) = FromCoast(tc, 0);
            // Convert the fractional inland offset along the u axis.
            switch (P.Coast)
            {
                case CoastSide.North: CbdX = x + 0.5; CbdZ = u; break;
                case CoastSide.South: CbdX = x + 0.5; CbdZ = H - u; break;
                case CoastSide.West: CbdX = u; CbdZ = z + 0.5; break;
                default: CbdX = W - u; CbdZ = z + 0.5; break;
            }
        }
        else if (_riverStart is not null)
        {
            var mid = (P.River == RiverCourse.NorthSouth ? H : W) / 2 + rng.Range(-2, 2);
            var across = RiverCentre(mid);
            if (P.River == RiverCourse.NorthSouth)
            {
                CbdX = across;
                CbdZ = mid + 0.5;
            }
            else
            {
                CbdX = mid + 0.5;
                CbdZ = across;
            }
        }
        else if (P.Terrain == TerrainStyle.Plateau && Corners is not null)
        {
            CbdX = _hillX;
            CbdZ = _hillZ;
        }
        else
        {
            CbdX = W / 2.0 + rng.Range(-0.04, 0.04) * W;
            CbdZ = H / 2.0 + rng.Range(-0.04, 0.04) * H;
        }

        // Coastal cities lose part of the urban disc to the sea: grow R_u until the
        // urban land area roughly matches an inland city of the same population.
        if (_coastDepth is not null)
        {
            for (var iter = 0; iter < 4; iter++)
            {
                var land = 0;
                var r2 = Ru * Ru;
                for (var z = 0; z < H; z++)
                {
                    for (var x = 0; x < W; x++)
                    {
                        var dx = x + 0.5 - CbdX;
                        var dz = z + 0.5 - CbdZ;
                        if (dx * dx + dz * dz <= r2 && IsLand(Idx(x, z))) land++;
                    }
                }
                var fraction = Math.Max(0.25, land / (Math.PI * r2));
                Ru = Math.Min(1.4 * _ru0, _ru0 / Math.Sqrt(fraction));
            }
        }

        // Keep a rural margin on every land side so the city never runs off the map
        // (the renderer's outskirts continue the countryside past the edge). When a
        // side is short of room the urban area becomes an ellipse stretched along the
        // free axis, keeping its area (aspect ≤ 1.35), as coastal and valley towns do.
        var margin = Math.Max(4.0, 0.08 * Math.Min(W, H));
        var reach = 1 + 0.6 * P.EdgeRoughness;
        double Cap(double room) => Math.Max(0.45 * _ru0, (room - margin) / reach);
        var capX = double.MaxValue;
        var capZ = double.MaxValue;
        if (P.Coast != CoastSide.West) capX = Math.Min(capX, Cap(CbdX));
        if (P.Coast != CoastSide.East) capX = Math.Min(capX, Cap(W - CbdX));
        if (P.Coast != CoastSide.North) capZ = Math.Min(capZ, Cap(CbdZ));
        if (P.Coast != CoastSide.South) capZ = Math.Min(capZ, Cap(H - CbdZ));
        var area = Ru * Ru;
        Rx = Math.Min(Ru, capX);
        Rz = Math.Min(Ru, capZ);
        if (Rx < Ru && Rz >= Ru) Rz = Math.Min(Math.Min(capZ, 1.35 * Rx), area / Rx);
        else if (Rz < Ru && Rx >= Ru) Rx = Math.Min(Math.Min(capX, 1.35 * Rz), area / Rz);
        Ru = Math.Sqrt(Rx * Rz);

        var edge = new PeriodicNoise(NoiseSeed("edge"));
        var wiggle = NoiseSeed("wiggle");
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var dx = (x + 0.5 - CbdX) / Rx;
                var dz = (z + 0.5 - CbdZ) / Rz;
                var e = 1 + P.EdgeRoughness * edge.Sample(Math.Atan2(dz, dx));
                var rho = Math.Sqrt(dx * dx + dz * dz) / e;
                Rho[Idx(x, z)] = rho * (1 + 0.09 * Noise.Signed(wiggle, x, z, 4.5, 2));
            }
        }
    }

    // ------------------------------------------------------------------ slopes

    private void ComputeSlopes()
    {
        if (Corners is null) return;
        var w1 = W + 1;
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (!IsLand(i))
                {
                    Slope[i] = 0;
                    continue;
                }
                var a = Corners[z * w1 + x];
                var b = Corners[z * w1 + x + 1];
                var c = Corners[(z + 1) * w1 + x];
                var d = Corners[(z + 1) * w1 + x + 1];
                var grade = (Math.Max(Math.Max(a, b), Math.Max(c, d)) - Math.Min(Math.Min(a, b), Math.Min(c, d))) / CityLayout.PlotSizeMetres;
                Slope[i] = SlopeClass(grade);
            }
        }
    }

    /// <summary>caplab §5.2 slope classes: &lt;4% → 0, &lt;8% → 1, &lt;15% → 2, else 3.</summary>
    internal static byte SlopeClass(double grade) => grade < 0.04 ? (byte)0 : grade < 0.08 ? (byte)1 : grade < 0.15 ? (byte)2 : (byte)3;
}
