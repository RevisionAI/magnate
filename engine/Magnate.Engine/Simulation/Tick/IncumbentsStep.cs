namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 18 (econ-audit §4.16): incumbent local-competition dynamics — erosion and entry of the
/// permanent per-(city, product) incumbent offer (§4.2, P1).
/// <para>
/// Classic: no-op (there are no incumbents). Realistic P0: no-op as well — the incumbent mass is
/// the static base <c>A₀ = max(min, D$_ref / (utilisation · RetailCapPerSlot$)) · strength</c>,
/// computed from content and rules whenever the demand model runs
/// (<see cref="Market.RetailMarket.IncumbentMass"/>), so it needs no monthly state. The P1
/// dynamics (erosion toward a 25 % floor as companies take share, entry when they over-price)
/// will update a persisted per-market mass here.
/// </para>
/// </summary>
internal static class IncumbentsStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Market.Enabled) return;

        // P0: static incumbents (see the class remarks). P1 dynamics go here.
    }
}
