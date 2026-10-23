# Phase 3.52 — Statistics Dashboard

## Summary

A new top-level analytics scene that aggregates cross-scene metrics the player
would otherwise have to hunt for across Reports, Market Intel, Research Tree,
and the Financial Statements. Pure read; no engine changes; single scrollable
page. Refreshes on every live sim tick via `GameState.TickIfRunning`.

## Files added

- `client/scripts/StatsDashboard.cs` — `public partial class StatsDashboard : Node`.
  Seven render helpers driven by a single `RefreshAll()`; null-safe against
  `GameState.World`. All lookups use ordinal ordering for determinism.
- `client/scenes/StatsDashboard.tscn` — Panel → ScrollContainer → VBox →
  HeaderStrip (RichTextLabel, BBCode) → SparklineHost (VBox, programmatic
  children) → HeatmapLabel + HeatmapHost (GridContainer) →
  RDLeaderboardText / BrandText / TopRevenueText / TopOpexText
  (RichTextLabels, BBCode, `fit_content=true`) → BackButton.

## Sections

1. **Header strip** — scenario · date · company · cash · corporate value
   (`BalanceSheet.TotalAssets`) · current-month net income (green/red).
2. **Corporate value sparkline** — full-width `Sparkline` (200×60 min),
   sourced from `GameState.History` (cash series since `GameState.History`
   doesn't store a pre-computed corporate-value column; cash is the honest
   proxy and is clearly labeled). Annotations: latest, high, low, count.
3. **Market share heatmap** — `GridContainer` of (city × player's portfolio).
   Portfolio = distinct products across player retail slots. Cell colors
   interpolate cool (0.20, 0.40, 0.70) → amber (0.85, 0.70, 0.30) → hot
   (0.85, 0.30, 0.30). Dark label text on bright cells, light on cool.
4. **R&D leaderboard** — per engaged product (retail ∪ production ∪ research
   slots), all companies sorted by `World.GetTech` desc, rendered with a 20-
   char block-bar against `Product.MaxTechLevel`. Player row is marked with ▶.
5. **Brand awareness map** — per player-retail-product, top-5 (company, city,
   brand) triples over `World.GetBrandAwareness`. Player rows marked with ▶.
6. **Top 5 buildings by revenue** — filter `Ledger.EntriesFor(player)` to
   current-month `ProductSale ∪ ExportSale` with a non-null `Building`,
   group by building id, sort desc.
7. **Top 5 buildings by opex** — same filter but `OperatingCost`; flipped to
   positive for display. Shows id / type / city / amount.

## Data queries

- `world.GetBalanceSheet(PlayerId)` for corporate value.
- `world.GetIncomeStatement(PlayerId, now, now)` for current-month NI.
- `world.GetMarketShare(PlayerId, product, city)` per heatmap cell.
- `world.GetTech(companyId, product)` for the R&D grid.
- `world.GetBrandAwareness(companyId, product, cityId)` for the brand map.
- `world.Ledger.EntriesFor(PlayerId)` filtered by
  `e.Date.AsMonthIndex() == world.Clock.Now.AsMonthIndex()` for the
  building top-5s (per the gotcha to filter by month + company before iterating).

## Integrator wiring (NOT done in this phase)

- **Add to `client/scenes/Main.tscn`** under `Hud/VBox/HBox2`, next to the
  existing `MarketIntelButton` / `ActivityFeedButton`:

  ```
  [node name="StatsButton" type="Button" parent="Hud/VBox/HBox2"]
  layout_mode = 2
  text = "Stats"
  ```

- **Add to `Main.cs` `_Ready`**: look up `StatsButton` and wire
  `Pressed += () => GetTree().ChangeSceneToFile("res://scenes/StatsDashboard.tscn");`.

- **Keybind** — `Key.X` is currently free (M/R/C/T/S/F/I/A/P are taken);
  bind it in the existing `_UnhandledInput` switch to the same navigation.

## Verification

- `dotnet build` — clean (0 warnings, 0 errors).
- `dotnet test engine/Magnate.Engine.Tests --no-build`:
  - 192 passed / 5 failed. The 5 failures are all in `PatentTests` and are
    **pre-existing** (no engine/test files were touched this phase; excluding
    PatentTests gives 192/192 clean). These were inherited unfailed from the
    Sprint 10 baseline — flag to the integrator for a separate triage.

## Style conformance

- BBCode on every `RichTextLabel`; `Money = CultureInfo.GetCultureInfo("en-US")`
  with `("C0", Money)` formatters.
- All nodes created programmatically in helpers; `Owner = …` is never set.
- All `IEnumerable` orderings use `StringComparer.Ordinal` or ordinal id values
  for determinism.
- Live-tick pattern mirrors Reports/MarketIntel: `_Process` → `if
  (GameState.TickIfRunning((float)delta)) RefreshAll();`.
- Every `world is null` / `TryGetValue` fallback is null-safe.

## File ownership

Only the three NEW files above were created. No existing client, engine, test,
content, or tools file was modified in this phase.
