using System;
using Magnate.Engine.Domain;
using Magnate.Engine.Land.Generation;

namespace Magnate.Engine.Land;

/// <summary>
/// Generates the deterministic layout of a city (MASTER-PLAN D12, caplab-brief
/// §5.2–5.5): terrain, coast or river, an arterial grid with district-specific
/// street patterns and varied block depth, an organic urban edge, the caplab ring
/// model of districts with an industrial wedge, parcels that all front a road,
/// ambient development, landmarks, resource deposits, and the land-value and
/// traffic fields. Pure: no World state is read or written.
/// </summary>
public static class CityLayoutGenerator
{
    /// <summary>The seed used when no game is running (equal to the bridge's default new-game seed).</summary>
    public const int DefaultSeed = 1;

    /// <summary>
    /// Generates the layout of <paramref name="city"/> for <paramref name="seed"/>
    /// using its built-in identity profile, or a profile derived from its
    /// geography for cities without one. Same inputs → identical layout.
    /// </summary>
    /// <exception cref="ArgumentNullException"><paramref name="city"/> is null.</exception>
    /// <exception cref="ArgumentOutOfRangeException">The city grid is outside 16..256 plots.</exception>
    public static CityLayout Generate(City city, int seed)
    {
        ArgumentNullException.ThrowIfNull(city);
        return Generate(city, seed, CityProfiles.Resolve(city));
    }

    /// <summary>Generates a layout with an explicit identity profile (tools and tests).</summary>
    public static CityLayout Generate(City city, int seed, CityProfile profile)
    {
        ArgumentNullException.ThrowIfNull(city);
        ArgumentNullException.ThrowIfNull(profile);
        return new LayoutBuilder(city, seed, profile).Build();
    }
}
