using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Production and extraction under Realistic rules (econ-audit §4.5–4.7): per-unit recipes with a
/// slot throughput, line/rig equipment paid once and capitalised, other materials and energy
/// capitalised into the output's cost, the finished-goods buffer, and cash-capped conversion.
/// </summary>
[Trait("Area", "Market")]
public sealed class ProductionTests
{
    private static readonly ProductId Sugar = new("sugar");
    private static readonly ProductId Plastic = new("plastic");
    private static readonly ProductId Crude = new("crude_oil");
    private static readonly ProductId Wheat = new("wheat");
    private static readonly CityId Portbay = new("portbay");   // the oil-rich city

    [Fact]
    public void A_soft_drink_line_runs_its_throughput_at_the_per_unit_recipe_cost()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var plant = Build(world, a.Id, FactorySmall, Metropolis);
        world.ConfigureProductionSlot(plant.Id, 0, SoftDrink);
        world.AdvanceMonth();

        // Table 4.7-A: 1.5M bottles per slot-month; sugar 0.050 kg + plastic 0.022 kg imported at
        // W × 1.10; other $0.71; 0.03 kWh × $0.092.
        Assert.Equal(1_500_000, plant.Inventory.Get(SoftDrink), 6);
        var expectedUnitCost = 0.050m * 0.60m * 1.10m + 0.022m * 1.45m * 1.10m + 0.71m + 0.03m * 0.092m;
        var unitCost = plant.Inventory.CostOf(SoftDrink) / (decimal)plant.Inventory.Get(SoftDrink);
        Assert.Equal((double)expectedUnitCost, (double)unitCost, 9);
        Assert.Equal(-0.71m * 1_500_000m, Sum(world, a.Id, LedgerCategory.OtherMaterials));
        Assert.Equal(-0.03m * 0.092m * 1_500_000m, Sum(world, a.Id, LedgerCategory.ProductionEnergy));
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Line_equipment_is_paid_once_capitalised_and_bought_again_on_retooling()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var plant = world.Construct(a.Id, FactorySmall, Metropolis);
        world.SetAutoExport(plant.Id, true);
        world.ConfigureProductionSlot(plant.Id, 0, Sugar);
        world.AdvanceMonth();
        world.AdvanceMonth();

        Assert.Equal(-5_000_000m, Sum(world, a.Id, LedgerCategory.EquipmentPurchase));
        Assert.Equal(20_000_000m, plant.CapitalizedCost);
        var installed = world.GetInstalledEquipment(plant.Id);
        Assert.Equal(Sugar, installed[0].Product);
        Assert.Equal(5_000_000m, installed[0].Cost);
        // Maintenance: 1.5 %/yr on the $15M structure + 4 %/yr on the $5M line.
        Assert.Equal(15_000_000m * 0.015m / 12m + 5_000_000m * 0.04m / 12m, world.GetMonthlyBuildingCosts(plant.Id).Maintenance);

        world.ConfigureProductionSlot(plant.Id, 0, Plastic);
        world.AdvanceMonth();
        Assert.Equal(-15_000_000m, Sum(world, a.Id, LedgerCategory.EquipmentPurchase));
        Assert.Equal(Plastic, world.GetInstalledEquipment(plant.Id)[0].Product);
        Assert.Equal(30_000_000m, plant.CapitalizedCost);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void A_slot_tops_its_output_up_to_one_month_of_stock_and_no_further()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var plant = Build(world, a.Id, FactorySmall, Metropolis);
        world.ConfigureProductionSlot(plant.Id, 0, Sugar);   // auto-export off, no buyer
        foreach (var _ in Months(3)) world.AdvanceMonth();
        Assert.Equal(2_000_000, plant.Inventory.Get(Sugar), 6);
        var otherMaterials = world.Ledger.EntriesFor(a.Id).Count(e => e.Category == LedgerCategory.OtherMaterials);
        Assert.Equal(1, otherMaterials);   // months 2 and 3 produced nothing: the buffer was full
    }

    [Fact]
    public void An_oil_well_pays_its_rig_and_lifting_cost_into_the_crude_it_extracts()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 100_000_000m);
        var well = Build(world, a.Id, new BuildingTypeId("oil_well"), Portbay);
        world.ConfigureExtractionSlot(well.Id, 0, Crude);
        world.AdvanceMonth();

        Assert.Equal(12_000, well.Inventory.Get(Crude), 6);
        Assert.Equal(30m * 12_000m, well.Inventory.CostOf(Crude));   // $30/bbl lifting and royalty
        Assert.Equal(-12_000_000m, Sum(world, a.Id, LedgerCategory.EquipmentPurchase));
        Assert.Equal(18_000_000m, well.CapitalizedCost);
        Assert.Equal((4 + 6) * 8_110m * 0.92m, world.GetMonthlyBuildingCosts(well.Id).Wages);   // Portbay wage index 0.92
    }

    [Fact]
    public void A_company_that_cannot_pay_for_the_line_idles_the_slot()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 18_000_000m);
        var plant = world.Construct(a.Id, FactorySmall, Metropolis);   // $15M: $3M left, the line is $8M
        world.ConfigureProductionSlot(plant.Id, 0, SoftDrink);
        world.AdvanceMonth();
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.EquipmentPurchase));
        Assert.Equal(0, plant.Inventory.Get(SoftDrink));
        Assert.Equal(15_000_000m, plant.CapitalizedCost);
    }

    [Fact]
    public void Conversion_costs_are_capped_by_cash_above_the_reserve()
    {
        var world = Realistic();
        world.CreditHeadroom = NoCredit.Instance; // the cash cap alone (the revolver headroom is tested in WorldTradeTests)
        var a = world.CreateCompany("A", 19_400_000m);
        var plant = world.Construct(a.Id, FactorySmall, Metropolis);
        Assert.False(plant.AutoExport); // D7: the flour stays on site, so the inventory measures the cap
        world.ConfigureProductionSlot(plant.Id, 0, new ProductId("flour"));
        world.AdvanceMonth();
        // $19.4M − $15M − $3.5M line − payroll − one month's reserve leaves about half a month of
        // flour inputs: output is cut below the 2M-unit line throughput, cash stays positive.
        var flour = plant.Inventory.Get(new ProductId("flour"));
        Assert.True(flour > 0 && flour < 2_000_000, $"flour {flour}");
        Assert.True(world.Companies[a.Id].Cash >= 0m);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Own_upstream_supply_is_pulled_before_imports()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 200_000_000m);
        var well = Build(world, a.Id, new BuildingTypeId("oil_well"), Portbay);
        world.ConfigureExtractionSlot(well.Id, 0, Crude);
        world.AdvanceMonth();   // the well fills its buffer first

        var plant = Build(world, a.Id, FactorySmall, Portbay);
        world.ConfigureProductionSlot(plant.Id, 0, Plastic);
        world.AdvanceMonth();

        // 1.5M kg × 0.011 bbl = 16,500 bbl a month. The well's whole buffer (12,000 bbl, one
        // month of output) is pulled first; only the 4,500 bbl shortfall is imported.
        var imported = world.Ledger.EntriesFor(a.Id).Where(e => e.Category == LedgerCategory.InputPurchase && e.Product == Crude).Sum(e => e.Quantity ?? 0);
        Assert.Equal(4_500, imported, 6);
        Assert.Equal(12_000, world.TransferLog.Entries.Where(t => t.Product == Crude && t.To == plant.Id).Sum(t => t.Quantity), 6);
    }
}
