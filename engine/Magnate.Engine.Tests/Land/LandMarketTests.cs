using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// The land market (bridge-spec §8.2): listed parcels can be bought outright at their current
/// value, held land costs nothing more to build on, other companies' land is unavailable, and
/// held land sells back at market value with a disposal gain or loss.
/// </summary>
public sealed class LandMarketTests
{
    private static (World World, CompanyId A, CompanyId B, CityId City, Parcel Lot) Setup()
    {
        var (world, a) = LandWorlds.Realistic(cash: 1_000_000_000m);
        var b = world.CreateCompany("Rival", 1_000_000_000m).Id;
        var city = LandWorlds.City("metropolis");
        // A listed commercial lot big enough for a supermarket.
        var lot = world.GetParcels(city)
            .Where(p => p.ForSale && p.Parcel.Rect.W >= 3 && p.Parcel.Rect.H >= 3)
            .Select(p => p.Parcel)
            .First(p => world.QuoteConstruction(a, LandWorlds.Type("supermarket"), city, new PlotRef(p.Px, p.Pz)).Ok);
        return (world, a, b, city, lot);
    }

    [Fact]
    public void Buying_a_listed_parcel_pays_its_value_and_titles_every_plot()
    {
        var (world, a, _, city, lot) = Setup();
        var info = world.GetParcel(city, lot.Id);
        Assert.True(info.ForSale);
        Assert.Equal(info.LandValue, info.AskingPrice);
        var cash = world.Companies[a].Cash;
        var rev = world.GetLayoutRevision(city);

        var deal = world.BuyLand(a, city, lot.Id);

        Assert.Equal(info.LandValue, deal.Amount);
        Assert.Equal(cash - deal.Amount, world.Companies[a].Cash);
        Assert.Equal(lot.Rect.Area, world.GetLandHoldings(a).Count);
        Assert.Equal(deal.Amount, world.GetHeldLandAtCost(a));
        Assert.Equal(deal.Amount, world.GetLandAtCost(a));
        Assert.Equal(a, world.LandOwnerAt(city, lot.Px, lot.Pz));
        Assert.True(world.GetLayoutRevision(city) > rev);
        var after = world.GetParcel(city, lot.Id);
        Assert.False(after.ForSale);
        Assert.Equal(a, after.Owner);
        Assert.Single(world.Ledger.Entries, e => e.Category == LedgerCategory.LandPurchase && e.Amount == -deal.Amount && e.Building is null);
        LandWorlds.AssertBooksCloseWithHeldLand(world);
        var ex = Assert.Throws<LandMarketException>(() => world.BuyLand(a, city, lot.Id));
        Assert.Equal(LandMarketError.NotForSale, ex.Error);
    }

    [Fact]
    public void Building_on_held_land_costs_no_more_land_and_absorbs_its_basis()
    {
        var (world, a, b, city, lot) = Setup();
        world.BuyLand(a, city, lot.Id);
        var at = new PlotRef(lot.Px, lot.Pz);

        var own = world.QuoteConstruction(a, LandWorlds.Type("supermarket"), city, at);
        Assert.True(own.Ok);
        Assert.Equal(0m, own.LandCost);
        Assert.True(own.HeldLandBasis > 0m);

        var rival = world.QuoteConstruction(b, LandWorlds.Type("supermarket"), city, at);
        Assert.False(rival.Ok);
        Assert.Contains(rival.Placement.Issues, i => i.Code == PlacementCode.Occupied);
        Assert.DoesNotContain(world.FindConstructionSites(b, LandWorlds.Type("convenience_store"), city, SitePreference.Cheapest, 50),
            q => q.Placement.Footprint.Intersects(lot.Rect));

        var held = world.GetHeldLandAtCost(a);
        var building = world.Construct(a, LandWorlds.Type("supermarket"), city, at);
        Assert.Equal(own.HeldLandBasis, world.GetLandCost(building.Id));
        Assert.Equal(held - own.HeldLandBasis, world.GetHeldLandAtCost(a));
        Assert.DoesNotContain(world.Ledger.Entries, e => e.Category == LedgerCategory.LandPurchase && e.Building == building.Id);
        LandWorlds.AssertBooksCloseWithHeldLand(world);
    }

    [Fact]
    public void Selling_held_land_books_the_proceeds_and_the_gain_or_loss()
    {
        var (world, a, _, city, lot) = Setup();
        var bought = world.BuyLand(a, city, lot.Id);
        var cash = world.Companies[a].Cash;

        var sold = world.SellLand(a, city, lot.Id);

        Assert.Equal(bought.Amount, sold.CostBasis);
        Assert.Equal(cash + sold.Amount, world.Companies[a].Cash);
        Assert.Equal(sold.Amount - sold.CostBasis, sold.GainOrLoss);
        Assert.Empty(world.GetLandHoldings(a));
        Assert.True(world.GetParcel(city, lot.Id).ForSale);
        if (sold.GainOrLoss != 0m) Assert.Single(world.AccrualJournal.Entries, e => e.Kind == AccrualKind.DisposalGainLoss);
        LandWorlds.AssertBooksCloseWithHeldLand(world);
        var ex = Assert.Throws<LandMarketException>(() => world.SellLand(a, city, lot.Id));
        Assert.Equal(LandMarketError.NotOwned, ex.Error);
    }

    [Fact]
    public void Developed_public_and_unaffordable_parcels_cannot_be_bought()
    {
        var (world, a) = LandWorlds.Realistic(cash: 1_000m);
        var city = LandWorlds.City("metropolis");
        var layout = world.GetCityLayout(city);
        var developed = layout.Parcels.First(p => p.Ambient is { IsStructure: true });
        var landmark = layout.Parcels.First(p => p.Landmark is not null);
        var listed = layout.Parcels.First(p => p.ForSale && p.LandValue > 1_000m);

        Assert.Equal(LandMarketError.NotForSale, Assert.Throws<LandMarketException>(() => world.BuyLand(a, city, developed.Id)).Error);
        Assert.Equal(LandMarketError.NotForSale, Assert.Throws<LandMarketException>(() => world.BuyLand(a, city, landmark.Id)).Error);
        var poor = Assert.Throws<LandMarketException>(() => world.BuyLand(a, city, listed.Id));
        Assert.Equal(LandMarketError.InsufficientFunds, poor.Error);
        Assert.Equal(listed.LandValue, poor.Required);
        Assert.Throws<System.Collections.Generic.KeyNotFoundException>(() => world.BuyLand(a, city, layout.Parcels.Count + 1));
        Assert.Throws<InvalidOperationException>(() => Worlds.Live().BuyLand(new CompanyId(1), city, listed.Id));
    }

    [Fact]
    public void Land_value_follows_development_at_the_month_close()
    {
        var (world, a) = LandWorlds.Realistic(cash: 5_000_000_000m);
        var city = LandWorlds.City("metropolis");
        var before = world.GetLandFields(city);
        Assert.Same(world.GetCityLayout(city).Fields, before);
        var rev = world.GetLayoutRevision(city);

        var b = LandWorlds.BuildAt(world, a, "department_store", "metropolis");
        Assert.Same(before, world.GetLandFields(city)); // fields move at the month close only
        var afterBuild = world.GetLayoutRevision(city);
        Assert.True(afterBuild > rev);

        world.AdvanceMonth();
        var after = world.GetLandFields(city);
        Assert.NotSame(before, after);
        Assert.True(world.GetLayoutRevision(city) > afterBuild);
        var at = b.Placement!.Value;
        // A big store attracts customers: traffic rises next to it.
        Assert.True(after.TrafficAt(at.Px, at.Pz) > before.TrafficAt(at.Px, at.Pz));

        // No further change, no further bump.
        var settled = world.GetLayoutRevision(city);
        world.AdvanceMonth();
        Assert.Equal(settled, world.GetLayoutRevision(city));
        Assert.Same(after, world.GetLandFields(city));
    }
}
