using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land;

/// <summary>
/// The ambient (non-company) development on a parcel: what the renderer draws
/// and what a player must buy out to build there.
/// </summary>
/// <param name="Kind">The archetype.</param>
/// <param name="Floors">Storeys above ground (0 for land covers such as fields and parks).</param>
/// <param name="Variant">Seeded variant index (0–7); the renderer maps it onto its own variant count.</param>
/// <param name="Civic">Civic sub-kind when <paramref name="Kind"/> is <see cref="AmbientKind.Civic"/>.</param>
/// <param name="Deposit">Resource when <paramref name="Kind"/> is <see cref="AmbientKind.Deposit"/>.</param>
public sealed record AmbientBuilding(
    AmbientKind Kind,
    int Floors,
    int Variant,
    CivicKind Civic = CivicKind.None,
    DepositKind Deposit = DepositKind.None)
{
    /// <summary>The wire name (<c>house</c>, <c>civic:hall</c>, <c>deposit:oil</c>, …).</summary>
    public string WireKind => LandWire.Name(Kind, Civic, Deposit);

    /// <summary>
    /// True for buildings that must be bought out and demolished before a company
    /// can build on the plot (houses, shops, offices, sheds…). Land covers
    /// (fields, forest, scrub, deposits), parking and open space are not structures.
    /// </summary>
    public bool IsStructure => Kind switch
    {
        AmbientKind.House or AmbientKind.Rowhouse or AmbientKind.Villa or AmbientKind.Apartment
            or AmbientKind.Midrise or AmbientKind.Office or AmbientKind.StripMall or AmbientKind.Shop
            or AmbientKind.Civic or AmbientKind.Factory or AmbientKind.Warehouse or AmbientKind.TankFarm => true,
        _ => false,
    };
}

/// <summary>
/// A rectangular lot. Every parcel touches at least one road plot (4-neighbour
/// adjacency); landmark, civic and park parcels are never for sale.
/// </summary>
/// <param name="Id">1-based id, assigned in row-major order of the NW corner.</param>
/// <param name="Rect">The plots covered.</param>
/// <param name="District">Fine-grained land-use district.</param>
/// <param name="LandValue">Sum of the plot land values, whole dollars.</param>
/// <param name="LandValuePerPlot">Mean plot land value, whole dollars.</param>
/// <param name="Traffic">Mean customer-traffic index of the plots, 0–100.</param>
/// <param name="ForSale">Listed on the land market (vacant urban lots and all rural land).</param>
/// <param name="Vacant">No ambient structure stands on it, so building needs no buy-out.</param>
/// <param name="Ambient">What stands on the parcel, or null for a bare lot.</param>
/// <param name="Facing">Street-facing side, from the best adjacent road (or the water for port lots).</param>
/// <param name="Frontage">Best road class adjacent to the parcel.</param>
/// <param name="DepositId">The deposit under the parcel, or 0.</param>
/// <param name="Landmark">The landmark on this parcel, if any.</param>
public sealed record Parcel(
    int Id,
    PlotRect Rect,
    District District,
    decimal LandValue,
    decimal LandValuePerPlot,
    double Traffic,
    bool ForSale,
    bool Vacant,
    AmbientBuilding? Ambient,
    Facing Facing,
    RoadClass Frontage,
    int DepositId,
    LandmarkKind? Landmark)
{
    /// <summary>The bridge-spec zone of the parcel.</summary>
    public Zone Zone => LandWire.ZoneOf(District);

    /// <summary>NW corner x.</summary>
    public int Px => Rect.Px;

    /// <summary>NW corner z.</summary>
    public int Pz => Rect.Pz;

    /// <summary>Width in plots (x).</summary>
    public int W => Rect.W;

    /// <summary>Height in plots (z).</summary>
    public int H => Rect.H;

    /// <summary>The asking price when listed: the parcel's land value.</summary>
    public decimal? AskingPrice => ForSale ? LandValue : null;
}

/// <summary>
/// A straight, axis-aligned road segment one plot wide. Segments overlap at
/// intersections; the per-plot road class is the highest class through the plot.
/// </summary>
/// <param name="Id">1-based id.</param>
/// <param name="Class">Functional class.</param>
/// <param name="Lanes">Carriageway lanes (street 2, arterial 4, highway 4–6).</param>
/// <param name="Start">First plot (the west or north end).</param>
/// <param name="End">Last plot, inclusive.</param>
/// <param name="Bridge">True when at least one plot of the segment crosses water.</param>
public sealed record Road(int Id, RoadClass Class, int Lanes, PlotPoint Start, PlotPoint End, bool Bridge)
{
    /// <summary>True for a north–south segment.</summary>
    public bool Vertical => Start.Px == End.Px && Start.Pz != End.Pz;

    /// <summary>Number of plots in the segment.</summary>
    public int Length => Math.Abs(End.Px - Start.Px) + Math.Abs(End.Pz - Start.Pz) + 1;

    /// <summary>The plots of the segment from <see cref="Start"/> to <see cref="End"/>.</summary>
    public IEnumerable<PlotPoint> Path()
    {
        var dx = Math.Sign(End.Px - Start.Px);
        var dz = Math.Sign(End.Pz - Start.Pz);
        for (var i = 0; i < Length; i++)
        {
            yield return new PlotPoint(Start.Px + dx * i, Start.Pz + dz * i);
        }
    }
}

/// <summary>A rectangle of water plots of one kind and one shore treatment.</summary>
/// <param name="Rect">The plots covered.</param>
/// <param name="Kind">Sea, river or lake.</param>
/// <param name="Shore">How the rectangle meets the land: beach, quay, or a natural bank (None).</param>
public sealed record WaterRect(PlotRect Rect, WaterKind Kind, ShoreKind Shore);

/// <summary>A named landmark on a parcel.</summary>
/// <param name="Kind">What it is.</param>
/// <param name="ParcelId">The parcel it stands on.</param>
/// <param name="Rect">Its plots (equal to the parcel's).</param>
public sealed record Landmark(LandmarkKind Kind, int ParcelId, PlotRect Rect);

/// <summary>
/// A natural-resource deposit. Onshore deposits are parcels (zone agricultural)
/// on gentle slopes reached by a road; offshore deposits are visual only (oil
/// rigs drawn on the sea) and cannot be built on.
/// </summary>
/// <param name="Id">1-based id.</param>
/// <param name="Resource">Iron or oil.</param>
/// <param name="Rect">The plots of the deposit.</param>
/// <param name="Quality">Ore grade / crude quality, 35–85.</param>
/// <param name="Reserve">Recoverable reserve in <see cref="ReserveUnit"/>.</param>
/// <param name="Offshore">True for offshore (sea) deposits.</param>
public sealed record Deposit(int Id, DepositKind Resource, PlotRect Rect, int Quality, double Reserve, bool Offshore)
{
    /// <summary>Unit of <see cref="Reserve"/>: tonnes of ore or barrels of crude.</summary>
    public string ReserveUnit => Resource == DepositKind.Oil ? "bbl" : "t";
}
