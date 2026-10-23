# Phase 3.39 — Engine cleanup follow-ups (Sprint 9)

Two required deliverables and the optional stretch all shipped. 175 → 179
engine tests pass. Schema bumped 4 → 5 (additive; v1-v4 still load).

## A. AutoExport BuildingId attribution — already in place

Investigation shows the `RecordCashChange` call inside `AutoExportSurplus`
(MonthlyTick.cs ~line 324) was already passing `building.Id` as the trailing
argument when this phase started, and the regression test
`PerBuildingPnLTests.Export_sales_carry_the_source_building_id` was already
present and passing. Sprint 8 must have closed this when the brief was being
written. No source change required for A; the named test already enforces the
invariant the brief asked for.

## B. VerticalIntegrator config round-trip — shipped

`VerticalIntegrator`'s 5 tunables (`CushionMonths`, `PriceUndercut`,
`SoloMarkup`, `PriceFloorMultiplier`, `AdBudgetPerCity`) now persist losslessly
through save/load.

- `WorldSaver.StrategyConfig` — added a `VerticalIntegrator vi =>` arm emitting
  all 5 fields with `CultureInfo.InvariantCulture` formatting, mirroring the
  `AdaptiveStrategy` arm. Keys are camelCase (`cushionMonths`, `priceUndercut`,
  `soloMarkup`, `priceFloorMultiplier`, `adBudgetPerCity`) to match the
  AdaptiveStrategy convention.
- `WorldLoader.CreateStrategy` — replaced the parameterless `new
  VerticalIntegrator()` arm with `=> BuildVerticalIntegrator(config)`.
- `WorldLoader.BuildVerticalIntegrator` — new helper following
  `BuildAdaptiveStrategy`'s shape: null/empty config falls back to defaults,
  individual missing keys also fall back via the existing `ReadDecimal` /
  `ReadInt` helpers.
- New test: `PersistenceTests.VerticalIntegrator_config_round_trips_through_save_load`.

The Sprint 7 `Save_then_load_preserves_ai_strategies` test still passes, which
covers the no-config case (default ctor) for VI as well.

## C. CogsEntry SourceBuilding — shipped (stretch)

Per-building accrual P&L is now possible. The data is recorded but not yet
consumed by the BuildingInspector — that is a future client-side phase.

- `CogsLog.cs` — added `BuildingInstanceId? SourceBuilding = null` to the
  `CogsEntry` record. Optional positional argument so existing call sites
  compile unchanged.
- `World.RecordCogs` — now accepts an optional `BuildingInstanceId?
  sourceBuilding = null` parameter, threaded into the new `CogsEntry`.
- `MonthlyTick.AllocateDemandAndSell` and `AutoExportSurplus` — both pass
  `building.Id` to `RecordCogs`.
- `WorldSaveFile.CogsEntryDto` — gained nullable `int? SourceBuildingId = null`.
- `WorldSaver` — `SchemaVersion` bumped 4 → 5; cogs serializer emits
  `c.SourceBuilding?.Value`. `MinSupportedSchemaVersion` stays at 1.
- `WorldLoader` — accepts v1-v5; null SourceBuilding for v1-v4 saves.
- New tests:
  - `PerBuildingPnLTests.Cogs_entries_carry_the_source_building_id` — both
    sale-driven and export-driven COGS recognitions carry the right building.
  - `PersistenceTests.Load_accepts_v4_save_missing_cogs_source_building` —
    backward-compat: hand-rolled v4 JSON loads cleanly with SourceBuilding=null.
  - `PersistenceTests.Cogs_source_building_round_trips_through_save_load` —
    v5 round-trip for sale-side COGS.

## Verification

```
dotnet build engine/Magnate.Engine.Tests       0 Error(s)
dotnet test engine/Magnate.Engine.Tests        179 passed (was 175)
dotnet run --project tools/ContentValidator    OK — no errors
```

The repo's client project (`Magnate.Client`) has pre-existing compile errors
in `client/scripts/Manage.cs` unrelated to this phase; per the brief these are
left for the integration agent.

## Schema delta

- `SchemaVersion`: 4 → 5
- `MinSupportedSchemaVersion`: 1 (unchanged)
- New optional field: `CogsEntryDto.SourceBuildingId` (`int?`)

## Test delta

175 → 179 (+1 VI round-trip, +1 COGS source building attribution, +1 v4
backward-compat, +1 v5 COGS round-trip).

## Notes for the integrator

- BuildingInspector accrual rewrite is unblocked but not done — the data
  source is now in place (`world.CogsLog.Entries` carry `SourceBuilding`).
- Save files written by Phase 3.39+ are v5; v4 saves still load. No migration
  needed.
- VI's invariant #24 round-trip (`load(save(W)) == W`) now holds for the AI
  configuration layer as it already did for AdaptiveStrategy.
