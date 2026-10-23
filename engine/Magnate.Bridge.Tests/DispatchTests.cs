using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Envelope, error model and dispatch pipeline (GameSession.cs, bridge-spec §4.3, §4.7, §5.0).</summary>
public class DispatchTests
{
    [Fact]
    public void Unknown_method_is_a_structured_error_and_does_not_bump_the_revision()
    {
        var bridge = Bridge.Init();
        var before = bridge.Envelope("ping").GetProperty("revision").GetInt64();
        var error = bridge.Fail("noSuchMethod");
        Assert.Equal(BridgeErrorCodes.UnknownMethod, error.Code);
        Assert.Equal(before, error.Revision);
    }

    [Fact]
    public void Game_methods_require_a_game_and_content_requires_init()
    {
        Assert.Equal(BridgeErrorCodes.NoGame, Bridge.Init().Fail("snapshot").Code);
        Assert.Equal(BridgeErrorCodes.NotInitialized, new Bridge(new GameSession()).Fail("newGame", new { scenarioId = "tutorial" }).Code);
    }

    [Fact]
    public void Malformed_arguments_name_the_offending_field()
    {
        var bridge = Bridge.Game();
        var error = bridge.Fail("advance", "{\"months\":\"many\"}");
        Assert.Equal(BridgeErrorCodes.BadRequest, error.Code);
        Assert.Equal("months", error.Field);
        Assert.NotNull(error.Detail("devMessage"));

        var missing = bridge.Fail("construct", new { cityId = "metropolis" });
        Assert.Equal(BridgeErrorCodes.BadRequest, missing.Code);
        Assert.Equal("typeId", missing.Field);
    }

    [Fact]
    public void Revision_bumps_once_per_successful_mutation_and_never_for_queries_or_rejections()
    {
        var bridge = Bridge.Game();
        var r0 = bridge.Revision;
        bridge.Call("snapshot");
        Assert.Equal(r0, bridge.Revision);
        bridge.Call("buildings", new { });
        Assert.Equal(r0, bridge.Revision);

        bridge.Supermarket();
        Assert.Equal(r0 + 1, bridge.Revision);

        var rejected = bridge.Fail("construct", new { typeId = "oil_well", cityId = "hilltown" });
        Assert.Equal(BridgeErrorCodes.GeographyMismatch, rejected.Code);
        Assert.Equal(r0 + 1, rejected.Revision);

        bridge.Call("advance", new { months = 5 });
        Assert.Equal(r0 + 2, bridge.Revision);
    }

    [Fact]
    public void Mutating_envelopes_carry_the_hud_and_their_events_but_advance_embeds_them()
    {
        var bridge = Bridge.Game();
        bridge.Supermarket();
        var envelope = bridge.LastEnvelope;
        var hud = envelope.GetProperty("hud");
        Assert.Equal(envelope.GetProperty("revision").GetInt64(), hud.GetProperty("revision").GetInt64());
        Assert.Equal(1, hud.GetProperty("player").GetProperty("buildings").GetInt32());
        var events = bridge.EnvelopeEvents();
        Assert.Contains(events, e => e.GetProperty("kind").GetString() == "buildingConstructed");
        // The tutorial's first two goals latch on that construct.
        Assert.Contains(events, e => e.GetProperty("kind").GetString() == "goalAchieved");
        Assert.All(events, e => Assert.True(e.GetProperty("seq").GetInt64() > 0));

        bridge.Call("advance", new { months = 1 });
        Assert.False(bridge.LastEnvelope.TryGetProperty("hud", out _));
        Assert.False(bridge.LastEnvelope.TryGetProperty("events", out _));

        bridge.Call("snapshot");
        Assert.False(bridge.LastEnvelope.TryGetProperty("hud", out _));
    }

    [Fact]
    public void A_throwing_tick_faults_the_session_until_a_new_game()
    {
        var session = TestContent.NewSession();
        var world = new World(session.Catalog, 1, new GameDate(2026, 1));
        var player = world.CreateCompany("Player", 10_000_000m);
        var rival = world.CreateCompany("Saboteur", 10_000_000m);
        world.RegisterAi(rival.Id, new ThrowingStrategy());
        session.Attach(world, player.Id, null);
        var bridge = new Bridge(session);

        var error = bridge.Fail("advance", new { months = 3 });
        Assert.Equal(BridgeErrorCodes.TickFailed, error.Code);
        Assert.Contains("ThrowingStrategy", error.Detail("devMessage") ?? "", StringComparison.Ordinal);
        Assert.True(session.Faulted);

        Assert.Equal(BridgeErrorCodes.TickFailed, bridge.Fail("construct", new { typeId = "supermarket", cityId = "metropolis" }).Code);
        Assert.True(bridge.Call("snapshot").GetProperty("faulted").GetBoolean());

        bridge.Call("newGame", new { scenarioId = "sandbox" });
        Assert.False(session.Faulted);
        bridge.Call("advance", new { months = 1 });
    }

    [Fact]
    public void Release_surface_registers_no_debug_commands_besides_debugStats()
    {
        var debug = GameSession.MethodNames.Where(m => m.StartsWith("debug", StringComparison.Ordinal)).ToList();
        Assert.Equal(new[] { "debugStats" }, debug);
    }

    [Fact]
    public void Init_reports_features_content_hash_and_versions()
    {
        var bridge = Bridge.Init();
        var init = bridge.Call("init", new { contentRoot = TestContent.Root });
        Assert.Equal(GameSession.ProtocolVersion, init.GetProperty("protocolVersion").GetInt32());
        Assert.Matches("^[0-9a-f]{64}$", init.GetProperty("contentHash").GetString());
        // The session's switches as they stand (each flips when its workstream lands; ExtTests pins the set).
        var expected = JsonSerializer.SerializeToElement(GameSession.Features, BridgeJson.Options);
        Assert.All(init.GetProperty("features").EnumerateObject(), f => Assert.Equal(expected.GetProperty(f.Name).GetBoolean(), f.Value.GetBoolean()));
        Assert.Equal(Magnate.Engine.Persistence.WorldSaver.SchemaVersion, init.GetProperty("engineSchemaVersion").GetInt32());
        var methods = init.GetProperty("methods").EnumerateArray().Select(m => m.GetString()).ToList();
        Assert.Contains("cityView", methods);
        Assert.Contains("macro", methods);

        // Same content → same hash; the hash is stable across sessions.
        var again = Bridge.Init().Call("init", new { contentRoot = TestContent.Root });
        Assert.Equal(init.GetProperty("contentHash").GetString(), again.GetProperty("contentHash").GetString());

        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("init", new { contentRoot = "/no/such/folder" }).Code);
    }

    [Fact]
    public void Engine_exceptions_get_english_messages_and_dev_details()
    {
        var body = GameSession.ToErrorBody(new KeyNotFoundException("The given key 'x' was not present"));
        Assert.Equal(BridgeErrorCodes.NotFound, body.Code);
        Assert.DoesNotContain("'x'", body.Message, StringComparison.Ordinal);
        Assert.Contains("'x'", body.Details!.DevMessage!, StringComparison.Ordinal);

        Assert.Equal(BridgeErrorCodes.InvalidArgument, GameSession.ToErrorBody(new ArgumentOutOfRangeException("SlotIndex")).Code);
        Assert.Equal("slotIndex", GameSession.ToErrorBody(new ArgumentOutOfRangeException("SlotIndex")).Field);
        Assert.Equal(BridgeErrorCodes.InvalidOperation, GameSession.ToErrorBody(new InvalidOperationException("nope")).Code);
        Assert.Equal(BridgeErrorCodes.Internal, GameSession.ToErrorBody(new NullReferenceException()).Code);
    }

    private sealed class ThrowingStrategy : IAiStrategy
    {
        public IReadOnlyList<AiAction> Plan(World world, CompanyId actor) => throw new InvalidOperationException("ThrowingStrategy exploded");
    }
}

/// <summary>JSON conventions (bridge-spec §4.4): money rounding, finite doubles, source-generated metadata.</summary>
public class JsonConventionTests
{
    [Fact]
    public void Money_is_rounded_half_even_to_cents_and_unit_prices_to_four_places()
    {
        var json = JsonSerializer.Serialize(new PriceEffectDto("x", 1.234567m, 1, 0.123456m, 0.123449m), BridgeJson.Options);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(1.23m, doc.RootElement.GetProperty("multiplier").GetDecimal());
        Assert.Equal(0.1235m, doc.RootElement.GetProperty("basePrice").GetDecimal());
        Assert.Equal(0.1234m, doc.RootElement.GetProperty("effectivePrice").GetDecimal());

        var even = JsonSerializer.Serialize(new CashFlowLineDto("x", 0.125m), BridgeJson.Options);
        Assert.Contains("0.12", even, StringComparison.Ordinal);
    }

    [Fact]
    public void Non_finite_doubles_become_null()
    {
        var json = JsonSerializer.Serialize(new CompanyValueDto(1, double.NaN), BridgeJson.Options);
        Assert.Equal("{\"companyId\":1,\"value\":null}", json);
    }

    [Fact]
    public void Money_arguments_are_read_exactly_from_numbers_and_strings()
    {
        var args = JsonSerializer.Deserialize<SetRetailPriceArgs>("{\"buildingId\":1,\"slotIndex\":0,\"price\":1.8}", BridgeJson.Options)!;
        Assert.Equal(1.8m, args.Price);
        var text = JsonSerializer.Deserialize<SetRetailPriceArgs>("{\"buildingId\":1,\"slotIndex\":0,\"price\":\"2.05\"}", BridgeJson.Options)!;
        Assert.Equal(2.05m, text.Price);
    }
}

/// <summary>The source-generated metadata context stays complete (Protocol/BridgeJsonContext.cs).</summary>
public class BridgeJsonContextTests
{
    [Fact]
    public void Every_public_protocol_record_has_source_generated_metadata()
    {
        var records = typeof(GameSession).Assembly.GetTypes()
            .Where(t => t.IsPublic && t.IsClass && t.IsSealed && t.GetMethod("<Clone>$") is not null)
            .ToList();
        Assert.True(records.Count > 150, $"found {records.Count} records");
        var missing = records.Where(t => BridgeJsonContext.Default.GetTypeInfo(t) is null).Select(t => t.Name).ToList();
        Assert.True(missing.Count == 0, "add to BridgeJsonContext (regenerate): " + string.Join(", ", missing));
    }
    [Theory]
    [InlineData("8870000.00", 2, "8870000")]
    [InlineData("1234.50", 2, "1234.5")]
    [InlineData("1234.5678", 2, "1234.57")]
    [InlineData("1234.565", 2, "1234.56")]
    [InlineData("1234.575", 2, "1234.58")]
    [InlineData("-0.10", 2, "-0.1")]
    [InlineData("0.00", 2, "0")]
    [InlineData("-1234.57", 2, "-1234.57")]
    [InlineData("1.995", 2, "2")]
    [InlineData("74973577156.360723454334219791", 2, "74973577156.36")]
    [InlineData("74973577156.360723454334219791", 4, "74973577156.3607")]
    [InlineData("0.12345", 4, "0.1234")]
    [InlineData("79228162514264337593543950335", 2, "79228162514264337593543950335")]
    [InlineData("7922816251426433759354395033.0", 2, "7922816251426433759354395033")]
    public void Money_is_rounded_half_even_without_trailing_zeros(string input, int decimals, string expected)
    {
        var value = decimal.Parse(input, System.Globalization.CultureInfo.InvariantCulture);
        var rounded = MoneyJson.Round(value, decimals);
        Assert.Equal(expected, rounded.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(Math.Round(value, decimals, MidpointRounding.ToEven), rounded);
    }
}
