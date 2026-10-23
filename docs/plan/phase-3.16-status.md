# Phase 3.16 — AI strategy config persistence

**Goal**: close a documented Phase 2.8 MVP limitation — `AdaptiveStrategy`'s six tunable ctor arguments were silently reverting to defaults on save/load. Bump the save schema to v3 and round-trip the config so invariant #24 (`load(save(W)) == W`) holds for AI behavior too.

## Delivered

### Schema bump: v2 → v3

`WorldSaver.SchemaVersion` is now `3`. `MinSupportedSchemaVersion` stays at `1` — the loader still accepts v1 and v2 saves. The only difference for older saves is that `AiStrategyDto.Config` comes back as `null`, which the loader treats as "use the strategy's default ctor args" (see `WorldLoader.BuildAdaptiveStrategy`). The existing `Load_rejects_mismatched_schema_version` test still passes — the bogus payload uses `schemaVersion: 999`, which is still outside the accepted `[1, 3]` window.

### `AiStrategyDto` gains an optional `Config`

```csharp
internal sealed record AiStrategyDto(
    int CompanyId,
    string Strategy,
    IReadOnlyDictionary<string, string>? Config = null);
```

**Structure decision — string/string dictionary vs typed record.** A `Dictionary<string, string>` was chosen over a typed nested record (e.g. `AdaptiveStrategyConfigDto`) for three reasons:

1. **Extensibility.** Adding a new tunable means writing one dict entry and one parse line; no DTO change, no schema bump. That matters because `AdaptiveStrategy` is still evolving.
2. **Strategy-agnostic shape.** One field works for `AdaptiveStrategy`, `SimpleRetailerStrategy` (null → empty), and any future `AggressiveStrategy` / `PriceWarStrategy`. A typed record would force a discriminated union or one-per-strategy field.
3. **Forward-compat.** An unknown key can be ignored at load time, and a partial config (e.g. a future tool that only persists a subset) still loads cleanly because `WorldLoader.BuildAdaptiveStrategy` falls back to `new AdaptiveStrategy()` defaults for missing keys.

The trade-off is no compile-time validation of the key set. We accept that because the serializer and deserializer live next to each other in `Magnate.Engine.Persistence` and share a small, bounded key list.

### Persisted AdaptiveStrategy fields

All six `AdaptiveStrategy` ctor arguments (exposed as `{ get; }` properties) round-trip:

| Key | Type | Default |
| --- | --- | --- |
| `adBudgetPerCity`         | `decimal` | `50_000m` |
| `cushionMonths`           | `int`     | `6`       |
| `priceUndercut`           | `decimal` | `0.95m`   |
| `soloMarkup`              | `decimal` | `1.20m`   |
| `priceFloorMultiplier`    | `decimal` | `1.05m`   |
| `minCashForAdsMultiplier` | `int`     | `6`       |

Decimals/ints are formatted via `ToString(CultureInfo.InvariantCulture)` and parsed via `decimal.Parse(..., CultureInfo.InvariantCulture)` / `int.Parse(..., CultureInfo.InvariantCulture)` to stay locale-independent on disk — same policy the rest of the saver uses for `Company.Cash`, retail `Price`, etc.

`SimpleRetailerStrategy` (no tunables) writes `null`, which the serializer's `JsonIgnoreCondition.WhenWritingNull` drops from the on-disk JSON entirely. The `config` key is absent for those entries.

### `WorldLoader.CreateStrategy` gains an optional config

```csharp
private static IAiStrategy CreateStrategy(
    string name,
    IReadOnlyDictionary<string, string>? config)
    => name.ToLowerInvariant() switch
    {
        "simple" or "retailer" => new SimpleRetailerStrategy(),
        "adaptive" => BuildAdaptiveStrategy(config),
        _ => throw new InvalidOperationException($"unknown AI strategy '{name}' in save file"),
    };
```

`BuildAdaptiveStrategy` reads each key with an invariant-culture parse, falling back to the parameterless ctor's defaults when a key is missing. That means:

- **v1 save**: no `aiStrategies[].config` key → all defaults (matches pre-3.16 behavior).
- **v2 save**: same — `aiStrategies` entries were serialized without a `config` field.
- **v3 save with `SimpleRetailerStrategy`**: `config` is absent → no-arg ctor.
- **v3 save with `AdaptiveStrategy`**: `config` present → values restored exactly.
- **v3 save with partial config** (hypothetical future): missing keys → defaults for those keys.

### Tests added in `PersistenceTests.cs`

1. `AdaptiveStrategy_config_round_trips_through_save_load` — construct with all six fields non-default (75_000 / 9 / 0.92 / 1.35 / 1.10 / 8), save, load, assert exact equality on each field.
2. `AdaptiveStrategy_default_config_round_trips` — sanity check that default-constructed values also survive a round-trip (proves the config block is actually written and parsed, not silently skipped).
3. `Load_accepts_v2_save_missing_ai_strategy_config` — hand-crafted v2-shape JSON with `"aiStrategies": [{ "companyId": 1, "strategy": "adaptive" }]` (no `config` key) loads cleanly and produces an `AdaptiveStrategy` whose fields match the default ctor. Confirms backward compatibility.

## Back-compat surprises

None. The `AiStrategyDto.Config` field defaults to `null`, and System.Text.Json accepts v1/v2 JSON payloads that lack the key without error. Existing `Save_then_load_preserves_ai_strategies` and `Simulation_continues_deterministically_across_save_load` tests still pass — they compare behavior (AIs still build after reload) rather than the raw config dict, and behavior is unchanged because those tests use default-constructed strategies.

## Test-visibility change

`PersistenceTests` needs to retrieve the reconstructed strategy instance to assert on its ctor-backed properties. `World.InternalAiStrategies` is marked `internal`, so a small `[assembly: InternalsVisibleTo("Magnate.Engine.Tests")]` attribute was added near the top of `engine/Magnate.Engine/Ai/AdaptiveStrategy.cs`. This mirrors common practice for test-visible internals and keeps the public API surface unchanged. No other test file relies on this today.

## Verification

```
dotnet test engine/Magnate.Engine.Tests --logger "console;verbosity=minimal"
```

→ **147 tests pass, 0 fail** (144 pre-existing + 3 new). Ran three consecutive times to confirm determinism. No new compiler warnings were introduced (existing CS1591 XML-comment warnings are pre-existing and untouched).

## Files changed

- `engine/Magnate.Engine/Persistence/WorldSaveFile.cs` — extended `AiStrategyDto`.
- `engine/Magnate.Engine/Persistence/WorldSaver.cs` — schema 2 → 3, `StrategyConfig` helper.
- `engine/Magnate.Engine/Persistence/WorldLoader.cs` — `CreateStrategy` takes config, `BuildAdaptiveStrategy` + `ReadDecimal` / `ReadInt` helpers.
- `engine/Magnate.Engine/Ai/AdaptiveStrategy.cs` — `[assembly: InternalsVisibleTo(...)]` only; no behavioral change.
- `engine/Magnate.Engine.Tests/PersistenceTests.cs` — three new tests.

## Follow-ups

- If a third strategy with ctor tunables lands, extend `StrategyConfig` and `CreateStrategy` in the obvious way; no schema bump needed unless the dictionary representation itself becomes insufficient.
- The client's scenario-preset pipeline could now optionally read these tunables from a save and surface them in a future "AI difficulty" panel. Out of scope for this phase.
