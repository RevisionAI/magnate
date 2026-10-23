using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// Per-company monthly metric rows, appended at every month close and persisted
/// in the save sidecar (bridge-spec §4.6.8). The first row is the start state.
/// Legacy saves (no sidecar) get cash, revenue and net income backfilled exactly
/// from the ledger; the other series start at the load month and report it in
/// <c>missingBefore</c>.
/// </summary>
internal sealed class MetricsHistory
{
    /// <summary>Series names in row order (TS <c>HistorySeries</c>).</summary>
    public static readonly string[] SeriesNames =
    {
        "cash", "revenue", "netIncome", "totalAssets", "equity", "corporateValue",
        "inventoryValue", "buildingValue", "buildings", "topBrand", "topTech",
    };

    private static readonly Dictionary<string, int> SeriesIndex =
        SeriesNames.Select((name, i) => (name, i)).ToDictionary(t => t.name, t => t.i, StringComparer.Ordinal);

    private readonly Dictionary<int, CompanyRows> _rows = new();
    private readonly Dictionary<int, Dictionary<string, int>> _missingBefore = new();

    public static bool IsSeries(string name) => SeriesIndex.ContainsKey(name);

    /// <summary>Append (or replace) the row for <paramref name="month"/> for every company.</summary>
    public void Append(World world, IReadOnlyDictionary<int, CompanyFinancials> financials, int month)
    {
        foreach (var company in world.Companies.Values)
        {
            var id = company.Id.Value;
            if (!financials.TryGetValue(id, out var f)) continue;
            var (topBrand, topTech) = BrandAndTech(world, company.Id);
            var row = new decimal?[SeriesNames.Length];
            row[0] = Cents(f.Cash);
            row[1] = Cents(f.RevenueThisMonth);
            row[2] = Cents(f.NetIncomeThisMonth);
            row[3] = Cents(f.TotalAssets);
            row[4] = Cents(f.Equity);
            row[5] = Cents(f.CorporateValue);
            row[6] = Cents(f.Inventory);
            row[7] = Cents(f.BookValue);
            row[8] = f.Buildings;
            row[9] = Math.Round((decimal)topBrand, 2, MidpointRounding.ToEven);
            row[10] = topTech;
            RowsOf(id).Set(month, row);
        }
    }

    /// <summary>
    /// Rebuild cash, revenue and net income for every month the ledger covers
    /// (legacy loads). Other series are unknown before <paramref name="loadMonth"/>.
    /// </summary>
    public void Backfill(World world, LedgerIndex index, int loadMonth)
    {
        foreach (var company in world.Companies.Values)
        {
            var id = company.Id.Value;
            if (index.FirstMonth(id) is not int first) continue;
            var rows = RowsOf(id);
            for (var m = first; m < loadMonth; m++)
            {
                if (rows.Get(m) is not null) continue;
                var row = new decimal?[SeriesNames.Length];
                row[0] = Cents(index.CashAtMonthEnd(id, m));
                row[1] = Cents(index.Revenue(id, m));
                row[2] = Cents(index.NetIncome(id, m));
                rows.Set(m, row);
            }
            var missing = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var s = 3; s < SeriesNames.Length; s++) missing[SeriesNames[s]] = loadMonth;
            _missingBefore[id] = missing;
        }
    }

    /// <summary>Dense series for one company between two months (inclusive).</summary>
    public CompanySeriesDto Query(int company, IReadOnlyList<string> series, int from, int to)
    {
        _rows.TryGetValue(company, out var rows);
        var map = new Dictionary<string, IReadOnlyList<decimal?>>(StringComparer.Ordinal);
        foreach (var name in series)
        {
            var s = SeriesIndex[name];
            var values = new decimal?[Math.Max(0, to - from + 1)];
            if (rows is not null)
            {
                for (var m = from; m <= to; m++) values[m - from] = rows.Get(m)?[s];
            }
            map[name] = values;
        }
        var missing = new Dictionary<string, DateDto>(StringComparer.Ordinal);
        if (_missingBefore.TryGetValue(company, out var mb))
        {
            foreach (var name in series)
            {
                if (mb.TryGetValue(name, out var month)) missing[name] = Months.Dto(month);
            }
        }
        return new CompanySeriesDto(company, map, missing);
    }

    /// <summary>One value of the row for <paramref name="month"/>, if recorded.</summary>
    public decimal? Value(int company, string series, int month)
        => _rows.TryGetValue(company, out var rows) ? rows.Get(month)?[SeriesIndex[series]] : null;

    /// <summary>
    /// Money series are stored as decimals rounded to cents: charts need no more, the
    /// sidecar stays small, and decimals serialize several times faster than doubles
    /// (a ten-year, all-company history is ≈ 6,600 numbers).
    /// </summary>
    private static decimal Cents(decimal value) => Math.Round(value, 2, MidpointRounding.ToEven);

    /// <summary>
    /// Highest brand over the (product, city) pairs the company advertises or
    /// retails in, and highest tech over the products in its slots.
    /// </summary>
    public static (double TopBrand, int TopTech) BrandAndTech(World world, CompanyId company)
    {
        var brandKeys = new HashSet<(ProductId, CityId)>();
        var techProducts = new HashSet<ProductId>();
        foreach (var c in world.AdCampaigns)
        {
            if (c.Company == company) brandKeys.Add((c.Product, c.City));
        }
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != company) continue;
            foreach (var s in b.RetailSlots)
            {
                brandKeys.Add((s.Product, b.City));
                techProducts.Add(s.Product);
            }
            foreach (var s in b.ProductionSlots) techProducts.Add(s.Product);
            foreach (var s in b.ExtractionSlots) techProducts.Add(s.Product);
            foreach (var s in b.ResearchSlots) techProducts.Add(s.Product);
        }
        var topBrand = 0.0;
        foreach (var (p, city) in brandKeys) topBrand = Math.Max(topBrand, world.GetBrandAwareness(company, p, city));
        var topTech = techProducts.Count == 0 ? EngineConstants.BaseTechLevel : techProducts.Max(p => world.GetTech(company, p));
        return (topBrand, topTech);
    }

    // ------------------------------------------------------------------ persistence

    public HistoryStateDto Save()
    {
        var companies = new List<CompanyHistoryDto>();
        foreach (var (id, rows) in _rows.OrderBy(kv => kv.Key))
        {
            if (rows.Range() is not var (first, last)) continue;
            var dense = new List<IReadOnlyList<decimal?>>(last - first + 1);
            for (var m = first; m <= last; m++)
            {
                dense.Add(rows.Get(m) ?? new decimal?[SeriesNames.Length]);
            }
            Dictionary<string, DateDto>? missing = null;
            if (_missingBefore.TryGetValue(id, out var mb))
            {
                missing = mb.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => Months.Dto(kv.Value));
            }
            companies.Add(new CompanyHistoryDto(id, Months.Dto(first), dense, missing));
        }
        return new HistoryStateDto(SeriesNames, companies);
    }

    public void Restore(HistoryStateDto? state)
    {
        _rows.Clear();
        _missingBefore.Clear();
        if (state?.Companies is null) return;
        var columns = state.Series ?? SeriesNames;
        foreach (var company in state.Companies)
        {
            var rows = RowsOf(company.CompanyId);
            var first = Months.Index(company.Start);
            for (var i = 0; i < company.Rows.Count; i++)
            {
                var stored = company.Rows[i];
                if (stored.Count == 0 || stored.All(v => v is null)) continue;
                var row = new decimal?[SeriesNames.Length];
                for (var c = 0; c < columns.Count && c < stored.Count; c++)
                {
                    if (SeriesIndex.TryGetValue(columns[c], out var s)) row[s] = stored[c];
                }
                rows.Set(first + i, row);
            }
            if (company.MissingBefore is { } missing)
            {
                _missingBefore[company.CompanyId] = missing.ToDictionary(kv => kv.Key, kv => Months.Index(kv.Value), StringComparer.Ordinal);
            }
        }
    }

    private CompanyRows RowsOf(int company)
    {
        if (!_rows.TryGetValue(company, out var rows))
        {
            rows = new CompanyRows();
            _rows[company] = rows;
        }
        return rows;
    }

    /// <summary>One company's rows, dense by month (rows are appended month by month).</summary>
    private sealed class CompanyRows
    {
        private readonly List<decimal?[]?> _rows = new();
        private int _start;

        public decimal?[]? Get(int month)
        {
            var i = month - _start;
            return i >= 0 && i < _rows.Count ? _rows[i] : null;
        }

        public void Set(int month, decimal?[] row)
        {
            if (_rows.Count == 0)
            {
                _start = month;
            }
            else if (month < _start)
            {
                _rows.InsertRange(0, new decimal?[]?[_start - month]);
                _start = month;
            }
            var i = month - _start;
            while (_rows.Count <= i) _rows.Add(null);
            _rows[i] = row;
        }

        /// <summary>First and last month with a row, or null when empty.</summary>
        public (int First, int Last)? Range()
        {
            var first = _rows.FindIndex(r => r is not null);
            if (first < 0) return null;
            return (_start + first, _start + _rows.FindLastIndex(r => r is not null));
        }
    }
}

/// <summary>Persisted metrics history (save sidecar): column names plus dense rows per company.</summary>
public sealed record HistoryStateDto(IReadOnlyList<string>? Series, IReadOnlyList<CompanyHistoryDto>? Companies);

/// <summary>One company's persisted rows, dense from <see cref="Start"/>.</summary>
public sealed record CompanyHistoryDto(
    int CompanyId,
    DateDto Start,
    IReadOnlyList<IReadOnlyList<decimal?>> Rows,
    IReadOnlyDictionary<string, DateDto>? MissingBefore);
