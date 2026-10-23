using Magnate.Engine.Economics;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 4 (econ-audit §4.16): payroll and building costs.
/// <para>
/// Classic: the level-aware fixed operating cost of every building, one
/// <see cref="LedgerCategory.OperatingCost"/> entry per building per month (formerly
/// <c>MonthlyTick.ChargeOperatingCosts</c>).
/// </para>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, econ-audit §4.5–4.6): per building, one
/// entry per cost line — <see cref="LedgerCategory.Wages"/> (headcount × base wage × city wage
/// index), <see cref="LedgerCategory.Utilities"/> (the content's re-based fixed opex),
/// <see cref="LedgerCategory.Maintenance"/> (1.5 %/yr structure + 4 %/yr equipment),
/// <see cref="LedgerCategory.Insurance"/> (0.3 %/yr of gross PP&amp;E) and
/// <see cref="LedgerCategory.PropertyTax"/> (1.2 %/yr, farms 0.6 %, of land + NBV). Buildings
/// still under construction pay only insurance and property tax (<see cref="IBuildingSiteInfo"/>).
/// </para>
/// </summary>
internal static class PayrollStep
{
    public static void Run(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            ChargeRealisticCosts(ctx);
            return;
        }

        ChargeFixedOpex(ctx);
    }

    /// <summary>Classic fixed opex: one <see cref="LedgerCategory.OperatingCost"/> entry per building.</summary>
    private static void ChargeFixedOpex(TickContext ctx)
    {
        var world = ctx.World;
        foreach (var building in ctx.Buildings)
        {
            var type = world.Catalog.BuildingType(building.TypeId);
            // Phase 3.59: effective opex depends on the instance's upgrade level.
            var opex = world.GetMonthlyOpex(building);
            if (opex <= 0m) continue;

            world.RecordCashChange(
                building.Owner,
                LedgerCategory.OperatingCost,
                -opex,
                $"opex {type.Id} ({building.Id})",
                building: building.Id);
        }
    }

    private static void ChargeRealisticCosts(TickContext ctx)
    {
        var world = ctx.World;
        world.MarketState.InvalidateFixedCosts();
        // Every building, construction sites included (E1 x E3b): a site pays its insurance and
        // property tax (OperatingCosts.Of charges only those while IsOperational is false).
        foreach (var building in ctx.AllBuildings)
        {
            var costs = OperatingCosts.Of(world, building);
            Charge(world, building, LedgerCategory.Wages, costs.Wages, $"wages {costs.Headcount:0.#} staff");
            Charge(world, building, LedgerCategory.Utilities, costs.Utilities, "utilities and building services");
            Charge(world, building, LedgerCategory.Maintenance, costs.Maintenance, "maintenance");
            Charge(world, building, LedgerCategory.Insurance, costs.Insurance, "insurance");
            Charge(world, building, LedgerCategory.PropertyTax, costs.PropertyTax, "property tax");
        }

        world.MarketState.InvalidateFixedCosts();
    }

    private static void Charge(World world, BuildingInstance building, LedgerCategory category, decimal amount, string memo)
    {
        if (amount <= 0m) return;
        world.RecordCashChange(building.Owner, category, -amount, $"{memo} ({building.Id})", building: building.Id);
    }
}
