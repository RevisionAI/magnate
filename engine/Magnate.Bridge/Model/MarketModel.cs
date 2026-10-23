using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>One retail slot as the demand model sees it.</summary>
internal sealed record RetailerModel(
    BuildingInstance Building,
    RetailSlot Slot,
    decimal Price,
    double Quality,
    int Tech,
    double Brand,
    double Weight,
    double Demand,
    double Share,
    IReadOnlyList<string> ExcludedBrackets);

/// <summary>One income bracket's demand in a market.</summary>
internal sealed record BracketModel(string Bracket, double Population, double PerCapita, double Demand, decimal? Ceiling, int Eligible);

/// <summary>The modelled allocation of one (city, product) market.</summary>
internal sealed record MarketAllocation(
    City City,
    Product Product,
    double Elasticity,
    IReadOnlyList<BracketModel> Brackets,
    IReadOnlyList<RetailerModel> Retailers,
    double PotentialDemand,
    double AllocatedDemand);

/// <summary>
/// Bridge replica of the engine's retail demand allocation
/// (<c>MonthlyTick.AllocateDemandAndSell</c>, bridge-spec §5.9), used for
/// forecasts, model shares and price what-ifs. <c>modelSource</c> is
/// <c>bridgeReplica</c>; it is retired the moment the engine exposes one public
/// demand model (change request E9, <c>features.demandModel</c>).
/// <code>
/// ε  = elasticity > 0 ? elasticity : 1
/// Qᵢ = onHand > 0 ? average quality on hand : world-market quality (forecast heuristic)
/// wᵢ = max((Qᵢ + 10·Tech + Brand) / 3, 1) / priceᵢ^ε
/// per bracket b: Dᵦ = population × shareᵦ × perCapitaᵦ; eligible = price ≤ reservationᵦ
///                demandᵢ += Dᵦ × wᵢ / Σ eligible w
/// </code>
/// Iteration order matches the engine (buildings by id, slots in list order) so
/// floating-point sums agree.
/// </summary>
internal static class MarketModel
{
    public const string Source = "bridgeReplica";

    /// <summary>Bracket iteration order (the engine's, never reorder).</summary>
    public static readonly IncomeBracket[] Brackets = { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High };

    public static string BracketId(IncomeBracket b) => b switch
    {
        IncomeBracket.Low => "low",
        IncomeBracket.Middle => "middle",
        _ => "high",
    };

    /// <summary>Monthly potential demand of a finished product in a city (0 for other tiers).</summary>
    public static double PotentialDemand(City city, Product product)
    {
        if (product.Tier != ProductTier.Finished) return 0;
        double total = 0;
        foreach (var bracket in Brackets)
        {
            var share = city.Demographics.TryGetValue(bracket, out var s) ? s : 0;
            var perCapita = product.BaseDemandPerCapita.TryGetValue(bracket, out var d) ? d : 0;
            total += city.Population * share * perCapita;
        }
        return total;
    }

    /// <summary>The bracket's reservation price, or null when the product sets none.</summary>
    public static decimal? Ceiling(Product product, IncomeBracket bracket)
        => product.ReservationPrice is not null && product.ReservationPrice.TryGetValue(bracket, out var v) ? v : null;

    /// <summary>
    /// Allocate the market. <paramref name="priceOverride"/> replaces one slot's
    /// price for a what-if (used by <c>suggestPrice</c>). Queries that allocate many
    /// markets pass one <see cref="RetailIndex"/> instead of re-sorting every building
    /// per market.
    /// </summary>
    public static MarketAllocation Allocate(
        World world,
        City city,
        Product product,
        (int BuildingId, int SlotIndex, decimal Price)? priceOverride = null,
        RetailIndex? retail = null)
    {
        var elasticity = product.PriceElasticity > 0 ? product.PriceElasticity : 1.0;
        var slots = new List<(BuildingInstance B, RetailSlot S, decimal Price)>();
        if (product.Tier == ProductTier.Finished)
        {
            foreach (var (b, s) in (retail ?? new RetailIndex(world)).Slots(city.Id, product.Id))
            {
                var price = priceOverride is { } o && o.BuildingId == b.Id.Value && o.SlotIndex == s.Index ? o.Price : s.Price;
                slots.Add((b, s, price));
            }
        }

        var weights = new double[slots.Count];
        var qualities = new double[slots.Count];
        var techs = new int[slots.Count];
        var brands = new double[slots.Count];
        for (var i = 0; i < slots.Count; i++)
        {
            var (b, _, price) = slots[i];
            var onHand = b.Inventory.Get(product.Id);
            qualities[i] = onHand > 0 ? b.Inventory.AverageQuality(product.Id) : EngineConstants.WorldMarketQuality;
            techs[i] = world.GetTech(b.Owner, product.Id);
            brands[i] = world.GetBrandAwareness(b.Owner, product.Id, b.City);
            var desirability = Math.Max((qualities[i] + techs[i] * 10.0 + brands[i]) / 3.0, 1.0);
            weights[i] = price > 0m ? desirability / Math.Pow((double)price, elasticity) : 0;
        }

        var demand = new double[slots.Count];
        var excluded = new List<string>[slots.Count];
        for (var i = 0; i < slots.Count; i++) excluded[i] = new List<string>();
        var brackets = new List<BracketModel>(3);
        double potential = 0;
        foreach (var bracket in Brackets)
        {
            var share = city.Demographics.TryGetValue(bracket, out var sh) ? sh : 0.0;
            var perCapita = product.BaseDemandPerCapita.TryGetValue(bracket, out var pc) ? pc : 0.0;
            var population = city.Population * share;
            var bracketDemand = product.Tier == ProductTier.Finished ? population * perCapita : 0.0;
            var ceiling = Ceiling(product, bracket);
            var eligible = 0;
            var weightSum = 0.0;
            for (var i = 0; i < slots.Count; i++)
            {
                if (ceiling is decimal c && slots[i].Price > c)
                {
                    excluded[i].Add(BracketId(bracket));
                    continue;
                }
                eligible++;
                weightSum += weights[i];
            }
            brackets.Add(new BracketModel(BracketId(bracket), population, perCapita, bracketDemand, ceiling, eligible));
            if (share <= 0 || perCapita <= 0 || bracketDemand <= 0) continue;
            potential += bracketDemand;
            if (weightSum <= 0) continue;
            for (var i = 0; i < slots.Count; i++)
            {
                if (ceiling is decimal c && slots[i].Price > c) continue;
                demand[i] += bracketDemand * (weights[i] / weightSum);
            }
        }

        double allocated = 0;
        foreach (var d in demand) allocated += d;
        var retailers = new List<RetailerModel>(slots.Count);
        for (var i = 0; i < slots.Count; i++)
        {
            var (b, s, price) = slots[i];
            retailers.Add(new RetailerModel(b, s, price, qualities[i], techs[i], brands[i], weights[i], demand[i],
                allocated > 0 ? demand[i] / allocated : 0, excluded[i]));
        }
        return new MarketAllocation(city, product, elasticity, brackets, retailers, potential, allocated);
    }

    /// <summary>Buildings ordered by id (the engine's tick order).</summary>
    public static List<BuildingInstance> SortedBuildings(World world)
    {
        var list = new List<BuildingInstance>(world.Buildings.Values);
        list.Sort((a, b) => a.Id.Value.CompareTo(b.Id.Value));
        return list;
    }
}

/// <summary>
/// Every retail slot grouped by (city, product) market, in the engine's iteration
/// order (buildings by id, slots in list order). A snapshot of the world when built:
/// build one per query, never keep it across mutations.
/// </summary>
internal sealed class RetailIndex
{
    private static readonly IReadOnlyList<(BuildingInstance B, RetailSlot S)> None = Array.Empty<(BuildingInstance, RetailSlot)>();
    private readonly Dictionary<(CityId City, ProductId Product), List<(BuildingInstance B, RetailSlot S)>> _markets = new();

    public RetailIndex(World world)
    {
        foreach (var b in MarketModel.SortedBuildings(world))
        {
            foreach (var s in b.RetailSlots)
            {
                if (!_markets.TryGetValue((b.City, s.Product), out var list))
                {
                    list = new List<(BuildingInstance B, RetailSlot S)>();
                    _markets[(b.City, s.Product)] = list;
                }
                list.Add((b, s));
            }
        }
    }

    /// <summary>The retail slots selling <paramref name="product"/> in <paramref name="city"/>.</summary>
    public IReadOnlyList<(BuildingInstance B, RetailSlot S)> Slots(CityId city, ProductId product)
        => _markets.TryGetValue((city, product), out var list) ? list : None;
}

/// <summary>
/// The engine's own demand model (bridge-spec E9, <c>features.demandModel</c>,
/// <c>modelSource:'engine'</c>): every market view of a world under Realistic market rules reads
/// <see cref="World.PreviewDemand"/>, so forecasts, model shares and price suggestions are exactly
/// what the next tick will do with the shelves restocked to their targets. Classic worlds (legacy
/// saves) keep the <see cref="MarketModel"/> replica.
/// </summary>
internal static class EngineMarket
{
    public const string Source = "engine";

    /// <summary>True when the world runs the Realistic demand model.</summary>
    public static bool Applies(World world) => world.Rules.Market.Enabled;

    /// <summary>The market as the next tick will see it (null for goods with no consumer demand).</summary>
    public static MarketPreview? Preview(World world, City city, Product product)
        => product.Demand is null ? null : world.PreviewDemand(city.Id, product.Id);

    /// <summary>
    /// Units per company last month with the incumbents in the denominator (shares sum to 1 with
    /// the incumbents' share), or null when the market did not trade.
    /// </summary>
    public static (Dictionary<int, double> Shares, double IncumbentShare)? LastMonthShares(World world, City city, Product product)
    {
        if (world.GetMarketUnits(city.Id, product.Id, world.Clock.Now) is not { } units) return null;
        var total = units.Incumbents + units.Companies.Values.Sum();
        if (!(total > 0)) return null;
        var shares = units.Companies.ToDictionary(kv => kv.Key.Value, kv => kv.Value / total);
        return (shares, units.Incumbents / total);
    }
}
