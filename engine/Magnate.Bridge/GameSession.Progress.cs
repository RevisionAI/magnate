using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Progress and feedback (bridge-spec §5.10–§5.11): goals and outcome, advisor,
// metric history, the stats dashboard, news, the persisted activity feed,
// session settings and the player's autopilot.
public sealed partial class GameSession
{
    /// <summary>Goals with full text, the outcome, the deadline and the next goal to work on.</summary>
    [BridgeMethod("goals")]
    public GoalsDto Goals()
    {
        var game = Game;
        var end = game.Scenario?.EndDate;
        return new GoalsDto(
            game.Goals.ToDtos(),
            game.Goals.Outcome,
            end is { } e ? Months.Dto(e) : null,
            end is { } d ? Math.Max(0, d.AsMonthIndex() - game.Now) : null,
            game.Goals.NextGoalId);
    }

    /// <summary>The advisor: the next step for this company plus ranked hints with $/month impact and one-click fixes.</summary>
    [BridgeMethod("advisor")]
    public AdvisorDto GetAdvisor()
    {
        var game = Game;
        var cash = game.World.Companies[game.Player].Cash;
        return new Advisor(game.World, game.Player, game.Index, game.Rules, game.Now, game.StartMonth, Runway(game, cash),
            game.Goals.Status == Outcomes.Playing ? game.Goals.BankruptcyInMonths : null).Build();
    }

    /// <summary>Dense monthly metric series for one or more companies (rivals allowed).</summary>
    [BridgeMethod("history")]
    public HistoryDto History(HistoryArgs args)
    {
        var game = Game;
        var series = args.Series is { Count: > 0 } s ? s : MetricsHistory.SeriesNames;
        foreach (var name in series)
        {
            if (!MetricsHistory.IsSeries(name))
            {
                throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown history series '{name}'.", "series");
            }
        }
        var companies = args.CompanyIds is { Count: > 0 } ids ? ids : new[] { game.Player.Value };
        foreach (var id in companies) Guard.Company(game.World, id, "companyIds");
        var from = args.From is null ? game.StartMonth : Months.Index(Guard.Date(args.From, "from"));
        var to = args.To is null ? game.Now : Months.Index(Guard.Date(args.To, "to"));
        from = Math.Clamp(from, Math.Min(game.StartMonth, game.Index.EarliestMonth), game.Now);
        to = Math.Clamp(to, from, game.Now);
        return new HistoryDto(Months.Dto(from), to - from + 1,
            companies.Select(id => game.History.Query(id, series, from, to)).ToList());
    }

    /// <summary>The statistics dashboard: value, share heatmap, R&amp;D and brand boards, top buildings.</summary>
    [BridgeMethod("statsDashboard")]
    public StatsDashboardDto StatsDashboard()
    {
        var game = Game;
        var world = game.World;
        var now = game.Now;
        var f = Financials.Compute(world, game.Index, now, game.StartMonth)[game.Player.Value];
        var mine = world.Buildings.Values.Where(b => b.Owner == game.Player).ToList();

        var retailed = mine.SelectMany(b => b.RetailSlots.Select(s => s.Product.Value))
            .Where(p => world.Catalog.Product(new ProductId(p)).Tier == ProductTier.Finished)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();
        var cities = world.Catalog.Cities.Values.OrderByDescending(c => c.Population).ThenBy(c => c.Id.Value, StringComparer.Ordinal)
            .Select(c => c.Id.Value).ToList();
        var heat = cities.Select(city => (IReadOnlyList<double?>)retailed
                .Select(p => game.Index.RealisedShare(city, p, game.Player.Value, now, now))
                .ToList())
            .ToList();

        var slotted = mine.SelectMany(SlotRules.Slots).Select(s => s.Product).Distinct().OrderBy(p => p.Value, StringComparer.Ordinal).ToList();
        var rd = slotted.Select(p => new TechBoardDto(
                p.Value,
                world.Catalog.Product(p).MaxTechLevel,
                world.Companies.Keys.OrderBy(c => c.Value).Select(c => new CompanyValueDto(c.Value, world.GetTech(c, p))).ToList()))
            .ToList();

        var brands = retailed.Select(p => new BrandBoardDto(
                p,
                world.Companies.Keys
                    .SelectMany(c => world.Catalog.Cities.Keys.Select(city => new BrandRowDto(c.Value, city.Value, world.GetBrandAwareness(c, new ProductId(p), city))))
                    .Where(r => r.Brand > 0)
                    .OrderByDescending(r => r.Brand)
                    .ThenBy(r => r.CompanyId)
                    .ThenBy(r => r.CityId, StringComparer.Ordinal)
                    .Take(5)
                    .ToList()))
            .ToList();

        var months = mine.Select(b => (Building: b, Month: game.Index.Building(b.Id.Value, now))).ToList();
        var topRevenue = months.Where(x => x.Month is { Revenue: > 0m })
            .OrderByDescending(x => x.Month!.Revenue).ThenBy(x => x.Building.Id.Value).Take(5)
            .Select(x => new BuildingMoneyDto(x.Building.Id.Value, x.Building.TypeId.Value, x.Building.City.Value, x.Month!.Revenue)).ToList();
        var topOpex = months.Where(x => x.Month is { Opex: > 0m })
            .OrderByDescending(x => x.Month!.Opex).ThenBy(x => x.Building.Id.Value).Take(5)
            .Select(x => new BuildingMoneyDto(x.Building.Id.Value, x.Building.TypeId.Value, x.Building.City.Value, x.Month!.Opex)).ToList();

        var seriesFrom = game.StartMonth;
        var cv = game.History.Query(game.Player.Value, new[] { "corporateValue" }, seriesFrom, now).Series["corporateValue"]
            .Select(v => v is decimal d ? (double?)(double)d : null)
            .ToList();

        return new StatsDashboardDto(
            f.Cash, f.CorporateValue, f.TotalAssets, f.NetIncomeThisMonth,
            new SeriesDto(Months.Dto(seriesFrom), cv),
            new ShareHeatmapDto(cities, retailed, heat),
            rd, brands, topRevenue, topOpex);
    }

    /// <summary>World news (newest last) with effects joined from the event catalog, plus active price effects.</summary>
    [BridgeMethod("news")]
    public NewsDto News(NewsArgs args)
    {
        var game = Game;
        var world = game.World;
        var limit = Math.Clamp(args.Limit, 1, 500);
        var log = world.NewsLog;
        var first = args.SinceSeq is long since ? (int)Math.Clamp(since + 1, 0, log.Count) : 0;
        first = Math.Max(first, log.Count - limit);
        var entries = new List<NewsEntryDto>();
        for (var i = first; i < log.Count; i++)
        {
            var n = log[i];
            var def = world.Catalog.Events.FirstOrDefault(e => e.Id == n.EventId);
            var effects = def?.Effects.Select(EffectOf).ToList() ?? new List<EffectDto>();
            entries.Add(new NewsEntryDto(i, Months.Dto(n.Date), n.EventId, n.Headline, def?.Description ?? "",
                n.Severity.ToString().ToLowerInvariant(), effects));
        }
        var effectsNow = world.ActivePriceEffects.Select(e =>
        {
            var basePrice = (decimal)world.Catalog.Product(new ProductId(e.ProductId)).BaseWorldMarketPrice;
            return new PriceEffectDto(e.ProductId, e.Multiplier, e.RemainingMonths, basePrice, world.GetEffectiveWorldPrice(new ProductId(e.ProductId)));
        }).ToList();
        return new NewsDto(entries, log.Count - 1, effectsNow);
    }

    /// <summary>The persisted activity feed (events with priority ≥ 1), newest last.</summary>
    [BridgeMethod("activityFeed")]
    public FeedDto ActivityFeed(FeedArgs args) => Game.Feed.Query(args.SinceSeq, args.Limit, args.Kinds, args.Search);

    /// <summary>Session settings.</summary>
    [BridgeMethod("settings")]
    public SettingsDto Settings()
    {
        var game = Game;
        return new SettingsDto(game.LowCashThreshold, game.AutosaveEveryMonths, game.Goals.GraceMonths, game.Feed.Capacity);
    }

    /// <summary>Change session settings (low-cash warning threshold, autosave cadence; 0 disables autosave).</summary>
    [BridgeMethod("updateSettings", Mutates = true)]
    public SettingsDto UpdateSettings(UpdateSettingsArgs args)
    {
        var game = Game;
        if (args.LowCashThreshold is decimal threshold)
        {
            game.LowCashThreshold = Guard.NonNegativeMoney(threshold, 1_000_000_000_000m, "lowCashThreshold");
        }
        if (args.AutosaveEveryMonths is int every)
        {
            if (every < 0 || every > 120)
            {
                throw new BridgeException(BridgeErrorCodes.InvalidArgument, "Autosave cadence must be 0–120 months.", "autosaveEveryMonths",
                    new ErrorDetailsDto(Min: 0, Max: 120));
            }
            game.AutosaveEveryMonths = every;
        }
        return Settings();
    }

    /// <summary>
    /// Hand the player's company to an AI strategy ("spectator" / autopilot), or take
    /// it back with <c>strategy: null</c> (<c>World.UnregisterAi</c>, change request E2).
    /// The engine save carries the registration, so it survives save/load.
    /// </summary>
    [BridgeMethod("setAutopilot", Mutates = true)]
    public SnapshotDto SetAutopilot(AutopilotArgs args)
    {
        var game = Game;
        if (args.Strategy is null)
        {
            if (game.Autopilot is null) return BuildSnapshot();
            MarkDirty();
            game.World.UnregisterAi(game.Player);
            return BuildSnapshot();
        }
        var canonical = Strategies.Normalize(args.Strategy)
            ?? throw Guard.NotFound(EntityKinds.Strategy, args.Strategy, "strategy", $"Unknown AI strategy '{args.Strategy}'.");
        MarkDirty();
        game.World.RegisterAi(game.Player, AiStrategies.Create(canonical));
        return BuildSnapshot();
    }

    private static EffectDto EffectOf(EventEffect effect) => effect switch
    {
        WorldMarketPriceMultiplierEffect p => new EffectDto("priceMultiplier", p.ProductId, null, p.Multiplier, p.DurationMonths, null),
        BrandShiftEffect b => new EffectDto("brandShift", b.ProductId, b.CityId, null, null, b.Delta),
        _ => new EffectDto("headline", null, null, null, null, null),
    };
}
