# Phase 3.54 — Patent Licensing

**Status: complete.** Extends Phase 3.49's 24-month patent exclusivity with
voluntary, revocable licenses that unblock a specific competitor in exchange
for a 5% royalty on their `ProductSale` + `ExportSale` revenue for the
patented product.

## Surface

- `PatentLicense(Holder, Licensee, Product)` record (new in `Patents.cs`).
- `World.GrantPatentLicense`, `World.RevokePatentLicense`,
  `World.GetPatentLicenses` — grant is idempotent; grant throws when no
  active patent or when the holder is also the licensee. Revoke is
  idempotent.
- `IsPatentBlocked` now returns false for a licensee as long as the patent
  is still live.
- `PruneExpiredPatents` cascade-deletes licenses on the (holder, product)
  tuple — patent expiry cleans up licensing state automatically.
- `LedgerCategory.PatentRoyaltyIncome` (revenue bucket) and
  `PatentRoyaltyExpense` (opex bucket); both wired into
  `World.GetIncomeStatement`.
- `SimulationConstants.PatentRoyaltyRate = 0.05m`.

## Tick ordering

`CollectPatentRoyalties` runs as the final step of `MonthlyTick.Execute`,
after `AllocateDemandAndSell` and `AutoExportSurplus` so the ledger already
carries this month's `ProductSale` + `ExportSale` entries. It filters by
`Date == clock.Now`, the licensee CompanyId, the patented product, and the
two sale categories, then emits two mirrored entries (licensee `-amount`
→ holder `+amount`). Patents iterate in `(holder, product)` order;
licensees in `CompanyId` order.

## Persistence

Schema v7 adds `patentLicenses: [{ holder, licensee, product }]`. v1-v6
saves load with empty licenses (`PatentLicenseDto` defaults to null).
Active licenses round-trip losslessly; a v6 regression test exercises the
missing-field path.

## Tests

`PatentTests.cs` +11 (grant unblocks R&D; grant idempotent; grant throws
without patent; grant by non-holder throws; revoke re-blocks; revoke
idempotent; 5% royalty flows both ways; expiry cascades; save/load
round-trip; determinism; income-statement categorization).
`PersistenceTests.cs` +1 (v6 save loads with empty licenses). Test count
198 → 210 (+12). One pre-existing unrelated failure in
`AdaptiveAiTests.AdaptiveStrategy_builds_research_center_once_retail_is_saturated`
— content added 2 finished products (8 total) after the test's 38-month
budget was sized for 7; outside this phase's file ownership.
