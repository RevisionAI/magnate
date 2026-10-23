namespace Magnate.Engine.Simulation;

/// <summary>Runtime id for a company (allocated by <see cref="World"/>).</summary>
public readonly record struct CompanyId(int Value)
{
    /// <summary>Display form, e.g. <c>C1</c>.</summary>
    public override string ToString() => $"C{Value}";
}

/// <summary>Runtime id for a constructed building instance.</summary>
public readonly record struct BuildingInstanceId(int Value)
{
    /// <summary>Display form, e.g. <c>B1</c>.</summary>
    public override string ToString() => $"B{Value}";
}
