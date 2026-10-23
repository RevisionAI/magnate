using System;
using System.Collections.Generic;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// World-wide accounting and state invariants (test-map §7.3, econ-audit §6 R1). Call
/// <see cref="AssertAll"/> after every tick in property, golden and scenario tests; it must hold
/// under every ruleset. Each check names the company/building/product it failed on.
/// <list type="number">
///   <item>Cash == Σ ledger, exactly, for every company.</item>
///   <item>Books close: A − L == E, and E == Σ owner equity flows + cumulative net income
///         (net income from the engine's own income statement).</item>
///   <item>Ledger amounts follow their category's normal sign; entries without a building
///         belong to company-level categories; entries with one name an existing building of
///         the same owner (engine metadata, <see cref="LedgerCategoryInfo"/>).</item>
///   <item>Sub-ledgers agree: liabilities == Σ financing flows; accumulated depreciation ==
///         −Σ depreciation accruals per building; book values ≥ 0; the cash-flow classes sum
///         to cash.</item>
///   <item>No NaN/∞ in double-valued state; inventory ≥ 0; brand ∈ [0,100]; tech ∈ [1,max];
///         quality ∈ [0,100]; research progress ≥ 0.</item>
///   <item>Licences ride on registered patents; news is chronological.</item>
/// </list>
/// </summary>
public static class Invariants
{
    /// <summary>
    /// Tolerance for identities whose two sides are summed in different orders. Decimal sums of
    /// values near 10^10 with 18+ fractional digits exceed the 28-29 digit mantissa and round in
    /// the last digit, so "to the cent" is enforced with a micro-dollar bound.
    /// </summary>
    public const decimal BooksTolerance = 0.000001m;

    private sealed class CompanyTotals
    {
        public decimal Cash;
        public decimal EquityFlows;
        public decimal Financing;
        public decimal Operating;
        public decimal Investing;
        public decimal FinancingCashFlow;
    }

    /// <summary>Run every invariant. Throws an xUnit assertion on the first violation.</summary>
    public static void AssertAll(World world)
    {
        ArgumentNullException.ThrowIfNull(world);
        var totals = ScanLedger(world);
        CashEqualsLedger(world, totals);
        BooksClose(world, totals);
        SubLedgersAgree(world, totals);
        NoNonFiniteState(world);
        InventoryNonNegative(world);
        RangesHold(world);
        LicensesRideOnLivePatents(world);
        NewsIsChronological(world);
    }

    /// <summary><c>Company.Cash == Σ ledger(company)</c>, exactly (same additions, same order).</summary>
    public static void CashEqualsLedger(World world) => CashEqualsLedger(world, ScanLedger(world));

    /// <summary>
    /// Books close: <c>Assets − Liabilities == Equity</c> and
    /// <c>Equity == Σ owner equity flows + cumulative net income</c> for every company.
    /// </summary>
    public static void BooksClose(World world) => BooksClose(world, ScanLedger(world));

    /// <summary>
    /// Net owner equity flows (contributions minus distributions) recorded in the cash ledger:
    /// every category whose engine metadata maps it to <see cref="StatementSection.EquityContribution"/>.
    /// </summary>
    public static decimal ContributedCapital(World world, CompanyId company)
        => TotalsOf(ScanLedger(world), company).EquityFlows;

    /// <summary>Categories that may legitimately carry no building reference (engine metadata).</summary>
    public static bool IsCompanyLevel(LedgerCategory category) => LedgerCategoryInfo.Of(category).IsCompanyLevel;

    /// <summary>
    /// One pass over the ledger: per-company totals, plus the sign and attribution checks that
    /// need every entry anyway.
    /// </summary>
    private static Dictionary<CompanyId, CompanyTotals> ScanLedger(World world)
    {
        var totals = new Dictionary<CompanyId, CompanyTotals>();
        foreach (var e in world.Ledger.Entries)
        {
            var info = LedgerCategoryInfo.Of(e.Category);

            Assert.True(info.NormalSign == 0 || Math.Sign(e.Amount) * info.NormalSign >= 0,
                $"{e.Category} entry on {e.Date} for {e.Company} has the wrong sign: {e.Amount}");

            if (e.Building is BuildingInstanceId bid)
            {
                // Sold, demolished and liquidated buildings keep their ledger history (E2 finance).
                Assert.True(world.Buildings.TryGetValue(bid, out var b) || world.RetiredBuildings.TryGetValue(bid, out b),
                    $"ledger entry on {e.Date} names unknown building {bid}");
                Assert.True(b!.Owner == e.Company, $"ledger entry for {e.Company} names {bid} owned by {b.Owner}");
            }
            else
            {
                // The land market (E3b) buys and sells plots held without a building.
                var heldLand = e.Category is LedgerCategory.LandPurchase or LedgerCategory.AssetSale;
                Assert.True(info.IsCompanyLevel || heldLand, $"{e.Category} entry on {e.Date} for {e.Company} has no building");
            }

            if (!totals.TryGetValue(e.Company, out var t))
            {
                t = new CompanyTotals();
                totals[e.Company] = t;
            }

            t.Cash += e.Amount;
            switch (info.Section)
            {
                case StatementSection.EquityContribution:
                    t.EquityFlows += e.Amount;
                    break;
                case StatementSection.Financing:
                    t.Financing += e.Amount;
                    break;
            }

            switch (info.CashFlow)
            {
                case CashFlowClass.Operating:
                    t.Operating += e.Amount;
                    break;
                case CashFlowClass.Investing:
                    t.Investing += e.Amount;
                    break;
                case CashFlowClass.Financing:
                    t.FinancingCashFlow += e.Amount;
                    break;
            }
        }

        return totals;
    }

    private static CompanyTotals TotalsOf(Dictionary<CompanyId, CompanyTotals> totals, CompanyId company)
        => totals.TryGetValue(company, out var t) ? t : new CompanyTotals();

    private static void CashEqualsLedger(World world, Dictionary<CompanyId, CompanyTotals> totals)
    {
        foreach (var c in world.Companies.Values)
        {
            var ledger = TotalsOf(totals, c.Id).Cash;
            Assert.True(c.Cash == ledger, $"cash != Σ ledger for {c.Id} ({c.Name}): cash {c.Cash}, ledger {ledger}");
        }
    }

    private static void BooksClose(World world, Dictionary<CompanyId, CompanyTotals> totals)
    {
        var from = new GameDate(1, 1);
        foreach (var c in world.Companies.Values)
        {
            var bs = world.GetBalanceSheet(c.Id);
            Assert.True(bs.TotalAssets - bs.Liabilities == bs.Equity,
                $"A − L != E for {c.Id}: assets {bs.TotalAssets}, liabilities {bs.Liabilities}, equity {bs.Equity}");

            var contributed = TotalsOf(totals, c.Id).EquityFlows;
            var netIncome = world.GetIncomeStatement(c.Id, from, world.Clock.Now).NetIncome;
            var gap = bs.Equity - (contributed + netIncome);
            Assert.True(Math.Abs(gap) <= BooksTolerance,
                $"books do not close for {c.Id} ({c.Name}): equity {bs.Equity} vs owner equity flows {contributed} + net income {netIncome} (gap {gap})");
        }
    }

    private static void SubLedgersAgree(World world, Dictionary<CompanyId, CompanyTotals> totals)
    {
        foreach (var c in world.Companies.Values)
        {
            var t = TotalsOf(totals, c.Id);
            var liabilities = world.GetBalanceSheet(c.Id).Liabilities;
            Assert.True(liabilities == t.Financing,
                $"liabilities of {c.Id} ({liabilities}) disagree with the financing flows ({t.Financing})");

            var netCashFlow = t.Operating + t.Investing + t.FinancingCashFlow;
            Assert.True(Math.Abs(netCashFlow - c.Cash) <= BooksTolerance,
                $"cash-flow classes of {c.Id} net to {netCashFlow}, cash is {c.Cash}");
        }

        var depreciation = new Dictionary<BuildingInstanceId, decimal>();
        foreach (var a in world.AccrualJournal.Entries)
        {
            if (a.Kind != AccrualKind.Depreciation || a.Building is not BuildingInstanceId bid) continue;
            depreciation.TryGetValue(bid, out var acc);
            depreciation[bid] = acc - a.Amount;
        }

        foreach (var b in world.Buildings.Values)
        {
            depreciation.TryGetValue(b.Id, out var journal);
            Assert.True(b.AccumulatedDepreciation == journal,
                $"accumulated depreciation of {b.Id} is {b.AccumulatedDepreciation}, journal says {journal}");
            Assert.True(b.BookValue >= 0m, $"negative book value {b.BookValue} for {b.Id}");
        }
    }

    /// <summary>No NaN or infinity anywhere in double-valued state.</summary>
    public static void NoNonFiniteState(World world)
    {
        foreach (var b in world.Buildings.Values)
        {
            foreach (var (product, qty, _, quality) in b.Inventory.EntriesWithCost)
            {
                Assert.True(double.IsFinite(qty), $"non-finite quantity {qty} of {product} at {b.Id}");
                Assert.True(double.IsFinite(quality), $"non-finite quality {quality} of {product} at {b.Id}");
            }
            foreach (var s in b.RetailSlots)
                Assert.True(double.IsFinite(s.RestockTarget), $"non-finite restock target at {b.Id} slot {s.Index}");
            foreach (var s in b.WarehouseSlots)
                Assert.True(double.IsFinite(s.TargetStock), $"non-finite warehouse target at {b.Id} slot {s.Index}");
        }

        foreach (var (key, value) in world.InternalBrandAwareness)
            Assert.True(double.IsFinite(value), $"non-finite brand {value} for {key}");
        foreach (var (key, value) in world.InternalResearchProgress)
            Assert.True(double.IsFinite(value), $"non-finite research progress {value} for {key}");
    }

    /// <summary>Inventory quantity ≥ −1e-9 and cost basis ≥ 0 for every building and product.</summary>
    public static void InventoryNonNegative(World world)
    {
        foreach (var b in world.Buildings.Values)
        {
            foreach (var (product, qty, cost, _) in b.Inventory.EntriesWithCost)
            {
                Assert.True(qty >= -1e-9, $"negative quantity {qty} of {product} at {b.Id}");
                Assert.True(cost >= 0m, $"negative cost basis {cost} of {product} at {b.Id}");
            }
        }
    }

    /// <summary>Brand ∈ [0, 100], tech ∈ [1, max], quality ∈ [0, 100], research progress ≥ 0.</summary>
    public static void RangesHold(World world)
    {
        foreach (var (key, value) in world.InternalBrandAwareness)
            Assert.True(value >= 0 && value <= 100, $"brand {value} outside [0, 100] for {key}");
        foreach (var (key, level) in world.InternalTech)
        {
            var max = world.Catalog.Product(key.Product).MaxTechLevel;
            Assert.True(level >= 1 && level <= max, $"tech {level} outside [1, {max}] for {key}");
        }
        foreach (var (key, value) in world.InternalResearchProgress)
            Assert.True(value >= 0, $"negative research progress {value} for {key}");
        foreach (var b in world.Buildings.Values)
        {
            foreach (var (product, qty, _, quality) in b.Inventory.EntriesWithCost)
            {
                if (qty <= 0) continue;
                Assert.True(quality >= -1e-9 && quality <= 100 + 1e-9, $"quality {quality} of {product} at {b.Id}");
            }
        }
    }

    /// <summary>Licences only exist on patents that are still registered.</summary>
    public static void LicensesRideOnLivePatents(World world)
    {
        foreach (var key in world.InternalPatentLicenses.Keys)
        {
            Assert.True(world.InternalPatents.ContainsKey(key), $"licence on {key} without a registered patent");
        }
    }

    /// <summary>News-log dates are non-decreasing.</summary>
    public static void NewsIsChronological(World world)
    {
        var news = world.NewsLog;
        for (var i = 1; i < news.Count; i++)
        {
            Assert.True(news[i - 1].Date <= news[i].Date, $"news out of order at index {i}: {news[i - 1].Date} then {news[i].Date}");
        }
    }
}
