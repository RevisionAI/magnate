# Phase 3.31 — Exports tab in Reports scene

## Summary

Added a 7th tab, **Exports**, to the Reports scene. Positioned between
**Per-Product P&L** and **R&D and Ads** so the narrative flow reads
"total P&L by product → world-market exports detail → R&D/marketing inputs".

## Data sources (all existing engine APIs — no engine changes)

- `world.Ledger.EntriesFor(PlayerId)` filtered to `LedgerCategory.ExportSale`
  inside a rolling 12-month window relative to `world.Clock.Now`.
- `world.Catalog.Product(pid).BaseWorldMarketPrice` to reconstruct unit
  counts from revenue (export sales are recorded at base world price in
  `MonthlyTick.AutoExportSurplus`).
- `world.Buildings` for type/city lookup when per-building attribution
  is available.

## Rendered sections

1. **Headline** — total export revenue (bold) and total units over the
   last 12 months.
2. **By product** — table of Product / Revenue / Units / Avg Price,
   rank-sorted by revenue desc.
3. **By exporter (building)** — defensively gated.

## Phase 3.29 defensive handling

`LedgerEntry.Building` already exists in the record shape, but the
call site in `MonthlyTick.AutoExportSurplus` does NOT yet pass a
building id, so the field is null on every current ExportSale entry.
Client code uses reflection (`typeof(LedgerEntry).GetProperty("Building")`)
plus a non-null scan of entries; if nothing is attributed, the tab
prints an italic "per-building attribution pending Phase 3.29" note
and keeps the by-product view as the primary breakdown. When the
engine starts attaching building ids the table populates automatically
— no client change needed.

## Sample (Export Tycoon after a few years)

```
Exports — last 12 months

  Total export revenue        $2,418,000
  Units shipped                  12,090.0

By product
  Product              Revenue        Units    Avg Price
  ──────────────────────────────────────────────────────
  wheat                $1,450,000      7,250     $200.00
  corn                   $968,000      4,840     $200.00

By exporter (building)
  per-building attribution pending Phase 3.29 — export sales
  don't yet carry a building id; showing by-product totals above.
```

## Verification

- `dotnet build`: succeeded, 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests`: 161/161 passed (unchanged —
  this is pure client UI, no engine helpers added, no new test file).

Optional sparkline was skipped to keep scope tight; the Trends tab
already carries monthly revenue which partially covers that view.
