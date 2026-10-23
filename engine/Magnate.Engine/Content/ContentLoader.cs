using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Content;

/// <summary>
/// Loads game content from a directory tree of JSON files and performs semantic
/// validation beyond what JSON Schema can express.
/// </summary>
/// <remarks>
/// Expected layout under <c>contentRoot</c>:
/// <code>
/// data/products/*.json     — array of Product
/// data/buildings/*.json    — array of BuildingType
/// data/cities/*.json       — single City object
/// </code>
/// </remarks>
public static class ContentLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = false,
    };

    /// <summary>Load and validate the catalog rooted at <paramref name="contentRoot"/>.</summary>
    /// <exception cref="ContentLoadException">One or more content files failed validation.</exception>
    public static ContentCatalog Load(string contentRoot)
    {
        ArgumentNullException.ThrowIfNull(contentRoot);

        if (!Directory.Exists(contentRoot))
        {
            throw new DirectoryNotFoundException($"Content root not found: {contentRoot}");
        }

        var errors = new List<string>();

        var buildingTypes = LoadBuildingTypes(contentRoot, errors);
        var products = LoadProducts(contentRoot, buildingTypes, errors);
        var cities = LoadCities(contentRoot, errors);
        var events = LoadEvents(contentRoot, errors);

        ValidateReferentialIntegrity(products, errors);

        if (errors.Count > 0)
        {
            throw new ContentLoadException(errors);
        }

        return new ContentCatalog(products, buildingTypes, cities, events);
    }

    // ------------------------------------------------------------------------ events (Phase 3.65)

    private static IReadOnlyList<EventDefinition> LoadEvents(string root, List<string> errors)
    {
        var dir = Path.Combine(root, "data", "events");
        var result = new List<EventDefinition>();

        if (!Directory.Exists(dir))
        {
            // Backward-compatible: a content tree without /data/events still
            // loads cleanly with an empty events catalog.
            return result;
        }

        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (file, dtos) in ReadArrayFiles<EventDto>(dir, errors))
        {
            foreach (var dto in dtos)
            {
                try
                {
                    var def = ToEventDefinition(dto);
                    if (!seenIds.Add(def.Id))
                    {
                        errors.Add($"{file}: duplicate event id '{def.Id}'");
                        continue;
                    }
                    result.Add(def);
                }
                catch (Exception ex)
                {
                    errors.Add($"{file}: {ex.Message}");
                }
            }
        }

        // Stable ordering by id so the catalog (and therefore the dice-pick) is
        // deterministic regardless of filesystem enumeration order.
        result.Sort((a, b) => StringComparer.Ordinal.Compare(a.Id, b.Id));
        return result;
    }

    private static EventDefinition ToEventDefinition(EventDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Id))
        {
            throw new InvalidOperationException("event has no id");
        }
        if (string.IsNullOrWhiteSpace(dto.Name))
        {
            throw new InvalidOperationException($"event '{dto.Id}': name required");
        }
        if (dto.Weight <= 0)
        {
            throw new InvalidOperationException($"event '{dto.Id}': weight must be positive");
        }

        var trigger = ParseTrigger(dto.Id, dto.Trigger);
        var severity = ParseSeverity(dto.Id, dto.Severity);

        var effects = new List<EventEffect>();
        if (dto.Effects is not null)
        {
            foreach (var eff in dto.Effects)
            {
                effects.Add(ParseEffect(dto.Id, eff));
            }
        }

        return new EventDefinition(
            dto.Id,
            dto.Name,
            dto.Description ?? string.Empty,
            trigger,
            effects,
            dto.Weight,
            severity);
    }

    private static EventTrigger ParseTrigger(string eventId, EventTriggerDto? dto)
    {
        if (dto is null) throw new InvalidOperationException($"event '{eventId}': trigger required");
        return dto.Type?.ToLowerInvariant() switch
        {
            "random" => new RandomTrigger(),
            null => throw new InvalidOperationException($"event '{eventId}': trigger.type required"),
            _ => throw new InvalidOperationException($"event '{eventId}': unknown trigger type '{dto.Type}'"),
        };
    }

    private static EventEffect ParseEffect(string eventId, EventEffectDto dto)
    {
        var type = dto.Type?.ToLowerInvariant()
            ?? throw new InvalidOperationException($"event '{eventId}': effect.type required");

        switch (type)
        {
            case "world_market_price_multiplier":
            case "price_multiplier":
                if (string.IsNullOrWhiteSpace(dto.ProductId))
                    throw new InvalidOperationException($"event '{eventId}': price_multiplier requires productId");
                if (dto.Multiplier is null || dto.Multiplier <= 0)
                    throw new InvalidOperationException($"event '{eventId}': price_multiplier requires positive multiplier");
                if (dto.DurationMonths is null || dto.DurationMonths <= 0)
                    throw new InvalidOperationException($"event '{eventId}': price_multiplier requires positive durationMonths");
                return new WorldMarketPriceMultiplierEffect(
                    dto.ProductId,
                    (decimal)dto.Multiplier.Value,
                    dto.DurationMonths.Value);

            case "brand_shift":
                if (string.IsNullOrWhiteSpace(dto.ProductId))
                    throw new InvalidOperationException($"event '{eventId}': brand_shift requires productId");
                if (string.IsNullOrWhiteSpace(dto.CityId))
                    throw new InvalidOperationException($"event '{eventId}': brand_shift requires cityId");
                if (dto.Delta is null)
                    throw new InvalidOperationException($"event '{eventId}': brand_shift requires delta");
                return new BrandShiftEffect(dto.ProductId, dto.CityId, dto.Delta.Value);

            case "headline":
                return new HeadlineEffect();

            default:
                throw new InvalidOperationException($"event '{eventId}': unknown effect type '{dto.Type}'");
        }
    }

    private static EventSeverity ParseSeverity(string eventId, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return EventSeverity.Info;
        return value.ToLowerInvariant() switch
        {
            "info" => EventSeverity.Info,
            "notable" => EventSeverity.Notable,
            "major" => EventSeverity.Major,
            _ => throw new InvalidOperationException($"event '{eventId}': unknown severity '{value}'"),
        };
    }

    // ------------------------------------------------------------------------ products

    private static IReadOnlyDictionary<ProductId, Product> LoadProducts(
        string root,
        IReadOnlyDictionary<BuildingTypeId, BuildingType> buildingTypes,
        List<string> errors)
    {
        var dir = Path.Combine(root, "data", "products");
        var result = new Dictionary<ProductId, Product>();

        foreach (var (file, dtos) in ReadArrayFiles<ProductDto>(dir, errors))
        {
            foreach (var dto in dtos)
            {
                try
                {
                    var product = ToProduct(dto, file, buildingTypes);
                    if (!result.TryAdd(product.Id, product))
                    {
                        errors.Add($"{file}: duplicate product id '{product.Id}'");
                    }
                }
                catch (Exception ex)
                {
                    errors.Add($"{file}: {ex.Message}");
                }
            }
        }

        return result;
    }

    private static Product ToProduct(ProductDto dto, string file, IReadOnlyDictionary<BuildingTypeId, BuildingType> buildingTypes)
    {
        _ = file;
        if (string.IsNullOrWhiteSpace(dto.Id))
        {
            throw new InvalidOperationException("product has no id");
        }

        var tier = ParseTier(dto.Tier, dto.Id);

        // Semantic rule: raws have no recipe; intermediates/finished must.
        switch (tier)
        {
            case ProductTier.Raw when dto.Recipe is not null:
                throw new InvalidOperationException($"product '{dto.Id}' is raw but has a recipe");
            case ProductTier.Intermediate or ProductTier.Finished when dto.Recipe is null:
                throw new InvalidOperationException($"product '{dto.Id}' is {tier.ToString().ToLowerInvariant()} but is missing a recipe");
        }

        // Semantic rule: extraction is only valid on raws.
        if (dto.Extraction is not null && tier != ProductTier.Raw)
        {
            throw new InvalidOperationException($"product '{dto.Id}' has an extraction block but is not a raw");
        }

        Recipe? recipe = dto.Recipe is null ? null : MarketContent.ToRecipe(dto.Id, dto.Recipe);
        ProductExtraction? extraction = dto.Extraction is null ? null : MarketContent.ToExtraction(dto.Id, dto.Extraction);

        var demand = BuildDemand(dto.BaseDemandPerCapita);
        var reservation = BuildReservation(dto.ReservationPrice);

        var product = new Product(
            new ProductId(dto.Id),
            dto.Name,
            tier,
            dto.Category,
            dto.Unit,
            dto.BaseWorldMarketPrice,
            dto.PriceElasticity ?? 1.0,
            dto.MaxTechLevel ?? 10,
            demand,
            recipe,
            extraction,
            reservation);

        return product with
        {
            Demand = tier == ProductTier.Finished ? MarketContent.ToDemandProfile(dto, product, buildingTypes) : null,
            Trade = MarketContent.ToTradeProfile(dto, product),
        };
    }

    private static ProductTier ParseTier(string value, string id) => value switch
    {
        "raw" => ProductTier.Raw,
        "intermediate" => ProductTier.Intermediate,
        "finished" => ProductTier.Finished,
        _ => throw new InvalidOperationException($"product '{id}': unknown tier '{value}'"),
    };

    private static IReadOnlyDictionary<IncomeBracket, double> BuildDemand(DemandDto? dto)
    {
        var d = new Dictionary<IncomeBracket, double>
        {
            [IncomeBracket.Low]    = dto?.Low ?? 0.0,
            [IncomeBracket.Middle] = dto?.Middle ?? 0.0,
            [IncomeBracket.High]   = dto?.High ?? 0.0,
        };
        return d;
    }

    /// <summary>
    /// Convert the optional reservation-price DTO into a per-bracket map.
    /// Returns <c>null</c> if the DTO is absent (uniform-no-ceiling product).
    /// Brackets omitted from the DTO are also "no ceiling" — we leave the key
    /// missing so callers can use a sentinel default.
    /// </summary>
    private static IReadOnlyDictionary<IncomeBracket, decimal>? BuildReservation(ReservationDto? dto)
    {
        if (dto is null) return null;

        var d = new Dictionary<IncomeBracket, decimal>();
        if (dto.Low    is not null) d[IncomeBracket.Low]    = (decimal)dto.Low.Value;
        if (dto.Middle is not null) d[IncomeBracket.Middle] = (decimal)dto.Middle.Value;
        if (dto.High   is not null) d[IncomeBracket.High]   = (decimal)dto.High.Value;
        return d.Count == 0 ? null : d;
    }

    // ------------------------------------------------------------------------ buildings

    private static IReadOnlyDictionary<BuildingTypeId, BuildingType> LoadBuildingTypes(string root, List<string> errors)
    {
        var dir = Path.Combine(root, "data", "buildings");
        var result = new Dictionary<BuildingTypeId, BuildingType>();

        foreach (var (file, dtos) in ReadArrayFiles<BuildingTypeDto>(dir, errors))
        {
            foreach (var dto in dtos)
            {
                try
                {
                    var bt = ToBuildingType(dto);
                    if (!result.TryAdd(bt.Id, bt))
                    {
                        errors.Add($"{file}: duplicate building id '{bt.Id}'");
                    }
                }
                catch (Exception ex)
                {
                    errors.Add($"{file}: {ex.Message}");
                }
            }
        }

        return result;
    }

    private static BuildingType ToBuildingType(BuildingTypeDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Id))
        {
            throw new InvalidOperationException("building has no id");
        }

        var tiers = (dto.ProducibleTiers ?? Array.Empty<string>())
            .Select(t => ParseTier(t, dto.Id))
            .ToList();

        HeadcountRange? headcount = dto.TargetHeadcount is null
            ? null
            : new HeadcountRange(dto.TargetHeadcount.Min, dto.TargetHeadcount.Max);

        if (headcount is not null && headcount.Min > headcount.Max)
        {
            throw new InvalidOperationException($"building '{dto.Id}': targetHeadcount.min > max");
        }

        GeographyRequirement? geo = dto.GeographyRequirement is null
            ? null
            : new GeographyRequirement(
                dto.GeographyRequirement.Coastal,
                dto.GeographyRequirement.Arable,
                dto.GeographyRequirement.MineralRich,
                dto.GeographyRequirement.OilRich);

        IReadOnlyList<BuildingLevelConfig>? levels = null;
        if (dto.Levels is not null && dto.Levels.Count > 0)
        {
            var list = new List<BuildingLevelConfig>(dto.Levels.Count);
            var expected = 1;
            foreach (var lvl in dto.Levels)
            {
                if (lvl.Level != expected)
                {
                    throw new InvalidOperationException(
                        $"building '{dto.Id}': levels must be ordered starting at 1 (saw {lvl.Level}, expected {expected})");
                }
                if (lvl.Capacity < 1)
                {
                    throw new InvalidOperationException(
                        $"building '{dto.Id}' L{lvl.Level}: capacity must be >= 1");
                }
                if (lvl.MonthlyOperatingCost < 0)
                {
                    throw new InvalidOperationException(
                        $"building '{dto.Id}' L{lvl.Level}: monthlyOperatingCost must be >= 0");
                }
                if (lvl.UpgradeCost < 0)
                {
                    throw new InvalidOperationException(
                        $"building '{dto.Id}' L{lvl.Level}: upgradeCost must be >= 0");
                }
                list.Add(new BuildingLevelConfig(
                    lvl.Level,
                    lvl.Capacity,
                    (decimal)lvl.MonthlyOperatingCost,
                    (decimal)lvl.UpgradeCost));
                expected++;
            }
            levels = list;
        }

        var buildingType = new BuildingType(
            new BuildingTypeId(dto.Id),
            dto.Name,
            dto.Category,
            (decimal)dto.ConstructionCost,
            (decimal)dto.MonthlyOperatingCost,
            new Footprint(dto.Footprint.Width, dto.Footprint.Height),
            dto.MaxUnits,
            tiers,
            dto.Retail ?? false,
            headcount,
            geo,
            levels);

        return MarketContent.WithMarketFields(buildingType, dto);
    }

    // ------------------------------------------------------------------------ cities

    private static IReadOnlyDictionary<CityId, City> LoadCities(string root, List<string> errors)
    {
        var dir = Path.Combine(root, "data", "cities");
        var result = new Dictionary<CityId, City>();

        if (!Directory.Exists(dir))
        {
            return result;
        }

        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
        {
            try
            {
                using var stream = File.OpenRead(file);
                var dto = JsonSerializer.Deserialize<CityDto>(stream, JsonOptions)
                    ?? throw new InvalidOperationException("city file deserialized to null");

                var city = ToCity(dto);

                if (!result.TryAdd(city.Id, city))
                {
                    errors.Add($"{file}: duplicate city id '{city.Id}'");
                }
            }
            catch (Exception ex)
            {
                errors.Add($"{file}: {ex.Message}");
            }
        }

        return result;
    }

    private static City ToCity(CityDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Id))
        {
            throw new InvalidOperationException("city has no id");
        }

        var demographics = new Dictionary<IncomeBracket, double>
        {
            [IncomeBracket.Low]    = dto.Demographics.Low,
            [IncomeBracket.Middle] = dto.Demographics.Middle,
            [IncomeBracket.High]   = dto.Demographics.High,
        };

        var sum = demographics.Values.Sum();
        if (Math.Abs(sum - 1.0) > 0.001)
        {
            throw new InvalidOperationException($"city '{dto.Id}': demographics sum to {sum:F3}, expected 1.000");
        }

        var city = new City(
            new CityId(dto.Id),
            dto.Name,
            dto.Population,
            demographics,
            new CityGrid(dto.Grid.Width, dto.Grid.Height),
            new CityGeography(
                dto.Geography?.Coastal ?? false,
                dto.Geography?.Arable ?? true,
                dto.Geography?.MineralRich ?? false,
                dto.Geography?.OilRich ?? false),
            (decimal)(dto.BaseLandPrice ?? 100.0));

        return MarketContent.WithMarketFields(city, dto);
    }

    // ------------------------------------------------------------------------ shared

    private static IEnumerable<(string file, IReadOnlyList<T> dtos)> ReadArrayFiles<T>(string dir, List<string> errors)
    {
        if (!Directory.Exists(dir))
        {
            yield break;
        }

        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
        {
            IReadOnlyList<T>? parsed = null;
            try
            {
                using var stream = File.OpenRead(file);
                parsed = JsonSerializer.Deserialize<List<T>>(stream, JsonOptions);
            }
            catch (Exception ex)
            {
                errors.Add($"{file}: {ex.Message}");
            }

            if (parsed is null)
            {
                continue;
            }

            yield return (file, parsed);
        }
    }

    private static void ValidateReferentialIntegrity(
        IReadOnlyDictionary<ProductId, Product> products,
        List<string> errors)
    {
        foreach (var product in products.Values)
        {
            if (product.Recipe is null)
            {
                continue;
            }

            foreach (var input in product.Recipe.Inputs)
            {
                if (!products.ContainsKey(input.ProductId))
                {
                    errors.Add($"product '{product.Id}': recipe input references unknown product '{input.ProductId}'");
                }
                else if (input.ProductId == product.Id)
                {
                    errors.Add($"product '{product.Id}': recipe input references itself");
                }
            }
        }
    }

    // ------------------------------------------------------------------------ DTOs

    internal sealed record ProductDto(
        string Id,
        string Name,
        string Tier,
        string Category,
        string Unit,
        double BaseWorldMarketPrice,
        double? PriceElasticity,
        int? MaxTechLevel,
        DemandDto? BaseDemandPerCapita,
        RecipeDto? Recipe,
        ExtractionDto? Extraction,
        ReservationDto? ReservationPrice,
        double? ReferencePrice = null,
        double? WtpSigma = null,
        double? OfferElasticity = null,
        double? ValueSpread = null,
        AttributeWeightsDto? AttributeWeights = null,
        IncumbentDto? Incumbent = null,
        double? ImportBrand = null,
        string? RetailCategory = null,
        string? ReferenceStore = null,
        double? ImportMultiplier = null,
        double? ExportMultiplier = null,
        bool? Exportable = null,
        double? WorldMarketDepth = null);

    internal sealed record ExtractionDto(
        string SourceCategory,
        double YieldPerSlotPerMonth,
        double? OtherCostPerUnit = null,
        double? LaborPerSlot = null,
        double? EquipmentCapex = null,
        double? FieldsCapex = null);

    internal sealed record AttributeWeightsDto(double? Quality, double? Brand, double? Tech);

    internal sealed record IncumbentDto(double? Brand, double? Quality);

    internal sealed record DemandDto(double? Low, double? Middle, double? High);

    internal sealed record ReservationDto(double? Low, double? Middle, double? High);

    internal sealed record RecipeDto(
        double OutputQuantity,
        double LaborUnits,
        IReadOnlyList<RecipeInputDto> Inputs,
        double? OutputPerSlotMonth = null,
        double? LaborPerSlot = null,
        double? OtherCostPerUnit = null,
        double? KwhPerUnit = null,
        double? LineCapex = null);

    internal sealed record RecipeInputDto(string ProductId, double Quantity);

    internal sealed record BuildingTypeDto(
        string Id,
        string Name,
        string Category,
        double ConstructionCost,
        double MonthlyOperatingCost,
        FootprintDto Footprint,
        int MaxUnits,
        IReadOnlyList<string>? ProducibleTiers,
        bool? Retail,
        HeadcountDto? TargetHeadcount,
        GeographyDto? GeographyRequirement,
        IReadOnlyList<BuildingLevelDto>? Levels = null,
        StaffDto? Staff = null,
        RetailFormatDto? RetailFormat = null,
        double? StorageValuePerSlot = null,
        int? BuildMonths = null);

    internal sealed record StaffDto(double? Fixed, string? FixedRole, double? PerSlot, string? SlotRole);

    internal sealed record RetailFormatDto(double? CapacityPerSlot, Dictionary<string, double>? Draw);

    internal sealed record BuildingLevelDto(
        int Level,
        int Capacity,
        double MonthlyOperatingCost,
        double UpgradeCost);

    internal sealed record FootprintDto(int Width, int Height);

    internal sealed record HeadcountDto(int Min, int Max);

    internal sealed record GeographyDto(bool? Coastal, bool? Arable, bool? MineralRich, bool? OilRich);

    internal sealed record CityDto(
        string Id,
        string Name,
        long Population,
        CityDemographicsDto Demographics,
        CityGridDto Grid,
        GeographyDto? Geography,
        double? BaseLandPrice,
        double? WageIndex = null,
        double? PriceIndex = null);

    internal sealed record CityDemographicsDto(double Low, double Middle, double High);

    internal sealed record CityGridDto(int Width, int Height);

    // Phase 3.65 — events DTOs.
    private sealed record EventDto(
        string Id,
        string Name,
        string? Description,
        EventTriggerDto? Trigger,
        IReadOnlyList<EventEffectDto>? Effects,
        int Weight,
        string? Severity);

    private sealed record EventTriggerDto(string? Type);

    private sealed record EventEffectDto(
        string? Type,
        string? ProductId,
        string? CityId,
        double? Multiplier,
        int? DurationMonths,
        int? Delta);
}
