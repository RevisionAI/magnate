using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>City view with visual deltas, world map, supply flows and the build preview (GameSession.City.cs, bridge-spec §5.5).</summary>
public class CityTests
{
    private static Dictionary<int, JsonElement> ById(JsonElement view)
        => view.GetProperty("buildings").EnumerateArray().ToDictionary(b => b.GetProperty("id").GetInt32());

    [Fact]
    public void City_view_serves_full_lists_then_deltas_by_revision()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket();
        var full = bridge.Call("cityView", new { cityId = "metropolis" });
        Assert.True(full.GetProperty("full").GetBoolean());
        var visual = ById(full)[store];
        Assert.Equal(0, visual.GetProperty("colorIndex").GetInt32());
        Assert.True(visual.GetProperty("isPlayer").GetBoolean());
        Assert.Equal("#2F7DE1", visual.GetProperty("color").GetString());
        Assert.Equal("operating", visual.GetProperty("status").GetString());
        Assert.Equal("retail", visual.GetProperty("slotKind").GetString());
        Assert.Equal(new[] { "soft_drink" }, visual.GetProperty("products").EnumerateArray().Select(p => p.GetString()));
        Assert.Equal(3, visual.GetProperty("footprintW").GetInt32());
        Assert.Equal("auto", visual.GetProperty("placement").GetProperty("source").GetString());
        var since = full.GetProperty("revision").GetInt64();

        // Nothing visible changed: an empty delta.
        var none = bridge.Call("cityView", new { cityId = "metropolis", since });
        Assert.False(none.GetProperty("full").GetBoolean());
        Assert.Equal(0, none.GetProperty("buildings").GetArrayLength());
        Assert.Equal(0, none.GetProperty("removedIds").GetArrayLength());

        // A price change bumps the revision but not the look of the building.
        bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 1.5 });
        var priceOnly = bridge.Call("cityView", new { cityId = "metropolis", since = none.GetProperty("revision").GetInt64() });
        Assert.False(priceOnly.GetProperty("full").GetBoolean());
        Assert.Equal(0, priceOnly.GetProperty("buildings").GetArrayLength());

        // New signage and a new building are upserts.
        bridge.Call("configureSlot", new { buildingId = store, slotIndex = 1, productId = "bread", price = 3, restockTarget = 1000 });
        var kiosk = bridge.Build("convenience_store", "metropolis", new { productId = "beer", price = 4, restockTarget = 100 });
        bridge.Build("convenience_store", "hilltown");
        var delta = bridge.Call("cityView", new { cityId = "metropolis", since = priceOnly.GetProperty("revision").GetInt64() });
        Assert.False(delta.GetProperty("full").GetBoolean());
        var upserts = ById(delta);
        Assert.Equal(new[] { store, kiosk }, upserts.Keys.OrderBy(k => k));
        Assert.Equal(new[] { "soft_drink", "bread" }, upserts[store].GetProperty("products").EnumerateArray().Select(p => p.GetString()));
        Assert.NotEqual(visual.GetProperty("visualRev").GetUInt32(), upserts[store].GetProperty("visualRev").GetUInt32());

        // An unknown or stale `since` falls back to a full list; activity is always complete.
        var stale = bridge.Call("cityView", new { cityId = "metropolis", since = 1 });
        Assert.True(stale.GetProperty("full").GetBoolean());
        Assert.Equal(stale.GetProperty("buildings").GetArrayLength(), stale.GetProperty("activity").GetProperty("ids").GetArrayLength());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("cityView", new { cityId = "atlantis" }).Code);
    }

    [Fact]
    public void Visual_revisions_change_only_with_looks_and_activity_is_columnar()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket("soft_drink", 2.0m, 50_000);
        var factory = bridge.Build("factory_small", "metropolis", new { productId = "flour" });
        bridge.Call("setAutoExport", new { buildingId = factory, enabled = true }); // E1 (D7): off by default
        var first = ById(bridge.Call("cityView", new { cityId = "metropolis" }));
        bridge.Advance(1);
        var second = ById(bridge.Call("cityView", new { cityId = "metropolis" }));
        Assert.Equal(first[store].GetProperty("visualRev").GetUInt32(), second[store].GetProperty("visualRev").GetUInt32());

        bridge.Call("upgradeBuilding", new { buildingId = store });
        var view = bridge.Call("cityView", new { cityId = "metropolis" });
        var third = ById(view);
        Assert.Equal(2, third[store].GetProperty("level").GetInt32());
        Assert.NotEqual(second[store].GetProperty("visualRev").GetUInt32(), third[store].GetProperty("visualRev").GetUInt32());
        Assert.Equal(second[factory].GetProperty("visualRev").GetUInt32(), third[factory].GetProperty("visualRev").GetUInt32());

        var activity = view.GetProperty("activity");
        var ids = activity.GetProperty("ids").EnumerateArray().Select(i => i.GetInt32()).ToList();
        foreach (var column in new[] { "revenue", "unitsSold", "exportUnits", "netIncome", "utilization", "transfersIn", "transfersOut" })
        {
            Assert.Equal(ids.Count, activity.GetProperty(column).GetArrayLength());
        }
        var s = ids.IndexOf(store);
        var f = ids.IndexOf(factory);
        Assert.True(activity.GetProperty("unitsSold")[s].GetDouble() > 0);
        Assert.Equal(JsonValueKind.Null, activity.GetProperty("utilization")[s].ValueKind); // not a producer
        Assert.True(activity.GetProperty("exportUnits")[f].GetDouble() > 0);
        Assert.InRange(activity.GetProperty("utilization")[f].GetDouble(), 0.0, 1.0);
    }

    [Fact]
    public void Auto_placement_is_deterministic_legal_and_ring_aware()
    {
        var a = Bridge.Custom(seed: 3, playerCash: 500_000_000m);
        var b = Bridge.Custom(seed: 3, playerCash: 500_000_000m);
        var types = new[]
        {
            "supermarket", "small_farm", "factory_small", "convenience_store", "warehouse_large", "rd_center", "large_farm",
            "department_store", "radio_station", "factory_large", "small_plantation", "warehouse_small", "seaport",
        };
        foreach (var t in types)
        {
            a.Build(t, "metropolis");
            b.Build(t, "metropolis");
        }

        var placements = a.Call("buildings", new { cityId = "metropolis" }).EnumerateArray().ToList();
        var again = b.Call("buildings", new { cityId = "metropolis" }).EnumerateArray().ToList();
        Assert.Equal(placements.Select(p => p.GetProperty("placement").GetRawText()), again.Select(p => p.GetProperty("placement").GetRawText()));

        var catalog = a.Session.Catalog;
        var occupied = new HashSet<(int, int)>();
        var grid = catalog.City(new CityId("metropolis")).Grid;
        foreach (var row in placements)
        {
            var type = catalog.BuildingType(new BuildingTypeId(row.GetProperty("typeId").GetString()!));
            var p = row.GetProperty("placement");
            Assert.Equal("auto", p.GetProperty("source").GetString());
            var (px, pz) = (p.GetProperty("px").GetInt32(), p.GetProperty("pz").GetInt32());
            Assert.InRange(px, 0, grid.Width - type.Footprint.Width);
            Assert.InRange(pz, 0, grid.Height - type.Footprint.Height);
            for (var x = px; x < px + type.Footprint.Width; x++)
            {
                for (var z = pz; z < pz + type.Footprint.Height; z++)
                {
                    Assert.True(occupied.Add((x, z)), $"{row.GetProperty("typeId")} overlaps at {x},{z}");
                    Assert.False(PlacementModel.IsRoad(x, z), $"{row.GetProperty("typeId")} sits on a road at {x},{z}");
                }
            }
        }

        double Ring(JsonElement row)
        {
            var type = catalog.BuildingType(new BuildingTypeId(row.GetProperty("typeId").GetString()!));
            var p = row.GetProperty("placement");
            var cx = p.GetProperty("px").GetInt32() + type.Footprint.Width / 2.0;
            var cz = p.GetProperty("pz").GetInt32() + type.Footprint.Height / 2.0;
            return Math.Max(Math.Abs(cx - grid.Width / 2.0), Math.Abs(cz - grid.Height / 2.0)) / (grid.Width / 2.0);
        }
        var byType = placements.ToDictionary(p => p.GetProperty("typeId").GetString()!);
        Assert.True(Ring(byType["supermarket"]) < 0.45);
        Assert.True(Ring(byType["convenience_store"]) < 0.45);
        Assert.True(Ring(byType["small_farm"]) >= 0.6);
        Assert.InRange(Ring(byType["factory_small"]), 0.35, 0.8);
        // Coastal city: the seaport sits on the south band.
        var port = byType["seaport"].GetProperty("placement");
        Assert.True(port.GetProperty("pz").GetInt32() + 3 >= grid.Height - PlacementModel.RoadEvery);
    }

    [Fact]
    public void Player_plots_are_validated_against_existing_buildings()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        bridge.Build("supermarket", "hilltown", null, new { px = 1, pz = 1 });
        var taken = bridge.Fail("construct", new { typeId = "convenience_store", cityId = "hilltown", at = new { px = 3, pz = 3 } });
        Assert.Equal(BridgeErrorCodes.PlotOccupied, taken.Code);
        Assert.Equal("occupied", taken.Detail("reason"));
        // The plot next door is free; rotation swaps a non-square footprint.
        bridge.Build("convenience_store", "hilltown", null, new { px = 4, pz = 1 });
        // Rotated 90°, the 5×3 seaport is 3 wide and 5 deep: from pz 2 it crosses the z = 6 road line, from pz 1 it fits.
        var swapped = bridge.Call("previewBuild", new { typeId = "seaport", cityId = "metropolis", at = new { px = 75, pz = 2, rotation = 90 } });
        Assert.Equal("road", swapped.GetProperty("placementIssue").GetString());
        Assert.True(bridge.Call("previewBuild", new { typeId = "seaport", cityId = "metropolis", at = new { px = 75, pz = 1, rotation = 90 } })
            .GetProperty("placementOk").GetBoolean());
        var fits = bridge.Call("previewBuild", new { typeId = "seaport", cityId = "metropolis", at = new { px = 1, pz = 1, rotation = 0 } });
        Assert.True(fits.GetProperty("placementOk").GetBoolean());
    }

    [Fact]
    public void Build_preview_is_a_pure_query()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        bridge.Build("supermarket", "hilltown", null, new { px = 1, pz = 1 });
        var revision = bridge.Revision;
        var cash = bridge.Cash();

        var ok = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" });
        var supermarket = Bridge.Type("supermarket");
        Assert.Equal(supermarket.ConstructionCost, ok.GetProperty("constructionCost").GetDecimal());
        Assert.Equal(supermarket.ConstructionCost, ok.GetProperty("totalCost").GetDecimal());
        Assert.False(ok.TryGetProperty("landCost", out _));
        Assert.Equal(supermarket.Levels![0].MonthlyOperatingCost, ok.GetProperty("monthlyOpex").GetDecimal());
        Assert.Equal(supermarket.Levels[0].Capacity, ok.GetProperty("capacity").GetInt32());
        Assert.True(ok.GetProperty("affordable").GetBoolean());
        Assert.Equal(cash - supermarket.ConstructionCost, ok.GetProperty("cashAfter").GetDecimal());
        Assert.True(ok.GetProperty("geographyOk").GetBoolean());
        Assert.True(ok.GetProperty("placementOk").GetBoolean());
        Assert.Equal("auto", ok.GetProperty("suggestedPlacement").GetProperty("source").GetString());
        Assert.Equal(8, ok.GetProperty("eligibleProductIds").GetArrayLength());

        var oil = bridge.Call("previewBuild", new { typeId = "oil_well", cityId = "hilltown" });
        Assert.False(oil.GetProperty("geographyOk").GetBoolean());
        Assert.Equal(new[] { "oilRich" }, oil.GetProperty("geographyIssues").EnumerateArray().Select(i => i.GetString()));

        var occupied = bridge.Call("previewBuild", new { typeId = "convenience_store", cityId = "hilltown", at = new { px = 2, pz = 2 } });
        Assert.False(occupied.GetProperty("placementOk").GetBoolean());
        Assert.Equal("occupied", occupied.GetProperty("placementIssue").GetString());
        Assert.Equal("outOfBounds", bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "hilltown", at = new { px = 39, pz = 0 } })
            .GetProperty("placementIssue").GetString());

        var poor = Bridge.Custom(playerCash: 2_000_000m);
        var dept = poor.Call("previewBuild", new { typeId = "department_store", cityId = "metropolis" });
        Assert.False(dept.GetProperty("affordable").GetBoolean());
        Assert.Equal(Bridge.Cost("department_store") - 2_000_000m, dept.GetProperty("shortfall").GetDecimal());

        Assert.Equal(revision, bridge.Revision);
        Assert.Equal(cash, bridge.Cash());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("previewBuild", new { typeId = "castle", cityId = "hilltown" }).Code);
    }

    [Fact]
    public void Build_preview_projects_runway_when_burning_cash()
    {
        var bridge = Bridge.Custom(playerCash: Bridge.Cost("rd_center") + 10_000_000m);
        var rd = bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });
        Assert.False(bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" }).TryGetProperty("runwayMonthsAfter", out _));
        bridge.Advance(2);
        // Burning the R&D centre's operating cash (Realistic: its wages, utilities, maintenance,
        // insurance, property tax) averaged over the closed months; a convenience store adds its opex.
        var game = bridge.Session.Game;
        var operating = bridge.World.Ledger.Entries
            .Where(e => e.Company == bridge.Session.PlayerId && e.Date.AsMonthIndex() > game.StartMonth
                && Magnate.Engine.Economics.LedgerCategoryInfo.Of(e.Category).CashFlow == Magnate.Engine.Economics.CashFlowClass.Operating)
            .Sum(e => e.Amount);
        var burn = -operating / (game.Now - game.StartMonth);
        Assert.True(burn >= bridge.BookedOpex(rd, game.Now) - 0.01m);
        var preview = bridge.Call("previewBuild", new { typeId = "convenience_store", cityId = "metropolis" });
        var storeOpex = preview.GetProperty("monthlyOpex").GetDecimal();
        Assert.Equal(Bridge.Type("convenience_store").MonthlyOperatingCost, storeOpex);
        var cashAfter = preview.GetProperty("cashAfter").GetDecimal();
        Assert.Equal((double)Math.Round(cashAfter / (burn + storeOpex), 2), preview.GetProperty("runwayMonthsAfter").GetDouble(), 2);
    }

    [Fact]
    public void World_map_summarises_every_city()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        bridge.Supermarket("soft_drink", 2.0m, 50_000);
        bridge.Build("convenience_store", "hilltown");
        bridge.World.Construct(new CompanyId(2), new BuildingTypeId("supermarket"), new CityId("metropolis"));
        bridge.Advance(1);
        var cities = bridge.Call("worldMap").GetProperty("cities").EnumerateArray().ToList();
        Assert.Equal(new[] { "metropolis", "riverside", "eastside", "portbay", "hilltown" }, cities.Select(c => c.GetProperty("cityId").GetString()));
        var metro = cities[0];
        Assert.True(metro.GetProperty("totalBuildings").GetInt32() >= 2);
        Assert.Equal(1, metro.GetProperty("playerBuildings").GetInt32());
        Assert.Contains(metro.GetProperty("buildingsByOwner").EnumerateArray(), o => o.GetProperty("companyId").GetInt32() == 2);
        Assert.InRange(metro.GetProperty("playerAvgShare").GetDouble(), 0.0001, 1.0);
        var demand = metro.GetProperty("topDemand").EnumerateArray().Select(d => d.GetProperty("quantity").GetDouble()).ToList();
        Assert.Equal(8, demand.Count);
        Assert.Equal(demand.OrderByDescending(d => d), demand);
        Assert.True(metro.GetProperty("geography").GetProperty("coastal").GetBoolean());
        Assert.Equal(80, metro.GetProperty("gridW").GetInt32());
        Assert.Equal(0, cities[4].GetProperty("playerAvgShare").GetDouble()); // a store with nothing to sell
    }

    [Fact]
    public void Supply_flows_trace_transfers_imports_exports_and_retail()
    {
        var bridge = Bridge.Custom(seed: 3);
        var farm = bridge.Build("small_farm", "metropolis", new { productId = "wheat" });
        var mill = bridge.Build("factory_small", "metropolis", new { productId = "flour" });
        var store = bridge.Supermarket("soft_drink", 2.0m, 20_000);
        bridge.Call("setAutoExport", new { buildingId = mill, enabled = true }); // E1 (D7): off by default
        bridge.Advance(1);
        var entries = bridge.World.Ledger.Entries.Where(e => e.Company == bridge.Session.PlayerId).ToList();

        var flows = bridge.Call("supplyFlows", new { cityId = "metropolis" }).GetProperty("flows").EnumerateArray().ToList();
        var transfer = flows.Single(f => f.GetProperty("kind").GetString() == "transfer");
        Assert.Equal(farm, transfer.GetProperty("fromBuildingId").GetInt32());
        Assert.Equal(mill, transfer.GetProperty("toBuildingId").GetInt32());
        Assert.Equal("wheat", transfer.GetProperty("productId").GetString());
        // The farm's month of wheat (one slot's yield), all of it wanted by the mill.
        Assert.Equal(TestContent.Catalog.Products[new ProductId("wheat")].Extraction!.YieldPerSlotPerMonth, transfer.GetProperty("quantity").GetDouble());
        var exported = entries.Where(e => e.Category == Magnate.Engine.Economics.LedgerCategory.ExportSale && e.Product?.Value == "flour").Sum(e => e.Quantity ?? 0);
        Assert.True(exported > 0);
        Assert.Contains(flows, f => f.GetProperty("kind").GetString() == "export" && f.GetProperty("fromBuildingId").GetInt32() == mill
            && f.GetProperty("productId").GetString() == "flour" && f.GetProperty("quantity").GetDouble() == exported);
        Assert.Contains(flows, f => f.GetProperty("kind").GetString() == "import" && f.GetProperty("toBuildingId").GetInt32() == store);
        var retail = flows.Single(f => f.GetProperty("kind").GetString() == "retail");
        // What the store sold (demand with incumbents decides it, E1), at $2.
        var sold = entries.Where(e => e.Category == Magnate.Engine.Economics.LedgerCategory.ProductSale && e.Building?.Value == store).ToList();
        Assert.True(sold.Sum(e => e.Quantity ?? 0) > 0);
        Assert.Equal(sold.Sum(e => e.Quantity ?? 0), retail.GetProperty("quantity").GetDouble());
        Assert.Equal(Math.Round(sold.Sum(e => e.Amount), 2), retail.GetProperty("amount").GetDecimal());

        var onlyMill = bridge.Call("supplyFlows", new { buildingId = mill }).GetProperty("flows").EnumerateArray().ToList();
        Assert.All(onlyMill, f => Assert.True(
            (f.TryGetProperty("fromBuildingId", out var from) && from.GetInt32() == mill)
            || (f.TryGetProperty("toBuildingId", out var to) && to.GetInt32() == mill)));
        Assert.Empty(bridge.Call("supplyFlows", new { cityId = "hilltown" }).GetProperty("flows").EnumerateArray());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("supplyFlows", new { buildingId = 999 }).Code);
    }

    // ------------------------------------------------------------------ E3b: plots, land, construction time

    [Fact]
    public void Preview_on_land_quotes_the_auto_site_land_schedule_and_catchment()
    {
        var bridge = Bridge.Game("tutorial", seed: 5, rules: EconomyRules.Realistic);
        var preview = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" });
        decimal D(string name) => preview.GetProperty(name).GetDecimal();

        Assert.True(preview.GetProperty("placementOk").GetBoolean());
        Assert.Equal(0, preview.GetProperty("placementIssues").GetArrayLength());
        Assert.Equal("engine", preview.GetProperty("suggestedPlacement").GetProperty("source").GetString());
        Assert.Equal(4, preview.GetProperty("constructionMonths").GetInt32()); // econ-audit §4.12 table
        Assert.True(D("landCost") > 0m);
        Assert.Equal(D("constructionCost") + D("landCost"), D("totalCost"));
        Assert.Equal(D("landCost") + D("deposit"), D("upfrontCost"));
        Assert.Equal(Math.Round(D("constructionCost") * 0.2m, 2), D("deposit"));
        Assert.True(D("monthlyInstalment") > 0m);
        Assert.True(preview.GetProperty("affordable").GetBoolean());
        var opens = preview.GetProperty("opensAt");
        var start = bridge.World.Clock.Now;
        Assert.Equal(start.AsMonthIndex() + 4, opens.GetProperty("year").GetInt32() * 12 + opens.GetProperty("month").GetInt32() - 1);

        var site = preview.GetProperty("site");
        Assert.InRange(site.GetProperty("locationFactor").GetDouble(), 0.3, 2.5);
        Assert.Contains(site.GetProperty("district").GetString(), new[] { "cbd", "commercial", "mixed" });
        Assert.True(site.GetProperty("parcelIds").GetArrayLength() >= 1);
        var catchment = preview.GetProperty("catchment");
        Assert.Equal(site.GetProperty("locationFactor").GetDouble(), catchment.GetProperty("score").GetDouble());
        Assert.True(catchment.GetProperty("potentialUnitsPerMonth").GetDouble() > 0);
        Assert.Equal(6, catchment.GetProperty("radiusPlots").GetInt32());

        // The same site asked for explicitly prices identically (and skips the city-wide search).
        var spot = preview.GetProperty("suggestedPlacement");
        var at = new { px = spot.GetProperty("px").GetInt32(), pz = spot.GetProperty("pz").GetInt32(), rotation = spot.GetProperty("rotation").GetInt32() };
        var exact = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis", at });
        Assert.True(exact.GetProperty("placementOk").GetBoolean());
        Assert.Equal(D("totalCost"), exact.GetProperty("totalCost").GetDecimal());
        Assert.False(exact.TryGetProperty("suggestedPlacement", out _));
    }

    [Fact]
    public void Preview_on_land_names_every_broken_rule()
    {
        var bridge = Bridge.Game("tutorial", seed: 5, rules: EconomyRules.Realistic);
        var layout = bridge.World.GetCityLayout(new CityId("metropolis"));
        string? Issue(string typeId, (int Px, int Pz) at)
        {
            var preview = bridge.Call("previewBuild", new { typeId, cityId = "metropolis", at = new { px = at.Px, pz = at.Pz } });
            Assert.Equal(!preview.TryGetProperty("placementIssue", out _), preview.GetProperty("placementOk").GetBoolean());
            Assert.True(preview.GetProperty("landCost").ValueKind == JsonValueKind.Number || preview.GetProperty("placementIssue").GetString() == "outOfBounds");
            return preview.TryGetProperty("placementIssue", out var issue) ? issue.GetString() : null;
        }

        Assert.Equal("outOfBounds", Issue("convenience_store", (layout.Width + 3, 0)));
        Assert.Equal("road", Issue("convenience_store", LandSites.Find(layout, (k, _) => k == PlotKind.Road)));
        Assert.Equal("water", Issue("convenience_store", LandSites.Find(layout, (k, _) => k == PlotKind.Water)));
        Assert.Equal("zoning", Issue("convenience_store", LandSites.Find(layout, (k, d) => k == PlotKind.Parcel && d == District.Rural)));
        Assert.Equal("zoning", Issue("factory_small", LandSites.Find(layout, (k, d) => k == PlotKind.Parcel && d == District.Cbd)));

        // No site anywhere: a seaport in an inland city is a geography problem, not a placement one.
        var seaport = bridge.Call("previewBuild", new { typeId = "seaport", cityId = "hilltown" });
        Assert.False(seaport.GetProperty("geographyOk").GetBoolean());
        Assert.False(seaport.GetProperty("placementOk").GetBoolean());
        Assert.False(seaport.TryGetProperty("suggestedPlacement", out _));
    }

    [Fact]
    public void City_view_shows_construction_until_the_building_opens()
    {
        var bridge = Bridge.Game("tutorial", seed: 5, rules: EconomyRules.Realistic);
        var store = bridge.Supermarket();
        var view = bridge.Call("cityView", new { cityId = "metropolis" });
        var visual = ById(view)[store];
        Assert.Equal("underConstruction", visual.GetProperty("status").GetString());
        Assert.Equal("engine", visual.GetProperty("placement").GetProperty("source").GetString());
        var works = visual.GetProperty("construction");
        Assert.Equal(0.0, works.GetProperty("progress").GetDouble());
        Assert.Equal(4, works.GetProperty("monthsTotal").GetInt32());
        Assert.True(works.GetProperty("costRemaining").GetDecimal() > 0m);
        Assert.True(works.GetProperty("cancelRefund").GetDecimal() > 0m);
        var rev = view.GetProperty("layout").GetProperty("layoutRev").GetInt32();
        Assert.True(rev > 1); // the site was taken
        var since = view.GetProperty("revision").GetInt64();

        // One month on: the scaffold moved on (visualRev changed), the store still does not trade.
        bridge.Advance(1);
        var delta = bridge.Call("cityView", new { cityId = "metropolis", since });
        var step = ById(delta)[store];
        Assert.Equal(0.25, step.GetProperty("construction").GetProperty("progress").GetDouble());
        Assert.NotEqual(visual.GetProperty("visualRev").GetUInt32(), step.GetProperty("visualRev").GetUInt32());
        Assert.Equal(0m, bridge.Call("building", new { buildingId = store }).GetProperty("pnl").GetProperty("thisMonth").GetProperty("revenue").GetDecimal());

        // Completion is a month-close event (toast-worthy for the player) and the store opens.
        var tick = bridge.Advance(3);
        var done = tick.GetProperty("events").EnumerateArray().Single(e => e.GetProperty("kind").GetString() == "constructionCompleted"
            && e.GetProperty("buildingId").GetInt32() == store); // rivals' sites complete too
        Assert.True(done.GetProperty("isPlayer").GetBoolean());
        Assert.Equal(2, done.GetProperty("priority").GetInt32());
        Assert.Equal("engine", done.GetProperty("placement").GetProperty("source").GetString());
        var open = ById(bridge.Call("cityView", new { cityId = "metropolis" }))[store];
        Assert.Equal("operating", open.GetProperty("status").GetString());
        Assert.False(open.TryGetProperty("construction", out _));
        var detail = bridge.Call("building", new { buildingId = store });
        Assert.True(detail.TryGetProperty("openedAt", out _));
        Assert.False(detail.TryGetProperty("construction", out _));
    }

    [Fact]
    public void Classic_worlds_keep_the_interim_grid_and_report_no_layout_revision()
    {
        var bridge = Bridge.Game("tutorial", seed: 5, rules: EconomyRules.Classic);
        var store = bridge.Supermarket();
        var view = bridge.Call("cityView", new { cityId = "metropolis" });
        Assert.Equal("auto", ById(view)[store].GetProperty("placement").GetProperty("source").GetString());
        Assert.False(view.TryGetProperty("layout", out _));
        var preview = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" });
        Assert.False(preview.TryGetProperty("landCost", out _));
        Assert.False(preview.TryGetProperty("constructionMonths", out _));
    }
}

/// <summary>Plot finders over a generated layout (E3b tests).</summary>
internal static class LandSites
{
    /// <summary>The first plot (row-major) matching the predicate.</summary>
    public static (int Px, int Pz) Find(CityLayout layout, Func<PlotKind, District, bool> match)
    {
        for (var pz = 0; pz < layout.Height; pz++)
        {
            for (var px = 0; px < layout.Width; px++)
            {
                if (match(layout.KindAt(px, pz), layout.DistrictAt(px, pz))) return (px, pz);
            }
        }
        throw new InvalidOperationException("no matching plot");
    }

    /// <summary>The site <c>construct</c> would auto-pick (previewBuild without <c>at</c>).</summary>
    public static object Suggested(Bridge bridge, string typeId, string cityId = "metropolis")
    {
        var spot = bridge.Call("previewBuild", new { typeId, cityId }).GetProperty("suggestedPlacement");
        return new { px = spot.GetProperty("px").GetInt32(), pz = spot.GetProperty("pz").GetInt32(), rotation = spot.GetProperty("rotation").GetInt32() };
    }
}
