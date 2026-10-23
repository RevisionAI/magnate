using System;
using System.Collections.Generic;
using Magnate.Engine.Simulation.Tick;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Advances the simulation by one month: advances the clock, then runs every step of
/// <see cref="Pipeline"/> in order (econ-audit §4.16). Each step is a static class in
/// <c>Simulation/Tick/</c>; steps that belong to a realism area early-return unless that area of
/// <see cref="World.Rules"/> is enabled, so a Classic world executes exactly the pre-overhaul
/// sequence: opex → research → advertising → extraction → production (intermediate, finished)
/// → restock (warehouses, retailers) → demand and sales → auto-export → royalties → events.
/// AI decisions run before the tick, in <see cref="World.AdvanceMonth"/>.
/// </summary>
internal static class MonthlyTick
{
    /// <summary>One named step of the monthly pipeline.</summary>
    internal readonly record struct Step(string Name, Action<TickContext> Run);

    /// <summary>The monthly pipeline, in execution order. Never reorder: Classic golden masters pin it.</summary>
    internal static readonly IReadOnlyList<Step> Pipeline = new Step[]
    {
        new("Macro", MacroStep.Run),
        new("WorldPrices", WorldPricesStep.Run),
        new("Construction", ConstructionStep.Run),
        new("Payroll", PayrollStep.Run),
        new("Research", ResearchStep.Run),
        new("Advertising", AdvertisingStep.Run),
        new("Extraction", ExtractionStep.Run),
        new("Production", ProductionStep.Run),
        new("Restock", RestockStep.Run),
        new("Demand", DemandStep.Run),
        new("Export", ExportStep.Run),
        new("Royalties", RoyaltiesStep.Run),
        new("Finance", FinanceStep.Run),
        new("Depreciation", DepreciationStep.Run),
        new("Tax", TaxStep.Run),
        new("QuarterEnd", QuarterEndStep.Run),
        new("Solvency", SolvencyStep.Run),
        new("Incumbents", IncumbentsStep.Run),
        new("Events", EventsStep.Run),
    };

    public static void Execute(World world)
    {
        world.Clock.AdvanceMonth();

        var ctx = new TickContext(world);
        foreach (var step in Pipeline)
        {
            step.Run(ctx);
        }
    }
}
