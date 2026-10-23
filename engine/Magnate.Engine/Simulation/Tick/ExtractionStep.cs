using System;
using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 7 (econ-audit §4.16): extraction. Every extraction slot adds the product's yield to its
/// building's inventory at <see cref="SimulationConstants.ExtractionQuality"/>.
/// <para>
/// Classic: zero cost basis (variable costing — the building's opex hits the P&amp;L as a period
/// cost).
/// </para>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>): the slot's equipment is paid for the
/// first month it runs (<see cref="LedgerCategory.EquipmentPurchase"/>, capitalised into the
/// building); each unit's cash cost (<see cref="Domain.ProductExtraction.OtherCostPerUnit"/>) is
/// charged as <see cref="LedgerCategory.OtherMaterials"/> and capitalised into the raw's cost
/// basis. Output is cut to what the company can pay for and to the slot's buffer
/// (<see cref="Rules.MarketRules.OutputBufferMonths"/>); buildings under construction do not
/// extract.
/// </para>
/// </summary>
internal static class ExtractionStep
{
    public static void Run(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            RunRealistic(ctx);
            return;
        }

        var world = ctx.World;

        // Extracted raws enter inventory with ZERO cost basis. Period costs (the building's
        // monthly opex) hit P&L directly and are not absorbed into inventory cost — i.e.
        // we use variable costing, not absorption costing. Phase 2 may revisit this.
        foreach (var building in ctx.Buildings)
        {
            if (building.ExtractionSlots.Count == 0) continue;

            foreach (var slot in building.ExtractionSlots.OrderBy(s => s.Index))
            {
                var product = world.Catalog.Product(slot.Product);
                if (product.Extraction is null) continue; // defensive; configure() guards this

                building.Inventory.Add(
                    slot.Product,
                    product.Extraction.YieldPerSlotPerMonth,
                    cost: 0m,
                    quality: SimulationConstants.ExtractionQuality);
            }
        }
    }

    private static void RunRealistic(TickContext ctx)
    {
        var world = ctx.World;
        foreach (var building in ctx.Buildings)
        {
            if (building.ExtractionSlots.Count == 0) continue;
            if (!world.SiteInfo.IsOperational(building)) continue;

            foreach (var slot in building.ExtractionSlots.OrderBy(s => s.Index))
            {
                var product = world.Catalog.Product(slot.Product);
                if (product.Extraction is not { } extraction) continue;

                // Output buffer (as production): top the raw up to OutputBufferMonths of output.
                var slots = building.ExtractionSlots.Count(s => s.Product == product.Id);
                var room = world.Rules.Market.OutputBufferMonths * extraction.YieldPerSlotPerMonth * slots - building.Inventory.Get(product.Id);
                if (!(room > 0)) continue;
                if (!Equipment.EnsureInstalled(world, building, slot.Index, product.Id, extraction.EquipmentCapex)) continue;

                var units = Math.Min(extraction.YieldPerSlotPerMonth, room);
                var unitCost = extraction.OtherCostPerUnit;
                if (unitCost > 0m)
                {
                    var affordable = (double)(world.ProcurementBudget(building.Owner) / unitCost);
                    units = Math.Min(units, Math.Floor(affordable));
                }

                if (!(units > 0)) continue;
                var cost = (decimal)units * unitCost;
                if (cost > 0m)
                {
                    world.RecordCashChange(building.Owner, LedgerCategory.OtherMaterials, -cost,
                        $"extraction cost {units:F2} {product.Id}", product.Id, building.Id, units);
                }

                building.Inventory.Add(product.Id, units, cost, SimulationConstants.ExtractionQuality);
            }
        }
    }
}
