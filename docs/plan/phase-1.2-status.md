# Phase 1.2 — Simulation Core Status

**Goal**: a deterministic monthly-tick simulation that can construct a company, build factories and retailers, execute a full month of production + retail, and reconcile P&L to cash via a transaction ledger.

## Delivered

### Simulation namespace (`Magnate.Engine.Simulation`)

| Type | Responsibility |
|---|---|
| `GameDate` | Year + Month value struct with comparison and rollover |
| `GameClock` | Holds current `Now`; `AdvanceMonth()` rolls it forward |
| `IRandomSource` / `DeterministicRandom` | Seed-reproducible RNG abstraction |
| `CompanyId`, `BuildingInstanceId` | Strongly-typed runtime ids |
| `Company` | Name, cash, owned-building list. `Cash` is mutated only through the World |
| `Inventory` | Mutable `Dictionary<ProductId, double>` with `Add` / `Take` |
| `ProductionSlot` / `RetailSlot` | Unit configuration inside a building |
| `BuildingInstance` | Constructed building: type, owner, city, inventory, slots, auto-export flag |
| `SimulationConstants` | Tunable magic numbers (currently `CyclesPerSlotPerMonth = 200`) |
| `World` | Top-level aggregate. Construction, configuration, `AdvanceMonth`, internal `RecordCashChange` |
| `MonthlyTick` | Orchestrates the monthly pipeline (details below) |

### Economics namespace (`Magnate.Engine.Economics`)

| Type | Responsibility |
|---|---|
| `LedgerCategory` | enum: StartingCapital, ConstructionCost, OperatingCost, InputPurchase, RetailRestock, ProductSale, ExportSale |
| `LedgerEntry` | Immutable record (date, company, category, amount ± signed, memo) |
| `Ledger` | Append-only log with filtered queries (`EntriesFor`, `EntriesInRange`, `NetCashFlow`, `IncomeStatement`) |
| `IncomeStatement` | Revenue / OperatingExpenses / NetIncome for a company over a date range |

### Monthly tick pipeline

```
AdvanceMonth()
  ├─ Clock +1 month
  ├─ 1. OpCost    — every building pays its type's monthlyOperatingCost
  ├─ 2. Produce   — each factory's slots buy inputs from world market at base price,
  │                 then consume inputs and add output to building inventory
  ├─ 3. AutoExport— any produced-product inventory in a factory is sold to world
  │                 market at base price (Phase 1.3 will prefer internal transfer)
  ├─ 4. Restock   — every retailer tops up each slot's inventory to RestockTarget
  │                 by buying from the world market
  └─ 5. Allocate  — for each (city, product) market, distribute city demand across
                    retailers using inverse-price weights (w = 1/price^elasticity),
                    execute sales, log ProductSale entries
```

### Invariants enforced

1. **Cash = signed sum of ledger entries** for each company (`RecordCashChange` is the only cash mutation path).
2. **Deterministic iteration order** in all multi-building / multi-market steps (sorted by id / by key).
3. **Raw products have no recipe** — the configure API rejects them.
4. **Production only in tier-compatible buildings** — `producibleTiers` gates the slot config.
5. **Prices and restock targets are positive**.

### Test coverage (`SimulationTests`)

- Clock advances and rolls over years.
- Company creation logs StartingCapital and sets cash.
- Construction charges cost and registers the building under the owner.
- Insufficient-cash construction is rejected.
- Configuring a raw product as production output is rejected.
- **Cash invariant**: after 12 months of factory + retail operation, company cash equals ledger sum.
- Factory produces output and auto-exports (ledger has InputPurchase + ExportSale; inventory ends at zero).
- Standalone factory is profitable over a year.
- Retailer sells to city consumers and logs product sales.
- Two retailers at different prices split demand inversely (cheap sells more units).
- Same seed → same final cash (determinism).

## Out of scope (Phase 1.3+)

- Internal routing: factory → warehouse → retailer. Currently retailers buy from world market, factories export to world market.
- Workers, salaries, morale.
- Quality / Brand / Technology attributes (Q/B/T).
- Raw-material extraction buildings (farms / mines / oil wells) — currently inert content; raws come from world market.
- R&D, patents.
- Advertising & brand awareness.
- AI competitors.
- Balance sheet, depreciation, credit rating.
- Multi-city demand (only the single Metropolis city is seeded).
- Daily tick (currently monthly-only; daily will drive retail-flow + price updates later).

## Files added (17)

Engine domain and simulation:
- `engine/Magnate.Engine/Simulation/GameClock.cs`
- `engine/Magnate.Engine/Simulation/Rng.cs`
- `engine/Magnate.Engine/Simulation/Ids.cs`
- `engine/Magnate.Engine/Simulation/Inventory.cs`
- `engine/Magnate.Engine/Simulation/Company.cs`
- `engine/Magnate.Engine/Simulation/BuildingInstance.cs`
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs`
- `engine/Magnate.Engine/Simulation/World.cs`
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs`
- `engine/Magnate.Engine/Economics/Ledger.cs`
- `engine/Magnate.Engine/Economics/IncomeStatement.cs`

Tests:
- `engine/Magnate.Engine.Tests/SimulationTests.cs`

## Running

.NET 8.0.420 SDK is installed at `~/.dotnet/`. With env exported:

```bash
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"

cd /Users/eddyh/Documents/2026/Games/Capitalism
dotnet build                                       # 0 warnings, 0 errors
dotnet test engine/Magnate.Engine.Tests            # 18/18 passing
dotnet run --project tools/ContentValidator        # OK — no errors
```

**Verified green on 2026-04-24**: 18 tests pass, validator confirms 16 products / 12 building types / 1 city load cleanly.

## Phase 1.3 preview

Build the slot-and-arrow internal editor semantics:
- `IMaterialSource` abstraction — world market, warehouse, or upstream factory.
- Route configuration on production/retail slots (prefer internal before external).
- Warehouse building as stock buffer.
- Start of reporting UI surface (text-only) so Phase 1.5 MVP can render it.
