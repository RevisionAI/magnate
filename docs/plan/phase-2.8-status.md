# Phase 2.8 — Save / load

**Goal**: a running Magnate game can be persisted to disk and resumed later, with identical state and deterministic continuation. Prerequisite for the Godot client to feel like a real game rather than a one-shot CLI run.

## Delivered

### `Magnate.Engine.Persistence` namespace

| Type | Responsibility |
|---|---|
| `WorldSaveFile` (internal DTO) + typed sub-records | JSON schema: seed, clock, next ids, companies, buildings (with inventory + all slot kinds), tech, brand awareness, research progress, ad campaigns, AI strategies, ledger, transfers, COGS |
| `WorldSaver.Save(world, path)` | Serializes every scrap of runtime state to JSON. Decimals stored as invariant-culture strings for exact round-trips. |
| `WorldLoader.Load(catalog, path)` | Rebuilds a fresh `World` from a save file. Content catalog supplied separately — saves don't embed catalog data. |

### Schema versioning

`WorldSaver.SchemaVersion = 1`. Loader rejects mismatched versions with a clear error. A migration path is trivial to add when v2 arrives (detect version, transform DTO).

### Strategy round-trip

AI strategies have no internal state so we serialize a name discriminator:

| `IAiStrategy` | Name |
|---|---|
| `SimpleRetailerStrategy` | `"simple"` |
| `AdaptiveStrategy` | `"adaptive"` |

Loader has a factory that reconstructs the strategy by name. Strategy constructor args (AdBudgetPerCity, CushionMonths, etc.) revert to defaults on reload — known MVP limitation, documented.

### Engine-internals exposed to Persistence (same assembly)

```csharp
// on World:
internal int InternalNextCompanyId  { get; set; }
internal int InternalNextBuildingId { get; set; }
internal Dictionary<CompanyId, Company>                                        InternalCompanies;
internal Dictionary<BuildingInstanceId, BuildingInstance>                      InternalBuildings;
internal Dictionary<CompanyId, IAiStrategy>                                    InternalAiStrategies;
internal Dictionary<(CompanyId, ProductId), int>                               InternalTech;
internal Dictionary<(CompanyId, ProductId, CityId), double>                    InternalBrandAwareness;
internal Dictionary<(CompanyId, ProductId), double>                            InternalResearchProgress;
internal Dictionary<(CompanyId, ProductId, CityId, AdChannel), AdCampaign>     InternalAdCampaigns;

// on GameClock:
public GameDate Now { get; internal set; }  // was private set
```

Public API remains encapsulated; only the persistence layer reaches the internals.

### Tests (10 new — total 120 passing)

Round-trip:
- `Save_then_load_preserves_empty_world`
- `Save_then_load_preserves_companies_and_cash`
- `Save_then_load_preserves_buildings_and_slots` (all 5 slot kinds — production, extraction, warehouse, retail, research)
- `Save_then_load_preserves_inventory_including_cost_and_quality` ← locks WAC + quality-mass
- `Save_then_load_preserves_tech_brand_and_research_progress`
- `Save_then_load_preserves_ad_campaigns`
- `Save_then_load_preserves_ai_strategies` ← after reload, advancing a month still builds stores
- `Ledger_transfer_and_cogs_logs_round_trip`

The big one:
- `Simulation_continues_deterministically_across_save_load` — two parallel 12-month runs; one continuous, one with a save/load at month 6. Final cash, ledger length, and tech level must match bit-for-bit.

Schema safety:
- `Load_rejects_mismatched_schema_version`

### Cockpit flags

```bash
magnate-sim 12 --save /tmp/acme.json                  # default scenario, save at end
magnate-sim --load /tmp/acme.json 6                    # resume and advance 6 more
magnate-sim --scenario soft_drink_war --auto-player 24 --save run.json
magnate-sim --load run.json                            # see final state from the save
```

`--save` and `--load` work across all three run modes (default, scenario, load).

### Demo

Save after 6 months (55 KB JSON on disk), load, continue 6 more — final state matches the uninterrupted 12-month run exactly:

```
Continuous run (12 months):       $40,117,954 cash
6 mo → save → load → 6 mo:        $40,117,954 cash    ✓
```

## New invariant

24. **Save/load is lossless and deterministic.** For any world W:
    ```
    load(save(W)) == W         (state equality)
    advanceN(load(save(W))) == advanceN(W)  (trajectory equality)
    ```
    The invariant is enforced by `Simulation_continues_deterministically_across_save_load`.

## Out of scope (future)

- **SQLite backend** — ADR-0001 originally mentioned SQLite. JSON was faster to ship and more debuggable; a future phase can swap to SQLite for larger saves (append-only ledger becomes hundreds of MB over a 50-year game) and partial querying. The save-file DTO shape is stable enough to move to a different storage layer without changing the public API.
- **Strategy config serialization** — strategy constructor arguments are lost on reload (reset to defaults). Phase 2.4.1 adds personality variants; when that lands, bundle config into the save.
- **Schema v2 migrations** — only v1 exists. Infrastructure is in place (version check); actual migration code can wait for the first breaking change.
- **Compression** — JSON is human-readable but verbose. Long games may want gzip around the stream. Trivial add when saves get big.
- **Auto-save** — no periodic write-through. The cockpit only saves at end on `--save`.

## Files

Added:
- `engine/Magnate.Engine/Persistence/WorldSaveFile.cs`
- `engine/Magnate.Engine/Persistence/WorldSaver.cs`
- `engine/Magnate.Engine/Persistence/WorldLoader.cs`
- `engine/Magnate.Engine.Tests/PersistenceTests.cs`
- `docs/plan/phase-2.8-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/GameClock.cs` (`Now` setter now internal)
- `engine/Magnate.Engine/Simulation/World.cs` (internal accessors on all runtime-state maps + next-id fields)
- `tools/MagnateSim/Program.cs` (`--save`, `--load` flags across all run modes)
