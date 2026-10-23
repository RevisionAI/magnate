using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// Cash-flow statement over a date range: every ledger amount of the period classified by
/// <see cref="LedgerCategoryInfo.CashFlow"/> (econ-audit §4.15). Reconciles by construction:
/// <see cref="NetChange"/> equals the change in cash over the period.
/// </summary>
/// <param name="From">First month of the period.</param>
/// <param name="ToInclusive">Last month of the period.</param>
/// <param name="Operating">Cash from operations (sales, purchases, opex, interest, tax).</param>
/// <param name="Investing">Cash for or from long-lived assets (construction, upgrades, land, disposals).</param>
/// <param name="Financing">Cash from or to lenders and owners (starting capital, loans, dividends).</param>
public sealed record CashFlowStatement(
    GameDate From,
    GameDate ToInclusive,
    decimal Operating,
    decimal Investing,
    decimal Financing)
{
    /// <summary>Operating + investing + financing.</summary>
    public decimal NetChange => Operating + Investing + Financing;
}
