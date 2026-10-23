using System.Collections.Generic;
using System.Diagnostics;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>
/// The bridge-spec §1 workload: <c>four_archetype_melee</c> (5 companies, the four AI archetypes), seed 42,
/// the player on the adaptive autopilot, advanced one month at a time for ten
/// years (≈ 16 buildings and ≈ 43k ledger entries on the 2026-USD content; ≈ 110 on Wave-1's). The
/// game is a funded custom game relabelled as the scenario, so its incumbents are custom-normal
/// strength (1.0), not the scenario's "hard" 1.4. Built once and shared by the
/// ledger-index parity tests and the perf tests, which run sequentially in the
/// <c>year10</c> collection (the session is not thread-safe).
/// </summary>
public sealed class Year10Fixture
{
    public const int Months = 120;

    public Year10Fixture()
    {
        // Every company starts with the price of 25 supermarkets (the scenario's $30M at the Wave-1
        // content prices), so the ten-year build-out — and the workload — follow content repricing.
        var cash = 25 * Bridge.Cost("supermarket");
        Bridge = Bridge.FundedScenario("four_archetype_melee", playerCash: cash, rivalCash: cash, seed: 42,
            ("BasicCo", "simple"), ("Adapta Holdings", "adaptive"), ("ChainLink Inc", "verticalIntegrator"), ("Zenith Labs", "techLeader"));
        Bridge.Call("setAutopilot", new { strategy = "adaptive" });
        var session = Bridge.Session;
        for (var m = 0; m < Months; m++)
        {
            var started = Stopwatch.GetTimestamp();
            var response = session.Dispatch("advance", "{\"months\":1}");
            var totalMs = GameSession.ElapsedMs(started);
            Assert.Contains("\"ok\":true", response, System.StringComparison.Ordinal);
            var engineMs = session.Game.LastTickMs;
            EngineMs.Add(engineMs);
            // Everything the facade adds on top of World.AdvanceMonth: index catch-up, history,
            // goals, event detection, the snapshot, activity and the envelope serialization.
            BridgeOverheadMs.Add(totalMs - engineMs);
        }
    }

    internal Bridge Bridge { get; }

    /// <summary>Per-month <c>World.AdvanceMonth</c> time (AI planning + tick).</summary>
    public List<double> EngineMs { get; } = new();

    /// <summary>Per-month facade overhead of an <c>advance {months:1}</c> dispatch.</summary>
    public List<double> BridgeOverheadMs { get; } = new();
}

/// <summary>Tests sharing the ten-year session run one at a time.</summary>
[CollectionDefinition("year10")]
public sealed class Year10Collection : ICollectionFixture<Year10Fixture>
{
}
