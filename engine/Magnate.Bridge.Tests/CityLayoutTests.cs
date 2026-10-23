using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Rules;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>The <c>cityLayout</c> bridge method (bridge-spec §8.1 + art-rendering §5.3 extensions).</summary>
public sealed class CityLayoutTests
{
    private static JsonElement Ok(string response)
    {
        using var doc = JsonDocument.Parse(response);
        var root = doc.RootElement.Clone();
        Assert.True(root.GetProperty("ok").GetBoolean(), response.Length > 400 ? response[..400] : response);
        return root.GetProperty("result");
    }

    private static string ErrorCode(string response)
    {
        using var doc = JsonDocument.Parse(response);
        Assert.False(doc.RootElement.GetProperty("ok").GetBoolean());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString()!;
    }

    [Fact]
    public void City_layout_is_registered_and_needs_no_game()
    {
        Assert.Contains("cityLayout", GameSession.MethodNames);
        var session = TestContent.NewSession();
        var layout = Ok(session.Dispatch("cityLayout", "{\"cityId\":\"hilltown\"}"));
        Assert.Equal("hilltown", layout.GetProperty("cityId").GetString());
    }

    [Theory]
    [InlineData("metropolis", 80)]
    [InlineData("riverside", 60)]
    [InlineData("eastside", 55)]
    [InlineData("portbay", 50)]
    [InlineData("hilltown", 40)]
    public void Layout_has_the_spec_shape(string cityId, int grid)
    {
        var session = TestContent.NewSession();
        var l = Ok(session.Dispatch("cityLayout", JsonSerializer.Serialize(new { cityId })));
        Assert.Equal(cityId, l.GetProperty("cityId").GetString());
        Assert.Equal(1, l.GetProperty("layoutRev").GetInt32());
        Assert.Equal(grid, l.GetProperty("gridW").GetInt32());
        Assert.Equal(grid, l.GetProperty("gridH").GetInt32());
        Assert.Equal(1, l.GetProperty("seed").GetInt32());
        Assert.Equal(24.0, l.GetProperty("plotSize").GetDouble());
        Assert.Contains(l.GetProperty("climate").GetString(), new[] { "temperate", "warm", "cold", "arid" });

        // Roads: spec kinds, contiguous straight paths, lanes.
        var roads = l.GetProperty("roads").EnumerateArray().ToList();
        Assert.NotEmpty(roads);
        foreach (var r in roads)
        {
            Assert.Contains(r.GetProperty("kind").GetString(), new[] { "highway", "arterial", "street" });
            Assert.Contains(r.GetProperty("roadClass").GetString(), new[] { "highway", "arterial", "collector", "local" });
            Assert.InRange(r.GetProperty("lanes").GetInt32(), 2, 6);
            var path = r.GetProperty("path").EnumerateArray().Select(p => (X: p.GetProperty("px").GetInt32(), Z: p.GetProperty("pz").GetInt32())).ToList();
            Assert.NotEmpty(path);
            for (var k = 1; k < path.Count; k++) Assert.Equal(1, System.Math.Abs(path[k].X - path[k - 1].X) + System.Math.Abs(path[k].Z - path[k - 1].Z));
        }

        // Parcels: spec fields, ids 1..n, nulls omitted.
        var parcels = l.GetProperty("parcels").EnumerateArray().ToList();
        var ids = new HashSet<int>();
        foreach (var p in parcels)
        {
            Assert.True(ids.Add(p.GetProperty("id").GetInt32()));
            Assert.Contains(p.GetProperty("zone").GetString(), new[] { "residential", "commercial", "industrial", "agricultural", "port", "park", "civic" });
            Assert.True(p.GetProperty("landValuePerPlot").GetDecimal() > 0);
            Assert.InRange(p.GetProperty("traffic").GetDouble(), 0, 100);
            Assert.False(p.TryGetProperty("ownerId", out _));
            Assert.False(p.TryGetProperty("buildingId", out _));
            var forSale = p.GetProperty("forSale").GetBoolean();
            Assert.Equal(forSale, p.TryGetProperty("askingPrice", out _));
            Assert.InRange(p.GetProperty("facing").GetInt32(), 0, 3);
        }
        Assert.Equal(Enumerable.Range(1, parcels.Count), ids.OrderBy(i => i));

        // Ambient: one entry per developed parcel, extended kinds.
        foreach (var a in l.GetProperty("ambient").EnumerateArray())
        {
            Assert.Contains(a.GetProperty("parcelId").GetInt32(), ids);
            Assert.False(string.IsNullOrEmpty(a.GetProperty("kind").GetString()));
            Assert.InRange(a.GetProperty("variant").GetInt32(), 0, 7);
            Assert.True(a.GetProperty("floors").GetInt32() >= 0);
        }

        // Per-plot arrays: one entry per plot, documented alphabets.
        var plots = l.GetProperty("plots");
        var n = grid * grid;
        var kinds = plots.GetProperty("kinds").GetString()!;
        Assert.Equal(n, kinds.Length);
        Assert.All(kinds, c => Assert.Contains(c, "prbsvlho"));
        Assert.All(plots.GetProperty("roads").GetString()!, c => Assert.InRange(c, '0', '4'));
        Assert.Equal(n, plots.GetProperty("districts").GetString()!.Length);
        Assert.Equal(n, plots.GetProperty("landValue").GetArrayLength());
        Assert.Equal(n, plots.GetProperty("traffic").GetArrayLength());

        // Hilly cities ship terrain corner heights and slopes; flat cities omit them.
        var hilly = cityId is "hilltown" or "riverside";
        Assert.Equal(hilly, l.TryGetProperty("terrain", out var terrain));
        Assert.Equal(hilly, plots.TryGetProperty("slopes", out _));
        if (hilly) Assert.Equal((grid + 1) * (grid + 1), terrain.GetProperty("heights").GetArrayLength());

        Assert.Contains(l.GetProperty("landmarks").EnumerateArray(), m => m.GetProperty("kind").GetString() == "cityHall");
        foreach (var w in l.GetProperty("water").EnumerateArray())
        {
            Assert.Contains(w.GetProperty("kind").GetString(), new[] { "sea", "river", "lake" });
            if (w.TryGetProperty("shore", out var shore)) Assert.Contains(shore.GetString(), new[] { "beach", "quay" });
        }
    }

    [Fact]
    public void Coastal_and_resource_extensions_are_present()
    {
        var session = TestContent.NewSession();
        var portbay = Ok(session.Dispatch("cityLayout", "{\"cityId\":\"portbay\"}"));
        var deposits = portbay.GetProperty("deposits").EnumerateArray().ToList();
        Assert.Contains(deposits, d => d.GetProperty("resource").GetString() == "oil" && d.GetProperty("offshore").GetBoolean());
        Assert.Contains(portbay.GetProperty("ambient").EnumerateArray(), a => a.GetProperty("kind").GetString() == "deposit:oil");
        Assert.Contains(portbay.GetProperty("water").EnumerateArray(), w => w.TryGetProperty("shore", out var s) && s.GetString() == "quay");
        Assert.Contains(portbay.GetProperty("parcels").EnumerateArray(), p => p.GetProperty("zone").GetString() == "port");

        var riverside = Ok(session.Dispatch("cityLayout", "{\"cityId\":\"riverside\"}"));
        Assert.Contains(riverside.GetProperty("roads").EnumerateArray(), r => r.TryGetProperty("bridge", out var b) && b.GetBoolean());
        Assert.Contains(riverside.GetProperty("ambient").EnumerateArray(), a => a.GetProperty("kind").GetString()!.StartsWith("civic:", System.StringComparison.Ordinal));
    }

    [Fact]
    public void Layouts_are_deterministic_and_cached_per_city_and_seed()
    {
        var a = TestContent.NewSession();
        var b = TestContent.NewSession();
        var first = a.Dispatch("cityLayout", "{\"cityId\":\"eastside\"}");
        Assert.Equal(first, a.Dispatch("cityLayout", "{\"cityId\":\"eastside\"}"));
        Assert.Equal(first, b.Dispatch("cityLayout", "{\"cityId\":\"eastside\"}"));

        // Without a game a preview seed may be asked for; it changes the layout.
        var seeded = Ok(a.Dispatch("cityLayout", "{\"cityId\":\"eastside\",\"seed\":99}"));
        Assert.Equal(99, seeded.GetProperty("seed").GetInt32());
        Assert.NotEqual(first, a.Dispatch("cityLayout", "{\"cityId\":\"eastside\",\"seed\":99}"));
    }

    [Fact]
    public void A_running_game_pins_the_layout_seed()
    {
        var session = TestContent.NewSession();
        Ok(session.Dispatch("newGame", "{\"scenarioId\":\"tutorial\",\"seed\":7}"));
        var during = Ok(session.Dispatch("cityLayout", "{\"cityId\":\"metropolis\",\"seed\":99}"));
        // E3b: each game generates its cities from its own seed (World.LayoutSeed); the argument is ignored.
        Assert.Equal(7, during.GetProperty("seed").GetInt32());
        Assert.Equal(80, during.GetProperty("gridW").GetInt32());
    }

    [Fact]
    public void Bad_requests_and_unknown_cities_are_structured_errors()
    {
        var session = TestContent.NewSession();
        Assert.Equal(BridgeErrorCodes.NotFound, ErrorCode(session.Dispatch("cityLayout", "{\"cityId\":\"atlantis\"}")));
        Assert.Equal(BridgeErrorCodes.BadRequest, ErrorCode(session.Dispatch("cityLayout", "{\"cityId\":\"\"}")));
        Assert.Equal(BridgeErrorCodes.NotInitialized, ErrorCode(new GameSession().Dispatch("cityLayout", "{\"cityId\":\"metropolis\"}")));
    }

    [Fact]
    public void Metropolis_payload_stays_compact()
    {
        var session = TestContent.NewSession();
        var json = session.Dispatch("cityLayout", "{\"cityId\":\"metropolis\"}");
        Assert.True(json.Length < 450_000, $"cityLayout(metropolis) is {json.Length:N0} characters");
    }

    // ------------------------------------------------------------------ E3b: live layout and the land market

    private static JsonElement Parcel(JsonElement layout, int id)
        => layout.GetProperty("parcels").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);

    [Fact]
    public void Land_purchases_and_sales_move_the_live_layout()
    {
        var bridge = Bridge.Game("tutorial", seed: 11, rules: EconomyRules.Realistic);
        var layout = bridge.Call("cityLayout", new { cityId = "metropolis" });
        var rev = layout.GetProperty("layoutRev").GetInt32();
        Assert.Equal(11, layout.GetProperty("seed").GetInt32());

        var listed = bridge.Call("parcels", new { cityId = "metropolis", filter = "forSale" }).EnumerateArray()
            .First(p => p.GetProperty("askingPrice").GetDecimal() is > 0m and < 1_000_000m);
        var id = listed.GetProperty("id").GetInt32();
        var price = listed.GetProperty("askingPrice").GetDecimal();
        var cash = bridge.Cash();

        var bought = bridge.Call("buyLand", new { cityId = "metropolis", parcelId = id });
        var purchased = bridge.EnvelopeEvents().Single(e => e.GetProperty("kind").GetString() == "landPurchased");
        Assert.Equal(1, bought.GetProperty("ownerId").GetInt32());
        Assert.False(bought.GetProperty("forSale").GetBoolean());
        Assert.Equal(cash - price, bridge.Cash());
        Assert.Equal(price, purchased.GetProperty("amount").GetDecimal());
        Assert.True(bridge.Call("balanceSheet", new { }).GetProperty("booksClose").GetBoolean());

        var after = bridge.Call("cityLayout", new { cityId = "metropolis" });
        Assert.True(after.GetProperty("layoutRev").GetInt32() > rev);
        Assert.Equal(1, Parcel(after, id).GetProperty("ownerId").GetInt32());
        Assert.Contains(bridge.Call("parcels", new { cityId = "metropolis", filter = "owned" }).EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);
        Assert.Equal(BridgeErrorCodes.ParcelNotForSale, bridge.Fail("buyLand", new { cityId = "metropolis", parcelId = id }).Code);

        var sold = bridge.Call("sellLand", new { cityId = "metropolis", parcelId = id });
        Assert.True(sold.GetProperty("forSale").GetBoolean());
        Assert.False(sold.TryGetProperty("ownerId", out _));
        Assert.Equal(cash, bridge.Cash()); // same month: the same value
        Assert.Equal(BridgeErrorCodes.ParcelNotOwned, bridge.Fail("sellLand", new { cityId = "metropolis", parcelId = id }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("buyLand", new { cityId = "metropolis", parcelId = 999_999 }).Code);
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("parcels", new { cityId = "metropolis", filter = "cheap" }).Code);

        // A landmark is never for sale.
        var landmark = after.GetProperty("landmarks")[0].GetProperty("parcelId").GetInt32();
        Assert.Equal(BridgeErrorCodes.ParcelNotForSale, bridge.Fail("buyLand", new { cityId = "metropolis", parcelId = landmark }).Code);
    }

    [Fact]
    public void Construction_shows_on_the_live_layout_and_moves_the_fields_at_month_close()
    {
        var bridge = Bridge.Game("tutorial", seed: 11, rules: EconomyRules.Realistic);
        var before = bridge.Call("cityLayout", new { cityId = "metropolis" });
        var id = bridge.Build("supermarket", "metropolis", new { productId = "soft_drink", price = 2.0m, restockTarget = 50_000 });
        var built = bridge.Call("cityLayout", new { cityId = "metropolis" });
        Assert.True(built.GetProperty("layoutRev").GetInt32() > before.GetProperty("layoutRev").GetInt32());
        var parcels = built.GetProperty("parcels").EnumerateArray().Where(p => p.TryGetProperty("buildingId", out var b) && b.GetInt32() == id).ToList();
        Assert.NotEmpty(parcels);
        Assert.All(parcels, p => Assert.Equal(1, p.GetProperty("ownerId").GetInt32()));
        var under = parcels.Select(p => p.GetProperty("id").GetInt32()).ToHashSet();
        Assert.DoesNotContain(built.GetProperty("ambient").EnumerateArray(), a => under.Contains(a.GetProperty("parcelId").GetInt32()));
        // The fields only change at the month close.
        Assert.Equal(before.GetProperty("plots").GetProperty("traffic").GetRawText(), built.GetProperty("plots").GetProperty("traffic").GetRawText());

        bridge.Advance(1);
        var closed = bridge.Call("cityLayout", new { cityId = "metropolis" });
        Assert.True(closed.GetProperty("layoutRev").GetInt32() > built.GetProperty("layoutRev").GetInt32());
        Assert.NotEqual(built.GetProperty("plots").GetProperty("traffic").GetRawText(), closed.GetProperty("plots").GetProperty("traffic").GetRawText());
        Assert.Equal(closed.GetProperty("layoutRev").GetInt32(),
            bridge.Call("cityView", new { cityId = "metropolis" }).GetProperty("layout").GetProperty("layoutRev").GetInt32());
    }

    [Fact]
    public void Land_methods_answer_feature_unavailable_without_land_rules()
    {
        var bridge = Bridge.Game("tutorial", seed: 11, rules: EconomyRules.Classic);
        Assert.Equal(BridgeErrorCodes.FeatureUnavailable, bridge.Fail("parcels", new { cityId = "metropolis" }).Code);
        Assert.Equal(BridgeErrorCodes.FeatureUnavailable, bridge.Fail("buyLand", new { cityId = "metropolis", parcelId = 1 }).Code);
        Assert.Equal(BridgeErrorCodes.FeatureUnavailable, bridge.Fail("sellLand", new { cityId = "metropolis", parcelId = 1 }).Code);
        var store = bridge.Supermarket();
        Assert.Equal(BridgeErrorCodes.FeatureUnavailable, bridge.Fail("cancelConstruction", new { buildingId = store }).Code);
        // A Classic game keeps the generated layout (seed 1, revision 1).
        var layout = bridge.Call("cityLayout", new { cityId = "metropolis" });
        Assert.Equal(1, layout.GetProperty("layoutRev").GetInt32());
        Assert.Equal(1, layout.GetProperty("seed").GetInt32());
    }
}
