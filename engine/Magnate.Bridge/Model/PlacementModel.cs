using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>Placement sources (TS <c>PlacementDto.source</c>).</summary>
internal static class PlacementSources
{
    public const string Auto = "auto";
    public const string Bridge = "bridge";
    public const string Engine = "engine";

    /// <summary>Not on the map: an order still waiting for a site (land rules).</summary>
    public const string None = "none";
}

/// <summary>
/// Where every building stands, as all views share it.
/// <list type="bullet">
///   <item><b>Engine placements</b> (<c>source: "engine"</c>): under land rules
///         (<c>features.plots</c>) the engine owns the site of every building
///         (<see cref="BuildingInstance.Placement"/>, persisted in the engine save). Orders still
///         waiting for a site have none (<c>source: "none"</c>; they are not drawn).</item>
///   <item><b>Interim placements</b> (bridge-spec §4.6.10), for worlds without land rules (Classic
///         games, legacy saves) and any building the engine has not sited: a stable plot on a
///         simple per-city grid (every 6th row and column is a reserved road line). Player
///         placements are validated for bounds, roads and overlap (<c>source: "bridge"</c>);
///         everything else is auto-sited deterministically in building-id order on a spiral from
///         a category ring (<c>source: "auto"</c>). Persisted in the save sidecar.</item>
/// </list>
/// It also turns construction progress into bridge events between calls
/// (<see cref="DrainEvents"/>).
/// </summary>
internal sealed class PlacementModel
{
    /// <summary>Road line spacing in plots (interim grid).</summary>
    public const int RoadEvery = 6;

    /// <summary>Retired-building count at the last prune (see <see cref="EnsureAll"/>).</summary>
    private int _retiredSeen;

    /// <summary>Golden-angle step that spreads consecutive buildings around the ring.</summary>
    private const double GoldenAngleDegrees = 137.508;

    private readonly ContentCatalog _catalog;
    private readonly Dictionary<int, PlacementDto> _byBuilding = new();
    private readonly Dictionary<int, string> _cityOf = new();
    private readonly Dictionary<string, Occupancy> _grids = new(StringComparer.Ordinal);

    // Construction progress seen at the last EnsureAll: building id → (awaiting site, under construction).
    private readonly Dictionary<int, (bool Awaiting, bool Building)> _construction = new();
    private readonly List<GameEventDto> _pendingEvents = new();
    private World? _world;

    public PlacementModel(ContentCatalog catalog)
    {
        _catalog = catalog;
    }

    /// <summary>
    /// The placement of a building: the engine's site when it has one, else the interim
    /// placement; <c>source: "none"</c> for a land-rules order still waiting for a site; null for
    /// an unknown building.
    /// </summary>
    public PlacementDto? Get(int buildingId)
    {
        if (_world is { } world && world.Buildings.TryGetValue(new BuildingInstanceId(buildingId), out var b))
        {
            if (b.Placement is PlotRef at) return new PlacementDto(at.Px, at.Pz, at.Rotation, PlacementSources.Engine);
            if (world.Rules.Land.Enabled && b.Construction is { AwaitingSite: true }) return Unplaced;
        }
        return _byBuilding.TryGetValue(buildingId, out var p) ? p : null;
    }

    /// <summary>The placement reported for a building that is not on the map.</summary>
    public static PlacementDto Unplaced { get; } = new(0, 0, 0, PlacementSources.None);

    /// <summary>True when the building has a place on the map (anything but <c>source: "none"</c>).</summary>
    public bool IsOnMap(int buildingId) => Get(buildingId) is { Source: not PlacementSources.None };

    /// <summary>Interim placements recorded (engine placements are not counted).</summary>
    public int Count => _byBuilding.Count;

    /// <summary>Footprint after rotation (90/270 swap width and height).</summary>
    public static (int W, int H) Rotated(Footprint footprint, int rotation)
        => rotation is 90 or 270 ? (footprint.Height, footprint.Width) : (footprint.Width, footprint.Height);

    /// <summary>True for a reserved road line of the interim grid.</summary>
    public static bool IsRoad(int px, int pz) => px % RoadEvery == 0 || pz % RoadEvery == 0;

    /// <summary>
    /// Why the interim grid cannot take the footprint at the plot (<c>outOfBounds</c> | <c>road</c> |
    /// <c>occupied</c>), or null when it can. Worlds with land rules validate through the engine.
    /// </summary>
    public string? Issue(City city, Footprint footprint, PlotRefDto at)
    {
        var (w, h) = Rotated(footprint, at.Rotation);
        if (at.Px < 0 || at.Pz < 0 || at.Px + w > city.Grid.Width || at.Pz + h > city.Grid.Height) return "outOfBounds";
        var grid = GridFor(city);
        // Footprints that fit a 5×5 block must stay off road lines; larger ones may span them.
        var respectRoads = w < RoadEvery && h < RoadEvery;
        for (var x = at.Px; x < at.Px + w; x++)
        {
            for (var z = at.Pz; z < at.Pz + h; z++)
            {
                if (respectRoads && IsRoad(x, z)) return "road";
                if (grid.Taken(x, z)) return "occupied";
            }
        }
        return null;
    }

    /// <summary>Throw <c>invalid_argument</c> unless the rotation is 0, 90, 180 or 270.</summary>
    public static void ValidateRotation(PlotRefDto at, string field)
    {
        if (at.Rotation is not (0 or 90 or 180 or 270))
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, "Rotation must be 0, 90, 180 or 270 degrees.", field + ".rotation");
        }
    }

    /// <summary>Throw <c>plot_out_of_bounds</c> / <c>plot_occupied</c> when the interim grid cannot take the plot.</summary>
    public void Require(City city, Footprint footprint, PlotRefDto at, string field)
    {
        ValidateRotation(at, field);
        switch (Issue(city, footprint, at))
        {
            case null:
                return;
            case "outOfBounds":
                throw new BridgeException(BridgeErrorCodes.PlotOutOfBounds,
                    "That plot is outside the city.", field + ".px", new ErrorDetailsDto(Reason: "outOfBounds"));
            case "road":
                throw new BridgeException(BridgeErrorCodes.PlotOccupied,
                    "That plot is on a road.", field + ".px", new ErrorDetailsDto(Reason: "road"));
            default:
                throw new BridgeException(BridgeErrorCodes.PlotOccupied,
                    "That plot is already taken.", field + ".px", new ErrorDetailsDto(Reason: "occupied"));
        }
    }

    /// <summary>Record a player-chosen interim plot (already validated).</summary>
    public PlacementDto Place(int buildingId, City city, Footprint footprint, PlotRefDto at)
    {
        var placement = new PlacementDto(at.Px, at.Pz, at.Rotation, PlacementSources.Bridge);
        Record(buildingId, city.Id.Value, footprint, placement);
        return placement;
    }

    /// <summary>
    /// Bring the model up to date with the world (called after every mutation and every month):
    /// give interim placements to buildings the engine does not place, and note construction
    /// progress for <see cref="DrainEvents"/>. Buildings that left the world (sold, demolished or
    /// liquidated — E2 finance) lose their interim placement, which frees their plots.
    /// </summary>
    public void EnsureAll(World world)
    {
        _world = world;
        if (world.RetiredBuildings.Count != _retiredSeen)
        {
            _retiredSeen = world.RetiredBuildings.Count;
            // Rebuild the interim grid without the retired buildings, keeping the construction
            // tracking and any events not yet drained (Restore resets both, as a load must).
            var pending = _pendingEvents.ToList();
            var tracked = _construction.ToList();
            Restore(world, Save());
            _pendingEvents.AddRange(pending);
            foreach (var (id, state) in tracked)
            {
                if (world.Buildings.ContainsKey(new BuildingInstanceId(id))) _construction[id] = state;
            }
        }
        TrackConstruction(world);
        var landRules = world.Rules.Land.Enabled;
        if (!landRules && _byBuilding.Count == world.Buildings.Count) return;
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (_byBuilding.ContainsKey(b.Id.Value)) continue;
            // Under land rules the engine places buildings (and retired ones are off the map);
            // the interim grid only serves Classic worlds.
            if (landRules) continue;
            var type = world.Catalog.BuildingType(b.TypeId);
            var city = world.Catalog.City(b.City);
            var spot = Suggest(city, type, b.Id.Value) ?? Fallback(city, type);
            Record(b.Id.Value, city.Id.Value, type.Footprint, spot);
        }
    }

    /// <summary>
    /// Construction events noticed since the last drain, oldest first: <c>constructionStarted</c>
    /// when an order waiting for a site got one, <c>constructionCompleted</c> when a building
    /// finished. (The player's own <c>construct</c> reports <c>constructionStarted</c> itself.)
    /// </summary>
    /// <remarks>The player's own events are toast-worthy (<c>success</c>, priority 2 for a completion); rivals' go to the feed.</remarks>
    public IReadOnlyList<GameEventDto> DrainEvents(CompanyId player)
    {
        if (_pendingEvents.Count == 0) return Array.Empty<GameEventDto>();
        var events = new List<GameEventDto>(_pendingEvents.Count);
        foreach (var e in _pendingEvents)
        {
            var mine = e.CompanyId == player.Value;
            var completed = e.Kind == GameSession.LandEventKinds.ConstructionCompleted;
            events.Add(e with
            {
                IsPlayer = mine,
                Severity = mine ? "success" : "info",
                Priority = mine && completed ? 2 : 1,
            });
        }
        _pendingEvents.Clear();
        return events;
    }

    /// <summary>The plot interim auto-siting would pick for a building of <paramref name="type"/> (not reserved).</summary>
    public PlacementDto? Suggest(City city, BuildingType type, int seedId)
    {
        var grid = GridFor(city);
        var (w, h) = (type.Footprint.Width, type.Footprint.Height);
        if (w > city.Grid.Width || h > city.Grid.Height) return null;
        var (r0, r1, southBand) = Ring(type, city);
        var half = Math.Max(city.Grid.Width, city.Grid.Height) / 2.0;
        var cx0 = city.Grid.Width / 2.0;
        var cz0 = city.Grid.Height / 2.0;
        var theta0 = ((seedId * GoldenAngleDegrees) % 360.0) * Math.PI / 180.0;
        var ringStep = RoadEvery / half; // one block, as a fraction of the half-grid
        var respectRoads = w < RoadEvery && h < RoadEvery;

        (double Band, double Ring, double Angle, int Pz, int Px) best = (double.MaxValue, 0, 0, 0, 0);
        PlacementDto? bestSpot = null;
        for (var pz = 0; pz + h <= city.Grid.Height; pz++)
        {
            for (var px = 0; px + w <= city.Grid.Width; px++)
            {
                if (respectRoads && (!FitsBlock(px, w) || !FitsBlock(pz, h))) continue;
                var cx = px + w / 2.0;
                var cz = pz + h / 2.0;
                var f = Math.Max(Math.Abs(cx - cx0), Math.Abs(cz - cz0)) / half;
                double band;
                double ring;
                if (southBand)
                {
                    band = pz + h >= city.Grid.Height - RoadEvery ? 0 : 1 + (city.Grid.Height - (pz + h)) / (double)RoadEvery;
                    ring = Math.Abs(cx - cx0) / half;
                }
                else if (f >= r0 && f < r1)
                {
                    band = 0;
                    ring = Math.Floor((f - r0) / ringStep);
                }
                else
                {
                    band = 1 + (f < r0 ? r0 - f : f - r1);
                    ring = 0;
                }
                var angle = Math.Atan2(cz - cz0, cx - cx0);
                var delta = (angle - theta0) % (2 * Math.PI);
                if (delta < 0) delta += 2 * Math.PI;
                var key = (band, ring, delta, pz, px);
                if (key.CompareTo(best) >= 0) continue;
                if (!Free(grid, px, pz, w, h)) continue;
                best = key;
                bestSpot = new PlacementDto(px, pz, 0, PlacementSources.Auto);
            }
        }
        return bestSpot;
    }

    /// <summary>Restore persisted interim placements (unknown buildings ignored, overlaps tolerated).</summary>
    public void Restore(World world, IReadOnlyDictionary<string, PlacementDto>? placements)
    {
        _byBuilding.Clear();
        _cityOf.Clear();
        _grids.Clear();
        _construction.Clear();
        _pendingEvents.Clear();
        _world = world;
        if (placements is not null)
        {
            foreach (var (key, placement) in placements.OrderBy(kv => int.TryParse(kv.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) ? id : int.MaxValue))
            {
                if (!int.TryParse(key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)) continue;
                if (!world.Buildings.TryGetValue(new BuildingInstanceId(id), out var b)) continue;
                // Engine-placed buildings (land rules) never use the interim map.
                if (b.Placement is not null) continue;
                Record(id, b.City.Value, world.Catalog.BuildingType(b.TypeId).Footprint, placement);
            }
        }
        // A load is not news: start tracking from the restored state.
        TrackConstruction(world, silent: true);
    }

    /// <summary>Persisted form: building id (string) → interim placement, in id order.</summary>
    public Dictionary<string, PlacementDto> Save()
        => _byBuilding.OrderBy(kv => kv.Key)
            .ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => kv.Value, StringComparer.Ordinal);

    // ------------------------------------------------------------------ internals

    private void TrackConstruction(World world, bool silent = false)
    {
        if (!world.Rules.Land.Enabled) return;
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            var now = (Awaiting: b.Construction is { AwaitingSite: true }, Building: b.Construction is not null);
            var known = _construction.TryGetValue(b.Id.Value, out var before);
            _construction[b.Id.Value] = now;
            // New buildings are announced by their command (construct) or the event detector
            // (rival construction); only transitions of buildings seen before are news here.
            if (silent || !known || b.IsRetired) continue;
            var type = world.Catalog.BuildingType(b.TypeId);
            var city = world.Catalog.City(b.City);
            var owner = b.Owner.Value;
            var company = world.Companies.TryGetValue(b.Owner, out var c) ? c.Name : $"Company {owner}";
            if (before.Awaiting && !now.Awaiting && b.Placement is PlotRef at)
            {
                _pendingEvents.Add(new GameEventDto(GameSession.LandEventKinds.ConstructionStarted, "info",
                    $"{company} broke ground on a {type.Name} in {city.Name}.",
                    BuildingId: b.Id.Value, CompanyId: owner, TypeId: type.Id.Value, CityId: city.Id.Value,
                    Amount: world.GetLandCost(b.Id) + world.GetConstructionInProgress(b.Id), Placement: new PlacementDto(at.Px, at.Pz, at.Rotation, PlacementSources.Engine),
                    Months: b.Construction?.MonthsRemaining, Priority: 1));
            }
            if (before.Building && !now.Building && b.Placement is PlotRef done)
            {
                _pendingEvents.Add(new GameEventDto(GameSession.LandEventKinds.ConstructionCompleted, "info",
                    $"{company} opened a {type.Name} in {city.Name}.",
                    BuildingId: b.Id.Value, CompanyId: owner, TypeId: type.Id.Value, CityId: city.Id.Value,
                    Amount: b.CapitalizedCost, Placement: new PlacementDto(done.Px, done.Pz, done.Rotation, PlacementSources.Engine),
                    Reason: SlotRulesConfigured(b) ? null : "unconfigured", Priority: 1));
            }
        }
    }

    private static bool SlotRulesConfigured(BuildingInstance b)
        => b.ProductionSlots.Count + b.ExtractionSlots.Count + b.WarehouseSlots.Count + b.RetailSlots.Count + b.ResearchSlots.Count > 0;

    private void Record(int buildingId, string cityId, Footprint footprint, PlacementDto placement)
    {
        _byBuilding[buildingId] = placement;
        _cityOf[buildingId] = cityId;
        if (!_catalog.Cities.TryGetValue(new CityId(cityId), out var city)) return;
        var (w, h) = Rotated(footprint, placement.Rotation);
        GridFor(city).Mark(placement.Px, placement.Pz, w, h);
    }

    private static PlacementDto Fallback(City city, BuildingType type)
    {
        // The city is full: stack on the centre-most legal-shaped spot. Visible overlap is better than no
        // placement; the engine's plots (land rules) replace this grid in real games.
        var px = Math.Max(0, Math.Min(city.Grid.Width - type.Footprint.Width, city.Grid.Width / 2));
        var pz = Math.Max(0, Math.Min(city.Grid.Height - type.Footprint.Height, city.Grid.Height / 2));
        return new PlacementDto(px, pz, 0, PlacementSources.Auto);
    }

    private static bool FitsBlock(int start, int size)
    {
        var offset = start % RoadEvery;
        return offset != 0 && offset + size - 1 < RoadEvery;
    }

    private static bool Free(Occupancy grid, int px, int pz, int w, int h)
    {
        for (var z = pz; z < pz + h; z++)
        {
            for (var x = px; x < px + w; x++)
            {
                if (grid.Taken(x, z)) return false;
            }
        }
        return true;
    }

    private static (double R0, double R1, bool SouthBand) Ring(BuildingType type, City city)
    {
        var category = type.Category;
        if (category == "seaport" && city.Geography.Coastal) return (0, 1, true);
        if (type.Retail || category is "media" or "rd_center") return (0, 0.45, false);
        if (category is "farm" or "plantation" or "mine" or "oil_well") return (0.6, 1.0001, false);
        return (0.35, 0.8, false);
    }

    private Occupancy GridFor(City city)
    {
        if (!_grids.TryGetValue(city.Id.Value, out var grid))
        {
            grid = new Occupancy(city.Grid.Width, city.Grid.Height);
            _grids[city.Id.Value] = grid;
        }
        return grid;
    }

    private sealed class Occupancy
    {
        private readonly int _w;
        private readonly int _h;
        private readonly bool[] _cells;

        public Occupancy(int w, int h)
        {
            _w = Math.Max(1, w);
            _h = Math.Max(1, h);
            _cells = new bool[_w * _h];
        }

        public bool Taken(int x, int z) => x >= 0 && z >= 0 && x < _w && z < _h && _cells[z * _w + x];

        public void Mark(int px, int pz, int w, int h)
        {
            for (var z = Math.Max(0, pz); z < Math.Min(_h, pz + h); z++)
            {
                for (var x = Math.Max(0, px); x < Math.Min(_w, px + w); x++) _cells[z * _w + x] = true;
            }
        }
    }
}
