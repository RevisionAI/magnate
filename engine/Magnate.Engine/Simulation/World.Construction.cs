using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;

namespace Magnate.Engine.Simulation;

// Construction, upgrades and slot configuration.
public sealed partial class World
{
    /// <summary>
    /// Build <paramref name="typeId"/> in <paramref name="city"/> for <paramref name="owner"/>.
    /// <list type="bullet">
    ///   <item>Classic (<see cref="Rules.LandRules.Enabled"/> off): charges the construction cost
    ///         (<see cref="LedgerCategory.ConstructionCost"/>, capitalised into
    ///         <see cref="BuildingInstance.CapitalizedCost"/>); the building operates from the next tick.</item>
    ///   <item>Land rules: the building is auto-sited (<see cref="ChooseAutoSite"/>: the best site
    ///         by the category's preference the company can pay for up front, else the cheapest)
    ///         and built there exactly as <see cref="Construct(CompanyId, BuildingTypeId, CityId, PlotRef)"/>
    ///         does. When no site is free or affordable the order waits for one
    ///         (<see cref="ConstructionState.AwaitingSite"/>; nothing is paid, its slots may be
    ///         configured) and the construction step retries every month. This keeps the AI and
    ///         the legacy client working unchanged: the call never fails for lack of land.</item>
    /// </list>
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown company, building type or city.</exception>
    /// <exception cref="InvalidOperationException">
    /// Classic: the company cannot afford it. Land rules: the city lacks the type's geography
    /// requirement (<see cref="MeetsGeographyRequirement(BuildingTypeId, CityId)"/>).
    /// </exception>
    public BuildingInstance Construct(CompanyId owner, BuildingTypeId typeId, CityId city)
    {
        var company = RequireCompany(owner);
        var type = Catalog.BuildingType(typeId);
        var cityDef = Catalog.City(city); // throws if unknown

        // bridge-spec E6 / econ-audit E9: geography is enforced under Realistic land rules.
        // Classic keeps the pre-overhaul behaviour (no check).
        if (Rules.Land.Enabled && !SatisfiesGeography(type, cityDef))
        {
            throw new InvalidOperationException(
                $"{typeId} cannot be built in {city}: the city does not meet its geography requirement");
        }

        if (Rules.Land.Enabled)
        {
            // A company that may not invest (finance distress, E2) places the order; works start
            // once it may invest again and a site is free.
            var site = CanInvest(owner) ? ChooseAutoSite(owner, typeId, city) : null;
            return site is null ? PlaceOrder(company, type, city) : ConstructAt(company, type, city, site);
        }

        if (company.Cash < type.ConstructionCost)
        {
            throw new InvalidOperationException(
                $"company '{company.Name}' has {company.Cash:C} but {typeId} costs {type.ConstructionCost:C}");
        }

        var building = new BuildingInstance(new BuildingInstanceId(_nextBuildingId++), typeId, owner, city)
        {
            CapitalizedCost = type.ConstructionCost,
            BuiltAt = Clock.Now,
        };
        _buildings[building.Id] = building;
        company.OwnedBuildings.Add(building.Id);

        RecordCashChange(owner, LedgerCategory.ConstructionCost, -type.ConstructionCost, $"construct {typeId} in {city}", building: building.Id);
        ApplyMarketDefaults(building);
        return building;
    }

    /// <summary>
    /// Build <paramref name="typeId"/> on a chosen site (land rules): validates the site
    /// (<see cref="QuoteConstruction"/>: zoning, frontage, coast, deposits, slope, geography,
    /// occupancy, land titles), buys the land it does not already hold at its current value plus
    /// the buy-out of ambient structures (<see cref="LedgerCategory.LandPurchase"/>, capitalised as
    /// the building's land, <see cref="GetLandCost"/>), and starts construction: the deposit is paid now
    /// (<see cref="LedgerCategory.ConstructionPayment"/> → construction in progress) and the rest in
    /// monthly instalments by the construction step; the building operates once complete. With an
    /// instant schedule the full cost is charged as <see cref="LedgerCategory.ConstructionCost"/>
    /// and the building operates from the next tick.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Land rules are off, the company may not invest (<see cref="EnsureCanInvest"/>: finance
    /// distress), or it cannot pay what is due up front.
    /// </exception>
    /// <exception cref="PlacementRejectedException">The site is not valid (issues in the exception's quote).</exception>
    /// <exception cref="KeyNotFoundException">Unknown company, building type or city.</exception>
    public BuildingInstance Construct(CompanyId owner, BuildingTypeId typeId, CityId city, PlotRef at)
    {
        var company = RequireCompany(owner);
        var quote = QuoteConstruction(owner, typeId, city, at);
        EnsureCanInvest(owner);
        if (!quote.Ok) throw new PlacementRejectedException(quote);
        return ConstructAt(company, Catalog.BuildingType(typeId), city, quote);
    }

    private BuildingInstance ConstructAt(Company company, BuildingType type, CityId city, ConstructionQuote quote)
    {
        if (AvailableFunds(company.Id) < quote.UpfrontCost)
        {
            throw new InvalidOperationException(
                $"company '{company.Name}' has {company.Cash:C} but a {type.Id} at {quote.At} in {city} needs {quote.UpfrontCost:C} up front");
        }

        var building = NewBuilding(company, type, city);
        building.Construction = new ConstructionState(Clock.Now, quote.Schedule, awaitingSite: false);
        StartWorks(building, type, quote);
        return building;
    }

    /// <summary>An order that waits for a free, affordable site (legacy auto-siting path).</summary>
    private BuildingInstance PlaceOrder(Company company, BuildingType type, CityId city)
    {
        var building = NewBuilding(company, type, city);
        building.Construction = new ConstructionState(Clock.Now, ConstructionSchedule.For(type, Rules.Land), awaitingSite: true);
        return building;
    }

    private BuildingInstance NewBuilding(Company company, BuildingType type, CityId city)
    {
        var building = new BuildingInstance(new BuildingInstanceId(_nextBuildingId++), type.Id, company.Id, city)
        {
            BuiltAt = Clock.Now,
        };
        _buildings[building.Id] = building;
        company.OwnedBuildings.Add(building.Id);
        ApplyMarketDefaults(building); // E1 D7: no auto-export on new buildings under Realistic market rules
        return building;
    }

    /// <summary>
    /// Take the site and start the works: buy the land, pay the deposit (or the whole cost when
    /// the schedule is instant, which completes the building at once).
    /// </summary>
    private void StartWorks(BuildingInstance building, BuildingType type, ConstructionQuote quote)
    {
        var owner = building.Owner;
        var city = building.City;
        var state = building.Construction!;
        state.AwaitingSite = false;
        state.StartedAt = Clock.Now;
        state.CompletesAt = ConstructionState.AddMonths(Clock.Now, state.MonthsTotal);

        var absorbed = Site(building, LandOf(city), quote);
        var landCash = quote.SiteCost;
        if (landCash > 0m)
        {
            RecordCashChange(owner, LedgerCategory.LandPurchase, -landCash,
                $"land for {type.Id} at {quote.At} in {city}", building: building.Id);
        }
        // Land at historical cost: what was paid now plus the basis of plots the owner already held.
        CapitalizeLand(building.Id, absorbed + landCash);

        var schedule = quote.Schedule;
        if (schedule.Instant)
        {
            building.Construction = null;
            building.BuiltAt = Clock.Now;
            building.CapitalizedCost = schedule.ConstructionCost;
            if (schedule.ConstructionCost > 0m)
            {
                RecordCashChange(owner, LedgerCategory.ConstructionCost, -schedule.ConstructionCost,
                    $"construct {type.Id} in {city}", building: building.Id);
            }
            return;
        }

        state.CostPaid = schedule.Deposit;
        state.CostRemaining = schedule.ConstructionCost - schedule.Deposit;
        if (schedule.Deposit > 0m)
        {
            RecordCashChange(owner, LedgerCategory.ConstructionPayment, -schedule.Deposit,
                $"construction deposit {type.Id} in {city}", building: building.Id);
            AddConstructionInProgress(building.Id, schedule.Deposit);
        }
    }

    /// <summary>
    /// Retry an order waiting for a site (construction step): when a free site the company can pay
    /// for up front exists, works start this month. Returns true when they did.
    /// </summary>
    internal bool TrySiteOrder(BuildingInstance building)
    {
        if (building.Construction is not { AwaitingSite: true } state || building.IsRetired) return false;
        state.CompletesAt = ConstructionState.AddMonths(Clock.Now, state.MonthsTotal);
        if (!CanInvest(building.Owner)) return false; // finance distress (E2): no new works

        // A failed search is only worth repeating once the city changed (a site freed, prices
        // moved: the layout revision bumps) or the company can afford the cheapest site it saw.
        // The memo is transient: skipping a search that would fail again changes nothing, so a
        // loaded game (empty memo) behaves exactly like the original.
        var revision = GetLayoutRevision(building.City);
        var funds = AvailableFunds(building.Owner);
        if (_failedSiteSearches.TryGetValue(building.Id, out var failed) && failed.Revision == revision && funds < failed.CheapestUpfront)
        {
            return false;
        }

        var type = Catalog.BuildingType(building.TypeId);
        var site = ChooseAutoSite(building.Owner, building.TypeId, building.City);
        if (site is null)
        {
            var cheapest = FindConstructionSites(building.Owner, building.TypeId, building.City, SitePreference.Cheapest, 1);
            _failedSiteSearches[building.Id] = (revision, cheapest.Count == 0 ? decimal.MaxValue : cheapest[0].UpfrontCost);
            return false;
        }
        _failedSiteSearches.Remove(building.Id);
        StartWorks(building, type, site);
        return true;
    }

    private readonly Dictionary<BuildingInstanceId, (int Revision, decimal CheapestUpfront)> _failedSiteSearches = new();

    /// <summary>
    /// Pay one month of construction for a building under construction (the construction step,
    /// econ-audit §4.12): the instalment moves into construction in progress; when it was the
    /// last one the building completes — CIP becomes PP&amp;E (<see cref="BuildingInstance.CapitalizedCost"/>),
    /// <see cref="BuildingInstance.BuiltAt"/> is this month and it operates from now on. When the
    /// company cannot fund the instalment the project pauses for the month (nothing is paid, the
    /// projected completion moves out by a month). Returns true when the building completed.
    /// </summary>
    internal bool AdvanceConstruction(BuildingInstance building)
    {
        if (building.Construction is not ConstructionState state || state.AwaitingSite || building.IsRetired) return false;
        var due = state.NextInstalment;
        if (due > 0m && AvailableFunds(building.Owner) < due)
        {
            state.PausedMonths++;
            state.CompletesAt = state.CompletesAt.AddMonth();
            return false;
        }

        if (due > 0m)
        {
            RecordCashChange(building.Owner, LedgerCategory.ConstructionPayment, -due,
                $"construction instalment {building.TypeId} ({building.Id})", building: building.Id);
            AddConstructionInProgress(building.Id, due);
            state.CostPaid += due;
            state.CostRemaining -= due;
        }
        state.MonthsRemaining--;
        if (state.MonthsRemaining > 0) return false;

        // CIP → PP&E (E2's register; depreciation starts next month). CapitalizedCost stayed 0
        // while the cost sat in CIP.
        CompleteConstruction(building.Id);
        building.Construction = null;
        building.BuiltAt = Clock.Now;
        return true;
    }

    /// <summary>
    /// Cancel a building under construction (econ-audit §4.12, bridge <c>cancelConstruction</c>):
    /// <see cref="Rules.LandRules.CancelRecoveryShare"/> of the construction in progress comes back
    /// in cash and the rest is written off (<see cref="AccrualKind.ConstructionWriteOff"/>); the
    /// site is sold back to the city at its current market value (gain or loss against its cost
    /// as <see cref="AccrualKind.DisposalGainLoss"/>). The building retires: it frees its plots,
    /// loses its slots and keeps only its history.
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    /// <exception cref="InvalidOperationException">Land rules are off, or the building is not under construction.</exception>
    public ConstructionCancellation CancelConstruction(BuildingInstanceId buildingId)
    {
        var quote = QuoteCancellation(buildingId);
        var building = RequireBuilding(buildingId);
        var owner = building.Owner;
        var recovered = quote.Recovered;
        var writtenOff = quote.WrittenOff;
        var landProceeds = quote.LandProceeds;
        var landCost = quote.LandCost;
        var landGain = landProceeds - landCost;
        var memo = $"cancel construction {building.TypeId} ({buildingId})";

        if (recovered > 0m) RecordCashChange(owner, LedgerCategory.AssetSale, recovered, memo + ": salvage", building: buildingId);
        if (landProceeds > 0m) RecordCashChange(owner, LedgerCategory.AssetSale, landProceeds, memo + ": site sold", building: buildingId);
        WriteOffConstruction(buildingId, recovered); // journals the unrecovered CIP (ConstructionWriteOff)
        ReleaseLand(buildingId);
        if (landGain != 0m) RecordAccrual(owner, AccrualKind.DisposalGainLoss, landGain, memo + ": site", building: buildingId);

        building.Construction = null;
        building.ProductionSlots.Clear();
        building.ExtractionSlots.Clear();
        building.WarehouseSlots.Clear();
        building.RetailSlots.Clear();
        building.ResearchSlots.Clear();
        // One retirement model (integration E2 x E3b): the building leaves World.Buildings for the
        // finance retired registry (history kept for the ledger), its plots are freed.
        Retire(building);

        return quote;
    }

    /// <summary>
    /// What cancelling a building under construction would return (<see cref="CancelConstruction"/>
    /// without the side effects): the recoverable share of the construction in progress, the
    /// write-off, and the site's current market value against its historical cost. Pure.
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    /// <exception cref="InvalidOperationException">Land rules are off, or the building is not under construction.</exception>
    public ConstructionCancellation QuoteCancellation(BuildingInstanceId buildingId)
    {
        RequireLandRules();
        var building = RequireBuilding(buildingId);
        if (building.Construction is null || building.IsRetired)
        {
            throw new InvalidOperationException($"building {buildingId} is not under construction");
        }

        var cip = GetConstructionInProgress(buildingId);
        var share = Rules.Land.CancelRecoveryShare;
        var recovered = share == 1m ? cip : Math.Round(cip * share, 2, MidpointRounding.ToEven);
        decimal landProceeds = 0m;
        if (building.Placement is PlotRef at)
        {
            var fields = LandOf(building.City).FieldsAt(this, Clock.Now);
            var rect = at.Rect(Catalog.BuildingType(building.TypeId).Footprint);
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++) landProceeds += fields.LandValueAt(x, z);
            }
        }
        return new ConstructionCancellation(buildingId, building.Owner, cip, recovered, cip - recovered,
            GetLandCost(buildingId), landProceeds, building.Construction.CompletesAt);
    }

    /// <summary>
    /// Advance <paramref name="buildingId"/> from its current level to the next
    /// (1→2 or 2→3). Reads the upgrade cost from the type's
    /// <see cref="BuildingType.Levels"/> ladder, charges the company via a
    /// <see cref="LedgerCategory.UpgradeCost"/> entry (capex, not P&amp;amp;L), capitalises the
    /// cost into <see cref="BuildingInstance.CapitalizedCost"/> and increments
    /// <see cref="BuildingInstance.Level"/>. Throws when:
    /// <list type="bullet">
    ///   <item>The building type has no <c>Levels</c> config (non-upgradeable).</item>
    ///   <item>The building is already at the maximum configured level.</item>
    ///   <item>The company cannot afford the next level's <c>UpgradeCost</c>.</item>
    /// </list>
    /// </summary>
    public void UpgradeBuilding(BuildingInstanceId buildingId)
    {
        var building = RequireBuilding(buildingId);
        var type = Catalog.BuildingType(building.TypeId);
        RequireOperational(building, "upgraded");

        if (type.Levels is null || type.Levels.Count == 0)
        {
            throw new InvalidOperationException(
                $"building type '{building.TypeId}' has no upgrade path");
        }

        var maxLevel = type.Levels.Count;
        if (building.Level >= maxLevel)
        {
            throw new InvalidOperationException(
                $"building {buildingId} is already at max level {maxLevel}");
        }

        var nextLevel = building.Level + 1;
        var nextConfig = type.Levels[nextLevel - 1];
        var cost = nextConfig.UpgradeCost;

        var company = RequireCompany(building.Owner);
        if (company.Cash < cost)
        {
            throw new InvalidOperationException(
                $"company '{company.Name}' has {company.Cash:C} but upgrading {buildingId} to L{nextLevel} costs {cost:C}");
        }

        RecordCashChange(
            building.Owner,
            LedgerCategory.UpgradeCost,
            -cost,
            $"upgrade {building.TypeId} ({buildingId}) to L{nextLevel}",
            building: buildingId);

        // Upgrade capex is capitalised into the building (econ-audit F8 / bridge-spec E5): the
        // cash left, so the balance sheet must carry it or the books stop closing.
        building.CapitalizedCost += cost;
        building.Level = nextLevel;
    }

    /// <summary>
    /// Effective slot capacity for <paramref name="building"/>, taking its current
    /// <see cref="BuildingInstance.Level"/> into account. Falls back to
    /// <see cref="BuildingType.MaxUnits"/> when the type has no upgrade ladder or
    /// when the instance's level is out of the ladder's range (defensive — this
    /// shouldn't happen in a well-formed world).
    /// </summary>
    public int GetCapacity(BuildingInstance building)
    {
        var type = Catalog.BuildingType(building.TypeId);
        if (type.Levels is null || type.Levels.Count == 0) return type.MaxUnits;
        var idx = building.Level - 1;
        if (idx < 0 || idx >= type.Levels.Count) return type.MaxUnits;
        return type.Levels[idx].Capacity;
    }

    /// <summary>
    /// Effective monthly operating cost for <paramref name="building"/> at its
    /// current level. Mirrors <see cref="GetCapacity"/>'s fallback semantics. Zero while the
    /// building is under construction or retired (land rules).
    /// </summary>
    public decimal GetMonthlyOpex(BuildingInstance building)
    {
        // Land rules: nothing runs (and nothing is charged as operating cost) until a building is
        // complete, nor after it retired. Classic buildings are always operational.
        if (!building.IsOperational) return 0m;
        return GetOperatingOpex(building);
    }

    /// <summary>
    /// The monthly operating cost the building has (or will have once complete) at its current
    /// level — <see cref="GetMonthlyOpex"/> without the "not operational yet" zero, for displays.
    /// </summary>
    public decimal GetOperatingOpex(BuildingInstance building)
    {
        var type = Catalog.BuildingType(building.TypeId);
        if (type.Levels is null || type.Levels.Count == 0) return type.MonthlyOperatingCost;
        var idx = building.Level - 1;
        if (idx < 0 || idx >= type.Levels.Count) return type.MonthlyOperatingCost;
        return type.Levels[idx].MonthlyOperatingCost;
    }

    /// <summary>
    /// Configure (or replace) production slot <paramref name="slotIndex"/> to run
    /// <paramref name="product"/>'s recipe. The product needs a recipe whose tier the building
    /// type can produce.
    /// </summary>
    public void ConfigureProductionSlot(BuildingInstanceId buildingId, int slotIndex, ProductId product)
    {
        var building = RequireBuilding(buildingId);
        RequireNotRetired(building);
        var type = Catalog.BuildingType(building.TypeId);
        var capacity = GetCapacity(building);

        if (slotIndex < 0 || slotIndex >= capacity)
        {
            throw new ArgumentOutOfRangeException(nameof(slotIndex), $"building {buildingId} supports {capacity} slots");
        }

        var prod = Catalog.Product(product);
        if (prod.Recipe is null)
        {
            throw new InvalidOperationException($"cannot produce raw material '{product}' (no recipe)");
        }

        if (!type.ProducibleTiers.Contains(prod.Tier))
        {
            throw new InvalidOperationException(
                $"building type {building.TypeId} cannot produce tier '{prod.Tier}'");
        }

        building.ProductionSlots.RemoveAll(s => s.Index == slotIndex);
        building.ProductionSlots.Add(new ProductionSlot(slotIndex, product));
    }

    /// <summary>
    /// Configure (or replace) extraction slot <paramref name="slotIndex"/> to extract a raw
    /// product whose extraction source matches the building's category.
    /// </summary>
    public void ConfigureExtractionSlot(BuildingInstanceId buildingId, int slotIndex, ProductId product)
    {
        var building = RequireBuilding(buildingId);
        RequireNotRetired(building);
        var type = Catalog.BuildingType(building.TypeId);
        var capacity = GetCapacity(building);

        if (slotIndex < 0 || slotIndex >= capacity)
        {
            throw new ArgumentOutOfRangeException(nameof(slotIndex), $"building {buildingId} supports {capacity} slots");
        }

        var prod = Catalog.Product(product);
        if (prod.Tier != ProductTier.Raw)
        {
            throw new InvalidOperationException($"extraction slots require a raw product; '{product}' is {prod.Tier}");
        }
        if (prod.Extraction is null)
        {
            throw new InvalidOperationException($"product '{product}' has no extraction definition");
        }
        if (!string.Equals(prod.Extraction.SourceCategory, type.Category, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"product '{product}' extracts at '{prod.Extraction.SourceCategory}', not building category '{type.Category}'");
        }

        building.ExtractionSlots.RemoveAll(s => s.Index == slotIndex);
        building.ExtractionSlots.Add(new ExtractionSlot(slotIndex, product));
    }

    /// <summary>Configure (or replace) research slot <paramref name="slotIndex"/> of an R&amp;D center.</summary>
    public void ConfigureResearchSlot(BuildingInstanceId buildingId, int slotIndex, ProductId product)
    {
        var building = RequireBuilding(buildingId);
        RequireNotRetired(building);
        var type = Catalog.BuildingType(building.TypeId);

        if (type.Category != "rd_center")
        {
            throw new InvalidOperationException(
                $"research slots are only valid on R&D centers; '{type.Category}' is not eligible");
        }

        var capacity = GetCapacity(building);
        if (slotIndex < 0 || slotIndex >= capacity)
        {
            throw new ArgumentOutOfRangeException(nameof(slotIndex), $"building {buildingId} supports {capacity} slots");
        }

        _ = Catalog.Product(product); // throws if unknown

        building.ResearchSlots.RemoveAll(s => s.Index == slotIndex);
        building.ResearchSlots.Add(new ResearchSlot(slotIndex, product));
    }

    /// <summary>
    /// Configure (or replace) warehouse slot <paramref name="slotIndex"/> to keep
    /// <paramref name="targetStock"/> units of <paramref name="product"/> on hand.
    /// </summary>
    public void ConfigureWarehouseSlot(
        BuildingInstanceId buildingId,
        int slotIndex,
        ProductId product,
        double targetStock)
    {
        var building = RequireBuilding(buildingId);
        RequireNotRetired(building);
        var type = Catalog.BuildingType(building.TypeId);

        var category = type.Category;
        if (category is not ("warehouse" or "distribution_center" or "seaport" or "freight_yard"))
        {
            throw new InvalidOperationException(
                $"warehouse slots are only valid on storage/logistics buildings; '{category}' is not eligible");
        }

        var capacity = GetCapacity(building);
        if (slotIndex < 0 || slotIndex >= capacity)
        {
            throw new ArgumentOutOfRangeException(nameof(slotIndex), $"building {buildingId} supports {capacity} slots");
        }

        if (targetStock <= 0) throw new ArgumentException("targetStock must be positive", nameof(targetStock));
        _ = Catalog.Product(product); // throws if unknown

        building.WarehouseSlots.RemoveAll(s => s.Index == slotIndex);
        building.WarehouseSlots.Add(new WarehouseSlot(slotIndex, product, targetStock));
    }

    /// <summary>
    /// Configure (or replace) retail slot <paramref name="slotIndex"/> of a retail building.
    /// Under <see cref="Rules.MarketRules.Enabled"/> only finished goods may be retailed
    /// (bridge-spec E7); Classic accepts any tier.
    /// </summary>
    public void ConfigureRetailSlot(
        BuildingInstanceId buildingId,
        int slotIndex,
        ProductId product,
        decimal price,
        double restockTarget)
    {
        var building = RequireBuilding(buildingId);
        RequireNotRetired(building);
        var type = Catalog.BuildingType(building.TypeId);

        if (!type.Retail)
        {
            throw new InvalidOperationException($"building type {building.TypeId} is not retail");
        }

        var capacity = GetCapacity(building);
        if (slotIndex < 0 || slotIndex >= capacity)
        {
            throw new ArgumentOutOfRangeException(nameof(slotIndex));
        }

        if (price <= 0m) throw new ArgumentException("price must be positive", nameof(price));
        if (restockTarget <= 0) throw new ArgumentException("restockTarget must be positive", nameof(restockTarget));

        var prod = Catalog.Product(product); // throws if unknown
        if (Rules.Market.Enabled && prod.Tier != ProductTier.Finished)
        {
            throw new InvalidOperationException(
                $"only finished goods can be retailed; '{product}' is {prod.Tier}");
        }

        building.RetailSlots.RemoveAll(s => s.Index == slotIndex);
        building.RetailSlots.Add(new RetailSlot(slotIndex, product, price, restockTarget));
    }
    // ------------------------------------------------------------------ geography (bridge-spec E6)

    /// <summary>
    /// True when <paramref name="city"/> satisfies every geography flag the building type
    /// requires (coastal, arable, mineral-rich, oil-rich). Types without a requirement fit
    /// anywhere. Enforced by <see cref="Construct(CompanyId, BuildingTypeId, CityId)"/> only under Realistic land rules; the bridge
    /// and the UI use it for pre-validation under every ruleset.
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown building type or city.</exception>
    public bool MeetsGeographyRequirement(BuildingTypeId typeId, CityId city)
        => SatisfiesGeography(Catalog.BuildingType(typeId), Catalog.City(city));

    private static bool SatisfiesGeography(BuildingType type, City city)
    {
        var need = type.GeographyRequirement;
        if (need is null) return true;
        var has = city.Geography;
        return (need.Coastal != true || has.Coastal)
            && (need.Arable != true || has.Arable)
            && (need.MineralRich != true || has.MineralRich)
            && (need.OilRich != true || has.OilRich);
    }

    // ------------------------------------------------------------------ validated slot commands (bridge-spec E3)

    /// <summary>
    /// Change the price of an existing retail slot. Prefer this to writing
    /// <see cref="RetailSlot.Price"/> directly (kept public for the legacy client).
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    /// <exception cref="InvalidOperationException">No retail slot at that index.</exception>
    /// <exception cref="ArgumentException">Price is not positive.</exception>
    public void SetRetailPrice(BuildingInstanceId buildingId, int slotIndex, decimal price)
    {
        if (price <= 0m) throw new ArgumentException("price must be positive", nameof(price));
        RequireRetailSlot(buildingId, slotIndex).Price = price;
    }

    /// <summary>Change the restock target of an existing retail slot.</summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    /// <exception cref="InvalidOperationException">No retail slot at that index.</exception>
    /// <exception cref="ArgumentException">Target is not a positive finite number.</exception>
    public void SetRestockTarget(BuildingInstanceId buildingId, int slotIndex, double restockTarget)
    {
        if (!double.IsFinite(restockTarget) || restockTarget <= 0)
        {
            throw new ArgumentException("restockTarget must be a positive finite number", nameof(restockTarget));
        }

        RequireRetailSlot(buildingId, slotIndex).RestockTarget = restockTarget;
    }

    /// <summary>Change the target stock of an existing warehouse slot.</summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    /// <exception cref="InvalidOperationException">No warehouse slot at that index.</exception>
    /// <exception cref="ArgumentException">Target is not a positive finite number.</exception>
    public void SetWarehouseTarget(BuildingInstanceId buildingId, int slotIndex, double targetStock)
    {
        if (!double.IsFinite(targetStock) || targetStock <= 0)
        {
            throw new ArgumentException("targetStock must be a positive finite number", nameof(targetStock));
        }

        var building = RequireBuilding(buildingId);
        var slot = building.WarehouseSlots.FirstOrDefault(s => s.Index == slotIndex)
            ?? throw new InvalidOperationException($"building {buildingId} has no warehouse slot {slotIndex}");
        slot.TargetStock = targetStock;
    }

    /// <summary>Switch auto-export of a building's surplus own output on or off.</summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    public void SetAutoExport(BuildingInstanceId buildingId, bool autoExport)
        => RequireBuilding(buildingId).AutoExport = autoExport;

    /// <summary>
    /// Remove whatever slot is configured at <paramref name="slotIndex"/> (any kind). Inventory
    /// already in the building stays. Returns false when the index was empty.
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown building.</exception>
    public bool ClearSlot(BuildingInstanceId buildingId, int slotIndex)
    {
        var building = RequireBuilding(buildingId);
        var removed = building.ProductionSlots.RemoveAll(s => s.Index == slotIndex)
            + building.ExtractionSlots.RemoveAll(s => s.Index == slotIndex)
            + building.WarehouseSlots.RemoveAll(s => s.Index == slotIndex)
            + building.RetailSlots.RemoveAll(s => s.Index == slotIndex)
            + building.ResearchSlots.RemoveAll(s => s.Index == slotIndex);
        return removed > 0;
    }

    private static void RequireOperational(BuildingInstance building, string action)
    {
        RequireNotRetired(building);
        if (building.IsUnderConstruction)
        {
            throw new InvalidOperationException($"building {building.Id} is under construction and cannot be {action} yet");
        }
    }

    private static void RequireNotRetired(BuildingInstance building)
    {
        if (building.IsRetired) throw new InvalidOperationException($"building {building.Id} was retired");
    }

    private RetailSlot RequireRetailSlot(BuildingInstanceId buildingId, int slotIndex)
    {
        var building = RequireBuilding(buildingId);
        return building.RetailSlots.FirstOrDefault(s => s.Index == slotIndex)
            ?? throw new InvalidOperationException($"building {buildingId} has no retail slot {slotIndex}");
    }
}

/// <summary>The outcome of <see cref="World.CancelConstruction"/>.</summary>
/// <param name="BuildingId">The retired building.</param>
/// <param name="Owner">Its owner.</param>
/// <param name="ConstructionInProgress">Construction cost paid before cancelling.</param>
/// <param name="Recovered">Cash recovered from the works.</param>
/// <param name="WrittenOff">Construction in progress written off.</param>
/// <param name="LandCost">Historical cost of the site.</param>
/// <param name="LandProceeds">Cash from selling the site back at its market value.</param>
/// <param name="WouldHaveCompletedAt">The completion month the project was heading for.</param>
public sealed record ConstructionCancellation(
    BuildingInstanceId BuildingId,
    CompanyId Owner,
    decimal ConstructionInProgress,
    decimal Recovered,
    decimal WrittenOff,
    decimal LandCost,
    decimal LandProceeds,
    GameDate WouldHaveCompletedAt)
{
    /// <summary>Cash received in total.</summary>
    public decimal Proceeds => Recovered + LandProceeds;

    /// <summary>Carrying value given up (CIP plus land).</summary>
    public decimal BookValue => ConstructionInProgress + LandCost;

    /// <summary>Proceeds minus carrying value (negative: a loss).</summary>
    public decimal GainOrLoss => Proceeds - BookValue;
}
