using System;
using System.Collections.Generic;
using System.Linq;

namespace Magnate.Engine.Economics;

/// <summary>
/// Where a cash-ledger category lands in the financial statements (econ-audit §4.15). The
/// statements are pure functions of the ledger, the COGS log and the accrual journal; this
/// mapping is the single source of truth they (and the bridge's report classifiers) read.
/// </summary>
public enum StatementSection
{
    /// <summary>Top line: retail sales, exports, royalty income.</summary>
    Revenue,

    /// <summary>
    /// Cash spent on goods that enter inventory at cost; it reaches the income statement as
    /// COGS when the goods are sold, never directly.
    /// </summary>
    InventoryCapitalized,

    /// <summary>Period costs above EBIT (opex, wages, utilities, advertising, royalty expense, …).</summary>
    OperatingExpense,

    /// <summary>Below EBIT: interest income and expense (net, signed as booked).</summary>
    NonOperating,

    /// <summary>Corporate income tax.</summary>
    IncomeTax,

    /// <summary>Investment in or disposal of long-lived assets (construction, upgrades, land, equipment, asset sales).</summary>
    Capex,

    /// <summary>Debt principal flows (loans, revolver). Their running sum is the outstanding debt.</summary>
    Financing,

    /// <summary>
    /// Equity flows with owners: contributions (starting capital, share issues, net of fees) and
    /// distributions (dividends, buybacks). Their running sum plus cumulative net income is equity.
    /// </summary>
    EquityContribution,
}

/// <summary>Cash-flow statement class of a ledger category (econ-audit §4.15).</summary>
public enum CashFlowClass
{
    /// <summary>Cash from operations (sales, purchases, opex, interest, tax).</summary>
    Operating,

    /// <summary>Cash for or from long-lived assets.</summary>
    Investing,

    /// <summary>Cash from or to lenders and owners.</summary>
    Financing,
}

/// <summary>
/// Accounting metadata of one <see cref="LedgerCategory"/>.
/// </summary>
/// <param name="Category">The category described.</param>
/// <param name="Section">Statement section the category's amounts land in.</param>
/// <param name="CashFlow">Cash-flow statement class.</param>
/// <param name="IsCompanyLevel">
/// True when the flow is company-wide and its ledger entries carry no building (starting
/// capital, advertising, royalties, financing, tax, corporate overhead). False when every entry
/// names the building that caused it.
/// </param>
/// <param name="NormalSign">+1 when amounts are inflows, −1 when outflows, 0 when either occurs (tax refunds).</param>
public sealed record LedgerCategoryInfo(
    LedgerCategory Category,
    StatementSection Section,
    CashFlowClass CashFlow,
    bool IsCompanyLevel,
    int NormalSign)
{
    private static readonly LedgerCategoryInfo[] Table = BuildTable();

    /// <summary>Metadata for every category, indexed by the enum's numeric value.</summary>
    public static IReadOnlyList<LedgerCategoryInfo> All => Table;

    /// <summary>Metadata of <paramref name="category"/>.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The value is not a defined category.</exception>
    public static LedgerCategoryInfo Of(LedgerCategory category)
    {
        var index = (int)category;
        if (index < 0 || index >= Table.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(category), category, "undefined ledger category");
        }

        return Table[index];
    }

    /// <summary>True when amounts in this category flow into net income directly (not via COGS or the balance sheet).</summary>
    public bool AffectsNetIncome => Section is StatementSection.Revenue
        or StatementSection.OperatingExpense
        or StatementSection.NonOperating
        or StatementSection.IncomeTax;

    /// <summary>All categories of a statement section, in enum order.</summary>
    public static IReadOnlyList<LedgerCategory> InSection(StatementSection section)
        => Table.Where(i => i.Section == section).Select(i => i.Category).ToList();

    private static LedgerCategoryInfo[] BuildTable()
    {
        const int In = 1, Out = -1, Either = 0;
        var rows = new List<LedgerCategoryInfo>
        {
            // Existing (pre-overhaul) categories.
            new(LedgerCategory.StartingCapital, StatementSection.EquityContribution, CashFlowClass.Financing, true, In),
            new(LedgerCategory.ConstructionCost, StatementSection.Capex, CashFlowClass.Investing, false, Out),
            new(LedgerCategory.OperatingCost, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.InputPurchase, StatementSection.InventoryCapitalized, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.RetailRestock, StatementSection.InventoryCapitalized, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.ProductSale, StatementSection.Revenue, CashFlowClass.Operating, false, In),
            new(LedgerCategory.ExportSale, StatementSection.Revenue, CashFlowClass.Operating, false, In),
            new(LedgerCategory.ShippingCost, StatementSection.InventoryCapitalized, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.AdvertisingCost, StatementSection.OperatingExpense, CashFlowClass.Operating, true, Out),
            new(LedgerCategory.PatentRoyaltyIncome, StatementSection.Revenue, CashFlowClass.Operating, true, In),
            new(LedgerCategory.PatentRoyaltyExpense, StatementSection.OperatingExpense, CashFlowClass.Operating, true, Out),
            new(LedgerCategory.UpgradeCost, StatementSection.Capex, CashFlowClass.Investing, false, Out),

            // econ-audit §4.15 additions.
            new(LedgerCategory.ShareIssuance, StatementSection.EquityContribution, CashFlowClass.Financing, true, In),
            new(LedgerCategory.ShareIssuanceFee, StatementSection.EquityContribution, CashFlowClass.Financing, true, Out),
            new(LedgerCategory.ShareBuyback, StatementSection.EquityContribution, CashFlowClass.Financing, true, Out),
            new(LedgerCategory.DividendPaid, StatementSection.EquityContribution, CashFlowClass.Financing, true, Out),
            new(LedgerCategory.LoanDrawdown, StatementSection.Financing, CashFlowClass.Financing, true, In),
            new(LedgerCategory.LoanRepayment, StatementSection.Financing, CashFlowClass.Financing, true, Out),
            new(LedgerCategory.RevolverDraw, StatementSection.Financing, CashFlowClass.Financing, true, In),
            new(LedgerCategory.RevolverRepay, StatementSection.Financing, CashFlowClass.Financing, true, Out),
            new(LedgerCategory.LandPurchase, StatementSection.Capex, CashFlowClass.Investing, false, Out),
            new(LedgerCategory.ConstructionPayment, StatementSection.Capex, CashFlowClass.Investing, false, Out),
            new(LedgerCategory.EquipmentPurchase, StatementSection.Capex, CashFlowClass.Investing, false, Out),
            new(LedgerCategory.AssetSale, StatementSection.Capex, CashFlowClass.Investing, false, In),
            new(LedgerCategory.LiquidationProceeds, StatementSection.Capex, CashFlowClass.Investing, false, In),
            new(LedgerCategory.OtherMaterials, StatementSection.InventoryCapitalized, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.ProductionEnergy, StatementSection.InventoryCapitalized, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.Wages, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.Utilities, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.Maintenance, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.Insurance, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.PropertyTax, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.RetailVariable, StatementSection.OperatingExpense, CashFlowClass.Operating, false, Out),
            new(LedgerCategory.CorporateOverhead, StatementSection.OperatingExpense, CashFlowClass.Operating, true, Out),
            new(LedgerCategory.InterestExpense, StatementSection.NonOperating, CashFlowClass.Operating, true, Out),
            new(LedgerCategory.DistressInterest, StatementSection.NonOperating, CashFlowClass.Operating, true, Out),
            new(LedgerCategory.InterestIncome, StatementSection.NonOperating, CashFlowClass.Operating, true, In),
            new(LedgerCategory.IncomeTax, StatementSection.IncomeTax, CashFlowClass.Operating, true, Either),
        };

        var table = new LedgerCategoryInfo[Enum.GetValues<LedgerCategory>().Length];
        foreach (var row in rows)
        {
            var index = (int)row.Category;
            if (table[index] is not null)
            {
                throw new InvalidOperationException($"ledger category {row.Category} mapped twice");
            }

            table[index] = row;
        }

        for (var i = 0; i < table.Length; i++)
        {
            if (table[i] is null)
            {
                throw new InvalidOperationException($"ledger category {(LedgerCategory)i} has no statement mapping");
            }
        }

        return table;
    }
}
