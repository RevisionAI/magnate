namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 2 (econ-audit §4.16): world prices — commodity cycles
/// <c>x_p = 0.97·x_{p,t−1} + σ_p·ε</c> from the <c>commodities</c> RNG stream (§4.13).
/// <para>
/// Classic: no-op. Event price overlays (<see cref="World.ActivePriceEffects"/>) keep ticking
/// down in <see cref="EventsStep"/> at the end of the month, exactly as before the overhaul —
/// moving them here would shift which month's procurement an expiring overlay still affects.
/// Realistic: gated by <see cref="Rules.MacroRules.Enabled"/>.
/// </para>
/// </summary>
internal static class WorldPricesStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Macro.Enabled) return;

        // TODO(E5 macro, Wave 3): commodity cycles and CPI pass-through to world prices
        // (§4.13). World.GetEffectiveWorldPrice is the single read point for every consumer.
    }
}
