using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Finance;

/// <summary>Depreciation class of one capitalised component (econ-audit §4.8).</summary>
public enum AssetClass
{
    /// <summary>Buildings and shells: retail, industrial, warehouse, R&amp;D, HQ (30 y), media (25 y), seaport (40 y), farm/mine shells (20 y).</summary>
    Structure,

    /// <summary>Store fixtures and equipment (10 y).</summary>
    Fixtures,

    /// <summary>Production-line, farm, mine, well or lab equipment (5–20 y by building).</summary>
    Equipment,
}

/// <summary>One capitalised slice of a building's cost: class, share and life.</summary>
/// <param name="Class">Depreciation class.</param>
/// <param name="Share">Share of the building's construction cost (the shares of a schedule sum to 1).</param>
/// <param name="LifeMonths">Straight-line life in months.</param>
public sealed record AssetComponentSpec(AssetClass Class, decimal Share, int LifeMonths);

/// <summary>
/// How a building type's construction cost splits into depreciable components (econ-audit
/// §4.8 table), keyed by the content <see cref="BuildingType.Category"/>. Categories the table
/// does not know (content added later) fall back by kind: retail types use the store split,
/// everything else a 30-year structure.
/// </summary>
public static class AssetClasses
{
    /// <summary>Life of an upgrade: max(this, remaining structure life) months.</summary>
    public const int MinUpgradeLifeMonths = 120;

    /// <summary>Default life of equipment capitalised without an explicit life (production line, 10 y).</summary>
    public const int DefaultEquipmentLifeMonths = 120;

    private static readonly AssetComponentSpec[] Store =
    {
        new(AssetClass.Structure, 0.75m, 360),
        new(AssetClass.Fixtures, 0.25m, 120),
    };

    private static readonly AssetComponentSpec[] Shell30 = { new(AssetClass.Structure, 1m, 360) };

    private static readonly Dictionary<string, AssetComponentSpec[]> ByCategory = new(StringComparer.Ordinal)
    {
        ["convenience_store"] = Store,
        ["supermarket"] = Store,
        ["department_store"] = Store,
        ["car_dealership"] = Store,
        ["electronics_store"] = Store,
        ["boutique"] = Store,
        ["retail"] = Store,
        ["factory"] = Shell30,
        ["warehouse"] = Shell30,
        ["hq"] = Shell30,
        ["rd_center"] = new[] { new AssetComponentSpec(AssetClass.Structure, 0.75m, 360), new AssetComponentSpec(AssetClass.Equipment, 0.25m, 60) },
        ["media"] = new[] { new AssetComponentSpec(AssetClass.Structure, 1m, 300) },
        ["seaport"] = new[] { new AssetComponentSpec(AssetClass.Structure, 1m, 480) },
        ["farm"] = new[] { new AssetComponentSpec(AssetClass.Structure, 1m, 240) },
        ["plantation"] = new[] { new AssetComponentSpec(AssetClass.Structure, 1m, 240) },
        ["mine"] = new[] { new AssetComponentSpec(AssetClass.Structure, 1m, 240) },
        ["oil_well"] = new[] { new AssetComponentSpec(AssetClass.Equipment, 1m, 120) },
    };

    /// <summary>The component split of a building type's construction cost.</summary>
    public static IReadOnlyList<AssetComponentSpec> ScheduleFor(BuildingType type)
    {
        ArgumentNullException.ThrowIfNull(type);
        if (ByCategory.TryGetValue(type.Category, out var schedule)) return schedule;
        return type.Retail ? Store : Shell30;
    }

    /// <summary>
    /// Life of line / rig equipment bought for a slot (econ-audit §4.8): production lines 10 y,
    /// farm equipment 12 y, plantation 15 y, mine 20 y, wells 10 y. Other categories use
    /// <see cref="DefaultEquipmentLifeMonths"/>.
    /// </summary>
    public static int EquipmentLifeMonths(BuildingType type)
    {
        ArgumentNullException.ThrowIfNull(type);
        return type.Category switch
        {
            "farm" => 144,
            "plantation" => 180,
            "mine" => 240,
            "oil_well" => 120,
            _ => DefaultEquipmentLifeMonths,
        };
    }

    /// <summary>Life of the building's main structure component (upgrades depreciate over at least the remainder of it).</summary>
    public static int StructureLifeMonths(BuildingType type)
    {
        foreach (var c in ScheduleFor(type))
        {
            if (c.Class == AssetClass.Structure) return c.LifeMonths;
        }

        return ScheduleFor(type)[0].LifeMonths;
    }

    /// <summary>Collateral advance rate of a component class (§4.10): structures 60 %, equipment and fixtures 40 %.</summary>
    public static decimal AdvanceRate(AssetClass assetClass) => assetClass == AssetClass.Structure ? 0.60m : 0.40m;
}
