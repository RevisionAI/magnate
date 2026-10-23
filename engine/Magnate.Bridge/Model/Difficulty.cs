using System;
using System.Linq;
using Magnate.Engine.Scenarios;

namespace Magnate.Bridge;

/// <summary>
/// Scenario difficulty, 1–5 stars (bridge-spec §4.6.7; port of the Godot
/// client's ScenarioDifficulty.Compute, unchanged) and its bucket.
/// </summary>
internal static class Difficulty
{
    public static int Compute(Scenario s)
    {
        var score = 0;
        var ais = s.AiCompetitors.Count;
        if (s.Player.StartingCash > 0m && ais >= 1)
        {
            var ratio = s.AiCompetitors.Sum(a => a.StartingCash) / s.Player.StartingCash;
            score += ratio > 2.5m ? 3 : ratio >= 1.5m ? 2 : ratio > 1.0m ? 1 : 0;
        }
        var goals = s.Goals.Count;
        score += goals >= 6 ? 2 : goals >= 4 ? 1 : 0;
        score += ais == 0 ? -1 : ais == 2 ? 1 : ais >= 3 ? 2 : 0;
        if (s.EndDate is { } end)
        {
            var months = (end.Year - s.StartDate.Year) * 12 + (end.Month - s.StartDate.Month);
            score += months <= 24 ? 1 : months >= 49 && months <= 72 ? -1 : 0;
        }
        else
        {
            score -= 1;
        }
        if (s.AiCompetitors.Any(a => string.Equals(a.Strategy, "verticalIntegrator", StringComparison.OrdinalIgnoreCase)))
        {
            score += 1;
        }
        var hardGoals = s.Goals.Count(g =>
            (g is MarketShareGoal m && m.Threshold >= 0.35)
            || g is TopBrandGoal
            || (g is ExportRevenueGoal e && e.Amount > 3_000_000m));
        score += Math.Min(2, hardGoals);
        return Math.Clamp(score, 1, 5);
    }

    public static string Bucket(int difficulty) => difficulty <= 2 ? "easy" : difficulty == 3 ? "normal" : "hard";

    /// <summary>
    /// Strength of the permanent local competition (incumbents) for a difficulty bucket (master
    /// plan D6, econ-audit §4.1): easy 0.6, normal 1.0, hard 1.4. <c>newGame</c> passes it to the
    /// engine's market rules (<c>MarketRules.IncumbentStrength</c>, E1) for the scenario's bucket.
    /// </summary>
    public static double IncumbentStrength(string bucket) => bucket switch
    {
        "easy" => 0.6,
        "hard" => 1.4,
        _ => 1.0,
    };
}
