using System;
using System.Collections.Generic;

namespace Magnate.Engine.Domain;

/// <summary>
/// Consumer-demand parameters of one finished good (econ-audit §4.1 content table). Every field
/// is resolved by the content loader: values the content omits fall back to category defaults,
/// so a product built from the frozen Classic content still has a usable profile under
/// Realistic rules.
/// </summary>
/// <param name="ReferencePrice">Pref: the reference shelf price at CPI 1 and city price index 1 ($).</param>
/// <param name="PerCapitaLow">q for the Low bracket: units per capita per month when only incumbents trade at Pref.</param>
/// <param name="PerCapitaMiddle">q for the Middle bracket.</param>
/// <param name="PerCapitaHigh">q for the High bracket.</param>
/// <param name="CategoryElasticity">ε: category (total-market) price elasticity of the Middle bracket at the reference point.</param>
/// <param name="WtpSigma">σ: log-standard deviation of the lognormal willingness-to-pay distribution.</param>
/// <param name="OfferElasticity">θ: substitution elasticity between offers (Middle bracket).</param>
/// <param name="ValueSpread">κ: how strongly perceived value multiplies willingness to pay (S = 100 → e^κ).</param>
/// <param name="WeightQuality">wQ: weight of quality in perceived value (the three weights sum to 1).</param>
/// <param name="WeightBrand">wB: weight of brand.</param>
/// <param name="WeightTech">wT: weight of technology.</param>
/// <param name="IncumbentBrand">B₀: brand of the unmodelled local competition.</param>
/// <param name="IncumbentQuality">Q₀: quality of the local competition.</param>
/// <param name="ImportBrand">Brand floor carried by imported (national-brand) goods (P0 max rule).</param>
/// <param name="RetailCategory">Retail category (grocery, apparel, electronics, auto, …) matched against store draws.</param>
/// <param name="ReferenceStore">Store type that sizes the incumbent offer (its throughput per slot).</param>
public sealed record ProductDemandProfile(
    decimal ReferencePrice,
    double PerCapitaLow,
    double PerCapitaMiddle,
    double PerCapitaHigh,
    double CategoryElasticity,
    double WtpSigma,
    double OfferElasticity,
    double ValueSpread,
    double WeightQuality,
    double WeightBrand,
    double WeightTech,
    double IncumbentBrand,
    double IncumbentQuality,
    double ImportBrand,
    string RetailCategory,
    BuildingTypeId ReferenceStore)
{
    /// <summary>q for a bracket.</summary>
    public double PerCapita(IncomeBracket bracket) => bracket switch
    {
        IncomeBracket.Low => PerCapitaLow,
        IncomeBracket.Middle => PerCapitaMiddle,
        _ => PerCapitaHigh,
    };
}

/// <summary>
/// World-market trade terms of a product (econ-audit §4.4): what importing costs and exporting
/// earns relative to the world price, and how deep the export market is.
/// </summary>
/// <param name="ImportMultiplier">Landed import price ÷ world price (freight, broker, importer margin).</param>
/// <param name="ExportMultiplier">Export netback ÷ world price at zero volume.</param>
/// <param name="Exportable">False for perishables (bread, fresh coffee): they can be imported but never exported.</param>
/// <param name="WorldMarketDepth">Export volume (units/month, all companies) at which the export price factor is 1/√2. 0 = infinitely deep.</param>
public sealed record ProductTradeProfile(
    decimal ImportMultiplier,
    decimal ExportMultiplier,
    bool Exportable,
    double WorldMarketDepth)
{
    /// <summary>Frictionless terms (multipliers 1, exportable, infinite depth): the Classic world market.</summary>
    public static ProductTradeProfile Default { get; } = new(1m, 1m, true, 0);
}

/// <summary>
/// Wage roles of the payroll model (econ-audit §4.5). Content names roles with these ids.
/// </summary>
public static class StaffRoles
{
    /// <summary>Factory production workers.</summary>
    public const string Production = "production";

    /// <summary>Store staff.</summary>
    public const string Retail = "retail";

    /// <summary>Farm and plantation workers.</summary>
    public const string Farm = "farm";

    /// <summary>Mine and oil-field workers.</summary>
    public const string Extraction = "extraction";

    /// <summary>Administration and management.</summary>
    public const string Admin = "admin";

    /// <summary>R&amp;D scientists.</summary>
    public const string Scientist = "scientist";

    /// <summary>Media staff.</summary>
    public const string Media = "media";

    /// <summary>Every known role, in a stable order.</summary>
    public static IReadOnlyList<string> All { get; } = new[] { Production, Retail, Farm, Extraction, Admin, Scientist, Media };

    /// <summary>True when <paramref name="role"/> is a known role id.</summary>
    public static bool IsKnown(string? role) => role is not null && Array.IndexOf((string[])All, role) >= 0;
}

/// <summary>
/// Staffing of a building type (econ-audit §4.5): <c>Headcount = Fixed · LevelStaffMult(level) +
/// Σ active slots · per-slot staff</c>. Production and extraction slots take their per-slot staff
/// from the recipe / raw (<see cref="Recipe.LaborPerSlot"/>, <see cref="ProductExtraction.LaborPerSlot"/>);
/// retail, warehouse and research slots use <see cref="PerSlot"/>.
/// </summary>
/// <param name="Fixed">Fixed staff at level 1.</param>
/// <param name="FixedRole">Wage role of the fixed staff.</param>
/// <param name="PerSlot">Staff per active retail/warehouse/research slot.</param>
/// <param name="SlotRole">Wage role of slot staff (production/extraction slots use the recipe's or raw's role).</param>
public sealed record BuildingStaffing(double Fixed, string FixedRole, double PerSlot, string SlotRole)
{
    /// <summary>No staff (buildings created in code without content).</summary>
    public static BuildingStaffing None { get; } = new(0, StaffRoles.Admin, 0, StaffRoles.Admin);
}

/// <summary>
/// Retail format of a store type (econ-audit §4.3): throughput per slot and how well the format
/// draws shoppers for each retail category (0 or missing = the category is not sold there).
/// </summary>
/// <param name="CapacityPerSlot">Throughput per slot per month, in dollars at the product's reference price.</param>
/// <param name="Draw">Draw by retail category id.</param>
public sealed record RetailFormat(decimal CapacityPerSlot, IReadOnlyDictionary<string, double> Draw)
{
    /// <summary>Draw of this format for a retail category (0 when not sold here).</summary>
    public double DrawFor(string category) => Draw.TryGetValue(category, out var d) ? d : 0.0;
}
