using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Static content for the client (GameSession.Catalog.cs, bridge-spec §5.3 `catalog`, §4.6.4 slot rules).</summary>
public class CatalogTests
{
    private static readonly Bridge Session = Bridge.Init();
    private static readonly JsonElement Catalog = Session.Call("catalog");

    /// <summary>The engine's content behind the DTOs (expected values come from it, not from today's numbers).</summary>
    private static Magnate.Engine.Content.ContentCatalog Content => Session.Session.Catalog;

    private static JsonElement Type(string id)
        => Catalog.GetProperty("buildingTypes").EnumerateArray().Single(t => t.GetProperty("id").GetString() == id);

    private static JsonElement Product(string id)
        => Catalog.GetProperty("products").EnumerateArray().Single(p => p.GetProperty("id").GetString() == id);

    private static List<string> Strings(JsonElement array) => array.EnumerateArray().Select(e => e.GetString()!).ToList();

    [Theory]
    [InlineData("small_farm", "extraction", "extraction")]
    [InlineData("oil_well", "extraction", "extraction")]
    [InlineData("iron_mine", "extraction", "extraction")]
    [InlineData("small_plantation", "extraction", "extraction")]
    [InlineData("supermarket", "retail", "retail")]
    [InlineData("convenience_store", "retail", "retail")]
    [InlineData("warehouse_small", "warehouse", "logistics")]
    [InlineData("seaport", "warehouse", "logistics")]
    [InlineData("rd_center", "research", "research")]
    [InlineData("factory_small", "production", "production")]
    [InlineData("tv_station", "none", "media")]
    [InlineData("radio_station", "none", "media")]
    public void Every_type_gets_its_slot_kind_and_build_menu_group(string typeId, string slotKind, string group)
    {
        var type = Type(typeId);
        Assert.Equal(slotKind, type.GetProperty("slotKind").GetString());
        Assert.Equal(group, type.GetProperty("buildMenuGroup").GetString());
    }

    [Fact]
    public void Eligible_products_follow_the_slot_rules()
    {
        var finished = Catalog.GetProperty("products").EnumerateArray()
            .Where(p => p.GetProperty("tier").GetString() == "finished").Select(p => p.GetProperty("id").GetString()!).ToHashSet();
        // Retail is stricter than the engine: finished goods only (E7).
        Assert.True(finished.SetEquals(Strings(Type("supermarket").GetProperty("eligibleProductIds"))));
        // Extraction: raws whose source category matches the building.
        Assert.Equal(new[] { "crude_oil" }, Strings(Type("oil_well").GetProperty("eligibleProductIds")));
        Assert.Equal(new[] { "coffee_beans", "hops" }, Strings(Type("small_plantation").GetProperty("eligibleProductIds")));
        // Production: anything with a recipe at a producible tier (no raws).
        var factory = Strings(Type("factory_small").GetProperty("eligibleProductIds"));
        Assert.Contains("steel", factory);
        Assert.Contains("car", factory);
        Assert.DoesNotContain("wheat", factory);
        // Warehouses and R&D take every product; media takes none.
        Assert.Equal(Catalog.GetProperty("products").GetArrayLength(), Type("warehouse_small").GetProperty("eligibleProductIds").GetArrayLength());
        Assert.Equal(Catalog.GetProperty("products").GetArrayLength(), Type("rd_center").GetProperty("eligibleProductIds").GetArrayLength());
        Assert.Equal(0, Type("tv_station").GetProperty("eligibleProductIds").GetArrayLength());
    }

    [Fact]
    public void Level_ladders_are_real_or_one_synthetic_rung()
    {
        var supermarket = Type("supermarket");
        Assert.Equal(3, supermarket.GetProperty("maxLevel").GetInt32());
        var levels = supermarket.GetProperty("levels").EnumerateArray().ToList();
        var ladder = Content.BuildingTypes[new Magnate.Engine.Domain.BuildingTypeId("supermarket")].Levels!;
        Assert.Equal(ladder.Select(l => l.Capacity), levels.Select(l => l.GetProperty("capacity").GetInt32()));
        Assert.Equal(0m, levels[0].GetProperty("upgradeCost").GetDecimal()); // level 1 is the building itself
        Assert.Equal(ladder[1].UpgradeCost, levels[1].GetProperty("upgradeCost").GetDecimal());
        Assert.True(levels[1].GetProperty("upgradeCost").GetDecimal() > 0m);

        var store = Type("convenience_store");
        var single = Assert.Single(store.GetProperty("levels").EnumerateArray());
        Assert.Equal(store.GetProperty("maxUnits").GetInt32(), single.GetProperty("capacity").GetInt32());
        Assert.Equal(store.GetProperty("monthlyOperatingCost").GetDecimal(), single.GetProperty("monthlyOperatingCost").GetDecimal());
        Assert.Equal(1, store.GetProperty("maxLevel").GetInt32());
    }

    [Fact]
    public void Media_types_name_their_channel_and_bonus_and_geography_is_explicit()
    {
        Assert.Equal("tv", Type("tv_station").GetProperty("mediaChannel").GetString());
        Assert.Equal(1.35m, Type("tv_station").GetProperty("mediaBonus").GetDecimal());
        Assert.Equal(1.25m, Type("newspaper_publisher").GetProperty("mediaBonus").GetDecimal());
        Assert.False(Type("supermarket").TryGetProperty("mediaChannel", out _));

        Assert.True(Type("oil_well").GetProperty("geography").GetProperty("oilRich").GetBoolean());
        Assert.False(Type("oil_well").GetProperty("geography").TryGetProperty("coastal", out _));
        Assert.True(Type("seaport").GetProperty("geography").GetProperty("coastal").GetBoolean());
        Assert.False(Type("supermarket").TryGetProperty("geography", out _));
    }

    [Fact]
    public void Products_carry_planning_numbers()
    {
        var softDrink = Product("soft_drink");
        Assert.True(softDrink.GetProperty("affectsRetailDemand").GetBoolean());
        // Per-cycle content numbers × the cycles the engine runs per slot per month: the recipe's
        // own (outputPerSlotMonth / outputQuantity, E1 per-unit recipes), not the legacy constant.
        var recipe = Content.Products[new Magnate.Engine.Domain.ProductId("soft_drink")].Recipe!;
        var cycles = recipe.CyclesPerSlotMonth;
        Assert.Equal(recipe.OutputPerSlotMonth, softDrink.GetProperty("outputPerSlotPerMonth").GetDouble());
        Assert.Equal(recipe.OutputQuantity * cycles, softDrink.GetProperty("outputPerSlotPerMonth").GetDouble());
        var inputs = softDrink.GetProperty("recipe").GetProperty("inputs").EnumerateArray().ToList();
        Assert.Equal(recipe.Inputs.Single(i => i.ProductId.Value == "sugar").Quantity * cycles,
            inputs.Single(i => i.GetProperty("productId").GetString() == "sugar").GetProperty("perSlotPerMonth").GetDouble());
        // Bracket values as the content sets them; a bracket the content omits is absent.
        var reservation = Content.Products[new Magnate.Engine.Domain.ProductId("soft_drink")].ReservationPrice;
        foreach (var (bracket, id) in new[] { (Magnate.Engine.Domain.IncomeBracket.Low, "low"), (Magnate.Engine.Domain.IncomeBracket.Middle, "middle"), (Magnate.Engine.Domain.IncomeBracket.High, "high") })
        {
            var present = softDrink.TryGetProperty("reservationPrice", out var rp) && rp.TryGetProperty(id, out var v) && v.ValueKind == JsonValueKind.Number;
            Assert.Equal(reservation is not null && reservation.ContainsKey(bracket), present);
            if (present) Assert.Equal((double)reservation![bracket], rp.GetProperty(id).GetDouble());
        }

        var plastic = Product("plastic");
        Assert.False(plastic.GetProperty("affectsRetailDemand").GetBoolean());
        Assert.Contains("soft_drink", Strings(plastic.GetProperty("feedsInto")));
        Assert.Contains("television", Strings(plastic.GetProperty("feedsInto")));

        var wheat = Product("wheat");
        Assert.Equal("farm", wheat.GetProperty("extractedAt").GetString());
        Assert.Equal(Content.Products[new Magnate.Engine.Domain.ProductId("wheat")].Extraction!.YieldPerSlotPerMonth, wheat.GetProperty("yieldPerSlotPerMonth").GetDouble());
        Assert.True(wheat.GetProperty("yieldPerSlotPerMonth").GetDouble() > 0);
        Assert.False(wheat.TryGetProperty("recipe", out _));
    }

    [Fact]
    public void Cities_list_potential_demand_for_finished_products_only()
    {
        var cities = Catalog.GetProperty("cities").EnumerateArray().ToList();
        Assert.Equal("metropolis", cities[0].GetProperty("id").GetString()); // most populous first
        var metro = cities[0];
        // Σ population × share × perCapita over the income brackets.
        var city = Content.Cities[new Magnate.Engine.Domain.CityId("metropolis")];
        var drink = Content.Products[new Magnate.Engine.Domain.ProductId("soft_drink")];
        var expected = city.Demographics.Sum(kv => city.Population * kv.Value * (drink.BaseDemandPerCapita.TryGetValue(kv.Key, out var d) ? d : 0));
        Assert.True(expected > 0);
        Assert.Equal(expected, metro.GetProperty("potentialDemand").GetProperty("soft_drink").GetDouble(), 3);
        Assert.False(metro.GetProperty("potentialDemand").TryGetProperty("steel", out _));
        Assert.Equal(city.Demographics[Magnate.Engine.Domain.IncomeBracket.Low], metro.GetProperty("demographics").GetProperty("low").GetDouble());
        Assert.True(metro.GetProperty("coastal").GetBoolean());
    }

    [Fact]
    public void Channels_constants_events_and_starter_plans()
    {
        var channels = Catalog.GetProperty("adChannels").EnumerateArray().ToDictionary(c => c.GetProperty("id").GetString()!);
        Assert.Equal(new[] { "magazine", "newspaper", "radio", "tv" }, channels.Keys.OrderBy(k => k, StringComparer.Ordinal));
        Assert.Equal(4_000m, channels["tv"].GetProperty("costPerPoint").GetDecimal());
        Assert.Equal("radio_station", channels["radio"].GetProperty("mediaBuildingTypeId").GetString());

        var constants = Catalog.GetProperty("constants");
        Assert.Equal(200, constants.GetProperty("cyclesPerSlotPerMonth").GetInt32());
        Assert.Equal(GoalTracker.DefaultBankruptcyGraceMonths, constants.GetProperty("bankruptcyGraceMonths").GetInt32());

        Assert.True(Catalog.GetProperty("events").GetArrayLength() > 0);
        Assert.All(Catalog.GetProperty("events").EnumerateArray(),
            e => Assert.Contains(e.GetProperty("severity").GetString(), new[] { "info", "notable", "major" }));

        var plans = Catalog.GetProperty("starterPlans").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();
        Assert.Equal(new[] { "cornerStore", "breadAisle", "warehouseHub", "softDrinkLab" }, plans);
        Assert.Matches("^[0-9a-f]{64}$", Catalog.GetProperty("contentHash").GetString());
    }

    [Fact]
    public void Catalog_is_built_once_per_init_and_needs_no_game()
    {
        var bridge = Bridge.Init();
        var a = bridge.Envelope("catalog").GetRawText();
        bridge.Call("newGame", new { scenarioId = "sandbox" });
        var b = bridge.Envelope("catalog").GetRawText();
        Assert.Equal(StripRevision(a), StripRevision(b));
        Assert.Equal(BridgeErrorCodes.NotInitialized, new Bridge(new GameSession()).Fail("catalog").Code);
    }

    private static string StripRevision(string envelope)
    {
        using var doc = JsonDocument.Parse(envelope);
        return doc.RootElement.GetProperty("result").GetRawText();
    }
}
