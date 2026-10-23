using System.Collections.Generic;

namespace Magnate.Engine.Simulation;

/// <summary>A player- or AI-operated corporation.</summary>
public sealed class Company
{
    /// <summary>Runtime id (C1 is the player in every scenario).</summary>
    public CompanyId Id { get; }

    /// <summary>Display name.</summary>
    public string Name { get; }

    /// <summary>Current cash on hand. Mutated only by <see cref="World"/> helpers.</summary>
    public decimal Cash { get; internal set; }

    /// <summary>Ids of the company's buildings in construction order.</summary>
    public List<BuildingInstanceId> OwnedBuildings { get; } = new();

    internal Company(CompanyId id, string name)
    {
        Id = id;
        Name = name;
        Cash = 0m;
    }
}
