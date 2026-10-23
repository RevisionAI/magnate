using System;
using System.Collections.Generic;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Scenarios;

/// <summary>
/// Applies a <see cref="Scenario"/> to a fresh <see cref="World"/>: creates companies,
/// registers AI strategies, sets the clock. Returns the new world and the player's
/// <see cref="CompanyId"/> so goal-evaluation knows which company to measure.
/// </summary>
public static class ScenarioRunner
{
    /// <summary>
    /// Create the scenario's world. <paramref name="rules"/> defaults to
    /// <see cref="EconomyRules.Realistic"/> — the gameplay ruleset (master plan D3); pass
    /// <see cref="EconomyRules.Classic"/> explicitly to reproduce the pre-overhaul engine.
    /// </summary>
    public static (World World, CompanyId PlayerId) Apply(
        ContentCatalog catalog,
        Scenario scenario,
        int seed,
        EconomyRules? rules = null)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(scenario);

        var world = new World(catalog, seed, scenario.StartDate, rules ?? EconomyRules.Realistic);

        var player = world.CreateCompany(scenario.Player.Name, scenario.Player.StartingCash);

        foreach (var ai in scenario.AiCompetitors)
        {
            var company = world.CreateCompany(ai.Name, ai.StartingCash);
            world.RegisterAi(company.Id, CreateStrategy(ai.Strategy));
        }

        return (world, player.Id);
    }

    private static IAiStrategy CreateStrategy(string name)
        => AiStrategies.TryCreate(name, config: null, out var strategy)
            ? strategy
            : throw new InvalidOperationException($"unknown AI strategy: {name}");

    /// <summary>Evaluate every goal in a scenario against the current world state.</summary>
    public static IReadOnlyList<GoalEvaluation> EvaluateGoals(World world, Scenario scenario, CompanyId player)
    {
        var results = new List<GoalEvaluation>(scenario.Goals.Count);
        foreach (var goal in scenario.Goals)
        {
            results.Add(goal.Evaluate(world, player));
        }
        return results;
    }
}
