using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// Snapshot of a company's financial position at a given date (econ-audit §4.15).
/// <list type="bullet">
///   <item><see cref="InventoryValue"/>: weighted-average cost of goods on hand (Phase 2.1).</item>
///   <item><see cref="BuildingValue"/>: net book value of buildings (PP&amp;E) — capitalised cost
///         (construction plus upgrades) less accumulated depreciation. Land and construction in
///         progress are separate lines.</item>
///   <item><see cref="Land"/>: land at historical cost, never depreciated (§4.8).</item>
///   <item><see cref="Cip"/>: construction in progress (§4.12).</item>
///   <item><see cref="Liabilities"/>: outstanding debt principal, the running sum of the
///         <see cref="StatementSection.Financing"/> ledger categories (zero in Classic); split into
///         <see cref="TermLoans"/> and <see cref="Revolver"/> from the finance register.</item>
///   <item><see cref="PaidInCapital"/> + <see cref="RetainedEarnings"/> = <see cref="Equity"/>.</item>
/// </list>
/// Invariant (every company, every month): <c>TotalAssets − Liabilities == Equity ==
/// Σ owner equity flows + cumulative net income</c>.
/// <para>
/// <see cref="BuildingValue"/>, <see cref="TotalAssets"/> and <see cref="Equity"/> keep their
/// pre-overhaul meaning for the legacy client and tools; for a Classic world every new line is 0.
/// </para>
/// </summary>
/// <param name="AsOf">Month of the snapshot.</param>
/// <param name="Company">Company described.</param>
/// <param name="Cash">Cash on hand (equals the company's ledger sum).</param>
/// <param name="InventoryValue">Inventory at cost.</param>
/// <param name="BuildingValue">PP&amp;E at net book value.</param>
/// <param name="Liabilities">Debt principal outstanding.</param>
/// <param name="Land">Land at cost.</param>
/// <param name="Cip">Construction in progress.</param>
/// <param name="GrossPpe">PP&amp;E at historical cost.</param>
/// <param name="AccumulatedDepreciation">Depreciation booked against <see cref="GrossPpe"/>.</param>
/// <param name="TermLoans">Term-loan principal outstanding.</param>
/// <param name="Revolver">Revolving-credit balance drawn.</param>
/// <param name="PaidInCapital">Owner contributions: starting capital and share issues net of fees.</param>
public sealed record BalanceSheet(
    GameDate AsOf,
    CompanyId Company,
    decimal Cash,
    decimal InventoryValue,
    decimal BuildingValue,
    decimal Liabilities,
    decimal Land = 0m,
    decimal Cip = 0m,
    decimal GrossPpe = 0m,
    decimal AccumulatedDepreciation = 0m,
    decimal TermLoans = 0m,
    decimal Revolver = 0m,
    decimal PaidInCapital = 0m)
{
    /// <summary>Cash + inventory + PP&amp;E + land + construction in progress.</summary>
    public decimal TotalAssets => Land == 0m && Cip == 0m
        ? Cash + InventoryValue + BuildingValue
        : Cash + InventoryValue + BuildingValue + Land + Cip;

    /// <summary>Assets − liabilities.</summary>
    public decimal Equity => TotalAssets - Liabilities;

    /// <summary>Equity − paid-in capital: cumulative net income less distributions.</summary>
    public decimal RetainedEarnings => Equity - PaidInCapital;

    /// <summary>Liabilities − cash (negative when cash exceeds debt).</summary>
    public decimal NetDebt => Liabilities - Cash;
}
