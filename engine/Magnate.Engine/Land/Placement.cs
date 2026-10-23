using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Land;

/// <summary>
/// Which plots of a city are taken by company buildings (or their construction
/// sites). The World implements it in Wave 2; ambient development is layout
/// data, not occupancy (it can be bought out, see <see cref="PlacementResult.RedevelopmentCost"/>).
/// </summary>
public interface IPlotOccupancy
{
    /// <summary>The id of the company building covering the plot, or null when it is free.</summary>
    int? BuildingAt(int px, int pz);
}

/// <summary>Stock occupancies.</summary>
public static class PlotOccupancy
{
    /// <summary>A city with no company buildings.</summary>
    public static IPlotOccupancy None { get; } = new Nobody();

    private sealed class Nobody : IPlotOccupancy
    {
        public int? BuildingAt(int px, int pz) => null;
    }
}

/// <summary>A mutable occupancy grid (tools, tests, AI planning and the bridge's interim placement).</summary>
public sealed class PlotOccupancyMap : IPlotOccupancy
{
    private const int Free = int.MinValue;
    private readonly int[] _cells;

    /// <summary>An empty map for a <paramref name="width"/> × <paramref name="height"/> city.</summary>
    public PlotOccupancyMap(int width, int height)
    {
        if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        Width = width;
        Height = height;
        _cells = new int[width * height];
        Array.Fill(_cells, Free);
    }

    /// <summary>Grid width in plots.</summary>
    public int Width { get; }

    /// <summary>Grid height in plots.</summary>
    public int Height { get; }

    /// <inheritdoc/>
    public int? BuildingAt(int px, int pz)
    {
        if ((uint)px >= (uint)Width || (uint)pz >= (uint)Height) return null;
        var v = _cells[pz * Width + px];
        return v == Free ? null : v;
    }

    /// <summary>Marks the plots of <paramref name="rect"/> as covered by <paramref name="buildingId"/>.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The rectangle leaves the grid.</exception>
    /// <exception cref="InvalidOperationException">A plot is already occupied.</exception>
    public void Occupy(int buildingId, PlotRect rect)
    {
        if (buildingId == Free) throw new ArgumentOutOfRangeException(nameof(buildingId));
        if (rect.Px < 0 || rect.Pz < 0 || rect.Right > Width || rect.Bottom > Height || rect.W <= 0 || rect.H <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(rect), $"{rect} is outside {Width}x{Height}");
        }
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                if (_cells[z * Width + x] != Free) throw new InvalidOperationException($"plot ({x},{z}) is occupied by building {_cells[z * Width + x]}");
            }
        }
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++) _cells[z * Width + x] = buildingId;
        }
    }

    /// <summary>Frees every plot covered by <paramref name="buildingId"/>.</summary>
    public void Release(int buildingId)
    {
        for (var i = 0; i < _cells.Length; i++)
        {
            if (_cells[i] == buildingId) _cells[i] = Free;
        }
    }
}

/// <summary>Why a footprint cannot be built (wire names in <see cref="PlacementCodes"/>).</summary>
public enum PlacementCode : byte
{
    /// <summary>The footprint leaves the city grid.</summary>
    OutOfBounds = 0,

    /// <summary>A company building already stands on a plot.</summary>
    Occupied = 1,

    /// <summary>The footprint covers a road (E3a addition; bridge-spec <c>placementIssue: 'road'</c>).</summary>
    Road = 2,

    /// <summary>The footprint covers water.</summary>
    Water = 3,

    /// <summary>A plot is zoned for something else (or is a park, civic site, beach or unparcelled land).</summary>
    Zone = 4,

    /// <summary>No adjacent road of the required class.</summary>
    NeedsRoad = 5,

    /// <summary>Needs the sea: the city is inland, or the footprint does not front the water.</summary>
    NeedsCoast = 6,

    /// <summary>Needs a resource deposit the city or the plots do not have.</summary>
    NeedsDeposit = 7,

    /// <summary>Needs arable land and the city has none.</summary>
    NotArable = 8,

    /// <summary>Too steep (slope class 3, or class 2 under a footprint larger than 2×2).</summary>
    Slope = 9,
}

/// <summary>Wire names of <see cref="PlacementCode"/> (UPPER_SNAKE, as in the E3a brief and caplab §5.9).</summary>
public static class PlacementCodes
{
    /// <summary>The wire name of a code.</summary>
    public static string Name(PlacementCode code) => code switch
    {
        PlacementCode.OutOfBounds => "OUT_OF_BOUNDS",
        PlacementCode.Occupied => "OCCUPIED",
        PlacementCode.Road => "ROAD",
        PlacementCode.Water => "WATER",
        PlacementCode.Zone => "ZONE",
        PlacementCode.NeedsRoad => "NEEDS_ROAD",
        PlacementCode.NeedsCoast => "NEEDS_COAST",
        PlacementCode.NeedsDeposit => "NEEDS_DEPOSIT",
        PlacementCode.NotArable => "NOT_ARABLE",
        PlacementCode.Slope => "SLOPE",
        _ => throw new ArgumentOutOfRangeException(nameof(code), code, null),
    };
}

/// <summary>One reason a placement fails.</summary>
/// <param name="Code">Machine-readable reason.</param>
/// <param name="Message">Player-facing English message.</param>
/// <param name="At">The first offending plot, when the reason is plot-specific.</param>
public sealed record PlacementIssue(PlacementCode Code, string Message, PlotPoint? At = null)
{
    /// <summary>The wire name of <see cref="Code"/>.</summary>
    public string CodeName => PlacementCodes.Name(Code);
}

/// <summary>What the site offers (the live info panel of caplab §5.9 step 4).</summary>
/// <param name="Traffic">Mean customer-traffic index over the footprint, 0–100.</param>
/// <param name="PeakTraffic">Highest traffic index of a footprint plot.</param>
/// <param name="LocationFactor">econ-audit §4.3 <c>L = clamp(Traffic / median, 0.3, 2.5)</c>.</param>
/// <param name="DistanceToCbd">Distance from the footprint centre to the CBD centre, in plots.</param>
/// <param name="Frontage">Best road class adjacent to the footprint.</param>
/// <param name="District">Most common district under the footprint.</param>
/// <param name="MaxSlope">Steepest slope class under the footprint (0–3).</param>
/// <param name="Waterfront">The footprint touches the sea.</param>
/// <param name="LandValuePerPlot">Mean land value of the footprint plots, whole dollars.</param>
/// <param name="DepositId">The onshore deposit under the footprint, or 0.</param>
/// <param name="DepositQuality">Its quality (35–85), or 0.</param>
/// <param name="DepositReserve">Its recoverable reserve (tonnes or barrels), or 0.</param>
public sealed record SiteSummary(
    double Traffic,
    double PeakTraffic,
    double LocationFactor,
    double DistanceToCbd,
    RoadClass Frontage,
    District District,
    int MaxSlope,
    bool Waterfront,
    decimal LandValuePerPlot,
    int DepositId,
    int DepositQuality,
    double DepositReserve);

/// <summary>The verdict of <see cref="PlacementValidator.Validate"/>.</summary>
/// <param name="Ok">True when the building can be placed here.</param>
/// <param name="Issues">Every failed rule, one per code, most fundamental first. Empty when <paramref name="Ok"/>.</param>
/// <param name="Footprint">The plots covered (rotation applied).</param>
/// <param name="Rotation">Rotation in degrees (0, 90, 180 or 270; the front faces S, E, N, W).</param>
/// <param name="LandCost">Market value of the footprint plots the buyer does not already hold, whole dollars.</param>
/// <param name="RedevelopmentCost">Buy-out and demolition of the ambient buildings on the parcels the footprint touches, whole dollars.</param>
/// <param name="ParcelIds">Parcels the footprint touches, ascending.</param>
/// <param name="Site">Traffic, location and resource summary; null when the footprint leaves the grid.</param>
public sealed record PlacementResult(
    bool Ok,
    IReadOnlyList<PlacementIssue> Issues,
    PlotRect Footprint,
    int Rotation,
    decimal LandCost,
    decimal RedevelopmentCost,
    IReadOnlyList<int> ParcelIds,
    SiteSummary? Site)
{
    /// <summary>Land plus redevelopment (construction is priced by the building type).</summary>
    public decimal SiteCost => LandCost + RedevelopmentCost;

    /// <summary>The most fundamental issue, or null when the placement is valid.</summary>
    public PlacementIssue? FirstIssue => Issues.Count > 0 ? Issues[0] : null;
}

/// <summary>
/// The engine's placement authority (caplab-brief §5.9): validates a building
/// footprint at a plot and rotation against the layout, the company buildings
/// already standing (<see cref="IPlotOccupancy"/>), zoning, frontage, geography
/// and slope, and prices the site. Pure and cheap (a ghost can call it at 10 Hz).
/// </summary>
public static class PlacementValidator
{
    /// <summary>The footprint size after rotation (90° and 270° swap width and height).</summary>
    public static (int W, int H) RotatedSize(Footprint footprint, int rotation)
    {
        ArgumentNullException.ThrowIfNull(footprint);
        var r = NormalizeRotation(rotation);
        return r is 90 or 270 ? (footprint.Height, footprint.Width) : (footprint.Width, footprint.Height);
    }

    /// <summary>Rotation in [0, 360) for a multiple of 90 degrees.</summary>
    /// <exception cref="ArgumentException">The rotation is not a multiple of 90.</exception>
    public static int NormalizeRotation(int rotation)
    {
        if (rotation % 90 != 0) throw new ArgumentException($"rotation {rotation} must be a multiple of 90 degrees", nameof(rotation));
        return ((rotation % 360) + 360) % 360;
    }

    /// <summary>
    /// Validates <paramref name="type"/> with its north-west plot at
    /// (<paramref name="px"/>, <paramref name="pz"/>) and the given rotation (degrees).
    /// </summary>
    /// <param name="layout">The city layout.</param>
    /// <param name="occupancy">Company buildings already standing (use <see cref="PlotOccupancy.None"/> for an empty city).</param>
    /// <param name="type">The building type.</param>
    /// <param name="px">North-west plot x of the rotated footprint.</param>
    /// <param name="pz">North-west plot z of the rotated footprint.</param>
    /// <param name="rotation">0, 90, 180 or 270 (any multiple of 90 is normalised).</param>
    /// <param name="fields">Current land-value and traffic fields; defaults to the layout's generated ones.</param>
    /// <param name="land">
    /// The buyer's view of the land market (E3b): plots another company holds are
    /// <see cref="PlacementCode.Occupied"/>, plots the buyer holds add nothing to
    /// <see cref="PlacementResult.LandCost"/>, and cleared parcels need no buy-out. Null
    /// treats every plot as city land and every ambient structure as standing.
    /// </param>
    public static PlacementResult Validate(
        CityLayout layout,
        IPlotOccupancy occupancy,
        BuildingType type,
        int px,
        int pz,
        int rotation = 0,
        CityFields? fields = null,
        LandContext? land = null)
    {
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(occupancy);
        ArgumentNullException.ThrowIfNull(type);
        var r = NormalizeRotation(rotation);
        var (w, h) = RotatedSize(type.Footprint, r);
        var rect = new PlotRect(px, pz, w, h);
        var rule = SiteRules.For(type);
        fields ??= layout.Fields;
        var issues = new IssueList();

        if (w <= 0 || h <= 0 || rule.Class == SiteClass.None)
        {
            issues.Add(PlacementCode.Zone, $"{type.Name} has no site in the city");
        }
        if (px < 0 || pz < 0 || rect.Right > layout.Width || rect.Bottom > layout.Height)
        {
            issues.Add(PlacementCode.OutOfBounds, "Outside the city limits");
            return new PlacementResult(false, issues.Items, rect, r, 0, 0, Array.Empty<int>(), null);
        }

        CheckCityGeography(layout, type, rule, issues);

        // ---- per plot: occupancy, kind, zoning, deposits, slope
        var area = w * h;
        var maxSlope = 0;
        var strictest = RoadClass.Local;
        var districtCount = new int[16];
        decimal landCost = 0;
        decimal marketValue = 0;
        double trafficSum = 0, trafficPeak = 0;
        var parcels = new List<int>();
        var depositId = 0;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                var at = new PlotPoint(x, z);
                if (occupancy.BuildingAt(x, z) is { } building)
                {
                    issues.Add(PlacementCode.Occupied, $"Occupied by building {building}", at);
                }
                else if (land is not null && land.ForeignTitle(x, z))
                {
                    issues.Add(PlacementCode.Occupied, "Land owned by another company", at);
                }

                var kind = layout.KindAt(x, z);
                var district = layout.DistrictAt(x, z);
                districtCount[(int)district]++;
                maxSlope = Math.Max(maxSlope, layout.SlopeAt(x, z));
                var traffic = fields.TrafficAt(x, z);
                trafficSum += traffic;
                trafficPeak = Math.Max(trafficPeak, traffic);
                var value = fields.LandValueAt(x, z);
                marketValue += value;
                if (land is null || !land.OwnTitle(x, z)) landCost += value;

                switch (kind)
                {
                    case PlotKind.Road:
                        issues.Add(PlacementCode.Road, "Covers a road", at);
                        continue;
                    case PlotKind.Water:
                        issues.Add(PlacementCode.Water, "Covers water", at);
                        continue;
                    case PlotKind.Beach:
                        issues.Add(PlacementCode.Zone, "A public beach", at);
                        continue;
                    case PlotKind.Open:
                        issues.Add(PlacementCode.Zone, "Not zoned for building", at);
                        continue;
                }

                var parcel = layout.ParcelAt(x, z)!;
                if (!parcels.Contains(parcel.Id)) parcels.Add(parcel.Id);
                if (parcel.Landmark is not null || district is District.Civic or District.Park)
                {
                    issues.Add(PlacementCode.Zone, $"Public land ({LandWire.Name(LandWire.ZoneOf(district))})", at);
                    continue;
                }

                var zone = rule.ZoneFor(district);
                if (zone is null || area > zone.MaxArea)
                {
                    issues.Add(PlacementCode.Zone, $"Zoned {ZoneLabel(district)} — {rule.ZoneHint.ToLowerInvariant()}", at);
                }
                else if (zone.MinFrontage > strictest)
                {
                    strictest = zone.MinFrontage;
                }

                var deposit = layout.DepositAt(x, z);
                var onshore = deposit is { Offshore: false } ? deposit : null;
                if (rule.Deposit != DepositKind.None)
                {
                    if (onshore is null || onshore.Resource != rule.Deposit)
                    {
                        issues.Add(PlacementCode.NeedsDeposit, $"Needs an {LandWire.Name(rule.Deposit)} deposit under the whole site", at);
                    }
                    else if (depositId == 0)
                    {
                        depositId = onshore.Id;
                    }
                }
                else if (onshore is not null)
                {
                    issues.Add(PlacementCode.Zone, "Deposit land is reserved for extraction", at);
                }

                if (rule.NeedsForest && parcel.Ambient?.Kind != AmbientKind.Forest)
                {
                    issues.Add(PlacementCode.Zone, "Logging camps must stand in forest", at);
                }
            }
        }

        if (maxSlope >= 3 || (maxSlope == 2 && area > 4))
        {
            issues.Add(PlacementCode.Slope, maxSlope >= 3 ? "Too steep to build on" : "Too steep for a building larger than 2×2");
        }

        // ---- frontage and coast
        var frontage = Frontage(layout, rect, out var seaContacts);
        if (frontage == RoadClass.None || frontage < strictest)
        {
            issues.Add(PlacementCode.NeedsRoad, strictest > RoadClass.Local
                ? $"Needs {LandWire.Name(strictest)} or better road frontage"
                : "Needs road frontage");
        }
        if (rule.NeedsCoast && layout.Geography.Coastal && seaContacts < Math.Min(w, h))
        {
            issues.Add(PlacementCode.NeedsCoast, "Must stand on the quay, fronting the sea");
        }

        // ---- costs and summary
        parcels.Sort();
        decimal redevelopment = 0;
        foreach (var id in parcels)
        {
            var parcel = layout.ParcelById(id);
            redevelopment += land is null ? RedevelopmentValue(parcel) : land.Redevelopment(parcel);
        }

        var dominant = District.None;
        var dominantCount = 0;
        for (var d = 1; d < districtCount.Length; d++)
        {
            if (districtCount[d] <= dominantCount) continue;
            dominant = (District)d;
            dominantCount = districtCount[d];
        }
        var meanTraffic = trafficSum / area;
        var depositRecord = depositId > 0 ? layout.Deposits[depositId - 1] : null;
        var site = new SiteSummary(
            Math.Round(meanTraffic, 1),
            trafficPeak,
            Math.Round(fields.LocationFactor(meanTraffic), 3),
            Math.Round(Distance(rect.Px + w / 2.0, rect.Pz + h / 2.0, layout.CbdX, layout.CbdZ), 2),
            frontage,
            dominant,
            maxSlope,
            seaContacts > 0,
            Math.Round(marketValue / area, 0, MidpointRounding.ToEven),
            depositId,
            depositRecord?.Quality ?? 0,
            depositRecord?.Reserve ?? 0);

        return new PlacementResult(issues.Count == 0, issues.Items, rect, r, landCost, redevelopment, parcels, site);
    }

    /// <summary>
    /// What it costs to buy out and clear the ambient development of a parcel
    /// (2026 USD; the whole structure even when the footprint covers only part
    /// of its parcel). Open land, fields and scrub cost nothing to clear.
    /// </summary>
    public static decimal RedevelopmentValue(Parcel parcel)
    {
        ArgumentNullException.ThrowIfNull(parcel);
        if (parcel.Ambient is not { } a) return 0;
        var plots = parcel.Rect.Area;
        var floors = Math.Max(1, a.Floors);
        decimal perPlot = a.Kind switch
        {
            AmbientKind.House => 320_000m,
            AmbientKind.Rowhouse => 880_000m,
            AmbientKind.Villa => 1_250_000m,
            AmbientKind.Apartment => 700_000m * floors,
            AmbientKind.Midrise => 750_000m * floors,
            AmbientKind.Office => 1_000_000m * floors,
            AmbientKind.Shop => 550_000m * floors,
            AmbientKind.StripMall => 500_000m,
            AmbientKind.Factory => 600_000m,
            AmbientKind.Warehouse => 450_000m,
            AmbientKind.TankFarm => 800_000m,
            AmbientKind.Parking => 40_000m,
            AmbientKind.Orchard or AmbientKind.Vineyard => 25_000m,
            AmbientKind.Forest => 12_000m,
            _ => 0m,
        };
        return perPlot * plots;
    }

    /// <summary>Best road class adjacent to the rectangle from outside; also counts adjacent sea plots.</summary>
    internal static RoadClass Frontage(CityLayout layout, PlotRect rect, out int seaContacts)
    {
        var best = RoadClass.None;
        seaContacts = 0;
        for (var x = rect.Px; x < rect.Right; x++)
        {
            Look(x, rect.Pz - 1, ref best, ref seaContacts);
            Look(x, rect.Bottom, ref best, ref seaContacts);
        }
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            Look(rect.Px - 1, z, ref best, ref seaContacts);
            Look(rect.Right, z, ref best, ref seaContacts);
        }
        return best;

        void Look(int x, int z, ref RoadClass bestClass, ref int sea)
        {
            if (!layout.InBounds(x, z)) return;
            var c = layout.RoadAt(x, z);
            if (c > bestClass) bestClass = c;
            if (c == RoadClass.None && layout.WaterAt(x, z) == WaterKind.Sea) sea++;
        }
    }

    private static void CheckCityGeography(CityLayout layout, BuildingType type, SiteRule rule, IssueList issues)
    {
        var city = layout.Geography;
        var geo = type.GeographyRequirement;
        if ((rule.NeedsCoast || geo?.Coastal == true) && !city.Coastal)
        {
            issues.Add(PlacementCode.NeedsCoast, $"{layout.CityName} has no coast");
        }
        if ((rule.Deposit == DepositKind.Iron || geo?.MineralRich == true) && !city.MineralRich)
        {
            issues.Add(PlacementCode.NeedsDeposit, $"{layout.CityName} has no ore deposits");
        }
        if ((rule.Deposit == DepositKind.Oil || geo?.OilRich == true) && !city.OilRich)
        {
            issues.Add(PlacementCode.NeedsDeposit, $"{layout.CityName} has no oil");
        }
        if (rule.NeedsArable && !city.Arable)
        {
            issues.Add(PlacementCode.NotArable, $"{layout.CityName} has no arable land");
        }
    }

    private static string ZoneLabel(District d) => d switch
    {
        District.Cbd => "downtown",
        District.Commercial => "commercial",
        District.Mixed => "main street",
        District.Apartments => "residential (apartments)",
        District.Houses => "residential (houses)",
        District.Industrial => "industrial",
        District.Port => "port",
        District.Rural => "agricultural",
        District.Park => "park",
        District.Civic => "civic",
        _ => "unzoned",
    };

    private static double Distance(double x, double z, double x2, double z2)
    {
        var dx = x - x2;
        var dz = z - z2;
        return Math.Sqrt(dx * dx + dz * dz);
    }

    /// <summary>Issues in insertion order, at most one per code (the first location wins).</summary>
    private sealed class IssueList
    {
        private readonly List<PlacementIssue> _items = new();
        private int _seen;

        public IReadOnlyList<PlacementIssue> Items => _items;

        public int Count => _items.Count;

        public void Add(PlacementCode code, string message, PlotPoint? at = null)
        {
            var bit = 1 << (int)code;
            if ((_seen & bit) != 0) return;
            _seen |= bit;
            _items.Add(new PlacementIssue(code, message, at));
        }
    }
}
