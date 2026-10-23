using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>Ledger category metadata and the statements built on it (econ-audit §4.15).</summary>
public sealed class LedgerCategoryInfoTests
{
    [Fact]
    public void Every_category_has_metadata()
    {
        var categories = Enum.GetValues<LedgerCategory>();
        Assert.Equal(categories.Length, LedgerCategoryInfo.All.Count);
        foreach (var c in categories)
        {
            Assert.Equal(c, LedgerCategoryInfo.Of(c).Category);
        }
    }

    [Fact]
    public void Pre_overhaul_categories_keep_their_names_and_order()
    {
        // Saves serialise by name, so names must never change; appending keeps old values too.
        var expected = new[]
        {
            "StartingCapital", "ConstructionCost", "OperatingCost", "InputPurchase", "RetailRestock",
            "ProductSale", "ExportSale", "ShippingCost", "AdvertisingCost", "PatentRoyaltyIncome",
            "PatentRoyaltyExpense", "UpgradeCost",
        };
        Assert.Equal(expected, Enum.GetNames<LedgerCategory>().Take(expected.Length).ToArray());
    }

    [Fact]
    public void Classic_income_statement_mapping_is_unchanged()
    {
        Assert.Equal(
            new[] { LedgerCategory.ProductSale, LedgerCategory.ExportSale, LedgerCategory.PatentRoyaltyIncome },
            LedgerCategoryInfo.InSection(StatementSection.Revenue));
        var opex = LedgerCategoryInfo.InSection(StatementSection.OperatingExpense);
        Assert.Contains(LedgerCategory.OperatingCost, opex);
        Assert.Contains(LedgerCategory.AdvertisingCost, opex);
        Assert.Contains(LedgerCategory.PatentRoyaltyExpense, opex);
        foreach (var capitalised in new[] { LedgerCategory.InputPurchase, LedgerCategory.RetailRestock, LedgerCategory.ShippingCost })
        {
            Assert.Equal(StatementSection.InventoryCapitalized, LedgerCategoryInfo.Of(capitalised).Section);
        }
        Assert.Equal(StatementSection.Capex, LedgerCategoryInfo.Of(LedgerCategory.ConstructionCost).Section);
        Assert.Equal(StatementSection.Capex, LedgerCategoryInfo.Of(LedgerCategory.UpgradeCost).Section);
        Assert.Equal(StatementSection.EquityContribution, LedgerCategoryInfo.Of(LedgerCategory.StartingCapital).Section);
    }

    [Theory]
    [InlineData(LedgerCategory.LoanDrawdown, StatementSection.Financing, CashFlowClass.Financing)]
    [InlineData(LedgerCategory.RevolverRepay, StatementSection.Financing, CashFlowClass.Financing)]
    [InlineData(LedgerCategory.DividendPaid, StatementSection.EquityContribution, CashFlowClass.Financing)]
    [InlineData(LedgerCategory.LandPurchase, StatementSection.Capex, CashFlowClass.Investing)]
    [InlineData(LedgerCategory.Wages, StatementSection.OperatingExpense, CashFlowClass.Operating)]
    [InlineData(LedgerCategory.ProductionEnergy, StatementSection.InventoryCapitalized, CashFlowClass.Operating)]
    [InlineData(LedgerCategory.InterestExpense, StatementSection.NonOperating, CashFlowClass.Operating)]
    [InlineData(LedgerCategory.IncomeTax, StatementSection.IncomeTax, CashFlowClass.Operating)]
    public void Econ_audit_table_maps_new_categories(LedgerCategory category, StatementSection section, CashFlowClass cashFlow)
    {
        var info = LedgerCategoryInfo.Of(category);
        Assert.Equal(section, info.Section);
        Assert.Equal(cashFlow, info.CashFlow);
    }

    /// <summary>
    /// Books every statement section by hand (cash entries through the engine's single cash
    /// mutation point, non-cash entries through the accrual journal) and checks that the
    /// income statement, balance sheet and cash-flow statement put each amount on the right line
    /// and that the books still close.
    /// </summary>
    [Fact]
    public void Statements_classify_every_section_and_books_close()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.AdvanceMonth();

        var store1 = store.Id;
        world.RecordCashChange(acme.Id, LedgerCategory.LoanDrawdown, 5_000_000m, "loan");
        world.RecordCashChange(acme.Id, LedgerCategory.ProductSale, 300_000m, "sales", building: store1);
        world.RecordCashChange(acme.Id, LedgerCategory.Wages, -40_000m, "wages", building: store1);
        world.RecordCashChange(acme.Id, LedgerCategory.InterestExpense, -25_000m, "interest");
        world.RecordCashChange(acme.Id, LedgerCategory.InterestIncome, 1_000m, "deposit interest");
        world.RecordCashChange(acme.Id, LedgerCategory.IncomeTax, -50_000m, "tax");
        world.RecordCashChange(acme.Id, LedgerCategory.LoanRepayment, -100_000m, "principal");
        world.RecordCashChange(acme.Id, LedgerCategory.ShareIssuance, 2_000_000m, "secondary");
        world.RecordCashChange(acme.Id, LedgerCategory.DividendPaid, -150_000m, "dividend");
        world.RecordAccrual(acme.Id, AccrualKind.Depreciation, -3_333.33m, "depreciation", store1);

        var now = world.Clock.Now;
        var month = world.GetIncomeStatement(acme.Id, now, now);
        Assert.Equal(300_000m, month.Revenue);
        Assert.Equal(0m, month.CostOfGoodsSold);
        Assert.Equal(3_333.33m, month.Depreciation);
        var opex = world.GetMonthlyOpex(store) + 40_000m + 3_333.33m;
        Assert.Equal(opex, month.OperatingExpenses);
        Assert.Equal(-25_000m + 1_000m, month.NonOperatingIncome);
        Assert.Equal(50_000m, month.IncomeTax);
        Assert.Equal(month.GrossProfit - opex, month.Ebit);
        Assert.Equal(month.Ebit + 3_333.33m, month.Ebitda);
        Assert.Equal(month.Ebit - 24_000m - 50_000m, month.NetIncome);

        var bs = world.GetBalanceSheet(acme.Id);
        Assert.Equal(4_900_000m, bs.Liabilities);
        var type = world.Catalog.BuildingType(store.TypeId);
        Assert.Equal(type.ConstructionCost - 3_333.33m, bs.BuildingValue);

        var cashFlow = world.GetCashFlowStatement(acme.Id, new GameDate(2026, 1), now);
        Assert.Equal(acme.Cash, cashFlow.NetChange);
        Assert.Equal(10_000_000m + 5_000_000m - 100_000m + 2_000_000m - 150_000m, cashFlow.Financing);
        Assert.Equal(-type.ConstructionCost, cashFlow.Investing);

        Invariants.AssertAll(world);
    }

    [Fact]
    public void Journal_gains_write_offs_and_write_downs_land_on_their_lines()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        world.AdvanceMonth();
        world.RecordAccrual(acme.Id, AccrualKind.DisposalGainLoss, 7_000m, "gain on sale");
        world.RecordAccrual(acme.Id, AccrualKind.ConstructionWriteOff, -2_000m, "cancelled project");
        world.RecordAccrual(acme.Id, AccrualKind.InventoryWriteDown, -500m, "spoilage", product: new ProductId("bread"));

        var now = world.Clock.Now;
        var month = world.GetIncomeStatement(acme.Id, now, now);
        Assert.Equal(5_000m, month.NonOperatingIncome);
        Assert.Equal(500m, month.CostOfGoodsSold);
        Assert.Equal(0m, month.Depreciation);
        Assert.Equal(3, world.AccrualJournal.EntriesFor(acme.Id).Count());
    }

    [Fact]
    public void Depreciation_accruals_must_name_an_owned_building_and_be_expenses()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rival = world.CreateCompany("Rival", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));

        Assert.Throws<ArgumentException>(() => world.RecordAccrual(acme.Id, AccrualKind.Depreciation, -1m, "x"));
        Assert.Throws<InvalidOperationException>(() => world.RecordAccrual(rival.Id, AccrualKind.Depreciation, -1m, "x", store.Id));
        Assert.Throws<ArgumentOutOfRangeException>(() => world.RecordAccrual(acme.Id, AccrualKind.Depreciation, 1m, "x", store.Id));
        Assert.Empty(world.AccrualJournal.Entries);
        Assert.Equal(0m, store.AccumulatedDepreciation);
    }
}
