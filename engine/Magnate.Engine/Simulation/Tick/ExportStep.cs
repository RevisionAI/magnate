using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 11 (econ-audit §4.16): exports.
/// <para>
/// Classic: every building with <see cref="BuildingInstance.AutoExport"/> sells its entire
/// remaining own output (products of its production and extraction slots) to the world market
/// at the effective world price, after retailers have pulled.
/// </para>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, §4.4): the same surplus is gathered from
/// every auto-exporting building first; the world's total volume V of each product sets one price
/// <c>W · ExportMult · (1 + V/Depth)^−½</c>, and every exporter is booked at it (deterministic and
/// order-independent). Perishables (<see cref="ProductTradeProfile.Exportable"/> false) are never
/// exported. Auto-export starts off for new buildings (master plan D7,
/// <see cref="World.ApplyMarketDefaults"/>).
/// </para>
/// </summary>
internal static class ExportStep
{
    public static void Run(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            ExportRealistic(ctx);
            return;
        }

        AutoExportSurplus(ctx);
    }

    private static void AutoExportSurplus(TickContext ctx)
    {
        var world = ctx.World;
        foreach (var building in ctx.Buildings)
        {
            if (!building.AutoExport) continue;

            // Export only products this building actively produces (extraction or recipe).
            var ownOutputs = building.ProductionSlots.Select(s => s.Product)
                .Concat(building.ExtractionSlots.Select(s => s.Product))
                .Distinct()
                .ToList();

            foreach (var productId in ownOutputs)
            {
                var qty = building.Inventory.Get(productId);
                if (qty <= 0) continue;

                var draw = building.Inventory.Take(productId, qty);
                if (draw.Quantity <= 0) continue;

                // Phase 3.65: export revenue uses the *effective* world price
                // so a fired WorldMarketPriceMultiplierEffect actually moves the
                // top-line on auto-export.
                var revenue = (decimal)draw.Quantity * world.GetEffectiveWorldPrice(productId);

                world.RecordCashChange(
                    building.Owner,
                    LedgerCategory.ExportSale,
                    revenue,
                    $"export {draw.Quantity:F2} {productId}",
                    productId,
                    building.Id,
                    draw.Quantity);

                world.RecordCogs(building.Owner, productId, draw.Quantity, draw.Cost, building.Id);
            }
        }
    }

    private static void ExportRealistic(TickContext ctx)
    {
        var world = ctx.World;

        // 1. Gather every exporter's surplus (buildings by id, products in slot order).
        var batches = new List<(BuildingInstance Building, ProductId Product, double Quantity)>();
        var volume = new Dictionary<ProductId, double>();
        foreach (var building in ctx.Buildings)
        {
            if (!building.AutoExport) continue;
            if (!world.SiteInfo.IsOperational(building)) continue;

            var ownOutputs = building.ProductionSlots.OrderBy(s => s.Index).Select(s => s.Product)
                .Concat(building.ExtractionSlots.OrderBy(s => s.Index).Select(s => s.Product))
                .Distinct()
                .ToList();
            foreach (var productId in ownOutputs)
            {
                if (!world.Catalog.Product(productId).Trade.Exportable) continue;
                var qty = building.Inventory.Get(productId);
                if (!(qty > 0)) continue;
                batches.Add((building, productId, qty));
                volume[productId] = volume.TryGetValue(productId, out var v) ? v + qty : qty;
            }
        }

        if (batches.Count == 0) return;

        // 2. One price per product from the world's total volume.
        var prices = new Dictionary<ProductId, decimal>();
        foreach (var (productId, total) in volume.OrderBy(kv => kv.Key.Value, System.StringComparer.Ordinal))
        {
            var price = WorldTrade.ExportPrice(world, world.Catalog.Product(productId), total);
            prices[productId] = price;
            world.MarketState.Exports[productId] = new ExportQuote(ctx.Now, total, price);
        }

        // 3. Book every exporter at that price.
        foreach (var (building, productId, qty) in batches)
        {
            var draw = building.Inventory.Take(productId, qty);
            if (draw.Quantity <= 0) continue;
            var revenue = (decimal)draw.Quantity * prices[productId];
            world.RecordCashChange(
                building.Owner,
                LedgerCategory.ExportSale,
                revenue,
                $"export {draw.Quantity:F2} {productId} @ {prices[productId]:0.####}",
                productId,
                building.Id,
                draw.Quantity);

            world.RecordCogs(building.Owner, productId, draw.Quantity, draw.Cost, building.Id);
        }
    }
}
