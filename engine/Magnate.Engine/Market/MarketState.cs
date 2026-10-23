using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>
/// Last month's result of one store line: a building's merged retail slots for one product
/// (econ-audit §4.1; bridge-spec E10 retail part). Persisted, because the AI's restock rule reads
/// trailing sales.
/// </summary>
/// <param name="Month">The month the line traded.</param>
/// <param name="Price">Offer price.</param>
/// <param name="Slots">Retail slots merged into the line.</param>
/// <param name="Capacity">Throughput capacity (units/month).</param>
/// <param name="Demand">Demand allocated before capacity and spill.</param>
/// <param name="Sold">Units sold, including spill.</param>
/// <param name="Revenue">Sales revenue.</param>
/// <param name="EndStock">Units left on the shelf after sales.</param>
public sealed record RetailLineReport(
    GameDate Month,
    decimal Price,
    int Slots,
    double Capacity,
    double Demand,
    double Sold,
    decimal Revenue,
    double EndStock)
{
    /// <summary>Demand the line could not serve itself (part of it may have spilled to rivals).</summary>
    public double Unserved => Math.Max(0, Demand - Sold);

    /// <summary>True when the shelf ran empty.</summary>
    public bool SoldOut => EndStock <= 1e-9 && Sold > 0;
}

/// <summary>A production line or extraction rig whose equipment has been paid for.</summary>
/// <param name="Product">Product the equipment makes.</param>
/// <param name="Cost">Capex paid (capitalised into the building).</param>
public sealed record InstalledEquipment(ProductId Product, decimal Cost);

/// <summary>Units sold in one (city, product) market in one month.</summary>
internal sealed class MarketMonthCell
{
    public SortedDictionary<int, double> CompanyUnits { get; } = new();

    public double IncumbentUnits { get; set; }
}

/// <summary>One month of market-wide unit sales.</summary>
internal sealed class MarketMonth
{
    public MarketMonth(GameDate month) => Month = month;

    public GameDate Month { get; }

    public Dictionary<(CityId City, ProductId Product), MarketMonthCell> Cells { get; } = new();

    public MarketMonthCell Cell(CityId city, ProductId product)
    {
        if (!Cells.TryGetValue((city, product), out var cell))
        {
            cell = new MarketMonthCell();
            Cells[(city, product)] = cell;
        }

        return cell;
    }
}

/// <summary>Last month's aggregate export of one product (econ-audit §4.4).</summary>
/// <param name="Month">Month of the export.</param>
/// <param name="Volume">Units exported by all companies.</param>
/// <param name="UnitPrice">The one price every exporter received.</param>
public sealed record ExportQuote(GameDate Month, double Volume, decimal UnitPrice);

/// <summary>
/// Per-world mutable state of the market area (never static). Persisted by
/// <see cref="Persistence.Sections.MarketSaveSection"/>; the curve cache and the fixed-cost
/// cache are derived and rebuilt on demand.
/// </summary>
internal sealed class MarketState
{
    /// <summary>Months of history behind trailing statistics (market share, restock).</summary>
    public const int TrailingMonths = 3;

    /// <summary>
    /// Months of market unit sales kept (and saved) for windowed queries such as
    /// <see cref="World.GetIncumbentUnitsSold"/>; the trailing statistics read the last
    /// <see cref="TrailingMonths"/> of them.
    /// </summary>
    public const int HistoryMonths = 24;

    public DemandCurveCache Curves { get; } = new();

    /// <summary>Market unit sales of the last <see cref="HistoryMonths"/> months, oldest first (one per tick).</summary>
    public List<MarketMonth> History { get; } = new();

    /// <summary>The last <see cref="TrailingMonths"/> months of <see cref="History"/>, oldest first.</summary>
    public IEnumerable<MarketMonth> Trailing => History.Skip(Math.Max(0, History.Count - TrailingMonths));

    /// <summary>Latest report per store line.</summary>
    public Dictionary<(BuildingInstanceId Building, ProductId Product), RetailLineReport> Lines { get; } = new();

    /// <summary>Units sold per store line over the trailing months, most recent last.</summary>
    public Dictionary<(BuildingInstanceId Building, ProductId Product), List<(GameDate Month, double Sold)>> LineHistory { get; } = new();

    /// <summary>Equipment already paid for, per (building, slot index).</summary>
    public Dictionary<(BuildingInstanceId Building, int Slot), InstalledEquipment> Equipment { get; } = new();

    /// <summary>Last export per product.</summary>
    public Dictionary<ProductId, ExportQuote> Exports { get; } = new();

    // Derived per-tick cache of each company's monthly fixed costs (cash-reserve rule).
    private GameDate _fixedCostMonth = new(int.MinValue, 1);
    private readonly Dictionary<CompanyId, decimal> _fixedCosts = new();

    public MarketMonth OpenMonth(GameDate month)
    {
        if (History.Count > 0 && History[^1].Month == month) return History[^1];
        var record = new MarketMonth(month);
        History.Add(record);
        while (History.Count > HistoryMonths) History.RemoveAt(0);
        return record;
    }

    public void RecordLine(BuildingInstanceId building, ProductId product, RetailLineReport report)
    {
        Lines[(building, product)] = report;
        if (!LineHistory.TryGetValue((building, product), out var list))
        {
            list = new List<(GameDate, double)>();
            LineHistory[(building, product)] = list;
        }

        if (list.Count > 0 && list[^1].Month == report.Month) list[^1] = (report.Month, report.Sold);
        else list.Add((report.Month, report.Sold));
        while (list.Count > TrailingMonths) list.RemoveAt(0);
    }

    /// <summary>Drop line statistics that have not traded within the trailing window.</summary>
    public void PruneLines(GameDate now)
    {
        var horizon = now.AsMonthIndex() - TrailingMonths;
        foreach (var key in Lines.Where(kv => kv.Value.Month.AsMonthIndex() <= horizon).Select(kv => kv.Key).ToList())
        {
            Lines.Remove(key);
            LineHistory.Remove(key);
        }
    }

    public decimal InstalledEquipmentCost(BuildingInstanceId building)
    {
        decimal total = 0m;
        foreach (var ((b, _), eq) in Equipment.OrderBy(kv => kv.Key.Slot))
        {
            if (b == building) total += eq.Cost;
        }

        return total;
    }

    public bool TryGetFixedCosts(GameDate month, CompanyId company, out decimal value)
    {
        if (_fixedCostMonth != month)
        {
            _fixedCosts.Clear();
            _fixedCostMonth = month;
        }

        return _fixedCosts.TryGetValue(company, out value);
    }

    public void CacheFixedCosts(GameDate month, CompanyId company, decimal value)
    {
        if (_fixedCostMonth != month)
        {
            _fixedCosts.Clear();
            _fixedCostMonth = month;
        }

        _fixedCosts[company] = value;
    }

    public void InvalidateFixedCosts() => _fixedCosts.Clear();
}
