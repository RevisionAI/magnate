using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;
using Magnate.Engine.Tests.Land;
using Xunit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Wave 2 integration of the market (E1), finance (E2) and land (E3b) areas under the full
/// Realistic rules: the site seam, construction-site running costs, market defaults on new
/// buildings, held land on the balance sheet and the single retirement model.
/// </summary>
public sealed class MarketLandIntegrationTests
{
    [Fact]
    public void Land_rules_install_the_plot_backed_site_info_and_credit_headroom()
    {
        var (world, company) = LandWorlds.Realistic();
        Assert.IsType<LandSiteInfo>(world.SiteInfo);
        Assert.IsType<RevolverCreditHeadroom>(world.CreditHeadroom);

        var quote = LandWorlds.Site(world, company, "supermarket", "metropolis");
        var b = world.Construct(company, LandWorlds.Type("supermarket"), LandWorlds.City("metropolis"), quote.At);
        Assert.False(world.SiteInfo.IsOperational(b));
        Assert.Equal(world.GetLandCost(b.Id), world.SiteInfo.LandCost(b));
        Assert.Equal(quote.Placement.Site!.LocationFactor, world.SiteInfo.LocationFactor(b), 2);
        Assert.False(b.AutoExport); // D7: ApplyMarketDefaults in Construct
    }

    [Fact]
    public void A_construction_site_pays_only_insurance_and_property_tax_and_never_trades()
    {
        var (world, company) = LandWorlds.Realistic();
        var b = LandWorlds.BuildAt(world, company, "supermarket", "metropolis");
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), 2m, 1000);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.True(b.IsUnderConstruction);

        var month = world.Ledger.Entries.Where(e => e.Building == b.Id && e.Date == world.Clock.Now).ToList();
        Assert.Contains(month, e => e.Category == LedgerCategory.PropertyTax && e.Amount < 0m);
        Assert.DoesNotContain(month, e => e.Category is LedgerCategory.Wages or LedgerCategory.Utilities or LedgerCategory.RetailRestock or LedgerCategory.ProductSale);
    }

    [Fact]
    public void Held_land_is_on_the_balance_sheet_and_the_books_close()
    {
        var (world, company) = LandWorlds.Realistic(cash: 1_000_000_000m);
        var city = LandWorlds.City("metropolis");
        var lot = world.GetParcels(city).First(p => p.ForSale).Parcel;
        var before = world.GetBalanceSheet(company).Land;
        var deal = world.BuyLand(company, city, lot.Id);

        Assert.Equal(before + deal.Amount, world.GetBalanceSheet(company).Land);
        world.AdvanceMonth();
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Buildings_under_construction_cannot_be_sold_and_a_sale_frees_the_site()
    {
        var (world, company) = LandWorlds.Realistic();
        var b = LandWorlds.BuildAt(world, company, "convenience_store", "metropolis");
        var ex = Assert.Throws<FinanceException>(() => world.SellBuilding(b.Id));
        Assert.Equal(FinanceErrorCode.InvalidDisposal, ex.Code);

        LandWorlds.Run(world, world.GetConstructionMonths(b.TypeId) + 1);
        Assert.True(b.IsOperational);
        var site = b.Placement!.Value;
        var rev = world.GetLayoutRevision(b.City);

        world.SellBuilding(b.Id);

        Assert.False(world.Buildings.ContainsKey(b.Id));
        Assert.True(world.RetiredBuildings.ContainsKey(b.Id));
        Assert.Null(world.BuildingAtPlot(b.City, site.Px, site.Pz));
        Assert.True(world.GetLayoutRevision(b.City) > rev);
        Assert.Equal(0m, world.GetLandCost(b.Id));
        world.AdvanceMonth();
        Invariants.AssertAll(world);
    }
}
