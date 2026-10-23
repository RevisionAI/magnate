using System.Collections.Generic;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 3 (econ-audit §4.16): construction progress (§4.12). For every building under
/// construction, in id order: pay the month's instalment (ledger <c>ConstructionPayment</c> →
/// construction in progress) or pause when it cannot be funded; when the last instalment is paid
/// the building completes (CIP → PP&amp;E, <c>BuiltAt</c> = this month) and operates from this
/// month's later steps on. Orders waiting for a site retry (works start when a free, affordable
/// site exists). Then the land model closes the month: cities whose development changed
/// bump their layout revision (the land-value and traffic fields are recomputed from the
/// development standing at this month close).
/// <para>Classic: no-op (buildings are operational the month they are built). Realistic: gated by
/// <see cref="Rules.LandRules.Enabled"/>.</para>
/// </summary>
internal static class ConstructionStep
{
    /// <summary>Site searches per company per month for orders waiting for a site.</summary>
    internal const int MaxSiteAttemptsPerCompany = 3;

    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Land.Enabled) return;

        var world = ctx.World;
        var siteAttempts = new Dictionary<CompanyId, int>();
        foreach (var building in ctx.AllBuildings)
        {
            if (building.Construction is not { } state || building.IsRetired) continue;
            if (state.AwaitingSite)
            {
                // Orders waiting for a site retry oldest first, a few per company per month (each
                // attempt is a city-wide site search).
                var attempts = siteAttempts.GetValueOrDefault(building.Owner);
                if (attempts >= MaxSiteAttemptsPerCompany) continue;
                siteAttempts[building.Owner] = attempts + 1;
                world.TrySiteOrder(building);
                continue;
            }
            world.AdvanceConstruction(building);
        }
        world.CloseLandMonth();
    }
}
