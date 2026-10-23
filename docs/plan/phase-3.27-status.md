# Phase 3.27 — Building Inspector enhancement (Agent D)

**Status:** code complete, build green, scene boots not yet verified
(Godot headless runs were blocked by the sandbox — see Verification below).

## What changed

Only `client/scripts/BuildingInspector.cs` was touched. The scene file
`client/scenes/BuildingInspector.tscn` is unchanged — every new widget is
created programmatically under the existing `Panel/VBox/Scroll/Content`
container, so no new named Controls are required. The back button and top
header / sublabel / status stays identical.

### New sections (rendered top-to-bottom inside the scroll container)

1. **Workforce** — reads `BuildingType.TargetHeadcount` (min/max per slot) and
   multiplies by configured slot count to show an estimated staffing demand
   range. Notes that actual headcount tracking awaits engine support (the
   domain currently has no `Building.Headcount` property — see
   `engine/Magnate.Engine/Simulation/BuildingInstance.cs`).

2. **Monthly P&L (this building)** — placeholder. `LedgerEntry` and `CogsEntry`
   don't carry a `BuildingInstanceId`, so per-building attribution is
   impossible without an engine change. The section explains this and points
   the user to the company-wide Financial Report.

3. **Inventory** — now split by tier (Raw / Intermediate / Finished). Summary
   strip shows qty + cost basis per tier, detailed grid has a Tier column
   and tier-coloured labels.

### Slot-row detail upgrades

- **Retail slots** — now also show on-shelf qty vs restock target. "Last-month
  units sold" flagged as needing engine support (no per-building-per-product
  sales log).
- **Production slots** — show monthly capacity
  (`recipe.OutputQuantity * SimulationConstants.CyclesPerSlotPerMonth`) and
  an input-deficit line per input (on-hand vs one month's full-rate demand).
- **Extraction slots** — show `YieldPerSlotPerMonth` and current on-hand
  quantity.
- **Research slots** — show tech level (`World.GetTech`), cumulative progress
  (`World.GetResearchProgress`), and points/month.
- **Warehouse slots** — show on-hand vs target stock under the editable row.

### Live refresh

Added `_Process(double delta)` that calls `GameState.TickIfRunning` and
re-renders if a month ticked. Also detects externally-advanced months via
`Clock.Now.AsMonthIndex()` tracked in `_lastRenderedMonthIndex`.

### Null-safe load

If the scene is opened with no building selected (e.g. headless smoke test),
header / sublabel now switch to explanatory text instead of throwing.
Previously only `StatusLabel` was set, and a second call to `Render` could
NRE on `SelectedBuilding`.

## Files

- Modified: `/Users/eddyh/Documents/2026/Games/Capitalism/client/scripts/BuildingInspector.cs`
- Unchanged: `/Users/eddyh/Documents/2026/Games/Capitalism/client/scenes/BuildingInspector.tscn`

## Engine APIs used (read-only, no engine changes)

- `World.Buildings`, `World.Catalog`, `World.Clock`
- `World.GetTech`, `World.GetResearchProgress`
- `Inventory.EntriesWithCost`, `Inventory.Get`
- `BuildingType.TargetHeadcount`
- `Product.Recipe.OutputQuantity` / `Inputs`
- `Product.Extraction.YieldPerSlotPerMonth`
- `SimulationConstants.CyclesPerSlotPerMonth`,
  `SimulationConstants.ResearchPointsPerSlotPerMonth`
- `GameState.TickIfRunning`

## Verification

- `dotnet build /Users/eddyh/Documents/2026/Games/Capitalism` → **Build
  succeeded. 0 Warning(s) 0 Error(s)** (3.3 s).
- Godot headless smoke runs for `BuildingInspector.tscn` and `Main.tscn`
  **could not be executed** — the sandbox denied the Godot binary across
  every invocation variant attempted. Ran a permission-free path existence
  check only. Build-clean is the strongest signal we have. The null-guard
  (no `SelectedBuilding`) is exercised by the scene-file smoke test, which
  should now pass cleanly when unblocked.

## Known limitations / not in scope

- No engine modifications were made. Per-building P&L, last-month units-sold,
  and real headcount all live behind "needs engine support" notes per the
  sprint instructions.
- The inspector still does a full re-render each time a month ticks; widgets
  aren't retained across renders. That's fine for Phase 3.27 performance but
  a later UX polish could rebuild only the data sections.
