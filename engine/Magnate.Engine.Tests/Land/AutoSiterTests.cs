using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

public sealed class AutoSiterTests
{
    [Theory]
    [MemberData(nameof(LandFixture.BuildingTypes), MemberType = typeof(LandFixture))]
    public void Every_building_type_finds_valid_non_overlapping_sites_in_some_city(string typeId)
    {
        var type = LandFixture.Type(typeId);
        var hosts = new List<string>();
        foreach (var city in LandFixture.CityIds)
        {
            var layout = LandFixture.Layout(city);
            var sites = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 5);
            Assert.True(sites.Count <= 5);
            if (sites.Count == 0) continue;
            hosts.Add(city);
            for (var a = 0; a < sites.Count; a++)
            {
                Assert.True(sites[a].Placement.Ok);
                var again = PlacementValidator.Validate(layout, PlotOccupancy.None, type, sites[a].Px, sites[a].Pz, sites[a].Rotation);
                Assert.True(again.Ok, $"{typeId} in {city}: {string.Join("; ", again.Issues.Select(i => i.CodeName))}");
                if (a > 0) Assert.True(sites[a].Score >= sites[a - 1].Score);
                for (var b = 0; b < a; b++) Assert.False(sites[a].Placement.Footprint.Intersects(sites[b].Placement.Footprint));
            }
        }
        Assert.NotEmpty(hosts);
    }

    [Theory]
    [InlineData("seaport", "hilltown")]
    [InlineData("seaport", "eastside")]
    [InlineData("seaport", "riverside")]
    [InlineData("iron_mine", "metropolis")]
    [InlineData("iron_mine", "portbay")]
    [InlineData("oil_well", "riverside")]
    [InlineData("oil_well", "hilltown")]
    [InlineData("small_farm", "portbay")]
    [InlineData("large_farm", "portbay")]
    [InlineData("small_plantation", "portbay")]
    public void Impossible_combinations_find_nothing(string typeId, string city)
    {
        var sites = AutoSiter.FindSites(LandFixture.Layout(city), PlotOccupancy.None, LandFixture.Type(typeId), SitePreference.Auto, 5);
        Assert.Empty(sites);
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Every_city_keeps_clear_sites_for_big_stores_and_the_largest_factory(string city, int seed)
    {
        // Competitors need room: several disjoint supermarket sites, and an industrial
        // estate that takes the largest factory without buying out ambient industry.
        var layout = LandFixture.Layout(city, seed);
        var supermarkets = AutoSiter.FindSites(layout, PlotOccupancy.None, LandFixture.Type("supermarket"), SitePreference.Cheapest, 10);
        Assert.True(supermarkets.Count >= 2, $"{city}/{seed}: only {supermarkets.Count} supermarket site(s)");
        var factory = AutoSiter.FindSites(layout, PlotOccupancy.None, LandFixture.Type("factory_large"), SitePreference.Cheapest, 1);
        Assert.Single(factory);
        Assert.Equal(0m, factory[0].Placement.RedevelopmentCost);
    }

    [Theory]
    [MemberData(nameof(LandFixture.Cities), MemberType = typeof(LandFixture))]
    public void Every_city_hosts_every_building_its_geography_allows(string city)
    {
        var layout = LandFixture.Layout(city);
        foreach (var type in LandFixture.Catalog.BuildingTypes.Values)
        {
            var geo = type.GeographyRequirement;
            var allowed = (geo?.Coastal != true || layout.Geography.Coastal)
                && (geo?.Arable != true || layout.Geography.Arable)
                && (geo?.MineralRich != true || layout.Geography.MineralRich)
                && (geo?.OilRich != true || layout.Geography.OilRich);
            var sites = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 1);
            Assert.True(allowed == (sites.Count > 0), $"{city}: {type.Id} allowed={allowed} but {sites.Count} sites");
        }
    }

    [Fact]
    public void Occupied_sites_are_skipped()
    {
        var layout = LandFixture.Layout("metropolis");
        var type = LandFixture.Type("supermarket");
        var occupancy = new PlotOccupancyMap(layout.Width, layout.Height);
        var first = AutoSiter.FindSites(layout, occupancy, type, SitePreference.MaxTraffic, 1).Single();
        occupancy.Occupy(1, first.Placement.Footprint);
        var second = AutoSiter.FindSites(layout, occupancy, type, SitePreference.MaxTraffic, 3);
        Assert.NotEmpty(second);
        Assert.All(second, s => Assert.False(s.Placement.Footprint.Intersects(first.Placement.Footprint)));
        Assert.Throws<InvalidOperationException>(() => occupancy.Occupy(2, first.Placement.Footprint));
    }

    [Fact]
    public void Preferences_rank_sites_differently()
    {
        var layout = LandFixture.Layout("metropolis");
        var type = LandFixture.Type("supermarket");
        var busy = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.MaxTraffic, 1).Single().Placement;
        var cheap = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Cheapest, 1).Single().Placement;
        var central = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.NearCbd, 1).Single().Placement;
        Assert.True(busy.Site!.Traffic >= cheap.Site!.Traffic);
        Assert.True(cheap.SiteCost <= busy.SiteCost);
        Assert.True(central.Site!.DistanceToCbd <= Math.Min(busy.Site.DistanceToCbd, cheap.Site.DistanceToCbd));
        Assert.Equal(SitePreference.BestValue, AutoSiter.DefaultPreference(type));
        Assert.Equal(SitePreference.NearPort, AutoSiter.DefaultPreference(LandFixture.Type("factory_small")));
        Assert.Equal(SitePreference.BestDeposit, AutoSiter.DefaultPreference(LandFixture.Type("oil_well")));
        Assert.Equal(SitePreference.Cheapest, AutoSiter.DefaultPreference(LandFixture.Type("small_farm")));
    }

    [Fact]
    public void Mines_go_to_the_best_deposit()
    {
        var layout = LandFixture.Layout("riverside");
        var mine = LandFixture.Type("iron_mine");
        var sites = AutoSiter.FindSites(layout, PlotOccupancy.None, mine, SitePreference.Auto, 10);
        Assert.NotEmpty(sites);
        var best = layout.Deposits.Where(d => !d.Offshore && sites.Any(s => s.Placement.Site!.DepositId == d.Id)).Max(d => d.Quality);
        Assert.Equal(best, sites[0].Placement.Site!.DepositQuality);
        Assert.All(sites, s => Assert.True(s.Placement.Site!.DepositReserve > 0));
    }

    [Fact]
    public void Factories_prefer_the_port_in_a_port_city()
    {
        var layout = LandFixture.Layout("metropolis");
        var factory = LandFixture.Type("factory_small");
        var nearPort = AutoSiter.FindSites(layout, PlotOccupancy.None, factory, SitePreference.NearPort, 1).Single().Placement;
        var anywhere = AutoSiter.FindSites(layout, PlotOccupancy.None, factory, SitePreference.NearCbd, 1).Single().Placement;
        var port = layout.Parcels.Where(p => p.District == District.Port).ToList();
        double ToPort(PlotRect r) => port.Min(p => Math.Abs(p.Px - r.Px) + Math.Abs(p.Pz - r.Pz));
        Assert.True(ToPort(nearPort.Footprint) <= ToPort(anywhere.Footprint));
    }

    [Fact]
    public void Sites_face_their_best_road_and_seaports_face_the_water()
    {
        var layout = LandFixture.Layout("metropolis");
        foreach (var typeId in new[] { "supermarket", "factory_small", "warehouse_small", "radio_station" })
        {
            foreach (var site in AutoSiter.FindSites(layout, PlotOccupancy.None, LandFixture.Type(typeId), SitePreference.Auto, 3))
            {
                var r = site.Placement.Footprint;
                var front = FrontPlots(r, site.Rotation).Where(p => layout.InBounds(p.X, p.Z)).ToList();
                Assert.Contains(front, p => layout.RoadAt(p.X, p.Z) != RoadClass.None);
            }
        }

        var seaport = AutoSiter.FindSites(LandFixture.Layout("portbay"), PlotOccupancy.None, LandFixture.Type("seaport"), SitePreference.Auto, 3);
        Assert.NotEmpty(seaport);
        foreach (var site in seaport)
        {
            var front = FrontPlots(site.Placement.Footprint, site.Rotation).ToList();
            Assert.Contains(front, p => LandFixture.Layout("portbay").InBounds(p.X, p.Z) && LandFixture.Layout("portbay").WaterAt(p.X, p.Z) == WaterKind.Sea);
        }
    }

    [Fact]
    public void Counts_are_clamped()
    {
        var layout = LandFixture.Layout("hilltown");
        var type = LandFixture.Type("convenience_store");
        Assert.Empty(AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 0));
        Assert.True(AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 1_000).Count <= AutoSiter.MaxCount);
    }

    /// <summary>The plots just outside the footprint's front side (facing S, E, N, W for 0, 90, 180, 270).</summary>
    private static IEnumerable<(int X, int Z)> FrontPlots(PlotRect r, int rotation)
    {
        switch (rotation)
        {
            case 0:
                for (var x = r.Px; x < r.Right; x++) yield return (x, r.Bottom);
                break;
            case 90:
                for (var z = r.Pz; z < r.Bottom; z++) yield return (r.Right, z);
                break;
            case 180:
                for (var x = r.Px; x < r.Right; x++) yield return (x, r.Pz - 1);
                break;
            default:
                for (var z = r.Pz; z < r.Bottom; z++) yield return (r.Px - 1, z);
                break;
        }
    }
}
