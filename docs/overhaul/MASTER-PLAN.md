# Magnate Overhaul — Master Plan (Three.js city · realistic economy · audio)

Status: **active** · Owner: lead agent · Started 2026-09-30

The user asked for major improvements to playability and visual appeal: a Three.js client that renders each city as a
real 3D city (factories, shops, houses, roads, traffic), gameplay that follows real-world finance and business
principles, and better sound, music and voice, all replicating Capitalism Lab.

This document is the single source of truth for **decisions, architecture, ownership and sequencing**. The detailed
specs live in the research reports and are referenced by section; when a report and this plan disagree, **this plan
wins**.

| Report | What it specifies |
|---|---|
| `research/econ-audit.md` | Measured defects; the realistic economic model (§4), targets (§5), regression checks (§6), staging (§7) |
| `research/bridge-spec.md` | ~60 bridge methods with C# + TS DTOs (§5), facade architecture (§4), WASM host (§6), tick events (§7), extension points (§8), engine change requests (§9), plan B0–B8 (§11) |
| `research/art-rendering.md` | Art bible (§3), per-asset specs (§4), rendering architecture + module layout (§5), packages (§6), verified reference code (App. A — already copied into `web/src/scene/**`) |
| `research/ux-playability.md` | Parity checklist (§2), playtest evidence (§3), web IA + every screen (§6), first 15 minutes (§7), game-feel catalogue (§8), VO lines (§9) |
| `research/caplab-brief.md` | CapLab mechanics (§2), P0/P1/P2 (§4), city generator + land/traffic fields (§5), core loop (§6), balance bands (§7) |
| `research/audio-plan.md` | Asset audit (§1), formats + mastering (§2), web audio system (§4), VO script (§5), SFX list (§6), music (§7) |
| `research/test-map.md` | Test classification, mutation evidence, Classic/Realistic strategy (§7), Godot compile coupling (§8) |

---

## 1. Decisions (resolves the reports' open questions)

| # | Topic | Decision |
|---|---|---|
| D1 | Client | New `web/` client: Vite 6 + React 19 + TypeScript 5.9 + three **0.186.1 (pinned)** + zustand. Imperative three.js (no R3F). The legacy Godot client is kept compiling but is no longer developed. |
| D2 | Engine hosting | C# engine + `Magnate.Bridge` compiled to .NET 8 browser-wasm, running in a dedicated module Web Worker (built by `web/scripts/build-engine.mjs`). |
| D3 | Rulesets | Per-World immutable `EconomyRules`. **Classic** reproduces today's engine exactly (default for `new World(...)`, used by legacy tests). **Realistic** is the gameplay ruleset (used by `ScenarioRunner` and the bridge). Classic is a test oracle, not a player mode. Saves persist the full rules snapshot. |
| D4 | Scale | **Real 2026 USD magnitudes** (econ-audit §4.0): shelf prices real, supermarket ≈ $10M + land, wages at BLS rates. Scenario starting cash and thresholds rescale per econ §4.18. One `EconomyScale` knob is kept for later tuning. |
| D5 | Tick | Monthly engine tick. Client shows a 30-day visual clock. **1× = 12 s/month**, 2× = 6 s, 4× = 3 s, 8× = 1.5 s, plus step-one-month. Player commands apply at month close (UI says so). |
| D6 | Demand | econ §4.1–4.3: lognormal-WTP category demand + logit choice on quality-adjusted price, permanent incumbent local competition (strength 0.6/1.0/1.4 by difficulty, floor 25%), store throughput capacity, location factor from plot traffic, duplicate slots merged. Tech reaches consumers through quality (caplab §2.6) in P1. |
| D7 | World market | econ §4.4: import markup, export discount, finite depth with falling marginal price; AutoExport defaults **off** for new buildings under Realistic. |
| D8 | Accounting | econ §4.15: cash ledger + `AccrualJournal`; statements are pure functions; `Assets − Liabilities == Equity` to the cent every month (new invariant). Upgrade capex is capitalised (fix also applied to Classic). |
| D9 | Finance | Amortising term loans + an automatic revolving credit line (the revolver replaces negative cash), rating from ICR/leverage/size, Damodaran spreads over a 4.00% policy rate; 25% tax with NOL (80% cap); straight-line depreciation, land at cost; bankruptcy after a 3-month cure window (econ §4.10, §4.14). Equity/IPO/share price/dividends/buybacks are **P1** (Wave 3). |
| D10 | Corporate value | One engine definition: `World.GetCorporateValue(c) = listed ? MarketCap : FundamentalEquityValue` (econ §4.11/§4.18). HUD label "Company Value". Market cap shown separately once listed. `totalAssets` goal type keeps legacy semantics. |
| D11 | Goals | Latched once reached ("reachOnce") by default; optional `holdAtDeadline`. Win = all goals latched. Market-share goals use realised trailing-3-month unit share incl. incumbents. Fix the two unwinnable scenarios. |
| D12 | City | Engine-side deterministic generator per (city, seed) (caplab §5.2–5.5): grid of **24 m plots**, axis-aligned 1-plot roads with arterials/avenues, varied block depth, rivers/coast/hills, zones, land value + traffic fields, ambient buildings, civic/finance landmarks. Buildings occupy parcels; construction takes time with progress payments; geography requirements enforced. |
| D13 | Building interior | Keep the engine's slot model for v1. The inspector presents it as a CapLab-style 3×3 unit grid with auto-derived links (UX §6.7). The true unit/link data model is P2. |
| D14 | Look | art §0: "architect's scale model on a sunny afternoon"; one Lambert-based `CityMaterial`; Neutral tone mapping; LOW pipeline default (no SSAO on integrated GPUs); budgets art D7; 12-minute cosmetic day/night cycle **on by default** (setting to lock daytime). |
| D15 | Colours | Player = blue `#2F7DE1` + gold badge/ring; rivals = Okabe–Ito-derived palette + emblem shapes (art §3.4). `colorIndex 0` is always the player. Single source: `web/src/theme/tokens.ts`. |
| D16 | Audio | Ogg Opus 48 kHz + m4a fallback; loudness targets audio §2.3; loop points inside content; procedural SFX kit for UI/economy cues; music director + ambience director + voice queue (audio §4). Advisor persona "Morgan" voiced by the existing ElevenLabs voice "Hope"; news-anchor voice "Daniel". Generation only with the user's approval of key/credits. |
| D17 | Saves | Binary (gzip in .NET) through the worker into IndexedDB; 3 autosaves + quicksave + manual; string save kept for tests/dev (bridge §6.3). |
| D18 | Determinism | Named RNG streams with persisted state (econ §4.19); per-runtime determinism only (cross-runtime bit-exactness not required). |
| D19 | Scope order | Econ P0 before P1; CapLab P0 city/market before P1 loop; UX parity + first-15-minutes before depth. |

---

## 2. Architecture

```
content/*.json ──embedded──▶ Magnate.Wasm (browser-wasm) ─┐
engine/Magnate.Engine  (pure C#, EconomyRules, World, tick) │  Web Worker: dotnet runtime + IndexedDB save store
engine/Magnate.Bridge  (GameSession facade, DTOs, indexes)──┘        │ postMessage (JSON envelopes, binary saves)
                                                                     ▼
web/src/bridge (EngineClient) → state (zustand stores, useEngineQuery) → ui/ (React HUD, drawers, overlays)
                                                                     → scene/ (CityScene + SceneModules: env, city, assets, dynamic, interaction)
                                                                     → audio/ (AudioEngine: music, ambience, emitters, sfx, voice)
                         game/events.ts bus: tick, gameEvent, buildingPlaced, selection, ui cues → scene FX + audio + toasts
```

Invariants (engine): zero Godot deps; cash == Σ ledger; deterministic ordinal iteration; `A − L == E` every month;
saves lossless and backward compatible (v1–v9 load as Classic); every new mechanic gated by `EconomyRules`.

Invariants (web): the client never re-derives game logic (bridge-spec §3); the main thread never blocks on the engine;
every panel reads through `useEngineQuery` or the store and re-fetches on `revision`; all colours/typography come from
`web/src/theme/tokens.ts`; component styles are CSS Modules (`*.module.css`); three.js objects are disposed by their
owning module.

---

## 3. Delivery waves

Parallel work happens in **git worktrees of a private integration repo** (the project directory itself is not a git
repo; see §5). Each workstream owns a disjoint set of files. Shared files have exactly one owner per wave.

### Wave 1 — foundations (parallel)

| WS | Scope (spec refs) | Owns |
|---|---|---|
| **E0 engine-foundation** | test-map §7.3–7.4; econ §4.15 (categories + metadata, AccrualJournal), §4.16 (19-step orchestrator with rule-gated no-op stubs), §4.19 (RNG streams + v10 skeleton); split `World.cs`/`MonthlyTick.cs` into partials/step files; `EconomyRules` (Classic/Realistic + per-workstream sub-rule records); frozen Classic content fixture + golden masters; TestSupport; upgrade capitalisation; E2–E7 engine change requests from bridge §9 that are small | `engine/Magnate.Engine/**` (except `Land/`), `engine/Magnate.Engine.Tests/**`, `tools/**` (except `tools/audio`), `client/**` (compile fixes only) |
| **E3a city-generator** | caplab §5.1–5.5, bridge §8.1 DTOs, art §5.3 requests; deterministic `CityLayoutGenerator`, land-value + traffic fields, placement validation + auto-siting (pure, no World edits) | `engine/Magnate.Engine/Land/**`, `engine/Magnate.Engine.Tests/Land/**`, `engine/Magnate.Bridge/GameSession.CityLayout.cs` |
| **B1 bridge** | bridge §11 B0, B1, B2 (interim placement), B3, B4, B5, B7 against the current engine; full TS `Methods` map for all spec'd methods | `engine/Magnate.Bridge/**` (except `GameSession.CityLayout.cs`), `engine/Magnate.Bridge.Tests/**`, `web/src/bridge/**`, `web/engine-host/**` |
| **W1 render-core** | art §5.2 W1: renderer/post pipeline/tiers/governor/camera rig/shadow fit/day-night/sky/water/outskirts; own `CityMaterial`; scene lab dev route | `web/src/scene/{CityScene.ts,SceneContext.ts,units.ts}`, `web/src/scene/{core,env}/**`, `web/src/scene/materials/CityMaterial.ts`, `web/src/dev/SceneLab*` |
| **W3 assets-A** | art §4.1, §4.3 (+ §4.2 retail/media/office types): residential, commercial, civic, props, retail + media + R&D + HQ company buildings | `web/src/scene/assets/families/{residential,commercial,civic,props,retail,media,rnd}/**`, `web/src/scene/assets/familiesA.ts` |
| **W4 assets-B** | art §4.2: factories, farms/plantation, mines, oil, warehouses, seaport, construction stages; shared `GeoBuilder`/`AssetFactory`/`registry`/`palette`; the asset gallery dev page | `web/src/scene/assets/{GeoBuilder,AssetFactory,Instancing,registry,palette}.ts`, `.../families/{industrial,extraction,logistics,construction}/**`, `web/src/scene/assets/familiesB.ts`, `web/src/dev/AssetGallery*`, `web/src/scene/materials/SignAtlas.ts` |
| **U1 ui-shell** | UX §6.1–6.4, §6.18–6.21: design system, app shell, screens (title/scenario select/loading/settings/pause/save-load UI), HUD frame (top bar, left rail, drawer + overlay hosts, toasts, ticker, advisor dock), key map, time controls | `web/src/{App.tsx,main.tsx}`, `web/src/ui/**`, `web/src/styles/**`, `web/src/theme/**`, `web/src/state/**`, `web/src/game/**`, `web/src/util/**` |
| **A1 audio** | audio §2 (mastering pipeline), §4 (engine), §6.1 procedural kit, §4.12 event routing | `web/src/audio/**`, `web/public/audio/**`, `tools/audio/**` |

Wave 1 exit gate: `dotnet build Magnate.sln` 0 errors; all engine + bridge tests green; `npm run typecheck` + `vite build`
green; smoke test green; asset gallery and scene-lab screenshots reviewed.

### Wave 2 — the real economy and the living city (parallel)

| WS | Scope | Depends on |
|---|---|---|
| **E1 market** | econ §4.1–4.7, §4.20, AI pricing fixes of §4.17; content rebalance; labour/utilities payroll step | E0 |
| **E2 finance** | econ §4.8–4.10, §4.14, §4.15 statements, §4.18 corporate value + goal semantics | E0 |
| **E3b land-integration** | plots in World, construct-at-plot + auto-site, land purchase, construction time + progress payments + CIP, geography enforcement, persistence | E0, E3a |
| **W2 city** | art §5.2 W2: layout module, chunk manager + worker, roads, pick index, ambient + company buildings from bridge | W1, W3/W4, E3a |
| **W5 life** | traffic, pedestrians, trucks on supply flows, particles, animated parts, construction sites, world FX | W1, W2 interfaces |
| **W6 interaction** | picking, selection, placement ghost, overlays, link arcs, labels/badges | W1, W2 interfaces |
| **U2 panels-A** | UX §6.6–6.8: build flow, inspector drawer (overview, 3×3 layout, price slider, stock cover), markets | U1, B1 |
| **U3 panels-B** | UX §6.9–6.16: reports, finance, R&D, marketing, rivals, news, goals/outcome, advisor | U1, B1 |
| **B2 bridge** | bridge B6 (binary saves, IndexedDB, autosave), B8 fixtures, event taxonomy completion | B1 |

### Wave 3 — integration of the new economy

E4 AI rewrite (econ §4.17 expansion/finance/land) · E5 equity + macro (econ §4.11, §4.13) · bridge feature switch-on
(plots, landMarket, constructionTime, loans, stockMarket, macro, demandModel) · UI wiring of land/placement/construction/
loans/stock · scenario rescale (econ §4.18) + tutorial chapter 1 (UX §7) · game-feel catalogue (UX §8) · audio event
routing + VO generation (if approved).

### Wave 4 — verification and polish

Balance sweeps (econ §5–6 R1–R18, caplab §7.1 bands), scripted e2e playtests with screenshots, visual critique of every
screen, perf on the UHD 630 (art D7 budgets), adversarial code review, fix loops until dry. Docs: README, HANDOVER,
memory.

---

## 4. Contracts that cross workstreams

1. **EconomyRules** (E0 creates; later waves fill): `EconomyRules { Preset, Market: MarketRules, Finance: FinanceRules,
   Land: LandRules, Macro: MacroRules, Economy scale knobs }`. Each sub-record lives in its own file owned by the
   workstream that implements it. Classic = every feature off; Realistic = the gameplay configuration.
2. **Tick steps** (E0 creates `Simulation/Tick/*Step.cs` stubs in the econ §4.16 order; owners fill them):
   Macro/WorldPrices/Construction/Payroll/Research/Advertising/Extraction/Production/Restock/Demand/Export/Royalties/
   Finance/Depreciation/Tax/QuarterEnd/Solvency/Incumbents/Events.
3. **Ledger categories + metadata** (E0): every category of econ §4.15 exists with its statement mapping
   (`LedgerCategoryInfo`). Later workstreams only *use* categories.
4. **Persistence v10** (E0): `WorldSaveFile` gains `rules`, `rng`, and nullable sections (`land`, `finance`, `market`,
   `macro`) whose DTO types live in files owned by the implementing workstream.
5. **City layout DTO** (E3a): exactly bridge-spec §8.1 + art §5.3 requests (terrain heights, water kind/shore, extended
   ambient kinds, climate, seed).
6. **Bridge protocol** (B1): bridge-spec §5 shapes; `web/src/bridge/protocol.ts` holds every method's types from day
   one; not-yet-implemented methods return `feature_unavailable`.
7. **Scene modules**: `SceneModule` contract (`web/src/scene/SceneContext.ts`); asset factories implement
   `AssetFactory` (`web/src/scene/assets/AssetFactory.ts`) and register through `familiesA.ts` / `familiesB.ts`.
8. **Theme tokens**: `web/src/theme/tokens.ts` is the only place colours, owner palette, fonts, radii and z-layers are
   defined; the 3D palette re-exports it.
9. **Event bus**: `web/src/game/events.ts` topics are the integration seam for FX, audio and UI juice; bridge
   `GameEventDto.kind` names follow bridge-spec §7 (audio routing keys use the same names).

---

## 5. Integration protocol

- Integration repo: `$SCRATCH/magnate-repo` (git), baseline = project snapshot. Each workstream gets a worktree at
  `$SCRATCH/wt/<ws>` on branch `<ws>`; `web/node_modules` is a symlink to the project's install.
- Agents never touch files they don't own; if they need a change elsewhere they write it under "Requests" in their
  status doc `docs/overhaul/status/<ws>.md`.
- The lead merges branches into `main`, resolves conflicts, runs the full gate, then syncs `main` into the project dir.
- Verification commands (every workstream runs the subset relevant to it before reporting):
  ```bash
  export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1
  dotnet build Magnate.sln 2>&1 | tail -3               # 0 errors (TreatWarningsAsErrors is on)
  dotnet test Magnate.sln --no-build 2>&1 | grep -E "Passed!|Failed!"
  (cd web && npm run typecheck && npx vite build)       # green
  (cd web && npm run build:engine && node scripts/smoke.mjs)   # SMOKE OK
  ```

## 6. Progress log

| Date | Event |
|---|---|
| 2026-09-30 | Baseline green (229 tests). Backup `tmp/backup/magnate-pre-web3d-2026-09-30.tar.gz`. WASM spike OK. |
| 2026-09-30 | Foundation: `Magnate.Bridge` (reflection-dispatched protocol), `Magnate.Wasm` host, `web/` scaffold, worker engine, smoke test OK. |
| 2026-10-01 | Research complete (7 reports, `docs/overhaul/research/`). Master plan written. Wave 1 starting. |
| 2026-10-01 | Power loss mid-wave; work survived in persistent worktrees. Finished e3a/b1/u1 + voice QA (106 Kokoro lines, ElevenLabs out of credits). Wave 1 merged and synced: engine 863 tests, bridge 201, web 610, smoke OK (save works end to end). |
| 2026-10-01 | Wave 2 launched (10 teams): e1-market, e2-finance, e3b-land, b2-bridge, w2-city, w5-life, w6-interaction, u2-panels-a, u3-panels-b, a3-audio-integration. Briefs in tmp/integration/prompts/wave2/. |
| 2026-10-02 | Wave 2 merged (10 branches) and reconciled; gate green: engine 1296 tests (+1 perf), bridge 253 (+4 perf), web 845 (vitest), smoke + smoke-saves OK, W6/U2/U3 tours OK on the real engine. Hard-difficulty AI idling, revolver/AI over-commitment, disposals and Realistic opex in the bridge fixed at merge. LOW tier UHD 630: 9–12.5 ms, ≤ 246 calls; JS submit 2–5 ms (over 2.5). Report: `docs/overhaul/status/wave2-integration.md`. |
