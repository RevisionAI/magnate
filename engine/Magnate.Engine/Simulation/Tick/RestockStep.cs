using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 9 (econ-audit §4.16): restock — warehouses first (to their slot target stock, booked as
/// <see cref="LedgerCategory.InputPurchase"/>), then retailers (to their restock target, booked as
/// <see cref="LedgerCategory.RetailRestock"/>), each through <see cref="MaterialProcurement"/>.
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, §4.3–4.4, §4.7): a store restocks each
/// <em>line</em> (all its slots for one product) to Σ slot targets clamped to the stock cap
/// (1.5 × monthly throughput); a format that does not draw the product's category restocks
/// nothing; a warehouse slot holds at most <see cref="BuildingType.StorageValuePerSlot"/> of stock
/// at world price; world-market purchases are capped by what the company can afford (inside
/// <see cref="MaterialProcurement"/>); buildings under construction are skipped.
/// </para>
/// </summary>
internal static class RestockStep
{
    public static void Run(TickContext ctx)
    {
        RestockWarehouses(ctx);
        RestockRetailers(ctx);
    }

    private static void RestockWarehouses(TickContext ctx)
    {
        var world = ctx.World;
        var realistic = ctx.Rules.Market.Enabled;
        foreach (var building in ctx.Buildings)
        {
            if (building.WarehouseSlots.Count == 0) continue;
            if (realistic && !world.SiteInfo.IsOperational(building)) continue;
            var valueCap = realistic ? world.Catalog.BuildingType(building.TypeId).StorageValuePerSlot : null;

            foreach (var slot in building.WarehouseSlots.OrderBy(s => s.Index))
            {
                var target = slot.TargetStock;
                if (valueCap is decimal cap)
                {
                    var price = world.GetEffectiveWorldPrice(slot.Product);
                    if (price > 0m) target = Math.Min(target, (double)(cap / price));
                }

                MaterialProcurement.EnsureAvailable(
                    world,
                    building,
                    slot.Product,
                    target,
                    LedgerCategory.InputPurchase);
            }
        }
    }

    private static void RestockRetailers(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            RestockRetailLines(ctx);
            return;
        }

        foreach (var building in ctx.Buildings)
        {
            if (building.RetailSlots.Count == 0) continue;

            foreach (var slot in building.RetailSlots.OrderBy(s => s.Index))
            {
                MaterialProcurement.EnsureAvailable(
                    ctx.World,
                    building,
                    slot.Product,
                    slot.RestockTarget,
                    LedgerCategory.RetailRestock);
            }
        }
    }

    private static void RestockRetailLines(TickContext ctx)
    {
        var world = ctx.World;
        foreach (var building in ctx.Buildings)
        {
            if (building.RetailSlots.Count == 0) continue;

            // One line per product, in order of the line's lowest slot index.
            var products = building.RetailSlots
                .OrderBy(s => s.Index)
                .Select(s => s.Product)
                .Distinct()
                .ToList();
            foreach (var productId in products)
            {
                var line = RetailMarket.LineOf(world, building, productId);
                if (line is null) continue;
                var product = world.Catalog.Product(productId);
                var target = product.Demand is null ? 0 : RetailMarket.RestockTarget(world, line, product);
                if (!(target > 0)) continue;

                MaterialProcurement.EnsureAvailable(world, building, productId, target, LedgerCategory.RetailRestock);
            }
        }
    }
}
