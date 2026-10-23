using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Finance reports (bridge-spec §5.8, §5.10 monthly report), served from the ledger
// index (O(months × keys), never a ledger scan — except the paged ledger and the
// month's noteworthy entries, which read one month's slice). The index also folds the
// accrual journal, so the non-cash lines (depreciation, disposal gains/losses,
// write-offs; econ-audit §4.15) come from it too; the balance sheet is the engine's
// (land, CIP, PP&E, loans, revolver).
public sealed partial class GameSession
{
    /// <summary>Accrual income statement over a period (rivals allowed — public-company reports).</summary>
    [BridgeMethod("incomeStatement")]
    public IncomeStatementDto IncomeStatement(CompanyPeriodArgs args)
    {
        var game = Game;
        var company = ReportCompany(game, args.CompanyId, allowRivals: true);
        var period = ResolvePeriod(game, args.Period, Periods.ThisMonth);
        var sums = new decimal[LedgerCategories.Count];
        decimal cogs = 0m, depreciation = 0m, otherGains = 0m;
        var months = args.ByMonth ? new List<IncomeMonthDto>(period.Months) : null;
        for (var m = period.From; m <= period.To; m++)
        {
            if (game.Index.Company(company, m) is not { } cm)
            {
                months?.Add(new IncomeMonthDto(Months.Dto(m), 0m, 0m, 0m, 0m));
                continue;
            }
            for (var i = 0; i < sums.Length; i++) sums[i] += cm.ByCategory[i];
            cogs += cm.Cogs + cm.WriteDowns;
            depreciation += cm.Depreciation;
            otherGains += cm.OtherGains;
            months?.Add(new IncomeMonthDto(Months.Dto(m), cm.Revenue, cm.Cogs + cm.WriteDowns, cm.Opex + cm.Depreciation, cm.NetIncome));
        }

        decimal Sum(PnlRole role)
        {
            decimal total = 0m;
            for (var i = 0; i < sums.Length; i++) if (LedgerCategories.RoleOf(i) == role) total += sums[i];
            return total;
        }
        var revenue = Sum(PnlRole.Revenue);
        var opex = -Sum(PnlRole.OperatingExpense) + depreciation;
        var interest = -Sum(PnlRole.InterestExpense);
        var interestIncome = Sum(PnlRole.InterestIncome);
        var otherIncome = interestIncome + otherGains;
        var tax = -Sum(PnlRole.IncomeTax);
        var gross = revenue - cogs;
        var net = gross - opex - interest + otherIncome - tax;
        return new IncomeStatementDto(
            period.ToDto(),
            company,
            revenue,
            sums[(int)LedgerCategory.ProductSale],
            sums[(int)LedgerCategory.ExportSale],
            sums[(int)LedgerCategory.PatentRoyaltyIncome],
            cogs,
            gross,
            opex,
            // Operating costs: every operating expense but advertising and royalties — Classic's
            // fixed opex, or Realistic's wages, utilities, maintenance, insurance, property tax,
            // retail variable costs and corporate overhead (E1), so the opex lines add up.
            -Sum(PnlRole.OperatingExpense) + sums[(int)LedgerCategory.AdvertisingCost] + sums[(int)LedgerCategory.PatentRoyaltyExpense],
            -sums[(int)LedgerCategory.AdvertisingCost],
            -sums[(int)LedgerCategory.PatentRoyaltyExpense],
            net,
            revenue == 0m ? null : (double)(gross / revenue),
            revenue == 0m ? null : (double)(net / revenue),
            months,
            Depreciation: depreciation != 0m ? depreciation : null,
            InterestExpense: interest != 0m ? interest : null,
            IncomeTax: tax != 0m ? tax : null,
            OtherIncome: otherIncome != 0m ? otherIncome : null);
    }

    /// <summary>
    /// Balance sheet at now (econ-audit §4.15), from the engine: PP&amp;E at net book value (construction
    /// and upgrades less depreciation), land at cost, construction in progress, inventory at cost;
    /// term loans and the revolver as liability lines; paid-in capital and retained earnings.
    /// <c>drift</c> cross-checks equity against paid-in capital plus every month's net income since
    /// the company was founded (ledger index + accrual journal) — zero when the books close.
    /// </summary>
    [BridgeMethod("balanceSheet")]
    public BalanceSheetDto BalanceSheet(BalanceSheetArgs args)
    {
        var game = Game;
        var world = game.World;
        var company = ReportCompany(game, args.CompanyId, allowRivals: true);
        var id = new CompanyId(company);
        var now = game.Now;
        var bs = world.GetBalanceSheet(id);
        var first = game.Index.FirstMonth(company) ?? now;
        var paidIn = bs.PaidInCapital;
        var earned = game.Index.NetIncome(company, first, now);
        var distributions = game.Index.CategorySum(company, LedgerCategory.DividendPaid, first, now)
            + game.Index.CategorySum(company, LedgerCategory.ShareBuyback, first, now);
        var drift = bs.Equity - (paidIn + earned + distributions);
        var finance = world.Rules.Finance.Enabled;

        List<BuildingValueDto>? buildings = null;
        List<BuildingInventoryDto>? inventories = null;
        if (args.Drilldown)
        {
            var owned = world.Buildings.Values.Where(b => b.Owner == id).OrderBy(b => b.Id.Value).ToList();
            buildings = owned.Select(b =>
            {
                var info = game.Index.BuildingInfo(b.Id.Value);
                var type = world.Catalog.BuildingType(b.TypeId);
                var upgrades = info?.UpgradeCost ?? 0m;
                var construction = b.CapitalizedCost - upgrades;
                return new BuildingValueDto(b.Id.Value, type.Name, b.City.Value, construction, upgrades, b.BookValue);
            }).ToList();
            inventories = owned
                .Select(b => (Building: b, Rows: InventoryRows(world, b)))
                .Where(x => x.Rows.Count > 0)
                .Select(x => new BuildingInventoryDto(x.Building.Id.Value, world.Catalog.BuildingType(x.Building.TypeId).Name,
                    x.Building.City.Value, x.Rows, x.Building.Inventory.TotalValue()))
                .ToList();
        }

        List<LiabilityLineDto>? liabilities = null;
        if (finance)
        {
            liabilities = new List<LiabilityLineDto>();
            foreach (var loan in world.GetLoans(id))
            {
                liabilities.Add(new LiabilityLineDto("loan",
                    $"Term loan #{loan.Id} · {loan.AnnualRate * 100m:0.00}% · {loan.MonthsRemaining} months left", loan.Outstanding));
            }
            if (bs.Revolver != 0m) liabilities.Add(new LiabilityLineDto("loan", "Revolving credit line", bs.Revolver));
        }

        return new BalanceSheetDto(
            Months.Dto(now),
            company,
            bs.Cash,
            bs.InventoryValue,
            bs.BuildingValue,
            bs.TotalAssets,
            bs.Liabilities,
            bs.Equity,
            paidIn,
            bs.RetainedEarnings,
            bs.BuildingValue,
            drift,
            Math.Abs(drift) < 0.01m,
            buildings,
            inventories,
            liabilities,
            LandValue: finance ? bs.Land : null,
            AccumulatedDepreciation: finance ? bs.AccumulatedDepreciation : null,
            Cip: finance ? bs.Cip : null,
            GrossPpe: finance ? bs.GrossPpe : null,
            TermLoans: finance ? bs.TermLoans : null,
            Revolver: finance ? bs.Revolver : null);
    }

    /// <summary>
    /// Cash-flow statement with an exhaustive category mapping; <c>netChange</c> is
    /// operating + investing + financing, and <c>reconciles</c> checks it against the
    /// ledger's cash at the period end and that every category was classified.
    /// </summary>
    [BridgeMethod("cashFlow")]
    public CashFlowDto CashFlow(CompanyPeriodArgs args)
    {
        var game = Game;
        var company = ReportCompany(game, args.CompanyId, allowRivals: true);
        var period = ResolvePeriod(game, args.Period, Periods.ThisMonth);
        var sums = new decimal[LedgerCategories.Count];
        for (var m = period.From; m <= period.To; m++)
        {
            if (game.Index.Company(company, m) is not { } cm) continue;
            for (var i = 0; i < sums.Length; i++) sums[i] += cm.ByCategory[i];
        }

        var allMapped = true;
        var lines = new Dictionary<CashSection, List<CashFlowLineDto>>
        {
            [CashSection.Operating] = new(),
            [CashSection.Investing] = new(),
            [CashSection.Financing] = new(),
        };
        foreach (var category in LedgerCategories.All)
        {
            var ordinal = (int)category;
            if (sums[ordinal] == 0m) continue;
            var section = LedgerCategories.SectionOf(ordinal);
            if (section == CashSection.Unmapped)
            {
                allMapped = false;
                section = CashSection.Operating;
            }
            var line = LedgerCategories.LineOf(ordinal);
            var list = lines[section];
            var existing = list.FindIndex(l => l.Category == line);
            if (existing >= 0) list[existing] = list[existing] with { Amount = list[existing].Amount + sums[ordinal] };
            else list.Add(new CashFlowLineDto(line, sums[ordinal]));
        }
        CashFlowSectionDto Section(CashSection s) => new(lines[s], lines[s].Sum(l => l.Amount));
        var operating = Section(CashSection.Operating);
        var investing = Section(CashSection.Investing);
        var financing = Section(CashSection.Financing);
        var beginning = game.Index.CashBefore(company, period.From);
        var net = operating.Net + investing.Net + financing.Net;
        var ending = beginning + net;
        var actual = period.To == game.Now
            ? game.World.Companies[new CompanyId(company)].Cash
            : game.Index.CashAtMonthEnd(company, period.To);
        return new CashFlowDto(period.ToDto(), company, beginning, operating, investing, financing, net, ending,
            allMapped && Math.Abs(ending - actual) < 0.005m);
    }

    /// <summary>Per-product P&amp;L (revenue, COGS, marketing, units) over a period. Player only.</summary>
    [BridgeMethod("productProfitability")]
    public ProductProfitabilityDto ProductProfitability(CompanyPeriodArgs args)
    {
        var game = Game;
        var company = ReportCompany(game, args.CompanyId, allowRivals: false);
        var period = ResolvePeriod(game, args.Period, Periods.ThisMonth);
        var rows = new List<ProductPnlRowDto>();
        foreach (var productId in game.Index.ProductsOf(company))
        {
            decimal revenue = 0m, cogs = 0m, ads = 0m;
            double units = 0;
            var listed = false;
            for (var m = period.From; m <= period.To; m++)
            {
                if (game.Index.Product(company, productId, m) is not { } pm) continue;
                listed |= pm.InProfitability;
                revenue += pm.Sales + pm.Exports;
                cogs += pm.Cogs;
                ads += pm.Ads;
                units += pm.CogsQty;
            }
            if (!listed) continue;
            var gross = revenue - cogs;
            var netMargin = gross - ads;
            rows.Add(new ProductPnlRowDto(productId, ProductName(new Magnate.Engine.Domain.ProductId(productId)), revenue, cogs, gross, ads, netMargin,
                revenue == 0m ? null : (double)(netMargin / revenue), units));
        }
        return new ProductProfitabilityDto(period.ToDto(),
            rows.OrderByDescending(r => r.Revenue).ThenBy(r => r.ProductId, StringComparer.Ordinal).ToList());
    }

    /// <summary>Exports over a period with exact units from COGS, by product and by building. Player only.</summary>
    [BridgeMethod("exports")]
    public ExportsDto Exports(CompanyPeriodArgs args)
    {
        var game = Game;
        var world = game.World;
        var company = ReportCompany(game, args.CompanyId, allowRivals: false);
        var period = ResolvePeriod(game, args.Period, Periods.ThisMonth);
        var byProduct = new List<ExportProductRowDto>();
        foreach (var productId in game.Index.ProductsOf(company))
        {
            decimal revenue = 0m;
            double units = 0;
            for (var m = period.From; m <= period.To; m++)
            {
                if (game.Index.Product(company, productId, m) is not { } pm) continue;
                revenue += pm.Exports;
                units += pm.ExportQty;
            }
            if (revenue == 0m && units == 0) continue;
            byProduct.Add(new ExportProductRowDto(productId, revenue, units, units > 0 ? revenue / (decimal)units : null));
        }
        var byBuilding = new List<ExportBuildingRowDto>();
        foreach (var b in world.Buildings.Values.Where(b => b.Owner.Value == company).OrderBy(b => b.Id.Value))
        {
            decimal revenue = 0m;
            double units = 0;
            for (var m = period.From; m <= period.To; m++)
            {
                if (game.Index.Building(b.Id.Value, m) is not { } bm) continue;
                revenue += bm.Exports;
                units += bm.ExportQty;
            }
            if (revenue == 0m && units == 0) continue;
            byBuilding.Add(new ExportBuildingRowDto(b.Id.Value, b.TypeId.Value, b.City.Value, revenue, units));
        }
        return new ExportsDto(
            period.ToDto(),
            byProduct.Sum(r => r.Revenue),
            byProduct.Sum(r => r.Units),
            byProduct.OrderByDescending(r => r.Revenue).ThenBy(r => r.ProductId, StringComparer.Ordinal).ToList(),
            byBuilding.OrderByDescending(r => r.Revenue).ThenBy(r => r.BuildingId).ToList());
    }

    /// <summary>The player's ledger, newest first, filtered and paged (limit ≤ 500).</summary>
    [BridgeMethod("ledger")]
    public LedgerPageDto Ledger(LedgerArgs args)
    {
        var game = Game;
        var world = game.World;
        var period = ResolvePeriod(game, args.Period, Periods.SinceStart);
        var limit = Math.Clamp(args.Limit, 1, 500);
        var offset = Math.Max(0, args.Offset);
        HashSet<LedgerCategory>? categories = null;
        if (args.Categories is { Count: > 0 } wanted)
        {
            categories = new HashSet<LedgerCategory>();
            foreach (var id in wanted)
            {
                if (!LedgerCategories.TryParse(id, out var c))
                {
                    throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown ledger category '{id}'.", "categories");
                }
                categories.Add(c);
            }
        }
        if (args.BuildingId is { } bid) Guard.Building(world, bid);
        if (args.ProductId is { } pid) Guard.Product(Catalog, pid);

        // Walk only the player's entries, newest first; the ledger is date-monotonic, so the
        // walk stops at the first entry older than the period.
        var positions = game.Index.LedgerPositions(game.Player.Value);
        var entries = world.Ledger.Entries;
        var monotonic = game.Index.Monotonic;
        var rows = new List<LedgerRowDto>(limit);
        var total = 0;
        for (var k = positions.Count - 1; k >= 0; k--)
        {
            var i = positions[k];
            var e = entries[i];
            var m = e.Date.AsMonthIndex();
            if (m > period.To) continue;
            if (m < period.From)
            {
                if (monotonic) break;
                continue;
            }
            if (categories is not null && !categories.Contains(e.Category)) continue;
            if (args.BuildingId is { } b && e.Building?.Value != b) continue;
            if (args.ProductId is { } p && e.Product?.Value != p) continue;
            if (total >= offset && rows.Count < limit)
            {
                rows.Add(new LedgerRowDto(i, Months.Dto(e.Date), LedgerCategories.Id(e.Category), e.Amount, e.Memo, e.Product?.Value, e.Building?.Value));
            }
            total++;
        }
        return new LedgerPageDto(total, offset, rows);
    }

    /// <summary>
    /// Why net income changed between two periods (default: last month vs this month):
    /// per-product volume / price / unit-cost variances on retail, exports, opex of
    /// existing vs new buildings, advertising, royalties, and a residual so the drivers
    /// sum exactly to the change. Player only.
    /// </summary>
    [BridgeMethod("explainNetIncome")]
    public ExplainDto ExplainNetIncome(ExplainArgs args)
    {
        var game = Game;
        var company = game.Player.Value;
        var basePeriod = ResolvePeriod(game, args.Base, Periods.LastMonth, "base");
        var compare = ResolvePeriod(game, args.Compare, Periods.ThisMonth, "compare");
        var ni1 = game.Index.NetIncome(company, basePeriod.From, basePeriod.To);
        var ni2 = game.Index.NetIncome(company, compare.From, compare.To);
        var drivers = new List<VarianceLineDto>();
        decimal explained = 0m;
        void Add(string driver, string? product, int? building, decimal amount)
        {
            if (amount == 0m) return;
            drivers.Add(new VarianceLineDto(driver, product, building, amount));
            explained += amount;
        }

        ProductTotals Totals(string product, Period p)
        {
            var t = new ProductTotals();
            for (var m = p.From; m <= p.To; m++)
            {
                if (game.Index.Product(company, product, m) is not { } pm) continue;
                t.RetailQty += pm.RetailQty;
                t.RetailRevenue += pm.Sales;
                t.RetailCogs += pm.RetailCogs;
                t.ExportRevenue += pm.Exports;
                t.ExportCogs += pm.ExportCogs;
                t.Ads += pm.Ads;
                t.Royalties += pm.RoyaltyIn - pm.RoyaltyOut;
            }
            return t;
        }

        decimal exports = 0m, ads = 0m, royalties = 0m;
        foreach (var product in game.Index.ProductsOf(company))
        {
            var a = Totals(product, basePeriod);
            var b = Totals(product, compare);
            if (a.RetailQty > 0 && b.RetailQty > 0)
            {
                var p1 = a.RetailRevenue / (decimal)a.RetailQty;
                var c1 = a.RetailCogs / (decimal)a.RetailQty;
                var p2 = b.RetailRevenue / (decimal)b.RetailQty;
                var c2 = b.RetailCogs / (decimal)b.RetailQty;
                var q1 = (decimal)a.RetailQty;
                var q2 = (decimal)b.RetailQty;
                Add("volume", product, null, Math.Round((q2 - q1) * (p1 - c1), 2));
                Add("price", product, null, Math.Round((p2 - p1) * q2, 2));
                Add("unitCost", product, null, Math.Round(-(c2 - c1) * q2, 2));
            }
            else
            {
                // Entering or leaving a market: the whole margin is volume.
                Add("volume", product, null, (b.RetailRevenue - b.RetailCogs) - (a.RetailRevenue - a.RetailCogs));
            }
            exports += (b.ExportRevenue - b.ExportCogs) - (a.ExportRevenue - a.ExportCogs);
            ads += b.Ads - a.Ads;
            royalties += b.Royalties - a.Royalties;
        }
        Add("exports", null, null, exports);
        Add("advertising", null, null, -ads);
        Add("royalties", null, null, royalties);

        // A building is "new" when it did not operate (charged no opex) in the base period: one
        // built in the base period's last month first operates the month after (§4.6.2).
        decimal opexExisting = 0m, opexNew = 0m;
        foreach (var building in game.World.Buildings.Values.Where(x => x.Owner == game.Player))
        {
            decimal o1 = 0m, o2 = 0m;
            for (var m = basePeriod.From; m <= basePeriod.To; m++) o1 += game.Index.Building(building.Id.Value, m)?.Opex ?? 0m;
            for (var m = compare.From; m <= compare.To; m++) o2 += game.Index.Building(building.Id.Value, m)?.Opex ?? 0m;
            if (o1 != 0m) opexExisting -= o2 - o1;
            else opexNew -= o2 - o1;
        }
        Add("opexExisting", null, null, opexExisting);
        Add("opexNewBuildings", null, null, opexNew);

        // Below the operating line (econ-audit §4.15): depreciation, net interest, income tax.
        decimal Below(Period p, PnlRole role)
        {
            decimal sum = 0m;
            for (var m = p.From; m <= p.To; m++)
            {
                if (game.Index.Company(company, m) is not { } cm) continue;
                for (var i = 0; i < cm.ByCategory.Length; i++) if (LedgerCategories.RoleOf(i) == role) sum += cm.ByCategory[i];
            }
            return sum;
        }
        decimal Depreciation(Period p)
        {
            decimal sum = 0m;
            for (var m = p.From; m <= p.To; m++) sum += game.Index.Company(company, m)?.Depreciation ?? 0m;
            return sum;
        }
        Add("depreciation", null, null, -(Depreciation(compare) - Depreciation(basePeriod)));
        Add("interest", null, null,
            (Below(compare, PnlRole.InterestExpense) + Below(compare, PnlRole.InterestIncome))
            - (Below(basePeriod, PnlRole.InterestExpense) + Below(basePeriod, PnlRole.InterestIncome)));
        Add("tax", null, null, Below(compare, PnlRole.IncomeTax) - Below(basePeriod, PnlRole.IncomeTax));
        Add("other", null, null, (ni2 - ni1) - explained);
        return new ExplainDto(basePeriod.ToDto(), compare.ToDto(), ni1, ni2, drivers);
    }

    /// <summary>Month-by-month summaries for the player (default: the last 12 months).</summary>
    [BridgeMethod("monthlyReport")]
    public MonthlyReportDto MonthlyReport(MonthlyReportArgs args)
    {
        var game = Game;
        var world = game.World;
        var company = game.Player.Value;
        var now = game.Now;
        var from = args.From is null ? Math.Max(game.StartMonth, now - 11) : Months.Index(Guard.Date(args.From, "from"));
        var to = args.To is null ? now : Months.Index(Guard.Date(args.To, "to"));
        from = Math.Clamp(from, game.StartMonth, now);
        to = Math.Clamp(to, game.StartMonth, now);
        if (from > to) throw new BridgeException(BridgeErrorCodes.InvalidPeriod, "The period starts after it ends.", "from");

        var cumulativeNi = game.Index.NetIncome(company, game.StartMonth, from - 1);
        var mine = world.Buildings.Values.Where(b => b.Owner == game.Player).ToList();
        var months = new List<MonthSummaryDto>();
        for (var m = from; m <= to; m++)
        {
            var cm = game.Index.Company(company, m);
            var ni = cm?.NetIncome ?? 0m;
            cumulativeNi += ni;
            var top = mine
                .Select(b => (Building: b, Ni: game.Index.Building(b.Id.Value, m)?.NetIncome ?? 0m))
                .Where(x => x.Ni != 0m)
                .OrderByDescending(x => Math.Abs(x.Ni))
                .ThenBy(x => x.Building.Id.Value)
                .Take(3)
                .Select(x => new BuildingNiDto(x.Building.Id.Value, world.Catalog.BuildingType(x.Building.TypeId).Name, x.Building.City.Value, x.Ni))
                .ToList();
            months.Add(new MonthSummaryDto(
                Months.Dto(m),
                cm?.Revenue ?? 0m,
                // Operating expenses (every opex line, advertising included); royalties are reported net below.
                (cm?.Opex ?? 0m) + (cm?.Category(LedgerCategory.PatentRoyaltyExpense) ?? 0m),
                cm?.Net ?? 0m,
                cm?.Cogs ?? 0m,
                (cm?.Category(LedgerCategory.PatentRoyaltyIncome) ?? 0m) + (cm?.Category(LedgerCategory.PatentRoyaltyExpense) ?? 0m),
                ni,
                cm?.RetailQty ?? 0,
                cm?.NewBuildings ?? 0,
                cm?.AdEntries ?? 0,
                game.Index.CashAtMonthEnd(company, m),
                cumulativeNi,
                top,
                Noteworthy(game, m)));
        }
        return new MonthlyReportDto(months);
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>A large-entry threshold for the monthly report (ReplayViewer parity).</summary>
    private const decimal NoteworthyAmount = 250_000m;

    private sealed class ProductTotals
    {
        public double RetailQty;
        public decimal RetailRevenue;
        public decimal RetailCogs;
        public decimal ExportRevenue;
        public decimal ExportCogs;
        public decimal Ads;
        public decimal Royalties;
    }

    private static List<NoteworthyDto> Noteworthy(ActiveGame game, int month)
    {
        var list = new List<NoteworthyDto>();
        var (start, end) = game.Index.LedgerMonth(month);
        var entries = game.World.Ledger.Entries;
        for (var i = start; i < end && i < entries.Count; i++)
        {
            var e = entries[i];
            if (e.Company != game.Player || e.Date.AsMonthIndex() != month || Math.Abs(e.Amount) < NoteworthyAmount) continue;
            list.Add(new NoteworthyDto(i, LedgerCategories.Id(e.Category), e.Product?.Value, e.Amount));
        }
        return list;
    }

    private static int ReportCompany(ActiveGame game, int? requested, bool allowRivals)
    {
        if (requested is not { } id || id == game.Player.Value) return game.Player.Value;
        Guard.Company(game.World, id);
        if (!allowRivals)
        {
            throw new BridgeException(BridgeErrorCodes.NotOwner, "That report is only available for your own company.", "companyId",
                new ErrorDetailsDto(EntityKind: EntityKinds.Company, EntityId: id.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
        return id;
    }

    private static Period ResolvePeriod(ActiveGame game, PeriodArgs? args, string defaultPreset, string field = "period")
        => Periods.Resolve(args, game.StartMonth, game.Now, defaultPreset, field);
}
