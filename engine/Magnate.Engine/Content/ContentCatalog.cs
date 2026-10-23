using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Content;

/// <summary>Immutable, validated collection of static game content.</summary>
public sealed record ContentCatalog
{
    public IReadOnlyDictionary<ProductId, Product> Products { get; }
    public IReadOnlyDictionary<BuildingTypeId, BuildingType> BuildingTypes { get; }
    public IReadOnlyDictionary<CityId, City> Cities { get; }

    /// <summary>
    /// Phase 3.65: random / conditional event catalog. Empty when the
    /// <c>content/data/events/</c> directory is missing — preserves
    /// pre-3.65 callers and content trees.
    /// </summary>
    public IReadOnlyList<EventDefinition> Events { get; }

    public ContentCatalog(
        IReadOnlyDictionary<ProductId, Product> products,
        IReadOnlyDictionary<BuildingTypeId, BuildingType> buildingTypes,
        IReadOnlyDictionary<CityId, City> cities,
        IReadOnlyList<EventDefinition>? events = null)
    {
        Products = products;
        BuildingTypes = buildingTypes;
        Cities = cities;
        Events = events ?? Array.Empty<EventDefinition>();
    }

    public Product Product(ProductId id) => Products[id];
    public BuildingType BuildingType(BuildingTypeId id) => BuildingTypes[id];
    public City City(CityId id) => Cities[id];
}
