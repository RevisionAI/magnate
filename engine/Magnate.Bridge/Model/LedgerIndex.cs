using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>One company's ledger and COGS totals for one month.</summary>
internal sealed class CompanyMonth
{
    /// <summary>Σ ledger amount per category ordinal (signed, as booked).</summary>
    public readonly decimal[] ByCategory = new decimal[LedgerCategories.Count];

    /// <summary>Σ of every ledger amount (the month's net cash flow).</summary>
    public decimal Net;

    /// <summary>Σ COGS cost (retail + export + unattributed).</summary>
    public decimal Cogs;
    public double CogsQty;
    public double RetailQty;
    public decimal RetailCogs;
    public double ExportQty;
    public decimal ExportCogs;
    public int NewBuildings;
    public int AdEntries;

    public decimal Revenue
    {
        get
        {
            decimal sum = 0m;
            foreach (var o in LedgerCategories.RevenueOrdinals) sum += ByCategory[o];
            return sum;
        }
    }

    /// <summary>Operating expenses as a positive number.</summary>
    public decimal Opex
    {
        get
        {
            decimal sum = 0m;
            foreach (var o in LedgerCategories.OpexOrdinals) sum -= ByCategory[o];
            return sum;
        }
    }

    /// <summary>Interest, tax and other below-EBIT items as a positive expense (zero on today's engine).</summary>
    public decimal BelowEbit
    {
        get
        {
            decimal sum = 0m;
            for (var i = 0; i < ByCategory.Length; i++)
            {
                var role = LedgerCategories.RoleOf(i);
                if (role is PnlRole.InterestExpense or PnlRole.InterestIncome or PnlRole.IncomeTax) sum -= ByCategory[i];
            }
            return sum;
        }
    }

    /// <summary>Depreciation charged this month (positive; accrual journal, econ-audit §4.15).</summary>
    public decimal Depreciation;

    /// <summary>Inventory write-downs (positive; reported in COGS).</summary>
    public decimal WriteDowns;

    /// <summary>Disposal gains/losses and construction write-offs (signed effect on net income).</summary>
    public decimal OtherGains;

    /// <summary>Signed net-income effect of the month's non-cash entries.</summary>
    public decimal AccrualEffect => OtherGains - Depreciation - WriteDowns;

    /// <summary>Accrual net income: the cash-classified P&amp;L plus the non-cash journal (the engine's income statement).</summary>
    public decimal NetIncome => Revenue - Cogs - Opex - BelowEbit + AccrualEffect;

    public decimal Category(LedgerCategory category) => ByCategory[(int)category];

    /// <summary>Σ operating cash-flow categories (for runway).</summary>
    public decimal OperatingCashFlow
    {
        get
        {
            decimal sum = 0m;
            for (var i = 0; i < ByCategory.Length; i++)
            {
                if (LedgerCategories.SectionOf(i) == CashSection.Operating) sum += ByCategory[i];
            }
            return sum;
        }
    }
}

/// <summary>One building's month (accrual P&amp;L pieces, cash movements, goods flows).</summary>
internal sealed class BuildingMonth
{
    public decimal Sales;
    public decimal Exports;
    public decimal Opex;
    public decimal InputPurchase;
    public decimal RetailRestock;
    public decimal Shipping;
    public decimal Construction;
    public decimal Upgrade;
    public decimal Net;
    public decimal Cogs;
    public double RetailQty;
    public double ExportQty;
    public double TransfersIn;
    public double TransfersOut;

    public decimal Revenue => Sales + Exports;

    /// <summary>Per-building accrual net income: revenue − COGS − opex (advertising is company-scoped).</summary>
    public decimal NetIncome => Sales + Exports - Cogs - Opex;
}

/// <summary>Facts about a building that never change, plus its capex as booked in the ledger.</summary>
internal sealed class BuildingStatic
{
    public int Owner;
    public string City = string.Empty;
    public string TypeId = string.Empty;
    public bool IsRetail;
    public bool Known;
    public decimal ConstructionCost;
    public decimal UpgradeCost;

    /// <summary>The engine's building while it exists (book value and build date come from it).</summary>
    public BuildingInstance? Instance;

    /// <summary>Month of the first construction entry (fallback for buildings the world no longer has).</summary>
    public int? FirstConstructionMonth;

    /// <summary>
    /// Month the building opened: the engine's <c>BuildingInstance.BuiltAt</c> (E17; rebuilt from
    /// the ledger for pre-v10 saves), else the first construction entry.
    /// </summary>
    public int? OpenedMonth => Instance is { } b ? b.BuiltAt.AsMonthIndex() : FirstConstructionMonth;

    /// <summary>
    /// Net book value: the engine's <c>BuildingInstance.BookValue</c> (capitalised construction +
    /// upgrades − accumulated depreciation, E5), else the ledger capex.
    /// </summary>
    public decimal BookValue => Instance?.BookValue ?? ConstructionCost + UpgradeCost;
}

/// <summary>One company's month for one product.</summary>
internal sealed class ProductMonth
{
    public decimal Sales;
    public decimal Exports;
    public decimal Ads;
    public decimal RoyaltyIn;
    public decimal RoyaltyOut;
    public decimal Purchases;
    public decimal Shipping;
    public decimal Cogs;
    public decimal RetailCogs;
    public decimal ExportCogs;
    public double CogsQty;
    public double RetailQty;
    public double ExportQty;

    /// <summary>Units bought from the world market (ledger <c>Quantity</c> of purchases and restocks, E11).</summary>
    public double PurchaseQty;

    /// <summary>Units shipped between the company's own cities (ledger <c>Quantity</c> of shipping, E11).</summary>
    public double ShippedQty;

    /// <summary>True when the engine's product report would list this product (sale, export, ad or COGS seen).</summary>
    public bool InProfitability;
}

/// <summary>One building's month for one product (kept for a rolling window only).</summary>
internal sealed class BuildingProductMonth
{
    public double SaleQty;
    public decimal SaleRev;
    public double ExportQty;
    public decimal ExportRev;
    public decimal Cogs;
    public decimal Purchases;
    public decimal Shipping;
    public double TransferIn;
    public double TransferOut;

    /// <summary>Units bought from the world market for this building (ledger <c>Quantity</c>, E11).</summary>
    public double PurchaseQty;

    /// <summary>Units shipped in from the company's other cities (ledger <c>Quantity</c>, E11).</summary>
    public double ShippedQty;
}

/// <summary>Retail units and revenue of one company in one (city, product) market for a month.</summary>
internal sealed class RetailCell
{
    public double Qty;
    public decimal Rev;
}

/// <summary>
/// Incremental monthly aggregates over the engine's append-only, date-monotonic
/// <see cref="Ledger"/>, <see cref="CogsLog"/> and <see cref="TransferLog"/>
/// (bridge-spec §4.5). The engine's own reports scan the whole ledger (7 ms per
/// one-month income statement at year 10 in WASM); the index folds only new
/// entries after each mutation or tick and answers every report in
/// O(months × keys).
/// </summary>
/// <remarks>
/// Classification rules: revenue/opex follow <see cref="LedgerCategories"/>; a COGS
/// entry whose source building is a retail type is a retail sale, otherwise an
/// export; COGS with no source building (saves older than v5) count toward company
/// and product totals only. Per-(building, product) and per-market data is kept for
/// a rolling window of <see cref="RetainMonths"/> months.
/// </remarks>
internal sealed class LedgerIndex
{
    /// <summary>Months of per-(building, product) and per-market detail kept.</summary>
    public const int RetainMonths = 24;

    private readonly World _world;
    private int _ledgerPos;
    private int _cogsPos;
    private int _transferPos;
    private int _accrualPos;

    private readonly Dictionary<(int C, int M), CompanyMonth> _companyMonth = new();
    private readonly Dictionary<int, (int First, int Last)> _companyRange = new();
    private readonly Dictionary<(int B, int M), BuildingMonth> _buildingMonth = new();
    private readonly Dictionary<int, BuildingStatic> _buildingStatic = new();
    private readonly Dictionary<(int C, string P, int M), ProductMonth> _productMonth = new();
    private readonly Dictionary<int, SortedSet<string>> _productsByCompany = new();
    private readonly Dictionary<int, Dictionary<(int B, string P), BuildingProductMonth>> _buildingProduct = new();
    // month → (city, product) market → company → cell: market lookups are O(companies in the market).
    private readonly Dictionary<int, Dictionary<(string City, string P), Dictionary<int, RetailCell>>> _retail = new();
    private readonly Dictionary<int, List<int>> _ledgerByCompany = new();
    private readonly MonthSlices _ledgerSlices = new();
    private readonly MonthSlices _cogsSlices = new();
    private readonly MonthSlices _transferSlices = new();
    private readonly Dictionary<int, List<decimal>> _cashPrefix = new();
    private bool _prefixDirty = true;

    /// <summary>
    /// First month whose per-(building, product) and per-market detail this catch-up builds: older
    /// detail would be pruned at its end anyway (a load folds ten years at once, §4.8).
    /// </summary>
    private int _windowFrom = int.MinValue;

    public LedgerIndex(World world)
    {
        _world = world;
    }

    /// <summary>Latest month seen in any log (int.MinValue when empty).</summary>
    public int LatestMonth { get; private set; } = int.MinValue;

    /// <summary>Earliest month seen in any log (int.MaxValue when empty).</summary>
    public int EarliestMonth { get; private set; } = int.MaxValue;

    /// <summary>Entries folded so far (for diagnostics).</summary>
    public (int Ledger, int Cogs, int Transfers) Positions => (_ledgerPos, _cogsPos, _transferPos);

    /// <summary>True while every log has been date-monotonic (month slices are valid).</summary>
    public bool Monotonic => _ledgerSlices.Monotonic && _cogsSlices.Monotonic && _transferSlices.Monotonic;

    /// <summary>Fold every entry appended since the last call. O(new entries).</summary>
    public void CatchUp()
    {
        var ledger = _world.Ledger.Entries;
        var cogs = _world.CogsLog.Entries;
        var transfers = _world.TransferLog.Entries;
        var accruals = _world.AccrualJournal.Entries;
        if (_ledgerPos == ledger.Count && _cogsPos == cogs.Count && _transferPos == transfers.Count && _accrualPos == accruals.Count) return;
        // FoldAccrual touches company months only, so the window ignores the accrual journal.
        _windowFrom = WindowFrom(ledger, cogs, transfers);

        for (; _ledgerPos < ledger.Count; _ledgerPos++) FoldLedger(ledger[_ledgerPos], _ledgerPos);
        for (; _cogsPos < cogs.Count; _cogsPos++) FoldCogs(cogs[_cogsPos], _cogsPos);
        for (; _transferPos < transfers.Count; _transferPos++) FoldTransfer(transfers[_transferPos], _transferPos);
        for (; _accrualPos < accruals.Count; _accrualPos++) FoldAccrual(accruals[_accrualPos]);
        _prefixDirty = true;
        Prune();
    }

    /// <summary>
    /// A lower bound of <see cref="Prune"/>'s cutoff after this catch-up: the latest month will be at
    /// least that of each log's last entry, so detail before it is certainly dropped.
    /// </summary>
    private int WindowFrom(IReadOnlyList<LedgerEntry> ledger, IReadOnlyList<CogsEntry> cogs, IReadOnlyList<TransferEntry> transfers)
    {
        var latest = LatestMonth;
        if (ledger.Count > 0) latest = Math.Max(latest, ledger[^1].Date.AsMonthIndex());
        if (cogs.Count > 0) latest = Math.Max(latest, cogs[^1].Date.AsMonthIndex());
        if (transfers.Count > 0) latest = Math.Max(latest, transfers[^1].Date.AsMonthIndex());
        return latest == int.MinValue ? int.MinValue : latest - RetainMonths;
    }

    // ------------------------------------------------------------------ folding

    /// <summary>
    /// A non-cash journal entry (finance workstream, econ-audit §4.15): depreciation, inventory
    /// write-downs, disposal gains/losses and construction write-offs move net income without
    /// moving cash, so every net-income consumer of the index sees the engine's accrual figure.
    /// </summary>
    private void FoldAccrual(AccrualEntry e)
    {
        var m = e.Date.AsMonthIndex();
        var c = e.Company.Value;
        Touch(c, m);
        var cm = CompanyMonthFor(c, m);
        switch (e.Kind)
        {
            case AccrualKind.Depreciation: cm.Depreciation -= e.Amount; break;
            case AccrualKind.InventoryWriteDown: cm.WriteDowns -= e.Amount; break;
            default: cm.OtherGains += e.Amount; break;
        }
    }

    private void FoldLedger(LedgerEntry e, int position)
    {
        var m = e.Date.AsMonthIndex();
        var c = e.Company.Value;
        Touch(c, m);
        _ledgerSlices.Add(m, position);

        if (!_ledgerByCompany.TryGetValue(c, out var positions))
        {
            positions = new List<int>();
            _ledgerByCompany[c] = positions;
        }
        positions.Add(position);

        var cm = CompanyMonthFor(c, m);
        var ordinal = (int)e.Category;
        if (ordinal >= 0 && ordinal < cm.ByCategory.Length) cm.ByCategory[ordinal] += e.Amount;
        cm.Net += e.Amount;
        if (e.Category == LedgerCategory.AdvertisingCost) cm.AdEntries++;
        if (e.Category == LedgerCategory.ConstructionCost && e.Building is not null) cm.NewBuildings++;

        if (e.Product is { } product)
        {
            var pm = ProductMonthFor(c, product.Value, m);
            switch (e.Category)
            {
                case LedgerCategory.ProductSale: pm.Sales += e.Amount; pm.InProfitability = true; break;
                case LedgerCategory.ExportSale: pm.Exports += e.Amount; pm.InProfitability = true; break;
                case LedgerCategory.AdvertisingCost: pm.Ads -= e.Amount; pm.InProfitability = true; break;
                case LedgerCategory.PatentRoyaltyIncome: pm.RoyaltyIn += e.Amount; break;
                case LedgerCategory.PatentRoyaltyExpense: pm.RoyaltyOut -= e.Amount; break;
                case LedgerCategory.InputPurchase:
                case LedgerCategory.RetailRestock: pm.Purchases -= e.Amount; pm.PurchaseQty += e.Quantity ?? 0; break;
                case LedgerCategory.ShippingCost: pm.Shipping -= e.Amount; pm.ShippedQty += e.Quantity ?? 0; break;
            }
        }

        if (e.Building is { } buildingId)
        {
            var b = buildingId.Value;
            var info = StaticFor(b);
            var bm = BuildingMonthFor(b, m);
            bm.Net += e.Amount;
            switch (e.Category)
            {
                case LedgerCategory.ProductSale: bm.Sales += e.Amount; break;
                case LedgerCategory.ExportSale: bm.Exports += e.Amount; break;
                case LedgerCategory.InputPurchase: bm.InputPurchase -= e.Amount; break;
                case LedgerCategory.RetailRestock: bm.RetailRestock -= e.Amount; break;
                case LedgerCategory.ShippingCost: bm.Shipping -= e.Amount; break;
                case LedgerCategory.ConstructionCost:
                    bm.Construction -= e.Amount;
                    info.ConstructionCost -= e.Amount;
                    if (info.FirstConstructionMonth is not int first || m < first) info.FirstConstructionMonth = m;
                    break;
                case LedgerCategory.UpgradeCost:
                    bm.Upgrade -= e.Amount;
                    info.UpgradeCost -= e.Amount;
                    break;
                default:
                    // Classic's single OperatingCost line, or Realistic's wages, utilities,
                    // maintenance, insurance, property tax and retail variable costs (E1/E2).
                    if (LedgerCategories.RoleOf(ordinal) == PnlRole.OperatingExpense) bm.Opex -= e.Amount;
                    break;
            }

            if (e.Product is { } p && m >= _windowFrom)
            {
                var bp = BuildingProductFor(m, b, p.Value);
                switch (e.Category)
                {
                    case LedgerCategory.ProductSale:
                        bp.SaleRev += e.Amount;
                        if (info.Known) RetailCellFor(m, info.City, p.Value, c).Rev += e.Amount;
                        break;
                    case LedgerCategory.ExportSale: bp.ExportRev += e.Amount; break;
                    case LedgerCategory.InputPurchase:
                    case LedgerCategory.RetailRestock: bp.Purchases -= e.Amount; bp.PurchaseQty += e.Quantity ?? 0; break;
                    case LedgerCategory.ShippingCost: bp.Shipping -= e.Amount; bp.ShippedQty += e.Quantity ?? 0; break;
                }
            }
        }
    }

    private void FoldCogs(CogsEntry e, int position)
    {
        var m = e.Date.AsMonthIndex();
        var c = e.Company.Value;
        var p = e.Product.Value;
        Touch(c, m);
        _cogsSlices.Add(m, position);

        var cm = CompanyMonthFor(c, m);
        cm.Cogs += e.Cost;
        cm.CogsQty += e.Quantity;
        var pm = ProductMonthFor(c, p, m);
        pm.Cogs += e.Cost;
        pm.CogsQty += e.Quantity;
        pm.InProfitability = true;

        if (e.SourceBuilding is not { } source) return;
        var b = source.Value;
        var info = StaticFor(b);
        if (!info.Known) return;

        var bm = BuildingMonthFor(b, m);
        bm.Cogs += e.Cost;
        var windowed = m >= _windowFrom;
        var bp = windowed ? BuildingProductFor(m, b, p) : null;
        if (bp is not null) bp.Cogs += e.Cost;
        if (info.IsRetail)
        {
            cm.RetailQty += e.Quantity;
            cm.RetailCogs += e.Cost;
            pm.RetailQty += e.Quantity;
            pm.RetailCogs += e.Cost;
            bm.RetailQty += e.Quantity;
            if (bp is not null) bp.SaleQty += e.Quantity;
            if (windowed) RetailCellFor(m, info.City, p, c).Qty += e.Quantity;
        }
        else
        {
            cm.ExportQty += e.Quantity;
            cm.ExportCogs += e.Cost;
            pm.ExportQty += e.Quantity;
            pm.ExportCogs += e.Cost;
            bm.ExportQty += e.Quantity;
            if (bp is not null) bp.ExportQty += e.Quantity;
        }
    }

    private void FoldTransfer(TransferEntry e, int position)
    {
        var m = e.Date.AsMonthIndex();
        Touch(e.Company.Value, m);
        _transferSlices.Add(m, position);
        var from = e.From.Value;
        var to = e.To.Value;
        BuildingMonthFor(from, m).TransfersOut += e.Quantity;
        BuildingMonthFor(to, m).TransfersIn += e.Quantity;
        if (m < _windowFrom) return;
        BuildingProductFor(m, from, e.Product.Value).TransferOut += e.Quantity;
        BuildingProductFor(m, to, e.Product.Value).TransferIn += e.Quantity;
    }

    private void Touch(int company, int month)
    {
        if (month > LatestMonth) LatestMonth = month;
        if (month < EarliestMonth) EarliestMonth = month;
        if (_companyRange.TryGetValue(company, out var range))
        {
            if (month < range.First || month > range.Last)
            {
                _companyRange[company] = (Math.Min(range.First, month), Math.Max(range.Last, month));
            }
        }
        else
        {
            _companyRange[company] = (month, month);
        }
    }

    private CompanyMonth CompanyMonthFor(int c, int m)
    {
        if (!_companyMonth.TryGetValue((c, m), out var cm))
        {
            cm = new CompanyMonth();
            _companyMonth[(c, m)] = cm;
        }
        return cm;
    }

    private BuildingMonth BuildingMonthFor(int b, int m)
    {
        if (!_buildingMonth.TryGetValue((b, m), out var bm))
        {
            bm = new BuildingMonth();
            _buildingMonth[(b, m)] = bm;
        }
        return bm;
    }

    private ProductMonth ProductMonthFor(int c, string p, int m)
    {
        if (!_productMonth.TryGetValue((c, p, m), out var pm))
        {
            pm = new ProductMonth();
            _productMonth[(c, p, m)] = pm;
            if (!_productsByCompany.TryGetValue(c, out var set))
            {
                set = new SortedSet<string>(StringComparer.Ordinal);
                _productsByCompany[c] = set;
            }
            set.Add(p);
        }
        return pm;
    }

    private BuildingProductMonth BuildingProductFor(int m, int b, string p)
    {
        if (!_buildingProduct.TryGetValue(m, out var month))
        {
            month = new Dictionary<(int B, string P), BuildingProductMonth>();
            _buildingProduct[m] = month;
        }
        if (!month.TryGetValue((b, p), out var bp))
        {
            bp = new BuildingProductMonth();
            month[(b, p)] = bp;
        }
        return bp;
    }

    private RetailCell RetailCellFor(int m, string city, string p, int c)
    {
        if (!_retail.TryGetValue(m, out var month))
        {
            month = new Dictionary<(string City, string P), Dictionary<int, RetailCell>>();
            _retail[m] = month;
        }
        if (!month.TryGetValue((city, p), out var market))
        {
            market = new Dictionary<int, RetailCell>();
            month[(city, p)] = market;
        }
        if (!market.TryGetValue(c, out var cell))
        {
            cell = new RetailCell();
            market[c] = cell;
        }
        return cell;
    }

    private BuildingStatic StaticFor(int b)
    {
        if (_buildingStatic.TryGetValue(b, out var info)) return info;
        info = new BuildingStatic();
        // Retired buildings (sold, demolished, liquidated) keep their facts: a cold rebuild after a
        // disposal classifies their history exactly as the live index did.
        var key = new BuildingInstanceId(b);
        if (_world.Buildings.TryGetValue(key, out var building) || _world.RetiredBuildings.TryGetValue(key, out building))
        {
            info.Known = true;
            info.Instance = building;
            info.Owner = building.Owner.Value;
            info.City = building.City.Value;
            info.TypeId = building.TypeId.Value;
            info.IsRetail = _world.Catalog.BuildingTypes.TryGetValue(building.TypeId, out var type) && type.Retail;
        }
        _buildingStatic[b] = info;
        return info;
    }

    private void Prune()
    {
        if (LatestMonth == int.MinValue) return;
        var cutoff = LatestMonth - RetainMonths;
        PruneMonths(_buildingProduct, cutoff);
        PruneMonths(_retail, cutoff);
    }

    private static void PruneMonths<TValue>(Dictionary<int, TValue> byMonth, int cutoff)
    {
        List<int>? stale = null;
        foreach (var month in byMonth.Keys)
        {
            if (month < cutoff) (stale ??= new List<int>()).Add(month);
        }
        if (stale is null) return;
        foreach (var month in stale) byMonth.Remove(month);
    }

    // ------------------------------------------------------------------ queries

    /// <summary>Companies that have any entry.</summary>
    public IEnumerable<int> Companies => _companyRange.Keys;

    /// <summary>First month with an entry for <paramref name="company"/>.</summary>
    public int? FirstMonth(int company) => _companyRange.TryGetValue(company, out var r) ? r.First : null;

    public CompanyMonth? Company(int company, int month)
        => _companyMonth.TryGetValue((company, month), out var cm) ? cm : null;

    public decimal Revenue(int company, int month) => Company(company, month)?.Revenue ?? 0m;

    public decimal NetIncome(int company, int month) => Company(company, month)?.NetIncome ?? 0m;

    /// <summary>Σ net income over an inclusive month range.</summary>
    public decimal NetIncome(int company, int from, int to)
    {
        decimal sum = 0m;
        for (var m = from; m <= to; m++) sum += NetIncome(company, m);
        return sum;
    }

    /// <summary>Σ of one category over an inclusive month range.</summary>
    public decimal CategorySum(int company, LedgerCategory category, int from, int to)
    {
        decimal sum = 0m;
        for (var m = from; m <= to; m++)
        {
            if (_companyMonth.TryGetValue((company, m), out var cm)) sum += cm.ByCategory[(int)category];
        }
        return sum;
    }

    /// <summary>Σ ledger for the company with date ≤ <paramref name="month"/> (cash at that month end).</summary>
    public decimal CashAtMonthEnd(int company, int month)
    {
        if (!_companyRange.TryGetValue(company, out var range) || month < range.First) return 0m;
        if (_prefixDirty)
        {
            _cashPrefix.Clear();
            _prefixDirty = false;
        }
        if (!_cashPrefix.TryGetValue(company, out var prefix))
        {
            prefix = new List<decimal>(range.Last - range.First + 1);
            decimal running = 0m;
            for (var m = range.First; m <= range.Last; m++)
            {
                if (_companyMonth.TryGetValue((company, m), out var cm)) running += cm.Net;
                prefix.Add(running);
            }
            _cashPrefix[company] = prefix;
        }
        var idx = Math.Min(month, range.Last) - range.First;
        return prefix[idx];
    }

    /// <summary>Σ ledger for the company with date &lt; <paramref name="month"/>.</summary>
    public decimal CashBefore(int company, int month) => CashAtMonthEnd(company, month - 1);

    public BuildingMonth? Building(int building, int month)
        => _buildingMonth.TryGetValue((building, month), out var bm) ? bm : null;

    public BuildingStatic? BuildingInfo(int building)
        => _buildingStatic.TryGetValue(building, out var info) ? info : null;

    public ProductMonth? Product(int company, string product, int month)
        => _productMonth.TryGetValue((company, product, month), out var pm) ? pm : null;

    /// <summary>Products with any activity for the company, ordinal order.</summary>
    public IReadOnlyCollection<string> ProductsOf(int company)
        => _productsByCompany.TryGetValue(company, out var set) ? set : (IReadOnlyCollection<string>)Array.Empty<string>();

    public BuildingProductMonth? BuildingProduct(int building, string product, int month)
        => _buildingProduct.TryGetValue(month, out var map) && map.TryGetValue((building, product), out var bp) ? bp : null;

    /// <summary>Every (building, product) cell of a retained month.</summary>
    public IEnumerable<KeyValuePair<(int B, string P), BuildingProductMonth>> BuildingProducts(int month)
        => _buildingProduct.TryGetValue(month, out var map) ? map : Enumerable.Empty<KeyValuePair<(int B, string P), BuildingProductMonth>>();

    /// <summary>Retail units/revenue of one company in a market for a retained month.</summary>
    public RetailCell? Retail(string city, string product, int company, int month)
        => Market(city, product, month) is { } market && market.TryGetValue(company, out var cell) ? cell : null;

    /// <summary>Every retail cell of a retained month.</summary>
    public IEnumerable<KeyValuePair<(string City, string P, int C), RetailCell>> RetailCells(int month)
    {
        if (!_retail.TryGetValue(month, out var map)) yield break;
        foreach (var (market, companies) in map)
        {
            foreach (var (company, cell) in companies)
            {
                yield return new KeyValuePair<(string City, string P, int C), RetailCell>((market.City, market.P, company), cell);
            }
        }
    }

    /// <summary>The (city, product) markets that had retail sales in a retained month.</summary>
    public IEnumerable<(string City, string P)> RetailMarkets(int month)
        => _retail.TryGetValue(month, out var map) ? map.Keys : Enumerable.Empty<(string City, string P)>();

    /// <summary>
    /// Realised unit share of <paramref name="company"/> in (city, product) over an
    /// inclusive month range: its retail units ÷ all retail units. Null when nothing sold.
    /// </summary>
    public double? RealisedShare(string city, string product, int company, int from, int to)
    {
        double mine = 0, total = 0;
        for (var m = from; m <= to; m++)
        {
            if (Market(city, product, m) is not { } market) continue;
            foreach (var (c, cell) in market)
            {
                total += cell.Qty;
                if (c == company) mine += cell.Qty;
            }
        }
        return total > 0 ? mine / total : null;
    }

    /// <summary>Every company's retail units in (city, product) over a range.</summary>
    public Dictionary<int, double> RetailUnitsByCompany(string city, string product, int from, int to)
    {
        var result = new Dictionary<int, double>();
        for (var m = from; m <= to; m++)
        {
            if (Market(city, product, m) is not { } market) continue;
            foreach (var (c, cell) in market)
            {
                result.TryGetValue(c, out var q);
                result[c] = q + cell.Qty;
            }
        }
        return result;
    }

    private Dictionary<int, RetailCell>? Market(string city, string product, int month)
        => _retail.TryGetValue(month, out var map) && map.TryGetValue((city, product), out var market) ? market : null;

    /// <summary>Positions (indices into <c>Ledger.Entries</c>) of one company's entries, in ledger order.</summary>
    public IReadOnlyList<int> LedgerPositions(int company)
        => _ledgerByCompany.TryGetValue(company, out var positions) ? positions : Array.Empty<int>();

    /// <summary>Ledger positions dated <paramref name="month"/> (valid while <see cref="Monotonic"/>).</summary>
    public (int Start, int End) LedgerMonth(int month) => _ledgerSlices.Get(month);

    /// <summary>COGS positions dated <paramref name="month"/>.</summary>
    public (int Start, int End) CogsMonth(int month) => _cogsSlices.Get(month);

    /// <summary>Transfer positions dated <paramref name="month"/>.</summary>
    public (int Start, int End) TransferMonth(int month) => _transferSlices.Get(month);

    /// <summary>Tracks [start, end) positions per month for a date-monotonic log.</summary>
    private sealed class MonthSlices
    {
        private readonly Dictionary<int, (int Start, int End)> _slices = new();
        private int _lastMonth = int.MinValue;

        // The run being appended (consecutive positions of one month). Logs append month by
        // month, so almost every Add only extends the run; it is flushed to the map when the
        // month changes or before a query.
        private int _runMonth = int.MinValue;
        private int _runStart;
        private int _runEnd;

        public bool Monotonic { get; private set; } = true;

        public void Add(int month, int position)
        {
            if (month == _runMonth && position == _runEnd)
            {
                _runEnd = position + 1;
                return;
            }
            Flush();
            if (month < _lastMonth) Monotonic = false;
            if (month > _lastMonth) _lastMonth = month;
            _runMonth = month;
            _runStart = position;
            _runEnd = position + 1;
        }

        public (int Start, int End) Get(int month)
        {
            Flush();
            return _slices.TryGetValue(month, out var s) ? s : (0, 0);
        }

        private void Flush()
        {
            if (_runMonth == int.MinValue) return;
            _slices[_runMonth] = _slices.TryGetValue(_runMonth, out var s)
                ? (Math.Min(s.Start, _runStart), Math.Max(s.End, _runEnd))
                : (_runStart, _runEnd);
            _runMonth = int.MinValue;
        }
    }
}
