namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 16 (econ-audit §4.16): quarter-end processing (months 3/6/9/12) — credit-rating update,
/// covenant tests, dividends, earnings surprise; every month the share price (§4.10–4.11).
/// <para>Classic: no-op. Realistic: gated by <see cref="Rules.FinanceRules.Enabled"/>.</para>
/// </summary>
internal static class QuarterEndStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;

        if (ctx.IsQuarterEnd) Finance.FinanceTick.QuarterEnd(ctx.World, ctx.Now);

        // P1: covenant tests (§4.10).
        // TODO(E5 equity, Wave 3): dividends, share price and sentiment (§4.11).
    }
}
