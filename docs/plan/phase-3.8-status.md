# Phase 3.8 — Live Reports + sparkline charts

**Goal**: turn Reports from a one-shot text dump into a live dashboard. Play state carries across scene transitions, Reports re-renders on every tick, and a new Trends tab draws sparkline charts from an accumulating history of monthly snapshots.

## Delivered

### Shared tick state in `GameState`

Previously each scene kept its own `_running` flag and tick accumulator; toggling Play on Main paused the sim as soon as you opened Reports. Now it's all shared:

```csharp
static bool  GameState.IsPlaying
static float GameState.SecondsPerMonth = 1.0f
static float GameState.TickAccumulator
static bool  GameState.TickIfRunning(float delta)   // advance + snapshot if due; returns true on tick
static void  GameState.RecordSnapshot()             // captures one HistoryEntry
static List<HistoryEntry> GameState.History
```

Every scene's `_Process` just calls `GameState.TickIfRunning(delta)` and refreshes its UI if it returned true. Play state survives scene transitions. Opening Reports no longer pauses.

### `HistoryEntry` accumulator

```csharp
record HistoryEntry(GameDate Date, decimal Cash, decimal MonthlyRevenue, decimal MonthlyNetIncome);
```

Captured:
- On scenario start (ScenarioPicker)
- On save-file load (SaveBrowser)
- On Main's default-demo bootstrap
- On every tick (via `TickIfRunning`)
- On manual "Advance 1 Month"

Cleared on scenario start and save load so each game starts fresh.

### `Sparkline` custom Control

40-line C# `Control` subclass that overrides `_Draw()`:

- Takes `IReadOnlyList<double>` via `SetValues(...)`
- Normalizes to widget rect, draws antialiased polyline
- Configurable `LineColor`, `BackgroundColor`, `LineWidth`

Uses Godot's immediate-mode drawing API (`DrawRect`, `DrawPolyline`) — no external charting library.

### Reports — live + Trends tab

`Reports.cs` reworked:

- `_Process` calls `GameState.TickIfRunning` and refreshes all tabs on tick
- New `PlaybackBar` at the bottom with **Play/Pause** and **Advance 1 Month** buttons so you can drive the sim without returning to Main
- New **Trends tab** with three sparklines:
  - **Cash** over time (blue)
  - **Monthly Revenue** (green)
  - **Monthly Net Income** (orange)
- Each sparkline comes with title, 500×80 rect, and a detail line (latest / min / max)

Opening Reports no longer pauses; Main → Reports carries Play forward.

### Extended smoke test

`HeadlessSmokeTest.cs` gains an 11th check:

```
[OK]   history tracking via TickIfRunning
```

Drives 5 ticks programmatically at 0.1 s/month, asserts 5 actual advances happened and history grew from 1 (initial snapshot) to 6 entries. Passes on first run.

## Build status

| | |
|---|---|
| `dotnet build client` | 0 warnings, 0 errors |
| `dotnet test` (engine) | **125/125 passing** |
| Godot smoke test | **11/11 OK** |

## Why history lives in `GameState`, not the engine

The engine already stores every ledger entry and all inventory costs — the monthly cash and revenue can be derived from the ledger. But re-deriving them on every frame to feed sparklines is expensive, and certain snapshot-style metrics (brand curves per city, tech-level progression) aren't in the ledger at all.

For Phase 3.8, a simple per-tick snapshot list in the client is the cheapest and clearest path. The list isn't persisted (a save/load resets it) — same tradeoff SaveBrowser noted in Phase 3.2.

## Out of scope (future)

- **Brand & Tech sparklines** — snapshots don't yet capture per-product brand awareness or tech levels. Trivial to extend `HistoryEntry`.
- **Per-month granular axes** — sparklines have no X-axis ticks. A small month-labels strip would help for long games.
- **History persistence** — not saved/loaded. If you save at month 12 and reload, the trend starts over.
- **Multi-series / stacked charts** — one series per sparkline. A proper chart library would let revenue stack against COGS against NI.

## Files

Added:
- `client/scripts/Sparkline.cs`
- `docs/plan/phase-3.8-status.md`

Modified:
- `client/scripts/GameState.cs` (shared tick state + History + TickIfRunning + RecordSnapshot)
- `client/scripts/Main.cs` (use shared state; record snapshot on bootstrap / Advance)
- `client/scripts/ScenarioPicker.cs` (clear history + initial snapshot on Start)
- `client/scripts/SaveBrowser.cs` (clear history + initial snapshot on Load)
- `client/scenes/Reports.tscn` (Trends tab + Playback bar)
- `client/scripts/Reports.cs` (live `_Process` + Trends renderer + playback buttons)
- `client/scripts/HeadlessSmokeTest.cs` (new 11th check for history tracking)
