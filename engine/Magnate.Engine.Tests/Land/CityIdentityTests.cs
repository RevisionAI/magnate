using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>Geography, zoning rings, land value and the five city identities (caplab-brief §5.2–5.5).</summary>
public sealed class CityIdentityTests
{
    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Water_and_ports_follow_the_coastal_flag(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var sea = Enumerable.Range(0, l.PlotCount).Count(i => l.WaterKinds[i] == WaterKind.Sea);
        var ports = l.Parcels.Where(p => p.District == District.Port).ToList();
        if (l.Geography.Coastal)
        {
            Assert.InRange(sea / (double)l.PlotCount, 0.06, 0.2);
            Assert.NotEmpty(ports);
            // Port land is quayside: every plot lies within three plots of the sea,
            // and the quay is lined with lots that front the water.
            foreach (var p in ports)
            {
                foreach (var (x, z) in LandFixture.Plots(p.Rect))
                {
                    var near = false;
                    for (var dz = -3; dz <= 3 && !near; dz++)
                    {
                        for (var dx = -3; dx <= 3 && !near; dx++) near = l.InBounds(x + dx, z + dz) && l.WaterAt(x + dx, z + dz) == WaterKind.Sea;
                    }
                    Assert.True(near, $"port parcel {p.Id} plot ({x},{z}) is not quayside");
                }
            }
            Assert.True(ports.Count(p => Touches(l, p.Rect, (x, z) => l.WaterAt(x, z) == WaterKind.Sea)) * 2 > ports.Count);
        }
        else
        {
            Assert.Equal(0, sea);
            Assert.Empty(ports);
        }
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Deposits_exist_exactly_where_the_geography_says(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var iron = l.Deposits.Where(d => d.Resource == DepositKind.Iron).ToList();
        var oil = l.Deposits.Where(d => d.Resource == DepositKind.Oil).ToList();
        Assert.Equal(l.Geography.MineralRich, iron.Count > 0);
        Assert.Equal(l.Geography.OilRich, oil.Count > 0);
        Assert.InRange(l.Deposits.Count(d => !d.Offshore), l.Deposits.Count == 0 ? 0 : 2, 12);
        if (!l.Geography.Coastal) Assert.DoesNotContain(l.Deposits, d => d.Offshore);

        foreach (var d in l.Deposits)
        {
            Assert.InRange(d.Quality, 35, 85);
            Assert.True(d.Reserve > 0);
            foreach (var (x, z) in LandFixture.Plots(d.Rect))
            {
                Assert.Equal(d.Id, l.DepositAt(x, z)!.Id);
                if (d.Offshore)
                {
                    Assert.Equal(WaterKind.Sea, l.WaterAt(x, z));
                    continue;
                }
                var parcel = l.ParcelAt(x, z)!;
                Assert.Equal(Zone.Agricultural, parcel.Zone);
                Assert.Equal(d.Id, parcel.DepositId);
                Assert.Equal(AmbientKind.Deposit, parcel.Ambient!.Kind);
                Assert.Equal(d.Resource, parcel.Ambient.Deposit);
            }
        }
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Farmland_only_in_arable_cities(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var crops = l.Parcels.Count(p => p.Ambient?.Kind is AmbientKind.Field or AmbientKind.Orchard or AmbientKind.Vineyard);
        var scrub = l.Parcels.Count(p => p.Ambient?.Kind == AmbientKind.Scrub);
        if (l.Geography.Arable)
        {
            Assert.True(crops > 10, $"{city}: only {crops} crop parcels");
            Assert.Equal(0, scrub);
        }
        else
        {
            Assert.Equal(0, crops);
            Assert.True(scrub > 10, $"{city}: only {scrub} scrub parcels");
        }
        if (l.Geography.Arable) Assert.Contains(l.Parcels, p => p.Ambient?.Kind == AmbientKind.Forest);
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Districts_follow_the_rings_outward_from_the_CBD(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        double Mean(District d)
        {
            var plots = Enumerable.Range(0, l.PlotCount).Where(i => l.Kinds[i] == PlotKind.Parcel && l.Districts[i] == d).ToList();
            Assert.True(plots.Count > 0, $"{city}/{seed}: no {d} plots");
            return plots.Average(i => l.DistanceToCbd(i % l.Width, i / l.Width));
        }
        var cbd = Mean(District.Cbd);
        var commercial = Mean(District.Commercial);
        var apartments = Mean(District.Apartments);
        var houses = Mean(District.Houses);
        var rural = Mean(District.Rural);
        Assert.True(cbd < commercial && commercial < houses && apartments < houses && houses < rural,
            $"{city}/{seed}: ring distances CBD {cbd:F1}, commercial {commercial:F1}, apartments {apartments:F1}, houses {houses:F1}, rural {rural:F1}");
        Assert.True(cbd < 0.35 * l.UrbanRadius, $"{city}/{seed}: CBD mean distance {cbd:F1} vs R_u {l.UrbanRadius:F1}");
        Assert.Contains(l.Parcels, p => p.District == District.Industrial);
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Land_value_falls_away_from_the_CBD(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var bands = new List<double>();
        foreach (var (lo, hi) in new[] { (0.0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1.0), (1.25, 9.0) })
        {
            var values = new List<double>();
            for (var i = 0; i < l.PlotCount; i++)
            {
                if (l.Kinds[i] != PlotKind.Parcel || l.DepositIds[i] != 0) continue;
                var d = l.DistanceToCbd(i % l.Width, i / l.Width) / l.UrbanRadius;
                if (d >= lo && d < hi) values.Add((double)l.LandValues[i]);
            }
            Assert.True(values.Count > 0, $"{city}/{seed}: no plots in band {lo}-{hi}");
            values.Sort();
            bands.Add(values[values.Count / 2]);
        }
        for (var k = 1; k < bands.Count; k++)
        {
            Assert.True(bands[k] < bands[k - 1], $"{city}/{seed}: median land value by distance band {string.Join(" > ", bands.Select(b => b.ToString("N0")))}");
        }
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Traffic_is_busiest_downtown_and_on_avenues(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        double Mean(Func<int, bool> predicate) => Enumerable.Range(0, l.PlotCount).Where(predicate).Average(i => l.TrafficValues[i]);
        var cbd = Mean(i => l.Kinds[i] == PlotKind.Parcel && l.Districts[i] == District.Cbd);
        var houses = Mean(i => l.Kinds[i] == PlotKind.Parcel && l.Districts[i] == District.Houses);
        var rural = Mean(i => l.Kinds[i] == PlotKind.Parcel && l.Districts[i] == District.Rural);
        Assert.True(cbd > houses && houses > rural, $"{city}/{seed}: traffic CBD {cbd:F1}, houses {houses:F1}, rural {rural:F1}");
        var arterial = Mean(i => l.RoadClasses[i] == RoadClass.Arterial);
        var local = Mean(i => l.RoadClasses[i] == RoadClass.Local);
        Assert.True(arterial > local, $"{city}/{seed}: arterial traffic {arterial:F1} vs local {local:F1}");
        // The econ location factor is centred on the median urban plot.
        Assert.InRange(l.Fields.LocationFactor(l.MedianUrbanTraffic), 0.999, 1.001);
    }

    [Fact]
    public void Metropolis_land_prices_have_real_2026_magnitudes()
    {
        // caplab §5.4 / econ §4.3, MASTER-PLAN D4: CBD ≈ $0.8M per 24 m plot, urban
        // edge ≈ $35k, mid-distance industry ≈ $58k, farmland ≈ $5.6k.
        var l = LandFixture.Layout("metropolis");
        decimal Median(District d)
        {
            var v = l.Parcels.Where(p => p.District == d && p.DepositId == 0).Select(p => p.LandValuePerPlot).OrderBy(x => x).ToList();
            return v[v.Count / 2];
        }
        Assert.InRange(Median(District.Cbd), 400_000m, 1_500_000m);
        Assert.InRange(Median(District.Houses), 20_000m, 120_000m);
        Assert.InRange(Median(District.Industrial), 12_000m, 120_000m);
        Assert.InRange(Median(District.Rural), 2_000m, 15_000m);
        // A 3×3 downtown supermarket site costs millions of dollars of land.
        var cbdPlot = l.Parcels.Where(p => p.District == District.Cbd).Max(p => p.LandValuePerPlot);
        Assert.InRange(cbdPlot * 9, 4_000_000m, 15_000_000m);
    }

    [Fact]
    public void Land_value_scales_with_the_city_base_land_price()
    {
        var city = LandFixture.City("eastside");
        var dear = city with { BaseLandPrice = city.BaseLandPrice * 2 };
        var a = CityLayoutGenerator.Generate(city, 3);
        var b = CityLayoutGenerator.Generate(dear, 3);
        Assert.Equal(a.Parcels.Select(p => p.Rect), b.Parcels.Select(p => p.Rect));
        Assert.True(a.Kinds.SequenceEqual(b.Kinds));
        for (var i = 0; i < a.PlotCount; i++)
        {
            if (a.LandValues[i] == 0) continue;
            Assert.InRange((double)(b.LandValues[i] / a.LandValues[i]), 1.99, 2.01);
        }
    }

    [Fact]
    public void Each_city_has_its_identity()
    {
        // Metropolis: coastal capital with the towers, the bay CBD, a port and an industrial wedge.
        var metro = LandFixture.Layout("metropolis");
        Assert.Equal(CoastSide.East, CityProfiles.Resolve(LandFixture.City("metropolis")).Coast);
        var tallest = metro.Parcels.Where(p => p.Ambient?.Kind == AmbientKind.Office).Max(p => p.Ambient!.Floors);
        Assert.True(tallest >= 40, $"tallest Metropolis tower has {tallest} floors");
        var toSea = Enumerable.Range(0, metro.PlotCount).Where(i => metro.WaterKinds[i] == WaterKind.Sea)
            .Min(i => metro.DistanceToCbd(i % metro.Width, i / metro.Width));
        Assert.True(toSea < 0.35 * metro.UrbanRadius, $"the CBD is {toSea:F1} plots from the bay");
        Assert.Contains(metro.Water, w => w.Shore == ShoreKind.Quay);

        // Riverside: a river through the centre crossed by bridges; industry downstream.
        var river = LandFixture.Layout("riverside");
        Assert.Contains(river.Water, w => w.Kind == WaterKind.River);
        Assert.True(river.Roads.Count(r => r.Bridge) >= 2, "Riverside needs bridges");
        Assert.True(Enumerable.Range(0, river.PlotCount).Any(i => river.WaterKinds[i] == WaterKind.River && river.DistanceToCbd(i % river.Width, i / river.Width) < 3),
            "the river runs through the centre");

        // Eastside: leafy and affluent — villas and parks, little industry.
        var east = LandFixture.Layout("eastside");
        Assert.True(east.Parcels.Count(p => p.Ambient?.Kind == AmbientKind.Villa) > east.Parcels.Count(p => p.Ambient?.Kind == AmbientKind.Rowhouse));
        Assert.True(Share(east, District.Industrial) < Share(metro, District.Industrial));

        // Portbay: oil fields, tank farms, scrub instead of farms.
        var port = LandFixture.Layout("portbay");
        Assert.Contains(port.Deposits, d => d.Resource == DepositKind.Oil && d.Offshore);
        Assert.Equal(Climate.Warm, port.Climate);

        // Hilltown: small, hilly, affluent — vineyards on the slopes, the priciest land per plot.
        var hill = LandFixture.Layout("hilltown");
        Assert.Contains(hill.Parcels, p => p.Ambient?.Kind == AmbientKind.Vineyard);
        Assert.True(hill.Parcels.Where(p => p.District == District.Cbd).Max(p => p.LandValuePerPlot)
            > metro.Parcels.Where(p => p.District == District.Cbd).Max(p => p.LandValuePerPlot) * 0.8m);
    }

    private static double Share(CityLayout l, District d) => Enumerable.Range(0, l.PlotCount).Count(i => l.Districts[i] == d) / (double)l.PlotCount;

    private static bool Touches(CityLayout l, PlotRect r, Func<int, int, bool> predicate)
    {
        foreach (var (x, z) in LandFixture.Plots(r))
        {
            foreach (var (dx, dz) in new[] { (0, 1), (1, 0), (0, -1), (-1, 0) })
            {
                var nx = x + dx;
                var nz = z + dz;
                if (l.InBounds(nx, nz) && !r.Contains(nx, nz) && predicate(nx, nz)) return true;
            }
        }
        return false;
    }
}
