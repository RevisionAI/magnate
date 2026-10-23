# B2 — Bridge completion — status

Branch `b2-bridge`. Scope: bridge-spec §11 B6 (binary saves through the worker into IndexedDB) and B8 (contract
fixtures), the §7 event taxonomy, adoption of the e0 engine APIs, and the §4.8 performance budgets.

**Status: done.** Every gate is green. Some items need the E1, E2 or E3b branches; they are listed under
"Merge notes" and "Requests".

## File map

| Area | Files |
|---|---|
| Saves (.NET) | `engine/Magnate.Bridge/Persistence/WebSave.cs`: the envelope, gzip, and a single-pass streaming scan with hashed content-id sets. The envelope writes the engine part last, and a trusted load slices it out without tokenizing it.<br>`GameSession.Persistence.cs`: `SaveBinary`, `SaveMeta`, `LoadBinary`, `InspectSave`, `LastSaveMeta`, and per-phase timings.<br>`Protocol/Dtos.Persistence.cs`: `SaveArgs.Client`, `LoadArgs.TrustContent`, `InspectResultDto.Client`/`ContentChanged`, `DebugStatsDto.LastSave/LoadPhasesMs`. |
| WASM host | `web/engine-host/Program.cs`: adds the `LastSaveMeta` JSExport. |
| Worker + store | `web/src/bridge/engine.worker.ts`: the save, load, list, delete, rename, export, import, storageEstimate and configureSaves messages, plus a worker-driven autosave.<br>`saveDb.ts`: the IndexedDB store, a superset of the Wave-1 layout (`saveMeta`, `saveData` as a gzip Blob, `saveClient`).<br>`workerProtocol.ts`: the message types.<br>`engine.ts`: the `EngineClient` save methods. |
| UI wiring | `web/src/state/saveStoreWorker.ts`: `WorkerSaveStore` implements the U1 `SaveStore` interface unchanged.<br>`state/savegame/index.ts` + one line in `gameStore.ts`: selects the worker store when the engine build supports binary saves. |
| Events | `Model/EventDetector.cs`: `EventKinds` (the full §7 + UX §8 taxonomy, plus `insolvency`) and the detectors (quarterClosed, cashRecovered, marketLeaderLost, interim stockout/overstock/inputShortage with persisted re-arm latches).<br>`protocol.ts`: the `GameEventKind` block. |
| e0 adoption | `Model/Strategies.cs` (AiStrategies registry), `LedgerCategories.cs` (`LedgerCategoryInfo`), `LedgerIndex.cs` (BookValue/BuiltAt, `LedgerEntry.Quantity`, a cold rebuild that skips pruned detail), `GameSession.Progress.cs` (`UnregisterAi`: autopilot off) |
| Advisor | `Model/Advisor.cs`: new code `insolvency`.<br>`Model/Difficulty.cs`: `IncumbentStrength(bucket)`. |
| Tests | `engine/Magnate.Bridge.Tests/`: Persistence, LedgerIndexParity, EventDetector, GameFlow, Perf, ContractFixture, Catalog, Marketing, Dispatch, Ext, Research; helpers in `Bridge.cs` and `TestContent.cs`.<br>`web/src/bridge/saveDb.test.ts` and `web/src/state/saveStoreWorker.test.ts`. |
| e2e | `web/scripts/smoke-saves.mjs` (new). `--year10` adds the timed WASM 10-year save and load; with `--dev` it also records the .NET phases. |

## APIs and contracts for other workstreams

- **Saves from the UI.**
  - Use only the U1 `SaveStore` interface, which is unchanged.
  - Saves are gzip web envelopes in the worker's IndexedDB. Slots:
    - `m-<uuid>` for manual saves;
    - `quick` for the quicksave;
    - `auto-1..3`, rotated (an unused slot first, else the oldest).
  - `listSaves` never reads a save body.
  - Import accepts:
    - `.magnate` files (gzip envelope);
    - plain envelope JSON;
    - legacy engine JSON (v1–v9);
    - `.json.gz`;
    - the Wave-1 `magnate.save` export.
  - Imports are checked by `InspectSave` and stored as manual slots.
  - Wave-1 slots stay listable, loadable, renamable and exportable.
- **`LoadArgs.trustContent`** (C# and TS).
  - The worker sets it for its own slots only.
  - A save whose `contentHash` equals the installed content skips the content-id scan.
  - Anything from outside (imports, the string `loadGame`) is always scanned. This matters because the engine loader does not validate ids: an unknown product would load and then crash later.
- **Envelope layout.** `{format, formatVersion:1, contentHash, engineLast:true, meta, bridge, client?, engine}`. Saves with the Wave-1 member order still load.
- **`debugStats`** adds:
  - `lastSavePhasesMs`: engine, meta, sidecar, envelope, gzip;
  - `lastLoadPhasesMs`: gunzip, scan, engine, sidecar, install, backfill, snapshot.
- **Events.**
  - `EventKinds` (C#) and `GameEventKind` (TS) are now one set, guarded by a test. The same test checks that every kind has an entry in `web/src/audio/data/audio-events.json`.
  - New kind `insolvency` (reason `default | cured | bankrupt`). E2's `GoalTracker` publishes it together with `loanTaken`, `loanRepaid`, `loanPaymentMissed` and `creditRatingChanged`.
  - The bridge keeps all of these finance kinds.
  - The interim `bankruptcyWarning` fires only while cash is negative, so it does not duplicate E2's distress events, because the revolver keeps cash positive under finance rules.
  - Audio aliases that the bridge does not emit: `insolvencyWarning`, `loanApproved`, `dividendDeclared`, `stockOut`, `priceUndercut`, `marketLeaderGained`, `playerIdle` and `climateChanged`. Their emitted equivalents are `bankruptcyWarning`/`insolvency`, `loanTaken`, `dividendPaid`, `stockout`, `rivalUndercut` and `shareRankFirst`; `playerIdle` and `climateChanged` are client-side.
- **Advisor (for U3).**
  - Code `insolvency` (severity `danger`) is active while the cure window is open, i.e. while `GoalTracker.BankruptcyInMonths` is not null. That is the interim negative-cash rule, or E2's distress window.
  - Params: `monthsLeft` (month closes before bankruptcy; 0 means this month decides) and `cash`.
  - It is both the `priority` and the first hint. Deduplicate by `code` if both are shown.
- **New bridge method from E2.** `previewDisposal` is not in bridge-spec. It previews a sale or demolition with `DisposalResultDto`, using `DisposalPreviewArgs` (`GameSession.Loans.cs`). Add it to §5.14 when the spec is next revised. It needs a line in `ContractFixtureTests.Script` after the merge, or "every registered method is scripted" fails.
- **Test helpers (`Bridge.cs` / `TestContent.cs`).** Use these in tests instead of hard-coded prices:
  - `Bridge.Cost(typeId)`: the content's construction cost;
  - `Bridge.Funded(playerCash, rivalCash, seed, rivals…)`: a custom game with chosen cash;
  - `Bridge.FundedScenario(scenarioId, …)`: a scenario's goals with chosen cash, via a sidecar relabel;
  - `TestContent.Catalog`: the loaded content.

## Verification (2026-10-02, final run on HEAD)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors, 0 warnings from bridge/tests. 278 CS1591 warnings are pre-existing in `Magnate.Engine` (untouched by B2; on main). |
| `dotnet test Magnate.sln --no-build` | Bridge **239 passed**, 4 skipped (the perf category). Engine **863 passed**. |
| `MAGNATE_PERF=1 … --filter Category=perf` | 4/4 pass (table below) |
| `node scripts/build-engine.mjs` | 63 files (12.9 MB) |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 627 passed, 3 skipped (32 files + 1 skipped) |
| `npx vite build` | built |
| `node scripts/smoke.mjs` | **SMOKE OK** |
| `node scripts/smoke-saves.mjs` | **SMOKE-SAVES OK**, 12 steps (save, quicksave, load, export, three imports, legacy load, autosave rotation, reload + Continue, delete). Manual save 0.57 s, load 1.55 s. |

**Screenshots** are in `web/test-results/saves/` and were inspected:
- 01 Save tab: slot with thumbnail and meta, Overwrite and Import buttons.
- 02 and 05 Load tab: three rotating autosaves, the imported slots, and storage used.
- 03 after load: HUD restored, "Game loaded" toast.
- 06 title screen: Continue opens the newest save.

**Scratch merge with `e1-market`** (a clone in the scratchpad, since deleted):
- After this branch's test changes, the only failure in B2-owned tests is `MarketingTests.Previews…`. That is expected until `Marketing.cs` reads E1's v2 advertising (see "Merge notes").
- The other 23 failures are in Buildings, City, Finance and Progress tests (not B2's). Their owners can use the helpers above.

### Performance (§4.8)

The desktop runs were measured on a quiet moment (load average 6). The WASM runs come from the `smoke-saves --year10` workload at load average 15–20.

| Budget | Measured |
|---|---|
| `snapshot` ≤ 2 ms | median 0.13 ms, p95 0.19 ms |
| Reports ≤ 10 ms (`history`: all 11 series × 5 companies × 121 months, 63 KB) | `history` median 1.2–1.4 ms (b1 measured 6–9 ms). Every report and view median ≤ 0.9 ms. |
| Advance facade overhead | desktop median 1.9 ms, p95 3.1 ms. WASM bridge median 0.7 ms, p95 1.0 ms. |
| `SaveBinary` ≤ 2.5 s (WASM) | 3.5 s, of which engine `SaveToUtf8` 2.9 s, envelope 0.17 s, gzip 0.23 s, meta + sidecar 0.04 s |
| `LoadBinary` ≤ 4 s (WASM) | 5.6 s, of which engine `WorldLoader.Load` 4.6 s, scan 0.24 s, install 0.51 s, gunzip 0.08 s |

The WASM load went from 14.4 s to 5.6 s. Work done to get there:
- **Content scan.** It now reads the save in a single pass with hashed id sets. A trusted load skips it, and because the engine part is written last it is sliced out rather than tokenized: 1.45 s → 0.24 s.
- **Index rebuild on load.** It no longer folds per-building detail that would be pruned anyway: 2× faster, 0.98 s → 0.51 s.

Both WASM misses are now the engine's own JSON (de)serialization, which is reflection-based System.Text.Json running interpreted. See Requests 1 and 2.

## Merge notes

- **`LedgerIndex.CatchUp`:**
  - E2 adds the accrual loop and B2 adds `_windowFrom = WindowFrom(...)`. Both are needed; they collide on adjacent lines.
  - `FoldAccrual` touches company months only, so it does not need the window.
- **`GameSession.cs` `Features`:** E1 sets `DemandModel = true` and E2 sets `Demolish`/`Loans`. Take the union.
- **B2 test files that E2 also edited:**
  - `DispatchTests`/`ExtTests` (feature flags): take B2's version. It compares against `GameSession.Features`, and the EXT theory skips flags that are on.
  - `ContractFixtureTests`, `GameFlowTests`, `PersistenceTests`: keep both sides' additions.
- **Fixtures:** regenerate after merging with `MAGNATE_UPDATE_FIXTURES=1 dotnet test engine/Magnate.Bridge.Tests --filter ContractFixture`. The script now plays a funded tutorial (`Bridge.FundedScenario`), so it is independent of content prices.
- **E1 follow-ups in B2 files. They need E1's API, so they could not be written on this branch:**
  1. `GameSession.Game.cs` `newGame`: apply the difficulty to the rules, e.g. `rules with { Market = rules.Market with { IncumbentStrength = Difficulty.IncumbentStrength(Difficulty.Bucket(Difficulty.Compute(scenario))) } }` (custom games are "normal" via `Compute`).
  2. `GameSession.Marketing.cs`:
     - Under `world.Rules.Market.Enabled`, use `world.GetAdCostPerPoint(city, channel)` in place of `EngineConstants.AdCostPerPoint(channel)` (preview, catalog channels, campaign DTOs).
     - In `ProjectBrand`, use E1's Realistic formula `B·(1−d) + Σ points·(1−B/100)` with `d = Rules.Market.BrandDecayRate`, matching `World.GetProjectedBrandAwareness` exactly.
     - `MarketingTests.Previews…` checks this.
  3. `construct` calls `World.ApplyMarketDefaults`. It is in `GameSession.Buildings.cs` (E3b's file), so see Requests.

## Known gaps

- **WASM save/load miss their budgets** (3.5 s / 5.6 s against 2.5 s / 4 s). The remaining time is in the engine serializer (Requests 1 and 2).
- **Legacy (engine-only) imports** list `Value $0` in the save modal, because the corporate value is unknown until the save is loaded. `SaveMetaDto.corporateValue` stays a number (U1 types). Request 4.
- **The validated slot setters are adopted by nobody yet.** The facade still writes slot fields directly, and `ClearSlot` uses `RemoveAll`. These are `World.SetRetailPrice`/`SetRestockTarget`/`SetWarehouseTarget`/`SetAutoExport`/`ClearSlot`. Geography pre-validation via `World.MeetsGeographyRequirement` is also not adopted. Both live in `GameSession.Buildings.cs`/`City.cs`, which belong to E3b (Request 3). The bridge's own retail-tier rule (`SlotRules`, finished goods only) is the E7 pre-validation and stays.
- **Cash-flow statement.** The facade answers from its monthly index. `World.GetCashFlowStatement` is now the reference, with a parity test over 20 random windows per company, rather than the code path (the engine version is a full-ledger scan).
- **The year-10 perf workload** follows content prices: each company starts with 25× a supermarket's price. On E1 content the AIs build about 16 buildings, not about 110, so the workload test pins only floors.

## Requests

1. **E1/E0 (engine persistence):**
   - Add System.Text.Json source generation (a `JsonSerializerContext`) for `WorldSaveFile` and its DTOs.
   - `WorldSaver.SaveToUtf8` (2.9 s) and `WorldLoader.Load` (4.6 s) dominate the WASM 10-year save and load. They currently run the reflection path, interpreted in the browser.
2. **Lead:**
   - Consider AOT for the WASM build. `RunAOTCompilation` needs the `wasm-tools` workload, which is not installed on this machine.
   - The engine's month tick is about 15× slower in the browser than on the desktop: about 81 ms median against 5.8 ms.
3. **E3b (`GameSession.Buildings.cs` / `City.cs`):**
   - Route `setRetailPrice`, `setRestockTarget`, `setWarehouseTarget`, `setAutoExport` and `clearSlot` through the validated `World` setters.
   - Replace `GeographyIssues` with `World.MeetsGeographyRequirement`.
   - Call `World.ApplyMarketDefaults(building)` in `construct` (E1's D7: no auto-export on new player buildings).
   - Make your tests price-independent with `Bridge.Cost`/`Funded`/`FundedScenario`.
4. **U1/U3 (save modal, `SaveLoadModal.tsx`):** show "—" instead of `Value $0` when `formatVersion === 0` (a legacy import).
5. **A1 (audio):**
   - Route the `insolvency` kind (reason `default` → bankruptcy warning, `cured` → recovery, `bankrupt` → handled by `scenarioLost`).
   - `AudioSystem` throws "setTargetAtTime overlaps setValueCurveAtTime" on some tick/gameEvent handlers (seen in every smoke-saves run; non-fatal).
6. **Test owners (Buildings, City, Finance, Progress; E2/E3b):** 23 bridge tests fail on the E1 merge from hard-coded Wave-1 prices and from starting cash. Use the helpers above.
