using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using Xunit;
using Xunit.Abstractions;

namespace Magnate.Bridge.Tests;

/// <summary>
/// A <see cref="FactAttribute"/> that runs only when <c>MAGNATE_PERF=1</c>: wall-clock
/// budgets are meaningless on a shared, loaded build machine, so they stay out of the
/// default gate (bridge-spec §10.3: "category perf, not on every CI run").
/// Run them with <c>MAGNATE_PERF=1 dotnet test --filter Category=perf</c>.
/// </summary>
public sealed class PerfFactAttribute : FactAttribute
{
    public PerfFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("MAGNATE_PERF") != "1")
        {
            Skip = "performance budget; set MAGNATE_PERF=1 to run";
        }
    }
}

/// <summary>
/// Performance budgets at year 10 (bridge-spec §4.8, §10.3), measured on the desktop
/// runtime through the full dispatch path (argument binding, handler, envelope
/// serialization). The desktop runtime is roughly 1.2–4× faster than the browser
/// for queries, so each call must stay under the spec's desktop target at the median
/// and under the WASM budget at p95 — tight enough to catch an accidental ledger
/// scan (≈ 6 ms at year 10).
/// </summary>
[Collection("year10")]
[Trait("Category", "perf")]
public class PerfTests
{
    private readonly Year10Fixture _year10;
    private readonly ITestOutputHelper _output;

    public PerfTests(Year10Fixture year10, ITestOutputHelper output)
    {
        _year10 = year10;
        _output = output;
    }

    private (double Median, double P95) Measure(string method, object? args, int samples = 40)
    {
        var session = _year10.Bridge.Session;
        var json = args is null ? "{}" : JsonSerializer.Serialize(args, Bridge.Json);
        var first = session.Dispatch(method, json);
        Assert.Contains("\"ok\":true", first, StringComparison.Ordinal);
        for (var i = 0; i < 5; i++) session.Dispatch(method, json); // warm the JIT and caches
        var times = new List<double>(samples);
        for (var i = 0; i < samples; i++)
        {
            var started = Stopwatch.GetTimestamp();
            session.Dispatch(method, json);
            times.Add(GameSession.ElapsedMs(started));
        }
        var stats = Stats(times);
        _output.WriteLine($"{method,-22} median {stats.Median,7:F3} ms   p95 {stats.P95,7:F3} ms   ({first.Length / 1024.0:F1} KB)");
        return stats;
    }

    private static (double Median, double P95) Stats(IReadOnlyCollection<double> values)
    {
        var sorted = values.OrderBy(v => v).ToList();
        return (sorted[sorted.Count / 2], sorted[Math.Min(sorted.Count - 1, (int)Math.Ceiling(sorted.Count * 0.95) - 1)]);
    }

    [PerfFact]
    public void Snapshot_stays_well_under_a_millisecond_at_year_ten()
    {
        var (median, p95) = Measure("snapshot", null, samples: 200);
        Assert.True(median < 1.0, $"snapshot median {median:F3} ms");
        Assert.True(p95 < 2.0, $"snapshot p95 {p95:F3} ms");
    }

    [PerfFact]
    public void Advance_overhead_stays_small_every_month()
    {
        var overhead = _year10.BridgeOverheadMs;
        var lastYear = Stats(overhead.Skip(overhead.Count - 12).ToList());
        var all = Stats(overhead);
        var engine = Stats(_year10.EngineMs.Skip(_year10.EngineMs.Count - 12).ToList());
        _output.WriteLine($"advance bridge overhead: year 10 median {lastYear.Median:F3} ms p95 {lastYear.P95:F3} ms; all months p95 {all.P95:F3} ms");
        _output.WriteLine($"advance engine (World.AdvanceMonth), year 10: median {engine.Median:F3} ms p95 {engine.P95:F3} ms");
        Assert.True(lastYear.Median < 5.0, $"advance overhead median {lastYear.Median:F3} ms");
        Assert.True(lastYear.P95 < 15.0, $"advance overhead p95 {lastYear.P95:F3} ms");
    }

    [PerfFact]
    public void Reports_and_views_meet_their_budgets()
    {
        var game = _year10.Bridge.Session.Game;
        var biggest = game.World.Buildings.Values
            .Where(b => b.Owner == game.Player)
            .OrderByDescending(b => SlotRules.ConfiguredCount(b))
            .ThenBy(b => b.Id.Value)
            .First().Id.Value;

        // (method, args, desktop median budget, WASM p95 budget) — bridge-spec §4.8.
        var cases = new (string Method, object? Args, double Median, double P95)[]
        {
            ("companies", null, 1, 2),
            ("goals", null, 1, 2),
            ("building", new { buildingId = biggest }, 2.5, 5),
            ("buildings", new { }, 5, 15),
            ("cityView", new { cityId = "metropolis" }, 7.5, 15),
            ("worldMap", null, 10, 20),
            ("supplyFlows", new { cityId = "metropolis" }, 5, 10),
            ("incomeStatement", new { period = new { preset = "last12" }, byMonth = true }, 5, 10),
            ("cashFlow", new { period = new { preset = "sinceStart" } }, 5, 10),
            ("balanceSheet", new { drilldown = true }, 5, 10),
            ("productProfitability", new { period = new { preset = "sinceStart" } }, 5, 10),
            ("exports", new { period = new { preset = "sinceStart" } }, 5, 10),
            ("ledger", new { limit = 200 }, 5, 10),
            ("monthlyReport", null, 5, 10),
            ("explainNetIncome", null, 5, 10),
            ("history", new { series = MetricsHistory.SeriesNames, companyIds = game.World.Companies.Keys.Select(c => c.Value).ToArray() }, 5, 10),
            ("statsDashboard", null, 5, 10),
            ("advisor", null, 5, 10),
            ("news", null, 5, 10),
            ("activityFeed", new { limit = 200 }, 5, 10),
            ("researchTree", null, 5, 10),
            ("patents", null, 5, 10),
            ("adCampaigns", null, 5, 10),
            ("marketDetail", new { cityId = "metropolis", productId = "soft_drink" }, 5, 10),
            ("marketIntel", null, 10, 20),
            ("marketOpportunities", null, 10, 20),
            ("previewBuild", new { typeId = "supermarket", cityId = "metropolis", at = new { px = 1, pz = 1 } }, 5, 10),
        };
        var failures = new List<string>();
        foreach (var (method, args, medianBudget, p95Budget) in cases)
        {
            var (median, p95) = Measure(method, args, samples: 20);
            if (median > medianBudget || p95 > p95Budget)
            {
                failures.Add($"{method}: median {median:F3} ms (budget {medianBudget}), p95 {p95:F3} ms (budget {p95Budget})");
            }
        }
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    [PerfFact]
    public void A_ten_year_web_save_round_trips_within_budget()
    {
        // The first round trip pays the desktop JIT for the serializers and the scan (the
        // browser runs them interpreted, with no such step), so it is reported, not judged;
        // the budget applies to the best of three warm round trips (robust on a shared machine).
        var session = _year10.Bridge.Session;
        double bestSave = double.MaxValue, bestLoad = double.MaxValue;
        for (var round = 0; round < 4; round++)
        {
            var started = Stopwatch.GetTimestamp();
            var bytes = session.SaveBinary("{\"slotKind\":\"manual\"}");
            var saveMs = GameSession.ElapsedMs(started);
            Assert.NotEmpty(bytes);

            var other = TestContent.NewSession();
            started = Stopwatch.GetTimestamp();
            var envelope = other.LoadBinary(bytes, "{}");
            var loadMs = GameSession.ElapsedMs(started);
            Assert.Contains("\"ok\":true", envelope, StringComparison.Ordinal);
            _output.WriteLine($"{(round == 0 ? "cold" : "warm")}: SaveBinary {saveMs:F0} ms → {bytes.Length / 1024.0:F0} KB gzip; LoadBinary {loadMs:F0} ms");
            if (round == 0) continue;
            bestSave = Math.Min(bestSave, saveMs);
            bestLoad = Math.Min(bestLoad, loadMs);
        }
        // WASM budgets are 2.5 s / 4 s (§4.8); desktop is 5–7× faster for (de)serialization,
        // so the desktop bar is a fifth of each.
        Assert.True(bestSave < 500, $"SaveBinary took {bestSave:F0} ms");
        Assert.True(bestLoad < 800, $"LoadBinary took {bestLoad:F0} ms");
    }
}
