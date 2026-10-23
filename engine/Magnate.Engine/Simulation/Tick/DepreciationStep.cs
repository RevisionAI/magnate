namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 14 (econ-audit §4.16): depreciation — straight-line, monthly, zero salvage, starting the
/// month after an asset is completed; land is never depreciated (§4.8). Each charge is a
/// non-cash <c>AccrualJournal</c> entry of kind <c>Depreciation</c> that also raises the
/// building's accumulated depreciation.
/// <para>Classic: no-op. Realistic: gated by <see cref="Rules.FinanceRules.Enabled"/>.</para>
/// </summary>
internal static class DepreciationStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;

        if (!ctx.Rules.Finance.Depreciation) return;
        Finance.FinanceTick.Depreciation(ctx.World, ctx.Buildings, ctx.Now);
    }
}
