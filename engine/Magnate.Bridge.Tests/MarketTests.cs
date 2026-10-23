using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>
/// Market intelligence on the engine's demand model (GameSession.Market.cs, bridge-spec §5.9 and
/// E9): new games run Realistic market rules, so every market view reads
/// <c>World.PreviewDemand</c> (<c>modelSource:'engine'</c>) and counts the incumbent local
/// competition.
/// </summary>
public class MarketTests
{
    /// <summary>Two soft-drink supermarkets in Riverside, both the player's (no AI moves).</summary>
    private static (Bridge Bridge, int Cheap, int Dear) Riverside()
    {
        var bridge = Bridge.Custom(seed: 21, playerCash: 80_000_000m);
        // Restock targets above the stock cap: the engine clamps them to 1.5 months of throughput.
        var cheap = bridge.Build("supermarket", "riverside", new { productId = "soft_drink", price = 1.75, restockTarget = 2_000_000 });
        var dear = bridge.Build("supermarket", "riverside", new { productId = "soft_drink", price = 2.10, restockTarget = 2_000_000 });
        return (bridge, cheap, dear);
    }

    [Fact]
    public void The_demand_model_is_on_and_reported_by_init()
    {
        var init = Bridge.Init().Call("init", new { contentRoot = TestContent.Root });
        Assert.True(init.GetProperty("features").GetProperty("demandModel").GetBoolean());
    }

    [Fact]
    public void The_engine_model_predicts_the_ticks_sales_exactly()
    {
        var (bridge, cheap, dear) = Riverside();
        var before = bridge.Call("marketDetail", new { cityId = "riverside", productId = "soft_drink" });
        Assert.Equal("engine", before.GetProperty("modelSource").GetString());
        var forecast = before.GetProperty("retailers").EnumerateArray()
            .ToDictionary(r => r.GetProperty("buildingId").GetInt32(), r => r.GetProperty("modelDemandUnits").GetDouble());
        Assert.Equal(2, forecast.Count);
        Assert.True(forecast[cheap] > forecast[dear], "the cheaper line sells more");
        var incumbent = before.GetProperty("incumbent");
        Assert.True(incumbent.GetProperty("mass").GetDouble() > 10, "Riverside has a sizeable local soft-drink trade");
        Assert.Equal(1.75m, incumbent.GetProperty("price").GetDecimal());
        var modelShares = before.GetProperty("retailers").EnumerateArray().Sum(r => r.GetProperty("modelShare").GetDouble())
            + incumbent.GetProperty("modelShare").GetDouble();
        Assert.Equal(1.0, modelShares, 6);

        bridge.Advance(1);
        foreach (var (id, units) in forecast)
        {
            var sold = bridge.Call("building", new { buildingId = id }).GetProperty("slots")[0].GetProperty("retail").GetProperty("lastMonthUnits").GetDouble();
            Assert.InRange(sold - units, -0.001, 0.001); // forecast units are reported to 3 decimals
        }

        var after = bridge.Call("marketDetail", new { cityId = "riverside", productId = "soft_drink" });
        var brackets = after.GetProperty("brackets").EnumerateArray().ToList();
        Assert.Equal(new[] { "low", "middle", "high" }, brackets.Select(b => b.GetProperty("bracket").GetString()));
        Assert.All(brackets, b => Assert.False(b.TryGetProperty("reservationPrice", out _)));
        // Realised shares count the incumbents: the player's lines plus the local trade make 100 %.
        var realised = after.GetProperty("retailers").EnumerateArray().Sum(r => r.GetProperty("lastMonthRealisedShare").GetDouble());
        var incumbentUnits = after.GetProperty("incumbent").GetProperty("lastMonthUnits").GetDouble();
        var playerUnits = after.GetProperty("retailers").EnumerateArray().Sum(r => r.GetProperty("lastMonthUnits").GetDouble());
        Assert.Equal(playerUnits / (playerUnits + incumbentUnits), realised, 6);
        Assert.Equal(realised, after.GetProperty("engineGoalShare").GetDouble(), 6);
        Assert.InRange(realised, 0.01, 0.99);
    }

    [Fact]
    public void Market_detail_validates_its_key()
    {
        var bridge = Bridge.Custom();
        var flour = bridge.Fail("marketDetail", new { cityId = "riverside", productId = "flour" });
        Assert.Equal(BridgeErrorCodes.ProductNotAllowed, flour.Code);
        Assert.Equal("notFinished", flour.Detail("reason"));
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("marketDetail", new { cityId = "gotham", productId = "bread" }).Code);
        var empty = bridge.Call("marketDetail", new { cityId = "hilltown", productId = "car" });
        Assert.Equal(0, empty.GetProperty("retailers").GetArrayLength());
        Assert.Equal(0, empty.GetProperty("engineGoalShare").GetDouble());
        // Nobody retails cars in Hilltown yet, but the local dealers do: the whole market is theirs.
        Assert.Equal(1.0, empty.GetProperty("incumbent").GetProperty("modelShare").GetDouble(), 9);
    }

    [Fact]
    public void Market_intel_lists_every_consumer_market_with_filters_and_sorts()
    {
        var (bridge, _, _) = Riverside();
        bridge.World.Construct(new CompanyId(1), new BuildingTypeId("supermarket"), new CityId("metropolis")); // no slot: not a retailer
        bridge.Advance(1);
        var all = bridge.Call("marketIntel", new { }).GetProperty("rows").EnumerateArray().ToList();
        Assert.Equal(5 * 8, all.Count); // every city × finished product
        var top = all[0]; // default sort: the player's share, best first
        Assert.Equal("riverside", top.GetProperty("cityId").GetString());
        Assert.Equal("soft_drink", top.GetProperty("productId").GetString());
        Assert.True(top.GetProperty("playerPresent").GetBoolean());
        Assert.Equal(1.75m, top.GetProperty("playerPrice").GetDecimal());
        var playerShare = top.GetProperty("playerRealisedShare").GetDouble();
        Assert.Equal(1.0, playerShare + top.GetProperty("incumbentShare").GetDouble(), 9);
        Assert.Equal(2, top.GetProperty("retailerCount").GetInt32());
        Assert.Equal(0, top.GetProperty("rivalCount").GetInt32());
        Assert.False(top.TryGetProperty("topRival", out _));
        Assert.All(all, r => Assert.InRange(r.GetProperty("incumbentShare").GetDouble(), 0.0, 1.0));

        Assert.Single(bridge.Call("marketIntel", new { playerOnly = true }).GetProperty("rows").EnumerateArray());
        Assert.Empty(bridge.Call("marketIntel", new { competitorsOnly = true }).GetProperty("rows").EnumerateArray());
        Assert.Equal(8, bridge.Call("marketIntel", new { cityId = "hilltown" }).GetProperty("rows").GetArrayLength());
        Assert.Equal(5, bridge.Call("marketIntel", new { productId = "car" }).GetProperty("rows").GetArrayLength());
        var significant = bridge.Call("marketIntel", new { significantOnly = true }).GetProperty("rows").EnumerateArray().ToList();
        Assert.All(significant, r => Assert.True(r.GetProperty("retailerCount").GetInt32() > 0 || r.GetProperty("potentialDemand").GetDouble() >= 1000));
        Assert.True(significant.Count < all.Count); // cars, TVs and designer jeans sell a few hundred units in small cities
        var byDemand = bridge.Call("marketIntel", new { sort = "demand" }).GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("potentialDemand").GetDouble()).ToList();
        Assert.Equal(byDemand.OrderByDescending(d => d), byDemand);
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("marketIntel", new { sort = "vibes" }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("marketIntel", new { productId = "gold" }).Code);
    }

    [Fact]
    public void Opportunities_rank_markets_to_enter_and_to_defend()
    {
        var bridge = Bridge.Game("soft_drink_war", seed: 3);
        bridge.Supermarket("soft_drink", 1.80m, 300_000);
        bridge.Advance(6);
        var o = bridge.Call("marketOpportunities");
        var enter = o.GetProperty("enter").EnumerateArray().ToList();
        Assert.Equal(3, enter.Count);
        var scores = enter.Select(e => e.GetProperty("score").GetDouble()).ToList();
        Assert.Equal(scores.OrderByDescending(s => s), scores);
        Assert.All(enter, e => Assert.Equal(e.GetProperty("potentialDemand").GetDouble() / (1 + e.GetProperty("rivalCount").GetInt32()),
            e.GetProperty("score").GetDouble(), 2));
        // The player sells soft drinks in Metropolis, so that market is never an "enter" pick.
        Assert.DoesNotContain(enter, e => e.GetProperty("cityId").GetString() == "metropolis" && e.GetProperty("productId").GetString() == "soft_drink");
        Assert.All(o.GetProperty("defend").EnumerateArray(), d =>
            Assert.True(d.GetProperty("topRivalShare").GetDouble() > d.GetProperty("playerShare").GetDouble()));
    }

    [Fact]
    public void Price_suggestions_are_exact_engine_previews()
    {
        var (bridge, cheap, _) = Riverside();
        bridge.Advance(1);
        var s = bridge.Call("suggestPrice", new { buildingId = cheap, slotIndex = 0 });
        Assert.Equal("engine", s.GetProperty("modelSource").GetString());
        // Restocked from the world market at the landed import price: $1.10 × 1.12.
        Assert.Equal(1.232m, s.GetProperty("unitCost").GetDecimal());
        Assert.False(s.TryGetProperty("rivalMin", out _)); // no rival companies in this market
        Assert.Empty(s.GetProperty("ceilings").EnumerateArray()); // no reservation cliffs in the engine model
        var points = s.GetProperty("expectedUnitsAt").EnumerateArray().ToList();
        // 0.8 … 1.6 × the $1.75 reference price.
        Assert.Equal(new[] { 1.4m, 1.58m, 1.75m, 1.93m, 2.1m, 2.28m, 2.45m, 2.63m, 2.8m }, points.Select(p => p.GetProperty("price").GetDecimal()));
        var units = points.Select(p => p.GetProperty("units").GetDouble()).ToList();
        Assert.True(units.Zip(units.Skip(1)).All(u => u.First >= u.Second), "units never rise with price");
        var world = bridge.World;
        var cap = world.GetStockCap(new BuildingInstanceId(cheap), new ProductId("soft_drink"));
        Assert.All(units, u => Assert.True(u <= cap + 1e-6));

        // Each point is exactly what the engine's preview says the next tick would sell.
        foreach (var p in points)
        {
            var price = p.GetProperty("price").GetDecimal();
            var preview = world.PreviewDemand(new CityId("riverside"), new ProductId("soft_drink"),
                new PreviewOffer { Building = new BuildingInstanceId(cheap), Price = price });
            Assert.Equal(Math.Round(preview.Hypothetical!.Sold, 3), p.GetProperty("units").GetDouble(), 6);
        }

        // The suggestion is the grid's profit-maximising point: the best contribution after the
        // retail variable costs (the current $1.75 is itself a grid point), never a bracket ceiling.
        var suggested = s.GetProperty("suggested").GetDecimal();
        var rate = world.Rules.Market.RetailVariableRate;
        var best = points
            .Select(p => (Price: p.GetProperty("price").GetDecimal(), Value: (decimal)p.GetProperty("units").GetDouble() * (p.GetProperty("price").GetDecimal() * (1m - rate) - 1.232m)))
            .OrderByDescending(p => p.Value).ThenBy(p => p.Price).First();
        Assert.True(best.Value > 0);
        Assert.Equal(best.Price, suggested);
        Assert.InRange(suggested, 1.4m, 2.8m);   // within 0.8–1.6 × Pref, above the landed cost

        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("suggestPrice", new { buildingId = cheap, slotIndex = 3 }).Code);
        var warehouse = bridge.Build("warehouse_small", "riverside", new { productId = "soft_drink", targetStock = 10.0 });
        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("suggestPrice", new { buildingId = warehouse, slotIndex = 0 }).Code);
    }

    [Fact]
    public void Duplicate_slots_merge_into_one_line_and_rivals_show()
    {
        var bridge = Bridge.Custom(seed: 5, playerCash: 80_000_000m, ("Rival", "simple"));
        var store = bridge.Supermarket("bread", 3.20m, 40_000, "hilltown");
        bridge.Call("configureSlot", new { buildingId = store, slotIndex = 1, productId = "bread", price = 3.20, restockTarget = 40_000 });
        var rivalId = bridge.World.Companies.Values.Single(c => c.Name == "Rival").Id;
        var rivalStore = bridge.World.Construct(rivalId, new BuildingTypeId("supermarket"), new CityId("hilltown"));
        bridge.World.ConfigureRetailSlot(rivalStore.Id, 0, new ProductId("bread"), 2.90m, 40_000);
        bridge.Advance(1);
        var detail = bridge.Call("marketDetail", new { cityId = "hilltown", productId = "bread" });
        var rows = detail.GetProperty("retailers").EnumerateArray().ToList();
        // One row per store line: the player's two bread slots are one offer (econ-audit F7).
        Assert.Contains(rows, r => r.GetProperty("buildingId").GetInt32() == store);
        Assert.Single(rows, r => r.GetProperty("isPlayer").GetBoolean());
        var theirs = rows.Single(r => r.GetProperty("buildingId").GetInt32() == rivalStore.Id.Value);
        Assert.Equal(2.9m, theirs.GetProperty("price").GetDecimal());
        Assert.Equal("Rival", theirs.GetProperty("ownerName").GetString());
        var shares = rows.Sum(r => r.GetProperty("modelShare").GetDouble()) + detail.GetProperty("incumbent").GetProperty("modelShare").GetDouble();
        Assert.Equal(1.0, shares, 5);   // each share is reported to 6 decimals

        var slot = bridge.Call("building", new { buildingId = store }).GetProperty("slots")[0].GetProperty("retail");
        Assert.True(slot.GetProperty("rivalCount").GetInt32() >= 1);
    }
}
