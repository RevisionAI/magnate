namespace Magnate.Engine.Domain;

/// <summary>Stable machine id for a product (lowercase snake_case).</summary>
public readonly record struct ProductId(string Value)
{
    public override string ToString() => Value;
    public static implicit operator string(ProductId id) => id.Value;
}

/// <summary>Stable machine id for a building type.</summary>
public readonly record struct BuildingTypeId(string Value)
{
    public override string ToString() => Value;
    public static implicit operator string(BuildingTypeId id) => id.Value;
}

/// <summary>Stable machine id for a city.</summary>
public readonly record struct CityId(string Value)
{
    public override string ToString() => Value;
    public static implicit operator string(CityId id) => id.Value;
}
