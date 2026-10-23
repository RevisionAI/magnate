# Phase 3.18 — Two new win-condition scenarios

**Agent:** A
**Date:** 2026-04-24
**Status:** Complete

## Goal

Add 2 new scenario JSON files exercising the scenario/goal machinery built in Phase 3.13, using existing goal types only (no engine changes).

## Files changed

- **New** `content/scenarios/export_tycoon.json` — single `ExportRevenueGoal` ($5M within 5 years, $8M starting cash, no AI competitors).
- **New** `content/scenarios/brand_monopolist.json` — three `TopBrandGoal` entries for `soft_drink` at threshold `70.0` across `metropolis`, `eastside`, `riverside`. Starting cash $20M, no AI competitors.
- **Modified** `engine/Magnate.Engine.Tests/ScenarioTests.cs` — appended a Phase 3.18 section with two new `[Fact]` tests (existing tests untouched).

## Tests added

1. `Export_tycoon_scenario_loads_with_single_export_revenue_goal` — asserts a single `ExportRevenueGoal` with `Amount = 5_000_000m` and `StartDate` stamped from the scenario start (`2026/1`).
2. `Brand_monopolist_scenario_loads_with_three_top_brand_goals` — asserts three `TopBrandGoal` entries, all targeting `soft_drink` at threshold `70.0`, with three distinct cities.

## Verification

```
dotnet run --project tools/ContentValidator --no-build
  → Loaded 22 products, 14 building types, 5 cities.
  → OK — no errors.

dotnet build (solution)
  → Build succeeded. 0 Warning(s), 0 Error(s).

dotnet test engine/Magnate.Engine.Tests --no-build
  → Passed: 149, Failed: 0, Skipped: 0, Total: 149
```

Test count went from 147 → 149 (+2 as expected). Scenario catalog grew from 7 → 9 scenarios.

## Notes

- No engine code touched. Both scenarios rely entirely on existing loader goal mappings (`exportRevenue`, `topBrand`).
- Per phase guidance, no fail condition / time cap was needed for `export_tycoon` — scenarios evaluate win conditions only.
- Cities chosen for `brand_monopolist` (metropolis, eastside, riverside) are all present in `content/data/cities/`.
