# Phase 3.17 — Keyboard shortcuts + speed controls

## Summary

Polish pass on the Main HUD. Adds three speed buttons (1× / 2× / 5×) and a
keyboard-shortcut layer so the whole in-game HUD is drivable without a mouse.
Speed state piggy-backs on the already-shared `GameState.SecondsPerMonth` from
phase 3.8, so it naturally survives scene transitions.

## Files touched

- `client/scenes/Main.tscn` — new `SpeedHBox` with a `SpeedLabel` + three
  toggle-mode `Button`s (`Speed1x`, `Speed2x`, `Speed5x`) between the existing
  Play/Advance row and the Manage/Reports/CityMap/Save/Back row.
- `client/scripts/Main.cs`
  - Cached references to the three speed buttons in `_Ready`.
  - Wired `Pressed` signals to `SetSpeed(seconds)` lambdas.
  - Added `_UnhandledInput` handling raw `InputEventKey` events, dispatching on
    `Key.*` values. Marks the event handled on a match so background controls
    don't double-fire.
  - `SetSpeed(float)` mutates `GameState.SecondsPerMonth`, zeroes
    `GameState.TickAccumulator` (so the new cadence starts from "now" instead
    of firing a queued tick from the previous slower rate), then calls
    `RefreshSpeedButtons` + `UpdateStatusLabel`.
  - `RefreshSpeedButtons` flips `ButtonPressed` on the matching button (epsilon
    compare on the float) and clears the others — this is why the buttons are
    `toggle_mode = true`.
  - `UpdateStatusLabel` now formats "Running at 2×" / "Paused (5×)" using the
    shared `SpeedMultiplierLabel` helper instead of the old hard-coded string.

No changes to `GameState.cs`, `project.godot`, or any other scene/script.
Sticking with raw `Key.*` dispatch avoided the need to register InputMap
actions in `project.godot`.

## Keymap reference

| Key         | Action                                          |
| ----------- | ----------------------------------------------- |
| Space       | Toggle Play / Pause                             |
| `.` period  | Advance 1 month (ignored while playing)         |
| `1`         | Speed 1× (`SecondsPerMonth = 1.0`)              |
| `2`         | Speed 2× (`SecondsPerMonth = 0.5`)              |
| `3`         | Speed 5× (`SecondsPerMonth = 0.2`)              |
| `M`         | Open Manage                                     |
| `R`         | Open Reports                                    |
| `C`         | Open City Map                                   |
| `Esc`       | Back to Title (also pauses)                     |

All bindings live on the Main scene only — child scenes (Manage, Reports,
CityMap, BuildingInspector, etc.) still own their own input and are
unaffected. `_UnhandledInput` is used rather than `_Input` so focused UI
controls (buttons, text fields if ever added) get first crack at the event.

## Visual approach for speed buttons

Used Godot's built-in `toggle_mode = true` + `button_pressed` state, which
gives the selected speed the engine's native pressed-button look (sunken /
accented styling per the active theme). This was chosen over a `Modulate`
tint because it:

1. Matches the idiom Godot users expect for a radio-group selector.
2. Automatically themes correctly if we ever swap themes.
3. Needs zero custom draw code — one bool per button.

The `Pressed` signal still fires when a toggle button is clicked, so our
handler re-asserts the correct `ButtonPressed` state for all three buttons
on every click. That means clicking an already-selected button is a visual
no-op (it doesn't "un-select" to leave all three off), which is the right
behaviour for a radio-group.

Initial state on `_Ready`: whichever button matches the current
`GameState.SecondsPerMonth` is pressed. Default is `1.0` from `GameState`
initialisation, so the 1× button is lit on first entry.

## Behaviour notes

- **Period only advances when paused.** If the user is playing and taps `.`
  the handler returns early (no tick, no `SetInputAsHandled` — though the
  event isn't meaningful to anything else in this scene either).
- **Speed persists across scene reloads.** `GameState.SecondsPerMonth` is
  static; returning from Manage / Reports / CityMap re-lights the same
  speed button via `RefreshSpeedButtons` in `_Ready`.
- **Escape from Main pauses and returns to Title.** Matches the existing
  `BackButton` handler — no confirm dialog (MVP).
- **Cmd-Q etc. not trapped.** We only match `Key.M/R/C/Escape/Space/Period/
  Key1/Key2/Key3`. macOS OS shortcuts (Cmd-Q, Cmd-W, Cmd-Tab) don't reach
  `_UnhandledInput` as `InputEventKey` without the cmd modifier match, so
  no conflict.

## Runaway-tick sanity check

At 5× (`SecondsPerMonth = 0.2`), `TickIfRunning` still resets the accumulator
to `0` after each tick, meaning at most one month advances per `_Process`
call. At 60 fps that caps us at 60 months/sec in theory but in practice the
accumulator only fires once per frame and delta is well under 0.2s per frame,
so we get the intended ~5 ticks/sec. No runaway observed.

If we ever want true "catch up" behaviour on slow frames (e.g. a stutter
dropping delta to 0.5s) we'd need a `while` loop with a safety cap, but for
now the single-tick-per-frame policy is fine.

## Verification

```
dotnet build client                 → Build succeeded (client DLL)
SmokeTest.tscn                      → 11 passed, 0 failed
Main.tscn --quit-after 30           → clean boot, no GD.PushError
```

(There's a pre-existing `CS1574` XML-cref warning-as-error in
`engine/Persistence/WorldSaver.cs:198` that surfaces in the solution-wide
build output, but it does not block the client DLL from building and is
outside this phase's scope per the file-ownership rules.)
