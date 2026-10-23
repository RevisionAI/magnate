using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Tick events: the bridge-spec §7.2 taxonomy, ordering, priorities and latches (Model/EventDetector.cs).</summary>
public class EventDetectorTests
{
    private static string? Kind(JsonElement e) => e.GetProperty("kind").GetString();

    private static List<JsonElement> Events(JsonElement tick) => tick.GetProperty("events").EnumerateArray().ToList();

    /// <summary>A rival whose moves the test scripts month by month.</summary>
    private sealed class ScriptedStrategy : IAiStrategy
    {
        public Queue<AiAction[]> Months { get; } = new();

        public IReadOnlyList<AiAction> Plan(World world, CompanyId actor) => Months.Count > 0 ? Months.Dequeue() : Array.Empty<AiAction>();
    }

    [Fact]
    public void Each_month_ends_with_month_closed_and_sequences_increase()
    {
        var bridge = Bridge.Game("tutorial", seed: 8);
        bridge.Supermarket();
        var tick = bridge.Advance(5);
        var events = Events(tick);
        var seqs = events.Select(e => e.GetProperty("seq").GetInt64()).ToList();
        Assert.Equal(seqs.OrderBy(s => s).Distinct(), seqs);
        var closes = events.Select((e, i) => (e, i)).Where(x => Kind(x.e) == "monthClosed").ToList();
        Assert.Equal(5, closes.Count);
        for (var m = 0; m < closes.Count; m++)
        {
            var month = JsonSerializer.Deserialize<DateDto>(closes[m].e.GetProperty("month").GetRawText(), Bridge.Json)!;
            Assert.Equal(new DateDto(2026, 2 + m), month);
            Assert.Equal(0, closes[m].e.GetProperty("priority").GetInt32());
            // Every event before this close (and after the previous one) belongs to the same month.
            var from = m == 0 ? 0 : closes[m - 1].i + 1;
            Assert.All(events.Skip(from).Take(closes[m].i - from), e =>
                Assert.Equal(month, JsonSerializer.Deserialize<DateDto>(e.GetProperty("month").GetRawText(), Bridge.Json)));
        }
        Assert.Single(events, e => Kind(e) == "firstSale");
        Assert.DoesNotContain(Events(bridge.Advance(3)), e => Kind(e) == "firstSale");
    }

    [Fact]
    public void Losing_months_build_a_streak_and_a_return_to_profit_flips()
    {
        // A store selling far below any unit cost loses money whatever the content's prices.
        var bridge = Bridge.Custom(seed: 6);
        bridge.Build("supermarket", "metropolis", new { productId = "soft_drink", price = 0.05, restockTarget = 50_000 });
        var streaks = new List<int>();
        for (var m = 0; m < 6; m++)
        {
            streaks.AddRange(Events(bridge.Advance(1)).Where(e => Kind(e) == "lossStreak").Select(e => e.GetProperty("months").GetInt32()));
        }
        Assert.Equal(new[] { 2, 4, 6 }, streaks);

        // A profitable month, independent of the economy's tuning: a one-off income booked in the month
        // the next advance closes (the detector reads net income from the ledger index).
        var world = bridge.World;
        var player = world.Companies.Keys.Min();
        world.Ledger.Record(new LedgerEntry(world.Clock.Now.AddMonth(), player, LedgerCategory.PatentRoyaltyIncome, 1_000_000_000m, "test: windfall"));
        var flip = Events(bridge.Advance(1)).Single(e => Kind(e) == "netIncomeFlip");
        Assert.Equal("toProfit", flip.GetProperty("reason").GetString());
        Assert.Equal("success", flip.GetProperty("severity").GetString());
        Assert.True(flip.GetProperty("amount").GetDecimal() > 0);
    }

    [Fact]
    public void Low_cash_warns_once_and_rearms_at_twice_the_threshold()
    {
        var bridge = Bridge.Custom(seed: 6, playerCash: 50_000_000m);
        bridge.Call("updateSettings", new { lowCashThreshold = 60_000_000 });
        var low = Events(bridge.Advance(1)).Single(e => Kind(e) == "cashLow");
        Assert.Equal(60_000_000m, low.GetProperty("threshold").GetDecimal());
        Assert.Equal(2, low.GetProperty("priority").GetInt32());
        Assert.DoesNotContain(Events(bridge.Advance(1)), e => Kind(e) == "cashLow"); // still low: no repeat
        Assert.True(bridge.Call("snapshot").GetProperty("alerts").GetProperty("lowCash").GetBoolean());

        bridge.Call("updateSettings", new { lowCashThreshold = 1_000_000 });
        bridge.Advance(1); // cash ≥ 2 × threshold: re-armed
        bridge.Call("updateSettings", new { lowCashThreshold = 60_000_000 });
        Assert.Single(Events(bridge.Advance(1)), e => Kind(e) == "cashLow");
    }

    [Fact]
    public void Revenue_milestones_fire_once_each()
    {
        var bridge = Bridge.Custom(seed: 6);
        bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.00, restockTarget = 200_000 });
        var milestones = new List<decimal>();
        for (var m = 0; m < 4; m++)
        {
            milestones.AddRange(Events(bridge.Advance(1)).Where(e => Kind(e) == "revenueMilestone").Select(e => e.GetProperty("threshold").GetDecimal()));
        }
        // $600k of bread a month: $1M in month 2.
        Assert.Equal(new[] { 1_000_000m }, milestones);
    }

    [Fact]
    public void Rivals_entering_and_undercutting_a_player_market_are_reported()
    {
        var bridge = Bridge.Custom(seed: 6, playerCash: 50_000_000m, ("Discounter", "simple"));
        var script = new ScriptedStrategy();
        var rival = new CompanyId(2);
        bridge.World.RegisterAi(rival, script);
        bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.00, restockTarget = 50_000 });

        script.Months.Enqueue(new AiAction[] { new BuildRetailerAction(new BuildingTypeId("supermarket"), new CityId("riverside"), new ProductId("bread"), 3.20m, 50_000) });
        var entered = Events(bridge.Advance(1)).ToList();
        var entry = entered.Single(e => Kind(e) == "rivalEnteredMarket");
        Assert.Equal(2, entry.GetProperty("companyId").GetInt32());
        Assert.Equal("riverside", entry.GetProperty("cityId").GetString());
        Assert.Equal(3.2m, entry.GetProperty("amount").GetDecimal());
        Assert.Contains(entered, e => Kind(e) == "buildingConstructed" && !e.GetProperty("isPlayer").GetBoolean());

        var rivalStore = bridge.World.Buildings.Values.Single(b => b.Owner == rival).Id;
        script.Months.Enqueue(new AiAction[] { new AdjustRetailPriceAction(rivalStore, 0, 2.80m) });
        var cut = Events(bridge.Advance(1)).Single(e => Kind(e) == "rivalUndercut");
        Assert.Equal(3.2m, cut.GetProperty("oldValue").GetDecimal());
        Assert.Equal(2.8m, cut.GetProperty("newValue").GetDecimal());

        // A second store of the same rival in the same market is not "news" again.
        script.Months.Enqueue(new AiAction[] { new BuildRetailerAction(new BuildingTypeId("convenience_store"), new CityId("riverside"), new ProductId("bread"), 2.90m, 1_000) });
        Assert.DoesNotContain(Events(bridge.Advance(1)), e => Kind(e) == "rivalEnteredMarket");
    }

    [Fact]
    public void Brand_milestones_and_below_cost_warnings()
    {
        var bridge = Bridge.Custom(seed: 6);
        var store = bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.00, restockTarget = 2_000_000 });
        // A budget the advertising model prices at about forty brand points a month (whatever its tuning).
        var costPerPoint = bridge.Call("previewAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 1 })
            .GetProperty("costPerPoint").GetDecimal();
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 40 * costPerPoint });
        var thresholds = new List<decimal>();
        for (var m = 0; m < 3; m++)
        {
            thresholds.AddRange(Events(bridge.Advance(1)).Where(e => Kind(e) == "brandMilestone").Select(e => e.GetProperty("threshold").GetDecimal()));
        }
        var brand = bridge.World.GetBrandAwareness(bridge.World.Companies.Keys.Min(), new ProductId("bread"), new CityId("riverside"));
        Assert.True(brand >= 30, $"brand {brand}");
        // Each threshold the brand passed fires once, in order.
        Assert.Equal(new[] { 30m, 50m, 70m }.Where(t => (double)t <= brand), thresholds);

        var unitCost = bridge.Call("suggestPrice", new { buildingId = store, slotIndex = 0 }).GetProperty("unitCost").GetDecimal();
        Assert.True(unitCost > 0m);
        var below = Math.Round(unitCost * 0.8m, 2);
        bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = 0, price = below });
        var warning = Events(bridge.Advance(1)).Single(e => Kind(e) == "belowCostPrice");
        Assert.Equal(below, warning.GetProperty("newValue").GetDecimal());
        Assert.True(warning.GetProperty("oldValue").GetDecimal() > below); // the unit cost it is below
        Assert.Equal(store, warning.GetProperty("buildingId").GetInt32());
        Assert.DoesNotContain(Events(bridge.Advance(3)), e => Kind(e) == "belowCostPrice"); // once per slot per 12 months
    }

    [Fact]
    public void Command_events_carry_their_context()
    {
        var bridge = Bridge.Custom();
        var store = bridge.Supermarket("bread", 3.0m, 10_000, "riverside");
        bridge.Call("configureSlot", new { buildingId = store, slotIndex = 1, productId = "beer", price = 4.0, restockTarget = 1_000 });
        var configured = bridge.EnvelopeEvents().Single(e => Kind(e) == "slotConfigured");
        Assert.Equal("beer", configured.GetProperty("productId").GetString());
        Assert.Equal(0, configured.GetProperty("priority").GetInt32());
        Assert.Equal(4m, configured.GetProperty("newValue").GetDecimal());
        // Priority-0 command events travel in the envelope only, never into the feed.
        Assert.DoesNotContain(bridge.Call("activityFeed", new { }).GetProperty("events").EnumerateArray(), e => Kind(e) == "slotConfigured");
        Assert.Contains(bridge.Call("activityFeed", new { }).GetProperty("events").EnumerateArray(), e => Kind(e) == "buildingConstructed");
    }
    [Fact]
    public void Quarter_close_sums_the_quarter_and_news_carries_the_content_event_id()
    {
        var bridge = Bridge.Game("tutorial", seed: 42);
        bridge.Supermarket("soft_drink", 2.25m, 60_000);
        var events = Events(bridge.Advance(7));
        var quarters = events.Where(e => Kind(e) == "quarterClosed").ToList();
        Assert.Equal(new[] { "Q1 2026", "Q2 2026" }, quarters.Select(q => q.GetProperty("reason").GetString()));
        var game = bridge.Session.Game;
        var q2 = quarters[1];
        var june = Months.Index(new DateDto(2026, 6));
        Assert.Equal(Math.Round(game.Index.NetIncome(game.Player.Value, june - 2, june), 2), q2.GetProperty("amount").GetDecimal());
        Assert.Equal(3, q2.GetProperty("months").GetInt32());
        Assert.Equal(1, q2.GetProperty("priority").GetInt32());
        // Ordering: the quarter close precedes the month close of the same month.
        var juneClose = events.FindIndex(e => Kind(e) == "monthClosed" && e.GetProperty("month").GetProperty("month").GetInt32() == 6);
        Assert.True(events.IndexOf(q2) < juneClose);

        var news = events.Where(e => Kind(e) == "news").ToList();
        Assert.NotEmpty(news);
        var ids = bridge.World.Catalog.Events.Select(e => e.Id).ToHashSet();
        Assert.All(news, n => Assert.Contains(n.GetProperty("typeId").GetString()!, ids));
    }

    [Fact]
    public void Sold_out_and_overstocked_lines_warn_and_rearm()
    {
        var bridge = Bridge.Custom(seed: 6);
        var lean = bridge.Build("supermarket", "riverside", new { productId = "bread", price = 1.00, restockTarget = 1_000 });
        // Realistic restocking caps a line's stock at StockCapMonths (1.5) of the store's throughput (E1),
        // so a big target alone no longer overstocks: the line must also barely sell — bread at $5.
        var heavy = bridge.Build("supermarket", "hilltown", new { productId = "bread", price = 5.00, restockTarget = 3_000_000 });
        var months = new List<List<JsonElement>>();
        for (var m = 0; m < 8; m++) months.Add(Events(bridge.Advance(1)));

        var stockouts = months.Select(ev => ev.Where(e => Kind(e) == "stockout" && e.GetProperty("buildingId").GetInt32() == lean).ToList()).ToList();
        Assert.Single(stockouts[0]);
        var first = stockouts[0][0];
        Assert.Equal("bread", first.GetProperty("productId").GetString());
        Assert.Equal(2, first.GetProperty("priority").GetInt32());
        Assert.True(first.GetProperty("units").GetDouble() > 0);
        Assert.All(stockouts.Skip(1).Take(5), Assert.Empty); // re-armed after 6 months
        Assert.Single(stockouts[6]);

        var overstock = months.SelectMany(ev => ev.Where(e => Kind(e) == "overstock")).ToList();
        var line = Assert.Single(overstock); // once per line per 12 months
        Assert.Equal(heavy, line.GetProperty("buildingId").GetInt32());
        Assert.True(line.GetProperty("months").GetInt32() >= 3);
        Assert.True(line.GetProperty("units").GetDouble() > 0);
        Assert.DoesNotContain(overstock, e => e.GetProperty("buildingId").GetInt32() == lean);

        // The latches survive a save/load: nothing re-fires right after loading.
        var data = bridge.Call("saveGame").GetProperty("data").GetString()!;
        var loaded = Bridge.Init();
        loaded.Call("loadGame", new { data });
        Assert.DoesNotContain(Events(loaded.Advance(1)), e => Kind(e) is "overstock");
    }

    [Fact]
    public void Losing_the_top_seller_spot_is_reported()
    {
        var bridge = Bridge.Custom(seed: 6, playerCash: 50_000_000m, ("Discounter", "simple"));
        var script = new ScriptedStrategy();
        var rival = new CompanyId(2);
        bridge.World.RegisterAi(rival, script);
        bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.00, restockTarget = 50_000 });
        Assert.DoesNotContain(Events(bridge.Advance(1)), e => Kind(e) == "marketLeaderLost");

        script.Months.Enqueue(new AiAction[] { new BuildRetailerAction(new BuildingTypeId("supermarket"), new CityId("riverside"), new ProductId("bread"), 1.50m, 400_000) });
        var events = Events(bridge.Advance(2));
        var lost = Assert.Single(events, e => Kind(e) == "marketLeaderLost");
        Assert.Equal(2, lost.GetProperty("companyId").GetInt32());
        Assert.Equal("riverside", lost.GetProperty("cityId").GetString());
        Assert.True(lost.GetProperty("newValue").GetDecimal() < lost.GetProperty("oldValue").GetDecimal());
    }

    [Fact]
    public void Cash_back_above_zero_and_starved_producers_are_detected()
    {
        var bridge = Bridge.Custom(seed: 6);
        var factory = bridge.Build("factory_small", "riverside", new { productId = "flour" });
        var game = bridge.Session.Game;
        var detector = new EventDetector();
        var before = detector.Before(game.World, game.Player);
        before.PlayerCash = -250_000m; // last month ended in the red
        var events = detector.AfterTick(game.World, game.Player, game.Index, before, game.Now, game.StartMonth, 1_000_000m, null, _ => 0.1);

        var recovered = Assert.Single(events, e => e.Kind == EventKinds.CashRecovered);
        Assert.Equal(-250_000m, recovered.OldValue);
        Assert.Equal(2, recovered.Priority);

        var shortage = Assert.Single(events, e => e.Kind == EventKinds.InputShortage);
        Assert.Equal(factory, shortage.BuildingId);
        var recipe = game.World.Catalog.Product(new ProductId("flour")).Recipe!;
        Assert.Contains(shortage.ProductId, recipe.Inputs.Select(i => i.ProductId.Value));
        // Re-armed only after six months; never at full utilisation.
        Assert.DoesNotContain(detector.AfterTick(game.World, game.Player, game.Index, before, game.Now, game.StartMonth, 1_000_000m, null, _ => 0.1), e => e.Kind == EventKinds.InputShortage);
        Assert.DoesNotContain(new EventDetector().AfterTick(game.World, game.Player, game.Index, before, game.Now, game.StartMonth, 1_000_000m, null, _ => 1.0), e => e.Kind == EventKinds.InputShortage);
    }

    [Fact]
    public void The_kind_taxonomy_is_the_protocol_union_and_every_kind_reaches_the_audio_router()
    {
        // bridge-spec §7.1: EventKinds (C#) == GameEventKind (protocol.ts); the audio router
        // (audio-events.json, audio-plan §4.12) has an entry for every kind the bridge can emit.
        var web = System.IO.Path.Combine(System.IO.Directory.GetParent(TestContent.Root)!.FullName, "web", "src");
        var protocol = System.IO.File.ReadAllText(System.IO.Path.Combine(web, "bridge", "protocol.ts"));
        var start = protocol.IndexOf("export type GameEventKind =", StringComparison.Ordinal);
        Assert.True(start >= 0);
        var lines = protocol[start..].Split('\n');
        var last = Array.FindIndex(lines, l => !l.TrimStart().StartsWith("//", StringComparison.Ordinal) && l.TrimEnd().EndsWith(';'));
        var union = lines.Take(last + 1)
            .Where(l => !l.TrimStart().StartsWith("//", StringComparison.Ordinal))
            .SelectMany(l => System.Text.RegularExpressions.Regex.Matches(l, "'(\\w+)'").Select(m => m.Groups[1].Value))
            .ToHashSet(StringComparer.Ordinal);

        var constants = typeof(EventKinds).GetFields()
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .Where(v => v is not (EventKinds.Info or EventKinds.Success or EventKinds.Warning or EventKinds.Danger))
            .ToHashSet(StringComparer.Ordinal);
        Assert.Equal(constants.OrderBy(k => k, StringComparer.Ordinal), union.OrderBy(k => k, StringComparer.Ordinal));
        Assert.Contains(EventKinds.Insolvency, union);

        using var audio = JsonDocument.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(web, "audio", "data", "audio-events.json")));
        var routed = audio.RootElement.GetProperty("events").EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        // insolvency (E2 finance) has no router entry yet: routed by the audio team (b2-bridge status, Requests).
        var unrouted = union.Where(k => !routed.Contains(k) && k != EventKinds.Insolvency).OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.True(unrouted.Count == 0, "kinds without an audio-events.json entry: " + string.Join(", ", unrouted));
    }
}
