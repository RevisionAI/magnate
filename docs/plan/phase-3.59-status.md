# Phase 3.59 — Building upgrades/leveling

**Status**: shipped (the original Phase 3.59 agent hit account rate limit; main agent added the missing test file + this status doc during integration).

## What landed

Each upgradeable building now has a Level 1 → 2 → 3 ladder. Level 1 mirrors the
original `MaxUnits` / `MonthlyOperatingCost` so pre-upgrade behaviour is
unchanged. Higher levels offer more slot capacity and lower per-slot opex; the
upgrade itself is a one-shot capex paid via a new `LedgerCategory.UpgradeCost`
ledger entry (treated as balance-sheet movement, NOT P&L expense — same
classification as `ConstructionCost`).

### Engine changes

- `Domain/BuildingType.cs` — added `BuildingLevelConfig(Level, Capacity, MonthlyOperatingCost, UpgradeCost)` record + optional trailing `Levels: IReadOnlyList<BuildingLevelConfig>?` parameter on `BuildingType` (null = no upgrade path).
- `Simulation/BuildingInstance.cs` — `int Level { get; internal set; } = 1`.
- `Simulation/World.cs` — `UpgradeBuilding(BuildingInstanceId)` (deducts upgrade cost via ledger, increments level, throws on max-level / no-Levels-config / insufficient cash); `GetCapacity(BuildingInstance)` and `GetMonthlyOpex(BuildingInstance)` helpers reading the ladder.
- `Simulation/MonthlyTick.cs` — `ChargeOperatingCosts` now reads `world.GetMonthlyOpex(building)`.
- `Economics/Ledger.cs` — added `LedgerCategory.UpgradeCost`.
- `Economics/IncomeStatement.cs` / `World.GetIncomeStatement` — `UpgradeCost` is excluded from P&L (capex, mirroring `ConstructionCost`).
- `Content/ContentLoader.cs` — parses optional `levels` array.
- `Persistence/WorldSaver.cs` + `WorldLoader.cs` + `WorldSaveFile.cs` — `BuildingDto.Level = 1` (default); schema bumped 7 → 8; v1-v7 saves load with all buildings at Level 1.

### Content changes

`content/data/buildings/retail.json` and `content/data/buildings/production.json` opted in:

- `supermarket`: L1 cap=6 opex=$15k; L2 cap=9 opex=$12.75k upgrade=$720k; L3 cap=12 opex=$10.5k upgrade=$600k.
- `factory_small`: L1 cap=6 opex=$20k; L2 cap=9 opex=$17k upgrade=$900k; L3 cap=12 opex=$14k upgrade=$750k.
- `factory_large`: L1 cap=12 opex=$55k; L2 cap=18 opex=$46.75k upgrade=$3M; L3 cap=24 opex=$38.5k upgrade=$2.5M.
- `large_farm`: L1 cap=3 opex=$4k; L2 cap=4 opex=$3.4k upgrade=$150k; L3 cap=6 opex=$2.8k upgrade=$125k.
- `oil_well`: L1 cap=2 opex=$25k; L2 cap=3 opex=$21.25k upgrade=$1.5M; L3 cap=4 opex=$17.5k upgrade=$1.25M.

Other building types (rd_center, tv_station, warehouses, etc.) have no `levels` config — they remain Level 1 forever and `UpgradeBuilding` throws on them.

## Tests

`engine/Magnate.Engine.Tests/BuildingUpgradeTests.cs` (NEW) — 8 tests:

1. New buildings default to Level 1.
2. `UpgradeBuilding` deducts cost via `UpgradeCost` ledger entry, increments level.
3. Sequential upgrade 1→2→3 works; further attempts throw.
4. `GetCapacity` + `GetMonthlyOpex` track current level on supermarket across L1/L2/L3.
5. Monthly opex ledger amount reflects level (verifies the tick uses the helper).
6. Insufficient cash throws without mutating state.
7. Non-upgradeable type (`rd_center`, no `Levels` config) throws.
8. Save/load round-trips Level on a v8 save.

Test count: 211 → 219 (+8).

## Schema migration

- `WorldSaver.SchemaVersion = 8`.
- `MinSupportedSchemaVersion = 1` unchanged.
- `WorldLoader` accepts `BuildingDto.Level` missing from JSON via `Level = 1` default on the DTO; existing v7 (and earlier) saves load with every building at Level 1.

## Known follow-ups

- Client UI for triggering upgrades (BuildingInspector or Manage). Currently only callable via engine API.
- AI strategies don't use `UpgradeBuilding` yet. AdaptiveStrategy / VerticalIntegrator / TechLeader could opt into upgrades when retail saturates and cash is plentiful.
- `Levels` array currently has no schema validation in `content/schemas/building.schema.json`; relies on `ContentLoader` runtime checks (level numbering, ascending order). A future polish phase could tighten the schema.
