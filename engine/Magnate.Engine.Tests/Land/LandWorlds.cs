using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>World factories and checks for the land-integration (E3b) tests.</summary>
internal static class LandWorlds
{
    /// <summary>A Realistic world on live content with one company.</summary>
    public static (World World, CompanyId Company) Realistic(decimal cash = 500_000_000m, int seed = 42, EconomyRules? rules = null)
    {
        var world = new World(TestContent.Live, seed, Worlds.DefaultStart, rules ?? EconomyRules.Realistic);
        var company = world.CreateCompany("Builder", cash).Id;
        return (world, company);
    }

    /// <summary>Realistic rules without the revolver: construction is funded from cash alone.</summary>
    public static EconomyRules NoCredit => EconomyRules.Realistic with { Finance = EconomyRules.Realistic.Finance with { Revolver = false } };

    /// <summary>Realistic rules with instant construction (the tests' opt-out knob).</summary>
    public static EconomyRules Instant => EconomyRules.Realistic with { Land = EconomyRules.Realistic.Land with { ConstructionMonths = 0 } };

    public static BuildingTypeId Type(string id) => new(id);

    public static CityId City(string id) => new(id);

    /// <summary>The best valid site by the type's default preference (fails the test when there is none).</summary>
    public static ConstructionQuote Site(World world, CompanyId company, string type, string city, SitePreference preference = SitePreference.Auto)
    {
        var sites = world.FindConstructionSites(company, Type(type), City(city), preference, 1);
        Assert.True(sites.Count > 0, $"no site for {type} in {city}");
        return sites[0];
    }

    /// <summary>Build at the best site and return the building.</summary>
    public static BuildingInstance BuildAt(World world, CompanyId company, string type, string city, SitePreference preference = SitePreference.Auto)
        => world.Construct(company, Type(type), City(city), Site(world, company, type, city, preference).At);

    /// <summary>Advance <paramref name="months"/> months, asserting every invariant after each.</summary>
    public static void Run(World world, int months)
    {
        for (var i = 0; i < months; i++)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
            AssertSitesConsistent(world);
        }
    }

    /// <summary>
    /// Occupancy and placements agree: every sited, non-retired building covers exactly its
    /// footprint, no two buildings overlap, and every plot of the footprint is a parcel plot.
    /// </summary>
    public static void AssertSitesConsistent(World world)
    {
        var seen = new Dictionary<(string City, int X, int Z), int>();
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Placement is not PlotRef at || b.IsRetired) continue;
            var type = world.Catalog.BuildingType(b.TypeId);
            var rect = at.Rect(type.Footprint);
            var layout = world.GetCityLayout(b.City);
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++)
                {
                    Assert.True(layout.InBounds(x, z), $"building {b.Id} leaves the grid at ({x},{z})");
                    Assert.Equal(PlotKind.Parcel, layout.KindAt(x, z));
                    Assert.True(seen.TryAdd((b.City.Value, x, z), b.Id.Value), $"buildings {seen.GetValueOrDefault((b.City.Value, x, z))} and {b.Id} overlap at ({x},{z}) in {b.City}");
                    Assert.Equal(b.Id, world.BuildingAtPlot(b.City, x, z));
                }
            }
        }
    }

    /// <summary>
    /// Books close with the land a company holds <em>without a building</em>: since the E2 x E3b
    /// integration the engine balance sheet's Land line includes it, so no adjustment is needed.
    /// </summary>
    public static void AssertBooksCloseWithHeldLand(World world)
    {
        var from = new GameDate(1, 1);
        foreach (var c in world.Companies.Values)
        {
            var bs = world.GetBalanceSheet(c.Id);
            var contributed = world.Ledger.Entries.Where(e => e.Company == c.Id && e.Category == Economics.LedgerCategory.StartingCapital).Sum(e => e.Amount);
            var netIncome = world.GetIncomeStatement(c.Id, from, world.Clock.Now).NetIncome;
            var equity = bs.Equity;
            Assert.True(bs.Land >= world.GetHeldLandAtCost(c.Id), "held land is on the balance sheet");
            Assert.True(Math.Abs(equity - (contributed + netIncome)) <= Invariants.BooksTolerance,
                $"books do not close for {c.Id} with held land: equity {equity} vs {contributed} + {netIncome}");
            Assert.Equal(c.Cash, world.Ledger.Entries.Where(e => e.Company == c.Id).Sum(e => e.Amount));
        }
    }
}
