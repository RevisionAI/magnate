using System;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Finance;

/// <summary>
/// The §4.15 accounting model as a property over every scenario under Realistic rules (R1): every
/// company, every month, <c>Assets − Liabilities == Equity</c>, the equity identity, the cash-flow
/// identity <c>CFO + CFI + CFF == ΔCash</c>, and the finance register agrees with the ledger.
/// Plus the R15 determinism and lossless save/load with the finance section populated.
/// </summary>
public sealed class AccountingPropertyTests
{
    public static TheoryData<string> Scenarios()
    {
        var data = new TheoryData<string>();
        foreach (var id in TestContent.LiveScenarios.Keys.OrderBy(k => k, StringComparer.Ordinal)) data.Add(id);
        return data;
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Books_close_every_month_for_every_company_under_realistic_rules(string scenarioId)
    {
        var scenario = TestContent.LiveScenarios[scenarioId];
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 7, EconomyRules.Realistic);
        world.RegisterAi(player, new AdaptiveStrategy());

        for (var month = 0; month < 36; month++)
        {
            world.AdvanceMonth();
            if (month % 3 == 2) Invariants.AssertAll(world);
            var now = world.Clock.Now;
            foreach (var c in world.Companies.Values)
            {
                var bs = world.GetBalanceSheet(c.Id);
                Assert.Equal(bs.Equity, bs.TotalAssets - bs.Liabilities);
                Assert.Equal(bs.Liabilities, bs.TermLoans + bs.Revolver);
                Assert.Equal(bs.BuildingValue, bs.GrossPpe - bs.AccumulatedDepreciation);
                Assert.Equal(bs.Equity, bs.PaidInCapital + bs.RetainedEarnings);
                Assert.True(bs.Land >= 0m && bs.Cip >= 0m);

                // Monthly CFO + CFI + CFF = the month's net cash change.
                var cf = world.GetCashFlowStatement(c.Id, now, now);
                var dated = world.Ledger.NetCashFlow(c.Id, now, now);
                // Exact up to decimal's 28th significant digit: ledger amounts carry sub-cent
                // fractions (E1 per-unit purchases), and summing them per section or in date
                // order can round the last digit differently.
                Assert.True(Math.Abs(dated - cf.NetChange) < 0.000001m, $"{c.Id} {now}: ledger {dated} vs cash-flow statement {cf.NetChange}");
            }
        }

        Invariants.AssertAll(world);
        Assert.All(ScenarioRunner.EvaluateGoals(world, scenario, player), g => Assert.InRange(g.Progress, 0.0, 1.0));
    }

    [Fact]
    public void Whole_history_cash_flow_statement_reconciles_to_cash()
    {
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, TestContent.LiveScenarios["soft_drink_war"], seed: 3, EconomyRules.Realistic);
        world.RegisterAi(player, new AdaptiveStrategy());
        for (var i = 0; i < 24; i++) world.AdvanceMonth();
        foreach (var c in world.Companies.Values)
        {
            var cf = world.GetCashFlowStatement(c.Id, new GameDate(1, 1), world.Clock.Now);
            Assert.Equal(c.Cash, cf.NetChange);
        }
    }

    [Fact]
    public void Save_load_mid_run_with_finance_state_is_lossless_and_deterministic()
    {
        var scenario = TestContent.LiveScenarios["four_archetype_melee"];
        var (a, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 11, EconomyRules.Realistic);
        a.RegisterAi(player, new AdaptiveStrategy());
        for (var i = 0; i < 18; i++) a.AdvanceMonth();

        // Exercise every persisted structure: a loan, land, a disposal.
        var profile = a.GetCreditProfile(player);
        if (profile.NewTermLoanMax > 1_000m) a.TakeLoan(player, Math.Floor(profile.NewTermLoanMax / 2m), 36);
        var mine = a.Buildings.Values.Where(b => b.Owner == player).OrderBy(b => b.Id.Value).ToList();
        if (mine.Count > 1) a.SellBuilding(mine[^1].Id);

        var json = WorldSaver.SaveToString(a, scenario.Id, player);
        var b = WorldLoader.LoadFromString(TestContent.Live, json).World;
        Assert.Equal(json, WorldSaver.SaveToString(b, scenario.Id, player));
        Assert.Equal(StateDigest.Of(a), StateDigest.Of(b));

        for (var i = 0; i < 18; i++)
        {
            a.AdvanceMonth();
            b.AdvanceMonth();
        }

        Assert.Equal(StateDigest.Of(a), StateDigest.Of(b));
        Assert.Equal(WorldSaver.SaveToString(a, scenario.Id, player), WorldSaver.SaveToString(b, scenario.Id, player));
        Assert.Equal(a.FinanceEvents.Count, b.FinanceEvents.Count);
        Invariants.AssertAll(b);
    }

    [Fact]
    public void A_realistic_save_without_a_finance_section_loads_and_does_not_tax_its_history()
    {
        // Land rules off: since the E2 x E3b integration the finance section also carries land and
        // construction in progress, and a save from before finance (Wave 1) had no plots either.
        var rules = EconomyRules.Realistic with { Land = new LandRules() };
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, TestContent.LiveScenarios["sandbox"], seed: 5, rules);
        world.RegisterAi(player, new AdaptiveStrategy());
        for (var i = 0; i < 6; i++) world.AdvanceMonth();
        var json = WorldSaver.SaveToString(world);
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!.AsObject();
        Assert.True(node.Remove("finance"));
        var loaded = WorldLoader.LoadFromString(TestContent.Live, node.ToJsonString()).World;
        loaded.AdvanceMonth();
        Invariants.AssertAll(loaded);
        var newTax = loaded.Ledger.Entries.Where(e => e.Category == LedgerCategory.IncomeTax && e.Date == loaded.Clock.Now).Sum(e => -e.Amount);
        // Only the first month after the load is taxed (25 % of at most this month's pre-tax income).
        var thisMonth = loaded.Companies.Values.Sum(c => Math.Max(0m, loaded.GetIncomeStatement(c.Id, loaded.Clock.Now, loaded.Clock.Now).PreTaxIncome));
        Assert.True(newTax <= 0.25m * thisMonth + 0.01m, $"tax {newTax} on month income {thisMonth}");
    }
}
