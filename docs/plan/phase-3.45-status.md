# Phase 3.45 — BuildingInspector accrual P&L

**Status:** Complete. Build clean, 179/179 engine tests pass (no engine changes — client-only refactor).

## What changed

`client/scripts/BuildingInspector.cs` — replaced the Phase 3.29 cash-flow panel with a proper per-building accrual Income Statement. Scene unchanged: all P&L UI is built programmatically into the existing `Panel/VBox/Scroll/Content` host.

## P&L formula (per building, per period)

For a period `[from..to]` and `BuildingInstanceId b` owned by company `c`:

- **Revenue** = Σ `LedgerEntry.Amount` where `Company == c` ∧ `Building == b` ∧ `Category ∈ {ProductSale, ExportSale}` ∧ `Date ∈ [from..to]`
- **COGS**    = Σ `CogsEntry.Cost` where `Company == c` ∧ `SourceBuilding == b` ∧ `Date ∈ [from..to]`. `Cost` is already total cost basis of the units that left inventory in that recognition (WAC), so summed directly.
- **Opex**    = Σ `-LedgerEntry.Amount` where `Category == OperatingCost` ∧ `Building == b` (signed-out so the row reads positive)
- **Advertising** — always shown as `—` with the hint *"(company-level)"*. Engine intentionally records `AdvertisingCost` with `Building == null` because campaigns are `(company, product, city)`-scoped.
- **Net Income** = Revenue − COGS − Opex.

## Time windows

Three side-by-side columns: **This month / Last 12 months / Since open**. `Since open` uses the earliest `ConstructionCost` ledger entry attributed to the building; falls back to `SimStart (2026-02)` for older saves. The 12-month window is clamped to that open date.

## Sparkline integration

Reused `client/scripts/Sparkline.cs` (read-only). Builds a per-month net-income series across the same last-12 window via `BuildMonthlyNetIncomeSeries` (`ComputeWindow` per month). Line color flips green/red on the sign of the latest value. Annotated with latest / min / max in compact `$1.2M` formatting.

## Gotchas surfaced in UI

- **Factory revenue is low by design.** Internal transfers between own buildings don't book revenue — value surfaces downstream when retailers ship goods. Noted in inline help.
- **Older saves (pre-Phase 3.39) lack `SourceBuilding`.** Filter excludes them; UI notes "Older entries may not be attributed."
- **Ad spend excluded.** UI links the user mentally to Financial Statements for company-wide ad totals.

## Files touched

- `client/scripts/BuildingInspector.cs`
- `docs/plan/phase-3.45-status.md` (new)

`client/scenes/BuildingInspector.tscn` was not modified — all new UI is programmatic, fitting the existing scrollable Content host.
