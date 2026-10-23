# Phase 1.6 — Multi-city + warehouses

**Goal**: turn Magnate from a single-city sandbox into a regional economy. Geography becomes a strategic surface; warehouses appear as a buffer layer; inter-city shipping has a real cost.

## Delivered

### Content — 3 new cities

Total population now 1.0M across 4 cities, each with a distinct profile:

| City | Pop | Low / Mid / High | Coastal | Arable | Mineral | Oil |
|---|---|---|---|---|---|---|
| Metropolis | 500k | 0.45 / 0.40 / 0.15 | ✓ | ✓ |   |   |
| Riverside  | 250k | 0.35 / 0.45 / 0.20 |   | ✓ | ✓ |   |
| Hilltown   | 100k | 0.20 / 0.40 / 0.40 |   | ✓ |   |   |
| Portbay    | 150k | 0.50 / 0.40 / 0.10 | ✓ |   |   | ✓ |

Each city now has its own demand profile + geography requirements (e.g., oil wells only in Portbay, mines only in Riverside).

### Engine — `WarehouseSlot`

```csharp
class WarehouseSlot { int Index; ProductId Product; double TargetStock; }
```

Configured via `World.ConfigureWarehouseSlot(buildingId, slot, product, targetStock)`. Validates the building category is one of `warehouse`, `distribution_center`, `seaport`, `freight_yard`.

A new `MonthlyTick.RestockWarehouses` step runs **between production and retail restock**, so warehouses absorb fresh production before retailers pull. Each slot is topped up via the standard `MaterialProcurement.EnsureAvailable` path.

Warehouses are NOT auto-exported (auto-export only touches buildings with production or extraction slots).

### Engine — `MaterialProcurement` extended

Single-pass procurement now considers all own buildings as sources, sorted same-city-first then by city ordinal then by id. Filter `IsValidSource` includes warehouses (slot for the requested product), as well as the existing producer/extractor predicates.

Inter-city pulls charge `ShippingCost` = `qty × baseWorldMarketPrice × 0.10` (10% of value), product-attributed so it shows up in per-product P&L. Same-city pulls remain free.

### New ledger / report categories

- `LedgerCategory.ShippingCost` added; included in IncomeStatement operating expenses and in ProductProfitability cost.
- `SimulationConstants.InterCityShippingFraction = 0.10m`.

### Tests (10 new — total 50 passing)

Multi-city catalog:
- `All_four_cities_load`
- `Demand_in_each_city_scales_with_population_and_demographics`
- `Stores_in_different_cities_dont_compete_for_demand` ← isolation invariant

Warehouses:
- `Warehouse_stocks_from_world_market_when_no_internal_supply`
- `Warehouse_keeps_stock_across_months_no_auto_export` ← buffer doesn't leak via export
- `Retailer_pulls_from_warehouse_in_same_city` ← end-to-end warehouse→retailer
- `ConfigureWarehouseSlot_rejects_non_warehouse_buildings`

Inter-city:
- `Inter_city_pull_charges_shipping`
- `Same_city_pull_does_not_charge_shipping`
- `Same_city_source_is_preferred_over_other_city_source`

Updated:
- `Ai_eventually_serves_multiple_products_over_several_months` extended to 10 months — with 4 cities the AI fills bread × 4 before reaching soft_drink, so reaching ≥3 distinct products takes ~9 months.

### Cockpit demo

Acme now spans Metropolis (full chain) + Riverside (satellite supermarket pulling soft_drink from Metropolis with shipping cost). RivalCo expands across all 4 cities.

12-month run shows AI building 12 stores in deterministic demand-rank order: bread × 4 cities → soft_drink × 4 → t_shirt × 4. Year-1 net Acme $9.28M / RivalCo $40.5M.

### New invariants

12. **Cities don't leak demand to one another.** `AllocateDemandAndSell` keys markets by `(CityId, ProductId)`; retailers only compete with same-city peers.
13. **Inter-city pulls are explicit and costed.** `MaterialProcurement` exhausts same-city sources first, then incurs `ShippingCost` on every inter-city goods movement.
14. **Warehouses are buffers, not producers.** Their inventory doesn't auto-export; they only show up as a procurement source when a `WarehouseSlot` is configured for the requested product.

## Out of scope (Phase 1.7+)

- **Shipping lag** — goods move instantly with cost; queue/in-transit tracking is a future addition.
- **Distance-based shipping cost** — currently a flat 10% regardless of which two cities. Real distance matrix would let geography matter more.
- **Warehouse capacity / footprint** — `WarehouseSlot.TargetStock` has no physical cap.
- **Distribution-center / seaport active behavior** — currently treated identically to warehouses.
- **AI multi-city strategy** — `SimpleRetailerStrategy` already handles multiple cities (it iterates all of them) but doesn't optimize for inter-city efficiency, regional specialization, or hub-and-spoke layouts.

## Files

Added:
- `content/data/cities/{riverside,hilltown,portbay}.json`
- `engine/Magnate.Engine.Tests/MultiCityWarehouseTests.cs`
- `docs/plan/phase-1.6-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs` (`InterCityShippingFraction`)
- `engine/Magnate.Engine/Economics/Ledger.cs` (`ShippingCost` category)
- `engine/Magnate.Engine/Simulation/BuildingInstance.cs` (`WarehouseSlot` + list)
- `engine/Magnate.Engine/Simulation/World.cs` (`ConfigureWarehouseSlot`, profitability cost includes ShippingCost)
- `engine/Magnate.Engine/Simulation/MaterialProcurement.cs` (single-pass procurement, warehouse sources, shipping)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (RestockWarehouses step)
- `engine/Magnate.Engine.Tests/AiTests.cs` (10-month horizon for multi-product expansion)
- `tools/MagnateSim/Program.cs` (Riverside satellite)
