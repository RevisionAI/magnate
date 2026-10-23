using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Payroll and overhead (econ-audit §4.5–4.6) and advertising v2 (§4.20, F10) under Realistic
/// rules; Classic keeps one flat opex line and the flat-cost, campaign-freezes-decay brand model.
/// </summary>
[Trait("Area", "Market")]
public sealed class PayrollAndAdvertisingTests
{
    private static readonly CityId Portbay = new("portbay");

    // ------------------------------------------------------------------ payroll (§4.5–4.6)

    [Fact]
    public void A_supermarket_pays_wages_utilities_maintenance_insurance_and_property_tax()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 50_000_000m);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.75m, 1), (Bread, 3.2m, 1));

        var costs = world.GetMonthlyBuildingCosts(store.Id);
        Assert.Equal(16 + 2 * 5, costs.Headcount);                   // fixed 16 + 5 per active slot
        Assert.Equal(26 * 4_855m, costs.Wages);                        // retail wage, Metropolis index 1.00
        Assert.Equal(40_000m, costs.Utilities);
        Assert.Equal(10_000_000m * 0.015m / 12m, costs.Maintenance);   // structure only: no equipment
        Assert.Equal(10_000_000m * 0.003m / 12m, costs.Insurance);
        Assert.Equal(10_000_000m * 0.012m / 12m, costs.PropertyTax);

        world.AdvanceMonth();
        var month = world.Clock.Now;
        Assert.Equal(-costs.Wages, Sum(world, a.Id, LedgerCategory.Wages, month));
        Assert.Equal(-costs.Utilities, Sum(world, a.Id, LedgerCategory.Utilities, month));
        Assert.Equal(-costs.Maintenance, Sum(world, a.Id, LedgerCategory.Maintenance, month));
        Assert.Equal(-costs.Insurance, Sum(world, a.Id, LedgerCategory.Insurance, month));
        Assert.Equal(-costs.PropertyTax, Sum(world, a.Id, LedgerCategory.PropertyTax, month));
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.OperatingCost));
        Assert.All(world.Ledger.EntriesFor(a.Id).Where(e => e.Category == LedgerCategory.Wages), e => Assert.Equal(store.Id, e.Building));
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Wages_follow_the_city_wage_index_and_the_level()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 80_000_000m);
        var port = Store(world, a.Id, Supermarket, Portbay, (SoftDrink, 1.75m, 1));
        Assert.Equal(21 * 4_855m * 0.92m, world.GetMonthlyBuildingCosts(port.Id).Wages);

        world.UpgradeBuilding(port.Id);
        var l2 = world.GetMonthlyBuildingCosts(port.Id);
        Assert.Equal(16 * 1.25 + 5, l2.Headcount);
        Assert.Equal(52_000m, l2.Utilities);                           // L2 opex from the level ladder
    }

    [Fact]
    public void Configured_slots_pay_staff_even_when_idle_and_empty_slots_cost_nothing()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var plant = world.Construct(a.Id, FactorySmall, Metropolis);
        var empty = world.GetMonthlyBuildingCosts(plant.Id);
        Assert.Equal(12, empty.Headcount);
        Assert.Equal(12 * 10_138m, empty.Wages);                       // admin only

        world.ConfigureProductionSlot(plant.Id, 0, SoftDrink);
        world.ConfigureProductionSlot(plant.Id, 1, new ProductId("television"));
        var staffed = world.GetMonthlyBuildingCosts(plant.Id);
        Assert.Equal(12 + 22 + 40, staffed.Headcount);
        Assert.Equal(12 * 10_138m + 62 * 6_842m, staffed.Wages);

        var lab = world.Construct(a.Id, new BuildingTypeId("rd_center"), Metropolis);
        world.ConfigureResearchSlot(lab.Id, 0, SoftDrink);
        Assert.Equal(10 * 10_138m + 15 * 13_517m, world.GetMonthlyBuildingCosts(lab.Id).Wages);
    }

    [Fact]
    public void Farms_pay_the_agricultural_property_tax_rate()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 20_000_000m);
        var farm = world.Construct(a.Id, new BuildingTypeId("small_farm"), Metropolis);
        Assert.Equal(1_500_000m * 0.006m / 12m, world.GetMonthlyBuildingCosts(farm.Id).PropertyTax);
    }

    [Fact]
    public void Buildings_under_construction_pay_only_insurance_and_property_tax()
    {
        var world = Realistic();
        var sites = new Sites();
        world.SiteInfo = sites;
        var a = world.CreateCompany("A", 50_000_000m);
        var store = Store(world, a.Id, Supermarket, Metropolis, (SoftDrink, 1.75m, 1));
        sites.UnderConstruction.Add(store.Id);
        sites.Land[store.Id] = 3_000_000m;

        var costs = world.GetMonthlyBuildingCosts(store.Id);
        Assert.False(costs.Operational);
        Assert.Equal(0m, costs.Wages + costs.Utilities + costs.Maintenance);
        Assert.Equal((3_000_000m + 10_000_000m) * 0.012m / 12m, costs.PropertyTax);
        Assert.Equal(costs.Insurance + costs.PropertyTax, costs.Total);
    }

    [Fact]
    public void Classic_rules_keep_one_flat_opex_line()
    {
        var world = Worlds.Live();
        var a = world.CreateCompany("A", 50_000_000m);
        world.Construct(a.Id, Supermarket, Metropolis);
        world.AdvanceMonth();
        Assert.Equal(-40_000m, Sum(world, a.Id, LedgerCategory.OperatingCost));
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.Wages));
        Assert.Equal(40_000m, world.GetMonthlyFixedCosts(a.Id));
    }

    // ------------------------------------------------------------------ advertising v2 (§4.20)

    [Fact]
    public void Cost_per_awareness_point_scales_with_population()
    {
        var world = Realistic();
        Assert.Equal(12_500m, world.GetAdCostPerPoint(Metropolis, AdChannel.TV));
        Assert.Equal(2_500m, world.GetAdCostPerPoint(Hilltown, AdChannel.TV));
        Assert.Equal(9_000m, world.GetAdCostPerPoint(Metropolis, AdChannel.Radio));
        Assert.Equal(10_000m, world.GetAdCostPerPoint(Metropolis, AdChannel.Newspaper));
        Assert.Equal(14_000m, world.GetAdCostPerPoint(Metropolis, AdChannel.Magazine));
    }

    [Theory]
    [InlineData(50, 37_500)]
    [InlineData(70, 87_500)]
    [InlineData(85, 212_500)]
    public void Sustain_budgets_match_the_spec(double awareness, double budget)
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 1_000_000m);
        Assert.Equal((decimal)budget, Math.Round(world.GetSustainBudget(a.Id, Metropolis, AdChannel.TV, awareness), 2));
        Assert.Equal((decimal)budget / 5m, Math.Round(world.GetSustainBudget(a.Id, Hilltown, AdChannel.TV, awareness), 2));
    }

    [Fact]
    public void A_one_dollar_campaign_cannot_freeze_brand_decay()
    {
        // F10 / R16: awareness 100 with a $1/month campaign decays like the control.
        var world = Realistic();
        var a = world.CreateCompany("A", 1_000_000m);
        var b = world.CreateCompany("B", 1_000_000m);
        world.SetBrandAwareness(a.Id, SoftDrink, Metropolis, 100);
        world.SetBrandAwareness(b.Id, SoftDrink, Metropolis, 100);
        world.RegisterAdCampaign(a.Id, SoftDrink, Metropolis, AdChannel.TV, 1m);
        foreach (var _ in Months(24)) world.AdvanceMonth();

        var withDollar = world.GetBrandAwareness(a.Id, SoftDrink, Metropolis);
        var control = world.GetBrandAwareness(b.Id, SoftDrink, Metropolis);
        Assert.Equal(100 * Math.Pow(0.97, 24), control, 9);
        Assert.InRange(withDollar - control, 0, 0.01);
    }

    [Fact]
    public void Two_hundred_thousand_a_month_per_half_million_people_builds_the_same_brand_everywhere()
    {
        // §4.20: awareness reaches ≈ 60 / 77 / 84 at months 6 / 12 / 24 in every city.
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var cities = world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal).ToList();
        foreach (var city in cities)
        {
            world.RegisterAdCampaign(a.Id, Bread, city.Id, AdChannel.TV, 200_000m * city.Population / 500_000m);
        }

        foreach (var month in Enumerable.Range(1, 24))
        {
            world.AdvanceMonth();
            foreach (var city in cities)
            {
                var b = world.GetBrandAwareness(a.Id, Bread, city.Id);
                Assert.Equal(world.GetBrandAwareness(a.Id, Bread, Metropolis), b, 9);
                if (month == 6) Assert.InRange(b, 58, 62);
                if (month == 12) Assert.InRange(b, 75, 79);
                if (month == 24) Assert.InRange(b, 82.5, 85);
            }
        }
    }

    [Fact]
    public void Owning_the_station_stretches_the_budget()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var b = world.CreateCompany("B", 100_000_000m);
        world.Construct(a.Id, new BuildingTypeId("radio_station"), Hilltown);
        world.RegisterAdCampaign(a.Id, Bread, Hilltown, AdChannel.Radio, 18_000m);
        world.RegisterAdCampaign(b.Id, Bread, Hilltown, AdChannel.Radio, 18_000m);
        world.AdvanceMonth();
        // 18,000 / (18 × 100) = 10 points; the station owner gets ×1.35.
        Assert.Equal(10.0, world.GetBrandAwareness(b.Id, Bread, Hilltown), 9);
        Assert.Equal(13.5, world.GetBrandAwareness(a.Id, Bread, Hilltown), 9);
    }
}
