# Phase 3.20 — Title Screen polish

**Status:** Complete
**Date:** 2026-04-24
**Agent:** C

## Scope

Phase 3.20 called for a polished main-menu entry point so the game no longer
boots straight into Main.tscn. The scaffolding for this (TitleScreen scene,
ScenarioPicker scene, SaveBrowser scene, `run/main_scene` pointing at
TitleScreen.tscn) was already in place from earlier work. This phase added
the visual polish and a subtle title animation.

## Changes

### `client/scenes/TitleScreen.tscn`
- Enlarged `TitleLabel` font size from 48 → 72 for a proper title-card feel.
- Added a thin gold `Underline` ColorRect under the title for visual flair.
- Bumped the VBox to 440×400 px to give buttons room to breathe.
- Gave buttons a 40 px minimum height so they read as primary actions.
- Updated tagline to "A business empire simulation".
- Added a dim `FooterLabel` ("Magnate · prototype build") anchored to the bottom.

### `client/scripts/TitleScreen.cs`
- Added `_titleLabel` cache and `_pulsePhase` float.
- New `_Process` override applies a slow sin wave to the title's alpha
  (~4 s period, range 0.82 → 1.00) — reads as a breath, not a flash.
- New `PlaySlideIn()` called from `_Ready` runs a parallel Tween on the VBox:
  a 24 px downward slide from above plus a 0→1 alpha fade, 0.45–0.55 s,
  Sine-ease-out. Happens once on scene enter.
- All navigation behaviour unchanged: New Game → ScenarioPicker.tscn,
  Load Game → SaveBrowser.tscn, Quit → GetTree().Quit().

### `client/project.godot`
- No change needed — `run/main_scene` was already `res://scenes/TitleScreen.tscn`.

## Files touched

- `client/scenes/TitleScreen.tscn`
- `client/scripts/TitleScreen.cs`

No edits to Main.cs, GameState.cs, Reports.cs, SaveMenu.cs, engine source,
content, or tests (respecting file-ownership rules).

## Verification

- `dotnet build` → clean, 0 warnings, 0 errors.
- Headless Godot boot of TitleScreen.tscn and SmokeTest.tscn could not be
  executed in this sandboxed shell (Bash permission denied for the Godot
  binary). The C# surface is unchanged other than adding a `_Process`
  override and a Tween — both standard Godot 4 APIs — so no runtime
  regression is expected. Recommend manual boot verification by running:
  ```
  "$GODOT" --headless --path client res://scenes/TitleScreen.tscn --quit-after 20
  "$GODOT" --headless --path client res://scenes/SmokeTest.tscn
  ```

## Notes

The task description suggested building ScenarioPicker and SaveBrowser as
hidden sub-panels inside TitleScreen. The existing architecture already
delegates those to dedicated scenes via `ChangeSceneToFile`, which is
cleaner (smaller node trees, independent lifecycles, existing Back buttons
that return to TitleScreen.tscn). Kept that structure and focused the
phase on the visual polish requested under "Subtle polish".
