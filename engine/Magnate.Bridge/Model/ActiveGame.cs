using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>A mutating call recorded for bug reports (and, once RNG state persists, replay).</summary>
public sealed record JournalEntryDto(long Revision, DateDto Month, string Method, string ArgsJson);

/// <summary>
/// Everything that belongs to one game (bridge-spec §4.2): the engine world plus
/// the facade's indexes, trackers and persisted sidecar state. Replaced wholesale
/// by <c>newGame</c> / <c>loadGame</c>, so nothing leaks between games.
/// </summary>
internal sealed class ActiveGame
{
    /// <summary>Journal capacity (oldest entries dropped).</summary>
    public const int JournalCapacity = 5000;

    public ActiveGame(World world, CompanyId player, Scenario? scenario, int startMonth, int seed, string gameId, SlotRules rules)
    {
        World = world;
        Player = player;
        Scenario = scenario;
        ScenarioId = scenario?.Id;
        StartMonth = startMonth;
        Seed = seed;
        GameId = gameId;
        Rules = rules;
        Index = new LedgerIndex(world);
        History = new MetricsHistory();
        Goals = new GoalTracker(scenario);
        Detector = new EventDetector();
        Feed = new ActivityFeed();
        Placement = new PlacementModel(world.Catalog);
        Colors = CompanyPalette.Assign(world, player);
    }

    public World World { get; }
    public CompanyId Player { get; }
    public Scenario? Scenario { get; }

    /// <summary>The scenario id the game was started from (kept even when the scenario is not installed).</summary>
    public string? ScenarioId { get; set; }

    /// <summary>A custom game's definition (persisted so loads restore it).</summary>
    public CustomGameDto? Custom { get; set; }

    public int StartMonth { get; }
    public int Seed { get; }
    public string GameId { get; }
    public string? CreatedAtIso { get; set; }
    public SlotRules Rules { get; }

    public LedgerIndex Index { get; }
    public MetricsHistory History { get; }
    public GoalTracker Goals { get; }
    public EventDetector Detector { get; }
    public ActivityFeed Feed { get; }
    public PlacementModel Placement { get; }

    /// <summary>Colour index per company id (0 = player). Recomputed if companies appear.</summary>
    public Dictionary<int, int> Colors { get; private set; }

    /// <summary>
    /// Canonical strategy name of an AI-driven company, read from the engine's registry
    /// (<c>World.TryGetAiStrategy</c> + <see cref="AiStrategies.TryGetName"/>); null when the
    /// company is human-run. The engine save persists strategies, so loads need no sidecar copy.
    /// </summary>
    public string? StrategyOf(int companyId)
        => World.TryGetAiStrategy(new CompanyId(companyId), out var strategy) && AiStrategies.TryGetName(strategy, out var name) ? name : null;

    /// <summary>The player's autopilot strategy, when the player company is AI-driven.</summary>
    public string? Autopilot => StrategyOf(Player.Value);

    public decimal LowCashThreshold { get; set; } = 1_000_000m;
    public int AutosaveEveryMonths { get; set; } = 12;
    public int MonthsSinceAutosave { get; set; }

    /// <summary>True after <c>AdvanceMonth</c> threw: mutating calls fail until load / new game.</summary>
    public bool Faulted { get; set; }

    public double LastTickMs { get; set; }
    public double LastBridgeMs { get; set; }
    public double IndexCatchUpMs { get; set; }

    /// <summary>Facade time per phase of the last <c>advance</c> (summed over its months), for the dev overlay.</summary>
    public IReadOnlyDictionary<string, double>? LastAdvancePhasesMs { get; set; }

    public List<JournalEntryDto> Journal { get; } = new();

    /// <summary>Last city view served per city: (revision, visualRev by building id).</summary>
    public Dictionary<string, (long Revision, Dictionary<int, uint> VisualRevs)> CityViewCache { get; } = new(StringComparer.Ordinal);

    /// <summary>On-hand stock of produced goods at the previous and latest month close (utilisation).</summary>
    public Dictionary<(int Building, string Product), double> OnHandPrevious { get; private set; } = new();
    public Dictionary<(int Building, string Product), double> OnHandLatest { get; private set; } = new();

    public int Now => World.Clock.Now.AsMonthIndex();

    public int ColorIndex(int companyId)
    {
        if (Colors.TryGetValue(companyId, out var index)) return index;
        Colors = CompanyPalette.Assign(World, Player);
        return Colors.TryGetValue(companyId, out index) ? index : 0;
    }

    public string Color(int companyId) => CompanyPalette.Colors[ColorIndex(companyId)];

    public void Record(long revision, string method, string argsJson)
    {
        Journal.Add(new JournalEntryDto(revision, Months.Dto(Now), method, argsJson));
        if (Journal.Count > JournalCapacity) Journal.RemoveRange(0, Journal.Count - JournalCapacity);
    }

    /// <summary>Snapshot produced-goods stock at a month close (for the utilisation approximation).</summary>
    public void CaptureOnHand()
    {
        OnHandPrevious = OnHandLatest;
        var latest = new Dictionary<(int, string), double>();
        foreach (var b in World.Buildings.Values)
        {
            foreach (var p in b.ProductionSlots.Select(s => s.Product).Distinct())
            {
                latest[(b.Id.Value, p.Value)] = b.Inventory.Get(p);
            }
        }
        OnHandLatest = latest;
    }

    /// <summary>
    /// v1 utilisation approximation for production buildings (bridge-spec §5.5):
    /// output = exports + transfers out + Δ stock of the produced goods last month,
    /// divided by full-speed output. Extraction always yields fully. Null otherwise.
    /// Exact once the engine reports per-slot production (E10).
    /// </summary>
    public double? Utilization(BuildingInstance b)
    {
        if (b.ExtractionSlots.Count > 0) return 1.0;
        if (b.ProductionSlots.Count == 0) return null;
        double capacity = 0;
        double output = 0;
        var now = Now;
        foreach (var product in b.ProductionSlots.Select(s => s.Product).Distinct())
        {
            var def = World.Catalog.Product(product);
            var slots = b.ProductionSlots.Count(s => s.Product == product);
            capacity += (def.Recipe is { } recipe ? recipe.OutputQuantity * recipe.CyclesPerSlotMonth : 0) * slots;
            var bp = Index.BuildingProduct(b.Id.Value, product.Value, now);
            var key = (b.Id.Value, product.Value);
            var delta = OnHandLatest.TryGetValue(key, out var after) && OnHandPrevious.TryGetValue(key, out var prior) ? after - prior : 0;
            output += (bp?.ExportQty ?? 0) + (bp?.TransferOut ?? 0) + delta;
        }
        return capacity > 0 ? Math.Clamp(output / capacity, 0, 1) : null;
    }
}
