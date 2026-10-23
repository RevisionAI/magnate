using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;

namespace Magnate.Engine.Simulation;

/// <summary>A hypothetical change to one offer, evaluated by <see cref="World.PreviewDemand"/>.</summary>
/// <remarks>
/// Name an existing store line with <see cref="Building"/> to change its price or stock; leave it
/// null and set <see cref="Owner"/> + <see cref="StoreType"/> to add a store that does not exist
/// yet (an expansion test).
/// </remarks>
public sealed record PreviewOffer
{
    /// <summary>Existing store whose line for the product is changed; null for a new store.</summary>
    public BuildingInstanceId? Building { get; init; }

    /// <summary>Owner of a new store (brand and tech come from it).</summary>
    public CompanyId? Owner { get; init; }

    /// <summary>Type of a new store.</summary>
    public BuildingTypeId? StoreType { get; init; }

    /// <summary>Price to evaluate; null keeps the line's price (a new store needs one).</summary>
    public decimal? Price { get; init; }

    /// <summary>Slots of a new store selling the product (default 1).</summary>
    public int Slots { get; init; } = 1;

    /// <summary>Level of a new store (default 1).</summary>
    public int Level { get; init; } = 1;

    /// <summary>Location factor of a new store (default 1, an average site).</summary>
    public double LocationFactor { get; init; } = 1.0;

    /// <summary>Stock quality of a new store (default: world-market quality).</summary>
    public double? Quality { get; init; }

    /// <summary>Sellable stock override (default: the line restocked to its target, or a new store's stock cap).</summary>
    public double? Stock { get; init; }
}

/// <summary>One offer in a <see cref="MarketPreview"/>.</summary>
/// <param name="Building">The store (null for a hypothetical new store).</param>
/// <param name="Owner">Owning company.</param>
/// <param name="Price">Offer price.</param>
/// <param name="Quality">Stock quality.</param>
/// <param name="Brand">Perceived brand: the owner's awareness after next month's advertising step, floored at the import brand.</param>
/// <param name="Tech">Technology score 0–100.</param>
/// <param name="Attractiveness">A.</param>
/// <param name="Capacity">Throughput capacity (units/month).</param>
/// <param name="Sellable">min(stock, capacity) assumed by the preview.</param>
/// <param name="Demand">Demand allocated before capacity and spill.</param>
/// <param name="Sold">Units sold including spill.</param>
/// <param name="Share">Share of category demand.</param>
/// <param name="Hypothetical">True for the offer the preview changed or added.</param>
public sealed record PreviewLine(
    BuildingInstanceId? Building,
    CompanyId Owner,
    decimal Price,
    double Quality,
    double Brand,
    double Tech,
    double Attractiveness,
    double Capacity,
    double Sellable,
    double Demand,
    double Sold,
    double Share,
    bool Hypothetical);

/// <summary>The demand model evaluated for one (city, product) market (bridge-spec E9).</summary>
/// <param name="City">City.</param>
/// <param name="Product">Product.</param>
/// <param name="Lines">Every store line (and the hypothetical store, last), in building-id order.</param>
/// <param name="IncumbentMass">A₀ of the local competition.</param>
/// <param name="IncumbentPrice">Local competition's price.</param>
/// <param name="IncumbentUnits">Units the local competition sells.</param>
/// <param name="ReferenceDemand">Market size at the reference point.</param>
/// <param name="TotalDemand">Category demand at the offered prices.</param>
/// <param name="TotalSold">Units sold by every offer and the incumbents.</param>
/// <param name="Lost">Demand lost to stock-outs after spill.</param>
/// <param name="Brackets">Per-bracket detail.</param>
public sealed record MarketPreview(
    CityId City,
    ProductId Product,
    IReadOnlyList<PreviewLine> Lines,
    double IncumbentMass,
    decimal IncumbentPrice,
    double IncumbentUnits,
    double ReferenceDemand,
    double TotalDemand,
    double TotalSold,
    double Lost,
    IReadOnlyList<BracketOutcome> Brackets)
{
    /// <summary>The changed or added offer, if the preview had one.</summary>
    public PreviewLine? Hypothetical => Lines.FirstOrDefault(l => l.Hypothetical);

    /// <summary>
    /// Demand the local competition draws before capacity and spill. With every line's
    /// <see cref="PreviewLine.Demand"/> it adds up to <see cref="TotalDemand"/>, so
    /// <c>IncumbentDemand / TotalDemand</c> is the incumbents' model share on the same footing as
    /// <see cref="PreviewLine.Share"/>.
    /// </summary>
    public double IncumbentDemand { get; init; }
}

// Market economics (econ-audit §4.1–4.7, §4.20; E1): demand model access, market share, world
// trade prices, operating-cost queries and the seams other workstreams plug into.
public sealed partial class World
{
    private readonly MarketState _marketState = new();
    private IBuildingSiteInfo? _siteInfo;
    private Land.LandSiteInfo? _landSiteInfo;

    /// <summary>Market-area state (trailing sales, line reports, installed equipment, exports).</summary>
    internal MarketState MarketState => _marketState;

    /// <summary>
    /// Where buildings stand: location factor, land cost, operational state (econ-audit §4.3). The
    /// land workstream (E3b) installs the plot-backed implementation; the default is neutral
    /// (L = 1, no land, always operational). Not persisted: the installer re-attaches it on load.
    /// </summary>
    /// <remarks>
    /// When nothing is set explicitly, worlds under land rules answer with
    /// <see cref="Land.LandSiteInfo"/> (plot location factor, land at cost, construction state),
    /// so the seam survives a load without re-attaching; other worlds are neutral.
    /// </remarks>
    public IBuildingSiteInfo SiteInfo
    {
        get => _siteInfo ?? (Rules.Land.Enabled ? _landSiteInfo ??= new Land.LandSiteInfo(this) : NeutralSiteInfo.Instance);
        set => _siteInfo = value;
    }

    private ICreditHeadroom? _creditHeadroom;

    /// <summary>
    /// Undrawn credit available to companies (the finance workstream's revolver). Null = none:
    /// world-market purchases are then capped by cash alone. Not persisted. When nothing is set
    /// explicitly and the finance rules run a revolver, the world answers with its own undrawn
    /// revolver (<see cref="Finance.RevolverCreditHeadroom"/>), so the seam needs no re-attaching after load.
    /// </summary>
    public ICreditHeadroom? CreditHeadroom
    {
        get => _creditHeadroom ?? (Rules.Finance.Enabled && Rules.Finance.Revolver ? Finance.RevolverCreditHeadroom.Instance : null);
        set => _creditHeadroom = value;
    }

    // ------------------------------------------------------------------ market share

    /// <summary>
    /// A company's share of <paramref name="product"/> in <paramref name="city"/>.
    /// <list type="bullet">
    ///   <item>Classic: the demand-allocation softmax replayed on current prices, quality, tech and
    ///         brand (no reservation gating; 0 when nobody retails it).</item>
    ///   <item>Realistic market rules (master plan D11): realised units sold by the company over the
    ///         trailing 3 months ÷ all units sold in that market, incumbents included.</item>
    /// </list>
    /// </summary>
    public double GetMarketShare(CompanyId company, ProductId product, CityId city)
    {
        if (Rules.Market.Enabled) return RealisedMarketShare(company, product, city);

        var retailers = _buildings.Values
            .Where(b => b.City == city && b.RetailSlots.Any(s => s.Product == product))
            .ToList();
        if (retailers.Count == 0) return 0.0;

        var prod = Catalog.Product(product);
        var elasticity = prod.PriceElasticity > 0 ? prod.PriceElasticity : 1.0;

        double totalWeight = 0.0;
        double companyWeight = 0.0;

        foreach (var b in retailers)
        {
            foreach (var slot in b.RetailSlots.Where(s => s.Product == product))
            {
                var q = b.Inventory.AverageQuality(product);
                var t = GetTech(b.Owner, product) * 10.0;
                var br = GetBrandAwareness(b.Owner, product, b.City);
                var desirability = Math.Max((q + t + br) / 3.0, 1.0);
                var weight = desirability / Math.Pow((double)slot.Price, elasticity);

                totalWeight += weight;
                if (b.Owner == company) companyWeight += weight;
            }
        }

        return totalWeight > 0 ? companyWeight / totalWeight : 0.0;
    }

    private double RealisedMarketShare(CompanyId company, ProductId product, CityId city)
    {
        double own = 0, total = 0;
        foreach (var month in _marketState.Trailing)
        {
            if (!month.Cells.TryGetValue((city, product), out var cell)) continue;
            total += cell.IncumbentUnits;
            foreach (var (companyId, units) in cell.CompanyUnits)
            {
                total += units;
                if (companyId == company.Value) own += units;
            }
        }

        return total > 0 ? own / total : 0.0;
    }

    /// <summary>
    /// Units sold in (city, product) over the trailing months (up to 3): per company id, plus the
    /// incumbents. Empty under Classic rules.
    /// </summary>
    public (IReadOnlyDictionary<CompanyId, double> Companies, double Incumbents) GetTrailingMarketUnits(CityId city, ProductId product)
    {
        var companies = new SortedDictionary<int, double>();
        double incumbents = 0;
        foreach (var month in _marketState.Trailing)
        {
            if (!month.Cells.TryGetValue((city, product), out var cell)) continue;
            incumbents += cell.IncumbentUnits;
            foreach (var (id, units) in cell.CompanyUnits)
            {
                companies[id] = companies.TryGetValue(id, out var v) ? v + units : units;
            }
        }

        return (companies.ToDictionary(kv => new CompanyId(kv.Key), kv => kv.Value), incumbents);
    }

    /// <summary>
    /// Units the permanent local competition (econ-audit §4.2) sold of <paramref name="product"/>
    /// in <paramref name="city"/> over the months <paramref name="from"/>..<paramref name="toInclusive"/>,
    /// for realised market shares that count the incumbents (master plan D11). Covers the last
    /// <see cref="MarketState.HistoryMonths"/> simulated months; 0 under Classic rules.
    /// </summary>
    public double GetIncumbentUnitsSold(ProductId product, CityId city, GameDate from, GameDate toInclusive)
    {
        double units = 0;
        foreach (var month in _marketState.History)
        {
            if (month.Month < from || month.Month > toInclusive) continue;
            if (month.Cells.TryGetValue((city, product), out var cell)) units += cell.IncumbentUnits;
        }

        return units;
    }

    /// <summary>
    /// Units sold in (city, product) in one month of the kept history: per company id, plus
    /// the incumbents. Null when that month is not in the history (or under Classic rules).
    /// </summary>
    public (IReadOnlyDictionary<CompanyId, double> Companies, double Incumbents)? GetMarketUnits(CityId city, ProductId product, GameDate month)
    {
        foreach (var m in _marketState.History)
        {
            if (m.Month != month) continue;
            if (!m.Cells.TryGetValue((city, product), out var cell)) return (new Dictionary<CompanyId, double>(), 0);
            return (cell.CompanyUnits.ToDictionary(kv => new CompanyId(kv.Key), kv => kv.Value), cell.IncumbentUnits);
        }

        return null;
    }

    // ------------------------------------------------------------------ demand preview (E9)

    /// <summary>
    /// Evaluate the Realistic demand model for one market with everything frozen except
    /// <paramref name="change"/> (econ-audit §4.17; bridge-spec E9). Read-only: no state changes.
    /// The market is taken as the next tick will see it at its sales step: existing lines
    /// restocked to their target (capped by the stock cap) and brand awareness after the month's
    /// advertising step (<see cref="GetProjectedBrandAwareness"/>). With no player or AI command in
    /// between, the preview is exactly the next tick's sales, except when a restock is cut short by
    /// cash or a research level completes during the tick.
    /// </summary>
    /// <exception cref="InvalidOperationException">The product is not a consumer good, or a new store lacks owner/type/price.</exception>
    public MarketPreview PreviewDemand(CityId city, ProductId product, PreviewOffer? change = null)
    {
        var cityDef = Catalog.City(city);
        var prod = Catalog.Product(product);
        if (prod.Demand is null) throw new InvalidOperationException($"'{product}' is not sold to consumers");

        var market = RetailMarket.MarketOf(this, cityDef, prod);
        var lines = RetailMarket.Lines(this, city, product);
        var offers = new List<DemandOffer>(lines.Count + 1);
        var meta = new List<(BuildingInstanceId? Building, CompanyId Owner, decimal Price, double Capacity, bool Hypothetical)>(lines.Count + 1);

        foreach (var line in lines)
        {
            var isChanged = change?.Building is BuildingInstanceId changed && changed == line.Building.Id;
            var target = RetailMarket.RestockTarget(this, line, prod);
            var stock = isChanged && change!.Stock is double s ? s : Math.Max(line.Building.Inventory.Get(product), target);
            var price = isChanged && change!.Price is decimal p ? p : line.Price;
            var offer = RetailMarket.OfferOf(this, line, prod, stock, price)
                with { Brand = GetProjectedBrandAwareness(line.Building.Owner, product, city) };
            offers.Add(offer);
            meta.Add((line.Building.Id, line.Building.Owner, price, RetailMarket.Capacity(line.Type, prod, line.Slots.Count), isChanged));
        }

        if (change is not null && change.Building is null)
        {
            if (change.Owner is not CompanyId owner || change.StoreType is not BuildingTypeId typeId || change.Price is not decimal price)
                throw new InvalidOperationException("a hypothetical new store needs an owner, a store type and a price");
            RequireCompany(owner);
            var type = Catalog.BuildingType(typeId);
            var slots = Math.Max(1, change.Slots);
            var draw = RetailMarket.Draw(type, prod);
            var capacity = RetailMarket.Capacity(type, prod, slots);
            var stock = change.Stock ?? RetailMarket.StockCap(this, type, prod, slots);
            offers.Add(new DemandOffer(
                (double)price,
                change.Quality ?? SimulationConstants.WorldMarketQuality,
                GetProjectedBrandAwareness(owner, product, city),
                RetailMarket.TechScore(this, owner, prod),
                RetailMarket.Attractiveness(this, change.LocationFactor, draw, slots, Math.Max(1, change.Level)),
                draw > 0 ? Math.Min(stock, capacity) : 0));
            meta.Add((null, owner, price, capacity, true));
        }

        var outcome = DemandModel.Evaluate(market, offers, _marketState.Curves);
        var result = new List<PreviewLine>(offers.Count);
        for (var i = 0; i < offers.Count; i++)
        {
            var o = offers[i];
            var m = meta[i];
            result.Add(new PreviewLine(m.Building, m.Owner, m.Price, o.Quality, Math.Max(o.Brand, prod.Demand.ImportBrand), o.Tech, o.Attractiveness,
                m.Capacity, o.Sellable, outcome.Demand[i], outcome.Sold[i], outcome.Share[i], m.Hypothetical));
        }

        return new MarketPreview(city, product, result, market.IncumbentMass, (decimal)market.IncumbentPrice, outcome.IncumbentSold,
            outcome.ReferenceDemand, outcome.TotalDemand, outcome.TotalSold, outcome.Lost, outcome.Brackets)
        {
            IncumbentDemand = outcome.IncumbentDemand,
        };
    }

    // ------------------------------------------------------------------ retail queries

    /// <summary>
    /// True when <paramref name="type"/> may retail <paramref name="product"/>: always under
    /// Classic rules (any retail type, any product); under Realistic market rules only finished
    /// goods whose retail category the store format draws (econ-audit §4.3: no cars in a
    /// convenience store).
    /// </summary>
    public bool CanRetail(BuildingTypeId type, ProductId product)
    {
        var t = Catalog.BuildingType(type);
        if (!t.Retail) return false;
        if (!Rules.Market.Enabled) return true;
        var p = Catalog.Product(product);
        return p.Tier == ProductTier.Finished && RetailMarket.Draw(t, p) > 0;
    }

    /// <summary>
    /// Throughput capacity (units/month) of a store's line for a product, counting every slot of
    /// the building that sells it (Realistic rules; +∞ under Classic, which has no capacity).
    /// </summary>
    public double GetRetailCapacity(BuildingInstanceId building, ProductId product)
    {
        if (!Rules.Market.Enabled) return double.PositiveInfinity;
        var b = RequireBuilding(building);
        var slots = b.RetailSlots.Count(s => s.Product == product);
        return RetailMarket.Capacity(Catalog.BuildingType(b.TypeId), Catalog.Product(product), Math.Max(1, slots));
    }

    /// <summary>Stock cap (units) of a store's line: restock targets above it are clamped (+∞ under Classic).</summary>
    public double GetStockCap(BuildingInstanceId building, ProductId product)
    {
        if (!Rules.Market.Enabled) return double.PositiveInfinity;
        var b = RequireBuilding(building);
        var slots = b.RetailSlots.Count(s => s.Product == product);
        return RetailMarket.StockCap(this, Catalog.BuildingType(b.TypeId), Catalog.Product(product), Math.Max(1, slots));
    }

    /// <summary>Last month's result of a store line, or null (Classic, or the line did not trade).</summary>
    public RetailLineReport? GetRetailLineReport(BuildingInstanceId building, ProductId product)
        => _marketState.Lines.TryGetValue((building, product), out var r) ? r : null;

    /// <summary>Average monthly units sold by a store line over the trailing months it traded (0 if none).</summary>
    public double GetTrailingLineSales(BuildingInstanceId building, ProductId product)
    {
        if (!_marketState.LineHistory.TryGetValue((building, product), out var list) || list.Count == 0) return 0;
        double total = 0;
        foreach (var (_, sold) in list) total += sold;
        return total / list.Count;
    }

    /// <summary>Incumbent mass A₀ of (city, product) (0 under Classic rules or for non-consumer goods).</summary>
    public double GetIncumbentMass(CityId city, ProductId product)
    {
        if (!Rules.Market.Enabled) return 0;
        return RetailMarket.IncumbentMass(this, Catalog.City(city), Catalog.Product(product));
    }

    // ------------------------------------------------------------------ world trade (§4.4)

    /// <summary>Landed import price per unit (Realistic: W × import multiplier; Classic: W).</summary>
    public decimal GetImportPrice(ProductId product)
        => Rules.Market.Enabled ? WorldTrade.ImportPrice(this, Catalog.Product(product)) : GetEffectiveWorldPrice(product);

    /// <summary>
    /// Unit export price if the world exported <paramref name="totalVolume"/> units this month
    /// (Realistic: discount and depth; Classic: W at any volume). 0 for non-exportable goods.
    /// </summary>
    public decimal GetExportPrice(ProductId product, double totalVolume)
        => Rules.Market.Enabled ? WorldTrade.ExportPrice(this, Catalog.Product(product), totalVolume) : GetEffectiveWorldPrice(product);

    /// <summary>Last month's aggregate export of a product (volume and the one price paid), or null.</summary>
    public ExportQuote? GetLastExport(ProductId product)
        => _marketState.Exports.TryGetValue(product, out var q) ? q : null;

    // ------------------------------------------------------------------ operating costs (§4.5–4.6)

    /// <summary>A building's monthly fixed costs under the Realistic payroll model.</summary>
    public BuildingCosts GetMonthlyBuildingCosts(BuildingInstanceId building) => OperatingCosts.Of(this, RequireBuilding(building));

    /// <summary>
    /// A company's monthly fixed costs: Realistic wages, utilities, maintenance, insurance and
    /// property tax of every building; Classic Σ building opex.
    /// </summary>
    public decimal GetMonthlyFixedCosts(CompanyId company)
    {
        RequireCompany(company);
        if (Rules.Market.Enabled) return OperatingCosts.CompanyMonthly(this, company);
        decimal total = 0m;
        foreach (var b in _buildings.Values.Where(b => b.Owner == company).OrderBy(b => b.Id.Value)) total += GetMonthlyOpex(b);
        return total;
    }

    /// <summary>Equipment paid for in a building, per slot index.</summary>
    public IReadOnlyDictionary<int, InstalledEquipment> GetInstalledEquipment(BuildingInstanceId building)
        => _marketState.Equipment.Where(kv => kv.Key.Building == building).OrderBy(kv => kv.Key.Slot).ToDictionary(kv => kv.Key.Slot, kv => kv.Value);

    /// <summary>
    /// Cash a company may spend on world-market purchases now:
    /// <c>Cash + undrawn credit − CashReserveMonths × monthly fixed costs</c> (econ-audit §4.4).
    /// Retail restock passes <paramref name="keepReserve"/> = false: shelf stock turns into cash
    /// within the month, so starving the shelves to protect the reserve would only deepen a cash
    /// squeeze. Never negative.
    /// </summary>
    internal decimal ProcurementBudget(CompanyId company, bool keepReserve = true)
    {
        var c = RequireCompany(company);
        if (!keepReserve)
        {
            var headroom = c.Cash + Math.Max(0m, CreditHeadroom?.UndrawnCredit(this, company) ?? 0m);
            return headroom > 0m ? headroom : 0m;
        }

        var now = Clock.Now;
        if (!_marketState.TryGetFixedCosts(now, company, out var fixedCosts))
        {
            fixedCosts = OperatingCosts.CompanyMonthly(this, company);
            _marketState.CacheFixedCosts(now, company, fixedCosts);
        }

        var credit = CreditHeadroom?.UndrawnCredit(this, company) ?? 0m;
        var budget = c.Cash + Math.Max(0m, credit) - Rules.Market.CashReserveMonths * fixedCosts;
        return budget > 0m ? budget : 0m;
    }

    // ------------------------------------------------------------------ seams for construction (E3b)

    /// <summary>
    /// Market defaults for a building constructed under the current rules (master plan D7): under
    /// Realistic market rules new buildings start with auto-export
    /// <see cref="Rules.MarketRules.AutoExportByDefault"/> (off). Call right after construction;
    /// a no-op under Classic.
    /// </summary>
    public void ApplyMarketDefaults(BuildingInstance building)
    {
        ArgumentNullException.ThrowIfNull(building);
        if (!Rules.Market.Enabled) return;
        building.AutoExport = Rules.Market.AutoExportByDefault;
    }

    /// <summary>
    /// Throws when a retail slot of <paramref name="building"/> may not sell
    /// <paramref name="product"/> under the current rules (see <see cref="CanRetail"/>). A no-op
    /// under Classic. Construction code calls it from <c>ConfigureRetailSlot</c>.
    /// </summary>
    /// <exception cref="InvalidOperationException">The store format does not sell the product.</exception>
    public void ValidateRetailProduct(BuildingInstance building, ProductId product)
    {
        ArgumentNullException.ThrowIfNull(building);
        if (!Rules.Market.Enabled) return;
        if (!CanRetail(building.TypeId, product))
        {
            throw new InvalidOperationException($"a {building.TypeId} cannot sell '{product}' (its store format has no draw for that category)");
        }
    }
}
