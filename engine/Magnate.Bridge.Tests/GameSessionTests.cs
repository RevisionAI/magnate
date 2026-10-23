using System.Linq;
using System.Text.Json;
using Xunit;

namespace Magnate.Bridge.Tests;

public class GameSessionTests
{
    private static JsonElement Ok(string response)
    {
        using var doc = JsonDocument.Parse(response);
        var root = doc.RootElement.Clone();
        Assert.True(root.GetProperty("ok").GetBoolean(), response);
        return root.GetProperty("result");
    }

    private static string ErrorCode(string response)
    {
        using var doc = JsonDocument.Parse(response);
        Assert.False(doc.RootElement.GetProperty("ok").GetBoolean(), response);
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString()!;
    }

    [Fact]
    public void Init_reports_catalog_counts_and_methods()
    {
        var session = new GameSession();
        var result = Ok(session.Dispatch("init", JsonSerializer.Serialize(new { contentRoot = TestContent.Root })));
        Assert.True(result.GetProperty("products").GetInt32() > 0);
        Assert.True(result.GetProperty("scenarios").GetInt32() > 0);
        var methods = result.GetProperty("methods").EnumerateArray().Select(m => m.GetString()).ToList();
        Assert.Contains("newGame", methods);
        Assert.Contains("advance", methods);
    }

    [Fact]
    public void Unknown_method_is_a_structured_error()
    {
        var session = new GameSession();
        Assert.Equal(BridgeErrorCodes.UnknownMethod, ErrorCode(session.Dispatch("nope", "{}")));
    }

    [Fact]
    public void Game_methods_require_a_game()
    {
        var session = TestContent.NewSession();
        Assert.Equal(BridgeErrorCodes.NoGame, ErrorCode(session.Dispatch("snapshot", null)));
    }

    [Fact]
    public void New_game_advance_and_construct_round_trip()
    {
        var session = TestContent.NewSession();
        var snap = Ok(session.Dispatch("newGame", "{\"scenarioId\":\"tutorial\",\"seed\":7}"));
        Assert.Equal(1, snap.GetProperty("playerId").GetInt32());

        var built = Ok(session.Dispatch("construct", "{\"typeId\":\"supermarket\",\"cityId\":\"metropolis\"}"));
        Assert.Equal("supermarket", built.GetProperty("typeId").GetString());

        var tick = Ok(session.Dispatch("advance", "{\"months\":2}"));
        Assert.Equal(2, tick.GetProperty("months").GetInt32());
        Assert.Contains(tick.GetProperty("events").EnumerateArray(), e => e.GetProperty("kind").GetString() == "monthClosed");
    }

    [Fact]
    public void Engine_rejections_map_to_error_codes()
    {
        var session = TestContent.NewSession();
        Ok(session.Dispatch("newGame", "{\"scenarioId\":\"tutorial\"}"));
        Assert.Equal(BridgeErrorCodes.NotFound, ErrorCode(session.Dispatch("construct", "{\"typeId\":\"no_such_type\",\"cityId\":\"metropolis\"}")));
        Assert.Equal(BridgeErrorCodes.BadRequest, ErrorCode(session.Dispatch("advance", "{\"months\":\"many\"")));
    }
}

public class GameSessionPersistenceTests
{
    [Fact]
    public void Save_and_load_round_trip_through_the_bridge()
    {
        var session = TestContent.NewSession();
        session.Dispatch("newGame", "{\"scenarioId\":\"tutorial\",\"seed\":3}");
        session.Dispatch("construct", "{\"typeId\":\"supermarket\",\"cityId\":\"metropolis\"}");
        session.Dispatch("advance", "{\"months\":2}");

        using var saved = System.Text.Json.JsonDocument.Parse(session.Dispatch("saveGame", null));
        Assert.True(saved.RootElement.GetProperty("ok").GetBoolean());
        var data = saved.RootElement.GetProperty("result").GetProperty("data").GetString()!;
        var cash = saved.RootElement.GetProperty("result").GetProperty("cash").GetDecimal();

        var other = TestContent.NewSession();
        var args = System.Text.Json.JsonSerializer.Serialize(new { data });
        using var loaded = System.Text.Json.JsonDocument.Parse(other.Dispatch("loadGame", args));
        Assert.True(loaded.RootElement.GetProperty("ok").GetBoolean(), loaded.RootElement.ToString());
        var player = loaded.RootElement.GetProperty("result").GetProperty("companies")[0];
        Assert.Equal(cash, player.GetProperty("cash").GetDecimal());
        Assert.Equal("tutorial", loaded.RootElement.GetProperty("result").GetProperty("scenario").GetProperty("id").GetString());
    }
}
