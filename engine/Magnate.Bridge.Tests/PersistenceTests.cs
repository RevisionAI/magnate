using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Magnate.Engine.Persistence;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Web saves: envelope + sidecar, binary entry points, legacy import, validation (GameSession.Persistence.cs, Persistence/WebSave.cs, bridge-spec §6.3).</summary>
public class PersistenceTests
{
    /// <summary>A game with something in every sidecar section: history, latched goals, feed, a chosen plot, settings, latches.</summary>
    private static Bridge Played()
    {
        // One store with two lines: the tutorial's starting cash buys one at any content calibration.
        var bridge = Bridge.Game("tutorial", seed: 13);
        var store = bridge.Build("supermarket", "hilltown", new { productId = "soft_drink", price = 2.2, restockTarget = 40_000 }, new { px = 7, pz = 7, rotation = 180 });
        bridge.Call("configureSlot", new { buildingId = store, slotIndex = 1, productId = "bread", price = 3.1, restockTarget = 30_000 });
        bridge.Call("setAdCampaign", new { productId = "soft_drink", cityId = "hilltown", channel = "tv", monthlyBudget = 30_000 });
        bridge.Call("updateSettings", new { lowCashThreshold = 2_500_000, autosaveEveryMonths = 6 });
        bridge.Advance(4);
        return bridge;
    }

    private static byte[] Decompress(byte[] gzip)
    {
        using var input = new GZipStream(new MemoryStream(gzip), CompressionMode.Decompress);
        using var output = new MemoryStream();
        input.CopyTo(output);
        return output.ToArray();
    }

    private static string Save(Bridge bridge) => bridge.Call("saveGame").GetProperty("data").GetString()!;

    private static Bridge Load(string data)
    {
        var bridge = Bridge.Init();
        bridge.Call("loadGame", new { data });
        return bridge;
    }

    /// <summary>The JSON of a result without its top-level <c>revision</c>: that belongs to the session, not the game.</summary>
    private static string Strip(JsonElement result)
    {
        var node = JsonNode.Parse(result.GetRawText())!;
        if (node is JsonObject obj) obj.Remove("revision");
        return node.ToJsonString();
    }

    [Fact]
    public void A_web_save_restores_the_whole_bridge_state()
    {
        var original = Played();
        var data = Save(original);
        using (var doc = JsonDocument.Parse(data))
        {
            var root = doc.RootElement;
            Assert.Equal("magnate.websave", root.GetProperty("format").GetString());
            Assert.Equal(1, root.GetProperty("formatVersion").GetInt32());
            Assert.Equal(original.Session.ContentHash, root.GetProperty("contentHash").GetString());
            Assert.Equal(WorldSaver.SchemaVersion, root.GetProperty("engine").GetProperty("schemaVersion").GetInt32());
            var bridgeSection = root.GetProperty("bridge");
            Assert.Equal(13, bridgeSection.GetProperty("seed").GetInt32());
            Assert.Equal("bridge", bridgeSection.GetProperty("placement").GetProperty("1").GetProperty("source").GetString());
        }

        var loaded = Load(data);
        Assert.Equal(Strip(original.Call("snapshot")), Strip(loaded.Call("snapshot")));
        foreach (var (method, args) in new (string, object?)[]
        {
            ("goals", null), ("history", new { series = Array.Empty<string>(), companyIds = new[] { 1, 2 } }),
            ("activityFeed", new { limit = 1000 }), ("settings", null), ("buildings", new { }), ("cityView", new { cityId = "hilltown" }),
            ("incomeStatement", new { period = new { preset = "sinceStart" } }), ("adCampaigns", null), ("companies", null),
        })
        {
            Assert.Equal(Strip(original.Envelope(method, args).GetProperty("result")), Strip(loaded.Envelope(method, args).GetProperty("result")));
        }

        // Latches survive: nothing that already fired fires again after the load.
        var next = loaded.Advance(1).GetProperty("events").EnumerateArray().Select(e => e.GetProperty("kind").GetString()).ToList();
        Assert.DoesNotContain("firstSale", next);
        Assert.DoesNotContain("goalAchieved", next);
        Assert.Equal(original.Advance(1).GetProperty("snapshot").GetProperty("player").GetProperty("cash").GetDecimal(),
            loaded.Call("snapshot").GetProperty("player").GetProperty("cash").GetDecimal());
    }

    [Fact]
    public void Same_seed_same_commands_same_bytes()
    {
        static string Script()
        {
            var bridge = Bridge.Game("soft_drink_war", seed: 99);
            bridge.Supermarket("soft_drink", 2.4m, 70_000);
            bridge.Build("factory_small", "riverside", new { productId = "flour" });
            bridge.Advance(6);
            return Save(bridge);
        }
        Assert.Equal(Script(), Script());
    }

    /// <summary>
    /// Save → load → continue is indistinguishable from never saving (engine RNG streams persist
    /// since schema v10, the sidecar carries the bridge's latches): a rival market with news runs a
    /// year, is saved and reloaded through the binary path, and both copies play two more years.
    /// </summary>
    [Fact]
    public void Continuing_after_a_binary_load_matches_never_saving()
    {
        var original = Bridge.Game("four_archetype_melee", seed: 21, autopilot: "adaptive");
        original.Advance(12);
        var bytes = original.Session.SaveBinary("{\"slotKind\":\"manual\",\"createdAtIso\":\"2026-10-01T00:00:00Z\"}");
        var loaded = Bridge.Init();
        Assert.True(Envelope(loaded.Session.LoadBinary(bytes, "{}")).TryGetProperty("gameId", out _));
        loaded.Call("setAutopilot", new { strategy = "adaptive" });
        original.Call("setAutopilot", new { strategy = "adaptive" });

        for (var i = 0; i < 24; i++)
        {
            Assert.Equal(Strip(original.Advance(1).GetProperty("snapshot")), Strip(loaded.Advance(1).GetProperty("snapshot")));
        }
        foreach (var (method, args) in new (string, object?)[]
        {
            ("news", new { limit = 500 }), ("activityFeed", new { limit = 1000 }), ("companies", null),
            ("history", new { series = Array.Empty<string>() }),
        })
        {
            Assert.Equal(Strip(original.Call(method, args)), Strip(loaded.Call(method, args)));
        }
        // The saves agree byte for byte except the command journal's session revisions (a
        // revision counts calls in one session, so the loaded session's are lower).
        static string WithoutJournalRevisions(string save)
        {
            var root = JsonNode.Parse(save)!;
            foreach (var entry in root["bridge"]!["journal"]?.AsArray() ?? new JsonArray()) entry!.AsObject().Remove("revision");
            return root.ToJsonString();
        }
        Assert.Equal(WithoutJournalRevisions(Save(original)), WithoutJournalRevisions(Save(loaded)));
    }

    [Fact]
    public void Binary_saves_are_gzip_and_round_trip_through_the_js_exports()
    {
        var original = Played();
        var bytes = original.Session.SaveBinary("{\"slotKind\":\"quicksave\",\"label\":\"  Before the war  \",\"createdAtIso\":\"2026-10-01T12:00:00Z\"}");
        Assert.Equal(0x1F, bytes[0]);
        Assert.Equal(0x8B, bytes[1]);
        using (var gzip = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8))
        {
            using var doc = JsonDocument.Parse(reader.ReadToEnd());
            var meta = doc.RootElement.GetProperty("meta");
            Assert.Equal("quicksave", meta.GetProperty("slotKind").GetString());
            Assert.Equal("Before the war", meta.GetProperty("label").GetString());
            Assert.Equal("Your Corp", meta.GetProperty("companyName").GetString());
            Assert.Equal(original.Call("goals").GetProperty("goals").GetArrayLength(), meta.GetProperty("goalsTotal").GetInt32());
            Assert.Equal(4, meta.GetProperty("elapsedMonths").GetInt32());
            var capital = original.World.Ledger.Entries.First(e => e.Category == Magnate.Engine.Economics.LedgerCategory.StartingCapital && e.Company.Value == 1).Amount;
            Assert.Equal(capital, meta.GetProperty("startingCapital").GetDecimal());
            Assert.Contains(meta.GetProperty("buildingsByCategory").EnumerateArray(), c => c.GetProperty("id").GetString() == "supermarket" && c.GetProperty("count").GetInt32() == 1);
        }

        var inspect = Envelope(TestContent.NewSession().InspectSave(bytes));
        Assert.True(inspect.GetProperty("loadable").GetBoolean());
        Assert.Equal(bytes.Length, inspect.GetProperty("meta").GetProperty("compressedBytes").GetInt64());
        Assert.True(inspect.GetProperty("meta").GetProperty("rawBytes").GetInt64() > bytes.Length);

        var session = TestContent.NewSession();
        var loaded = Envelope(session.LoadBinary(bytes, "{}"));
        Assert.Equal(original.Call("snapshot").GetProperty("gameId").GetString(), loaded.GetProperty("gameId").GetString());
        var meta2 = Envelope(session.SaveMeta("{\"slotKind\":\"autosave\"}"));
        Assert.Equal("autosave", meta2.GetProperty("slotKind").GetString());
        Assert.True(meta2.GetProperty("compressedBytes").GetInt64() > 0);

        var wrong = JsonDocument.Parse(session.LoadBinary(bytes, "{\"expectedGameId\":\"0000\"}")).RootElement;
        Assert.Equal(BridgeErrorCodes.InvalidArgument, wrong.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public void The_client_document_travels_inside_the_save_and_comes_back_from_inspect()
    {
        var original = Played();
        const string client = "{\"version\":1,\"tutorial\":{\"step\":3},\"thumbnail\":\"data:image/webp;base64,AAAA\",\"playTimeSec\":321}";
        var args = JsonSerializer.Serialize(new { slotKind = "manual", client }, Bridge.Json);
        var bytes = original.Session.SaveBinary(args);
        Assert.NotEmpty(bytes);

        // The metadata of that exact save is handed back without a second serialization.
        var meta = JsonDocument.Parse(original.Session.LastSaveMetaJson!).RootElement;
        Assert.Equal(bytes.Length, meta.GetProperty("compressedBytes").GetInt64());
        Assert.True(meta.GetProperty("rawBytes").GetInt64() > bytes.Length);
        Assert.Equal("manual", meta.GetProperty("slotKind").GetString());

        var inspect = Envelope(TestContent.NewSession().InspectSave(bytes));
        Assert.Equal(client, inspect.GetProperty("client").GetString());
        Assert.False(inspect.GetProperty("contentChanged").GetBoolean());

        // Saving again without a client document leaves the field out; loading ignores it either way.
        var plain = original.Session.SaveBinary("{}");
        Assert.False(Envelope(TestContent.NewSession().InspectSave(plain)).TryGetProperty("client", out _));
        Assert.True(JsonDocument.Parse(TestContent.NewSession().LoadBinary(bytes, "{}")).RootElement.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public void Client_documents_must_be_json_and_bounded()
    {
        var bridge = Bridge.Game();
        Assert.Empty(bridge.Session.SaveBinary(JsonSerializer.Serialize(new { client = "{not json" }, Bridge.Json)));
        var error = JsonDocument.Parse(bridge.Session.LastErrorJson!).RootElement.GetProperty("error");
        Assert.Equal(BridgeErrorCodes.InvalidArgument, error.GetProperty("code").GetString());
        Assert.Equal("client", error.GetProperty("field").GetString());
        Assert.Null(bridge.Session.LastSaveMetaJson);

        var huge = "\"" + new string('x', SaveArgs.MaxClientBytes) + "\"";
        Assert.Empty(bridge.Session.SaveBinary(JsonSerializer.Serialize(new { client = huge }, Bridge.Json)));
        Assert.Equal("client", JsonDocument.Parse(bridge.Session.LastErrorJson!).RootElement.GetProperty("error").GetProperty("field").GetString());

        var malformed = bridge.Fail("saveGame", "{\"slotKind\":7}");
        Assert.Equal(BridgeErrorCodes.BadRequest, malformed.Code);
    }

    [Fact]
    public void Inspect_flags_saves_written_against_other_content_without_refusing_them()
    {
        var data = Save(Played());
        var node = JsonNode.Parse(data)!.AsObject();
        node["contentHash"] = "0123456789abcdef";
        var inspect = Envelope(TestContent.NewSession().InspectSave(Encoding.UTF8.GetBytes(node.ToJsonString())));
        Assert.True(inspect.GetProperty("contentChanged").GetBoolean());
        Assert.True(inspect.GetProperty("loadable").GetBoolean());
    }

    [Fact]
    public void The_engine_part_of_a_web_save_is_compact()
    {
        var data = Save(Played());
        using var doc = JsonDocument.Parse(data);
        var engine = doc.RootElement.GetProperty("engine").GetRawText();
        Assert.DoesNotContain("\n", engine, StringComparison.Ordinal);
        Assert.DoesNotContain(": ", engine, StringComparison.Ordinal);
    }

    [Fact]
    public void Autosaves_reset_the_cadence_and_land_in_the_feed()
    {
        var bridge = Bridge.Game("tutorial", seed: 13);
        bridge.Call("updateSettings", new { autosaveEveryMonths = 2 });
        bridge.Advance(1);
        Assert.True(bridge.Advance(1).GetProperty("autosaveDue").GetBoolean());
        Assert.NotEmpty(bridge.Session.SaveBinary("{\"slotKind\":\"autosave\"}"));
        Assert.False(bridge.Advance(1).GetProperty("autosaveDue").GetBoolean());
        Assert.Single(bridge.Call("activityFeed", new { kinds = new[] { "autosaved" } }).GetProperty("events").EnumerateArray());
    }

    [Fact]
    public void A_failed_binary_save_reports_through_last_error()
    {
        var session = TestContent.NewSession();
        Assert.Empty(session.SaveBinary("{}"));
        var error = JsonDocument.Parse(session.LastErrorJson!).RootElement;
        Assert.Equal(BridgeErrorCodes.NoGame, error.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public void Legacy_engine_saves_load_with_history_backfilled_from_the_ledger()
    {
        var original = Played();
        var legacy = original.Call("exportEngineJson").GetProperty("json").GetString()!;
        Assert.StartsWith("{", legacy.TrimStart(), StringComparison.Ordinal);

        var loaded = Load(legacy);
        var snapshot = loaded.Call("snapshot");
        Assert.Equal("tutorial", snapshot.GetProperty("scenario").GetProperty("id").GetString());
        Assert.Equal(original.Cash(), snapshot.GetProperty("player").GetProperty("cash").GetDecimal());

        var history = loaded.Call("history", new { series = new[] { "cash", "revenue", "netIncome", "corporateValue" } }).GetProperty("companies")[0];
        var expected = original.Call("history", new { series = new[] { "cash", "revenue", "netIncome" } }).GetProperty("companies")[0].GetProperty("series");
        foreach (var name in new[] { "cash", "revenue", "netIncome" })
        {
            var got = history.GetProperty("series").GetProperty(name).EnumerateArray().Select(v => v.GetDecimal()).ToList();
            var want = expected.GetProperty(name).EnumerateArray().Select(v => v.GetDecimal()).ToList();
            // The start-month row differs (the sidecar recorded the pre-construction state, the ledger
            // shows the month's net); every closed month is exact.
            Assert.Equal(want.Skip(1), got.Skip(1));
        }
        var cv = history.GetProperty("series").GetProperty("corporateValue").EnumerateArray().ToList();
        Assert.All(cv.Take(cv.Count - 1), v => Assert.Equal(JsonValueKind.Null, v.ValueKind));
        Assert.Equal(new DateDto(2026, 5), JsonSerializer.Deserialize<DateDto>(history.GetProperty("missingBefore").GetProperty("corporateValue").GetRawText(), Bridge.Json));
        Assert.False(history.GetProperty("missingBefore").TryGetProperty("cash", out _));

        // Milestones already passed are primed, not re-fired; placements are re-sited automatically.
        Assert.DoesNotContain(loaded.Advance(1).GetProperty("events").EnumerateArray(), e => e.GetProperty("kind").GetString() == "firstSale");
        Assert.All(loaded.Call("buildings", new { ownerId = 1 }).EnumerateArray(), b => Assert.Equal("auto", b.GetProperty("placement").GetProperty("source").GetString()));
    }

    [Fact]
    public void Saves_naming_missing_content_are_refused_before_the_world_changes()
    {
        var original = Played();
        // A hand-edited save (its content hash still the installed one) naming a product this install lacks.
        var data = System.Text.RegularExpressions.Regex.Replace(Save(original), "\"productId\":\\s*\"bread\"", "\"productId\": \"nope\"");
        var bridge = Bridge.Game("sandbox", seed: 2);
        var before = bridge.Call("snapshot").GetProperty("gameId").GetString();
        var error = bridge.Fail("loadGame", new { data });
        Assert.Equal(BridgeErrorCodes.SaveContentMismatch, error.Code);
        Assert.Equal("[\"product:nope\"]", error.Details.GetProperty("missing").GetRawText());
        Assert.Equal(before, bridge.Call("snapshot").GetProperty("gameId").GetString()); // the previous game stays

        var inspect = Envelope(TestContent.NewSession().InspectSave(Encoding.UTF8.GetBytes(data)));
        Assert.False(inspect.GetProperty("loadable").GetBoolean());
        Assert.Equal(BridgeErrorCodes.SaveContentMismatch, inspect.GetProperty("problem").GetString());
    }

    [Theory]
    [InlineData("{\"format\":\"magnate.websave\",\"formatVersion\":99,\"engine\":{}}", BridgeErrorCodes.SaveVersionUnsupported)]
    [InlineData("{\"schemaVersion\":999}", BridgeErrorCodes.SaveVersionUnsupported)]
    [InlineData("{\"schemaVersion\":0}", BridgeErrorCodes.SaveVersionUnsupported)]
    [InlineData("{\"format\":\"magnate.websave\",\"formatVersion\":1}", BridgeErrorCodes.SaveCorrupt)]
    [InlineData("{\"hello\":\"world\"}", BridgeErrorCodes.SaveCorrupt)]
    [InlineData("[1,2,3]", BridgeErrorCodes.SaveCorrupt)]
    [InlineData("this is not json", BridgeErrorCodes.SaveCorrupt)]
    public void Unreadable_saves_get_typed_errors(string data, string code)
    {
        var bridge = Bridge.Init();
        var error = bridge.Fail("loadGame", new { data });
        Assert.Equal(code, error.Code);
        if (code == BridgeErrorCodes.SaveVersionUnsupported)
        {
            Assert.NotNull(error.Detail("schemaVersion"));
            Assert.NotNull(error.Detail("maxSchemaVersion"));
        }
    }

    [Fact]
    public void Corrupt_binaries_are_save_corrupt()
    {
        var session = TestContent.NewSession();
        Assert.Equal(BridgeErrorCodes.SaveCorrupt, Code(session.LoadBinary(new byte[] { 0x1F, 0x8B, 1, 2, 3, 4 }, "{}")));
        Assert.Equal(BridgeErrorCodes.SaveCorrupt, Code(session.LoadBinary(Array.Empty<byte>(), "{}")));
        Assert.Equal(BridgeErrorCodes.SaveCorrupt, Code(session.InspectSave(new byte[] { 0x1F, 0x8B, 0, 0 })));
        Assert.Equal(BridgeErrorCodes.NotInitialized, Code(new GameSession().LoadBinary(new byte[] { 1 }, "{}")));
    }

    [Fact]
    public void A_custom_game_round_trips_its_definition()
    {
        var bridge = Bridge.Custom(seed: 4, playerCash: 12_000_000m, ("Alpha", "tech"));
        bridge.Advance(2);
        var loaded = Load(Save(bridge));
        var snapshot = loaded.Call("snapshot");
        Assert.Equal("custom", snapshot.GetProperty("scenario").GetProperty("id").GetString());
        Assert.Equal("techLeader", snapshot.GetProperty("companies")[1].GetProperty("aiStrategy").GetString());
        Assert.Equal(new DateDto(2026, 1), JsonSerializer.Deserialize<DateDto>(snapshot.GetProperty("startDate").GetRawText(), Bridge.Json));
        loaded.Advance(1);
    }

    private static JsonElement Envelope(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.GetProperty("ok").GetBoolean(), json);
        return doc.RootElement.GetProperty("result").Clone();
    }

    private static string Code(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.False(doc.RootElement.GetProperty("ok").GetBoolean(), json);
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString()!;
    }

    [Fact]
    public void Binary_save_and_load_report_their_phases_in_debug_stats()
    {
        var original = Bridge.Game("tutorial", seed: 5);
        original.Advance(2);
        var bytes = original.Session.SaveBinary("{\"slotKind\":\"manual\"}");
        var save = original.Call("debugStats").GetProperty("lastSavePhasesMs");
        Assert.Equal(new[] { "engine", "envelope", "gzip", "meta", "sidecar" }, save.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(save.EnumerateObject(), p => Assert.True(p.Value.GetDouble() >= 0));

        var loaded = Bridge.Init();
        Envelope(loaded.Session.LoadBinary(bytes, "{}"));
        var load = loaded.Call("debugStats").GetProperty("lastLoadPhasesMs");
        Assert.Equal(new[] { "engine", "gunzip", "install", "scan", "sidecar", "snapshot" }, load.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void Trusted_loads_skip_the_content_scan_only_for_the_installed_content()
    {
        var original = Played();
        var expected = Strip(original.Call("snapshot"));
        var bytes = original.Session.SaveBinary("{\"slotKind\":\"manual\"}");
        const string trusted = "{\"trustContent\":true}";

        var loaded = Bridge.Init();
        Envelope(loaded.Session.LoadBinary(bytes, trusted));
        Assert.Equal(expected, Strip(loaded.Call("snapshot")));

        // Written against other content: even a trusted load scans and names what is missing.
        var json = Encoding.UTF8.GetString(Decompress(bytes));
        var other = System.Text.RegularExpressions.Regex.Replace(json, "\"contentHash\":\"[0-9a-f]+\"", "\"contentHash\":\"other-content\"");
        other = System.Text.RegularExpressions.Regex.Replace(other, "\"productId\":\\s*\"bread\"", "\"productId\": \"nope\"");
        var refused = JsonDocument.Parse(Bridge.Init().Session.LoadBinary(Encoding.UTF8.GetBytes(other), trusted)).RootElement;
        Assert.False(refused.GetProperty("ok").GetBoolean());
        Assert.Equal(BridgeErrorCodes.SaveContentMismatch, refused.GetProperty("error").GetProperty("code").GetString());

        // A truncated trusted save is corrupt, not a crash, and the previous game stays.
        var bridge = Bridge.Game("sandbox", seed: 2);
        var before = bridge.Call("snapshot").GetProperty("gameId").GetString();
        var truncated = JsonDocument.Parse(bridge.Session.LoadBinary(Encoding.UTF8.GetBytes(json[..^40]), trusted)).RootElement;
        Assert.Equal(BridgeErrorCodes.SaveCorrupt, truncated.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(before, bridge.Call("snapshot").GetProperty("gameId").GetString());
    }

    [Fact]
    public void Envelopes_put_the_engine_last_and_older_member_orders_still_load()
    {
        var original = Played();
        var data = Save(original);
        var root = JsonNode.Parse(data)!.AsObject();
        Assert.Equal("engine", root.Select(kv => kv.Key).Last());
        Assert.True(root["engineLast"]!.GetValue<bool>());
        var expected = Strip(original.Call("snapshot"));

        // Wave-1 layout (engine between meta and bridge, no engineLast): scanned, and trusted (skipped over).
        var wave1 = new JsonObject
        {
            ["format"] = root["format"]!.DeepClone(),
            ["formatVersion"] = root["formatVersion"]!.DeepClone(),
            ["contentHash"] = root["contentHash"]!.DeepClone(),
            ["meta"] = root["meta"]!.DeepClone(),
            ["engine"] = root["engine"]!.DeepClone(),
            ["bridge"] = root["bridge"]!.DeepClone(),
        }.ToJsonString();
        Assert.Equal(expected, Strip(Load(wave1).Call("snapshot")));
        var trusted = Bridge.Init();
        Envelope(trusted.Session.LoadBinary(Encoding.UTF8.GetBytes(wave1), "{\"trustContent\":true}"));
        Assert.Equal(expected, Strip(trusted.Call("snapshot")));
    }
}
