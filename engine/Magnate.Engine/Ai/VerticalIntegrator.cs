using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// Competitor archetype that builds the full supply chain: raw producer →
/// factory → retailer, supplying itself through <see cref="MaterialProcurement"/>.
/// Where <see cref="AdaptiveStrategy"/> is a pure retailer that always buys
/// wholesale, the <see cref="VerticalIntegrator"/> keeps its COGS in-house.
///
/// Each monthly tick the strategy:
/// <list type="number">
///   <item>Reprices every own retail slot to undercut the cheapest competitor (with a wholesale floor).</item>
///   <item>Runs a flat-budget TV campaign in every contested market it serves (no fancy cash cushion check — vertical chains are already capital-hungry).</item>
///   <item>Executes one expansion move: first retailer, then factory supplying it, then upstream raw producer, then fill adjacent retail slots, then repeat the chain for the next-best market.</item>
/// </list>
/// </summary>
public sealed class VerticalIntegrator : IAiStrategy
{
    public int CushionMonths { get; }
    public decimal PriceUndercut { get; }
    public decimal SoloMarkup { get; }
    public decimal PriceFloorMultiplier { get; }
    public decimal AdBudgetPerCity { get; }

    private static readonly BuildingTypeId RetailerType = new("supermarket");
    private static readonly BuildingTypeId FactorySmall = new("factory_small");
    private static readonly BuildingTypeId FactoryLarge = new("factory_large");
    private const decimal LargeFactoryCashThreshold = 15_000_000m;

    // Extraction category → building type. Map every known raw source category
    // to the cheapest producer building in that category.
    private static readonly Dictionary<string, BuildingTypeId> ExtractorForCategory = new()
    {
        ["farm"]       = new BuildingTypeId("small_farm"),
        ["plantation"] = new BuildingTypeId("small_plantation"),
        ["mine"]       = new BuildingTypeId("iron_mine"),
        ["oil_well"]   = new BuildingTypeId("oil_well"),
    };

    public VerticalIntegrator(
        int cushionMonths = 6,
        decimal priceUndercut = 0.95m,
        decimal soloMarkup = 1.20m,
        decimal priceFloorMultiplier = 1.05m,
        decimal adBudgetPerCity = 40_000m)
    {
        CushionMonths = cushionMonths;
        PriceUndercut = priceUndercut;
        SoloMarkup = soloMarkup;
        PriceFloorMultiplier = priceFloorMultiplier;
        AdBudgetPerCity = adBudgetPerCity;
    }

    public IReadOnlyList<AiAction> Plan(World world, CompanyId actor)
    {
        if (world.Rules.Market.Enabled) return PlanRealistic(world, actor);

        var company = world.Companies[actor];
        var actions = new List<AiAction>();

        AddPriceAdjustments(world, actor, actions);
        AddAdCampaignAdjustments(world, actor, actions);

        var expansion = FindBestExpansion(world, actor, company);
        if (expansion is not null) actions.Add(expansion);

        return actions;
    }

    // -------------------------------------------------------- Realistic market rules (econ-audit §4.17)

    /// <summary>Minimum make-vs-buy saving (share of the import price) that justifies a plant.</summary>
    public const double MinIntegrationSaving = 0.05;

    /// <summary>
    /// Realistic plan: expected-profit pricing and trailing-sales restock on every line, the
    /// advertising rule, auto-export only where the export netback covers the full unit cost, then
    /// one expansion move: a first store; a factory for the flagship product when making it saves
    /// ≥ 5 % against importing and the company can carry it; upstream plants on the same test;
    /// otherwise more retail.
    /// </summary>
    private IReadOnlyList<AiAction> PlanRealistic(World world, CompanyId actor)
    {
        var actions = new List<AiAction>();
        MarketAi.AddLineMaintenance(world, actor, actions);
        MarketAi.AddAdvertising(world, actor, actions, AdBudgetPerCity, CushionMonths);
        AddExportDecisions(world, actor, actions);

        var expansion = RealisticExpansion(world, actor);
        if (expansion is not null) actions.Add(expansion);
        return actions;
    }

    private static void AddExportDecisions(World world, CompanyId actor, List<AiAction> actions)
    {
        foreach (var plant in world.Buildings.Values
            .Where(b => b.Owner == actor && (b.ProductionSlots.Count > 0 || b.ExtractionSlots.Count > 0))
            .OrderBy(b => b.Id.Value))
        {
            var outputs = plant.ProductionSlots.Select(s => s.Product).Concat(plant.ExtractionSlots.Select(s => s.Product)).Distinct().ToList();
            var export = outputs.Count > 0 && outputs.All(p =>
            {
                var product = world.Catalog.Product(p);
                if (!product.Trade.Exportable) return false;
                var volume = (world.GetLastExport(p)?.Volume ?? 0) + plant.Inventory.Get(p);
                var netback = world.GetExportPrice(p, volume);
                var fullCost = MarketAi.OwnUnitCost(world, product, plant.City) ?? decimal.MaxValue;
                return netback >= fullCost;
            });
            if (plant.AutoExport != export) actions.Add(new SetAutoExportAction(plant.Id, export));
        }
    }

    private AiAction? RealisticExpansion(World world, CompanyId actor)
    {
        var lines = MarketAi.OwnLines(world, actor).ToList();
        if (lines.Count == 0) return MarketAi.FindRetailExpansion(world, actor, CushionMonths);

        // Flagship: the line with the most revenue last month (ties: product, city ordinal).
        var flagship = lines
            .Where(l => world.Catalog.Product(l.Product).Recipe is not null)
            .Select(l => (Line: l, Revenue: world.GetRetailLineReport(l.Building.Id, l.Product)?.Revenue ?? 0m))
            .OrderByDescending(x => x.Revenue)
            .ThenBy(x => x.Line.Product.Value, StringComparer.Ordinal)
            .ThenBy(x => x.Line.Building.City.Value, StringComparer.Ordinal)
            .Select(x => x.Line)
            .FirstOrDefault();

        if (flagship is not null)
        {
            // Own demand for the flagship: trailing sales of every own line selling it.
            var demand = lines.Where(l => l.Product == flagship.Product).Sum(l => world.GetTrailingLineSales(l.Building.Id, l.Product));
            var plant = NextPlant(world, actor, world.Catalog.Product(flagship.Product), flagship.Building.City, depth: 0, demand, 0m);
            if (plant is not null) return plant;
        }

        return MarketAi.FindRetailExpansion(world, actor, CushionMonths);
    }

    /// <summary>Minimum expected utilisation of a new plant (econ-audit T7: ROIC collapses below ~70 %).</summary>
    public const double MinPlantUtilisation = 0.70;

    /// <summary>
    /// The next plant of the chain below <paramref name="product"/>: its own factory first, then
    /// (one level at a time) inputs. A plant is built only when (a) making saves ≥ 5 % — of the
    /// import price for the flagship product, of the downstream line's material cost for an input
    /// (§4.17) — and (b) it would run at ≥ 70 % utilisation on own demand <paramref name="demand"/>
    /// (units/month), or its surplus can be exported at a netback covering the full unit cost.
    /// </summary>
    private AiAction? NextPlant(World world, CompanyId actor, Product product, CityId city, int depth, double demand, decimal downstreamMaterialCost)
    {
        if (depth > 3) return null;
        var makes = product.Recipe is not null ? HasFactoryFor(world, actor, product.Id) : HasExtractorFor(world, actor, product.Id);
        if (!makes)
        {
            var own = MarketAi.OwnUnitCost(world, product, city);
            if (own is not decimal ownCost) return null;
            var import = world.GetImportPrice(product.Id);
            var saving = depth == 0
                ? (double)((import - ownCost) / Math.Max(import, 1e-9m))
                : (double)((import - ownCost) * (decimal)demand / Math.Max(downstreamMaterialCost, 1e-9m));
            if (saving < MinIntegrationSaving) return null;

            var output = product.Recipe is not null
                ? product.Recipe.CyclesPerSlotMonth * product.Recipe.OutputQuantity
                : product.Extraction?.YieldPerSlotPerMonth ?? 0;
            if (!(output > 0)) return null;
            if (demand / output < MinPlantUtilisation)
            {
                var surplus = output - demand;
                var netback = world.GetExportPrice(product.Id, (world.GetLastExport(product.Id)?.Volume ?? 0) + surplus);
                if (!product.Trade.Exportable || netback < ownCost) return null;
            }

            return product.Recipe is not null
                ? AffordablePlant(world, actor, FactorySmall, city, product, product.Recipe.LineCapex, isExtraction: false)
                : BuildRealisticExtractor(world, actor, product, city);
        }

        if (product.Recipe is not { } recipe) return null;
        // Monthly demand for each input = this plant's monthly output × input per unit.
        var plantOutput = recipe.CyclesPerSlotMonth * recipe.OutputQuantity
            * world.Buildings.Values.Where(b => b.Owner == actor).Sum(b => b.ProductionSlots.Count(s => s.Product == product.Id));
        decimal material = recipe.OtherCostPerUnit;
        foreach (var input in recipe.Inputs)
        {
            material += world.GetImportPrice(input.ProductId) * (decimal)(input.Quantity / recipe.OutputQuantity);
        }

        material *= (decimal)plantOutput;
        foreach (var input in recipe.Inputs.OrderBy(i => i.ProductId.Value, StringComparer.Ordinal))
        {
            var need = plantOutput * input.Quantity / recipe.OutputQuantity;
            var next = NextPlant(world, actor, world.Catalog.Product(input.ProductId), city, depth + 1, need, material);
            if (next is not null) return next;
        }

        return null;
    }

    private AiAction? BuildRealisticExtractor(World world, CompanyId actor, Product raw, CityId preferred)
    {
        if (raw.Extraction is null) return null;
        if (!ExtractorForCategory.TryGetValue(raw.Extraction.SourceCategory, out var typeId)) return null;
        var type = world.Catalog.BuildingType(typeId);
        var city = world.Catalog.Cities.Values
            .OrderBy(c => c.Id == preferred ? 0 : 1)
            .ThenBy(c => c.Id.Value, StringComparer.Ordinal)
            .FirstOrDefault(c => world.MeetsGeographyRequirement(typeId, c.Id));
        if (city is null) return null;
        _ = type;
        return AffordablePlant(world, actor, typeId, city.Id, raw, raw.Extraction.EquipmentCapex, isExtraction: true);
    }

    private AiAction? AffordablePlant(World world, CompanyId actor, BuildingTypeId typeId, CityId city, Product product, decimal equipment, bool isExtraction)
    {
        var type = world.Catalog.BuildingType(typeId);
        var newFixed = MarketAi.NewStoreFixedCosts(world, type, city, 0);
        if (MarketAi.SiteAndCommitments(world, actor, typeId, city) is not decimal site) return null;
        var need = type.ConstructionCost + site + equipment + (world.GetMonthlyFixedCosts(actor) + newFixed) * CushionMonths;
        if (world.Companies[actor].Cash < need) return null;
        return new BuildPlantAction(typeId, city, product.Id, isExtraction);
    }

    // -------------------------------------------------------- price adjustments

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

    // -------------------------------------------------------- ad campaigns

    private void AddAdCampaignAdjustments(World world, CompanyId actor, List<AiAction> actions)
    {
        // Dedupe per (city, product) — only one TV campaign per market, and only
        // if at least one competitor sells the same product in the same city.
        var servedMarkets = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .SelectMany(b => b.RetailSlots.Select(s => (b.City, s.Product)))
            .Distinct()
            .OrderBy(x => x.City.Value, StringComparer.Ordinal)
            .ThenBy(x => x.Product.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var (city, product) in servedMarkets)
        {
            var contested = world.Buildings.Values.Any(b =>
                b.Owner != actor && b.City == city && b.RetailSlots.Any(s => s.Product == product));

            var targetBudget = contested ? AdBudgetPerCity : 0m;

            var existing = world.GetAdCampaign(actor, product, city, AdChannel.TV);
            var currentBudget = existing?.MonthlyBudget ?? 0m;
            if (currentBudget != targetBudget)
            {
                actions.Add(new SetAdCampaignAction(product, city, AdChannel.TV, targetBudget));
            }
        }
    }

    // -------------------------------------------------------- expansion

    private AiAction? FindBestExpansion(World world, CompanyId actor, Company company)
    {
        var ownedMarkets = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .SelectMany(b => b.RetailSlots.Select(s => (b.City, s.Product)))
            .ToHashSet();

        var ownedRetailers = world.Buildings.Values
            .Where(b => b.Owner == actor && b.RetailSlots.Count > 0)
            .ToList();

        // Step 1: no retailer yet — build one in the biggest unserved finished-goods market.
        if (ownedRetailers.Count == 0)
        {
            return FindBestRetailExpansion(world, actor, company, ownedMarkets);
        }

        // Step 2+: we have ≥1 retailer. Determine the "flagship" product chain
        // by picking the retailed product with the largest demand in the cities
        // we already operate. Everything downstream (factory, extractor) is sized
        // to feed this product in the flagship city.
        var flagship = ChooseFlagshipChain(world, actor, ownedRetailers);
        if (flagship is null)
        {
            // No finished-goods recipe in our retail slots — unusual, but fall
            // back to retail expansion so we don't freeze.
            return FindBestRetailExpansion(world, actor, company, ownedMarkets);
        }

        // Step 2: build factory for the flagship finished product if we don't have one.
        if (!HasFactoryFor(world, actor, flagship.Product))
        {
            var factoryAction = BuildFactoryFor(world, actor, company, flagship.Product, flagship.City);
            if (factoryAction is not null) return factoryAction;
        }
        else
        {
            // Step 3: factory exists — ensure every recipe input is produced in-house.
            // Walk one level of the recipe tree: for intermediates we also need a
            // factory, for raws we need an extractor.
            var upstreamAction = BuildNextUpstream(world, actor, company, flagship.Product, flagship.City);
            if (upstreamAction is not null) return upstreamAction;
        }

        // Step 4: top of the chain is satisfied — broaden the footprint.
        // Prefer filling an adjacent retail slot in an existing retailer (cheap;
        // uses the same building) before spinning up a whole new market.
        var adjacentSlotAction = FillAdjacentRetailSlot(world, actor, company, ownedRetailers, ownedMarkets);
        if (adjacentSlotAction is not null) return adjacentSlotAction;

        return FindBestRetailExpansion(world, actor, company, ownedMarkets);
    }

    private sealed record FlagshipChain(ProductId Product, CityId City);

    private static FlagshipChain? ChooseFlagshipChain(World world, CompanyId actor, List<BuildingInstance> ownedRetailers)
    {
        // Pick the (city, product) slot with the largest computed city demand among
        // our retail slots. Deterministic: tie-break by product id then city id.
        FlagshipChain? best = null;
        double bestDemand = -1;
        foreach (var retailer in ownedRetailers.OrderBy(b => b.Id.Value))
        {
            var city = world.Catalog.City(retailer.City);
            foreach (var slot in retailer.RetailSlots.OrderBy(s => s.Index))
            {
                var prod = world.Catalog.Product(slot.Product);
                if (prod.Recipe is null) continue; // only products we can actually manufacture
                var demand = ComputeCityDemand(city, prod);
                if (demand > bestDemand
                    || (demand == bestDemand && best is not null
                        && (StringComparer.Ordinal.Compare(slot.Product.Value, best.Product.Value) < 0
                           || (slot.Product == best.Product
                               && StringComparer.Ordinal.Compare(retailer.City.Value, best.City.Value) < 0))))
                {
                    bestDemand = demand;
                    best = new FlagshipChain(slot.Product, retailer.City);
                }
            }
        }
        return best;
    }

    private static bool HasFactoryFor(World world, CompanyId actor, ProductId product)
        => world.Buildings.Values.Any(b =>
            b.Owner == actor
            && b.ProductionSlots.Any(s => s.Product == product));

    private static bool HasExtractorFor(World world, CompanyId actor, ProductId product)
        => world.Buildings.Values.Any(b =>
            b.Owner == actor
            && b.ExtractionSlots.Any(s => s.Product == product));

    private AiAction? BuildFactoryFor(World world, CompanyId actor, Company company, ProductId product, CityId city)
    {
        var typeId = company.Cash > LargeFactoryCashThreshold ? FactoryLarge : FactorySmall;
        var type = world.Catalog.BuildingType(typeId);
        var cushion = type.ConstructionCost + MarketAi.ConstructionCommitments(world, actor) + type.MonthlyOperatingCost * CushionMonths;
        if (company.Cash < cushion) return null;
        return new BuildProducerAction(typeId, city, product, IsExtraction: false);
    }

    private AiAction? BuildNextUpstream(World world, CompanyId actor, Company company, ProductId finishedProduct, CityId anchorCity)
    {
        var product = world.Catalog.Product(finishedProduct);
        if (product.Recipe is null) return null;

        // Enumerate recipe inputs in a deterministic order.
        foreach (var input in product.Recipe.Inputs.OrderBy(i => i.ProductId.Value, StringComparer.Ordinal))
        {
            var inputProd = world.Catalog.Product(input.ProductId);

            if (inputProd.Tier == ProductTier.Raw)
            {
                if (HasExtractorFor(world, actor, input.ProductId)) continue;
                var extractorAction = BuildExtractorFor(world, actor, company, inputProd, anchorCity);
                if (extractorAction is not null) return extractorAction;
                continue; // can't afford this one; try the next input.
            }

            // Intermediate — needs its own factory, and recursively its own raws.
            if (!HasFactoryFor(world, actor, input.ProductId))
            {
                var factoryAction = BuildFactoryFor(world, actor, company, input.ProductId, anchorCity);
                if (factoryAction is not null) return factoryAction;
                continue;
            }

            // Have the intermediate factory; now walk one level further.
            var deeper = BuildNextUpstream(world, actor, company, input.ProductId, anchorCity);
            if (deeper is not null) return deeper;
        }

        return null;
    }

    private AiAction? BuildExtractorFor(World world, CompanyId actor, Company company, Product rawProduct, CityId preferredCity)
    {
        if (rawProduct.Extraction is null) return null;
        if (!ExtractorForCategory.TryGetValue(rawProduct.Extraction.SourceCategory, out var typeId)) return null;

        var type = world.Catalog.BuildingType(typeId);
        var cushion = type.ConstructionCost + MarketAi.ConstructionCommitments(world, actor) + type.MonthlyOperatingCost * CushionMonths;
        if (company.Cash < cushion) return null;

        // Prefer the anchor city if its geography supports the building; otherwise
        // pick the first city in ordinal order that does. Geography validation at
        // runtime is advisory (Phase 3 has no hard gate), but respecting it keeps
        // behaviour plausible and matches the content designers' intent.
        var cityId = ChooseProducerCity(world, preferredCity, rawProduct.Extraction.SourceCategory);
        return new BuildProducerAction(typeId, cityId, rawProduct.Id, IsExtraction: true);
    }

    private static CityId ChooseProducerCity(World world, CityId preferred, string sourceCategory)
    {
        bool Supports(City c) => sourceCategory switch
        {
            "farm"       => c.Geography.Arable,
            "plantation" => c.Geography.Arable,
            "mine"       => c.Geography.MineralRich,
            "oil_well"   => c.Geography.OilRich,
            _            => true,
        };

        var preferredCity = world.Catalog.City(preferred);
        if (Supports(preferredCity)) return preferred;

        var fallback = world.Catalog.Cities.Values
            .Where(Supports)
            .OrderBy(c => c.Id.Value, StringComparer.Ordinal)
            .FirstOrDefault();
        return fallback?.Id ?? preferred;
    }

    private AiAction? FillAdjacentRetailSlot(
        World world,
        CompanyId actor,
        Company company,
        List<BuildingInstance> ownedRetailers,
        HashSet<(CityId City, ProductId Product)> ownedMarkets)
    {
        foreach (var retailer in ownedRetailers.OrderBy(b => b.Id.Value))
        {
            var type = world.Catalog.BuildingType(retailer.TypeId);
            if (retailer.RetailSlots.Count >= type.MaxUnits) continue;

            var city = world.Catalog.City(retailer.City);
            // Pick the highest-demand finished product we don't already retail in this city.
            var candidate = world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Finished)
                .Where(p => !ownedMarkets.Contains((retailer.City, p.Id)))
                .Select(p => (Product: p, Demand: ComputeCityDemand(city, p)))
                .Where(x => x.Demand > 0)
                .OrderByDescending(x => x.Demand)
                .ThenBy(x => x.Product.Id.Value, StringComparer.Ordinal)
                .FirstOrDefault();

            if (candidate.Product is null) continue;

            var usedIndices = retailer.RetailSlots.Select(s => s.Index).ToHashSet();
            var slotIndex = Enumerable.Range(0, type.MaxUnits).First(i => !usedIndices.Contains(i));

            var price = ComputeTargetPrice(world, actor, retailer.City, candidate.Product.Id);

            var existingRetailerCount = world.Buildings.Values
                .Count(b => b.City == retailer.City && b.RetailSlots.Any(s => s.Product == candidate.Product.Id));
            var expectedShare = 1.0 / (existingRetailerCount + 1);
            var restockTarget = candidate.Demand * expectedShare * 1.2;

            return new ConfigureRetailSlotAction(retailer.Id, slotIndex, candidate.Product.Id, price, restockTarget);
        }
        return null;
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
        var price = ComputeTargetPrice(world, actor, best.City, best.Product);

        var existingRetailerCount = world.Buildings.Values
            .Count(b => b.City == best.City && b.RetailSlots.Any(s => s.Product == best.Product));
        var expectedShare = 1.0 / (existingRetailerCount + 1);
        var restockTarget = best.Demand * expectedShare * 1.2;

        return new BuildRetailerAction(RetailerType, best.City, best.Product, price, restockTarget);
    }

    // -------------------------------------------------------- shared math
    // (Copied from AdaptiveStrategy per Phase 3.23 brief — keeping VI self-contained
    //  means we can tune its pricing/demand heuristics independently.)

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

// ============================================================================
// New AiAction variants needed by VerticalIntegrator. Defined in this file so
// Phase 3.23 stays contained to its owned files.
// ============================================================================

/// <summary>
/// Construct a factory or extractor and configure its first slot. Used by the
/// <see cref="VerticalIntegrator"/> to spin up supply-chain buildings.
/// </summary>
public sealed record BuildProducerAction(
    BuildingTypeId Type,
    CityId City,
    ProductId Product,
    bool IsExtraction) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        var building = world.Construct(actor, Type, City);
        if (IsExtraction)
        {
            world.ConfigureExtractionSlot(building.Id, 0, Product);
        }
        else
        {
            world.ConfigureProductionSlot(building.Id, 0, Product);
        }
    }
}

/// <summary>
/// Add or replace a retail slot on an existing building. Silently skips if the
/// building doesn't exist, isn't owned by the acting company, or the slot
/// index is out of range for the building type.
/// </summary>
public sealed record ConfigureRetailSlotAction(
    BuildingInstanceId Retailer,
    int SlotIndex,
    ProductId Product,
    decimal Price,
    double RestockTarget) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        if (!world.Buildings.TryGetValue(Retailer, out var building)) return;
        if (building.Owner != actor) return;
        world.ConfigureRetailSlot(Retailer, SlotIndex, Product, Price, RestockTarget);
    }
}
