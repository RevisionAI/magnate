# Phase 3.63 — History snapshot tracks CorporateValue

**Goal.** `GameState.History` now records Corporate Value per monthly snapshot, and
StatsDashboard's "Corporate Value" sparkline plots that series instead of the cash
trajectory it was falling back to since Phase 3.52.

## CV formula — client-side composition

No `World.GetCorporateValue(companyId)` exists. The engine exposes
`GetBalanceSheet` (Cash / InventoryValue / BuildingValue) and
`GetIncomeStatement(from, toInclusive).NetIncome`, so Phase 3.63 composes them
client-side:

```
CV = BS.Cash + BS.InventoryValue + BS.BuildingValue + 10 × NI(trailing 12 months)
```

Keeping the 10× multiplier + window policy in the client means the scenario
goal (`CorporateValueGoal` uses bare `TotalAssets`) and the sparkline don't
have to agree — if we later want a different multiplier it's one file to edit.

**Trailing-window clamp.** `GameDate` has no `AddMonths(int)` or `SimStart`, so we
clamp via `Math.Max(0, now.AsMonthIndex() - 11)` and decompose back to
`(year, month)`. `GetIncomeStatement` tolerates partial ranges (returns zero
over missing months), so young simulations degrade gracefully rather than
throwing.

## In-memory snapshot migration

`History` is **not persisted** (verified: zero hits in `Persistence/`). Pre-3.63
snapshots therefore only exist within one running session. The new
`CorporateValue` field is an appended positional-record param defaulting to 0
for any snapshots recorded before this build; the sparkline ramps from zero
until each month has been re-recorded under 3.63. No save-schema bump, no
overlap with Phase 3.59's v7→v8 work.

## StatsDashboard updates

- Sparkline now reads `h.CorporateValue` (was `h.Cash`).
- Annotation reworded: `CV  latest: … · high: … · low: … · vs cash: ±$X (N mo)`.
  The `vs cash` delta (CV − Cash) surfaces how much of corporate value is
  non-cash (inventory + buildings + capitalised earnings).
- No `.tscn` change — section already labelled "Corporate Value".

## Sibling observations (untouched)

- `Reports.cs` Trends tab (Phase 3.10, owned by Phase 3.60) plots five
  sparklines: Cash / Revenue / NetIncome / TopBrand / TopTech. There is **no**
  CV sparkline there, so no mislabeled-curve bug to flag. Reports.cs was not
  modified.
- `engine/.../Domain/BuildingType.cs:42` has an XML-doc comment on a positional
  record parameter, which is a C# error (CS1587). Engine does not build in
  isolation at the moment — presumably in-flight Phase 3.59 work. Flagged only;
  engine is out of scope.

## Verification

- `dotnet build` — currently fails due to the Phase 3.59 CS1587 in
  `BuildingType.cs` (not touched by this phase). My two client files are
  syntactically correct against the pre-existing engine API.
- `dotnet test engine/Magnate.Engine.Tests --no-build` — **211 / 211 passed**
  (run against the last-good engine binary; no engine sources touched by 3.63).
