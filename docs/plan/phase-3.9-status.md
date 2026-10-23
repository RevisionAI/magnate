# Phase 3.9 — Save file v2 (scenario + player metadata)

**Goal**: round-trip the active scenario id and the player company id through the save file so that after load the Goals tab renders and `SaveBrowser` stops guessing at the player. Keep v1 saves loadable.

## Delivered

### Schema bump: v1 → v2

`WorldSaver.SchemaVersion` is now `2`. A new `WorldSaver.MinSupportedSchemaVersion = 1` constant lets the loader accept any version in the `[1, 2]` window. The version-rejection test now targets `999` (an out-of-range future version) rather than "any non-equal" number.

### Two optional fields on `WorldSaveFile`

```csharp
internal sealed record WorldSaveFile(
    ...,
    // v2 additions — optional to stay compatible with v1 saves.
    string? ScenarioId = null,
    int? PlayerId = null);
```

The JSON writer is configured with `DefaultIgnoreCondition = WhenWritingNull`, so v1-shape saves (no scenario/player) still serialize without the two new keys. That keeps the on-disk JSON clean and means tests can assert the keys are absent when the caller doesn't pass them.

### `WorldSaver.Save` gains two optional parameters

```csharp
public static void Save(
    World world,
    string path,
    string? scenarioId = null,
    CompanyId? playerId = null)
```

Existing callers (MagnateSim's demo scenarios, the engine tests that don't care) keep working without source changes. The client's `Main.OnSave` now passes `GameState.ActiveScenario?.Id` and `_playerId`.

### `WorldLoader.Load` returns a result type

```csharp
public sealed record WorldLoadResult(World World, string? ScenarioId, CompanyId? PlayerId);

public static WorldLoadResult Load(ContentCatalog catalog, string path);
```

Metadata is `null` for v1 saves and for v2 saves where the saver didn't provide it — callers fall back to their pre-3.9 heuristics in that case.

### `SaveBrowser.cs`

After `WorldLoader.Load`:

1. `GameState.PlayerId = result.PlayerId ?? first-company-by-id` (old heuristic as a v1 fallback).
2. If `result.ScenarioId` is set, `ScenarioLoader.LoadAll(...)` resolves it in `content/scenarios/`; on hit, `GameState.ActiveScenario` and `GameState.ScenarioName` get the real scenario. On a miss we `GD.PushWarning` but don't fail the load.

Missing-scenario and load-error paths are wrapped defensively — a partially valid save (v2 metadata pointing at a scenario that doesn't exist on disk) still loads into a playable world, it just has `ActiveScenario == null` and the Goals tab stays empty.

### `MagnateSim/Program.cs`

Only `RunFromSave` touched `WorldLoader.Load` directly. Now it unwraps `.World` and surfaces scenario / player metadata in the startup banner when present.

### Tests

`engine/Magnate.Engine.Tests/PersistenceTests.cs`:

- Every existing `var loaded = WorldLoader.Load(...)` is now `WorldLoader.Load(...).World` — all 8 prior round-trip tests still pass unchanged in intent.
- **New** `Save_round_trips_scenario_and_player_metadata` — writes with explicit `scenarioId`/`playerId` and asserts they come back intact.
- **New** `Save_without_metadata_leaves_fields_null` — confirms nulls round-trip, and asserts the on-disk JSON doesn't contain `scenarioId` / `playerId` keys (ignore-null writer behavior).
- **New** `Load_accepts_v1_save_with_missing_metadata_fields` — a hand-crafted v1 payload (no metadata fields) loads with `ScenarioId` and `PlayerId` both `null`. This is the backward-compat guarantee in test form.
- **New** `Save_with_metadata_still_deterministic_across_chain_simulation` — invariant #24. Two parallel chain-built worlds advance 12 months; the second saves v2 metadata at month 6 and reloads; final cash, ledger entry count, transfer count, COGS count, and tech level all match.

## Build status

| | |
|---|---|
| `dotnet build` (solution) | 0 warnings, 0 errors |
| `dotnet test` (engine) | **129/129 passing** (125 prior + 4 new) |
| `dotnet build client` | 0 warnings, 0 errors |
| Godot smoke test | **11/11 OK** |

## Files

Modified:
- `engine/Magnate.Engine/Persistence/WorldSaveFile.cs` — added `ScenarioId`, `PlayerId` optional fields.
- `engine/Magnate.Engine/Persistence/WorldSaver.cs` — bumped schema, added optional params, `WhenWritingNull` ignore condition.
- `engine/Magnate.Engine/Persistence/WorldLoader.cs` — new `WorldLoadResult` return type, `MinSupportedSchemaVersion` window check.
- `engine/Magnate.Engine.Tests/PersistenceTests.cs` — unwrap `.World` in existing tests, four new tests.
- `client/scripts/SaveBrowser.cs` — resolve scenario via `ScenarioLoader`, use `result.PlayerId` with v1 fallback.
- `client/scripts/Main.cs` — `OnSave` now passes scenario id + player id.
- `tools/MagnateSim/Program.cs` — `RunFromSave` unwraps `.World`, surfaces metadata.

## Notes / decisions

- **`WorldLoadResult` as a record, not a tuple.** Tuples are anonymous and leak through public API signatures; a named record is self-documenting and lets future metadata (e.g. save-time seed, UI camera position) slot in without breaking callers.
- **Ignore-null JSON writer.** Without `WhenWritingNull`, every v2 save from a caller that doesn't pass metadata (e.g. MagnateSim's demo mode) would emit `"scenarioId": null, "playerId": null`. Cleaner to omit them — and it gives us a cheap test assertion that those keys don't leak into "pure simulation" saves.
- **Version window is `[1, 2]`, not `== 2`.** The previous behavior rejected anything non-equal; that would have blocked v1 saves we explicitly want to keep. The new check is also ready for the next bump: only the upper bound moves.
- **Client `Main.cs` was edited.** It's not in the "don't touch" list, and without it the save path produced v1-shape files (no metadata), defeating the point. The change is a single call-site update — `WorldSaver.Save(_world, path, GameState.ActiveScenario?.Id, _playerId)`.
- **`HeadlessSmokeTest.cs` already spelled `reloaded.World.Companies`.** It was pre-adapted to the new API before Phase 3.9 landed (presumably by the agent owning that file). The smoke test compiles and passes without any edit from me.
