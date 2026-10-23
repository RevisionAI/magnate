using System;
using System.Linq;
using System.Text;
using Magnate.Engine.Ai;
using Magnate.Engine.Economics;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;
using Xunit.Abstractions;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// R8 sweep (econ-audit §6), reduced: all 16 live scenarios under Realistic rules with every
/// company AI-driven (the player on Adaptive) for 60 months (<c>SWEEP_MONTHS</c> overrides;
/// <c>SWEEP_ONLY</c> picks one scenario, <c>SWEEP_TRACE</c> prints a company's monthly ledger).
/// Prints one line per company and checks the sanity bounds: no exception, no negative cash,
/// no retail price above 3 × Pref, no total assets above 50 × starting cash.
/// </summary>
[Trait("Area", "Market")]
[Trait("Category", "calibration")]
public sealed class ScenarioSweepReport
{
    private readonly ITestOutputHelper _out;

    public ScenarioSweepReport(ITestOutputHelper output) => _out = output;

    [Fact]
    public void Every_scenario_runs_five_years_of_ai_play_within_the_sanity_bounds()
    {
        var months = int.Parse(Environment.GetEnvironmentVariable("SWEEP_MONTHS") ?? "60");
        var only = Environment.GetEnvironmentVariable("SWEEP_ONLY");
        var sb = new StringBuilder();
        foreach (var (id, scenario) in TestContent.LiveScenarios.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            if (only is not null && id != only) continue;
            var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, 42, EconomyRules.Realistic);
            world.RegisterAi(player, new AdaptiveStrategy());
            var minCash = world.Companies.Values.ToDictionary(c => c.Id, c => c.Cash);
            var startCash = world.Companies.Values.ToDictionary(c => c.Id, c => c.Cash);
            var trace = Environment.GetEnvironmentVariable("SWEEP_TRACE");
            for (var m = 0; m < months; m++)
            {
                world.AdvanceMonth();
                if (trace is not null)
                {
                    foreach (var c in world.Companies.Values.Where(c => c.Name == trace))
                    {
                        var byCat = world.Ledger.EntriesInRange(c.Id, world.Clock.Now, world.Clock.Now).GroupBy(e => e.Category).Select(g => $"{g.Key}:{g.Sum(e => e.Amount) / 1000m:F0}k");
                        var blds = string.Join(",", world.Buildings.Values.Where(b => b.Owner == c.Id).Select(b => b.TypeId.Value + "[" + string.Join("/", b.RetailSlots.Select(s => s.Product.Value + "@" + s.Price + "x" + s.RestockTarget.ToString("F0")).Concat(b.ProductionSlots.Select(s => "P:" + s.Product.Value))) + "]" + (b.AutoExport ? "E" : "")));
                        sb.AppendLine($"  {world.Clock.Now} cash {c.Cash / 1e6m:F2}M {string.Join(" ", byCat)} | {blds}");
                    }
                }
                foreach (var c in world.Companies.Values) minCash[c.Id] = Math.Min(minCash[c.Id], c.Cash);
            }
            foreach (var c in world.Companies.Values.OrderBy(c => c.Id.Value))
            {
                var bs = world.GetBalanceSheet(c.Id);
                var last = world.GetIncomeStatement(c.Id, new GameDate(world.Clock.Now.Year - 1, world.Clock.Now.Month), world.Clock.Now);
                var lines = MarketAi.OwnLines(world, c.Id).Count();
                var maxPx = MarketAi.OwnLines(world, c.Id).Select(l => (double)(l.Price / MarketAi.ReferencePrice(world, l.Building.City, world.Catalog.Product(l.Product)))).DefaultIfEmpty(0).Max();
                Assert.True(minCash[c.Id] >= 0m, $"{id}: {c.Name} went to {minCash[c.Id]:N0} cash");
                Assert.True(maxPx <= 3.0, $"{id}: {c.Name} prices at {maxPx:F2} × Pref");
                Assert.True(bs.TotalAssets <= 50m * Math.Max(1m, startCash[c.Id]), $"{id}: {c.Name} assets {bs.TotalAssets:N0}");
                sb.AppendLine($"{id,-22} {c.Name,-22} eq {bs.Equity / 1e6m,8:F1}M cash {c.Cash / 1e6m,8:F1}M min {minCash[c.Id] / 1e6m,7:F1}M bldg {c.OwnedBuildings.Count,3} lines {lines,3} rev12 {last.Revenue / 1e6m,8:F1}M NI12 {last.NetIncome / 1e6m,7:F2}M maxPx/Pref {maxPx:F2}");
            }
        }
        _out.WriteLine(sb.ToString());
    }
}
