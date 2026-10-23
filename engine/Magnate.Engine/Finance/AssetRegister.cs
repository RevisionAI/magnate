using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>
/// One capitalised component of a building (econ-audit §4.8): straight-line, monthly, zero
/// salvage, first charged in <see cref="StartMonth"/>.
/// </summary>
public sealed class AssetComponent
{
    /// <summary>Create a component.</summary>
    public AssetComponent(AssetClass assetClass, decimal cost, int lifeMonths, int startMonth, string label)
    {
        if (lifeMonths <= 0) throw new ArgumentOutOfRangeException(nameof(lifeMonths), "life must be at least one month");
        Class = assetClass;
        Cost = cost;
        LifeMonths = lifeMonths;
        StartMonth = startMonth;
        Label = label;
    }

    /// <summary>Depreciation class.</summary>
    public AssetClass Class { get; }

    /// <summary>Historical cost.</summary>
    public decimal Cost { get; }

    /// <summary>Straight-line life in months.</summary>
    public int LifeMonths { get; }

    /// <summary>Month index (<see cref="GameDate.AsMonthIndex"/>) of the first depreciation charge.</summary>
    public int StartMonth { get; }

    /// <summary>What the component is ("structure", "fixtures", "upgrade L2", …).</summary>
    public string Label { get; }

    /// <summary>Depreciation booked so far.</summary>
    public decimal Accumulated { get; internal set; }

    /// <summary>Net book value.</summary>
    public decimal NetBookValue => Cost - Accumulated;

    /// <summary>Straight-line monthly charge, rounded to cents.</summary>
    public decimal MonthlyCharge => FinanceMath.Cents(Cost / LifeMonths);

    /// <summary>
    /// The charge due in month <paramref name="month"/>: zero before the start month and once
    /// fully depreciated; the final month books the exact remainder so accumulated depreciation
    /// equals cost after <see cref="LifeMonths"/> charges.
    /// </summary>
    public decimal ChargeFor(int month)
    {
        if (month < StartMonth) return 0m;
        var remaining = Cost - Accumulated;
        if (remaining <= 0m) return 0m;
        var chargeNumber = month - StartMonth + 1;
        if (chargeNumber >= LifeMonths) return remaining;
        return Math.Min(MonthlyCharge, remaining);
    }
}

/// <summary>
/// The fixed-asset record of one building: land at cost (never depreciated), construction in
/// progress (CIP) and the depreciable components of its capitalised cost.
/// </summary>
public sealed class BuildingAssets
{
    /// <summary>Create an empty record.</summary>
    public BuildingAssets(BuildingInstanceId building) => Building = building;

    /// <summary>The building described.</summary>
    public BuildingInstanceId Building { get; }

    /// <summary>Land at historical cost (§4.8). Never depreciated.</summary>
    public decimal Land { get; internal set; }

    /// <summary>Construction in progress: progress payments not yet transferred to PP&amp;E (§4.12).</summary>
    public decimal ConstructionInProgress { get; internal set; }

    /// <summary>Depreciable components, in the order they were capitalised.</summary>
    public List<AssetComponent> Components { get; } = new();

    /// <summary>Σ component cost: the part of the building's capitalised cost already scheduled.</summary>
    public decimal RegisteredCost => Components.Count == 0 ? 0m : Components.Sum(c => c.Cost);

    /// <summary>Σ component accumulated depreciation.</summary>
    public decimal AccumulatedDepreciation => Components.Count == 0 ? 0m : Components.Sum(c => c.Accumulated);

    /// <summary>True when nothing is recorded (the record can be dropped).</summary>
    public bool IsEmpty => Land == 0m && ConstructionInProgress == 0m && Components.Count == 0;
}

/// <summary>
/// Fixed-asset register keyed by building id (econ-audit §4.8, §4.15, §4.19): land, CIP and the
/// depreciation schedule of every building. The building's own
/// <see cref="BuildingInstance.CapitalizedCost"/> stays the gross PP&amp;E figure; the register
/// splits it into components and drives the monthly charge. Cost the register has not scheduled
/// yet (a building constructed or upgraded since the last depreciation step) is picked up by
/// <see cref="Reconcile"/>.
/// </summary>
public sealed class AssetRegister
{
    private readonly Dictionary<BuildingInstanceId, BuildingAssets> _byBuilding = new();

    /// <summary>Every record, keyed by building.</summary>
    public IReadOnlyDictionary<BuildingInstanceId, BuildingAssets> Records => _byBuilding;

    /// <summary>The record of a building, or null when nothing is recorded for it.</summary>
    public BuildingAssets? Find(BuildingInstanceId building) => _byBuilding.TryGetValue(building, out var r) ? r : null;

    /// <summary>The record of a building, created on first use.</summary>
    public BuildingAssets For(BuildingInstanceId building)
    {
        if (!_byBuilding.TryGetValue(building, out var record))
        {
            record = new BuildingAssets(building);
            _byBuilding[building] = record;
        }

        return record;
    }

    /// <summary>Drop a building's record (disposal).</summary>
    internal BuildingAssets? Remove(BuildingInstanceId building)
        => _byBuilding.Remove(building, out var record) ? record : null;

    /// <summary>Land at cost of a building (0 when none).</summary>
    public decimal LandOf(BuildingInstanceId building) => Find(building)?.Land ?? 0m;

    /// <summary>Construction in progress of a building (0 when none).</summary>
    public decimal CipOf(BuildingInstanceId building) => Find(building)?.ConstructionInProgress ?? 0m;

    /// <summary>
    /// Schedule any capitalised cost of <paramref name="building"/> the register has not seen:
    /// the first slice is split by the type's §4.8 schedule; later slices are upgrades,
    /// capitalised to the structure and depreciated over max(120 months, remaining structure
    /// life). The new components are first charged in <paramref name="month"/>.
    /// </summary>
    public void Reconcile(BuildingInstance building, BuildingType type, int month)
    {
        ArgumentNullException.ThrowIfNull(building);
        ArgumentNullException.ThrowIfNull(type);
        var gross = building.CapitalizedCost;
        var existing = Find(building.Id);
        var registered = existing?.RegisteredCost ?? 0m;
        var delta = gross - registered;
        if (delta <= 0m) return;

        var record = existing ?? For(building.Id);
        if (record.Components.Count == 0)
        {
            var schedule = AssetClasses.ScheduleFor(type);
            var allocated = 0m;
            for (var i = 0; i < schedule.Count; i++)
            {
                var spec = schedule[i];
                var cost = i == schedule.Count - 1 ? delta - allocated : FinanceMath.Cents(delta * spec.Share);
                allocated += cost;
                if (cost <= 0m) continue;
                record.Components.Add(new AssetComponent(spec.Class, cost, spec.LifeMonths, month, spec.Class.ToString().ToLowerInvariant()));
            }

            return;
        }

        var structureLife = AssetClasses.StructureLifeMonths(type);
        var structure = record.Components.FirstOrDefault(c => c.Class == AssetClass.Structure);
        var elapsed = structure is null ? 0 : Math.Max(0, month - structure.StartMonth);
        var life = Math.Max(AssetClasses.MinUpgradeLifeMonths, structureLife - elapsed);
        record.Components.Add(new AssetComponent(AssetClass.Structure, delta, life, month, $"upgrade L{building.Level}"));
    }
}
