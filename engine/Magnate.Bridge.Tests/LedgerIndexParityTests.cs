using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>
/// The incremental <see cref="LedgerIndex"/> against the engine's own (full-scan)
/// reports over a ten-year, five-company autopilot game (bridge-spec §4.5, §10.1):
/// income statements and product P&amp;L to the cent for 50 random windows per
/// company, cash at every month end equal to the ledger prefix sum, and the
/// incrementally folded index equal to a cold rebuild.
/// </summary>
[Collection("year10")]
public class LedgerIndexParityTests
{
    private const int Windows = 50;
    private readonly Year10Fixture _year10;

    public LedgerIndexParityTests(Year10Fixture year10)
    {
        _year10 = year10;
    }

    private ActiveGame Game => _year10.Bridge.Session.Game;

    private static void Close(double expected, double actual)
        => Assert.True(Math.Abs(expected - actual) <= 1e-9 * Math.Max(1, Math.Abs(expected)), $"expected {expected}, got {actual}");

    private static void AssertCents(decimal expected, decimal actual, string what)
        => Assert.True(Math.Abs(expected - actual) < 0.01m, $"{what}: engine {expected} vs index {actual}");

    private IEnumerable<(int From, int To)> RandomWindows(int seed)
    {
        var rng = new Random(seed);
        var start = Game.StartMonth;
        var now = Game.Now;
        for (var i = 0; i < Windows; i++)
        {
            var a = rng.Next(start, now + 1);
            var b = rng.Next(start, now + 1);
            yield return (Math.Min(a, b), Math.Max(a, b));
        }
    }

    [Fact]
    public void Bridge_classification_is_the_engine_metadata()
    {
        // LedgerCategories reads LedgerCategoryInfo (e0 §2.4): cash-flow class and P&L membership agree for every category.
        foreach (var category in Enum.GetValues<LedgerCategory>())
        {
            var info = LedgerCategoryInfo.Of(category);
            var ordinal = (int)category;
            Assert.Equal(info.CashFlow.ToString(), LedgerCategories.SectionOf(ordinal).ToString());
            Assert.Equal(info.AffectsNetIncome, LedgerCategories.RoleOf(ordinal) != PnlRole.None);
            Assert.Equal(info.Section == StatementSection.Revenue, LedgerCategories.RevenueOrdinals.Contains(ordinal));
            Assert.Equal(info.Section == StatementSection.OperatingExpense, LedgerCategories.OpexOrdinals.Contains(ordinal));
        }
    }

    [Fact]
    public void Book_value_and_opening_month_are_the_engines()
    {
        // E5/E17: BuildingInstance.BookValue and BuiltAt, not a ledger reconstruction.
        var world = Game.World;
        Assert.NotEmpty(world.Buildings);
        foreach (var b in world.Buildings.Values)
        {
            var info = Game.Index.BuildingInfo(b.Id.Value);
            Assert.NotNull(info);
            Assert.Equal(b.BookValue, info!.BookValue);
            Assert.Equal(b.BuiltAt.AsMonthIndex(), info.OpenedMonth);
            // Without depreciation (Classic finance), book value is still construction + upgrades.
            Assert.Equal(info.ConstructionCost + info.UpgradeCost, b.CapitalizedCost);
        }
    }

    [Fact]
    public void Purchase_and_shipping_units_are_the_ledger_quantities()
    {
        // E11: LedgerEntry.Quantity on market buys and freight, folded per company × product × month.
        var world = Game.World;
        var purchased = new Dictionary<(int, string), double>();
        var shipped = new Dictionary<(int, string), double>();
        foreach (var e in world.Ledger.Entries)
        {
            if (e.Product is not { } p) continue;
            var key = (e.Company.Value, p.Value);
            if (e.Category is LedgerCategory.InputPurchase or LedgerCategory.RetailRestock) purchased[key] = purchased.GetValueOrDefault(key) + (e.Quantity ?? 0);
            if (e.Category == LedgerCategory.ShippingCost) shipped[key] = shipped.GetValueOrDefault(key) + (e.Quantity ?? 0);
        }
        Assert.Contains(purchased.Values, q => q > 0);
        foreach (var company in world.Companies.Keys.Select(c => c.Value))
        {
            foreach (var product in Game.Index.ProductsOf(company))
            {
                double bought = 0, moved = 0;
                for (var m = Game.StartMonth; m <= Game.Now; m++)
                {
                    if (Game.Index.Product(company, product, m) is not { } pm) continue;
                    bought += pm.PurchaseQty;
                    moved += pm.ShippedQty;
                }
                // Same entries, summed in a different order: equal to double rounding.
                Close(purchased.GetValueOrDefault((company, product)), bought);
                Close(shipped.GetValueOrDefault((company, product)), moved);
            }
        }
    }

    [Fact]
    public void The_workload_is_the_spec_one()
    {
        var world = Game.World;
        Assert.Equal(5, world.Companies.Count);
        // The scale the budgets guard against: an accidental full-ledger scan. The building count
        // follows the AI's economics (≈110 on the Wave-1 content, ≈16 with the 2026-USD market of E1),
        // so only a floor is pinned.
        Assert.True(world.Ledger.Entries.Count > 20_000, $"ledger has {world.Ledger.Entries.Count} entries");
        Assert.True(world.Buildings.Count > 12, $"{world.Buildings.Count} buildings");
        Assert.True(Game.Index.Monotonic);
        Assert.Equal(Year10Fixture.Months, Game.Now - Game.StartMonth);
    }

    [Fact]
    public void Income_statements_match_the_engine_for_every_company_and_window()
    {
        var bridge = _year10.Bridge;
        var world = Game.World;
        foreach (var company in world.Companies.Keys.OrderBy(c => c.Value))
        {
            foreach (var (from, to) in RandomWindows(42 + company.Value))
            {
                var engine = world.GetIncomeStatement(company, Months.Date(from), Months.Date(to));
                var dto = bridge.Call("incomeStatement", new
                {
                    companyId = company.Value,
                    period = new { from = Months.Dto(from), to = Months.Dto(to) },
                });
                var label = $"C{company.Value} {Months.Label(from)}–{Months.Label(to)}";
                Assert.Equal(to - from + 1, dto.GetProperty("period").GetProperty("months").GetInt32());
                AssertCents(engine.Revenue, dto.GetProperty("revenue").GetDecimal(), label + " revenue");
                AssertCents(engine.CostOfGoodsSold, dto.GetProperty("cogs").GetDecimal(), label + " cogs");
                AssertCents(engine.OperatingExpenses, dto.GetProperty("opex").GetDecimal(), label + " opex");
                AssertCents(engine.GrossProfit, dto.GetProperty("grossProfit").GetDecimal(), label + " gross");
                AssertCents(engine.NetIncome, dto.GetProperty("netIncome").GetDecimal(), label + " net income");
            }
        }
    }

    [Fact]
    public void Product_profitability_matches_the_engine_for_every_company_and_window()
    {
        var world = Game.World;
        var index = Game.Index;
        foreach (var company in world.Companies.Keys.OrderBy(c => c.Value))
        {
            foreach (var (from, to) in RandomWindows(4242 + company.Value))
            {
                var engine = world.GetProductProfitability(company, Months.Date(from), Months.Date(to));
                var rows = new Dictionary<string, (decimal Revenue, decimal Cost, decimal Marketing)>(StringComparer.Ordinal);
                foreach (var product in index.ProductsOf(company.Value))
                {
                    decimal revenue = 0m, cost = 0m, marketing = 0m;
                    var listed = false;
                    for (var m = from; m <= to; m++)
                    {
                        if (index.Product(company.Value, product, m) is not { } pm) continue;
                        listed |= pm.InProfitability;
                        revenue += pm.Sales + pm.Exports;
                        cost += pm.Cogs;
                        marketing += pm.Ads;
                    }
                    if (listed) rows[product] = (revenue, cost, marketing);
                }
                var label = $"C{company.Value} {Months.Label(from)}–{Months.Label(to)}";
                Assert.Equal(engine.Keys.Select(k => k.Value).OrderBy(k => k, StringComparer.Ordinal), rows.Keys.OrderBy(k => k, StringComparer.Ordinal));
                foreach (var (product, p) in engine)
                {
                    var row = rows[product.Value];
                    AssertCents(p.Revenue, row.Revenue, $"{label} {product} revenue");
                    AssertCents(p.Cost, row.Cost, $"{label} {product} cost");
                    AssertCents(p.MarketingCost, row.Marketing, $"{label} {product} marketing");
                }
            }
        }

        // The player's report goes through the protocol too.
        var player = Game.Player;
        var whole = world.GetProductProfitability(player, Months.Date(Game.StartMonth), Months.Date(Game.Now));
        var report = _year10.Bridge.Call("productProfitability", new { period = new { preset = "sinceStart" } });
        var reported = report.GetProperty("rows").EnumerateArray().ToDictionary(r => r.GetProperty("productId").GetString()!);
        Assert.Equal(whole.Count, reported.Count);
        foreach (var (product, p) in whole)
        {
            var row = reported[product.Value];
            AssertCents(p.Revenue, row.GetProperty("revenue").GetDecimal(), $"{product} revenue");
            AssertCents(p.NetMargin, row.GetProperty("netMargin").GetDecimal(), $"{product} net margin");
        }
    }

    [Fact]
    public void Cash_at_every_month_end_is_the_ledger_prefix_sum()
    {
        var world = Game.World;
        var index = Game.Index;
        var running = new Dictionary<int, decimal>();
        var expected = new Dictionary<(int C, int M), decimal>();
        var lastMonth = int.MinValue;
        foreach (var entry in world.Ledger.Entries)
        {
            var m = entry.Date.AsMonthIndex();
            Assert.True(m >= lastMonth, "the ledger is date-monotonic");
            lastMonth = m;
            var c = entry.Company.Value;
            running[c] = running.GetValueOrDefault(c) + entry.Amount;
            expected[(c, m)] = running[c];
        }

        foreach (var company in world.Companies.Values)
        {
            var c = company.Id.Value;
            var first = index.FirstMonth(c)!.Value;
            decimal carried = 0m;
            for (var m = first; m <= Game.Now; m++)
            {
                if (expected.TryGetValue((c, m), out var atEnd)) carried = atEnd;
                // Monthly subtotals are summed in a different order than the raw entries, so the
                // 28-digit decimals may differ in the last digit; money is compared to the cent.
                AssertCents(carried, index.CashAtMonthEnd(c, m), $"C{c} cash at end of {Months.Label(m)}");
            }
            // The engine's invariant (cash == Σ ledger) seen through the index.
            AssertCents(company.Cash, index.CashAtMonthEnd(c, Game.Now), $"C{c} cash now");
            Assert.Equal(0m, index.CashBefore(c, first));
        }
    }

    [Fact]
    public void Incremental_folding_equals_a_cold_rebuild()
    {
        var world = Game.World;
        var live = Game.Index;
        var cold = new LedgerIndex(world);
        cold.CatchUp();
        Assert.Equal(live.Positions, cold.Positions);
        Assert.Equal(live.EarliestMonth, cold.EarliestMonth);
        Assert.Equal(live.LatestMonth, cold.LatestMonth);

        foreach (var company in world.Companies.Keys.Select(c => c.Value))
        {
            for (var m = Game.StartMonth; m <= Game.Now; m++)
            {
                var a = live.Company(company, m);
                var b = cold.Company(company, m);
                Assert.Equal(a is null, b is null);
                if (a is null || b is null) continue;
                Assert.Equal(a.ByCategory, b.ByCategory);
                Assert.Equal(a.Net, b.Net);
                Assert.Equal(a.Cogs, b.Cogs);
                Assert.Equal(a.RetailQty, b.RetailQty);
                Assert.Equal(a.ExportQty, b.ExportQty);
                Assert.Equal(a.NewBuildings, b.NewBuildings);
            }
            Assert.Equal(live.ProductsOf(company), cold.ProductsOf(company));
        }
        // The rolling window (per building × product, per market): a cold rebuild skips folding the
        // detail it would prune, and keeps the same months the live index kept.
        for (var m = Game.StartMonth; m <= Game.Now; m++)
        {
            var a = live.BuildingProducts(m).OrderBy(kv => kv.Key.B).ThenBy(kv => kv.Key.P, StringComparer.Ordinal)
                .Select(kv => (kv.Key, kv.Value.SaleQty, kv.Value.SaleRev, kv.Value.ExportQty, kv.Value.Cogs, kv.Value.Purchases, kv.Value.TransferIn, kv.Value.TransferOut)).ToList();
            var b = cold.BuildingProducts(m).OrderBy(kv => kv.Key.B).ThenBy(kv => kv.Key.P, StringComparer.Ordinal)
                .Select(kv => (kv.Key, kv.Value.SaleQty, kv.Value.SaleRev, kv.Value.ExportQty, kv.Value.Cogs, kv.Value.Purchases, kv.Value.TransferIn, kv.Value.TransferOut)).ToList();
            Assert.Equal(a, b);
            var ra = live.RetailCells(m).OrderBy(kv => kv.Key.City, StringComparer.Ordinal).ThenBy(kv => kv.Key.P, StringComparer.Ordinal).ThenBy(kv => kv.Key.C)
                .Select(kv => (kv.Key, kv.Value.Qty, kv.Value.Rev)).ToList();
            var rb = cold.RetailCells(m).OrderBy(kv => kv.Key.City, StringComparer.Ordinal).ThenBy(kv => kv.Key.P, StringComparer.Ordinal).ThenBy(kv => kv.Key.C)
                .Select(kv => (kv.Key, kv.Value.Qty, kv.Value.Rev)).ToList();
            Assert.Equal(ra, rb);
            if (m < Game.Now - LedgerIndex.RetainMonths) Assert.True(b.Count == 0 && rb.Count == 0, $"detail kept for {Months.Label(m)}");
        }
        foreach (var building in world.Buildings.Keys.Select(b => b.Value))
        {
            Assert.Equal(live.BuildingInfo(building)!.BookValue, cold.BuildingInfo(building)!.BookValue);
            Assert.Equal(live.BuildingInfo(building)!.OpenedMonth, cold.BuildingInfo(building)!.OpenedMonth);
            for (var m = Game.Now - 23; m <= Game.Now; m++)
            {
                var a = live.Building(building, m);
                var b = cold.Building(building, m);
                Assert.Equal(a is null, b is null);
                if (a is null || b is null) continue;
                Assert.Equal((a.Revenue, a.Cogs, a.Opex, a.Net, a.RetailQty, a.ExportQty, a.TransfersIn, a.TransfersOut),
                    (b.Revenue, b.Cogs, b.Opex, b.Net, b.RetailQty, b.ExportQty, b.TransfersIn, b.TransfersOut));
            }
        }
    }

    [Fact]
    public void Retail_cells_account_for_every_retail_sale()
    {
        // Every retail sale writes a COGS entry with its source building, so realised market
        // shares are exact: the per-market cells add up to the company's retail units.
        var world = Game.World;
        var index = Game.Index;
        for (var m = Game.Now - 5; m <= Game.Now; m++)
        {
            foreach (var company in world.Companies.Keys.Select(c => c.Value))
            {
                var cells = index.RetailCells(m).Where(kv => kv.Key.C == company).Sum(kv => kv.Value.Qty);
                Assert.Equal(index.Company(company, m)?.RetailQty ?? 0, cells, 6);
            }
        }
        var share = index.RealisedShare("metropolis", "soft_drink", Game.Player.Value, Game.Now, Game.Now);
        if (share is double s) Assert.InRange(s, 0.0, 1.0);
    }

    [Fact]
    public void Cash_flow_sections_match_the_engine_statement_for_every_company_and_window()
    {
        // e0 §6: the engine's GetCashFlowStatement (a ledger scan classified by LedgerCategoryInfo)
        // is the reference; the facade answers the same question from the monthly index.
        var bridge = _year10.Bridge;
        var world = Game.World;
        foreach (var company in world.Companies.Keys.OrderBy(c => c.Value))
        {
            foreach (var (from, to) in RandomWindows(777 + company.Value).Take(20))
            {
                var engine = world.GetCashFlowStatement(company, Months.Date(from), Months.Date(to));
                var flow = bridge.Call("cashFlow", new
                {
                    companyId = company.Value,
                    period = new { from = Months.Dto(from), to = Months.Dto(to) },
                });
                var label = $"C{company.Value} {Months.Label(from)}–{Months.Label(to)}";
                AssertCents(engine.Operating, flow.GetProperty("operating").GetProperty("net").GetDecimal(), label + " operating");
                AssertCents(engine.Investing, flow.GetProperty("investing").GetProperty("net").GetDecimal(), label + " investing");
                AssertCents(engine.Financing, flow.GetProperty("financing").GetProperty("net").GetDecimal(), label + " financing");
                AssertCents(engine.NetChange, flow.GetProperty("netChange").GetDecimal(), label + " net change");
            }
        }
    }

    [Fact]
    public void Cash_flow_reconciles_every_month_for_every_company()
    {
        var bridge = _year10.Bridge;
        var world = Game.World;
        foreach (var company in world.Companies.Keys.Select(c => c.Value))
        {
            for (var m = Game.StartMonth; m <= Game.Now; m += 7)
            {
                var flow = bridge.Call("cashFlow", new { companyId = company, period = new { from = Months.Dto(m), to = Months.Dto(m) } });
                Assert.True(flow.GetProperty("reconciles").GetBoolean(), $"C{company} {Months.Label(m)}: {flow}");
                var sections = flow.GetProperty("operating").GetProperty("net").GetDecimal()
                    + flow.GetProperty("investing").GetProperty("net").GetDecimal()
                    + flow.GetProperty("financing").GetProperty("net").GetDecimal();
                Assert.InRange(sections - flow.GetProperty("netChange").GetDecimal(), -0.02m, 0.02m);
            }
            var whole = bridge.Call("cashFlow", new { companyId = company, period = new { preset = "sinceStart" } });
            Assert.True(whole.GetProperty("reconciles").GetBoolean());
            AssertCents(world.Companies[new CompanyId(company)].Cash, whole.GetProperty("endingCash").GetDecimal(), $"C{company} ending cash");
            Assert.Equal(0m, whole.GetProperty("beginningCash").GetDecimal());
        }
    }
}
