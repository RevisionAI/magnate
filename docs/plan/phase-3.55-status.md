# Phase 3.55 — ReplayViewer accrual overlay

**Status:** Complete. Build clean, 198/198 engine tests pass (client-only change).

## What changed

`client/scripts/ReplayViewer.cs` — the per-month aggregator now emits accrual alongside the existing cash lines, plus a per-month top-3 building NI drill-down and a second cumulative-NI sparkline. `ReplayViewer.tscn` unchanged: all new UI appends BBCode into the existing `ReplayText` RichTextLabel and appends a second `Sparkline` under the pre-existing `SparkHost`.

## Per-month additions

For each month (oldest first) the section now shows:

- **COGS** — Σ `CogsEntry.Cost` for entries whose `Company == playerId` and `Date` falls in the month. `Cost` is already total cost basis (WAC of units that left inventory), summed directly.
- **Royalties** *(optional)* — only rendered when non-zero. See defensive handling below.
- **Accrual NI** — Revenue − COGS − Opex − Ads (+ Royalties if present). Signed, green/red semantics are carried by the `+/−` sign prefix and the cumulative sparkline color.
- **Top buildings (by |NI|)** — up to 3 rows with `Bxxx [TypeName · CityId]  +/−$amount`. Revenue attributed by `LedgerEntry.Building`, COGS by `CogsEntry.SourceBuilding`, Opex by `LedgerEntry.Building` on `OperatingCost`. Ads are explicitly excluded (ads ledger entries have `Building == null` — they're `(company, product, city)`-scoped). Sorted descending by `Math.Abs(NI)`, tiebreak ascending by building id.

Both the existing cash-trajectory sparkline and a new cumulative-accrual-NI sparkline render above the month list.

## Phase 3.54 defensive handling

`Enum.TryParse<LedgerCategory>("PatentRoyaltyIncome" | "PatentRoyaltyExpense", ...)` resolves once into two `LedgerCategory?` statics. If Phase 3.54 hasn't landed the enum members are null and the royalty branch is skipped silently — no compile-time dependency on the new values. When present, income is summed as-is (positive inflow), expense as-is (already-signed outflow), and a `Royalties` line renders only when the month's net is non-zero.

## Attribution caveats

- **Older saves (pre-Phase 3.39)** have `CogsEntry.SourceBuilding == null`, so those entries bypass per-building attribution. The month section prints a transparency note with the count: *"(N COGS entries without a source building — pre-Phase 3.39 save)"*.
- **Deleted buildings** resolved via `world.Buildings.TryGetValue`; falls back to `(unknown) · ?` so history stays readable even if a source building was removed.

## Verification

- `dotnet build` — 0 warnings / 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — 198 passed / 0 failed (unchanged; no engine edits).
