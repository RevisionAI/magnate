# Phase 3.72 — Guided Tutorial overlay

Status: **code-complete, build verified (0 errors / 0 warnings), boot unverified** (Godot binary
not runnable in this sandbox — verified via `dotnet build client/Magnate.Client.csproj`).

## What landed

A compact, self-driving overlay that converts the `tutorial` scenario's five goals into a
guided, step-by-step experience. It reads goal achievement from
`ScenarioRunner.EvaluateGoals(...)` (same source as the HUD tip panel), advances automatically
as each goal is met, celebrates each completed step with a brief in-overlay flash, and shows a
final "Tutorial complete!" state.

- Anchored to the **top-right edge**, bounded height, sitting above the bottom-right Manage
  command grid and clear of the left-column playback controls. A collapse toggle (`–` / `+`)
  shrinks it to a header-only tab so it can never block anything.
- Shows: `Guided Tutorial` title, `Step N of 5`, an imperative instruction, a `Why:` line, and a
  5-row checklist (`✓` done / `▶` current / `○` pending).
- **Only activates when `GameState.ActiveScenario?.Id == "tutorial"`** — a no-op for every other
  scenario or a save-loaded game.
- Self-sufficient: polls `GameState` on its own `_Process` (throttled to 0.2s). The integrator
  does **not** need to wire a per-tick callback.

## Files touched

- `client/scripts/GuidedTutorial.cs` — new. Overlay logic + code-built UI.
- `client/scenes/GuidedTutorial.tscn` — new. Thin `CanvasLayer` wrapper (script builds the UI).
- `docs/plan/phase-3.72-status.md` — this file.

Not touched: `tutorial.json` (step copy lives in `GuidedTutorial.cs` keyed by goal index, so the
scenario file stays schema-valid and its fuller descriptions remain the source of truth for the
HUD tip panel / Reports). `Tutorial.cs` / `Tutorial.tscn` remain the functional 10-page reference
handbook, still reached by the HUD "Tutorial" button (unchanged).

## Integration API (what the integrator adds to Main.cs)

The overlay attaches as a child `CanvasLayer` of any `Node`. **One line** in `Main._Ready()`, after
`EnsureWorld()` / `UpdateHud()` (i.e. once a world is live). It is a no-op unless the tutorial
scenario is active, so it is safe to call unconditionally:

```csharp
// Main._Ready(), after UpdateHud();  (around line 116)
GuidedTutorial.TryAttach(this);
```

That is the entire required wiring. Notes:

- `Main` is re-created on every scene re-entry; `TryAttach` re-attaches a fresh overlay each time
  and guards against double-attach within one `Main` instance.
- No per-tick call is required (the overlay self-polls). If you prefer explicit updates instead of
  polling, capture the return value and call `overlay.Refresh()` from `_Process` after
  `GameState.TickIfRunning(...)`:
  ```csharp
  private GuidedTutorial? _guided;
  // in _Ready:  _guided = GuidedTutorial.TryAttach(this);
  // in _Process, inside the TickIfRunning branch:  _guided?.Refresh();
  ```

## Per-step audio hook (for a later voice-over pass)

Each step has a stable id — `build-store`, `stock-shelf`, `let-time-pass`, `run-campaign`,
`grow-value` (plus `complete`). Read the current id via `GuidedTutorial.CurrentStepId`, or connect
the `StepChanged(string stepId)` Godot signal to trigger per-step voice-over on every transition.

## Verify

```
export PATH="$HOME/.dotnet:$PATH"; export DOTNET_ROOT="$HOME/.dotnet"
dotnet build client/Magnate.Client.csproj   # -> 0 errors / 0 warnings
```

Content validator not required (tutorial.json unchanged).
