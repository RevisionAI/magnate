using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence.Sections;

/// <summary>
/// Schema-v10 save section for the market area (E1): the trailing per-market unit sales behind
/// <see cref="World.GetMarketShare"/>, the store-line reports and trailing line sales the AI
/// restocks from, the equipment already paid for per slot, and the last aggregate export per
/// product. Serialised as the nullable <c>market</c> property of the save file; omitted for
/// Classic worlds (and whenever there is nothing to persist).
/// <para>
/// Every list is written in a canonical sorted order, so a save → load → save round trip is
/// byte-identical regardless of in-memory insertion order. Decimals are invariant-culture
/// strings like the rest of the save; doubles use System.Text.Json's round-trip format.
/// Incumbent masses are not persisted: P0 incumbents are a pure function of content and rules.
/// </para>
/// </summary>
internal sealed record MarketSaveSection
{
    /// <summary>Market unit sales of the kept months (up to 24), oldest first.</summary>
    public IReadOnlyList<MarketMonthDto>? History { get; init; }

    /// <summary>Latest report and trailing sales per store line, by (building, product).</summary>
    public IReadOnlyList<RetailLineDto>? Lines { get; init; }

    /// <summary>Installed equipment, by (building, slot).</summary>
    public IReadOnlyList<EquipmentDto>? Equipment { get; init; }

    /// <summary>Last aggregate export per product.</summary>
    public IReadOnlyList<ExportDto>? Exports { get; init; }

    /// <summary>
    /// Snapshot the area's state, or return <c>null</c> when there is nothing to persist (the
    /// section is then omitted from the save).
    /// </summary>
    internal static MarketSaveSection? Capture(World world)
    {
        var state = world.MarketState;
        if (state.History.Count == 0 && state.Lines.Count == 0 && state.Equipment.Count == 0 && state.Exports.Count == 0)
        {
            return null;
        }

        static string Dec(decimal d) => d.ToString(CultureInfo.InvariantCulture);

        var history = state.History.Select(m => new MarketMonthDto(
            m.Month.Year,
            m.Month.Month,
            m.Cells
                .OrderBy(kv => kv.Key.City.Value, StringComparer.Ordinal)
                .ThenBy(kv => kv.Key.Product.Value, StringComparer.Ordinal)
                .Select(kv => new MarketCellDto(
                    kv.Key.City.Value,
                    kv.Key.Product.Value,
                    kv.Value.IncumbentUnits,
                    kv.Value.CompanyUnits.Select(u => new CompanyUnitsDto(u.Key, u.Value)).ToList()))
                .ToList())).ToList();

        var lines = state.Lines
            .OrderBy(kv => kv.Key.Building.Value)
            .ThenBy(kv => kv.Key.Product.Value, StringComparer.Ordinal)
            .Select(kv =>
            {
                var r = kv.Value;
                var trailing = state.LineHistory.TryGetValue(kv.Key, out var list)
                    ? list.Select(x => new LineMonthDto(x.Month.Year, x.Month.Month, x.Sold)).ToList()
                    : new List<LineMonthDto>();
                return new RetailLineDto(kv.Key.Building.Value, kv.Key.Product.Value, r.Month.Year, r.Month.Month, Dec(r.Price), r.Slots,
                    r.Capacity, r.Demand, r.Sold, Dec(r.Revenue), r.EndStock, trailing);
            })
            .ToList();

        var equipment = state.Equipment
            .OrderBy(kv => kv.Key.Building.Value)
            .ThenBy(kv => kv.Key.Slot)
            .Select(kv => new EquipmentDto(kv.Key.Building.Value, kv.Key.Slot, kv.Value.Product.Value, Dec(kv.Value.Cost)))
            .ToList();

        var exports = state.Exports
            .OrderBy(kv => kv.Key.Value, StringComparer.Ordinal)
            .Select(kv => new ExportDto(kv.Key.Value, kv.Value.Month.Year, kv.Value.Month.Month, kv.Value.Volume, Dec(kv.Value.UnitPrice)))
            .ToList();

        return new MarketSaveSection
        {
            History = history,
            Lines = lines,
            Equipment = equipment,
            Exports = exports,
        };
    }

    /// <summary>
    /// Apply a persisted section to a freshly rebuilt world. Called after every core collection
    /// (companies, buildings, logs, RNG) has been restored; <paramref name="section"/> is null
    /// for saves that did not write it.
    /// </summary>
    internal static void Restore(World world, MarketSaveSection? section)
    {
        if (section is null) return;
        var state = world.MarketState;
        static decimal Dec(string s) => decimal.Parse(s, NumberStyles.Number, CultureInfo.InvariantCulture);

        foreach (var m in section.History ?? Array.Empty<MarketMonthDto>())
        {
            var month = state.OpenMonth(new GameDate(m.Year, m.Month));
            foreach (var c in m.Cells ?? Array.Empty<MarketCellDto>())
            {
                var cell = month.Cell(new CityId(c.City), new ProductId(c.Product));
                cell.IncumbentUnits = c.IncumbentUnits;
                foreach (var u in c.Companies ?? Array.Empty<CompanyUnitsDto>()) cell.CompanyUnits[u.Company] = u.Units;
            }
        }

        foreach (var l in section.Lines ?? Array.Empty<RetailLineDto>())
        {
            var key = (new BuildingInstanceId(l.Building), new ProductId(l.Product));
            state.Lines[key] = new RetailLineReport(new GameDate(l.Year, l.Month), Dec(l.Price), l.Slots, l.Capacity, l.Demand, l.Sold,
                Dec(l.Revenue), l.EndStock);
            state.LineHistory[key] = (l.History ?? Array.Empty<LineMonthDto>())
                .Select(h => (new GameDate(h.Year, h.Month), h.Sold))
                .ToList();
        }

        foreach (var e in section.Equipment ?? Array.Empty<EquipmentDto>())
        {
            state.Equipment[(new BuildingInstanceId(e.Building), e.Slot)] = new InstalledEquipment(new ProductId(e.Product), Dec(e.Cost));
        }

        foreach (var x in section.Exports ?? Array.Empty<ExportDto>())
        {
            state.Exports[new ProductId(x.Product)] = new ExportQuote(new GameDate(x.Year, x.Month), x.Volume, Dec(x.UnitPrice));
        }
    }
}

/// <summary>One month of market unit sales.</summary>
internal sealed record MarketMonthDto(int Year, int Month, IReadOnlyList<MarketCellDto> Cells);

/// <summary>Units sold in one (city, product) market in one month.</summary>
internal sealed record MarketCellDto(string City, string Product, double IncumbentUnits, IReadOnlyList<CompanyUnitsDto> Companies);

/// <summary>Units one company sold.</summary>
internal sealed record CompanyUnitsDto(int Company, double Units);

/// <summary>A store line's latest report plus its trailing monthly sales.</summary>
internal sealed record RetailLineDto(
    int Building,
    string Product,
    int Year,
    int Month,
    string Price,
    int Slots,
    double Capacity,
    double Demand,
    double Sold,
    string Revenue,
    double EndStock,
    IReadOnlyList<LineMonthDto> History);

/// <summary>Units a store line sold in one month.</summary>
internal sealed record LineMonthDto(int Year, int Month, double Sold);

/// <summary>Equipment paid for in one slot.</summary>
internal sealed record EquipmentDto(int Building, int Slot, string Product, string Cost);

/// <summary>Last aggregate export of a product.</summary>
internal sealed record ExportDto(string Product, int Year, int Month, double Volume, string UnitPrice);
