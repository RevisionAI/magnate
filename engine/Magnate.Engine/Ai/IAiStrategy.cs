using System.Collections.Generic;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>
/// Decides what an AI-controlled company does at the start of each monthly tick.
/// Strategies are pure functions of world state — they MUST NOT mutate the world
/// directly. The engine executes the returned actions in order.
/// </summary>
public interface IAiStrategy
{
    /// <summary>Returns zero or more actions to execute for <paramref name="actor"/> this month.</summary>
    IReadOnlyList<AiAction> Plan(World world, CompanyId actor);
}
