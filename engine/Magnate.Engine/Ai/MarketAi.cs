using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// Shared AI decision rules for Realistic market rules (econ-audit §4.17). Every strategy keeps
/// its Classic code path untouched and calls these helpers only when
/// <see cref="Rules.MarketRules.Enabled"/> is on. All helpers are pure functions of world state
/// (they plan, never mutate), iterate in ordinal order and read the demand model through the
/// read-only <see cref="World.PreviewDemand"/>.
/// <list type="bullet">
///   <item><b>Pricing</b>: evaluate <c>{1 − step, 1 − 1 %, 1, 1 + 1 %, 1 + step} × current</c> and keep the best
///         expected gross profit, clamped to <c>[unit cost × floor, ceiling × Pref]</c> — at most
///         ±5 %/month, so no price spiral is possible.</item>
///   <item><b>Restock</b>: 1.2 × trailing monthly sales, capped by the stock cap.</item>
///   <item><b>Store choice</b>: the format with the strongest draw for the product's category
///         (cars → car dealership, apparel/electronics → department store, groceries →
///         supermarket).</item>
///   <item><b>Expansion</b>: fill a free slot of an own store first; build a new store only if its
///         projected EBIT pays the capex back within the payback limit and the company keeps a
///         cash cushion.</item>
///   <item><b>Advertising</b>: only where the brand lever pays: min(6 % of the line's revenue, the
///         budget that sustains awareness 60), never below 2 % market share.</item>
/// </list>
/// </summary>
public static class MarketAi
{
    /// <summary>Maximum simple payback (months) of a new store under normal difficulty.</summary>
    public const int MaxPaybackMonths = 96;

    /// <summary>
    /// Fine step tried alongside the ±<see cref="Rules.MarketRules.AiPriceStep"/> candidates, so a
    /// line settles within a cent or two of its profit peak instead of hopping around it.
    /// </summary>
    public const decimal FinePriceStep = 0.01m;

    /// <summary>Annual capital charge used by the expansion test.</summary>
    public const decimal CapitalChargeRate = 0.03m;

    /// <summary>Advertising budget share of the line's revenue.</summary>
    public const decimal AdRevenueShare = 0.06m;

    /// <summary>Awareness the advertising rule sustains at most.</summary>
    public const double AdSustainAwareness = 60;

    /// <summary>Minimum market share before an AI advertises.</summary>
    public const double AdMinShare = 0.02;

    /// <summary>The city's reference price of a consumer good.</summary>
    public static decimal ReferencePrice(World world, CityId city, Product product)
        => product.Demand is { } d ? d.ReferencePrice * (decimal)world.Catalog.City(city).PriceIndex : (decimal)product.BaseWorldMarketPrice;

    /// <summary>Unit cost of a line: weighted-average cost on hand, else the landed import price.</summary>
    public static decimal UnitCost(World world, BuildingInstance building, ProductId product)
    {
        var onHand = building.Inventory.Get(product);
        return onHand > 1e-9 ? building.Inventory.CostOf(product) / (decimal)onHand : world.GetImportPrice(product);
    }

    /// <summary>The retail format the AI builds for a product (strongest draw; ties → cheaper), or null.</summary>
    public static BuildingTypeId? StoreTypeFor(World world, Product product)
    {
        BuildingType? best = null;
        double bestDraw = 0;
        foreach (var type in world.Catalog.BuildingTypes.Values.OrderBy(t => t.Id.Value, StringComparer.Ordinal))
        {
            var draw = RetailMarket.Draw(type, product);
            if (draw <= 0) continue;
            if (best is null || draw > bestDraw || (draw == bestDraw && type.ConstructionCost < best.ConstructionCost))
            {
                best = type;
                bestDraw = draw;
            }
        }

        return best?.Id;
    }

    /// <summary>Price bounds of a line: <c>[unit cost × floor, ceiling × Pref]</c> (the floor wins a conflict).</summary>
    public static (decimal Floor, decimal Ceiling) PriceBounds(World world, CityId city, Product product, decimal unitCost)
    {
        var rules = world.Rules.Market;
        var floor = unitCost * rules.AiPriceFloorOverCost;
        var ceiling = ReferencePrice(world, city, product) * rules.AiPriceCeiling;
        return (floor, Math.Max(floor, ceiling));
    }

    /// <summary>
    /// Expected monthly contribution of a line: <c>units × (price × (1 − retail variable rate) − unit cost)</c>
    /// — gross profit less the card fees and shrink that scale with sales (econ-audit §4.6). The
    /// objective every price search maximises.
    /// </summary>
    public static decimal Contribution(World world, double units, decimal price, decimal unitCost)
    {
        var rate = world.Rules.Market.RetailVariableRate;
        var net = rate == 0m ? price : price * (1m - rate);
        return (decimal)units * (net - unitCost);
    }

    /// <summary>Round a price to cents (never below one cent).</summary>
    public static decimal Cents(decimal price) => Math.Max(0.01m, Math.Round(price, 2, MidpointRounding.ToEven));

    /// <summary>
    /// The price-profit search of §4.17: candidates <c>{1 − step, 1 − 1 %, 1, 1 + 1 %, 1 + step} × current</c>
    /// clamped to the bounds; the best expected gross profit wins (ties keep the current price).
    /// </summary>
    public static decimal ChoosePrice(World world, RetailLine line, Product product)
    {
        var b = line.Building;
        var current = line.Price;
        var unitCost = UnitCost(world, b, product.Id);
        var (floor, ceiling) = PriceBounds(world, b.City, product, unitCost);
        var step = world.Rules.Market.AiPriceStep;

        var candidates = new[] { current, current * (1 - step), current * (1 + step), current * (1 - FinePriceStep), current * (1 + FinePriceStep) }
            .Select(p => Cents(Math.Clamp(p, floor, ceiling)))
            .Distinct()
            .ToList();
        // A price far outside the bounds (e.g. costs jumped) moves one step toward them per month.
        if (current < floor) candidates = new List<decimal> { Cents(Math.Min(floor, current * (1 + step))) };
        if (current > ceiling) candidates = new List<decimal> { Cents(Math.Max(ceiling, current * (1 - step))) };

        var best = candidates[0];
        var bestProfit = decimal.MinValue;
        foreach (var price in candidates)
        {
            var preview = world.PreviewDemand(b.City, product.Id, new PreviewOffer { Building = b.Id, Price = price });
            var sold = preview.Hypothetical?.Sold ?? 0;
            var profit = Contribution(world, sold, price, unitCost);
            if (profit > bestProfit)
            {
                best = price;
                bestProfit = profit;
            }
        }

        return best;
    }

    /// <summary>
    /// Entry price of a new line: the best expected gross profit over
    /// <c>{0.90, 0.95, 1.00, 1.05, 1.10, 1.20} × Pref</c>, floored at landed cost × floor.
    /// </summary>
    public static decimal EntryPrice(World world, CompanyId owner, BuildingTypeId storeType, CityId city, Product product, double locationFactor = 1.0, int level = 1)
    {
        var pref = ReferencePrice(world, city, product);
        var unitCost = world.GetImportPrice(product.Id);
        var (floor, ceiling) = PriceBounds(world, city, product, unitCost);
        var best = Cents(Math.Clamp(pref, floor, ceiling));
        var bestProfit = decimal.MinValue;
        foreach (var f in new[] { 0.90m, 0.95m, 1.00m, 1.05m, 1.10m, 1.20m })
        {
            var price = Cents(Math.Clamp(pref * f, floor, ceiling));
            var sold = PreviewNewLine(world, owner, storeType, city, product, price, locationFactor, level).Sold;
            var profit = Contribution(world, sold, price, unitCost);
            if (profit > bestProfit)
            {
                best = price;
                bestProfit = profit;
            }
        }

        return best;
    }

    /// <summary>The hypothetical new line of a preview (units it would sell at <paramref name="price"/>).</summary>
    public static PreviewLine PreviewNewLine(World world, CompanyId owner, BuildingTypeId storeType, CityId city, Product product, decimal price, double locationFactor = 1.0, int level = 1)
        => world.PreviewDemand(city, product.Id, new PreviewOffer
        {
            Owner = owner,
            StoreType = storeType,
            Price = price,
            LocationFactor = locationFactor,
            Level = level,
        }).Hypothetical!;

    /// <summary>
    /// Restock target of a line: <see cref="Rules.MarketRules.AiRestockCover"/> × trailing monthly
    /// sales (or × the preview's expected sales for a line without history), capped at the stock cap.
    /// </summary>
    public static double RestockTarget(World world, RetailLine line, Product product)
    {
        var cover = world.Rules.Market.AiRestockCover;
        var trailing = world.GetTrailingLineSales(line.Building.Id, product.Id);
        double basis = trailing;
        if (!(basis > 0))
        {
            var preview = world.PreviewDemand(line.Building.City, product.Id, new PreviewOffer { Building = line.Building.Id });
            basis = preview.Hypothetical?.Sold ?? 0;
        }

        var cap = RetailMarket.StockCap(world, line.Type, product, line.Slots.Count);
        return Math.Max(1, Math.Min(cap, basis * cover));
    }

    /// <summary>Monthly price and restock maintenance for every line of the actor (§4.17).</summary>
    public static void AddLineMaintenance(World world, CompanyId actor, List<AiAction> actions, Func<RetailLine, Product, decimal>? pricing = null)
    {
        foreach (var line in OwnLines(world, actor))
        {
            var product = world.Catalog.Product(line.Product);
            if (product.Demand is null) continue;
            var price = pricing?.Invoke(line, product) ?? ChoosePrice(world, line, product);
            if (line.Slots.Any(s => Math.Abs(s.Price - price) >= 0.005m))
            {
                actions.Add(new SetLinePriceAction(line.Building.Id, line.Product, price));
            }

            var target = RestockTarget(world, line, product);
            if (Math.Abs(line.RestockTarget - target) > Math.Max(1e-6, 0.01 * target))
            {
                actions.Add(new SetLineRestockAction(line.Building.Id, line.Product, target));
            }
        }
    }

    /// <summary>The actor's store lines (buildings by id, products by first slot index).</summary>
    public static IEnumerable<RetailLine> OwnLines(World world, CompanyId actor)
    {
        foreach (var b in world.Buildings.Values.Where(b => b.Owner == actor && b.RetailSlots.Count > 0).OrderBy(b => b.Id.Value))
        {
            foreach (var product in b.RetailSlots.OrderBy(s => s.Index).Select(s => s.Product).Distinct().ToList())
            {
                var line = RetailMarket.LineOf(world, b, product);
                if (line is not null) yield return line;
            }
        }
    }

    /// <summary>
    /// The advertising rule of §4.17: per served (city, product), budget = min(6 % of last month's
    /// revenue of the actor's lines there, the TV budget that sustains awareness 60); 0 below 2 %
    /// market share or when cash is short. Emits only changes.
    /// </summary>
    public static void AddAdvertising(World world, CompanyId actor, List<AiAction> actions, decimal maxBudget, int minCashMonths)
    {
        var markets = OwnLines(world, actor)
            .Select(l => (l.Building.City, l.Product))
            .Distinct()
            .OrderBy(m => m.City.Value, StringComparer.Ordinal)
            .ThenBy(m => m.Product.Value, StringComparer.Ordinal)
            .ToList();
        var cash = world.Companies[actor].Cash;
        foreach (var (city, product) in markets)
        {
            var target = AdBudget(world, actor, city, product, maxBudget);
            if (target > 0m && cash < target * minCashMonths) target = 0m;
            var current = world.GetAdCampaign(actor, product, city, AdChannel.TV)?.MonthlyBudget ?? 0m;
            if (current != target) actions.Add(new SetAdCampaignAction(product, city, AdChannel.TV, target));
        }
    }

    /// <summary>The §4.17 TV budget for one market (see <see cref="AddAdvertising"/>).</summary>
    public static decimal AdBudget(World world, CompanyId actor, CityId city, ProductId product, decimal maxBudget)
    {
        if (world.GetMarketShare(actor, product, city) < AdMinShare) return 0m;
        decimal revenue = 0m;
        foreach (var b in world.Buildings.Values.Where(b => b.Owner == actor && b.City == city).OrderBy(b => b.Id.Value))
        {
            revenue += world.GetRetailLineReport(b.Id, product)?.Revenue ?? 0m;
        }

        var sustain = world.GetSustainBudget(actor, city, AdChannel.TV, AdSustainAwareness);
        var budget = Math.Min(Math.Min(revenue * AdRevenueShare, sustain), maxBudget);
        return budget >= 1_000m ? Math.Round(budget, 0, MidpointRounding.ToEven) : 0m;
    }

    // ------------------------------------------------------------------ expansion

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<World, Dictionary<(string Type, string City, int Month, int Rev), double?>> SiteLocations = new();

    /// <summary>
    /// Location factor of the site the auto-siting <c>Construct</c> would choose for a new
    /// <paramref name="type"/> in <paramref name="city"/> (land rules), or null when no site is
    /// available. Site searches are expensive, so the answer is memoised per world for the month
    /// and the city's layout revision (any land change bumps it): an estimate for the expansion
    /// test, shared by every company planning that month.
    /// </summary>
    private static double? ExpectedSiteLocation(World world, CompanyId actor, BuildingTypeId type, CityId city)
    {
        var memo = SiteLocations.GetOrCreateValue(world);
        var key = (type.Value, city.Value, world.Clock.Now.AsMonthIndex(), world.GetLayoutRevision(city));
        if (memo.TryGetValue(key, out var cached)) return cached;
        if (memo.Count > 512) memo.Clear();
        var site = world.FindConstructionSites(actor, type, city, Land.SitePreference.Auto, 1).FirstOrDefault();
        double? location = site is null ? null : site.Placement.Site?.LocationFactor ?? 1.0;
        memo[key] = location;
        return location;
    }

    /// <summary>
    /// Money the company has already committed to construction (land rules, E3b): the unpaid
    /// instalments of its buildings under construction, plus the full cost of orders still waiting
    /// for a site. 0 under Classic rules. Expansion checks add it to the new project's cost so the
    /// AI does not start more works than its cash can finish (integration E1 x E3b).
    /// </summary>
    public static decimal ConstructionCommitments(World world, CompanyId actor)
    {
        if (!world.Rules.Land.Enabled) return 0m;
        decimal committed = 0m;
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != actor || b.Construction is not { } c) continue;
            committed += c.AwaitingSite ? world.Catalog.BuildingType(b.TypeId).ConstructionCost : c.CostRemaining;
        }

        return committed;
    }

    /// <summary>
    /// Extra up-front money a new building of <paramref name="type"/> in <paramref name="city"/>
    /// needs beyond its construction cost under land rules: the land and buy-out of the site the
    /// legacy auto-siting <c>Construct</c> would choose, plus <see cref="ConstructionCommitments"/>.
    /// Null when no site is available (the order would only wait). 0 under Classic rules.
    /// </summary>
    public static decimal? SiteAndCommitments(World world, CompanyId actor, BuildingTypeId type, CityId city)
    {
        if (!world.Rules.Land.Enabled) return 0m;
        var site = world.ChooseAutoSite(actor, type, city);
        if (site is null) return null;
        return site.SiteCost + ConstructionCommitments(world, actor);
    }

    /// <summary>Projected monthly fixed costs of a new building of <paramref name="type"/> with <paramref name="activeSlots"/> retail slots.</summary>
    public static decimal NewStoreFixedCosts(World world, BuildingType type, CityId city, int activeSlots)
    {
        var rules = world.Rules.Market;
        var wageIndex = (decimal)world.Catalog.City(city).WageIndex;
        var staffing = type.Staffing;
        var wages = (OperatingCosts.Wage(rules, staffing.FixedRole) * (decimal)staffing.Fixed
            + OperatingCosts.Wage(rules, staffing.SlotRole) * (decimal)(staffing.PerSlot * activeSlots)) * wageIndex;
        var capex = type.ConstructionCost;
        var overhead = capex * (rules.MaintenanceStructureRate + rules.InsuranceRate + rules.PropertyTaxRate) / 12m;
        return wages + type.MonthlyOperatingCost + overhead;
    }

    /// <summary>Incremental monthly wages of one more retail slot in a building.</summary>
    public static decimal SlotStaffCost(World world, BuildingType type, CityId city)
        => OperatingCosts.Wage(world.Rules.Market, type.Staffing.SlotRole) * (decimal)type.Staffing.PerSlot * (decimal)world.Catalog.City(city).WageIndex;

    /// <summary>Expected monthly contribution (<see cref="Contribution"/>) of a new line at the reference price.</summary>
    public static decimal LineGrossProfit(World world, CompanyId owner, BuildingTypeId storeType, CityId city, Product product, double locationFactor = 1.0, int level = 1)
    {
        var price = ReferencePrice(world, city, product);
        var cost = world.GetImportPrice(product.Id);
        var sold = PreviewNewLine(world, owner, storeType, city, product, price, locationFactor, level).Sold;
        return Contribution(world, sold, price, cost);
    }

    /// <summary>
    /// One retail expansion move (§4.17 expansion test, P0 simplification without finance):
    /// <list type="number">
    ///   <item>Fill a free slot of an own operational store with the unserved product whose
    ///         expected gross profit beats the slot's extra staff cost by the most.</item>
    ///   <item>Otherwise build the store whose best <c>k</c> unserved lines (k = its slots) earn
    ///         projected EBIT (after fixed costs, depreciation and a 3 % capital charge) that pays
    ///         the capex back within <paramref name="maxPaybackMonths"/>, if the company keeps
    ///         <paramref name="cushionMonths"/> of fixed costs afterwards.</item>
    /// </list>
    /// <paramref name="productFilter"/>/<paramref name="cityFilter"/> restrict the candidates;
    /// <paramref name="requiredProduct"/> makes every candidate carry that product (a slot fill must
    /// add it; a new store must open with it, whatever its own margin).
    /// </summary>
    public static AiAction? FindRetailExpansion(
        World world,
        CompanyId actor,
        int cushionMonths,
        int maxPaybackMonths = MaxPaybackMonths,
        Func<Product, bool>? productFilter = null,
        Func<City, bool>? cityFilter = null,
        ProductId? requiredProduct = null)
    {
        var served = OwnLines(world, actor).Select(l => (l.Building.City, l.Product)).ToHashSet();
        var products = world.Catalog.Products.Values
            .Where(p => p.Demand is not null && (productFilter?.Invoke(p) ?? true))
            .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
            .ToList();
        var cities = world.Catalog.Cities.Values
            .Where(c => cityFilter?.Invoke(c) ?? true)
            .OrderBy(c => c.Id.Value, StringComparer.Ordinal)
            .ToList();

        // 1. Free slots in own stores.
        (BuildingInstance Store, Product Product, decimal Net)? bestFill = null;
        foreach (var store in world.Buildings.Values
            .Where(b => b.Owner == actor && b.RetailSlots.Count > 0 && world.SiteInfo.IsOperational(b))
            .OrderBy(b => b.Id.Value))
        {
            if (!cities.Any(c => c.Id == store.City)) continue;
            var type = world.Catalog.BuildingType(store.TypeId);
            if (store.RetailSlots.Count >= world.GetCapacity(store)) continue;
            var slotCost = SlotStaffCost(world, type, store.City);
            foreach (var product in products)
            {
                if (requiredProduct is ProductId must && product.Id != must) continue;
                if (served.Contains((store.City, product.Id))) continue;
                if (!world.CanRetail(store.TypeId, product.Id)) continue;
                var net = LineGrossProfit(world, actor, store.TypeId, store.City, product, world.SiteInfo.LocationFactor(store), store.Level) - slotCost;
                if (net > 0m && (bestFill is null || net > bestFill.Value.Net)) bestFill = (store, product, net);
            }
        }

        var company = world.Companies[actor];
        var fixedCosts = world.GetMonthlyFixedCosts(actor);
        if (bestFill is { } fill)
        {
            var store = fill.Store;
            var price = EntryPrice(world, actor, store.TypeId, store.City, fill.Product, world.SiteInfo.LocationFactor(store), store.Level);
            var type = world.Catalog.BuildingType(store.TypeId);
            var expected = PreviewNewLine(world, actor, store.TypeId, store.City, fill.Product, price, world.SiteInfo.LocationFactor(store), store.Level).Sold;
            var restock = Math.Max(1, Math.Min(RetailMarket.StockCap(world, type, fill.Product, 1), expected * world.Rules.Market.AiRestockCover));
            var inventory = (decimal)restock * world.GetImportPrice(fill.Product.Id);
            if (company.Cash >= inventory + fixedCosts * cushionMonths)
            {
                var used = store.RetailSlots.Select(s => s.Index).ToHashSet();
                var slot = Enumerable.Range(0, world.GetCapacity(store)).First(i => !used.Contains(i));
                return new ConfigureRetailSlotAction(store.Id, slot, fill.Product.Id, price, restock);
            }
        }

        // 2. A new store.
        (BuildingTypeId Type, CityId City, Product First, decimal Ebit, double Location)? bestStore = null;
        foreach (var city in cities)
        {
            foreach (var typeId in products.Select(p => StoreTypeFor(world, p)).OfType<BuildingTypeId>().Distinct().OrderBy(t => t.Value, StringComparer.Ordinal))
            {
                var type = world.Catalog.BuildingType(typeId);
                // Under land rules the store goes on the site the auto-siting Construct picks, so its
                // lines are valued at that site's location factor (E1 x E3b), not at an average site:
                // at hard difficulty (incumbents x1.4) only good sites pay, and an average-site
                // estimate left every AI idle for the whole game.
                var location = 1.0;
                if (world.Rules.Land.Enabled)
                {
                    if (ExpectedSiteLocation(world, actor, typeId, city.Id) is not double l) continue;
                    location = l;
                }

                var candidates = products
                    .Where(p => !served.Contains((city.Id, p.Id)) && RetailMarket.Draw(type, p) > 0)
                    .Select(p => (Product: p, Gross: LineGrossProfit(world, actor, typeId, city.Id, p, location) - SlotStaffCost(world, type, city.Id)))
                    .ToList();
                var lines = candidates
                    .Where(x => x.Gross > 0m && x.Product.Id != requiredProduct)
                    .OrderByDescending(x => x.Gross)
                    .ThenBy(x => x.Product.Id.Value, StringComparer.Ordinal)
                    .ToList();
                if (requiredProduct is ProductId required)
                {
                    var must = candidates.Where(x => x.Product.Id == required).ToList();
                    if (must.Count == 0) continue;
                    lines.Insert(0, must[0]);
                }

                lines = lines.Take(type.MaxUnits).ToList();
                if (lines.Count == 0) continue;
                var capex = type.ConstructionCost;
                var ebit = lines.Sum(x => x.Gross)
                    - NewStoreFixedCosts(world, type, city.Id, 0)
                    - capex / 360m                       // structure depreciation (30 y)
                    - capex * CapitalChargeRate / 12m;
                if (ebit <= 0m || capex / ebit > maxPaybackMonths) continue;
                if (bestStore is null || ebit > bestStore.Value.Ebit) bestStore = (typeId, city.Id, lines[0].Product, ebit, location);
            }
        }

        if (bestStore is not { } build) return null;
        var buildType = world.Catalog.BuildingType(build.Type);
        var newFixed = NewStoreFixedCosts(world, buildType, build.City, 1);
        var entry = EntryPrice(world, actor, build.Type, build.City, build.First, build.Location);
        var sold = PreviewNewLine(world, actor, build.Type, build.City, build.First, entry, build.Location).Sold;
        var target = Math.Max(1, Math.Min(RetailMarket.StockCap(world, buildType, build.First, 1), sold * world.Rules.Market.AiRestockCover));
        var stock = (decimal)target * world.GetImportPrice(build.First.Id);
        if (SiteAndCommitments(world, actor, build.Type, build.City) is not decimal site) return null;
        if (company.Cash < buildType.ConstructionCost + site + stock + (fixedCosts + newFixed) * cushionMonths) return null;
        return new BuildStoreAction(build.Type, build.City, build.First.Id, entry, target);
    }

    /// <summary>
    /// Sell-through repricing (§4.17 fallback, SimpleRetailer): +3 % when the line sold out last
    /// month, −3 % when it sold less than 70 % of what it had, within the price bounds.
    /// </summary>
    public static decimal SellThroughPrice(World world, RetailLine line, Product product)
    {
        var report = world.GetRetailLineReport(line.Building.Id, product.Id);
        var current = line.Price;
        var unitCost = UnitCost(world, line.Building, product.Id);
        var (floor, ceiling) = PriceBounds(world, line.Building.City, product, unitCost);
        if (report is null) return Cents(Math.Clamp(current, floor, ceiling));
        var available = report.Sold + report.EndStock;
        var next = current;
        if (report.SoldOut) next = current * 1.03m;
        else if (available > 0 && report.Sold / available < 0.70) next = current * 0.97m;
        return Cents(Math.Clamp(next, floor, ceiling));
    }

    // ------------------------------------------------------------------ make or buy

    /// <summary>
    /// Estimated full unit cost of making <paramref name="product"/> in <paramref name="city"/> with
    /// imported inputs: inputs at the landed import price + other materials + energy + direct
    /// labour per unit + line equipment over ten years per unit (full utilisation). Raws: their
    /// extraction cash cost + labour + equipment. Null for products that cannot be made.
    /// </summary>
    public static decimal? OwnUnitCost(World world, Product product, CityId city)
    {
        var rules = world.Rules.Market;
        var wageIndex = (decimal)world.Catalog.City(city).WageIndex;
        if (product.Recipe is { } recipe)
        {
            var perMonth = (decimal)(recipe.CyclesPerSlotMonth * recipe.OutputQuantity);
            if (perMonth <= 0m) return null;
            decimal inputs = 0m;
            foreach (var input in recipe.Inputs)
            {
                inputs += world.GetImportPrice(input.ProductId) * (decimal)(input.Quantity / recipe.OutputQuantity);
            }

            var energy = (decimal)recipe.KwhPerUnit * rules.IndustrialPowerPrice;
            var labour = rules.WageProduction * (decimal)recipe.LaborPerSlot * wageIndex / perMonth;
            var equipment = recipe.LineCapex / 120m / perMonth;
            return inputs + recipe.OtherCostPerUnit + energy + labour + equipment;
        }

        if (product.Extraction is { } extraction && extraction.YieldPerSlotPerMonth > 0)
        {
            var perMonth = (decimal)extraction.YieldPerSlotPerMonth;
            var labour = OperatingCosts.Wage(rules, extraction.SourceCategory is "farm" or "plantation" ? StaffRoles.Farm : StaffRoles.Extraction)
                * (decimal)extraction.LaborPerSlot * wageIndex / perMonth;
            return extraction.OtherCostPerUnit + labour + extraction.EquipmentCapex / 144m / perMonth;
        }

        return null;
    }

    /// <summary>
    /// Saving of making instead of importing, as a share of the import price (≥ 0.05 justifies a
    /// plant under the §4.17 integration rule). 0 when the product cannot be made.
    /// </summary>
    public static double MakeSaving(World world, Product product, CityId city)
    {
        var own = OwnUnitCost(world, product, city);
        var import = world.GetImportPrice(product.Id);
        if (own is not decimal cost || import <= 0m) return 0;
        return (double)((import - cost) / import);
    }
}
