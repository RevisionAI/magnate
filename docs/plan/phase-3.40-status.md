# Phase 3.40 — Manage scene polish

Sprint 9 / parallel agent. Touched only `client/scripts/Manage.cs`,
`client/scenes/Manage.tscn`, and this status note.

## Shipped

1. **Build tab — cost preview + affordability + category filter.**
   New `RichTextLabel` shows `Construction $X · Monthly opex $Y · Capacity N
   slots · Workforce a–b/slot` for the selected type. A green/red badge below
   compares cost against the player's cash and reports the shortfall when
   short. A category dropdown (`All / Production / Retail / Warehouse /
   Extraction / Media / R&D`) filters the type picker; rows now carry a
   `[category]` prefix. Picker selections are wired so changing the category
   or type re-renders preview + product list.

2. **Buildings tab — richer rows + sort.**
   Each row now shows `B# · type · city · slots used/cap · [category]` plus a
   per-building cashflow line: `This month: signed-cash · Baseline opex:
   -X/mo`. Cashflow is computed by summing
   `world.Ledger.Entries.Where(e => e.Building == bId)` for the current month
   index (Phase 3.29 attribution; null-`Building` entries skipped per brief).
   Top-of-list summary strip totals count, current-month net flow, and
   baseline opex. Sort dropdown: id / city / category / net cashflow.

3. **Campaigns tab — reach preview + media-bonus disclosure.**
   Form gains an `Estimated next month` line that runs the engine's actual
   formula (`AdCostPerPoint × MediaOwnershipBonus × saturation`) to project
   `current → new` brand awareness. Active-campaign rows now annotate any
   media-ownership bonus (`×1.35 media bonus` etc). Added the missing Radio
   channel option. Summary strip shows total monthly ad spend.

4. **Live tick auto-refresh** (Reports.cs pattern). `_Process` calls
   `GameState.TickIfRunning` and re-renders Buildings + Campaigns tabs and
   the Build affordability badge whenever the month index advances; the
   Build form's user state (selections, spinbox values) is preserved
   because it lives in retained widget references.

## Deferred

- **Item 5 — keyboard nav.** Tab/Shift-Tab cycling and Enter activation
  of focused row buttons. Skipped; cost vs. value didn't fit the slot,
  and Godot's default focus walk already cycles forward across visible
  controls. Easy follow-up.
- **Per-row brand awareness for active campaigns** is shown, but a
  per-product reach trend (multi-month sparkline) was out of scope.

## Verification

```
dotnet build          → 0 warnings, 0 errors
dotnet test (engine)  → 179/179 passing
```

No engine or other client files modified. Headless Godot run skipped
per brief.
