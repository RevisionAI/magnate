using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Market intelligence (bridge-spec §5.9). Under Realistic market rules every model share,
// forecast and price suggestion comes from the engine's demand model (World.PreviewDemand,
// modelSource "engine", bridge-spec E9) and realised shares count the incumbent local
// competition; Classic worlds (legacy saves) keep the bridge replica of the old softmax
// (MarketModel, "bridgeReplica"). Realised retail units come from the ledger index.
public sealed partial class GameSession
{
    /// <summary>
    /// The market grid: one row per (city, finished product). <c>sort</c> = share |
    /// price | city | demand; <c>significantOnly</c> keeps markets with retailers or
    /// at least 1,000 units/month of demand.
    /// </summary>
    [BridgeMethod("marketIntel")]
    public MarketIntelDto MarketIntel(MarketIntelArgs args)
    {
        var game = Game;
        var world = game.World;
        if (args.CityId is { } cityFilter) Guard.City(Catalog, cityFilter);
        if (args.ProductId is { } productFilter) Guard.Product(Catalog, productFilter);
        var now = game.Now;
        var retail = new RetailIndex(world);
        var rows = new List<MarketRowDto>();
        foreach (var city in world.Catalog.Cities.Values.OrderByDescending(c => c.Population).ThenBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            if (args.CityId is not null && city.Id.Value != args.CityId) continue;
            foreach (var product in game.Rules.OrderedProducts.Where(p => p.Tier == ProductTier.Finished))
            {
                if (args.ProductId is not null && product.Id.Value != args.ProductId) continue;
                var row = EngineMarket.Applies(world)
                    ? EngineMarketRow(game, city, product, now)
                    : MarketRow(game, MarketModel.Allocate(world, city, product, retail: retail), now);
                if (args.PlayerOnly && !row.PlayerPresent) continue;
                if (args.CompetitorsOnly && row.RivalCount == 0) continue;
                if (args.SignificantOnly && row.RetailerCount == 0 && row.PotentialDemand < 1000) continue;
                rows.Add(row);
            }
        }
        IEnumerable<MarketRowDto> sorted = args.Sort switch
        {
            "price" => rows.OrderBy(r => r.PlayerPrice ?? decimal.MaxValue).ThenBy(r => r.CityId, StringComparer.Ordinal).ThenBy(r => r.ProductId, StringComparer.Ordinal),
            "city" => rows.OrderBy(r => r.CityId, StringComparer.Ordinal).ThenBy(r => r.ProductId, StringComparer.Ordinal),
            "demand" => rows.OrderByDescending(r => r.PotentialDemand).ThenBy(r => r.CityId, StringComparer.Ordinal).ThenBy(r => r.ProductId, StringComparer.Ordinal),
            null or "share" => rows.OrderByDescending(r => r.PlayerRealisedShare ?? r.PlayerModelShare)
                .ThenByDescending(r => r.PotentialDemand).ThenBy(r => r.CityId, StringComparer.Ordinal).ThenBy(r => r.ProductId, StringComparer.Ordinal),
            _ => throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown sort '{args.Sort}'.", "sort"),
        };
        return new MarketIntelDto(sorted.ToList());
    }

    /// <summary>One market in depth: brackets, every competing retail slot, the player's share history.</summary>
    [BridgeMethod("marketDetail")]
    public MarketDetailDto MarketDetail(MarketKeyArgs args)
    {
        var game = Game;
        var world = game.World;
        var city = Guard.City(Catalog, args.CityId);
        var product = Guard.Product(Catalog, args.ProductId);
        if (product.Tier != ProductTier.Finished)
        {
            throw new BridgeException(BridgeErrorCodes.ProductNotAllowed, $"{product.Name} is not sold to consumers.", "productId",
                new ErrorDetailsDto(ProductId: product.Id.Value, Reason: "notFinished"));
        }
        var now = game.Now;
        if (EngineMarket.Applies(world)) return EngineMarketDetail(game, city, product, now);
        var allocation = MarketModel.Allocate(world, city, product);
        var unitsByCompany = game.Index.RetailUnitsByCompany(city.Id.Value, product.Id.Value, now, now);
        var marketUnits = unitsByCompany.Values.Sum();

        var retailers = new List<RetailerRowDto>();
        foreach (var r in allocation.Retailers)
        {
            var b = r.Building;
            var bp = game.Index.BuildingProduct(b.Id.Value, product.Id.Value, now);
            var sameProductSlots = b.RetailSlots.Count(s => s.Product == product.Id);
            var units = (bp?.SaleQty ?? 0) / Math.Max(1, sameProductSlots);
            var revenue = (bp?.SaleRev ?? 0m) / Math.Max(1, sameProductSlots);
            retailers.Add(new RetailerRowDto(
                b.Id.Value, r.Slot.Index, b.Owner.Value, world.Companies[b.Owner].Name, b.Owner == game.Player,
                r.Price, r.Quality, r.Tech, r.Brand, r.Weight, Math.Round(r.Demand, 3), Math.Round(r.Share, 6),
                b.Inventory.Get(product.Id), units, revenue, marketUnits > 0 ? units / marketUnits : 0, r.ExcludedBrackets));
        }

        var from = Math.Max(game.StartMonth, now - 11);
        var history = new List<double?>();
        for (var m = from; m <= now; m++) history.Add(game.Index.RealisedShare(city.Id.Value, product.Id.Value, game.Player.Value, m, m));

        return new MarketDetailDto(
            city.Id.Value,
            product.Id.Value,
            Math.Round(allocation.PotentialDemand, 3),
            allocation.Elasticity,
            (decimal)product.BaseWorldMarketPrice,
            world.GetEffectiveWorldPrice(product.Id),
            allocation.Brackets.Select(b => new BracketDemandDto(b.Bracket, b.Population, b.PerCapita, Math.Round(b.Demand, 3), b.Ceiling, b.Eligible)).ToList(),
            retailers,
            new SeriesDto(Months.Dto(from), history),
            world.GetMarketShare(game.Player, product.Id, city.Id),
            MarketModel.Source);
    }

    /// <summary>Top three markets to enter (unserved demand) and to defend (a rival out-sells you).</summary>
    [BridgeMethod("marketOpportunities")]
    public MarketOpportunitiesDto MarketOpportunities()
    {
        var game = Game;
        var world = game.World;
        var now = game.Now;
        var enter = new List<EnterOpportunityDto>();
        var defend = new List<DefendPressureDto>();
        var retail = new RetailIndex(world);
        foreach (var city in world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            foreach (var product in game.Rules.OrderedProducts.Where(p => p.Tier == ProductTier.Finished))
            {
                if (EngineMarket.Applies(world))
                {
                    EngineOpportunity(game, city, product, now, enter, defend);
                    continue;
                }

                var allocation = MarketModel.Allocate(world, city, product, retail: retail);
                var playerPresent = allocation.Retailers.Any(r => r.Building.Owner == game.Player);
                var rivalCompanies = allocation.Retailers.Where(r => r.Building.Owner != game.Player).Select(r => r.Building.Owner).Distinct().ToList();
                var demand = allocation.PotentialDemand;
                if (demand <= 0) continue;
                if (!playerPresent)
                {
                    decimal? cheapest = rivalCompanies.Count > 0 ? allocation.Retailers.Min(r => r.Price) : null;
                    enter.Add(new EnterOpportunityDto(city.Id.Value, product.Id.Value, Math.Round(demand, 3), rivalCompanies.Count, cheapest,
                        Math.Round(demand / (1 + rivalCompanies.Count), 3)));
                    continue;
                }
                if (rivalCompanies.Count == 0) continue;
                var shares = Shares(game, allocation, now);
                var playerShare = shares.GetValueOrDefault(game.Player.Value);
                var top = shares.Where(kv => kv.Key != game.Player.Value).OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).First();
                var score = (top.Value - playerShare) * demand;
                if (score <= 0) continue;
                defend.Add(new DefendPressureDto(city.Id.Value, product.Id.Value, Math.Round(playerShare, 6), Math.Round(top.Value, 6),
                    world.Companies[new CompanyId(top.Key)].Name, Math.Round(score, 3)));
            }
        }
        return new MarketOpportunitiesDto(
            enter.OrderByDescending(e => e.Score).ThenBy(e => e.CityId, StringComparer.Ordinal).ThenBy(e => e.ProductId, StringComparer.Ordinal).Take(3).ToList(),
            defend.OrderByDescending(d => d.Score).ThenBy(d => d.CityId, StringComparer.Ordinal).ThenBy(d => d.ProductId, StringComparer.Ordinal).Take(3).ToList());
    }

    /// <summary>
    /// A price for one of the player's retail slots that maximises expected gross profit.
    /// Engine model (Realistic): the store line (all its slots for the product share one price)
    /// is evaluated exactly with <see cref="World.PreviewDemand"/> at
    /// <c>{0.8 … 1.6} × the city reference price</c> and at the current price; units are what
    /// the next tick would sell (capacity, stock target, competition and incumbents included).
    /// Replica (Classic): five points around a reference price plus each bracket's reservation
    /// ceiling, units capped by the restock target.
    /// </summary>
    [BridgeMethod("suggestPrice")]
    public PriceSuggestionDto SuggestPrice(SlotRefArgs args)
    {
        var game = Game;
        var world = game.World;
        var b = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        var slot = b.RetailSlots.FirstOrDefault(s => s.Index == args.SlotIndex) ?? throw SlotEmpty(args.SlotIndex);
        var product = world.Catalog.Product(slot.Product);
        var city = world.Catalog.City(b.City);
        if (EngineMarket.Applies(world) && product.Demand is not null) return EngineSuggestPrice(game, b, slot, product, city);
        var worldPrice = world.GetEffectiveWorldPrice(product.Id);
        var onHand = b.Inventory.Get(product.Id);
        var unitCost = onHand > 0 ? b.Inventory.CostOf(product.Id) / (decimal)onHand : worldPrice;

        var retail = new RetailIndex(world);
        var baseline = MarketModel.Allocate(world, city, product, retail: retail);
        var rivalPrices = baseline.Retailers.Where(r => r.Building.Owner != game.Player).Select(r => r.Price).OrderBy(p => p).ToList();
        decimal? rivalMin = rivalPrices.Count > 0 ? rivalPrices[0] : null;
        decimal? rivalMedian = rivalPrices.Count == 0 ? null
            : rivalPrices.Count % 2 == 1 ? rivalPrices[rivalPrices.Count / 2]
            : (rivalPrices[rivalPrices.Count / 2 - 1] + rivalPrices[rivalPrices.Count / 2]) / 2m;
        var reference = Math.Max(unitCost * 1.25m, rivalMedian ?? worldPrice * 1.2m);

        PricePointDto Evaluate(decimal price)
        {
            var allocation = MarketModel.Allocate(world, city, product, (b.Id.Value, slot.Index, price), retail);
            var demand = allocation.Retailers.FirstOrDefault(r => r.Building.Id == b.Id && r.Slot.Index == slot.Index)?.Demand ?? 0;
            var units = Math.Min(demand, slot.RestockTarget);
            return new PricePointDto(price, Math.Round(units, 3), (decimal)units * price, (decimal)units * (price - unitCost));
        }

        var points = new[] { 0.8m, 0.9m, 1.0m, 1.1m, 1.2m }
            .Select(f => Math.Max(0.01m, Math.Round(reference * f, 2, MidpointRounding.AwayFromZero)))
            .Distinct()
            .Select(Evaluate)
            .ToList();
        var ceilings = MarketModel.Brackets
            .Select(bracket => (Bracket: MarketModel.BracketId(bracket), Price: MarketModel.Ceiling(product, bracket)))
            .Where(c => c.Price is decimal p && p > 0m)
            .Select(c => new CeilingDto(c.Bracket, c.Price!.Value))
            .ToList();
        var candidates = points
            .Concat(ceilings.Where(c => c.Price > unitCost).Select(c => Evaluate(c.Price)))
            .OrderByDescending(p => p.GrossProfit)
            .ThenBy(p => p.Price)
            .ToList();
        var suggested = candidates.Count > 0 && candidates[0].GrossProfit > 0m ? candidates[0].Price : Math.Max(0.01m, Math.Round(reference, 2));

        return new PriceSuggestionDto(b.Id.Value, slot.Index, unitCost, worldPrice, rivalMin, rivalMedian, ceilings, suggested, points, MarketModel.Source);
    }

    // ------------------------------------------------------------------ helpers

    private static MarketRowDto MarketRow(ActiveGame game, MarketAllocation allocation, int now)
    {
        var world = game.World;
        var player = allocation.Retailers.Where(r => r.Building.Owner == game.Player).ToList();
        var rivals = allocation.Retailers.Where(r => r.Building.Owner != game.Player).ToList();
        var shares = Shares(game, allocation, now);
        var topRival = shares.Where(kv => kv.Key != game.Player.Value).OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).FirstOrDefault();
        return new MarketRowDto(
            allocation.City.Id.Value,
            allocation.City.Name,
            allocation.Product.Id.Value,
            allocation.Product.Name,
            Math.Round(allocation.PotentialDemand, 3),
            allocation.Retailers.Count,
            player.Count > 0,
            player.Count > 0 ? player.Min(r => r.Price) : null,
            Math.Round(player.Sum(r => r.Share), 6),
            game.Index.RealisedShare(allocation.City.Id.Value, allocation.Product.Id.Value, game.Player.Value, now, now),
            rivals.Count > 0 ? rivals.Min(r => r.Price) : null,
            topRival.Key == 0 ? null : new CompanyShareDto(topRival.Key, world.Companies[new CompanyId(topRival.Key)].Name, Math.Round(topRival.Value, 6)),
            rivals.Select(r => r.Building.Owner).Distinct().Count());
    }

    /// <summary>Share per company: realised units last month when the market sold anything, otherwise the model share.</summary>
    private static Dictionary<int, double> Shares(ActiveGame game, MarketAllocation allocation, int now)
    {
        var units = game.Index.RetailUnitsByCompany(allocation.City.Id.Value, allocation.Product.Id.Value, now, now);
        var total = units.Values.Sum();
        var shares = new Dictionary<int, double>();
        if (total > 0)
        {
            foreach (var (company, qty) in units) shares[company] = qty / total;
            foreach (var r in allocation.Retailers) shares.TryAdd(r.Building.Owner.Value, 0);
            return shares;
        }
        foreach (var r in allocation.Retailers)
        {
            shares[r.Building.Owner.Value] = shares.GetValueOrDefault(r.Building.Owner.Value) + r.Share;
        }
        return shares;
    }

    // ------------------------------------------------------------------ engine demand model (E9)

    private static MarketRowDto EngineMarketRow(ActiveGame game, City city, Product product, int now)
    {
        var world = game.World;
        var preview = EngineMarket.Preview(world, city, product);
        var lines = preview?.Lines ?? Array.Empty<PreviewLine>();
        var player = lines.Where(l => l.Owner == game.Player).ToList();
        var rivals = lines.Where(l => l.Owner != game.Player).ToList();
        var realised = EngineMarket.LastMonthShares(world, city, product);
        var shares = EngineShares(game, lines, realised);
        var topRival = shares.Where(kv => kv.Key != game.Player.Value).OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).FirstOrDefault();
        double? incumbentShare = preview is null ? null
            : realised?.IncumbentShare ?? (preview.TotalDemand > 0 ? Math.Round(preview.IncumbentDemand / preview.TotalDemand, 6) : null);
        return new MarketRowDto(
            city.Id.Value,
            city.Name,
            product.Id.Value,
            product.Name,
            Math.Round(preview?.ReferenceDemand ?? 0, 3),
            lines.Count,
            player.Count > 0,
            player.Count > 0 ? player.Min(l => l.Price) : null,
            Math.Round(player.Sum(l => l.Share), 6),
            realised is { } r ? Math.Round(r.Shares.GetValueOrDefault(game.Player.Value), 6) : null,
            rivals.Count > 0 ? rivals.Min(l => l.Price) : null,
            topRival.Key == 0 ? null : new CompanyShareDto(topRival.Key, world.Companies[new CompanyId(topRival.Key)].Name, Math.Round(topRival.Value, 6)),
            rivals.Select(l => l.Owner).Distinct().Count(),
            incumbentShare is double v ? Math.Round(v, 6) : null);
    }

    /// <summary>Per-company share: last month's realised units (incumbents in the denominator), else the model share.</summary>
    private static Dictionary<int, double> EngineShares(ActiveGame game, IReadOnlyList<PreviewLine> lines, (Dictionary<int, double> Shares, double IncumbentShare)? realised)
    {
        var shares = new Dictionary<int, double>();
        if (realised is { } r)
        {
            foreach (var (company, share) in r.Shares) shares[company] = share;
            foreach (var l in lines) shares.TryAdd(l.Owner.Value, 0);
            return shares;
        }

        foreach (var l in lines) shares[l.Owner.Value] = shares.GetValueOrDefault(l.Owner.Value) + l.Share;
        return shares;
    }

    private static MarketDetailDto EngineMarketDetail(ActiveGame game, City city, Product product, int now)
    {
        var world = game.World;
        var preview = world.PreviewDemand(city.Id, product.Id);
        var realised = EngineMarket.LastMonthShares(world, city, product);
        var unitsByCompany = game.Index.RetailUnitsByCompany(city.Id.Value, product.Id.Value, now, now);
        var lastMonth = world.GetMarketUnits(city.Id, product.Id, world.Clock.Now);
        var marketUnits = unitsByCompany.Values.Sum() + (lastMonth?.Incumbents ?? 0);
        var sellable = preview.Lines.Count(l => l.Sellable > 0);

        var retailers = new List<RetailerRowDto>();
        foreach (var line in preview.Lines)
        {
            if (line.Building is not BuildingInstanceId id) continue;
            var b = world.Buildings[id];
            var report = world.GetRetailLineReport(id, product.Id);
            var firstSlot = b.RetailSlots.Where(s => s.Product == product.Id).Min(s => s.Index);
            var units = report?.Month == world.Clock.Now ? report.Sold : 0;
            var revenue = report?.Month == world.Clock.Now ? report.Revenue : 0m;
            retailers.Add(new RetailerRowDto(
                id.Value, firstSlot, b.Owner.Value, world.Companies[b.Owner].Name, b.Owner == game.Player,
                line.Price, Math.Round(line.Quality, 6), world.GetTech(b.Owner, product.Id), Math.Round(line.Brand, 6),
                Math.Round(line.Attractiveness, 6), Math.Round(line.Sold, 3), Math.Round(line.Share, 6),
                b.Inventory.Get(product.Id), units, revenue, marketUnits > 0 ? units / marketUnits : 0, Array.Empty<string>()));
        }

        var from = Math.Max(game.StartMonth, now - 11);
        var history = new List<double?>();
        for (var m = from; m <= now; m++) history.Add(game.Index.RealisedShare(city.Id.Value, product.Id.Value, game.Player.Value, m, m));

        var brackets = preview.Brackets.Select(b => new BracketDemandDto(
            MarketModel.BracketId(b.Bracket), b.Population, b.PerCapita, Math.Round(b.Demand, 3), null, sellable)).ToList();
        var incumbent = new IncumbentDto(
            preview.IncumbentPrice,
            Math.Round(preview.IncumbentMass, 6),
            Math.Round(preview.IncumbentUnits, 3),
            preview.TotalDemand > 0 ? Math.Round(preview.IncumbentDemand / preview.TotalDemand, 6) : 0,
            lastMonth?.Incumbents is double inc ? Math.Round(inc, 3) : null);

        return new MarketDetailDto(
            city.Id.Value,
            product.Id.Value,
            Math.Round(preview.ReferenceDemand, 3),
            product.Demand!.CategoryElasticity,
            (decimal)product.BaseWorldMarketPrice,
            world.GetEffectiveWorldPrice(product.Id),
            brackets,
            retailers,
            new SeriesDto(Months.Dto(from), history),
            world.GetMarketShare(game.Player, product.Id, city.Id),
            EngineMarket.Source,
            incumbent);
    }

    private static void EngineOpportunity(ActiveGame game, City city, Product product, int now, List<EnterOpportunityDto> enter, List<DefendPressureDto> defend)
    {
        var world = game.World;
        if (EngineMarket.Preview(world, city, product) is not { } preview) return;
        var demand = preview.ReferenceDemand;
        if (!(demand > 0)) return;
        var playerPresent = preview.Lines.Any(l => l.Owner == game.Player);
        var rivalCompanies = preview.Lines.Where(l => l.Owner != game.Player).Select(l => l.Owner).Distinct().ToList();
        if (!playerPresent)
        {
            decimal? cheapest = rivalCompanies.Count > 0 ? preview.Lines.Min(l => l.Price) : null;
            enter.Add(new EnterOpportunityDto(city.Id.Value, product.Id.Value, Math.Round(demand, 3), rivalCompanies.Count, cheapest,
                Math.Round(demand / (1 + rivalCompanies.Count), 3)));
            return;
        }

        if (rivalCompanies.Count == 0) return;
        var shares = EngineShares(game, preview.Lines, EngineMarket.LastMonthShares(world, city, product));
        var playerShare = shares.GetValueOrDefault(game.Player.Value);
        var top = shares.Where(kv => kv.Key != game.Player.Value).OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).First();
        var score = (top.Value - playerShare) * demand;
        if (score <= 0) return;
        defend.Add(new DefendPressureDto(city.Id.Value, product.Id.Value, Math.Round(playerShare, 6), Math.Round(top.Value, 6),
            world.Companies[new CompanyId(top.Key)].Name, Math.Round(score, 3)));
    }

    private static PriceSuggestionDto EngineSuggestPrice(ActiveGame game, BuildingInstance b, RetailSlot slot, Product product, City city)
    {
        var world = game.World;
        var worldPrice = world.GetEffectiveWorldPrice(product.Id);
        var onHand = b.Inventory.Get(product.Id);
        var unitCost = onHand > 0 ? b.Inventory.CostOf(product.Id) / (decimal)onHand : world.GetImportPrice(product.Id);
        var baseline = world.PreviewDemand(city.Id, product.Id);
        var rivalPrices = baseline.Lines.Where(l => l.Owner != game.Player).Select(l => l.Price).OrderBy(p => p).ToList();
        decimal? rivalMin = rivalPrices.Count > 0 ? rivalPrices[0] : null;
        decimal? rivalMedian = rivalPrices.Count == 0 ? null
            : rivalPrices.Count % 2 == 1 ? rivalPrices[rivalPrices.Count / 2]
            : (rivalPrices[rivalPrices.Count / 2 - 1] + rivalPrices[rivalPrices.Count / 2]) / 2m;
        var reference = product.Demand!.ReferencePrice * (decimal)city.PriceIndex;

        PricePointDto Evaluate(decimal price)
        {
            var preview = world.PreviewDemand(city.Id, product.Id, new PreviewOffer { Building = b.Id, Price = price });
            var units = preview.Hypothetical?.Sold ?? 0;
            return new PricePointDto(price, Math.Round(units, 3), Math.Round((decimal)units * price, 2), Math.Round((decimal)units * (price - unitCost), 2));
        }

        var points = new[] { 0.8m, 0.9m, 1.0m, 1.1m, 1.2m, 1.3m, 1.4m, 1.5m, 1.6m }
            .Select(f => Math.Max(0.01m, Math.Round(reference * f, 2, MidpointRounding.AwayFromZero)))
            .Distinct()
            .Select(Evaluate)
            .ToList();
        // Rank by contribution (gross profit less the retail variable costs), the objective the AI's
        // price search maximises too: the suggestion is the profit-maximising point of the grid.
        var candidates = points.Append(Evaluate(slot.Price))
            .Select(p => (Point: p, Contribution: Magnate.Engine.Ai.MarketAi.Contribution(world, p.Units, p.Price, unitCost)))
            .OrderByDescending(p => p.Contribution)
            .ThenBy(p => p.Point.Price)
            .ToList();
        var suggested = candidates[0].Contribution > 0m ? candidates[0].Point.Price : Math.Max(0.01m, Math.Round(Math.Max(reference, unitCost * 1.05m), 2));
        return new PriceSuggestionDto(b.Id.Value, slot.Index, unitCost, worldPrice, rivalMin, rivalMedian, Array.Empty<CeilingDto>(), suggested, points, EngineMarket.Source);
    }
}
