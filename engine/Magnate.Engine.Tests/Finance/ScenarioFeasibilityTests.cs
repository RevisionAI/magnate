using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Finance;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Finance;

/// <summary>
/// Every shipped scenario is winnable and none is won on day one (econ-audit §4.18, master plan
/// D11, UX §6.16). The feasibility check is content-driven, so it keeps holding as the market
/// workstream rebalances products and buildings: it reads costs and products from the live
/// catalog rather than literals.
/// </summary>
public sealed class ScenarioFeasibilityTests
{
    public static TheoryData<string> Scenarios()
    {
        var data = new TheoryData<string>();
        foreach (var id in TestContent.LiveScenarios.Keys.OrderBy(k => k, StringComparer.Ordinal)) data.Add(id);
        return data;
    }

    private static int DurationMonths(Scenario s)
        => s.EndDate is { } end ? end.AsMonthIndex() - s.StartDate.AsMonthIndex() : int.MaxValue;

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Every_goal_is_feasible_within_the_scenario(string id)
    {
        var s = TestContent.LiveScenarios[id];
        var catalog = TestContent.Live;
        var cash = s.Player.StartingCash;
        var duration = DurationMonths(s);
        var years = Math.Max(1.0, Math.Min(duration, 120) / 12.0);
        var problems = new List<string>();

        foreach (var goal in s.Goals)
        {
            switch (goal)
            {
                case ElapsedMonthsGoal e when e.Months > duration:
                    problems.Add($"'{goal.Description}' needs {e.Months} months but the scenario lasts {duration}");
                    break;
                case CorporateValueGoal v:
                    CheckValue(v.Threshold, "company value");
                    break;
                case TotalAssetsGoal v:
                    CheckValue(v.Threshold, "total assets");
                    break;
                case NetWorthGoal v:
                    CheckValue(v.Threshold, "net worth");
                    break;
                case NetIncomeSinceStartGoal n:
                    if (n.Amount <= 0m || (double)n.Amount > (double)cash * 0.30 * years)
                        problems.Add($"net income {n.Amount:N0} is outside (0, 30 % × start cash × years]");
                    break;
                case ExportRevenueGoal x:
                    var perMonth = x.Amount / Math.Min(duration, 120);
                    if (x.Amount <= 0m || perMonth > 0.10m * cash)
                        problems.Add($"export revenue {x.Amount:N0} needs {perMonth:N0}/month, more than 10 % of start cash");
                    break;
                case MarketShareGoal m:
                    Product(m.Product);
                    City(m.City);
                    if (m.Threshold <= 0 || m.Threshold > 0.6) problems.Add($"market share {m.Threshold} outside (0, 0.6]");
                    break;
                case TopBrandGoal b:
                    Product(b.Product);
                    City(b.City);
                    if (b.Threshold <= 0 || b.Threshold > 90) problems.Add($"brand {b.Threshold} outside (0, 90]");
                    break;
                case ProductRetailedGoal p:
                    if (Product(p.Product) is { Tier: not ProductTier.Finished }) problems.Add($"{p.Product} is not a retail product");
                    break;
                case AdCampaignActiveGoal a:
                    Product(a.Product);
                    break;
                case OwnsBuildingOfCategoryGoal o:
                    var types = catalog.BuildingTypes.Values.Where(t => t.Category == o.Category).ToList();
                    if (types.Count == 0)
                    {
                        problems.Add($"no building type has category '{o.Category}'");
                        break;
                    }

                    var cheapest = types.Min(t => t.ConstructionCost);
                    if (cheapest * o.Count > cash * 2m) problems.Add($"{o.Count} × {o.Category} ({cheapest:N0} each) exceeds twice the start cash");
                    break;
                case CreditRatingGoal r:
                    if (duration < 15) problems.Add("a credit-rating goal needs at least 15 months (seasoning + a review)");
                    if (r.Target < CreditRating.AA) problems.Add("AAA cannot be reached below $2B of assets");
                    break;
            }
        }

        Assert.True(problems.Count == 0, $"{id}: " + string.Join("; ", problems));

        void CheckValue(decimal threshold, string what)
        {
            var multiple = (double)(threshold / cash);
            if (multiple <= 1.05) problems.Add($"{what} {threshold:N0} is not above the {cash:N0} start");
            if (multiple > Math.Max(2.0, Math.Pow(1.45, years))) problems.Add($"{what} {threshold:N0} needs {multiple:F1}× in {years:F1} years");
            if (duration < 12) problems.Add($"{what} goals need at least a year");
        }

        Product? Product(ProductId p)
        {
            if (catalog.Products.TryGetValue(p, out var product)) return product;
            problems.Add($"unknown product {p}");
            return null;
        }

        void City(CityId c)
        {
            if (!catalog.Cities.ContainsKey(c)) problems.Add($"unknown city {c}");
        }
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void No_scenario_is_won_on_day_one(string id)
    {
        var s = TestContent.LiveScenarios[id];
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, s, seed: 42, EconomyRules.Realistic);
        var referee = new ScenarioProgress(s, player);
        referee.Update(world);
        Assert.Equal(ScenarioStatus.Playing, referee.Status);
        world.AdvanceMonth();
        referee.Update(world);
        Assert.Equal(ScenarioStatus.Playing, referee.Status);
        if (s.Goals.Count > 0) Assert.True(referee.Latched.Count < s.Goals.Count);
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Goal_text_is_written_for_the_web_client(string id)
    {
        var s = TestContent.LiveScenarios[id];
        var texts = s.Goals.Select(g => g.Description).Append(s.Description).ToList();
        foreach (var text in texts)
        {
            Assert.False(string.IsNullOrWhiteSpace(text));
            foreach (var legacy in new[] { "Manage", "Inspect view", "softmax", "Construct.", "Reports scene", "_drink", "soft_drink", "designer_jeans", "coffee_drink" })
            {
                Assert.DoesNotContain(legacy, text, StringComparison.Ordinal);
            }
        }

        Assert.Equal(s.Goals.Count, s.Goals.Select(g => g.Id).Where(x => x is not null).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void The_two_formerly_unwinnable_scenarios_judge_value_at_the_deadline()
    {
        foreach (var id in new[] { "four_archetype_melee", "tech_titan_clash" })
        {
            var s = TestContent.LiveScenarios[id];
            Assert.DoesNotContain(s.Goals, g => g is ElapsedMonthsGoal e && e.Months > DurationMonths(s));
            Assert.Contains(s.Goals, g => g is CorporateValueGoal && g.Mode == GoalMode.HoldAtDeadline);
        }
    }

    [Fact]
    public void Tutorial_action_goals_latch_for_a_player_who_follows_the_steps()
    {
        var s = TestContent.LiveScenarios["tutorial"];
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, s, seed: 42, EconomyRules.Realistic);
        var referee = new ScenarioProgress(s, player);
        var soft = new ProductId("soft_drink");
        var bread = new ProductId("bread");
        var metropolis = new CityId("metropolis");

        var store = world.Construct(player, new BuildingTypeId("supermarket"), metropolis);
        world.ConfigureRetailSlot(store.Id, 0, soft, (decimal)world.Catalog.Product(soft).BaseWorldMarketPrice * 1.5m, 50_000);
        world.RegisterAdCampaign(player, soft, metropolis, AdChannel.TV, 50_000m);
        for (var month = 0; month < 6; month++)
        {
            world.AdvanceMonth();
            referee.Update(world);
        }

        var quote = world.GetCreditProfile(player).NewTermLoanMax;
        Assert.True(quote > 0m, "the store should be collateral for a first loan");
        world.TakeLoan(player, Math.Min(quote, 2_000_000m), 36);
        world.ConfigureRetailSlot(store.Id, 1, bread, (decimal)world.Catalog.Product(bread).BaseWorldMarketPrice * 1.5m, 20_000);
        world.AdvanceMonth();
        referee.Update(world);

        var latched = referee.LatchedIndices.Select(i => s.Goals[i].Id).ToHashSet();
        foreach (var goal in new[] { "open-store", "stock-soft-drinks", "advertise", "bank-loan", "second-line" })
        {
            Assert.Contains(goal, latched);
        }

        Assert.NotEqual(ScenarioStatus.Lost, referee.Status);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Hold_at_deadline_goals_are_judged_at_the_deadline()
    {
        var start = new GameDate(2026, 1);
        var goal = new CorporateValueGoal("worth 1", 1m) { Mode = GoalMode.HoldAtDeadline };
        var scenario = new Scenario("t", "t", "", start, new GameDate(2026, 4), new ScenarioPlayer("P", 5_000_000m),
            Array.Empty<ScenarioCompany>(), new Goal[] { goal });
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 1, EconomyRules.Realistic);
        var referee = new ScenarioProgress(scenario, player);
        for (var i = 0; i < 2; i++)
        {
            world.AdvanceMonth();
            referee.Update(world);
            Assert.Equal(ScenarioStatus.Playing, referee.Status);
        }

        world.AdvanceMonth(); // April 2026: the deadline month
        referee.Update(world);
        Assert.Equal(ScenarioStatus.Won, referee.Status);
        Assert.Empty(referee.Latched);
    }

    [Fact]
    public void Reach_once_goals_stay_latched_and_the_deadline_loses()
    {
        var start = new GameDate(2026, 1);
        var reach = new CorporateValueGoal("worth 4M", 4_000_000m);
        var never = new TopBrandGoal("brand", new ProductId("soft_drink"), new CityId("metropolis"), 90);
        var scenario = new Scenario("t", "t", "", start, new GameDate(2026, 3), new ScenarioPlayer("P", 5_000_000m),
            Array.Empty<ScenarioCompany>(), new Goal[] { reach, never });
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 1, EconomyRules.Realistic);
        var referee = new ScenarioProgress(scenario, player);
        referee.Update(world);
        Assert.Contains(0, referee.Latched.Keys);
        world.AdvanceMonth();
        referee.Update(world);
        world.AdvanceMonth();
        referee.Update(world);
        Assert.Equal(ScenarioStatus.Lost, referee.Status);
        Assert.Equal("deadline", referee.Reason);
        Assert.Contains(0, referee.Latched.Keys);
    }

    [Fact]
    public void Bankruptcy_loses_the_scenario()
    {
        var start = new GameDate(2026, 1);
        var scenario = new Scenario("t", "t", "", start, null, new ScenarioPlayer("P", 5_000_000m),
            Array.Empty<ScenarioCompany>(), new Goal[] { new CorporateValueGoal("v", 1_000_000_000m) });
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 1, EconomyRules.Realistic);
        var referee = new ScenarioProgress(scenario, player);
        FinanceFixture.BookProfit(world, player, -50_000_000m);
        for (var i = 0; i < 5 && referee.Status == ScenarioStatus.Playing; i++)
        {
            world.AdvanceMonth();
            referee.Update(world);
        }

        Assert.Equal(ScenarioStatus.Lost, referee.Status);
        Assert.Equal("bankruptcy", referee.Reason);
        Assert.True(world.IsBankrupt(player));
    }

    [Fact]
    public void New_goal_types_parse_from_json()
    {
        var dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "magnate-goal-" + Guid.NewGuid().ToString("N"));
        System.IO.Directory.CreateDirectory(dir);
        try
        {
            var path = System.IO.Path.Combine(dir, "x.json");
            System.IO.File.WriteAllText(path, """
            { "id": "x", "name": "X", "startDate": { "year": 2026, "month": 1 }, "player": { "name": "P", "startingCash": 1000000 },
              "goals": [
                { "id": "a", "type": "creditRating", "rating": "A-", "description": "rating" },
                { "id": "b", "type": "totalAssets", "threshold": 5, "description": "assets", "mode": "holdAtDeadline" },
                { "type": "netWorth", "threshold": 5, "description": "worth" },
                { "type": "loanTaken", "description": "loan" },
                { "type": "companyValue", "threshold": 9, "description": "value" } ] }
            """);
            var s = ScenarioLoader.Load(path);
            Assert.Equal(CreditRating.AMinus, Assert.IsType<CreditRatingGoal>(s.Goals[0]).Target);
            Assert.Equal("a", s.Goals[0].Id);
            Assert.Equal(GoalMode.HoldAtDeadline, Assert.IsType<TotalAssetsGoal>(s.Goals[1]).Mode);
            Assert.IsType<NetWorthGoal>(s.Goals[2]);
            Assert.Equal(1, Assert.IsType<LoanTakenGoal>(s.Goals[3]).Count);
            Assert.IsType<CorporateValueGoal>(s.Goals[4]);
            Assert.Null(s.Goals[2].Id);
        }
        finally
        {
            System.IO.Directory.Delete(dir, recursive: true);
        }
    }
}
