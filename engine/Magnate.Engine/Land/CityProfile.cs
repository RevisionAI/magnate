using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;
using Magnate.Engine.Land.Generation;

namespace Magnate.Engine.Land;

/// <summary>Which map edge the sea lies on.</summary>
public enum CoastSide : byte
{
    /// <summary>Inland city.</summary>
    None = 0,

    /// <summary>Sea along the north edge (pz = 0).</summary>
    North = 1,

    /// <summary>Sea along the east edge (px = W−1).</summary>
    East = 2,

    /// <summary>Sea along the south edge (pz = H−1).</summary>
    South = 3,

    /// <summary>Sea along the west edge (px = 0).</summary>
    West = 4,
}

/// <summary>Shape of the harbour the CBD or port grows around.</summary>
public enum BayStyle : byte
{
    /// <summary>A plain (noisy) coastline.</summary>
    None = 0,

    /// <summary>A broad natural bay with a straight, engineered head where the CBD waterfront sits.</summary>
    Inlet = 1,

    /// <summary>A rectangular dredged harbour basin lined with quays.</summary>
    Basin = 2,
}

/// <summary>Course of a river through the map.</summary>
public enum RiverCourse : byte
{
    /// <summary>No river.</summary>
    None = 0,

    /// <summary>Flows from the north edge to the south edge.</summary>
    NorthSouth = 1,

    /// <summary>Flows from the west edge to the east edge.</summary>
    EastWest = 2,
}

/// <summary>Terrain relief style.</summary>
public enum TerrainStyle : byte
{
    /// <summary>Flat ground (no terrain heights are shipped).</summary>
    Flat = 0,

    /// <summary>The town on a hilltop plateau, slopes falling away to the edges (Hilltown).</summary>
    Plateau = 1,

    /// <summary>A gentle river valley with a range of hills to one side (Riverside).</summary>
    Valley = 2,
}

/// <summary>A compass direction for highways (map edges).</summary>
public enum Compass : byte
{
    /// <summary>Towards pz = 0.</summary>
    North = 0,

    /// <summary>Towards px = W−1.</summary>
    East = 1,

    /// <summary>Towards pz = H−1.</summary>
    South = 2,

    /// <summary>Towards px = 0.</summary>
    West = 3,
}

/// <summary>Resource deposits to scatter in the rural ring.</summary>
/// <param name="Resource">The resource.</param>
/// <param name="Count">Onshore deposit count (2–6).</param>
/// <param name="BearingDeg">Preferred direction from the CBD (0 = east, 90 = south, 180 = west, 270 = north).</param>
/// <param name="OffshoreCount">Offshore (visual-only) deposits for coastal cities.</param>
public sealed record DepositPlan(DepositKind Resource, int Count, double BearingDeg, int OffshoreCount = 0);

/// <summary>A stretch of coast (fractions 0–1 along the coast side) given over to port quays.</summary>
/// <param name="Start">Start fraction along the coast.</param>
/// <param name="End">End fraction along the coast.</param>
public sealed record PortWindow(double Start, double End);

/// <summary>
/// The identity of a city: the knobs that make Metropolis read as a coastal
/// financial capital and Hilltown as a small historic hill town. Built-in cities
/// have hand-written profiles (caplab-brief §5.5); any other city id gets a
/// profile derived from its geography flags and population
/// (<see cref="CityProfiles.Resolve"/>). The seed varies the details (coastline,
/// street offsets, lots, development), never the identity.
/// </summary>
public sealed record CityProfile
{
    /// <summary>The city id this profile was written for, or <c>generic</c>.</summary>
    public required string Key { get; init; }

    /// <summary>One-line description of the identity (documentation and preview captions).</summary>
    public string Identity { get; init; } = "";

    /// <summary>Coast side (None for inland cities).</summary>
    public CoastSide Coast { get; init; }

    /// <summary>Target share of plots under the sea (caplab: 8–14%).</summary>
    public double SeaShare { get; init; } = 0.11;

    /// <summary>Harbour shape.</summary>
    public BayStyle Bay { get; init; }

    /// <summary>Centre of the bay or basin along the coast (0–1).</summary>
    public double BayPosition { get; init; } = 0.5;

    /// <summary>How far an inlet bay or basin cuts inland, as a fraction of the map depth.</summary>
    public double BayDepth { get; init; } = 0.17;

    /// <summary>Half-width of the straight bay head (or basin), as a fraction of the coast length.</summary>
    public double BayHalfWidth { get; init; } = 0.075;

    /// <summary>Stretches of coast lined with port quays.</summary>
    public IReadOnlyList<PortWindow> PortWindows { get; init; } = Array.Empty<PortWindow>();

    /// <summary>River course.</summary>
    public RiverCourse River { get; init; }

    /// <summary>River width in plots (1–3).</summary>
    public int RiverWidth { get; init; } = 2;

    /// <summary>Terrain style.</summary>
    public TerrainStyle Terrain { get; init; }

    /// <summary>Peak relief in metres (hill height above the valley floor).</summary>
    public double Relief { get; init; }

    /// <summary>Multiplier on the population-derived urban radius.</summary>
    public double UrbanScale { get; init; } = 1.0;

    /// <summary>Amplitude of the lobed urban edge (fraction of R_u).</summary>
    public double EdgeRoughness { get; init; } = 0.17;

    /// <summary>Outer normalised radius ρ of the CBD.</summary>
    public double CbdRho { get; init; } = 0.16;

    /// <summary>Outer ρ of the main-street commercial ring.</summary>
    public double CommercialRho { get; init; } = 0.32;

    /// <summary>Outer ρ of the apartment ring.</summary>
    public double ApartmentRho { get; init; } = 0.60;

    /// <summary>Minimum spacing of arterial avenues (plots, centre to centre).</summary>
    public int ArterialSpacingMin { get; init; } = 11;

    /// <summary>Maximum spacing of arterial avenues.</summary>
    public int ArterialSpacingMax { get; init; } = 13;

    /// <summary>Chance that a secondary avenue jogs sideways by 1–2 plots where it crosses a primary avenue.</summary>
    public double JogChance { get; init; } = 0.3;

    /// <summary>Chance that a primary avenue carries on past the urban edge to the map edge as a country road.</summary>
    public double CountryRoadChance { get; init; } = 0.6;

    /// <summary>Chance that a N–S country road jogs sideways by 1–3 plots where it crosses an E–W country road.</summary>
    public double RuralJogChance { get; init; } = 0.45;

    /// <summary>Direction of the industrial wedge from the CBD (degrees; null = towards the port or downstream).</summary>
    public double? IndustryBearingDeg { get; init; }

    /// <summary>Half-width of the industrial wedge in degrees.</summary>
    public double IndustryHalfWidthDeg { get; init; } = 35;

    /// <summary>Inner ρ of the industrial wedge.</summary>
    public double IndustryRhoMin { get; init; } = 0.35;

    /// <summary>Outer ρ of the industrial wedge.</summary>
    public double IndustryRhoMax { get; init; } = 1.1;

    /// <summary>Mills and factories line the downstream river banks.</summary>
    public bool RiverIndustry { get; init; }

    /// <summary>Directions of the inter-city highways (2–4).</summary>
    public IReadOnlyList<Compass> Highways { get; init; } = [Compass.West, Compass.East];

    /// <summary>Highway carriageway lanes.</summary>
    public int HighwayLanes { get; init; } = 4;

    /// <summary>Office tower floors at the bottom land-value percentile.</summary>
    public int OfficeFloorsMin { get; init; } = 12;

    /// <summary>Office tower floors at the top land-value percentile.</summary>
    public int OfficeFloorsMax { get; init; } = 40;

    /// <summary>Apartment floors at the bottom percentile.</summary>
    public int ApartmentFloorsMin { get; init; } = 4;

    /// <summary>Apartment floors at the top percentile.</summary>
    public int ApartmentFloorsMax { get; init; } = 12;

    /// <summary>Tallest mixed-use mid-rise.</summary>
    public int MidriseFloorsMax { get; init; } = 8;

    /// <summary>Share of house lots that are villas.</summary>
    public double VillaShare { get; init; } = 0.08;

    /// <summary>Share of house lots that are row houses.</summary>
    public double RowhouseShare { get; init; } = 0.30;

    /// <summary>Relative weight of crop fields in the rural ring (arable cities only).</summary>
    public double FieldWeight { get; init; } = 0.6;

    /// <summary>Relative weight of pasture.</summary>
    public double PastureWeight { get; init; } = 0.3;

    /// <summary>Relative weight of orchards.</summary>
    public double OrchardWeight { get; init; } = 0.1;

    /// <summary>Relative weight of vineyards.</summary>
    public double VineyardWeight { get; init; }

    /// <summary>Relative weight of scrub (used instead of fields when the city is not arable).</summary>
    public double ScrubWeight { get; init; } = 1.0;

    /// <summary>Share of the rural ring under forest (caplab: 5–10%).</summary>
    public double ForestShare { get; init; } = 0.07;

    /// <summary>Climate.</summary>
    public Climate Climate { get; init; }

    /// <summary>Shopping-centre sites at avenue crossings (null = one per 125k people, 1–5).</summary>
    public int? ShoppingCentres { get; init; }

    /// <summary>Central park size as a share of urban plots (caplab: 2–4%).</summary>
    public double ParkShare { get; init; } = 0.03;

    /// <summary>The city hosts the stock exchange.</summary>
    public bool StockExchange { get; init; }

    /// <summary>The city hosts an investment bank.</summary>
    public bool InvestmentBank { get; init; }

    /// <summary>Residential and rural sea shores get sand beaches.</summary>
    public bool Beaches { get; init; } = true;

    /// <summary>Extra churches (Hilltown's historic square has one beside the hall).</summary>
    public int Churches { get; init; } = 1;

    /// <summary>Resource deposits (only generated when the geography flag allows the resource).</summary>
    public IReadOnlyList<DepositPlan> Deposits { get; init; } = Array.Empty<DepositPlan>();
}

/// <summary>The built-in identity table and the generic fallback (caplab-brief §5.5).</summary>
public static class CityProfiles
{
    /// <summary>The key of the derived profile used for cities without a built-in entry.</summary>
    public const string GenericKey = "generic";

    private static readonly IReadOnlyDictionary<string, CityProfile> BuiltIn = new Dictionary<string, CityProfile>(StringComparer.Ordinal)
    {
        ["metropolis"] = new CityProfile
        {
            Key = "metropolis",
            Identity = "Coastal capital: a dense waterfront CBD of towers on a bay, container port and industrial wedge to the south, farmland to the west.",
            Coast = CoastSide.East,
            SeaShare = 0.12,
            Bay = BayStyle.Inlet,
            BayPosition = 0.47,
            BayDepth = 0.27,
            BayHalfWidth = 0.07,
            PortWindows = [new PortWindow(0.64, 0.96)],
            CbdRho = 0.2,
            CommercialRho = 0.36,
            ApartmentRho = 0.72,
            ArterialSpacingMin = 10,
            ArterialSpacingMax = 14,
            IndustryHalfWidthDeg = 38,
            IndustryRhoMin = 0.38,
            IndustryRhoMax = 1.25,
            Highways = [Compass.West, Compass.North, Compass.South],
            HighwayLanes = 6,
            OfficeFloorsMin = 18,
            OfficeFloorsMax = 60,
            ApartmentFloorsMin = 5,
            ApartmentFloorsMax = 15,
            MidriseFloorsMax = 10,
            VillaShare = 0.06,
            RowhouseShare = 0.38,
            FieldWeight = 0.62,
            PastureWeight = 0.28,
            OrchardWeight = 0.10,
            ForestShare = 0.07,
            Climate = Climate.Temperate,
            ParkShare = 0.035,
            StockExchange = true,
            InvestmentBank = true,
        },
        ["riverside"] = new CityProfile
        {
            Key = "riverside",
            Identity = "Workshop city: a river through the centre crossed by bridges, mills downstream, iron mines in the north-east hills.",
            River = RiverCourse.NorthSouth,
            RiverWidth = 3,
            Terrain = TerrainStyle.Valley,
            Relief = 30,
            CbdRho = 0.17,
            ApartmentRho = 0.55,
            ArterialSpacingMin = 9,
            ArterialSpacingMax = 13,
            IndustryBearingDeg = 90,
            IndustryHalfWidthDeg = 40,
            IndustryRhoMin = 0.32,
            IndustryRhoMax = 1.3,
            RiverIndustry = true,
            Highways = [Compass.West, Compass.East, Compass.South],
            OfficeFloorsMin = 10,
            OfficeFloorsMax = 28,
            ApartmentFloorsMin = 4,
            ApartmentFloorsMax = 10,
            MidriseFloorsMax = 7,
            VillaShare = 0.05,
            RowhouseShare = 0.40,
            FieldWeight = 0.55,
            PastureWeight = 0.35,
            OrchardWeight = 0.10,
            ForestShare = 0.08,
            Climate = Climate.Temperate,
            ParkShare = 0.03,
            Deposits = [new DepositPlan(DepositKind.Iron, 4, 315)],
        },
        ["eastside"] = new CityProfile
        {
            Key = "eastside",
            Identity = "Affluent, leafy town: low-rise boutiques, villas and parks, almost no industry, a ring of farmland and orchards.",
            ArterialSpacingMin = 9,
            ArterialSpacingMax = 13,
            JogChance = 0.4,
            CbdRho = 0.14,
            ApartmentRho = 0.42,
            IndustryBearingDeg = 180,
            IndustryHalfWidthDeg = 20,
            IndustryRhoMin = 0.6,
            IndustryRhoMax = 1.15,
            Highways = [Compass.West, Compass.East],
            OfficeFloorsMin = 6,
            OfficeFloorsMax = 16,
            ApartmentFloorsMin = 3,
            ApartmentFloorsMax = 6,
            MidriseFloorsMax = 5,
            VillaShare = 0.42,
            RowhouseShare = 0.10,
            FieldWeight = 0.52,
            PastureWeight = 0.20,
            OrchardWeight = 0.28,
            ForestShare = 0.07,
            Climate = Climate.Temperate,
            ParkShare = 0.06,
        },
        ["portbay"] = new CityProfile
        {
            Key = "portbay",
            Identity = "Oil and port town: a dredged container basin, refinery tank farms, pumpjacks inland, arid scrub, working-class housing.",
            Coast = CoastSide.South,
            SeaShare = 0.12,
            Bay = BayStyle.Basin,
            BayPosition = 0.34,
            BayDepth = 0.16,
            BayHalfWidth = 0.07,
            PortWindows = [new PortWindow(0.12, 0.50)],
            ArterialSpacingMin = 8,
            ArterialSpacingMax = 12,
            ApartmentRho = 0.5,
            IndustryHalfWidthDeg = 42,
            IndustryRhoMin = 0.3,
            IndustryRhoMax = 1.15,
            Highways = [Compass.North, Compass.West, Compass.East],
            OfficeFloorsMin = 8,
            OfficeFloorsMax = 22,
            ApartmentFloorsMin = 4,
            ApartmentFloorsMax = 9,
            MidriseFloorsMax = 6,
            VillaShare = 0.03,
            RowhouseShare = 0.55,
            FieldWeight = 0,
            PastureWeight = 0.12,
            OrchardWeight = 0,
            ScrubWeight = 0.88,
            ForestShare = 0.03,
            Climate = Climate.Warm,
            ParkShare = 0.025,
            Deposits = [new DepositPlan(DepositKind.Oil, 5, 270, OffshoreCount: 2)],
        },
        ["hilltown"] = new CityProfile
        {
            Key = "hilltown",
            Identity = "Small historic hill town: a tiny CBD square with a church-like hall on the hilltop, terraced villas, vineyards and orchards on the slopes.",
            Terrain = TerrainStyle.Plateau,
            Relief = 26,
            ArterialSpacingMin = 6,
            ArterialSpacingMax = 9,
            JogChance = 0.6,
            CountryRoadChance = 0.45,
            RuralJogChance = 0.6,
            CbdRho = 0.2,
            CommercialRho = 0.32,
            ApartmentRho = 0.48,
            IndustryBearingDeg = 135,
            IndustryHalfWidthDeg = 24,
            IndustryRhoMin = 0.55,
            IndustryRhoMax = 1.2,
            Highways = [Compass.North, Compass.South],
            OfficeFloorsMin = 3,
            OfficeFloorsMax = 6,
            ApartmentFloorsMin = 3,
            ApartmentFloorsMax = 5,
            MidriseFloorsMax = 4,
            VillaShare = 0.45,
            RowhouseShare = 0.15,
            FieldWeight = 0.22,
            PastureWeight = 0.15,
            OrchardWeight = 0.25,
            VineyardWeight = 0.38,
            ForestShare = 0.10,
            Climate = Climate.Temperate,
            ParkShare = 0.04,
            Churches = 2,
        },
    };

    /// <summary>The ids that have hand-written profiles.</summary>
    public static IEnumerable<string> BuiltInIds => BuiltIn.Keys;

    /// <summary>
    /// The profile for <paramref name="city"/>: its built-in entry, or one derived
    /// from geography, population and a hash of the city id (so a modded city
    /// gets a stable, plausible identity).
    /// </summary>
    public static CityProfile Resolve(City city)
    {
        ArgumentNullException.ThrowIfNull(city);
        return BuiltIn.TryGetValue(city.Id.Value, out var profile) ? profile : Derive(city);
    }

    private static CityProfile Derive(City city)
    {
        var rng = new LayoutRandom(LayoutSeeds.Fnv1a("profile:" + city.Id.Value));
        var g = city.Geography;
        var pop = Math.Max(20_000, city.Population);
        var big = pop >= 300_000;
        var small = pop < 150_000;

        var coast = CoastSide.None;
        var bay = BayStyle.None;
        var bayPos = rng.Range(0.35, 0.65);
        IReadOnlyList<PortWindow> ports = Array.Empty<PortWindow>();
        if (g.Coastal)
        {
            coast = (CoastSide)(1 + rng.Next(4));
            bay = rng.Chance(0.5) ? BayStyle.Inlet : BayStyle.Basin;
            ports = bayPos < 0.5
                ? [new PortWindow(Math.Min(0.95, bayPos + 0.18), Math.Min(0.97, bayPos + 0.42))]
                : [new PortWindow(Math.Max(0.03, bayPos - 0.42), Math.Max(0.05, bayPos - 0.18))];
        }

        // caplab §5.2: a random factor decides on a river (30% when inland).
        var river = !g.Coastal && rng.Chance(0.3) ? (rng.Chance(0.5) ? RiverCourse.NorthSouth : RiverCourse.EastWest) : RiverCourse.None;
        var terrain = !g.Coastal && g.MineralRich ? TerrainStyle.Valley : TerrainStyle.Flat;

        var highways = new List<Compass>();
        foreach (var c in new[] { Compass.West, Compass.East, Compass.North, Compass.South })
        {
            if (coast != CoastSide.None && CoastOf(c) == coast) continue;
            highways.Add(c);
        }
        var highwayCount = big ? 3 : 2;
        while (highways.Count > highwayCount) highways.RemoveAt(rng.Next(highways.Count));

        var deposits = new List<DepositPlan>();
        if (g.MineralRich) deposits.Add(new DepositPlan(DepositKind.Iron, rng.Range(3, 5), rng.Range(0.0, 360.0)));
        if (g.OilRich) deposits.Add(new DepositPlan(DepositKind.Oil, rng.Range(3, 5), rng.Range(0.0, 360.0), g.Coastal ? 1 : 0));

        var affluence = city.Demographics.TryGetValue(IncomeBracket.High, out var high) ? high : 0.2;
        return new CityProfile
        {
            Key = GenericKey,
            Identity = "Derived from geography flags and population.",
            Coast = coast,
            Bay = bay,
            BayPosition = bayPos,
            PortWindows = ports,
            River = river,
            Terrain = terrain,
            Relief = terrain == TerrainStyle.Flat ? 0 : 24,
            ArterialSpacingMin = small ? 8 : 10,
            ArterialSpacingMax = small ? 10 : 12,
            IndustryHalfWidthDeg = g.Coastal || g.OilRich || g.MineralRich ? 35 : 25,
            Highways = highways,
            HighwayLanes = big ? 6 : 4,
            OfficeFloorsMin = big ? 15 : small ? 4 : 8,
            OfficeFloorsMax = big ? 50 : small ? 10 : 24,
            ApartmentFloorsMax = big ? 14 : small ? 6 : 10,
            VillaShare = Math.Clamp(affluence * 0.9, 0.03, 0.45),
            RowhouseShare = Math.Clamp(0.5 - affluence, 0.08, 0.5),
            FieldWeight = g.Arable ? 0.6 : 0,
            PastureWeight = g.Arable ? 0.3 : 0.12,
            OrchardWeight = g.Arable ? 0.1 : 0,
            ScrubWeight = g.Arable ? 0 : 0.88,
            Climate = g.Arable ? Climate.Temperate : Climate.Arid,
            StockExchange = pop >= 400_000,
            InvestmentBank = pop >= 400_000,
            Deposits = deposits,
        };
    }

    /// <summary>The coast side that lies in a compass direction.</summary>
    internal static CoastSide CoastOf(Compass c) => c switch
    {
        Compass.North => CoastSide.North,
        Compass.East => CoastSide.East,
        Compass.South => CoastSide.South,
        _ => CoastSide.West,
    };
}
