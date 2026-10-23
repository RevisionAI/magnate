using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Economics;

/// <summary>
/// What a cash ledger entry is. Serialised by name in saves, so members are only ever
/// appended. <see cref="LedgerCategoryInfo"/> maps each to its statement section and cash-flow
/// class.
/// </summary>
public enum LedgerCategory
{
    /// <summary>Equity injection at company creation.</summary>
    StartingCapital,

    /// <summary>Purchase of a new building (capex).</summary>
    ConstructionCost,

    /// <summary>Monthly fixed operating cost of a building.</summary>
    OperatingCost,

    /// <summary>Raw material or component bought from the world market (or upstream supplier).</summary>
    InputPurchase,

    /// <summary>Retailer restocking finished goods from the world market.</summary>
    RetailRestock,

    /// <summary>Revenue from selling to end consumers at a retailer.</summary>
    ProductSale,

    /// <summary>Revenue from exporting goods to the world market.</summary>
    ExportSale,

    /// <summary>Freight charge for moving goods between cities owned by the same company.</summary>
    ShippingCost,

    /// <summary>Monthly advertising campaign spend. Period cost — hits P&amp;L under opex, not COGS.</summary>
    AdvertisingCost,

    /// <summary>
    /// Royalty received by a patent holder from a licensee, equal to
    /// <see cref="Simulation.SimulationConstants.PatentRoyaltyRate"/> of the
    /// licensee's <c>ProductSale</c> + <c>ExportSale</c> revenue on the
    /// patented product in the just-completed tick. Positive amounts; flows
    /// into the holder's <see cref="Magnate.Engine.Economics.IncomeStatement"/>
    /// as revenue. See Phase 3.54.
    /// </summary>
    PatentRoyaltyIncome,

    /// <summary>
    /// Royalty paid by a licensee to a patent holder, mirror of
    /// <see cref="PatentRoyaltyIncome"/>. Negative amounts; flows into the
    /// licensee's <see cref="Magnate.Engine.Economics.IncomeStatement"/> as
    /// operating expense. See Phase 3.54.
    /// </summary>
    PatentRoyaltyExpense,

    /// <summary>
    /// One-shot capex paid to advance a building from level N to N+1 (Phase 3.59).
    /// Negative amounts. Capitalised into the building's book value like
    /// <see cref="ConstructionCost"/> — excluded from the P&amp;amp;L opex bucket.
    /// </summary>
    UpgradeCost,

    // ------------------------------------------------------------------ econ-audit §4.15
    // Appended 2026-10-01 (E0). Serialised by name, so appending never breaks a save; never
    // reorder or rename. The statement mapping of every category is LedgerCategoryInfo.

    /// <summary>Gross proceeds of a share issue (IPO or secondary offering). Positive. Paid-in capital.</summary>
    ShareIssuance,

    /// <summary>Underwriting fee on a share issue. Negative. Charged against paid-in capital.</summary>
    ShareIssuanceFee,

    /// <summary>Cash paid to repurchase shares. Negative. Reduces paid-in capital / retained earnings.</summary>
    ShareBuyback,

    /// <summary>Dividend paid to shareholders. Negative. Reduces retained earnings.</summary>
    DividendPaid,

    /// <summary>Term-loan principal received. Positive. Raises term-loan liabilities.</summary>
    LoanDrawdown,

    /// <summary>Scheduled or early term-loan principal repayment. Negative. Lowers term-loan liabilities.</summary>
    LoanRepayment,

    /// <summary>Revolving-credit draw (automatic overdraft). Positive. Raises the revolver balance.</summary>
    RevolverDraw,

    /// <summary>Revolving-credit repayment (sweep). Negative. Lowers the revolver balance.</summary>
    RevolverRepay,

    /// <summary>Land bought for a building's plot. Negative. Capitalised at cost, never depreciated.</summary>
    LandPurchase,

    /// <summary>Construction deposit or progress payment (Realistic construction time). Negative. Construction-in-progress, then PP&amp;amp;E.</summary>
    ConstructionPayment,

    /// <summary>Production-line or store equipment bought. Negative. Capitalised to PP&amp;amp;E.</summary>
    EquipmentPurchase,

    /// <summary>Proceeds from selling a building or asset. Positive. The gain or loss goes to the accrual journal.</summary>
    AssetSale,

    /// <summary>Proceeds from a bankruptcy liquidation. Positive. The gain or loss goes to the accrual journal.</summary>
    LiquidationProceeds,

    /// <summary>Other direct materials (packaging, consumables). Negative. Capitalised to inventory.</summary>
    OtherMaterials,

    /// <summary>Production energy. Negative. Capitalised to inventory.</summary>
    ProductionEnergy,

    /// <summary>Building payroll. Negative. Operating expense.</summary>
    Wages,

    /// <summary>Building base-load utilities. Negative. Operating expense.</summary>
    Utilities,

    /// <summary>Building maintenance. Negative. Operating expense.</summary>
    Maintenance,

    /// <summary>Property and casualty insurance. Negative. Operating expense.</summary>
    Insurance,

    /// <summary>Property tax on land and buildings. Negative. Operating expense.</summary>
    PropertyTax,

    /// <summary>Retail variable selling cost (card fees, shrinkage). Negative. Operating expense.</summary>
    RetailVariable,

    /// <summary>Head-office overhead. Negative. Operating expense.</summary>
    CorporateOverhead,

    /// <summary>Interest on term loans and the revolver. Negative. Below EBIT.</summary>
    InterestExpense,

    /// <summary>Penalty interest on a negative balance in distress. Negative. Below EBIT.</summary>
    DistressInterest,

    /// <summary>Interest earned on positive cash. Positive. Below EBIT.</summary>
    InterestIncome,

    /// <summary>Corporate income tax: negative = payment, positive = refund of tax paid earlier in the year.</summary>
    IncomeTax,
}

/// <summary>
/// Immutable ledger entry. Sign convention: positive = cash inflow to the company,
/// negative = cash outflow. <see cref="Product"/> is set on entries that are
/// product-attributable (sales, restock, input purchases, exports) and null on
/// entries that aren't (opex, construction, starting capital).
/// <see cref="Building"/> (Phase 3.29) is set whenever a cash movement is directly
/// caused by a specific building — opex, sales, exports, procurement (destination
/// building), shipping (destination), construction. It is null for company-wide
/// flows (starting capital, advertising spend — ads are (company,product,city)-scoped).
/// <see cref="Quantity"/> (bridge-spec E11, schema v10) is the number of units behind a sale,
/// export, purchase or shipment; null for flows that are not per-unit and for older saves.
/// </summary>
public sealed record LedgerEntry(
    GameDate Date,
    CompanyId Company,
    LedgerCategory Category,
    decimal Amount,
    string? Memo,
    ProductId? Product = null,
    BuildingInstanceId? Building = null,
    double? Quantity = null);

/// <summary>Append-only log of all cash movements in the simulation.</summary>
public sealed class Ledger
{
    private readonly List<LedgerEntry> _entries = new();

    /// <summary>
    /// Running per-company totals by statement section, maintained on <see cref="Record"/> in
    /// recording order (the same additions, in the same order, as a scan would make).
    /// </summary>
    private readonly Dictionary<(CompanyId Company, StatementSection Section), decimal> _sectionTotals = new();

    /// <summary>Running per-company totals by category, maintained like <see cref="_sectionTotals"/>.</summary>
    private readonly Dictionary<(CompanyId Company, LedgerCategory Category), decimal> _categoryTotals = new();

    private readonly ChronologicalIndex _index = new();

    /// <summary>Every entry in recording order (chronological).</summary>
    public IReadOnlyList<LedgerEntry> Entries => _entries;

    /// <summary>Append an entry. Engine code goes through <c>World.RecordCashChange</c>, which also moves cash.</summary>
    public void Record(LedgerEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var key = (entry.Company, LedgerCategoryInfo.Of(entry.Category).Section);
        _index.Observe(entry.Date);
        _entries.Add(entry);
        _sectionTotals[key] = _sectionTotals.TryGetValue(key, out var total) ? total + entry.Amount : entry.Amount;
        var categoryKey = (entry.Company, entry.Category);
        _categoryTotals[categoryKey] = _categoryTotals.TryGetValue(categoryKey, out var ct) ? ct + entry.Amount : entry.Amount;
    }

    /// <summary>
    /// Sum of every amount the company ever booked in <paramref name="category"/> (O(1)); zero when
    /// nothing was booked. Paid-in capital, loans taken and similar lifetime figures read it.
    /// </summary>
    public decimal CategoryTotal(CompanyId company, LedgerCategory category)
        => _categoryTotals.TryGetValue((company, category), out var total) ? total : 0m;

    /// <summary>
    /// Sum of every amount the company ever booked in categories of <paramref name="section"/>
    /// (O(1)). For example the <see cref="StatementSection.Financing"/> total is the company's
    /// outstanding debt principal, the <see cref="StatementSection.EquityContribution"/> total its
    /// net owner equity flows. Zero when nothing was booked.
    /// </summary>
    public decimal SectionTotal(CompanyId company, StatementSection section)
        => _sectionTotals.TryGetValue((company, section), out var total) ? total : 0m;

    /// <summary>All entries of one company, in recording order.</summary>
    public IEnumerable<LedgerEntry> EntriesFor(CompanyId company)
        => _entries.Where(e => e.Company == company);

    /// <summary>
    /// The company's entries dated within <c>[from, toInclusive]</c>, in recording order.
    /// O(log n + k) on the chronological log (bridge-spec E8).
    /// </summary>
    public IEnumerable<LedgerEntry> EntriesInRange(CompanyId company, GameDate from, GameDate toInclusive)
        => _index.Range(_entries, e => e.Date, e => e.Company == company, from, toInclusive);

    /// <summary>Net cash change for a company over a date range (inclusive).</summary>
    public decimal NetCashFlow(CompanyId company, GameDate from, GameDate toInclusive)
        => EntriesInRange(company, from, toInclusive).Sum(e => e.Amount);
}
