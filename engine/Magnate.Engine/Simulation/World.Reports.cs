using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;

namespace Magnate.Engine.Simulation;

// Financial statements and per-product profitability (market share lives in World.Market.cs).
public sealed partial class World
{
    /// <summary>Compute a balance-sheet snapshot for the company at <see cref="Clock"/>.Now.</summary>
    /// <remarks>
    /// Inventory is valued at weighted-average cost (Phase 2.1) — what the company actually paid
    /// to acquire/produce the goods, NOT a market-price proxy. Buildings are at book value:
    /// construction cost plus capitalised upgrades, less accumulated depreciation. Land and
    /// construction in progress come from the fixed-asset register (econ-audit §4.8, §4.12).
    /// Liabilities are the outstanding debt principal: the running total of the
    /// <see cref="StatementSection.Financing"/> ledger categories, split into term loans and the
    /// revolver by the finance register. Paid-in capital is the running total of owner
    /// contributions (starting capital and share issues net of fees); retained earnings are the
    /// remainder of equity.
    /// </remarks>
    public BalanceSheet GetBalanceSheet(CompanyId companyId)
    {
        var company = RequireCompany(companyId);

        decimal inventoryValue = 0m;
        decimal buildingValue = 0m;
        decimal grossPpe = 0m;
        decimal accumulated = 0m;
        decimal land = 0m;
        decimal cip = 0m;
        var register = _finance.Assets;
        var hasRegister = register.Records.Count > 0;

        foreach (var building in _buildings.Values.Where(b => b.Owner == companyId))
        {
            buildingValue += building.BookValue;
            inventoryValue += building.Inventory.TotalValue();
            grossPpe += building.CapitalizedCost;
            accumulated += building.AccumulatedDepreciation;
            if (hasRegister && register.Find(building.Id) is { } assets)
            {
                land += assets.Land;
                cip += assets.ConstructionInProgress;
            }
        }

        // E3b: land held without a building (outside the per-building register) is land at cost.
        if (Rules.Land.Enabled) land += GetHeldLandAtCost(companyId);

        var liabilities = Ledger.SectionTotal(companyId, StatementSection.Financing);
        decimal termLoans = 0m, revolver = 0m;
        if (_finance.Companies.TryGetValue(companyId, out var finance))
        {
            termLoans = finance.TermDebt;
            revolver = finance.RevolverDrawn;
        }

        var paidIn = Ledger.CategoryTotal(companyId, LedgerCategory.StartingCapital)
            + Ledger.CategoryTotal(companyId, LedgerCategory.ShareIssuance)
            + Ledger.CategoryTotal(companyId, LedgerCategory.ShareIssuanceFee);

        return new BalanceSheet(
            Clock.Now,
            companyId,
            company.Cash,
            inventoryValue,
            buildingValue,
            liabilities,
            Land: land,
            Cip: cip,
            GrossPpe: grossPpe,
            AccumulatedDepreciation: accumulated,
            TermLoans: termLoans,
            Revolver: revolver,
            PaidInCapital: paidIn);
    }

    /// <summary>
    /// Cash-flow statement over a date range: the company's ledger amounts classified by
    /// <see cref="LedgerCategoryInfo.CashFlow"/>. <see cref="CashFlowStatement.NetChange"/> equals
    /// the change in cash over the period by construction.
    /// </summary>
    public CashFlowStatement GetCashFlowStatement(CompanyId companyId, GameDate from, GameDate toInclusive)
    {
        RequireCompany(companyId);
        decimal operating = 0m, investing = 0m, financing = 0m;
        foreach (var entry in Ledger.EntriesInRange(companyId, from, toInclusive))
        {
            switch (LedgerCategoryInfo.Of(entry.Category).CashFlow)
            {
                case CashFlowClass.Operating:
                    operating += entry.Amount;
                    break;
                case CashFlowClass.Investing:
                    investing += entry.Amount;
                    break;
                case CashFlowClass.Financing:
                    financing += entry.Amount;
                    break;
            }
        }

        return new CashFlowStatement(from, toInclusive, operating, investing, financing);
    }

    /// <summary>
    /// Realised market share (master plan D11, econ-audit §4.18): units of <paramref name="product"/>
    /// the company sold at retail in <paramref name="city"/> over the trailing
    /// <paramref name="months"/> months (ending now), divided by all retail units sold there in the
    /// same window. Read from the ledger's per-unit <see cref="LedgerCategory.ProductSale"/>
    /// entries, so it is exactly what happened, not a model replay. 0 when nothing sold.
    /// <para>
    /// The incumbent local competition of the realistic demand model (E1, econ-audit §4.2) joins
    /// the denominator through <see cref="IncumbentUnitsSold"/>.
    /// </para>
    /// </summary>
    public double GetRealisedMarketShare(CompanyId company, ProductId product, CityId city, int months = 3)
    {
        RequireCompany(company);
        if (months < 1) throw new ArgumentOutOfRangeException(nameof(months), "window must be at least one month");
        var to = Clock.Now;
        var fromIndex = to.AsMonthIndex() - (months - 1);
        var from = new GameDate(fromIndex / 12, fromIndex % 12 + 1);
        double mine = 0, total = 0;
        foreach (var c in _companies.Keys.OrderBy(k => k.Value))
        {
            foreach (var e in Ledger.EntriesInRange(c, from, to))
            {
                if (e.Category != LedgerCategory.ProductSale || e.Product != product || e.Building is not BuildingInstanceId bid) continue;
                if (!(_buildings.TryGetValue(bid, out var b) || _finance.Retired.TryGetValue(bid, out b)) || b!.City != city) continue;
                var units = e.Quantity ?? 0;
                total += units;
                if (c == company) mine += units;
            }
        }

        total += IncumbentUnitsSold(product, city, from, to);
        return total > 0 ? mine / total : 0.0;
    }

    /// <summary>
    /// Units the permanent local incumbents (econ-audit §4.2) sold of <paramref name="product"/> in
    /// <paramref name="city"/> over the window, as recorded by the market model
    /// (<see cref="GetIncumbentUnitsSold"/>; 0 under Classic rules).
    /// </summary>
    private double IncumbentUnitsSold(ProductId product, CityId city, GameDate from, GameDate toInclusive)
        => GetIncumbentUnitsSold(product, city, from, toInclusive);

    /// <summary>
    /// Accrual P&amp;L over a date range (econ-audit §4.15): ledger amounts classified by
    /// <see cref="LedgerCategoryInfo.Section"/>, COGS from the <see cref="CogsLog"/>, non-cash
    /// items from the <see cref="AccrualJournal"/>.
    /// </summary>
    public IncomeStatement GetIncomeStatement(CompanyId companyId, GameDate from, GameDate toInclusive)
    {
        decimal revenue = 0m;
        decimal opex = 0m;
        decimal nonOperating = 0m;
        decimal incomeTax = 0m;
        decimal interestExpense = 0m;
        decimal interestIncome = 0m;
        decimal otherGains = 0m;

        foreach (var entry in Ledger.EntriesInRange(companyId, from, toInclusive))
        {
            switch (LedgerCategoryInfo.Of(entry.Category).Section)
            {
                case StatementSection.Revenue:
                    revenue += entry.Amount;
                    break;
                case StatementSection.OperatingExpense:
                    opex += -entry.Amount;
                    break;
                case StatementSection.NonOperating:
                    nonOperating += entry.Amount;
                    if (entry.Category == LedgerCategory.InterestIncome) interestIncome += entry.Amount;
                    else interestExpense += -entry.Amount;
                    break;
                case StatementSection.IncomeTax:
                    incomeTax += -entry.Amount;
                    break;
                // InventoryCapitalized: capitalised to inventory (surfaces as COGS when sold).
                // Capex / Financing / EquityContribution: balance-sheet flows, not P&L.
            }
        }

        var cogs = CogsLog.EntriesInRange(companyId, from, toInclusive).Sum(e => e.Cost);

        decimal depreciation = 0m;
        foreach (var accrual in AccrualJournal.EntriesInRange(companyId, from, toInclusive))
        {
            switch (accrual.Kind)
            {
                case AccrualKind.Depreciation:
                    depreciation += -accrual.Amount;
                    break;
                case AccrualKind.InventoryWriteDown:
                    cogs += -accrual.Amount;
                    break;
                case AccrualKind.DisposalGainLoss:
                case AccrualKind.ConstructionWriteOff:
                    nonOperating += accrual.Amount;
                    otherGains += accrual.Amount;
                    break;
            }
        }

        if (depreciation != 0m) opex += depreciation;
        return new IncomeStatement(from, toInclusive, revenue, cogs, opex, depreciation, nonOperating, incomeTax,
            interestExpense, interestIncome, otherGains);
    }

    /// <summary>
    /// Per-product profitability over a date range. Revenue is from cash ledger
    /// product sales; cost is COGS recognized when those goods left inventory.
    /// Products that were consumed as inputs but never sold (e.g. plastic feeding
    /// a soft-drink line) don't appear — their cost is rolled into the finished
    /// good's COGS.
    /// </summary>
    public IReadOnlyDictionary<ProductId, ProductProfitability> GetProductProfitability(
        CompanyId companyId,
        GameDate from,
        GameDate toInclusive)
    {
        var byProduct = new Dictionary<ProductId, (decimal revenue, decimal cost, decimal marketingCost)>();

        foreach (var entry in Ledger.EntriesInRange(companyId, from, toInclusive))
        {
            if (entry.Product is null) continue;
            var key = entry.Product.Value;
            byProduct.TryGetValue(key, out var acc);

            switch (entry.Category)
            {
                case LedgerCategory.ProductSale:
                case LedgerCategory.ExportSale:
                    acc.revenue += entry.Amount;
                    break;
                case LedgerCategory.AdvertisingCost:
                    acc.marketingCost += -entry.Amount;
                    break;
                default:
                    continue;
            }
            byProduct[key] = acc;
        }

        foreach (var entry in CogsLog.EntriesInRange(companyId, from, toInclusive))
        {
            byProduct.TryGetValue(entry.Product, out var acc);
            acc.cost += entry.Cost;
            byProduct[entry.Product] = acc;
        }

        return byProduct.ToDictionary(
            kvp => kvp.Key,
            kvp => new ProductProfitability(kvp.Key, kvp.Value.revenue, kvp.Value.cost, kvp.Value.marketingCost));
    }
}
