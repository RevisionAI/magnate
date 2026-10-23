using System;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Scenario library, new game, HUD, companies, advance, settings, autopilot (GameSession.Game.cs / Progress.cs).</summary>
public class GameFlowTests
{
    [Fact]
    public void Scenario_library_is_ordered_rated_and_briefed()
    {
        var list = Bridge.Init().Call("listScenarios").EnumerateArray().ToList();
        Assert.Equal(16, list.Count);
        Assert.Equal("tutorial", list[0].GetProperty("id").GetString());
        Assert.Equal("sandbox", list[1].GetProperty("id").GetString());
        var keys = list.Select(s => s.GetProperty("sortKey").GetInt32()).ToList();
        Assert.Equal(keys.OrderBy(k => k).ToList(), keys);
        foreach (var s in list)
        {
            var difficulty = s.GetProperty("difficulty").GetInt32();
            Assert.InRange(difficulty, 1, 5);
            Assert.Contains(s.GetProperty("difficultyBucket").GetString(), new[] { "easy", "normal", "hard" });
            Assert.False(string.IsNullOrWhiteSpace(s.GetProperty("briefing").GetString()));
            var goals = s.GetProperty("goalDetails").EnumerateArray().ToList();
            Assert.Equal(s.GetProperty("goals").GetArrayLength(), goals.Count);
            // Scenario-provided goal ids (E2 content), else "g" + index; unique within the scenario.
            var ids = goals.Select(g => g.GetProperty("id").GetString()!).ToList();
            Assert.All(ids, id => Assert.False(string.IsNullOrWhiteSpace(id)));
            Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
            Assert.All(s.GetProperty("competitors").EnumerateArray(),
                c => Assert.Contains(c.GetProperty("strategy").GetString(), new[] { "simple", "adaptive", "verticalIntegrator", "techLeader" }));
        }
        var melee = list.Single(s => s.GetProperty("id").GetString() == "four_archetype_melee");
        Assert.Equal(84, melee.GetProperty("durationMonths").GetInt32());
        // Company value goals read World.GetCorporateValue (D10) and are judged at the deadline (D11).
        Assert.Equal("companyValue", melee.GetProperty("goalDetails")[3].GetProperty("metric").GetString());
        Assert.Equal("holdAtDeadline", melee.GetProperty("goalDetails")[3].GetProperty("mode").GetString());
    }

    [Fact]
    public void New_game_builds_the_hud_with_player_colour_zero_and_a_stable_game_id()
    {
        var a = Bridge.Game("soft_drink_war", seed: 11);
        var snap = a.Call("snapshot");
        Assert.Equal(1, snap.GetProperty("playerId").GetInt32());
        var companies = snap.GetProperty("companies").EnumerateArray().ToList();
        Assert.True(companies.Count >= 2);
        var player = companies.Single(c => c.GetProperty("isPlayer").GetBoolean());
        Assert.Equal(0, player.GetProperty("colorIndex").GetInt32());
        Assert.Equal("#2F7DE1", player.GetProperty("color").GetString());
        Assert.All(companies.Where(c => !c.GetProperty("isPlayer").GetBoolean()),
            c => Assert.InRange(c.GetProperty("colorIndex").GetInt32(), 1, 7));
        Assert.All(companies.Where(c => !c.GetProperty("isPlayer").GetBoolean()),
            c => Assert.False(string.IsNullOrEmpty(c.GetProperty("aiStrategy").GetString())));
        Assert.Equal("playing", snap.GetProperty("outcome").GetProperty("status").GetString());
        Assert.Equal(0, snap.GetProperty("elapsedMonths").GetInt32());
        Assert.Matches("^[0-9a-f]{32}$", snap.GetProperty("gameId").GetString());

        var b = Bridge.Game("soft_drink_war", seed: 11);
        Assert.Equal(snap.GetProperty("gameId").GetString(), b.Call("snapshot").GetProperty("gameId").GetString());
        var c2 = Bridge.Game("soft_drink_war", seed: 12);
        Assert.NotEqual(snap.GetProperty("gameId").GetString(), c2.Call("snapshot").GetProperty("gameId").GetString());
    }

    [Fact]
    public void New_game_options_rename_the_player_and_validate_inputs()
    {
        var bridge = Bridge.Init();
        var snap = bridge.Call("newGame", new { scenarioId = "sandbox", companyName = "  Acme  " });
        Assert.Equal("Acme", snap.GetProperty("player").GetProperty("name").GetString());

        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("newGame", new { scenarioId = "nope" }).Code);
        var badPilot = bridge.Fail("newGame", new { scenarioId = "sandbox", autopilot = "chaos" });
        Assert.Equal(BridgeErrorCodes.NotFound, badPilot.Code);
        Assert.Equal("strategy", badPilot.Detail("entityKind"));
        Assert.Equal(BridgeErrorCodes.BadRequest, bridge.Fail("newGame", new { scenarioId = "custom" }).Code);
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("newGame", new { scenarioId = "sandbox", companyName = "" }).Code);
    }

    [Fact]
    public void Custom_games_run_with_the_requested_rivals()
    {
        var bridge = Bridge.Init();
        var snap = bridge.Call("newGame", new
        {
            scenarioId = "custom",
            seed = 5,
            custom = new
            {
                startDate = new { year = 2030, month = 6 },
                playerCash = 25_000_000,
                competitors = new[]
                {
                    new { name = "Alpha", startingCash = 20_000_000, strategy = "adaptive" },
                    new { name = "Beta", startingCash = 20_000_000, strategy = "vertical" },
                },
            },
        });
        Assert.Equal(3, snap.GetProperty("companies").GetArrayLength());
        Assert.Equal(2030, snap.GetProperty("date").GetProperty("year").GetInt32());
        Assert.Equal("verticalIntegrator", snap.GetProperty("companies")[2].GetProperty("aiStrategy").GetString());
        bridge.Advance(2);

        var badCustom = bridge.Fail("newGame", new
        {
            scenarioId = "custom",
            custom = new { startDate = new { year = 2030, month = 1 }, playerCash = -5, competitors = Array.Empty<object>() },
        });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, badCustom.Code);
        Assert.Equal("custom.playerCash", badCustom.Field);
    }

    [Fact]
    public void Advance_closes_months_in_order_and_reports_summaries_and_activity()
    {
        var bridge = Bridge.Game("tutorial", seed: 3);
        var store = bridge.Supermarket("soft_drink", 2.25m, 50_000);
        var tick = bridge.Advance(3);
        Assert.Equal(3, tick.GetProperty("months").GetInt32());
        var summaries = tick.GetProperty("monthSummaries").EnumerateArray().ToList();
        Assert.Equal(3, summaries.Count);
        for (var i = 1; i < summaries.Count; i++)
        {
            Assert.Equal(summaries[i - 1].GetProperty("cashEnd").GetDecimal(), summaries[i].GetProperty("cashStart").GetDecimal());
        }

        var events = tick.GetProperty("events").EnumerateArray().ToList();
        var closes = events.Select((e, i) => (Kind: e.GetProperty("kind").GetString(), i)).Where(x => x.Kind == "monthClosed").Select(x => x.i).ToList();
        Assert.Equal(3, closes.Count);
        Assert.Equal(events.Count - 1, closes[^1]);
        var seqs = events.Select(e => e.GetProperty("seq").GetInt64()).ToList();
        Assert.Equal(seqs.OrderBy(s => s).ToList(), seqs);
        Assert.Contains(events, e => e.GetProperty("kind").GetString() == "firstSale");

        var activity = tick.GetProperty("playerActivity").EnumerateArray().ToList();
        var storeActivity = activity.Single(a => a.GetProperty("buildingId").GetInt32() == store);
        Assert.True(storeActivity.GetProperty("revenue").GetDecimal() > 0);
        Assert.Equal(50_000, storeActivity.GetProperty("unitsSold").GetDouble());

        Assert.Equal(1, bridge.Advance(0).GetProperty("months").GetInt32());
        Assert.Equal(24, bridge.Advance(99).GetProperty("months").GetInt32());
    }

    [Fact]
    public void Advance_stops_early_on_requested_event_kinds_and_flags_autosaves()
    {
        var bridge = Bridge.Game("tutorial", seed: 3);
        bridge.Supermarket();
        var tick = bridge.Call("advance", new { months = 12, stopOn = new[] { "firstSale" } });
        Assert.Equal("firstSale", tick.GetProperty("stoppedBy").GetString());
        Assert.Equal(1, tick.GetProperty("months").GetInt32());

        bridge.Call("updateSettings", new { autosaveEveryMonths = 3 });
        Assert.False(bridge.Advance(1).GetProperty("autosaveDue").GetBoolean());
        Assert.True(bridge.Advance(1).GetProperty("autosaveDue").GetBoolean());
        bridge.Call("saveGame", new { slotKind = "autosave" });
        Assert.False(bridge.Advance(1).GetProperty("autosaveDue").GetBoolean());
        var feed = bridge.Call("activityFeed", new { kinds = new[] { "autosaved" } });
        Assert.Equal(1, feed.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public void Advance_can_include_the_city_view()
    {
        var bridge = Bridge.Game();
        bridge.Supermarket();
        var tick = bridge.Call("advance", new { months = 1, viewCityId = "metropolis" });
        var view = tick.GetProperty("cityView");
        Assert.True(view.GetProperty("full").GetBoolean());
        Assert.Equal(bridge.Revision, view.GetProperty("revision").GetInt64());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("advance", new { months = 1, viewCityId = "atlantis" }).Code);
    }

    [Fact]
    public void Companies_rank_by_corporate_value()
    {
        var bridge = Bridge.Game("three_way_melee", seed: 9);
        bridge.Advance(6);
        var rows = bridge.Call("companies").EnumerateArray().Select(c => c.GetProperty("corporateValue").GetDecimal()).ToList();
        Assert.Equal(rows.OrderByDescending(v => v).ToList(), rows);
    }

    [Fact]
    public void Settings_validate_and_persist()
    {
        var bridge = Bridge.Game();
        var settings = bridge.Call("settings");
        Assert.Equal(1_000_000m, settings.GetProperty("lowCashThreshold").GetDecimal());
        Assert.Equal(12, settings.GetProperty("autosaveEveryMonths").GetInt32());
        Assert.Equal(3, settings.GetProperty("bankruptcyGraceMonths").GetInt32());
        var updated = bridge.Call("updateSettings", new { lowCashThreshold = 2_500_000, autosaveEveryMonths = 0 });
        Assert.Equal(2_500_000m, updated.GetProperty("lowCashThreshold").GetDecimal());
        Assert.Equal(0, updated.GetProperty("autosaveEveryMonths").GetInt32());
        Assert.Equal("autosaveEveryMonths", bridge.Fail("updateSettings", new { autosaveEveryMonths = 500 }).Field);
    }

    [Fact]
    public void Autopilot_drives_the_player_company()
    {
        var bridge = Bridge.Game("sandbox", seed: 4);
        Assert.Equal("playing", bridge.Call("setAutopilot", "{\"strategy\":null}").GetProperty("outcome").GetProperty("status").GetString());
        var snap = bridge.Call("setAutopilot", new { strategy = "adaptive" });
        Assert.Equal("adaptive", snap.GetProperty("autopilot").GetString());
        bridge.Advance(4);
        Assert.True(bridge.Call("snapshot").GetProperty("player").GetProperty("buildings").GetInt32() > 0);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("setAutopilot", new { strategy = "chaos" }).Code);

        // The registration lives in the engine save: a reload keeps the autopilot on.
        var data = bridge.Call("saveGame").GetProperty("data").GetString()!;
        var reloaded = Bridge.Init();
        Assert.Equal("adaptive", reloaded.Call("loadGame", new { data }).GetProperty("autopilot").GetString());

        // Hand control back (World.UnregisterAi): the company stops building on its own.
        var off = bridge.Call("setAutopilot", "{\"strategy\":null}");
        Assert.False(off.TryGetProperty("autopilot", out _));
        Assert.False(bridge.World.TryGetAiStrategy(bridge.Session.PlayerId, out _));
        var buildings = bridge.Call("snapshot").GetProperty("player").GetProperty("buildings").GetInt32();
        bridge.Advance(3);
        Assert.Equal(buildings, bridge.Call("snapshot").GetProperty("player").GetProperty("buildings").GetInt32());
        var player = bridge.Call("snapshot").GetProperty("companies").EnumerateArray().Single(c => c.GetProperty("isPlayer").GetBoolean());
        Assert.False(player.TryGetProperty("aiStrategy", out _));
    }

    [Fact]
    public void Hud_runway_appears_only_when_burning_cash()
    {
        // An R&D centre earns nothing: with three times its price in the bank the runway is long but finite.
        var bridge = Bridge.Funded(playerCash: 3 * Bridge.Cost("rd_center"), rivalCash: 0m, seed: 3);
        Assert.False(bridge.Call("snapshot").GetProperty("player").TryGetProperty("cashRunwayMonths", out _));
        bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });
        bridge.Advance(2);
        var player = bridge.Call("snapshot").GetProperty("player");
        Assert.True(player.GetProperty("cashRunwayMonths").GetDouble() > 3);
        Assert.Equal(1, player.GetProperty("buildings").GetInt32());
        Assert.Equal(0, player.GetProperty("idleBuildings").GetInt32());
    }

    [Theory]
    [InlineData(1, "easy", 0.6)]
    [InlineData(2, "easy", 0.6)]
    [InlineData(3, "normal", 1.0)]
    [InlineData(4, "hard", 1.4)]
    [InlineData(5, "hard", 1.4)]
    public void Difficulty_buckets_map_to_incumbent_strength(int stars, string bucket, double strength)
    {
        Assert.Equal(bucket, Difficulty.Bucket(stars));
        Assert.Equal(strength, Difficulty.IncumbentStrength(Difficulty.Bucket(stars)));
    }

    [Fact]
    public void The_advisor_puts_insolvency_first_while_the_cure_window_is_open()
    {
        // A company that spends its cash on an R&D centre and then pays its running costs.
        var bridge = Bridge.Funded(playerCash: Bridge.Cost("rd_center") + 1_000m, rivalCash: 0m, seed: 4);
        bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });
        Assert.NotEqual("insolvency", bridge.Call("advisor").GetProperty("priority").GetProperty("code").GetString());
        bridge.Advance(1);

        var game = bridge.Session.Game;
        var advisor = bridge.Call("advisor");
        if (game.Goals.BankruptcyInMonths is int left)
        {
            var priority = advisor.GetProperty("priority");
            Assert.Equal("insolvency", priority.GetProperty("code").GetString());
            Assert.Equal("danger", priority.GetProperty("severity").GetString());
            Assert.Equal(left.ToString(System.Globalization.CultureInfo.InvariantCulture), priority.GetProperty("params").GetProperty("monthsLeft").GetString());
            Assert.Equal("insolvency", advisor.GetProperty("hints")[0].GetProperty("code").GetString()); // danger ranks first
        }

        // The rule itself, whatever the solvency model: any open window leads.
        var direct = new Advisor(game.World, game.Player, game.Index, game.Rules, game.Now, game.StartMonth, runway: 10, insolventMonthsLeft: 2).Build();
        Assert.Equal("insolvency", direct.Priority.Code);
        Assert.Equal("2", direct.Priority.Params["monthsLeft"]);
        Assert.Equal("insolvency", direct.Hints[0].Code);
        Assert.NotEqual("insolvency", new Advisor(game.World, game.Player, game.Index, game.Rules, game.Now, game.StartMonth, runway: 10).Build().Priority.Code);
    }
}
