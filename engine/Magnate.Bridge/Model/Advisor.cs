using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// The advisor (bridge-spec §4.6.9, UX §6.15): one <b>priority</b> — the first rule
/// of the onboarding ladder that fires — plus <b>hints</b> ranked by severity and
/// estimated $/month at stake, each with a one-click fix where a bridge command
/// can fix it. Everything is computed from data the engine has today; rules that
/// need the per-slot sales report (stock-outs, overstock) arrive with E10.
/// </summary>
internal sealed class Advisor
{
    private readonly World _world;
    private readonly CompanyId _player;
    private readonly LedgerIndex _index;
    private readonly SlotRules _rules;
    private readonly int _now;
    private readonly int _start;
    private readonly double? _runway;
    private readonly int? _insolventMonthsLeft;

    /// <summary>
    /// <c>insolventMonthsLeft</c>: months left in the insolvency cure window
    /// (<c>GoalTracker.BankruptcyInMonths</c>: negative cash under the interim rule, the engine's
    /// distress window under finance rules), or null when solvent.
    /// </summary>
    public Advisor(World world, CompanyId player, LedgerIndex index, SlotRules rules, int now, int start, double? runway, int? insolventMonthsLeft = null)
    {
        _insolventMonthsLeft = insolventMonthsLeft;
        _world = world;
        _player = player;
        _index = index;
        _rules = rules;
        _now = now;
        _start = start;
        _runway = runway;
    }

    /// <summary>Maximum hints returned.</summary>
    public const int MaxHints = 8;

    public AdvisorDto Build()
    {
        var hints = new List<(int Rank, AdvisorItemDto Item)>();
        void Add(AdvisorItemDto item) => hints.Add((SeverityRank(item.Severity), item));

        var mine = _world.Buildings.Values.Where(b => b.Owner == _player).OrderBy(b => b.Id.Value).ToList();

        if (Insolvency() is { } insolvency) Add(insolvency);
        if (_runway is double runway && runway < 3)
        {
            Add(Item("lowRunway", "danger",
                $"Cash runs out in about {runway.ToString("0.#", CultureInfo.InvariantCulture)} months at the current burn rate.",
                P(("months", runway.ToString("0.#", CultureInfo.InvariantCulture)))));
        }

        foreach (var b in mine)
        {
            var kind = _rules.KindOf(b);
            var type = _world.Catalog.BuildingType(b.TypeId);
            if (kind != SlotKinds.None && SlotRules.ConfiguredCount(b) == 0)
            {
                Add(Item("idleBuilding", "warning",
                    $"{type.Name} #{b.Id.Value} has nothing configured and costs {Text.Money(_world.GetMonthlyOpex(b))} a month.",
                    P(("buildingId", Text.Int(b.Id.Value))), buildingIds: new[] { b.Id.Value }, cityId: b.City.Value,
                    impact: _world.GetMonthlyOpex(b)));
            }

            foreach (var s in b.RetailSlots.OrderBy(s => s.Index))
            {
                var product = _world.Catalog.Product(s.Product);
                if (product.Tier != ProductTier.Finished)
                {
                    Add(Item("unsellableRetail", "warning",
                        $"{product.Name} cannot be sold to consumers; slot {s.Index} of {type.Name} #{b.Id.Value} restocks it for nothing.",
                        P(("buildingId", Text.Int(b.Id.Value)), ("productId", product.Id.Value), ("slotIndex", Text.Int(s.Index))),
                        buildingIds: new[] { b.Id.Value }, productId: product.Id.Value,
                        fix: Fix("clearSlot", new SlotRefArgs(b.Id.Value, s.Index), "Clear the slot")));
                    continue;
                }
                var onHand = b.Inventory.Get(s.Product);
                if (onHand <= 0) continue;
                var unitCost = b.Inventory.CostOf(s.Product) / (decimal)onHand;
                if (s.Price >= unitCost) continue;
                var units = _index.BuildingProduct(b.Id.Value, s.Product.Value, _now)?.SaleQty ?? 0;
                var suggested = Math.Round(unitCost * 1.25m, 2, MidpointRounding.ToEven);
                Add(Item("sellingBelowCost", "warning",
                    $"{product.Name} at {type.Name} #{b.Id.Value} sells for {Text.Money(s.Price)} but costs {Text.Money(unitCost)} a unit.",
                    P(("buildingId", Text.Int(b.Id.Value)), ("productId", product.Id.Value), ("price", Text.Dec(s.Price)),
                        ("unitCost", Text.Dec(Math.Round(unitCost, 4)))),
                    buildingIds: new[] { b.Id.Value }, productId: product.Id.Value, cityId: b.City.Value,
                    impact: (decimal)units * (unitCost - s.Price),
                    fix: Fix("setRetailPrice", new SetRetailPriceArgs(b.Id.Value, s.Index, suggested), $"Price at {Text.Money(suggested)}")));
            }

            if (b.AutoExport && (b.ProductionSlots.Count > 0 || b.ExtractionSlots.Count > 0))
            {
                foreach (var product in b.ProductionSlots.Select(s => s.Product).Concat(b.ExtractionSlots.Select(s => s.Product)).Distinct())
                {
                    var bp = _index.BuildingProduct(b.Id.Value, product.Value, _now);
                    if (bp is null || bp.ExportQty <= 0 || bp.ExportRev >= bp.Cogs) continue;
                    var loss = bp.Cogs - bp.ExportRev;
                    Add(Item("exportingAtLoss", "warning",
                        $"{type.Name} #{b.Id.Value} exports {ProductName(product.Value)} below what it costs to make.",
                        P(("buildingId", Text.Int(b.Id.Value)), ("productId", product.Value),
                            ("worldPrice", Text.Dec(Math.Round(_world.GetEffectiveWorldPrice(product), 4))),
                            ("unitCost", Text.Dec(Math.Round(bp.Cogs / (decimal)bp.ExportQty, 4)))),
                        buildingIds: new[] { b.Id.Value }, productId: product.Value, impact: loss,
                        fix: Fix("setAutoExport", new SetAutoExportArgs(b.Id.Value, false), "Stop auto-export")));
                }
            }

            if (kind != SlotKinds.None)
            {
                var losing = 0;
                decimal lossSum = 0m;
                for (var m = _now; m > _now - 3 && m > _start; m--)
                {
                    var ni = _index.Building(b.Id.Value, m)?.NetIncome ?? 0m;
                    if (ni >= 0m) break;
                    losing++;
                    lossSum += ni;
                }
                if (losing == 3)
                {
                    Add(Item("losingBuilding", "warning",
                        $"{type.Name} #{b.Id.Value} has lost money three months running.",
                        P(("buildingId", Text.Int(b.Id.Value)), ("months", "3")),
                        buildingIds: new[] { b.Id.Value }, cityId: b.City.Value, impact: -lossSum / 3m));
                }
            }
        }

        var blocked = mine.SelectMany(b => b.ResearchSlots).Select(s => s.Product).Distinct()
            .Where(p => _world.IsPatentBlocked(_player, p)).OrderBy(p => p.Value, StringComparer.Ordinal);
        foreach (var product in blocked)
        {
            var patent = _world.GetActivePatents().FirstOrDefault(p => p.Product == product && p.Holder != _player);
            Add(Item("rivalPatentBlocksYou", "warning",
                $"A rival patent blocks your {ProductName(product.Value)} research{(patent is null ? "" : " until " + Months.Label(patent.ExpiresAt.AsMonthIndex()))}.",
                P(("productId", product.Value), ("holderId", patent is null ? "" : Text.Int(patent.Holder.Value)),
                    ("expiresAt", patent is null ? "" : Months.Label(patent.ExpiresAt.AsMonthIndex()))),
                productId: product.Value));
        }

        foreach (var c in _world.AdCampaigns.Where(c => c.Company == _player && c.MonthlyBudget > 0m)
                     .OrderBy(c => c.Product.Value, StringComparer.Ordinal).ThenBy(c => c.City.Value, StringComparer.Ordinal).ThenBy(c => (int)c.Channel))
        {
            if (HasRetailPresence(c.Product, c.City)) continue;
            Add(Item("adsWithoutStore", "warning",
                $"You advertise {ProductName(c.Product.Value)} in {CityName(c.City)} but sell it nowhere there.",
                P(("productId", c.Product.Value), ("cityId", c.City.Value), ("channel", ChannelId(c.Channel))),
                productId: c.Product.Value, cityId: c.City.Value, impact: c.MonthlyBudget,
                fix: Fix("cancelAdCampaign", new AdKeyArgs(c.Product.Value, c.City.Value, ChannelId(c.Channel)), "Stop the campaign")));
        }

        RivalUndercutHints(mine, Add);
        PatentLeverageHints(Add);
        TechGapHints(mine, Add);
        OpportunityHint(mine, Add);

        var ranked = hints
            .OrderBy(h => h.Rank)
            .ThenByDescending(h => h.Item.ImpactPerMonth ?? 0m)
            .ThenBy(h => h.Item.Code, StringComparer.Ordinal)
            .Select(h => h.Item)
            .Take(MaxHints)
            .ToList();
        return new AdvisorDto(Priority(mine), ranked);
    }

    /// <summary>
    /// <c>insolvency</c> (danger) while the cure window is open: the company goes bankrupt when it
    /// closes. <c>params.monthsLeft</c> counts the month closes left (0 = this one decides).
    /// </summary>
    private AdvisorItemDto? Insolvency()
    {
        if (_insolventMonthsLeft is not int left) return null;
        var cash = _world.Companies[_player].Cash;
        var message = left switch
        {
            <= 0 => "Insolvent: this month decides bankruptcy. Raise cash now — cut costs, sell stock or stop campaigns.",
            1 => "Insolvent: one month left to restore solvency before bankruptcy.",
            _ => $"Insolvent: {left} months left to restore solvency before bankruptcy.",
        };
        return Item("insolvency", "danger", message,
            P(("monthsLeft", Text.Int(Math.Max(0, left))), ("cash", Text.Dec(Math.Round(cash, 2)))),
            impact: cash < 0m ? -cash : null);
    }

    // ------------------------------------------------------------------ the priority ladder

    private AdvisorItemDto Priority(List<BuildingInstance> mine)
    {
        // Survival first: nothing else matters while the company is in its cure window.
        if (Insolvency() is { } insolvency) return insolvency;
        if (mine.Count == 0)
        {
            return Item("firstRevenue", "info", "Build your first store and stock a product to start earning.", P());
        }
        var idle = mine.Where(b => _rules.KindOf(b) != SlotKinds.None && SlotRules.ConfiguredCount(b) == 0).ToList();
        if (idle.Count > 0)
        {
            return Item("activateIdle", "warning",
                idle.Count == 1 ? "One of your buildings has nothing to do — configure it." : $"{idle.Count} of your buildings have nothing to do — configure them.",
                P(("count", Text.Int(idle.Count))), buildingIds: idle.Select(b => b.Id.Value).ToList());
        }
        if (!mine.Any(b => _rules.KindOf(b) == SlotKinds.Retail))
        {
            return Item("needRetail", "info", "Open a store so customers can buy what you make.", P());
        }
        var netIncome = _index.NetIncome(_player.Value, _now);
        if (netIncome < 0m)
        {
            return Item("restoreProfit", "warning", $"You lost {Text.Money(-netIncome)} this month — fix prices, costs or idle buildings.",
                P(("netIncome", Text.Dec(Math.Round(netIncome, 2)))), impact: -netIncome);
        }
        var campaigns = _world.AdCampaigns.Count(c => c.Company == _player && c.MonthlyBudget > 0m);
        if (campaigns == 0)
        {
            return Item("buildBrand", "info", "Advertise your best product to grow brand awareness and market share.", P());
        }
        if (!mine.Any(b => _rules.KindOf(b) == SlotKinds.Research))
        {
            return Item("addResearch", "info", "Build an R&D center to raise product quality through technology.", P());
        }
        return Item("scale", "success", "Everything is running. Next: scale your best market.",
            P(("retail", Text.Int(mine.Count(b => _rules.KindOf(b) == SlotKinds.Retail))),
                ("production", Text.Int(mine.Count(b => _rules.KindOf(b) is SlotKinds.Production or SlotKinds.Extraction))),
                ("research", Text.Int(mine.Count(b => _rules.KindOf(b) == SlotKinds.Research))),
                ("campaigns", Text.Int(campaigns))));
    }

    // ------------------------------------------------------------------ market hints

    private void RivalUndercutHints(List<BuildingInstance> mine, Action<AdvisorItemDto> add)
    {
        var served = new SortedSet<(string City, string Product)>(OrdinalComparers.Pair);
        foreach (var b in mine)
        {
            foreach (var s in b.RetailSlots) served.Add((b.City.Value, s.Product.Value));
        }
        foreach (var (city, product) in served)
        {
            var myPrices = mine.Where(b => b.City.Value == city).SelectMany(b => b.RetailSlots).Where(s => s.Product.Value == product).ToList();
            if (myPrices.Count == 0) continue;
            var myPrice = myPrices.Min(s => s.Price);
            var rivals = _world.Buildings.Values
                .Where(b => b.Owner != _player && b.City.Value == city)
                .SelectMany(b => b.RetailSlots.Where(s => s.Product.Value == product).Select(s => (b, s)))
                .ToList();
            if (rivals.Count == 0) continue;
            var cheapest = rivals.MinBy(r => r.s.Price);
            if (cheapest.s.Price >= myPrice * 0.9m) continue;
            var shareNow = _index.RealisedShare(city, product, _player.Value, _now, _now) ?? 0;
            var shareBefore = _index.RealisedShare(city, product, _player.Value, _now - 1, _now - 1) ?? 0;
            if (shareBefore - shareNow < 0.05) continue;
            var cityDef = _world.Catalog.City(new CityId(city));
            var productDef = _world.Catalog.Product(new ProductId(product));
            var demand = MarketModel.PotentialDemand(cityDef, productDef);
            var unitCost = UnitCost(mine, city, product);
            var match = Math.Max(Math.Round(cheapest.s.Price * 0.99m, 2, MidpointRounding.ToEven), 0.01m);
            var slot = myPrices.MinBy(s => s.Price)!;
            var building = mine.First(b => b.City.Value == city && b.RetailSlots.Contains(slot));
            add(Item("rivalUndercut", "warning",
                $"{CompanyName(cheapest.b.Owner)} undercuts your {productDef.Name} in {cityDef.Name} and your share is falling.",
                P(("companyId", Text.Int(cheapest.b.Owner.Value)), ("cityId", city), ("productId", product),
                    ("rivalPrice", Text.Dec(cheapest.s.Price)), ("yourPrice", Text.Dec(myPrice))),
                buildingIds: new[] { building.Id.Value }, cityId: city, productId: product,
                impact: (decimal)((shareBefore - shareNow) * demand) * Math.Max(0m, myPrice - unitCost),
                fix: Fix("setRetailPrice", new SetRetailPriceArgs(building.Id.Value, slot.Index, match), $"Match at {Text.Money(match)}")));
        }
    }

    private void PatentLeverageHints(Action<AdvisorItemDto> add)
    {
        var licenses = _world.GetPatentLicenses();
        foreach (var patent in _world.GetActivePatents().Where(p => p.Holder == _player))
        {
            if (licenses.Any(l => l.Holder == _player && l.Product == patent.Product)) continue;
            var blockedRivals = _world.Buildings.Values
                .Where(b => b.Owner != _player && b.ResearchSlots.Any(s => s.Product == patent.Product))
                .Select(b => b.Owner).Distinct().ToList();
            if (blockedRivals.Count == 0) continue;
            var best = blockedRivals
                .Select(c => (Company: c, Sales: (_index.Product(c.Value, patent.Product.Value, _now)?.Sales ?? 0m)
                    + (_index.Product(c.Value, patent.Product.Value, _now)?.Exports ?? 0m)))
                .OrderByDescending(x => x.Sales).ThenBy(x => x.Company.Value).First();
            add(Item("patentLeverage", "info",
                $"Rivals are blocked by your {ProductName(patent.Product.Value)} patent — licensing it earns royalties.",
                P(("productId", patent.Product.Value), ("licenseeId", Text.Int(best.Company.Value))),
                productId: patent.Product.Value, impact: best.Sales * EngineConstants.PatentRoyaltyRate,
                fix: Fix("grantLicense", new LicenseArgs(best.Company.Value, patent.Product.Value), $"License to {CompanyName(best.Company)}")));
        }
    }

    private void TechGapHints(List<BuildingInstance> mine, Action<AdvisorItemDto> add)
    {
        var contested = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var b in mine)
        {
            foreach (var s in b.RetailSlots)
            {
                var rivalHere = _world.Buildings.Values.Any(r => r.Owner != _player && r.City == b.City && r.RetailSlots.Any(x => x.Product == s.Product));
                if (rivalHere) contested.Add(s.Product.Value);
            }
        }
        foreach (var product in contested)
        {
            var id = new ProductId(product);
            var myTech = _world.GetTech(_player, id);
            var leader = _world.Companies.Keys.Where(c => c != _player).Select(c => (Company: c, Tech: _world.GetTech(c, id)))
                .OrderByDescending(x => x.Tech).ThenBy(x => x.Company.Value).FirstOrDefault();
            if (leader.Tech < myTech + 2) continue;
            var revenue = _index.Product(_player.Value, product, _now)?.Sales ?? 0m;
            add(Item("techGap", "info",
                $"{CompanyName(leader.Company)} is {leader.Tech - myTech} technology levels ahead on {ProductName(product)}.",
                P(("productId", product), ("companyId", Text.Int(leader.Company.Value)), ("yourTech", Text.Int(myTech)), ("rivalTech", Text.Int(leader.Tech))),
                productId: product, impact: revenue * 0.1m));
        }
    }

    private void OpportunityHint(List<BuildingInstance> mine, Action<AdvisorItemDto> add)
    {
        var served = new HashSet<(string, string)>();
        foreach (var b in mine)
        {
            foreach (var s in b.RetailSlots) served.Add((b.City.Value, s.Product.Value));
        }
        (string City, string Product, decimal Gross)? best = null;
        foreach (var city in _world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            foreach (var product in _rules.OrderedProducts.Where(p => p.Tier == ProductTier.Finished))
            {
                if (served.Contains((city.Id.Value, product.Id.Value))) continue;
                var rivals = _world.Buildings.Values.Count(b => b.City == city.Id && b.RetailSlots.Any(s => s.Product == product.Id));
                var units = MarketModel.PotentialDemand(city, product) / (1 + rivals);
                var gross = (decimal)units * _world.GetEffectiveWorldPrice(product.Id) * 0.2m;
                if (best is null || gross > best.Value.Gross) best = (city.Id.Value, product.Id.Value, gross);
            }
        }
        if (best is not { } top) return;
        var impact = Math.Round(top.Gross * 0.3m, 2);
        if (impact < 10_000m) return;
        add(Item("unservedOpportunity", "info",
            $"Nobody serves {ProductName(top.Product)} well in {CityName(new CityId(top.City))} — a store there could earn about {Text.Money(impact)} a month.",
            P(("cityId", top.City), ("productId", top.Product)), cityId: top.City, productId: top.Product, impact: impact));
    }

    // ------------------------------------------------------------------ helpers

    private decimal UnitCost(List<BuildingInstance> mine, string city, string product)
    {
        decimal cost = 0m;
        double qty = 0;
        foreach (var b in mine.Where(b => b.City.Value == city))
        {
            var id = new ProductId(product);
            qty += b.Inventory.Get(id);
            cost += b.Inventory.CostOf(id);
        }
        return qty > 0 ? cost / (decimal)qty : _world.GetEffectiveWorldPrice(new ProductId(product));
    }

    private bool HasRetailPresence(ProductId product, CityId city)
        => _world.Buildings.Values.Any(b => b.Owner == _player && b.City == city && b.RetailSlots.Any(s => s.Product == product));

    private string ProductName(string id) => _world.Catalog.Products.TryGetValue(new ProductId(id), out var p) ? p.Name : id;

    private string CityName(CityId id) => _world.Catalog.Cities.TryGetValue(id, out var c) ? c.Name : id.Value;

    private string CompanyName(CompanyId id) => _world.Companies.TryGetValue(id, out var c) ? c.Name : "A rival";

    public static string ChannelId(AdChannel channel) => channel switch
    {
        AdChannel.TV => "tv",
        AdChannel.Newspaper => "newspaper",
        AdChannel.Magazine => "magazine",
        _ => "radio",
    };

    private static int SeverityRank(string severity) => severity switch
    {
        "danger" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    };

    private static Dictionary<string, string> P(params (string Key, string Value)[] pairs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (k, v) in pairs) map[k] = v;
        return map;
    }

    private static AdvisorItemDto Item(
        string code,
        string severity,
        string message,
        Dictionary<string, string> parameters,
        IReadOnlyList<int>? buildingIds = null,
        string? cityId = null,
        string? productId = null,
        decimal? impact = null,
        AdvisorFixDto? fix = null)
        => new(code, severity, message, parameters, buildingIds, cityId, productId,
            impact is decimal i ? Math.Round(Math.Max(0m, i), 2, MidpointRounding.ToEven) : null, fix);

    private static AdvisorFixDto Fix<T>(string method, T args, string label)
        => new(method, JsonSerializer.Serialize(args, BridgeJson.Options), label);
}
