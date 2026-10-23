using System.Collections.Generic;

namespace Magnate.Engine.Domain;

public sealed record RecipeInput(ProductId ProductId, double Quantity);

public sealed record Recipe(
    double OutputQuantity,
    double LaborUnits,
    IReadOnlyList<RecipeInput> Inputs)
{
    /// <summary>
    /// Output units one production slot makes per month at level 1 (econ-audit §4.7). When set,
    /// a slot runs <c>OutputPerSlotMonth / OutputQuantity</c> recipe cycles a month; when null
    /// it runs <see cref="Simulation.SimulationConstants.CyclesPerSlotPerMonth"/> (the legacy
    /// 200-cycle abstraction, which the frozen Classic content relies on).
    /// </summary>
    public double? OutputPerSlotMonth { get; init; }

    /// <summary>
    /// Production staff per active slot (econ-audit §4.5). The loader maps a legacy
    /// <see cref="LaborUnits"/> value <c>u</c> to <c>5·u</c> when the content omits it.
    /// </summary>
    public double LaborPerSlot { get; init; }

    /// <summary>
    /// Purchased materials not modelled as products (packaging, concentrate, components), $
    /// per output unit, charged and capitalised at production under Realistic market rules.
    /// </summary>
    public decimal OtherCostPerUnit { get; init; }

    /// <summary>Production energy per output unit (kWh), charged at the industrial tariff and capitalised.</summary>
    public double KwhPerUnit { get; init; }

    /// <summary>
    /// Production-line equipment capex per slot, paid the first month a slot runs this recipe
    /// under Realistic market rules and capitalised into the building.
    /// </summary>
    public decimal LineCapex { get; init; }

    /// <summary>Recipe cycles one slot runs per month (see <see cref="OutputPerSlotMonth"/>).</summary>
    public double CyclesPerSlotMonth => OutputPerSlotMonth is double perMonth && OutputQuantity > 0
        ? perMonth / OutputQuantity
        : Simulation.SimulationConstants.CyclesPerSlotPerMonth;
}
