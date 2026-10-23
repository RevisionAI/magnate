using System;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// The world market under Realistic rules (econ-audit §4.4): import markup, export discount,
/// finite depth with a falling marginal price, one aggregate export price per product,
/// perishables, auto-export defaults and affordability-capped purchases (R5, E1, E8).
/// </summary>
[Trait("Area", "Market")]
public sealed class WorldTradeTests
{
    private static readonly ProductId Steel = new("steel");

    [Theory]
    [InlineData("soft_drink", 1.10, 1.12, 0.93)]
    [InlineData("car", 30_500, 1.04, 0.95)]
    [InlineData("television", 345, 1.08, 0.94)]
    [InlineData("steel", 760, 1.10, 0.92)]
    [InlineData("crude_oil", 75, 1.10, 0.92)]
    public void Imports_pay_a_markup_and_exports_take_a_discount(string product, double w, double import, double export)
    {
        var world = Realistic();
        var id = new ProductId(product);
        Assert.Equal((decimal)w * (decimal)import, world.GetImportPrice(id));
        Assert.Equal((decimal)w * (decimal)export, world.GetExportPrice(id, 0));
        Assert.Equal((decimal)w, Worlds.Live().GetImportPrice(id));   // Classic: frictionless at W
        Assert.Equal((decimal)w, Worlds.Live().GetExportPrice(id, 1e12));
    }

    [Fact]
    public void Export_price_falls_with_world_volume_and_total_revenue_is_concave()
    {
        // R5: revenue per unit strictly decreasing in world export volume; total revenue concave;
        // no NaN at V = 0. At V = depth the factor is 1/√2.
        var world = Realistic();
        var product = world.Catalog.Product(SoftDrink);
        var depth = product.Trade.WorldMarketDepth;
        Assert.Equal(3_000_000, depth);
        Assert.Equal(1.0, WorldTrade.DepthFactor(0, depth, 0.5));
        Assert.Equal(1 / Math.Sqrt(2), WorldTrade.DepthFactor(depth, depth, 0.5), 12);
        Assert.Equal(0.5, WorldTrade.DepthFactor(3 * depth, depth, 0.5), 12);

        decimal previousPrice = decimal.MaxValue;
        double previousRevenue = 0, previousSlope = double.PositiveInfinity;
        for (var v = 0.0; v <= 6 * depth; v += depth / 4)
        {
            var price = world.GetExportPrice(SoftDrink, v);
            Assert.True(price < previousPrice || v == 0);
            previousPrice = price;
            var revenue = (double)price * v;
            if (v > 0)
            {
                var slope = (revenue - previousRevenue) / (depth / 4);
                Assert.True(slope < previousSlope, "marginal export revenue falls");
                previousSlope = slope;
            }

            previousRevenue = revenue;
        }

        // Beyond ~2× depth the marginal unit earns less than the bottler's full unit cost.
        var marginal = WorldTrade.MarginalExportRevenue(world, product, 2 * depth);
        var ownCost = MarketAi.OwnUnitCost(world, product, Metropolis)!.Value;
        Assert.True(marginal < ownCost, $"marginal {marginal:0.000} vs unit cost {ownCost:0.000}");
    }

    [Fact]
    public void Every_exporter_of_a_product_gets_the_one_world_price()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 200_000_000m);
        var b = world.CreateCompany("B", 200_000_000m);
        var fa = world.Construct(a.Id, FactorySmall, Metropolis);
        var fb = world.Construct(b.Id, FactorySmall, Riverside);
        world.ConfigureProductionSlot(fa.Id, 0, Steel);
        world.ConfigureProductionSlot(fb.Id, 0, Steel);
        world.ConfigureProductionSlot(fb.Id, 1, Steel);
        world.SetAutoExport(fa.Id, true);
        world.SetAutoExport(fb.Id, true);
        world.AdvanceMonth();

        var exports = world.Ledger.EntriesInRange(a.Id, world.Clock.Now, world.Clock.Now)
            .Concat(world.Ledger.EntriesInRange(b.Id, world.Clock.Now, world.Clock.Now))
            .Where(e => e.Category == LedgerCategory.ExportSale)
            .ToList();
        Assert.Equal(2, exports.Count);
        var unitPrices = exports.Select(e => e.Amount / (decimal)e.Quantity!.Value).Distinct().ToList();
        Assert.Single(unitPrices);

        var quote = world.GetLastExport(Steel)!;
        var volume = exports.Sum(e => e.Quantity!.Value);
        Assert.Equal(volume, quote.Volume, 6);
        Assert.Equal(world.GetExportPrice(Steel, volume), quote.UnitPrice);
        Assert.Equal(quote.UnitPrice, unitPrices[0]);
        Assert.True(quote.UnitPrice < 760m * 0.92m);
    }

    [Fact]
    public void Perishables_are_never_exported()
    {
        var world = Realistic();
        var a = world.CreateCompany("A", 200_000_000m);
        var bakery = world.Construct(a.Id, FactorySmall, Metropolis);
        world.ConfigureProductionSlot(bakery.Id, 0, Bread);
        world.SetAutoExport(bakery.Id, true);
        world.AdvanceMonth();
        Assert.False(world.Catalog.Product(Bread).Trade.Exportable);
        Assert.Equal(0m, world.GetExportPrice(Bread, 0));
        Assert.Equal(0m, Sum(world, a.Id, LedgerCategory.ExportSale));
        Assert.True(bakery.Inventory.Get(Bread) > 0);
    }

    [Fact]
    public void New_buildings_start_with_auto_export_off_under_realistic_rules()
    {
        var realistic = Realistic();
        var plant = realistic.Construct(realistic.CreateCompany("A", 50_000_000m).Id, FactorySmall, Metropolis);
        realistic.ApplyMarketDefaults(plant);
        Assert.False(plant.AutoExport);

        var classic = Worlds.Live();
        var legacy = classic.Construct(classic.CreateCompany("A", 50_000_000m).Id, FactorySmall, Metropolis);
        classic.ApplyMarketDefaults(legacy);
        Assert.True(legacy.AutoExport);   // Classic keeps today's default
    }

    [Fact]
    public void Market_purchases_never_drive_cash_negative()
    {
        // E1: a $12M firm builds a $10M Hilltown supermarket, prices soft drinks at W (below the
        // landed cost) and asks for 10M bottles. World-market purchases are capped by what it can
        // pay: no purchase ever takes cash below zero. (Period costs — wages, utilities — can still
        // push a loss-maker negative; the finance workstream's revolver and solvency rules own that.)
        // The revolver is switched off here: with it, purchases may also use the undrawn credit
        // line (ICreditHeadroom, see Purchases_may_draw_on_the_revolver_within_its_limit).
        var world = Realistic();
        world = new World(world.Catalog, 42, Worlds.DefaultStart,
            world.Rules with { Finance = world.Rules.Finance with { Revolver = false } });
        var firm = world.CreateCompany("Small", 12_000_000m);
        Store(world, firm.Id, Supermarket, Hilltown, (SoftDrink, 1.10m, 10_000_000));
        world.AdvanceMonth();
        Assert.True(world.Companies[firm.Id].Cash >= 0m, "month 1 no longer ends $13M overdrawn");
        foreach (var _ in Months(23))
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }

        var cash = 0m;
        foreach (var e in world.Ledger.EntriesFor(firm.Id))
        {
            var before = cash;
            cash += e.Amount;
            if (e.Category is LedgerCategory.RetailRestock or LedgerCategory.InputPurchase)
            {
                Assert.True(before > 0m && cash >= 0m, $"{e.Date}: purchase of {-e.Amount:N2} with {before:N2} in cash");
            }
        }
    }

    [Fact]
    public void Purchases_may_draw_on_the_revolver_within_its_limit()
    {
        // Integration (E1 x E2): under the full Realistic rules the world installs the revolver as
        // the credit-headroom seam. The same over-ambitious store may now buy past its cash; the
        // Finance step draws the revolver to cover it, never beyond the limit, and the books close.
        var world = Realistic();
        Assert.NotNull(world.CreditHeadroom);
        var firm = world.CreateCompany("Small", 12_000_000m);
        Store(world, firm.Id, Supermarket, Hilltown, (SoftDrink, 1.10m, 10_000_000));
        foreach (var _ in Months(24))
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
            var f = world.GetCompanyFinance(firm.Id);
            if (f is null || f.InDistress) continue;
            Assert.True(world.Companies[firm.Id].Cash >= 0m, "the revolver replaces negative cash at month end");
        }
    }

    [Fact]
    public void Warehouse_targets_are_capped_by_stock_value_and_by_cash()
    {
        // E8: a warehouse target of a million cars no longer buys $18B on credit in one tick.
        var world = Realistic();
        var firm = world.CreateCompany("Tiny", 8_000_000m);
        var warehouse = world.Construct(firm.Id, WarehouseSmall, Metropolis);
        world.ConfigureWarehouseSlot(warehouse.Id, 0, Car, 1_000_000);
        world.AdvanceMonth();
        var cars = warehouse.Inventory.Get(Car);
        Assert.True(cars <= (double)(5_000_000m / 30_500m) + 1e-9, $"{cars} cars");
        Assert.True(world.Companies[firm.Id].Cash >= 0m);

        var rich = world.CreateCompany("Rich", 500_000_000m);
        var big = world.Construct(rich.Id, WarehouseSmall, Metropolis);
        world.ConfigureWarehouseSlot(big.Id, 0, Car, 1_000_000);
        world.AdvanceMonth();
        Assert.Equal(Math.Floor(5_000_000.0 / 30_500.0 + 1e-9), Math.Floor(big.Inventory.Get(Car) + 1e-9));
    }

    [Fact]
    public void Production_input_purchases_keep_one_month_of_fixed_costs_in_reserve()
    {
        var world = Realistic();
        var firm = world.CreateCompany("Lean", 30_000_000m);
        var plant = world.Construct(firm.Id, FactorySmall, Metropolis);
        world.ConfigureProductionSlot(plant.Id, 0, SoftDrink);
        world.AdvanceMonth();
        var reserve = world.GetMonthlyFixedCosts(firm.Id);
        Assert.True(world.Companies[firm.Id].Cash >= 0m);
        Assert.True(reserve > 0m);
        // The $8M line was paid; inputs and conversion were bought only out of cash above the reserve.
        Assert.Equal(-8_000_000m, Sum(world, firm.Id, LedgerCategory.EquipmentPurchase));
    }
}
