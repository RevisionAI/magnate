using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// Event kinds (TS <c>GameEventKind</c>, bridge-spec §7.1) and their UI severities. The names
/// are also the audio router's keys (<c>web/src/audio/data/audio-events.json</c>); workstreams
/// that emit the EXT kinds (construction, land, finance, equity, macro) use these constants.
/// </summary>
internal static class EventKinds
{
    public const string MonthClosed = "monthClosed";
    public const string FirstSale = "firstSale";
    public const string RecordMonth = "recordMonth";
    public const string BuildingSales = "buildingSales";
    public const string ExportSales = "exportSales";
    public const string NetIncomeFlip = "netIncomeFlip";
    public const string LossStreak = "lossStreak";
    public const string CashLow = "cashLow";
    public const string LowRunway = "lowRunway";
    public const string CashNegative = "cashNegative";
    public const string BankruptcyWarning = "bankruptcyWarning";
    public const string GoalAchieved = "goalAchieved";
    public const string GoalLost = "goalLost";
    public const string ScenarioWon = "scenarioWon";
    public const string ScenarioLost = "scenarioLost";
    public const string News = "news";
    public const string PriceEffectEnded = "priceEffectEnded";
    public const string BuildingConstructed = "buildingConstructed";
    public const string BuildingUpgraded = "buildingUpgraded";
    public const string SlotConfigured = "slotConfigured";
    public const string SlotCleared = "slotCleared";
    public const string PriceChanged = "priceChanged";
    public const string TechLevelUp = "techLevelUp";
    public const string PatentGranted = "patentGranted";
    public const string PatentExpired = "patentExpired";
    public const string PatentBlocked = "patentBlocked";
    public const string LicenseGranted = "licenseGranted";
    public const string LicenseRevoked = "licenseRevoked";
    public const string RevenueMilestone = "revenueMilestone";
    public const string RivalEnteredMarket = "rivalEnteredMarket";
    public const string RivalUndercut = "rivalUndercut";
    public const string ShareRankFirst = "shareRankFirst";
    public const string ShareMilestone = "shareMilestone";
    public const string CampaignStarted = "campaignStarted";
    public const string CampaignChanged = "campaignChanged";
    public const string CampaignCancelled = "campaignCancelled";
    public const string BrandMilestone = "brandMilestone";
    public const string BrandFading = "brandFading";
    public const string BelowCostPrice = "belowCostPrice";
    public const string Autosaved = "autosaved";

    // Game-feel kinds the audio router keys on (UX §8, audio-plan §4.12).
    public const string CashRecovered = "cashRecovered";
    public const string QuarterClosed = "quarterClosed";
    public const string MarketLeaderLost = "marketLeaderLost";

    // Per-slot operating report (E10). Until the engine reports demand per slot these are
    // detected from month-end stock: a retail line that ended empty after selling (stockout),
    // more than three months of cover on the shelf (overstock), a producer starved of an input.
    public const string Stockout = "stockout";
    public const string Overstock = "overstock";
    public const string InputShortage = "inputShortage";

    // EXT kinds (bridge-spec §8), emitted by the land, finance, equity and macro workstreams.
    public const string ConstructionStarted = "constructionStarted";
    public const string ConstructionCompleted = "constructionCompleted";
    public const string BuildingDemolished = "buildingDemolished";
    public const string LandPurchased = "landPurchased";
    public const string LoanTaken = "loanTaken";
    public const string LoanRepaid = "loanRepaid";
    public const string LoanDenied = "loanDenied";
    public const string LoanPaymentMissed = "loanPaymentMissed";
    public const string CreditRatingChanged = "creditRatingChanged";
    /// <summary>E2 finance (published by GoalTracker): <c>reason</c> default | cured | bankrupt.</summary>
    public const string Insolvency = "insolvency";
    public const string TaxPaid = "taxPaid";
    public const string DividendPaid = "dividendPaid";
    public const string IpoEligible = "ipoEligible";
    public const string IpoCompleted = "ipoCompleted";
    public const string SharePriceMove = "sharePriceMove";
    public const string IndexMove = "indexMove";
    public const string TakeoverBid = "takeoverBid";
    public const string StakeAlert = "stakeAlert";
    public const string MacroShift = "macroShift";
    public const string PolicyRateChanged = "policyRateChanged";
    public const string CompanyBankrupt = "companyBankrupt";

    public const string Info = "info";
    public const string Success = "success";
    public const string Warning = "warning";
    public const string Danger = "danger";
}

/// <summary>
/// Turns world changes into <see cref="GameEventDto"/>s (bridge-spec §7.2):
/// a cheap pre-tick <see cref="Capture"/> (O(buildings + slots)) diffed against
/// the post-tick world and the index's closed month. Latches (low cash, net-income
/// sign, milestones, first sale, rival entries, blocked patents, below-cost
/// warnings) persist in the save so nothing re-fires after a load. When the engine
/// emits domain events (E12, <c>features.domainEvents</c>) this diffing is replaced.
/// </summary>
internal sealed class EventDetector
{
    /// <summary>Cumulative player revenue milestones (UX §8 #8).</summary>
    public static readonly decimal[] RevenueMilestones = { 1_000_000m, 10_000_000m, 100_000_000m, 1_000_000_000m };

    private static readonly double[] ShareThresholds = { 0.25, 0.50, 0.75 };
    private static readonly double[] BrandThresholds = { 30, 50, 70 };

    /// <summary>Months of shelf cover above which a retail line counts as overstocked (UX §8 #10).</summary>
    public const double OverstockCoverMonths = 3.0;

    /// <summary>A rival must outsell the player by this factor to take the lead (no flapping on ties).</summary>
    private const double LeadLostMargin = 1.05;

    /// <summary>Re-fire windows (months) of the per-line warnings.</summary>
    private const int StockoutRearmMonths = 6;
    private const int OverstockRearmMonths = 12;
    private const int ShortageRearmMonths = 6;

    /// <summary>Utilisation below which a producer that ran out of an input reports a shortage.</summary>
    private const double ShortageUtilization = 0.5;

    /// <summary>Per-month cap on per-building sales/export popup events.</summary>
    public const int MaxPopupEvents = 50;

    private bool _lowCashArmed = true;
    private bool _lowRunwayActive;
    private int _niSign;
    private int _lossStreak;
    private decimal? _maxNetIncome;
    private int _revenueMilestoneIndex;
    private bool _firstSale;
    private readonly HashSet<string> _rivalEntered = new(StringComparer.Ordinal);
    private readonly HashSet<string> _patentBlocked = new(StringComparer.Ordinal);
    private readonly HashSet<string> _playerPatents = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _belowCostFired = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _stockoutFired = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _overstockFired = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _shortageFired = new(StringComparer.Ordinal);

    /// <summary>State before a tick, enough to diff against afterwards.</summary>
    internal sealed class Capture
    {
        public decimal PlayerCash;
        public int NewsCount;
        public readonly Dictionary<int, (int Owner, int Level)> Buildings = new();
        public readonly HashSet<(int Holder, string Product)> Patents = new();
        public readonly Dictionary<(int Company, string Product), int> Tech = new();
        public readonly HashSet<(string City, string Product)> PlayerMarkets = new();
        public readonly Dictionary<(int Building, int Slot), (int Owner, string City, string Product, decimal Price)> RivalSlots = new();
        public readonly HashSet<string> PriceEffects = new(StringComparer.Ordinal);
        public readonly Dictionary<(string Product, string City), double> PlayerBrand = new();
    }

    public Capture Before(World world, CompanyId player)
    {
        var c = new Capture
        {
            PlayerCash = world.Companies[player].Cash,
            NewsCount = world.NewsLog.Count,
        };
        foreach (var b in world.Buildings.Values)
        {
            c.Buildings[b.Id.Value] = (b.Owner.Value, b.Level);
            if (b.Owner == player)
            {
                foreach (var s in b.RetailSlots) c.PlayerMarkets.Add((b.City.Value, s.Product.Value));
            }
        }
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner == player) continue;
            foreach (var s in b.RetailSlots)
            {
                if (c.PlayerMarkets.Contains((b.City.Value, s.Product.Value)))
                {
                    c.RivalSlots[(b.Id.Value, s.Index)] = (b.Owner.Value, b.City.Value, s.Product.Value, s.Price);
                }
            }
        }
        foreach (var p in world.GetActivePatents()) c.Patents.Add((p.Holder.Value, p.Product.Value));
        foreach (var company in world.Companies.Keys)
        {
            foreach (var product in world.Catalog.Products.Keys) c.Tech[(company.Value, product.Value)] = world.GetTech(company, product);
        }
        foreach (var e in world.ActivePriceEffects) c.PriceEffects.Add(e.ProductId);
        foreach (var key in PlayerBrandKeys(world, player)) c.PlayerBrand[key] = world.GetBrandAwareness(player, new ProductId(key.Product), new CityId(key.City));
        return c;
    }

    /// <summary>
    /// Everything detectable after a tick, in the spec's order: news, rival construction,
    /// rival moves, player sales, milestones, cash. Goals, outcome, the bankruptcy
    /// countdown and <c>monthClosed</c> are appended by the session.
    /// </summary>
    public List<GameEventDto> AfterTick(
        World world,
        CompanyId player,
        LedgerIndex index,
        Capture before,
        int now,
        int start,
        decimal lowCashThreshold,
        double? runwayMonths,
        Func<BuildingInstance, double?>? utilization = null)
    {
        var events = new List<GameEventDto>();
        var catalog = world.Catalog;
        var playerId = player.Value;

        // ---- news
        for (var n = before.NewsCount; n < world.NewsLog.Count; n++)
        {
            var news = world.NewsLog[n];
            var major = news.Severity == EventSeverity.Major;
            var (productId, cityId) = NewsSubject(world, news.EventId);
            // typeId = the content event id: the audio router picks the anchor line by it (news-map.json).
            events.Add(new GameEventDto(EventKinds.News, major ? EventKinds.Warning : EventKinds.Info, news.Headline,
                NewsSeq: n, ProductId: productId, CityId: cityId, Priority: major ? 2 : 1,
                Reason: news.Severity.ToString().ToLowerInvariant(), TypeId: news.EventId));
        }
        var effectsNow = new HashSet<string>(world.ActivePriceEffects.Select(e => e.ProductId), StringComparer.Ordinal);
        foreach (var ended in before.PriceEffects.Where(p => !effectsNow.Contains(p)).OrderBy(p => p, StringComparer.Ordinal))
        {
            events.Add(new GameEventDto(EventKinds.PriceEffectEnded, EventKinds.Info,
                $"World price of {ProductName(world, ended)} is back to normal.", ProductId: ended, Priority: 0));
        }

        // ---- construction and upgrades during the tick (AI, or the player's autopilot)
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (!before.Buildings.TryGetValue(b.Id.Value, out var prior))
            {
                var mine = b.Owner == player;
                var type = catalog.BuildingType(b.TypeId);
                events.Add(new GameEventDto(EventKinds.BuildingConstructed, mine ? EventKinds.Success : EventKinds.Info,
                    $"{CompanyName(world, b.Owner.Value)} opened a {type.Name} in {catalog.City(b.City).Name}.",
                    BuildingId: b.Id.Value, CompanyId: b.Owner.Value, IsPlayer: mine, TypeId: b.TypeId.Value,
                    CityId: b.City.Value, Amount: type.ConstructionCost, Priority: 1));
            }
            else if (b.Level > prior.Level)
            {
                var mine = b.Owner == player;
                events.Add(new GameEventDto(EventKinds.BuildingUpgraded, mine ? EventKinds.Success : EventKinds.Info,
                    $"{catalog.BuildingType(b.TypeId).Name} #{b.Id.Value} upgraded to level {b.Level}.",
                    BuildingId: b.Id.Value, CompanyId: b.Owner.Value, IsPlayer: mine, Level: b.Level, Priority: 1));
            }
        }

        // ---- rival moves in the player's markets
        var playerPrice = new Dictionary<(string, string), decimal>();
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            foreach (var s in b.RetailSlots)
            {
                var key = (b.City.Value, s.Product.Value);
                playerPrice[key] = playerPrice.TryGetValue(key, out var p) ? Math.Min(p, s.Price) : s.Price;
            }
        }
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Owner == player) continue;
            foreach (var s in b.RetailSlots.OrderBy(s => s.Index))
            {
                var market = (b.City.Value, s.Product.Value);
                if (!before.PlayerMarkets.Contains(market)) continue;
                if (!before.RivalSlots.TryGetValue((b.Id.Value, s.Index), out var prior) || prior.Product != s.Product.Value)
                {
                    var latch = $"{b.Owner.Value}|{b.City.Value}|{s.Product.Value}";
                    if (_rivalEntered.Add(latch))
                    {
                        events.Add(new GameEventDto(EventKinds.RivalEnteredMarket, EventKinds.Warning,
                            $"{CompanyName(world, b.Owner.Value)} started selling {ProductName(world, s.Product.Value)} in {catalog.City(b.City).Name}.",
                            CompanyId: b.Owner.Value, IsPlayer: false, CityId: b.City.Value, ProductId: s.Product.Value,
                            BuildingId: b.Id.Value, Amount: s.Price, Priority: 2));
                    }
                }
                else if (s.Price <= prior.Price * 0.95m
                         && playerPrice.TryGetValue(market, out var mine) && s.Price < mine)
                {
                    events.Add(new GameEventDto(EventKinds.RivalUndercut, EventKinds.Warning,
                        $"{CompanyName(world, b.Owner.Value)} cut its {ProductName(world, s.Product.Value)} price in {catalog.City(b.City).Name} below yours.",
                        CompanyId: b.Owner.Value, IsPlayer: false, CityId: b.City.Value, ProductId: s.Product.Value,
                        BuildingId: b.Id.Value, OldValue: prior.Price, NewValue: s.Price, Priority: 1));
                }
            }
        }

        // ---- player sales
        var month = index.Company(playerId, now);
        var sales = new List<(BuildingInstance B, BuildingMonth M)>();
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            if (index.Building(b.Id.Value, now) is { } bm && (bm.Sales > 0m || bm.Exports > 0m)) sales.Add((b, bm));
        }
        var productSales = month?.Category(Magnate.Engine.Economics.LedgerCategory.ProductSale) ?? 0m;
        if (!_firstSale && productSales > 0m)
        {
            _firstSale = true;
            var top = sales.Where(s => s.M.Sales > 0m).OrderByDescending(s => s.M.Sales).ThenBy(s => s.B.Id.Value).FirstOrDefault();
            events.Add(new GameEventDto(EventKinds.FirstSale, EventKinds.Success, "Your first sale! Customers are buying.",
                Amount: productSales, BuildingId: top.B?.Id.Value, CityId: top.B?.City.Value, Priority: 2));
        }
        foreach (var (b, bm) in sales.Where(s => s.M.Sales > 0m).OrderByDescending(s => s.M.Sales).ThenBy(s => s.B.Id.Value).Take(MaxPopupEvents))
        {
            events.Add(new GameEventDto(EventKinds.BuildingSales, EventKinds.Info,
                $"{catalog.BuildingType(b.TypeId).Name} #{b.Id.Value} sold {Text.Money(bm.Sales)}.",
                BuildingId: b.Id.Value, CityId: b.City.Value, Amount: bm.Sales, Units: bm.RetailQty, Priority: 0));
        }
        foreach (var (b, bm) in sales.Where(s => s.M.Exports > 0m).OrderByDescending(s => s.M.Exports).ThenBy(s => s.B.Id.Value).Take(MaxPopupEvents))
        {
            events.Add(new GameEventDto(EventKinds.ExportSales, EventKinds.Info,
                $"{catalog.BuildingType(b.TypeId).Name} #{b.Id.Value} exported {Text.Money(bm.Exports)}.",
                BuildingId: b.Id.Value, CityId: b.City.Value, Amount: bm.Exports, Units: bm.ExportQty, Priority: 0));
        }

        // ---- milestones
        var netIncome = month?.NetIncome ?? 0m;
        var previousMax = _maxNetIncome ?? 0m;
        if (netIncome >= 100_000m && netIncome > previousMax * 1.10m)
        {
            events.Add(new GameEventDto(EventKinds.RecordMonth, EventKinds.Success,
                $"Record month: net income {Text.Money(netIncome)}.", Amount: netIncome, OldValue: _maxNetIncome, Priority: 2));
        }
        _maxNetIncome = _maxNetIncome is decimal max ? Math.Max(max, netIncome) : netIncome;

        decimal cumulativeRevenue = 0m;
        for (var m = start; m <= now; m++) cumulativeRevenue += index.Revenue(playerId, m);
        while (_revenueMilestoneIndex < RevenueMilestones.Length && cumulativeRevenue >= RevenueMilestones[_revenueMilestoneIndex])
        {
            var threshold = RevenueMilestones[_revenueMilestoneIndex++];
            events.Add(new GameEventDto(EventKinds.RevenueMilestone, EventKinds.Success,
                $"Lifetime revenue passed {Text.Money(threshold)}.", Threshold: threshold, Amount: cumulativeRevenue, Priority: 2));
        }

        var relevant = PlayerProducts(world, player);
        foreach (var ((companyId, productId), techBefore) in before.Tech.OrderBy(kv => kv.Key.Company).ThenBy(kv => kv.Key.Product, StringComparer.Ordinal))
        {
            var company = new CompanyId(companyId);
            if (!world.Companies.ContainsKey(company)) continue;
            var product = catalog.Product(new ProductId(productId));
            var techAfter = world.GetTech(company, product.Id);
            if (techAfter <= techBefore) continue;
            var mine = companyId == playerId;
            if (!mine && !relevant.Contains(productId)) continue;
            events.Add(new GameEventDto(EventKinds.TechLevelUp, mine ? EventKinds.Success : EventKinds.Info,
                mine
                    ? $"{product.Name} technology reached level {techAfter}."
                    : $"{CompanyName(world, companyId)} reached {product.Name} technology level {techAfter}.",
                CompanyId: companyId, IsPlayer: mine, ProductId: productId, Level: techAfter, MaxLevel: product.MaxTechLevel,
                Priority: mine ? 2 : 1));
        }

        var patentsNow = world.GetActivePatents();
        var patentSet = new HashSet<(int, string)>(patentsNow.Select(p => (p.Holder.Value, p.Product.Value)));
        var researching = PlayerResearchProducts(world, player);
        foreach (var p in patentsNow)
        {
            if (p.Holder == player) _playerPatents.Add(p.Product.Value);
            if (before.Patents.Contains((p.Holder.Value, p.Product.Value))) continue;
            var mine = p.Holder == player;
            var threatening = !mine && researching.Contains(p.Product.Value);
            events.Add(new GameEventDto(EventKinds.PatentGranted,
                mine ? EventKinds.Success : threatening ? EventKinds.Warning : EventKinds.Info,
                mine
                    ? $"Patent granted on {ProductName(world, p.Product.Value)} for {EngineConstants.PatentDurationMonths} months."
                    : $"{CompanyName(world, p.Holder.Value)} patented {ProductName(world, p.Product.Value)}.",
                CompanyId: p.Holder.Value, IsPlayer: mine, ProductId: p.Product.Value, Months: EngineConstants.PatentDurationMonths,
                Priority: mine ? 3 : threatening ? 2 : 1));
        }
        foreach (var (holder, product) in before.Patents.OrderBy(p => p.Holder).ThenBy(p => p.Product, StringComparer.Ordinal))
        {
            if (patentSet.Contains((holder, product))) continue;
            events.Add(new GameEventDto(EventKinds.PatentExpired, EventKinds.Info,
                $"The patent on {ProductName(world, product)} held by {CompanyName(world, holder)} expired.",
                CompanyId: holder, IsPlayer: holder == playerId, ProductId: product, Priority: 1));
        }
        foreach (var product in researching.OrderBy(p => p, StringComparer.Ordinal))
        {
            var blocked = world.IsPatentBlocked(player, new ProductId(product));
            if (blocked && _patentBlocked.Add(product))
            {
                var holder = patentsNow.FirstOrDefault(p => p.Product.Value == product && p.Holder != player);
                events.Add(new GameEventDto(EventKinds.PatentBlocked, EventKinds.Warning,
                    $"Your {ProductName(world, product)} research is blocked by a rival patent.",
                    ProductId: product, CompanyId: holder?.Holder.Value, Priority: 2));
            }
            else if (!blocked)
            {
                _patentBlocked.Remove(product);
            }
        }

        ShareEvents(world, index, player, now, events);
        BrandEvents(world, player, before, events);
        BelowCostEvents(world, player, now, events);
        StockEvents(world, index, player, now, events);
        if (utilization is not null) ShortageEvents(world, player, now, utilization, events);

        if (Months.Dto(now).Month % 3 == 0)
        {
            var from = Math.Max(start, now - 2);
            var quarterNi = index.NetIncome(playerId, from, now);
            decimal quarterRevenue = 0m;
            for (var m = from; m <= now; m++) quarterRevenue += index.Revenue(playerId, m);
            var label = $"Q{Months.Dto(now).Month / 3} {Months.Dto(now).Year}";
            events.Add(new GameEventDto(EventKinds.QuarterClosed, quarterNi >= 0m ? EventKinds.Success : EventKinds.Warning,
                $"{label}: revenue {Text.Money(quarterRevenue)}, net income {Text.Money(quarterNi)}.",
                Amount: quarterNi, NewValue: quarterRevenue, Months: now - from + 1, Reason: label, Priority: 1));
        }

        var sign = Math.Sign(netIncome);
        if (sign != 0)
        {
            if (_niSign != 0 && sign != _niSign)
            {
                var toProfit = sign > 0;
                events.Add(new GameEventDto(EventKinds.NetIncomeFlip, toProfit ? EventKinds.Success : EventKinds.Warning,
                    toProfit ? "Back in the black: this month made a profit." : "This month lost money.",
                    Amount: netIncome, Reason: toProfit ? "toProfit" : "toLoss", Priority: 2));
            }
            _niSign = sign;
        }
        _lossStreak = netIncome < 0m ? _lossStreak + 1 : 0;
        if (_lossStreak is 2 or 4 or 6)
        {
            events.Add(new GameEventDto(EventKinds.LossStreak, EventKinds.Warning,
                $"{_lossStreak} losing months in a row.", Months: _lossStreak, Amount: netIncome, Priority: 2));
        }

        // ---- cash
        var cash = world.Companies[player].Cash;
        if (cash < lowCashThreshold && _lowCashArmed)
        {
            _lowCashArmed = false;
            events.Add(new GameEventDto(EventKinds.CashLow, EventKinds.Warning,
                $"Cash is down to {Text.Money(cash)}.", Amount: cash, Threshold: lowCashThreshold, Priority: 2));
        }
        else if (cash >= lowCashThreshold * 2m)
        {
            _lowCashArmed = true;
        }
        if (runwayMonths is double runway && runway < 3)
        {
            if (!_lowRunwayActive)
            {
                _lowRunwayActive = true;
                events.Add(new GameEventDto(EventKinds.LowRunway, EventKinds.Warning,
                    $"At this burn rate cash runs out in {runway.ToString("0.#", CultureInfo.InvariantCulture)} months.",
                    Months: (int)Math.Floor(runway), Amount: cash, Priority: 2));
            }
        }
        else
        {
            _lowRunwayActive = false;
        }
        if (before.PlayerCash >= 0m && cash < 0m)
        {
            events.Add(new GameEventDto(EventKinds.CashNegative, EventKinds.Danger,
                "Cash has gone negative.", Amount: cash, Priority: 3));
        }
        else if (before.PlayerCash < 0m && cash >= 0m)
        {
            events.Add(new GameEventDto(EventKinds.CashRecovered, EventKinds.Success,
                "Cash is positive again.", Amount: cash, OldValue: before.PlayerCash, Priority: 2));
        }
        return events;
    }

    /// <summary>
    /// True when the player was granted a patent on <paramref name="productId"/> at some
    /// month close (it may since have expired; the engine grants one patent per company
    /// and product, ever). Distinguishes <c>patent_not_active</c> from <c>not_patent_holder</c>.
    /// </summary>
    public bool PlayerEverHeldPatent(string productId) => _playerPatents.Contains(productId);

    // ------------------------------------------------------------------ helpers

    private static void ShareEvents(World world, LedgerIndex index, CompanyId player, int now, List<GameEventDto> events)
    {
        var markets = new SortedSet<(string, string)>(OrdinalComparers.Pair);
        foreach (var (city, product) in index.RetailMarkets(now))
        {
            if (index.Retail(city, product, player.Value, now) is { Qty: > 0 }) markets.Add((city, product));
        }
        // Markets the player led last month (it may have sold nothing this month).
        foreach (var (city, product) in index.RetailMarkets(now - 1))
        {
            if (index.Retail(city, product, player.Value, now - 1) is { Qty: > 0 }) markets.Add((city, product));
        }
        foreach (var (city, product) in markets)
        {
            var thisMonth = index.RetailUnitsByCompany(city, product, now, now);
            var lastMonth = index.RetailUnitsByCompany(city, product, now - 1, now - 1);
            var shareNow = Share(thisMonth, player.Value);
            var shareBefore = Share(lastMonth, player.Value);
            if (IsFirst(lastMonth, player.Value))
            {
                var mine = thisMonth.GetValueOrDefault(player.Value);
                var leader = thisMonth.Where(kv => kv.Key != player.Value).OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).FirstOrDefault();
                if (leader.Value > 0 && leader.Value > mine * LeadLostMargin)
                {
                    events.Add(new GameEventDto(EventKinds.MarketLeaderLost, EventKinds.Warning,
                        $"{CompanyName(world, leader.Key)} overtook you as the top seller of {ProductName(world, product)} in {world.Catalog.City(new CityId(city)).Name}.",
                        CityId: city, ProductId: product, CompanyId: leader.Key, OldValue: (decimal)Math.Round(shareBefore, 4),
                        NewValue: (decimal)Math.Round(shareNow, 4), Priority: 2));
                }
            }
            if (IsFirst(thisMonth, player.Value) && !IsFirst(lastMonth, player.Value) && thisMonth.Count > 1)
            {
                events.Add(new GameEventDto(EventKinds.ShareRankFirst, EventKinds.Success,
                    $"You are now the #1 seller of {ProductName(world, product)} in {world.Catalog.City(new CityId(city)).Name}.",
                    CityId: city, ProductId: product, NewValue: (decimal)Math.Round(shareNow, 4), Priority: 2));
            }
            var crossed = ShareThresholds.Where(t => shareNow >= t && shareBefore < t).DefaultIfEmpty(0).Max();
            if (crossed > 0)
            {
                events.Add(new GameEventDto(EventKinds.ShareMilestone, EventKinds.Success,
                    $"You now sell {Text.Percent(crossed)} of the {ProductName(world, product)} in {world.Catalog.City(new CityId(city)).Name}.",
                    CityId: city, ProductId: product, Threshold: (decimal)crossed, NewValue: (decimal)Math.Round(shareNow, 4), Priority: 1));
            }
        }
    }

    private static double Share(Dictionary<int, double> units, int company)
    {
        var total = units.Values.Sum();
        return total > 0 && units.TryGetValue(company, out var mine) ? mine / total : 0;
    }

    private static bool IsFirst(Dictionary<int, double> units, int company)
    {
        if (!units.TryGetValue(company, out var mine) || mine <= 0) return false;
        return units.All(kv => kv.Key == company || kv.Value < mine);
    }

    private static void BrandEvents(World world, CompanyId player, Capture before, List<GameEventDto> events)
    {
        var activeCampaigns = new HashSet<(string, string)>(world.AdCampaigns
            .Where(c => c.Company == player && c.MonthlyBudget > 0m)
            .Select(c => (c.Product.Value, c.City.Value)));
        foreach (var key in PlayerBrandKeys(world, player).OrderBy(k => k.Product, StringComparer.Ordinal).ThenBy(k => k.City, StringComparer.Ordinal))
        {
            var brandBefore = before.PlayerBrand.TryGetValue(key, out var b) ? b : 0;
            var brandNow = world.GetBrandAwareness(player, new ProductId(key.Product), new CityId(key.City));
            var crossed = BrandThresholds.Where(t => brandNow >= t && brandBefore < t).DefaultIfEmpty(0).Max();
            if (crossed > 0)
            {
                events.Add(new GameEventDto(EventKinds.BrandMilestone, EventKinds.Success,
                    $"{ProductName(world, key.Product)} brand awareness in {world.Catalog.City(new CityId(key.City)).Name} passed {crossed:0}.",
                    ProductId: key.Product, CityId: key.City, Threshold: (decimal)crossed, Priority: 1));
            }
            else if (brandNow < 30 && brandBefore >= 30 && !activeCampaigns.Contains(key))
            {
                events.Add(new GameEventDto(EventKinds.BrandFading, EventKinds.Info,
                    $"{ProductName(world, key.Product)} brand awareness in {world.Catalog.City(new CityId(key.City)).Name} is fading.",
                    ProductId: key.Product, CityId: key.City, Priority: 0));
            }
        }
    }

    private void BelowCostEvents(World world, CompanyId player, int now, List<GameEventDto> events)
    {
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Owner != player) continue;
            foreach (var s in b.RetailSlots.OrderBy(s => s.Index))
            {
                var onHand = b.Inventory.Get(s.Product);
                if (onHand <= 0) continue;
                var unitCost = b.Inventory.CostOf(s.Product) / (decimal)onHand;
                if (s.Price >= unitCost) continue;
                var key = $"{b.Id.Value}:{s.Index}";
                if (_belowCostFired.TryGetValue(key, out var fired) && now - fired < 12) continue;
                _belowCostFired[key] = now;
                events.Add(new GameEventDto(EventKinds.BelowCostPrice, EventKinds.Warning,
                    $"{ProductName(world, s.Product.Value)} at {world.Catalog.BuildingType(b.TypeId).Name} #{b.Id.Value} sells below cost.",
                    BuildingId: b.Id.Value, ProductId: s.Product.Value, CityId: b.City.Value,
                    NewValue: s.Price, OldValue: Math.Round(unitCost, 4), Priority: 2));
            }
        }
    }

    /// <summary>
    /// Retail lines (building × product) that sold out — month-end stock gone after selling, so
    /// demand went unmet — or sit on more than <see cref="OverstockCoverMonths"/> months of cover.
    /// Interim until the engine's per-slot report (E10) gives demand and lost sales directly.
    /// </summary>
    private void StockEvents(World world, LedgerIndex index, CompanyId player, int now, List<GameEventDto> events)
    {
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Owner != player || b.RetailSlots.Count == 0) continue;
            var type = world.Catalog.BuildingType(b.TypeId);
            foreach (var product in b.RetailSlots.Select(s => s.Product.Value).Distinct().OrderBy(p => p, StringComparer.Ordinal))
            {
                var sold = index.BuildingProduct(b.Id.Value, product, now)?.SaleQty ?? 0;
                if (sold <= 0) continue;
                var onHand = b.Inventory.Get(new ProductId(product));
                var key = $"{b.Id.Value}:{product}";
                if (onHand <= 1e-9)
                {
                    if (Rearmed(_stockoutFired, key, now, StockoutRearmMonths))
                    {
                        events.Add(new GameEventDto(EventKinds.Stockout, EventKinds.Warning,
                            $"{ProductName(world, product)} sold out at {type.Name} #{b.Id.Value} — customers found empty shelves.",
                            BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: product, Units: Math.Round(sold, 2), Priority: 2));
                    }
                }
                else if (onHand / sold > OverstockCoverMonths && Rearmed(_overstockFired, key, now, OverstockRearmMonths))
                {
                    events.Add(new GameEventDto(EventKinds.Overstock, EventKinds.Warning,
                        $"{ProductName(world, product)} at {type.Name} #{b.Id.Value} has {Math.Floor(onHand / sold).ToString(CultureInfo.InvariantCulture)} months of stock on the shelf.",
                        BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: product,
                        Units: Math.Round(onHand - OverstockCoverMonths * sold, 2), Months: (int)Math.Floor(onHand / sold), Priority: 1));
                }
            }
        }
    }

    /// <summary>
    /// Producers that ran below <see cref="ShortageUtilization"/> with an input out of stock at
    /// month end. Interim until the engine reports short inputs per slot (E10).
    /// </summary>
    private void ShortageEvents(World world, CompanyId player, int now, Func<BuildingInstance, double?> utilization, List<GameEventDto> events)
    {
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Owner != player || b.ProductionSlots.Count == 0) continue;
            if (utilization(b) is not double used || used >= ShortageUtilization) continue;
            string? missing = null;
            foreach (var product in b.ProductionSlots.Select(s => s.Product).Distinct().OrderBy(p => p.Value, StringComparer.Ordinal))
            {
                var recipe = world.Catalog.Product(product).Recipe;
                if (recipe is null) continue;
                foreach (var input in recipe.Inputs)
                {
                    if (b.Inventory.Get(input.ProductId) > 1e-9) continue;
                    missing = input.ProductId.Value;
                    break;
                }
                if (missing is not null) break;
            }
            if (missing is null || !Rearmed(_shortageFired, b.Id.Value.ToString(CultureInfo.InvariantCulture), now, ShortageRearmMonths)) continue;
            events.Add(new GameEventDto(EventKinds.InputShortage, EventKinds.Warning,
                $"{world.Catalog.BuildingType(b.TypeId).Name} #{b.Id.Value} ran short of {ProductName(world, missing)} and worked at {Text.Percent(used)} capacity.",
                BuildingId: b.Id.Value, CityId: b.City.Value, ProductId: missing, NewValue: (decimal)Math.Round(used, 4), Priority: 1));
        }
    }

    /// <summary>True (and records the month) when <paramref name="key"/> has not fired within the window.</summary>
    private static bool Rearmed(Dictionary<string, int> fired, string key, int now, int window)
    {
        if (fired.TryGetValue(key, out var at) && now - at < window) return false;
        fired[key] = now;
        return true;
    }

    /// <summary>(product, city) pairs where the player advertises or retails.</summary>
    private static HashSet<(string Product, string City)> PlayerBrandKeys(World world, CompanyId player)
    {
        var keys = new HashSet<(string, string)>();
        foreach (var c in world.AdCampaigns)
        {
            if (c.Company == player) keys.Add((c.Product.Value, c.City.Value));
        }
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            foreach (var s in b.RetailSlots) keys.Add((s.Product.Value, b.City.Value));
        }
        return keys;
    }

    private static HashSet<string> PlayerProducts(World world, CompanyId player)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            foreach (var s in SlotRules.Slots(b)) set.Add(s.Product.Value);
        }
        return set;
    }

    private static HashSet<string> PlayerResearchProducts(World world, CompanyId player)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != player) continue;
            foreach (var s in b.ResearchSlots) set.Add(s.Product.Value);
        }
        return set;
    }

    private static (string? Product, string? City) NewsSubject(World world, string eventId)
    {
        var def = world.Catalog.Events.FirstOrDefault(e => e.Id == eventId);
        if (def is null) return (null, null);
        foreach (var effect in def.Effects)
        {
            switch (effect)
            {
                case WorldMarketPriceMultiplierEffect p: return (p.ProductId, null);
                case BrandShiftEffect b: return (b.ProductId, b.CityId);
            }
        }
        return (null, null);
    }

    private static string ProductName(World world, string productId)
        => world.Catalog.Products.TryGetValue(new ProductId(productId), out var p) ? p.Name : productId;

    private static string CompanyName(World world, int companyId)
        => world.Companies.TryGetValue(new CompanyId(companyId), out var c) ? c.Name : "A rival";

    // ------------------------------------------------------------------ persistence

    public DetectorStateDto Save() => new(
        _lowCashArmed,
        _lowRunwayActive,
        _niSign,
        _lossStreak,
        _maxNetIncome,
        _revenueMilestoneIndex,
        _firstSale,
        _rivalEntered.OrderBy(s => s, StringComparer.Ordinal).ToList(),
        _patentBlocked.OrderBy(s => s, StringComparer.Ordinal).ToList(),
        _belowCostFired.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal),
        _playerPatents.OrderBy(s => s, StringComparer.Ordinal).ToList(),
        Sorted(_stockoutFired),
        Sorted(_overstockFired),
        Sorted(_shortageFired));

    private static Dictionary<string, int>? Sorted(Dictionary<string, int> map)
        => map.Count == 0 ? null : map.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

    private static void Fill(Dictionary<string, int> target, IReadOnlyDictionary<string, int>? source)
    {
        target.Clear();
        foreach (var (k, v) in source ?? new Dictionary<string, int>()) target[k] = v;
    }

    public void Restore(DetectorStateDto? state)
    {
        if (state is null) return;
        _lowCashArmed = state.LowCashArmed;
        _lowRunwayActive = state.LowRunwayActive;
        _niSign = Math.Sign(state.NiSign);
        _lossStreak = Math.Max(0, state.LossStreak);
        _maxNetIncome = state.MaxNetIncome;
        _revenueMilestoneIndex = Math.Clamp(state.RevenueMilestoneIndex, 0, RevenueMilestones.Length);
        _firstSale = state.FirstSale;
        _rivalEntered.Clear();
        foreach (var s in state.RivalEntered ?? Array.Empty<string>()) _rivalEntered.Add(s);
        _patentBlocked.Clear();
        foreach (var s in state.PatentBlocked ?? Array.Empty<string>()) _patentBlocked.Add(s);
        _belowCostFired.Clear();
        foreach (var (k, v) in state.BelowCostFired ?? new Dictionary<string, int>()) _belowCostFired[k] = v;
        _playerPatents.Clear();
        foreach (var s in state.PlayerPatents ?? Array.Empty<string>()) _playerPatents.Add(s);
        Fill(_stockoutFired, state.StockoutFired);
        Fill(_overstockFired, state.OverstockFired);
        Fill(_shortageFired, state.ShortageFired);
    }

    /// <summary>
    /// Initialise latches for a game that predates the detector (legacy load) so
    /// milestones already passed do not fire on the next tick.
    /// <paramref name="patentsEverHeld"/> are the products the save says the player was
    /// ever granted a patent on (expired ones included).
    /// </summary>
    public void Prime(World world, CompanyId player, LedgerIndex index, int start, int now, decimal lowCashThreshold, IEnumerable<string> patentsEverHeld)
    {
        foreach (var product in patentsEverHeld) _playerPatents.Add(product);
        decimal cumulative = 0m;
        for (var m = start; m <= now; m++) cumulative += index.Revenue(player.Value, m);
        _revenueMilestoneIndex = RevenueMilestones.Count(t => cumulative >= t);
        _firstSale = index.CategorySum(player.Value, Magnate.Engine.Economics.LedgerCategory.ProductSale, start, now) > 0m;
        decimal? max = null;
        for (var m = start; m <= now; m++)
        {
            var ni = index.NetIncome(player.Value, m);
            max = max is decimal x ? Math.Max(x, ni) : ni;
        }
        _maxNetIncome = max;
        _niSign = Math.Sign(index.NetIncome(player.Value, now));
        var cash = world.Companies[player].Cash;
        _lowCashArmed = cash >= lowCashThreshold;
        foreach (var p in world.GetActivePatents())
        {
            if (p.Holder == player) _playerPatents.Add(p.Product.Value);
        }
    }
}

/// <summary>Persisted event-detector latches (save sidecar).</summary>
public sealed record DetectorStateDto(
    bool LowCashArmed,
    bool LowRunwayActive,
    int NiSign,
    int LossStreak,
    decimal? MaxNetIncome,
    int RevenueMilestoneIndex,
    bool FirstSale,
    IReadOnlyList<string>? RivalEntered,
    IReadOnlyList<string>? PatentBlocked,
    IReadOnlyDictionary<string, int>? BelowCostFired,
    IReadOnlyList<string>? PlayerPatents = null,
    IReadOnlyDictionary<string, int>? StockoutFired = null,
    IReadOnlyDictionary<string, int>? OverstockFired = null,
    IReadOnlyDictionary<string, int>? ShortageFired = null);
