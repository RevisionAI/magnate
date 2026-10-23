using System;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Research and patents (GameSession.Research.cs, bridge-spec §5.7).</summary>
public class ResearchTests
{
    private static JsonElement Node(Bridge bridge, string product)
        => bridge.Call("researchTree").GetProperty("nodes").EnumerateArray().Single(n => n.GetProperty("productId").GetString() == product);

    /// <summary>
    /// The player one level short of max soft-drink tech with a full R&amp;D center on it
    /// (4 slots × 100 points vs a 700-point threshold): the patent lands in two months.
    /// </summary>
    private static (Bridge Bridge, int Lab) NearPatent(params (string, string)[] rivals)
    {
        var bridge = Bridge.Custom(seed: 9, playerCash: 50_000_000m, rivals);
        bridge.World.SetTech(new CompanyId(1), new ProductId("soft_drink"), 7);
        var lab = bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });
        for (var i = 1; i < 4; i++) bridge.Call("configureSlot", new { buildingId = lab, slotIndex = i, productId = "soft_drink" });
        return (bridge, lab);
    }

    [Fact]
    public void The_tree_shows_progress_thresholds_and_etas()
    {
        var bridge = Bridge.Custom();
        var fresh = Node(bridge, "bread");
        Assert.Equal(1, fresh.GetProperty("tech").GetInt32());
        Assert.Equal(7, fresh.GetProperty("maxTech").GetInt32());
        Assert.Equal(100, fresh.GetProperty("threshold").GetDouble());
        Assert.Equal(0, fresh.GetProperty("researchingSlots").GetInt32());
        Assert.False(fresh.TryGetProperty("etaMonths", out _)); // no points, no ETA
        Assert.True(fresh.GetProperty("affectsRetailDemand").GetBoolean());
        Assert.Equal(new[] { "flour" }, fresh.GetProperty("inputs").EnumerateArray().Select(i => i.GetString()));
        Assert.False(Node(bridge, "flour").GetProperty("affectsRetailDemand").GetBoolean());
        Assert.Contains("bread", Node(bridge, "flour").GetProperty("feedsInto").EnumerateArray().Select(i => i.GetString()));

        var lab = bridge.Build("rd_center", "metropolis", new { productId = "bread" });
        bridge.Call("configureSlot", new { buildingId = lab, slotIndex = 1, productId = "bread" });
        var planned = Node(bridge, "bread");
        Assert.Equal(2, planned.GetProperty("researchingSlots").GetInt32());
        Assert.Equal(200, planned.GetProperty("pointsPerMonth").GetDouble());
        Assert.Equal(1, planned.GetProperty("etaMonths").GetInt32());
        // To max: Σ 100·L for L = 1..6 = 2,100 points at 200 a month.
        Assert.Equal(11, planned.GetProperty("etaToMaxMonths").GetInt32());

        bridge.Advance(1);
        var later = Node(bridge, "bread");
        Assert.Equal(2, later.GetProperty("tech").GetInt32());
        Assert.Equal(100, later.GetProperty("progress").GetDouble()); // 200 points − 100 to reach level 2
        Assert.Equal(200, later.GetProperty("threshold").GetDouble());
        Assert.Equal(1, later.GetProperty("etaMonths").GetInt32());
        var slot = bridge.Call("building", new { buildingId = lab }).GetProperty("slots")[0].GetProperty("research");
        Assert.Equal(2, slot.GetProperty("tech").GetInt32());
        Assert.Equal(200, slot.GetProperty("companyPointsPerMonth").GetDouble());
        Assert.False(slot.GetProperty("blocked").GetBoolean());
        Assert.Contains(bridge.Call("activityFeed", new { kinds = new[] { "techLevelUp" } }).GetProperty("events").EnumerateArray(),
            e => e.GetProperty("productId").GetString() == "bread" && e.GetProperty("level").GetInt32() == 2);
    }

    [Fact]
    public void Reaching_max_tech_first_grants_a_patent_the_player_can_license()
    {
        var (bridge, _) = NearPatent(("Rival", "simple"));
        var tick = bridge.Advance(2);
        var granted = tick.GetProperty("events").EnumerateArray().Single(e => e.GetProperty("kind").GetString() == "patentGranted");
        Assert.True(granted.GetProperty("isPlayer").GetBoolean());
        Assert.Equal(3, granted.GetProperty("priority").GetInt32());
        Assert.Equal(24, granted.GetProperty("months").GetInt32());

        var patents = bridge.Call("patents");
        var mine = patents.GetProperty("mine").EnumerateArray().Single();
        Assert.Equal("soft_drink", mine.GetProperty("productId").GetString());
        Assert.Equal(24, mine.GetProperty("monthsRemaining").GetInt32());
        Assert.Equal(new[] { 2 }, mine.GetProperty("candidates").EnumerateArray().Select(c => c.GetProperty("companyId").GetInt32()));
        Assert.Equal(0.05m, patents.GetProperty("royaltyRate").GetDecimal());
        var node = Node(bridge, "soft_drink");
        Assert.True(node.GetProperty("patent").GetProperty("mine").GetBoolean());
        Assert.Equal(8, node.GetProperty("tech").GetInt32());
        Assert.Equal(0, node.GetProperty("threshold").GetDouble()); // at max tech

        var licensed = bridge.Call("grantLicense", new { licenseeId = 2, productId = "soft_drink" });
        Assert.Contains(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "licenseGranted");
        var row = licensed.GetProperty("mine")[0];
        Assert.Equal(2, row.GetProperty("licensees")[0].GetProperty("companyId").GetInt32());
        Assert.Equal(1, row.GetProperty("licensees")[0].GetProperty("colorIndex").GetInt32());
        Assert.Equal(0, row.GetProperty("candidates").GetArrayLength());

        bridge.Call("revokeLicense", new { licenseeId = 2, productId = "soft_drink" });
        Assert.Contains(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "licenseRevoked");
        bridge.Call("revokeLicense", new { licenseeId = 2, productId = "soft_drink" }); // idempotent, no event
        Assert.DoesNotContain(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "licenseRevoked");

        var self = bridge.Fail("grantLicense", new { licenseeId = 1, productId = "soft_drink" });
        Assert.Equal(BridgeErrorCodes.PatentSelfLicense, self.Code);
        Assert.Equal(BridgeErrorCodes.NotPatentHolder, bridge.Fail("grantLicense", new { licenseeId = 2, productId = "bread" }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("grantLicense", new { licenseeId = 42, productId = "soft_drink" }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("revokeLicense", new { licenseeId = 2, productId = "gold" }).Code);
    }

    [Fact]
    public void Patents_expire_after_two_years()
    {
        var (bridge, _) = NearPatent(("Rival", "simple"));
        bridge.Advance(2);
        Assert.Equal(24, bridge.Call("patents").GetProperty("mine")[0].GetProperty("monthsRemaining").GetInt32());
        var expired = bridge.Advance(24).GetProperty("events").EnumerateArray().Single(e => e.GetProperty("kind").GetString() == "patentExpired");
        Assert.Equal("soft_drink", expired.GetProperty("productId").GetString());
        Assert.True(expired.GetProperty("isPlayer").GetBoolean());
        Assert.Empty(bridge.Call("patents").GetProperty("mine").EnumerateArray());
        var error = bridge.Fail("grantLicense", new { licenseeId = 2, productId = "soft_drink" });
        Assert.Equal(BridgeErrorCodes.PatentNotActive, error.Code);
        Assert.Equal("soft_drink", error.Detail("productId"));
        // The distinction survives a save/load.
        var reloaded = Bridge.Init();
        reloaded.Call("loadGame", new { data = bridge.Call("saveGame").GetProperty("data").GetString() });
        Assert.Equal(BridgeErrorCodes.PatentNotActive, reloaded.Fail("grantLicense", new { licenseeId = 2, productId = "soft_drink" }).Code);
    }

    [Fact]
    public void A_rival_patent_blocks_the_players_research()
    {
        var lab = Bridge.Cost("rd_center");
        var bridge = Bridge.Funded(playerCash: 2 * lab, rivalCash: 2 * lab, seed: 9, ("Inventor", "simple"));
        var world = bridge.World;
        var rival = new CompanyId(2);
        world.SetTech(rival, new ProductId("soft_drink"), 7);
        var theirLab = world.Construct(rival, new BuildingTypeId("rd_center"), new CityId("eastside"));
        for (var i = 0; i < 4; i++) world.ConfigureResearchSlot(theirLab.Id, i, new ProductId("soft_drink"));
        bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });

        var tick = bridge.Advance(2);
        var events = tick.GetProperty("events").EnumerateArray().ToList();
        var granted = events.Single(e => e.GetProperty("kind").GetString() == "patentGranted");
        Assert.False(granted.GetProperty("isPlayer").GetBoolean());
        Assert.Equal("warning", granted.GetProperty("severity").GetString()); // a rival patent on something I research
        Assert.Contains(events, e => e.GetProperty("kind").GetString() == "patentBlocked");

        var node = Node(bridge, "soft_drink");
        Assert.True(node.GetProperty("blocked").GetBoolean());
        Assert.Equal(0, node.GetProperty("pointsPerMonth").GetDouble());
        Assert.False(node.GetProperty("patent").GetProperty("mine").GetBoolean());
        Assert.Equal(2, node.GetProperty("bestRival").GetProperty("companyId").GetInt32());
        Assert.Equal(8, node.GetProperty("bestRival").GetProperty("tech").GetInt32());

        var theirs = bridge.Call("patents").GetProperty("rivals").EnumerateArray().Single();
        Assert.True(theirs.GetProperty("blocksMyResearch").GetBoolean());
        Assert.False(theirs.GetProperty("licensedToMe").GetBoolean());
        Assert.Equal("Inventor", theirs.GetProperty("holderName").GetString());
        Assert.Contains(bridge.Call("advisor").GetProperty("hints").EnumerateArray(), h => h.GetProperty("code").GetString() == "rivalPatentBlocksYou");

        // A license from the holder lifts the block.
        world.GrantPatentLicense(rival, new CompanyId(1), new ProductId("soft_drink"));
        Assert.False(Node(bridge, "soft_drink").GetProperty("blocked").GetBoolean());
        Assert.True(bridge.Call("patents").GetProperty("rivals")[0].GetProperty("licensedToMe").GetBoolean());
    }
}
