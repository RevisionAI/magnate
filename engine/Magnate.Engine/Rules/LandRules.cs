using System;
using System.Collections.Generic;

namespace Magnate.Engine.Rules;

/// <summary>
/// City land and construction realism: plots from the city layout, land purchase capitalised at
/// cost, construction time with progress payments and construction-in-progress (econ-audit
/// §4.12), geography requirements (bridge-spec E6).
/// <para>
/// Every field defaults to its <em>neutral</em> value — the value that reproduces Classic
/// behaviour exactly (no plots, free land, instant construction, no geography checks) — and
/// <see cref="EconomyRules.Realistic"/> sets the gameplay values. Saves persist the full record,
/// so a field missing from an older save deserialises to that neutral default. Every knob other
/// than <see cref="Enabled"/> is read only while <see cref="Enabled"/> is true.
/// </para>
/// </summary>
public sealed record LandRules
{
    /// <summary>
    /// Master switch. When <c>false</c> (Classic) buildings have no plot, land is free, the
    /// construction cost is charged in full and the building operates from the next tick. When
    /// <c>true</c> every building stands on a validated site of its city's generated layout
    /// (zoning, frontage, coast, deposits, slope and the type's geography requirement), the
    /// company buys the land at its current value plus any buy-out of ambient development, and the
    /// city's land-value and traffic fields are recomputed monthly as development changes.
    /// </summary>
    public bool Enabled { get; init; }

    /// <summary>
    /// Construction takes time (econ-audit §4.12): a deposit of <see cref="DepositShare"/> of the
    /// construction cost is paid up front and the rest in equal monthly
    /// <c>ConstructionPayment</c> instalments; the building is not operational until the last one
    /// is paid. <c>false</c> (neutral) builds instantly — the full cost is charged at once as
    /// <c>ConstructionCost</c>.
    /// </summary>
    public bool ConstructionTime { get; init; }

    /// <summary>
    /// Overrides the build duration of every type, in months, when set (tests use <c>0</c> to opt
    /// into instant construction under otherwise Realistic rules). <c>null</c> (neutral) uses
    /// <see cref="BuildMonths"/> and the fallback formula.
    /// </summary>
    public int? ConstructionMonths { get; init; }

    /// <summary>
    /// Build duration per building type id, in months (econ-audit §4.12 table). Types not listed
    /// fall back to <c>ceil(k·√plots)</c> with k by category (retail 1.3, logistics 1.5,
    /// industrial 1.6, R&amp;D 2.0, media 1.5, mine 3.3, seaport 3.1, other 1.5).
    /// </summary>
    public IReadOnlyDictionary<string, int>? BuildMonths { get; init; }

    /// <summary>
    /// Multiplies every build duration (rounded up). 1 = durations as specified; econ-audit §4.12
    /// suggests 2.5 for a "realistic time" setting.
    /// </summary>
    public decimal ConstructionTimeScale { get; init; } = 1m;

    /// <summary>
    /// Share of the construction cost paid as the deposit when construction starts (econ-audit
    /// §4.12: 0.20). The neutral 1 pays everything up front.
    /// </summary>
    public decimal DepositShare { get; init; } = 1m;

    /// <summary>
    /// Share of the construction-in-progress recovered in cash when a project is cancelled
    /// (econ-audit §4.12: 0.50); the rest is written off. The site is sold back at its current
    /// market value.
    /// </summary>
    public decimal CancelRecoveryShare { get; init; } = 0.5m;

    /// <summary>The econ-audit §4.12 build durations (game-compressed, about 40 % of real time).</summary>
    public static IReadOnlyDictionary<string, int> DefaultBuildMonths { get; } = new SortedDictionary<string, int>(StringComparer.Ordinal)
    {
        ["convenience_store"] = 2,
        ["supermarket"] = 4,
        ["department_store"] = 6,
        ["car_dealership"] = 4,
        ["electronics_store"] = 3,
        ["fashion_boutique"] = 2,
        ["warehouse_small"] = 3,
        ["warehouse_large"] = 5,
        ["seaport"] = 12,
        ["factory_small"] = 5,
        ["factory_large"] = 8,
        ["small_farm"] = 2,
        ["large_farm"] = 3,
        ["small_plantation"] = 3,
        ["iron_mine"] = 10,
        ["oil_well"] = 4,
        ["rd_center"] = 6,
        ["tv_station"] = 6,
        ["radio_station"] = 3,
        ["newspaper_publisher"] = 4,
        ["magazine_publisher"] = 4,
    };

    /// <summary>Value equality (the build-month table compares by content, so a loaded snapshot equals the original).</summary>
    public bool Equals(LandRules? other)
    {
        if (other is null) return false;
        if (ReferenceEquals(this, other)) return true;
        return Enabled == other.Enabled
            && ConstructionTime == other.ConstructionTime
            && ConstructionMonths == other.ConstructionMonths
            && ConstructionTimeScale == other.ConstructionTimeScale
            && DepositShare == other.DepositShare
            && CancelRecoveryShare == other.CancelRecoveryShare
            && SameMonths(BuildMonths, other.BuildMonths);
    }

    /// <inheritdoc/>
    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Enabled);
        hash.Add(ConstructionTime);
        hash.Add(ConstructionMonths);
        hash.Add(ConstructionTimeScale);
        hash.Add(DepositShare);
        hash.Add(CancelRecoveryShare);
        hash.Add(BuildMonths?.Count ?? -1);
        return hash.ToHashCode();
    }

    private static bool SameMonths(IReadOnlyDictionary<string, int>? a, IReadOnlyDictionary<string, int>? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null || a.Count != b.Count) return false;
        foreach (var (key, value) in a)
        {
            if (!b.TryGetValue(key, out var other) || other != value) return false;
        }
        return true;
    }

    /// <summary>Throws when a knob is out of range.</summary>
    /// <exception cref="ArgumentException">A knob is out of range.</exception>
    public void Validate()
    {
        if (ConstructionMonths is < 0 or > 240)
        {
            throw new ArgumentException($"Land.ConstructionMonths must be within 0..240 (was {ConstructionMonths})");
        }
        if (ConstructionTimeScale <= 0m || ConstructionTimeScale > 10m)
        {
            throw new ArgumentException($"Land.ConstructionTimeScale must be within (0, 10] (was {ConstructionTimeScale})");
        }
        if (DepositShare < 0m || DepositShare > 1m)
        {
            throw new ArgumentException($"Land.DepositShare must be within [0, 1] (was {DepositShare})");
        }
        if (CancelRecoveryShare < 0m || CancelRecoveryShare > 1m)
        {
            throw new ArgumentException($"Land.CancelRecoveryShare must be within [0, 1] (was {CancelRecoveryShare})");
        }
        if (BuildMonths is not null)
        {
            foreach (var (type, months) in BuildMonths)
            {
                if (months is < 0 or > 240) throw new ArgumentException($"Land.BuildMonths[{type}] must be within 0..240 (was {months})");
            }
        }
    }
}
