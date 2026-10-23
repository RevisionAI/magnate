using System;
using System.Collections.Generic;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// One company's headline financials at now (bridge-spec §4.6.1), straight from the engine:
/// <list type="bullet">
///   <item>Balance-sheet figures are <c>World.GetBalanceSheet</c> (PP&amp;E at net book value, land,
///         construction in progress, term loans and the revolver — econ-audit §4.15).</item>
///   <item><b>Company value (master plan D10)</b> is <c>World.GetCorporateValue</c>: market cap once
///         listed, otherwise the fundamental equity value; total assets under Classic rules.</item>
///   <item>Net income is the ledger index's accrual figure: the cash-classified P&amp;L plus the
///         non-cash journal it folds (depreciation, disposal gains and losses, write-offs) —
///         exactly the engine's income statement.</item>
/// </list>
/// </summary>
internal readonly record struct CompanyFinancials(
    decimal Cash,
    decimal Inventory,
    decimal BookValue,
    decimal EngineBuildingValue,
    decimal Liabilities,
    decimal RevenueThisMonth,
    decimal NetIncomeThisMonth,
    decimal NetIncomeLast12,
    int Buildings,
    decimal TotalAssets,
    decimal Equity,
    decimal CorporateValue,
    string? CreditRating,
    string Solvency);

/// <summary>Computes <see cref="CompanyFinancials"/> for every company.</summary>
internal static class Financials
{
    /// <summary>Months in the trailing net-income window.</summary>
    public const int TrailingMonths = 12;

    public static Dictionary<int, CompanyFinancials> Compute(World world, LedgerIndex index, int now, int start)
    {
        var counts = new Dictionary<int, int>();
        foreach (var b in world.Buildings.Values)
        {
            counts[b.Owner.Value] = counts.GetValueOrDefault(b.Owner.Value) + 1;
        }

        var from12 = Math.Max(start, now - (TrailingMonths - 1));
        var result = new Dictionary<int, CompanyFinancials>(world.Companies.Count);
        foreach (var company in world.Companies.Values)
        {
            var id = company.Id.Value;
            var bs = world.GetBalanceSheet(company.Id);
            var month = index.Company(id, now);
            var finance = world.GetCompanyFinance(company.Id);
            var ni12 = index.NetIncome(id, from12, now);
            result[id] = new CompanyFinancials(
                Cash: company.Cash,
                Inventory: bs.InventoryValue,
                BookValue: bs.BuildingValue,
                EngineBuildingValue: bs.BuildingValue,
                Liabilities: bs.Liabilities,
                RevenueThisMonth: month?.Revenue ?? 0m,
                NetIncomeThisMonth: month?.NetIncome ?? 0m,
                NetIncomeLast12: ni12,
                Buildings: counts.GetValueOrDefault(id),
                TotalAssets: bs.TotalAssets,
                Equity: bs.Equity,
                CorporateValue: world.GetCorporateValue(company.Id),
                CreditRating: CreditLabel(world, company.Id),
                Solvency: SolvencyLabel(finance));
        }
        return result;
    }

    /// <summary>
    /// Net book value of a building (construction + upgrades − depreciation): the engine's figure,
    /// which capitalises upgrades (bridge-spec E5) and rebuilds legacy saves' cost from the ledger.
    /// </summary>
    public static decimal BookValue(World world, LedgerIndex index, BuildingInstance b)
    {
        // Everything the building carries: structure NBV plus its land at cost and construction in
        // progress (E2's asset register; E3b's construction sites hold only land and CIP).
        _ = index;
        return b.BookValue + world.GetLandCost(b.Id) + world.GetConstructionInProgress(b.Id);
    }

    /// <summary>The reported rating label ("NR" while unrated), or null when the finance model is off.</summary>
    public static string? CreditLabel(World world, CompanyId company)
    {
        if (!world.Rules.Finance.Enabled || !world.Rules.Finance.CreditRating) return null;
        return world.GetCompanyFinance(company)?.Rating is { } r ? CreditRatings.Label(r) : "NR";
    }

    private static string SolvencyLabel(CompanyFinance? finance) => finance?.State switch
    {
        SolvencyState.Distress => "distress",
        SolvencyState.Bankrupt => "bankrupt",
        _ => "solvent",
    };
}
