namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 13 (econ-audit §4.16): finance — interest on term loans, the revolver and deposits,
/// scheduled amortisation, revolver sweep (§4.10). Ledger categories <c>InterestExpense</c>,
/// <c>InterestIncome</c>, <c>LoanRepayment</c>, <c>RevolverDraw</c>/<c>RevolverRepay</c>.
/// <para>Classic: no-op. Realistic: gated by <see cref="Rules.FinanceRules.Enabled"/>.</para>
/// </summary>
internal static class FinanceStep
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;

        Finance.FinanceTick.Interest(ctx.World, ctx.Now);
    }
}
