namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 1 (econ-audit §4.16): the macro economy — regime, growth, output gap, inflation,
/// policy rate, CPI, wage level, population, income mix, land index (§4.13). Draws from the
/// persisted <c>macro</c> RNG stream.
/// <para>Classic: no-op. Realistic: gated by <see cref="Rules.MacroRules.Enabled"/>.</para>
/// </summary>
internal static class MacroStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Macro.Enabled) return;

        // TODO(E5 macro, Wave 3): advance the regime-switching cycle (§4.13) and persist its
        // state through Persistence/Sections/MacroSaveSection. Until then the macro state is
        // frozen at its initial values, which is exactly Classic behaviour.
    }
}
