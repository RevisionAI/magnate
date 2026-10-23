using System;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// The land save section: sites, land cost, construction in progress and schedules, orders
/// waiting for a site, held land, cleared parcels, retired buildings, layout revisions and the
/// layout seed survive a save/load round trip, and a resumed game continues exactly like an
/// uninterrupted one.
/// </summary>
public sealed class LandPersistenceTests
{
    /// <summary>A Realistic world with every kind of land state, plus AI rivals that keep building.</summary>
    private static World Script(int seed = 42)
    {
        var (world, a) = LandWorlds.Realistic(cash: 400_000_000m, seed: seed);
        var metropolis = LandWorlds.City("metropolis");
        var store = LandWorlds.BuildAt(world, a, "supermarket", "metropolis");
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.9m, 200_000);
        var factory = LandWorlds.BuildAt(world, a, "factory_large", "metropolis");
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));
        var doomed = LandWorlds.BuildAt(world, a, "department_store", "riverside");
        world.CancelConstruction(doomed.Id);
        var lot = world.GetParcels(metropolis).First(p => p.ForSale && p.Parcel.District == District.Rural);
        world.BuyLand(a, metropolis, lot.Parcel.Id);

        var poor = world.CreateCompany("Shoestring", 60_000m).Id;
        var order = world.Construct(poor, LandWorlds.Type("convenience_store"), LandWorlds.City("eastside"));
        Assert.True(order.Construction!.AwaitingSite);

        var rival = world.CreateCompany("Rival", 80_000_000m);
        world.RegisterAi(rival.Id, new AdaptiveStrategy());
        var chain = world.CreateCompany("Chain", 80_000_000m);
        world.RegisterAi(chain.Id, new VerticalIntegrator());
        return world;
    }

    [Fact]
    public void Save_and_load_mid_construction_continue_exactly_like_an_uninterrupted_run()
    {
        var direct = Script();
        for (var m = 0; m < 20; m++) direct.AdvanceMonth();

        var first = Script();
        for (var m = 0; m < 3; m++) first.AdvanceMonth();
        Assert.Contains(first.Buildings.Values, b => b.Construction is { AwaitingSite: false });
        var saved = WorldSaver.SaveToString(first);
        var resumed = WorldLoader.LoadFromString(first.Catalog, saved).World;
        Assert.Equal(saved, WorldSaver.SaveToString(resumed));
        Assert.Equal(LandDigest(first), LandDigest(resumed));
        for (var m = 3; m < 20; m++)
        {
            resumed.AdvanceMonth();
            LandWorlds.AssertBooksCloseWithHeldLand(resumed);
        }

        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(resumed));
        Assert.Equal(LandDigest(direct), LandDigest(resumed));
        Assert.Equal(WorldSaver.SaveToString(direct), WorldSaver.SaveToString(resumed));
    }

    [Fact]
    public void Round_trip_keeps_every_land_field()
    {
        var world = Script();
        world.AdvanceMonth();
        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;

        Assert.Equal(world.LayoutSeed, loaded.LayoutSeed);
        foreach (var b in world.Buildings.Values)
        {
            var c = loaded.Buildings[b.Id];
            Assert.Equal(b.Placement, c.Placement);
            Assert.Equal(b.SitedAt, c.SitedAt);
            Assert.Equal(world.GetLandCost(b.Id), loaded.GetLandCost(c.Id));
            Assert.Equal(world.GetConstructionInProgress(b.Id), loaded.GetConstructionInProgress(c.Id));
            Assert.Equal(b.RetiredAt, c.RetiredAt);
            Assert.Equal(b.CapitalizedCost, c.CapitalizedCost);
            Assert.Equal(b.BuiltAt, c.BuiltAt);
            Assert.Equal(b.Construction is null, c.Construction is null);
            if (b.Construction is { } x && c.Construction is { } y)
            {
                Assert.Equal((x.OrderedAt, x.StartedAt, x.CompletesAt, x.AwaitingSite, x.MonthsTotal, x.MonthsRemaining),
                    (y.OrderedAt, y.StartedAt, y.CompletesAt, y.AwaitingSite, y.MonthsTotal, y.MonthsRemaining));
                Assert.Equal((x.CostPaid, x.CostRemaining, x.Deposit, x.Instalment, x.FinalInstalment, x.PausedMonths),
                    (y.CostPaid, y.CostRemaining, y.Deposit, y.Instalment, y.FinalInstalment, y.PausedMonths));
            }
        }
        foreach (var city in world.Catalog.Cities.Keys)
        {
            Assert.Equal(world.GetLayoutRevision(city), loaded.GetLayoutRevision(city));
        }
        Assert.Equal(world.GetHeldLandAtCost(new CompanyId(1)), loaded.GetHeldLandAtCost(new CompanyId(1)));
        Assert.True(world.GetHeldLandAtCost(new CompanyId(1)) > 0m);
        LandWorlds.AssertSitesConsistent(loaded);
    }

    [Fact]
    public void Classic_saves_have_no_land_section()
    {
        var world = Worlds.Live();
        var c = world.CreateCompany("C", 10_000_000m).Id;
        world.Construct(c, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"));
        _ = world.GetCityLayout(LandWorlds.City("metropolis"));
        world.AdvanceMonth();
        var json = JsonNode.Parse(WorldSaver.SaveToString(world))!.AsObject();
        Assert.False(json.ContainsKey("land"));
    }

    [Fact]
    public void Realistic_saves_from_before_the_land_integration_keep_seed_one_and_get_their_buildings_sited()
    {
        var world = Script();
        world.AdvanceMonth();
        var json = JsonNode.Parse(WorldSaver.SaveToString(world))!.AsObject();
        json.Remove("land");

        var loaded = WorldLoader.LoadFromString(world.Catalog, json.ToJsonString()).World;

        Assert.Equal(CityLayoutGenerator.DefaultSeed, loaded.LayoutSeed);
        var live = loaded.Buildings.Values.Where(b => !b.IsRetired).ToList();
        Assert.All(live.Where(b => b.Construction is null), b => Assert.NotNull(b.Placement));
        LandWorlds.AssertSitesConsistent(loaded);
        for (var m = 0; m < 3; m++) loaded.AdvanceMonth();
    }

    /// <summary>Canonical text of the land state (sites, values, schedules, titles, revisions, fields).</summary>
    internal static string LandDigest(World world)
    {
        var sb = new StringBuilder();
        sb.Append("seed ").Append(world.LayoutSeed).Append('\n');
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            sb.Append(b.Id.Value).Append(' ').Append(b.Placement).Append(' ').Append(b.SitedAt).Append(' ')
              .Append(world.GetLandCost(b.Id)).Append(' ').Append(world.GetConstructionInProgress(b.Id)).Append(' ').Append(b.RetiredAt).Append(' ')
              .Append(b.Construction is { } c ? $"{c.OrderedAt}/{c.StartedAt}/{c.CompletesAt}/{c.AwaitingSite}/{c.MonthsRemaining}/{c.CostPaid}/{c.PausedMonths}" : "-")
              .Append('\n');
        }
        foreach (var city in world.Catalog.Cities.Keys.OrderBy(k => k.Value, StringComparer.Ordinal))
        {
            sb.Append(city.Value).Append(" rev ").Append(world.GetLayoutRevision(city));
            var fields = world.GetLandFields(city);
            decimal value = 0;
            double traffic = 0;
            for (var i = 0; i < fields.LandValues.Length; i++)
            {
                value += fields.LandValues[i];
                traffic += fields.Traffic[i];
            }
            sb.Append(" value ").Append(value).Append(" traffic ").Append(traffic.ToString("R", System.Globalization.CultureInfo.InvariantCulture)).Append('\n');
            foreach (var p in world.GetParcels(city).Where(p => p.Owner is not null || p.Cleared))
            {
                sb.Append("  parcel ").Append(p.Parcel.Id).Append(' ').Append(p.Owner).Append(' ').Append(p.Building).Append(' ').Append(p.Cleared).Append('\n');
            }
        }
        foreach (var c in world.Companies.Values.OrderBy(c => c.Id.Value))
        {
            foreach (var h in world.GetLandHoldings(c.Id)) sb.Append("held ").Append(c.Id.Value).Append(' ').Append(h).Append('\n');
        }
        return sb.ToString();
    }
}
