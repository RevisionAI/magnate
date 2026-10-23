# Phase 1.5 — Content rebalance + reporting

**Goal**: pay off the technical and balance debt the Phase 1.4 AI exposed. Make the simulation legible at the company level (balance sheet) and the product level (profitability), and surface internal goods movements (transfer log).

## Delivered

### Content rebalance (`content/data/products/finished.json`)

Halved per-capita demand for big-ticket durables to land at realistic annual purchase rates.

| Product | Before (low / mid / high per month) | After | Annual cars per 1000 residents |
|---|---|---|---|
| television | 0.01 / 0.05 / 0.08 | 0.002 / 0.005 / 0.010 | — |
| car        | 0.002 / 0.01 / 0.03 | 0.001 / 0.003 / 0.008 | ~36 (was ~700) |

Test `Rebalanced_durables_have_realistic_annual_demand` locks the new numbers into a sane range.

### `LedgerEntry.Product` (optional)

`LedgerEntry` gained a nullable `ProductId? Product` field. Categories that are product-attributable (`ProductSale`, `ExportSale`, `InputPurchase`, `RetailRestock`) now carry the product they relate to; capital and overhead categories (`StartingCapital`, `ConstructionCost`, `OperatingCost`) leave it null. `World.RecordCashChange` accepts an optional `product` parameter and threads it through.

### `TransferLog` — internal goods movements

```csharp
record TransferEntry(GameDate Date, CompanyId Company, BuildingInstanceId From, BuildingInstanceId To, ProductId Product, double Quantity)
```

`MaterialProcurement.PullFromOwnProducers` now records a `TransferEntry` whenever goods move between same-owner buildings. Cash isn't touched; this is purely visibility for production reports.

`World.TransferLog` is the public access point.

### `BalanceSheet` (`World.GetBalanceSheet(CompanyId)`)

Snapshot at `Clock.Now`:
- **Cash** — `Company.Cash`
- **Inventory** — `Σ qty × baseWorldMarketPrice` across all owned buildings (Phase 2 will switch to weighted-average cost)
- **Buildings** — `Σ constructionCost` (no depreciation yet)
- **Liabilities** — 0 until the bond / loan system lands
- **TotalAssets**, **Equity** — derived

### `ProductProfitability` (`World.GetProductProfitability(CompanyId, from, to)`)

Returns `IReadOnlyDictionary<ProductId, ProductProfitability>` — per-product Revenue, Cost, Margin, MarginPct from grouping product-tagged ledger entries. Entries without a product (opex, construction) are excluded.

### Tests (8 new — total 40 passing)

- `Initial_balance_sheet_equals_starting_capital`
- `Construction_moves_value_from_cash_to_buildings_keeping_total_assets_unchanged` ← capex invariant
- `Inventory_is_valued_at_world_market_price`
- `Profitability_attributes_revenue_and_cost_to_correct_product`
- `Profitability_excludes_opex_and_construction`
- `Internal_pull_emits_a_transfer_entry`
- `Vertical_chain_emits_transfer_per_internal_link` ← farm→sugar, sugar→drink, drink→store
- `Rebalanced_durables_have_realistic_annual_demand`

### Cockpit upgraded

`magnate-sim` final standings now show per-company:
- Income statement (Rev / OpEx / NetIncome)
- Balance sheet (Cash / Inventory@market / Buildings@cost / TotalAssets / Liabilities / Equity)
- Per-product P&L table sorted by margin
- Internal transfer count

## What the reports immediately revealed

The per-product P&L on Acme's chain shows:

| Product | Revenue | Cost | Margin |
|---|---|---|---|
| soft_drink | $30.2M | $24.2M | 20.1% |
| sugar | $2.3M | $0 | 100% (export surplus) |
| sugarcane | $192k | $0 | 100% (export surplus) |
| **plastic** | **$0** | **$36k** | **−100%** |

The plastic line is **cash-basis accounting biting back**: we buy plastic to feed the drink factory but never sell it directly, so the report shows a 100% loss on plastic when in reality its cost is rolled into soft_drink. This is the canonical reason real businesses use accrual accounting (COGS).

**Phase 2 fix**: weighted-average cost per (building, product) so produced goods carry the cost of their inputs, and the soft_drink line shows the full true cost while plastic shows zero.

## New invariant

10. **Product-attributable ledger entries carry a Product field.** Reports must use it for per-product attribution; never parse the memo string.

## Out of scope (Phase 2+)

- COGS via weighted-average cost — would close the cash-basis gap noted above
- Building depreciation
- Liabilities (loans, bonds, mortgages — Banking DLC)
- Internal transfer pricing (would let chain participants show meaningful per-product margins)
- Cash flow statement breakdown (operating / investing / financing)

## Files

Added:
- `engine/Magnate.Engine/Economics/BalanceSheet.cs`
- `engine/Magnate.Engine/Economics/ProductProfitability.cs`
- `engine/Magnate.Engine/Economics/TransferLog.cs`
- `engine/Magnate.Engine.Tests/ReportingTests.cs`
- `docs/plan/phase-1.5-status.md`

Modified:
- `content/data/products/finished.json` (car/TV demand halved)
- `engine/Magnate.Engine/Economics/Ledger.cs` (LedgerEntry adds `Product`, imports Domain)
- `engine/Magnate.Engine/Simulation/World.cs` (TransferLog property; RecordCashChange takes optional `product`; GetBalanceSheet + GetProductProfitability)
- `engine/Magnate.Engine/Simulation/MaterialProcurement.cs` (logs transfers; passes product to market buys)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (passes product to ProductSale + ExportSale entries)
- `tools/MagnateSim/Program.cs` (richer per-company summary)
