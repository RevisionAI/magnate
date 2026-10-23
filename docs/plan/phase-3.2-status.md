# Phase 3.2 — Scenario launcher + save/load UI

**Goal**: turn the client from a hard-coded demo into something that feels like a game. Title screen → pick a scenario → play → save → come back later and load. Uses the engine's existing `ScenarioRunner`, `WorldSaver`, and `WorldLoader` — zero new simulation code.

## Delivered

### New scenes

| Scene | Role |
|---|---|
| `scenes/TitleScreen.tscn` | First-shown scene. New Game / Load Game / Quit buttons. Eagerly loads the content catalog into `GameState` on `_Ready()`. |
| `scenes/ScenarioPicker.tscn` | Lists scenarios discovered by `ScenarioLoader.LoadAll(content/scenarios/)`. Each row shows name, description, goal/competitor counts, and a Start button. |
| `scenes/SaveBrowser.tscn` | Lists `*.json` save files under `OS.GetUserDataDir()`. Each row shows filename, last-modified timestamp, and size. |

`scenes/Main.tscn` got two new buttons (Save, Back to Title) and a ScenarioLabel that shows which scenario is running.

### `GameState` singleton

`scripts/GameState.cs` is an internal static class that holds `Catalog`, `World`, `PlayerId`, and `ScenarioName` across scene transitions. Godot's scene tree doesn't share instance state between scenes; this is the idiomatic way to pass a live simulation handle around. Written only from the main thread.

### Scene-to-scene flow

```
TitleScreen
  ├─ New Game → ScenarioPicker → Start → Main
  ├─ Load Game → SaveBrowser → Load → Main
  └─ Quit

Main
  ├─ Play / Pause (toggles real-time month tick)
  ├─ Advance 1 Month (manual step)
  ├─ Save → writes <scenario>-<timestamp>.json to OS.GetUserDataDir()
  └─ Back to Title → TitleScreen
```

### Save file conventions

- **Location**: `OS.GetUserDataDir()` — OS-appropriate per-app data dir (e.g. `~/Library/Application Support/Godot/app_userdata/Magnate/` on macOS).
- **Filename**: `<scenario-name-safe>-<yyyyMMdd-HHmmss>.json`
- **Format**: JSON via `WorldSaver` (engine Phase 2.8). Schema v1.

### MVP limitation: player plays on autopilot

The client doesn't yet have building-placement, slot-configuration, pricing, or R&D/ad controls. When a scenario starts, `ScenarioPicker` registers the player company with `AdaptiveStrategy` so something actually happens on screen. Human control arrives in Phase 3.3+ when we add gameplay UI.

Same accommodation on load: the first company by id is assumed to be the player (fine for now — scenarios always create the player first).

### Entry point

`project.godot`'s `run/main_scene` is now `res://scenes/TitleScreen.tscn`.

## Build status

- `dotnet build client` → **0 warnings, 0 errors**
- Engine regression: **120/120 tests passing**

No tests added for the client itself — Godot scene testing requires the editor runtime. Scene files are plain text (`format=3`) and scripts are unit-free C# glue; correctness will surface when the user opens Godot and runs.

## How a play session looks

```
Launch Magnate
  ┌──────────────────────────────┐
  │          MAGNATE             │
  │  A business-simulation game  │
  │                              │
  │       [ New Game ]           │
  │       [ Load Game ]          │
  │       [ Quit     ]           │
  └──────────────────────────────┘

Click New Game
  ┌──────────────────────────────┐
  │     Choose a Scenario        │
  │                              │
  │  ┌────────────────────────┐  │
  │  │ Sandbox                │  │
  │  │ Free play. No goals.   │  │
  │  │ 0 goals · 1 AI         │  │
  │  │ [ Start ]              │  │
  │  └────────────────────────┘  │
  │  ┌────────────────────────┐  │
  │  │ Soft Drink War         │  │
  │  │ Capture Metropolis…    │  │
  │  │ 2 goals · 2 AIs        │  │
  │  │ [ Start ]              │  │
  │  └────────────────────────┘  │
  │       [ Back ]               │
  └──────────────────────────────┘

Click Start on Soft Drink War
  ┌──────────────────────────────┐
  │           Magnate            │
  │  Scenario: Soft Drink War    │
  │        Date: 2026-01         │
  │  Acme Beverages: $30,000,000 │
  │        RivalCo: $25,000,000  │
  │  0 buildings, 3 ledger …     │
  │                              │
  │  [ Play ]  [ Advance 1 Mo ]  │
  │  [ Save ]  [ Back to Title ] │
  │         Paused               │
  └──────────────────────────────┘
```

## Out of scope (future)

- **Human building placement / slot configuration UI** — Phase 3.3 is the natural next step: at least a Buildings panel where you can construct + configure retail slots without the AI playing for you.
- **Per-company goal display** — scenario picker shows goal count but in-game there's no live goal progress bar. Trivial follow-up once there's a reports scene.
- **Save-file metadata** — we don't currently store `ScenarioName` or `PlayerId` inside the save. On load, the first-company heuristic finds the player. A `saveMetadata` block in `WorldSaveFile` would fix this cleanly.
- **Delete Save** — SaveBrowser only lists and loads; no delete action yet.
- **City map rendering** — no visual world yet. Buildings exist conceptually but aren't placed on any map. Phase 3.4+.

## Files

Added:
- `client/scripts/GameState.cs`
- `client/scenes/TitleScreen.tscn`
- `client/scripts/TitleScreen.cs`
- `client/scenes/ScenarioPicker.tscn`
- `client/scripts/ScenarioPicker.cs`
- `client/scenes/SaveBrowser.tscn`
- `client/scripts/SaveBrowser.cs`
- `docs/plan/phase-3.2-status.md`

Modified:
- `client/project.godot` (main scene → TitleScreen)
- `client/scenes/Main.tscn` (Save / Back to Title buttons, ScenarioLabel)
- `client/scripts/Main.cs` (reads World from `GameState`; save / back handlers)
