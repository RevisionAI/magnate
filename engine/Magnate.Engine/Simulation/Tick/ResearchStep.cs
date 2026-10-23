using System.Linq;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 5 (econ-audit §4.16): research. Prunes expired patents, then every research slot adds
/// <see cref="SimulationConstants.ResearchPointsPerSlotPerMonth"/> points to its owner's
/// (company, product) progress unless a rival's live patent blocks it (Phase 3.49/3.54).
/// Scientist wages are charged by <see cref="PayrollStep"/> under Realistic rules.
/// </summary>
internal static class ResearchStep
{
    public static void Run(TickContext ctx)
    {
        var world = ctx.World;

        // Phase 3.49: expire any patents that have reached their ExpiresAt, then
        // silently drop R&D injections on products locked by a rival's patent.
        world.PruneExpiredPatents();

        foreach (var building in ctx.Buildings)
        {
            if (building.ResearchSlots.Count == 0) continue;

            foreach (var slot in building.ResearchSlots.OrderBy(s => s.Index))
            {
                if (world.IsPatentBlocked(building.Owner, slot.Product)) continue;

                world.AddResearchPoints(
                    building.Owner,
                    slot.Product,
                    SimulationConstants.ResearchPointsPerSlotPerMonth);
            }
        }
    }
}
