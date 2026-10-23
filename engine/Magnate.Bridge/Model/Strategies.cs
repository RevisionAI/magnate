using Magnate.Engine.Ai;

namespace Magnate.Bridge;

/// <summary>
/// AI strategy names (TS <c>AiStrategyName</c>) over the engine's registry
/// (<see cref="AiStrategies"/>, change request E2): the single name ↔ strategy table the
/// scenario runner, the saver and the loader also use. Aliases (<c>retailer</c>,
/// <c>vertical</c>, <c>tech</c>) normalise to the canonical names.
/// </summary>
internal static class Strategies
{
    /// <summary>Canonical name for a strategy name or alias; null when the registry does not know it.</summary>
    public static string? Normalize(string? name)
        => name is not null && AiStrategies.TryCreate(name, null, out var strategy) ? AiStrategies.NameOf(strategy) : null;
}
