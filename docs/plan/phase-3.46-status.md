# Phase 3.46 — TitleScreen Scenario Showcase

**Status:** Complete · 2026-04-24

## Goal
Extend the Phase 3.20 polished title screen with a programmatic row of 3-4
hand-picked scenario "showcase cards" — name, difficulty stars, one-line
description, and a Play button that jumps straight into Main with the
scenario applied (saves a click vs going through ScenarioPicker).

## Shipped

1. **Showcase ids (hard-coded, missing-tolerant).** `ShowcaseIds = { tutorial,
   coffee_monopoly, vertical_showdown, sandbox }` — covers the difficulty
   curve (easy intro → narrative-rich vertical chain → hard challenge → free
   sandbox). Missing ids are silently skipped; the row gracefully shrinks.

2. **Card layout.** `BuildShowcaseCard(Scenario)` returns a `PanelContainer`
   styled with a dark fill + gold border (mirrors the title underline). VBox
   inside: Label (name, font_size=18) + RichTextLabel (gold filled stars,
   dimmed empty stars, `[d/5]` meta, truncated description) + spacer + Play.
   Description truncated by first sentence break, else hard-cut at a word
   boundary near 90 chars. `card.SizeFlagsHorizontal = ExpandFill` lets the
   four cards share the row width evenly.

3. **Difficulty heuristic — duplicated.** `ComputeDifficulty(Scenario)` is a
   verbatim copy of `ScenarioPicker.ComputeDifficulty` with a doc comment
   noting the two must be kept in sync. Avoids cross-file dependencies.

4. **Quick-pick handler.** Mirrors `ScenarioPicker.StartScenario`: calls
   `ScenarioRunner.Apply(Catalog, scenario, seed: 42)` and stashes
   `World`, `PlayerId`, `ScenarioName`, `ActiveScenario`, clears `History`,
   records a snapshot, then `ChangeSceneToFile(Main.tscn)`. Auto-play
   defaults OFF (player drives when launching directly from the title).

5. **Null-safety.** Catalog absent → empty showcase row (existing buttons
   remain functional). Scenarios load failure → logged warning, no crash.

6. **Scene change.** Added `Panel/ShowcaseRow` HBoxContainer anchored
   bottom-center above the footer (960×180 box, 12px separation). Title,
   gold underline, slide-in tween, and alpha pulse all preserved.

## Verification
- `dotnet build` — clean, 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — **179 / 179 pass**.

## Files
- `client/scripts/TitleScreen.cs` — extended with showcase + heuristic.
- `client/scenes/TitleScreen.tscn` — added `ShowcaseRow` placeholder.
