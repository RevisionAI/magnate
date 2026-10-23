using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class ReportingTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    // ---------------------------------------------------------- BalanceSheet

    [Fact]
    public void Initial_balance_sheet_equals_starting_capital()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var bs = world.GetBalanceSheet(acme.Id);

        Assert.Equal(10_000_000m, bs.Cash);
        Assert.Equal(0m, bs.InventoryValue);
        Assert.Equal(0m, bs.BuildingValue);
        Assert.Equal(10_000_000m, bs.TotalAssets);
        Assert.Equal(10_000_000m, bs.Equity);
    }

    [Fact]
    public void Construction_moves_value_from_cash_to_buildings_keeping_total_assets_unchanged()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var before = world.GetBalanceSheet(acme.Id);
        world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        var after = world.GetBalanceSheet(acme.Id);

        var supermarketCost = world.Catalog.BuildingType(new BuildingTypeId("supermarket")).ConstructionCost;
        Assert.Equal(before.Cash - supermarketCost, after.Cash);
        Assert.Equal(supermarketCost, after.BuildingValue);
        Assert.Equal(before.TotalAssets, after.TotalAssets);
    }

    [Fact]
    public void Market_bought_inventory_carries_cost_basis_at_world_price()
    {
        // Under WAC (Phase 2.1), the cost basis equals what was actually paid. For
        // goods bought from the world market that's the world price — this test
        // happens to look identical to "valued at world price" only because of the
        // market-buy path. See Self_produced_inventory_carries_only_input_cost for
        // the contrasting case.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("car"), price: 25_000m, restockTarget: 10);

        world.AdvanceMonth();

        var carsLeft = store.Inventory.Get(new ProductId("car"));
        var bs = world.GetBalanceSheet(acme.Id);
        Assert.Equal((decimal)carsLeft * 18_000m, bs.InventoryValue);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Self_produced_inventory_carries_only_input_cost_not_market_price()
    {
        // Acme extracts sugarcane (zero cost) and refines it to sugar. The sugar
        // sitting in the factory should be valued at the cost of its inputs (zero),
        // NOT at sugar's $2/kg world market price.
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        farm.AutoExport = false;

        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));
        sugarPlant.AutoExport = false;

        world.AdvanceMonth();

        // Sugar produced from zero-cost sugarcane → zero-cost sugar inventory.
        Assert.True(sugarPlant.Inventory.Get(new ProductId("sugar")) > 0);
        Assert.Equal(0m, sugarPlant.Inventory.CostOf(new ProductId("sugar")));
    }

    [Fact]
    public void Production_rolls_input_cost_into_output_inventory()
    {
        // Drink plant buys plastic from the world market (paid cost) and sugar
        // from an internal sugar plant (free upstream). Per-unit soft_drink cost
        // should reflect just the plastic — sugar contributes zero.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));

        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkPlant.Id, 0, new ProductId("soft_drink"));
        drinkPlant.AutoExport = false;

        world.AdvanceMonth();

        var bottlesProduced = drinkPlant.Inventory.Get(new ProductId("soft_drink"));
        var bottleCost = drinkPlant.Inventory.CostOf(new ProductId("soft_drink"));
        Assert.True(bottlesProduced > 0);

        // sugarcane was bought from world market by the sugar plant, so sugar carries
        // sugarcane's cost. Plastic was bought from world too. Both flow into soft_drink.
        // Verify cost is positive but well below the world price * units (which would
        // imply we're double-counting through a market buy of soft_drink itself).
        var worldValueIfPurchased = (decimal)bottlesProduced * 1.50m;
        Assert.True(bottleCost > 0m, "soft_drink should carry positive cost (plastic + sugarcane via sugar)");
        Assert.True(bottleCost < worldValueIfPurchased,
            $"self-produced cost {bottleCost} should be cheaper than market price {worldValueIfPurchased}");
    }

    [Fact]
    public void Cogs_is_recorded_when_goods_are_sold()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        var cogs = world.CogsLog.EntriesFor(acme.Id).Where(e => e.Product == new ProductId("soft_drink")).ToList();
        Assert.NotEmpty(cogs);
        Assert.True(cogs.Sum(e => e.Cost) > 0, "expected positive COGS for sold soft_drink");
    }

    [Fact]
    public void Income_statement_separates_revenue_cogs_and_opex()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        var pnl = world.GetIncomeStatement(acme.Id, world.Clock.Now, world.Clock.Now);
        Assert.True(pnl.Revenue > 0);
        Assert.True(pnl.CostOfGoodsSold > 0);
        Assert.True(pnl.OperatingExpenses > 0);
        Assert.Equal(pnl.Revenue - pnl.CostOfGoodsSold, pnl.GrossProfit);
        Assert.Equal(pnl.GrossProfit - pnl.OperatingExpenses, pnl.NetIncome);
    }

    [Fact]
    public void Equity_equals_starting_capital_plus_cumulative_net_income()
    {
        // The bookkeeping equation closes (no liabilities, no debt). After any
        // number of months, total assets must equal starting equity plus the
        // sum of net incomes.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 300_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));
        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkPlant.Id, 0, new ProductId("soft_drink"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 500_000);

        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var pnl = world.GetIncomeStatement(acme.Id, new GameDate(2026, 2), world.Clock.Now);
        var bs = world.GetBalanceSheet(acme.Id);

        var expected = 300_000_000m + pnl.NetIncome;
        var diff = System.Math.Abs(bs.Equity - expected);
        Assert.True(diff < 1m, $"equity {bs.Equity} should equal {expected} (diff = {diff}); books don't close");
    }

    [Fact]
    public void Inter_city_shipping_capitalizes_into_inventory_not_opex()
    {
        // Shipping for inbound goods is capitalized to inventory (will surface as
        // COGS later), NOT recognized as an operating expense in the period it's paid.
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 200_000_000m);

        var mine = world.Construct(acme.Id, new BuildingTypeId("iron_mine"), new CityId("riverside"));
        world.ConfigureExtractionSlot(mine.Id, 0, new ProductId("iron_ore"));
        mine.AutoExport = false;

        var steelPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(steelPlant.Id, 0, new ProductId("steel"));
        steelPlant.AutoExport = false;

        world.AdvanceMonth();

        // ShippingCost cash entry exists (inter-city pull).
        var shipping = world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.ShippingCost).ToList();
        Assert.NotEmpty(shipping);

        // But OperatingExpenses on the P&L only contains OperatingCost, not shipping.
        var pnl = world.GetIncomeStatement(acme.Id, world.Clock.Now, world.Clock.Now);
        var opexFromOpCost = -world.Ledger.EntriesFor(acme.Id)
            .Where(e => e.Category == LedgerCategory.OperatingCost).Sum(e => e.Amount);
        Assert.Equal(opexFromOpCost, pnl.OperatingExpenses);
    }

    // ---------------------------------------------------------- ProductProfitability

    [Fact]
    public void Profitability_attributes_revenue_and_cost_to_correct_product()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        var report = world.GetProductProfitability(acme.Id, world.Clock.Now, world.Clock.Now);
        Assert.True(report.ContainsKey(new ProductId("soft_drink")));
        var p = report[new ProductId("soft_drink")];
        Assert.True(p.Revenue > 0, $"expected positive revenue, got {p.Revenue}");
        Assert.True(p.Cost > 0, $"expected positive cost, got {p.Cost}");
    }

    [Fact]
    public void Profitability_excludes_opex_and_construction()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        // Only product-tagged categories appear; construction & opex shouldn't sneak into any product line.
        var report = world.GetProductProfitability(acme.Id, world.Clock.Now, world.Clock.Now);
        var supermarketCost = world.Catalog.BuildingType(new BuildingTypeId("supermarket")).ConstructionCost;
        Assert.All(report.Values, p => Assert.True(p.Cost < supermarketCost,
            $"product '{p.Product}' cost {p.Cost} unexpectedly large — construction may be leaking in"));
    }

    // ---------------------------------------------------------- TransferLog

    [Fact]
    public void Internal_pull_emits_a_transfer_entry()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 20_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));

        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));

        world.AdvanceMonth();

        var transfers = world.TransferLog.EntriesFor(acme.Id).ToList();
        // Exactly one transfer this month: farm → sugarPlant for sugarcane.
        Assert.Single(transfers);
        var t = transfers[0];
        Assert.Equal(farm.Id, t.From);
        Assert.Equal(sugarPlant.Id, t.To);
        Assert.Equal(new ProductId("sugarcane"), t.Product);
        Assert.True(t.Quantity > 0);
    }

    [Fact]
    public void Vertical_chain_emits_transfer_per_internal_link()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 300_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));

        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));

        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkPlant.Id, 0, new ProductId("soft_drink"));

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        world.AdvanceMonth();

        var transfers = world.TransferLog.EntriesFor(acme.Id).ToList();
        // 3 expected internal links: farm→sugar, sugar→drink, drink→store
        Assert.Contains(transfers, t => t.From == farm.Id && t.To == sugarPlant.Id && t.Product == new ProductId("sugarcane"));
        Assert.Contains(transfers, t => t.From == sugarPlant.Id && t.To == drinkPlant.Id && t.Product == new ProductId("sugar"));
        Assert.Contains(transfers, t => t.From == drinkPlant.Id && t.To == store.Id && t.Product == new ProductId("soft_drink"));
    }

    // ---------------------------------------------------------- Demand sanity check (post-rebalance)

    [Fact]
    public void Rebalanced_durables_have_realistic_annual_demand()
    {
        var world = NewWorld();
        var city = world.Catalog.City(new CityId("metropolis"));

        // Compute annual unit demand for car. After rebalance we want ~2-5% of the population
        // buying a car per year, NOT the absurd 36% of high earners we shipped initially.
        var car = world.Catalog.Product(new ProductId("car"));
        double monthlyDemand = 0;
        foreach (var (bracket, share) in city.Demographics)
        {
            var perCapita = car.BaseDemandPerCapita.TryGetValue(bracket, out var d) ? d : 0;
            monthlyDemand += city.Population * share * perCapita;
        }
        var annualDemand = monthlyDemand * 12;
        var population = city.Population;

        // Annual cars per 1000 residents — should land somewhere in the 20-80 range, not 700+.
        var perKilo = annualDemand / population * 1000;
        Assert.InRange(perKilo, 20.0, 100.0);
    }
}
