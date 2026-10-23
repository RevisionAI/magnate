using System;

namespace Magnate.Engine.Rules;

/// <summary>
/// Market-side realism: demand model (econ-audit §4.1–4.3), incumbent local competition,
/// retail throughput and location, world-market spreads and depth (§4.4), labour, utilities and
/// building overhead charged by the payroll step (§4.5–4.6), advertising adjustments (§4.20),
/// retail tier validation (bridge-spec E7) and the AI pricing rules of §4.17.
/// <para>
/// <b>Neutral value.</b> <see cref="Enabled"/> is the area switch and defaults to <c>false</c>:
/// every market step then runs the Classic code path untouched, and no other knob is read. The
/// knobs below are only consulted when <see cref="Enabled"/> is <c>true</c>, so any value of
/// theirs reproduces Classic; their defaults are the econ-audit gameplay calibration, which is
/// what <see cref="EconomyRules.Realistic"/> uses (<see cref="Gameplay"/>). Saves persist the
/// full record; a knob added later loads from an older save with its default.
/// </para>
/// <para>Only scalar fields: the record keeps value equality across a save/load round trip.</para>
/// </summary>
public sealed record MarketRules
{
    /// <summary>
    /// Master switch for the realistic market model. When <c>false</c> every market step runs
    /// the Classic code path untouched.
    /// </summary>
    public bool Enabled { get; init; }

    /// <summary>The gameplay configuration (econ-audit §4–§5 calibration, normal difficulty).</summary>
    public static MarketRules Gameplay { get; } = new() { Enabled = true };

    // ------------------------------------------------------------------ demand (§4.1)

    /// <summary>Share of unserved demand (stock-outs, capacity) re-offered once to offers with spare stock and to incumbents.</summary>
    public double SpillFraction { get; init; } = 0.60;

    /// <summary>World technology as a share of a product's max tech level (P0: frozen at the game-start 30 %).</summary>
    public double WorldTechShare { get; init; } = 0.30;

    // ------------------------------------------------------------------ incumbents (§4.2)

    /// <summary>
    /// Strength of the permanent local competition: 0.6 easy, 1.0 normal, 1.4 hard (CapLab
    /// LOCALCOMP). 0 removes incumbents (a test configuration; the game always has them).
    /// </summary>
    public double IncumbentStrength { get; init; } = 1.0;

    /// <summary>
    /// Utilisation at which an average new store with average attributes runs against the
    /// incumbents at the reference price: sizes the incumbent mass.
    /// </summary>
    public double IncumbentUtilisation { get; init; } = 0.75;

    /// <summary>Minimum incumbent mass, in equivalent reference-store slots.</summary>
    public double IncumbentMinMass { get; init; } = 0.5;

    // ------------------------------------------------------------------ retail (§4.3)

    /// <summary>Stock cap per offer, in months of throughput capacity (restock targets are clamped to it).</summary>
    public double StockCapMonths { get; init; } = 1.5;

    /// <summary>Attractiveness gain per store level above 1 (L2 +10 %, L3 +20 %).</summary>
    public double LevelAttractiveness { get; init; } = 0.10;

    /// <summary>Retail variable costs (card fees, shrink, bags) as a share of retail sales.</summary>
    public decimal RetailVariableRate { get; init; } = 0.015m;

    // ------------------------------------------------------------------ world market (§4.4)

    /// <summary>Exponent of the export price factor <c>(1 + V/Depth)^−x</c>.</summary>
    public double ExportDepthExponent { get; init; } = 0.5;

    /// <summary>
    /// Whether newly constructed buildings start with auto-export on (master plan D7: off under
    /// Realistic). Read by the construction code through <c>World.ApplyMarketDefaults</c>.
    /// </summary>
    public bool AutoExportByDefault { get; init; }

    /// <summary>Months of fixed costs a company keeps back from world-market purchases (affordability cap).</summary>
    public decimal CashReserveMonths { get; init; } = 1m;

    // ------------------------------------------------------------------ labour (§4.5)

    /// <summary>Fully loaded monthly wage of a production worker (BLS manufacturing $30.37/h × 173.3 h × 1.30).</summary>
    public decimal WageProduction { get; init; } = 6_842m;

    /// <summary>Fully loaded monthly wage of store staff.</summary>
    public decimal WageRetail { get; init; } = 4_855m;

    /// <summary>Fully loaded monthly wage of a farm worker.</summary>
    public decimal WageFarm { get; init; } = 4_224m;

    /// <summary>Fully loaded monthly wage of a mine or oil-field worker.</summary>
    public decimal WageExtraction { get; init; } = 8_110m;

    /// <summary>Fully loaded monthly wage of administration and management.</summary>
    public decimal WageAdmin { get; init; } = 10_138m;

    /// <summary>Fully loaded monthly wage of an R&amp;D scientist.</summary>
    public decimal WageScientist { get; init; } = 13_517m;

    /// <summary>Fully loaded monthly wage of media staff.</summary>
    public decimal WageMedia { get; init; } = 8_800m;

    /// <summary>Fixed staff multiplier at level 2 (level 3 uses <see cref="Level3StaffMultiplier"/>).</summary>
    public double Level2StaffMultiplier { get; init; } = 1.25;

    /// <summary>Fixed staff multiplier at level 3.</summary>
    public double Level3StaffMultiplier { get; init; } = 1.50;

    // ------------------------------------------------------------------ utilities and overhead (§4.6)

    /// <summary>Industrial electricity tariff ($/kWh, EIA Jun-2026) for production energy.</summary>
    public decimal IndustrialPowerPrice { get; init; } = 0.092m;

    /// <summary>
    /// Finished-goods buffer of a production slot, in months of its output: a slot only produces
    /// up to this much of its product on hand in the building (output that is exported or pulled
    /// by the company's stores leaves room for more). Stops plants from piling up unsellable stock.
    /// </summary>
    public double OutputBufferMonths { get; init; } = 1.0;

    /// <summary>Whether a production/extraction slot pays its line or equipment capex the first month it runs.</summary>
    public bool ChargeLineEquipment { get; init; } = true;

    /// <summary>Annual maintenance on structure cost.</summary>
    public decimal MaintenanceStructureRate { get; init; } = 0.015m;

    /// <summary>Annual maintenance on installed equipment cost.</summary>
    public decimal MaintenanceEquipmentRate { get; init; } = 0.04m;

    /// <summary>Annual insurance on gross PP&amp;E.</summary>
    public decimal InsuranceRate { get; init; } = 0.003m;

    /// <summary>Annual property tax on land cost + building net book value.</summary>
    public decimal PropertyTaxRate { get; init; } = 0.012m;

    /// <summary>Annual property tax for farms and plantations.</summary>
    public decimal AgriculturalPropertyTaxRate { get; init; } = 0.006m;

    // ------------------------------------------------------------------ advertising (§4.20)

    /// <summary>Monthly brand-awareness decay, applied to every (company, product, city), campaign or not.</summary>
    public double BrandDecayRate { get; init; } = 0.03;

    /// <summary>TV cost per awareness point per 1,000 residents ($).</summary>
    public decimal AdCostPerThousandTv { get; init; } = 25m;

    /// <summary>Radio cost per awareness point per 1,000 residents ($).</summary>
    public decimal AdCostPerThousandRadio { get; init; } = 18m;

    /// <summary>Newspaper cost per awareness point per 1,000 residents ($).</summary>
    public decimal AdCostPerThousandNewspaper { get; init; } = 20m;

    /// <summary>Magazine cost per awareness point per 1,000 residents ($).</summary>
    public decimal AdCostPerThousandMagazine { get; init; } = 28m;

    // ------------------------------------------------------------------ AI (§4.17)

    /// <summary>Largest monthly AI price move, as a fraction of the current price.</summary>
    public decimal AiPriceStep { get; init; } = 0.05m;

    /// <summary>AI price ceiling as a multiple of the city reference price.</summary>
    public decimal AiPriceCeiling { get; init; } = 1.6m;

    /// <summary>AI price floor as a multiple of unit cost.</summary>
    public decimal AiPriceFloorOverCost { get; init; } = 1.05m;

    /// <summary>AI restock target as a multiple of trailing monthly sales.</summary>
    public double AiRestockCover { get; init; } = 1.2;

    /// <summary>Throws when a knob is out of range.</summary>
    /// <exception cref="ArgumentException">A knob is out of range.</exception>
    public void Validate()
    {
        static void Range(string name, double value, double min, double max)
        {
            if (!(value >= min && value <= max)) throw new ArgumentException($"MarketRules.{name} must be in [{min}, {max}] (was {value})");
        }

        Range(nameof(SpillFraction), SpillFraction, 0, 1);
        Range(nameof(WorldTechShare), WorldTechShare, 0, 1);
        Range(nameof(IncumbentStrength), IncumbentStrength, 0, 10);
        Range(nameof(IncumbentUtilisation), IncumbentUtilisation, 0.05, 1);
        Range(nameof(IncumbentMinMass), IncumbentMinMass, 0, 1000);
        Range(nameof(StockCapMonths), StockCapMonths, 0.1, 24);
        Range(nameof(OutputBufferMonths), OutputBufferMonths, 0.1, 24);
        Range(nameof(LevelAttractiveness), LevelAttractiveness, 0, 1);
        Range(nameof(RetailVariableRate), (double)RetailVariableRate, 0, 0.5);
        Range(nameof(ExportDepthExponent), ExportDepthExponent, 0, 4);
        Range(nameof(CashReserveMonths), (double)CashReserveMonths, 0, 24);
        Range(nameof(BrandDecayRate), BrandDecayRate, 0, 1);
        Range(nameof(AiPriceStep), (double)AiPriceStep, 0, 1);
        Range(nameof(AiPriceCeiling), (double)AiPriceCeiling, 0.1, 100);
        Range(nameof(AiPriceFloorOverCost), (double)AiPriceFloorOverCost, 0, 10);
        Range(nameof(AiRestockCover), AiRestockCover, 0.1, 10);
        Range(nameof(Level2StaffMultiplier), Level2StaffMultiplier, 0, 10);
        Range(nameof(Level3StaffMultiplier), Level3StaffMultiplier, 0, 10);
        foreach (var (name, value) in new (string, decimal)[]
        {
            (nameof(WageProduction), WageProduction), (nameof(WageRetail), WageRetail), (nameof(WageFarm), WageFarm),
            (nameof(WageExtraction), WageExtraction), (nameof(WageAdmin), WageAdmin), (nameof(WageScientist), WageScientist),
            (nameof(WageMedia), WageMedia), (nameof(IndustrialPowerPrice), IndustrialPowerPrice),
            (nameof(MaintenanceStructureRate), MaintenanceStructureRate), (nameof(MaintenanceEquipmentRate), MaintenanceEquipmentRate),
            (nameof(InsuranceRate), InsuranceRate), (nameof(PropertyTaxRate), PropertyTaxRate),
            (nameof(AgriculturalPropertyTaxRate), AgriculturalPropertyTaxRate),
        })
        {
            if (value < 0m) throw new ArgumentException($"MarketRules.{name} must be >= 0 (was {value})");
        }

        foreach (var (name, value) in new (string, decimal)[]
        {
            (nameof(AdCostPerThousandTv), AdCostPerThousandTv), (nameof(AdCostPerThousandRadio), AdCostPerThousandRadio),
            (nameof(AdCostPerThousandNewspaper), AdCostPerThousandNewspaper), (nameof(AdCostPerThousandMagazine), AdCostPerThousandMagazine),
        })
        {
            if (value <= 0m) throw new ArgumentException($"MarketRules.{name} must be positive (was {value})");
        }
    }
}
