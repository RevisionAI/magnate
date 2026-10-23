# Phase 1.1 — Status

**Goal**: data-driven content layer + engine domain types that deserialize it, validated both by JSON Schema and by engine semantic rules.

## Delivered

### Content
- **Schemas** (`content/schemas/`): `product.schema.json`, `building-type.schema.json`, `city.schema.json` — JSON Schema 2020-12.
- **Seed data** (`content/data/`):
  - **Products** (16): 5 raws (sugarcane, wheat, cotton, iron_ore, crude_oil), 6 intermediates (sugar, flour, cotton_fabric, steel, plastic, electronic_parts), 5 finished (soft_drink, bread, t_shirt, television, car). Recipes chain back to raws.
  - **Buildings** (12): farms, mine, oil well, 2 factory sizes, 3 retail sizes, 2 warehouses, seaport.
  - **Cities** (1): Metropolis — 500k population, 80×80 grid, coastal, arable.

### Engine (`engine/Magnate.Engine`)
- Pure C# class library, zero Godot dependency (per ADR-0001).
- Domain records: `Product`, `Recipe`, `RecipeInput`, `BuildingType`, `Footprint`, `HeadcountRange`, `GeographyRequirement`, `City`, `CityGrid`, `CityGeography`.
- Strongly-typed ids: `ProductId`, `BuildingTypeId`, `CityId`.
- `ContentLoader.Load(contentRoot)` — parses JSON, maps to domain, runs semantic validation, returns immutable `ContentCatalog` or throws `ContentLoadException` with all errors collected.

### Semantic rules enforced by the loader
1. Raw products must NOT have a recipe.
2. Intermediate / finished products MUST have a recipe.
3. Recipe inputs reference existing products.
4. No recipe self-reference.
5. City demographic shares sum to 1.0 (±0.001).
6. Building `targetHeadcount.min <= max`.
7. Duplicate ids are rejected.

### Tests (`engine/Magnate.Engine.Tests`)
- xunit test suite: loads the seed catalog and asserts invariants including a cost-sanity check that each finished good's input cost at world prices stays below its sale price (catches mis-calibrated recipes).

### Validator CLI (`tools/ContentValidator`)
- `magnate-validate` binary. Runs JSON Schema validation (JsonSchema.Net) + engine semantic validation and prints aggregated errors.
- Usage: `dotnet run --project tools/ContentValidator [optional content root]`

## Setup required (not yet installed on this machine)

The code is written but nothing has been built or run. You need:

1. **.NET 8 SDK** (matches `global.json`):
   - macOS: `brew install --cask dotnet-sdk` or installer from https://dotnet.microsoft.com/download/dotnet/8.0
2. **Godot 4 with .NET/C# support** (for later phases; not required for Phase 1.1):
   - macOS: `brew install --cask godot-mono` or download from https://godotengine.org/download — make sure to pick the **.NET** build.

Once .NET is installed:

```bash
cd /Users/eddyh/Documents/2026/Games/Capitalism
dotnet restore
dotnet build
dotnet test engine/Magnate.Engine.Tests
dotnet run --project tools/ContentValidator
```

The test suite and validator should both pass on first run.

## What's next — Phase 1.2 preview

Simulation core:
- Tick scheduler (daily + monthly).
- Company / Building instance / Inventory entities.
- Recipe solver (consume inputs, produce outputs, charge labor).
- Demand solver (per product × city × bracket).
- Transaction ledger → P&L and cash-flow queries.
- Deterministic seeded RNG.
- Property tests for accounting invariants.
