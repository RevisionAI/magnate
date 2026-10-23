# Phase 3.35 — Replay Viewer (status)

## New files
- `client/scripts/ReplayViewer.cs` — `ReplayViewer : Node`, read-only.
- `client/scenes/ReplayViewer.tscn` — Panel → VBox → (Header, Sub, SparkHost, Scroll/ReplayText, HBox/BackButton).

## What is aggregated per month
Iterates `world.Ledger.EntriesFor(playerId)` once, groups by `GameDate.AsMonthIndex()`, derives
`[start, end]` from min/max entry dates. For each month in that contiguous range:

- **Revenue** — sum of `ProductSale` + `ExportSale`.
- **Expenses** — magnitude of `OperatingCost` + `AdvertisingCost` outflows.
- **Net cash** — sum of every ledger amount that month (signed).
- **Goods produced** — units from `CogsLog` entries for the player that month.
- **New buildings** — count of `ConstructionCost` entries.
- **Ads active** — count of `AdvertisingCost` entries (one per campaign-month).
- **Noteworthy** — any single entry with `|amount| >= $250k`, labeled with category + product.
- A cumulative-cash sparkline is drawn above the list when `months >= 2`.

Rendered oldest-to-newest as BBCode in a ScrollContainer'd `RichTextLabel` (`fit_content=true`).

## Null / empty-state behavior
- `GameState.World is null`: `[i]No save loaded. Load a game from the title screen first.[/i]`.
- World present but zero player ledger entries: `[i]No recorded history yet...[/i]`.
- Scenario goals per month deliberately skipped — goal state isn't snapshotted, only live-evaluated,
  so attributing achievement to a specific past month would be fabrication. Flagged for a later phase.

## Integrator wiring ask (Main.cs / Main.tscn — NOT modified here)
- Add `Button` named `ReplayButton` (text: `"Replay (P)"`) under `Hud/VBox/HBox2/` in `Main.tscn`.
- Wire its `Pressed` in `Main.cs._Ready` to `GetTree().ChangeSceneToFile("res://scenes/ReplayViewer.tscn")`.
- Add `Key.P` case in `Main.cs._UnhandledInput` calling the same handler.
- Scene is self-navigating: `Escape` or the Back button returns to `res://scenes/Main.tscn`.

## Verification
- `dotnet build` — 0 errors, 0 warnings (see report).
- `dotnet test engine/Magnate.Engine.Tests` — 170/170 passing (engine untouched).
