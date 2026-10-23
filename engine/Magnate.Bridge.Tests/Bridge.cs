using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Magnate.Engine.Rules;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>A protocol error as the client sees it.</summary>
internal sealed record BridgeError(string Code, string Message, string? Field, JsonElement Details, long Revision)
{
    public string? Detail(string name)
        => Details.ValueKind == JsonValueKind.Object && Details.TryGetProperty(name, out var v) ? v.ToString() : null;
}

/// <summary>
/// Test driver that talks to a <see cref="GameSession"/> exactly like the web
/// client does: JSON args in, envelope JSON out.
/// </summary>
internal sealed class Bridge
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public Bridge(GameSession session)
    {
        Session = session;
    }

    public GameSession Session { get; }

    /// <summary>The last envelope received (for hud / events / revision assertions).</summary>
    public JsonElement LastEnvelope { get; private set; }

    public static Bridge Init(EconomyRules? rules = null)
    {
        var session = TestContent.NewSession();
        session.NewGameRules = rules ?? LandOff;
        return new Bridge(session);
    }

    /// <summary>
    /// The ruleset tests get unless they ask for another: Realistic with the land rules off
    /// (E3b) — free land, instant construction and the interim placement grid, the behaviour
    /// these tests were written against. Land, plots and construction-time tests pass
    /// <see cref="EconomyRules.Realistic"/> (the rules every real game uses).
    /// </summary>
    public static readonly EconomyRules LandOff = EconomyRules.Realistic with { Land = new LandRules() };

    /// <summary>A session with a new game started.</summary>
    public static Bridge Game(string scenarioId = "tutorial", int seed = 7, string? autopilot = null, EconomyRules? rules = null)
    {
        var bridge = Init(rules);
        bridge.Call("newGame", new { scenarioId, seed, autopilot, createdAtIso = "2026-10-01T00:00:00Z" });
        return bridge;
    }

    /// <summary>
    /// A custom game (no scenario goals) with the given rivals; no rivals means a
    /// market the player has to itself, which keeps AI moves out of a test.
    /// </summary>
    public static Bridge Custom(int seed = 7, decimal playerCash = 50_000_000m, params (string Name, string Strategy)[] rivals)
        => CustomOn(null, seed, playerCash, rivals);

    /// <summary><see cref="Custom"/> under a chosen ruleset (null: <see cref="LandOff"/>).</summary>
    public static Bridge CustomOn(EconomyRules? rules, int seed = 7, decimal playerCash = 50_000_000m, params (string Name, string Strategy)[] rivals)
    {
        var bridge = Init(rules);
        bridge.Call("newGame", new
        {
            scenarioId = "custom",
            seed,
            createdAtIso = "2026-10-01T00:00:00Z",
            custom = new
            {
                startDate = new { year = 2026, month = 1 },
                playerCash,
                competitors = rivals.Select(r => new { name = r.Name, startingCash = 20_000_000m, strategy = r.Strategy }).ToArray(),
            },
        });
        return bridge;
    }

    /// <summary>
    /// A custom game whose player and rivals each start with <paramref name="playerCash"/> and
    /// <paramref name="rivalCash"/>: size them from <see cref="Cost"/> so a test survives content repricing.
    /// </summary>
    public static Bridge Funded(decimal playerCash, decimal rivalCash, int seed = 7, params (string Name, string Strategy)[] rivals)
        => FundedOn(null, playerCash, rivalCash, seed, rivals);

    /// <summary><see cref="Funded"/> under a chosen ruleset (null: <see cref="LandOff"/>).</summary>
    public static Bridge FundedOn(EconomyRules? rules, decimal playerCash, decimal rivalCash, int seed = 7, params (string Name, string Strategy)[] rivals)
    {
        var bridge = Init(rules);
        bridge.Call("newGame", new
        {
            scenarioId = "custom",
            seed,
            createdAtIso = "2026-10-01T00:00:00Z",
            custom = new
            {
                startDate = new { year = 2026, month = 1 },
                playerCash,
                competitors = rivals.Select(r => new { name = r.Name, startingCash = rivalCash, strategy = r.Strategy }).ToArray(),
            },
        });
        return bridge;
    }

    /// <summary>
    /// A scenario game (its goals, deadline and name) whose player starts with <paramref name="playerCash"/>:
    /// a <see cref="Funded"/> custom game relabelled as the scenario through a save round trip (the
    /// sidecar names the scenario the bridge evaluates). Keeps scripted games independent of the
    /// content's starting cash.
    /// </summary>
    public static Bridge FundedScenario(string scenarioId, decimal playerCash, decimal rivalCash, int seed, params (string Name, string Strategy)[] rivals)
        => FundedScenarioOn(null, scenarioId, playerCash, rivalCash, seed, rivals);

    /// <summary><see cref="FundedScenario"/> under a chosen ruleset (null: <see cref="LandOff"/>).</summary>
    public static Bridge FundedScenarioOn(EconomyRules? rules, string scenarioId, decimal playerCash, decimal rivalCash, int seed, params (string Name, string Strategy)[] rivals)
    {
        var funded = FundedOn(rules, playerCash, rivalCash, seed, rivals);
        var root = System.Text.Json.Nodes.JsonNode.Parse(funded.Call("saveGame").GetProperty("data").GetString()!)!.AsObject();
        var sidecar = root["bridge"]!.AsObject();
        sidecar["scenarioId"] = scenarioId;
        sidecar.Remove("custom");
        var bridge = Init(rules);
        bridge.Call("loadGame", new { data = root.ToJsonString() });
        Assert.Equal(scenarioId, bridge.Call("snapshot").GetProperty("scenario").GetProperty("id").GetString());
        return bridge;
    }

    /// <summary>The content's construction cost of a building type.</summary>
    public static decimal Cost(string typeId)
        => Type(typeId).ConstructionCost;

    /// <summary>The content's definition of a building type (opex, levels, capacity).</summary>
    public static Magnate.Engine.Domain.BuildingType Type(string typeId)
        => TestContent.Catalog.BuildingTypes[new Magnate.Engine.Domain.BuildingTypeId(typeId)];

    /// <summary>The engine world behind the session (tests may inspect or nudge it).</summary>
    public Magnate.Engine.Simulation.World World => Session.World;

    public long Revision => LastEnvelope.GetProperty("revision").GetInt64();

    /// <summary>
    /// A building's operating expenses booked in a month, straight from the engine's ledger
    /// (Classic's fixed opex, or Realistic's wages, utilities, maintenance, insurance and
    /// property tax): what a test expects the facade's per-building opex to be.
    /// </summary>
    public decimal BookedOpex(int buildingId, int monthIndex)
        => -World.Ledger.Entries
            .Where(e => e.Building?.Value == buildingId && e.Date.AsMonthIndex() == monthIndex
                && Magnate.Engine.Economics.LedgerCategoryInfo.Of(e.Category).Section == Magnate.Engine.Economics.StatementSection.OperatingExpense)
            .Sum(e => e.Amount);

    /// <summary>Call and return the raw envelope root.</summary>
    public JsonElement Envelope(string method, object? args = null)
    {
        var argsJson = args is null ? "{}" : args as string ?? JsonSerializer.Serialize(args, Json);
        var response = Session.Dispatch(method, argsJson);
        using var doc = JsonDocument.Parse(response);
        LastEnvelope = doc.RootElement.Clone();
        return LastEnvelope;
    }

    /// <summary>Call, assert success, return <c>result</c>.</summary>
    public JsonElement Call(string method, object? args = null)
    {
        var envelope = Envelope(method, args);
        Assert.True(envelope.GetProperty("ok").GetBoolean(), $"{method} failed: {envelope}");
        return envelope.GetProperty("result");
    }

    /// <summary>Call, assert failure, return the error.</summary>
    public BridgeError Fail(string method, object? args = null)
    {
        var envelope = Envelope(method, args);
        Assert.False(envelope.GetProperty("ok").GetBoolean(), $"{method} unexpectedly succeeded: {envelope}");
        Assert.False(envelope.TryGetProperty("result", out _), "error envelopes carry no result");
        var error = envelope.GetProperty("error");
        return new BridgeError(
            error.GetProperty("code").GetString()!,
            error.GetProperty("message").GetString()!,
            error.TryGetProperty("field", out var f) ? f.GetString() : null,
            error.TryGetProperty("details", out var d) ? d.Clone() : default,
            envelope.GetProperty("revision").GetInt64());
    }

    /// <summary>Advance and return the tick result.</summary>
    public JsonElement Advance(int months = 1, object? extra = null)
        => Call("advance", extra ?? new { months });

    /// <summary>Events attached to the last envelope (empty when none).</summary>
    public JsonElement[] EnvelopeEvents()
        => LastEnvelope.TryGetProperty("events", out var e) ? e.EnumerateArray().ToArray() : Array.Empty<JsonElement>();

    public decimal Cash() => Call("snapshot").GetProperty("player").GetProperty("cash").GetDecimal();

    /// <summary>Construct a building and return its id.</summary>
    public int Build(string typeId, string cityId = "metropolis", object? initialSlot = null, object? at = null)
        => Call("construct", new { typeId, cityId, initialSlot, at }).GetProperty("id").GetInt32();

    /// <summary>A supermarket in Metropolis selling soft drinks.</summary>
    public int Supermarket(string product = "soft_drink", decimal price = 2.0m, double restock = 50_000, string city = "metropolis")
        => Build("supermarket", city, new { productId = product, price, restockTarget = restock });
}
