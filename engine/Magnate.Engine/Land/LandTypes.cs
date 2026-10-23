namespace Magnate.Engine.Land;

// Vocabulary of the city layout. Every enum here has a stable wire name (see
// LandWire) because the bridge ships these values to the web client; never
// renumber or rename a member without updating the client decoder.

/// <summary>What occupies one plot of the city grid.</summary>
public enum PlotKind : byte
{
    /// <summary>Unparcelled land (a verge or landlocked courtyard). Not buildable.</summary>
    Open = 0,

    /// <summary>Land inside a <see cref="Parcel"/>.</summary>
    Parcel = 1,

    /// <summary>A road plot. When <see cref="CityLayout.WaterAt"/> is not <see cref="WaterKind.None"/> it is a bridge.</summary>
    Road = 2,

    /// <summary>Open water: sea, river or lake.</summary>
    Water = 3,

    /// <summary>A public sand beach along the sea. Not buildable.</summary>
    Beach = 4,
}

/// <summary>Functional class of a road plot. Ordered: a higher value is a busier road.</summary>
public enum RoadClass : byte
{
    /// <summary>Not a road.</summary>
    None = 0,

    /// <summary>Local street or country lane (2 lanes).</summary>
    Local = 1,

    /// <summary>Collector street (2 lanes plus parking; trucks and big-box frontage).</summary>
    Collector = 2,

    /// <summary>Arterial avenue (4 lanes with a median).</summary>
    Arterial = 3,

    /// <summary>Inter-city highway (4–6 lanes).</summary>
    Highway = 4,
}

/// <summary>The coarse zoning of a parcel, exactly the bridge-spec §8.1 <c>ParcelDto.zone</c> set.</summary>
public enum Zone : byte
{
    /// <summary>No zone (roads, water, beaches).</summary>
    None = 0,

    /// <summary>Apartments and houses.</summary>
    Residential = 1,

    /// <summary>CBD, main-street commercial and mixed arterial strips.</summary>
    Commercial = 2,

    /// <summary>Factories and warehouses.</summary>
    Industrial = 3,

    /// <summary>The rural ring: fields, pasture, orchards, forest, scrub and resource deposits.</summary>
    Agricultural = 4,

    /// <summary>Quayside land that can take a seaport.</summary>
    Port = 5,

    /// <summary>Public parks and plazas (not for sale).</summary>
    Park = 6,

    /// <summary>Civic buildings and landmarks (not for sale).</summary>
    Civic = 7,
}

/// <summary>
/// The fine-grained land-use district of caplab-brief §5.3. Placement rules and
/// ambient development use the district; the wire <see cref="Zone"/> is derived
/// from it (<see cref="LandWire.ZoneOf"/>).
/// </summary>
public enum District : byte
{
    /// <summary>No district (roads, water, beaches).</summary>
    None = 0,

    /// <summary>Central business district: towers, banks, the exchange, city hall.</summary>
    Cbd = 1,

    /// <summary>Main-street commercial ring around the CBD.</summary>
    Commercial = 2,

    /// <summary>Two-plot commercial strips along arterials through residential rings.</summary>
    Mixed = 3,

    /// <summary>Residential-high: apartment blocks.</summary>
    Apartments = 4,

    /// <summary>Residential-low: detached houses, row houses and villas.</summary>
    Houses = 5,

    /// <summary>The industrial wedge.</summary>
    Industrial = 6,

    /// <summary>Quayside port land.</summary>
    Port = 7,

    /// <summary>The rural ring beyond the urban edge.</summary>
    Rural = 8,

    /// <summary>Parks and promenades.</summary>
    Park = 9,

    /// <summary>Civic sites and landmarks.</summary>
    Civic = 10,
}

/// <summary>Kind of water body on a plot.</summary>
public enum WaterKind : byte
{
    /// <summary>Dry land.</summary>
    None = 0,

    /// <summary>The sea (coastal cities).</summary>
    Sea = 1,

    /// <summary>A river.</summary>
    River = 2,

    /// <summary>A lake or pond.</summary>
    Lake = 3,
}

/// <summary>How a water rectangle meets the land (art §5.3 request 2).</summary>
public enum ShoreKind : byte
{
    /// <summary>Open water or a natural grassy bank.</summary>
    None = 0,

    /// <summary>A sand beach.</summary>
    Beach = 1,

    /// <summary>A concrete quay wall (port, promenade).</summary>
    Quay = 2,
}

/// <summary>A natural-resource deposit type. Only resources the content can extract are generated.</summary>
public enum DepositKind : byte
{
    /// <summary>No deposit.</summary>
    None = 0,

    /// <summary>Iron ore (mineral-rich cities; extracted by <c>iron_mine</c>).</summary>
    Iron = 1,

    /// <summary>Crude oil (oil-rich cities; extracted by <c>oil_well</c>).</summary>
    Oil = 2,
}

/// <summary>Climate used by the renderer for seasons and vegetation (art §3.14).</summary>
public enum Climate : byte
{
    /// <summary>Four seasons, no snow by default.</summary>
    Temperate = 0,

    /// <summary>Mild winters, palms.</summary>
    Warm = 1,

    /// <summary>Snowy winters.</summary>
    Cold = 2,

    /// <summary>Dry scrubland.</summary>
    Arid = 3,
}

/// <summary>Street-facing side of a lot (art §3.2 lot frame: facing S = 0, E = 1, N = 2, W = 3).</summary>
public enum Facing : byte
{
    /// <summary>Front faces +Z (south).</summary>
    South = 0,

    /// <summary>Front faces +X (east).</summary>
    East = 1,

    /// <summary>Front faces −Z (north).</summary>
    North = 2,

    /// <summary>Front faces −X (west).</summary>
    West = 3,
}

/// <summary>Kind of a named landmark.</summary>
public enum LandmarkKind : byte
{
    /// <summary>City hall (CBD).</summary>
    CityHall = 0,

    /// <summary>Stock exchange (the financial capital's CBD).</summary>
    StockExchange = 1,

    /// <summary>Commercial bank (CBD); opens the loan screens.</summary>
    Bank = 2,

    /// <summary>Investment bank (CBD of large cities).</summary>
    InvestmentBank = 3,

    /// <summary>The public harbour of a coastal city.</summary>
    Port = 4,

    /// <summary>University campus.</summary>
    University = 5,

    /// <summary>Stadium.</summary>
    Stadium = 6,

    /// <summary>Hospital.</summary>
    Hospital = 7,

    /// <summary>The central park next to the CBD.</summary>
    CentralPark = 8,
}

/// <summary>Ambient (non-company) development drawn on a parcel. Wire names in <see cref="LandWire"/>.</summary>
public enum AmbientKind : byte
{
    /// <summary>Detached house (1×1).</summary>
    House = 0,

    /// <summary>A row of terraced houses (1×1).</summary>
    Rowhouse = 1,

    /// <summary>Luxury villa (1×1–2×2).</summary>
    Villa = 2,

    /// <summary>Apartment block (2×2–3×3).</summary>
    Apartment = 3,

    /// <summary>Mixed-use mid-rise: shops below, flats or offices above.</summary>
    Midrise = 4,

    /// <summary>Office tower.</summary>
    Office = 5,

    /// <summary>Strip mall along a collector or arterial.</summary>
    StripMall = 6,

    /// <summary>Local (unbranded) shop.</summary>
    Shop = 7,

    /// <summary>A civic building; the sub-kind is <see cref="AmbientBuilding.Civic"/>.</summary>
    Civic = 8,

    /// <summary>Park with lawns and trees.</summary>
    Park = 9,

    /// <summary>Paved plaza or promenade.</summary>
    Plaza = 10,

    /// <summary>Surface car park.</summary>
    Parking = 11,

    /// <summary>Crop field.</summary>
    Field = 12,

    /// <summary>Forest (timber).</summary>
    Forest = 13,

    /// <summary>Orchard.</summary>
    Orchard = 14,

    /// <summary>Vineyard.</summary>
    Vineyard = 15,

    /// <summary>Pasture with livestock.</summary>
    Pasture = 16,

    /// <summary>Dry scrubland (non-arable cities).</summary>
    Scrub = 17,

    /// <summary>An undeveloped resource deposit; the resource is <see cref="AmbientBuilding.Deposit"/>.</summary>
    Deposit = 18,

    /// <summary>Local manufacturer's factory shed (E3a extension).</summary>
    Factory = 19,

    /// <summary>Local logistics warehouse (E3a extension).</summary>
    Warehouse = 20,

    /// <summary>Oil tank farm (E3a extension).</summary>
    TankFarm = 21,
}

/// <summary>Civic building sub-kind (<c>civic:&lt;kind&gt;</c> on the wire).</summary>
public enum CivicKind : byte
{
    /// <summary>Not a civic building.</summary>
    None = 0,

    /// <summary>City hall.</summary>
    Hall = 1,

    /// <summary>Stock exchange.</summary>
    Exchange = 2,

    /// <summary>Bank or investment bank.</summary>
    Bank = 3,

    /// <summary>School.</summary>
    School = 4,

    /// <summary>Hospital.</summary>
    Hospital = 5,

    /// <summary>Police station.</summary>
    Police = 6,

    /// <summary>Fire station.</summary>
    Fire = 7,

    /// <summary>University.</summary>
    University = 8,

    /// <summary>Stadium.</summary>
    Stadium = 9,

    /// <summary>Church.</summary>
    Church = 10,

    /// <summary>Public harbour terminal (E3a extension).</summary>
    Port = 11,
}

/// <summary>
/// What a plot is used for, as seen by the traffic and land-value fields. The
/// generator derives it from ambient development; the World (Wave 2) overrides
/// plots covered by company buildings (<see cref="LandUses.ForCategory"/>).
/// </summary>
public enum LandUse : byte
{
    /// <summary>Road, water or beach.</summary>
    None = 0,

    /// <summary>Undeveloped land: a vacant lot, scrub or a deposit.</summary>
    Vacant = 1,

    /// <summary>Houses, row houses, villas.</summary>
    House = 2,

    /// <summary>Apartment blocks.</summary>
    Apartment = 3,

    /// <summary>Offices (towers, HQs, media, R&amp;D).</summary>
    Office = 4,

    /// <summary>Shops, malls, mixed-use ground floors.</summary>
    Retail = 5,

    /// <summary>Civic buildings.</summary>
    Civic = 6,

    /// <summary>Parks and plazas.</summary>
    Park = 7,

    /// <summary>Factories and tank farms.</summary>
    Factory = 8,

    /// <summary>Warehouses, seaports, logistics.</summary>
    Warehouse = 9,

    /// <summary>Mines and oil wells.</summary>
    Extraction = 10,

    /// <summary>Fields, pasture, orchards, vineyards, farms.</summary>
    Farm = 11,

    /// <summary>Forest.</summary>
    Forest = 12,

    /// <summary>Paved parking.</summary>
    Parking = 13,
}

/// <summary>A plot coordinate. <c>Px</c> grows east (+X), <c>Pz</c> grows south (+Z); (0,0) is the NW corner.</summary>
public readonly record struct PlotPoint(int Px, int Pz)
{
    /// <inheritdoc/>
    public override string ToString() => $"({Px},{Pz})";
}

/// <summary>An axis-aligned rectangle of plots: the NW corner plus a size in plots.</summary>
public readonly record struct PlotRect(int Px, int Pz, int W, int H)
{
    /// <summary>Exclusive east edge.</summary>
    public int Right => Px + W;

    /// <summary>Exclusive south edge.</summary>
    public int Bottom => Pz + H;

    /// <summary>Number of plots covered.</summary>
    public int Area => W * H;

    /// <summary>True when the plot lies inside the rectangle.</summary>
    public bool Contains(int px, int pz) => px >= Px && px < Right && pz >= Pz && pz < Bottom;

    /// <summary>True when the two rectangles share at least one plot.</summary>
    public bool Intersects(PlotRect other)
        => Px < other.Right && other.Px < Right && Pz < other.Bottom && other.Pz < Bottom;

    /// <inheritdoc/>
    public override string ToString() => $"[{Px},{Pz} {W}x{H}]";
}
