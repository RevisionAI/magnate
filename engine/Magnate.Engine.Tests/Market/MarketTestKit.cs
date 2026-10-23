using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Shared setup for the market-economics tests (E1): Realistic worlds on live content, the
/// demand-model inputs of a (city, product) market, and small world-building helpers.
/// </summary>
internal static class MarketTestKit
{
    public static readonly CityId Metropolis = new("metropolis");
    public static readonly CityId Riverside = new("riverside");
    public static readonly CityId Hilltown = new("hilltown");
    public static readonly ProductId SoftDrink = new("soft_drink");
    public static readonly ProductId Bread = new("bread");
    public static readonly ProductId Car = new("car");
    public static readonly ProductId TShirt = new("t_shirt");
    public static readonly BuildingTypeId Supermarket = new("supermarket");
    public static readonly BuildingTypeId Convenience = new("convenience_store");
    public static readonly BuildingTypeId Dealer = new("car_dealership");
    public static readonly BuildingTypeId FactorySmall = new("factory_small");
    public static readonly BuildingTypeId WarehouseSmall = new("warehouse_small");

    private static readonly Lazy<ContentCatalog> QuietLazy = new(() =>
        new ContentCatalog(TestContent.Live.Products, TestContent.Live.BuildingTypes, TestContent.Live.Cities));

    /// <summary>Live content without the random-event catalog: clean market measurements.</summary>
    public static ContentCatalog Quiet => QuietLazy.Value;

    /// <summary>
    /// Realistic rules on live content, optionally with a market-rules tweak. Random events are
    /// off unless <paramref name="events"/> (a brand shift or price shock would blur the numbers).
    /// Land rules are off (instant construction, no plots, neutral sites — the conditions these
    /// market measurements were calibrated under); the land x market seam is covered by
    /// <c>MarketLandIntegrationTests</c> and the Land tests.
    /// </summary>
    public static World Realistic(Func<MarketRules, MarketRules>? market = null, int seed = 42, bool events = false)
    {
        var rules = EconomyRules.Realistic with { Land = new LandRules() };
        if (market is not null) rules = rules with { Market = market(rules.Market) };
        return new World(events ? TestContent.Live : Quiet, seed, Worlds.DefaultStart, rules);
    }

    /// <summary>The demand-model market of (city, product) in <paramref name="world"/>, optionally without incumbents.</summary>
    public static DemandMarket MarketOf(World world, CityId city, ProductId product, bool incumbents = true)
    {
        var m = RetailMarket.MarketOf(world, world.Catalog.City(city), world.Catalog.Product(product));
        return incumbents ? m : m with { IncumbentMass = 0 };
    }

    /// <summary>The live content profile of a consumer good.</summary>
    public static ProductDemandProfile Profile(ProductId product) => TestContent.Live.Product(product).Demand!;

    /// <summary>
    /// An average new supermarket line (A = 1, quality 50, no own brand, world tech) at
    /// <paramref name="price"/> with unlimited stock and capacity: the calibration's "uncapped" offer.
    /// </summary>
    public static DemandOffer Uncapped(double price, double brand = 0, double quality = 50, double tech = 30, double attractiveness = 1)
        => new(price, quality, brand, tech, attractiveness, double.PositiveInfinity);

    /// <summary>Landed import cost per unit (W × import multiplier) from live content.</summary>
    public static double ImportCost(ProductId product)
    {
        var p = TestContent.Live.Product(product);
        return (double)((decimal)p.BaseWorldMarketPrice * p.Trade.ImportMultiplier);
    }

    /// <summary>
    /// Construct with the current rules' market defaults applied (Realistic: auto-export off), as
    /// the land workstream's <c>Construct</c> does once it calls <see cref="World.ApplyMarketDefaults"/>.
    /// </summary>
    public static BuildingInstance Build(World world, CompanyId owner, BuildingTypeId type, CityId city)
    {
        var b = world.Construct(owner, type, city);
        world.ApplyMarketDefaults(b);
        return b;
    }

    /// <summary>A store with one slot per (product, price, restock) entry, configured in order.</summary>
    public static BuildingInstance Store(World world, CompanyId owner, BuildingTypeId type, CityId city, params (ProductId Product, decimal Price, double Restock)[] lines)
    {
        var b = Build(world, owner, type, city);
        for (var i = 0; i < lines.Length; i++) world.ConfigureRetailSlot(b.Id, i, lines[i].Product, lines[i].Price, lines[i].Restock);
        return b;
    }

    /// <summary>Σ ledger amounts of <paramref name="category"/> for a company (optionally one month).</summary>
    public static decimal Sum(World world, CompanyId company, Economics.LedgerCategory category, GameDate? month = null)
        => world.Ledger.EntriesFor(company)
            .Where(e => e.Category == category && (month is null || e.Date == month))
            .Sum(e => e.Amount);

    /// <summary>Units sold by a building's retail line in the current month (from the line report).</summary>
    public static double SoldThisMonth(World world, BuildingInstanceId building, ProductId product)
        => world.GetRetailLineReport(building, product) is { } r && r.Month == world.Clock.Now ? r.Sold : 0;

    /// <summary>A site-info stub: per-building location factor / operational state / land cost.</summary>
    public sealed class Sites : IBuildingSiteInfo
    {
        public Dictionary<BuildingInstanceId, double> Location { get; } = new();

        public HashSet<BuildingInstanceId> UnderConstruction { get; } = new();

        public Dictionary<BuildingInstanceId, decimal> Land { get; } = new();

        public double LocationFactor(BuildingInstance building) => Location.TryGetValue(building.Id, out var l) ? l : 1.0;

        public decimal LandCost(BuildingInstance building) => Land.TryGetValue(building.Id, out var c) ? c : 0m;

        public bool IsOperational(BuildingInstance building) => !UnderConstruction.Contains(building.Id);
    }

    /// <summary>A credit-headroom stub with no undrawn credit (cash-only purchase caps).</summary>
    public sealed class NoCredit : ICreditHeadroom
    {
        public static NoCredit Instance { get; } = new();

        public decimal UndrawnCredit(World world, CompanyId company) => 0m;
    }

    /// <summary>Months as a sequence for readable loops.</summary>
    public static IEnumerable<int> Months(int count) => Enumerable.Range(0, count);
}
