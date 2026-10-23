using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// City layout (workstreams E3a + E3b, bridge-spec §8.1–8.2 + art-rendering §5.3 requests):
// the generated plan of a city — roads, parcels, water, ambient development,
// terrain, landmarks, deposits and the land-value / traffic fields — for the 3D
// renderer and the overlays, plus the land market (parcels, buyLand, sellLand).
// The generated part is static per (city, seed) and cached by the session; in a game
// under land rules the parcels' owners, buildings and listings, the cleared ambient
// development and the monthly land-value / traffic fields come from the World and
// the whole DTO is cached per layout revision (layoutRev).
public sealed partial class GameSession
{
    private readonly Dictionary<(string City, int Seed), CityLayout> _layouts = new();
    private readonly Dictionary<(string City, int Seed), CityLayoutDto> _layoutDtos = new();
    private readonly Dictionary<string, (World World, int Rev, CityLayoutDto Dto)> _liveLayoutDtos = new(StringComparer.Ordinal);
    private ContentCatalog? _layoutCatalog;

    /// <summary>Revision of a freshly generated layout (bumps with land sales, construction and field changes).</summary>
    public const int GeneratedLayoutRev = 1;

    /// <summary>
    /// The layout of one city. With a game in progress it is the game's layout (its
    /// layout seed; <paramref name="args"/>.Seed is ignored) at its current revision; without
    /// one, <c>seed</c> previews any generated layout (default <see cref="CityLayoutGenerator.DefaultSeed"/>).
    /// </summary>
    [BridgeMethod("cityLayout", RequiresGame = false)]
    public CityLayoutDto GetCityLayout(CityLayoutArgs args)
    {
        if (string.IsNullOrWhiteSpace(args.CityId))
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest, "cityId required");
        }
        var catalog = Catalog;
        if (!catalog.Cities.TryGetValue(new CityId(args.CityId), out var city))
        {
            throw new BridgeException(BridgeErrorCodes.NotFound, $"unknown city '{args.CityId}'");
        }

        if (_game is { } game) return LiveLayoutDto(game, city);
        var seed = args.Seed ?? CityLayoutGenerator.DefaultSeed;
        var layout = LayoutFor(city, seed); // also drops caches built from an older catalog
        return GeneratedLayoutDto(layout, seed);
    }

    // ------------------------------------------------------------------ §8.2 land market

    /// <summary>
    /// The parcels of a city with their market state (features.landMarket): owner, building,
    /// listing, current land value and traffic. <c>filter</c>: <c>forSale</c> (listed),
    /// <c>owned</c> (the player's: held or built on), <c>vacant</c> (no structure), or all.
    /// </summary>
    [BridgeMethod("parcels")]
    public IReadOnlyList<ParcelDto> Parcels(ParcelsArgs args)
    {
        var game = RequireLandMarket();
        var city = Guard.City(Catalog, args.CityId);
        Func<LandParcelInfo, bool> keep = args.Filter switch
        {
            null or "" or "all" => _ => true,
            "forSale" => p => p.ForSale,
            "owned" => p => p.Owner == game.Player,
            "vacant" => p => p.Vacant,
            _ => throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown parcel filter '{args.Filter}'.", "filter"),
        };
        var world = game.World;
        var generated = GeneratedLayoutDto(world.GetCityLayout(city.Id), world.LayoutSeed);
        return world.GetParcels(city.Id).Where(keep).Select(p => LiveParcel(generated.Parcels[p.Parcel.Id - 1], p)).ToList();
    }

    /// <summary>
    /// Buy a listed parcel outright at its current land value (features.landMarket): the
    /// player holds the plots and can build on them later without paying for the land again.
    /// </summary>
    [BridgeMethod("buyLand", Mutates = true)]
    public ParcelDto BuyLand(ParcelRefArgs args)
    {
        var game = RequireLandMarket();
        var world = game.World;
        var city = Guard.City(Catalog, args.CityId);
        var info = RequireParcel(world, city, args.ParcelId);
        if (!info.ForSale || info.AskingPrice is not decimal price)
        {
            throw new BridgeException(BridgeErrorCodes.ParcelNotForSale, "That parcel is not for sale.", "parcelId",
                new ErrorDetailsDto(EntityKind: EntityKinds.Parcel, EntityId: args.ParcelId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
        RequireCanInvest(game);
        var funds = world.AvailableFunds(game.Player);
        if (price > funds) throw Guard.InsufficientFunds(price, funds, "this parcel");

        MarkDirty();
        var deal = world.BuyLand(game.Player, city.Id, args.ParcelId);
        var after = world.GetParcel(city.Id, args.ParcelId);
        QueueEvent(new GameEventDto(LandEventKinds.LandPurchased, EventKinds.Success,
            $"Bought parcel {args.ParcelId} in {city.Name} for {Money(deal.Amount)}.",
            Amount: deal.Amount, CityId: city.Id.Value, CompanyId: game.Player.Value, IsPlayer: true,
            Placement: new PlacementDto(after.Parcel.Px, after.Parcel.Pz, 0, PlacementSources.Engine), Priority: 1));
        return LiveParcel(GeneratedLayoutDto(world.GetCityLayout(city.Id), world.LayoutSeed).Parcels[args.ParcelId - 1], after);
    }

    /// <summary>
    /// Sell the player's free plots of a parcel back at their current land value
    /// (features.landMarket); the difference to what they cost is a gain or loss.
    /// </summary>
    [BridgeMethod("sellLand", Mutates = true)]
    public ParcelDto SellLand(ParcelRefArgs args)
    {
        var game = RequireLandMarket();
        var world = game.World;
        var city = Guard.City(Catalog, args.CityId);
        var info = RequireParcel(world, city, args.ParcelId);
        var held = world.GetLandHoldings(game.Player).Any(h => h.City == city.Id && info.Parcel.Rect.Contains(h.Px, h.Pz));
        if (!held)
        {
            throw new BridgeException(BridgeErrorCodes.ParcelNotOwned, "You hold no free land on that parcel.", "parcelId",
                new ErrorDetailsDto(EntityKind: EntityKinds.Parcel, EntityId: args.ParcelId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }

        MarkDirty();
        world.SellLand(game.Player, city.Id, args.ParcelId);
        var after = world.GetParcel(city.Id, args.ParcelId);
        return LiveParcel(GeneratedLayoutDto(world.GetCityLayout(city.Id), world.LayoutSeed).Parcels[args.ParcelId - 1], after);
    }

    private ActiveGame RequireLandMarket()
    {
        var game = Game;
        if (!LandRulesOn(game)) throw Unavailable(FeatureNames.LandMarket);
        return game;
    }

    private static LandParcelInfo RequireParcel(World world, City city, int parcelId)
    {
        var count = world.GetCityLayout(city.Id).Parcels.Count;
        if (parcelId < 1 || parcelId > count)
        {
            throw Guard.NotFound(EntityKinds.Parcel, parcelId.ToString(System.Globalization.CultureInfo.InvariantCulture), "parcelId",
                $"{city.Name} has no parcel {parcelId}.");
        }
        return world.GetParcel(city.Id, parcelId);
    }

    // ------------------------------------------------------------------ layouts

    /// <summary>The generated (static) DTO of a layout, cached per (city, seed).</summary>
    private CityLayoutDto GeneratedLayoutDto(CityLayout layout, int seed)
    {
        if (!ReferenceEquals(_layoutCatalog, Catalog)) LayoutFor(Catalog.City(layout.CityId), seed); // resets stale caches
        var key = (layout.CityId.Value, seed);
        if (!_layoutDtos.TryGetValue(key, out var dto))
        {
            dto = ToCityLayoutDto(layout);
            _layoutDtos[key] = dto;
        }
        return dto;
    }

    /// <summary>
    /// The game's layout of a city as it stands. Classic games (no land rules) never change it:
    /// the generated DTO. Under land rules the parcels' market state, the ambient development
    /// still standing and the per-plot land value and traffic come from the World; cached until
    /// the city's layout revision moves.
    /// </summary>
    private CityLayoutDto LiveLayoutDto(ActiveGame game, City city)
    {
        var world = game.World;
        var layout = world.GetCityLayout(city.Id);
        var generated = GeneratedLayoutDto(layout, world.LayoutSeed);
        if (!LandRulesOn(game)) return generated;

        var rev = world.GetLayoutRevision(city.Id);
        if (_liveLayoutDtos.TryGetValue(city.Id.Value, out var cached) && ReferenceEquals(cached.World, world) && cached.Rev == rev)
        {
            return cached.Dto;
        }

        var infos = world.GetParcels(city.Id);
        var parcels = new List<ParcelDto>(infos.Count);
        var gone = new HashSet<int>();
        foreach (var info in infos)
        {
            parcels.Add(LiveParcel(generated.Parcels[info.Parcel.Id - 1], info));
            // Bought-out structures are demolished, and nothing ambient stands under a company building.
            if (info.Cleared || info.Building is not null) gone.Add(info.Parcel.Id);
        }
        var ambient = gone.Count == 0 ? generated.Ambient : generated.Ambient.Where(a => !gone.Contains(a.ParcelId)).ToList();

        var fields = world.GetLandFields(city.Id);
        var n = layout.PlotCount;
        var land = new decimal[n];
        var traffic = new double[n];
        var values = fields.LandValues;
        var flows = fields.Traffic;
        for (var i = 0; i < n; i++)
        {
            land[i] = Math.Round(values[i], 0, MidpointRounding.ToEven);
            traffic[i] = Math.Round(flows[i], 1);
        }
        var dto = generated with
        {
            LayoutRev = rev,
            Parcels = parcels,
            Ambient = ambient,
            Plots = generated.Plots with { LandValue = land, Traffic = traffic },
            MedianTraffic = fields.MedianUrbanTraffic,
        };
        _liveLayoutDtos[city.Id.Value] = (world, rev, dto);
        return dto;
    }

    /// <summary>A generated parcel with its live market state.</summary>
    private static ParcelDto LiveParcel(ParcelDto generated, LandParcelInfo info) => generated with
    {
        LandValuePerPlot = info.LandValuePerPlot,
        OwnerId = info.Owner?.Value,
        BuildingId = info.Building?.Value,
        ForSale = info.ForSale,
        AskingPrice = info.AskingPrice,
        Traffic = info.Traffic,
        Vacant = info.Vacant,
    };

    /// <summary>
    /// The engine layout of a city for the active game (or the default seed when
    /// none is running), for other bridge areas (placement previews, siting).
    /// </summary>
    internal CityLayout LayoutForCity(City city) => _world is { } world ? world.GetCityLayout(city.Id) : LayoutFor(city, CityLayoutGenerator.DefaultSeed);

    private CityLayout LayoutFor(City city, int seed)
    {
        // A new content catalog (init) invalidates everything generated from the old one.
        var catalog = Catalog;
        if (!ReferenceEquals(_layoutCatalog, catalog))
        {
            _layouts.Clear();
            _layoutDtos.Clear();
            _layoutCatalog = catalog;
        }
        var key = (city.Id.Value, seed);
        if (!_layouts.TryGetValue(key, out var layout))
        {
            layout = CityLayoutGenerator.Generate(city, seed);
            _layouts[key] = layout;
        }
        return layout;
    }

    private static CityLayoutDto ToCityLayoutDto(CityLayout layout)
    {
        var roads = new List<RoadDto>(layout.Roads.Count);
        foreach (var r in layout.Roads)
        {
            var path = new List<LayoutPlotDto>(r.Length);
            foreach (var p in r.Path()) path.Add(new LayoutPlotDto(p.Px, p.Pz));
            roads.Add(new RoadDto(r.Id, LandWire.RoadKind(r.Class), path, r.Lanes, LandWire.Name(r.Class), r.Bridge ? true : null));
        }

        var parcels = new List<ParcelDto>(layout.Parcels.Count);
        var ambient = new List<AmbientDto>();
        foreach (var p in layout.Parcels)
        {
            parcels.Add(new ParcelDto(
                p.Id,
                p.Px,
                p.Pz,
                p.W,
                p.H,
                LandWire.Name(p.Zone),
                p.LandValuePerPlot,
                OwnerId: null,
                BuildingId: null,
                p.ForSale,
                p.AskingPrice,
                p.Traffic,
                LandWire.Name(p.District),
                (int)p.Facing,
                p.Frontage == RoadClass.None ? null : LandWire.Name(p.Frontage),
                p.Vacant,
                p.DepositId == 0 ? null : p.DepositId,
                p.Landmark is { } lm ? LandWire.Name(lm) : null));
            if (p.Ambient is { } a) ambient.Add(new AmbientDto(p.Id, a.WireKind, a.Floors, a.Variant));
        }

        var water = new List<WaterRectDto>(layout.Water.Count);
        foreach (var w in layout.Water)
        {
            water.Add(new WaterRectDto(w.Rect.Px, w.Rect.Pz, w.Rect.W, w.Rect.H, LandWire.Name(w.Kind), LandWire.Name(w.Shore)));
        }

        var landmarks = new List<LayoutLandmarkDto>(layout.Landmarks.Count);
        foreach (var l in layout.Landmarks)
        {
            landmarks.Add(new LayoutLandmarkDto(LandWire.Name(l.Kind), l.ParcelId, l.Rect.Px, l.Rect.Pz, l.Rect.W, l.Rect.H));
        }

        var deposits = new List<LayoutDepositDto>(layout.Deposits.Count);
        foreach (var d in layout.Deposits)
        {
            deposits.Add(new LayoutDepositDto(d.Id, LandWire.Name(d.Resource), d.Rect.Px, d.Rect.Pz, d.Rect.W, d.Rect.H, d.Quality, d.Reserve, d.Offshore));
        }

        return new CityLayoutDto(
            layout.CityId.Value,
            GeneratedLayoutRev,
            layout.Width,
            layout.Height,
            roads,
            parcels,
            water,
            ambient,
            layout.Seed,
            LandWire.Name(layout.Climate),
            layout.HasTerrain ? new LayoutTerrainDto(layout.CornerHeights.ToArray()) : null,
            EncodePlots(layout),
            landmarks,
            deposits,
            new LayoutPointDto(Math.Round(layout.CbdX, 2), Math.Round(layout.CbdZ, 2)),
            Math.Round(layout.UrbanRadius, 2),
            layout.MedianUrbanTraffic,
            CityLayout.GeneratorVersion,
            layout.ProfileKey,
            CityLayout.PlotSizeMetres);
    }

    /// <summary>Per-plot arrays, row-major (<c>index = pz·gridW + px</c>); see <see cref="LayoutPlotsDto"/>.</summary>
    private static LayoutPlotsDto EncodePlots(CityLayout layout)
    {
        var n = layout.PlotCount;
        var kinds = new char[n];
        var roads = new char[n];
        var districts = new char[n];
        var slopes = layout.HasTerrain ? new char[n] : null;
        var land = new decimal[n];
        var traffic = new double[n];
        for (var i = 0; i < n; i++)
        {
            kinds[i] = LandWire.KindCode(layout.Kinds[i], layout.WaterKinds[i]);
            roads[i] = LandWire.RoadCode(layout.RoadClasses[i]);
            districts[i] = LandWire.DistrictCode(layout.Districts[i]);
            if (slopes is not null) slopes[i] = (char)('0' + layout.SlopeClasses[i]);
            land[i] = layout.LandValues[i];
            traffic[i] = layout.TrafficValues[i];
        }
        return new LayoutPlotsDto(new string(kinds), new string(roads), new string(districts), land, traffic,
            slopes is null ? null : new string(slopes));
    }
}

/// <summary>Args for <c>cityLayout</c> (bridge-spec §8.1, plus an optional preview seed honoured only without a game).</summary>
public sealed record CityLayoutArgs(string CityId, int? Seed = null);

/// <summary>
/// The plan of one city (bridge-spec §8.1 field names; the fields after
/// <paramref name="Ambient"/> are the art-rendering §5.3 requests and E3a additions,
/// listed in docs/overhaul/status/e3a-citygen.md).
/// </summary>
/// <param name="CityId">City id.</param>
/// <param name="LayoutRev">Layout revision (1 while generated; bumps with land sales and construction in Wave 2).</param>
/// <param name="GridW">Grid width in plots.</param>
/// <param name="GridH">Grid height in plots.</param>
/// <param name="Roads">Straight road segments (overlapping at intersections).</param>
/// <param name="Parcels">Every parcel, ordered by id.</param>
/// <param name="Water">Water as rectangles with kind and shore.</param>
/// <param name="Ambient">Ambient development, one entry per developed parcel.</param>
/// <param name="Seed">Generation seed (art §5.3 request 4).</param>
/// <param name="Climate"><c>temperate|warm|cold|arid</c> (art §5.3 request 4).</param>
/// <param name="Terrain">Corner heights for hilly cities (art §5.3 request 1); omitted when flat.</param>
/// <param name="Plots">Per-plot arrays (kind, road class, district, land value, traffic, slope).</param>
/// <param name="Landmarks">City hall, exchange, banks, port, campus, stadium, hospitals, central park.</param>
/// <param name="Deposits">Natural-resource deposits (offshore ones are visual only).</param>
/// <param name="Cbd">CBD centre in plot space (plot centres sit at +0.5).</param>
/// <param name="UrbanRadius">Urban radius R_u in plots.</param>
/// <param name="MedianTraffic">Median urban traffic (econ location factor <c>L = clamp(T / median, 0.3, 2.5)</c>).</param>
/// <param name="GeneratorVersion">Generator algorithm version.</param>
/// <param name="Profile">Identity profile key (the city id, or <c>generic</c>).</param>
/// <param name="PlotSize">Plot edge in metres (24).</param>
public sealed record CityLayoutDto(
    string CityId,
    int LayoutRev,
    int GridW,
    int GridH,
    IReadOnlyList<RoadDto> Roads,
    IReadOnlyList<ParcelDto> Parcels,
    IReadOnlyList<WaterRectDto> Water,
    IReadOnlyList<AmbientDto> Ambient,
    int Seed,
    string Climate,
    LayoutTerrainDto? Terrain,
    LayoutPlotsDto Plots,
    IReadOnlyList<LayoutLandmarkDto> Landmarks,
    IReadOnlyList<LayoutDepositDto> Deposits,
    LayoutPointDto Cbd,
    double UrbanRadius,
    double MedianTraffic,
    int GeneratorVersion,
    string Profile,
    double PlotSize);

/// <summary>A straight road segment (bridge-spec §8.1).</summary>
/// <param name="Id">1-based id.</param>
/// <param name="Kind"><c>highway|arterial|street</c>.</param>
/// <param name="Path">Every plot of the segment, from the west or north end.</param>
/// <param name="Lanes">Carriageway lanes (street 2, arterial 4, highway 4–6).</param>
/// <param name="RoadClass">E3a: <c>local|collector|arterial|highway</c> (<c>street</c> splits into local and collector).</param>
/// <param name="Bridge">E3a: true when the segment crosses water; omitted otherwise.</param>
public sealed record RoadDto(int Id, string Kind, IReadOnlyList<LayoutPlotDto> Path, int Lanes, string RoadClass, bool? Bridge);

/// <summary>A rectangular lot (bridge-spec §8.1, plus E3a extensions after <paramref name="Traffic"/>).</summary>
/// <param name="Id">1-based id (row-major order of the north-west corner).</param>
/// <param name="Px">North-west plot x.</param>
/// <param name="Pz">North-west plot z.</param>
/// <param name="W">Width in plots.</param>
/// <param name="H">Height in plots.</param>
/// <param name="Zone"><c>residential|commercial|industrial|agricultural|port|park|civic</c>.</param>
/// <param name="LandValuePerPlot">Mean land value per plot, whole dollars.</param>
/// <param name="OwnerId">Owning company (land market, Wave 2); omitted while unowned.</param>
/// <param name="BuildingId">Company building on the parcel (Wave 2); omitted while none.</param>
/// <param name="ForSale">Listed on the land market.</param>
/// <param name="AskingPrice">Asking price when listed, whole dollars.</param>
/// <param name="Traffic">Mean customer-traffic index, 0–100.</param>
/// <param name="District">E3a: <c>cbd|commercial|mixed|apartments|houses|industrial|port|rural|park|civic</c>.</param>
/// <param name="Facing">E3a: street-facing side, art §3.2 order (0 S, 1 E, 2 N, 3 W); seaport land faces the water.</param>
/// <param name="Frontage">E3a: best adjacent road class (<c>local|collector|arterial|highway</c>).</param>
/// <param name="Vacant">E3a: no ambient structure stands on it (building needs no buy-out).</param>
/// <param name="DepositId">E3a: the deposit under the parcel.</param>
/// <param name="Landmark">E3a: the landmark on the parcel (<c>cityHall</c>, <c>stockExchange</c>, …).</param>
public sealed record ParcelDto(
    int Id,
    int Px,
    int Pz,
    int W,
    int H,
    string Zone,
    decimal LandValuePerPlot,
    int? OwnerId,
    int? BuildingId,
    bool ForSale,
    decimal? AskingPrice,
    double Traffic,
    string District,
    int Facing,
    string? Frontage,
    bool Vacant,
    int? DepositId,
    string? Landmark);

/// <summary>A rectangle of water (bridge-spec §8.1; <paramref name="Kind"/> and <paramref name="Shore"/> are art §5.3 request 2).</summary>
/// <param name="Px">North-west plot x.</param>
/// <param name="Pz">North-west plot z.</param>
/// <param name="W">Width in plots.</param>
/// <param name="H">Height in plots.</param>
/// <param name="Kind"><c>sea|river|lake</c>.</param>
/// <param name="Shore"><c>beach|quay</c>; omitted for open water and natural banks.</param>
public sealed record WaterRectDto(int Px, int Pz, int W, int H, string? Kind = null, string? Shore = null);

/// <summary>Ambient (non-company) development on a parcel (bridge-spec §8.1; kinds extended per art §5.3 request 3).</summary>
/// <param name="ParcelId">The parcel.</param>
/// <param name="Kind">
/// <c>house|rowhouse|villa|apartment|midrise|office|strip_mall|shop|park|plaza|parking|field|forest|orchard|vineyard|pasture|scrub</c>,
/// <c>civic:&lt;hall|exchange|bank|school|hospital|police|fire|university|stadium|church|port&gt;</c>,
/// <c>deposit:&lt;iron|oil&gt;</c>, and the E3a industrial kinds <c>factory|warehouse|tank_farm</c>.
/// </param>
/// <param name="Floors">Storeys above ground (0 for land covers).</param>
/// <param name="Variant">Seeded variant 0–7.</param>
public sealed record AmbientDto(int ParcelId, string Kind, int Floors, int Variant);

/// <summary>A plot reference on the wire: the shape of bridge-spec <c>PlotRefDto</c> without the rotation.</summary>
/// <param name="Px">Plot x.</param>
/// <param name="Pz">Plot z.</param>
public sealed record LayoutPlotDto(int Px, int Pz);

/// <summary>
/// Per-plot data, row-major (<c>index = pz·gridW + px</c>). Strings carry one
/// character per plot:
/// <c>kinds</c> — <c>p</c> parcel, <c>r</c> road, <c>b</c> bridge, <c>s</c> sea, <c>v</c> river, <c>l</c> lake, <c>h</c> beach, <c>o</c> open land;
/// <c>roads</c> — <c>0</c> none, <c>1</c> local, <c>2</c> collector, <c>3</c> arterial, <c>4</c> highway;
/// <c>districts</c> — <c>.</c> none, <c>C</c> CBD, <c>c</c> commercial, <c>m</c> mixed, <c>a</c> apartments, <c>h</c> houses,
/// <c>i</c> industrial, <c>p</c> port, <c>g</c> rural, <c>k</c> park, <c>v</c> civic;
/// <c>slopes</c> — slope class <c>0</c>–<c>3</c> (hilly cities only).
/// </summary>
/// <param name="Kinds">Plot kinds.</param>
/// <param name="Roads">Road classes.</param>
/// <param name="Districts">Districts.</param>
/// <param name="LandValue">Land value per plot, whole dollars (0 on roads, water and beaches).</param>
/// <param name="Traffic">Customer-traffic index per plot, 0–100 (roads included).</param>
/// <param name="Slopes">Slope classes; omitted when the city is flat.</param>
public sealed record LayoutPlotsDto(
    string Kinds,
    string Roads,
    string Districts,
    IReadOnlyList<decimal> LandValue,
    IReadOnlyList<double> Traffic,
    string? Slopes);

/// <summary>Terrain corner heights in metres, (gridW+1)·(gridH+1) row-major by corner row (art §5.3 request 1).</summary>
/// <param name="Heights">Heights, 0.1 m resolution; water surface at 0 m.</param>
public sealed record LayoutTerrainDto(IReadOnlyList<float> Heights);

/// <summary>A named landmark.</summary>
/// <param name="Kind"><c>cityHall|stockExchange|bank|investmentBank|port|university|stadium|hospital|centralPark</c>.</param>
/// <param name="ParcelId">Its parcel.</param>
/// <param name="Px">North-west plot x.</param>
/// <param name="Pz">North-west plot z.</param>
/// <param name="W">Width in plots.</param>
/// <param name="H">Height in plots.</param>
public sealed record LayoutLandmarkDto(string Kind, int ParcelId, int Px, int Pz, int W, int H);

/// <summary>A natural-resource deposit.</summary>
/// <param name="Id">1-based id.</param>
/// <param name="Resource"><c>iron|oil</c>.</param>
/// <param name="Px">North-west plot x.</param>
/// <param name="Pz">North-west plot z.</param>
/// <param name="W">Width in plots.</param>
/// <param name="H">Height in plots.</param>
/// <param name="Quality">Quality 35–85.</param>
/// <param name="Reserve">Recoverable reserve (tonnes of ore or barrels of crude).</param>
/// <param name="Offshore">True for offshore fields (visual only: rigs on the sea).</param>
public sealed record LayoutDepositDto(int Id, string Resource, int Px, int Pz, int W, int H, int Quality, double Reserve, bool Offshore);

/// <summary>A point in plot space.</summary>
/// <param name="X">Plot-space x (plot centres at +0.5).</param>
/// <param name="Z">Plot-space z.</param>
public sealed record LayoutPointDto(double X, double Z);
