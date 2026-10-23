using System;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Advertising (GameSession.Marketing.cs, bridge-spec §5.6). Bread in Riverside: no news event touches it.</summary>
public class MarketingTests
{
    private static double Brand(Bridge bridge, string product = "bread", string city = "riverside")
        => bridge.World.GetBrandAwareness(bridge.Session.PlayerId, new ProductId(product), new CityId(city));

    [Fact]
    public void Previews_are_exactly_what_the_engine_does_next_month()
    {
        var bridge = Bridge.Custom(seed: 4);
        bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.0, restockTarget = 10_000 });

        var first = bridge.Call("previewAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 100_000 });
        Assert.Equal(0, first.GetProperty("currentBrand").GetDouble());
        // The numbers come from the engine's advertising model (its content and rules): the test pins
        // that the preview is consistent and is what happens, not today's tuning.
        Assert.True(first.GetProperty("costPerPoint").GetDecimal() > 0m);
        Assert.InRange(first.GetProperty("lift").GetDouble(), double.Epsilon, 100);
        Assert.InRange(first.GetProperty("saturation").GetDouble(), double.Epsilon, 1);
        Assert.Equal(first.GetProperty("lift").GetDouble(), first.GetProperty("projectedBrand").GetDouble(), 9); // from zero brand
        Assert.Equal(1m, first.GetProperty("mediaBonus").GetDecimal());
        Assert.True(first.GetProperty("hasRetailPresence").GetBoolean());
        Assert.Equal(0m, first.GetProperty("existingBudget").GetDecimal());

        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 100_000 });
        bridge.Advance(1);
        Assert.Equal(first.GetProperty("projectedBrand").GetDouble(), Brand(bridge), 9);

        // A second channel on the same product and city applies on top of the first, in channel order.
        bridge.Build("radio_station", "riverside");
        var both = bridge.Call("previewAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 50_000 });
        var bonus = both.GetProperty("mediaBonus").GetDecimal();
        Assert.True(bonus > 1m, $"owning the city's radio station boosts radio ads (bonus {bonus})");
        Assert.Equal(50_000m * bonus, both.GetProperty("effectiveBudget").GetDecimal());
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 50_000 });
        var listed = bridge.Call("adCampaigns").GetProperty("campaigns").EnumerateArray().ToList();
        Assert.Equal(2, listed.Count);
        Assert.All(listed, c => Assert.Equal(both.GetProperty("projectedBrand").GetDouble(), c.GetProperty("projectedBrand").GetDouble(), 9));
        bridge.Advance(1);
        Assert.Equal(both.GetProperty("projectedBrand").GetDouble(), Brand(bridge), 9);

        // Stopping everything: the brand decays by the monthly rate.
        bridge.Call("cancelAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv" });
        var stopping = bridge.Call("previewAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 0 });
        Assert.Equal(0, stopping.GetProperty("lift").GetDouble());
        Assert.InRange(stopping.GetProperty("projectedBrand").GetDouble(), 0, Brand(bridge) * (1 - 1e-9)); // decays
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 0 });
        bridge.Advance(1);
        Assert.Equal(stopping.GetProperty("projectedBrand").GetDouble(), Brand(bridge), 9);
    }

    [Fact]
    public void Campaign_commands_emit_lifecycle_events()
    {
        var bridge = Bridge.Custom();
        JsonElement Last(string kind) => bridge.EnvelopeEvents().Single(e => e.GetProperty("kind").GetString() == kind);

        var started = bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "Newspaper", monthlyBudget = 12_345.678 });
        Assert.Equal("newspaper", started.GetProperty("channel").GetString());
        Assert.Equal(12_345.68m, started.GetProperty("monthlyBudget").GetDecimal());
        Assert.False(started.GetProperty("hasRetailPresence").GetBoolean());
        Assert.Equal(12_345.68m, Last("campaignStarted").GetProperty("amount").GetDecimal());

        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "newspaper", monthlyBudget = 20_000 });
        var changed = Last("campaignChanged");
        Assert.Equal(12_345.68m, changed.GetProperty("oldValue").GetDecimal());
        Assert.Equal(20_000m, changed.GetProperty("newValue").GetDecimal());

        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "newspaper", monthlyBudget = 0 });
        Assert.Equal(20_000m, Last("campaignCancelled").GetProperty("oldValue").GetDecimal());
        Assert.Empty(bridge.Call("adCampaigns").GetProperty("campaigns").EnumerateArray());

        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 5_000 });
        Assert.True(bridge.Call("cancelAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv" }).GetProperty("cancelled").GetBoolean());
        Assert.Contains(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "campaignCancelled");
        Assert.False(bridge.Call("cancelAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv" }).GetProperty("cancelled").GetBoolean());
        Assert.DoesNotContain(bridge.EnvelopeEvents(), e => e.GetProperty("kind").GetString() == "campaignCancelled");
    }

    [Fact]
    public void Campaign_arguments_are_validated()
    {
        var bridge = Bridge.Custom();
        var negative = bridge.Fail("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = -1 });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, negative.Code);
        Assert.Equal("monthlyBudget", negative.Field);
        Assert.Equal("monthlyBudget", bridge.Fail("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 200_000_000 }).Field);
        var channel = bridge.Fail("previewAdCampaign", new { productId = "bread", cityId = "riverside", channel = "billboard", monthlyBudget = 1 });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, channel.Code);
        Assert.Equal("channel", channel.Field);
        var raw = bridge.Fail("setAdCampaign", new { productId = "steel", cityId = "riverside", channel = "tv", monthlyBudget = 1 });
        Assert.Equal(BridgeErrorCodes.ProductNotAllowed, raw.Code);
        Assert.Equal("notFinished", raw.Detail("reason"));
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("setAdCampaign", new { productId = "bread", cityId = "gotham", channel = "tv", monthlyBudget = 1 }).Code);
        Assert.Equal(BridgeErrorCodes.BadRequest, bridge.Fail("setAdCampaign", new { productId = "bread", cityId = "riverside", monthlyBudget = 1 }).Code);
    }

    [Fact]
    public void Campaign_list_totals_spend_and_flags_ads_without_a_store()
    {
        var bridge = Bridge.Custom();
        bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.0, restockTarget = 10_000 });
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "tv", monthlyBudget = 30_000 });
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "hilltown", channel = "radio", monthlyBudget = 10_000 });
        var list = bridge.Call("adCampaigns");
        Assert.Equal(40_000m, list.GetProperty("totalMonthlySpend").GetDecimal());
        Assert.Equal(bridge.World.Rules.Market.BrandDecayRate, list.GetProperty("brandDecayRate").GetDouble()); // E1 §4.20 under Realistic
        var rows = list.GetProperty("campaigns").EnumerateArray().ToList();
        Assert.Equal(new[] { "hilltown", "riverside" }, rows.Select(r => r.GetProperty("cityId").GetString()));
        Assert.False(rows[0].GetProperty("hasRetailPresence").GetBoolean());
        Assert.True(rows[1].GetProperty("hasRetailPresence").GetBoolean());

        var hint = bridge.Call("advisor").GetProperty("hints").EnumerateArray().Single(h => h.GetProperty("code").GetString() == "adsWithoutStore");
        Assert.Equal("hilltown", hint.GetProperty("cityId").GetString());
        Assert.Equal(10_000m, hint.GetProperty("impactPerMonth").GetDecimal());
        var fix = hint.GetProperty("fix");
        Assert.Equal("cancelAdCampaign", fix.GetProperty("method").GetString());
        // The one-click fix is a ready-to-send call.
        Assert.True(bridge.Call(fix.GetProperty("method").GetString()!, fix.GetProperty("argsJson").GetString()!).GetProperty("cancelled").GetBoolean());
    }
}
