using System;

namespace Magnate.Engine.Land;

/// <summary>
/// A requested or recorded building site: the north-west plot of the <em>rotated</em>
/// footprint and the rotation in degrees (0, 90, 180, 270; the front faces S, E, N, W).
/// Plot (0, 0) is the north-west corner of the city grid.
/// </summary>
/// <param name="Px">North-west plot x of the rotated footprint.</param>
/// <param name="Pz">North-west plot z of the rotated footprint.</param>
/// <param name="Rotation">Rotation in degrees.</param>
public readonly record struct PlotRef(int Px, int Pz, int Rotation = 0)
{
    /// <summary>The plots a footprint covers at this site (90° and 270° swap width and height).</summary>
    public PlotRect Rect(Domain.Footprint footprint)
    {
        var (w, h) = PlacementValidator.RotatedSize(footprint, Rotation);
        return new PlotRect(Px, Pz, w, h);
    }

    /// <inheritdoc/>
    public override string ToString() => $"({Px},{Pz}) rot {Rotation}";
}

/// <summary>
/// What the land market knows about a city beyond its generated layout: who holds the
/// title to each plot and which parcels' ambient structures have already been bought out
/// and demolished. The World implements it per city (Wave 2, E3b).
/// </summary>
public interface ILandState
{
    /// <summary>The company holding the title to the plot, or null while the city still sells it.</summary>
    int? TitleOwnerAt(int px, int pz);

    /// <summary>True once the parcel's ambient structure has been bought out (building there needs no buy-out).</summary>
    bool IsCleared(int parcelId);
}

/// <summary>
/// The buyer's view of the land market for validation and siting: plots the buyer already
/// holds cost nothing more, plots another company holds are unavailable, and parcels whose
/// ambient structure is gone need no buy-out.
/// </summary>
/// <param name="State">The city's land titles and cleared parcels.</param>
/// <param name="Buyer">The company that would build (company id).</param>
public sealed record LandContext(ILandState State, int Buyer)
{
    /// <summary>True when another company holds the plot's title.</summary>
    public bool ForeignTitle(int px, int pz) => State.TitleOwnerAt(px, pz) is int owner && owner != Buyer;

    /// <summary>True when the buyer already holds the plot's title.</summary>
    public bool OwnTitle(int px, int pz) => State.TitleOwnerAt(px, pz) == Buyer;

    /// <summary>The buy-out still owed for a parcel's ambient structure.</summary>
    public decimal Redevelopment(Parcel parcel)
    {
        ArgumentNullException.ThrowIfNull(parcel);
        return State.IsCleared(parcel.Id) ? 0m : PlacementValidator.RedevelopmentValue(parcel);
    }
}
