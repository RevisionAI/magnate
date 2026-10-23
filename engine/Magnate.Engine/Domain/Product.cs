using System.Collections.Generic;

namespace Magnate.Engine.Domain;

/// <summary>
/// How a raw material is extracted. Only present on raw products.
/// </summary>
public sealed record ProductExtraction(
    string SourceCategory,
    double YieldPerSlotPerMonth)
{
    /// <summary>
    /// Cash cost per extracted unit (lifting, seed, fertiliser, royalty; econ-audit §4.7), charged
    /// and capitalised into the raw's cost basis under Realistic market rules. 0 when the content
    /// omits it (Classic: raws enter inventory at zero cost).
    /// </summary>
    public decimal OtherCostPerUnit { get; init; }

    /// <summary>Staff per active extraction slot (econ-audit §4.5).</summary>
    public double LaborPerSlot { get; init; }

    /// <summary>
    /// Equipment capex per extraction slot (farm machinery, mine or well equipment), paid the
    /// first month the slot operates under Realistic market rules.
    /// </summary>
    public decimal EquipmentCapex { get; init; }

    /// <summary>
    /// Field (land) capex per farm or plantation slot. Informational until land accounting
    /// (E3b) books it: land is not depreciated, so it is not charged as equipment.
    /// </summary>
    public decimal FieldsCapex { get; init; }
}

/// <summary>
/// A tradeable good. Raw materials have no recipe and MAY have an
/// <see cref="Extraction"/> definition indicating which building extracts them.
/// Intermediates and finished goods always have a recipe.
/// Only finished goods carry meaningful <see cref="BaseDemandPerCapita"/> values.
/// </summary>
/// <remarks>
/// <see cref="ReservationPrice"/> (Phase 3.44) is an optional per-bracket price ceiling.
/// If a retailer's price exceeds a bracket's reservation, that bracket contributes zero
/// demand for that retailer (other brackets may still buy). A <c>null</c> dictionary or
/// a missing bracket key is treated as "no ceiling" (i.e. <c>decimal.MaxValue</c>),
/// preserving pre-3.44 behaviour for products that don't opt in.
/// </remarks>
public sealed record Product(
    ProductId Id,
    string Name,
    ProductTier Tier,
    string Category,
    string Unit,
    double BaseWorldMarketPrice,
    double PriceElasticity,
    int MaxTechLevel,
    IReadOnlyDictionary<IncomeBracket, double> BaseDemandPerCapita,
    Recipe? Recipe,
    ProductExtraction? Extraction,
    IReadOnlyDictionary<IncomeBracket, decimal>? ReservationPrice = null)
{
    /// <summary>
    /// Consumer-demand parameters of the Realistic demand model (econ-audit §4.1). Resolved by
    /// the content loader for every finished good (missing fields fall back to category
    /// defaults); null for raws and intermediates.
    /// </summary>
    public ProductDemandProfile? Demand { get; init; }

    /// <summary>
    /// World-market trade terms (econ-audit §4.4): import markup, export discount, tradability
    /// and depth. Always resolved by the content loader; the default instance is used for
    /// products built in code.
    /// </summary>
    public ProductTradeProfile Trade { get; init; } = ProductTradeProfile.Default;
}
