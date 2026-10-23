using System;
using Magnate.Engine.Domain;
using Magnate.Engine.Rules;

namespace Magnate.Engine.Land;

/// <summary>
/// How a building's construction cost is paid (econ-audit §4.12): a deposit when construction
/// starts, then equal monthly instalments, the last one absorbing the rounding remainder.
/// <see cref="Months"/> = 0 is an instant build (everything is due at once).
/// </summary>
/// <param name="Months">Build duration in months (0 = instant).</param>
/// <param name="ConstructionCost">The type's construction cost.</param>
/// <param name="Deposit">Paid when construction starts (the whole cost for an instant build).</param>
/// <param name="Instalment">Each monthly instalment except the last (to the cent).</param>
/// <param name="FinalInstalment">The last instalment (absorbs the rounding remainder).</param>
public sealed record ConstructionSchedule(int Months, decimal ConstructionCost, decimal Deposit, decimal Instalment, decimal FinalInstalment)
{
    /// <summary>True when the building is complete the moment it is ordered.</summary>
    public bool Instant => Months == 0;

    /// <summary>The instalment due when <paramref name="monthsRemaining"/> instalments are left.</summary>
    public decimal InstalmentFor(int monthsRemaining) => monthsRemaining <= 1 ? FinalInstalment : Instalment;

    /// <summary>
    /// The schedule for a building type under a ruleset. Durations come from
    /// <see cref="LandRules.ConstructionMonths"/> (override), <see cref="LandRules.BuildMonths"/>
    /// (per type) or the econ-audit §4.12 fallback <c>ceil(k·√plots)</c>, scaled by
    /// <see cref="LandRules.ConstructionTimeScale"/>; without <see cref="LandRules.ConstructionTime"/>
    /// every build is instant.
    /// </summary>
    public static ConstructionSchedule For(BuildingType type, LandRules rules)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(rules);
        var cost = type.ConstructionCost;
        var months = MonthsFor(type, rules);
        if (months == 0) return new ConstructionSchedule(0, cost, cost, 0m, 0m);

        var deposit = rules.DepositShare == 1m ? cost : Math.Round(cost * rules.DepositShare, 2, MidpointRounding.ToEven);
        var rest = cost - deposit;
        var instalment = Math.Round(rest / months, 2, MidpointRounding.ToEven);
        var final = rest - instalment * (months - 1);
        if (final < 0m)
        {
            // Rounding up every instalment overshot the remainder: pay it evenly but short, the last one takes the rest.
            instalment = Math.Floor(rest / months * 100m) / 100m;
            final = rest - instalment * (months - 1);
        }
        return new ConstructionSchedule(months, cost, deposit, instalment, final);
    }

    /// <summary>The build duration of a type in months under a ruleset (0 = instant).</summary>
    public static int MonthsFor(BuildingType type, LandRules rules)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(rules);
        if (!rules.ConstructionTime) return 0;
        int months;
        if (rules.ConstructionMonths is int forced)
        {
            months = forced;
        }
        else if (rules.BuildMonths is { } table && table.TryGetValue(type.Id.Value, out var listed))
        {
            months = listed;
        }
        else
        {
            var plots = Math.Max(1, type.Footprint.Width * type.Footprint.Height);
            months = (int)Math.Ceiling(FallbackFactor(type) * Math.Sqrt(plots));
        }
        if (months > 0 && rules.ConstructionTimeScale != 1m)
        {
            months = (int)Math.Ceiling(months * rules.ConstructionTimeScale);
        }
        return Math.Max(0, months);
    }

    /// <summary>The econ-audit §4.12 factor k of <c>ceil(k·√plots)</c> by site class.</summary>
    private static double FallbackFactor(BuildingType type) => SiteRules.For(type).Class switch
    {
        SiteClass.Retail => 1.3,
        SiteClass.Logistics => 1.5,
        SiteClass.Industry => 1.6,
        SiteClass.Research => 2.0,
        SiteClass.Media => 1.5,
        SiteClass.Extraction => 3.3,
        SiteClass.Seaport => 3.1,
        _ => 1.5,
    };
}
