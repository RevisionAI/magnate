using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>
/// What the market model needs to know about where a building stands (econ-audit §4.3, §4.6).
/// The land workstream (plots, E3b) supplies the real implementation through
/// <see cref="World.SiteInfo"/>; until then <see cref="NeutralSiteInfo"/> answers the neutral
/// values (every site average, no land cost, every building operational).
/// </summary>
public interface IBuildingSiteInfo
{
    /// <summary>
    /// Location factor L ∈ [0.3, 2.5]: the plot's traffic over the city's median urban traffic
    /// (<c>Land.CityFields.LocationFactorAt</c>). 1 = an average site.
    /// </summary>
    double LocationFactor(BuildingInstance building);

    /// <summary>Historical land cost of the building's plots (property-tax base). 0 when land is free.</summary>
    decimal LandCost(BuildingInstance building);

    /// <summary>
    /// False while the building is under construction: it then pays only insurance and property
    /// tax, and takes no part in production, restock, sales or exports.
    /// </summary>
    bool IsOperational(BuildingInstance building);
}

/// <summary>The neutral site: L = 1, no land cost, always operational.</summary>
public sealed class NeutralSiteInfo : IBuildingSiteInfo
{
    /// <summary>The shared stateless instance.</summary>
    public static NeutralSiteInfo Instance { get; } = new();

    private NeutralSiteInfo()
    {
    }

    /// <inheritdoc/>
    public double LocationFactor(BuildingInstance building) => 1.0;

    /// <inheritdoc/>
    public decimal LandCost(BuildingInstance building) => 0m;

    /// <inheritdoc/>
    public bool IsOperational(BuildingInstance building) => true;
}

/// <summary>
/// Credit a company can still draw (the finance workstream's revolver, econ-audit §4.10). World-
/// market purchases are capped at <c>Cash + UndrawnCredit − CashReserve</c> (§4.4); without a
/// source (Classic finance) the undrawn credit is 0.
/// </summary>
public interface ICreditHeadroom
{
    /// <summary>Undrawn committed credit available to <paramref name="company"/> right now (≥ 0).</summary>
    decimal UndrawnCredit(World world, CompanyId company);
}
