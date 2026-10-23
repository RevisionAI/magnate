using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// MVP utility-AI: each month, pick the (city, product) pair with biggest unmet
/// demand that this AI doesn't yet serve, build a supermarket there, and price
/// to undercut the cheapest competitor (with a floor at 5% over wholesale).
/// </summary>
/// <remarks>
/// Chosen for Phase 1.4 because it produces visible competitive pressure without
/// any of the more advanced systems (factories, advertising, R&amp;D) we haven't
/// built yet. Future strategies can mix and match more action types.
/// </remarks>
public sealed class SimpleRetailerStrategy : IAiStrategy
{
    private readonly decimal _soloMarkup;
    private readonly decimal _undercutFactor;
    private readonly int _cushionMonths;
    private readonly BuildingTypeId _retailerType;

    /// <summary>Create the strategy; every tunable has the pre-overhaul default.</summary>
    public SimpleRetailerStrategy(
        decimal soloMarkup = 1.20m,
        decimal undercutFactor = 0.95m,
        int cushionMonths = 6,
        string retailerTypeId = "supermarket")
    {
        _soloMarkup = soloMarkup;
        _undercutFactor = undercutFactor;
        _cushionMonths = cushionMonths;
        _retailerType = new BuildingTypeId(retailerTypeId);
    }

    /// <summary>Markup over the world price when entering a market with no competitor.</summary>
    public decimal SoloMarkup => _soloMarkup;

    /// <summary>Multiplier applied to the cheapest competitor's price when entering a contested market.</summary>
    public decimal UndercutFactor => _undercutFactor;

    /// <summary>Months of the retailer's opex the AI keeps in cash on top of the construction cost.</summary>
    public int CushionMonths => _cushionMonths;

    /// <summary>Retail building type the AI builds.</summary>
    public BuildingTypeId RetailerTypeId => _retailerType;

    /// <inheritdoc/>
    public IReadOnlyList<AiAction> Plan(World world, CompanyId actor)
    {
        if (world.Rules.Market.Enabled) return PlanRealistic(world, actor);

        var company = world.Companies[actor];
        var retailerType = world.Catalog.BuildingType(_retailerType);

        var ownedMarkets = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .SelectMany(b => b.RetailSlots.Select(s => (b.City, s.Product)))
            .ToHashSet();

        // Enumerate (city, product) opportunities in deterministic order.
        var opportunities = new List<(CityId city, ProductId product, double demand)>();
        foreach (var city in world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            foreach (var product in world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Finished)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal))
            {
                if (ownedMarkets.Contains((city.Id, product.Id))) continue;
                var demand = ComputeCityDemand(city, product);
                if (demand <= 0) continue;
                opportunities.Add((city.Id, product.Id, demand));
            }
        }

        if (opportunities.Count == 0) return Array.Empty<AiAction>();

        // Pick biggest unmet demand. LINQ OrderByDescending is stable, so the deterministic
        // enumeration order above resolves ties.
        var best = opportunities.OrderByDescending(o => o.demand).First();

        // Affordability check: construction + a few months of opex cushion.
        var cushion = retailerType.ConstructionCost
            + MarketAi.ConstructionCommitments(world, actor)
            + retailerType.MonthlyOperatingCost * _cushionMonths;
        if (company.Cash < cushion)
        {
            return Array.Empty<AiAction>();
        }

        var price = DetermineEntryPrice(world, best.city, best.product);

        // Size restock to expected share, not raw demand — otherwise we drown in
        // unsold inventory whenever competitors exist.
        var existingRetailerCount = world.Buildings.Values
            .Count(b => b.City == best.city && b.RetailSlots.Any(s => s.Product == best.product));
        var expectedShare = 1.0 / (existingRetailerCount + 1);
        var restockTarget = best.demand * expectedShare * 1.2;

        return new AiAction[]
        {
            new BuildRetailerAction(_retailerType, best.city, best.product, price, restockTarget),
        };
    }

    /// <summary>
    /// Realistic plan (econ-audit §4.17): monthly sell-through repricing (+3 % sold out, −3 % below
    /// 70 % sell-through) and restock from trailing sales on every line, then one expansion move
    /// (free slot first, then a store that passes the payback test). No advertising.
    /// </summary>
    private IReadOnlyList<AiAction> PlanRealistic(World world, CompanyId actor)
    {
        var actions = new List<AiAction>();
        MarketAi.AddLineMaintenance(world, actor, actions, (line, product) => MarketAi.SellThroughPrice(world, line, product));
        var expansion = MarketAi.FindRetailExpansion(world, actor, _cushionMonths);
        if (expansion is not null) actions.Add(expansion);
        return actions;
    }

    private decimal DetermineEntryPrice(World world, CityId city, ProductId product)
    {
        var prod = world.Catalog.Product(product);
        var worldPrice = (decimal)prod.BaseWorldMarketPrice;

        var competitorPrices = world.Buildings.Values
            .Where(b => b.City == city)
            .SelectMany(b => b.RetailSlots
                .Where(s => s.Product == product)
                .Select(s => s.Price))
            .ToList();

        if (competitorPrices.Count == 0)
        {
            return worldPrice * _soloMarkup;
        }

        var minCompetitor = competitorPrices.Min();
        var undercut = minCompetitor * _undercutFactor;
        var floor = worldPrice * 1.05m;
        return undercut > floor ? undercut : floor;
    }

    private static double ComputeCityDemand(City city, Product product)
    {
        if (product.Tier != ProductTier.Finished) return 0;
        double total = 0;
        foreach (var bracket in new[] { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High })
        {
            var share = city.Demographics.TryGetValue(bracket, out var s) ? s : 0;
            var perCapita = product.BaseDemandPerCapita.TryGetValue(bracket, out var d) ? d : 0;
            total += city.Population * share * perCapita;
        }
        return total;
    }
}
