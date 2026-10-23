using System;
using System.Collections.Generic;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Rules;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Top-level mutable state of a Magnate simulation. Holds companies, buildings,
/// the ledger, and drives the monthly tick.
/// <para>
/// The class is split into partial files by area: <c>World.cs</c> (state, construction of the
/// world, companies, cash/COGS recording, persistence accessors),
/// <c>World.Construction.cs</c> (buildings, upgrades, slots), <c>World.Advertising.cs</c>
/// (campaigns, brand), <c>World.Research.cs</c> (tech, R&amp;D, patents, licences),
/// <c>World.EventsNews.cs</c> (news log, world-price overlays), <c>World.Reports.cs</c>
/// (statements, market share, product P&amp;L) and <c>World.Ai.cs</c> (AI registry and
/// <see cref="AdvanceMonth"/>). The monthly pipeline itself lives in
/// <c>Simulation/Tick/</c>.
/// </para>
/// </summary>
public sealed partial class World
{
    private int _nextCompanyId = 1;
    private int _nextBuildingId = 1;

    private readonly Dictionary<CompanyId, Company> _companies = new();
    private readonly Dictionary<BuildingInstanceId, BuildingInstance> _buildings = new();
    private readonly Dictionary<CompanyId, IAiStrategy> _aiStrategies = new();
    private readonly Dictionary<(CompanyId Company, ProductId Product), int> _tech = new();
    private readonly Dictionary<(CompanyId Company, ProductId Product, CityId City), double> _brandAwareness = new();
    private readonly Dictionary<(CompanyId Company, ProductId Product), double> _researchProgress = new();
    private readonly Dictionary<(CompanyId Company, ProductId Product, CityId City, AdChannel Channel), AdCampaign> _adCampaigns = new();
    private readonly Dictionary<(CompanyId Holder, ProductId Product), Patent> _patents = new();
    private readonly HashSet<(CompanyId Holder, ProductId Product)> _patentsEverGranted = new();
    private readonly Dictionary<(CompanyId Holder, ProductId Product), HashSet<CompanyId>> _patentLicenses = new();
    private readonly List<NewsEntry> _newsLog = new();
    private readonly Dictionary<ProductId, ActivePriceEffect> _activePriceEffects = new();

    /// <summary>Immutable game content (products, buildings, cities, events) the world runs on.</summary>
    public ContentCatalog Catalog { get; }

    /// <summary>The in-game month. Advanced only by <see cref="AdvanceMonth"/>.</summary>
    public GameClock Clock { get; }

    /// <summary>Every cash movement; <c>Company.Cash == Σ ledger</c> for every company.</summary>
    public Ledger Ledger { get; } = new();

    /// <summary>Internal goods movements between a company's own buildings (no cash).</summary>
    public TransferLog TransferLog { get; } = new();

    /// <summary>Cost of goods sold recognised on every sale and export.</summary>
    public CogsLog CogsLog { get; } = new();

    /// <summary>
    /// Non-cash accounting entries (depreciation, disposal gains/losses, write-offs; econ-audit
    /// §4.15). Empty in Classic. Engine code appends through <see cref="RecordAccrual"/>.
    /// </summary>
    public AccrualJournal AccrualJournal { get; } = new();
    /// <summary>
    /// The random events stream (<see cref="RngStreams.Events"/>). Kept for source compatibility;
    /// new random consumers take their own named stream from <see cref="RngStreams"/> so they
    /// never shift the event schedule.
    /// </summary>
    public IRandomSource Rng => RngStreams.Events;

    /// <summary>
    /// Every named random stream of this world, derived from <see cref="Seed"/> and persisted with
    /// it (econ-audit §4.19). Get a stream with <c>RngStreams.Get(RngStreams.MacroStream)</c>.
    /// </summary>
    public RngStreams RngStreams { get; }

    /// <summary>The seed the world was created with; persisted so loads continue every stream.</summary>
    public int Seed => RngStreams.WorldSeed;

    /// <summary>Every company, keyed by id (ids are monotonic and never reused).</summary>
    public IReadOnlyDictionary<CompanyId, Company> Companies => _companies;

    /// <summary>Every building, keyed by id (ids are monotonic and never reused).</summary>
    public IReadOnlyDictionary<BuildingInstanceId, BuildingInstance> Buildings => _buildings;

    /// <summary>
    /// The immutable economic ruleset this world runs under (master plan D3). Every
    /// rule-gated mechanic reads it; Classic worlds take the pre-overhaul code paths.
    /// </summary>
    public EconomyRules Rules { get; }

    /// <summary>Create an empty world under <see cref="EconomyRules.Classic"/> rules.</summary>
    public World(ContentCatalog catalog, int seed, GameDate startDate)
        : this(catalog, seed, startDate, EconomyRules.Classic)
    {
    }

    /// <summary>Create an empty world under an explicit ruleset.</summary>
    /// <exception cref="ArgumentNullException"><paramref name="catalog"/> or <paramref name="rules"/> is null.</exception>
    /// <exception cref="ArgumentException"><paramref name="rules"/> fails <see cref="EconomyRules.Validate"/>.</exception>
    public World(ContentCatalog catalog, int seed, GameDate startDate, EconomyRules rules)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(rules);
        rules.Validate();
        Catalog = catalog;
        Rules = rules;
        RngStreams = new RngStreams(seed);
        Clock = new GameClock(startDate);
    }

    /// <summary>
    /// Found a company with <paramref name="startingCash"/> booked as
    /// <see cref="LedgerCategory.StartingCapital"/> (a company-level owner contribution).
    /// </summary>
    /// <exception cref="ArgumentException">Blank name or non-positive starting cash.</exception>
    public Company CreateCompany(string name, decimal startingCash)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("name required", nameof(name));
        if (startingCash <= 0) throw new ArgumentException("startingCash must be positive", nameof(startingCash));

        var id = new CompanyId(_nextCompanyId++);
        var company = new Company(id, name);
        _companies[id] = company;

        // StartingCapital is a company-wide equity injection, not tied to any building — leave building null.
        RecordCashChange(id, LedgerCategory.StartingCapital, startingCash, "starting capital");
        return company;
    }

    internal int InternalNextCompanyId { get => _nextCompanyId; set => _nextCompanyId = value; }
    internal int InternalNextBuildingId { get => _nextBuildingId; set => _nextBuildingId = value; }
    internal Dictionary<CompanyId, Company> InternalCompanies => _companies;
    internal Dictionary<BuildingInstanceId, BuildingInstance> InternalBuildings => _buildings;
    internal Dictionary<CompanyId, IAiStrategy> InternalAiStrategies => _aiStrategies;
    internal Dictionary<(CompanyId Company, ProductId Product), int> InternalTech => _tech;
    internal Dictionary<(CompanyId Company, ProductId Product, CityId City), double> InternalBrandAwareness => _brandAwareness;
    internal Dictionary<(CompanyId Company, ProductId Product), double> InternalResearchProgress => _researchProgress;
    internal Dictionary<(CompanyId Company, ProductId Product, CityId City, AdChannel Channel), AdCampaign> InternalAdCampaigns => _adCampaigns;
    internal Dictionary<(CompanyId Holder, ProductId Product), Patent> InternalPatents => _patents;
    internal HashSet<(CompanyId Holder, ProductId Product)> InternalPatentsEverGranted => _patentsEverGranted;
    internal Dictionary<(CompanyId Holder, ProductId Product), HashSet<CompanyId>> InternalPatentLicenses => _patentLicenses;
    internal List<NewsEntry> InternalNewsLog => _newsLog;
    internal Dictionary<ProductId, ActivePriceEffect> InternalActivePriceEffects => _activePriceEffects;

    internal Company RequireCompany(CompanyId id)
        => _companies.TryGetValue(id, out var c) ? c : throw new KeyNotFoundException($"unknown company {id}");

    internal BuildingInstance RequireBuilding(BuildingInstanceId id)
        => _buildings.TryGetValue(id, out var b) ? b : throw new KeyNotFoundException($"unknown building {id}");

    /// <summary>
    /// Central mutation point for company cash. Always records a ledger entry so
    /// the invariant <c>Company.Cash == sum(ledger entries for company)</c> holds.
    /// Pass <paramref name="product"/> for product-attributable categories so the
    /// per-product profitability report can group correctly. Pass
    /// <paramref name="building"/> (Phase 3.29) when the flow is clearly driven by
    /// a specific building so the per-building P&amp;amp;L view can slice correctly, and
    /// <paramref name="quantity"/> (bridge-spec E11) when the flow is per-unit.
    /// </summary>
    internal void RecordCashChange(
        CompanyId companyId,
        LedgerCategory category,
        decimal amount,
        string? memo,
        ProductId? product = null,
        BuildingInstanceId? building = null,
        double? quantity = null)
    {
        var company = RequireCompany(companyId);
        company.Cash += amount;
        Ledger.Record(new LedgerEntry(Clock.Now, companyId, category, amount, memo, product, building, quantity));
    }

    /// <summary>
    /// Record a non-cash accrual (econ-audit §4.15). A <see cref="AccrualKind.Depreciation"/>
    /// entry must name its building, whose <see cref="BuildingInstance.AccumulatedDepreciation"/>
    /// rises by the charge, so the balance sheet and the journal can never disagree.
    /// </summary>
    /// <param name="companyId">Company whose books the entry belongs to.</param>
    /// <param name="kind">Kind of entry.</param>
    /// <param name="amount">Signed effect on net income: negative for expenses and losses.</param>
    /// <param name="memo">Free text for reports.</param>
    /// <param name="building">Building concerned (required for depreciation).</param>
    /// <param name="product">Product concerned (inventory write-downs).</param>
    internal void RecordAccrual(
        CompanyId companyId,
        AccrualKind kind,
        decimal amount,
        string? memo,
        BuildingInstanceId? building = null,
        ProductId? product = null)
    {
        RequireCompany(companyId);
        if (kind == AccrualKind.Depreciation)
        {
            if (building is not BuildingInstanceId bid)
            {
                throw new ArgumentException("a depreciation entry must name its building", nameof(building));
            }

            var target = RequireBuilding(bid);
            if (target.Owner != companyId)
            {
                throw new InvalidOperationException($"building {bid} is owned by {target.Owner}, not {companyId}");
            }

            if (amount > 0m)
            {
                throw new ArgumentOutOfRangeException(nameof(amount), "depreciation is an expense: amount must be <= 0");
            }

            target.AccumulatedDepreciation -= amount;
        }

        AccrualJournal.Record(new AccrualEntry(Clock.Now, companyId, kind, amount, memo, building, product));
    }

    /// <summary>
    /// Record a Cost-of-Goods-Sold recognition. Called from <see cref="MonthlyTick"/>
    /// when goods leave inventory via sale or export. Has no cash impact — the
    /// underlying cash already moved when those goods were originally acquired.
    /// Pass <paramref name="sourceBuilding"/> (Phase 3.39) to attribute the
    /// recognition to the building whose inventory was drawn from so per-building
    /// accrual P&amp;amp;L can group correctly.
    /// </summary>
    internal void RecordCogs(
        CompanyId companyId,
        ProductId product,
        double quantity,
        decimal cost,
        BuildingInstanceId? sourceBuilding = null)
    {
        RequireCompany(companyId);
        CogsLog.Record(new CogsEntry(Clock.Now, companyId, product, quantity, cost, sourceBuilding));
    }
}
