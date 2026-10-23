using Magnate.Engine.Market;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Land;

/// <summary>
/// The land workstream's answer to the market model's <see cref="IBuildingSiteInfo"/> seam
/// (econ-audit §4.3, §4.6): the location factor of the plots a building stands on (mean customer
/// traffic of its footprint over the city's median urban traffic, clamped 0.3–2.5, from the land
/// fields of the last month close), its land at historical cost (E2's asset register: the
/// property-tax base) and whether it operates (not under construction). Holds no state of its
/// own (everything is read from the world); worlds under land rules use it unless another
/// implementation is set.
/// </summary>
public sealed class LandSiteInfo : IBuildingSiteInfo
{
    private readonly World _world;

    /// <summary>The site view of <paramref name="world"/>.</summary>
    public LandSiteInfo(World world) => _world = world;

    /// <inheritdoc/>
    public double LocationFactor(BuildingInstance building)
    {
        if (building.Placement is not PlotRef at) return 1.0; // unsited (waiting order, legacy save)
        var world = _world;
        var fields = world.GetLandFields(building.City);
        var rect = at.Rect(world.Catalog.BuildingType(building.TypeId).Footprint);
        double traffic = 0;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++) traffic += fields.TrafficAt(x, z);
        }

        return fields.LocationFactor(traffic / System.Math.Max(1, rect.Area));
    }

    /// <inheritdoc/>
    public decimal LandCost(BuildingInstance building) => _world.GetLandCost(building.Id);

    /// <inheritdoc/>
    public bool IsOperational(BuildingInstance building) => building.IsOperational;
}
