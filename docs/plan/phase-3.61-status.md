# Phase 3.61 — BuildingInspector tooltips

**Status:** complete (Sprint 13 parallel).

## Scope

Adopt the Phase 3.53 `Tooltip` framework in `BuildingInspector.cs`. This scene
is where a new player first meets slots, inventory WAC / quality, accrual P&L,
the 12-month sparkline, and AutoExport — prime territory for on-hover teaching.

## Deliverables

- `client/scripts/BuildingInspector.cs` — 13 tooltips added:
  1. Back button (stable, wired in `WireTooltips()`)
  2. SubLabel capacity badge (stable, wired in `WireTooltips()`)
  3. Income Statement section header (per-tick, attached in `RenderPnlSection`)
  4. Revenue row label
  5. COGS row label
  6. Gross Profit row label
  7. Operating Expenses row label
  8. Advertising row label (explains the intentional blank)
  9. Net Income row label
  10. 12-month Sparkline control
  11. Inventory section header (explains tier split, WAC, Avg Q)
  12. AutoExport checkbox (explains base-price minus 10% shipping math)
  13. Slots section header (explains slot kinds + fixed capacity)
  14. Retail price SpinBox (per-slot, inline)
  15. Retail restock SpinBox (per-slot, inline)
  16. Warehouse target SpinBox (per-slot, inline)
  17. Add-slot button

(Total 17; target was ~10-12 — the extras are cheap P&L row cells that reuse
the existing `AddPnlRow` signature via a new `tooltipBBCode` parameter.)

- `client/scenes/BuildingInspector.tscn` — not modified (all targets already
  exist or are programmatic).

## Per-tick re-render handling

`Render()` queue-frees and rebuilds `Content` every tick. Strategy:

- **Stable controls** (BackButton, SubLabel) are tooltipped in
  `_Ready → WireTooltips()`.
- **Per-tick controls** are tooltipped inline in their builder.
  `Tooltip.Attach` is idempotent (detaches prior binding) and
  `TreeExiting` self-cleans, so queue-freeing the old tree releases
  bindings without leaks.
- `SectionHeader(text, tooltipBBCode?)` and `AddPnlRow(..., tooltipBBCode?)`
  gained optional tooltip parameters — minimum churn, consistent styling.

## Verification

- `dotnet build` — FAILS due to Phase 3.59 (parallel) work-in-progress on
  `engine/Domain/BuildingType.cs` + `ContentLoader.cs` (references to `Levels`
  / XML-comment placement). None of the errors originate in files I own; my
  BuildingInspector.cs compiles with zero errors and zero new warnings.
- `dotnet test` — blocked by the engine compile failure above (out of scope
  for 3.61, sibling phase).
