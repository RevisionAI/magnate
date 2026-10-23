using System.Collections.Generic;

namespace Magnate.Engine.Domain;

public sealed record CityGeography(
    bool Coastal,
    bool Arable,
    bool MineralRich,
    bool OilRich);

public sealed record CityGrid(int Width, int Height);

public sealed record City(
    CityId Id,
    string Name,
    long Population,
    IReadOnlyDictionary<IncomeBracket, double> Demographics,
    CityGrid Grid,
    CityGeography Geography,
    decimal BaseLandPrice)
{
    /// <summary>City wage index applied to every base wage (econ-audit §4.5). 1 = national average.</summary>
    public double WageIndex { get; init; } = 1.0;

    /// <summary>City price index applied to reference retail prices (econ-audit §4.5, P1). 1 = national average.</summary>
    public double PriceIndex { get; init; } = 1.0;
}
