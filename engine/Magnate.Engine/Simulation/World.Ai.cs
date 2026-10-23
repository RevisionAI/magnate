using System;
using System.Linq;
using Magnate.Engine.Ai;

namespace Magnate.Engine.Simulation;

// AI strategy registry and the monthly advance.
public sealed partial class World
{
    /// <summary>
    /// Register an AI strategy for an existing company. The strategy's
    /// <see cref="IAiStrategy.Plan"/> will be invoked at the start of each
    /// <see cref="AdvanceMonth"/>, before the monthly tick runs.
    /// </summary>
    public void RegisterAi(CompanyId company, IAiStrategy strategy)
    {
        ArgumentNullException.ThrowIfNull(strategy);
        RequireCompany(company);
        _aiStrategies[company] = strategy;
    }

    /// <summary>
    /// The strategy driving <paramref name="company"/>, if it is AI-controlled (bridge-spec E2).
    /// </summary>
    public bool TryGetAiStrategy(CompanyId company, out IAiStrategy strategy)
    {
        if (_aiStrategies.TryGetValue(company, out var found))
        {
            strategy = found;
            return true;
        }

        strategy = null!;
        return false;
    }

    /// <summary>
    /// Hand <paramref name="company"/> back to the player (turn autopilot off). Returns false when
    /// the company had no AI strategy.
    /// </summary>
    public bool UnregisterAi(CompanyId company) => _aiStrategies.Remove(company);

    /// <summary>
    /// Run the AI decisions (in ascending company id order), then the monthly tick
    /// (<see cref="MonthlyTick"/>). An exception thrown by an AI action propagates.
    /// </summary>
    public void AdvanceMonth()
    {
        RunAiDecisions();
        MonthlyTick.Execute(this);
    }

    private void RunAiDecisions()
    {
        // Snapshot to a list before iterating so a strategy can be re-entrant
        // safe in future phases. Order is deterministic (CompanyId asc).
        var strategiesInOrder = _aiStrategies
            .OrderBy(kvp => kvp.Key.Value)
            .ToList();

        foreach (var (companyId, strategy) in strategiesInOrder)
        {
            var actions = strategy.Plan(this, companyId);
            foreach (var action in actions)
            {
                action.Execute(this, companyId);
            }
        }
    }
}
