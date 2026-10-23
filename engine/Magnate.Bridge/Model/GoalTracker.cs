using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>Goal kinds (TS <c>GoalKind</c>).</summary>
internal static class GoalKinds
{
    public const string CorporateValue = "corporateValue";
    public const string MarketShare = "marketShare";
    public const string OwnsBuilding = "ownsBuilding";
    public const string ProductRetailed = "productRetailed";
    public const string AdCampaignActive = "adCampaignActive";
    public const string ElapsedMonths = "elapsedMonths";
    public const string NetIncome = "netIncome";
    public const string TopBrand = "topBrand";
    public const string ExportRevenue = "exportRevenue";
    public const string ConsecutiveProfitable = "consecutiveProfitable";
    public const string TotalAssets = "totalAssets";
    public const string NetWorth = "netWorth";
    public const string CreditRating = "creditRating";
    public const string LoanTaken = "loanTaken";
    public const string Other = "other";
}

/// <summary>Goal modes (TS <c>GoalMode</c>, master plan D11).</summary>
internal static class GoalModes
{
    public const string ReachOnce = "reachOnce";
    public const string HoldAtDeadline = "holdAtDeadline";

    public static string Of(Goal goal) => goal.Mode == GoalMode.HoldAtDeadline ? HoldAtDeadline : ReachOnce;
}

/// <summary>Outcome statuses and reasons (TS <c>OutcomeDto</c>).</summary>
internal static class Outcomes
{
    public const string Playing = "playing";
    public const string Won = "won";
    public const string Lost = "lost";
    public const string AllGoals = "allGoals";
    public const string Bankruptcy = "bankruptcy";
    public const string Insolvency = "insolvency";
    public const string Deadline = "deadline";
}

/// <summary>A goal's static definition (id, kind, metric, target, unit).</summary>
internal sealed record GoalDef(
    string Id,
    int Index,
    string Kind,
    string Metric,
    string Unit,
    string Description,
    decimal Target,
    string? ProductId,
    string? CityId,
    string? Category,
    Goal Goal)
{
    public string Mode => GoalModes.Of(Goal);

    public bool Holds => Goal.Mode == GoalMode.HoldAtDeadline;

    public ScenarioGoalDto ToDto() => new(Id, Index, Kind, Metric, Description, Target, Unit, ProductId, CityId, Category, Mode);
}

/// <summary>One goal evaluated now.</summary>
internal sealed record GoalEval(GoalDef Def, bool Met, decimal Current, double Progress, string Detail);

/// <summary>
/// Goals and scenario outcome (bridge-spec §4.6.5–§4.6.6, MASTER-PLAN D11).
/// <list type="bullet">
///   <item>Goals have stable ids (<c>g0</c>…; scenario-provided ids once content carries them).</item>
///   <item>Goals are evaluated against the <see cref="LedgerIndex"/> with the engine's formulas,
///         so a refresh is O(months) instead of an O(ledger) scan per goal.</item>
///   <item><b>Latching (D11):</b> reach-once goals set <c>achievedAt</c> the first time they are met
///         and never clear it; hold-at-deadline goals are judged live and must be met in the
///         deadline month (or, without a deadline, when everything else has latched). The scenario
///         is <b>won when every reach-once goal has latched and every hold goal is met</b>.</item>
///   <item><b>Market share (D11):</b> realised trailing-3-month unit share (retail units sold by the
///         player ÷ all retail units in the market), not the engine's model share. Incumbent volume
///         joins the denominator once the market workstream exposes it.</item>
///   <item><b>Company value goals</b> read <c>World.GetCorporateValue</c> (D10, metric
///         <c>companyValue</c>); <c>totalAssets</c> goals keep the legacy metric.</item>
///   <item><b>Insolvency (D9, econ-audit §4.14):</b> under the finance rules the engine decides —
///         a default opens the cure window (rules <c>CureMonths</c>), and a liquidated player loses
///         with reason <c>insolvency</c>. Rules without solvency (Classic, legacy saves) keep the
///         interim rule: month-end cash negative for more than <c>bankruptcyGraceMonths</c> closes.</item>
///   <item><b>Finance events:</b> each refresh publishes the engine's new finance events (loans,
///         rating changes, missed payments, distress, bankruptcies) as bridge events.</item>
///   <item><b>Deadline:</b> not won by the close of the end month → lost.</item>
/// </list>
/// </summary>
internal sealed class GoalTracker
{
    /// <summary>Default cure window after the first negative month-end (D9: 3 months).</summary>
    public const int DefaultBankruptcyGraceMonths = 3;

    /// <summary>Months in the realised market-share window (D11).</summary>
    public const int ShareWindowMonths = 3;

    private readonly Scenario? _scenario;
    private readonly Dictionary<string, int> _achievedAt = new(StringComparer.Ordinal);
    private readonly Dictionary<string, bool> _lastMet = new(StringComparer.Ordinal);
    private List<GoalEval> _current = new();
    private int _financeEventCursor;
    private SolvencyStatus? _solvency;

    public GoalTracker(Scenario? scenario)
    {
        _scenario = scenario;
        Definitions = scenario is null
            ? Array.Empty<GoalDef>()
            : scenario.Goals.Select((g, i) => Define(g, i)).ToList();
    }

    public IReadOnlyList<GoalDef> Definitions { get; }

    /// <summary>Latest evaluation (refreshed after every mutation and tick).</summary>
    public IReadOnlyList<GoalEval> Current => _current;

    public string Status { get; private set; } = Outcomes.Playing;

    public string? Reason { get; private set; }

    public int? DecidedAt { get; private set; }

    /// <summary>
    /// Month closes in the insolvency window: months in distress under the finance rules,
    /// consecutive negative month-end cash under the interim rule.
    /// </summary>
    public int NegativeCashMonths { get; private set; }

    /// <summary>The cure window in months (the engine's <c>CureMonths</c> under the finance rules).</summary>
    public int GraceMonths { get; set; } = DefaultBankruptcyGraceMonths;

    /// <summary>The player's solvency as of the last refresh (null before the first or without finance rules).</summary>
    public SolvencyStatus? Solvency => _solvency;

    public int? AchievedAt(string goalId) => _achievedAt.TryGetValue(goalId, out var m) ? m : null;

    public int AchievedCount => Definitions.Count(d => _achievedAt.ContainsKey(d.Id));

    /// <summary>First goal (by index) that has not latched.</summary>
    public string? NextGoalId => Definitions.FirstOrDefault(d => !_achievedAt.ContainsKey(d.Id))?.Id;

    /// <summary>Months until bankruptcy is declared, while the cure window is open.</summary>
    public int? BankruptcyInMonths => _solvency is { } s
        ? s.CureMonthsLeft
        : NegativeCashMonths > 0 ? Math.Max(0, GraceMonths + 1 - NegativeCashMonths) : null;

    public OutcomeDto Outcome => new(Status, Reason, DecidedAt is int m ? Months.Dto(m) : null);

    // ------------------------------------------------------------------ evaluation

    /// <summary>
    /// Re-evaluate every goal, latch newly met ones and report transitions
    /// (<c>goalAchieved</c> / <c>goalLost</c>). <paramref name="silent"/> latches
    /// without events (new game, load).
    /// </summary>
    public List<GameEventDto> Refresh(World world, LedgerIndex index, CompanyId player, int start, bool silent)
    {
        var now = world.Clock.Now.AsMonthIndex();
        var events = new List<GameEventDto>();
        var evals = new List<GoalEval>(Definitions.Count);
        UpdateSolvency(world, player);
        PublishFinanceEvents(world, player, events, silent);
        foreach (var def in Definitions)
        {
            var eval = Evaluate(def, world, index, player, now, start);
            evals.Add(eval);
            var wasMet = _lastMet.TryGetValue(def.Id, out var lm) && lm;
            if (def.Holds)
            {
                _lastMet[def.Id] = eval.Met;
                continue;
            }

            if (eval.Met && !_achievedAt.ContainsKey(def.Id))
            {
                _achievedAt[def.Id] = now;
                if (!silent)
                {
                    events.Add(new GameEventDto(
                        "goalAchieved", "success", def.Description, GoalId: def.Id, Priority: 3,
                        Amount: def.Unit == "usd" ? eval.Current : null));
                }
            }
            else if (!eval.Met && wasMet && _achievedAt.ContainsKey(def.Id) && !silent)
            {
                events.Add(new GameEventDto("goalLost", "warning", def.Description, GoalId: def.Id, Priority: 1));
            }
            _lastMet[def.Id] = eval.Met;
        }
        _current = evals;
        return events;
    }

    /// <summary>
    /// Outcome check after a command: a command can latch the last goal, which wins
    /// immediately. Loss conditions are only decided at month close.
    /// </summary>
    public GameEventDto? CheckWin(int now)
    {
        if (Status != Outcomes.Playing || Definitions.Count == 0) return null;
        if (Definitions.Any(d => !d.Holds && !_achievedAt.ContainsKey(d.Id))) return null;
        if (Definitions.Any(d => d.Holds))
        {
            if (Definitions.Any(d => d.Holds && !(_lastMet.TryGetValue(d.Id, out var met) && met))) return null;
            if (_scenario?.EndDate is { } deadline && now < deadline.AsMonthIndex()) return null;
        }
        Status = Outcomes.Won;
        Reason = Outcomes.AllGoals;
        DecidedAt = now;
        return new GameEventDto("scenarioWon", "success", "Every goal achieved — you win!", Reason: Reason, Priority: 3);
    }

    /// <summary>Month-close outcome rules, in order: win, insolvency, deadline. Fires once.</summary>
    public GameEventDto? CloseMonth(int now, decimal playerCash)
    {
        if (_solvency is { } solvency)
        {
            NegativeCashMonths = solvency.State == SolvencyState.Distress ? solvency.MonthsInDistress + 1 : 0;
        }
        else
        {
            NegativeCashMonths = playerCash < 0m ? NegativeCashMonths + 1 : 0;
        }

        var win = CheckWin(now);
        if (win is not null || Status != Outcomes.Playing) return win;

        if (_solvency is { State: SolvencyState.Bankrupt })
        {
            // The finance workstream's insolvency rule (bridge-spec §8.4, econ-audit §4.14).
            Status = Outcomes.Lost;
            Reason = Outcomes.Insolvency;
            DecidedAt = now;
            return new GameEventDto("scenarioLost", "danger",
                "Bankrupt: the company could not cure its default and its assets were liquidated.", Reason: Reason, Priority: 3);
        }

        if (_solvency is null && NegativeCashMonths > GraceMonths)
        {
            Status = Outcomes.Lost;
            Reason = Outcomes.Bankruptcy;
            DecidedAt = now;
            return new GameEventDto("scenarioLost", "danger",
                "Bankrupt: cash stayed negative through the cure window.", Reason: Reason, Priority: 3);
        }
        if (_scenario?.EndDate is { } end && now >= end.AsMonthIndex())
        {
            Status = Outcomes.Lost;
            Reason = Outcomes.Deadline;
            DecidedAt = now;
            return new GameEventDto("scenarioLost", "danger",
                "Time is up: the scenario deadline passed before every goal was achieved.", Reason: Reason, Priority: 3);
        }
        return null;
    }

    // ------------------------------------------------------------------ DTOs

    public GoalDto ToDto(GoalEval eval) => new(
        Description: eval.Def.Description,
        Achieved: eval.Met,
        Progress: eval.Progress,
        Detail: eval.Detail,
        Id: eval.Def.Id,
        Index: eval.Def.Index,
        Kind: eval.Def.Kind,
        Metric: eval.Def.Metric,
        Current: eval.Current,
        Target: eval.Def.Target,
        Unit: eval.Def.Unit,
        AchievedAt: AchievedAt(eval.Def.Id) is int m ? Months.Dto(m) : null,
        ProductId: eval.Def.ProductId,
        CityId: eval.Def.CityId,
        Category: eval.Def.Category,
        Mode: eval.Def.Mode);

    public IReadOnlyList<GoalDto> ToDtos() => _current.Select(ToDto).ToList();

    // ------------------------------------------------------------------ persistence

    public GoalStateDto Save() => new(
        _achievedAt.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => Months.Dto(kv.Value)),
        new OutcomeDto(Status, Reason, DecidedAt is int m ? Months.Dto(m) : null),
        NegativeCashMonths);

    public void Restore(GoalStateDto? state)
    {
        if (state is null) return;
        _achievedAt.Clear();
        foreach (var (id, date) in state.AchievedAt ?? new Dictionary<string, DateDto>())
        {
            if (Definitions.Any(d => d.Id == id)) _achievedAt[id] = Months.Index(date);
        }
        if (state.Outcome is { } outcome)
        {
            Status = outcome.Status is Outcomes.Won or Outcomes.Lost ? outcome.Status : Outcomes.Playing;
            Reason = Status == Outcomes.Playing ? null : outcome.Reason;
            DecidedAt = Status == Outcomes.Playing || outcome.At is null ? null : Months.Index(outcome.At);
        }
        NegativeCashMonths = Math.Max(0, state.NegativeCashMonths);
    }

    // ------------------------------------------------------------------ goal formulas

    private static GoalDef Define(Goal goal, int index)
    {
        var id = goal.Id ?? "g" + index.ToString(CultureInfo.InvariantCulture);
        return goal switch
        {
            CorporateValueGoal g => new(id, index, GoalKinds.CorporateValue, "companyValue", "usd", g.Description, g.Threshold, null, null, null, goal),
            TotalAssetsGoal g => new(id, index, GoalKinds.TotalAssets, "totalAssets", "usd", g.Description, g.Threshold, null, null, null, goal),
            NetWorthGoal g => new(id, index, GoalKinds.NetWorth, "bookEquity", "usd", g.Description, g.Threshold, null, null, null, goal),
            CreditRatingGoal g => new(id, index, GoalKinds.CreditRating, "ratingNotch", "rating", g.Description, (int)CreditRating.D - (int)g.Target, null, null, null, goal),
            LoanTakenGoal g => new(id, index, GoalKinds.LoanTaken, "loansTaken", "count", g.Description, g.Count, null, null, null, goal),
            MarketShareGoal g => new(id, index, GoalKinds.MarketShare, "realisedShare3m", "ratio", g.Description, (decimal)g.Threshold, g.Product.Value, g.City.Value, null, goal),
            OwnsBuildingOfCategoryGoal g => new(id, index, GoalKinds.OwnsBuilding, GoalKinds.OwnsBuilding, "count", g.Description, g.Count, null, null, g.Category, goal),
            ProductRetailedGoal g => new(id, index, GoalKinds.ProductRetailed, GoalKinds.ProductRetailed, "flag", g.Description, 1m, g.Product.Value, null, null, goal),
            AdCampaignActiveGoal g => new(id, index, GoalKinds.AdCampaignActive, GoalKinds.AdCampaignActive, "flag", g.Description, 1m, g.Product.Value, null, null, goal),
            ElapsedMonthsGoal g => new(id, index, GoalKinds.ElapsedMonths, GoalKinds.ElapsedMonths, "months", g.Description, g.Months, null, null, null, goal),
            NetIncomeSinceStartGoal g => new(id, index, GoalKinds.NetIncome, GoalKinds.NetIncome, "usd", g.Description, g.Amount, null, null, null, goal),
            TopBrandGoal g => new(id, index, GoalKinds.TopBrand, GoalKinds.TopBrand, "points", g.Description, (decimal)g.Threshold, g.Product.Value, g.City.Value, null, goal),
            ExportRevenueGoal g => new(id, index, GoalKinds.ExportRevenue, GoalKinds.ExportRevenue, "usd", g.Description, g.Amount, null, null, null, goal),
            ConsecutiveProfitableMonthsGoal g => new(id, index, GoalKinds.ConsecutiveProfitable, GoalKinds.ConsecutiveProfitable, "months", g.Description, g.Months, null, null, null, goal),
            _ => new(id, index, GoalKinds.Other, GoalKinds.Other, "ratio", goal.Description, 1m, null, null, null, goal),
        };
    }

    private static GoalEval Evaluate(GoalDef def, World world, LedgerIndex index, CompanyId player, int now, int start)
    {
        switch (def.Goal)
        {
            case CorporateValueGoal g:
            {
                var value = world.GetCorporateValue(player);
                return Result(def, value >= g.Threshold, value, Ratio(value, g.Threshold),
                    $"{Text.Money(value)} / {Text.Money(g.Threshold)}");
            }
            case TotalAssetsGoal g:
            {
                var assets = world.GetBalanceSheet(player).TotalAssets;
                return Result(def, assets >= g.Threshold, assets, Ratio(assets, g.Threshold),
                    $"{Text.Money(assets)} / {Text.Money(g.Threshold)}");
            }
            case NetWorthGoal g:
            {
                var equity = world.GetBalanceSheet(player).Equity;
                return Result(def, equity >= g.Threshold, equity, Ratio(equity, g.Threshold),
                    $"{Text.Money(equity)} / {Text.Money(g.Threshold)}");
            }
            case CreditRatingGoal or LoanTakenGoal:
            {
                // Engine formula; current is notches above D (rating) or loans taken.
                var e = def.Goal.Evaluate(world, player);
                decimal current = def.Goal is CreditRatingGoal
                    ? (world.GetCompanyFinance(player)?.Rating is { } r ? (int)CreditRating.D - (int)r : 0)
                    : world.GetCompanyFinance(player)?.LoansTaken ?? 0;
                return Result(def, e.Achieved, current, Math.Clamp(e.Progress, 0, 1), e.Detail);
            }
            case MarketShareGoal g:
            {
                var share = RealisedShare(index, g.City.Value, g.Product.Value, player.Value, now, start);
                return Result(def, share >= g.Threshold, (decimal)share, Ratio(share, g.Threshold),
                    $"{Text.Percent(share)} / {Text.Percent(g.Threshold)}");
            }
            case OwnsBuildingOfCategoryGoal g:
            {
                var count = world.Buildings.Values.Count(b =>
                    b.Owner == player && world.Catalog.BuildingType(b.TypeId).Category == g.Category);
                return Result(def, count >= g.Count, count, Ratio((double)count, g.Count), $"{count} / {g.Count}");
            }
            case ProductRetailedGoal g:
            {
                var has = world.Buildings.Values.Any(b => b.Owner == player && b.RetailSlots.Any(s => s.Product == g.Product));
                return Result(def, has, has ? 1m : 0m, has ? 1 : 0, has ? "configured" : "not yet");
            }
            case AdCampaignActiveGoal g:
            {
                var running = world.AdCampaigns.Any(c => c.Company == player && c.Product == g.Product && c.MonthlyBudget > 0m);
                return Result(def, running, running ? 1m : 0m, running ? 1 : 0, running ? "running" : "not yet");
            }
            case ElapsedMonthsGoal g:
            {
                var elapsed = Math.Max(0, now - g.StartDate.AsMonthIndex());
                return Result(def, elapsed >= g.Months, elapsed, Ratio((double)elapsed, g.Months), $"{elapsed} / {g.Months} months");
            }
            case NetIncomeSinceStartGoal g:
            {
                var from = g.StartDate.AsMonthIndex();
                var net = now < from ? 0m : index.NetIncome(player.Value, from, now);
                return Result(def, net >= g.Amount, net, Ratio(net, g.Amount), $"{Text.Money(net)} / {Text.Money(g.Amount)}");
            }
            case TopBrandGoal g:
            {
                var brand = world.GetBrandAwareness(player, g.Product, g.City);
                return Result(def, brand >= g.Threshold, (decimal)brand, Ratio(brand, g.Threshold),
                    $"{brand.ToString("F1", CultureInfo.InvariantCulture)} / {g.Threshold.ToString("F1", CultureInfo.InvariantCulture)}");
            }
            case ExportRevenueGoal g:
            {
                var from = g.StartDate.AsMonthIndex();
                var total = now < from ? 0m : index.CategorySum(player.Value, LedgerCategory.ExportSale, from, now);
                return Result(def, total >= g.Amount, total, Ratio(total, g.Amount), $"{Text.Money(total)} / {Text.Money(g.Amount)}");
            }
            case ConsecutiveProfitableMonthsGoal g:
            {
                var streak = ProfitStreak(index, player.Value, now, g.Months);
                return Result(def, streak >= g.Months, streak, Ratio((double)streak, g.Months), $"{streak} / {g.Months} months");
            }
            default:
            {
                // A goal type this bridge predates: defer to the engine's own evaluation.
                var e = def.Goal.Evaluate(world, player);
                return Result(def, e.Achieved, (decimal)e.Progress, Math.Clamp(e.Progress, 0, 1), e.Detail);
            }
        }
    }

    /// <summary>D11 market share: player retail units ÷ all retail units over the last three months.</summary>
    public static double RealisedShare(LedgerIndex index, string city, string product, int player, int now, int start)
        => index.RealisedShare(city, product, player, Math.Max(start, now - (ShareWindowMonths - 1)), now) ?? 0.0;

    /// <summary>Run of strictly profitable months ending at <paramref name="now"/>, capped at <paramref name="cap"/>.</summary>
    public static int ProfitStreak(LedgerIndex index, int company, int now, int cap)
    {
        var streak = 0;
        var bound = Math.Max(cap * 4, 1200);
        for (var m = now; streak < bound && streak < Math.Max(cap, 1); m--)
        {
            if (index.NetIncome(company, m) <= 0m) break;
            streak++;
        }
        return streak;
    }

    // ------------------------------------------------------------------ finance (§4.14, bridge-spec §8.4)

    private void UpdateSolvency(World world, CompanyId player)
    {
        if (!world.Rules.Finance.Enabled || !world.Rules.Finance.Solvency)
        {
            _solvency = null;
            return;
        }

        _solvency = world.GetSolvency(player);
        GraceMonths = world.Rules.Finance.CureMonths;
    }

    /// <summary>Publish the engine's finance events since the last refresh (silent: just skip them).</summary>
    private void PublishFinanceEvents(World world, CompanyId player, List<GameEventDto> events, bool silent)
    {
        var log = world.FinanceEvents;
        if (_financeEventCursor > log.Count) _financeEventCursor = 0;
        for (var i = _financeEventCursor; i < log.Count && !silent; i++)
        {
            if (FinanceEventDto(log[i], player) is { } dto) events.Add(dto);
        }
        _financeEventCursor = log.Count;
    }

    /// <summary>Map one engine finance event to a bridge event (null when the client does not need it).</summary>
    internal static GameEventDto? FinanceEventDto(FinanceEvent e, CompanyId player)
    {
        var mine = e.Company == player;
        var company = e.Company.Value;
        switch (e.Kind)
        {
            case FinanceEventKind.LoanTaken when mine:
                return new GameEventDto("loanTaken", "success", e.Message, Amount: e.Amount, CompanyId: company, IsPlayer: true, Priority: 2);
            case FinanceEventKind.LoanRepaid when mine:
                return new GameEventDto("loanRepaid", "info", e.Message, Amount: e.Amount, CompanyId: company, IsPlayer: true, Priority: 1);
            case FinanceEventKind.LoanPaymentMissed when mine:
                return new GameEventDto("loanPaymentMissed", "danger", e.Message, Amount: e.Amount, CompanyId: company, IsPlayer: true, Priority: 3);
            case FinanceEventKind.CreditRatingChanged when mine:
            {
                CreditRatings.TryParse(e.OldRating, out var before);
                CreditRatings.TryParse(e.NewRating, out var after);
                var unratedBefore = e.OldRating is null or "NR";
                var better = unratedBefore || after < before;
                return new GameEventDto("creditRatingChanged", better ? "success" : "warning", e.Message,
                    CompanyId: company, IsPlayer: true, Reason: e.NewRating, Priority: 2,
                    OldValue: unratedBefore ? null : (int)before, NewValue: (int)after);
            }
            case FinanceEventKind.DistressEntered:
                return new GameEventDto("insolvency", "danger", e.Message, Amount: e.Amount, CompanyId: company, IsPlayer: mine,
                    Reason: "default", Priority: mine ? 3 : 1);
            case FinanceEventKind.DistressCured when mine:
                return new GameEventDto("insolvency", "success", e.Message, CompanyId: company, IsPlayer: true, Reason: "cured", Priority: 2);
            case FinanceEventKind.Bankruptcy:
                return new GameEventDto("insolvency", "danger", e.Message, Amount: e.Amount, CompanyId: company, IsPlayer: mine,
                    Reason: "bankrupt", Priority: mine ? 3 : 2);
            case FinanceEventKind.BuildingDisposed when mine:
                return new GameEventDto("buildingDemolished", "info", e.Message, Amount: e.Amount, BuildingId: e.BuildingId,
                    CompanyId: company, IsPlayer: true, Priority: 1);
            default:
                return null;
        }
    }

    private static GoalEval Result(GoalDef def, bool met, decimal current, double progress, string detail)
        => new(def, met, current, progress, detail);

    private static double Ratio(decimal current, decimal target)
        => target <= 0m ? 1.0 : Math.Clamp((double)(current / target), 0.0, 1.0);

    private static double Ratio(double current, double target)
        => target <= 0 ? 1.0 : Math.Clamp(current / target, 0.0, 1.0);
}

/// <summary>Persisted goal state (save sidecar).</summary>
public sealed record GoalStateDto(IReadOnlyDictionary<string, DateDto>? AchievedAt, OutcomeDto? Outcome, int NegativeCashMonths);
