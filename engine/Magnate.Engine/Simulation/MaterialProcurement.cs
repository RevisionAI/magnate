using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Ensures a building has enough of a given product in its inventory to proceed.
/// Procurement hierarchy (Phase 2.1):
/// <list type="number">
///   <item>Own on-hand inventory (free; cost basis already in building).</item>
///   <item>Own same-city sources (producers, extractors, warehouses with this product configured) — inventory and cost basis transfer; no cash; logged to <see cref="World.TransferLog"/>.</item>
///   <item>Own other-city sources — same as above, plus a <see cref="LedgerCategory.ShippingCost"/> charge of <see cref="SimulationConstants.InterCityShippingFraction"/> × world-market value. The shipping is **capitalized** into the receiving inventory's cost basis, so it surfaces later as COGS rather than as a period expense.</item>
///   <item>World market at base price — cash leaves via the supplied ledger category, and the same amount is added as cost basis to the destination inventory.</item>
/// </list>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, econ-audit §4.4): world-market purchases
/// pay the landed import price (W × import multiplier) and buy only
/// <c>min(requested, affordable)</c>, where affordable = (cash + undrawn credit − a reserve of
/// <see cref="Rules.MarketRules.CashReserveMonths"/> × monthly fixed costs) ÷ import price (retail
/// restock is exempt from the reserve: it turns back into cash within the month). A shortfall
/// reduces production or restock instead of creating negative cash (fixes E1/E8).
/// </para>
/// </summary>
internal static class MaterialProcurement
{
    public static void EnsureAvailable(
        World world,
        BuildingInstance requester,
        ProductId product,
        double targetQuantity,
        LedgerCategory marketCategory)
    {
        var shortfall = targetQuantity - requester.Inventory.Get(product);
        if (shortfall <= 0) return;

        shortfall = PullFromOwnSources(world, requester, product, shortfall);
        if (shortfall <= 0) return;

        BuyFromMarket(world, requester, product, shortfall, marketCategory);
    }

    private static double PullFromOwnSources(
        World world,
        BuildingInstance requester,
        ProductId product,
        double shortfall)
    {
        var sources = world.Buildings.Values
            .Where(b => b.Owner == requester.Owner
                     && b.Id != requester.Id
                     && IsValidSource(b, product))
            .OrderBy(b => b.City == requester.City ? 0 : 1)
            .ThenBy(b => b.City.Value, System.StringComparer.Ordinal)
            .ThenBy(b => b.Id.Value);

        foreach (var source in sources)
        {
            if (shortfall <= 0) break;
            var draw = source.Inventory.Take(product, shortfall);
            if (draw.Quantity <= 0) continue;

            var addedCost = draw.Cost;

            if (source.City != requester.City)
            {
                var shipping = ChargeShipping(world, requester, source, product, draw.Quantity);
                addedCost += shipping;
            }

            // Quality follows the goods unchanged — shipping/capitalization doesn't affect Q.
            requester.Inventory.Add(product, draw.Quantity, addedCost, draw.AverageQuality);
            shortfall -= draw.Quantity;

            world.TransferLog.Record(new TransferEntry(
                world.Clock.Now,
                requester.Owner,
                source.Id,
                requester.Id,
                product,
                draw.Quantity));
        }

        return shortfall;
    }

    private static bool IsValidSource(BuildingInstance building, ProductId product)
        => building.ProductionSlots.Any(s => s.Product == product)
        || building.ExtractionSlots.Any(s => s.Product == product)
        || building.WarehouseSlots.Any(s => s.Product == product);

    /// <summary>Charge shipping and return the cash amount (positive) so the caller can capitalize it.</summary>
    private static decimal ChargeShipping(
        World world,
        BuildingInstance requester,
        BuildingInstance source,
        ProductId product,
        double quantity)
    {
        // Phase 3.65: shipping uses the *effective* world price so a fired
        // WorldMarketPriceMultiplierEffect propagates to inter-city freight.
        var shippingCost = (decimal)quantity * world.GetEffectiveWorldPrice(product) * SimulationConstants.InterCityShippingFraction;

        world.RecordCashChange(
            requester.Owner,
            LedgerCategory.ShippingCost,
            -shippingCost,
            $"ship {quantity:F2} {product} {source.City} → {requester.City}",
            product,
            requester.Id,
            quantity);

        return shippingCost;
    }

    private static void BuyFromMarket(
        World world,
        BuildingInstance requester,
        ProductId product,
        double quantity,
        LedgerCategory category)
    {
        if (world.Rules.Market.Enabled)
        {
            BuyFromMarketRealistic(world, requester, product, quantity, category);
            return;
        }

        // Phase 3.65: market buy-ins use the *effective* world price so a fired
        // WorldMarketPriceMultiplierEffect actually changes procurement cost.
        var cost = (decimal)quantity * world.GetEffectiveWorldPrice(product);

        world.RecordCashChange(
            requester.Owner,
            category,
            -cost,
            $"market buy {quantity:F2} {product} → {requester.Id}",
            product,
            requester.Id,
            quantity);

        requester.Inventory.Add(product, quantity, cost, SimulationConstants.WorldMarketQuality);
    }

    private static void BuyFromMarketRealistic(
        World world,
        BuildingInstance requester,
        ProductId product,
        double quantity,
        LedgerCategory category)
    {
        var price = world.GetImportPrice(product);
        if (price > 0m)
        {
            var budget = world.ProcurementBudget(requester.Owner, keepReserve: category != LedgerCategory.RetailRestock);
            var affordable = (double)(budget / price);
            if (affordable < quantity) quantity = Math.Floor(affordable);
        }

        if (!(quantity > 0)) return;
        var cost = (decimal)quantity * price;

        world.RecordCashChange(
            requester.Owner,
            category,
            -cost,
            $"market buy {quantity:F2} {product} → {requester.Id}",
            product,
            requester.Id,
            quantity);

        requester.Inventory.Add(product, quantity, cost, SimulationConstants.WorldMarketQuality);
    }
}
