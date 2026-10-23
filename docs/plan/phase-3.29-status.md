# Phase 3.29 — Per-building P&L ledger attribution

**Status:** done
**Date:** 2026-04-24

## Goal
Thread an optional `BuildingInstanceId` through every cash movement the sim
produces so the per-building inspector can show a real cash-flow breakdown
rather than a placeholder. Close the loop the Phase 3.27 client already
anticipated.

## Engine changes

- `Economics/Ledger.cs`: `LedgerEntry` gains `BuildingInstanceId? Building`
  as the last optional ctor parameter (defaults to null — existing call sites
  with fewer args stay valid).
- `Simulation/World.cs`:
  - `RecordCashChange` gains optional `BuildingInstanceId? building = null`
    as the last parameter (after `ProductId? product`).
  - `CreateCompany` — `StartingCapital` leaves building null (inline comment).
  - `Construct` — `ConstructionCost` passes the new building's id.
  - `ApplyMonthlyAdvertising` — `AdvertisingCost` leaves building null because
    ads are (company, product, city)-scoped (inline comment).
- `Simulation/MonthlyTick.cs`:
  - `OperatingCost` (ChargeOperatingCosts) — passes building id.
  - `ProductSale` (AllocateDemandAndSell) — passes retailer building id.
  - `ExportSale` (AutoExportSurplus) — passes source building id.
- `Simulation/MaterialProcurement.cs`:
  - `ShippingCost` — passes destination (requester) building id.
  - `InputPurchase` / `RetailRestock` (via `BuyFromMarket`) — pass destination id.

### Call-site inventory

| Call site | Building | Notes |
|---|---|---|
| `World.CreateCompany` | null | Company-wide equity injection |
| `World.Construct` | new building | Capex clearly attributable |
| `World.ApplyMonthlyAdvertising` | null | (company, product, city)-scoped |
| `MonthlyTick.ChargeOperatingCosts` | building | 1 entry per building per month |
| `MonthlyTick.AllocateDemandAndSell` | retailer | Sales attributed to the retail slot's building |
| `MonthlyTick.AutoExportSurplus` | source | Export revenue belongs to the producing building |
| `MaterialProcurement.ChargeShipping` | destination | Cost lands where the goods landed |
| `MaterialProcurement.BuyFromMarket` | destination | Ditto for InputPurchase / RetailRestock |

Total: **8 call sites** threaded. 2 intentionally left null (StartingCapital,
AdvertisingCost) with inline comments explaining why.

## Persistence

- `Persistence/WorldSaveFile.cs`: `LedgerEntryDto` gains `int? BuildingId`
  as last (default-null) parameter.
- `Persistence/WorldSaver.cs`: `SchemaVersion` bumped **3 → 4**. Docstring
  updated to describe v4's addition. Snapshot projection writes `BuildingId`
  via `e.Building?.Value`.
- `Persistence/WorldLoader.cs`: ledger-entry reconstruction parses the
  optional `BuildingId`, null-coalescing so v1/v2/v3 saves still load.
  `MinSupportedSchemaVersion` stays at 1.

## Client

- `client/scripts/BuildingInspector.cs`: `RenderPnlPlaceholderSection`
  replaced by `RenderPnlSection`. Aggregates `world.Ledger.Entries` where
  `Building == this.Id`, bucketing into Revenue / Procurement+Shipping
  (cash-flow view) / Operating / Capex / Net. Labeled inline as cash-flow
  style with a note that accrual COGS is not yet per-building attributed.
  Added `using Magnate.Engine.Economics;` for `LedgerCategory`. No scene
  changes required — the section header and grid are built programmatically.

## Tests (161 → 170, +9)

- `engine/Magnate.Engine.Tests/PerBuildingPnLTests.cs` (new) — 7 tests:
  1. Opex entries carry the correct building id.
  2. Sales entries carry the retailer id.
  3. Procurement (RetailRestock) entries carry the destination id.
  4. Export sales carry the source building id.
  5. Construction costs carry the new building id.
  6. StartingCapital + AdvertisingCost leave Building null.
  7. Per-building sums reconcile to per-company totals (invariant #2 holds).
- `engine/Magnate.Engine.Tests/PersistenceTests.cs` (extended, +2):
  - `Load_accepts_v3_save_missing_ledger_building_field` — hand-authored v3 JSON.
  - `Save_then_load_preserves_ledger_building_attribution` — v4 round-trip.

## Verification

- `dotnet build` — clean, 0 errors / 0 warnings in changed assemblies.
- `dotnet test engine/Magnate.Engine.Tests` — **170/170 passed** (up from 161).
- `dotnet run --project tools/ContentValidator` — OK.

## Invariants preserved

1. **Zero Godot deps in engine/** — only `BuildingInstanceId` (engine type) added.
2. **Cash = Σ ledger** — new field is purely additive; sums unchanged. Covered
   by the reconciliation test.
3. **Deterministic iteration** — no new sorts introduced; existing orderings
   untouched.
4. **Books close** — StartingCapital + ΣNetIncome still equals Equity; accrual
   P&L path untouched.
5. **Save/load lossless (v4) and v3 backward-compatible** — two explicit tests.

## Known limitations (flagged to user inline)

- Per-building view is **cash-flow** — InputPurchase / RetailRestock /
  ShippingCost entries hit the destination at purchase time, not when
  the resulting inventory is eventually sold. A later phase can attribute
  accrual COGS to the selling building by threading the source
  `BuildingInstanceId` through `CogsEntry`.

## Integrator notes

- No public API breakage. Positional callers of `LedgerEntry` / `RecordCashChange`
  still compile because the new parameter is last + optional.
- Existing saves (v1/v2/v3) load without touching content. Re-saved files are v4.
- The BuildingInspector now reads the ledger every render. For realistic sim
  sizes this is O(ledger entries) per paint; fine for current scenarios.
