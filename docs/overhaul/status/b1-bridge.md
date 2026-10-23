# B1 — Bridge (C# facade + TypeScript protocol) — status

Branch `b1-bridge`. Scope: bridge-spec §11 steps B0, B1, B2 (interim placement §4.6.10), B3, B4, B5, B7, plus the
parts of B6 (web save envelope, binary JSExports) and B8 (contract fixtures, perf category) that fit Wave 1.
Built only against today's public engine API.

**Status: done.** Every method in the §5.14 `Methods` map is registered (75 C# handlers). `cityLayout` is the
exception: it is typed in TypeScript only and left for E3a. All gates pass.

## File map

| Area | Files |
|---|---|
| Dispatch, envelope | `engine/Magnate.Bridge/GameSession.cs` (reflection handler discovery; `{ok,result,hud?,events?,revision}` / `{ok:false,error:{code,message,field?,details?}}`; `Faulted` latch; `SessionResetMethods`), `BridgeMethodAttribute.cs` (`Mutates`), `BridgeException.cs`, `BridgeJson.cs` |
| Protocol | `Protocol/BridgeJsonContext.cs` (source-gen, 214 `[JsonSerializable]`, combined with a reflection fallback for the trimmed WASM build), `Protocol/Converters.cs` (money 2 dp / `Money4` 4 dp, half-even rounding, trailing zeros dropped; non-finite double → `null`), `Protocol/Errors.cs` (`BridgeErrorCodes`, `ErrorDetailsDto`, `Guard`), `Protocol/Dtos.*.cs` (one file per area) |
| Derived models | `Model/LedgerIndex.cs` (incremental monthly aggregates over Ledger/CogsLog/TransferLog), `Periods.cs`, `Months.cs`, `Financials.cs` (interim corporate value), `GoalTracker.cs`, `MetricsHistory.cs`, `EventDetector.cs`, `ActivityFeed.cs`, `Advisor.cs`, `Difficulty.cs`, `MarketModel.cs`, `SlotRules.cs`, `PlacementModel.cs`, `CompanyPalette.cs`, `LedgerCategories.cs`, `Strategies.cs`, `ActiveGame.cs` |
| Handlers (one partial per area) | `GameSession.Game.cs` (newGame, snapshot, advance, companies, settings, setAutopilot, listScenarios), `.Catalog.cs`, `.Buildings.cs`, `.City.cs`, `.Finance.cs`, `.Market.cs`, `.Marketing.cs`, `.Research.cs`, `.Progress.cs`, `.Persistence.cs`, `.Ext.cs`, `.Dev.cs` |
| Persistence | `Persistence/WebSave.cs` (web envelope v1, streaming load scan, gzip) |
| WASM host | `web/engine-host/Program.cs` (`Boot`, `Call`, `SaveBinary`, `SaveMeta`, `LoadBinary`, `InspectSave`, `LastError`) |
| TypeScript | `web/src/bridge/protocol.ts` (all DTOs, the full `Methods` map including EXT and `cityLayout`, `MUTATING_METHODS`, `CityLayoutDto` with art §5.3 extensions), `engine.ts` (`EngineClient`), `engine.worker.ts`, `workerProtocol.ts`, `protocol.contract.test.ts` (vitest over the C# fixtures), `__fixtures__/*.json` (75 method fixtures) |
| Tests | `engine/Magnate.Bridge.Tests/`: one class per partial (Dispatch, GameFlow, Catalog, Buildings, City, Finance, Market, Marketing, Research, Progress, EventDetector, Persistence, Ext + Dev), `LedgerIndexParityTests`, `ContractFixtureTests` (writes and checks the JSON shape fixtures), `PerfTests` (category `perf`), `Year10Fixture` |

## How other workstreams use it

- **Envelope.** Every mutating call returns `hud` (a `SnapshotDto`) and `events` (`GameEventDto[]`, stamped and
  ordered, already in the persisted feed). Errors carry a typed `code`, an optional `field` (the argument path,
  e.g. `at.px`) and `details` (amounts, ids, reasons). Clients render messages from `code` + `details`.
- **`EngineClient` (engine.ts).** `call`/`callRaw` keep their old signatures. New:
  - `client.onEnvelope(({method, revision, hud, events}) => …)` returns an unsubscribe function.
  - `client.onHud(cb)` and `client.onEvents(cb)` are filtered forms of `onEnvelope`.
  - `client.hud` and `client.revision` hold the latest values seen.
  - `advance`, `newGame`, `loadGame`, `setAutopilot` and `snapshot` results are published as HUD/events too.
  - Identical in-flight queries are coalesced, but never across a mutation.
- **advance (CHANGE).** Args: `{months, stopOn?, viewCityId?, viewSince?}`. Result: `TickResultDto {advanced,
  events, snapshot, monthSummaries[], playerActivity[], cityView?, stoppedBy?, autosaveDue, engineMs, bridgeMs}`.
- **Renderer (W1).** `cityView {cityId}` returns `BuildingVisualDto[]`. Each entry has:
  - `colorIndex` (0 = player), `placement {px,pz,rotation,source}`, `level`, `status`, `products`;
  - `activity.utilization` and `visualRev`.

  Pass `since: <revision>` to get only the changed or removed buildings. `supplyFlows {cityId}` and `worldMap` are
  available. Placement source is `'bridge'` for a player-chosen `construct.at`. It is `'auto'` for deterministic
  auto-siting, which uses a per-city grid with road lines every 6th plot and category rings. Placements persist in
  the save sidecar.
- **City layout (E3a).** The TS `cityLayout` entry and `CityLayoutDto` are in protocol.ts (§8.1 + art §5.3:
  terrain heights, water kind/shore, ambient kinds, climate, seed). The C# method is **not** registered here, so
  E3a's `GameSession.CityLayout.cs` can register it without a duplicate-registration crash.
- **Feature flags.** `init.features` (`plots`, `landMarket`, `constructionTime`, `demolish`, `loans`,
  `stockMarket`, `macro`, `productionLog`, `domainEvents`, `demandModel`) are all `false`. Every EXT method returns
  `feature_unavailable {feature}`.
- **Saves.** `saveGame` returns the web envelope `{format:"magnate.websave", formatVersion:1, contentHash, meta,
  engine, bridge}`. The bridge sidecar holds:
  - history, goal latches and outcome, event latches, the feed;
  - placements, settings, the journal, AI strategies and autosave state.

  `loadGame {data}` also accepts legacy engine saves (schema v1–v9) and rebuilds bridge state from the ledger.
  Missing content is refused with `save_content_mismatch {missing:["product:x",…]}` *before* the world changes.
  The binary path (`SaveBinary` → gzip, `LoadBinary`, `InspectSave`) is exported from the WASM host. Its worker
  messages and IndexedDB store are Wave-2 B6.
- **Dev.** `debugStats` adds `lastAdvancePhasesMs` (facade time per advance phase: capture, index, placement,
  history, events, goals, snapshot, activity) for the perf overlay.

## Verification (2026-10-01, final run)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | Build succeeded, 0 warnings, 0 errors |
| `dotnet test Magnate.sln --no-build` | Engine 231/231 passed. Bridge 190 passed, 0 failed, 4 skipped (the `perf` category, which needs `MAGNATE_PERF=1`) |
| `node scripts/build-engine.mjs` | 63 files (12.2 MB) copied to `public/_framework` |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vite build` | built in 13.6 s |
| `node scripts/smoke.mjs` | **SMOKE OK** (boot, tutorial, construct supermarket, advance a month) |
| `npx vitest run src/bridge` | 77/77 (contract test over the C# fixtures) |

**Extra check on the trimmed WASM build.** A scratch puppeteer script (not committed) drove the built worker
directly through these steps:

1. newGame, construct, advance 3 months.
2. `saveGame` → newGame(sandbox) → `loadGame`.
3. Check the restored game: snapshot cash, date and gameId are identical, and the activity feed is identical.
4. A tampered save is refused with `save_content_mismatch ["product:nope"]`.
5. 18 query methods return ok; `creditProfile` returns `feature_unavailable`.

This shows that source-gen plus the reflection fallback survive trimming, including the new streaming save reader.

**Perf category (`MAGNATE_PERF=1`) on a shared machine at load average 15–27.** The numbers are not
representative:

- `snapshot` median 0.41 ms, p95 0.59 ms: passes.
- Most report and view budgets pass: cityView 0.4 ms, balanceSheet 0.5 ms, marketIntel 1.7 ms.
- `history` (all 11 series × all companies × 120 months, 63 KB) measured 6–9 ms median against a 5 ms budget.
- Advance overhead p95 and the 10-year save round trip fail under this load. SaveBinary took 2.4–2.75 s and
  LoadBinary 3.3–4.0 s, with a 1.6 MB gzip. In the same runs the engine's own `AdvanceMonth` median was
  25–36 ms, so the whole machine was 3–5× slower than normal.

  Re-run on an idle machine with `MAGNATE_PERF=1 dotnet test engine/Magnate.Bridge.Tests --filter Category=perf`.

## Power-loss recovery

The previous session died with uncommitted edits, which were committed as `cf53871` ("WIP checkpoint").

- **What the edits contained:**
  - `WebSave` was rewritten to embed the engine JSON verbatim on save and to scan it in one forward
    `Utf8JsonReader` pass on load. The scan collects facts and missing content ids without building a
    document tree.
  - `EventDetector.Prime` now takes patents ever granted, so legacy loads don't re-fire patent events.
  - Per-phase advance timings were added to `debugStats`.
  - Tests and fixtures were adjusted.
- **What was verified:** I reviewed the diff, and it builds clean. All tests and web gates pass, and the WASM
  save/load round trip works.
- **What was added:** I added a test for the new `lastAdvancePhasesMs` field (`c3d87a9`).

## Known gaps

- **Interim models, each in exactly one place, to be replaced when the owning workstream lands:**
  - Corporate value = Equity + 10 × trailing-12-month NI (`Financials.cs`, D10).
  - Insolvency = 3-month cure window after a negative month-end cash balance (`GoalTracker.cs`, D9).
  - Bridge placement (`PlacementModel.cs`, until `features.plots`).
  - `suggestPrice` and market projections replay today's fixed-pie demand (`MarketModel.cs`, until E9).
  - Utilization approximation (until E10).
  - Event diffing (until E12 domain events).
- `setAutopilot {strategy:null}` (hand control back) is refused until the engine can unregister a strategy (E2).
- Determinism across save/load is still broken until the engine persists the RNG state (E4). The bridge has no
  workaround.
- The engine part of the save is indented JSON until E14 (compact saves). Gzip absorbs most of the cost.
- B6 remainder (Wave 2): worker save/load messages over the binary exports, IndexedDB store, autosave rotation,
  import/export UI, `bootProgress`.
- The perf budgets are unconfirmed on an idle machine (see above). The year-10 WASM save/load time has not been
  measured in a browser.

## Requests

1. **U1 (`web/src/state/**`): consume HUD/events from the envelope instead of re-polling `snapshot`.**
   - After boot, call `const off = client.onEnvelope(({ hud, events, method }) => { if (hud) store.setHud(hud);
     if (events.length) store.pushEvents(events); })`.
   - Drop the explicit `snapshot` call after mutations: the envelope already carries the HUD.
   - Render error messages from `EngineError.code`, `.field` and `.details`, not `.message`.
   - Use `advance`'s `monthSummaries` for the month-close toast and `playerActivity` for floating revenue numbers.
   - Pass `viewCityId` + `viewSince: lastCityViewRevision` to advance to get the city delta in the same call.
   - Honour `autosaveDue` by calling the B6 save path when it lands.
2. **E3a:** register `cityLayout` in `GameSession.CityLayout.cs` returning the `CityLayoutDto` already typed in
   protocol.ts. When `features.plots` flips, the bridge switches `PlacementModel` to engine placements
   (`source:'engine'`) and adopts the sidecar map for legacy saves.
3. **E0 (engine):** bridge-spec §10 change requests, in this order:
   - **P0:** E2 (AI registry and unregister), E3 (validated slot mutators), E4 (RNG persistence), E5 (books
     close after upgrades), E6 and E7 (geography and tier enforcement). The bridge ships workarounds for all of
     them except E4.
   - **Then:** E14 (compact save JSON), E8 (month index on the logs), E10 (per-month operating report),
     E9 (one public demand model).
4. **Lead (`web/scripts/smoke.mjs`, not owned by B1):** extend the smoke test with a save → load round trip and
   an `onEnvelope` HUD assertion. The scratch script used for the WASM check above can serve as a template.
5. **Finance workstream:** expose `World.GetCorporateValue` and an insolvency rule. The bridge then swaps the
   interim formula in `Financials.cs` / `GoalTracker.cs`; DTOs are unchanged.
