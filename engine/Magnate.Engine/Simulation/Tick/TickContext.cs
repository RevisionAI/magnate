using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Rules;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Per-tick state shared by every step of <see cref="MonthlyTick"/>. Created once per month,
/// right after the clock advances, and discarded at the end of the tick.
/// </summary>
internal sealed class TickContext
{
    public TickContext(World world)
    {
        World = world;
        Rules = world.Rules;
        Now = world.Clock.Now;
        // Snapshot at tick start in ascending id order: the order every building-iterating
        // step has used since Phase 1 (determinism invariant).
        AllBuildings = world.Buildings.Values.OrderBy(b => b.Id.Value).ToList();
    }

    /// <summary>The world being advanced.</summary>
    public World World { get; }

    /// <summary>Shortcut for <c>World.Rules</c>.</summary>
    public EconomyRules Rules { get; }

    /// <summary>The month being simulated (the clock has already advanced).</summary>
    public GameDate Now { get; }

    /// <summary>
    /// Every building, ascending by id, snapshotted at tick start — including buildings under
    /// construction or retired (land rules, E3b). Only steps that manage buildings rather than run
    /// them (construction progress) iterate this.
    /// </summary>
    public IReadOnlyList<BuildingInstance> AllBuildings { get; }

    /// <summary>
    /// The operating buildings (<see cref="BuildingInstance.IsOperational"/>), ascending by id: the
    /// tick-start snapshot without buildings under construction or retired. Evaluated when read, so
    /// a building whose construction completes in the construction step operates in every later
    /// step of the same month. Steps that run operations (payroll, research, extraction,
    /// production, restock, demand, export) iterate this. Classic: every building, no copy.
    /// </summary>
    public IReadOnlyList<BuildingInstance> Buildings
    {
        get
        {
            var all = AllBuildings;
            for (var i = 0; i < all.Count; i++)
            {
                if (!all[i].IsOperational) return all.Where(b => b.IsOperational).ToList();
            }
            return all;
        }
    }

    /// <summary>True in the last month of a calendar quarter (March, June, September, December).</summary>
    public bool IsQuarterEnd => Now.Month % 3 == 0;

    /// <summary>True in December.</summary>
    public bool IsYearEnd => Now.Month == 12;
}
