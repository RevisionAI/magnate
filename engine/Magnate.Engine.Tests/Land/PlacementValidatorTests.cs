using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

public sealed class PlacementValidatorTests
{
    /// <summary>The first city (content order) where the auto-siter finds a site, with that site.</summary>
    private static (CityLayout Layout, SiteCandidate Site) FirstSite(BuildingType type)
    {
        foreach (var id in LandFixture.CityIds)
        {
            var layout = LandFixture.Layout(id);
            var sites = AutoSiter.FindSites(layout, PlotOccupancy.None, type, SitePreference.Auto, 1);
            if (sites.Count > 0) return (layout, sites[0]);
        }
        throw new Xunit.Sdk.XunitException($"no city can host {type.Id}");
    }

    private static IReadOnlyList<PlacementCode> Codes(PlacementResult r) => r.Issues.Select(i => i.Code).ToList();

    [Theory]
    [MemberData(nameof(LandFixture.BuildingTypes), MemberType = typeof(LandFixture))]
    public void Every_building_type_validates_on_a_proper_site(string typeId)
    {
        var type = LandFixture.Type(typeId);
        var (layout, site) = FirstSite(type);
        var r = PlacementValidator.Validate(layout, PlotOccupancy.None, type, site.Px, site.Pz, site.Rotation);

        Assert.True(r.Ok, string.Join("; ", r.Issues.Select(i => i.CodeName + " " + i.Message)));
        Assert.Empty(r.Issues);
        var (w, h) = PlacementValidator.RotatedSize(type.Footprint, site.Rotation);
        Assert.Equal(new PlotRect(site.Px, site.Pz, w, h), r.Footprint);
        Assert.Equal(LandFixture.Plots(r.Footprint).Sum(p => layout.LandValueAt(p.X, p.Z)), r.LandCost);
        Assert.True(r.LandCost > 0);
        Assert.True(r.RedevelopmentCost >= 0);
        Assert.Equal(r.LandCost + r.RedevelopmentCost, r.SiteCost);
        Assert.NotEmpty(r.ParcelIds);
        Assert.Equal(r.ParcelIds.OrderBy(i => i).Distinct(), r.ParcelIds);
        Assert.NotNull(r.Site);
        Assert.NotEqual(RoadClass.None, r.Site!.Frontage);
        Assert.InRange(r.Site.LocationFactor, 0.3, 2.5);
    }

    [Theory]
    [MemberData(nameof(LandFixture.BuildingTypes), MemberType = typeof(LandFixture))]
    public void Every_building_type_is_rejected_off_the_map_on_roads_and_on_occupied_land(string typeId)
    {
        var type = LandFixture.Type(typeId);
        var (layout, site) = FirstSite(type);

        var outside = PlacementValidator.Validate(layout, PlotOccupancy.None, type, layout.Width - 1, -1, 0);
        Assert.False(outside.Ok);
        Assert.Equal(PlacementCode.OutOfBounds, outside.FirstIssue!.Code);
        Assert.Null(outside.Site);

        var road = layout.Roads.First(r => r.Class == RoadClass.Arterial && !r.Bridge);
        var onRoad = PlacementValidator.Validate(layout, PlotOccupancy.None, type,
            Math.Min(road.Start.Px, layout.Width - type.Footprint.Width), Math.Min(road.Start.Pz, layout.Height - type.Footprint.Height));
        Assert.False(onRoad.Ok);
        Assert.Contains(PlacementCode.Road, Codes(onRoad));

        var occupancy = new PlotOccupancyMap(layout.Width, layout.Height);
        var footprint = site.Placement.Footprint;
        occupancy.Occupy(99, new PlotRect(footprint.Px, footprint.Pz, 1, 1));
        var taken = PlacementValidator.Validate(layout, occupancy, type, site.Px, site.Pz, site.Rotation);
        Assert.False(taken.Ok);
        Assert.Equal([PlacementCode.Occupied], Codes(taken));
        Assert.Contains("99", taken.Issues[0].Message);
        occupancy.Release(99);
        Assert.True(PlacementValidator.Validate(layout, occupancy, type, site.Px, site.Pz, site.Rotation).Ok);
    }

    [Fact]
    public void Retail_is_zoned_out_of_houses_and_factories_out_of_downtown()
    {
        var l = LandFixture.Layout("metropolis");
        var house = l.Parcels.First(p => p.District == District.Houses && p.Rect.Area == 1);
        var store = PlacementValidator.Validate(l, PlotOccupancy.None, LandFixture.Type("convenience_store"), house.Px, house.Pz);
        Assert.Contains(PlacementCode.Zone, Codes(store));
        Assert.Contains("residential", store.Issues.First(i => i.Code == PlacementCode.Zone).Message);

        var cbd = l.Parcels.First(p => p.District == District.Cbd && p.Landmark is null);
        var factory = PlacementValidator.Validate(l, PlotOccupancy.None, LandFixture.Type("factory_small"), cbd.Px, cbd.Pz);
        Assert.Contains(PlacementCode.Zone, Codes(factory));
    }

    [Fact]
    public void Public_land_is_never_buildable()
    {
        var l = LandFixture.Layout("metropolis");
        foreach (var kind in new[] { LandmarkKind.CityHall, LandmarkKind.CentralPark, LandmarkKind.StockExchange })
        {
            var m = l.Landmarks.First(x => x.Kind == kind);
            var r = PlacementValidator.Validate(l, PlotOccupancy.None, LandFixture.Type("convenience_store"), m.Rect.Px, m.Rect.Pz);
            Assert.Contains(PlacementCode.Zone, Codes(r));
        }
    }

    [Fact]
    public void Farms_need_arable_land_and_stay_off_deposits()
    {
        var farm = LandFixture.Type("small_farm");
        var portbay = LandFixture.Layout("portbay");
        var scrub = portbay.Parcels.First(p => p.Ambient?.Kind == AmbientKind.Scrub);
        var arid = PlacementValidator.Validate(portbay, PlotOccupancy.None, farm, scrub.Px, scrub.Pz);
        Assert.Equal(PlacementCode.NotArable, arid.FirstIssue!.Code);

        var riverside = LandFixture.Layout("riverside");
        var deposit = riverside.Deposits.First(d => !d.Offshore);
        var onOre = PlacementValidator.Validate(riverside, PlotOccupancy.None, farm, deposit.Rect.Px, deposit.Rect.Pz);
        Assert.Contains(PlacementCode.Zone, Codes(onOre));
        Assert.Contains("extraction", onOre.Issues.First(i => i.Code == PlacementCode.Zone).Message);
    }

    [Fact]
    public void Extraction_needs_the_matching_deposit()
    {
        var mine = LandFixture.Type("iron_mine");
        var well = LandFixture.Type("oil_well");

        var metro = LandFixture.Layout("metropolis");
        var field = metro.Parcels.First(p => p.District == District.Rural && p.W >= 3 && p.H >= 3);
        var noOre = PlacementValidator.Validate(metro, PlotOccupancy.None, mine, field.Px, field.Pz);
        Assert.Equal(PlacementCode.NeedsDeposit, noOre.FirstIssue!.Code);
        Assert.Contains("Metropolis", noOre.FirstIssue.Message);

        var riverside = LandFixture.Layout("riverside");
        var rural = riverside.Parcels.First(p => p.District == District.Rural && p.DepositId == 0 && p.W >= 3 && p.H >= 3 && p.Ambient?.Kind != AmbientKind.Forest);
        var offDeposit = PlacementValidator.Validate(riverside, PlotOccupancy.None, mine, rural.Px, rural.Pz);
        Assert.Contains(PlacementCode.NeedsDeposit, Codes(offDeposit));

        var ore = riverside.Deposits.First(d => !d.Offshore);
        var wrongResource = PlacementValidator.Validate(riverside, PlotOccupancy.None, well, ore.Rect.Px, ore.Rect.Pz);
        Assert.Contains(PlacementCode.NeedsDeposit, Codes(wrongResource));
    }

    [Fact]
    public void Seaports_need_a_coast_and_the_quay()
    {
        var seaport = LandFixture.Type("seaport");
        var hill = LandFixture.Layout("hilltown");
        var inland = PlacementValidator.Validate(hill, PlotOccupancy.None, seaport, hill.Cbd.Px, hill.Cbd.Pz);
        Assert.Equal(PlacementCode.NeedsCoast, inland.FirstIssue!.Code);

        var metro = LandFixture.Layout("metropolis");
        var site = AutoSiter.FindSites(metro, PlotOccupancy.None, seaport, SitePreference.Auto, 1).Single();
        Assert.True(site.Placement.Site!.Waterfront);
        // Turned a quarter, the same corner leaves the quay strip.
        var turned = PlacementValidator.Validate(metro, PlotOccupancy.None, seaport, site.Px, site.Pz, site.Rotation + 90);
        Assert.False(turned.Ok);

        var industrial = metro.Parcels.First(p => p.District == District.Industrial && p.W >= 5 && p.H >= 3);
        var dry = PlacementValidator.Validate(metro, PlotOccupancy.None, seaport, industrial.Px, industrial.Pz);
        Assert.Contains(PlacementCode.Zone, Codes(dry));
    }

    [Fact]
    public void Water_slopes_and_missing_frontage_are_reported()
    {
        var river = LandFixture.Layout("riverside");
        var wet = Enumerable.Range(0, river.PlotCount).First(i => river.Kinds[i] == PlotKind.Water);
        var swim = PlacementValidator.Validate(river, PlotOccupancy.None, LandFixture.Type("convenience_store"), wet % river.Width, wet / river.Width);
        Assert.Contains(PlacementCode.Water, Codes(swim));

        // Hilltown's slopes: class 3 is unbuildable; class 2 only takes 2×2 or smaller.
        var hill = LandFixture.Layout("hilltown");
        var steep = Enumerable.Range(0, hill.PlotCount).Where(i => hill.Kinds[i] == PlotKind.Parcel && hill.SlopeClasses[i] >= 2).ToList();
        Assert.NotEmpty(steep);
        var (sx, sz) = (steep[0] % hill.Width, steep[0] / hill.Width);
        var big = LandFixture.Type("large_farm");
        var overSlope = PlacementValidator.Validate(hill, PlotOccupancy.None, big,
            Math.Clamp(sx - 2, 0, hill.Width - 5), Math.Clamp(sz - 2, 0, hill.Height - 5));
        Assert.True(overSlope.Footprint.Contains(sx, sz));
        Assert.Contains(PlacementCode.Slope, Codes(overSlope));

        // A downtown plot deep inside its lot has no road frontage.
        var metro = LandFixture.Layout("metropolis");
        var store = LandFixture.Type("convenience_store");
        var landlocked = Enumerable.Range(0, metro.PlotCount)
            .Where(i => metro.Kinds[i] == PlotKind.Parcel && metro.Districts[i] is District.Cbd or District.Commercial
                && metro.FrontageAt(i % metro.Width, i / metro.Width) == RoadClass.None)
            .Select(i => PlacementValidator.Validate(metro, PlotOccupancy.None, store, i % metro.Width, i / metro.Width))
            .Where(r => !r.Issues.Any(x => x.Code == PlacementCode.Zone))
            .ToList();
        Assert.NotEmpty(landlocked);
        Assert.All(landlocked, r => Assert.Equal([PlacementCode.NeedsRoad], Codes(r)));
    }

    [Fact]
    public void Building_over_ambient_development_costs_a_buy_out()
    {
        var l = LandFixture.Layout("metropolis");
        var store = LandFixture.Type("convenience_store");
        var shop = l.Parcels.First(p => p.Ambient?.Kind == AmbientKind.Shop && p.Rect.Area == 1 && !p.ForSale);
        var over = PlacementValidator.Validate(l, PlotOccupancy.None, store, shop.Px, shop.Pz);
        Assert.Equal(PlacementValidator.RedevelopmentValue(shop), over.RedevelopmentCost);
        Assert.True(over.RedevelopmentCost >= 550_000m);

        var vacant = l.Parcels.First(p => p.District is District.Commercial or District.Mixed && p.Ambient is null && p.Rect.Area == 1);
        var empty = PlacementValidator.Validate(l, PlotOccupancy.None, store, vacant.Px, vacant.Pz);
        Assert.Equal(0m, empty.RedevelopmentCost);
        Assert.True(vacant.ForSale);
        Assert.Equal(vacant.LandValue, empty.LandCost);

        // Taller buildings cost more to buy out than low ones on the same footprint.
        var tower = l.Parcels.Where(p => p.Ambient?.Kind == AmbientKind.Office).MaxBy(p => p.Ambient!.Floors)!;
        Assert.True(PlacementValidator.RedevelopmentValue(tower) > 20_000_000m);
        var pasture = l.Parcels.First(p => p.Ambient?.Kind == AmbientKind.Pasture);
        Assert.Equal(0m, PlacementValidator.RedevelopmentValue(pasture));
    }

    [Fact]
    public void Rotation_swaps_the_footprint_and_must_be_a_quarter_turn()
    {
        var seaport = LandFixture.Type("seaport");
        Assert.Equal((5, 3), PlacementValidator.RotatedSize(seaport.Footprint, 0));
        Assert.Equal((3, 5), PlacementValidator.RotatedSize(seaport.Footprint, 90));
        Assert.Equal((5, 3), PlacementValidator.RotatedSize(seaport.Footprint, 180));
        Assert.Equal((3, 5), PlacementValidator.RotatedSize(seaport.Footprint, -90));
        Assert.Equal(270, PlacementValidator.NormalizeRotation(-90));
        Assert.Throws<ArgumentException>(() => PlacementValidator.NormalizeRotation(45));
        var l = LandFixture.Layout("portbay");
        Assert.Throws<ArgumentException>(() => PlacementValidator.Validate(l, PlotOccupancy.None, seaport, 3, 3, 30));
    }

    [Fact]
    public void Current_fields_override_the_generated_ones()
    {
        var l = LandFixture.Layout("eastside");
        var type = LandFixture.Type("supermarket");
        var site = AutoSiter.FindSites(l, PlotOccupancy.None, type, SitePreference.Auto, 1).Single();
        var recomputed = CityFields.Compute(l, l.LandUses, CityFields.AmbientAttractors(l));
        var again = PlacementValidator.Validate(l, PlotOccupancy.None, type, site.Px, site.Pz, site.Rotation, recomputed);
        Assert.Equal(site.Placement.LandCost, again.LandCost);
        Assert.Equal(site.Placement.Site!.Traffic, again.Site!.Traffic);

        // An office district next door raises the land value of the site.
        var uses = l.LandUses.ToArray();
        foreach (var (x, z) in LandFixture.Plots(new PlotRect(Math.Max(0, site.Px - 4), Math.Max(0, site.Pz - 4), 12, 12)))
        {
            if (l.InBounds(x, z) && l.KindAt(x, z) == PlotKind.Parcel && !site.Placement.Footprint.Contains(x, z)) uses[z * l.Width + x] = LandUse.Office;
        }
        var boomed = PlacementValidator.Validate(l, PlotOccupancy.None, type, site.Px, site.Pz, site.Rotation, CityFields.Compute(l, uses, CityFields.AmbientAttractors(l)));
        Assert.True(boomed.LandCost > again.LandCost);
    }

    [Fact]
    public void Site_rules_follow_the_caplab_table()
    {
        Assert.Contains(SiteRules.For(LandFixture.Type("convenience_store")).Zones, z => z.District == District.Apartments && z.MinFrontage == RoadClass.Collector);
        var bigBox = SiteRules.For(LandFixture.Type("department_store"));
        Assert.Equal(SiteClass.Retail, bigBox.Class);
        Assert.DoesNotContain(bigBox.Zones, z => z.District == District.Apartments);
        Assert.All(bigBox.Zones, z => Assert.Equal(RoadClass.Collector, z.MinFrontage));
        Assert.Equal(SiteClass.Industry, SiteRules.For(LandFixture.Type("factory_large")).Class);
        Assert.Equal(SiteClass.Logistics, SiteRules.For(LandFixture.Type("warehouse_small")).Class);
        Assert.True(SiteRules.For(LandFixture.Type("seaport")).NeedsCoast);
        Assert.True(SiteRules.For(LandFixture.Type("small_plantation")).NeedsArable);
        Assert.Equal(DepositKind.Iron, SiteRules.For(LandFixture.Type("iron_mine")).Deposit);
        Assert.Equal(DepositKind.Oil, SiteRules.For(LandFixture.Type("oil_well")).Deposit);
        Assert.Equal(SiteClass.Media, SiteRules.For(LandFixture.Type("tv_station")).Class);
        Assert.Equal(SiteClass.Research, SiteRules.For(LandFixture.Type("rd_center")).Class);
        Assert.Equal(SiteClass.Office, SiteRules.ClassOf("some_future_category"));
        Assert.Equal(SiteClass.None, SiteRules.ClassOf("boardroom"));
        Assert.Equal("NEEDS_ROAD", PlacementCodes.Name(PlacementCode.NeedsRoad));
        Assert.Equal(10, Enum.GetValues<PlacementCode>().Select(PlacementCodes.Name).Distinct().Count());
    }
}
