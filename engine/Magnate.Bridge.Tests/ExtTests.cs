using System;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Extension points (GameSession.Ext.cs, bridge-spec §8): registered from day one, <c>feature_unavailable</c> until their flag.</summary>
public class ExtTests
{
    [Theory]
    [InlineData("parcels", "{\"cityId\":\"metropolis\"}", "landMarket")]
    [InlineData("buyLand", "{\"cityId\":\"metropolis\",\"parcelId\":1}", "landMarket")]
    [InlineData("sellLand", "{\"cityId\":\"metropolis\",\"parcelId\":1}", "landMarket")]
    [InlineData("cancelConstruction", "{\"buildingId\":1}", "constructionTime")]
    [InlineData("stockMarket", "{}", "stockMarket")]
    [InlineData("holdings", "{}", "stockMarket")]
    [InlineData("ipo", "{\"shares\":1000000,\"price\":10}", "stockMarket")]
    [InlineData("issueShares", "{\"shares\":1000,\"price\":10}", "stockMarket")]
    [InlineData("buybackShares", "{\"shares\":1000}", "stockMarket")]
    [InlineData("tradeShares", "{\"companyId\":2,\"shares\":1000,\"side\":\"buy\"}", "stockMarket")]
    [InlineData("setDividend", "{\"perShareQuarterly\":0.1}", "stockMarket")]
    [InlineData("macro", "{}", "macro")]
    public void Extension_methods_answer_feature_unavailable(string method, string args, string feature)
    {
        // Once a flag is on, its methods belong to that workstream's tests (FinanceTests for loans, …).
        if (JsonSerializer.SerializeToElement(GameSession.Features, BridgeJson.Options).GetProperty(feature).GetBoolean()) return;
        var bridge = Bridge.Game("tutorial", seed: 1);
        var revision = bridge.Call("ping").GetProperty("revision").GetInt64();
        var error = bridge.Fail(method, args);
        Assert.Equal(BridgeErrorCodes.FeatureUnavailable, error.Code);
        Assert.Equal(feature, error.Detail("feature"));
        Assert.Equal(revision, error.Revision); // nothing happened, nothing to refetch
        Assert.False(bridge.Session.Faulted);
    }

    [Fact]
    public void Extension_methods_still_need_a_game_first()
    {
        Assert.Equal(BridgeErrorCodes.NoGame, Bridge.Init().Fail("loans").Code);
    }

    [Fact]
    public void Feature_flags_are_the_sessions_switches()
    {
        var features = Bridge.Init().Call("init", new { contentRoot = TestContent.Root }).GetProperty("features");
        Assert.Equal(
            new[] { "constructionTime", "demandModel", "demolish", "domainEvents", "landMarket", "loans", "macro", "plots", "productionLog", "stockMarket" },
            features.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
        // Each flag flips when its workstream's engine feature lands (demandModel: E1, loans/demolish: E2, …);
        // the methods of a flag that is off answer feature_unavailable (the theory above).
        var expected = JsonSerializer.SerializeToElement(GameSession.Features, BridgeJson.Options);
        Assert.All(features.EnumerateObject(), p => Assert.Equal(expected.GetProperty(p.Name).GetBoolean(), p.Value.GetBoolean()));
    }

    [Fact]
    public void City_layout_belongs_to_the_city_generator_workstream()
    {
        // GameSession.CityLayout.cs (E3a) registers it; registering it here as well would make handler discovery throw.
        var registered = GameSession.MethodNames.Contains("cityLayout");
        var fileExists = System.IO.File.Exists(System.IO.Path.Combine(
            System.IO.Directory.GetParent(TestContent.Root)!.FullName, "engine", "Magnate.Bridge", "GameSession.CityLayout.cs"));
        Assert.Equal(fileExists, registered);
    }

    [Fact]
    public void Reserved_fields_stay_off_the_wire_while_their_features_are_off()
    {
        var bridge = Bridge.Game("tutorial", seed: 1);
        var store = bridge.Supermarket();
        Assert.False(bridge.Call("building", new { buildingId = store }).TryGetProperty("construction", out _));
        Assert.False(bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" }).TryGetProperty("catchment", out _));
        Assert.False(bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" }).TryGetProperty("constructionMonths", out _));
        Assert.False(bridge.Call("cityView", new { cityId = "metropolis" }).TryGetProperty("layout", out _));
        Assert.False(bridge.Call("snapshot").TryGetProperty("macro", out _));
        Assert.False(bridge.Call("snapshot").GetProperty("companies")[0].TryGetProperty("marketCap", out _));
        // Finance fields (E2) are on the wire under Realistic rules; LoanTests.Classic_rules_have_no_bank covers Classic.
        Assert.Equal("NR", bridge.Call("snapshot").GetProperty("player").GetProperty("creditRating").GetString());
        var sheet = bridge.Call("balanceSheet", new { });
        Assert.True(sheet.TryGetProperty("landValue", out _));
        Assert.True(sheet.TryGetProperty("liabilityLines", out _));
        Assert.False(bridge.Call("worldMap").GetProperty("cities")[0].TryGetProperty("climate", out _));
    }
}

/// <summary>Developer surface (GameSession.Dev.cs, bridge-spec §5.13).</summary>
public class DevTests
{
    [Fact]
    public void Debug_stats_work_with_and_without_a_game()
    {
        var bridge = Bridge.Init();
        var empty = bridge.Call("debugStats");
        Assert.Equal(0, empty.GetProperty("ledgerEntries").GetInt32());
        Assert.Equal("1", empty.GetProperty("protocolVersion").GetString());

        bridge.Call("newGame", new { scenarioId = "tutorial", seed = 4 });
        bridge.Supermarket();
        bridge.Advance(2);
        var stats = bridge.Call("debugStats");
        Assert.Equal(bridge.World.Ledger.Entries.Count, stats.GetProperty("ledgerEntries").GetInt32());
        Assert.Equal(bridge.World.CogsLog.Entries.Count, stats.GetProperty("cogsEntries").GetInt32());
        Assert.Equal(bridge.World.Buildings.Count, stats.GetProperty("buildings").GetInt32());
        Assert.Equal(2, stats.GetProperty("companies").GetInt32());
        Assert.True(stats.GetProperty("lastTickMs").GetDouble() > 0);
        Assert.True(stats.GetProperty("lastBridgeMs").GetDouble() >= 0);
        Assert.Equal(bridge.Revision, stats.GetProperty("revision").GetInt64());
        Assert.False(stats.GetProperty("faulted").GetBoolean());

        // The last advance's facade time, split by phase (dev overlay).
        Assert.False(empty.TryGetProperty("lastAdvancePhasesMs", out _));
        var phases = stats.GetProperty("lastAdvancePhasesMs");
        foreach (var phase in new[] { "capture", "index", "placement", "history", "events", "goals", "snapshot", "activity" })
        {
            Assert.True(phases.GetProperty(phase).GetDouble() >= 0, phase);
        }
    }

    [Fact]
    public void The_engine_save_export_is_the_legacy_format()
    {
        var bridge = Bridge.Game("tutorial", seed: 4);
        var json = bridge.Call("exportEngineJson").GetProperty("json").GetString()!;
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal(Magnate.Engine.Persistence.WorldSaver.SchemaVersion, doc.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("tutorial", doc.RootElement.GetProperty("scenarioId").GetString());
    }
}
