using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// Premium-brand competitor archetype. Picks one "hero" finished product at
/// registration time and channels its capital into Quality + Tech + Brand on
/// that product, accepting higher COGS and a premium retail price. Where
/// <see cref="VerticalIntegrator"/> wins on cost and <see cref="AdaptiveStrategy"/>
/// plays a balanced four-lever game, <see cref="TechLeader"/> bets entirely on
/// the non-price levers — it expects to dominate the softmax via Q+T+B even
/// when its sticker price is well above competitors.
///
/// <para>Each monthly tick the strategy:</para>
/// <list type="number">
///   <item>Identifies its hero product (highest <c>BaseWorldMarketPrice</c> among
///         finished goods, ordinal-tiebroken by id) — the choice is deterministic
///         and pinned for the life of the strategy instance.</item>
///   <item>Reprices every own retail slot selling the hero at
///         <see cref="PremiumMultiplier"/> times the most-expensive competitor
///         price in the same city (with a <see cref="PriceFloorMultiplier"/> ×
///         own-COGS floor). Non-hero slots get the same Adaptive-style undercut
///         math as a fallback so any incidental retailers behave sanely.</item>
///   <item>Runs a flat-budget TV campaign on the hero in every city where it
///         owns a retailer, regardless of contestation —
///         <see cref="TechLeader"/> is building brand, not chasing skirmishes.</item>
///   <item>Ensures at least <see cref="RdCentersTarget"/> R&amp;D centers exist
///         on the hero. If fewer, builds one in the largest-population city
///         the AI hasn't already used for R&amp;D.</item>
///   <item>Otherwise considers retail expansion: only High-bracket-rich cities
///         (<c>Demographics[High] &gt;= </c><see cref="MinHighBracketShare"/>),
///         capped at <see cref="MaxRetailersPerCity"/> per city and
///         <see cref="MaxCities"/> total cities for the hero.</item>
/// </list>
/// <para>Determinism: every iteration over buildings/cities/products is sorted
/// by ordinal id, so identical world states yield identical plans.</para>
/// </summary>
public sealed class TechLeader : IAiStrategy
{
    /// <summary>Target number of R&amp;D centers focused on the hero product.</summary>
    public int RdCentersTarget { get; }
    /// <summary>Hard cap on hero retailers per city.</summary>
    public int MaxRetailersPerCity { get; }
    /// <summary>Hard cap on cities entered for the hero product.</summary>
    public int MaxCities { get; }
    /// <summary>Multiplier applied to the highest competitor price for the hero.</summary>
    public decimal PremiumMultiplier { get; }
    /// <summary>Floor as a multiple of own COGS so a TechLeader never sells below cost.</summary>
    public decimal PriceFloorMultiplier { get; }
    /// <summary>Per-city flat ad budget for hero TV campaigns.</summary>
    public decimal AdBudgetPerCityHero { get; }
    /// <summary>Minimum demographic share for the High bracket required to enter a city.</summary>
    public double MinHighBracketShare { get; }

    private static readonly BuildingTypeId RetailerType = new("supermarket");
    private static readonly BuildingTypeId ResearchType = new("rd_center");

    // Hero product is resolved lazily on first Plan() call against the actual
    // catalog the world is using; we cache it for determinism + perf.
    private ProductId? _hero;

    /// <summary>
    /// Construct a <see cref="TechLeader"/> with optional tunable overrides.
    /// All defaults are tuned for a premium-brand archetype on the canonical
    /// 5-city × 7-finished-good catalog (cars are the natural hero).
    /// </summary>
    public TechLeader(
        int rdCentersTarget = 2,
        int maxRetailersPerCity = 2,
        int maxCities = 3,
        decimal premiumMultiplier = 1.30m,
        decimal priceFloorMultiplier = 1.10m,
        decimal adBudgetPerCityHero = 80_000m,
        double minHighBracketShare = 0.25)
    {
        RdCentersTarget = rdCentersTarget;
        MaxRetailersPerCity = maxRetailersPerCity;
        MaxCities = maxCities;
        PremiumMultiplier = premiumMultiplier;
        PriceFloorMultiplier = priceFloorMultiplier;
        AdBudgetPerCityHero = adBudgetPerCityHero;
        MinHighBracketShare = minHighBracketShare;
    }

    /// <inheritdoc/>
    public IReadOnlyList<AiAction> Plan(World world, CompanyId actor)
    {
        if (world.Rules.Market.Enabled) return PlanRealistic(world, actor);

        var hero = ResolveHero(world);
        var actions = new List<AiAction>();

        AddPriceAdjustments(world, actor, hero, actions);
        AddAdCampaignAdjustments(world, actor, hero, actions);

        // Expansion: prioritise R&D coverage of the hero, then disciplined retail.
        var rdAction = MaybeBuildResearchCenter(world, actor, hero);
        if (rdAction is not null)
        {
            actions.Add(rdAction);
            return actions;
        }

        var retailAction = MaybeOpenHeroRetailer(world, actor, hero);
        if (retailAction is not null) actions.Add(retailAction);

        return actions;
    }

    // ---------------------------------------------------------- Realistic market rules (econ-audit §4.17)

    /// <summary>
    /// Realistic plan. The hero is the most tech-led consumer good. It is priced on value — <c>Pref · M^0.8</c>, where M is the value
    /// multiplier of the hero's own quality, brand and tech — floored at
    /// <see cref="PriceFloorMultiplier"/> × the <em>per-unit</em> cost (fixes F4) and moved at most
    /// ±5 %/month; there is no "most expensive rival × 1.3" rule any more (fixes F3). Other lines
    /// use the expected-profit search. The hero gets TV brand-building up to the budget that
    /// sustains awareness 75 in every hero city; R&amp;D centres are built only when the company can
    /// carry them for a year; hero stores open in high-income cities through the payback test.
    /// </summary>
    private IReadOnlyList<AiAction> PlanRealistic(World world, CompanyId actor)
    {
        var hero = ResolveHero(world);
        var actions = new List<AiAction>();
        MarketAi.AddLineMaintenance(world, actor, actions, (line, product) => product.Id == hero
            ? HeroPrice(world, line, product)
            : MarketAi.ChoosePrice(world, line, product));

        var heroCities = MarketAi.OwnLines(world, actor)
            .Where(l => l.Product == hero)
            .Select(l => l.Building.City)
            .Distinct()
            .OrderBy(c => c.Value, StringComparer.Ordinal)
            .ToList();
        var cash = world.Companies[actor].Cash;
        foreach (var city in heroCities)
        {
            var sustain = world.GetSustainBudget(actor, city, AdChannel.TV, 75);
            var target = Math.Round(Math.Min(AdBudgetPerCityHero, sustain), 0, MidpointRounding.ToEven);
            if (cash < target * 6) target = 0m;
            var current = world.GetAdCampaign(actor, hero, city, AdChannel.TV)?.MonthlyBudget ?? 0m;
            if (current != target) actions.Add(new SetAdCampaignAction(hero, city, AdChannel.TV, target));
        }

        var rd = RealisticResearch(world, actor, hero, heroCities.Count > 0);
        if (rd is not null)
        {
            actions.Add(rd);
            return actions;
        }

        // Hero stores first (a brand builder accepts a long payback: 20 years), in high-income
        // cities, up to MaxCities; otherwise ordinary retail growth keeps the company earning.
        var heroCityCount = heroCities.Count;
        var expansion = heroCityCount < MaxCities
            ? MarketAi.FindRetailExpansion(
                world,
                actor,
                cushionMonths: 6,
                maxPaybackMonths: 240,
                cityFilter: c => (c.Demographics.TryGetValue(IncomeBracket.High, out var high) ? high : 0) >= MinHighBracketShare
                    && !heroCities.Contains(c.Id),
                requiredProduct: hero)
            : null;
        expansion ??= MarketAi.FindRetailExpansion(world, actor, cushionMonths: 6);
        if (expansion is not null) actions.Add(expansion);
        return actions;
    }

    /// <summary>Value-based hero price, floored at the per-unit cost and moved at most one step a month.</summary>
    private decimal HeroPrice(World world, Market.RetailLine line, Product product)
    {
        var b = line.Building;
        var profile = product.Demand!;
        var quality = b.Inventory.Get(product.Id) > 0 ? b.Inventory.AverageQuality(product.Id) : SimulationConstants.WorldMarketQuality;
        var brand = Math.Max(world.GetBrandAwareness(b.Owner, product.Id, b.City), profile.ImportBrand);
        var tech = Market.RetailMarket.TechScore(world, b.Owner, product);
        var score = Market.DemandModel.Score(profile, IncomeBracket.Middle, quality, brand, tech);
        var multiplier = Market.DemandModel.ValueMultiplier(profile, score);
        var target = MarketAi.ReferencePrice(world, b.City, product) * (decimal)Math.Pow(multiplier, 0.8);

        var unitCost = MarketAi.UnitCost(world, b, product.Id);
        var (_, ceiling) = MarketAi.PriceBounds(world, b.City, product, unitCost);
        var floor = unitCost * PriceFloorMultiplier;
        target = Math.Min(Math.Max(target, floor), Math.Max(floor, ceiling));

        var step = world.Rules.Market.AiPriceStep;
        var current = line.Price;
        var next = Math.Clamp(target, current * (1 - step), current * (1 + step));
        return MarketAi.Cents(next);
    }

    private AiAction? RealisticResearch(World world, CompanyId actor, ProductId hero, bool hasHeroStore)
    {
        if (!hasHeroStore) return null;
        var heroRdCount = world.Buildings.Values.Count(b => b.Owner == actor && b.ResearchSlots.Any(s => s.Product == hero));
        if (heroRdCount >= RdCentersTarget) return null;

        var rdType = world.Catalog.BuildingType(ResearchType);
        var occupied = world.Buildings.Values.Where(b => b.Owner == actor && b.ResearchSlots.Count > 0).Select(b => b.City).ToHashSet();
        var city = world.Catalog.Cities.Values
            .Where(c => !occupied.Contains(c.Id))
            .OrderByDescending(c => c.Population)
            .ThenBy(c => c.Id.Value, StringComparer.Ordinal)
            .FirstOrDefault()
            ?? world.Catalog.Cities.Values.OrderByDescending(c => c.Population).ThenBy(c => c.Id.Value, StringComparer.Ordinal).First();
        var rdFixed = MarketAi.NewStoreFixedCosts(world, rdType, city.Id, 1);
        var fixedCosts = world.GetMonthlyFixedCosts(actor);
        if (MarketAi.SiteAndCommitments(world, actor, rdType.Id, city.Id) is not decimal site) return null;
        if (world.Companies[actor].Cash < rdType.ConstructionCost + site + (fixedCosts + rdFixed) * 12) return null;
        return new BuildResearchCenterAction(city.Id, hero);
    }

    // ---------------------------------------------------------- hero selection

    private ProductId ResolveHero(World world)
    {
        if (_hero is ProductId cached) return cached;

        if (world.Rules.Market.Enabled)
        {
            // Realistic: the most tech-led consumer good (largest tech weight in perceived value,
            // ties → higher reference price): where R&D moves demand the most.
            var techLed = world.Catalog.Products.Values
                .Where(p => p.Demand is not null)
                .OrderByDescending(p => p.Demand!.WeightTech)
                .ThenByDescending(p => p.Demand!.ReferencePrice)
                .ThenBy(p => p.Id.Value, StringComparer.Ordinal)
                .First()
                .Id;
            _hero = techLed;
            return techLed;
        }

        var hero = world.Catalog.Products.Values
            .Where(p => p.Tier == ProductTier.Finished)
            .OrderByDescending(p => p.BaseWorldMarketPrice)
            .ThenBy(p => p.Id.Value, StringComparer.Ordinal)
            .First()
            .Id;

        _hero = hero;
        return hero;
    }

    // ---------------------------------------------------------- price adjustments

    private void AddPriceAdjustments(World world, CompanyId actor, ProductId hero, List<AiAction> actions)
    {
        var ownedRetailers = world.Buildings.Values
            .Where(b => b.Owner == actor && b.RetailSlots.Count > 0)
            .OrderBy(b => b.Id.Value)
            .ToList();

        foreach (var building in ownedRetailers)
        {
            foreach (var slot in building.RetailSlots.OrderBy(s => s.Index))
            {
                var target = ComputeTargetPrice(world, actor, building, slot.Product, hero);
                if (Math.Abs(target - slot.Price) >= 0.01m)
                {
                    actions.Add(new AdjustRetailPriceAction(building.Id, slot.Index, target));
                }
            }
        }
    }

    private decimal ComputeTargetPrice(
        World world,
        CompanyId actor,
        BuildingInstance ownStore,
        ProductId product,
        ProductId hero)
    {
        var worldPrice = (decimal)world.Catalog.Product(product).BaseWorldMarketPrice;

        var competitorPrices = world.Buildings.Values
            .Where(b => b.Owner != actor && b.City == ownStore.City)
            .SelectMany(b => b.RetailSlots.Where(s => s.Product == product))
            .Select(s => s.Price)
            .ToList();

        // Floor: never below 1.10× own COGS. If we have no inventory cost yet,
        // fall back to the world wholesale × floor multiplier — same shape as
        // Adaptive's wholesale floor so a freshly-built store doesn't briefly
        // price below break-even before its first restock.
        var ownCogs = ownStore.Inventory.CostOf(product);
        var cogsFloor = ownCogs > 0m
            ? ownCogs * PriceFloorMultiplier
            : worldPrice * PriceFloorMultiplier;

        decimal target;
        if (product == hero)
        {
            // Hero: premium 1.30× the *most expensive* competitor.
            target = competitorPrices.Count > 0
                ? competitorPrices.Max() * PremiumMultiplier
                : worldPrice * PremiumMultiplier;
        }
        else
        {
            // Non-hero (incidental) slot: undercut convention, with a wholesale floor.
            target = competitorPrices.Count > 0
                ? competitorPrices.Min() * 0.95m
                : worldPrice * 1.10m;
        }

        return target > cogsFloor ? target : cogsFloor;
    }

    // ---------------------------------------------------------- ad campaigns

    private void AddAdCampaignAdjustments(World world, CompanyId actor, ProductId hero, List<AiAction> actions)
    {
        // Aggressive brand investment: any city where we sell the hero gets a TV
        // campaign at the hero budget, contested or not. Brand awareness compounds.
        var heroCities = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .Where(b => b.RetailSlots.Any(s => s.Product == hero))
            .Select(b => b.City)
            .Distinct()
            .OrderBy(c => c.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var city in heroCities)
        {
            var existing = world.GetAdCampaign(actor, hero, city, AdChannel.TV);
            var currentBudget = existing?.MonthlyBudget ?? 0m;
            if (currentBudget != AdBudgetPerCityHero)
            {
                actions.Add(new SetAdCampaignAction(hero, city, AdChannel.TV, AdBudgetPerCityHero));
            }
        }
    }

    // ---------------------------------------------------------- R&D coverage

    private AiAction? MaybeBuildResearchCenter(World world, CompanyId actor, ProductId hero)
    {
        var heroRdCount = world.Buildings.Values
            .Count(b => b.Owner == actor && b.ResearchSlots.Any(s => s.Product == hero));
        if (heroRdCount >= RdCentersTarget) return null;

        var rdType = world.Catalog.BuildingType(ResearchType);
        if (world.Companies[actor].Cash < rdType.ConstructionCost + MarketAi.ConstructionCommitments(world, actor)) return null;

        // Pick the densest city we don't already have an R&D building in. Ties
        // broken by ordinal id so the choice is deterministic across runs.
        var occupiedRdCities = world.Buildings.Values
            .Where(b => b.Owner == actor && b.ResearchSlots.Count > 0)
            .Select(b => b.City)
            .ToHashSet();

        var rdCity = world.Catalog.Cities.Values
            .Where(c => !occupiedRdCities.Contains(c.Id))
            .OrderByDescending(c => c.Population)
            .ThenBy(c => c.Id.Value, StringComparer.Ordinal)
            .FirstOrDefault();

        // If we've somehow exhausted distinct cities, allow stacking in the
        // densest city overall — the target just needs to be hit.
        if (rdCity is null)
        {
            rdCity = world.Catalog.Cities.Values
                .OrderByDescending(c => c.Population)
                .ThenBy(c => c.Id.Value, StringComparer.Ordinal)
                .First();
        }

        return new BuildResearchCenterAction(rdCity.Id, hero);
    }

    // ---------------------------------------------------------- retail expansion

    private AiAction? MaybeOpenHeroRetailer(World world, CompanyId actor, ProductId hero)
    {
        // Cities currently selling the hero under our flag.
        var heroCityRetailers = world.Buildings.Values
            .Where(b => b.Owner == actor)
            .Where(b => b.RetailSlots.Any(s => s.Product == hero))
            .GroupBy(b => b.City)
            .ToDictionary(g => g.Key, g => g.Count());

        if (heroCityRetailers.Count >= MaxCities
            && !heroCityRetailers.Values.Any(n => n < MaxRetailersPerCity))
        {
            // Already at full footprint.
            return null;
        }

        var retailerType = world.Catalog.BuildingType(RetailerType);
        if (world.Companies[actor].Cash < retailerType.ConstructionCost + MarketAi.ConstructionCommitments(world, actor)) return null;

        // Candidate cities: High-bracket share ≥ MinHighBracketShare. Sort by
        // High share desc, ordinal id for ties — strict determinism.
        var candidates = world.Catalog.Cities.Values
            .Select(c => (City: c,
                          High: c.Demographics.TryGetValue(IncomeBracket.High, out var s) ? s : 0.0))
            .Where(x => x.High >= MinHighBracketShare)
            .OrderByDescending(x => x.High)
            .ThenBy(x => x.City.Id.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var (city, _) in candidates)
        {
            heroCityRetailers.TryGetValue(city.Id, out var existing);

            if (existing == 0)
            {
                // New city — only allowed if we're under MaxCities.
                if (heroCityRetailers.Count >= MaxCities) continue;
            }
            else if (existing >= MaxRetailersPerCity)
            {
                continue;
            }

            var price = ComputeEntryPrice(world, actor, city.Id, hero);
            var demand = ComputeCityDemand(city, world.Catalog.Product(hero));
            var existingShareDenom = world.Buildings.Values
                .Count(b => b.City == city.Id && b.RetailSlots.Any(s => s.Product == hero)) + 1;
            var restockTarget = demand / existingShareDenom * 1.2;

            return new BuildRetailerAction(RetailerType, city.Id, hero, price, restockTarget);
        }

        return null;
    }

    private decimal ComputeEntryPrice(World world, CompanyId actor, CityId city, ProductId hero)
    {
        var worldPrice = (decimal)world.Catalog.Product(hero).BaseWorldMarketPrice;

        var competitorPrices = world.Buildings.Values
            .Where(b => b.Owner != actor && b.City == city)
            .SelectMany(b => b.RetailSlots.Where(s => s.Product == hero))
            .Select(s => s.Price)
            .ToList();

        // No own-COGS yet (the building doesn't exist), so we floor against the
        // world wholesale price scaled by the same floor multiplier.
        var floor = worldPrice * PriceFloorMultiplier;
        var target = competitorPrices.Count > 0
            ? competitorPrices.Max() * PremiumMultiplier
            : worldPrice * PremiumMultiplier;

        return target > floor ? target : floor;
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
