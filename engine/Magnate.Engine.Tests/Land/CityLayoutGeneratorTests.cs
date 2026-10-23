using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

public sealed class CityLayoutGeneratorTests
{
    [Theory]
    [MemberData(nameof(LandFixture.Cities), MemberType = typeof(LandFixture))]
    public void Same_seed_gives_an_identical_layout(string cityId)
    {
        var city = LandFixture.City(cityId);
        var a = CityLayoutGenerator.Generate(city, 1234);
        var b = CityLayoutGenerator.Generate(city, 1234);

        Assert.Equal(a.ComputeHash(), b.ComputeHash());
        Assert.True(a.Kinds.SequenceEqual(b.Kinds));
        Assert.True(a.RoadClasses.SequenceEqual(b.RoadClasses));
        Assert.True(a.LandValues.SequenceEqual(b.LandValues));
        Assert.True(a.TrafficValues.SequenceEqual(b.TrafficValues));
        Assert.Equal(a.Parcels, b.Parcels);
        Assert.Equal(a.Roads, b.Roads);
    }

    [Theory]
    [MemberData(nameof(LandFixture.Cities), MemberType = typeof(LandFixture))]
    public void Different_seeds_give_different_layouts(string cityId)
    {
        var city = LandFixture.City(cityId);
        var hashes = new[] { 1, 2, 3 }.Select(seed => CityLayoutGenerator.Generate(city, seed).ComputeHash()).ToList();
        Assert.Equal(3, hashes.Distinct().Count());
    }

    [Fact]
    public void Generation_has_no_hidden_state_between_cities()
    {
        var first = LandFixture.CityIds.Select(id => CityLayoutGenerator.Generate(LandFixture.City(id), 5).ComputeHash()).ToList();
        var reversed = LandFixture.CityIds.Reverse().Select(id => CityLayoutGenerator.Generate(LandFixture.City(id), 5).ComputeHash()).Reverse().ToList();
        Assert.Equal(first, reversed);
    }

    [Theory]
    [MemberData(nameof(LandFixture.Cities), MemberType = typeof(LandFixture))]
    public void Every_content_city_generates_a_full_layout(string cityId)
    {
        var city = LandFixture.City(cityId);
        var layout = LandFixture.Layout(cityId);

        Assert.Equal(city.Grid.Width, layout.Width);
        Assert.Equal(city.Grid.Height, layout.Height);
        Assert.Equal(cityId, layout.ProfileKey);
        Assert.Equal(CityLayoutGenerator.DefaultSeed, layout.Seed);
        Assert.Equal(24.0, CityLayout.PlotSizeMetres);
        Assert.NotEmpty(layout.Roads);
        Assert.True(layout.Parcels.Count > layout.PlotCount / 20, $"{layout.Parcels.Count} parcels");
        Assert.True(layout.UrbanRadius > 4);
        Assert.InRange(layout.CbdX, 0, layout.Width);
        Assert.InRange(layout.CbdZ, 0, layout.Height);

        // Parcels are numbered 1..n in row-major order of their north-west corner.
        for (var k = 0; k < layout.Parcels.Count; k++) Assert.Equal(k + 1, layout.Parcels[k].Id);
        var corners = layout.Parcels.Select(p => p.Pz * layout.Width + p.Px).ToList();
        Assert.Equal(corners.OrderBy(c => c), corners);
    }

    [Fact]
    public void Built_in_profiles_cover_the_five_content_cities_and_others_get_the_generic_one()
    {
        foreach (var id in LandFixture.CityIds)
        {
            Assert.Equal(id, CityProfiles.Resolve(LandFixture.City(id)).Key);
        }

        var atlantis = Modded("atlantis", 320_000, coastal: true, arable: true, mineral: true, oil: true);
        Assert.Equal(CityProfiles.GenericKey, CityProfiles.Resolve(atlantis).Key);
    }

    [Fact]
    public void An_unknown_city_gets_a_plausible_layout_from_its_geography()
    {
        var atlantis = Modded("atlantis", 320_000, coastal: true, arable: true, mineral: true, oil: true);
        var layout = CityLayoutGenerator.Generate(atlantis, 9);
        Assert.Equal(CityProfiles.GenericKey, layout.ProfileKey);
        Assert.Contains(layout.Water, w => w.Kind == WaterKind.Sea);
        Assert.Contains(layout.Deposits, d => d.Resource == DepositKind.Iron && !d.Offshore);
        Assert.Contains(layout.Deposits, d => d.Resource == DepositKind.Oil && !d.Offshore);
        Assert.Contains(layout.Parcels, p => p.District == District.Port);
        Assert.Contains(layout.Landmarks, l => l.Kind == LandmarkKind.CityHall);
        LayoutInvariants.AssertAll(layout);

        // The same modded city always gets the same identity and layout.
        Assert.Equal(layout.ComputeHash(), CityLayoutGenerator.Generate(atlantis, 9).ComputeHash());

        var dustbowl = Modded("dustbowl", 60_000, coastal: false, arable: false, mineral: false, oil: false, size: 32);
        var small = CityLayoutGenerator.Generate(dustbowl, 3);
        Assert.DoesNotContain(small.Water, w => w.Kind == WaterKind.Sea);
        Assert.Empty(small.Deposits);
        Assert.DoesNotContain(small.Parcels, p => p.Ambient?.Kind is AmbientKind.Field or AmbientKind.Orchard or AmbientKind.Vineyard);
        LayoutInvariants.AssertAll(small);
    }

    [Fact]
    public void Grids_outside_16_to_256_plots_are_rejected()
    {
        var tiny = Modded("tiny", 50_000, false, true, false, false, size: 12);
        Assert.Throws<ArgumentOutOfRangeException>(() => CityLayoutGenerator.Generate(tiny, 1));
        Assert.Throws<ArgumentNullException>(() => CityLayoutGenerator.Generate(null!, 1));
    }

    internal static City Modded(string id, long population, bool coastal, bool arable, bool mineral, bool oil, int size = 56)
        => new(
            new CityId(id),
            char.ToUpperInvariant(id[0]) + id[1..],
            population,
            new Dictionary<IncomeBracket, double> { [IncomeBracket.Low] = 0.4, [IncomeBracket.Middle] = 0.4, [IncomeBracket.High] = 0.2 },
            new CityGrid(size, size),
            new CityGeography(coastal, arable, mineral, oil),
            120m);
}
