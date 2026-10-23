using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Magnate.Engine.Content;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>One per-month snapshot of player-relevant metrics, captured after each tick.</summary>
/// <remarks>
/// <see cref="CorporateValue"/> was added in Phase 3.63. For any snapshots recorded before
/// that phase shipped (i.e. this field was absent), the value is 0 — the History list is
/// in-memory only, so the only way a pre-3.63 snapshot exists is within a single running
/// session (not across loads). The CV sparkline will therefore start populating forward
/// from the first tick after this build.
/// </remarks>
internal sealed record HistoryEntry(
    GameDate Date,
    decimal Cash,
    decimal MonthlyRevenue,
    decimal MonthlyNetIncome,
    double TopBrand,
    int TopTech,
    decimal CorporateValue);

/// <summary>
/// Shared between scenes to pass the active <see cref="World"/> across scene
/// transitions (Godot scenes don't share instance state directly). Each scene
/// writes here on exit / reads on entry. Not thread-safe — the Godot main thread
/// is the only writer.
/// </summary>
internal static class GameState
{
    public static ContentCatalog? Catalog { get; set; }
    public static World? World { get; set; }
    public static CompanyId PlayerId { get; set; }
    public static string ScenarioName { get; set; } = "Sandbox";

    /// <summary>
    /// The scenario object currently being played (set by ScenarioPicker). Null
    /// on save-file loads or the default demo bootstrap — the scenario can't
    /// be recovered from a save alone. The Goals tab renders only when this is set.
    /// </summary>
    public static Scenario? ActiveScenario { get; set; }

    /// <summary>
    /// The building the user selected for inspection. Set by Manage's Buildings
    /// tab before transitioning to BuildingInspector; read there on _Ready.
    /// </summary>
    public static BuildingInstanceId? SelectedBuilding { get; set; }

    // ------------------------------------------------------ Shared clock

    /// <summary>Toggled by Main's Play button; respected by every scene's `_Process`.</summary>
    public static bool IsPlaying { get; set; }

    /// <summary>Real seconds between game months when <see cref="IsPlaying"/> is true.</summary>
    public static float SecondsPerMonth { get; set; } = 1.0f;

    /// <summary>Accumulator used by <see cref="TickIfRunning"/>.</summary>
    public static float TickAccumulator { get; set; }

    // ------------------------------------------------------ Game-feel event detection (Phase 3.69)
    //
    // Presentation-only state Main uses to fire notification toasts / win-lose
    // exactly once per transition. Reset on new game via <see cref="Clear"/>.

    /// <summary>Sign of the last observed monthly net income (-1 / 0 / +1); null until first tick.</summary>
    public static int? LastNetIncomeSign { get; set; }

    /// <summary>True once the "cash below $1M" warning toast has fired.</summary>
    public static bool LowCashWarned { get; set; }

    /// <summary>NewsLog count already surfaced as toasts; new entries beyond this are unseen.</summary>
    public static int LastNewsCountSeen { get; set; }

    /// <summary>Consecutive recorded months the player has held negative cash (bankruptcy watch).</summary>
    public static int ConsecutiveNegativeCashMonths { get; set; }

    /// <summary>Descriptions of scenario goals already celebrated, so each toasts once.</summary>
    public static HashSet<string> AchievedGoalKeys { get; } = new();

    /// <summary>Seeded once so pre-achieved goals (e.g. on load) don't burst-toast.</summary>
    public static bool GoalTrackingInitialized { get; set; }

    /// <summary>True once the win/lose modal has been shown for this game.</summary>
    public static bool WinLoseShown { get; set; }

    // ------------------------------------------------------ Autosave

    /// <summary>
    /// In-game months remaining until the next autosave. Counted down inside
    /// <see cref="TickIfRunning"/>; when it reaches zero an autosave is written
    /// to user://autosaves and the counter is reset to <see cref="AutosaveIntervalMonths"/>.
    /// </summary>
    public static int AutosaveMonthsRemaining { get; set; } = AutosaveIntervalMonths;

    /// <summary>Autosave cadence in in-game months. One save per game year.</summary>
    public const int AutosaveIntervalMonths = 12;

    /// <summary>Max number of autosave files kept on disk; oldest are pruned.</summary>
    public const int AutosaveRetentionCount = 3;

    /// <summary>
    /// Call from any scene's `_Process`. If the sim is running and enough real
    /// time has elapsed, advances one month and records a history snapshot.
    /// Returns true if a tick actually happened (caller should refresh UI).
    /// </summary>
    public static bool TickIfRunning(float delta)
    {
        if (!IsPlaying || World is null) return false;
        TickAccumulator += delta;
        if (TickAccumulator < SecondsPerMonth) return false;
        TickAccumulator = 0f;
        World.AdvanceMonth();
        RecordSnapshot();
        TickAutosave();
        return true;
    }

    /// <summary>
    /// Decrement the autosave counter; when it hits zero, write an autosave to
    /// user://autosaves/autosave_YYYY-MM.json and prune to the newest
    /// <see cref="AutosaveRetentionCount"/>. Errors are logged but never thrown —
    /// an autosave failure should not interrupt gameplay.
    /// </summary>
    private static void TickAutosave()
    {
        if (World is null) return;
        AutosaveMonthsRemaining--;
        if (AutosaveMonthsRemaining > 0) return;
        AutosaveMonthsRemaining = AutosaveIntervalMonths;

        try
        {
            var dir = Path.Combine(OS.GetUserDataDir(), "autosaves");
            Directory.CreateDirectory(dir);

            var now = World.Clock.Now;
            var fileName = $"autosave_{now.Year:D4}-{now.Month:D2}.json";
            var path = Path.Combine(dir, fileName);
            WorldSaver.Save(World, path, ActiveScenario?.Id, PlayerId);

            PruneAutosaves(dir);
        }
        catch (Exception ex)
        {
            GD.PushWarning($"[GameState] autosave failed: {ex.Message}");
        }
    }

    private static void PruneAutosaves(string dir)
    {
        var files = Directory.EnumerateFiles(dir, "autosave_*.json")
            .Select(p => new FileInfo(p))
            .OrderByDescending(fi => fi.LastWriteTime)
            .ToList();
        for (var i = AutosaveRetentionCount; i < files.Count; i++)
        {
            try { files[i].Delete(); }
            catch (Exception ex) { GD.PushWarning($"[GameState] failed to prune autosave {files[i].Name}: {ex.Message}"); }
        }
    }

    // ------------------------------------------------------ History

    public static List<HistoryEntry> History { get; } = new();

    /// <summary>Capture a one-row snapshot for the active player at the current clock.</summary>
    public static void RecordSnapshot()
    {
        if (World is null) return;
        var date = World.Clock.Now;
        var cash = World.Companies.TryGetValue(PlayerId, out var c) ? c.Cash : 0m;
        var pnl = World.GetIncomeStatement(PlayerId, date, date);
        var topBrand = ComputeTopBrand(World, PlayerId);
        var topTech = ComputeTopTech(World, PlayerId);
        var cv = ComputeCorporateValue(World, PlayerId, date);
        History.Add(new HistoryEntry(date, cash, pnl.Revenue, pnl.NetIncome, topBrand, topTech, cv));

        // Bankruptcy watch — authoritative regardless of which scene ticked.
        if (cash < 0m) ConsecutiveNegativeCashMonths++;
        else ConsecutiveNegativeCashMonths = 0;
    }

    /// <summary>
    /// Canonical corporate-value formula (Phase 3.63):
    /// <c>Cash + InventoryValue + BuildingValue + 10 × NetIncome(trailing 12 months)</c>.
    /// The engine exposes the balance-sheet components (<see cref="World.GetBalanceSheet"/>)
    /// and accrual P&amp;L (<see cref="World.GetIncomeStatement"/>) but no direct
    /// <c>GetCorporateValue</c>; we compose them here so the multiplier + window policy
    /// stays client-side. If the simulation is younger than 12 months, we clamp the
    /// trailing window to month index 0 — <see cref="World.GetIncomeStatement"/> tolerates
    /// empty/partial ranges by returning zero over the missing portion.
    /// </summary>
    private static decimal ComputeCorporateValue(World world, CompanyId player, GameDate now)
    {
        var bs = world.GetBalanceSheet(player);

        // Trailing 12 months ending at `now`, inclusive. Decompose (year, month)
        // by hand since GameDate only exposes AddMonth() (+1) and AsMonthIndex().
        var fromIdx = Math.Max(0, now.AsMonthIndex() - 11);
        var fromYear = fromIdx / 12;
        var fromMonth = (fromIdx % 12) + 1;
        var from = new GameDate(fromYear, fromMonth);

        var pnl = world.GetIncomeStatement(player, from, now);
        return bs.Cash + bs.InventoryValue + bs.BuildingValue + 10m * pnl.NetIncome;
    }

    /// <summary>
    /// Highest brand awareness across all of the player's active ad campaigns'
    /// (product, city) pairs. Returns 0 if the player has no ad campaigns.
    /// </summary>
    private static double ComputeTopBrand(World world, CompanyId player)
    {
        var best = 0.0;
        foreach (var campaign in world.AdCampaigns)
        {
            if (campaign.Company != player) continue;
            var brand = world.GetBrandAwareness(player, campaign.Product, campaign.City);
            if (brand > best) best = brand;
        }
        return best;
    }

    /// <summary>
    /// Highest tech level across every product the player has a retail, production,
    /// or research slot for. Falls back to <see cref="SimulationConstants.BaseTechLevel"/>
    /// (1) if the player has no slots anywhere.
    /// </summary>
    private static int ComputeTopTech(World world, CompanyId player)
    {
        var best = 0;
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            foreach (var slot in b.RetailSlots)
            {
                var t = world.GetTech(player, slot.Product);
                if (t > best) best = t;
            }
            foreach (var slot in b.ProductionSlots)
            {
                var t = world.GetTech(player, slot.Product);
                if (t > best) best = t;
            }
            foreach (var slot in b.ResearchSlots)
            {
                var t = world.GetTech(player, slot.Product);
                if (t > best) best = t;
            }
        }
        return best > 0 ? best : SimulationConstants.BaseTechLevel;
    }

    // ------------------------------------------------------

    public static void Clear()
    {
        World = null;
        ActiveScenario = null;
        ScenarioName = "Sandbox";
        SelectedBuilding = null;
        IsPlaying = false;
        TickAccumulator = 0f;
        AutosaveMonthsRemaining = AutosaveIntervalMonths;
        History.Clear();

        LastNetIncomeSign = null;
        LowCashWarned = false;
        LastNewsCountSeen = 0;
        ConsecutiveNegativeCashMonths = 0;
        AchievedGoalKeys.Clear();
        GoalTrackingInitialized = false;
        WinLoseShown = false;
    }
}
