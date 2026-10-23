using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

/// <summary>
/// The result of taking goods from an <see cref="Inventory"/>: the quantity
/// actually removed, the proportional cost basis released, and the weighted-average
/// quality of the goods that came out.
/// </summary>
public readonly record struct InventoryDraw(double Quantity, decimal Cost, double AverageQuality);

/// <summary>
/// Mutable per-product store attached to a building. Tracks:
/// <list type="bullet">
///   <item>Quantity</item>
///   <item>Total cost basis (Phase 2.1 WAC)</item>
///   <item>Total quality-mass = Σ (quality × quantity) across batches added (Phase 2.2)</item>
/// </list>
/// When goods are added, all three grow; when goods are taken, all three shrink
/// proportionally. This is blend-and-average semantics — appropriate for fungible
/// goods with no batch tracking.
/// </summary>
public sealed class Inventory
{
    private readonly Dictionary<ProductId, Entry> _entries = new();

    private struct Entry
    {
        public double Qty;
        public decimal Cost;
        /// <summary>Sum of (Q × qty) across blended batches. Average Q = QualityMass / Qty.</summary>
        public double QualityMass;
    }

    /// <summary>Quantity on hand (0 when the product was never stocked).</summary>
    public double Get(ProductId product)
        => _entries.TryGetValue(product, out var e) ? e.Qty : 0.0;

    /// <summary>Total cost basis on hand for a single product.</summary>
    public decimal CostOf(ProductId product)
        => _entries.TryGetValue(product, out var e) ? e.Cost : 0m;

    /// <summary>Weighted-average quality of this product currently in the inventory (0 if empty).</summary>
    public double AverageQuality(ProductId product)
    {
        if (!_entries.TryGetValue(product, out var e) || e.Qty <= 0) return 0.0;
        return e.QualityMass / e.Qty;
    }

    /// <summary>Sum of cost basis across all products in this inventory.</summary>
    public decimal TotalValue()
    {
        decimal total = 0m;
        foreach (var (_, e) in _entries) total += e.Cost;
        return total;
    }

    /// <summary>
    /// Add <paramref name="quantity"/> units with total cost basis <paramref name="cost"/> at
    /// <paramref name="quality"/>, blending into the weighted averages. Ignored for quantity ≤ 0.
    /// Engine code only: a direct call creates stock without any ledger entry.
    /// </summary>
    public void Add(ProductId product, double quantity, decimal cost, double quality)
    {
        if (quantity <= 0) return;
        _entries.TryGetValue(product, out var e);
        e.Qty += quantity;
        e.Cost += cost;
        e.QualityMass += quality * quantity;
        _entries[product] = e;
    }

    /// <summary>
    /// Remove up to <paramref name="quantity"/> units; returns the actual quantity
    /// removed, the proportional share of its cost basis, and the blended average
    /// quality of the inventory at the moment of the draw.
    /// </summary>
    public InventoryDraw Take(ProductId product, double quantity)
    {
        if (quantity <= 0) return new InventoryDraw(0, 0m, 0);
        if (!_entries.TryGetValue(product, out var e) || e.Qty <= 0)
        {
            return new InventoryDraw(0, 0m, 0);
        }

        var avgQ = e.QualityMass / e.Qty;
        var actual = e.Qty >= quantity ? quantity : e.Qty;
        decimal costRemoved;

        if (actual >= e.Qty)
        {
            // Taking everything — release the full cost and quality basis.
            costRemoved = e.Cost;
            e.Qty = 0;
            e.Cost = 0m;
            e.QualityMass = 0;
        }
        else
        {
            costRemoved = (decimal)(actual / e.Qty) * e.Cost;
            e.Qty -= actual;
            e.Cost -= costRemoved;
            e.QualityMass -= avgQ * actual;
        }

        _entries[product] = e;
        return new InventoryDraw(actual, costRemoved, avgQ);
    }

    /// <summary>
    /// Restore one entry exactly as persisted (schema v10): quantity, cost basis and quality mass
    /// verbatim, created even when empty, appended in call order. Used by the loader so a
    /// save/load round trip reproduces the inventory bit for bit — including enumeration order,
    /// which <see cref="TotalValue"/>'s decimal summation depends on.
    /// </summary>
    internal void Restore(ProductId product, double quantity, decimal cost, double qualityMass)
    {
        _entries[product] = new Entry { Qty = quantity, Cost = cost, QualityMass = qualityMass };
    }

    /// <summary>Raw per-product state in enumeration (insertion) order, for persistence.</summary>
    internal IEnumerable<(ProductId Product, double Quantity, decimal Cost, double QualityMass)> RawEntries
        => _entries.Select(kvp => (kvp.Key, kvp.Value.Qty, kvp.Value.Cost, kvp.Value.QualityMass));

    /// <summary>Backwards-compatible quantity-only enumeration.</summary>
    public IEnumerable<KeyValuePair<ProductId, double>> Entries
        => _entries.Select(kvp => new KeyValuePair<ProductId, double>(kvp.Key, kvp.Value.Qty));

    /// <summary>Cost- and quality-aware enumeration.</summary>
    public IEnumerable<(ProductId Product, double Quantity, decimal Cost, double AverageQuality)> EntriesWithCost
        => _entries.Select(kvp => (
            kvp.Key,
            kvp.Value.Qty,
            kvp.Value.Cost,
            kvp.Value.Qty > 0 ? kvp.Value.QualityMass / kvp.Value.Qty : 0.0));
}
