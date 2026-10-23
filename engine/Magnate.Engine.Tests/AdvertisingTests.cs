using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class AdvertisingTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ================================================== Registration / validation

    [Fact]
    public void RegisterAdCampaign_rejects_negative_budget()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        Assert.Throws<ArgumentException>(() =>
            world.RegisterAdCampaign(
                acme.Id, new ProductId("soft_drink"), new CityId("metropolis"),
                AdChannel.TV, monthlyBudget: -1m));
    }

    [Fact]
    public void Zero_budget_removes_the_campaign()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 0m);

        Assert.Null(world.GetAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV));
    }

    // ================================================== Monthly behaviour

    [Fact]
    public void Active_campaign_charges_budget_each_month()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m);

        world.AdvanceMonth();
        world.AdvanceMonth();
        world.AdvanceMonth();

        var adSpend = -world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.AdvertisingCost).Sum(e => e.Amount);
        Assert.Equal(150_000m, adSpend);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Active_campaign_raises_brand_awareness()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        world.RegisterAdCampaign(acme.Id, softDrink, city, AdChannel.TV, 100_000m);

        // At TV rate $4000/point, $100k/mo → 25 points at 0 saturation.
        world.AdvanceMonth();
        Assert.Equal(25.0, world.GetBrandAwareness(acme.Id, softDrink, city));

        // Next month: current=25, saturation factor 0.75 → +18.75 → 43.75.
        world.AdvanceMonth();
        Assert.InRange(world.GetBrandAwareness(acme.Id, softDrink, city), 43.7, 43.8);
    }

    [Fact]
    public void Brand_awareness_saturates_at_100_no_matter_how_much_spending()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 1_000_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Absurd budget — brand should saturate below 100 quickly but never exceed.
        world.RegisterAdCampaign(acme.Id, softDrink, city, AdChannel.TV, 10_000_000m);

        for (var i = 0; i < 20; i++) world.AdvanceMonth();

        var brand = world.GetBrandAwareness(acme.Id, softDrink, city);
        Assert.InRange(brand, 95.0, 100.0);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Brand_awareness_decays_when_no_campaign_active()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Seed brand at 50 directly.
        world.SetBrandAwareness(acme.Id, softDrink, city, 50.0);

        world.AdvanceMonth();

        // Decay of 2% per month: 50 × 0.98 = 49.
        Assert.InRange(world.GetBrandAwareness(acme.Id, softDrink, city), 48.99, 49.01);
    }

    [Fact]
    public void TV_is_more_cost_efficient_than_magazine_per_dollar()
    {
        // Equal spend on TV vs magazine → TV produces larger brand lift.
        var world1 = NewWorld();
        var acme1 = world1.CreateCompany("A", 1_000_000m);
        world1.RegisterAdCampaign(acme1.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m);
        world1.AdvanceMonth();

        var world2 = NewWorld();
        var acme2 = world2.CreateCompany("A", 1_000_000m);
        world2.RegisterAdCampaign(acme2.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.Magazine, 50_000m);
        world2.AdvanceMonth();

        var tvBrand = world1.GetBrandAwareness(acme1.Id, new ProductId("soft_drink"), new CityId("metropolis"));
        var magBrand = world2.GetBrandAwareness(acme2.Id, new ProductId("soft_drink"), new CityId("metropolis"));

        Assert.True(tvBrand > magBrand, $"tv {tvBrand} should exceed magazine {magBrand}");
    }

    [Fact]
    public void Ad_spend_reports_as_marketing_cost_on_product_profitability()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var softDrink = new ProductId("soft_drink");

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, softDrink, price: 1.80m, restockTarget: 100_000);

        world.RegisterAdCampaign(acme.Id, softDrink, new CityId("metropolis"), AdChannel.TV, 50_000m);

        world.AdvanceMonth();

        var report = world.GetProductProfitability(acme.Id, world.Clock.Now, world.Clock.Now);
        var p = report[softDrink];
        Assert.Equal(50_000m, p.MarketingCost);
        Assert.True(p.NetMargin < p.GrossMargin, "net margin must be below gross after ad spend");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Advertising_company_wins_more_share_at_equal_price()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 15_000_000m);
        var rival = world.CreateCompany("Rival", 15_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        var a = world.Construct(acme.Id, new BuildingTypeId("supermarket"), city);
        world.ConfigureRetailSlot(a.Id, 0, softDrink, price: 1.80m, restockTarget: 5_000_000);

        var b = world.Construct(rival.Id, new BuildingTypeId("supermarket"), city);
        world.ConfigureRetailSlot(b.Id, 0, softDrink, price: 1.80m, restockTarget: 5_000_000);

        // Acme spends $200k/mo on TV for 6 months → brand climbs into the 80s.
        world.RegisterAdCampaign(acme.Id, softDrink, city, AdChannel.TV, 200_000m);

        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var acmeSales = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);
        var rivalSales = world.Ledger.EntriesFor(rival.Id)
            .Where(e => e.Category == LedgerCategory.ProductSale).Sum(e => e.Amount);

        Assert.True(acmeSales > rivalSales * 1.3m,
            $"brand advantage should yield >30% sales lead. acme {acmeSales} rival {rivalSales}");
    }

    // ================================================== Media buildings (Phase 3.21)

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Media_tv_station_loads_from_catalog()
    {
        var catalog = TestContent.Classic;
        var tv = catalog.BuildingType(new BuildingTypeId("tv_station"));
        Assert.Equal("media", tv.Category);
        Assert.Equal(3_000_000m, tv.ConstructionCost);
        Assert.Equal(30_000m, tv.MonthlyOperatingCost);
        Assert.Equal(3, tv.Footprint.Width);
        Assert.Equal(3, tv.Footprint.Height);
        Assert.Equal(1, tv.MaxUnits);
        Assert.Empty(tv.ProducibleTiers);

        var radio = catalog.BuildingType(new BuildingTypeId("radio_station"));
        Assert.Equal("media", radio.Category);
        Assert.Equal(800_000m, radio.ConstructionCost);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Tv_station_owner_gets_ad_reach_bonus()
    {
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Baseline: no TV station.
        var worldBase = ClassicWorld();
        var acmeBase = worldBase.CreateCompany("Acme", 20_000_000m);
        worldBase.RegisterAdCampaign(acmeBase.Id, softDrink, city, AdChannel.TV, 40_000m);
        worldBase.AdvanceMonth();
        var baseBrand = worldBase.GetBrandAwareness(acmeBase.Id, softDrink, city);

        // With TV station owned.
        var worldStation = ClassicWorld();
        var acmeStation = worldStation.CreateCompany("Acme", 20_000_000m);
        worldStation.Construct(acmeStation.Id, new BuildingTypeId("tv_station"), city);
        worldStation.RegisterAdCampaign(acmeStation.Id, softDrink, city, AdChannel.TV, 40_000m);
        worldStation.AdvanceMonth();
        var stationBrand = worldStation.GetBrandAwareness(acmeStation.Id, softDrink, city);

        Assert.True(stationBrand > baseBrand,
            $"station-owner should get more brand lift than no-station. station={stationBrand} base={baseBrand}");

        // Exact check: bonus multiplier applied to effective budget at zero saturation.
        // base: 40000/4000 = 10 points. station: 40000*1.35/4000 = 13.5 points.
        Assert.Equal(10.0, baseBrand, 3);
        Assert.Equal(13.5, stationBrand, 3);

        // And the helper itself.
        Assert.Equal(1.35m, worldStation.GetMediaOwnershipBonus(acmeStation.Id, city, AdChannel.TV));
        Assert.Equal(1.0m, worldBase.GetMediaOwnershipBonus(acmeBase.Id, city, AdChannel.TV));
        // Station does not boost non-TV channels.
        Assert.Equal(1.0m, worldStation.GetMediaOwnershipBonus(acmeStation.Id, city, AdChannel.Newspaper));
    }

    [Fact]
    public void Equity_still_equals_starting_plus_net_income_with_ads_running()
    {
        // The books must still close once AdvertisingCost is in play.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), city);
        world.ConfigureRetailSlot(store.Id, 0, softDrink, price: 1.80m, restockTarget: 500_000);
        world.RegisterAdCampaign(acme.Id, softDrink, city, AdChannel.TV, 75_000m);

        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var pnl = world.GetIncomeStatement(acme.Id, new GameDate(2026, 2), world.Clock.Now);
        var bs = world.GetBalanceSheet(acme.Id);

        var expected = 20_000_000m + pnl.NetIncome;
        Assert.True(Math.Abs(bs.Equity - expected) < 1m,
            $"equity {bs.Equity} should equal {expected}; diff {bs.Equity - expected}");
    }

    // ================================================== Radio channel (Phase 3.25)

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Radio_channel_ad_campaigns_deliver_reach()
    {
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 5_000_000m);
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        world.RegisterAdCampaign(acme.Id, softDrink, city, AdChannel.Radio, 50_000m);
        world.AdvanceMonth();

        // Radio rate $5000/point, $50k/mo → 10 points at 0 saturation.
        var brand = world.GetBrandAwareness(acme.Id, softDrink, city);
        Assert.Equal(10.0, brand, 3);

        // Budget charged as advertising cost.
        var adSpend = -world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.AdvertisingCost).Sum(e => e.Amount);
        Assert.Equal(50_000m, adSpend);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Radio_station_owner_gets_radio_ad_bonus()
    {
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Baseline: no radio station.
        var worldBase = ClassicWorld();
        var acmeBase = worldBase.CreateCompany("Acme", 20_000_000m);
        worldBase.RegisterAdCampaign(acmeBase.Id, softDrink, city, AdChannel.Radio, 50_000m);
        worldBase.AdvanceMonth();
        var baseBrand = worldBase.GetBrandAwareness(acmeBase.Id, softDrink, city);

        // With radio station owned.
        var worldStation = ClassicWorld();
        var acmeStation = worldStation.CreateCompany("Acme", 20_000_000m);
        worldStation.Construct(acmeStation.Id, new BuildingTypeId("radio_station"), city);
        worldStation.RegisterAdCampaign(acmeStation.Id, softDrink, city, AdChannel.Radio, 50_000m);
        worldStation.AdvanceMonth();
        var stationBrand = worldStation.GetBrandAwareness(acmeStation.Id, softDrink, city);

        Assert.True(stationBrand > baseBrand,
            $"radio-station-owner should get more brand lift than no-station. station={stationBrand} base={baseBrand}");

        // Exact check: base 50000/5000 = 10 points; station 50000*1.35/5000 = 13.5 points.
        Assert.Equal(10.0, baseBrand, 3);
        Assert.Equal(13.5, stationBrand, 3);

        // Helper: radio_station boosts Radio only, not TV/Newspaper.
        Assert.Equal(1.35m, worldStation.GetMediaOwnershipBonus(acmeStation.Id, city, AdChannel.Radio));
        Assert.Equal(1.0m, worldStation.GetMediaOwnershipBonus(acmeStation.Id, city, AdChannel.TV));
        Assert.Equal(1.0m, worldStation.GetMediaOwnershipBonus(acmeStation.Id, city, AdChannel.Newspaper));
    }

    // ================================================== Print media (Phase 3.34)

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Media_newspaper_and_magazine_publishers_load_from_catalog()
    {
        var catalog = TestContent.Classic;
        var np = catalog.BuildingType(new BuildingTypeId("newspaper_publisher"));
        Assert.Equal("media", np.Category);
        Assert.Equal(2_100_000m, np.ConstructionCost);
        Assert.Equal(18_000m, np.MonthlyOperatingCost);
        Assert.Empty(np.ProducibleTiers);

        var mag = catalog.BuildingType(new BuildingTypeId("magazine_publisher"));
        Assert.Equal("media", mag.Category);
        Assert.Equal(2_100_000m, mag.ConstructionCost);
        Assert.Equal(18_000m, mag.MonthlyOperatingCost);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Newspaper_publisher_owner_gets_newspaper_ad_bonus()
    {
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Baseline: no publisher.
        var worldBase = ClassicWorld();
        var acmeBase = worldBase.CreateCompany("Acme", 20_000_000m);
        worldBase.RegisterAdCampaign(acmeBase.Id, softDrink, city, AdChannel.Newspaper, 60_000m);
        worldBase.AdvanceMonth();
        var baseBrand = worldBase.GetBrandAwareness(acmeBase.Id, softDrink, city);

        // With newspaper publisher owned.
        var worldPub = ClassicWorld();
        var acmePub = worldPub.CreateCompany("Acme", 20_000_000m);
        worldPub.Construct(acmePub.Id, new BuildingTypeId("newspaper_publisher"), city);
        worldPub.RegisterAdCampaign(acmePub.Id, softDrink, city, AdChannel.Newspaper, 60_000m);
        worldPub.AdvanceMonth();
        var pubBrand = worldPub.GetBrandAwareness(acmePub.Id, softDrink, city);

        Assert.True(pubBrand > baseBrand,
            $"publisher-owner should get more brand lift. pub={pubBrand} base={baseBrand}");

        // Exact check: Newspaper $6000/point. base 60000/6000 = 10 points.
        // publisher 60000*1.25/6000 = 12.5 points.
        Assert.Equal(10.0, baseBrand, 3);
        Assert.Equal(12.5, pubBrand, 3);

        Assert.Equal(1.25m, worldPub.GetMediaOwnershipBonus(acmePub.Id, city, AdChannel.Newspaper));
        Assert.Equal(1.0m, worldBase.GetMediaOwnershipBonus(acmeBase.Id, city, AdChannel.Newspaper));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Magazine_publisher_owner_gets_magazine_ad_bonus()
    {
        var softDrink = new ProductId("soft_drink");
        var city = new CityId("metropolis");

        // Baseline: no publisher.
        var worldBase = ClassicWorld();
        var acmeBase = worldBase.CreateCompany("Acme", 20_000_000m);
        worldBase.RegisterAdCampaign(acmeBase.Id, softDrink, city, AdChannel.Magazine, 80_000m);
        worldBase.AdvanceMonth();
        var baseBrand = worldBase.GetBrandAwareness(acmeBase.Id, softDrink, city);

        // With magazine publisher owned.
        var worldPub = ClassicWorld();
        var acmePub = worldPub.CreateCompany("Acme", 20_000_000m);
        worldPub.Construct(acmePub.Id, new BuildingTypeId("magazine_publisher"), city);
        worldPub.RegisterAdCampaign(acmePub.Id, softDrink, city, AdChannel.Magazine, 80_000m);
        worldPub.AdvanceMonth();
        var pubBrand = worldPub.GetBrandAwareness(acmePub.Id, softDrink, city);

        Assert.True(pubBrand > baseBrand,
            $"publisher-owner should get more brand lift. pub={pubBrand} base={baseBrand}");

        // Exact check: Magazine $8000/point. base 80000/8000 = 10 points.
        // publisher 80000*1.25/8000 = 12.5 points.
        Assert.Equal(10.0, baseBrand, 3);
        Assert.Equal(12.5, pubBrand, 3);

        Assert.Equal(1.25m, worldPub.GetMediaOwnershipBonus(acmePub.Id, city, AdChannel.Magazine));
        Assert.Equal(1.0m, worldBase.GetMediaOwnershipBonus(acmeBase.Id, city, AdChannel.Magazine));
    }

    [Fact]
    public void Newspaper_bonus_requires_newspaper_publisher_not_other_media_buildings()
    {
        var city = new CityId("metropolis");

        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 500_000_000m);

        // Acme owns a TV station, radio station, and magazine publisher — but NOT a newspaper publisher.
        world.Construct(acme.Id, new BuildingTypeId("tv_station"), city);
        world.Construct(acme.Id, new BuildingTypeId("radio_station"), city);
        world.Construct(acme.Id, new BuildingTypeId("magazine_publisher"), city);

        // Newspaper bonus must still be 1.0 — channel-specific mapping requires newspaper_publisher.
        Assert.Equal(1.0m, world.GetMediaOwnershipBonus(acme.Id, city, AdChannel.Newspaper));

        // And magazine bonus IS active (owner has a magazine publisher).
        Assert.Equal(1.25m, world.GetMediaOwnershipBonus(acme.Id, city, AdChannel.Magazine));
        // TV and Radio bonuses also active.
        Assert.Equal(1.35m, world.GetMediaOwnershipBonus(acme.Id, city, AdChannel.TV));
        Assert.Equal(1.35m, world.GetMediaOwnershipBonus(acme.Id, city, AdChannel.Radio));
    }

    [Fact]
    public void Only_the_company_that_owns_the_newspaper_publisher_gets_the_bonus()
    {
        var city = new CityId("metropolis");

        var world = NewWorld();
        var owner = world.CreateCompany("Owner", 20_000_000m);
        var rival = world.CreateCompany("Rival", 20_000_000m);

        world.Construct(owner.Id, new BuildingTypeId("newspaper_publisher"), city);

        Assert.Equal(1.25m, world.GetMediaOwnershipBonus(owner.Id, city, AdChannel.Newspaper));
        Assert.Equal(1.0m, world.GetMediaOwnershipBonus(rival.Id, city, AdChannel.Newspaper));
    }
}
