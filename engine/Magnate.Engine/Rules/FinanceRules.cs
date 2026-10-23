namespace Magnate.Engine.Rules;

/// <summary>
/// Corporate-finance realism: term loans and the revolving credit line, credit rating and
/// borrowing capacity (econ-audit §4.10), straight-line depreciation and land at cost (§4.8),
/// income tax with loss carry-forward (§4.9), quarter-end processing, solvency and bankruptcy
/// (§4.14), disposals, the fundamental company value (§4.11/§4.18) and the accrual statements of
/// §4.15.
/// <para>
/// Every field defaults to its <em>neutral</em> value — the value that reproduces Classic
/// behaviour exactly (switches off, rates and fractions zero) — and <see cref="Realistic"/> (used
/// by <see cref="EconomyRules.Realistic"/>) sets the gameplay values. Saves persist the full
/// record, so a field missing from an older save deserialises to that neutral default. Nothing
/// here is read unless <see cref="Enabled"/> is set.
/// </para>
/// </summary>
public sealed record FinanceRules
{
    /// <summary>
    /// Master switch for the finance model. When <c>false</c> the finance, depreciation, tax,
    /// quarter-end and solvency tick steps are no-ops and the books behave exactly as Classic.
    /// </summary>
    public bool Enabled { get; init; }

    // ------------------------------------------------------------------ §4.8 depreciation

    /// <summary>Straight-line monthly depreciation by asset class (land never depreciates).</summary>
    public bool Depreciation { get; init; }

    // ------------------------------------------------------------------ §4.9 income tax

    /// <summary>Flat corporate income-tax rate on taxable income (0 = no tax). Realistic 25 %.</summary>
    public decimal IncomeTaxRate { get; init; }

    /// <summary>
    /// Share of a year's positive taxable income that brought-forward losses may offset
    /// (US rule: 80 %). 0 disables loss carry-forward.
    /// </summary>
    public decimal LossCarryForwardCap { get; init; }

    // ------------------------------------------------------------------ §4.10 credit

    /// <summary>
    /// Central-bank policy rate every loan is priced over (P0 holds it at 4.00 %, the Sep-2026
    /// fed-funds midpoint; the Wave 3 macro model will move it).
    /// </summary>
    public decimal PolicyRate { get; init; }

    /// <summary>Amortising term loans can be taken (player command, AI later).</summary>
    public bool TermLoans { get; init; }

    /// <summary>Lender margin of a term loan on top of the risk-free rate and the rating spread (0.75 %).</summary>
    public decimal TermLoanMargin { get; init; }

    /// <summary>Shortest term-loan tenor in months.</summary>
    public int MinLoanTermMonths { get; init; }

    /// <summary>Longest term-loan tenor in months.</summary>
    public int MaxLoanTermMonths { get; init; }

    /// <summary>The automatic revolving credit line that replaces negative cash.</summary>
    public bool Revolver { get; init; }

    /// <summary>Lender margin of the revolver over the policy rate and the rating spread (1.50 %).</summary>
    public decimal RevolverMargin { get; init; }

    /// <summary>The revolver limit never exceeds this share of total assets (20 %).</summary>
    public decimal RevolverAssetCap { get; init; }

    /// <summary>
    /// Cash buffer, in months of fixed costs, above which surplus cash sweeps the revolver down (2).
    /// </summary>
    public decimal RevolverSweepBufferMonths { get; init; }

    /// <summary>Quarterly credit rating from interest cover, leverage and size.</summary>
    public bool CreditRating { get; init; }

    /// <summary>A company younger than this many months is unrated and borrows on half its collateral (12).</summary>
    public int SeasoningMonths { get; init; }

    /// <summary>Largest rating move, in notches, at one quarterly review (2; a move to D is never capped).</summary>
    public int MaxRatingMovePerQuarter { get; init; }

    // ------------------------------------------------------------------ §4.14 solvency

    /// <summary>Distress, cure window and bankruptcy with liquidation.</summary>
    public bool Solvency { get; init; }

    /// <summary>Months a company in distress has to cure before it is declared bankrupt (3).</summary>
    public int CureMonths { get; init; }

    /// <summary>Penalty interest per month on a negative cash balance while in distress (2 %).</summary>
    public decimal DistressMonthlyRate { get; init; }

    /// <summary>
    /// Quarter-end bankruptcy trigger: equity below this fraction of total assets (−20 %). Zero
    /// disables the test.
    /// </summary>
    public decimal BankruptcyEquityToAssets { get; init; }

    /// <summary>After a cure the rating is capped at B− for this many months (12).</summary>
    public int PostCureRatingCapMonths { get; init; }

    // ------------------------------------------------------------------ disposals

    /// <summary>Selling or demolishing a building (P1 rule of §4.8, pulled into P0 by the bridge).</summary>
    public bool Disposals { get; init; }

    /// <summary>A sold building's structure fetches this share of its net book value (60 %).</summary>
    public decimal SaleStructureRecovery { get; init; }

    /// <summary>Demolition clears the building's stock at this share of cost (50 %).</summary>
    public decimal DemolitionInventoryRecovery { get; init; }

    /// <summary>Liquidation fire-sale value of land, as a share of cost (70 %).</summary>
    public decimal FireSaleLand { get; init; }

    /// <summary>Liquidation fire-sale value of structures and equipment, as a share of net book value (40 %).</summary>
    public decimal FireSaleStructure { get; init; }

    /// <summary>Liquidation fire-sale value of inventory, as a share of cost (50 %).</summary>
    public decimal FireSaleInventory { get; init; }

    /// <summary>Liquidation value of construction in progress, as a share of cost (30 %).</summary>
    public decimal FireSaleConstruction { get; init; }

    // ------------------------------------------------------------------ §4.11 / §4.18 value

    /// <summary>
    /// Company value is the fundamental equity value of §4.11 (market cap once listed, Wave 3)
    /// instead of the legacy total-assets figure.
    /// </summary>
    public bool FundamentalValuation { get; init; }

    /// <summary>The gameplay configuration used by <see cref="EconomyRules.Realistic"/>.</summary>
    public static FinanceRules Realistic { get; } = new()
    {
        Enabled = true,
        Depreciation = true,
        IncomeTaxRate = 0.25m,
        LossCarryForwardCap = 0.80m,
        PolicyRate = 0.04m,
        TermLoans = true,
        TermLoanMargin = 0.0075m,
        MinLoanTermMonths = 12,
        MaxLoanTermMonths = 240,
        Revolver = true,
        RevolverMargin = 0.015m,
        RevolverAssetCap = 0.20m,
        RevolverSweepBufferMonths = 2m,
        CreditRating = true,
        SeasoningMonths = 12,
        MaxRatingMovePerQuarter = 2,
        Solvency = true,
        CureMonths = 3,
        DistressMonthlyRate = 0.02m,
        BankruptcyEquityToAssets = -0.20m,
        PostCureRatingCapMonths = 12,
        Disposals = true,
        SaleStructureRecovery = 0.60m,
        DemolitionInventoryRecovery = 0.50m,
        FireSaleLand = 0.70m,
        FireSaleStructure = 0.40m,
        FireSaleInventory = 0.50m,
        FireSaleConstruction = 0.30m,
        FundamentalValuation = true,
    };

    /// <summary>Throws when a knob is out of range.</summary>
    /// <exception cref="System.ArgumentException">A knob is out of range.</exception>
    public void Validate()
    {
        static void Fraction(decimal value, string name, decimal min = 0m, decimal max = 1m)
        {
            if (value < min || value > max)
            {
                throw new System.ArgumentException($"FinanceRules.{name} must be in [{min}, {max}] (was {value})");
            }
        }

        Fraction(IncomeTaxRate, nameof(IncomeTaxRate));
        Fraction(LossCarryForwardCap, nameof(LossCarryForwardCap));
        Fraction(PolicyRate, nameof(PolicyRate), -0.05m, 0.5m);
        Fraction(TermLoanMargin, nameof(TermLoanMargin), 0m, 0.5m);
        Fraction(RevolverMargin, nameof(RevolverMargin), 0m, 0.5m);
        Fraction(RevolverAssetCap, nameof(RevolverAssetCap));
        Fraction(DistressMonthlyRate, nameof(DistressMonthlyRate));
        Fraction(BankruptcyEquityToAssets, nameof(BankruptcyEquityToAssets), -10m, 0m);
        Fraction(SaleStructureRecovery, nameof(SaleStructureRecovery));
        Fraction(DemolitionInventoryRecovery, nameof(DemolitionInventoryRecovery));
        Fraction(FireSaleLand, nameof(FireSaleLand));
        Fraction(FireSaleStructure, nameof(FireSaleStructure));
        Fraction(FireSaleInventory, nameof(FireSaleInventory));
        Fraction(FireSaleConstruction, nameof(FireSaleConstruction));
        if (RevolverSweepBufferMonths < 0m) throw new System.ArgumentException("FinanceRules.RevolverSweepBufferMonths must be >= 0");
        if (MinLoanTermMonths < 0 || MaxLoanTermMonths < MinLoanTermMonths)
        {
            throw new System.ArgumentException($"FinanceRules loan terms must satisfy 0 <= min <= max (was {MinLoanTermMonths}..{MaxLoanTermMonths})");
        }

        if (SeasoningMonths < 0 || CureMonths < 0 || PostCureRatingCapMonths < 0 || MaxRatingMovePerQuarter < 0)
        {
            throw new System.ArgumentException("FinanceRules month counts and notch caps must be >= 0");
        }
    }
}
