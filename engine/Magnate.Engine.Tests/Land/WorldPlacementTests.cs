using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// Placement through the World (E3b): every building type in every city is either sited on a
/// valid plot or refused for the right geographic reason; occupancy, land titles, buy-outs and
/// the layout seed behave.
/// </summary>
public sealed class WorldPlacementTests
{
    public static IEnumerable<object[]> TypesAndCities()
        => TestContent.Live.BuildingTypes.Keys.Select(t => t.Value).OrderBy(t => t, StringComparer.Ordinal)
            .SelectMany(t => TestContent.Live.Cities.Keys.Select(c => c.Value).OrderBy(c => c, StringComparer.Ordinal)
                .Select(c => new object[] { t, c }));

    [Theory]
    [MemberData(nameof(TypesAndCities))]
    public void Every_type_is_sited_validly_or_refused_for_geography_in_every_city(string typeId, string cityId)
    {
        var (world, company) = LandWorlds.Realistic(cash: 5_000_000_000m);
        var type = LandWorlds.Type(typeId);
        var city = LandWorlds.City(cityId);
        var sites = world.FindConstructionSites(company, type, city, SitePreference.Auto, 3);

        if (!world.MeetsGeographyRequirement(type, city))
        {
            Assert.Empty(sites);
            Assert.Throws<InvalidOperationException>(() => world.Construct(company, type, city));
            return;
        }

        if (sites.Count == 0)
        {
            // The city meets the geography flags but its layout has no free plot of the right
            // shape: Hilltown's farmland is terraced (slope 2+ only takes 2x2 or smaller), so a
            // 5x5 large farm never fits. The legacy path then places an order that waits.
            Assert.Equal(("large_farm", "hilltown"), (typeId, cityId));
            var order = world.Construct(company, type, city);
            Assert.True(order.Construction!.AwaitingSite);
            return;
        }
        foreach (var site in sites)
        {
            Assert.True(site.Ok);
            Assert.Empty(site.Placement.Issues);
            var again = world.QuoteConstruction(company, type, city, site.At);
            Assert.True(again.Ok, string.Join("; ", again.Placement.Issues.Select(i => i.CodeName)));
            Assert.Equal(site.UpfrontCost, again.UpfrontCost);
        }

        // Build on the best one, then the same plot is taken for everyone.
        var b = world.Construct(company, type, city, sites[0].At);
        Assert.Equal(sites[0].At, b.Placement);
        var retry = world.QuoteConstruction(company, type, city, sites[0].At);
        Assert.False(retry.Ok);
        Assert.Contains(retry.Placement.Issues, i => i.Code == PlacementCode.Occupied);
        LandWorlds.AssertSitesConsistent(world);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Roads_water_and_the_edge_of_the_map_are_refused_with_their_codes()
    {
        var (world, company) = LandWorlds.Realistic();
        var city = LandWorlds.City("metropolis");
        var layout = world.GetCityLayout(city);
        int Find(Func<int, bool> pred) => Enumerable.Range(0, layout.PlotCount).First(pred);
        var road = Find(i => layout.Kinds[i] == PlotKind.Road);
        var water = Find(i => layout.Kinds[i] == PlotKind.Water);

        PlacementCode[] Codes(PlotRef at) => world.QuoteConstruction(company, LandWorlds.Type("convenience_store"), city, at)
            .Placement.Issues.Select(i => i.Code).ToArray();

        Assert.Contains(PlacementCode.Road, Codes(new PlotRef(road % layout.Width, road / layout.Width)));
        Assert.Contains(PlacementCode.Water, Codes(new PlotRef(water % layout.Width, water / layout.Width)));
        Assert.Contains(PlacementCode.OutOfBounds, Codes(new PlotRef(layout.Width, 0)));
        Assert.Contains(PlacementCode.OutOfBounds, Codes(new PlotRef(-1, 3)));
        Assert.Throws<ArgumentException>(() => world.QuoteConstruction(company, LandWorlds.Type("convenience_store"), city, new PlotRef(3, 3, 45)));
    }

    [Fact]
    public void Rotation_swaps_the_footprint_and_is_recorded()
    {
        var (world, company) = LandWorlds.Realistic(cash: 5_000_000_000m);
        // Seaport is 5x3: a rotated site is 3x5.
        var sites = world.FindConstructionSites(company, LandWorlds.Type("seaport"), LandWorlds.City("metropolis"), SitePreference.Auto, 10);
        Assert.NotEmpty(sites);
        foreach (var s in sites)
        {
            var (w, h) = (s.Placement.Footprint.W, s.Placement.Footprint.H);
            Assert.Equal(s.At.Rotation is 90 or 270 ? (3, 5) : (5, 3), (w, h));
        }
        var b = world.Construct(company, LandWorlds.Type("seaport"), LandWorlds.City("metropolis"), sites[0].At);
        Assert.Equal(sites[0].At.Rotation, b.Placement!.Value.Rotation);
        LandWorlds.AssertSitesConsistent(world);
    }

    [Fact]
    public void Building_over_ambient_development_pays_the_buy_out_once_per_parcel()
    {
        var (world, company) = LandWorlds.Realistic(cash: 5_000_000_000m);
        var city = LandWorlds.City("metropolis");
        var layout = world.GetCityLayout(city);
        var type = LandWorlds.Type("convenience_store");
        // A shop or house parcel larger than one plot, so a second store fits on it.
        var parcel = layout.Parcels.First(p => p.Ambient is { IsStructure: true } && p.Rect.Area >= 2
            && world.QuoteConstruction(company, type, city, new PlotRef(p.Px, p.Pz)).Ok
            && world.QuoteConstruction(company, type, city, new PlotRef(p.Px + (p.W > 1 ? 1 : 0), p.Pz + (p.W > 1 ? 0 : 1))).Ok);
        var first = world.QuoteConstruction(company, type, city, new PlotRef(parcel.Px, parcel.Pz));
        Assert.Equal(PlacementValidator.RedevelopmentValue(parcel), first.RedevelopmentCost);
        Assert.True(first.RedevelopmentCost > 0m);

        var b = world.Construct(company, type, city, first.At);
        Assert.Equal(first.LandCost + first.RedevelopmentCost, world.GetLandCost(b.Id));
        Assert.True(world.GetParcel(city, parcel.Id).Cleared);

        var secondAt = new PlotRef(parcel.Px + (parcel.W > 1 ? 1 : 0), parcel.Pz + (parcel.W > 1 ? 0 : 1));
        var second = world.QuoteConstruction(company, type, city, secondAt);
        Assert.True(second.Ok);
        Assert.Equal(0m, second.RedevelopmentCost);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Each_game_has_its_own_cities_and_old_style_worlds_keep_seed_one()
    {
        var (a, _) = LandWorlds.Realistic(seed: 42);
        var (b, _) = LandWorlds.Realistic(seed: 7);
        Assert.Equal(42, a.LayoutSeed);
        Assert.Equal(7, b.LayoutSeed);
        var city = LandWorlds.City("riverside");
        Assert.NotEqual(a.GetCityLayout(city).ComputeHash(), b.GetCityLayout(city).ComputeHash());
        Assert.Equal(CityLayoutGenerator.Generate(TestContent.Live.City(city), 42).ComputeHash(), a.GetCityLayout(city).ComputeHash());
        Assert.Same(a.GetCityLayout(city), a.GetCityLayout(city));
        Assert.Equal(CityLayoutGenerator.DefaultSeed, Worlds.Live().LayoutSeed);
    }

    [Fact]
    public void Legacy_construct_auto_sites_and_orders_wait_when_nothing_is_affordable()
    {
        var (world, company) = LandWorlds.Realistic(cash: 300_000_000m);
        var city = LandWorlds.City("hilltown");
        var b = world.Construct(company, LandWorlds.Type("supermarket"), city);
        Assert.NotNull(b.Placement);
        Assert.False(b.Construction!.AwaitingSite);
        Assert.True(world.GetLandCost(b.Id) > 0m);

        // A poor company's order waits for a site: nothing is paid, nothing occupies the map.
        var poor = world.CreateCompany("Poor", 50_000m).Id;
        var order = world.Construct(poor, LandWorlds.Type("supermarket"), city);
        Assert.True(order.Construction!.AwaitingSite);
        Assert.Null(order.Placement);
        Assert.Equal(0m, order.BookValue);
        Assert.Equal(50_000m, world.Companies[poor].Cash);
        world.ConfigureRetailSlot(order.Id, 0, new ProductId("soft_drink"), 2m, 100);
        LandWorlds.Run(world, 2);
        Assert.True(order.Construction!.AwaitingSite);
        Assert.Equal(0.0, order.Construction.Progress);

        // With money the order is sited at the next month close and starts its works.
        world.RecordCashChange(poor, LedgerCategory.StartingCapital, 500_000_000m, "investor");
        LandWorlds.Run(world, 1);
        Assert.False(order.Construction!.AwaitingSite);
        Assert.NotNull(order.Placement);
        Assert.Equal(world.Clock.Now, order.Construction.StartedAt);
        Assert.True(world.GetConstructionInProgress(order.Id) > 0m);

        // Geography is still enforced on the legacy path.
        Assert.Throws<InvalidOperationException>(() => world.Construct(company, LandWorlds.Type("seaport"), city));
    }

    [Fact]
    public void Construction_cost_of_an_instant_order_is_paid_when_it_is_sited()
    {
        var rules = LandWorlds.Instant;
        var (world, company) = LandWorlds.Realistic(cash: 10_000m, rules: rules);
        var order = world.Construct(company, LandWorlds.Type("convenience_store"), LandWorlds.City("metropolis"));
        Assert.True(order.Construction!.AwaitingSite);
        world.RecordCashChange(company, LedgerCategory.StartingCapital, 100_000_000m, "investor");
        LandWorlds.Run(world, 1);
        Assert.True(order.IsOperational);
        Assert.Equal(world.Catalog.BuildingType(order.TypeId).ConstructionCost, order.CapitalizedCost);
    }

    [Fact]
    public void Releasing_a_site_frees_its_plots_for_others()
    {
        // The hook E2's disposal (sale, demolition, liquidation) calls before a building leaves.
        var (world, company) = LandWorlds.Realistic();
        var city = LandWorlds.City("metropolis");
        var b = LandWorlds.BuildAt(world, company, "convenience_store", "metropolis");
        var at = b.Placement!.Value;
        var rival = world.CreateCompany("Rival", 500_000_000m).Id;
        Assert.False(world.QuoteConstruction(rival, b.TypeId, city, at).Ok);
        var rev = world.GetLayoutRevision(city);

        world.ReleaseSite(b);
        Assert.Null(world.BuildingAtPlot(city, at.Px, at.Pz));
        Assert.True(world.QuoteConstruction(rival, b.TypeId, city, at).Ok);
        Assert.True(world.GetLayoutRevision(city) > rev);
    }
}
