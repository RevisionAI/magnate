# Phase 3.37 — SaveBrowser preview pane

**Status:** done
**Date:** 2026-04-24

## Goal
Extend the flat save-file list into a left list + right preview layout that
renders rich metadata about a selected save without hydrating a World.

## Layout
`SaveBrowser.tscn` now wraps the list/preview in an `HSplitContainer` nested
inside the existing `VBox`. Left pane: header + `ScrollContainer` of toggle
`Button` rows (name + timestamp + KB). Right pane: header + scrollable
`RichTextLabel` (BBCode) + a disabled-until-selected Load button. `BackButton`
is preserved at the bottom.

## Preview fields rendered
- Scenario human name (via `ScenarioLoader.LoadAll`) + raw id + file timestamp.
- In-game clock (YYYY-MM) + schema version.
- Player company name, cash, starting cash (recovered from the save's
  `StartingCapital` ledger entry), and delta.
- Elapsed months = save clock − scenario start date (if resolvable).
- Player building count, broken out by `BuildingType.Category` via `GameState.Catalog`.
- Top 3 player products by cumulative revenue (sum of `ProductSale` + `ExportSale`
  ledger entries), rendered with catalog-resolved product names.
- Goals summary line when `GameState.ActiveScenario` matches the save's scenario id.

## Error handling
`SavePreview.Parse` uses `JsonDocument` traversal and accepts both camel- and
Pascal-case property names. `BuildPreview` wraps the parse in try/catch and,
on failure or schema out of `[MinSupportedSchemaVersion..SchemaVersion]`,
shows `[i]Preview unavailable (...)[/i]` instead of crashing. Catalog lookups
(building category, product name, scenario resolution) each fall back to the
raw id on exception.

## Laziness
Rows are built from `FileInfo` only at scene load. `SavePreview.Parse` runs
exactly once per user selection — no pre-parsing.

## Boundary
No engine files touched. The preview DTOs are private records inside
`SaveBrowser.cs`; engine-internal `WorldSaveFile` is not referenced.

## Build + tests
`dotnet build` — 0 warnings, 0 errors. `dotnet test engine/Magnate.Engine.Tests`
— 175/175 pass. Godot headless skipped per integrator contract.
