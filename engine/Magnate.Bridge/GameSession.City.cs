using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// The 3D scene's data (bridge-spec §5.5): city view with visual deltas, world map,
// supply flows for trucks and arcs, and the build-ghost preview.
public sealed partial class GameSession
{
    /// <summary>Land and construction event kinds (TS <c>GameEventKind</c>, bridge-spec §8.2–8.3).</summary>
    internal static class LandEventKinds
    {
        public const string ConstructionStarted = "constructionStarted";
        public const string ConstructionCompleted = "constructionCompleted";
        public const string LandPurchased = "landPurchased";
        public const string BuildingDemolished = "buildingDemolished";
    }

    /// <summary>
    /// Renderer state for one city. Pass the <c>revision</c> of the view you hold as
    /// <c>since</c> to receive only buildings whose <c>visualRev</c> changed (plus
    /// <c>removedIds</c>); otherwise the full list. <c>activity</c> is always full.
    /// </summary>
    [BridgeMethod("cityView")]
    public CityViewDto CityView(CityViewArgs args) => BuildCityView(Game, args.CityId, args.Since);

    /// <summary>Every city at a glance: geography, owners, the player's realised share, top demand.</summary>
    [BridgeMethod("worldMap")]
    public WorldMapDto WorldMap()
    {
        var game = Game;
        var world = game.World;
        var now = game.Now;
        var cities = new List<CityOverviewDto>();
        foreach (var city in world.Catalog.Cities.Values.OrderByDescending(c => c.Population).ThenBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            var here = world.Buildings.Values.Where(b => b.City == city.Id && !b.IsRetired).ToList();
            var byOwner = here.GroupBy(b => b.Owner.Value).OrderBy(g => g.Key).Select(g => new OwnerCountDto(g.Key, g.Count())).ToList();
            var playerProducts = here.Where(b => b.Owner == game.Player)
                .SelectMany(b => b.RetailSlots.Select(s => s.Product.Value))
                .Where(p => world.Catalog.Product(new ProductId(p)).Tier == ProductTier.Finished)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var avgShare = playerProducts.Count == 0
                ? 0.0
                : playerProducts.Average(p => game.Index.RealisedShare(city.Id.Value, p, game.Player.Value, now, now) ?? 0.0);
            var topDemand = game.Rules.OrderedProducts
                .Where(p => p.Tier == ProductTier.Finished)
                .Select(p => new ProductQtyDto(p.Id.Value, Math.Round(MarketModel.PotentialDemand(city, p), 3)))
                .OrderByDescending(p => p.Quantity)
                .ThenBy(p => p.ProductId, StringComparer.Ordinal)
                .Take(8)
                .ToList();
            cities.Add(new CityOverviewDto(
                city.Id.Value,
                city.Name,
                city.Population,
                city.Demographics.ToDictionary(kv => MarketModel.BracketId(kv.Key), kv => kv.Value),
                new GeographyDto(city.Geography.Coastal, city.Geography.Arable, city.Geography.MineralRich, city.Geography.OilRich),
                city.Grid.Width,
                city.Grid.Height,
                city.BaseLandPrice,
                byOwner,
                here.Count(b => b.Owner == game.Player),
                here.Count,
                Math.Round(avgShare, 6),
                topDemand));
        }
        return new WorldMapDto(cities);
    }

    /// <summary>
    /// Goods movements of the last closed month: own-building transfers (exact
    /// quantities), world-market imports (amounts), exports and retail sales
    /// (amounts and exact units). Filter by city or by building.
    /// </summary>
    [BridgeMethod("supplyFlows")]
    public SupplyFlowsDto SupplyFlows(SupplyFlowsArgs args)
    {
        var game = Game;
        var world = game.World;
        if (args.CityId is { } cityId) Guard.City(Catalog, cityId);
        if (args.BuildingId is { } bid) Guard.Building(world, bid);
        var now = game.Now;
        var flows = new List<FlowDto>();

        string? CityOf(int id) => world.Buildings.TryGetValue(new BuildingInstanceId(id), out var b) ? b.City.Value : null;
        bool Keep(int? from, int? to, string? fromCity, string? toCity)
        {
            if (args.BuildingId is { } only && from != only && to != only) return false;
            if (args.CityId is { } c && fromCity != c && toCity != c) return false;
            return true;
        }

        // Transfers: aggregate (from, to, product) over the month's slice of the transfer log.
        var transfers = new SortedDictionary<(int From, int To, string Product), double>(OrdinalComparers.IdIdThenName);
        var (tStart, tEnd) = game.Index.TransferMonth(now);
        var log = world.TransferLog.Entries;
        for (var i = tStart; i < tEnd && i < log.Count; i++)
        {
            var t = log[i];
            if (t.Date.AsMonthIndex() != now) continue;
            var key = (t.From.Value, t.To.Value, t.Product.Value);
            transfers[key] = transfers.GetValueOrDefault(key) + t.Quantity;
        }
        foreach (var ((from, to, product), qty) in transfers)
        {
            var fromCity = CityOf(from);
            var toCity = CityOf(to);
            if (Keep(from, to, fromCity, toCity)) flows.Add(new FlowDto("transfer", product, from, to, fromCity, toCity, qty, null));
        }

        foreach (var ((building, product), bp) in game.Index.BuildingProducts(now)
                     .OrderBy(kv => kv.Key.B).ThenBy(kv => kv.Key.P, StringComparer.Ordinal))
        {
            var city = CityOf(building);
            if (bp.Purchases > 0m && Keep(null, building, null, city))
            {
                flows.Add(new FlowDto("import", product, null, building, null, city, null, bp.Purchases));
            }
            if (bp.ExportRev > 0m && Keep(building, null, city, null))
            {
                flows.Add(new FlowDto("export", product, building, null, city, null, bp.ExportQty, bp.ExportRev));
            }
            if (bp.SaleRev > 0m && Keep(building, null, city, city))
            {
                flows.Add(new FlowDto("retail", product, building, null, city, city, bp.SaleQty, bp.SaleRev));
            }
        }
        return new SupplyFlowsDto(Months.Dto(now), flows);
    }

    /// <summary>
    /// What building <c>typeId</c> in <c>cityId</c> (optionally at a plot) would cost and
    /// whether it is allowed: a pure query, cheap enough for a ghost following the cursor.
    /// </summary>
    [BridgeMethod("previewBuild")]
    public BuildPreviewDto PreviewBuild(PreviewBuildArgs args)
    {
        var game = Game;
        var world = game.World;
        var type = Guard.BuildingType(Catalog, args.TypeId);
        var city = Guard.City(Catalog, args.CityId);
        if (args.At is { } requested) PlacementModel.ValidateRotation(requested, "at");
        if (LandRulesOn(game)) return PreviewOnLand(game, type, city, args.At);

        var cash = world.Companies[game.Player].Cash;
        var cost = type.ConstructionCost;
        var opex = InitialOpex(type);
        var issues = GeographyIssues(world, type, city);

        string? placementIssue = null;
        if (args.At is { } at) placementIssue = game.Placement.Issue(city, type.Footprint, at);
        var nextId = world.Buildings.Count == 0 ? 1 : world.Buildings.Keys.Max(k => k.Value) + 1;
        var suggested = game.Placement.Suggest(city, type, nextId);

        return new BuildPreviewDto(
            TypeId: type.Id.Value,
            CityId: city.Id.Value,
            ConstructionCost: cost,
            LandCost: null,
            TotalCost: cost,
            MonthlyOpex: opex,
            Capacity: SlotRules.InitialCapacity(type),
            Affordable: cost <= cash,
            Shortfall: Math.Max(0m, cost - cash),
            CashAfter: cash - cost,
            RunwayMonthsAfter: RunwayAfter(game, cash - cost, opex),
            GeographyOk: issues.Count == 0,
            GeographyIssues: issues,
            EligibleProductIds: game.Rules.Eligible(type.Id),
            FootprintW: type.Footprint.Width,
            FootprintH: type.Footprint.Height,
            PlacementOk: args.At is null ? suggested is not null : placementIssue is null,
            PlacementIssue: placementIssue,
            SuggestedPlacement: suggested);
    }

    /// <summary>
    /// <c>previewBuild</c> under engine land rules (E3b): the engine validates and prices the
    /// site — zoning, frontage, coast, deposits, slope, occupancy and land titles — and quotes
    /// the land (plus any buy-out of ambient buildings), the construction schedule and the
    /// catchment. Without <c>at</c> it previews the site <c>construct</c> would auto-pick
    /// (the best affordable one, else the cheapest valid one); with <c>at</c> it skips that
    /// city-wide search, so a ghost can call it at 10 Hz.
    /// </summary>
    private BuildPreviewDto PreviewOnLand(ActiveGame game, BuildingType type, City city, PlotRefDto? at)
    {
        var world = game.World;
        var player = game.Player;
        var cash = world.Companies[player].Cash;
        var funds = world.AvailableFunds(player);
        var opex = InitialOpex(type);
        var issues = GeographyIssues(world, type, city);
        var schedule = world.GetConstructionSchedule(type.Id);

        ConstructionQuote? quote;
        PlacementDto? suggested = null;
        if (at is { } spot)
        {
            quote = world.QuoteConstruction(player, type.Id, city.Id, new PlotRef(spot.Px, spot.Pz, spot.Rotation));
        }
        else
        {
            quote = issues.Count > 0 ? null : AutoSiteQuote(world, player, type, city);
            if (quote is not null) suggested = EnginePlacement(quote.At);
        }

        var landCost = quote?.SiteCost;
        var total = quote?.TotalCost ?? schedule.ConstructionCost;
        var upfront = quote?.UpfrontCost ?? schedule.Deposit;
        var placementIssues = quote is null ? new List<PlacementIssueDto>() : IssuesOf(quote.Placement);
        if (quote is null && issues.Count == 0)
        {
            placementIssues.Add(new PlacementIssueDto(PlacementIssueNames.NoSite, $"No free site in {city.Name} can take a {type.Name}."));
        }
        var cashAfter = cash - total;

        return new BuildPreviewDto(
            TypeId: type.Id.Value,
            CityId: city.Id.Value,
            ConstructionCost: schedule.ConstructionCost,
            LandCost: landCost,
            TotalCost: total,
            MonthlyOpex: opex,
            Capacity: SlotRules.InitialCapacity(type),
            Affordable: upfront <= funds && world.CanInvest(player),
            Shortfall: Math.Max(0m, upfront - funds),
            CashAfter: cashAfter,
            RunwayMonthsAfter: RunwayAfter(game, cashAfter, opex),
            GeographyOk: issues.Count == 0,
            GeographyIssues: issues,
            EligibleProductIds: game.Rules.Eligible(type.Id),
            FootprintW: type.Footprint.Width,
            FootprintH: type.Footprint.Height,
            PlacementOk: quote?.Ok == true && issues.Count == 0,
            PlacementIssue: placementIssues.Count > 0 ? placementIssues[0].Code : null,
            SuggestedPlacement: suggested,
            ConstructionMonths: schedule.Months,
            Catchment: quote is null ? null : Catchment(game, type, city, quote),
            UpfrontCost: upfront,
            RedevelopmentCost: quote?.RedevelopmentCost,
            Deposit: schedule.Deposit,
            MonthlyInstalment: schedule.Instant ? null : schedule.Instalment,
            OpensAt: Months.Dto(game.Now + schedule.Months),
            PlacementIssues: placementIssues,
            Site: quote is null ? null : SiteOf(quote.Placement));
    }

    /// <summary>The site <c>construct</c> without <c>at</c> takes (best affordable), else the cheapest valid one (to show what is missing).</summary>
    internal static ConstructionQuote? AutoSiteQuote(World world, CompanyId player, BuildingType type, City city)
        => world.ChooseAutoSite(player, type.Id, city.Id)
            ?? world.FindConstructionSites(player, type.Id, city.Id, SitePreference.Cheapest, 1).FirstOrDefault();

    /// <summary>
    /// Demand and competition around a site: <c>score</c> is the econ location factor
    /// (traffic over the city's median, 0.3–2.5); for stores, <c>potentialUnitsPerMonth</c> is
    /// the city's potential demand for the best-selling product the store may carry, scaled
    /// by that factor (an indicator, not a forecast); rivals are other companies' buildings
    /// of the same kind (any store, for a store) within 6 plots of the footprint.
    /// </summary>
    private static CatchmentDto? Catchment(ActiveGame game, BuildingType type, City city, ConstructionQuote quote)
    {
        if (quote.Placement.Site is not { } site) return null;
        const int radius = 6;
        var world = game.World;
        var rect = quote.Placement.Footprint;
        var rivals = 0;
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner == game.Player || b.City != city.Id || b.IsRetired || b.Placement is not PlotRef p) continue;
            var other = world.Catalog.BuildingType(b.TypeId);
            if (type.Retail ? !other.Retail : other.Category != type.Category) continue;
            var r = p.Rect(other.Footprint);
            var gapX = Math.Max(0, Math.Max(r.Px - (rect.Px + rect.W), rect.Px - (r.Px + r.W)));
            var gapZ = Math.Max(0, Math.Max(r.Pz - (rect.Pz + rect.H), rect.Pz - (r.Pz + r.H)));
            if (Math.Max(gapX, gapZ) <= radius) rivals++;
        }

        string? productId = null;
        double potential = 0;
        if (type.Retail)
        {
            foreach (var id in game.Rules.Eligible(type.Id))
            {
                var product = world.Catalog.Product(new ProductId(id));
                if (product.Tier != ProductTier.Finished) continue;
                var demand = MarketModel.PotentialDemand(city, product);
                if (demand > potential)
                {
                    potential = demand;
                    productId = id;
                }
            }
            potential *= site.LocationFactor;
        }
        return new CatchmentDto(Math.Round(site.LocationFactor, 3), Math.Round(potential, 1), rivals, productId, Math.Round(site.Traffic, 1), radius);
    }

    /// <summary>The site summary on the wire (null when the footprint leaves the grid).</summary>
    internal static SiteDto? SiteOf(PlacementResult placement)
    {
        if (placement.Site is not { } s) return null;
        return new SiteDto(
            Math.Round(s.Traffic, 1),
            Math.Round(s.PeakTraffic, 1),
            Math.Round(s.LocationFactor, 3),
            Math.Round(s.DistanceToCbd, 1),
            s.Frontage == RoadClass.None ? null : LandWire.Name(s.Frontage),
            LandWire.Name(s.District),
            s.MaxSlope,
            s.Waterfront,
            s.LandValuePerPlot,
            placement.ParcelIds,
            s.DepositId == 0 ? null : s.DepositId,
            s.DepositId == 0 ? null : s.DepositQuality,
            s.DepositId == 0 ? null : s.DepositReserve);
    }

    /// <summary>Every failed placement rule, most fundamental first.</summary>
    internal static List<PlacementIssueDto> IssuesOf(PlacementResult placement)
        => placement.Issues.Select(i => new PlacementIssueDto(PlacementIssueNames.Of(i.Code), i.Message, i.At?.Px, i.At?.Pz)).ToList();

    /// <summary>An engine site as a placement (<c>source: "engine"</c>).</summary>
    internal static PlacementDto EnginePlacement(PlotRef at) => new(at.Px, at.Pz, at.Rotation, PlacementSources.Engine);

    /// <summary>True when the game runs under engine land rules (plots, land market, construction time).</summary>
    internal static bool LandRulesOn(ActiveGame game) => game.World.Rules.Land.Enabled;

    /// <summary>
    /// Refuse new investment (construction, land) while finance (E2) blocks it: a company in
    /// default or bankrupt. Same error as E2's distressed refusals.
    /// </summary>
    internal static void RequireCanInvest(ActiveGame game)
    {
        if (!game.World.CanInvest(game.Player))
        {
            throw new BridgeException(BridgeErrorCodes.InvalidOperation,
                "Lenders block new borrowing and investment while the company is in default.", null,
                new ErrorDetailsDto(Reason: "distressed"));
        }
    }

    private static decimal InitialOpex(BuildingType type)
        => type.Levels is { Count: > 0 } levels ? levels[0].MonthlyOperatingCost : type.MonthlyOperatingCost;

    private static double? RunwayAfter(ActiveGame game, decimal cashAfter, decimal opex)
    {
        var opCf = AverageOperatingCashFlow(game);
        if (opCf is not decimal avg || avg - opex >= 0m) return null;
        return cashAfter <= 0m ? 0 : Math.Round((double)(cashAfter / (opex - avg)), 2);
    }

    // ------------------------------------------------------------------ helpers

    internal CityViewDto BuildCityView(ActiveGame game, string cityId, long? since)
    {
        var city = Guard.City(Catalog, cityId);
        var world = game.World;
        // Retired buildings (cancelled construction) and orders still waiting for a site are not on the map.
        var buildings = world.Buildings.Values
            .Where(b => b.City == city.Id && !b.IsRetired && game.Placement.IsOnMap(b.Id.Value))
            .OrderBy(b => b.Id.Value)
            .ToList();
        var visuals = buildings.Select(b => Visual(game, b)).ToList();
        var revs = visuals.ToDictionary(v => v.Id, v => v.VisualRev);

        var full = true;
        IReadOnlyList<BuildingVisualDto> list = visuals;
        IReadOnlyList<int> removed = Array.Empty<int>();
        if (since is long s && game.CityViewCache.TryGetValue(city.Id.Value, out var cached) && cached.Revision == s)
        {
            full = false;
            list = visuals.Where(v => !cached.VisualRevs.TryGetValue(v.Id, out var r) || r != v.VisualRev).ToList();
            removed = cached.VisualRevs.Keys.Where(id => !revs.ContainsKey(id)).OrderBy(id => id).ToList();
        }
        game.CityViewCache[city.Id.Value] = (Revision, revs);

        var now = game.Now;
        var n = buildings.Count;
        var ids = new int[n];
        var revenue = new decimal[n];
        var units = new double[n];
        var exports = new double[n];
        var netIncome = new decimal[n];
        var utilization = new double?[n];
        var transfersIn = new double[n];
        var transfersOut = new double[n];
        for (var i = 0; i < n; i++)
        {
            var b = buildings[i];
            ids[i] = b.Id.Value;
            var bm = game.Index.Building(b.Id.Value, now);
            revenue[i] = bm?.Revenue ?? 0m;
            units[i] = bm?.RetailQty ?? 0;
            exports[i] = bm?.ExportQty ?? 0;
            netIncome[i] = bm?.NetIncome ?? 0m;
            utilization[i] = game.Utilization(b);
            transfersIn[i] = bm?.TransfersIn ?? 0;
            transfersOut[i] = bm?.TransfersOut ?? 0;
        }
        var activity = new CityActivityDto(Months.Dto(now), ids, revenue, units, exports, netIncome, utilization, transfersIn, transfersOut);
        var layout = LandRulesOn(game) ? new LayoutRevisionDto(world.GetLayoutRevision(city.Id)) : null;
        return new CityViewDto(city.Id.Value, Revision, full, list, removed, activity, layout);
    }

    private static BuildingVisualDto Visual(ActiveGame game, BuildingInstance b)
    {
        var type = game.World.Catalog.BuildingType(b.TypeId);
        var kind = game.Rules.KindOf(b);
        var placement = game.Placement.Get(b.Id.Value) ?? new PlacementDto(0, 0, 0, PlacementSources.Auto);
        var status = StatusOf(kind, b);
        var products = SlotRules.Products(b);
        var owner = b.Owner.Value;
        var construction = ConstructionOf(game.World, b);
        return new BuildingVisualDto(
            Id: b.Id.Value,
            TypeId: b.TypeId.Value,
            Category: type.Category,
            SlotKind: kind,
            OwnerId: owner,
            IsPlayer: b.Owner == game.Player,
            Color: game.Color(owner),
            ColorIndex: game.ColorIndex(owner),
            Level: b.Level,
            FootprintW: type.Footprint.Width,
            FootprintH: type.Footprint.Height,
            Placement: placement,
            Status: status,
            Products: products,
            VisualRev: VisualRev(b.TypeId.Value, owner, b.Level, placement, status, products,
                b.Construction is { } c ? c.MonthsTotal - c.MonthsRemaining : -1),
            Construction: construction);
    }

    /// <summary>
    /// <see cref="SlotRules.Status"/>, plus <c>underConstruction</c> while a building is being
    /// built (features.constructionTime): it does not operate yet, though its slots may be set.
    /// </summary>
    internal static string StatusOf(string kind, BuildingInstance b)
        => b.Construction is not null ? BuildingStatuses.UnderConstruction : SlotRules.Status(kind, b);

    /// <summary>Construction progress on the wire, or null for a complete (or retired) building.</summary>
    internal static ConstructionDto? ConstructionOf(World world, BuildingInstance b)
    {
        if (b.Construction is not { } c || b.IsRetired) return null;
        return new ConstructionDto(
            Months.Dto(c.StartedAt),
            Months.Dto(c.CompletesAt),
            Math.Round(c.Progress, 4),
            c.CostPaid,
            c.CostRemaining,
            MonthsTotal: c.MonthsTotal,
            MonthsRemaining: c.MonthsRemaining,
            NextInstalment: c.AwaitingSite ? null : c.NextInstalment,
            AwaitingSite: c.AwaitingSite ? true : null,
            PausedMonths: c.PausedMonths > 0 ? c.PausedMonths : null,
            CancelRefund: world.QuoteCancellation(b.Id).Proceeds);
    }

    /// <summary>32-bit FNV-1a over everything that changes how a building looks.</summary>
    /// <remarks><paramref name="constructionStep"/> is the months of construction done (−1 when complete): the scaffold changes monthly.</remarks>
    internal static uint VisualRev(string typeId, int ownerId, int level, PlacementDto placement, string status, IReadOnlyList<string> products,
        int constructionStep = -1)
    {
        var builder = new StringBuilder(64)
            .Append(typeId).Append('|').Append(ownerId).Append('|').Append(level).Append('|')
            .Append(placement.Px).Append(',').Append(placement.Pz).Append(',').Append(placement.Rotation).Append('|')
            .Append(status).Append('|').AppendJoin(',', products);
        if (constructionStep >= 0) builder.Append('|').Append(constructionStep);
        var text = builder.ToString();
        var hash = 2166136261u;
        foreach (var b in Encoding.UTF8.GetBytes(text))
        {
            hash ^= b;
            hash = unchecked(hash * 16777619u);
        }
        return hash;
    }

    /// <summary>
    /// Required geography flags the city lacks (<c>coastal</c>, <c>arable</c>, <c>mineralRich</c>,
    /// <c>oilRich</c>). The engine's <see cref="World.MeetsGeographyRequirement"/> decides; this only
    /// names the missing flags for the player.
    /// </summary>
    internal static List<string> GeographyIssues(World world, BuildingType type, City city)
    {
        var issues = new List<string>();
        if (world.MeetsGeographyRequirement(type.Id, city.Id)) return issues;
        if (type.GeographyRequirement is not { } req) return issues;
        if (req.Coastal == true && !city.Geography.Coastal) issues.Add("coastal");
        if (req.Arable == true && !city.Geography.Arable) issues.Add("arable");
        if (req.MineralRich == true && !city.Geography.MineralRich) issues.Add("mineralRich");
        if (req.OilRich == true && !city.Geography.OilRich) issues.Add("oilRich");
        return issues;
    }

    /// <summary>Average operating cash flow of the last three closed tick months (null before the first tick).</summary>
    internal static decimal? AverageOperatingCashFlow(ActiveGame game)
    {
        var now = game.Now;
        var from = Math.Max(game.StartMonth + 1, now - 2);
        if (from > now) return null;
        decimal sum = 0m;
        for (var m = from; m <= now; m++) sum += game.Index.Company(game.Player.Value, m)?.OperatingCashFlow ?? 0m;
        return sum / (now - from + 1);
    }
}

/// <summary>Building statuses the facade adds to <see cref="SlotRules.Status"/> (TS <c>BuildingStatus</c>).</summary>
internal static class BuildingStatuses
{
    public const string UnderConstruction = "underConstruction";
}

/// <summary>
/// Wire names of the engine's placement rules (TS <c>PlacementIssue</c>): bridge-spec
/// <c>outOfBounds | occupied | road | zoning</c> plus the E3b site rules.
/// </summary>
internal static class PlacementIssueNames
{
    /// <summary>No valid (free) site in the whole city can take the type.</summary>
    public const string NoSite = "noSite";

    /// <summary>The wire name of an engine placement code.</summary>
    public static string Of(PlacementCode code) => code switch
    {
        PlacementCode.OutOfBounds => "outOfBounds",
        PlacementCode.Occupied => "occupied",
        PlacementCode.Road => "road",
        PlacementCode.Water => "water",
        PlacementCode.Zone => "zoning",
        PlacementCode.NeedsRoad => "needsRoad",
        PlacementCode.NeedsCoast => "needsCoast",
        PlacementCode.NeedsDeposit => "needsDeposit",
        PlacementCode.NotArable => "notArable",
        PlacementCode.Slope => "slope",
        _ => "zoning",
    };

    /// <summary>
    /// The protocol error for a rejected site: <c>plot_out_of_bounds</c>, <c>plot_occupied</c>
    /// (a building, a road or water is in the way) or <c>zoning_forbidden</c> (every site rule:
    /// zoning, frontage, coast, deposit, arable land, slope); <c>details.reason</c> is the first
    /// issue's wire name.
    /// </summary>
    public static BridgeException Error(PlacementResult placement, string field)
    {
        var first = placement.FirstIssue;
        var reason = first is null ? "zoning" : Of(first.Code);
        var code = first?.Code switch
        {
            PlacementCode.OutOfBounds => BridgeErrorCodes.PlotOutOfBounds,
            PlacementCode.Occupied or PlacementCode.Road or PlacementCode.Water => BridgeErrorCodes.PlotOccupied,
            _ => BridgeErrorCodes.ZoningForbidden,
        };
        var message = first is null ? "That site cannot take this building." : first.Message;
        return new BridgeException(code, message, field + ".px", new ErrorDetailsDto(Reason: reason));
    }
}

/// <summary>One failed placement rule (E3b).</summary>
/// <param name="Code">Wire name (<see cref="PlacementIssueNames"/>).</param>
/// <param name="Message">English explanation.</param>
/// <param name="Px">The offending plot, when the rule fails at one plot.</param>
/// <param name="Pz">The offending plot, when the rule fails at one plot.</param>
public sealed record PlacementIssueDto(string Code, string Message, int? Px = null, int? Pz = null);

/// <summary>What a site offers (E3b, caplab §5.9 step 4): traffic, location, land value, resources.</summary>
/// <param name="Traffic">Mean customer-traffic index over the footprint, 0–100.</param>
/// <param name="PeakTraffic">Highest traffic index of a footprint plot.</param>
/// <param name="LocationFactor">econ-audit §4.3 <c>clamp(traffic / median urban traffic, 0.3, 2.5)</c>.</param>
/// <param name="DistanceToCbd">Footprint centre to CBD centre, in plots.</param>
/// <param name="Frontage">Best adjacent road class (<c>local|collector|arterial|highway</c>); omitted when none.</param>
/// <param name="District">Most common district under the footprint.</param>
/// <param name="MaxSlope">Steepest slope class under the footprint (0–3).</param>
/// <param name="Waterfront">The footprint touches the sea.</param>
/// <param name="LandValuePerPlot">Mean land value of the footprint plots, whole dollars.</param>
/// <param name="ParcelIds">Parcels the footprint touches, ascending.</param>
/// <param name="DepositId">The onshore deposit under the footprint.</param>
/// <param name="DepositQuality">Its quality (35–85).</param>
/// <param name="DepositReserve">Its recoverable reserve.</param>
public sealed record SiteDto(
    double Traffic,
    double PeakTraffic,
    double LocationFactor,
    double DistanceToCbd,
    string? Frontage,
    string District,
    int MaxSlope,
    bool Waterfront,
    decimal LandValuePerPlot,
    IReadOnlyList<int> ParcelIds,
    int? DepositId,
    int? DepositQuality,
    double? DepositReserve);
