using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Economics;

namespace Magnate.Bridge;

/// <summary>Cash-flow statement section of a ledger category.</summary>
internal enum CashSection
{
    Operating,
    Investing,
    Financing,

    /// <summary>Out-of-range ordinal (never produced for a defined category).</summary>
    Unmapped,
}

/// <summary>Income-statement role of a ledger category.</summary>
internal enum PnlRole
{
    /// <summary>Balance-sheet movement (capex, inventory purchases, equity): not P&amp;L.</summary>
    None,
    Revenue,
    OperatingExpense,
    InterestExpense,
    InterestIncome,
    IncomeTax,
}

/// <summary>
/// Statement mapping for every <see cref="LedgerCategory"/> (bridge-spec §4.6.3,
/// econ-audit §4.15). The accounting facts — cash-flow class and statement section —
/// come from the engine's <see cref="LedgerCategoryInfo"/> metadata, the single source the
/// engine's own statements read, so a category the engine adds is classified the day it
/// appears. The bridge only adds presentation: the cash-flow line id each category is
/// reported under (several categories share a line, e.g. both construction categories).
/// </summary>
internal static class LedgerCategories
{
    // name → cash-flow line id (presentation only). Unlisted categories report under their own camelCase id.
    private static readonly Dictionary<string, string> LineByName = new(StringComparer.Ordinal)
    {
        ["ProductSale"] = "productSales",
        ["ExportSale"] = "exportSales",
        ["PatentRoyaltyIncome"] = "royaltyIncome",
        ["OperatingCost"] = "operatingCosts",
        ["AdvertisingCost"] = "advertising",
        ["PatentRoyaltyExpense"] = "royaltyExpense",
        ["InputPurchase"] = "inputPurchases",
        ["ShippingCost"] = "shipping",
        ["ConstructionCost"] = "construction",
        ["ConstructionPayment"] = "construction",
        ["UpgradeCost"] = "upgrades",
        ["EquipmentPurchase"] = "equipment",
        ["LandPurchase"] = "landPurchases",
        ["AssetSale"] = "assetSales",
        ["StartingCapital"] = "equityInjections",
        ["ShareIssuanceFee"] = "shareIssuanceFees",
        ["ShareBuyback"] = "shareBuybacks",
        ["DividendPaid"] = "dividends",
        ["LoanDrawdown"] = "loanProceeds",
        ["LoanRepayment"] = "loanRepayments",
        ["RevolverDraw"] = "revolverDraws",
        ["RevolverRepay"] = "revolverRepayments",
    };

    /// <summary>Every enum value, in declaration order.</summary>
    public static readonly LedgerCategory[] All = Enum.GetValues<LedgerCategory>();

    /// <summary>Array size for per-category sums (max ordinal + 1).</summary>
    public static readonly int Count = All.Length == 0 ? 1 : All.Max(c => (int)c) + 1;

    private static readonly CashSection[] Sections = new CashSection[Count];
    private static readonly string[] Lines = new string[Count];
    private static readonly PnlRole[] Roles = new PnlRole[Count];
    private static readonly string[] Ids = new string[Count];

    /// <summary>Ordinals of revenue categories.</summary>
    public static readonly int[] RevenueOrdinals;

    /// <summary>Ordinals of operating-expense categories.</summary>
    public static readonly int[] OpexOrdinals;

    static LedgerCategories()
    {
        for (var i = 0; i < Count; i++)
        {
            Sections[i] = CashSection.Unmapped;
            Lines[i] = "unclassified";
            Ids[i] = "unknown" + i;
        }
        foreach (var category in All)
        {
            var ordinal = (int)category;
            var name = category.ToString();
            var info = LedgerCategoryInfo.Of(category);
            Ids[ordinal] = CamelCase(name);
            Lines[ordinal] = LineByName.TryGetValue(name, out var line) ? line : CamelCase(name);
            Sections[ordinal] = info.CashFlow switch
            {
                CashFlowClass.Operating => CashSection.Operating,
                CashFlowClass.Investing => CashSection.Investing,
                _ => CashSection.Financing,
            };
            Roles[ordinal] = info.Section switch
            {
                StatementSection.Revenue => PnlRole.Revenue,
                StatementSection.OperatingExpense => PnlRole.OperatingExpense,
                StatementSection.NonOperating => info.NormalSign > 0 ? PnlRole.InterestIncome : PnlRole.InterestExpense,
                StatementSection.IncomeTax => PnlRole.IncomeTax,
                _ => PnlRole.None,
            };
        }
        RevenueOrdinals = All.Where(c => Roles[(int)c] == PnlRole.Revenue).Select(c => (int)c).ToArray();
        OpexOrdinals = All.Where(c => Roles[(int)c] == PnlRole.OperatingExpense).Select(c => (int)c).ToArray();
    }

    public static CashSection SectionOf(int ordinal) => ordinal >= 0 && ordinal < Count ? Sections[ordinal] : CashSection.Unmapped;

    public static string LineOf(int ordinal) => ordinal >= 0 && ordinal < Count ? Lines[ordinal] : "unclassified";

    public static PnlRole RoleOf(int ordinal) => ordinal >= 0 && ordinal < Count ? Roles[ordinal] : PnlRole.None;

    /// <summary>True for every defined category: the engine metadata maps them all (its type initialiser enforces it).</summary>
    public static bool IsMapped(LedgerCategory category) => (int)category >= 0 && (int)category < Count && Enum.IsDefined(category);

    /// <summary>Protocol id of a category (TS <c>LedgerCategoryId</c>): the enum name in camelCase.</summary>
    public static string Id(LedgerCategory category) => Ids[(int)category];

    /// <summary>Parse a protocol id (camelCase or PascalCase) back to a category.</summary>
    public static bool TryParse(string? id, out LedgerCategory category)
    {
        category = default;
        if (string.IsNullOrWhiteSpace(id)) return false;
        return Enum.TryParse(id, ignoreCase: true, out category) && Enum.IsDefined(category);
    }

    private static string CamelCase(string name)
        => string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name.Substring(1);
}
