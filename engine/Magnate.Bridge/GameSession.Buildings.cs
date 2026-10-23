using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Buildings (bridge-spec §5.5): lists, the inspector, atomic construction,
// starter plans, every slot command and upgrades. Every command validates through
// Guard/SlotRules before touching the engine (§4.6.4), so engine exceptions are
// the exception rather than the rule.
public sealed partial class GameSession
{
    /// <summary>
    /// The ruleset <c>newGame</c> starts worlds with; null (the default) means the scenario
    /// runner's default, <see cref="EconomyRules.Realistic"/>. A hook for tests and tools
    /// (e.g. instant construction under otherwise realistic rules); never set by the client.
    /// </summary>
    internal EconomyRules? NewGameRules { get; set; }

    /// <summary>Building rows, filtered by city and/or owner; <c>sort</c> = id | city | category | cashflow | netIncome.</summary>
    [BridgeMethod("buildings")]
    public IReadOnlyList<BuildingSummaryDto> Buildings(BuildingsArgs args)
    {
        var game = Game;
        var world = game.World;
        if (args.CityId is { } cityId) Guard.City(Catalog, cityId);
        if (args.OwnerId is { } ownerId) Guard.Company(world, ownerId, "ownerId");
        var rows = world.Buildings.Values
            .Where(b => !b.IsRetired)
            .Where(b => args.CityId is null || b.City.Value == args.CityId)
            .Where(b => args.OwnerId is null || b.Owner.Value == args.OwnerId)
            .Select(b => Summarize(game, b))
            .ToList();
        IEnumerable<BuildingSummaryDto> sorted = args.Sort switch
        {
            null or "id" => rows.OrderBy(r => r.Id),
            "city" => rows.OrderBy(r => r.CityId, StringComparer.Ordinal).ThenBy(r => r.Id),
            "category" => rows.OrderBy(r => r.Category, StringComparer.Ordinal).ThenBy(r => r.Id),
            "cashflow" => rows.OrderByDescending(r => r.CashFlowThisMonth).ThenBy(r => r.Id),
            "netIncome" => rows.OrderByDescending(r => r.NetIncomeThisMonth).ThenBy(r => r.Id),
            _ => throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown sort '{args.Sort}'.", "sort"),
        };
        return sorted.ToList();
    }

    /// <summary>Everything the building inspector shows (any owner; commands stay player-only).</summary>
    [BridgeMethod("building")]
    public BuildingDetailDto Building(BuildingRefArgs args)
    {
        var game = Game;
        var world = game.World;
        var b = Guard.Building(world, args.BuildingId);
        var type = world.Catalog.BuildingType(b.TypeId);
        var city = world.Catalog.City(b.City);
        var kind = game.Rules.KindOf(b);
        var isPlayer = b.Owner == game.Player;
        var capacity = world.GetCapacity(b);
        var info = game.Index.BuildingInfo(b.Id.Value);
        var maxLevel = type.Levels is { Count: > 0 } ladder ? ladder.Count : 1;
        var cash = world.Companies[b.Owner].Cash;

        UpgradeOptionDto? upgrade = null;
        var operational = b.IsOperational;
        if (type.Levels is { Count: > 0 } levels && b.Level < levels.Count && operational)
        {
            var next = levels[b.Level];
            upgrade = new UpgradeOptionDto(next.Level, next.UpgradeCost, next.Capacity, next.MonthlyOperatingCost, cash >= next.UpgradeCost);
        }

        var slotsUsed = SlotRules.ConfiguredCount(b);
        WorkforceDto? workforce = type.TargetHeadcount is { } head
            ? new WorkforceDto(head.Min, head.Max, head.Min * slotsUsed, head.Max * slotsUsed)
            : null;
        var nextFree = SlotRules.NextFreeIndex(b, capacity);
        var autoExportApplies = kind is SlotKinds.Production or SlotKinds.Extraction;

        return new BuildingDetailDto(
            Id: b.Id.Value,
            TypeId: b.TypeId.Value,
            TypeName: type.Name,
            Category: type.Category,
            SlotKind: kind,
            OwnerId: b.Owner.Value,
            OwnerName: world.Companies[b.Owner].Name,
            IsPlayer: isPlayer,
            CityId: city.Id.Value,
            CityName: city.Name,
            Level: b.Level,
            MaxLevel: maxLevel,
            Capacity: capacity,
            SlotsUsed: slotsUsed,
            NextFreeSlotIndex: nextFree,
            MonthlyOpex: world.GetMonthlyOpex(b),
            ConstructionCost: info is { ConstructionCost: > 0m } ? info.ConstructionCost : type.ConstructionCost,
            BookValue: Financials.BookValue(world, game.Index, b),
            OpenedAt: OpenedAt(game, b, info),
            AutoExport: b.AutoExport,
            AutoExportApplies: autoExportApplies,
            Upgrade: upgrade,
            Workforce: workforce,
            Slots: SlotRules.Slots(b).Select(s => SlotDetail(game, b, s.Index, null)).ToList(),
            Inventory: InventoryRows(world, b),
            InventoryTotals: InventoryTotals(world, b),
            Pnl: BuildingPnl(game, b),
            Supply: BuildingSupply(game, b),
            Actions: new BuildingActionsDto(
                CanUpgrade: isPlayer && upgrade is not null,
                CanAddSlot: isPlayer && nextFree >= 0 && kind != SlotKinds.None,
                CanConfigure: isPlayer && kind != SlotKinds.None,
                CanToggleAutoExport: isPlayer && autoExportApplies,
                // E2 disposals: a finance-rules game, an operating building, an owner not in bankruptcy.
                CanDemolish: isPlayer && world.Rules.Finance.Enabled && world.Rules.Finance.Disposals
                    && b.Construction is null && !world.IsBankrupt(b.Owner),
                EligibleProductIds: game.Rules.Eligible(b.TypeId)),
            Placement: game.Placement.Get(b.Id.Value) ?? new PlacementDto(0, 0, 0, PlacementSources.Auto),
            Construction: ConstructionOf(world, b),
            Book: new BookValueDto(
                GrossPpe: b.CapitalizedCost,
                AccumulatedDepreciation: b.AccumulatedDepreciation,
                Land: world.GetLandCost(b.Id),
                ConstructionInProgress: world.GetConstructionInProgress(b.Id),
                UpgradeCost: info?.UpgradeCost ?? 0m));
    }

    /// <summary>
    /// Build for the player, atomically: every check (type, city, geography,
    /// placement, first slot, cash) passes before any money moves, then the
    /// building is constructed, its first slot configured and its plot recorded.
    /// Under engine land rules (<c>features.plots</c>) the engine validates and prices the
    /// site: <c>at</c> picks it, otherwise the best site the player can pay for is
    /// auto-picked; the land is bought, the deposit paid, and the building operates once
    /// construction completes (<c>constructionStarted</c>; slots may be set meanwhile).
    /// </summary>
    [BridgeMethod("construct", Mutates = true)]
    public BuildingSummaryDto Construct(ConstructArgs args)
    {
        var game = Game;
        var world = game.World;
        var type = Guard.BuildingType(Catalog, args.TypeId);
        var city = Guard.City(Catalog, args.CityId);

        var issues = GeographyIssues(world, type, city);
        if (issues.Count > 0)
        {
            throw new BridgeException(BridgeErrorCodes.GeographyMismatch,
                $"A {type.Name} needs a city that is {string.Join(" and ", issues.Select(GeographyWord))}; {city.Name} is not.",
                "cityId", new ErrorDetailsDto(Reason: issues[0], EntityKind: EntityKinds.City, EntityId: city.Id.Value));
        }
        if (LandRulesOn(game)) return ConstructOnLand(game, type, city, args);
        if (args.At is { } at) game.Placement.Require(city, type.Footprint, at, "at");

        var slot = PlanInitialSlot(game, type, args.InitialSlot);
        var cash = world.Companies[game.Player].Cash;
        if (type.ConstructionCost > cash) throw Guard.InsufficientFunds(type.ConstructionCost, cash, $"a {type.Name}");

        MarkDirty();
        var building = world.Construct(game.Player, type.Id, city.Id);
        if (slot is { } planned) ApplySlot(world, building, planned);
        var placement = args.At is { } spot
            ? game.Placement.Place(building.Id.Value, city, type.Footprint, spot)
            : EnsurePlacement(game, building);

        QueueEvent(new GameEventDto(EventKinds.BuildingConstructed, EventKinds.Success,
            $"Built a {type.Name} in {city.Name}.",
            Amount: type.ConstructionCost, BuildingId: building.Id.Value, CityId: city.Id.Value, CompanyId: game.Player.Value,
            IsPlayer: true, TypeId: type.Id.Value, Placement: placement, ProductId: slot?.Product.Id.Value, Priority: 1));
        return Summarize(game, building);
    }

    /// <summary><c>construct</c> under engine land rules: site, land, deposit, schedule.</summary>
    private BuildingSummaryDto ConstructOnLand(ActiveGame game, BuildingType type, City city, ConstructArgs args)
    {
        var world = game.World;
        var player = game.Player;
        ConstructionQuote quote;
        if (args.At is { } at)
        {
            PlacementModel.ValidateRotation(at, "at");
            quote = world.QuoteConstruction(player, type.Id, city.Id, new PlotRef(at.Px, at.Pz, at.Rotation));
            if (!quote.Ok) throw PlacementIssueNames.Error(quote.Placement, "at");
        }
        else
        {
            quote = AutoSiteQuote(world, player, type, city)
                ?? throw new BridgeException(BridgeErrorCodes.ZoningForbidden,
                    $"No free site in {city.Name} can take a {type.Name}.", "cityId", new ErrorDetailsDto(Reason: PlacementIssueNames.NoSite));
        }

        var slot = PlanInitialSlot(game, type, args.InitialSlot);
        RequireCanInvest(game);
        var funds = world.AvailableFunds(player);
        if (quote.UpfrontCost > funds) throw Guard.InsufficientFunds(quote.UpfrontCost, funds, $"a {type.Name} here");

        MarkDirty();
        var building = world.Construct(player, type.Id, city.Id, quote.At);
        if (slot is { } planned) ApplySlot(world, building, planned);
        var placement = EnginePlacement(quote.At);
        if (building.Construction is { } works)
        {
            QueueEvent(new GameEventDto(LandEventKinds.ConstructionStarted, EventKinds.Success,
                $"Construction of a {type.Name} in {city.Name} started; it opens in {works.MonthsRemaining} month{(works.MonthsRemaining == 1 ? "" : "s")}.",
                Amount: quote.UpfrontCost, BuildingId: building.Id.Value, CityId: city.Id.Value, CompanyId: player.Value,
                IsPlayer: true, TypeId: type.Id.Value, Placement: placement, ProductId: slot?.Product.Id.Value,
                Months: works.MonthsRemaining, Priority: 1));
        }
        else
        {
            QueueEvent(new GameEventDto(EventKinds.BuildingConstructed, EventKinds.Success,
                $"Built a {type.Name} in {city.Name}.",
                Amount: quote.TotalCost, BuildingId: building.Id.Value, CityId: city.Id.Value, CompanyId: player.Value,
                IsPlayer: true, TypeId: type.Id.Value, Placement: placement, ProductId: slot?.Product.Id.Value, Priority: 1));
        }
        return Summarize(game, building);
    }

    /// <summary>Validate <c>construct.initialSlot</c> against the type (§4.6.4) before anything is built.</summary>
    private PlannedSlot? PlanInitialSlot(ActiveGame game, BuildingType type, SlotConfigArgs? initial)
    {
        if (initial is null) return null;
        var kind = game.Rules.KindOf(type.Id);
        return PlanSlot(type, kind, SlotRules.InitialCapacity(type), initial.SlotIndex ?? 0, initial.ProductId,
            initial.Price, initial.RestockTarget, initial.TargetStock, existing: null, field: "initialSlot");
    }

    /// <summary>
    /// Cancel one of the player's buildings under construction (features.constructionTime):
    /// part of the construction paid so far comes back (the rest is written off) and the site is
    /// sold back at its current land value; the building leaves the map.
    /// </summary>
    [BridgeMethod("cancelConstruction", Mutates = true)]
    public DisposalResultDto CancelConstruction(BuildingRefArgs args)
    {
        var game = Game;
        if (!LandRulesOn(game)) throw Unavailable(FeatureNames.ConstructionTime);
        var world = game.World;
        var b = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        if (b.Construction is null || b.IsRetired)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidOperation, "That building is not under construction.", "buildingId");
        }
        var type = world.Catalog.BuildingType(b.TypeId);
        var city = world.Catalog.City(b.City);
        var placement = game.Placement.Get(b.Id.Value);

        MarkDirty();
        var result = world.CancelConstruction(b.Id);
        QueueEvent(new GameEventDto(LandEventKinds.BuildingDemolished, EventKinds.Warning,
            $"Construction of the {type.Name} in {city.Name} was cancelled; {Money(result.Proceeds)} recovered.",
            Amount: result.Proceeds, BuildingId: b.Id.Value, CityId: city.Id.Value, CompanyId: game.Player.Value, IsPlayer: true,
            TypeId: type.Id.Value, Placement: placement is { Source: not PlacementSources.None } ? placement : null,
            Reason: "constructionCancelled", Priority: 1));
        return new DisposalResultDto(b.Id.Value, result.Proceeds, result.BookValue, result.GainOrLoss);
    }

    /// <summary>One-click starter build: construct + first slot in the most populous city.</summary>
    [BridgeMethod("buildStarterPlan", Mutates = true)]
    public BuildingSummaryDto BuildStarterPlan(StarterPlanArgs args)
    {
        var id = Guard.Required(args.PlanId, "planId");
        var plan = GetCatalog().StarterPlans.FirstOrDefault(p => p.Id == id)
            ?? throw Guard.NotFound(EntityKinds.StarterPlan, id, "planId", $"Unknown starter plan '{id}'.");
        var city = Catalog.Cities.Values.OrderByDescending(c => c.Population).ThenBy(c => c.Id.Value, StringComparer.Ordinal).First();
        var kind = Rules.KindOf(new BuildingTypeId(plan.TypeId));
        var initial = new SlotConfigArgs(
            plan.ProductId,
            0,
            Price: kind == SlotKinds.Retail ? plan.Price : null,
            RestockTarget: kind == SlotKinds.Retail ? plan.Target : null,
            TargetStock: kind == SlotKinds.Warehouse ? plan.Target : null);
        return Construct(new ConstructArgs(plan.TypeId, city.Id.Value, initial));
    }

    /// <summary>
    /// Configure (or re-configure) one slot. Re-configuring an index that holds a
    /// different product replaces it (<c>replacedProductId</c>). Kind-specific values
    /// are required unless the slot already sells the same product.
    /// </summary>
    [BridgeMethod("configureSlot", Mutates = true)]
    public SlotDetailDto ConfigureSlot(ConfigureSlotArgs args)
    {
        var game = Game;
        var world = game.World;
        var b = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        var type = world.Catalog.BuildingType(b.TypeId);
        var kind = game.Rules.KindOf(b);
        var existing = SlotRules.At(b, args.SlotIndex);
        var planned = PlanSlot(type, kind, world.GetCapacity(b), args.SlotIndex, args.ProductId, args.Price, args.RestockTarget,
            args.TargetStock, existing is { } e ? (b, e) : null, field: null);

        MarkDirty();
        ApplySlot(world, b, planned);
        var replaced = existing is { } prior && prior.Product != planned.Product.Id ? prior.Product.Value : null;
        QueueEvent(new GameEventDto(EventKinds.SlotConfigured, EventKinds.Info,
            $"{type.Name} #{b.Id.Value} slot {args.SlotIndex + 1} now handles {planned.Product.Name}.",
            BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: planned.Product.Id.Value,
            NewValue: planned.Price, Reason: replaced is null ? null : "replaced", Priority: 0));
        return SlotDetail(game, b, args.SlotIndex, replaced);
    }

    /// <summary>Empty one slot (its stock stays in the building).</summary>
    [BridgeMethod("clearSlot", Mutates = true)]
    public BuildingSummaryDto ClearSlot(SlotRefArgs args)
    {
        var game = Game;
        var world = game.World;
        var b = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        var slot = SlotRules.At(b, args.SlotIndex) ?? throw SlotEmpty(args.SlotIndex);

        MarkDirty();
        world.ClearSlot(b.Id, args.SlotIndex); // the engine's validated slot command (bridge-spec E3)
        QueueEvent(new GameEventDto(EventKinds.SlotCleared, EventKinds.Info,
            $"Cleared slot {args.SlotIndex + 1} of {world.Catalog.BuildingType(b.TypeId).Name} #{b.Id.Value}.",
            BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: slot.Product.Value, Priority: 0));
        return Summarize(game, b);
    }

    /// <summary>Change a retail slot's price (takes effect at the next month close).</summary>
    [BridgeMethod("setRetailPrice", Mutates = true)]
    public SlotDetailDto SetRetailPrice(SetRetailPriceArgs args)
    {
        var game = Game;
        var b = Guard.OwnedBuilding(game.World, game.Player, args.BuildingId);
        var slot = b.RetailSlots.FirstOrDefault(s => s.Index == args.SlotIndex) ?? throw SlotEmpty(args.SlotIndex);
        var price = Guard.PositiveMoney(args.Price, Guard.MaxPrice, "price");
        var old = slot.Price;
        MarkDirty();
        game.World.SetRetailPrice(b.Id, args.SlotIndex, price);
        if (old != price)
        {
            QueueEvent(new GameEventDto(EventKinds.PriceChanged, EventKinds.Info,
                $"{ProductName(slot.Product)} price set to {Money(price)}.",
                BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: slot.Product.Value, OldValue: old, NewValue: price, Priority: 0));
        }
        return SlotDetail(game, b, args.SlotIndex, null);
    }

    /// <summary>Change a retail slot's restock target (units kept on the shelf).</summary>
    [BridgeMethod("setRestockTarget", Mutates = true)]
    public SlotDetailDto SetRestockTarget(SetRestockTargetArgs args)
    {
        var game = Game;
        var b = Guard.OwnedBuilding(game.World, game.Player, args.BuildingId);
        var slot = b.RetailSlots.FirstOrDefault(s => s.Index == args.SlotIndex) ?? throw SlotEmpty(args.SlotIndex);
        var target = Guard.PositiveQuantity(args.RestockTarget, Guard.MaxQuantity, "restockTarget");
        MarkDirty();
        game.World.SetRestockTarget(b.Id, args.SlotIndex, target);
        return SlotDetail(game, b, args.SlotIndex, null);
    }

    /// <summary>Change a warehouse slot's target stock.</summary>
    [BridgeMethod("setWarehouseTarget", Mutates = true)]
    public SlotDetailDto SetWarehouseTarget(SetWarehouseTargetArgs args)
    {
        var game = Game;
        var b = Guard.OwnedBuilding(game.World, game.Player, args.BuildingId);
        var slot = b.WarehouseSlots.FirstOrDefault(s => s.Index == args.SlotIndex) ?? throw SlotEmpty(args.SlotIndex);
        var target = Guard.PositiveQuantity(args.TargetStock, Guard.MaxQuantity, "targetStock");
        MarkDirty();
        game.World.SetWarehouseTarget(b.Id, args.SlotIndex, target);
        return SlotDetail(game, b, args.SlotIndex, null);
    }

    /// <summary>Turn automatic export of a producer's output on or off.</summary>
    [BridgeMethod("setAutoExport", Mutates = true)]
    public BuildingSummaryDto SetAutoExport(SetAutoExportArgs args)
    {
        var game = Game;
        var b = Guard.OwnedBuilding(game.World, game.Player, args.BuildingId);
        MarkDirty();
        game.World.SetAutoExport(b.Id, args.Enabled);
        return Summarize(game, b);
    }

    /// <summary>Upgrade a building one level (more slots, lower opex).</summary>
    [BridgeMethod("upgradeBuilding", Mutates = true)]
    public UpgradeResultDto UpgradeBuilding(BuildingRefArgs args)
    {
        var game = Game;
        var world = game.World;
        var b = Guard.OwnedBuilding(world, game.Player, args.BuildingId);
        var type = world.Catalog.BuildingType(b.TypeId);
        if (b.Construction is not null)
        {
            throw new BridgeException(BridgeErrorCodes.UnderConstruction, $"The {type.Name} is still under construction.", "buildingId");
        }
        if (type.Levels is not { Count: > 0 } levels)
        {
            throw new BridgeException(BridgeErrorCodes.NotUpgradeable, $"A {type.Name} cannot be upgraded.", "buildingId",
                new ErrorDetailsDto(Level: b.Level, MaxLevel: 1));
        }
        if (b.Level >= levels.Count)
        {
            throw new BridgeException(BridgeErrorCodes.MaxLevel, $"This {type.Name} is already at its top level.", "buildingId",
                new ErrorDetailsDto(Level: b.Level, MaxLevel: levels.Count));
        }
        var next = levels[b.Level];
        var cash = world.Companies[game.Player].Cash;
        if (next.UpgradeCost > cash) throw Guard.InsufficientFunds(next.UpgradeCost, cash, $"upgrading the {type.Name}");

        MarkDirty();
        world.UpgradeBuilding(b.Id);
        QueueEvent(new GameEventDto(EventKinds.BuildingUpgraded, EventKinds.Success,
            $"{type.Name} #{b.Id.Value} upgraded to level {b.Level}.",
            BuildingId: b.Id.Value, CityId: b.City.Value, CompanyId: game.Player.Value, IsPlayer: true,
            Level: b.Level, MaxLevel: levels.Count, Amount: next.UpgradeCost, Priority: 1));
        return new UpgradeResultDto(b.Id.Value, b.Level, world.GetCapacity(b), world.GetMonthlyOpex(b), next.UpgradeCost);
    }

    // ------------------------------------------------------------------ slot planning

    /// <summary>A validated slot configuration ready to apply.</summary>
    private sealed record PlannedSlot(string Kind, int Index, Product Product, decimal? Price, double? RestockTarget, double? TargetStock);

    /// <summary>
    /// Validate a slot configuration in the spec's order (§4.6.4): index, kind,
    /// product, eligibility, then kind-specific values. <paramref name="existing"/>
    /// lets a re-configuration of the same product keep its current values.
    /// </summary>
    private PlannedSlot PlanSlot(
        BuildingType type,
        string kind,
        int capacity,
        int index,
        string? productId,
        decimal? price,
        double? restockTarget,
        double? targetStock,
        (BuildingInstance Building, SlotRef Slot)? existing,
        string? field)
    {
        string F(string name) => field is null ? name : field + "." + name;
        if (index < 0 || index >= capacity)
        {
            throw new BridgeException(BridgeErrorCodes.SlotOutOfRange,
                $"Slot {index + 1} does not exist; this building has {capacity} slot{(capacity == 1 ? "" : "s")}.",
                F("slotIndex"), new ErrorDetailsDto(SlotIndex: index, Capacity: capacity));
        }
        if (kind == SlotKinds.None)
        {
            throw new BridgeException(BridgeErrorCodes.SlotKindUnsupported, $"A {type.Name} has no configurable slots.",
                F("productId"), new ErrorDetailsDto(EntityKind: EntityKinds.BuildingType, EntityId: type.Id.Value));
        }
        var product = Guard.Product(Catalog, productId, F("productId"));
        if (SlotRules.IneligibilityReason(type, kind, product) is { } reason)
        {
            throw new BridgeException(BridgeErrorCodes.ProductNotAllowed,
                $"{product.Name} cannot go in a {type.Name} slot ({reason}).",
                F("productId"), new ErrorDetailsDto(ProductId: product.Id.Value, Reason: reason));
        }

        var same = existing is { } e && e.Slot.Product == product.Id ? e.Building : null;
        switch (kind)
        {
            case SlotKinds.Retail:
            {
                var current = same?.RetailSlots.FirstOrDefault(s => s.Index == index);
                var p = price is decimal given ? Guard.PositiveMoney(given, Guard.MaxPrice, F("price"))
                    : current?.Price ?? throw new BridgeException(BridgeErrorCodes.BadRequest, "A retail slot needs a price.", F("price"));
                var r = restockTarget is double rt ? Guard.PositiveQuantity(rt, Guard.MaxQuantity, F("restockTarget"))
                    : current?.RestockTarget ?? throw new BridgeException(BridgeErrorCodes.BadRequest, "A retail slot needs a restock target.", F("restockTarget"));
                return new PlannedSlot(kind, index, product, p, r, null);
            }
            case SlotKinds.Warehouse:
            {
                var current = same?.WarehouseSlots.FirstOrDefault(s => s.Index == index);
                var t = targetStock is double ts ? Guard.PositiveQuantity(ts, Guard.MaxQuantity, F("targetStock"))
                    : current?.TargetStock ?? throw new BridgeException(BridgeErrorCodes.BadRequest, "A warehouse slot needs a target stock.", F("targetStock"));
                return new PlannedSlot(kind, index, product, null, null, t);
            }
            default:
                return new PlannedSlot(kind, index, product, null, null, null);
        }
    }

    private static void ApplySlot(World world, BuildingInstance b, PlannedSlot slot)
    {
        switch (slot.Kind)
        {
            case SlotKinds.Retail:
                world.ConfigureRetailSlot(b.Id, slot.Index, slot.Product.Id, slot.Price!.Value, slot.RestockTarget!.Value);
                break;
            case SlotKinds.Warehouse:
                world.ConfigureWarehouseSlot(b.Id, slot.Index, slot.Product.Id, slot.TargetStock!.Value);
                break;
            case SlotKinds.Production:
                world.ConfigureProductionSlot(b.Id, slot.Index, slot.Product.Id);
                break;
            case SlotKinds.Extraction:
                world.ConfigureExtractionSlot(b.Id, slot.Index, slot.Product.Id);
                break;
            case SlotKinds.Research:
                world.ConfigureResearchSlot(b.Id, slot.Index, slot.Product.Id);
                break;
        }
    }

    private static BridgeException SlotEmpty(int index)
        => new(BridgeErrorCodes.SlotEmpty, $"Slot {index + 1} is not configured for that.", "slotIndex", new ErrorDetailsDto(SlotIndex: index));

    private static string GeographyWord(string issue) => issue switch
    {
        "coastal" => "coastal",
        "arable" => "farmable",
        "mineralRich" => "rich in minerals",
        _ => "rich in oil",
    };

    private static PlacementDto EnsurePlacement(ActiveGame game, BuildingInstance b)
    {
        game.Placement.EnsureAll(game.World);
        return game.Placement.Get(b.Id.Value)!;
    }

    /// <summary>
    /// The month a building opened: under land rules the month construction completed
    /// (<see cref="BuildingInstance.BuiltAt"/>; null while under construction), otherwise the
    /// month of its construction charge.
    /// </summary>
    private static DateDto? OpenedAt(ActiveGame game, BuildingInstance b, BuildingStatic? info)
    {
        if (LandRulesOn(game)) return b.IsOperational ? Months.Dto(b.BuiltAt) : null;
        return info?.OpenedMonth is int opened ? Months.Dto(opened) : null;
    }

    // ------------------------------------------------------------------ projections

    internal static BuildingSummaryDto Summarize(ActiveGame game, BuildingInstance b)
    {
        var world = game.World;
        var type = world.Catalog.BuildingType(b.TypeId);
        var kind = game.Rules.KindOf(b);
        var month = game.Index.Building(b.Id.Value, game.Now);
        var topStock = b.Inventory.Entries
            .Where(e => e.Value > 0)
            .OrderByDescending(e => e.Value)
            .ThenBy(e => e.Key.Value, StringComparer.Ordinal)
            .Take(3)
            .Select(e => new ProductQtyDto(e.Key.Value, e.Value))
            .ToList();
        return new BuildingSummaryDto(
            Id: b.Id.Value,
            TypeId: b.TypeId.Value,
            Category: type.Category,
            OwnerId: b.Owner.Value,
            CityId: b.City.Value,
            Level: b.Level,
            ConfiguredSlots: SlotRules.ConfiguredCount(b),
            Capacity: world.GetCapacity(b),
            Name: $"{type.Name} #{b.Id.Value.ToString(CultureInfo.InvariantCulture)}",
            SlotKind: kind,
            Status: StatusOf(kind, b),
            Products: SlotRules.Products(b),
            MonthlyOpex: world.GetMonthlyOpex(b),
            CashFlowThisMonth: month?.Net ?? 0m,
            NetIncomeThisMonth: month?.NetIncome ?? 0m,
            TopStock: topStock,
            Placement: game.Placement.Get(b.Id.Value) ?? new PlacementDto(0, 0, 0, PlacementSources.Auto),
            ColorIndex: game.ColorIndex(b.Owner.Value));
    }

    private SlotDetailDto SlotDetail(ActiveGame game, BuildingInstance b, int index, string? replaced)
    {
        var world = game.World;
        var slot = SlotRules.At(b, index) ?? throw SlotEmpty(index);
        var product = world.Catalog.Product(slot.Product);
        var onHand = b.Inventory.Get(product.Id);
        var unitCost = onHand > 0 ? b.Inventory.CostOf(product.Id) / (decimal)onHand : 0m;
        var worldPrice = world.GetEffectiveWorldPrice(product.Id);
        var now = game.Now;
        var bp = game.Index.BuildingProduct(b.Id.Value, product.Id.Value, now);

        RetailSlotDto? retail = null;
        WarehouseSlotDto? warehouse = null;
        ProductionSlotDto? production = null;
        ExtractionSlotDto? extraction = null;
        ResearchSlotDto? research = null;
        switch (slot.Kind)
        {
            case SlotKinds.Retail:
            {
                var rs = b.RetailSlots.First(s => s.Index == index);
                var city = world.Catalog.City(b.City);
                var allocation = MarketModel.Allocate(world, city, product);
                var model = allocation.Retailers.FirstOrDefault(r => r.Building.Id == b.Id && r.Slot.Index == index);
                var rivals = allocation.Retailers.Where(r => r.Building.Owner != b.Owner).ToList();
                var units = bp?.SaleQty ?? 0;
                var revenue = bp?.SaleRev ?? 0m;
                retail = new RetailSlotDto(
                    Price: rs.Price,
                    RestockTarget: rs.RestockTarget,
                    OnHand: onHand,
                    UnitCost: unitCost,
                    EffectiveWorldPrice: worldPrice,
                    LastMonthUnits: units,
                    LastMonthRevenue: revenue,
                    LastMonthAvgPrice: units > 0 ? revenue / (decimal)units : null,
                    CheapestRivalPrice: rivals.Count > 0 ? rivals.Min(r => r.Price) : null,
                    RivalCount: rivals.Select(r => r.Building.Owner).Distinct().Count(),
                    ModelDemandUnits: Math.Round(model?.Demand ?? 0, 3),
                    BelowCost: onHand > 0 && rs.Price < unitCost);
                break;
            }
            case SlotKinds.Warehouse:
            {
                var ws = b.WarehouseSlots.First(s => s.Index == index);
                warehouse = new WarehouseSlotDto(ws.TargetStock, onHand, unitCost);
                break;
            }
            case SlotKinds.Production:
            {
                var recipe = product.Recipe;
                // The engine's cycles: per-unit recipes (E1) run outputPerSlotMonth / outputQuantity,
                // legacy ones the 200-cycle constant.
                var cycles = recipe?.CyclesPerSlotMonth ?? EngineConstants.CyclesPerSlotPerMonth;
                var inputs = recipe is null
                    ? new List<InputSupplyDto>()
                    : recipe.Inputs.Select(i => InputSupply(world, b, i, cycles)).ToList();
                var exportLoss = b.AutoExport && bp is { ExportQty: > 0 } && bp.ExportRev < bp.Cogs;
                production = new ProductionSlotDto(
                    CyclesPerMonth: (int)Math.Floor(cycles),
                    OutputPerMonth: (recipe?.OutputQuantity ?? 0) * cycles,
                    Inputs: inputs,
                    LastMonthOutput: null,
                    Utilization: game.Utilization(b),
                    UnitCost: onHand > 0 ? unitCost : null,
                    EffectiveWorldPrice: worldPrice,
                    ExportsAtLoss: exportLoss);
                break;
            }
            case SlotKinds.Extraction:
                extraction = new ExtractionSlotDto(product.Extraction?.YieldPerSlotPerMonth ?? 0, onHand, EngineConstants.ExtractionQuality);
                break;
            case SlotKinds.Research:
                research = ResearchSlot(world, b.Owner, product);
                break;
        }
        return new SlotDetailDto(index, slot.Kind, product.Id.Value, product.Name, TierId(product.Tier),
            retail, warehouse, production, extraction, research, replaced);
    }

    /// <summary>
    /// Where the engine will source a recipe input (MaterialProcurement order): own stock,
    /// then own producers/extractors/warehouses of it — same city first, then by city id,
    /// then building id — then the world market.
    /// </summary>
    private static InputSupplyDto InputSupply(World world, BuildingInstance b, RecipeInput input, double cycles)
    {
        var source = world.Buildings.Values
            .Where(s => s.Owner == b.Owner && s.Id != b.Id
                && (s.ProductionSlots.Any(x => x.Product == input.ProductId)
                    || s.ExtractionSlots.Any(x => x.Product == input.ProductId)
                    || s.WarehouseSlots.Any(x => x.Product == input.ProductId)))
            .OrderBy(s => s.City == b.City ? 0 : 1)
            .ThenBy(s => s.City.Value, StringComparer.Ordinal)
            .ThenBy(s => s.Id.Value)
            .FirstOrDefault();
        var kind = source is null ? "worldMarket" : source.City == b.City ? "own" : "ownOtherCity";
        return new InputSupplyDto(
            input.ProductId.Value,
            input.Quantity * cycles,
            b.Inventory.Get(input.ProductId),
            kind,
            source?.Id.Value,
            source?.City.Value,
            world.GetEffectiveWorldPrice(input.ProductId));
    }

    private static ResearchSlotDto ResearchSlot(World world, CompanyId owner, Product product)
    {
        var tech = world.GetTech(owner, product.Id);
        var blocked = world.IsPatentBlocked(owner, product.Id);
        var slots = world.Buildings.Values.Where(x => x.Owner == owner).Sum(x => x.ResearchSlots.Count(s => s.Product == product.Id));
        var points = blocked ? 0 : EngineConstants.ResearchPointsPerSlotPerMonth * slots;
        var progress = world.GetResearchProgress(owner, product.Id);
        var threshold = EngineConstants.BaseResearchThreshold * tech;
        int? eta = tech >= product.MaxTechLevel || points <= 0 ? null : (int)Math.Ceiling(Math.Max(0, threshold - progress) / points);
        var holder = world.GetActivePatents().FirstOrDefault(p => p.Product == product.Id && p.Holder != owner)?.Holder.Value;
        return new ResearchSlotDto(tech, product.MaxTechLevel, progress, threshold, points, eta, blocked, blocked ? holder : null);
    }

    private static List<InventoryRowDto> InventoryRows(World world, BuildingInstance b)
        => b.Inventory.EntriesWithCost
            .Where(e => e.Quantity > 0)
            .Select(e => (Entry: e, Product: world.Catalog.Products.TryGetValue(e.Product, out var p) ? p : null))
            .OrderBy(x => x.Product?.Tier ?? ProductTier.Raw)
            .ThenBy(x => x.Entry.Product.Value, StringComparer.Ordinal)
            .Select(x => new InventoryRowDto(
                x.Entry.Product.Value,
                x.Product?.Name ?? x.Entry.Product.Value,
                x.Product is null ? "raw" : TierId(x.Product.Tier),
                x.Entry.Quantity,
                x.Entry.Cost,
                x.Entry.Quantity > 0 ? x.Entry.Cost / (decimal)x.Entry.Quantity : 0m,
                x.Entry.AverageQuality))
            .ToList();

    private static InventoryTotalsDto InventoryTotals(World world, BuildingInstance b)
    {
        double rawUnits = 0, midUnits = 0, finUnits = 0;
        decimal rawCost = 0m, midCost = 0m, finCost = 0m;
        foreach (var (product, quantity, cost, _) in b.Inventory.EntriesWithCost)
        {
            var tier = world.Catalog.Products.TryGetValue(product, out var p) ? p.Tier : ProductTier.Raw;
            switch (tier)
            {
                case ProductTier.Raw: rawUnits += quantity; rawCost += cost; break;
                case ProductTier.Intermediate: midUnits += quantity; midCost += cost; break;
                default: finUnits += quantity; finCost += cost; break;
            }
        }
        return new InventoryTotalsDto(new TierTotalDto(rawUnits, rawCost), new TierTotalDto(midUnits, midCost), new TierTotalDto(finUnits, finCost));
    }

    private static BuildingPnlDto BuildingPnl(ActiveGame game, BuildingInstance b)
    {
        var now = game.Now;
        var opened = game.Index.BuildingInfo(b.Id.Value)?.OpenedMonth ?? game.StartMonth;
        PnlWindowDto Window(int from, int to)
        {
            from = Math.Min(from, to);
            decimal revenue = 0m, cogs = 0m, opex = 0m;
            for (var m = from; m <= to; m++)
            {
                if (game.Index.Building(b.Id.Value, m) is not { } bm) continue;
                revenue += bm.Revenue;
                cogs += bm.Cogs;
                opex += bm.Opex;
            }
            return new PnlWindowDto(Months.Dto(from), Months.Dto(to), revenue, cogs, revenue - cogs, opex, revenue - cogs - opex);
        }
        var seriesStart = now - 11;
        var values = new double?[12];
        for (var i = 0; i < 12; i++)
        {
            var m = seriesStart + i;
            values[i] = m < opened ? null : (double)(game.Index.Building(b.Id.Value, m)?.NetIncome ?? 0m);
        }
        return new BuildingPnlDto(
            Window(now, now),
            Window(Math.Max(opened, now - 11), now),
            Window(opened, now),
            new SeriesDto(Months.Dto(seriesStart), values));
    }

    private static SupplyDto BuildingSupply(ActiveGame game, BuildingInstance b)
    {
        var world = game.World;
        var now = game.Now;
        var id = b.Id.Value;
        var sources = new List<SupplyLinkDto>();
        var destinations = new List<SupplyLinkDto>();

        var incoming = new SortedDictionary<(int From, string Product), double>(OrdinalComparers.IdThenName);
        var outgoing = new SortedDictionary<(int To, string Product), double>(OrdinalComparers.IdThenName);
        var (start, end) = game.Index.TransferMonth(now);
        var log = world.TransferLog.Entries;
        for (var i = start; i < end && i < log.Count; i++)
        {
            var t = log[i];
            if (t.Date.AsMonthIndex() != now) continue;
            if (t.To.Value == id) incoming[(t.From.Value, t.Product.Value)] = incoming.GetValueOrDefault((t.From.Value, t.Product.Value)) + t.Quantity;
            if (t.From.Value == id) outgoing[(t.To.Value, t.Product.Value)] = outgoing.GetValueOrDefault((t.To.Value, t.Product.Value)) + t.Quantity;
        }
        string? CityOf(int other) => world.Buildings.TryGetValue(new BuildingInstanceId(other), out var x) ? x.City.Value : null;
        foreach (var ((from, product), qty) in incoming) sources.Add(new SupplyLinkDto("transfer", product, qty, null, from, CityOf(from)));
        foreach (var ((to, product), qty) in outgoing) destinations.Add(new SupplyLinkDto("transfer", product, qty, null, to, CityOf(to)));

        foreach (var ((building, product), bp) in game.Index.BuildingProducts(now).Where(kv => kv.Key.B == id).OrderBy(kv => kv.Key.P, StringComparer.Ordinal))
        {
            if (bp.Purchases > 0m) sources.Add(new SupplyLinkDto("marketPurchase", product, null, bp.Purchases, null, null));
            if (bp.ExportRev > 0m) destinations.Add(new SupplyLinkDto("export", product, bp.ExportQty, bp.ExportRev, null, null));
            if (bp.SaleRev > 0m) destinations.Add(new SupplyLinkDto("retailSale", product, bp.SaleQty, bp.SaleRev, null, b.City.Value));
        }
        return new SupplyDto(sources, destinations);
    }

    private string ProductName(ProductId id) => Catalog.Products.TryGetValue(id, out var p) ? p.Name : id.Value;
}
