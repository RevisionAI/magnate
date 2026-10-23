namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 15 (econ-audit §4.16): corporate income tax — monthly year-to-date settlement with loss
/// carry-forward capped at 80 % of taxable income, December NOL roll (§4.9). Ledger category
/// <c>IncomeTax</c> (negative = payment, positive = refund).
/// <para>Classic: no-op. Realistic: gated by <see cref="Rules.FinanceRules.Enabled"/>.</para>
/// </summary>
internal static class TaxStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;

        Finance.FinanceTick.Tax(ctx.World, ctx.Now);
    }
}
