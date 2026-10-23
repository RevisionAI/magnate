using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// Research-point arithmetic for tests (test-map D9): derive thresholds from the engine's
/// research rule instead of hard-coding <c>100.0</c>, so retuning research never breaks tests
/// that only need "enough points to reach max tech".
/// </summary>
public static class TechPoints
{
    /// <summary>Points that take level <c>level</c> to <c>level + 1</c>.</summary>
    public static double Threshold(int level) => SimulationConstants.BaseResearchThreshold * level;

    /// <summary>Points that take <paramref name="product"/> from level <paramref name="fromLevel"/> to its max tech level.</summary>
    public static double ToMax(World world, ProductId product, int fromLevel = SimulationConstants.BaseTechLevel)
    {
        var max = world.Catalog.Product(product).MaxTechLevel;
        var total = 0.0;
        for (var level = fromLevel; level < max; level++) total += Threshold(level);
        return total;
    }
}
