using System.Collections.Generic;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;

namespace Magnate.Engine.Simulation;

/// <summary>One production slot inside a factory — produces a single product from a recipe.</summary>
public sealed class ProductionSlot
{
    /// <summary>Slot position (0 ≤ index &lt; building capacity).</summary>
    public int Index { get; }

    /// <summary>Product whose recipe the slot runs.</summary>
    public ProductId Product { get; }

    /// <summary>Create a slot (engine code uses <c>World.ConfigureProductionSlot</c>).</summary>
    public ProductionSlot(int index, ProductId product)
    {
        Index = index;
        Product = product;
    }
}

/// <summary>
/// One extraction slot inside a raw-material building (farm, mine, oil well, etc.).
/// Produces its configured product at the product's declared yield per month — no inputs consumed.
/// </summary>
public sealed class ExtractionSlot
{
    /// <summary>Slot position (0 ≤ index &lt; building capacity).</summary>
    public int Index { get; }

    /// <summary>Raw product the slot extracts.</summary>
    public ProductId Product { get; }

    /// <summary>Create a slot (engine code uses <c>World.ConfigureExtractionSlot</c>).</summary>
    public ExtractionSlot(int index, ProductId product)
    {
        Index = index;
        Product = product;
    }
}

/// <summary>
/// One research slot inside an R&amp;D center — accumulates research points toward
/// the next tech level of the configured product.
/// </summary>
public sealed class ResearchSlot
{
    /// <summary>Slot position (0 ≤ index &lt; building capacity).</summary>
    public int Index { get; }

    /// <summary>Product whose tech level the slot researches.</summary>
    public ProductId Product { get; }

    /// <summary>Create a slot (engine code uses <c>World.ConfigureResearchSlot</c>).</summary>
    public ResearchSlot(int index, ProductId product)
    {
        Index = index;
        Product = product;
    }
}

/// <summary>
/// One stockpile slot inside a warehouse — maintains a target stock level of a single
/// product. Each monthly tick the warehouse tops up this slot via the usual procurement
/// hierarchy (own producers, then world market).
/// </summary>
public sealed class WarehouseSlot
{
    /// <summary>Slot position (0 ≤ index &lt; building capacity).</summary>
    public int Index { get; }

    /// <summary>Product kept in stock.</summary>
    public ProductId Product { get; }

    /// <summary>Stock level the warehouse tops up to each month. Prefer <c>World.SetWarehouseTarget</c>.</summary>
    public double TargetStock { get; set; }

    /// <summary>Create a slot (engine code uses <c>World.ConfigureWarehouseSlot</c>).</summary>
    public WarehouseSlot(int index, ProductId product, double targetStock)
    {
        Index = index;
        Product = product;
        TargetStock = targetStock;
    }
}

/// <summary>One retail slot inside a retailer — sells a single product at a set price.</summary>
public sealed class RetailSlot
{
    /// <summary>Slot position (0 ≤ index &lt; building capacity).</summary>
    public int Index { get; }

    /// <summary>Product sold.</summary>
    public ProductId Product { get; }

    /// <summary>Shelf price per unit. Prefer <c>World.SetRetailPrice</c> (validated).</summary>
    public decimal Price { get; set; }

    /// <summary>Target stock level; retailer auto-restocks up to this quantity each month.</summary>
    public double RestockTarget { get; set; }

    /// <summary>Create a slot (engine code uses <c>World.ConfigureRetailSlot</c>).</summary>
    public RetailSlot(int index, ProductId product, decimal price, double restockTarget)
    {
        Index = index;
        Product = product;
        Price = price;
        RestockTarget = restockTarget;
    }
}

/// <summary>A constructed building in a city, owned by a company.</summary>
public sealed class BuildingInstance
{
    /// <summary>Runtime id (monotonic, never reused).</summary>
    public BuildingInstanceId Id { get; }

    /// <summary>Content building type.</summary>
    public BuildingTypeId TypeId { get; }

    /// <summary>Owning company.</summary>
    public CompanyId Owner { get; }

    /// <summary>City the building stands in.</summary>
    public CityId City { get; }

    /// <summary>Goods on hand, at weighted-average cost and quality.</summary>
    public Inventory Inventory { get; } = new();

    // Slot lists keep configuration order: the tick iterates retail slots (demand) and
    // production/extraction slots (auto-export) in list order, and saves (v10) persist it.

    /// <summary>Production slots, in configuration order.</summary>
    public List<ProductionSlot> ProductionSlots { get; } = new();

    /// <summary>Extraction slots, in configuration order.</summary>
    public List<ExtractionSlot> ExtractionSlots { get; } = new();

    /// <summary>Warehouse slots, in configuration order.</summary>
    public List<WarehouseSlot> WarehouseSlots { get; } = new();

    /// <summary>Retail slots, in configuration order.</summary>
    public List<RetailSlot> RetailSlots { get; } = new();

    /// <summary>Research slots, in configuration order.</summary>
    public List<ResearchSlot> ResearchSlots { get; } = new();

    /// <summary>Phase 1.2: factories auto-export all output to world market at month end.</summary>
    public bool AutoExport { get; set; } = true;

    /// <summary>
    /// Upgrade level of this building (Phase 3.59). Starts at 1 on construction.
    /// Advanced through <c>World.UpgradeBuilding</c>, up to the maximum defined
    /// on the <see cref="Domain.BuildingType.Levels"/> ladder. Buildings whose
    /// type has no <c>Levels</c> config remain at Level 1 forever.
    /// </summary>
    public int Level { get; internal set; } = 1;

    /// <summary>
    /// Month the building was constructed (bridge-spec E17). Saves older than v10 fall back to
    /// the date of the building's first <c>ConstructionCost</c> ledger entry.
    /// </summary>
    public GameDate BuiltAt { get; internal set; }

    /// <summary>
    /// Historical cost capitalised into this building (econ-audit §4.8/§4.15, bridge-spec E5):
    /// the construction cost paid when it was built plus every upgrade's cost. Upgrade capex is
    /// capitalised under every ruleset, so the books close after an upgrade.
    /// </summary>
    public decimal CapitalizedCost { get; internal set; }

    /// <summary>
    /// Accumulated depreciation booked against this building (econ-audit §4.8), maintained by
    /// <c>World.RecordAccrual</c> together with the accrual-journal entry. Always zero in Classic.
    /// </summary>
    public decimal AccumulatedDepreciation { get; internal set; }

    /// <summary>Net book value of the structure: <see cref="CapitalizedCost"/> − <see cref="AccumulatedDepreciation"/>.</summary>
    public decimal StructureBookValue => AccumulatedDepreciation == 0m ? CapitalizedCost : CapitalizedCost - AccumulatedDepreciation;

    /// <summary>
    /// Net book value of the structure (E2): <see cref="CapitalizedCost"/> −
    /// <see cref="AccumulatedDepreciation"/>. Land at cost and construction in progress live in
    /// the finance asset register (<c>World.GetLandCost</c> / <c>World.GetConstructionInProgress</c>).
    /// </summary>
    public decimal BookValue => StructureBookValue;

    // ------------------------------------------------------------------ plots and construction (E3b)

    /// <summary>
    /// The building's site on its city's layout (north-west plot of the rotated footprint and
    /// the rotation), or null when it has none: Classic worlds and saves older than the land
    /// integration whose site could not be migrated. A retired building keeps its last site as
    /// history but no longer occupies it.
    /// </summary>
    public PlotRef? Placement { get; internal set; }

    /// <summary>The month the building took its site (construction start); null without a placement.</summary>
    public GameDate? SitedAt { get; internal set; }

    /// <summary>Construction progress while the building is being built; null once it is complete (and always in Classic).</summary>
    public ConstructionState? Construction { get; internal set; }

    /// <summary>
    /// The month the building was retired (its construction was cancelled), or null. A retired
    /// building keeps its id, ledger history and record but no longer occupies its site and has
    /// no slots, costs or value; every operation ignores it.
    /// </summary>
    public GameDate? RetiredAt { get; internal set; }

    /// <summary>True while the building is being built.</summary>
    public bool IsUnderConstruction => Construction is not null;

    /// <summary>True once retired (construction cancelled).</summary>
    public bool IsRetired => RetiredAt is not null;

    /// <summary>
    /// True when the building runs: complete and not retired. Tick steps that operate buildings
    /// (payroll, research, extraction, production, restock, demand, export) skip the others;
    /// slots may be configured during construction and start working on completion.
    /// </summary>
    public bool IsOperational => Construction is null && RetiredAt is null;

    internal BuildingInstance(BuildingInstanceId id, BuildingTypeId typeId, CompanyId owner, CityId city)
    {
        Id = id;
        TypeId = typeId;
        Owner = owner;
        City = city;
    }
}

/// <summary>
/// Progress of a building under construction (econ-audit §4.12, bridge-spec §8.3). The deposit
/// was paid when construction started; one instalment is due at every month close until
/// <see cref="MonthsRemaining"/> reaches zero. A month whose instalment cannot be funded pauses
/// the project (nothing is paid, <see cref="CompletesAt"/> moves out a month).
/// <para>
/// An order placed through the auto-siting <c>World.Construct(owner, type, city)</c> when no site
/// is free or affordable waits for one (<see cref="AwaitingSite"/>): nothing is paid, and the
/// construction step retries every month; works start (land bought, deposit paid) the month a site
/// is found.
/// </para>
/// </summary>
public sealed class ConstructionState
{
    internal ConstructionState(GameDate orderedAt, ConstructionSchedule schedule, bool awaitingSite)
    {
        OrderedAt = orderedAt;
        StartedAt = orderedAt;
        AwaitingSite = awaitingSite;
        MonthsTotal = schedule.Months;
        MonthsRemaining = schedule.Months;
        CompletesAt = AddMonths(orderedAt, schedule.Months);
        CostPaid = awaitingSite ? 0m : schedule.Deposit;
        CostRemaining = schedule.ConstructionCost - CostPaid;
        Deposit = schedule.Deposit;
        Instalment = schedule.Instalment;
        FinalInstalment = schedule.FinalInstalment;
    }

    internal ConstructionState(
        GameDate orderedAt,
        GameDate startedAt,
        GameDate completesAt,
        bool awaitingSite,
        int monthsTotal,
        int monthsRemaining,
        decimal costPaid,
        decimal costRemaining,
        decimal deposit,
        decimal instalment,
        decimal finalInstalment,
        int pausedMonths)
    {
        OrderedAt = orderedAt;
        StartedAt = startedAt;
        CompletesAt = completesAt;
        AwaitingSite = awaitingSite;
        MonthsTotal = monthsTotal;
        MonthsRemaining = monthsRemaining;
        CostPaid = costPaid;
        CostRemaining = costRemaining;
        Deposit = deposit;
        Instalment = instalment;
        FinalInstalment = finalInstalment;
        PausedMonths = pausedMonths;
    }

    /// <summary>Month the order was placed.</summary>
    public GameDate OrderedAt { get; }

    /// <summary>Month works started (land bought, deposit paid); equals <see cref="OrderedAt"/> unless the order waited for a site.</summary>
    public GameDate StartedAt { get; internal set; }

    /// <summary>True while the order waits for a free, affordable site (nothing paid yet).</summary>
    public bool AwaitingSite { get; internal set; }

    /// <summary>Projected completion month (moves out by one for every paused or waiting month).</summary>
    public GameDate CompletesAt { get; internal set; }

    /// <summary>Planned build duration in months (0: the building completes the month works start).</summary>
    public int MonthsTotal { get; }

    /// <summary>Instalments still to pay; the building completes when the last one is paid.</summary>
    public int MonthsRemaining { get; internal set; }

    /// <summary>Construction cost paid so far (deposit plus instalments).</summary>
    public decimal CostPaid { get; internal set; }

    /// <summary>Construction cost still to pay.</summary>
    public decimal CostRemaining { get; internal set; }

    /// <summary>The deposit due when works start.</summary>
    public decimal Deposit { get; }

    /// <summary>Each monthly instalment except the last.</summary>
    public decimal Instalment { get; }

    /// <summary>The last instalment (absorbs the rounding remainder).</summary>
    public decimal FinalInstalment { get; }

    /// <summary>Months the project stood still because its instalment could not be funded.</summary>
    public int PausedMonths { get; internal set; }

    /// <summary>The instalment due at the next month close.</summary>
    public decimal NextInstalment => MonthsRemaining <= 1 ? FinalInstalment : Instalment;

    /// <summary>Share of the build time elapsed, 0–1 (month-granular; 0 while awaiting a site).</summary>
    public double Progress => AwaitingSite ? 0.0 : MonthsTotal <= 0 ? 1.0 : (MonthsTotal - MonthsRemaining) / (double)MonthsTotal;

    internal static GameDate AddMonths(GameDate date, int months)
    {
        for (var i = 0; i < months; i++) date = date.AddMonth();
        return date;
    }
}
