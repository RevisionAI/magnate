using System;
using System.Text.Json.Serialization;

namespace Magnate.Engine.Rules;

/// <summary>
/// The immutable economic ruleset a <see cref="Simulation.World"/> runs under (master plan D3).
/// One instance is held per world (<see cref="Simulation.World.Rules"/>); there is deliberately
/// no global or static "current" ruleset, because test classes run in parallel and every world
/// must be self-describing.
/// <list type="bullet">
///   <item><see cref="Classic"/> reproduces the pre-overhaul engine bit for bit. It is the default
///         of <c>new World(catalog, seed, start)</c> and the test oracle that the Classic golden
///         masters pin. It is not a player mode.</item>
///   <item><see cref="Realistic"/> is the gameplay ruleset (scenario runner, bridge). Each area
///         is switched on; the areas are filled in by their owning workstreams, and until an area
///         lands its tick steps still execute the Classic path.</item>
/// </list>
/// <para>
/// <b>How a mechanic is gated.</b> Engine code reads <c>world.Rules.&lt;Area&gt;</c> and keeps the
/// Classic path byte-identical when the area is disabled (or when a knob holds its neutral
/// value). Use fast paths for neutral knobs (<c>if (factor != 1m) price *= factor;</c>):
/// multiplying a decimal by <c>1.0m</c> changes its scale and therefore the save file and the
/// golden digests.
/// </para>
/// <para>
/// <b>Persistence.</b> Saves (schema v10+) store the full snapshot of this record, so retuning
/// <see cref="Realistic"/> later never changes an existing game. Saves older than v10 load as
/// <see cref="Classic"/>.
/// </para>
/// </summary>
public sealed record EconomyRules
{
    /// <summary>Preset id of <see cref="Classic"/>.</summary>
    public const string ClassicPreset = "classic";

    /// <summary>Preset id of <see cref="Realistic"/>.</summary>
    public const string RealisticPreset = "realistic";

    /// <summary>
    /// Name of the preset this configuration was derived from (<c>classic</c>, <c>realistic</c>,
    /// or a custom label). Informational: behaviour is driven by the area records, never by
    /// comparing this string.
    /// </summary>
    public string Preset { get; init; } = ClassicPreset;

    /// <summary>
    /// Uniform magnitude knob (econ-audit §4.0, master plan D4) for capex, land, labour cost,
    /// city demand volume, starting cash and goal thresholds — never shelf prices. 1 = content
    /// values as authored. Reserved: no mechanic reads it yet.
    /// </summary>
    public decimal EconomyScale { get; init; } = 1m;

    /// <summary>Demand, competition, world market, labour/utilities, advertising (E1).</summary>
    public MarketRules Market { get; init; } = new();

    /// <summary>Loans, rating, depreciation, tax, quarter-end, solvency (E2).</summary>
    public FinanceRules Finance { get; init; } = new();

    /// <summary>Plots, land purchase, construction time, geography (E3b).</summary>
    public LandRules Land { get; init; } = new();

    /// <summary>Business cycle, inflation, rates, commodities (E5).</summary>
    public MacroRules Macro { get; init; } = new();

    /// <summary>The pre-overhaul engine: every realism area disabled.</summary>
    public static EconomyRules Classic { get; } = new() { Preset = ClassicPreset };

    /// <summary>The gameplay ruleset: every realism area enabled.</summary>
    public static EconomyRules Realistic { get; } = new()
    {
        Preset = RealisticPreset,
        Market = MarketRules.Gameplay,
        Finance = FinanceRules.Realistic,
        Land = new LandRules
        {
            Enabled = true,
            ConstructionTime = true,
            BuildMonths = LandRules.DefaultBuildMonths,
            DepositShare = 0.20m,
            CancelRecoveryShare = 0.50m,
        },
        Macro = new MacroRules { Enabled = true },
    };

    /// <summary>True when no realism area is enabled (the Classic code paths run everywhere).</summary>
    [JsonIgnore]
    public bool IsClassic => !Market.Enabled && !Finance.Enabled && !Land.Enabled && !Macro.Enabled;

    /// <summary>
    /// Resolve a preset by name (case-insensitive): <c>classic</c> or <c>realistic</c>.
    /// </summary>
    /// <exception cref="ArgumentException">Unknown preset name.</exception>
    public static EconomyRules FromPreset(string preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        return preset.Trim().ToLowerInvariant() switch
        {
            ClassicPreset => Classic,
            RealisticPreset => Realistic,
            _ => throw new ArgumentException($"unknown economy preset '{preset}' (expected '{ClassicPreset}' or '{RealisticPreset}')", nameof(preset)),
        };
    }

    /// <summary>Throws when the configuration is internally inconsistent.</summary>
    /// <exception cref="ArgumentException">A knob is out of range.</exception>
    public void Validate()
    {
        if (EconomyScale <= 0m)
        {
            throw new ArgumentException($"EconomyScale must be positive (was {EconomyScale})");
        }

        if (Market is null || Finance is null || Land is null || Macro is null)
        {
            throw new ArgumentException("every rules area (Market, Finance, Land, Macro) must be set");
        }
    }
}
