using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 8 (econ-audit §4.16): production — intermediate tier first, then finished goods, so a
/// finished-goods line can consume this month's intermediate output. Each production slot runs
/// up to <see cref="Recipe.CyclesPerSlotMonth"/> recipe cycles (the content's
/// <c>outputPerSlotMonth</c>, or the legacy 200 cycles); inputs come through
/// <see cref="MaterialProcurement"/> (own stock → own sources → world market); output cost basis is
/// the drawn input cost and output quality the quantity-weighted input quality.
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, §4.5–4.7): the slot's line equipment is
/// paid the first month it runs; other purchased materials (<see cref="Recipe.OtherCostPerUnit"/>,
/// ledger <see cref="LedgerCategory.OtherMaterials"/>) and production energy
/// (<see cref="Recipe.KwhPerUnit"/> × industrial tariff, <see cref="LedgerCategory.ProductionEnergy"/>)
/// are charged and capitalised into the output's cost basis; output is cut to what the company can
/// pay for and to the slot's finished-goods buffer (<see cref="Rules.MarketRules.OutputBufferMonths"/>);
/// buildings under construction do not produce. Quality formation is P1.
/// </para>
/// </summary>
internal static class ProductionStep
{
    public static void Run(TickContext ctx)
    {
        RunTier(ctx, ProductTier.Intermediate);
        RunTier(ctx, ProductTier.Finished);
    }

    private static void RunTier(TickContext ctx, ProductTier targetTier)
    {
        var world = ctx.World;
        var realistic = ctx.Rules.Market.Enabled;
        foreach (var building in ctx.Buildings)
        {
            if (building.ProductionSlots.Count == 0) continue;
            if (realistic && !world.SiteInfo.IsOperational(building)) continue;

            foreach (var slot in building.ProductionSlots.OrderBy(s => s.Index))
            {
                var product = world.Catalog.Product(slot.Product);
                if (product.Tier != targetTier) continue;
                if (product.Recipe is null) continue; // defensive

                if (realistic) ProduceRealistic(world, building, slot.Index, product, product.Recipe);
                else ProduceAt(world, building, product, product.Recipe);
            }
        }
    }

    private static void ProduceAt(World world, BuildingInstance building, Product product, Recipe recipe)
    {
        if (recipe.OutputPerSlotMonth is not null)
        {
            ProduceContinuous(world, building, product, recipe, recipe.CyclesPerSlotMonth, capitaliseConversion: false);
            return;
        }

        var maxCycles = SimulationConstants.CyclesPerSlotPerMonth;
        if (maxCycles <= 0) return;

        // Procure inputs through the routing hierarchy.
        foreach (var input in recipe.Inputs)
        {
            var needed = input.Quantity * maxCycles;
            MaterialProcurement.EnsureAvailable(world, building, input.ProductId, needed, LedgerCategory.InputPurchase);
        }

        // Compute actual cycles based on what we managed to gather.
        var cyclesActual = maxCycles;
        foreach (var input in recipe.Inputs)
        {
            var available = building.Inventory.Get(input.ProductId);
            var cyclesForInput = (int)Math.Floor(available / input.Quantity);
            if (cyclesForInput < cyclesActual) cyclesActual = cyclesForInput;
        }

        if (cyclesActual <= 0) return;

        // Consume inputs; accumulate cost (rolls upstream cost into finished-good WAC)
        // and quality-mass (weighted by input quantity → output quality).
        decimal totalInputCost = 0m;
        double qualityMass = 0.0;
        double totalInputQuantity = 0.0;
        foreach (var input in recipe.Inputs)
        {
            var draw = building.Inventory.Take(input.ProductId, input.Quantity * cyclesActual);
            totalInputCost += draw.Cost;
            qualityMass += draw.AverageQuality * draw.Quantity;
            totalInputQuantity += draw.Quantity;
        }

        var outputQuality = totalInputQuantity > 0 ? qualityMass / totalInputQuantity : SimulationConstants.WorldMarketQuality;
        var outputQty = recipe.OutputQuantity * cyclesActual;
        building.Inventory.Add(product.Id, outputQty, totalInputCost, outputQuality);
    }

    private static void ProduceRealistic(World world, BuildingInstance building, int slotIndex, Product product, Recipe recipe)
    {
        // Output buffer: a slot tops its product up to OutputBufferMonths of its own output (all
        // slots of the product in this building share the stock, so each fills its share).
        var monthly = recipe.CyclesPerSlotMonth * recipe.OutputQuantity;
        var slots = building.ProductionSlots.Count(s => s.Product == product.Id);
        var buffer = world.Rules.Market.OutputBufferMonths * monthly * slots;
        var room = buffer - building.Inventory.Get(product.Id);
        if (!(room > 0)) return;
        if (!Equipment.EnsureInstalled(world, building, slotIndex, product.Id, recipe.LineCapex)) return;
        var cycles = Math.Min(recipe.CyclesPerSlotMonth, Math.Ceiling(room / recipe.OutputQuantity));
        ProduceContinuous(world, building, product, recipe, cycles, capitaliseConversion: true);
    }

    /// <summary>
    /// Per-unit recipes (content with <c>outputPerSlotMonth</c>): whole cycles up to
    /// <paramref name="maxCycles"/>, limited by inputs and — when conversion costs are charged —
    /// by what the company can pay for.
    /// </summary>
    private static void ProduceContinuous(World world, BuildingInstance building, Product product, Recipe recipe, double maxCycles, bool capitaliseConversion)
    {
        maxCycles = Math.Floor(maxCycles);
        if (!(maxCycles > 0)) return;

        foreach (var input in recipe.Inputs)
        {
            MaterialProcurement.EnsureAvailable(world, building, input.ProductId, input.Quantity * maxCycles, LedgerCategory.InputPurchase);
        }

        var cycles = maxCycles;
        foreach (var input in recipe.Inputs)
        {
            var forInput = Math.Floor(building.Inventory.Get(input.ProductId) / input.Quantity + 1e-9);
            if (forInput < cycles) cycles = forInput;
        }

        decimal otherPerCycle = 0m, energyPerCycle = 0m;
        if (capitaliseConversion)
        {
            var perCycle = (decimal)recipe.OutputQuantity;
            otherPerCycle = recipe.OtherCostPerUnit * perCycle;
            energyPerCycle = (decimal)recipe.KwhPerUnit * world.Rules.Market.IndustrialPowerPrice * perCycle;
            var conversion = otherPerCycle + energyPerCycle;
            if (conversion > 0m)
            {
                var affordable = Math.Floor((double)(world.ProcurementBudget(building.Owner) / conversion));
                if (affordable < cycles) cycles = affordable;
            }
        }

        if (!(cycles > 0)) return;

        decimal cost = 0m;
        double qualityMass = 0.0;
        double inputQuantity = 0.0;
        foreach (var input in recipe.Inputs)
        {
            var draw = building.Inventory.Take(input.ProductId, input.Quantity * cycles);
            cost += draw.Cost;
            qualityMass += draw.AverageQuality * draw.Quantity;
            inputQuantity += draw.Quantity;
        }

        var outputQty = recipe.OutputQuantity * cycles;
        if (otherPerCycle > 0m)
        {
            var other = otherPerCycle * (decimal)cycles;
            world.RecordCashChange(building.Owner, LedgerCategory.OtherMaterials, -other,
                $"materials for {outputQty:F2} {product.Id}", product.Id, building.Id, outputQty);
            cost += other;
        }

        if (energyPerCycle > 0m)
        {
            var energy = energyPerCycle * (decimal)cycles;
            world.RecordCashChange(building.Owner, LedgerCategory.ProductionEnergy, -energy,
                $"energy for {outputQty:F2} {product.Id}", product.Id, building.Id, outputQty);
            cost += energy;
        }

        var outputQuality = inputQuantity > 0 ? qualityMass / inputQuantity : SimulationConstants.WorldMarketQuality;
        building.Inventory.Add(product.Id, outputQty, cost, outputQuality);
    }
}
