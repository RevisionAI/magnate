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

/// <summary>Building lists, the inspector, atomic construction and every slot command (GameSession.Buildings.cs, bridge-spec §5.5, §4.6.4).</summary>
public class BuildingsTests
{
    private static int RivalBuilding(Bridge bridge, string typeId = "supermarket", string city = "metropolis")
        => bridge.World.Construct(new CompanyId(2), new BuildingTypeId(typeId), new CityId(city)).Id.Value;

    /// <summary>Every rejected construct leaves cash, buildings and the revision exactly as they were.</summary>
    private static BridgeError RejectedConstruct(Bridge bridge, object args)
    {
        var cash = bridge.Cash();
        var count = bridge.World.Buildings.Count;
        var revision = bridge.Revision;
        var error = bridge.Fail("construct", args);
        Assert.Equal(cash, bridge.Cash());
        Assert.Equal(count, bridge.World.Buildings.Count);
        Assert.Equal(revision, error.Revision);
        return error;
    }

    [Fact]
    public void Construct_with_an_invalid_first_slot_is_rejected_before_any_money_moves()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);

        var range = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "soft_drink", slotIndex = 6, price = 2.0, restockTarget = 1000 } });
        Assert.Equal(BridgeErrorCodes.SlotOutOfRange, range.Code);
        Assert.Equal("initialSlot.slotIndex", range.Field);
        Assert.Equal("6", range.Detail("capacity"));

        var unknown = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "unobtainium", price = 2.0, restockTarget = 1000 } });
        Assert.Equal(BridgeErrorCodes.NotFound, unknown.Code);
        Assert.Equal("initialSlot.productId", unknown.Field);
        Assert.Equal("product", unknown.Detail("entityKind"));

        var steel = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "steel", price = 2.0, restockTarget = 1000 } });
        Assert.Equal(BridgeErrorCodes.ProductNotAllowed, steel.Code);
        Assert.Equal("notFinished", steel.Detail("reason"));

        var wrongRaw = RejectedConstruct(bridge, new { typeId = "small_farm", cityId = "metropolis", initialSlot = new { productId = "crude_oil" } });
        Assert.Equal(BridgeErrorCodes.ProductNotAllowed, wrongRaw.Code);
        Assert.Equal("wrongSourceCategory", wrongRaw.Detail("reason"));

        var media = RejectedConstruct(bridge, new { typeId = "radio_station", cityId = "metropolis", initialSlot = new { productId = "soft_drink" } });
        Assert.Equal(BridgeErrorCodes.SlotKindUnsupported, media.Code);

        var noPrice = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "soft_drink", restockTarget = 1000 } });
        Assert.Equal(BridgeErrorCodes.BadRequest, noPrice.Code);
        Assert.Equal("initialSlot.price", noPrice.Field);

        var badPrice = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "soft_drink", price = -1, restockTarget = 1000 } });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, badPrice.Code);
        Assert.Equal("initialSlot.price", badPrice.Field);

        var zeroRestock = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "metropolis", initialSlot = new { productId = "soft_drink", price = 2, restockTarget = 0 } });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, zeroRestock.Code);
        Assert.Equal("initialSlot.restockTarget", zeroRestock.Field);

        var noTarget = RejectedConstruct(bridge, new { typeId = "warehouse_small", cityId = "metropolis", initialSlot = new { productId = "bread" } });
        Assert.Equal("initialSlot.targetStock", noTarget.Field);
    }

    [Fact]
    public void Construct_checks_type_city_geography_placement_and_cash_first()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var type = RejectedConstruct(bridge, new { typeId = "castle", cityId = "metropolis" });
        Assert.Equal(BridgeErrorCodes.NotFound, type.Code);
        Assert.Equal("buildingType", type.Detail("entityKind"));
        Assert.Equal("typeId", type.Field);

        var city = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "atlantis" });
        Assert.Equal("city", city.Detail("entityKind"));

        // E6: the engine does not enforce geography yet, the facade does.
        var oil = RejectedConstruct(bridge, new { typeId = "oil_well", cityId = "hilltown" });
        Assert.Equal(BridgeErrorCodes.GeographyMismatch, oil.Code);
        Assert.Equal("oilRich", oil.Detail("reason"));
        Assert.Equal(BridgeErrorCodes.GeographyMismatch, RejectedConstruct(bridge, new { typeId = "seaport", cityId = "riverside" }).Code);
        Assert.Equal(BridgeErrorCodes.GeographyMismatch, RejectedConstruct(bridge, new { typeId = "small_farm", cityId = "portbay" }).Code);

        var outside = RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "hilltown", at = new { px = 38, pz = 1 } });
        Assert.Equal(BridgeErrorCodes.PlotOutOfBounds, outside.Code);
        Assert.Equal("at.px", outside.Field);
        var road = RejectedConstruct(bridge, new { typeId = "convenience_store", cityId = "hilltown", at = new { px = 6, pz = 1 } });
        Assert.Equal(BridgeErrorCodes.PlotOccupied, road.Code);
        Assert.Equal("road", road.Detail("reason"));
        Assert.Equal(BridgeErrorCodes.InvalidArgument, RejectedConstruct(bridge, new { typeId = "supermarket", cityId = "hilltown", at = new { px = 1, pz = 1, rotation = 45 } }).Code);

        var poor = Bridge.Custom(playerCash: 1_000_000m);
        var funds = RejectedConstruct(poor, new { typeId = "department_store", cityId = "metropolis", initialSlot = new { productId = "bread", price = 3, restockTarget = 100 } });
        Assert.Equal(BridgeErrorCodes.InsufficientFunds, funds.Code);
        var required = Bridge.Cost("department_store");
        Assert.Equal(required, decimal.Parse(funds.Detail("required")!, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(1_000_000m, decimal.Parse(funds.Detail("available")!, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(required - 1_000_000m, decimal.Parse(funds.Detail("shortfall")!, System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public void Construct_builds_configures_and_places_in_one_step()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var before = bridge.Cash();
        var row = bridge.Call("construct", new
        {
            typeId = "supermarket",
            cityId = "hilltown",
            initialSlot = new { productId = "soft_drink", slotIndex = 2, price = 1.955, restockTarget = 30_000 },
            at = new { px = 7, pz = 13, rotation = 90 },
        });
        var events = bridge.EnvelopeEvents();
        Assert.Equal(before - Bridge.Cost("supermarket"), bridge.Cash());
        Assert.Equal("operating", row.GetProperty("status").GetString());
        Assert.Equal(1, row.GetProperty("configuredSlots").GetInt32());
        Assert.Equal(new[] { "soft_drink" }, row.GetProperty("products").EnumerateArray().Select(p => p.GetString()));
        var placement = row.GetProperty("placement");
        Assert.Equal(7, placement.GetProperty("px").GetInt32());
        Assert.Equal(90, placement.GetProperty("rotation").GetInt32());
        Assert.Equal("bridge", placement.GetProperty("source").GetString());

        var built = events.Single(e => e.GetProperty("kind").GetString() == "buildingConstructed");
        Assert.Equal(row.GetProperty("id").GetInt32(), built.GetProperty("buildingId").GetInt32());
        Assert.True(built.GetProperty("isPlayer").GetBoolean());
        Assert.Equal("bridge", built.GetProperty("placement").GetProperty("source").GetString());

        var slot = bridge.World.Buildings[new BuildingInstanceId(row.GetProperty("id").GetInt32())].RetailSlots.Single();
        Assert.Equal(2, slot.Index);
        Assert.Equal(1.96m, slot.Price); // half-even to cents: 1.955 → 1.96 (the 6 is even)
    }

    [Fact]
    public void Slot_commands_validate_in_spec_order()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket();
        var rival = RivalBuilding(bridge);
        var radio = bridge.Build("radio_station");

        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("configureSlot", new { buildingId = 999, slotIndex = 0, productId = "bread", price = 3, restockTarget = 10 }).Code);
        var owner = bridge.Fail("configureSlot", new { buildingId = rival, slotIndex = 0, productId = "bread", price = 3, restockTarget = 10 });
        Assert.Equal(BridgeErrorCodes.NotOwner, owner.Code);
        Assert.Equal("building", owner.Detail("entityKind"));
        var range = bridge.Fail("configureSlot", new { buildingId = store, slotIndex = 6, productId = "bread", price = 3, restockTarget = 10 });
        Assert.Equal(BridgeErrorCodes.SlotOutOfRange, range.Code);
        Assert.Equal("slotIndex", range.Field);
        Assert.Equal(BridgeErrorCodes.SlotKindUnsupported, bridge.Fail("configureSlot", new { buildingId = radio, slotIndex = 0, productId = "bread" }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("configureSlot", new { buildingId = store, slotIndex = 1, productId = "nope", price = 3, restockTarget = 10 }).Code);
        Assert.Equal(BridgeErrorCodes.ProductNotAllowed, bridge.Fail("configureSlot", new { buildingId = store, slotIndex = 1, productId = "flour", price = 3, restockTarget = 10 }).Code);
        var price = bridge.Fail("configureSlot", new { buildingId = store, slotIndex = 1, productId = "bread", price = 2_000_000_000, restockTarget = 10 });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, price.Code);
        Assert.Equal("price", price.Field);
        Assert.Equal("1000000000", price.Detail("max"));
    }

    [Fact]
    public void Reconfiguring_replaces_a_different_product_and_keeps_values_for_the_same_one()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket("soft_drink", 2.10m, 40_000);

        var same = bridge.Call("configureSlot", new { buildingId = store, slotIndex = 0, productId = "soft_drink" });
        Assert.Equal(2.10m, same.GetProperty("retail").GetProperty("price").GetDecimal());
        Assert.Equal(40_000, same.GetProperty("retail").GetProperty("restockTarget").GetDouble());
        Assert.False(same.TryGetProperty("replacedProductId", out _));

        var replaced = bridge.Call("configureSlot", new { buildingId = store, slotIndex = 0, productId = "bread", price = 3.5, restockTarget = 20_000 });
        Assert.Equal("soft_drink", replaced.GetProperty("replacedProductId").GetString());
        Assert.Equal("bread", replaced.GetProperty("productId").GetString());
        Assert.Equal("retail", replaced.GetProperty("kind").GetString());
        var b = bridge.World.Buildings[new BuildingInstanceId(store)];
        Assert.Equal("bread", b.RetailSlots.Single().Product.Value);

        // A different product needs its own values.
        Assert.Equal("price", bridge.Fail("configureSlot", new { buildingId = store, slotIndex = 0, productId = "t_shirt" }).Field);
    }

    [Fact]
    public void Clear_slot_and_slot_setters()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket("soft_drink", 2.00m, 40_000);
        var warehouse = bridge.Build("warehouse_small", "metropolis", new { productId = "bread", targetStock = 10_000.0 });

        // Price: half-even to cents, event only when it changes.
        var priced = bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 2.345 });
        Assert.Equal(2.34m, priced.GetProperty("retail").GetProperty("price").GetDecimal());
        var change = bridge.EnvelopeEvents().Single(e => e.GetProperty("kind").GetString() == "priceChanged");
        Assert.Equal(2.00m, change.GetProperty("oldValue").GetDecimal());
        Assert.Equal(2.34m, change.GetProperty("newValue").GetDecimal());
        bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 2.34 });
        Assert.DoesNotContain(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "priceChanged");
        Assert.Equal("price", bridge.Fail("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 0 }).Field);
        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("setRetailPrice", new { buildingId = store, slotIndex = 3, price = 1 }).Code);
        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("setRetailPrice", new { buildingId = warehouse, slotIndex = 0, price = 1 }).Code);

        // Targets: the Godot spin boxes allowed 0, which the engine rejects; the facade refuses it up front.
        Assert.Equal(55_000, bridge.Call("setRestockTarget", new { buildingId = store, slotIndex = 0, restockTarget = 55_000 })
            .GetProperty("retail").GetProperty("restockTarget").GetDouble());
        Assert.Equal("restockTarget", bridge.Fail("setRestockTarget", new { buildingId = store, slotIndex = 0, restockTarget = 0 }).Field);
        Assert.Equal(12_500, bridge.Call("setWarehouseTarget", new { buildingId = warehouse, slotIndex = 0, targetStock = 12_500 })
            .GetProperty("warehouse").GetProperty("targetStock").GetDouble());
        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("setWarehouseTarget", new { buildingId = store, slotIndex = 0, targetStock = 5 }).Code);
        Assert.Equal("targetStock", bridge.Fail("setWarehouseTarget", new { buildingId = warehouse, slotIndex = 0, targetStock = -5 }).Field);

        var cleared = bridge.Call("clearSlot", new { buildingId = store, slotIndex = 0 });
        Assert.Equal("idle", cleared.GetProperty("status").GetString());
        Assert.Equal(0, cleared.GetProperty("configuredSlots").GetInt32());
        Assert.Contains(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "slotCleared");
        Assert.Equal(BridgeErrorCodes.SlotEmpty, bridge.Fail("clearSlot", new { buildingId = store, slotIndex = 0 }).Code);
        Assert.Equal(1, bridge.Call("snapshot").GetProperty("player").GetProperty("idleBuildings").GetInt32());
    }

    [Fact]
    public void Auto_export_toggles_only_on_the_players_buildings()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var factory = bridge.Build("factory_small", "metropolis", new { productId = "flour" });
        var rival = RivalBuilding(bridge, "factory_small");
        // E1 (D7): new buildings start with auto-export off; the player opts in.
        Assert.False(bridge.Call("building", new { buildingId = factory }).GetProperty("autoExport").GetBoolean());
        bridge.Call("setAutoExport", new { buildingId = factory, enabled = true });
        Assert.True(bridge.World.Buildings[new BuildingInstanceId(factory)].AutoExport);
        Assert.True(bridge.Call("building", new { buildingId = factory }).GetProperty("autoExport").GetBoolean());
        bridge.Call("setAutoExport", new { buildingId = factory, enabled = false });
        Assert.False(bridge.World.Buildings[new BuildingInstanceId(factory)].AutoExport);
        Assert.Equal(BridgeErrorCodes.NotOwner, bridge.Fail("setAutoExport", new { buildingId = rival, enabled = false }).Code);
    }

    [Fact]
    public void Upgrades_follow_the_ladder_and_keep_the_books_closed()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket();
        var cash = bridge.Cash();
        var level2 = Bridge.Type("supermarket").Levels![1];
        var built = Bridge.Cost("supermarket") + level2.UpgradeCost;

        var up = bridge.Call("upgradeBuilding", new { buildingId = store });
        Assert.Equal(2, up.GetProperty("level").GetInt32());
        Assert.Equal(9, up.GetProperty("capacity").GetInt32());
        Assert.Equal(level2.MonthlyOperatingCost, up.GetProperty("monthlyOpex").GetDecimal());
        Assert.Equal(level2.UpgradeCost, up.GetProperty("cost").GetDecimal());
        var e = bridge.EnvelopeEvents().Single(x => x.GetProperty("kind").GetString() == "buildingUpgraded");
        Assert.Equal(cash - level2.UpgradeCost, bridge.Cash());
        Assert.Equal(2, e.GetProperty("level").GetInt32());
        Assert.Equal(3, e.GetProperty("maxLevel").GetInt32());

        // E5 landed in the engine (upgrade capex is capitalised): the engine's balance sheet and the
        // facade's ledger-derived book value now agree.
        var sheet = bridge.Call("balanceSheet", new { drilldown = true });
        Assert.True(sheet.GetProperty("booksClose").GetBoolean());
        Assert.Equal(built, sheet.GetProperty("buildingValue").GetDecimal());
        Assert.Equal(built, sheet.GetProperty("engineBuildingValue").GetDecimal());
        var row = sheet.GetProperty("buildings").EnumerateArray().Single();
        Assert.Equal(level2.UpgradeCost, row.GetProperty("upgradeCost").GetDecimal());

        var detail = bridge.Call("building", new { buildingId = store });
        Assert.Equal(9, detail.GetProperty("capacity").GetInt32());
        Assert.Equal(built, detail.GetProperty("bookValue").GetDecimal());
        Assert.Equal(3, detail.GetProperty("upgrade").GetProperty("toLevel").GetInt32());

        bridge.Call("upgradeBuilding", new { buildingId = store });
        var max = bridge.Fail("upgradeBuilding", new { buildingId = store });
        Assert.Equal(BridgeErrorCodes.MaxLevel, max.Code);
        Assert.Equal("3", max.Detail("maxLevel"));
        Assert.False(bridge.Call("building", new { buildingId = store }).TryGetProperty("upgrade", out _));

        var kiosk = bridge.Build("convenience_store");
        Assert.Equal(BridgeErrorCodes.NotUpgradeable, bridge.Fail("upgradeBuilding", new { buildingId = kiosk }).Code);

        // Enough for the store, not for its upgrade.
        var poor = Bridge.Custom(playerCash: Bridge.Cost("supermarket") + level2.UpgradeCost / 2);
        var small = poor.Build("supermarket");
        var funds = poor.Fail("upgradeBuilding", new { buildingId = small });
        Assert.Equal(BridgeErrorCodes.InsufficientFunds, funds.Code);
        Assert.Equal(1, poor.World.Buildings[new BuildingInstanceId(small)].Level);
    }

    [Fact]
    public void The_inspector_shows_level_aware_numbers_pnl_and_supply()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var store = bridge.Supermarket("soft_drink", 2.25m, 60_000);
        bridge.Advance(2);

        var detail = bridge.Call("building", new { buildingId = store });
        Assert.Equal("Supermarket", detail.GetProperty("typeName").GetString());
        Assert.True(detail.GetProperty("isPlayer").GetBoolean());
        Assert.Equal(6, detail.GetProperty("capacity").GetInt32());
        Assert.Equal(1, detail.GetProperty("slotsUsed").GetInt32());
        Assert.Equal(1, detail.GetProperty("nextFreeSlotIndex").GetInt32());
        Assert.Equal(Bridge.Type("supermarket").Levels![0].MonthlyOperatingCost, detail.GetProperty("monthlyOpex").GetDecimal());
        Assert.Equal(new DateDto(2026, 1), JsonSerializer.Deserialize<DateDto>(detail.GetProperty("openedAt").GetRawText(), Bridge.Json));
        Assert.False(detail.GetProperty("autoExportApplies").GetBoolean());

        var slot = detail.GetProperty("slots")[0];
        Assert.Equal("retail", slot.GetProperty("kind").GetString());
        var retail = slot.GetProperty("retail");
        var units = retail.GetProperty("lastMonthUnits").GetDouble();
        Assert.True(units > 0);
        Assert.Equal(Math.Round((decimal)units * 2.25m, 2), retail.GetProperty("lastMonthRevenue").GetDecimal());
        Assert.Equal(2.25m, retail.GetProperty("lastMonthAvgPrice").GetDecimal());
        Assert.True(retail.GetProperty("modelDemandUnits").GetDouble() > 0);

        var pnl = detail.GetProperty("pnl");
        var thisMonth = pnl.GetProperty("thisMonth");
        Assert.Equal(retail.GetProperty("lastMonthRevenue").GetDecimal(), thisMonth.GetProperty("revenue").GetDecimal());
        // Realistic opex is the month's wages, utilities, maintenance, insurance and property tax
        // (E1/E2), not the content's fixed figure: the facade reports what the engine booked.
        var opex = bridge.BookedOpex(store, bridge.Session.Game.Now);
        Assert.True(opex > detail.GetProperty("monthlyOpex").GetDecimal());
        Assert.Equal(Math.Round(opex, 2), thisMonth.GetProperty("opex").GetDecimal());
        // Lines are rounded from exact sums independently, so allow a cent.
        Assert.InRange(
            thisMonth.GetProperty("revenue").GetDecimal() - thisMonth.GetProperty("cogs").GetDecimal() - opex - thisMonth.GetProperty("netIncome").GetDecimal(),
            -0.01m, 0.01m);
        var series = pnl.GetProperty("monthlyNetIncome").GetProperty("values").EnumerateArray().ToList();
        Assert.Equal(12, series.Count);
        Assert.Equal(JsonValueKind.Null, series[0].ValueKind); // before the store opened
        Assert.Equal((double)thisMonth.GetProperty("netIncome").GetDecimal(), series[^1].GetDouble(), 2);
        Assert.Equal(new DateDto(2026, 1), JsonSerializer.Deserialize<DateDto>(pnl.GetProperty("sinceOpen").GetProperty("from").GetRawText(), Bridge.Json));

        var sale = detail.GetProperty("supply").GetProperty("destinations").EnumerateArray().Single();
        Assert.Equal("retailSale", sale.GetProperty("kind").GetString());
        Assert.Equal(units, sale.GetProperty("quantity").GetDouble());
        var purchase = detail.GetProperty("supply").GetProperty("sources").EnumerateArray().Single();
        Assert.Equal("marketPurchase", purchase.GetProperty("kind").GetString());

        // Inventory rows and tier totals describe the same stock.
        var rows = detail.GetProperty("inventory").EnumerateArray().ToList();
        Assert.Equal(rows.Where(r => r.GetProperty("tier").GetString() == "finished").Sum(r => r.GetProperty("quantity").GetDouble()),
            detail.GetProperty("inventoryTotals").GetProperty("finished").GetProperty("units").GetDouble(), 6);
        var actions = detail.GetProperty("actions");
        Assert.True(actions.GetProperty("canUpgrade").GetBoolean());
        Assert.True(actions.GetProperty("canAddSlot").GetBoolean());
        // E2 disposals are live under the (Realistic) finance rules: an operating player building may be sold.
        Assert.True(actions.GetProperty("canDemolish").GetBoolean());
        var book = detail.GetProperty("book");
        Assert.Equal(detail.GetProperty("bookValue").GetDecimal(),
            book.GetProperty("grossPpe").GetDecimal() - book.GetProperty("accumulatedDepreciation").GetDecimal()
            + book.GetProperty("land").GetDecimal() + book.GetProperty("constructionInProgress").GetDecimal());
        Assert.Equal(8, actions.GetProperty("eligibleProductIds").GetArrayLength());

        // A rival's building is inspectable, never commandable.
        var rival = RivalBuilding(bridge);
        var theirs = bridge.Call("building", new { buildingId = rival });
        Assert.False(theirs.GetProperty("isPlayer").GetBoolean());
        Assert.False(theirs.GetProperty("actions").GetProperty("canConfigure").GetBoolean());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("building", new { buildingId = 404 }).Code);
    }

    [Fact]
    public void Production_slots_predict_input_sources_in_the_engines_order()
    {
        // Three factories and a farm at real capex.
        var bridge = Bridge.Custom(seed: 5, playerCash: 3 * Bridge.Cost("factory_small") + Bridge.Cost("small_farm"));
        var flourMill = bridge.Build("factory_small", "riverside", new { productId = "flour" });
        var bakery = bridge.Build("factory_small", "metropolis", new { productId = "bread" });
        var farm = bridge.Build("small_farm", "metropolis", new { productId = "wheat" });

        // Bread needs flour: no own flour producer in Metropolis, so the one in Riverside (other city).
        var input = bridge.Call("building", new { buildingId = bakery }).GetProperty("slots")[0].GetProperty("production").GetProperty("inputs")[0];
        Assert.Equal("flour", input.GetProperty("productId").GetString());
        // Per-unit recipes (E1): flour per loaf × the loaves a slot makes a month — the engine's draw.
        var bread = TestContent.Catalog.Products[new ProductId("bread")].Recipe!;
        Assert.Equal(bread.Inputs.Single(i => i.ProductId.Value == "flour").Quantity * bread.CyclesPerSlotMonth, input.GetProperty("perMonth").GetDouble());
        Assert.True(input.GetProperty("perMonth").GetDouble() > 100_000);
        Assert.Equal("ownOtherCity", input.GetProperty("source").GetString());
        Assert.Equal(flourMill, input.GetProperty("sourceBuildingId").GetInt32());

        // Flour needs wheat: the farm is in another city than the mill, still the only own source.
        var wheat = bridge.Call("building", new { buildingId = flourMill }).GetProperty("slots")[0].GetProperty("production").GetProperty("inputs")[0];
        Assert.Equal(farm, wheat.GetProperty("sourceBuildingId").GetInt32());

        // Nothing makes sugar: world market.
        var drinks = bridge.Build("factory_small", "metropolis", new { productId = "soft_drink" });
        var sugar = bridge.Call("building", new { buildingId = drinks }).GetProperty("slots")[0].GetProperty("production").GetProperty("inputs")[0];
        Assert.Equal("worldMarket", sugar.GetProperty("source").GetString());
        Assert.False(sugar.TryGetProperty("sourceBuildingId", out _));
    }

    [Fact]
    public void Building_lists_filter_and_sort()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        bridge.Supermarket();
        bridge.Build("convenience_store", "hilltown", new { productId = "bread", price = 3.0, restockTarget = 5_000 });
        bridge.Build("radio_station");
        bridge.Build("warehouse_small", "metropolis");
        RivalBuilding(bridge, "supermarket", "hilltown");

        var all = bridge.Call("buildings", new { }).EnumerateArray().ToList();
        Assert.Equal(5, all.Count);
        Assert.Equal(all.Select(r => r.GetProperty("id").GetInt32()).OrderBy(i => i), all.Select(r => r.GetProperty("id").GetInt32()));
        Assert.Equal(new[] { "operating", "operating", "passive", "idle", "idle" }, all.Select(r => r.GetProperty("status").GetString()));
        Assert.Equal(3, bridge.Call("buildings", new { cityId = "metropolis" }).GetArrayLength());
        Assert.Equal(4, bridge.Call("buildings", new { ownerId = 1 }).GetArrayLength());
        var byCity = bridge.Call("buildings", new { sort = "city" }).EnumerateArray().Select(r => r.GetProperty("cityId").GetString()).ToList();
        Assert.Equal(byCity.OrderBy(c => c, StringComparer.Ordinal), byCity);
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("buildings", new { sort = "height" }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("buildings", new { ownerId = 99 }).Code);

        var rivalRow = all.Single(r => r.GetProperty("ownerId").GetInt32() == 2);
        Assert.Equal(1, rivalRow.GetProperty("colorIndex").GetInt32());
        Assert.All(all.Where(r => r.GetProperty("ownerId").GetInt32() == 1), r => Assert.Equal(0, r.GetProperty("colorIndex").GetInt32()));
        Assert.Equal("Supermarket #1", all[0].GetProperty("name").GetString());
    }

    [Fact]
    public void Starter_plans_build_in_the_most_populous_city()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        var row = bridge.Call("buildStarterPlan", new { planId = "cornerStore" });
        Assert.Equal("convenience_store", row.GetProperty("typeId").GetString());
        Assert.Equal("metropolis", row.GetProperty("cityId").GetString());
        var slot = bridge.World.Buildings[new BuildingInstanceId(row.GetProperty("id").GetInt32())].RetailSlots.Single();
        Assert.Equal(2.25m, slot.Price);
        Assert.Equal(250_000, slot.RestockTarget);

        var hub = bridge.Call("buildStarterPlan", new { planId = "warehouseHub" });
        Assert.Equal(500_000, bridge.World.Buildings[new BuildingInstanceId(hub.GetProperty("id").GetInt32())].WarehouseSlots.Single().TargetStock);
        var lab = bridge.Call("buildStarterPlan", new { planId = "softDrinkLab" });
        Assert.Single(bridge.World.Buildings[new BuildingInstanceId(lab.GetProperty("id").GetInt32())].ResearchSlots);

        var unknown = bridge.Fail("buildStarterPlan", new { planId = "castle" });
        Assert.Equal(BridgeErrorCodes.NotFound, unknown.Code);
        Assert.Equal("starterPlan", unknown.Detail("entityKind"));
    }

    // ------------------------------------------------------------------ E3b: construct on plots, construction time

    [Fact]
    public void Construct_on_land_buys_the_site_pays_the_deposit_and_opens_later()
    {
        var bridge = Bridge.Game("tutorial", seed: 3, rules: EconomyRules.Realistic);
        var at = LandSites.Suggested(bridge, "supermarket");
        var quote = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis", at });
        var cash = bridge.Cash();

        var row = bridge.Call("construct", new
        {
            typeId = "supermarket",
            cityId = "metropolis",
            at,
            initialSlot = new { productId = "soft_drink", price = 2.0m, restockTarget = 50_000 },
        });
        var id = row.GetProperty("id").GetInt32();
        var started = bridge.EnvelopeEvents().Single(e => e.GetProperty("kind").GetString() == "constructionStarted");
        Assert.Equal(cash - quote.GetProperty("upfrontCost").GetDecimal(), bridge.Cash());
        Assert.Equal("underConstruction", row.GetProperty("status").GetString());
        Assert.Equal("engine", row.GetProperty("placement").GetProperty("source").GetString());
        Assert.Equal(1, row.GetProperty("configuredSlots").GetInt32()); // slots may be pre-configured

        Assert.Equal(id, started.GetProperty("buildingId").GetInt32());
        Assert.Equal(4, started.GetProperty("months").GetInt32());
        Assert.Equal(quote.GetProperty("upfrontCost").GetDecimal(), started.GetProperty("amount").GetDecimal());

        var detail = bridge.Call("building", new { buildingId = id });
        var works = detail.GetProperty("construction");
        Assert.Equal(quote.GetProperty("deposit").GetDecimal(), works.GetProperty("costPaid").GetDecimal());
        Assert.Equal(quote.GetProperty("monthlyInstalment").GetDecimal(), works.GetProperty("nextInstalment").GetDecimal());
        Assert.False(detail.TryGetProperty("openedAt", out _));
        Assert.False(detail.GetProperty("actions").GetProperty("canUpgrade").GetBoolean());
        Assert.Equal(BridgeErrorCodes.UnderConstruction, bridge.Fail("upgradeBuilding", new { buildingId = id }).Code);
        bridge.Call("setRetailPrice", new { buildingId = id, slotIndex = 0, price = 2.1m });

        // The parcel now belongs to the player, the building stands on it, the site is taken.
        var parcels = bridge.Call("parcels", new { cityId = "metropolis", filter = "owned" }).EnumerateArray().ToList();
        Assert.Contains(parcels, p => p.TryGetProperty("buildingId", out var b) && b.GetInt32() == id);
        Assert.Equal("occupied", bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis", at }).GetProperty("placementIssue").GetString());

        // Instalments each month, then it opens and trades.
        var instalment = quote.GetProperty("monthlyInstalment").GetDecimal();
        bridge.Advance(4);
        var ledger = bridge.World.Ledger.Entries.Where(e => e.Building?.Value == id && e.Category == Magnate.Engine.Economics.LedgerCategory.ConstructionPayment).ToList();
        Assert.Equal(1 + 4, ledger.Count); // deposit + four instalments
        Assert.Equal(quote.GetProperty("constructionCost").GetDecimal(), -ledger.Sum(e => e.Amount));
        Assert.Equal(-instalment, ledger[1].Amount);
        var open = bridge.Call("building", new { buildingId = id });
        Assert.False(open.TryGetProperty("construction", out _));
        Assert.True(open.GetProperty("actions").GetProperty("canUpgrade").GetBoolean());
        bridge.Advance(1);
        Assert.True(bridge.Call("building", new { buildingId = id }).GetProperty("pnl").GetProperty("thisMonth").GetProperty("revenue").GetDecimal() > 0m);
        Assert.True(bridge.Call("balanceSheet", new { }).GetProperty("booksClose").GetBoolean());
    }

    [Fact]
    public void Construct_on_land_without_at_takes_the_auto_site()
    {
        var bridge = Bridge.Game("tutorial", seed: 3, rules: EconomyRules.Realistic);
        var suggested = bridge.Call("previewBuild", new { typeId = "factory_small", cityId = "metropolis" }).GetProperty("suggestedPlacement");
        var row = bridge.Call("construct", new { typeId = "factory_small", cityId = "metropolis" });
        var placement = row.GetProperty("placement");
        Assert.Equal(suggested.GetProperty("px").GetInt32(), placement.GetProperty("px").GetInt32());
        Assert.Equal(suggested.GetProperty("pz").GetInt32(), placement.GetProperty("pz").GetInt32());
        Assert.Equal(suggested.GetProperty("rotation").GetInt32(), placement.GetProperty("rotation").GetInt32());
    }

    [Fact]
    public void Construct_at_a_bad_site_is_refused_before_anything_changes()
    {
        var bridge = Bridge.Game("tutorial", seed: 3, rules: EconomyRules.Realistic);
        var layout = bridge.World.GetCityLayout(new CityId("metropolis"));
        var cash = bridge.Cash();
        var buildings = bridge.World.Buildings.Count;

        BridgeError Refused(string typeId, (int Px, int Pz) at)
        {
            var error = bridge.Fail("construct", new { typeId, cityId = "metropolis", at = new { px = at.Px, pz = at.Pz } });
            Assert.Equal("at.px", error.Field);
            return error;
        }
        var road = Refused("convenience_store", LandSites.Find(layout, (k, _) => k == PlotKind.Road));
        Assert.Equal((BridgeErrorCodes.PlotOccupied, "road"), (road.Code, road.Detail("reason")));
        var outside = Refused("convenience_store", (layout.Width, layout.Height));
        Assert.Equal(BridgeErrorCodes.PlotOutOfBounds, outside.Code);
        var rural = Refused("convenience_store", LandSites.Find(layout, (k, d) => k == PlotKind.Parcel && d == District.Rural));
        Assert.Equal((BridgeErrorCodes.ZoningForbidden, "zoning"), (rural.Code, rural.Detail("reason")));
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("construct", new { typeId = "convenience_store", cityId = "metropolis", at = new { px = 1, pz = 1, rotation = 45 } }).Code);

        // Taken by the player's own building: occupied.
        var at = LandSites.Suggested(bridge, "convenience_store");
        bridge.Call("construct", new { typeId = "convenience_store", cityId = "metropolis", at });
        var taken = bridge.Fail("construct", new { typeId = "convenience_store", cityId = "metropolis", at });
        Assert.Equal((BridgeErrorCodes.PlotOccupied, "occupied"), (taken.Code, taken.Detail("reason")));
        Assert.Equal(buildings + 1, bridge.World.Buildings.Count);
        Assert.True(bridge.Cash() < cash);
    }

    [Fact]
    public void Construct_on_land_needs_the_upfront_cost_only()
    {
        var bridge = Bridge.CustomOn(EconomyRules.Realistic, playerCash: 400_000m);
        var preview = bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis" });
        Assert.False(preview.GetProperty("affordable").GetBoolean()); // land + 20% of $1.2M is out of reach
        var error = bridge.Fail("construct", new { typeId = "supermarket", cityId = "metropolis", at = LandSites.Suggested(bridge, "supermarket") });
        Assert.Equal(BridgeErrorCodes.InsufficientFunds, error.Code);

        // A convenience store's deposit and land fit, although its full cost would not leave much.
        var store = bridge.Call("previewBuild", new { typeId = "convenience_store", cityId = "metropolis" });
        Assert.True(store.GetProperty("affordable").GetBoolean());
        bridge.Call("construct", new { typeId = "convenience_store", cityId = "metropolis" });
        Assert.Equal(400_000m - store.GetProperty("upfrontCost").GetDecimal(), bridge.Cash());
    }

    [Fact]
    public void Cancel_construction_refunds_what_was_quoted_and_frees_the_site()
    {
        var bridge = Bridge.Game("tutorial", seed: 3, rules: EconomyRules.Realistic);
        var at = LandSites.Suggested(bridge, "supermarket");
        var id = bridge.Call("construct", new { typeId = "supermarket", cityId = "metropolis", at }).GetProperty("id").GetInt32();
        bridge.Advance(1);
        var view = bridge.Call("cityView", new { cityId = "metropolis" });
        var since = view.GetProperty("revision").GetInt64();
        var refund = bridge.Call("building", new { buildingId = id }).GetProperty("construction").GetProperty("cancelRefund").GetDecimal();
        var cash = bridge.Cash();

        var result = bridge.Call("cancelConstruction", new { buildingId = id });
        var demolished = bridge.EnvelopeEvents().Single(e => e.GetProperty("kind").GetString() == "buildingDemolished");
        Assert.Equal(refund, result.GetProperty("proceeds").GetDecimal());
        Assert.Equal(cash + refund, bridge.Cash());
        Assert.True(result.GetProperty("gainOrLoss").GetDecimal() < 0m); // half the works are written off
        Assert.Equal("constructionCancelled", demolished.GetProperty("reason").GetString());

        Assert.DoesNotContain(bridge.Call("buildings", new { }).EnumerateArray(), b => b.GetProperty("id").GetInt32() == id);
        var delta = bridge.Call("cityView", new { cityId = "metropolis", since });
        Assert.Contains(id, delta.GetProperty("removedIds").EnumerateArray().Select(e => e.GetInt32()));
        Assert.True(bridge.Call("previewBuild", new { typeId = "supermarket", cityId = "metropolis", at }).GetProperty("placementOk").GetBoolean());
        // One retirement model (integration): a cancelled site leaves World.Buildings for
        // RetiredBuildings, like a sold building, so cancelling it again finds nothing.
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("cancelConstruction", new { buildingId = id }).Code);
        Assert.Equal(BridgeErrorCodes.NotOwner, bridge.Fail("cancelConstruction", new { buildingId = RivalBuilding(bridge) }).Code);
    }

    [Fact]
    public void Construction_survives_save_and_load_through_the_bridge()
    {
        var bridge = Bridge.Game("tutorial", seed: 3, rules: EconomyRules.Realistic);
        var id = bridge.Supermarket();
        bridge.Advance(2);
        var before = bridge.Call("building", new { buildingId = id });
        var layoutBefore = bridge.Call("cityLayout", new { cityId = "metropolis" });
        var data = bridge.Call("saveGame").GetProperty("data").GetString();

        bridge.Call("newGame", new { scenarioId = "sandbox", seed = 1 });
        bridge.Call("loadGame", new { data });
        var after = bridge.Call("building", new { buildingId = id });
        Assert.Equal(before.GetProperty("construction").GetRawText(), after.GetProperty("construction").GetRawText());
        Assert.Equal(before.GetProperty("placement").GetRawText(), after.GetProperty("placement").GetRawText());
        var layoutAfter = bridge.Call("cityLayout", new { cityId = "metropolis" });
        Assert.Equal(layoutBefore.GetProperty("layoutRev").GetInt32(), layoutAfter.GetProperty("layoutRev").GetInt32());
        Assert.Equal(layoutBefore.GetProperty("seed").GetInt32(), layoutAfter.GetProperty("seed").GetInt32());
        Assert.Equal(layoutBefore.GetProperty("parcels").GetRawText(), layoutAfter.GetProperty("parcels").GetRawText());

        // It completes on schedule after the load.
        var tick = bridge.Advance(2);
        Assert.Contains(tick.GetProperty("events").EnumerateArray(), e => e.GetProperty("kind").GetString() == "constructionCompleted" && e.GetProperty("buildingId").GetInt32() == id);
    }
}
