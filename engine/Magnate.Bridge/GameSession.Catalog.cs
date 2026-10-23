using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Static content for the client (bridge-spec §5.3 `catalog`), built once per init.
public sealed partial class GameSession
{
    private CatalogDto? _catalogDto;

    /// <summary>
    /// One-click starter builds (Godot Manage.cs:541-544), placed in the most
    /// populous city. Content-owned starter plans (content/data/starter_plans.json)
    /// are a requested follow-up; the economics workstream tunes the defaults.
    /// </summary>
    internal static readonly IReadOnlyList<StarterPlanDto> StarterPlans = new[]
    {
        new StarterPlanDto("cornerStore", "Corner store selling soft drinks", "convenience_store", "soft_drink", 2.25m, 250_000, "largestPopulation"),
        new StarterPlanDto("breadAisle", "Supermarket selling bread", "supermarket", "bread", 4.25m, 350_000, "largestPopulation"),
        new StarterPlanDto("warehouseHub", "Warehouse stocking bread", "warehouse_small", "bread", null, 500_000, "largestPopulation"),
        new StarterPlanDto("softDrinkLab", "R&D center researching soft drinks", "rd_center", "soft_drink", null, null, "largestPopulation"),
    };

    /// <summary>Static content: products, building types, cities, channels, constants, events, starter plans.</summary>
    [BridgeMethod("catalog", RequiresGame = false)]
    public CatalogDto GetCatalog() => _catalogDto ??= BuildCatalog();

    private CatalogDto BuildCatalog()
    {
        var catalog = Catalog;
        var rules = Rules;

        var feedsInto = new Dictionary<ProductId, List<string>>();
        foreach (var p in rules.OrderedProducts)
        {
            if (p.Recipe is null) continue;
            foreach (var input in p.Recipe.Inputs)
            {
                if (!feedsInto.TryGetValue(input.ProductId, out var list)) feedsInto[input.ProductId] = list = new List<string>();
                if (!list.Contains(p.Id.Value)) list.Add(p.Id.Value);
            }
        }

        var products = rules.OrderedProducts.Select(p => new ProductDto(
            Id: p.Id.Value,
            Name: p.Name,
            Tier: TierId(p.Tier),
            Category: p.Category,
            Unit: p.Unit,
            BaseWorldMarketPrice: p.BaseWorldMarketPrice,
            MaxTechLevel: p.MaxTechLevel,
            Recipe: p.Recipe is null
                ? null
                : new RecipeDto(
                    p.Recipe.OutputQuantity,
                    p.Recipe.Inputs.Select(i => new RecipeInputDto(i.ProductId.Value, i.Quantity, i.Quantity * p.Recipe.CyclesPerSlotMonth)).ToList(),
                    p.Recipe.LaborUnits),
            ExtractedAt: p.Extraction?.SourceCategory,
            PriceElasticity: p.PriceElasticity,
            BaseDemandPerCapita: Brackets(p.BaseDemandPerCapita),
            ReservationPrice: p.ReservationPrice is null
                ? null
                : new BracketValuesDto(
                    p.ReservationPrice.TryGetValue(IncomeBracket.Low, out var l) ? (double)l : null,
                    p.ReservationPrice.TryGetValue(IncomeBracket.Middle, out var m) ? (double)m : null,
                    p.ReservationPrice.TryGetValue(IncomeBracket.High, out var h) ? (double)h : null),
            YieldPerSlotPerMonth: p.Extraction?.YieldPerSlotPerMonth,
            OutputPerSlotPerMonth: p.Recipe is null ? null : p.Recipe.OutputQuantity * p.Recipe.CyclesPerSlotMonth,
            FeedsInto: feedsInto.TryGetValue(p.Id, out var feeds) ? feeds : Array.Empty<string>(),
            AffectsRetailDemand: p.Tier == ProductTier.Finished)).ToList();

        var buildingTypes = catalog.BuildingTypes.Values
            .OrderBy(b => b.Category, StringComparer.Ordinal)
            .ThenBy(b => b.ConstructionCost)
            .ThenBy(b => b.Id.Value, StringComparer.Ordinal)
            .Select(b => ToBuildingTypeDto(b, rules))
            .ToList();

        var cities = catalog.Cities.Values
            .OrderByDescending(c => c.Population)
            .ThenBy(c => c.Id.Value, StringComparer.Ordinal)
            .Select(c => new CityDto(
                c.Id.Value,
                c.Name,
                c.Population,
                c.Grid.Width,
                c.Grid.Height,
                c.Geography.Coastal,
                c.Geography.Arable,
                c.Geography.MineralRich,
                c.Geography.OilRich,
                c.BaseLandPrice,
                c.Demographics.ToDictionary(kv => MarketModel.BracketId(kv.Key), kv => kv.Value),
                rules.OrderedProducts
                    .Where(p => p.Tier == ProductTier.Finished)
                    .ToDictionary(p => p.Id.Value, p => Math.Round(MarketModel.PotentialDemand(c, p), 3))))
            .ToList();

        var channels = new[] { AdChannel.TV, AdChannel.Newspaper, AdChannel.Magazine, AdChannel.Radio }
            .Select(ch => new AdChannelDto(
                Advisor.ChannelId(ch),
                EngineConstants.AdCostPerPoint(ch),
                MediaBuildingType(ch),
                ch is AdChannel.TV or AdChannel.Radio ? EngineConstants.MediaOwnershipAdBonus : EngineConstants.MediaOwnershipAdBonusPrint))
            .ToList();

        var constants = new SimConstantsDto(
            CyclesPerSlotPerMonth: EngineConstants.CyclesPerSlotPerMonth,
            InterCityShippingFraction: EngineConstants.InterCityShippingFraction,
            WorldMarketQuality: EngineConstants.WorldMarketQuality,
            ExtractionQuality: EngineConstants.ExtractionQuality,
            BaseTechLevel: EngineConstants.BaseTechLevel,
            ResearchPointsPerSlotPerMonth: EngineConstants.ResearchPointsPerSlotPerMonth,
            BaseResearchThreshold: EngineConstants.BaseResearchThreshold,
            PatentDurationMonths: EngineConstants.PatentDurationMonths,
            PatentRoyaltyRate: EngineConstants.PatentRoyaltyRate,
            BrandDecayRate: EngineConstants.BrandDecayRate,
            EventBaseProbabilityPerMonth: EngineConstants.EventBaseProbabilityPerMonth,
            BankruptcyGraceMonths: GoalTracker.DefaultBankruptcyGraceMonths,
            DefaultLowCashThreshold: 1_000_000m);

        var events = catalog.Events
            .OrderBy(e => e.Id, StringComparer.Ordinal)
            .Select(e => new EventDefDto(e.Id, e.Name, e.Description, e.Severity.ToString().ToLowerInvariant()))
            .ToList();

        var plans = StarterPlans
            .Where(p => catalog.BuildingTypes.ContainsKey(new BuildingTypeId(p.TypeId)) && catalog.Products.ContainsKey(new ProductId(p.ProductId)))
            .ToList();

        return new CatalogDto(products, buildingTypes, cities, channels, constants, events, plans, _contentHash);
    }

    private static BuildingTypeDto ToBuildingTypeDto(BuildingType b, SlotRules rules)
    {
        var kind = rules.KindOf(b.Id);
        var levels = b.Levels is { Count: > 0 } ladder
            ? ladder.Select(l => new LevelDto(l.Level, l.Capacity, l.MonthlyOperatingCost, l.Level == 1 ? 0m : l.UpgradeCost)).ToList()
            : new List<LevelDto> { new(1, b.MaxUnits, b.MonthlyOperatingCost, 0m) };
        var channel = MediaChannelOf(b.Id.Value);
        return new BuildingTypeDto(
            Id: b.Id.Value,
            Name: b.Name,
            Category: b.Category,
            ConstructionCost: b.ConstructionCost,
            MonthlyOperatingCost: b.MonthlyOperatingCost,
            FootprintWidth: b.Footprint.Width,
            FootprintHeight: b.Footprint.Height,
            MaxUnits: b.MaxUnits,
            Retail: b.Retail,
            ProducibleTiers: b.ProducibleTiers.Select(TierId).ToList(),
            MaxLevel: levels.Count,
            SlotKind: kind,
            EligibleProductIds: rules.Eligible(b.Id),
            Levels: levels,
            Geography: b.GeographyRequirement is { } g
                ? new GeographyReqDto(g.Coastal == true ? true : null, g.Arable == true ? true : null,
                    g.MineralRich == true ? true : null, g.OilRich == true ? true : null)
                : null,
            Headcount: b.TargetHeadcount is { } h ? new HeadcountDto(h.Min, h.Max) : null,
            BuildMenuGroup: kind switch
            {
                SlotKinds.Extraction => "extraction",
                SlotKinds.Retail => "retail",
                SlotKinds.Warehouse => "logistics",
                SlotKinds.Research => "research",
                _ when b.Category == "media" => "media",
                _ => "production",
            },
            MediaChannel: channel is { } ch ? Advisor.ChannelId(ch) : null,
            MediaBonus: channel is { } c2 ? (c2 is AdChannel.TV or AdChannel.Radio ? EngineConstants.MediaOwnershipAdBonus : EngineConstants.MediaOwnershipAdBonusPrint) : null);
    }

    internal static string TierId(ProductTier tier) => tier switch
    {
        ProductTier.Raw => "raw",
        ProductTier.Intermediate => "intermediate",
        _ => "finished",
    };

    private static BracketValuesDto Brackets(IReadOnlyDictionary<IncomeBracket, double> values)
        => new(
            values.TryGetValue(IncomeBracket.Low, out var l) ? l : null,
            values.TryGetValue(IncomeBracket.Middle, out var m) ? m : null,
            values.TryGetValue(IncomeBracket.High, out var h) ? h : null);

    /// <summary>The ad channel a media building boosts (World.GetMediaOwnershipBonus).</summary>
    internal static AdChannel? MediaChannelOf(string typeId) => typeId switch
    {
        "tv_station" => AdChannel.TV,
        "radio_station" => AdChannel.Radio,
        "newspaper_publisher" => AdChannel.Newspaper,
        "magazine_publisher" => AdChannel.Magazine,
        _ => null,
    };

    private static string MediaBuildingType(AdChannel channel) => channel switch
    {
        AdChannel.TV => "tv_station",
        AdChannel.Radio => "radio_station",
        AdChannel.Newspaper => "newspaper_publisher",
        _ => "magazine_publisher",
    };
}
