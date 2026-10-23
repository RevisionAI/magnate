using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Scenarios;

/// <summary>
/// The outcome of evaluating a scenario goal at a point in time. <see cref="Progress"/>
/// is a soft [0, 1] metric (ratio of current value to threshold, capped at 1) so UI
/// can show a progress bar even before the goal is achieved.
/// </summary>
public sealed record GoalEvaluation(
    string Description,
    bool Achieved,
    double Progress,
    string Detail);

/// <summary>
/// How a goal counts toward victory (master plan D11).
/// </summary>
public enum GoalMode
{
    /// <summary>Latched the first time it is met; later dips do not un-meet it (the default).</summary>
    ReachOnce,

    /// <summary>Must be met at the scenario deadline (or, without a deadline, at the moment of victory).</summary>
    HoldAtDeadline,
}

/// <summary>A scenario win-condition. Concrete subclasses evaluate a specific metric.</summary>
public abstract record Goal(string Description)
{
    /// <summary>Stable id from the scenario file (bridge-spec E18); null → positional ids.</summary>
    public string? Id { get; init; }

    /// <summary>Victory semantics (D11): latched once reached, or held at the deadline.</summary>
    public GoalMode Mode { get; init; } = GoalMode.ReachOnce;

    /// <summary>Evaluate the goal for <paramref name="player"/> now.</summary>
    public abstract GoalEvaluation Evaluate(World world, CompanyId player);

    /// <summary>Progress ratio clamped to [0, 1] (1 when the target is not positive).</summary>
    protected static double Ratio(decimal current, decimal target)
        => target <= 0m ? 1.0 : Math.Clamp((double)(current / target), 0.0, 1.0);
}

/// <summary>
/// Achieved when the player's company value (<see cref="World.GetCorporateValue"/>, master plan
/// D10: market cap once listed, otherwise the fundamental equity value; total assets under
/// Classic rules) reaches <see cref="Threshold"/>.
/// </summary>
public sealed record CorporateValueGoal(string Description, decimal Threshold) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var value = world.GetCorporateValue(player);
        return new GoalEvaluation(Description, value >= Threshold, Ratio(value, Threshold), $"${value:N0} / ${Threshold:N0}");
    }
}

/// <summary>Achieved when the player's total assets (cash + inventory + PP&amp;E + land + CIP) reach <see cref="Threshold"/> (legacy semantics).</summary>
public sealed record TotalAssetsGoal(string Description, decimal Threshold) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var assets = world.GetBalanceSheet(player).TotalAssets;
        return new GoalEvaluation(Description, assets >= Threshold, Ratio(assets, Threshold), $"${assets:N0} / ${Threshold:N0}");
    }
}

/// <summary>Achieved when the player's book net worth (assets − liabilities) reaches <see cref="Threshold"/>.</summary>
public sealed record NetWorthGoal(string Description, decimal Threshold) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var equity = world.GetBalanceSheet(player).Equity;
        return new GoalEvaluation(Description, equity >= Threshold, Ratio(equity, Threshold), $"${equity:N0} / ${Threshold:N0}");
    }
}

/// <summary>
/// Achieved when the player's reported credit rating is <see cref="Target"/> or better
/// (econ-audit §4.18). Unrated companies (younger than the seasoning period) have not met it.
/// </summary>
public sealed record CreditRatingGoal(string Description, CreditRating Target) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var rating = world.GetCompanyFinance(player)?.Rating;
        var met = rating is { } r && r <= Target;
        // Progress: notches climbed from D toward the target.
        var progress = rating is { } x
            ? Math.Clamp(((double)CreditRating.D - (double)x) / Math.Max(1.0, (double)CreditRating.D - (double)Target), 0.0, 1.0)
            : 0.0;
        var label = rating is { } y ? CreditRatings.Label(y) : "unrated";
        return new GoalEvaluation(Description, met, met ? 1.0 : progress, $"{label} / {CreditRatings.Label(Target)}");
    }
}

/// <summary>Achieved once the player has taken at least <see cref="Count"/> term loans (tutorial).</summary>
public sealed record LoanTakenGoal(string Description, int Count = 1) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var taken = world.GetCompanyFinance(player)?.LoansTaken ?? 0;
        var progress = Count <= 0 ? 1.0 : Math.Min(1.0, taken / (double)Count);
        return new GoalEvaluation(Description, taken >= Count, progress, $"{taken} / {Count}");
    }
}

/// <summary>
/// Achieved when the player's market share of <see cref="Product"/> in <see cref="City"/> meets
/// <see cref="Threshold"/> (0..1). Under the realistic market model it is the realised
/// trailing-3-month unit share (<see cref="World.GetRealisedMarketShare"/>, master plan D11);
/// Classic keeps the softmax model share (<see cref="World.GetMarketShare"/>).
/// </summary>
public sealed record MarketShareGoal(
    string Description,
    ProductId Product,
    CityId City,
    double Threshold) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var share = world.Rules.Market.Enabled
            ? world.GetRealisedMarketShare(player, Product, City)
            : world.GetMarketShare(player, Product, City);
        var achieved = share >= Threshold;
        var progress = Threshold <= 0 ? 1.0 : Math.Min(1.0, share / Threshold);
        return new GoalEvaluation(
            Description,
            achieved,
            progress,
            $"{share * 100:F1}% / {Threshold * 100:F1}%");
    }
}

/// <summary>Achieved when the player owns at least <see cref="Count"/> buildings of <see cref="Category"/>.</summary>
public sealed record OwnsBuildingOfCategoryGoal(
    string Description,
    string Category,
    int Count = 1) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var matching = world.Buildings.Values.Count(b =>
            b.Owner == player && world.Catalog.BuildingType(b.TypeId).Category == Category);
        var achieved = matching >= Count;
        var progress = Count <= 0 ? 1.0 : Math.Min(1.0, matching / (double)Count);
        return new GoalEvaluation(Description, achieved, progress, $"{matching} / {Count}");
    }
}

/// <summary>Achieved when the player has at least one retail slot selling <see cref="Product"/>.</summary>
public sealed record ProductRetailedGoal(string Description, ProductId Product) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var hasSlot = world.Buildings.Values.Any(b =>
            b.Owner == player && b.RetailSlots.Any(s => s.Product == Product));
        return new GoalEvaluation(Description, hasSlot, hasSlot ? 1.0 : 0.0,
            hasSlot ? "configured" : "not yet");
    }
}

/// <summary>
/// Achieved when the player has at least one ad campaign active for <see cref="Product"/> (any city, any channel, budget &gt; 0).
/// </summary>
public sealed record AdCampaignActiveGoal(string Description, ProductId Product) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var running = world.AdCampaigns.Any(c =>
            c.Company == player && c.Product == Product && c.MonthlyBudget > 0m);
        return new GoalEvaluation(Description, running, running ? 1.0 : 0.0,
            running ? "running" : "not yet");
    }
}

/// <summary>
/// Achieved when at least <see cref="Months"/> months have elapsed since <see cref="StartDate"/>.
/// Loader stamps in the scenario's start date so the goal can count elapsed ticks.
/// </summary>
public sealed record ElapsedMonthsGoal(
    string Description,
    GameDate StartDate,
    int Months) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var elapsed = Math.Max(0, world.Clock.Now.AsMonthIndex() - StartDate.AsMonthIndex());
        var achieved = elapsed >= Months;
        var progress = Months <= 0 ? 1.0 : Math.Min(1.0, elapsed / (double)Months);
        return new GoalEvaluation(Description, achieved, progress, $"{elapsed} / {Months} months");
    }
}

/// <summary>
/// Achieved when the player's cumulative <see cref="IncomeStatement.NetIncome"/> from
/// <see cref="StartDate"/> through the current world clock reaches <see cref="Amount"/>.
/// Loader stamps in the scenario's start date.
/// </summary>
public sealed record NetIncomeSinceStartGoal(
    string Description,
    GameDate StartDate,
    decimal Amount) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var now = world.Clock.Now;
        var statement = now < StartDate
            ? new IncomeStatement(StartDate, StartDate, 0m, 0m, 0m)
            : world.GetIncomeStatement(player, StartDate, now);
        var net = statement.NetIncome;
        var achieved = net >= Amount;
        var progress = Amount <= 0m
            ? 1.0
            : Math.Max(0.0, Math.Min(1.0, (double)(net / Amount)));
        return new GoalEvaluation(Description, achieved, progress, $"${net:N0} / ${Amount:N0}");
    }
}

/// <summary>
/// Achieved when the player's brand awareness for <see cref="Product"/> in <see cref="City"/>
/// reaches <see cref="Threshold"/>. Threshold is 0..100 (same scale as
/// <see cref="World.GetBrandAwareness"/>).
/// </summary>
public sealed record TopBrandGoal(
    string Description,
    ProductId Product,
    CityId City,
    double Threshold) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var awareness = world.GetBrandAwareness(player, Product, City);
        var achieved = awareness >= Threshold;
        var progress = Threshold <= 0 ? 1.0 : Math.Min(1.0, awareness / Threshold);
        return new GoalEvaluation(
            Description,
            achieved,
            progress,
            $"{awareness:F1} / {Threshold:F1}");
    }
}

/// <summary>
/// Achieved when cumulative <see cref="LedgerCategory.ExportSale"/> revenue for the player
/// since <see cref="StartDate"/> reaches <see cref="Amount"/>. Loader stamps in the start date.
/// </summary>
public sealed record ExportRevenueGoal(
    string Description,
    GameDate StartDate,
    decimal Amount) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var now = world.Clock.Now;
        decimal total = 0m;
        if (now >= StartDate)
        {
            foreach (var entry in world.Ledger.EntriesInRange(player, StartDate, now))
            {
                if (entry.Category == LedgerCategory.ExportSale) total += entry.Amount;
            }
        }
        var achieved = total >= Amount;
        var progress = Amount <= 0m
            ? 1.0
            : Math.Max(0.0, Math.Min(1.0, (double)(total / Amount)));
        return new GoalEvaluation(Description, achieved, progress, $"${total:N0} / ${Amount:N0}");
    }
}

/// <summary>
/// Achieved when the player has had at least <see cref="Months"/> consecutive months
/// of positive per-month NetIncome, ending at the current world clock. Walks backward
/// one month at a time, counting the run of strictly-positive months.
/// </summary>
public sealed record ConsecutiveProfitableMonthsGoal(
    string Description,
    int Months) : Goal(Description)
{
    /// <inheritdoc />
    public override GoalEvaluation Evaluate(World world, CompanyId player)
    {
        var cursor = world.Clock.Now;
        var streak = 0;
        // Bound the walk so a malformed scenario can never loop forever.
        var bound = Math.Max(Months * 4, 1200);
        for (var i = 0; i < bound; i++)
        {
            var statement = world.GetIncomeStatement(player, cursor, cursor);
            if (statement.NetIncome <= 0m) break;
            streak++;
            if (streak >= Months) break;
            // Step backward one month. A GameDate(y, 1) subtracts to (y-1, 12); stop if we hit year 0.
            if (cursor.Year <= 1 && cursor.Month <= 1) break;
            cursor = cursor.Month == 1
                ? new GameDate(cursor.Year - 1, 12)
                : new GameDate(cursor.Year, cursor.Month - 1);
        }
        var achieved = streak >= Months;
        var progress = Months <= 0 ? 1.0 : Math.Min(1.0, streak / (double)Months);
        return new GoalEvaluation(Description, achieved, progress, $"{streak} / {Months} months");
    }
}
