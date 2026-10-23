# Phase 1.3 — Internal routing + raw extraction

**Goal**: turn the simulation from two disconnected loops (factory⇄world, retailer⇄world) into a real supply chain, where farms feed factories feed retailers and the world market is the fallback rather than the default.

## Delivered

### Content + schema

- **Product schema**: new optional `extraction` block (`sourceCategory`, `yieldPerSlotPerMonth`). The loader rejects `extraction` on non-raw products.
- **Seed raws** updated with extraction definitions:

| Raw | Source | Yield / slot / month |
|---|---|---|
| sugarcane | farm | 400 t |
| wheat | farm | 300 t |
| cotton | farm | 150 t |
| iron_ore | mine | 300 t |
| crude_oil | oil_well | 500 bbl |

### Engine

| Type | Responsibility |
|---|---|
| `ProductExtraction` (record) | Per-product extraction definition |
| `ExtractionSlot` | Configures one raw-extraction unit inside a building |
| `BuildingInstance.ExtractionSlots` | New list alongside `ProductionSlots` and `RetailSlots` |
| `World.ConfigureExtractionSlot(...)` | Validates raw-only product + matching `sourceCategory` ↔ `building.category` |
| `MaterialProcurement.EnsureAvailable(...)` | Procurement hierarchy: own inventory → own same-city producers → world market (with ledger entry under the supplied category) |

### Refactored monthly tick (now 7 ordered passes)

```
AdvanceMonth()
  1. ChargeOperatingCosts
  2. RunExtraction              — farms / mines add raw yield to own inventory
  3. RunProduction (intermediates pass)
  4. RunProduction (finished pass)        ← can pull from intermediates produced this same tick
  5. RestockRetailers           — uses MaterialProcurement; pulls from own factories first
  6. AllocateDemandAndSell      — consumers buy via inverse-price softmax
  7. AutoExportSurplus          — only what's left after retailers pulled
```

Two-pass production lets a chain `farm → intermediate → finished` complete inside a single month.
`AutoExportSurplus` running last means factories no longer dump output before retailers can take it.

### New invariants

6. **Internal pulls are cash-neutral** — no ledger entry when goods move between buildings of the same owner in the same city.
7. **Procurement order is fixed** — own inventory, then own producers (sorted by id), then world market. Determinism preserved.
8. **`extraction.sourceCategory` is enforced** at slot configuration time. You can't extract iron from a farm.

### Tests

7 new tests in addition to the existing 18:

- `Extraction_slot_produces_raw_each_month` — farm yields exactly base rate
- `ConfigureExtractionSlot_rejects_mismatched_building_category` — sugarcane in a mine throws
- `ConfigureExtractionSlot_rejects_intermediate_product` — only raws are extractable
- `Factory_pulls_inputs_from_own_upstream_factory_in_same_city` — no `sugar →` market buys when sugar is internal
- `Retailer_pulls_inventory_from_own_factory_when_available` — zero RetailRestock cost when factory output covers it
- `Vertical_chain_only_imports_unbacked_inputs_from_world_market` — full chain test: only plastic buys the world; sugarcane and sugar are internal
- `AutoExport_only_dumps_surplus_after_retailers_have_pulled` — verifies exported quantity = production − retailer pull

**Result: 25/25 tests passing.**

### Cockpit (MagnateSim)

Default scenario upgraded to the full vertical chain: farm → sugar factory → soft-drink factory → supermarket. With $30M starting capital. Year-1 net income ~$14.2M vs. Phase 1.2's flat factory+store at ~$11.9M — extra ~$2.3M/year from internal sourcing + raw-surplus exports.

## Out of scope (Phase 1.4+)

- Warehouses as active buffers (purchase-slot intake from world / from upstream). Currently warehouses exist as building types but have no functional behaviour.
- Inter-city transfers (with shipping cost + time).
- Explicit player-set source preferences per slot (currently auto-routed by id order).
- Workers, Q/B/T attributes, R&D, advertising.
- AI competitors.

## Files added / modified

Added:
- `engine/Magnate.Engine/Simulation/MaterialProcurement.cs`
- `docs/plan/phase-1.3-status.md`

Modified:
- `content/schemas/product.schema.json`
- `content/data/products/raws.json`
- `engine/Magnate.Engine/Domain/Product.cs`
- `engine/Magnate.Engine/Content/ContentLoader.cs`
- `engine/Magnate.Engine/Simulation/BuildingInstance.cs`
- `engine/Magnate.Engine/Simulation/World.cs`
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs`
- `engine/Magnate.Engine.Tests/SimulationTests.cs`
- `tools/MagnateSim/Program.cs`
