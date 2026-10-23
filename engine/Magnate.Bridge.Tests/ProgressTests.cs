using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Goals and outcome, advisor, history, stats, news and the activity feed (GameSession.Progress.cs, bridge-spec §5.10–§5.11, MASTER-PLAN D9/D11).</summary>
public class ProgressTests
{
    private static readonly GameDate Start = new(2026, 1);

    /// <summary>A session running a hand-made scenario with no AI.</summary>
    private static Bridge WithScenario(GameDate? end, decimal cash, params Goal[] goals)
    {
        var session = TestContent.NewSession();
        var scenario = new Scenario("test", "Test", "", Start, end, new ScenarioPlayer("Tester", cash), Array.Empty<ScenarioCompany>(), goals);
        var (world, player) = ScenarioRunner.Apply(session.Catalog, scenario, 1);
        session.Attach(world, player, scenario);
        return new Bridge(session);
    }

    private static string? Kind(JsonElement e) => e.GetProperty("kind").GetString();

    [Fact]
    public void Goals_latch_once_reached_and_the_scenario_is_won_when_all_have_latched()
    {
        var bridge = WithScenario(null, 20_000_000m,
            new ProductRetailedGoal("Sell bread", new ProductId("bread")),
            new ElapsedMonthsGoal("Two months", Start, 2));

        var store = bridge.Supermarket("bread", 3.0m, 10_000);
        var achieved = bridge.EnvelopeEvents().Single(e => Kind(e) == "goalAchieved");
        Assert.Equal("g0", achieved.GetProperty("goalId").GetString());
        Assert.Equal(3, achieved.GetProperty("priority").GetInt32());
        var goals = bridge.Call("goals");
        Assert.Equal("g1", goals.GetProperty("nextGoalId").GetString());
        Assert.True(goals.GetProperty("goals")[0].GetProperty("achieved").GetBoolean());
        Assert.Equal(new DateDto(2026, 1), JsonSerializer.Deserialize<DateDto>(goals.GetProperty("goals")[0].GetProperty("achievedAt").GetRawText(), Bridge.Json));
        Assert.Equal("reachOnce", goals.GetProperty("goals")[0].GetProperty("mode").GetString());

        // No longer met, still latched (D11): the goal counts towards victory.
        bridge.Call("clearSlot", new { buildingId = store, slotIndex = 0 });
        Assert.Contains(bridge.EnvelopeEvents(), e => Kind(e) == "goalLost" && e.GetProperty("goalId").GetString() == "g0");
        var g0 = bridge.Call("goals").GetProperty("goals")[0];
        Assert.False(g0.GetProperty("achieved").GetBoolean());
        Assert.True(g0.TryGetProperty("achievedAt", out _));
        Assert.Equal("g1", bridge.Call("snapshot").GetProperty("scenario").GetProperty("nextGoalId").GetString());

        var tick = bridge.Call("advance", new { months = 6 });
        Assert.Equal(2, tick.GetProperty("months").GetInt32()); // a decided scenario ends the batch
        Assert.Equal("scenarioWon", tick.GetProperty("stoppedBy").GetString());
        var won = tick.GetProperty("events").EnumerateArray().Single(e => Kind(e) == "scenarioWon");
        Assert.Equal("allGoals", won.GetProperty("reason").GetString());
        var outcome = tick.GetProperty("snapshot").GetProperty("outcome");
        Assert.Equal("won", outcome.GetProperty("status").GetString());
        Assert.Equal(new DateDto(2026, 3), JsonSerializer.Deserialize<DateDto>(outcome.GetProperty("at").GetRawText(), Bridge.Json));
        Assert.Equal(2, tick.GetProperty("snapshot").GetProperty("scenario").GetProperty("goalsAchieved").GetInt32());

        // Playing on is sandbox mode: the outcome sticks and commands still work.
        bridge.Advance(1);
        bridge.Supermarket("bread", 3.0m, 10_000);
        Assert.Equal("won", bridge.Call("goals").GetProperty("outcome").GetProperty("status").GetString());
    }

    [Fact]
    public void A_command_can_win_the_game()
    {
        var bridge = WithScenario(null, 20_000_000m, new OwnsBuildingOfCategoryGoal("Own a supermarket", "supermarket"));
        bridge.Build("supermarket");
        var won = bridge.EnvelopeEvents().Single(e => Kind(e) == "scenarioWon");
        Assert.Equal(3, won.GetProperty("priority").GetInt32());
        Assert.Equal("won", bridge.LastEnvelope.GetProperty("hud").GetProperty("outcome").GetProperty("status").GetString());
    }

    [Fact]
    public void Missing_the_deadline_loses_at_the_close_of_the_end_month()
    {
        var bridge = WithScenario(new GameDate(2026, 3), 20_000_000m, new OwnsBuildingOfCategoryGoal("Own a department store", "department_store"));
        var scenario = bridge.Call("snapshot").GetProperty("scenario");
        Assert.Equal(2, scenario.GetProperty("monthsRemaining").GetInt32());
        var tick = bridge.Call("advance", new { months = 12 });
        Assert.Equal(2, tick.GetProperty("months").GetInt32());
        Assert.Equal("scenarioLost", tick.GetProperty("stoppedBy").GetString());
        var lost = tick.GetProperty("events").EnumerateArray().Single(e => Kind(e) == "scenarioLost");
        Assert.Equal("deadline", lost.GetProperty("reason").GetString());
        var goals = bridge.Call("goals");
        Assert.Equal("lost", goals.GetProperty("outcome").GetProperty("status").GetString());
        Assert.Equal(0, goals.GetProperty("monthsRemaining").GetInt32());
        Assert.Equal(new DateDto(2026, 3), JsonSerializer.Deserialize<DateDto>(goals.GetProperty("deadline").GetRawText(), Bridge.Json));
    }

    /// <summary>A no-goal, no-AI game under Classic rules (no finance model): the interim insolvency rule applies.</summary>
    private static Bridge ClassicGame(decimal cash)
    {
        var session = TestContent.NewSession();
        var scenario = new Scenario("classic-test", "Classic test", "", Start, null, new ScenarioPlayer("Tester", cash),
            Array.Empty<ScenarioCompany>(), Array.Empty<Goal>());
        var (world, player) = ScenarioRunner.Apply(session.Catalog, scenario, 1, Magnate.Engine.Rules.EconomyRules.Classic);
        session.Attach(world, player, scenario);
        return new Bridge(session);
    }

    [Fact]
    public void Without_the_finance_model_insolvency_is_three_negative_month_ends()
    {
        // Classic rules (legacy saves): 3½ months of the store's fixed opex left after building it
        // (sized from content): negative at the close of May.
        var bridge = ClassicGame(Bridge.Cost("supermarket") + 3.5m * Bridge.Type("supermarket").MonthlyOperatingCost);
        bridge.Build("supermarket");
        var first = bridge.Call("advance", new { months = 12, stopOn = new[] { "cashNegative" } });
        Assert.Equal("cashNegative", first.GetProperty("stoppedBy").GetString());
        Assert.Equal(4, first.GetProperty("months").GetInt32());
        var warning = first.GetProperty("events").EnumerateArray().Single(e => Kind(e) == "bankruptcyWarning");
        Assert.Equal(3, warning.GetProperty("months").GetInt32());
        var alerts = first.GetProperty("snapshot").GetProperty("alerts");
        Assert.Equal(1, alerts.GetProperty("negativeCashMonths").GetInt32());
        Assert.Equal(3, alerts.GetProperty("bankruptcyInMonths").GetInt32());
        Assert.Equal(3, alerts.GetProperty("bankruptcyGraceMonths").GetInt32());
        Assert.True(alerts.GetProperty("lowCash").GetBoolean());

        var rest = bridge.Call("advance", new { months = 12 });
        Assert.Equal(3, rest.GetProperty("months").GetInt32()); // Jun, Jul still curable; lost at the close of Aug
        var events = rest.GetProperty("events").EnumerateArray().ToList();
        Assert.Equal(new[] { 2, 1 }, events.Where(e => Kind(e) == "bankruptcyWarning").Select(e => e.GetProperty("months").GetInt32()));
        Assert.Equal("bankruptcy", events.Single(e => Kind(e) == "scenarioLost").GetProperty("reason").GetString());
        var snapshot = rest.GetProperty("snapshot");
        Assert.Equal("lost", snapshot.GetProperty("outcome").GetProperty("status").GetString());
        Assert.False(snapshot.GetProperty("alerts").TryGetProperty("bankruptcyInMonths", out _));
    }

    [Fact]
    public void Insolvency_is_a_default_with_a_three_month_cure_window()
    {
        // Realistic rules (econ-audit §4.14): the revolver covers a shortfall up to its limit; past it
        // the company defaults (distress, rating D, no new credit), has three month closes to cure,
        // and is then liquidated — the player loses with reason "insolvency".
        // Sized from content: a store, a little cash, and a TV campaign a third of the store's cost a
        // month — far beyond what the revolver (half the collateral before seasoning) can carry.
        var bridge = Bridge.Custom(playerCash: Bridge.Cost("supermarket") + 100_000m);
        bridge.Build("supermarket", "metropolis", new { productId = "soft_drink", price = 2.0, restockTarget = 20_000 });
        bridge.Call("setAdCampaign", new { productId = "soft_drink", cityId = "metropolis", channel = "tv", monthlyBudget = Bridge.Cost("supermarket") / 3 });

        var first = bridge.Call("advance", new { months = 12, stopOn = new[] { "insolvency" } });
        Assert.Equal("insolvency", first.GetProperty("stoppedBy").GetString());
        var defaulted = first.GetProperty("events").EnumerateArray().Single(e => Kind(e) == "insolvency");
        Assert.Equal("default", defaulted.GetProperty("reason").GetString());
        Assert.Equal(3, defaulted.GetProperty("priority").GetInt32());
        Assert.True(defaulted.GetProperty("isPlayer").GetBoolean());
        var alerts = first.GetProperty("snapshot").GetProperty("alerts");
        Assert.Equal(3, alerts.GetProperty("bankruptcyInMonths").GetInt32());
        Assert.Equal(3, alerts.GetProperty("bankruptcyGraceMonths").GetInt32());
        Assert.Equal("playing", first.GetProperty("snapshot").GetProperty("outcome").GetProperty("status").GetString());

        var credit = bridge.Call("creditProfile");
        Assert.Equal("distress", credit.GetProperty("solvency").GetString());
        Assert.Equal(3, credit.GetProperty("cureMonthsLeft").GetInt32());
        Assert.Equal(0m, credit.GetProperty("newLoanMax").GetDecimal());
        Assert.Empty(bridge.Call("loanOffers").EnumerateArray());
        var refused = bridge.Fail("takeLoan", new { amount = 100_000, termMonths = 12 });
        Assert.Equal(BridgeErrorCodes.InvalidOperation, refused.Code);
        Assert.Equal("distressed", refused.Detail("reason"));

        // Nothing changes: the cure window runs out and the company is liquidated.
        var rest = bridge.Call("advance", new { months = 12 });
        Assert.Equal(3, rest.GetProperty("months").GetInt32());
        var events = rest.GetProperty("events").EnumerateArray().ToList();
        Assert.Contains(events, e => Kind(e) == "insolvency" && e.GetProperty("reason").GetString() == "bankrupt");
        Assert.Equal("insolvency", events.Single(e => Kind(e) == "scenarioLost").GetProperty("reason").GetString());
        var snapshot = rest.GetProperty("snapshot");
        Assert.Equal("lost", snapshot.GetProperty("outcome").GetProperty("status").GetString());
        Assert.Equal("insolvency", snapshot.GetProperty("outcome").GetProperty("reason").GetString());
        Assert.False(snapshot.GetProperty("alerts").TryGetProperty("bankruptcyInMonths", out _));
        Assert.Equal(0, snapshot.GetProperty("player").GetProperty("buildings").GetInt32()); // sold off
        Assert.Equal("bankrupt", bridge.Call("creditProfile").GetProperty("solvency").GetString());
    }

    [Fact]
    public void The_advisor_walks_the_onboarding_ladder_and_offers_fixes()
    {
        // 2026-USD economics (E1/E2): a supermarket only pays its wages, running costs and
        // depreciation with a full grocery and apparel range at sensible prices, and against normal
        // incumbents an R&D centre costs about four such stores' profit a month — so this company
        // opens a chain (every city, two in Metropolis) before researching. Cash is sized from content.
        var cities = new[] { "metropolis", "metropolis", "eastside", "portbay", "hilltown" };
        var bridge = Bridge.Custom(seed: 2, playerCash: Bridge.Cost("warehouse_small") + (1 + cities.Length) * Bridge.Cost("supermarket") + Bridge.Cost("rd_center") + 10_000_000m);
        string Priority() => bridge.Call("advisor").GetProperty("priority").GetProperty("code").GetString()!;
        Assert.Equal("firstRevenue", Priority());

        var warehouse = bridge.Build("warehouse_small", "riverside");
        var advisor = bridge.Call("advisor");
        Assert.Equal("activateIdle", advisor.GetProperty("priority").GetProperty("code").GetString());
        Assert.Equal(new[] { warehouse }, advisor.GetProperty("priority").GetProperty("buildingIds").EnumerateArray().Select(i => i.GetInt32()));
        var idle = advisor.GetProperty("hints").EnumerateArray().Single(h => h.GetProperty("code").GetString() == "idleBuilding");
        Assert.Equal(Bridge.Type("warehouse_small").MonthlyOperatingCost, idle.GetProperty("impactPerMonth").GetDecimal());

        bridge.Call("configureSlot", new { buildingId = warehouse, slotIndex = 0, productId = "bread", targetStock = 10_000 });
        Assert.Equal("needRetail", Priority());

        // Restocking above Riverside's bread demand leaves stock on the shelf to price; bread at $1
        // is below its landed cost. The rest of the range is priced at twice the world price.
        var range = new[] { "soft_drink", "beer", "coffee_drink", "t_shirt", "designer_jeans" };
        decimal Above(string product) => 2m * (decimal)TestContent.Catalog.Products[new ProductId(product)].BaseWorldMarketPrice;
        var store = bridge.Build("supermarket", "riverside", new { productId = "bread", price = 1.00, restockTarget = 2_000_000 });
        for (var i = 0; i < range.Length; i++)
        {
            bridge.Call("configureSlot", new { buildingId = store, slotIndex = i + 1, productId = range[i], price = Above(range[i]), restockTarget = 2_000_000 });
        }
        bridge.Advance(1);
        advisor = bridge.Call("advisor");
        Assert.Equal("restoreProfit", advisor.GetProperty("priority").GetProperty("code").GetString());
        Assert.Equal("warning", advisor.GetProperty("priority").GetProperty("severity").GetString());
        var below = advisor.GetProperty("hints").EnumerateArray().Single(h => h.GetProperty("code").GetString() == "sellingBelowCost");
        Assert.Equal(store.ToString(System.Globalization.CultureInfo.InvariantCulture), below.GetProperty("params").GetProperty("buildingId").GetString());
        Assert.True(below.GetProperty("impactPerMonth").GetDecimal() > 0);
        var fix = below.GetProperty("fix");
        Assert.Equal("setRetailPrice", fix.GetProperty("method").GetString());
        var shelf = bridge.World.Buildings[new BuildingInstanceId(store)].Inventory;
        var unitCost = shelf.CostOf(new ProductId("bread")) / (decimal)shelf.Get(new ProductId("bread"));
        Assert.True(unitCost > 1.00m);
        var repriced = bridge.Call("setRetailPrice", fix.GetProperty("argsJson").GetString()!);
        // The shelf's unit cost (world price + import mark-up) × 1.25, to the cent (half-even).
        Assert.Equal(Math.Round(unitCost * 1.25m, 2, MidpointRounding.ToEven), repriced.GetProperty("retail").GetProperty("price").GetDecimal());

        // The player then prices the whole range at the engine's suggestions and opens a chain.
        var suggested = new decimal[range.Length + 1];
        for (var i = 0; i <= range.Length; i++)
        {
            suggested[i] = bridge.Call("suggestPrice", new { buildingId = store, slotIndex = i }).GetProperty("suggested").GetDecimal();
            bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = i, price = suggested[i] });
        }
        foreach (var city in cities)
        {
            var chain = bridge.Build("supermarket", city, new { productId = "bread", price = suggested[0], restockTarget = 2_000_000 });
            for (var i = 0; i < range.Length; i++)
            {
                bridge.Call("configureSlot", new { buildingId = chain, slotIndex = i + 1, productId = range[i], price = suggested[i + 1], restockTarget = 2_000_000 });
            }
        }

        bridge.Advance(1);
        Assert.Equal("buildBrand", Priority());
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 1_000 });
        Assert.Equal("addResearch", Priority());
        bridge.Build("rd_center", "riverside", new { productId = "bread" });
        bridge.Advance(1);
        var scale = bridge.Call("advisor").GetProperty("priority");
        Assert.Equal("scale", scale.GetProperty("code").GetString());
        Assert.Equal("1", scale.GetProperty("params").GetProperty("research").GetString());
        Assert.Equal("1", scale.GetProperty("params").GetProperty("campaigns").GetString());
        Assert.True(bridge.Call("advisor").GetProperty("hints").GetArrayLength() <= 8);
    }

    [Fact]
    public void History_returns_dense_series_per_company()
    {
        var bridge = Bridge.Custom(seed: 3, playerCash: 50_000_000m, ("Rival", "simple"));
        bridge.Supermarket("bread", 3.0m, 50_000, "riverside");
        bridge.Advance(3);
        var history = bridge.Call("history", new { series = new[] { "cash", "buildings", "netIncome" } });
        Assert.Equal(4, history.GetProperty("months").GetInt32());
        Assert.Equal(new DateDto(2026, 1), JsonSerializer.Deserialize<DateDto>(history.GetProperty("start").GetRawText(), Bridge.Json));
        var player = history.GetProperty("companies").EnumerateArray().Single();
        Assert.Equal(1, player.GetProperty("companyId").GetInt32());
        var cash = player.GetProperty("series").GetProperty("cash").EnumerateArray().Select(v => v.GetDecimal()).ToList();
        Assert.Equal(50_000_000m, cash[0]); // the start row is recorded before anything is built
        Assert.Equal(Math.Round(bridge.Cash(), 2), cash[^1]);
        Assert.Equal(1m, player.GetProperty("series").GetProperty("buildings")[3].GetDecimal());
        Assert.False(player.GetProperty("series").TryGetProperty("topBrand", out _));
        Assert.Empty(player.GetProperty("missingBefore").EnumerateObject());

        var both = bridge.Call("history", new { series = Array.Empty<string>(), companyIds = new[] { 1, 2 }, from = new { year = 2026, month = 2 } });
        Assert.Equal(2, both.GetProperty("companies").GetArrayLength());
        Assert.Equal(3, both.GetProperty("months").GetInt32());
        Assert.Equal(MetricsHistory.SeriesNames.Length, both.GetProperty("companies")[1].GetProperty("series").EnumerateObject().Count());

        var bad = bridge.Fail("history", new { series = new[] { "vibes" } });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bad.Code);
        Assert.Equal("series", bad.Field);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("history", new { series = new[] { "cash" }, companyIds = new[] { 9 } }).Code);
    }

    [Fact]
    public void Stats_dashboard_reports_shares_tech_brands_and_top_buildings()
    {
        var bridge = Bridge.Custom(seed: 3);
        var store = bridge.Supermarket("bread", 3.0m, 50_000, "riverside");
        var rd = bridge.Build("rd_center", "riverside", new { productId = "bread" });
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 40_000 });
        bridge.Advance(2);
        var stats = bridge.Call("statsDashboard");
        var heat = stats.GetProperty("shareHeatmap");
        var cities = heat.GetProperty("cityIds").EnumerateArray().Select(c => c.GetString()).ToList();
        Assert.Equal(5, cities.Count);
        Assert.Equal(new[] { "bread" }, heat.GetProperty("productIds").EnumerateArray().Select(p => p.GetString()));
        Assert.Equal(1.0, heat.GetProperty("share")[cities.IndexOf("riverside")][0].GetDouble(), 9);
        Assert.Equal(JsonValueKind.Null, heat.GetProperty("share")[cities.IndexOf("hilltown")][0].ValueKind);
        var tech = stats.GetProperty("rdLeaderboard").EnumerateArray().Single();
        Assert.Equal("bread", tech.GetProperty("productId").GetString());
        Assert.Equal(7, tech.GetProperty("maxTech").GetInt32());
        var brand = stats.GetProperty("brandTop").EnumerateArray().Single().GetProperty("rows")[0];
        Assert.Equal("riverside", brand.GetProperty("cityId").GetString());
        Assert.True(brand.GetProperty("brand").GetDouble() > 0);
        Assert.Equal(store, stats.GetProperty("topByRevenue")[0].GetProperty("buildingId").GetInt32());
        // The R&D centre: its scientists' wages and running costs as booked this month (Realistic payroll).
        var top = stats.GetProperty("topByOpex")[0];
        Assert.Equal(rd, top.GetProperty("buildingId").GetInt32());
        Assert.Equal(Math.Round(bridge.BookedOpex(rd, bridge.Session.Game.Now), 2), top.GetProperty("amount").GetDecimal());
        Assert.True(top.GetProperty("amount").GetDecimal() > bridge.BookedOpex(store, bridge.Session.Game.Now));
        Assert.Equal(3, stats.GetProperty("corporateValueSeries").GetProperty("values").GetArrayLength());
    }

    [Fact]
    public void News_pages_by_sequence_and_joins_event_effects()
    {
        var bridge = Bridge.Game("sandbox", seed: 17);
        bridge.Advance(24);
        bridge.Advance(24);
        var news = bridge.Call("news", new { limit = 500 });
        var entries = news.GetProperty("entries").EnumerateArray().ToList();
        Assert.True(entries.Count > 3, $"{entries.Count} news entries in four years");
        Assert.Equal(bridge.World.NewsLog.Count, entries.Count);
        Assert.Equal(entries.Count - 1, news.GetProperty("latestSeq").GetInt64());
        Assert.Equal(news.GetProperty("latestSeq").GetInt64(), bridge.Call("snapshot").GetProperty("newsSeq").GetInt64());
        Assert.Equal(Enumerable.Range(0, entries.Count).Select(i => (long)i), entries.Select(e => e.GetProperty("seq").GetInt64()));
        Assert.All(entries, e => Assert.Contains(e.GetProperty("severity").GetString(), new[] { "info", "notable", "major" }));
        Assert.All(entries, e => Assert.NotEqual(0, e.GetProperty("effects").GetArrayLength()));
        Assert.All(entries, e => Assert.False(string.IsNullOrEmpty(e.GetProperty("description").GetString())));

        var since = bridge.Call("news", new { sinceSeq = entries.Count - 3 }).GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(2, since.Count);
        Assert.Equal(entries.Count - 2, since[0].GetProperty("seq").GetInt64());
        Assert.Equal(2, bridge.Call("news", new { limit = 2 }).GetProperty("entries").GetArrayLength());
        foreach (var effect in news.GetProperty("activePriceEffects").EnumerateArray())
        {
            Assert.Equal(effect.GetProperty("basePrice").GetDecimal() * effect.GetProperty("multiplier").GetDecimal(),
                effect.GetProperty("effectivePrice").GetDecimal(), 2);
        }
    }

    [Fact]
    public void The_activity_feed_keeps_feed_worthy_events_and_filters_them()
    {
        var bridge = Bridge.Game("tutorial", seed: 3);
        bridge.Supermarket("soft_drink", 2.25m, 50_000);
        var tick = bridge.Advance(6);
        var all = bridge.Call("activityFeed", new { limit = 1000 });
        var events = all.GetProperty("events").EnumerateArray().ToList();
        Assert.All(events, e => Assert.True(e.GetProperty("priority").GetInt32() >= 1));
        Assert.DoesNotContain(events, e => Kind(e) is "monthClosed" or "buildingSales");
        Assert.Contains(tick.GetProperty("events").EnumerateArray(), e => Kind(e) == "monthClosed"); // ambient: response only
        var seqs = events.Select(e => e.GetProperty("seq").GetInt64()).ToList();
        Assert.Equal(seqs.OrderBy(s => s), seqs);
        Assert.Equal(bridge.Call("snapshot").GetProperty("feedSeq").GetInt64(), all.GetProperty("latestSeq").GetInt64());

        var built = bridge.Call("activityFeed", new { kinds = new[] { "buildingConstructed" } }).GetProperty("events").EnumerateArray().ToList();
        Assert.Contains(built, e => e.GetProperty("isPlayer").GetBoolean());
        Assert.Contains(built, e => !e.GetProperty("isPlayer").GetBoolean()); // LocalCo opened a store too
        var search = bridge.Call("activityFeed", new { search = "FIRST SALE" }).GetProperty("events").EnumerateArray().ToList();
        Assert.Single(search);
        var tail = bridge.Call("activityFeed", new { sinceSeq = seqs[^2] }).GetProperty("events").EnumerateArray().ToList();
        Assert.Single(tail);
        Assert.Equal(2, bridge.Call("activityFeed", new { limit = 2 }).GetProperty("events").GetArrayLength());
    }
}

/// <summary>
/// The facade's goal evaluation against the engine's own <see cref="Goal.Evaluate"/> on
/// every month of every scenario with the player on autopilot (bridge-spec §10.1).
/// Market-share goals deliberately differ (D11: realised trailing-3-month unit share, not
/// the engine's model share) and are checked against an independent COGS computation.
/// </summary>
public class GoalParityTests
{
    public static IEnumerable<object[]> ScenarioIds()
        => TestContent.NewSession().Scenarios.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(id => new object[] { id });

    [Theory]
    [MemberData(nameof(ScenarioIds))]
    public void Facade_goals_agree_with_the_engine_every_month(string scenarioId)
    {
        var bridge = Bridge.Game(scenarioId, seed: 5, autopilot: "adaptive");
        var session = bridge.Session;
        var scenario = session.ActiveScenario!;
        for (var month = 0; month < 36; month++)
        {
            bridge.Advance(1);
            var facade = bridge.Call("goals").GetProperty("goals").EnumerateArray().ToList();
            Assert.Equal(scenario.Goals.Count, facade.Count);
            for (var i = 0; i < scenario.Goals.Count; i++)
            {
                var goal = scenario.Goals[i];
                var mine = facade[i];
                var label = $"{scenarioId} month {month + 1} goal g{i} ({goal.GetType().Name})";
                if (goal is MarketShareGoal share)
                {
                    var expected = TrailingShare(session.World, session.PlayerId, share.City, share.Product);
                    Assert.True(Math.Abs(expected - (double)mine.GetProperty("current").GetDecimal()) < 1e-4, $"{label}: {expected} vs {mine.GetProperty("current")}");
                    Assert.Equal(expected >= share.Threshold, mine.GetProperty("achieved").GetBoolean());
                    continue;
                }
                var engine = goal.Evaluate(session.World, session.PlayerId);
                Assert.True(engine.Achieved == mine.GetProperty("achieved").GetBoolean(), $"{label}: engine {engine.Achieved} ({engine.Detail}) vs facade {mine}");
                Assert.True(Math.Abs(Math.Clamp(engine.Progress, 0, 1) - mine.GetProperty("progress").GetDouble()) < 1e-9, $"{label}: progress {engine.Progress} vs {mine}");
            }
        }
    }

    /// <summary>Player retail units ÷ all retail units in (city, product) over the last three months, straight from the COGS log.</summary>
    private static double TrailingShare(World world, CompanyId player, CityId city, ProductId product)
    {
        var now = world.Clock.Now.AsMonthIndex();
        double mine = 0, total = 0;
        foreach (var e in world.CogsLog.Entries)
        {
            if (e.Product != product || e.SourceBuilding is not { } source) continue;
            if (e.Date.AsMonthIndex() < now - 2 || e.Date.AsMonthIndex() > now) continue;
            if (!world.Buildings.TryGetValue(source, out var building) && !world.RetiredBuildings.TryGetValue(source, out building)) continue;
            if (building.City != city || !world.Catalog.BuildingType(building.TypeId).Retail) continue;
            total += e.Quantity;
            if (e.Company == player) mine += e.Quantity;
        }
        return total > 0 ? mine / total : 0;
    }
}
