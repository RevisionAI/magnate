using System;
using System.Linq;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>Structural invariants on every content city across several seeds.</summary>
public sealed class CityLayoutInvariantTests
{
    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Roads_form_one_connected_network(string city, int seed)
        => LayoutInvariants.RoadsFormOneNetwork(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Roads_are_one_plot_wide_without_parallel_doubles(string city, int seed)
        => LayoutInvariants.NoTwoByTwoRoadSquares(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Every_parcel_touches_a_road(string city, int seed)
        => LayoutInvariants.EveryParcelTouchesARoad(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Parcels_partition_their_plots(string city, int seed)
        => LayoutInvariants.ParcelsTileTheirPlots(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Road_segments_match_the_road_grid(string city, int seed)
        => LayoutInvariants.RoadListMatchesTheGrid(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Bridges_run_bank_to_bank_in_one_class(string city, int seed)
        => LayoutInvariants.BridgesRunBankToBankInOneClass(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Water_rectangles_cover_the_water(string city, int seed)
        => LayoutInvariants.WaterRectsCoverTheWater(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Fields_are_in_range(string city, int seed)
        => LayoutInvariants.FieldsAreInRange(LandFixture.Layout(city, seed));

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Highways_run_to_the_map_edge(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var profile = CityProfiles.Resolve(LandFixture.City(city));
        foreach (var direction in profile.Highways)
        {
            var onEdge = direction switch
            {
                Compass.North => Enumerable.Range(0, l.Width).Any(x => l.RoadAt(x, 0) == RoadClass.Highway),
                Compass.South => Enumerable.Range(0, l.Width).Any(x => l.RoadAt(x, l.Height - 1) == RoadClass.Highway),
                Compass.West => Enumerable.Range(0, l.Height).Any(z => l.RoadAt(0, z) == RoadClass.Highway),
                _ => Enumerable.Range(0, l.Height).Any(z => l.RoadAt(l.Width - 1, z) == RoadClass.Highway),
            };
            Assert.True(onEdge, $"{city}/{seed}: no highway reaches the {direction} edge");
        }
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Landmarks_and_civic_sites_exist(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var hall = Assert.Single(l.Landmarks, m => m.Kind == LandmarkKind.CityHall);
        Assert.True(Distance(hall.Rect, l) <= 0.5 * l.UrbanRadius + 3, $"city hall {hall.Rect} is far from the CBD");
        Assert.Contains(l.Landmarks, m => m.Kind == LandmarkKind.Bank);
        Assert.Contains(l.Landmarks, m => m.Kind == LandmarkKind.CentralPark);
        Assert.Contains(l.Landmarks, m => m.Kind == LandmarkKind.Hospital);

        // The stock exchange and the investment bank belong to the financial capital.
        var capital = city == "metropolis";
        Assert.Equal(capital, l.Landmarks.Any(m => m.Kind == LandmarkKind.StockExchange));
        Assert.Equal(capital, l.Landmarks.Any(m => m.Kind == LandmarkKind.InvestmentBank));
        Assert.Equal(l.Geography.Coastal, l.Landmarks.Any(m => m.Kind == LandmarkKind.Port));

        foreach (var m in l.Landmarks)
        {
            var parcel = l.ParcelById(m.ParcelId);
            Assert.Equal(m.Rect, parcel.Rect);
            Assert.Equal(m.Kind, parcel.Landmark);
            Assert.False(parcel.ForSale);
        }
        Assert.Contains(l.Parcels, p => p.Ambient is { Kind: AmbientKind.Civic, Civic: CivicKind.School });
    }

    [Theory]
    [MemberData(nameof(LandFixture.CitiesAndSeeds), MemberType = typeof(LandFixture))]
    public void Terrain_heights_exist_only_for_hilly_cities(string city, int seed)
    {
        var l = LandFixture.Layout(city, seed);
        var hilly = city is "hilltown" or "riverside";
        Assert.Equal(hilly, l.HasTerrain);
        if (!hilly)
        {
            Assert.Equal(0, l.CornerHeights.Length);
            Assert.All(Enumerable.Range(0, l.PlotCount), i => Assert.Equal(0, l.SlopeClasses[i]));
            return;
        }
        Assert.Equal((l.Width + 1) * (l.Height + 1), l.CornerHeights.Length);
        Assert.All(l.CornerHeights.ToArray(), h => Assert.InRange(h, 0f, 200f));
        // Water lies at 0 m: every corner surrounded by water is at sea level.
        for (var z = 1; z < l.Height; z++)
        {
            for (var x = 1; x < l.Width; x++)
            {
                var wet = l.WaterAt(x - 1, z - 1) != WaterKind.None && l.WaterAt(x, z - 1) != WaterKind.None
                    && l.WaterAt(x - 1, z) != WaterKind.None && l.WaterAt(x, z) != WaterKind.None;
                if (wet) Assert.Equal(0f, l.CornerHeight(x, z));
            }
        }
        if (city == "hilltown")
        {
            // The town sits on the hilltop: the CBD is higher than the countryside.
            var cbd = l.PlotHeight(l.Cbd.Px, l.Cbd.Pz);
            Assert.True(cbd > l.PlotHeight(1, 1) + 5 && cbd > l.PlotHeight(l.Width - 2, l.Height - 2) + 5, $"CBD at {cbd:F1} m is not on the hill");
            Assert.Contains(Enumerable.Range(0, l.PlotCount), i => l.SlopeClasses[i] >= 1);
        }
    }

    private static double Distance(PlotRect r, CityLayout l)
        => Math.Sqrt(Math.Pow(r.Px + r.W / 2.0 - l.CbdX, 2) + Math.Pow(r.Pz + r.H / 2.0 - l.CbdZ, 2));
}
