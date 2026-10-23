using System;

namespace Magnate.Engine.Land;

/// <summary>
/// Stable string names for the land vocabulary, shared by the bridge DTOs, the
/// preview tool and the documentation (docs/overhaul/status/e3a-citygen.md).
/// The single-character plot codes are the compact per-plot encoding shipped in
/// <c>cityLayout.plots</c>.
/// </summary>
public static class LandWire
{
    /// <summary>The bridge-spec §8.1 zone of a district.</summary>
    public static Zone ZoneOf(District district) => district switch
    {
        District.Cbd or District.Commercial or District.Mixed => Zone.Commercial,
        District.Apartments or District.Houses => Zone.Residential,
        District.Industrial => Zone.Industrial,
        District.Port => Zone.Port,
        District.Rural => Zone.Agricultural,
        District.Park => Zone.Park,
        District.Civic => Zone.Civic,
        _ => Zone.None,
    };

    /// <summary>Wire name of a zone (<c>residential|commercial|industrial|agricultural|port|park|civic</c>).</summary>
    public static string Name(Zone zone) => zone switch
    {
        Zone.Residential => "residential",
        Zone.Commercial => "commercial",
        Zone.Industrial => "industrial",
        Zone.Agricultural => "agricultural",
        Zone.Port => "port",
        Zone.Park => "park",
        Zone.Civic => "civic",
        _ => "none",
    };

    /// <summary>Wire name of a district (<c>cbd|commercial|mixed|apartments|houses|industrial|port|rural|park|civic</c>).</summary>
    public static string Name(District district) => district switch
    {
        District.Cbd => "cbd",
        District.Commercial => "commercial",
        District.Mixed => "mixed",
        District.Apartments => "apartments",
        District.Houses => "houses",
        District.Industrial => "industrial",
        District.Port => "port",
        District.Rural => "rural",
        District.Park => "park",
        District.Civic => "civic",
        _ => "none",
    };

    /// <summary>Wire name of a road class (<c>local|collector|arterial|highway</c>).</summary>
    public static string Name(RoadClass road) => road switch
    {
        RoadClass.Local => "local",
        RoadClass.Collector => "collector",
        RoadClass.Arterial => "arterial",
        RoadClass.Highway => "highway",
        _ => "none",
    };

    /// <summary>bridge-spec §8.1 <c>RoadDto.kind</c>: collectors and locals are both <c>street</c>.</summary>
    public static string RoadKind(RoadClass road) => road switch
    {
        RoadClass.Highway => "highway",
        RoadClass.Arterial => "arterial",
        _ => "street",
    };

    /// <summary>Wire name of a water kind (<c>sea|river|lake</c>).</summary>
    public static string Name(WaterKind water) => water switch
    {
        WaterKind.Sea => "sea",
        WaterKind.River => "river",
        WaterKind.Lake => "lake",
        _ => "none",
    };

    /// <summary>Wire name of a shore kind (<c>beach|quay</c>), or null for a natural bank / open water.</summary>
    public static string? Name(ShoreKind shore) => shore switch
    {
        ShoreKind.Beach => "beach",
        ShoreKind.Quay => "quay",
        _ => null,
    };

    /// <summary>Wire name of a deposit resource (<c>iron|oil</c>).</summary>
    public static string Name(DepositKind deposit) => deposit switch
    {
        DepositKind.Iron => "iron",
        DepositKind.Oil => "oil",
        _ => "none",
    };

    /// <summary>Wire name of a climate (<c>temperate|warm|cold|arid</c>).</summary>
    public static string Name(Climate climate) => climate switch
    {
        Climate.Warm => "warm",
        Climate.Cold => "cold",
        Climate.Arid => "arid",
        _ => "temperate",
    };

    /// <summary>Wire name of a landmark kind (camelCase).</summary>
    public static string Name(LandmarkKind kind) => kind switch
    {
        LandmarkKind.CityHall => "cityHall",
        LandmarkKind.StockExchange => "stockExchange",
        LandmarkKind.Bank => "bank",
        LandmarkKind.InvestmentBank => "investmentBank",
        LandmarkKind.Port => "port",
        LandmarkKind.University => "university",
        LandmarkKind.Stadium => "stadium",
        LandmarkKind.Hospital => "hospital",
        LandmarkKind.CentralPark => "centralPark",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
    };

    /// <summary>Wire name of a civic sub-kind (the part after <c>civic:</c>).</summary>
    public static string Name(CivicKind kind) => kind switch
    {
        CivicKind.Hall => "hall",
        CivicKind.Exchange => "exchange",
        CivicKind.Bank => "bank",
        CivicKind.School => "school",
        CivicKind.Hospital => "hospital",
        CivicKind.Police => "police",
        CivicKind.Fire => "fire",
        CivicKind.University => "university",
        CivicKind.Stadium => "stadium",
        CivicKind.Church => "church",
        CivicKind.Port => "port",
        _ => "hall",
    };

    /// <summary>
    /// Wire name of an ambient kind (art §4.3 + §5.3 request 3, plus the E3a
    /// industrial extensions <c>factory</c>, <c>warehouse</c>, <c>tank_farm</c>).
    /// Civic and deposit kinds carry their sub-kind: <c>civic:hall</c>, <c>deposit:oil</c>.
    /// </summary>
    public static string Name(AmbientKind kind, CivicKind civic = CivicKind.None, DepositKind deposit = DepositKind.None) => kind switch
    {
        AmbientKind.House => "house",
        AmbientKind.Rowhouse => "rowhouse",
        AmbientKind.Villa => "villa",
        AmbientKind.Apartment => "apartment",
        AmbientKind.Midrise => "midrise",
        AmbientKind.Office => "office",
        AmbientKind.StripMall => "strip_mall",
        AmbientKind.Shop => "shop",
        AmbientKind.Civic => "civic:" + Name(civic),
        AmbientKind.Park => "park",
        AmbientKind.Plaza => "plaza",
        AmbientKind.Parking => "parking",
        AmbientKind.Field => "field",
        AmbientKind.Forest => "forest",
        AmbientKind.Orchard => "orchard",
        AmbientKind.Vineyard => "vineyard",
        AmbientKind.Pasture => "pasture",
        AmbientKind.Scrub => "scrub",
        AmbientKind.Deposit => "deposit:" + Name(deposit),
        AmbientKind.Factory => "factory",
        AmbientKind.Warehouse => "warehouse",
        AmbientKind.TankFarm => "tank_farm",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
    };

    /// <summary>
    /// Per-plot kind code used in <c>cityLayout.plots.kinds</c>: <c>p</c> parcel,
    /// <c>r</c> road, <c>b</c> bridge (road over water), <c>s</c> sea, <c>v</c> river,
    /// <c>l</c> lake, <c>h</c> beach, <c>o</c> open (unparcelled) land.
    /// </summary>
    public static char KindCode(PlotKind kind, WaterKind water) => kind switch
    {
        PlotKind.Parcel => 'p',
        PlotKind.Road => water == WaterKind.None ? 'r' : 'b',
        PlotKind.Water => water switch
        {
            WaterKind.River => 'v',
            WaterKind.Lake => 'l',
            _ => 's',
        },
        PlotKind.Beach => 'h',
        _ => 'o',
    };

    /// <summary>
    /// Per-plot district code used in <c>cityLayout.plots.districts</c>: <c>.</c> none,
    /// <c>C</c> CBD, <c>c</c> commercial, <c>m</c> mixed, <c>a</c> apartments,
    /// <c>h</c> houses, <c>i</c> industrial, <c>p</c> port, <c>g</c> rural,
    /// <c>k</c> park, <c>v</c> civic.
    /// </summary>
    public static char DistrictCode(District district) => district switch
    {
        District.Cbd => 'C',
        District.Commercial => 'c',
        District.Mixed => 'm',
        District.Apartments => 'a',
        District.Houses => 'h',
        District.Industrial => 'i',
        District.Port => 'p',
        District.Rural => 'g',
        District.Park => 'k',
        District.Civic => 'v',
        _ => '.',
    };

    /// <summary>Per-plot road code used in <c>cityLayout.plots.roads</c>: the digit of <see cref="RoadClass"/> (0 none … 4 highway).</summary>
    public static char RoadCode(RoadClass road) => (char)('0' + (int)road);
}

/// <summary>Maps ambient kinds and building categories onto <see cref="LandUse"/>.</summary>
public static class LandUses
{
    /// <summary>The land use of an ambient development kind.</summary>
    public static LandUse ForAmbient(AmbientKind kind) => kind switch
    {
        AmbientKind.House or AmbientKind.Rowhouse or AmbientKind.Villa => LandUse.House,
        AmbientKind.Apartment => LandUse.Apartment,
        AmbientKind.Midrise or AmbientKind.StripMall or AmbientKind.Shop => LandUse.Retail,
        AmbientKind.Office => LandUse.Office,
        AmbientKind.Civic => LandUse.Civic,
        AmbientKind.Park or AmbientKind.Plaza => LandUse.Park,
        AmbientKind.Parking => LandUse.Parking,
        AmbientKind.Field or AmbientKind.Orchard or AmbientKind.Vineyard or AmbientKind.Pasture => LandUse.Farm,
        AmbientKind.Forest => LandUse.Forest,
        AmbientKind.Factory or AmbientKind.TankFarm => LandUse.Factory,
        AmbientKind.Warehouse => LandUse.Warehouse,
        _ => LandUse.Vacant,
    };

    /// <summary>
    /// The land use of a company building by content category (Wave 2: the World
    /// overrides the plots its buildings cover). Unknown categories count as offices.
    /// </summary>
    public static LandUse ForCategory(string category) => category switch
    {
        "convenience_store" or "supermarket" or "department_store" or "specialty_store" or "auto_dealer"
            or "fashion_store" or "restaurant" or "fast_food" or "hardware_store" or "furniture_store"
            or "pharmacy" or "gas_station" or "showroom" or "shopping_mall" => LandUse.Retail,
        "factory" or "automotive_plant" or "semiconductor_fab" or "pharmaceutical_factory" => LandUse.Factory,
        "warehouse" or "distribution_center" or "seaport" or "freight_yard" => LandUse.Warehouse,
        "farm" or "livestock_farm" or "plantation" => LandUse.Farm,
        "mine" or "oil_well" or "quarry" or "logging_camp" => LandUse.Extraction,
        "apartment" or "luxury_condo" or "hotel" => LandUse.Apartment,
        "college" or "training_center" => LandUse.Civic,
        _ => LandUse.Office,
    };
}
