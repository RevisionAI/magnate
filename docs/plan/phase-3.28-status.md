# Phase 3.28 — Activity Feed

Status: complete (pending central integration).

## Deliverables
- `client/scripts/ActivityFeed.cs` — Control-rooted scene script. Polls `GameState.World`
  each `_Process`, derives events by comparing to a cached snapshot, renders a
  reverse-chronological BBCode list (max 50) with per-event color coding.
- `client/scenes/ActivityFeed.tscn` — Control root, Panel / VBox / RichTextLabel in
  a ScrollContainer, Back button. Programmatic UI, no theme.

## Events detected (player only)
- **Building constructed** — new `BuildingInstance.Id` with `Owner == PlayerId`
  (building-type display name + city, positive/green).
- **Month closed** — `world.Clock.Now` advanced since last poll; renders the new
  month's net income (green if ≥0, red otherwise).
- **Revenue milestone** — cumulative player `ProductSale + ExportSale` across
  thresholds $1M / $5M / $25M / $100M. Index tracks next milestone to fire.
- **R&D complete** — per-product tech level higher than last seen for any product
  the player has a retail/production/research slot on.
- **Goal achieved** — scenario goal flipped to `Achieved` via
  `ScenarioRunner.EvaluateGoals`; already-achieved goals at scene-entry are
  seeded into `_achievedGoals` so we don't spam them on first open.

## Snapshot discipline
Snapshot (`_knownBuildingIds`, `_achievedGoals`, `_lastTech`, `_lastDate`,
`_cumulativeRevenue`, `_revenueMilestoneIndex`) is cached on the node. Per-tick
detection iterates player-owned buildings and scenario goals only — no ledger
replay beyond a single pass for cumulative revenue. Re-initializes if
`GameState.World` becomes null and is later repopulated.

## Edge cases handled
- `GameState.World == null` → sub-label reads "No game loaded"; body shows an
  italic explainer. Snapshot is reset so re-entry after a game load starts
  clean.
- No active scenario → goal branch is skipped (doesn't throw).
- Products inside `[` / `]` escaped before BBCode rendering.

## CRITICAL scope
- Did NOT touch Main.cs, Main.tscn, engine source, other client scripts, tests,
  or content. Central integration will wire the Main button + hotkey.

## Verification
- `dotnet build` at repo root — clean, 0 warnings / 0 errors.
- Godot headless smoke test — **permission to run `$GODOT` was denied by the
  sandbox**, so the boot was not executed. Scene file mirrors the pattern used
  by BuildingInspector.tscn / Reports.tscn (same load steps, same ExtResource
  wiring), and the script compiled into `Magnate.Client.dll` successfully,
  which makes a boot failure unlikely. Re-run:
  ```
  "$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client \
      res://scenes/ActivityFeed.tscn --quit-after 10
  ```
