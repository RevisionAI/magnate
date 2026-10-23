// layout-preview — renders generated city layouts to PNG for visual review.
//
//   dotnet run -c Release --project tools/LayoutPreview -- [options]
//
//   --seed N          layout seed (default 1, the bridge default)
//   --cities a,b      city ids (default: every city in content/data/cities)
//   --out DIR         output directory (default docs/overhaul/status/e3a-citygen)
//   --content DIR     content root (default: the nearest content/ above the working directory)
//   --modes m,n       zones,landvalue,traffic,districts (default: zones,landvalue,traffic)
//   --size PX         target image edge in pixels (default 800)
//   --bench N         time N generations per city (min / median) and skip the images
//   --sites           print the auto-siter's best site for every building type in every city
//   --probe T,X,Z,R   validate building type T at plot (X,Z) rotation R in each city and print the verdict
//
// Images are written as 24-bit BMP and converted with macOS `sips` to PNG
// (the BMP is kept when sips is unavailable). Per-city statistics are printed.

using System.Diagnostics;
using System.Globalization;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;

var options = PreviewOptions.Parse(args);
var catalog = ContentLoader.Load(options.Content ?? FindContent());
var ids = options.Cities ?? catalog.Cities.Keys.Select(k => k.Value).OrderBy(k => k, StringComparer.Ordinal).ToList();
Directory.CreateDirectory(options.Out);

foreach (var id in ids)
{
    if (!catalog.Cities.TryGetValue(new CityId(id), out var city))
    {
        Console.Error.WriteLine($"unknown city '{id}'");
        continue;
    }

    _ = CityLayoutGenerator.Generate(city, options.Seed); // warm-up (JIT)
    if (options.Bench > 0)
    {
        // Wall clock and process CPU time: on a busy machine the CPU time is the
        // better estimate of the generator's own cost.
        var times = new List<double>();
        var cpu = new List<double>();
        var process = Process.GetCurrentProcess();
        for (var k = 0; k < options.Bench; k++)
        {
            process.Refresh();
            var c0 = process.TotalProcessorTime;
            var bw = Stopwatch.StartNew();
            _ = CityLayoutGenerator.Generate(city, options.Seed);
            times.Add(bw.Elapsed.TotalMilliseconds);
            process.Refresh();
            cpu.Add((process.TotalProcessorTime - c0).TotalMilliseconds);
        }
        times.Sort();
        cpu.Sort();
        Console.WriteLine($"{id,-12} wall min {times[0],6:F1} ms  median {times[times.Count / 2],6:F1} ms   cpu min {cpu[0],6:F1} ms  median {cpu[cpu.Count / 2],6:F1} ms   ({options.Bench} runs)");
        continue;
    }
    var sw = Stopwatch.StartNew();
    var layout = CityLayoutGenerator.Generate(city, options.Seed);
    sw.Stop();

    Stats.Print(layout, sw.Elapsed.TotalMilliseconds);
    if (options.Probe is { } probe)
    {
        var parts = probe.Split(',');
        var type = catalog.BuildingType(new BuildingTypeId(parts[0]));
        var result = PlacementValidator.Validate(layout, PlotOccupancy.None, type,
            int.Parse(parts[1], CultureInfo.InvariantCulture), int.Parse(parts[2], CultureInfo.InvariantCulture),
            parts.Length > 3 ? int.Parse(parts[3], CultureInfo.InvariantCulture) : 0);
        Console.WriteLine($"   probe {type.Id.Value} {result.Footprint} rot {result.Rotation}: ok={result.Ok} land ${result.LandCost:N0} redev ${result.RedevelopmentCost:N0} parcels [{string.Join(",", result.ParcelIds)}]");
        foreach (var issue in result.Issues) Console.WriteLine($"      {issue.CodeName,-14} {issue.Message} {issue.At}");
        for (var z = result.Footprint.Pz - 1; z <= result.Footprint.Bottom; z++)
        {
            var row = new System.Text.StringBuilder("      ");
            for (var x = result.Footprint.Px - 1; x <= result.Footprint.Right; x++)
            {
                if (!layout.InBounds(x, z)) { row.Append(' '); continue; }
                var i = z * layout.Width + x;
                row.Append(layout.Kinds[i] == PlotKind.Parcel ? LandWire.DistrictCode(layout.Districts[i]) : LandWire.KindCode(layout.Kinds[i], layout.WaterKinds[i]));
            }
            Console.WriteLine(row);
        }
    }
    if (options.Sites)
    {
        foreach (var type in catalog.BuildingTypes.Values.OrderBy(t => t.Id.Value, StringComparer.Ordinal))
        {
            var st = Stopwatch.StartNew();
            var sites = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 5);
            st.Stop();
            if (sites.Count == 0)
            {
                Console.WriteLine($"   site {type.Id.Value,-20} none ({st.Elapsed.TotalMilliseconds:F1} ms)");
                continue;
            }
            var b = sites[0].Placement;
            Console.WriteLine($"   site {type.Id.Value,-20} {sites.Count} found ({st.Elapsed.TotalMilliseconds,4:F1} ms) best {b.Footprint} rot {b.Rotation,3} {LandWire.Name(b.Site!.District),-10} "
                + $"traffic {b.Site.Traffic,5:F1} L {b.Site.LocationFactor:F2} land ${b.LandCost:N0} redev ${b.RedevelopmentCost:N0}");
        }
    }
    foreach (var mode in options.Modes)
    {
        var suffix = mode == "zones" ? "" : "-" + mode;
        var path = Path.Combine(options.Out, $"{id}{suffix}");
        var canvas = Renderer.Render(layout, mode, options.Size);
        canvas.Save(path);
    }
}

static string FindContent()
{
    var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
    while (dir is not null)
    {
        var candidate = Path.Combine(dir.FullName, "content");
        if (Directory.Exists(Path.Combine(candidate, "data"))) return candidate;
        dir = dir.Parent;
    }
    throw new DirectoryNotFoundException("content/ not found; pass --content");
}

internal sealed record PreviewOptions(int Seed, List<string>? Cities, string Out, string? Content, List<string> Modes, int Size, int Bench = 0, bool Sites = false, string? Probe = null)
{
    public static PreviewOptions Parse(string[] args)
    {
        var o = new PreviewOptions(1, null, Path.Combine("docs", "overhaul", "status", "e3a-citygen"), null, ["zones", "landvalue", "traffic"], 800);
        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{args[i]} needs a value");
            o = args[i] switch
            {
                "--seed" => o with { Seed = int.Parse(Next(), CultureInfo.InvariantCulture) },
                "--cities" => o with { Cities = Next().Split(',', StringSplitOptions.RemoveEmptyEntries).ToList() },
                "--out" => o with { Out = Next() },
                "--content" => o with { Content = Next() },
                "--modes" => o with { Modes = Next().Split(',', StringSplitOptions.RemoveEmptyEntries).ToList() },
                "--size" => o with { Size = int.Parse(Next(), CultureInfo.InvariantCulture) },
                "--bench" => o with { Bench = int.Parse(Next(), CultureInfo.InvariantCulture) },
                "--sites" => o with { Sites = true },
                "--probe" => o with { Probe = Next() },
                _ => throw new ArgumentException($"unknown option {args[i]}"),
            };
        }
        return o;
    }
}

internal static class Stats
{
    public static void Print(CityLayout l, double ms)
    {
        var kinds = new Dictionary<PlotKind, int>();
        var districts = new Dictionary<District, int>();
        for (var i = 0; i < l.PlotCount; i++)
        {
            kinds[l.Kinds[i]] = kinds.GetValueOrDefault(l.Kinds[i]) + 1;
            if (l.Kinds[i] == PlotKind.Parcel) districts[l.Districts[i]] = districts.GetValueOrDefault(l.Districts[i]) + 1;
        }
        double Pct(int v) => 100.0 * v / l.PlotCount;
        Console.WriteLine($"== {l.CityId} ({l.Width}x{l.Height}) seed {l.Seed}  {ms:F1} ms  hash {l.ComputeHash():x16}");
        Console.WriteLine($"   R_u {l.UrbanRadius:F1}  CBD ({l.CbdX:F1},{l.CbdZ:F1})  median traffic {l.MedianUrbanTraffic:F1}  climate {l.Climate}");
        Console.WriteLine("   plots: " + string.Join("  ", kinds.OrderBy(k => k.Key).Select(k => $"{k.Key} {Pct(k.Value):F1}%")));
        Console.WriteLine("   districts: " + string.Join("  ", districts.OrderBy(k => k.Key).Select(k => $"{k.Key} {Pct(k.Value):F1}%")));
        var byClass = l.Roads.GroupBy(r => r.Class).OrderBy(g => g.Key).Select(g => $"{g.Key} {g.Count()}");
        Console.WriteLine($"   roads {l.Roads.Count} ({string.Join(", ", byClass)}), bridges {l.Roads.Count(r => r.Bridge)}; parcels {l.Parcels.Count}; water rects {l.Water.Count}");
        var ambient = l.Parcels.Where(p => p.Ambient is not null).GroupBy(p => p.Ambient!.WireKind).OrderByDescending(g => g.Count())
            .Select(g => $"{g.Key} {g.Count()}");
        Console.WriteLine("   ambient: " + string.Join(", ", ambient));
        Console.WriteLine($"   for sale {l.Parcels.Count(p => p.ForSale)}, vacant urban {l.Parcels.Count(p => p.Vacant && p.Ambient is null)}");
        Console.WriteLine("   landmarks: " + string.Join(", ", l.Landmarks.Select(m => $"{m.Kind}@{m.Rect}")));
        Console.WriteLine("   deposits: " + string.Join(", ", l.Deposits.Select(d => $"{d.Resource}{(d.Offshore ? "(off)" : "")} q{d.Quality} {d.Rect}")));

        var cbd = l.ParcelAt(l.Cbd.Px, l.Cbd.Pz);
        decimal Pick(District d, Func<Parcel, double> key, bool max)
        {
            var set = l.Parcels.Where(p => p.District == d).ToList();
            if (set.Count == 0) return 0;
            return (max ? set.MaxBy(key) : set.MinBy(key))!.LandValuePerPlot;
        }
        var medianOf = new Func<District, decimal>(d =>
        {
            var v = l.Parcels.Where(p => p.District == d).Select(p => p.LandValuePerPlot).OrderBy(x => x).ToList();
            return v.Count == 0 ? 0 : v[v.Count / 2];
        });
        Console.WriteLine($"   land $/plot  CBD max {Pick(District.Cbd, p => (double)p.LandValuePerPlot, true):N0}  CBD med {medianOf(District.Cbd):N0}  "
            + $"commercial med {medianOf(District.Commercial):N0}  apartments med {medianOf(District.Apartments):N0}  houses med {medianOf(District.Houses):N0}  "
            + $"industrial med {medianOf(District.Industrial):N0}  rural med {medianOf(District.Rural):N0}");
        _ = cbd;
    }
}

internal sealed class Canvas
{
    private readonly byte[] _rgb;

    public Canvas(int width, int height)
    {
        Width = width;
        Height = height;
        _rgb = new byte[width * height * 3];
    }

    public int Width { get; }
    public int Height { get; }

    public void Set(int x, int y, Rgb c)
    {
        if ((uint)x >= (uint)Width || (uint)y >= (uint)Height) return;
        var o = (y * Width + x) * 3;
        _rgb[o] = c.R;
        _rgb[o + 1] = c.G;
        _rgb[o + 2] = c.B;
    }

    public Rgb Get(int x, int y)
    {
        var o = (y * Width + x) * 3;
        return new Rgb(_rgb[o], _rgb[o + 1], _rgb[o + 2]);
    }

    public void Fill(int x0, int y0, int w, int h, Rgb c)
    {
        for (var y = y0; y < y0 + h; y++)
        {
            for (var x = x0; x < x0 + w; x++) Set(x, y, c);
        }
    }

    public void Save(string pathWithoutExtension)
    {
        var bmp = pathWithoutExtension + ".bmp";
        var rowBytes = (Width * 3 + 3) & ~3;
        using (var fs = File.Create(bmp))
        using (var bw = new BinaryWriter(fs))
        {
            bw.Write((byte)'B');
            bw.Write((byte)'M');
            bw.Write(54 + rowBytes * Height);
            bw.Write(0);
            bw.Write(54);
            bw.Write(40);
            bw.Write(Width);
            bw.Write(Height);
            bw.Write((short)1);
            bw.Write((short)24);
            bw.Write(0);
            bw.Write(rowBytes * Height);
            bw.Write(2835);
            bw.Write(2835);
            bw.Write(0);
            bw.Write(0);
            var row = new byte[rowBytes];
            for (var y = Height - 1; y >= 0; y--)
            {
                for (var x = 0; x < Width; x++)
                {
                    var c = Get(x, y);
                    row[x * 3] = c.B;
                    row[x * 3 + 1] = c.G;
                    row[x * 3 + 2] = c.R;
                }
                bw.Write(row);
            }
        }

        var png = pathWithoutExtension + ".png";
        try
        {
            var psi = new ProcessStartInfo("sips", $"-s format png \"{bmp}\" --out \"{png}\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var p = Process.Start(psi)!;
            p.WaitForExit();
            if (p.ExitCode == 0)
            {
                File.Delete(bmp);
                Console.WriteLine($"   wrote {png}");
                return;
            }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // sips missing: keep the BMP.
        }
        Console.WriteLine($"   wrote {bmp}");
    }
}

internal readonly record struct Rgb(byte R, byte G, byte B)
{
    public static Rgb Hex(string hex)
    {
        var v = Convert.ToInt32(hex.TrimStart('#'), 16);
        return new Rgb((byte)(v >> 16), (byte)(v >> 8), (byte)v);
    }

    public Rgb Mix(Rgb o, double t) => new(
        (byte)Math.Round(R + (o.R - R) * t),
        (byte)Math.Round(G + (o.G - G) * t),
        (byte)Math.Round(B + (o.B - B) * t));

    public Rgb Scale(double f) => new(
        (byte)Math.Clamp(Math.Round(R * f), 0, 255),
        (byte)Math.Clamp(Math.Round(G * f), 0, 255),
        (byte)Math.Clamp(Math.Round(B * f), 0, 255));
}

internal static class Renderer
{
    private static readonly Rgb White = Rgb.Hex("#FFFFFF");
    private static readonly Rgb Sea = Rgb.Hex("#2F6F93");
    private static readonly Rgb River = Rgb.Hex("#4A90B8");
    private static readonly Rgb Lake = Rgb.Hex("#5FAFC4");
    private static readonly Rgb Sand = Rgb.Hex("#E6D6A8");
    private static readonly Rgb Verge = Rgb.Hex("#D3D3CB");
    private static readonly Rgb OpenLand = Rgb.Hex("#C9CDB8");

    public static Canvas Render(CityLayout l, string mode, int size)
    {
        var s = Math.Max(4, size / Math.Max(l.Width, l.Height));
        var c = new Canvas(l.Width * s, l.Height * s);
        double minLv = double.MaxValue, maxLv = 0;
        foreach (var v in l.LandValues)
        {
            if (v <= 0) continue;
            minLv = Math.Min(minLv, (double)v);
            maxLv = Math.Max(maxLv, (double)v);
        }

        for (var pz = 0; pz < l.Height; pz++)
        {
            for (var px = 0; px < l.Width; px++)
            {
                var i = pz * l.Width + px;
                var kind = l.Kinds[i];
                Rgb fill;
                if (kind == PlotKind.Water) fill = WaterColour(l.WaterKinds[i]);
                else if (kind == PlotKind.Beach) fill = Sand;
                else if (kind == PlotKind.Road) fill = l.WaterKinds[i] != WaterKind.None ? WaterColour(l.WaterKinds[i]) : Verge;
                else if (mode == "landvalue") fill = Ramp(Math.Log((double)Math.Max(1, l.LandValues[i]) / minLv) / Math.Log(maxLv / minLv));
                else if (mode == "traffic") fill = Ramp(l.TrafficValues[i] / 100.0);
                else if (mode == "districts") fill = DistrictColour(l.Districts[i]);
                else if (kind == PlotKind.Open) fill = OpenLand;
                else fill = ParcelColour(l.ParcelAt(px, pz)!);
                c.Fill(px * s, pz * s, s, s, fill);
            }
        }

        if (mode == "zones")
        {
            foreach (var p in l.Parcels) DrawParcel(c, l, p, s);
            foreach (var d in l.Deposits) Hatch(c, d.Rect, s, d.Resource == DepositKind.Oil ? Rgb.Hex("#111111") : Rgb.Hex("#7A3B12"));
        }

        DrawRoads(c, l, s, mode != "zones");

        if (mode == "zones")
        {
            foreach (var m in l.Landmarks) Outline(c, m.Rect, s, Rgb.Hex("#00E5FF"), 2);
            var cx = (int)(l.CbdX * s);
            var cz = (int)(l.CbdZ * s);
            c.Fill(cx - 2, cz - 2, 5, 5, Rgb.Hex("#FF0000"));
        }

        if (l.HasTerrain) Hillshade(c, l, s);
        return c;
    }

    private static Rgb WaterColour(WaterKind w) => w switch
    {
        WaterKind.River => River,
        WaterKind.Lake => Lake,
        _ => Sea,
    };

    /// <summary>Viridis-like ramp (dark blue → teal → yellow → red) for the heat maps.</summary>
    private static Rgb Ramp(double t)
    {
        t = Math.Clamp(double.IsNaN(t) ? 0 : t, 0, 1);
        Rgb[] stops = [Rgb.Hex("#2C1E4F"), Rgb.Hex("#2A6F97"), Rgb.Hex("#3FB68B"), Rgb.Hex("#F2D43B"), Rgb.Hex("#E8762B"), Rgb.Hex("#C0272D")];
        var f = t * (stops.Length - 1);
        var k = Math.Min(stops.Length - 2, (int)f);
        return stops[k].Mix(stops[k + 1], f - k);
    }

    private static Rgb DistrictColour(District d) => d switch
    {
        District.Cbd => Rgb.Hex("#B03A2E"),
        District.Commercial => Rgb.Hex("#E67E22"),
        District.Mixed => Rgb.Hex("#F0A85A"),
        District.Apartments => Rgb.Hex("#E2B93B"),
        District.Houses => Rgb.Hex("#F3E19B"),
        District.Industrial => Rgb.Hex("#8E7CC3"),
        District.Port => Rgb.Hex("#6C7A89"),
        District.Rural => Rgb.Hex("#B5CC8E"),
        District.Park => Rgb.Hex("#6AAF5A"),
        District.Civic => Rgb.Hex("#3A6EA5"),
        _ => OpenLand,
    };

    private static Rgb ParcelColour(Parcel p)
    {
        var a = p.Ambient;
        if (p.District == District.Rural && a is not null)
        {
            return a.Kind switch
            {
                AmbientKind.Field => Rgb.Hex("#D2C873"),
                AmbientKind.Pasture => Rgb.Hex("#A9C77F"),
                AmbientKind.Orchard => Rgb.Hex("#7FA65A"),
                AmbientKind.Vineyard => Rgb.Hex("#9A8F4E"),
                AmbientKind.Forest => Rgb.Hex("#3E7A3E"),
                AmbientKind.Scrub => Rgb.Hex("#CDBF8E"),
                AmbientKind.Deposit => Rgb.Hex("#C9B79C"),
                _ => DistrictColour(p.District),
            };
        }
        if (a?.Kind is AmbientKind.Park) return Rgb.Hex("#6AAF5A");
        if (a?.Kind is AmbientKind.Plaza) return Rgb.Hex("#D9CFBF");
        if (a?.Kind is AmbientKind.Parking) return Rgb.Hex("#A7A7A7");
        var baseColour = DistrictColour(p.District);
        return a is null ? baseColour.Mix(White, 0.55) : baseColour;
    }

    private static void DrawParcel(Canvas c, CityLayout l, Parcel p, int s)
    {
        var x0 = p.Px * s;
        var y0 = p.Pz * s;
        var w = p.W * s;
        var h = p.H * s;
        var edge = ParcelColour(p).Scale(0.78);
        for (var x = x0; x < x0 + w; x++)
        {
            c.Set(x, y0, edge);
            c.Set(x, y0 + h - 1, edge);
        }
        for (var y = y0; y < y0 + h; y++)
        {
            c.Set(x0, y, edge);
            c.Set(x0 + w - 1, y, edge);
        }

        if (p.Ambient is not { IsStructure: true } a) return;
        // Building footprint: darker with height.
        var inset = Math.Max(1, s / 5);
        var shade = 0.82 - Math.Min(0.45, a.Floors / 60.0 * 0.45);
        var colour = a.Kind == AmbientKind.Civic ? Rgb.Hex("#24497A") : ParcelColour(p).Scale(shade);
        c.Fill(x0 + inset, y0 + inset, w - 2 * inset, h - 2 * inset, colour);
    }

    private static void Hatch(Canvas c, PlotRect r, int s, Rgb colour)
    {
        for (var y = r.Pz * s; y < r.Bottom * s; y++)
        {
            for (var x = r.Px * s; x < r.Right * s; x++)
            {
                if ((x + y) % 6 == 0) c.Set(x, y, colour);
            }
        }
        Outline(c, r, s, colour, 1);
    }

    private static void Outline(Canvas c, PlotRect r, int s, Rgb colour, int width)
    {
        for (var k = 0; k < width; k++)
        {
            var x0 = r.Px * s + k;
            var y0 = r.Pz * s + k;
            var x1 = r.Right * s - 1 - k;
            var y1 = r.Bottom * s - 1 - k;
            for (var x = x0; x <= x1; x++)
            {
                c.Set(x, y0, colour);
                c.Set(x, y1, colour);
            }
            for (var y = y0; y <= y1; y++)
            {
                c.Set(x0, y, colour);
                c.Set(x1, y, colour);
            }
        }
    }

    private static void DrawRoads(Canvas c, CityLayout l, int s, bool heat)
    {
        for (var pz = 0; pz < l.Height; pz++)
        {
            for (var px = 0; px < l.Width; px++)
            {
                var cls = l.RoadClasses[pz * l.Width + px];
                if (cls == RoadClass.None) continue;
                var frac = cls switch
                {
                    RoadClass.Local => 0.4,
                    RoadClass.Collector => 0.55,
                    RoadClass.Arterial => 0.8,
                    _ => 1.0,
                };
                if (heat) frac *= 0.6;
                var colour = cls switch
                {
                    RoadClass.Local => Rgb.Hex("#6E6E6E"),
                    RoadClass.Collector => Rgb.Hex("#555555"),
                    RoadClass.Arterial => Rgb.Hex("#333333"),
                    _ => Rgb.Hex("#1C1C1C"),
                };
                var band = Math.Max(1, (int)Math.Round(s * frac));
                var off = (s - band) / 2;
                var x0 = px * s;
                var y0 = pz * s;
                c.Fill(x0 + off, y0 + off, band, band, colour);
                if (Road(l, px - 1, pz)) c.Fill(x0, y0 + off, off, band, colour);
                if (Road(l, px + 1, pz)) c.Fill(x0 + off + band, y0 + off, s - off - band, band, colour);
                if (Road(l, px, pz - 1)) c.Fill(x0 + off, y0, band, off, colour);
                if (Road(l, px, pz + 1)) c.Fill(x0 + off, y0 + off + band, band, s - off - band, colour);
                if (cls == RoadClass.Highway && s >= 6) c.Fill(x0 + s / 2, y0 + s / 2, 1, 1, Rgb.Hex("#F2C230"));
            }
        }
    }

    private static bool Road(CityLayout l, int px, int pz) => l.InBounds(px, pz) && l.RoadAt(px, pz) != RoadClass.None;

    private static void Hillshade(Canvas c, CityLayout l, int s)
    {
        double H(double x, double z)
        {
            x = Math.Clamp(x, 0, l.Width);
            z = Math.Clamp(z, 0, l.Height);
            var x0 = Math.Min(l.Width - 1, (int)x);
            var z0 = Math.Min(l.Height - 1, (int)z);
            var fx = x - x0;
            var fz = z - z0;
            var a = l.CornerHeight(x0, z0);
            var b = l.CornerHeight(x0 + 1, z0);
            var cc = l.CornerHeight(x0, z0 + 1);
            var d = l.CornerHeight(x0 + 1, z0 + 1);
            return (a * (1 - fx) + b * fx) * (1 - fz) + (cc * (1 - fx) + d * fx) * fz;
        }

        for (var y = 0; y < c.Height; y++)
        {
            for (var x = 0; x < c.Width; x++)
            {
                var gx = (double)x / s;
                var gz = (double)y / s;
                var e = 0.5;
                var dhdx = (H(gx + e, gz) - H(gx - e, gz)) / (2 * e * 24.0);
                var dhdz = (H(gx, gz + e) - H(gx, gz - e)) / (2 * e * 24.0);
                // Light from the north-west.
                var shade = 1.0 + (dhdx * -0.707 + dhdz * -0.707) * -2.2;
                var height = H(gx, gz);
                shade *= 0.9 + 0.1 * Math.Min(1.0, height / 30.0);
                c.Set(x, y, c.Get(x, y).Scale(Math.Clamp(shade, 0.55, 1.25)));
            }
        }
    }
}
