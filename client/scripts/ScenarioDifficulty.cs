using System.Collections.Generic;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Shared difficulty heuristic for <see cref="Scenario"/> rows and cards.
/// Extracted in Phase 3.57 to DRY up the previously-duplicated
/// <c>ComputeDifficulty</c> methods in <see cref="ScenarioPicker"/> (Phase 3.38)
/// and <see cref="TitleScreen"/> (Phase 3.46). Byte-equivalent to the original
/// heuristic — no behavior change.
/// </summary>
public static class ScenarioDifficulty
{
    /// <summary>
    /// Heuristic difficulty rating 1-5 derived from the scenario's JSON fields
    /// (no hand-authored <c>difficulty</c> field). Weighted sum of:
    ///   cash disadvantage vs AIs, goal count, AI count, duration, AI strategy
    ///   archetype, and goal-type toughness. Clamped to [1, 5].
    /// </summary>
    public static int Compute(Scenario scenario)
    {
        var score = 0;

        var ais = scenario.AiCompetitors ?? (IReadOnlyList<ScenarioCompany>)System.Array.Empty<ScenarioCompany>();

        // Cash disadvantage: sum(ai.StartingCash) / player.StartingCash.
        var playerCash = scenario.Player.StartingCash;
        decimal aiCashSum = 0m;
        foreach (var ai in ais) aiCashSum += ai.StartingCash;
        if (playerCash > 0m && ais.Count > 0)
        {
            var ratio = (double)(aiCashSum / playerCash);
            if (ratio > 2.5) score += 3;
            else if (ratio >= 1.5) score += 2;
            else if (ratio > 1.0) score += 1;
        }

        // Goal count.
        var goalCount = scenario.Goals.Count;
        if (goalCount >= 6) score += 2;
        else if (goalCount >= 4) score += 1;

        // AI count.
        var aiCount = ais.Count;
        if (aiCount == 0) score -= 1;
        else if (aiCount == 2) score += 1;
        else if (aiCount >= 3) score += 2;

        // Duration (months). No EndDate → treat as unbounded (loose deadline).
        if (scenario.EndDate is GameDate end)
        {
            var months = (end.Year - scenario.StartDate.Year) * 12 + (end.Month - scenario.StartDate.Month);
            if (months <= 24) score += 1;
            else if (months >= 49 && months <= 72) score -= 1;
            // 25-48 contributes 0; >72 also 0 (already loose).
        }
        else
        {
            score -= 1; // unbounded is easier.
        }

        // Strategy toughness: any verticalIntegrator AI.
        foreach (var ai in ais)
        {
            if (string.Equals(ai.Strategy, "verticalIntegrator", System.StringComparison.OrdinalIgnoreCase))
            {
                score += 1;
                break;
            }
        }

        // Goal difficulty mix. Each qualifying goal adds +1; cap the contribution at +2.
        var goalBonus = 0;
        foreach (var g in scenario.Goals)
        {
            switch (g)
            {
                case MarketShareGoal ms when ms.Threshold >= 0.35:
                    goalBonus++;
                    break;
                case TopBrandGoal:
                    goalBonus++;
                    break;
                case ExportRevenueGoal ex when ex.Amount > 3_000_000m:
                    goalBonus++;
                    break;
            }
        }
        score += System.Math.Min(goalBonus, 2);

        return System.Math.Clamp(score, 1, 5);
    }

    /// <summary>
    /// Plain-text star badge e.g. <c>★★★☆☆</c>. Uses U+2605 / U+2606 which render
    /// in Godot's default font. Input is clamped to [1, 5]; this is the format
    /// used by <see cref="ScenarioPicker"/>'s list rows.
    /// </summary>
    public static string FormatStars(int rating)
    {
        var d = System.Math.Clamp(rating, 1, 5);
        return new string('★', d) + new string('☆', 5 - d);
    }

    /// <summary>
    /// BBCode-colored star badge for <see cref="RichTextLabel"/> usage — gold
    /// filled stars and dimmed gold empty stars, matching the title screen's
    /// gold underline accent. Used by <see cref="TitleScreen"/>'s showcase cards.
    /// </summary>
    public static string FormatStarsBbcode(int rating)
    {
        var d = System.Math.Clamp(rating, 1, 5);
        return $"[color=#d9b859]{new string('★', d)}[/color]" +
               $"[color=#7a6a3a]{new string('☆', 5 - d)}[/color]";
    }

    /// <summary>
    /// Bucket label matching <see cref="ScenarioPicker"/>'s filter OptionButton:
    /// ratings 1-2 are "Easy", 3 is "Normal", 4-5 is "Hard". Used for tooltips
    /// and any dynamic label rendering (filter items themselves are hard-coded
    /// in <c>_Ready</c> with range hints, so they call this indirectly).
    /// </summary>
    public static string Bucket(int rating)
    {
        var d = System.Math.Clamp(rating, 1, 5);
        if (d <= 2) return "Easy";
        if (d == 3) return "Normal";
        return "Hard";
    }
}
