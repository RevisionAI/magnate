using System;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Economics;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>Every ledger category has a cash-flow section, a line and a P&amp;L role (bridge-spec §4.6.3, econ-audit §4.15).</summary>
public class LedgerCategoryMappingTests
{
    [Fact]
    public void Every_engine_category_is_classified()
    {
        var unmapped = Enum.GetValues<LedgerCategory>().Where(c => !LedgerCategories.IsMapped(c)).ToList();
        Assert.True(unmapped.Count == 0, "map these in LedgerCategories: " + string.Join(", ", unmapped));
    }

    [Theory]
    [InlineData(LedgerCategory.ProductSale, "Operating", "productSales", "Revenue")]
    [InlineData(LedgerCategory.ExportSale, "Operating", "exportSales", "Revenue")]
    [InlineData(LedgerCategory.PatentRoyaltyIncome, "Operating", "royaltyIncome", "Revenue")]
    [InlineData(LedgerCategory.OperatingCost, "Operating", "operatingCosts", "OperatingExpense")]
    [InlineData(LedgerCategory.AdvertisingCost, "Operating", "advertising", "OperatingExpense")]
    [InlineData(LedgerCategory.PatentRoyaltyExpense, "Operating", "royaltyExpense", "OperatingExpense")]
    [InlineData(LedgerCategory.InputPurchase, "Operating", "inputPurchases", "None")]
    [InlineData(LedgerCategory.RetailRestock, "Operating", "retailRestock", "None")]
    [InlineData(LedgerCategory.ShippingCost, "Operating", "shipping", "None")]
    [InlineData(LedgerCategory.ConstructionCost, "Investing", "construction", "None")]
    [InlineData(LedgerCategory.UpgradeCost, "Investing", "upgrades", "None")]
    [InlineData(LedgerCategory.StartingCapital, "Financing", "equityInjections", "None")]
    public void Categories_map_to_the_spec_lines(LedgerCategory category, string section, string line, string role)
    {
        var ordinal = (int)category;
        Assert.Equal(section, LedgerCategories.SectionOf(ordinal).ToString());
        Assert.Equal(line, LedgerCategories.LineOf(ordinal));
        Assert.Equal(role, LedgerCategories.RoleOf(ordinal).ToString());
    }

    [Fact]
    public void Protocol_ids_are_camel_case_and_parse_back()
    {
        Assert.Equal("productSale", LedgerCategories.Id(LedgerCategory.ProductSale));
        Assert.True(LedgerCategories.TryParse("upgradeCost", out var c));
        Assert.Equal(LedgerCategory.UpgradeCost, c);
        Assert.True(LedgerCategories.TryParse("RetailRestock", out c));
        Assert.False(LedgerCategories.TryParse("bribes", out _));
        Assert.False(LedgerCategories.TryParse("", out _));
    }
}

/// <summary>Finance reports (GameSession.Finance.cs, bridge-spec §5.8, §4.6.2–§4.6.3, §5.10 monthly report).</summary>
public class FinanceTests
{
    /// <summary>A small vertically integrated game: a farm feeding a mill that exports, a store, an ad campaign.</summary>
    private static (Bridge Bridge, int Farm, int Mill, int Store) Played(int months = 4)
    {
        var bridge = Bridge.Custom(seed: 11);
        var farm = bridge.Build("small_farm", "riverside", new { productId = "wheat" });
        var mill = bridge.Build("factory_small", "riverside", new { productId = "flour" });
        var store = bridge.Build("supermarket", "riverside", new { productId = "bread", price = 3.10, restockTarget = 150_000 });
        // E1 (D7): auto-export is off on new buildings; this mill exports its surplus by choice.
        bridge.Call("setAutoExport", new { buildingId = mill, enabled = true });
        bridge.Call("setAdCampaign", new { productId = "bread", cityId = "riverside", channel = "radio", monthlyBudget = 20_000 });
        bridge.Advance(months);
        return (bridge, farm, mill, store);
    }

    private static DateDto Date(JsonElement e) => JsonSerializer.Deserialize<DateDto>(e.GetRawText(), Bridge.Json)!;

    /// <summary><see cref="Played"/>'s construction capex, from content.</summary>
    private static decimal Capex() => Bridge.Cost("small_farm") + Bridge.Cost("factory_small") + Bridge.Cost("supermarket");

    /// <summary>
    /// <see cref="Played"/>'s equipment capex (E1, Realistic): the wheat slot's machinery and the flour
    /// line, paid the first month each runs and capitalised into PP&amp;E.
    /// </summary>
    private static decimal Equipment()
        => TestContent.Catalog.Products[new Magnate.Engine.Domain.ProductId("wheat")].Extraction!.EquipmentCapex
            + TestContent.Catalog.Products[new Magnate.Engine.Domain.ProductId("flour")].Recipe!.LineCapex;

    [Fact]
    public void Period_presets_resolve_server_side_and_clamp_to_the_game()
    {
        var (bridge, _, _, _) = Played(months: 14); // Jan 2026 → Mar 2027
        DateDto From(object period) => Date(bridge.Call("incomeStatement", new { period }).GetProperty("period").GetProperty("from"));
        JsonElement Period(object period) => bridge.Call("incomeStatement", new { period }).GetProperty("period");

        Assert.Equal(new DateDto(2027, 3), From(new { preset = "thisMonth" }));
        Assert.Equal(new DateDto(2027, 2), From(new { preset = "lastMonth" }));
        Assert.Equal(new DateDto(2027, 1), From(new { preset = "ytd" }));
        Assert.Equal(new DateDto(2026, 4), From(new { preset = "last12" }));
        Assert.Equal(new DateDto(2026, 1), From(new { preset = "sinceStart" }));
        Assert.Equal(15, Period(new { preset = "allTime" }).GetProperty("months").GetInt32());
        // Custom ranges are clamped to [start, now].
        var custom = Period(new { from = new { year = 2020, month = 1 }, to = new { year = 2030, month = 1 } });
        Assert.Equal("custom", custom.GetProperty("preset").GetString());
        Assert.Equal(new DateDto(2026, 1), Date(custom.GetProperty("from")));
        Assert.Equal(new DateDto(2027, 3), Date(custom.GetProperty("to")));
        // The default report period is this month.
        Assert.Equal("thisMonth", bridge.Call("incomeStatement", new { }).GetProperty("period").GetProperty("preset").GetString());

        var backwards = bridge.Fail("incomeStatement", new { period = new { from = new { year = 2027, month = 2 }, to = new { year = 2026, month = 5 } } });
        Assert.Equal(BridgeErrorCodes.InvalidPeriod, backwards.Code);
        Assert.Equal("period", backwards.Field);
        var preset = bridge.Fail("cashFlow", new { period = new { preset = "fortnight" } });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, preset.Code);
        Assert.Equal("period.preset", preset.Field);
        Assert.Equal("period.from", bridge.Fail("incomeStatement", new { period = new { from = new { year = 2026, month = 13 } } }).Field);

        // Early in a game, lastMonth clamps to the start month instead of reaching before it.
        var fresh = Bridge.Custom();
        Assert.Equal(new DateDto(2026, 1), Date(fresh.Call("incomeStatement", new { period = new { preset = "lastMonth" } }).GetProperty("period").GetProperty("from")));
    }

    [Fact]
    public void Income_statement_lines_add_up_and_come_by_month()
    {
        var (bridge, _, _, _) = Played();
        var s = bridge.Call("incomeStatement", new { period = new { preset = "sinceStart" }, byMonth = true });
        decimal D(string name) => s.GetProperty(name).GetDecimal();
        // Lines are rounded from exact sums independently, so totals may differ from their parts by a cent.
        decimal Opt(string name) => s.TryGetProperty(name, out var v) ? v.GetDecimal() : 0m;
        Assert.InRange(D("revenue") - (D("productSales") + D("exportSales") + D("royaltyIncome")), -0.02m, 0.02m);
        // Realistic rules: opex includes straight-line depreciation (econ-audit §4.8, §4.15).
        Assert.True(D("depreciation") > 0m);
        Assert.InRange(D("opex") - (D("operatingCosts") + D("advertising") + D("royaltyExpense") + D("depreciation")), -0.02m, 0.02m);
        Assert.InRange(D("grossProfit") - (D("revenue") - D("cogs")), -0.01m, 0.01m);
        Assert.InRange(D("netIncome") - (D("grossProfit") - D("opex") - Opt("interestExpense") + Opt("otherIncome") - Opt("incomeTax")), -0.02m, 0.02m);
        // The bridge's statement is the engine's (one definition of net income).
        var engine = bridge.World.GetIncomeStatement(bridge.Session.PlayerId, new Magnate.Engine.Simulation.GameDate(2026, 1), bridge.World.Clock.Now);
        Assert.InRange(D("netIncome") - engine.NetIncome, -0.02m, 0.02m);
        Assert.InRange(D("depreciation") - engine.Depreciation, -0.02m, 0.02m);
        Assert.True(D("exportSales") > 0);
        Assert.True(D("advertising") == 80_000m);
        Assert.InRange(s.GetProperty("grossMargin").GetDouble(), -1, 1);

        var months = s.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(5, months.Count);
        Assert.Equal(0m, months[0].GetProperty("revenue").GetDecimal()); // construction month: no tick yet
        Assert.InRange(months.Sum(m => m.GetProperty("netIncome").GetDecimal()) - D("netIncome"), -0.05m, 0.05m);
        Assert.False(s.TryGetProperty("interestExpense", out _)); // no debt, no interest

        var empty = Bridge.Custom().Call("incomeStatement", new { });
        Assert.False(empty.TryGetProperty("grossMargin", out _)); // no revenue → no margin, never NaN
        Assert.False(empty.TryGetProperty("months", out _));
    }

    [Fact]
    public void Rival_statements_are_public_but_detailed_reports_are_not()
    {
        var bridge = Bridge.Game("tutorial", seed: 5);
        bridge.Advance(3);
        Assert.Equal(2, bridge.Call("incomeStatement", new { companyId = 2 }).GetProperty("companyId").GetInt32());
        Assert.Equal(2, bridge.Call("balanceSheet", new { companyId = 2 }).GetProperty("companyId").GetInt32());
        Assert.Equal(2, bridge.Call("cashFlow", new { companyId = 2 }).GetProperty("companyId").GetInt32());
        Assert.Equal(BridgeErrorCodes.NotOwner, bridge.Fail("productProfitability", new { companyId = 2 }).Code);
        Assert.Equal(BridgeErrorCodes.NotOwner, bridge.Fail("exports", new { companyId = 2 }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("incomeStatement", new { companyId = 77 }).Code);
    }

    [Fact]
    public void Balance_sheet_closes_and_drills_down()
    {
        var (bridge, farm, mill, store) = Played();
        var sheet = bridge.Call("balanceSheet", new { drilldown = true });
        decimal D(string name) => sheet.GetProperty(name).GetDecimal();
        Assert.True(sheet.GetProperty("booksClose").GetBoolean());
        Assert.InRange(D("drift"), -0.01m, 0.01m);
        Assert.InRange(D("totalAssets") - (D("cash") + D("inventoryValue") + D("buildingValue") + D("landValue") + D("cip")), -0.02m, 0.02m);
        Assert.Equal(D("totalAssets") - D("liabilities"), D("equity"));
        Assert.Equal(D("termLoans") + D("revolver"), D("liabilities"));
        Assert.Equal(50_000_000m, D("startingCapital"));
        Assert.InRange(D("equity") - (D("startingCapital") + D("retainedEarnings")), -0.02m, 0.02m);
        // PP&E at cost less straight-line depreciation (econ-audit §4.8).
        Assert.Equal(Capex() + Equipment(), D("grossPpe"));
        Assert.True(D("accumulatedDepreciation") > 0m);
        Assert.Equal(D("grossPpe") - D("accumulatedDepreciation"), D("buildingValue"));
        Assert.Equal(D("buildingValue"), D("engineBuildingValue"));
        Assert.Equal(Math.Round(bridge.World.GetBalanceSheet(bridge.Session.PlayerId).TotalAssets, 2), D("totalAssets")); // money is serialised to cents

        var buildings = sheet.GetProperty("buildings").EnumerateArray().Select(b => b.GetProperty("buildingId").GetInt32()).ToList();
        Assert.Equal(new[] { farm, mill, store }, buildings);
        var stock = sheet.GetProperty("inventoryByBuilding").EnumerateArray().ToList();
        Assert.Equal(D("inventoryValue"), stock.Sum(b => b.GetProperty("total").GetDecimal()), 1);
        Assert.False(bridge.Call("balanceSheet", new { }).TryGetProperty("buildings", out _));
    }

    [Fact]
    public void Cash_flow_maps_every_category_and_reconciles()
    {
        var (bridge, _, _, _) = Played();
        var flow = bridge.Call("cashFlow", new { period = new { preset = "sinceStart" } });
        Assert.True(flow.GetProperty("reconciles").GetBoolean());
        Assert.Equal(0m, flow.GetProperty("beginningCash").GetDecimal());
        Assert.Equal(bridge.Cash(), flow.GetProperty("endingCash").GetDecimal());

        decimal Line(string section, string line)
            => flow.GetProperty(section).GetProperty("lines").EnumerateArray()
                .Where(l => l.GetProperty("category").GetString() == line).Sum(l => l.GetProperty("amount").GetDecimal());
        Assert.Equal(50_000_000m, Line("financing", "equityInjections"));
        Assert.Equal(-Capex(), Line("investing", "construction"));
        Assert.Equal(-Equipment(), Line("investing", "equipment"));
        Assert.Equal(-80_000m, Line("operating", "advertising"));
        Assert.True(Line("operating", "exportSales") > 0);
        Assert.True(Line("operating", "retailRestock") < 0);
        foreach (var section in new[] { "operating", "investing", "financing" })
        {
            var lines = flow.GetProperty(section).GetProperty("lines").EnumerateArray().Sum(l => l.GetProperty("amount").GetDecimal());
            Assert.InRange(lines - flow.GetProperty(section).GetProperty("net").GetDecimal(), -0.05m, 0.05m);
        }

        // A single month: beginning cash is the previous month end.
        var month = bridge.Call("cashFlow", new { period = new { preset = "thisMonth" } });
        var previous = bridge.Call("cashFlow", new { period = new { preset = "lastMonth" } });
        Assert.Equal(previous.GetProperty("endingCash").GetDecimal(), month.GetProperty("beginningCash").GetDecimal());
        Assert.True(month.GetProperty("reconciles").GetBoolean());
    }

    [Fact]
    public void Product_profitability_and_exports_use_exact_units()
    {
        var (bridge, _, mill, _) = Played(months: 2);
        var rows = bridge.Call("productProfitability", new { period = new { preset = "sinceStart" } }).GetProperty("rows").EnumerateArray()
            .ToDictionary(r => r.GetProperty("productId").GetString()!);
        Assert.Contains("bread", rows.Keys);
        Assert.Contains("flour", rows.Keys);
        var bread = rows["bread"];
        Assert.Equal(40_000m, bread.GetProperty("marketing").GetDecimal());
        Assert.InRange(bread.GetProperty("netMargin").GetDecimal() - (bread.GetProperty("grossMargin").GetDecimal() - 40_000m), -0.01m, 0.01m);
        // Units are the ledger's per-sale quantities (E11), not revenue ÷ price. Demand with incumbents
        // (E1) decides how much sells, so the expectation is what the engine booked.
        double Units(LedgerCategory category, string product) => bridge.World.Ledger.Entries
            .Where(e => e.Company == bridge.Session.PlayerId && e.Category == category && e.Product?.Value == product).Sum(e => e.Quantity ?? 0);
        decimal Revenue(LedgerCategory category, string product) => bridge.World.Ledger.Entries
            .Where(e => e.Company == bridge.Session.PlayerId && e.Category == category && e.Product?.Value == product).Sum(e => e.Amount);
        Assert.True(Units(LedgerCategory.ProductSale, "bread") > 0);
        Assert.Equal(Units(LedgerCategory.ProductSale, "bread"), bread.GetProperty("unitsSold").GetDouble());

        var exports = bridge.Call("exports", new { period = new { preset = "sinceStart" } });
        var flour = exports.GetProperty("byProduct").EnumerateArray().Single(p => p.GetProperty("productId").GetString() == "flour");
        // The mill's surplus flour, sold at the depth-adjusted world price (E1).
        var flourUnits = Units(LedgerCategory.ExportSale, "flour");
        var flourRevenue = Revenue(LedgerCategory.ExportSale, "flour");
        Assert.True(flourUnits > 0);
        Assert.Equal(flourUnits, flour.GetProperty("units").GetDouble());
        Assert.Equal(Math.Round(flourRevenue, 2), flour.GetProperty("revenue").GetDecimal());
        Assert.InRange(flour.GetProperty("avgPrice").GetDecimal() - flourRevenue / (decimal)flourUnits, -0.0001m, 0.0001m);
        var byBuilding = exports.GetProperty("byBuilding").EnumerateArray().ToList();
        Assert.Equal(mill, byBuilding[0].GetProperty("buildingId").GetInt32());
        Assert.InRange(exports.GetProperty("totalRevenue").GetDecimal() - exports.GetProperty("byProduct").EnumerateArray().Sum(p => p.GetProperty("revenue").GetDecimal()), -0.02m, 0.02m);
    }

    [Fact]
    public void Ledger_pages_newest_first_with_filters()
    {
        var (bridge, _, mill, store) = Played(months: 2);
        var entries = bridge.World.Ledger.Entries;
        var page = bridge.Call("ledger", new { limit = 3 });
        var rows = page.GetProperty("rows").EnumerateArray().ToList();
        Assert.Equal(3, rows.Count);
        var player = entries.Select((e, i) => (e, i)).Where(x => x.e.Company.Value == 1).ToList();
        Assert.Equal(player.Count, page.GetProperty("total").GetInt32());
        Assert.Equal(player[^1].i, rows[0].GetProperty("seq").GetInt64()); // newest first; seq = index in the ledger
        Assert.True(rows[0].GetProperty("seq").GetInt64() > rows[1].GetProperty("seq").GetInt64());

        var second = bridge.Call("ledger", new { limit = 3, offset = 3 }).GetProperty("rows")[0];
        Assert.True(second.GetProperty("seq").GetInt64() < rows[2].GetProperty("seq").GetInt64());

        var sales = bridge.Call("ledger", new { categories = new[] { "productSale" } }).GetProperty("rows").EnumerateArray().ToList();
        Assert.Equal(2, sales.Count);
        Assert.All(sales, r => Assert.Equal("productSale", r.GetProperty("category").GetString()));
        Assert.All(sales, r => Assert.Equal(store, r.GetProperty("buildingId").GetInt32()));
        var millRows = bridge.Call("ledger", new { buildingId = mill }).GetProperty("rows").EnumerateArray().ToList();
        Assert.All(millRows, r => Assert.Equal(mill, r.GetProperty("buildingId").GetInt32()));
        Assert.Contains(millRows, r => r.GetProperty("category").GetString() == "constructionCost");
        var flour = bridge.Call("ledger", new { productId = "flour" }).GetProperty("rows").EnumerateArray().ToList();
        Assert.All(flour, r => Assert.Equal("flour", r.GetProperty("productId").GetString()));
        var thisMonth = bridge.Call("ledger", new { period = new { preset = "thisMonth" } }).GetProperty("rows").EnumerateArray().ToList();
        Assert.All(thisMonth, r => Assert.Equal(new DateDto(2026, 3), Date(r.GetProperty("date"))));

        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("ledger", new { categories = new[] { "bribes" } }).Code);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("ledger", new { productId = "gold" }).Code);
        Assert.Single(bridge.Call("ledger", new { limit = 0 }).GetProperty("rows").EnumerateArray()); // limit clamps to 1..500
    }

    [Fact]
    public void Explaining_net_income_accounts_for_every_dollar()
    {
        var (bridge, _, _, store) = Played(months: 3);
        bridge.Call("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 3.60 });
        bridge.Build("convenience_store", "riverside", new { productId = "bread", price = 3.4, restockTarget = 20_000 });
        bridge.Advance(1);
        var explain = bridge.Call("explainNetIncome", new { });
        Assert.Equal("lastMonth", explain.GetProperty("base").GetProperty("preset").GetString());
        Assert.Equal("thisMonth", explain.GetProperty("compare").GetProperty("preset").GetString());
        var delta = explain.GetProperty("compareNetIncome").GetDecimal() - explain.GetProperty("baseNetIncome").GetDecimal();
        var drivers = explain.GetProperty("drivers").EnumerateArray().ToList();
        Assert.InRange(drivers.Sum(d => d.GetProperty("amount").GetDecimal()) - delta, -0.05m, 0.05m);
        Assert.Contains(drivers, d => d.GetProperty("driver").GetString() == "price" && d.GetProperty("productId").GetString() == "bread");
        Assert.Contains(drivers, d => d.GetProperty("driver").GetString() == "opexNewBuildings");
        Assert.All(drivers, d => Assert.Contains(d.GetProperty("driver").GetString(),
            new[] { "volume", "price", "unitCost", "opexExisting", "opexNewBuildings", "advertising", "exports", "royalties",
                "depreciation", "interest", "tax", "other" }));

        var custom = bridge.Call("explainNetIncome", new { @base = new { preset = "thisMonth" }, compare = new { preset = "thisMonth" } });
        Assert.Equal(0, custom.GetProperty("drivers").GetArrayLength());
    }

    [Fact]
    public void Monthly_report_summarises_each_month()
    {
        var (bridge, farm, mill, store) = Played(months: 3);
        var months = bridge.Call("monthlyReport").GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(4, months.Count); // Jan (construction) .. Apr, clamped to the start
        var january = months[0];
        Assert.Equal(3, january.GetProperty("newBuildings").GetInt32());
        Assert.Contains(january.GetProperty("noteworthy").EnumerateArray(), n => n.GetProperty("category").GetString() == "constructionCost"
            && n.GetProperty("amount").GetDecimal() == -Bridge.Cost("factory_small"));
        var last = months[^1];
        Assert.Equal(bridge.Cash(), last.GetProperty("cumulativeCash").GetDecimal());
        Assert.InRange(months.Sum(m => m.GetProperty("netIncome").GetDecimal()) - last.GetProperty("cumulativeNetIncome").GetDecimal(), -0.05m, 0.05m);
        // Opex of the three buildings (Realistic: wages, utilities, maintenance, insurance, property tax) + ads.
        var now = bridge.Session.Game.Now;
        var opex = bridge.BookedOpex(farm, now) + bridge.BookedOpex(mill, now) + bridge.BookedOpex(store, now);
        Assert.Equal(Math.Round(opex + 20_000m, 2), last.GetProperty("expenses").GetDecimal());
        Assert.True(last.GetProperty("topBuildings").GetArrayLength() is > 0 and <= 3);
        Assert.Equal(1, last.GetProperty("adCampaigns").GetInt32());

        var one = bridge.Call("monthlyReport", new { from = new { year = 2026, month = 2 }, to = new { year = 2026, month = 2 } });
        Assert.Single(one.GetProperty("months").EnumerateArray());
        Assert.Equal(BridgeErrorCodes.InvalidPeriod, bridge.Fail("monthlyReport", new { from = new { year = 2026, month = 4 }, to = new { year = 2026, month = 2 } }).Code);
    }
}

/// <summary>Loans, credit and disposals (GameSession.Loans.cs, bridge-spec §8.4; econ-audit §4.8, §4.10, §4.14).</summary>
public class LoanTests
{
    private static string? Kind(JsonElement e) => e.GetProperty("kind").GetString();

    /// <summary>A store that has traded for a few months, so the company has collateral and a credit history.</summary>
    private static (Bridge Bridge, int Store) Trading(int months = 3)
    {
        var bridge = Bridge.Custom(seed: 3, playerCash: 20_000_000m);
        var store = bridge.Supermarket("soft_drink", 2.2m, 60_000);
        bridge.Advance(months);
        return (bridge, store);
    }

    [Fact]
    public void The_credit_profile_reports_rating_limits_pricing_and_ratios()
    {
        var (bridge, _) = Trading();
        var p = bridge.Call("creditProfile");
        Assert.Equal("NR", p.GetProperty("rating").GetString()); // unrated until seasoned (12 months)
        Assert.False(p.GetProperty("seasoned").GetBoolean());
        Assert.Contains(p.GetProperty("pricingRating").GetString(), new[] { "BBB", "BB" });
        Assert.True(p.GetProperty("creditLimit").GetDecimal() > 0m);
        // A new term loan is whole dollars of the capacity (E2 floors it); no debt yet, so all of it.
        Assert.Equal(Math.Floor(p.GetProperty("creditLimit").GetDecimal()), p.GetProperty("newLoanMax").GetDecimal());
        Assert.Equal(0m, p.GetProperty("outstanding").GetDecimal());
        Assert.Equal(0.0, p.GetProperty("debtToEquity").GetDouble());
        Assert.False(p.TryGetProperty("interestCoverage", out _)); // no interest yet
        Assert.Equal(0.04, p.GetProperty("policyRate").GetDouble());
        Assert.Equal(p.GetProperty("revolverRate").GetDouble(), p.GetProperty("interestRate").GetDouble());
        Assert.Equal("solvent", p.GetProperty("solvency").GetString());
        Assert.Equal(0.25, p.GetProperty("taxRate").GetDouble());
        Assert.Equal(12, p.GetProperty("minTermMonths").GetInt32());
        Assert.Equal(240, p.GetProperty("maxTermMonths").GetInt32());
        var review = p.GetProperty("nextReview");
        Assert.Equal(0, review.GetProperty("month").GetInt32() % 3); // quarterly reviews
        Assert.Equal(bridge.World.GetCorporateValue(bridge.Session.PlayerId), p.GetProperty("companyValue").GetDecimal());
    }

    [Fact]
    public void Offers_price_by_tenor_and_cap_at_the_credit_limit()
    {
        var (bridge, _) = Trading();
        var max = bridge.Call("creditProfile").GetProperty("newLoanMax").GetDecimal();
        Assert.True(max > 100_000m, $"credit limit {max}");
        var offers = bridge.Call("loanOffers", new { amount = 100_000 }).EnumerateArray().ToList();
        Assert.Equal(new[] { 12, 36, 60, 120, 240 }, offers.Select(o => o.GetProperty("termMonths").GetInt32()));
        Assert.All(offers, o => Assert.Equal(100_000m, o.GetProperty("amount").GetDecimal()));
        var rates = offers.Select(o => o.GetProperty("annualRate").GetDouble()).ToList();
        Assert.Equal(rates.OrderBy(r => r), rates); // longer money costs more (term premium)
        Assert.True(rates[0] > 0.04); // over the 4.00 % policy rate
        var oneYear = offers[0];
        Assert.InRange(oneYear.GetProperty("monthlyPayment").GetDecimal() * 12m - 100_000m - oneYear.GetProperty("totalInterest").GetDecimal(), -1m, 1m);
        Assert.Equal("12m-10000000", oneYear.GetProperty("offerId").GetString());
        // Without an amount the offers are for the most lenders will extend.
        Assert.All(bridge.Call("loanOffers").EnumerateArray(), o => Assert.Equal(max, o.GetProperty("amount").GetDecimal()));

        var capped = bridge.Call("loanOffers", new { amount = max * 10m }).EnumerateArray().First();
        Assert.Equal(max, capped.GetProperty("amount").GetDecimal());
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("loanOffers", new { amount = -5 }).Code);
    }

    [Fact]
    public void A_loan_flows_through_cash_the_books_and_the_events()
    {
        var (bridge, _) = Trading();
        var cash = bridge.Cash();
        const decimal amount = 250_000m;
        var offer = bridge.Call("loanOffers", new { amount }).EnumerateArray().Single(o => o.GetProperty("termMonths").GetInt32() == 36);
        var loan = bridge.Call("takeLoan", new { offerId = offer.GetProperty("offerId").GetString() });
        var taken = bridge.EnvelopeEvents().Single(e => Kind(e) == "loanTaken");
        Assert.Equal(amount, taken.GetProperty("amount").GetDecimal());
        Assert.Equal(amount, loan.GetProperty("principal").GetDecimal());
        Assert.Equal(amount, loan.GetProperty("outstanding").GetDecimal());
        Assert.Equal(36, loan.GetProperty("monthsRemaining").GetInt32());
        Assert.Equal(offer.GetProperty("annualRate").GetDouble(), loan.GetProperty("annualRate").GetDouble());
        Assert.False(loan.GetProperty("inDefault").GetBoolean());
        Assert.Equal(cash + amount, bridge.Cash());

        var sheet = bridge.Call("balanceSheet", new { });
        Assert.Equal(amount, sheet.GetProperty("termLoans").GetDecimal());
        Assert.Equal(amount, sheet.GetProperty("liabilities").GetDecimal());
        Assert.True(sheet.GetProperty("booksClose").GetBoolean());
        var line = sheet.GetProperty("liabilityLines").EnumerateArray().Single();
        Assert.Equal("loan", line.GetProperty("kind").GetString());
        Assert.Equal(amount, line.GetProperty("amount").GetDecimal());

        bridge.Advance(1); // first instalment: interest + principal
        var loans = bridge.Call("loans").EnumerateArray().ToList();
        var after = Assert.Single(loans);
        Assert.Equal(35, after.GetProperty("monthsRemaining").GetInt32());
        Assert.True(after.GetProperty("outstanding").GetDecimal() < amount);
        var income = bridge.Call("incomeStatement", new { });
        Assert.True(income.GetProperty("interestExpense").GetDecimal() > 0m);
        var flow = bridge.Call("cashFlow", new { period = new { preset = "sinceStart" } });
        Assert.True(flow.GetProperty("reconciles").GetBoolean());
        decimal Line(string section, string name) => flow.GetProperty(section).GetProperty("lines").EnumerateArray()
            .Where(l => l.GetProperty("category").GetString() == name).Sum(l => l.GetProperty("amount").GetDecimal());
        Assert.Equal(amount, Line("financing", "loanProceeds"));
        Assert.True(Line("financing", "loanRepayments") < 0m);
        Assert.True(Line("operating", "interestExpense") < 0m); // US GAAP: interest paid is operating

        var profile = bridge.Call("creditProfile");
        Assert.Equal(after.GetProperty("outstanding").GetDecimal(), profile.GetProperty("termDebt").GetDecimal());
        Assert.True(profile.GetProperty("nextPayment").GetDecimal() > 0m);
        Assert.Equal(after.GetProperty("annualRate").GetDouble(), profile.GetProperty("interestRate").GetDouble(), 6);
        Assert.True(profile.GetProperty("debtToEquity").GetDouble() > 0);

        // Early repayment in full.
        var id = after.GetProperty("loanId").GetInt32();
        var repaid = bridge.Call("repayLoan", new { loanId = id, amount = 10_000_000 });
        Assert.Contains(bridge.EnvelopeEvents(), e => Kind(e) == "loanRepaid");
        Assert.Equal(0m, repaid.GetProperty("outstanding").GetDecimal());
        Assert.Empty(bridge.Call("loans").EnumerateArray());
        Assert.Equal(0m, bridge.Call("balanceSheet", new { }).GetProperty("liabilities").GetDecimal());
    }

    [Fact]
    public void Loan_commands_validate_and_refuse_with_typed_errors()
    {
        var (bridge, _) = Trading();
        var max = bridge.Call("creditProfile").GetProperty("newLoanMax").GetDecimal();
        var revision = bridge.Revision;

        var tooMuch = bridge.Fail("takeLoan", new { amount = max + 1_000_000m, termMonths = 60 });
        Assert.Equal(BridgeErrorCodes.CreditLimitExceeded, tooMuch.Code);
        Assert.Equal("amount", tooMuch.Field);
        Assert.Equal(max, tooMuch.Details.GetProperty("available").GetDecimal());
        Assert.Equal(revision, tooMuch.Revision);

        var term = bridge.Fail("takeLoan", new { amount = 100_000, termMonths = 6 });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, term.Code);
        Assert.Equal("termMonths", term.Field);
        Assert.Equal(BridgeErrorCodes.BadRequest, bridge.Fail("takeLoan", new { amount = 100_000 }).Code);
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("takeLoan", new { offerId = "soon" }).Code);
        Assert.Equal(BridgeErrorCodes.LoanNotFound, bridge.Fail("repayLoan", new { loanId = 99, amount = 100 }).Code);

        var loan = bridge.Call("takeLoan", new { amount = 50_000, termMonths = 24 });
        var id = loan.GetProperty("loanId").GetInt32();
        var broke = bridge.Fail("repayLoan", new { loanId = id, amount = 0 });
        Assert.Equal(BridgeErrorCodes.InvalidArgument, broke.Code);
        Assert.False(bridge.Session.Faulted);
    }

    [Fact]
    public void Classic_rules_have_no_bank()
    {
        var session = TestContent.NewSession();
        var scenario = session.Scenarios["tutorial"];
        var (world, player) = Magnate.Engine.Scenarios.ScenarioRunner.Apply(session.Catalog, scenario, 1, Magnate.Engine.Rules.EconomyRules.Classic);
        session.Attach(world, player, scenario);
        var bridge = new Bridge(session);
        foreach (var (method, args, feature) in new (string, object, string)[]
        {
            ("creditProfile", new { }, "loans"),
            ("loanOffers", new { }, "loans"),
            ("loans", new { }, "loans"),
            ("takeLoan", new { amount = 1_000_000, termMonths = 24 }, "loans"),
            ("repayLoan", new { loanId = 1, amount = 100 }, "loans"),
            ("sellBuilding", new { buildingId = 1 }, "demolish"),
            ("demolishBuilding", new { buildingId = 1 }, "demolish"),
            ("previewDisposal", new { buildingId = 1 }, "demolish"),
        })
        {
            var error = bridge.Fail(method, args);
            Assert.Equal(BridgeErrorCodes.FeatureUnavailable, error.Code);
            Assert.Equal(feature, error.Detail("feature"));
        }
        // Classic reports keep their pre-finance shape.
        var sheet = bridge.Call("balanceSheet", new { });
        Assert.False(sheet.TryGetProperty("landValue", out _));
        Assert.False(sheet.TryGetProperty("liabilityLines", out _));
        Assert.False(bridge.Call("snapshot").GetProperty("player").TryGetProperty("creditRating", out _));
    }

    [Fact]
    public void Selling_a_building_books_the_disposal_and_frees_its_plot()
    {
        var (bridge, store) = Trading();
        var preview = bridge.Call("previewDisposal", new { buildingId = store });
        Assert.Equal("sale", preview.GetProperty("kind").GetString());
        var ppe = preview.GetProperty("ppe").GetDecimal();
        Assert.True(ppe > 0m && ppe < Bridge.Cost("supermarket")); // depreciated since construction
        Assert.InRange(preview.GetProperty("proceeds").GetDecimal() - preview.GetProperty("bookValue").GetDecimal()
            - preview.GetProperty("gainOrLoss").GetDecimal(), -0.01m, 0.01m);
        var demolition = bridge.Call("previewDisposal", new { buildingId = store, kind = "demolition" });
        Assert.True(demolition.GetProperty("proceeds").GetDecimal() < preview.GetProperty("proceeds").GetDecimal());
        Assert.Equal(BridgeErrorCodes.InvalidArgument, bridge.Fail("previewDisposal", new { buildingId = store, kind = "arson" }).Code);

        var placement = bridge.Call("building", new { buildingId = store }).GetProperty("placement");
        var revision = bridge.Call("cityView", new { cityId = "metropolis" }).GetProperty("revision").GetInt64();
        var cash = bridge.Cash();
        var sold = bridge.Call("sellBuilding", new { buildingId = store });
        Assert.Contains(bridge.EnvelopeEvents(), e => Kind(e) == "buildingDemolished" && e.GetProperty("buildingId").GetInt32() == store);
        Assert.Equal(preview.GetProperty("proceeds").GetDecimal(), sold.GetProperty("proceeds").GetDecimal());
        Assert.Equal(cash + sold.GetProperty("proceeds").GetDecimal(), bridge.Cash());
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("building", new { buildingId = store }).Code);
        var view = bridge.Call("cityView", new { cityId = "metropolis", since = revision });
        Assert.Contains(store, view.GetProperty("removedIds").EnumerateArray().Select(i => i.GetInt32()));

        // The gain or loss is below the operating line; the books still close.
        var income = bridge.Call("incomeStatement", new { });
        Assert.Equal(sold.GetProperty("gainOrLoss").GetDecimal(), income.TryGetProperty("otherIncome", out var other) ? other.GetDecimal() : 0m);
        Assert.True(bridge.Call("balanceSheet", new { }).GetProperty("booksClose").GetBoolean());

        // The plot is free again: a new building can go exactly there.
        var again = bridge.Build("supermarket", "metropolis", null, new
        {
            px = placement.GetProperty("px").GetInt32(),
            pz = placement.GetProperty("pz").GetInt32(),
            rotation = placement.GetProperty("rotation").GetInt32(),
        });
        Assert.NotEqual(store, again);
        Assert.Equal(BridgeErrorCodes.NotFound, bridge.Fail("sellBuilding", new { buildingId = store }).Code);
        Assert.Equal(BridgeErrorCodes.NotOwner, bridge.Fail("demolishBuilding", new { buildingId = RivalBuilding(bridge) }).Code);
    }

    private static int RivalBuilding(Bridge bridge)
    {
        var rival = bridge.World.Companies.Values.FirstOrDefault(c => c.Id != bridge.Session.PlayerId)
            ?? bridge.World.CreateCompany("Rival", 5_000_000m);
        return bridge.World.Construct(rival.Id, new Magnate.Engine.Domain.BuildingTypeId("convenience_store"), new Magnate.Engine.Domain.CityId("riverside")).Id.Value;
    }
}
