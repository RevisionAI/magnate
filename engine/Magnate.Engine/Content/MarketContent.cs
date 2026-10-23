using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Content;

/// <summary>
/// Loader rules for the market-economics content fields (econ-audit §4.1, §4.3–4.7): parses the
/// optional new fields, falls back to category defaults when they are missing (so the frozen
/// Classic content and third-party content keep loading), maps legacy fields
/// (<c>laborUnits</c> → <c>laborPerSlot = 5·u</c>, a reservation price of 0 → the bracket is not a
/// market) and validates ranges. Every failure is an <see cref="InvalidOperationException"/>
/// that <see cref="ContentLoader"/> collects per file.
/// </summary>
internal static class MarketContent
{
    /// <summary>Reference shelf price ÷ world price when the content gives no <c>referencePrice</c>.</summary>
    public const double DefaultReferenceMarkup = 1.6;

    /// <summary>Default retail throughput per slot ($ at reference price per month).</summary>
    public const decimal DefaultRetailCapacityPerSlot = 450_000m;

    /// <summary>Legacy labour units → staff per slot (econ-audit §4.5).</summary>
    public const double LaborUnitsToStaff = 5.0;

    // ------------------------------------------------------------------ products

    public static Recipe ToRecipe(string productId, ContentLoader.RecipeDto dto)
    {
        if (dto.Inputs is null) throw new InvalidOperationException($"product '{productId}': recipe.inputs required");
        var recipe = new Recipe(
            dto.OutputQuantity,
            dto.LaborUnits,
            dto.Inputs.Select(i => new RecipeInput(new ProductId(i.ProductId), i.Quantity)).ToList())
        {
            OutputPerSlotMonth = dto.OutputPerSlotMonth,
            LaborPerSlot = dto.LaborPerSlot ?? LaborUnitsToStaff * dto.LaborUnits,
            OtherCostPerUnit = (decimal)(dto.OtherCostPerUnit ?? 0.0),
            KwhPerUnit = dto.KwhPerUnit ?? 0.0,
            LineCapex = (decimal)(dto.LineCapex ?? 0.0),
        };

        if (recipe.OutputQuantity <= 0) throw new InvalidOperationException($"product '{productId}': recipe.outputQuantity must be positive");
        if (recipe.OutputPerSlotMonth is double perMonth && !(perMonth > 0 && double.IsFinite(perMonth)))
            throw new InvalidOperationException($"product '{productId}': recipe.outputPerSlotMonth must be positive");
        RequireNonNegative(productId, "recipe.laborPerSlot", recipe.LaborPerSlot);
        RequireNonNegative(productId, "recipe.otherCostPerUnit", (double)recipe.OtherCostPerUnit);
        RequireNonNegative(productId, "recipe.kwhPerUnit", recipe.KwhPerUnit);
        RequireNonNegative(productId, "recipe.lineCapex", (double)recipe.LineCapex);
        foreach (var input in recipe.Inputs)
        {
            if (!(input.Quantity > 0)) throw new InvalidOperationException($"product '{productId}': recipe input '{input.ProductId}' quantity must be positive");
        }

        return recipe;
    }

    public static ProductExtraction ToExtraction(string productId, ContentLoader.ExtractionDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.SourceCategory)) throw new InvalidOperationException($"product '{productId}': extraction.sourceCategory required");
        var extraction = new ProductExtraction(dto.SourceCategory, dto.YieldPerSlotPerMonth)
        {
            OtherCostPerUnit = (decimal)(dto.OtherCostPerUnit ?? 0.0),
            LaborPerSlot = dto.LaborPerSlot ?? 4.0,
            EquipmentCapex = (decimal)(dto.EquipmentCapex ?? 0.0),
            FieldsCapex = (decimal)(dto.FieldsCapex ?? 0.0),
        };
        if (!(extraction.YieldPerSlotPerMonth > 0)) throw new InvalidOperationException($"product '{productId}': extraction.yieldPerSlotPerMonth must be positive");
        RequireNonNegative(productId, "extraction.otherCostPerUnit", (double)extraction.OtherCostPerUnit);
        RequireNonNegative(productId, "extraction.laborPerSlot", extraction.LaborPerSlot);
        RequireNonNegative(productId, "extraction.equipmentCapex", (double)extraction.EquipmentCapex);
        RequireNonNegative(productId, "extraction.fieldsCapex", (double)extraction.FieldsCapex);
        return extraction;
    }

    /// <summary>
    /// Resolve the demand profile of a finished good. Missing fields fall back to category
    /// defaults; <c>priceElasticity</c> is read as the category elasticity ε (econ-audit §4.1
    /// semantics change); a reservation price of 0 removes that bracket from the market.
    /// </summary>
    public static ProductDemandProfile ToDemandProfile(
        ContentLoader.ProductDto dto,
        Product product,
        IReadOnlyDictionary<BuildingTypeId, BuildingType> buildingTypes)
    {
        var id = product.Id.Value;
        var retailCategory = string.IsNullOrWhiteSpace(dto.RetailCategory) ? DefaultRetailCategory(product.Category) : dto.RetailCategory!;
        BuildingTypeId referenceStore;
        if (!string.IsNullOrWhiteSpace(dto.ReferenceStore))
        {
            referenceStore = new BuildingTypeId(dto.ReferenceStore!);
            if (!buildingTypes.TryGetValue(referenceStore, out var store) || store.RetailFormat is null)
                throw new InvalidOperationException($"product '{id}': referenceStore '{dto.ReferenceStore}' is not a retail building type");
        }
        else
        {
            referenceStore = DefaultReferenceStore(retailCategory, buildingTypes)
                ?? throw new InvalidOperationException($"product '{id}': no retail building type can size its incumbents (add referenceStore)");
        }

        var weights = dto.AttributeWeights;
        double wQ = weights?.Quality ?? 0.35, wB = weights?.Brand ?? 0.40, wT = weights?.Tech ?? 0.25;
        var incumbentBrand = dto.Incumbent?.Brand ?? 45.0;

        double Q(IncomeBracket bracket)
        {
            var q = product.BaseDemandPerCapita.TryGetValue(bracket, out var v) ? v : 0.0;
            // Legacy content: a reservation price of 0 means the bracket is not a market for p.
            if (product.ReservationPrice is not null && product.ReservationPrice.TryGetValue(bracket, out var rp) && rp <= 0m) return 0.0;
            return q;
        }

        var profile = new ProductDemandProfile(
            ReferencePrice: (decimal)(dto.ReferencePrice ?? product.BaseWorldMarketPrice * DefaultReferenceMarkup),
            PerCapitaLow: Q(IncomeBracket.Low),
            PerCapitaMiddle: Q(IncomeBracket.Middle),
            PerCapitaHigh: Q(IncomeBracket.High),
            CategoryElasticity: product.PriceElasticity,
            WtpSigma: dto.WtpSigma ?? 0.5,
            OfferElasticity: dto.OfferElasticity ?? 5.0,
            ValueSpread: dto.ValueSpread ?? 0.7,
            WeightQuality: wQ,
            WeightBrand: wB,
            WeightTech: wT,
            IncumbentBrand: incumbentBrand,
            IncumbentQuality: dto.Incumbent?.Quality ?? 50.0,
            ImportBrand: dto.ImportBrand ?? incumbentBrand,
            RetailCategory: retailCategory,
            ReferenceStore: referenceStore);

        Validate(id, profile);
        return profile;
    }

    private static void Validate(string id, ProductDemandProfile p)
    {
        if (!(p.ReferencePrice > 0m)) throw new InvalidOperationException($"product '{id}': referencePrice must be positive");
        if (!(p.WeightQuality > 0 && p.WeightBrand > 0 && p.WeightTech > 0))
            throw new InvalidOperationException($"product '{id}': attributeWeights must all be positive");
        var sum = p.WeightQuality + p.WeightBrand + p.WeightTech;
        if (Math.Abs(sum - 1.0) > 1e-6) throw new InvalidOperationException($"product '{id}': attributeWeights sum to {sum:R}, expected 1");
        RequireRange(id, "wtpSigma", p.WtpSigma, 0.2, 1.0);
        RequireRange(id, "offerElasticity", p.OfferElasticity, 1.2, 12.0);
        RequireRange(id, "valueSpread", p.ValueSpread, 0.2, 1.5);
        // The low bracket multiplies ε by 1.4; z(ε) must stay solvable on [−8, 4] for σ ≤ 1.
        RequireRange(id, "priceElasticity", p.CategoryElasticity, 0.05, 2.5);
        RequireRange(id, "incumbent.brand", p.IncumbentBrand, 0, 100);
        RequireRange(id, "incumbent.quality", p.IncumbentQuality, 0, 100);
        RequireRange(id, "importBrand", p.ImportBrand, 0, 100);
        RequireNonNegative(id, "baseDemandPerCapita", Math.Min(p.PerCapitaLow, Math.Min(p.PerCapitaMiddle, p.PerCapitaHigh)));
    }

    public static ProductTradeProfile ToTradeProfile(ContentLoader.ProductDto dto, Product product)
    {
        var id = product.Id.Value;
        var finished = product.Tier == ProductTier.Finished;
        var import = (decimal)(dto.ImportMultiplier ?? (finished ? 1.12 : 1.10));
        var export = (decimal)(dto.ExportMultiplier ?? (finished ? 0.93 : 0.92));
        var exportable = dto.Exportable ?? true;
        var depth = dto.WorldMarketDepth ?? DefaultDepth(product);

        if (!(import >= 1m)) throw new InvalidOperationException($"product '{id}': importMultiplier must be >= 1");
        if (!(export > 0m && export <= 1m)) throw new InvalidOperationException($"product '{id}': exportMultiplier must be in (0, 1]");
        if (!(depth >= 0 && double.IsFinite(depth))) throw new InvalidOperationException($"product '{id}': worldMarketDepth must be >= 0");
        return new ProductTradeProfile(import, export, exportable, depth);
    }

    /// <summary>Three L1 slots' monthly output (econ-audit §4.4: depth ≈ 2–4 × one slot).</summary>
    private static double DefaultDepth(Product product)
    {
        if (product.Extraction is not null) return 3 * product.Extraction.YieldPerSlotPerMonth;
        if (product.Recipe is not null) return 3 * product.Recipe.CyclesPerSlotMonth * product.Recipe.OutputQuantity;
        return 0;
    }

    public static string DefaultRetailCategory(string productCategory) => productCategory switch
    {
        "beverage" or "food" => "grocery",
        "apparel" => "apparel",
        "electronics" => "electronics",
        "automotive" => "auto",
        _ => "general",
    };

    private static BuildingTypeId? DefaultReferenceStore(string retailCategory, IReadOnlyDictionary<BuildingTypeId, BuildingType> buildingTypes)
    {
        // The retail type with the strongest draw for the category; ties go to the lowest id.
        BuildingType? best = null;
        var bestDraw = 0.0;
        foreach (var type in buildingTypes.Values.OrderBy(t => t.Id.Value, StringComparer.Ordinal))
        {
            if (type.RetailFormat is null) continue;
            var draw = type.RetailFormat.DrawFor(retailCategory);
            if (draw > bestDraw)
            {
                bestDraw = draw;
                best = type;
            }
        }

        if (best is not null) return best.Id;
        var anyRetail = buildingTypes.Values.Where(t => t.RetailFormat is not null).OrderBy(t => t.Id.Value, StringComparer.Ordinal).FirstOrDefault();
        return anyRetail?.Id;
    }

    // ------------------------------------------------------------------ buildings

    public static BuildingType WithMarketFields(BuildingType type, ContentLoader.BuildingTypeDto dto)
    {
        var id = type.Id.Value;
        var staffing = ToStaffing(type, dto.Staff);
        RetailFormat? format = null;
        if (type.Retail)
        {
            var capacity = (decimal)(dto.RetailFormat?.CapacityPerSlot ?? (double)DefaultRetailCapacityPerSlot);
            if (!(capacity > 0m)) throw new InvalidOperationException($"building '{id}': retailFormat.capacityPerSlot must be positive");
            IReadOnlyDictionary<string, double> draw;
            if (dto.RetailFormat?.Draw is { Count: > 0 } explicitDraw)
            {
                foreach (var (category, value) in explicitDraw)
                {
                    if (string.IsNullOrWhiteSpace(category)) throw new InvalidOperationException($"building '{id}': retailFormat.draw has a blank category");
                    RequireRange(id, $"retailFormat.draw.{category}", value, 0, 5);
                }

                draw = new SortedDictionary<string, double>(explicitDraw, StringComparer.Ordinal);
            }
            else
            {
                draw = DefaultDraw(type.Category);
            }

            format = new RetailFormat(capacity, draw);
        }
        else if (dto.RetailFormat is not null)
        {
            throw new InvalidOperationException($"building '{id}': retailFormat is only valid on retail buildings");
        }

        decimal? storage = dto.StorageValuePerSlot is double s ? (decimal)s : null;
        if (storage is decimal sv && sv <= 0m) throw new InvalidOperationException($"building '{id}': storageValuePerSlot must be positive");
        if (dto.BuildMonths is int months && months < 0) throw new InvalidOperationException($"building '{id}': buildMonths must be >= 0");

        return type with
        {
            Staffing = staffing,
            RetailFormat = format,
            StorageValuePerSlot = storage,
            BuildMonths = dto.BuildMonths,
        };
    }

    private static BuildingStaffing ToStaffing(BuildingType type, ContentLoader.StaffDto? dto)
    {
        var id = type.Id.Value;
        var (defaultFixedRole, defaultPerSlot, defaultSlotRole) = type.Category switch
        {
            _ when type.Retail => (StaffRoles.Retail, 3.0, StaffRoles.Retail),
            "factory" => (StaffRoles.Admin, 0.0, StaffRoles.Production),
            "farm" or "plantation" => (StaffRoles.Farm, 0.0, StaffRoles.Farm),
            "mine" or "oil_well" => (StaffRoles.Extraction, 0.0, StaffRoles.Extraction),
            "rd_center" => (StaffRoles.Admin, 15.0, StaffRoles.Scientist),
            "media" => (StaffRoles.Media, 0.0, StaffRoles.Media),
            "warehouse" or "seaport" or "distribution_center" or "freight_yard" => (StaffRoles.Production, 4.0, StaffRoles.Production),
            _ => (StaffRoles.Admin, 0.0, StaffRoles.Admin),
        };

        var staffing = new BuildingStaffing(
            dto?.Fixed ?? type.TargetHeadcount?.Min ?? 0,
            dto?.FixedRole ?? defaultFixedRole,
            dto?.PerSlot ?? defaultPerSlot,
            dto?.SlotRole ?? defaultSlotRole);

        RequireNonNegative(id, "staff.fixed", staffing.Fixed);
        RequireNonNegative(id, "staff.perSlot", staffing.PerSlot);
        if (!StaffRoles.IsKnown(staffing.FixedRole)) throw new InvalidOperationException($"building '{id}': unknown staff role '{staffing.FixedRole}'");
        if (!StaffRoles.IsKnown(staffing.SlotRole)) throw new InvalidOperationException($"building '{id}': unknown staff role '{staffing.SlotRole}'");
        return staffing;
    }

    private static IReadOnlyDictionary<string, double> DefaultDraw(string storeCategory)
    {
        var draw = new SortedDictionary<string, double>(StringComparer.Ordinal);
        switch (storeCategory)
        {
            case "convenience_store":
                draw["grocery"] = 0.30;
                break;
            case "supermarket":
                draw["grocery"] = 1.00;
                draw["apparel"] = 0.35;
                break;
            case "department_store":
                draw["apparel"] = 1.00;
                draw["electronics"] = 1.00;
                draw["grocery"] = 0.25;
                break;
            case "car_dealership" or "auto_dealer":
                draw["auto"] = 1.00;
                break;
            default:
                // An unknown (modded) store format sells everything at an average draw.
                foreach (var category in new[] { "apparel", "auto", "electronics", "general", "grocery" }) draw[category] = 1.00;
                break;
        }

        return draw;
    }

    // ------------------------------------------------------------------ cities

    public static City WithMarketFields(City city, ContentLoader.CityDto dto)
    {
        var id = city.Id.Value;
        var wage = dto.WageIndex ?? 1.0;
        var price = dto.PriceIndex ?? 1.0;
        RequireRange(id, "wageIndex", wage, 0.2, 5.0);
        RequireRange(id, "priceIndex", price, 0.2, 5.0);
        return city with { WageIndex = wage, PriceIndex = price };
    }

    // ------------------------------------------------------------------ helpers

    private static void RequireNonNegative(string id, string field, double value)
    {
        if (!(value >= 0 && double.IsFinite(value))) throw new InvalidOperationException($"'{id}': {field} must be a finite number >= 0 (was {value})");
    }

    private static void RequireRange(string id, string field, double value, double min, double max)
    {
        if (!(value >= min && value <= max)) throw new InvalidOperationException($"'{id}': {field} must be in [{min}, {max}] (was {value})");
    }
}
