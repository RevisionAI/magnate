using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>
/// Line and rig equipment (econ-audit §4.7 P0): a production or extraction slot pays its
/// equipment capex the first month it runs a product, booked as
/// <see cref="LedgerCategory.EquipmentPurchase"/> (investing) and capitalised into the building's
/// <see cref="BuildingInstance.CapitalizedCost"/> so the books keep closing. Re-tooling a slot to
/// another product buys that product's equipment (P0: full price; P1 makes it 25 %).
/// </summary>
internal static class Equipment
{
    /// <summary>
    /// True when the slot's equipment for <paramref name="product"/> is in place, buying it now if
    /// needed and affordable. False when the company cannot pay: the slot idles this month.
    /// </summary>
    public static bool EnsureInstalled(World world, BuildingInstance building, int slotIndex, ProductId product, decimal capex)
    {
        if (!world.Rules.Market.ChargeLineEquipment || capex <= 0m) return true;
        var key = (building.Id, slotIndex);
        var installed = world.MarketState.Equipment.TryGetValue(key, out var existing) ? existing : null;
        if (installed is not null && installed.Product == product) return true;
        if (world.ProcurementBudget(building.Owner) < capex) return false;

        world.RecordCashChange(building.Owner, LedgerCategory.EquipmentPurchase, -capex,
            $"equipment for {product} (slot {slotIndex})", product, building.Id);
        if (world.Rules.Finance.Enabled)
        {
            // Finance books (E2): a registered equipment component depreciated over its §4.8 life.
            world.CapitalizeEquipment(building.Id, capex, Finance.AssetClasses.EquipmentLifeMonths(world.Catalog.BuildingType(building.TypeId)));
        }
        else
        {
            building.CapitalizedCost += capex;
        }
        world.MarketState.Equipment[key] = new InstalledEquipment(product, (installed?.Cost ?? 0m) + capex);
        world.MarketState.InvalidateFixedCosts();
        return true;
    }
}
