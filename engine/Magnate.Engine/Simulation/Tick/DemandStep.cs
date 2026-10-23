using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 10 (econ-audit §4.16): demand allocation and retail sales.
/// <para>
/// Classic: per (city, finished product) market, each retail slot gets a perceived-value weight
/// <c>max((Q + 10·T + B)/3, 1) / price^elasticity</c>; per income bracket the bracket's demand
/// (<c>population × share × per-capita</c>) is split over the slots priced at or below the
/// bracket's reservation price; each slot sells <c>min(allocated demand, stock on hand)</c>.
/// </para>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, §4.1–4.3): per (city, finished product)
/// market, every store line (a building's merged slots) is one offer of
/// <see cref="Market.DemandModel"/> — lognormal-WTP category demand, logit choice on
/// quality-adjusted price, the permanent incumbent offer, throughput capacity and one spill pass.
/// Each line sells <c>min(demand + spill, stock, capacity)</c> at its price, books
/// <see cref="LedgerCategory.ProductSale"/>, COGS and <see cref="LedgerCategory.RetailVariable"/>
/// costs, and the market's unit sales (incumbents included) feed <see cref="World.GetMarketShare"/>
/// and the line reports the AI restocks from. The same model answers
/// <see cref="World.PreviewDemand"/> (bridge-spec E9).
/// </para>
/// </summary>
internal static class DemandStep
{
    /// <summary>
    /// Stable iteration order over income brackets. Determinism requires this
    /// be ordinal and never reordered — see Phase 3.44.
    /// </summary>
    private static readonly IncomeBracket[] BracketOrder =
    {
        IncomeBracket.Low,
        IncomeBracket.Middle,
        IncomeBracket.High,
    };

    public static void Run(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            AllocateRealistic(ctx);
            return;
        }

        AllocateDemandAndSell(ctx.World);
    }

    private static void AllocateDemandAndSell(World world)
    {
        var markets = new Dictionary<(CityId city, ProductId product), List<(BuildingInstance b, RetailSlot s)>>();

        foreach (var building in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (!building.IsOperational) continue; // land rules (E3b): under construction or retired
            foreach (var slot in building.RetailSlots)
            {
                var key = (building.City, slot.Product);
                if (!markets.TryGetValue(key, out var list))
                {
                    list = new List<(BuildingInstance, RetailSlot)>();
                    markets[key] = list;
                }
                list.Add((building, slot));
            }
        }

        var orderedKeys = markets.Keys
            .OrderBy(k => k.city.Value, StringComparer.Ordinal)
            .ThenBy(k => k.product.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var key in orderedKeys)
        {
            var cityId = key.city;
            var productId = key.product;
            var retailers = markets[key];

            var city = world.Catalog.City(cityId);
            var product = world.Catalog.Product(productId);

            if (product.Tier != ProductTier.Finished) continue;

            var elasticity = product.PriceElasticity > 0 ? product.PriceElasticity : 1.0;

            // Per-retailer perceived-value weights (Phase 2.2) — bracket-independent
            // factors are computed once. Reservation-price gating is the only
            // bracket-specific filter applied per-bracket below.
            //   desirability = (Q + T×10 + B) / 3, floored at 1 so new products still compete
            //   weight       = desirability / price^elasticity
            var weights = new double[retailers.Count];
            for (var i = 0; i < retailers.Count; i++)
            {
                var (b, s) = retailers[i];
                var q = b.Inventory.AverageQuality(productId);
                var t = world.GetTech(b.Owner, productId) * 10.0;
                var br = world.GetBrandAwareness(b.Owner, productId, b.City);
                var desirability = Math.Max((q + t + br) / 3.0, 1.0);

                var price = (double)s.Price;
                weights[i] = desirability / Math.Pow(price, elasticity);
            }

            // Per-bracket allocation (Phase 3.44): for each bracket compute its
            // demand contribution, exclude retailers above its reservation price,
            // softmax over the *allowed* subset, and accumulate into a per-retailer
            // demand total.
            var demandForRetailer = new double[retailers.Count];

            foreach (var bracket in BracketOrder)
            {
                var share = city.Demographics.TryGetValue(bracket, out var sh) ? sh : 0.0;
                if (share <= 0) continue;

                var perCapita = product.BaseDemandPerCapita.TryGetValue(bracket, out var pc) ? pc : 0.0;
                if (perCapita <= 0) continue;

                var bracketDemand = city.Population * share * perCapita;
                if (bracketDemand <= 0) continue;

                var ceiling = ReservationFor(product, bracket);

                // Sum weights only across retailers whose price is at-or-below the ceiling.
                var weightSum = 0.0;
                for (var i = 0; i < retailers.Count; i++)
                {
                    if (retailers[i].s.Price > ceiling) continue;
                    weightSum += weights[i];
                }

                if (weightSum <= 0) continue;

                for (var i = 0; i < retailers.Count; i++)
                {
                    if (retailers[i].s.Price > ceiling) continue;
                    demandForRetailer[i] += bracketDemand * (weights[i] / weightSum);
                }
            }

            for (var i = 0; i < retailers.Count; i++)
            {
                if (demandForRetailer[i] <= 0) continue;

                var (building, slot) = retailers[i];
                var draw = building.Inventory.Take(productId, demandForRetailer[i]);
                if (draw.Quantity <= 0) continue;

                var revenue = (decimal)draw.Quantity * slot.Price;
                world.RecordCashChange(
                    building.Owner,
                    LedgerCategory.ProductSale,
                    revenue,
                    $"sell {draw.Quantity:F2} {productId} @ {building.Id}",
                    productId,
                    building.Id,
                    draw.Quantity);

                world.RecordCogs(building.Owner, productId, draw.Quantity, draw.Cost, building.Id);
            }
        }
    }

    /// <summary>
    /// Resolve a product's reservation price for a given bracket. Returns
    /// <see cref="decimal.MaxValue"/> when no ceiling is configured (null map
    /// or missing bracket key) — i.e. uniform Phase 3.43 behaviour.
    /// </summary>
    private static decimal ReservationFor(Product product, IncomeBracket bracket)
    {
        if (product.ReservationPrice is null) return decimal.MaxValue;
        return product.ReservationPrice.TryGetValue(bracket, out var v) ? v : decimal.MaxValue;
    }

    // ------------------------------------------------------------------ Realistic (§4.1–4.3)

    private static void AllocateRealistic(TickContext ctx)
    {
        var world = ctx.World;
        var state = world.MarketState;
        var month = state.OpenMonth(ctx.Now);

        // Every (city, finished product) market that has demand, in ordinal order. Markets with
        // no store line still record the incumbents' sales so market shares have a denominator.
        foreach (var city in world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            foreach (var product in world.Catalog.Products.Values
                .Where(p => p.Demand is not null)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal))
            {
                SellMarket(world, month, city, product);
            }
        }

        state.PruneLines(ctx.Now);
    }

    private static void SellMarket(World world, MarketMonth month, City city, Product product)
    {
        var lines = RetailMarket.Lines(world, city.Id, product.Id);
        var market = RetailMarket.MarketOf(world, city, product);
        if (lines.Count == 0 && market.IncumbentMass <= 0) return;

        var offers = new DemandOffer[lines.Count];
        for (var i = 0; i < lines.Count; i++) offers[i] = RetailMarket.OfferOf(world, lines[i], product);

        var outcome = DemandModel.Evaluate(market, offers, world.MarketState.Curves);
        var cell = lines.Count > 0 || outcome.IncumbentSold > 0 ? month.Cell(city.Id, product.Id) : null;
        if (cell is not null) cell.IncumbentUnits += outcome.IncumbentSold;

        var rate = world.Rules.Market.RetailVariableRate;
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            var building = line.Building;
            var price = line.Price;
            var units = outcome.Sold[i];
            decimal revenue = 0m;
            double sold = 0;
            if (units > 0)
            {
                var draw = building.Inventory.Take(product.Id, units);
                if (draw.Quantity > 0)
                {
                    sold = draw.Quantity;
                    revenue = (decimal)draw.Quantity * price;
                    world.RecordCashChange(building.Owner, LedgerCategory.ProductSale, revenue,
                        $"sell {draw.Quantity:F2} {product.Id} @ {building.Id}", product.Id, building.Id, draw.Quantity);
                    world.RecordCogs(building.Owner, product.Id, draw.Quantity, draw.Cost, building.Id);

                    var variable = revenue * rate;
                    if (variable > 0m)
                    {
                        world.RecordCashChange(building.Owner, LedgerCategory.RetailVariable, -variable,
                            $"retail variable costs {product.Id} @ {building.Id}", product.Id, building.Id);
                    }

                    var owner = building.Owner.Value;
                    cell!.CompanyUnits[owner] = cell.CompanyUnits.TryGetValue(owner, out var u) ? u + sold : sold;
                }
            }

            world.MarketState.RecordLine(building.Id, product.Id, new RetailLineReport(
                world.Clock.Now,
                price,
                line.Slots.Count,
                RetailMarket.Capacity(line.Type, product, line.Slots.Count),
                outcome.Demand[i],
                sold,
                revenue,
                building.Inventory.Get(product.Id)));
        }
    }
}
