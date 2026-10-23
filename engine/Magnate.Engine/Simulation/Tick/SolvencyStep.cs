namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 17 (econ-audit §4.16): solvency — distress when cash is negative with the revolver
/// exhausted, the 3-month cure window, bankruptcy and liquidation (§4.14).
/// <para>Classic: no-op (negative cash is tolerated). Realistic: gated by
/// <see cref="Rules.FinanceRules.Enabled"/>.</para>
/// </summary>
internal static class SolvencyStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;

        Finance.FinanceTick.Solvency(ctx.World, ctx.Now, ctx.IsQuarterEnd);
    }
}
