using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// A competitive AI that uses all four strategic levers (price, quality via scale,
/// tech via R&amp;D, brand via ads). Each monthly tick it:
/// <list type="number">
///   <item>Reprices every own retail slot to undercut the cheapest competitor (with a wholesale floor).</item>
///   <item>Ensures a TV ad campaign is running at <see cref="AdBudgetPerCity"/> for every market it serves, cutting it if cash is tight.</item>
///   <item>Executes one expansion move per month: fill biggest unserved demand with a new retailer, or once retail is saturated build an R&amp;D center targeting the top-revenue product.</item>
/// </list>
/// </summary>
public sealed class AdaptiveStrategy : IAiStrategy
{
    public decimal AdBudgetPerCity { get; }
    public int CushionMonths { get; }
    public decimal PriceUndercut { get; }
    public decimal SoloMarkup { get; }
    public decimal PriceFloorMultiplier { get; }
    public int MinCashForAdsMultiplier { get; }

    private static readonly BuildingTypeId RetailerType = new("supermarket");
    private static readonly BuildingTypeId ResearchType = new("rd_center");

    public AdaptiveStrategy(
        decimal adBudgetPerCity = 50_000m,
        int cushionMonths = 6,
        decimal priceUndercut = 0.95m,
        decimal soloMarkup = 1.20m,
        decimal priceFloorMultiplier = 1.05m,
        int minCashForAdsMultiplier = 6)
    {
        AdBudgetPerCity = adBudgetPerCity;
        CushionMonths = cushionMonths;
        PriceUndercut = priceUndercut;
        SoloMarkup = soloMarkup;
        PriceFloorMultiplier = priceFloorMultiplier;
        MinCashForAdsMultiplier = minCashForAdsMultiplier;
    }

    public IReadOnlyList<AiAction> Plan(World world, CompanyId actor)
    {
        if (world.Rules.Market.Enabled) return PlanRealistic(world, actor);

        var company = world.Companies[actor];
        var actions = new List<AiAction>();

        AddPriceAdjustments(world, actor, actions);
        AddAdCampaignAdjustments(world, actor, company, actions);

        var expansion = FindBestExpansion(world, actor, company);
        if (expansion is not null) actions.Add(expansion);

        return actions;
    }

    // ------------------------------------------------------ Realistic market rules (econ-audit §4.17)

    /// <summary>
    /// Realistic plan: expected-profit pricing (±5 %/month) and restock from trailing sales on
    /// every line, advertising where the brand lever pays, then one expansion move — a free slot
    /// in an own store, a new store that passes the payback test, or (once retail is placed) an
    /// R&amp;D centre on the top product when the company can carry it for a year.
    /// </summary>
    private IReadOnlyList<AiAction> PlanRealistic(World world, CompanyId actor)
    {
        var actions = new List<AiAction>();
        MarketAi.AddLineMaintenance(world, actor, actions);
        MarketAi.AddAdvertising(world, actor, actions, AdBudgetPerCity, MinCashForAdsMultiplier);

        var expansion = MarketAi.FindRetailExpansion(world, actor, CushionMonths)
            ?? RealisticResearchExpansion(world, actor);
        if (expansion is not null) actions.Add(expansion);
        return actions;
    }

    private AiAction? RealisticResearchExpansion(World world, CompanyId actor)
    {
        if (world.Buildings.Values.Any(b => b.Owner == actor && b.ResearchSlots.Count > 0)) return null;
        var lines = MarketAi.OwnLines(world, actor).ToList();
        if (lines.Count < 3) return null;

        var rdType = world.Catalog.BuildingType(ResearchType);
        var rdFixed = MarketAi.NewStoreFixedCosts(world, rdType, lines[0].Building.City, 1);
        var fixedCosts = world.GetMonthlyFixedCosts(actor);
        if (MarketAi.SiteAndCommitments(world, actor, rdType.Id, lines[0].Building.City) is not decimal site) return null;
        if (world.Companies[actor].Cash < rdType.ConstructionCost + site + (fixedCosts + rdFixed) * 12) return null;

        var top = lines
            .Select(l => (l.Product, Revenue: world.GetRetailLineReport(l.Building.Id, l.Product)?.Revenue ?? 0m))
            .GroupBy(x => x.Product)
            .Select(g => (Product: g.Key, Revenue: g.Sum(x => x.Revenue)))
            .OrderByDescending(x => x.Revenue)
            .ThenBy(x => x.Product.Value, StringComparer.Ordinal)
            .First();
        var city = lines.OrderBy(l => l.Building.City.Value, StringComparer.Ordinal).ThenBy(l => l.Building.Id.Value).First().Building.City;
        return new BuildResearchCenterAction(city, top.Product);
    }

    // ------------------------------------------------------ price adjustments

    private void AddPriceAdjustments(World world, CompanyId actor, List<AiAction> actions)
    {
        var ownedRetailers = world.Buildings.Values
            .Where(b => b.Owner == actor && b.RetailSlots.Count > 0)
            .OrderBy(b => b.Id.Value)
            .ToList();

        foreach (var building in ownedRetailers)
        {
            foreach (var slot in building.RetailSlots.OrderBy(s => s.Index))
            {
                var target = ComputeTargetPrice(world, actor, building.City, slot.Product);
                if (Math.Abs(target - slot.Price) >= 0.01m)
                {
                    actions.Add(new AdjustRetailPriceAction(building.Id, slot.Index, target));
                }
            }
        }
    }

    private decimal ComputeTargetPrice(World world, CompanyId actor, CityId city, ProductId product)
    {
        var worldPrice = (decimal)world.Catalog.Product(product).BaseWorldMarketPrice;

        var competitorPrices = world.Buildings.Values
            .Where(b => b.Owner != actor && b.City == city)
            .SelectMany(b => b.RetailSlots.Where(s => s.Product == product))
            .Select(s => s.Price)
            .ToList();

        if (competitorPrices.Count == 0) return worldPrice * SoloMarkup;

        var undercut = competitorPrices.Min() * PriceUndercut;
        var floor = worldPrice * PriceFloorMultiplier;
        return undercut > floor ? undercut : floor;
    }

    // ------------------------------------------------------ ad campaign adjustments

    private void AddAdCampaignAdjustments(World world, CompanyId actor, Company company, List<AiAction> actions)
    {
        var servedMarkets = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .SelectMany(b => b.RetailSlots.Select(s => (b.City, s.Product)))
            .Distinct()
            .OrderBy(x => x.City.Value, StringComparer.Ordinal)
            .ThenBy(x => x.Product.Value, StringComparer.Ordinal)
            .ToList();

        var cashCushionOk = company.Cash >= AdBudgetPerCity * MinCashForAdsMultiplier;

        foreach (var (city, product) in servedMarkets)
        {
            // Only spend on ads where there's a competitor to fight for share. In a
            // monopoly market the brand lift earns nothing — the AI already sells
            // everything it can stock.
            var contested = world.Buildings.Values.Any(b =>
                b.Owner != actor && b.City == city && b.RetailSlots.Any(s => s.Product == product));

            var targetBudget = (contested && cashCushionOk) ? AdBudgetPerCity : 0m;

            var existing = world.GetAdCampaign(actor, product, city, AdChannel.TV);
            var currentBudget = existing?.MonthlyBudget ?? 0m;
            if (currentBudget != targetBudget)
            {
                actions.Add(new SetAdCampaignAction(product, city, AdChannel.TV, targetBudget));
            }
        }
    }

    // ------------------------------------------------------ expansion

    private AiAction? FindBestExpansion(World world, CompanyId actor, Company company)
    {
        var ownedMarkets = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .SelectMany(b => b.RetailSlots.Select(s => (b.City, s.Product)))
            .ToHashSet();

        // 1. Try to build a retailer for the biggest unserved finished-product demand.
        var retailExpansion = FindBestRetailExpansion(world, actor, company, ownedMarkets);
        if (retailExpansion is not null) return retailExpansion;

        // 2. Retail saturated (or unaffordable). Consider building an R&D center.
        var researchExpansion = FindBestResearchExpansion(world, actor, company, ownedMarkets);
        return researchExpansion;
    }

    private AiAction? FindBestRetailExpansion(
        World world,
        CompanyId actor,
        Company company,
        HashSet<(CityId City, ProductId Product)> ownedMarkets)
    {
        var retailerType = world.Catalog.BuildingType(RetailerType);
        var cushion = retailerType.ConstructionCost + MarketAi.ConstructionCommitments(world, actor) + retailerType.MonthlyOperatingCost * CushionMonths;
        if (company.Cash < cushion) return null;

        var opportunities = new List<(CityId City, ProductId Product, double Demand)>();
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

        if (opportunities.Count == 0) return null;

        var best = opportunities.OrderByDescending(o => o.Demand).First();
        var price = DetermineEntryPrice(world, actor, best.City, best.Product);

        var existingRetailerCount = world.Buildings.Values
            .Count(b => b.City == best.City && b.RetailSlots.Any(s => s.Product == best.Product));
        var expectedShare = 1.0 / (existingRetailerCount + 1);
        var restockTarget = best.Demand * expectedShare * 1.2;

        return new BuildRetailerAction(RetailerType, best.City, best.Product, price, restockTarget);
    }

    private AiAction? FindBestResearchExpansion(
        World world,
        CompanyId actor,
        Company company,
        HashSet<(CityId City, ProductId Product)> ownedMarkets)
    {
        // Don't build a second R&D center for the MVP strategy.
        var alreadyHasRd = world.Buildings.Values
            .Any(b => b.Owner == actor && b.ResearchSlots.Count > 0);
        if (alreadyHasRd) return null;
        if (ownedMarkets.Count == 0) return null;

        var rdType = world.Catalog.BuildingType(ResearchType);
        var cushion = rdType.ConstructionCost + MarketAi.ConstructionCommitments(world, actor) + rdType.MonthlyOperatingCost * CushionMonths;
        if (company.Cash < cushion) return null;

        // Research the highest-selling product this company has.
        var topProduct = ownedMarkets
            .Select(m => m.Product)
            .Distinct()
            .OrderBy(p => p.Value, StringComparer.Ordinal)
            .Select(p => (Product: p, Revenue: RevenueFor(world, actor, p)))
            .OrderByDescending(x => x.Revenue)
            .ThenBy(x => x.Product.Value, StringComparer.Ordinal)
            .FirstOrDefault();

        if (topProduct.Product.Value is null) return null;

        // Pick a city where this company operates — first in ordinal order for determinism.
        var rdCity = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .OrderBy(b => b.City.Value, StringComparer.Ordinal)
            .ThenBy(b => b.Id.Value)
            .First().City;

        return new BuildResearchCenterAction(rdCity, topProduct.Product);
    }

    private static decimal RevenueFor(World world, CompanyId actor, ProductId product)
        => world.Ledger.EntriesFor(actor)
            .Where(e => e.Product == product
                     && (e.Category == LedgerCategory.ProductSale || e.Category == LedgerCategory.ExportSale))
            .Sum(e => e.Amount);

    private decimal DetermineEntryPrice(World world, CompanyId actor, CityId city, ProductId product)
    {
        var worldPrice = (decimal)world.Catalog.Product(product).BaseWorldMarketPrice;

        var competitorPrices = world.Buildings.Values
            .Where(b => b.Owner != actor && b.City == city)
            .SelectMany(b => b.RetailSlots.Where(s => s.Product == product))
            .Select(s => s.Price)
            .ToList();

        if (competitorPrices.Count == 0) return worldPrice * SoloMarkup;

        var undercut = competitorPrices.Min() * PriceUndercut;
        var floor = worldPrice * PriceFloorMultiplier;
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
