using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

// World news log, effective world prices and event overlays (Phase 3.65).
public sealed partial class World
{
    /// <summary>
    /// Append-only world news log (Phase 3.65). Every fired
    /// <see cref="EventDefinition"/> writes one <see cref="NewsEntry"/> here for
    /// UI tickers and feed displays. Persisted across save/load (schema v9+).
    /// </summary>
    public IReadOnlyList<NewsEntry> NewsLog => _newsLog;

    /// <summary>
    /// All currently in-flight world-market price multipliers (Phase 3.65).
    /// Returned as a read-only snapshot ordered by product id for deterministic
    /// presentation. Internally indexed by <see cref="ProductId"/> — one active
    /// effect per product max (no stacking).
    /// </summary>
    public IReadOnlyList<ActivePriceEffect> ActivePriceEffects
    {
        get
        {
            var list = new List<ActivePriceEffect>(_activePriceEffects.Count);
            foreach (var kvp in _activePriceEffects.OrderBy(kv => kv.Key.Value, StringComparer.Ordinal))
            {
                list.Add(kvp.Value);
            }
            return list;
        }
    }

    /// <summary>
    /// Effective world-market price for <paramref name="product"/>: the product's
    /// catalog <c>BaseWorldMarketPrice</c> multiplied by the active price-effect
    /// multiplier (defaults to 1.0 when no effect is in flight). This is the
    /// price all sim-side cash flows that reference the world market — purchases,
    /// inter-city shipping, surplus exports — should use, so the
    /// <see cref="WorldMarketPriceMultiplierEffect"/> actually has gameplay impact.
    /// </summary>
    public decimal GetEffectiveWorldPrice(ProductId product)
    {
        var basePrice = (decimal)Catalog.Product(product).BaseWorldMarketPrice;
        if (_activePriceEffects.TryGetValue(product, out var effect))
        {
            return basePrice * effect.Multiplier;
        }
        return basePrice;
    }

    /// <summary>
    /// Record one entry in the world news log. Called by <see cref="EventEngine"/>
    /// when an event fires; also available to other systems that want to surface
    /// a beat (none today — kept open for future phases).
    /// </summary>
    public void RecordNewsEntry(NewsEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _newsLog.Add(entry);
    }

    /// <summary>
    /// Internal helper used by <see cref="EventEngine"/> to apply a fired
    /// <see cref="WorldMarketPriceMultiplierEffect"/>. Replaces any existing
    /// entry for the product (no stacking — Phase 3.65 simplification).
    /// </summary>
    internal void SetActivePriceEffect(ActivePriceEffect effect)
    {
        ArgumentNullException.ThrowIfNull(effect);
        _activePriceEffects[new ProductId(effect.ProductId)] = effect;
    }

    /// <summary>
    /// Internal helper used by <see cref="MonthlyTick"/> to decrement durations
    /// on every active price effect and remove any whose remaining months reach
    /// zero. Iteration order is product-id ordinal so the reduction is
    /// deterministic.
    /// </summary>
    internal void TickActivePriceEffects()
    {
        var keys = _activePriceEffects.Keys
            .OrderBy(k => k.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var key in keys)
        {
            var current = _activePriceEffects[key];
            var remaining = current.RemainingMonths - 1;
            if (remaining <= 0)
            {
                _activePriceEffects.Remove(key);
            }
            else
            {
                _activePriceEffects[key] = current with { RemainingMonths = remaining };
            }
        }
    }

    /// <summary>
    /// Internal helper used by <see cref="EventEngine"/> to apply a fired
    /// <see cref="BrandShiftEffect"/>. Bumps awareness for every company with
    /// an existing entry on (product, city) and clamps to [0, 100]. Companies
    /// with no prior brand on that (product, city) are <em>not</em> bootstrapped
    /// from zero — a "shift" only acts on existing awareness so that shouting
    /// doesn't create demand from thin air.
    /// </summary>
    internal void ApplyBrandShift(ProductId product, CityId city, int delta)
    {
        if (delta == 0) return;

        var keys = _brandAwareness.Keys
            .Where(k => k.Product == product && k.City == city)
            .OrderBy(k => k.Company.Value)
            .ToList();

        foreach (var key in keys)
        {
            var current = _brandAwareness[key];
            var next = current + delta;
            if (next < 0) next = 0;
            if (next > 100) next = 100;
            _brandAwareness[key] = next;
        }
    }
}
