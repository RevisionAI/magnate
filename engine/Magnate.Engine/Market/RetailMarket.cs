using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>
/// One store line: every retail slot of one building that sells one product, merged into a
/// single offer (econ-audit §4.1, fixes F7 — duplicate slots raise attractiveness only by √n).
/// </summary>
public sealed class RetailLine
{
    internal RetailLine(BuildingInstance building, BuildingType type, ProductId product, List<RetailSlot> slots)
    {
        Building = building;
        Type = type;
        Product = product;
        Slots = slots;
    }

    /// <summary>The store.</summary>
    public BuildingInstance Building { get; }

    /// <summary>The store's type.</summary>
    public BuildingType Type { get; }

    /// <summary>The product sold.</summary>
    public ProductId Product { get; }

    /// <summary>The merged slots, in index order.</summary>
    public IReadOnlyList<RetailSlot> Slots { get; }

    /// <summary>Offer price: the lowest price among the merged slots (shoppers take the cheapest shelf).</summary>
    public decimal Price => Slots.Min(s => s.Price);

    /// <summary>Σ restock targets of the merged slots.</summary>
    public double RestockTarget => Slots.Sum(s => s.RestockTarget);
}

/// <summary>
/// Builds the inputs of <see cref="DemandModel"/> from world state: store lines, their capacity,
/// attractiveness and stock caps (§4.3), and the incumbent offer (§4.2).
/// </summary>
public static class RetailMarket
{
    /// <summary>
    /// The store lines selling <paramref name="product"/> in <paramref name="city"/>, buildings in
    /// ascending id order. Non-operational buildings are skipped.
    /// </summary>
    public static IReadOnlyList<RetailLine> Lines(World world, CityId city, ProductId product)
    {
        var result = new List<RetailLine>();
        foreach (var building in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (building.City != city || building.RetailSlots.Count == 0) continue;
            var line = LineOf(world, building, product);
            if (line is not null) result.Add(line);
        }

        return result;
    }

    /// <summary>The line of <paramref name="building"/> for <paramref name="product"/>, or null when it has no slot for it or is not operational.</summary>
    public static RetailLine? LineOf(World world, BuildingInstance building, ProductId product)
    {
        List<RetailSlot>? slots = null;
        foreach (var slot in building.RetailSlots)
        {
            if (slot.Product != product) continue;
            (slots ??= new List<RetailSlot>()).Add(slot);
        }

        if (slots is null) return null;
        if (!world.SiteInfo.IsOperational(building)) return null;
        slots.Sort((a, b) => a.Index.CompareTo(b.Index));
        return new RetailLine(building, world.Catalog.BuildingType(building.TypeId), product, slots);
    }

    /// <summary>
    /// Draw of a store type for a product (0 = the product is not sold in that format, econ-audit
    /// §4.3). Non-retail types and non-finished products draw 0.
    /// </summary>
    public static double Draw(BuildingType type, Product product)
        => type.RetailFormat is { } format && product.Demand is { } demand ? format.DrawFor(demand.RetailCategory) : 0.0;

    /// <summary>
    /// Throughput capacity in units/month: <c>n · CapacityPerSlot / Pref</c>. Capacity per slot is
    /// the same at every level (levels add slots, §4.3).
    /// </summary>
    public static double Capacity(BuildingType type, Product product, int slots)
    {
        if (type.RetailFormat is not { } format || product.Demand is not { } demand) return 0;
        return slots * (double)format.CapacityPerSlot / (double)demand.ReferencePrice;
    }

    /// <summary>Stock cap: <see cref="Rules.MarketRules.StockCapMonths"/> × capacity.</summary>
    public static double StockCap(World world, BuildingType type, Product product, int slots)
        => world.Rules.Market.StockCapMonths * Capacity(type, product, slots);

    /// <summary>Attractiveness <c>A = L · Draw · √n · (1 + bonus·(level − 1))</c>.</summary>
    public static double Attractiveness(World world, double locationFactor, double draw, int slots, int level)
        => locationFactor * draw * Math.Sqrt(slots) * (1 + world.Rules.Market.LevelAttractiveness * (level - 1));

    /// <summary>World technology score (0–100) of the incumbents and of laggards (P0: frozen).</summary>
    public static double WorldTechScore(World world) => 100.0 * world.Rules.Market.WorldTechShare;

    /// <summary>Technology score 0–100 of a company for a product: <c>100 · max(own, world) / max tech</c>.</summary>
    public static double TechScore(World world, CompanyId owner, Product product)
    {
        var max = Math.Max(1, product.MaxTechLevel);
        var own = 100.0 * world.GetTech(owner, product.Id) / max;
        return Math.Max(own, WorldTechScore(world));
    }

    /// <summary>City price level: city price index × CPI (P0: CPI = 1).</summary>
    public static double PriceLevel(City city) => city.PriceIndex;

    /// <summary>
    /// Incumbent mass A₀ (econ-audit §4.2, P0 static base):
    /// <c>max(min, D$_ref / (utilisation · RetailCapPerSlot$(referenceStore))) · strength</c>.
    /// </summary>
    public static double IncumbentMass(World world, City city, Product product)
    {
        var rules = world.Rules.Market;
        if (product.Demand is not { } profile || rules.IncumbentStrength <= 0) return 0;
        var store = world.Catalog.BuildingTypes.TryGetValue(profile.ReferenceStore, out var t) ? t : null;
        var capacity = store?.RetailFormat?.CapacityPerSlot ?? Content.MarketContent.DefaultRetailCapacityPerSlot;
        double dollars = 0;
        var pref = (double)profile.ReferencePrice * PriceLevel(city);
        foreach (var bracket in DemandModel.Brackets)
        {
            dollars += city.Population * Mix(city, bracket) * profile.PerCapita(bracket) * pref;
        }

        var mass = Math.Max(rules.IncumbentMinMass, dollars / (rules.IncumbentUtilisation * (double)capacity));
        return mass * rules.IncumbentStrength;
    }

    /// <summary>Population share of a bracket in a city.</summary>
    public static double Mix(City city, IncomeBracket bracket)
        => city.Demographics.TryGetValue(bracket, out var share) ? share : 0.0;

    /// <summary>The market-level inputs for (city, product).</summary>
    public static DemandMarket MarketOf(World world, City city, Product product)
    {
        var profile = product.Demand ?? throw new InvalidOperationException($"product '{product.Id}' has no consumer demand profile");
        return new DemandMarket(
            profile,
            city.Population,
            Mix(city, IncomeBracket.Low),
            Mix(city, IncomeBracket.Middle),
            Mix(city, IncomeBracket.High),
            PriceLevel(city),
            WorldTechScore(world),
            IncumbentMass(world, city, product),
            world.Rules.Market.SpillFraction);
    }

    /// <summary>
    /// The demand-model offer of a line. <paramref name="sellableOverride"/> replaces the stock
    /// on hand (previews assume the month's restock); <paramref name="priceOverride"/> replaces the
    /// price.
    /// </summary>
    public static DemandOffer OfferOf(World world, RetailLine line, Product product, double? sellableOverride = null, decimal? priceOverride = null)
    {
        var b = line.Building;
        var draw = Draw(line.Type, product);
        var capacity = Capacity(line.Type, product, line.Slots.Count);
        var onHand = b.Inventory.Get(product.Id);
        var stock = sellableOverride ?? onHand;
        var quality = onHand > 0 ? b.Inventory.AverageQuality(product.Id) : SimulationConstants.WorldMarketQuality;
        return new DemandOffer(
            (double)(priceOverride ?? line.Price),
            quality,
            world.GetBrandAwareness(b.Owner, product.Id, b.City),
            TechScore(world, b.Owner, product),
            Attractiveness(world, world.SiteInfo.LocationFactor(b), draw, line.Slots.Count, b.Level),
            draw > 0 ? Math.Min(Math.Max(0, stock), capacity) : 0);
    }

    /// <summary>
    /// Restock target of a line under Realistic rules: Σ slot targets clamped to the stock cap;
    /// 0 when the store format does not sell the product.
    /// </summary>
    public static double RestockTarget(World world, RetailLine line, Product product)
    {
        if (Draw(line.Type, product) <= 0) return 0;
        return Math.Min(line.RestockTarget, StockCap(world, line.Type, product, line.Slots.Count));
    }
}
