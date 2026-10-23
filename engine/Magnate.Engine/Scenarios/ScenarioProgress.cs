using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Scenarios;

/// <summary>Scenario outcome.</summary>
public enum ScenarioStatus
{
    /// <summary>Undecided.</summary>
    Playing,

    /// <summary>Every goal achieved.</summary>
    Won,

    /// <summary>Bankrupt, or the deadline passed.</summary>
    Lost,
}

/// <summary>
/// Engine-side scenario referee (master plan D11, econ-audit §4.14/§4.18) for tools, tests and
/// headless runs; the bridge's <c>GoalTracker</c> applies the same rules. Call
/// <see cref="Update"/> after every month close.
/// <list type="bullet">
///   <item><see cref="GoalMode.ReachOnce"/> goals latch the first month they are met.</item>
///   <item><see cref="GoalMode.HoldAtDeadline"/> goals must be met at the deadline month (or, in a
///         scenario without a deadline, at the moment every other goal has latched).</item>
///   <item>Won when every reach-once goal has latched and every hold goal is met as above.</item>
///   <item>Lost when the player's company is liquidated (finance solvency rules), or when the
///         deadline month closes without a win.</item>
/// </list>
/// </summary>
public sealed class ScenarioProgress
{
    private readonly Dictionary<int, GameDate> _latched = new();

    /// <summary>Create a referee for <paramref name="scenario"/> played by <paramref name="player"/>.</summary>
    public ScenarioProgress(Scenario scenario, CompanyId player)
    {
        Scenario = scenario ?? throw new ArgumentNullException(nameof(scenario));
        Player = player;
    }

    /// <summary>The scenario.</summary>
    public Scenario Scenario { get; }

    /// <summary>The player's company.</summary>
    public CompanyId Player { get; }

    /// <summary>Outcome so far.</summary>
    public ScenarioStatus Status { get; private set; } = ScenarioStatus.Playing;

    /// <summary>"allGoals", "bankruptcy" or "deadline" once decided.</summary>
    public string? Reason { get; private set; }

    /// <summary>Month the outcome was decided.</summary>
    public GameDate? DecidedAt { get; private set; }

    /// <summary>Month each latched goal (by index) was first met.</summary>
    public IReadOnlyDictionary<int, GameDate> Latched => _latched;

    /// <summary>The latest evaluation of every goal.</summary>
    public IReadOnlyList<GoalEvaluation> Current { get; private set; } = Array.Empty<GoalEvaluation>();

    /// <summary>Evaluate every goal, latch, and decide the outcome. Returns the evaluations.</summary>
    public IReadOnlyList<GoalEvaluation> Update(World world)
    {
        ArgumentNullException.ThrowIfNull(world);
        var now = world.Clock.Now;
        var evals = new List<GoalEvaluation>(Scenario.Goals.Count);
        for (var i = 0; i < Scenario.Goals.Count; i++)
        {
            var goal = Scenario.Goals[i];
            var eval = goal.Evaluate(world, Player);
            evals.Add(eval);
            if (goal.Mode == GoalMode.ReachOnce && eval.Achieved && !_latched.ContainsKey(i)) _latched[i] = now;
        }

        Current = evals;
        if (Status != ScenarioStatus.Playing) return evals;

        if (world.IsBankrupt(Player))
        {
            Decide(ScenarioStatus.Lost, "bankruptcy", now);
            return evals;
        }

        if (IsWon(evals, now))
        {
            Decide(ScenarioStatus.Won, "allGoals", now);
            return evals;
        }

        if (Scenario.EndDate is { } end && now >= end)
        {
            Decide(ScenarioStatus.Lost, "deadline", now);
        }

        return evals;
    }

    private bool IsWon(IReadOnlyList<GoalEvaluation> evals, GameDate now)
    {
        var goals = Scenario.Goals;
        if (goals.Count == 0) return false;
        var holds = false;
        for (var i = 0; i < goals.Count; i++)
        {
            if (goals[i].Mode == GoalMode.ReachOnce)
            {
                if (!_latched.ContainsKey(i)) return false;
            }
            else
            {
                holds = true;
                if (!evals[i].Achieved) return false;
            }
        }

        // Hold goals are judged at the deadline month itself.
        return !holds || Scenario.EndDate is not { } end || now >= end;
    }

    private void Decide(ScenarioStatus status, string reason, GameDate at)
    {
        Status = status;
        Reason = reason;
        DecidedAt = at;
    }

    /// <summary>Indices of the goals that have latched, ascending.</summary>
    public IEnumerable<int> LatchedIndices => _latched.Keys.OrderBy(i => i);
}
