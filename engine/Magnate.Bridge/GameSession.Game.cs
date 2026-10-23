using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Core game flow: scenario library, new game, the HUD snapshot, companies and
// the month advance. Static content lives in GameSession.Catalog.cs; other
// feature areas live in their own GameSession.<Area>.cs files.
public sealed partial class GameSession
{
    /// <summary>Scenario library for the scenario-select screen (tutorial, sandbox, then by difficulty).</summary>
    [BridgeMethod("listScenarios", RequiresGame = false)]
    public IReadOnlyList<ScenarioSummaryDto> ListScenarios()
    {
        _ = Catalog;
        return _scenarios.Values
            .Select(ToSummary)
            .OrderBy(s => s.SortKey)
            .ThenBy(s => s.Name, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Start a new game from a scenario (or a custom definition). Replaces any game
    /// in progress; the facade's history, feed, goals and placements start fresh.
    /// </summary>
    [BridgeMethod("newGame", Mutates = true, RequiresGame = false)]
    public SnapshotDto NewGame(NewGameArgs args)
    {
        var catalog = Catalog;
        var scenarioId = Guard.Required(args.ScenarioId, "scenarioId");
        Scenario scenario;
        CustomGameDto? custom = null;
        if (scenarioId == "custom")
        {
            custom = Guard.Required(args.Custom, "custom");
            scenario = BuildCustomScenario(custom);
        }
        else if (!_scenarios.TryGetValue(scenarioId, out scenario!))
        {
            throw Guard.NotFound(EntityKinds.Scenario, scenarioId, "scenarioId", $"Unknown scenario '{scenarioId}'.");
        }

        if (args.CompanyName is { } name)
        {
            var trimmed = name.Trim();
            if (trimmed.Length is 0 or > 40)
            {
                throw new BridgeException(BridgeErrorCodes.InvalidArgument, "The company name must be 1–40 characters.", "companyName");
            }
            scenario = scenario with { Player = scenario.Player with { Name = trimmed } };
        }

        string? autopilot = null;
        if (args.Autopilot is { } requested)
        {
            autopilot = Strategies.Normalize(requested)
                ?? throw Guard.NotFound(EntityKinds.Strategy, requested, "autopilot", $"Unknown AI strategy '{requested}'.");
        }
        foreach (var ai in scenario.AiCompetitors)
        {
            if (Strategies.Normalize(ai.Strategy) is null)
            {
                throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown AI strategy '{ai.Strategy}'.", "custom.competitors");
            }
        }

        var seed = args.Seed ?? 1;
        // Difficulty sets the strength of the permanent local competition (E1 incumbents, master
        // plan D6): easy 0.6, normal 1.0, hard 1.4. Custom games compute as "normal".
        var rules = NewGameRules ?? EconomyRules.Realistic;
        if (rules.Market.Enabled)
        {
            var strength = Difficulty.IncumbentStrength(custom is not null ? "normal" : Difficulty.Bucket(Difficulty.Compute(scenario)));
            rules = rules with { Market = rules.Market with { IncumbentStrength = strength } };
        }
        var (world, playerId) = ScenarioRunner.Apply(catalog, scenario, seed, rules);
        if (autopilot is not null) world.RegisterAi(playerId, AiStrategies.Create(autopilot));

        var start = scenario.StartDate.AsMonthIndex();
        var game = new ActiveGame(world, playerId, scenario, start, seed, NewGameId(seed, scenario.Id, args.CreatedAtIso, start), Rules)
        {
            Custom = custom,
            CreatedAtIso = args.CreatedAtIso,
        };

        MarkDirty();
        InstallGame(game, freshStart: true);
        return BuildSnapshot();
    }

    /// <summary>Compact HUD-level state; cheap enough to fetch after every tick.</summary>
    [BridgeMethod("snapshot")]
    public SnapshotDto Snapshot() => BuildSnapshot();

    /// <summary>Every company's headline numbers, richest (by corporate value) first.</summary>
    [BridgeMethod("companies")]
    public IReadOnlyList<CompanySummaryDto> Companies()
    {
        var game = Game;
        var financials = Financials.Compute(game.World, game.Index, game.Now, game.StartMonth);
        return game.World.Companies.Values
            .Select(c => SummarizeCompany(game, c, financials[c.Id.Value]))
            .OrderByDescending(c => c.CorporateValue)
            .ThenBy(c => c.Id)
            .ToList();
    }

    /// <summary>
    /// Advance the simulation by whole months (1..24). Per month: capture, tick,
    /// fold the ledger, append history, refresh goals and outcome, detect events,
    /// and stop early when an event kind in <c>stopOn</c> fires. Revision bumps once.
    /// </summary>
    [BridgeMethod("advance", Mutates = true)]
    public TickResultDto Advance(AdvanceArgs args)
    {
        var game = Game;
        var world = game.World;
        var months = Math.Clamp(args.Months, 1, 24);
        var stopOn = args.StopOn is { Count: > 0 } ? new HashSet<string>(args.StopOn, StringComparer.Ordinal) : null;
        if (args.ViewCityId is { } viewCity) Guard.City(Catalog, viewCity, "viewCityId");

        var events = new List<GameEventDto>();
        var summaries = new List<MonthCloseDto>(months);
        double engineMs = 0;
        string? stoppedBy = null;
        var advanced = 0;
        Dictionary<int, CompanyFinancials>? lastFinancials = null;
        var phases = new PhaseTimer();

        for (var i = 0; i < months; i++)
        {
            phases.Start();
            var before = game.Detector.Before(world, game.Player);
            var cashStart = world.Companies[game.Player].Cash;
            phases.Lap("capture");

            MarkDirty();
            var tickStarted = Stopwatch.GetTimestamp();
            try
            {
                world.AdvanceMonth();
            }
            catch (Exception ex)
            {
                game.Faulted = true;
                engineMs += ElapsedMs(tickStarted);
                game.LastTickMs = engineMs;
                throw new BridgeException(BridgeErrorCodes.TickFailed,
                    "The simulation hit an internal error while advancing the month. Load your latest save.",
                    null, new ErrorDetailsDto(DevMessage: $"{ex.GetType().Name}: {ex.Message}"));
            }
            engineMs += ElapsedMs(tickStarted);
            advanced++;
            phases.Start();

            var now = game.Now;
            CatchUpIndex(game);
            phases.Lap("index");
            game.Placement.EnsureAll(world);
            game.CaptureOnHand();
            game.MonthsSinceAutosave++;
            phases.Lap("placement");
            var financials = Financials.Compute(world, game.Index, now, game.StartMonth);
            lastFinancials = financials;
            game.History.Append(world, financials, now);
            phases.Lap("history");

            var player = world.Companies[game.Player];
            var runway = Runway(game, player.Cash);
            var monthEvents = game.Detector.AfterTick(world, game.Player, game.Index, before, now, game.StartMonth, game.LowCashThreshold, runway, game.Utilization);
            monthEvents.AddRange(game.Placement.DrainEvents(game.Player));
            phases.Lap("events");
            monthEvents.AddRange(game.Goals.Refresh(world, game.Index, game.Player, game.StartMonth, silent: false));
            var wasPlaying = game.Goals.Status == Outcomes.Playing;
            if (game.Goals.CloseMonth(now, player.Cash) is { } outcome) monthEvents.Add(outcome);
            if (player.Cash < 0m && game.Goals.Status == Outcomes.Playing && game.Goals.BankruptcyInMonths is int left)
            {
                monthEvents.Add(new GameEventDto(EventKinds.BankruptcyWarning, EventKinds.Danger,
                    left == 1 ? "Insolvent: one month left to get cash positive." : $"Insolvent: {left} months left to get cash positive.",
                    Months: left, Amount: player.Cash, Priority: 3));
            }
            var month = game.Index.Company(game.Player.Value, now);
            var netIncome = month?.NetIncome ?? 0m;
            monthEvents.Add(new GameEventDto(EventKinds.MonthClosed, netIncome >= 0m ? EventKinds.Success : EventKinds.Warning,
                $"{Months.Label(now)}: revenue {Money(month?.Revenue ?? 0m)}, net income {Money(netIncome)}",
                Amount: netIncome, Priority: 0));

            var stamp = Months.Dto(now);
            foreach (var e in monthEvents) events.Add(game.Feed.Publish(e, stamp));
            phases.Lap("goals");

            summaries.Add(new MonthCloseDto(
                stamp,
                month?.Revenue ?? 0m,
                month?.Cogs ?? 0m,
                month?.Opex ?? 0m,
                netIncome,
                cashStart,
                player.Cash,
                month?.RetailQty ?? 0,
                month?.ExportQty ?? 0));

            if (stopOn is not null && monthEvents.FirstOrDefault(e => stopOn.Contains(e.Kind)) is { } hit)
            {
                stoppedBy = hit.Kind;
                break;
            }
            if (wasPlaying && game.Goals.Status != Outcomes.Playing)
            {
                // A decided scenario always ends a multi-month batch so the debrief shows promptly.
                stoppedBy = game.Goals.Status == Outcomes.Won ? EventKinds.ScenarioWon : EventKinds.ScenarioLost;
                break;
            }
        }

        game.LastTickMs = engineMs;
        var bridgeStarted = Stopwatch.GetTimestamp();
        phases.Start();
        // Nothing has changed since the last month's history row, so its financials serve the HUD.
        var snapshot = BuildSnapshot(lastFinancials);
        phases.Lap("snapshot");
        var activity = PlayerActivity(game);
        CityViewDto? view = args.ViewCityId is { } cityId ? BuildCityView(game, cityId, args.ViewSince) : null;
        var autosaveDue = game.AutosaveEveryMonths > 0 && game.MonthsSinceAutosave >= game.AutosaveEveryMonths;
        phases.Lap("activity");
        var bridgeMs = ElapsedMs(bridgeStarted);
        game.LastAdvancePhasesMs = phases.Totals();

        return new TickResultDto(advanced, events, snapshot, summaries, activity, view, stoppedBy, autosaveDue,
            Math.Round(engineMs, 3), Math.Round(bridgeMs, 3));
    }

    // ------------------------------------------------------------------ snapshot

    /// <summary>
    /// The HUD (bridge-spec §5.3): O(companies + buildings + goals), no ledger scans.
    /// <paramref name="financials"/> may pass this revision's already computed figures.
    /// </summary>
    internal SnapshotDto BuildSnapshot(Dictionary<int, CompanyFinancials>? financials = null)
    {
        var game = Game;
        var world = game.World;
        var now = game.Now;
        financials ??= Financials.Compute(world, game.Index, now, game.StartMonth);
        var companies = world.Companies.Values
            .OrderBy(c => c.Id.Value)
            .Select(c => SummarizeCompany(game, c, financials[c.Id.Value]))
            .ToList();

        var player = world.Companies[game.Player];
        var pf = financials[game.Player.Value];
        var mine = world.Buildings.Values.Where(b => b.Owner == game.Player).ToList();
        var idle = mine.Count(b => game.Rules.KindOf(b) != SlotKinds.None && SlotRules.ConfiguredCount(b) == 0);
        var campaigns = world.AdCampaigns.Count(c => c.Company == game.Player && c.MonthlyBudget > 0m);
        var hud = new PlayerHudDto(
            CompanyId: game.Player.Value,
            Name: player.Name,
            Cash: player.Cash,
            CashFlowThisMonth: game.Index.Company(game.Player.Value, now)?.Net ?? 0m,
            RevenueThisMonth: pf.RevenueThisMonth,
            NetIncomeThisMonth: pf.NetIncomeThisMonth,
            NetIncomeLast12: pf.NetIncomeLast12,
            TotalAssets: pf.TotalAssets,
            Equity: pf.Equity,
            CorporateValue: pf.CorporateValue,
            Buildings: mine.Count,
            IdleBuildings: idle,
            ActiveCampaigns: campaigns,
            CashRunwayMonths: Runway(game, player.Cash),
            CreditRating: pf.CreditRating);

        ActiveScenarioDto? scenario = null;
        if (game.Scenario is { } s)
        {
            int? remaining = s.EndDate is { } end ? Math.Max(0, end.AsMonthIndex() - now) : null;
            scenario = new ActiveScenarioDto(s.Id, s.Name, s.EndDate is { } e ? Months.Dto(e) : null,
                game.Goals.ToDtos(), remaining, game.Goals.AchievedCount, game.Goals.NextGoalId);
        }

        var negative = game.Goals.NegativeCashMonths;
        var alerts = new AlertsDto(
            LowCash: player.Cash < game.LowCashThreshold,
            NegativeCashMonths: negative,
            BankruptcyInMonths: game.Goals.Status == Outcomes.Playing ? game.Goals.BankruptcyInMonths : null,
            BankruptcyGraceMonths: game.Goals.GraceMonths);

        return new SnapshotDto(
            Date: Months.Dto(now),
            MonthIndex: now,
            PlayerId: game.Player.Value,
            Companies: companies,
            Scenario: scenario,
            Revision: Revision,
            GameId: game.GameId,
            StartDate: Months.Dto(game.StartMonth),
            ElapsedMonths: Math.Max(0, now - game.StartMonth),
            Player: hud,
            Outcome: game.Goals.Outcome,
            Alerts: alerts,
            NewsSeq: world.NewsLog.Count - 1,
            FeedSeq: game.Feed.LatestSeq,
            Autopilot: game.Autopilot,
            Faulted: game.Faulted);
    }

    private static CompanySummaryDto SummarizeCompany(ActiveGame game, Company company, CompanyFinancials f)
    {
        var id = company.Id.Value;
        var isPlayer = company.Id == game.Player;
        return new CompanySummaryDto(
            Id: id,
            Name: company.Name,
            IsPlayer: isPlayer,
            Cash: company.Cash,
            TotalAssets: f.TotalAssets,
            Equity: f.Equity,
            RevenueThisMonth: f.RevenueThisMonth,
            NetIncomeThisMonth: f.NetIncomeThisMonth,
            BuildingCount: f.Buildings,
            Color: game.Color(id),
            CorporateValue: f.CorporateValue,
            NetIncomeLast12: f.NetIncomeLast12,
            ColorIndex: game.ColorIndex(id),
            AiStrategy: game.StrategyOf(id));
    }

    /// <summary>
    /// Months of cash left at the average operating burn of the last three closed
    /// tick months (the start month has no tick); null when not burning cash.
    /// </summary>
    internal static double? Runway(ActiveGame game, decimal cash)
    {
        var now = game.Now;
        var from = Math.Max(game.StartMonth + 1, now - 2);
        if (from > now) return null;
        decimal sum = 0m;
        var n = 0;
        for (var m = from; m <= now; m++)
        {
            sum += game.Index.Company(game.Player.Value, m)?.OperatingCashFlow ?? 0m;
            n++;
        }
        var average = sum / n;
        if (average >= 0m) return null;
        if (cash <= 0m) return 0;
        return Math.Round((double)(cash / -average), 2);
    }

    private static List<BuildingActivityDto> PlayerActivity(ActiveGame game)
    {
        var now = game.Now;
        var list = new List<BuildingActivityDto>();
        foreach (var b in game.World.Buildings.Values.Where(b => b.Owner == game.Player).OrderBy(b => b.Id.Value))
        {
            if (game.Index.Building(b.Id.Value, now) is not { } bm) continue;
            if (bm.Revenue == 0m && bm.Cogs == 0m && bm.Opex == 0m) continue;
            list.Add(new BuildingActivityDto(b.Id.Value, b.City.Value, bm.Revenue, bm.RetailQty, bm.ExportQty, bm.NetIncome));
        }
        return list;
    }

    /// <summary>Accumulates wall time per named phase of an advance (dev overlay, perf work).</summary>
    private sealed class PhaseTimer
    {
        private readonly Dictionary<string, double> _totals = new(StringComparer.Ordinal);
        private long _mark;

        public void Start() => _mark = Stopwatch.GetTimestamp();

        public void Lap(string phase)
        {
            var now = Stopwatch.GetTimestamp();
            _totals[phase] = _totals.GetValueOrDefault(phase) + (now - _mark) * 1000.0 / Stopwatch.Frequency;
            _mark = now;
        }

        public IReadOnlyDictionary<string, double> Totals()
            => _totals.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value, 3), StringComparer.Ordinal);
    }

    private Scenario BuildCustomScenario(CustomGameDto custom)
    {
        var start = Guard.Date(custom.StartDate, "custom.startDate");
        GameDate? end = custom.EndDate is null ? null : Guard.Date(custom.EndDate, "custom.endDate");
        if (end is { } e && e <= start)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidPeriod, "The end date must be after the start date.", "custom.endDate");
        }
        var cash = Guard.PositiveMoney(custom.PlayerCash, 1_000_000_000_000m, "custom.playerCash");
        var competitors = new List<ScenarioCompany>();
        foreach (var (c, i) in (custom.Competitors ?? Array.Empty<ScenarioCompetitorDto>()).Select((c, i) => (c, i)))
        {
            var field = "custom.competitors[" + i.ToString(CultureInfo.InvariantCulture) + "]";
            var strategy = Strategies.Normalize(c.Strategy)
                ?? throw Guard.NotFound(EntityKinds.Strategy, c.Strategy ?? "", field + ".strategy", $"Unknown AI strategy '{c.Strategy}'.");
            var name = Guard.Required(c.Name, field + ".name").Trim();
            competitors.Add(new ScenarioCompany(name, Guard.PositiveMoney(c.StartingCash, 1_000_000_000_000m, field + ".startingCash"), strategy));
        }
        if (competitors.Count > 7)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, "A custom game supports at most seven rivals.", "custom.competitors");
        }
        return new Scenario("custom", "Custom Game", "", start, end, new ScenarioPlayer("Your Corp", cash), competitors, Array.Empty<Goal>());
    }

    private ScenarioSummaryDto ToSummary(Scenario s)
    {
        var tracker = new GoalTracker(s);
        var difficulty = Difficulty.Compute(s);
        int? duration = s.EndDate is { } end ? end.AsMonthIndex() - s.StartDate.AsMonthIndex() + 1 : null;
        var isTutorial = s.Id == "tutorial";
        var isSandbox = s.Goals.Count == 0;
        var sortKey = isTutorial ? 0 : isSandbox ? 100 : 200 + difficulty * 10;
        return new ScenarioSummaryDto(
            s.Id,
            s.Name,
            s.Description,
            Months.Dto(s.StartDate),
            s.EndDate is { } e ? Months.Dto(e) : null,
            s.Player.Name,
            s.Player.StartingCash,
            s.AiCompetitors.Select(a => new ScenarioCompetitorDto(a.Name, a.StartingCash, Strategies.Normalize(a.Strategy) ?? a.Strategy)).ToList(),
            s.Goals.Select(g => g.Description).ToList(),
            difficulty,
            Difficulty.Bucket(difficulty),
            duration,
            isSandbox,
            tracker.Definitions.Select(d => d.ToDto()).ToList(),
            sortKey,
            Briefing(s, duration));
    }

    /// <summary>A plain-words briefing paragraph: who you face, what you must do, by when, how you lose.</summary>
    private static string Briefing(Scenario s, int? duration)
    {
        var rivals = s.AiCompetitors.Count switch
        {
            0 => "You have the market to yourself.",
            1 => $"One rival, {s.AiCompetitors[0].Name}, starts with {Money(s.AiCompetitors[0].StartingCash)}.",
            var n => $"{n} rivals start with {Money(s.AiCompetitors.Sum(a => a.StartingCash))} between them.",
        };
        var goals = s.Goals.Count == 0 ? "There are no victory conditions." : $"Achieve {s.Goals.Count} goal{(s.Goals.Count == 1 ? "" : "s")}; each counts once reached.";
        var deadline = s.EndDate is { } end
            ? $"You have until {Months.Label(end.AsMonthIndex())} ({duration} months)."
            : "There is no deadline.";
        return $"You start with {Money(s.Player.StartingCash)}. {rivals} {goals} {deadline} " +
               $"If your cash stays negative for more than {GoalTracker.DefaultBankruptcyGraceMonths} months after it first dips below zero, you go bankrupt.";
    }
}
