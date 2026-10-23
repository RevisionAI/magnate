# Wave 2 integration — status

**Status: done** (2026-10-02). The ten Wave 2 branches are merged into `main` (from tag `pre-wave2-merge`), every
item of the lead's merge notes was worked through, and the full gate is green on the final tree. The merged
game was played headlessly through every visual tour against the real engine (no mocks).

## 1. Merges (in order)

| Branch | Merge | Conflicts and how they were combined |
|---|---|---|
| e2-finance | `6212025` | none |
| e1-market | `506e0de` | `Features` = union; Realistic rules = E1 `MarketRules.Gameplay` + E2 `FinanceRules.Realistic`; E2's `World.Reports.GetMarketShare` deleted (E1 moved it to `World.Market.cs`; would not compile) |
| e3b-land | `4633552` | `FinanceRegisterShim.cs` deleted (E2 implements the API; CS0111 otherwise), `ReleaseLand` re-implemented over E2's register; `Features` = union of E1/E2/E3b; Realistic `Land` block from E3b; `Financials.cs` = E2's; `PlacementModel` keeps E2's retired-building prune *and* E3b's engine placements/construction tracking (the prune now preserves undrained construction events); Dispatch/Ext feature tests take the union; web fixtures regenerated later |
| b2-bridge | `b89db3c` | `LedgerIndex.CatchUp` keeps E2's accrual fold and B2's `_windowFrom`; `newGame` keeps E3b's `NewGameRules` with B2's `AiStrategies`; month tick passes B2's utilization and drains E3b's placement events; Dispatch/Ext tests take B2's (compare with `GameSession.Features`); Persistence takes B2's; the contract script plays B2's funded tutorial under E3b's Realistic rules (new `Bridge.FundedOn` / `FundedScenarioOn`); `GameEventKind` = B2's taxonomy |
| a3-audio-integration | `0362ccb` | none |
| w2-city | `a886bb1` | none (W2's `scene/city/**` taken whole; `PlaceholderCity` deleted) |
| w5-life | `813dfae` | none |
| w6-interaction | `3342a2a` | W6's `Overlays.test.ts` fixture typed against the E3a/E3b protocol (`roadClass`, parcel `district/facing/vacant`; the degraded-payload case cast explicitly) — amended into the merge so it compiles |
| u2-panels-a | `c55ed5e` | none |
| u3-panels-b | `3f1fa54` | advisor `CODE_TITLE` gains B2's new `insolvency` code (exhaustive record) — amended into the merge |

## 2. Reconciliation commits

### Engine seams (E1 / E2 / E3b)

| Commit | What |
|---|---|
| `5779b13` | E2's `IncumbentUnitsSold` stub → `World.GetIncumbentUnitsSold` (realised share counts incumbents). `World.CreditHeadroom` defaults to `Finance.RevolverCreditHeadroom` whenever the rules run a revolver (undrawn limit, 0 in distress; no re-attach after load). Line/rig equipment capitalised through `CapitalizeEquipment` with §4.8 lives (`AssetClasses.EquipmentLifeMonths`: lines 10 y, farm 12 y, plantation 15 y, mine 20 y, well 10 y). Finance tests sized from content. |
| `eeffae8` | **One retirement model**: `CancelConstruction` retires through E2's `Retire` (the building leaves `World.Buildings` for the retired registry); `Retire` calls `ReleaseSite` (plots freed, `layoutRev` bumps) for sales, demolitions, liquidations and cancellations; pre-integration land saves migrate retired buildings, land and CIP into the register on load; the finance section is written whenever land or finance rules are on. **Sale/demolition refuse buildings under construction** (`FinanceErrorCode.InvalidDisposal`). **Held land on the balance sheet** (`Land` line + `GetHeldLandAtCost`). Shim fields `BuildingInstance.LandCost/ConstructionInProgress` removed; `BookValue` = structure NBV. `CompleteConstruction` schedules depreciation from the next month. **`IBuildingSiteInfo` = `Land.LandSiteInfo`** (footprint-traffic location factor, register land cost, construction state), the default under land rules. **`ApplyMarketDefaults` in `Construct`** (both paths, D7). **`PayrollStep` → `AllBuildings`** (sites pay insurance + property tax). `DemandStep` keeps E3b's operational skip. `AdjustAvailableFunds` adds the undrawn revolver (econ §4.12). AI expansion checks count the site's land and outstanding construction commitments (without it the adaptive autopilot started two supermarkets on `export_tycoon` and went bankrupt in 10 months). |
| `93d1436` | AI values a new store's lines at the location factor of the site it would actually get (memoised per world/month/layout revision). With difficulty → incumbent strength 1.4 (hard), an average-site estimate found nothing profitable and **every AI on `four_archetype_melee` and `vertical_showdown` sat idle for five years**. Regression test `AiLandTests.At_hard_difficulty_the_ai_still_builds_on_good_sites`. |
| `efbae03` | `Metropolis_generates_within_the_desktop_budget` → `Category=perf` (engine `PerfFactAttribute`, runs with `MAGNATE_PERF=1`). |

### Bridge (B2 × E1/E2/E3b)

| Commit | What |
|---|---|
| `ed205ac` | `Marketing.cs` on E1's v2 advertising (city cost per point, `B(1−d) + Σ points(1−B/100)`, rules' decay rate); **difficulty → `IncumbentStrength`** in `newGame` (0.6 / 1.0 / 1.4); slot commands through the engine's validated setters; geography via `World.MeetsGeographyRequirement`; disposal methods refuse buildings under construction (`under_construction`); contract fixtures regenerated. (`construct`'s `ApplyMarketDefaults` now happens inside `World.Construct`.) |
| `c5c048e` (merge of 7 commits) | **Bridge tests re-baselined** (27 failures → 0) with B2's content-derived helpers: capex/opex/recipe quantities from content or the engine ledger, funded fixtures, designed changes commented (auto-export off, retired-site semantics, Realistic insolvency). No assertion weakened. Real bridge bugs found and fixed: per-building opex and `incomeStatement.operatingCosts` / `monthlyReport.expenses` only counted the Classic `OperatingCost` category (Realistic opex was invisible); production slots / catalog / utilization used the legacy 200 cycles instead of `Recipe.CyclesPerSlotMonth` (bread's flour input showed 90/month vs 202,500); custom games ran through the scenario difficulty formula (three rivals = hard) — now "normal". |
| `e27bb3b` | Contract fixtures regenerated on the final engine. |
| `e4a6a54` | `building.actions.canDemolish` was hard-coded `false` (U2's Sell/Demolish stayed disabled on the real engine) — now follows E2's rules. New `BuildingDetailDto.book` (gross PP&E, depreciation, land, CIP, upgrades): `bookValue` includes land/CIP since the merge and U2 mislabelled land as "Upgrades". |

### Web

| Commit | What |
|---|---|
| `b4c8438` | Placeholder `car_dealership` asset (W3 small-shop kit on a 2×2 lot) + construction-site spec. |
| `415bd71` | **`protocol.ts` is the single source**: U2's local `previewDisposal` typing removed (typed `engine.call`), U3's "E2 view" types are protocol aliases, report label/driver records exhaustive again, A3's `subtitle` bus topic declared in `game/events.ts`. |
| `ee40a07` | **W5 `pickTruck` for W6** (hover card: owner, product, route; click selects the building served); **world popups drawn once** (`createDynamicModules({ worldPopups: false })`, W6 draws them). W2's CitySource / CityInteractionSource bind through their `import.meta.glob` seams (verified in the tours). |
| `5b62c16` | **U1 Meter CSS order** fixed; **audio stinger overlap** fixed (ducks on a dedicated per-deck gain, never on the fade curve's param; 0 occurrences in 17 smoke runs); **`insolvency` routed** (default → bankruptcy warning, cured → recovery, rival bankrupt → news sting); advisor dock counts the engine's cure window instead of "six month-ends" and reacts to E2 distress; legacy imports show "Value —". |
| `1937631` | Credit-rating chip in the HUD top bar (U3 → U1 follow-up). |
| `1a970bd`, `bd1c646` | W6 shots place through U2's build flow (U2 owns `placementConfirmed`, so W6's fallback no longer constructs); U3 "lost" tour reports instead of failing when the autopilot no longer goes bankrupt. |
| `f1877ed` | `?power=low-power` QA hook on the game screen (LOW-tier runs on the integrated GPU). |

**Checked, no change needed:** HUD company value and the value goal both come from `World.GetCorporateValue`
(0 mismatches in the economy runs below); U2 constructs exactly once and confirms on `previewBuild {at}`;
`placementConfirmed` → U2 confirm card → `construct {at}` verified in W6's shots; W2's under-construction
stages and `layoutRev` refetch work in-game (construction-site shots); the stale `PlaceholderCity` mention in
the minimap went with W6's minimap rewrite.

## 3. Gates (final `main`)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors (128 pre-existing CS1591 warnings in untouched Domain/AI files) |
| `dotnet test` | Engine **1296 passed**, 1 skipped (perf); Bridge **253 passed**, 4 skipped (perf) |
| `MAGNATE_PERF=1 dotnet test --filter Category=perf` (load avg 2.4) | Engine 1/1, Bridge 4/4 |
| `tsc --noEmit` | clean |
| `vitest` | **845 passed**, 3 skipped (61 files + 1 skipped) |
| `vite build` | built |
| `build-engine.mjs` (WASM) | 63 files, 13.9 MB |
| `smoke.mjs` | **SMOKE OK** (repeated runs) |
| `smoke-saves.mjs` | **SMOKE-SAVES OK**; manual save 0.88 s, load 1.56 s (see §6 for the one flaky run) |
| W6 `interaction-shots.mjs` | **W6 SHOTS OK** 24/24, 0 page errors |
| U2 tour (`u2tour.mjs`) | 27 shots at 1920×1080 and 1280×720, 0 page errors |
| U3 tour (`tour.mjs`, no `--mock-finance`) | **U3 TOUR OK** healthy 1920×1080 + 1280×720, lost 1920×1080 |

Screenshots read: city overview (day), district (night, supply-link arc), street (traffic, shoppers, full car
park), placing ghost with cost tag → U2 confirm card → construction site (foundation stage) → inspector
"Under construction"; opened store (Finance tab: book value breakdown, **Sell $11.47M / Demolish $5.27M live**
with gain/loss vs book); Finance › Bank (A− rating, 5 offers, revolver card, real engine); balance sheet
(land, gross PP&E, depreciation, CIP, books balanced); Markets matrix; build palette/confirm; outcome-modal
state of the melee.

## 4. Economy sanity (Realistic, 5 years, through the bridge)

| Scenario / player autopilot | Outcome | Books (max \|E − (paid-in + NI)\|) | HUD = goal = engine value | Notes |
|---|---|---|---|---|
| tutorial / adaptive | playing at 60 mo | 0.00 | yes | player 7 buildings, value $904M; LocalCo cash peak 2.2× start |
| four_archetype_melee / adaptive | playing | 0.00 | yes | all 5 companies build (2–5 buildings); no bankruptcy (was 13 months on the Wave 1 engine) |
| four_archetype_melee / techLeader | playing | 0.00 | yes | no cash explosion (was ~$10T on the Wave 1 engine); max cash = start |
| tech_titan_clash / adaptive | lost at deadline | 0.00 | yes | — |
| soft_drink_war / simple | lost at deadline | 0.00 | yes | — |
| first_hundred_million / verticalIntegrator | **won in 24 months** | 0.00 | yes | value goal $250M reached fast (see follow-ups) |
| vertical_showdown / adaptive | lost at deadline | 0.00 | yes | AI builds 9 buildings (0 before the hard-difficulty fix) |

No cash explosions, no instant bankruptcies, books close every month for every company, and HUD / goal / engine
company values agree. **Reported, not fixed:** the fundamental company value (E2 `Valuation`, multiple up to 8×
operating assets) swings widely (e.g. $53M → $534M in a year, then $351M) and makes value goals easy.

## 5. Performance (LOW tier, Intel UHD 630, 1920×1080, Metropolis, W5 traffic 500 vehicles + W6 links overlay)

Drained throughput (CPU submit + GPU), median of 5 × 40 frames; load average 2–4, `CPU_Speed_Limit` 100.

| Hour | View | ms static / moving | JS submit ms | Draw calls static / moving | Triangles static / moving |
|---|---|---|---|---|---|
| 13:00 | overview (2,000 m) | 9.9 / 10.2 | 2.3 | 114 / 133 | 198k / 249k |
| 13:00 | district (760 m) | 11.3 / 12.5 | 3.8–5.0 | 159 / 228 | 396k / 588k |
| 13:00 | street (180 m) | 9.5 / 10.7 | 3.5 | 84 / 107 | 268k / 344k |
| 22:30 | overview | 9.9 / 10.3 | 2.2–2.5 | 125 / 142 | 198k / 249k |
| 22:30 | district | 11.0 / 12.5 | 4.6–5.0 | 179 / **246** | 398k / 596k |
| 22:30 | street | 9.1 / 9.4 | 3.7 | 102 / 128 | 268k / 359k |

Within D7: ≤ 250 calls (peak 246), ≤ 700k triangles (peak 596k), frame ≤ 14 ms. **Over budget:** JS submit
2.2–5.0 ms against 2.5 ms in district/street views (W2's known gap; W5/W6 add little).

## 6. Open items and follow-ups

**Resolved:** one `smoke-saves.mjs` run failed right after `smoke.mjs` (the second of two back-to-back month steps clicked a still-disabled button). `stepMonth` now waits for the button and the store's `stepping` flag. After the fix: 16 loop runs, plus 5/5 `smoke.mjs` → `smoke-saves.mjs` back-to-back pairs (lead, 2026-10-02), all OK.

**Wave 3 (from the merge notes, left alone):** E5 market cap in `GetCorporateValue` + policy rate; AI loans /
disposals / distress playbook; catchment radius in `BuildPreviewDto`; E1 P1 (quality formation, incumbent
dynamics, absorption costing, specialty stores, freight); `EconomyScale` unused; extraction ROIC a few points
above band; W5 boom/recession traffic (macro mood); WASM save 3.5 s / load 5.6 s (System.Text.Json source
generation for `WorldSaveFile`), WASM AOT (`wasm-tools`); visual: W4 midrise flat dark roofs, W1 night glass
towers, W1 stair-stepped shallow water, rounded cul-de-sacs; inspector scroll position on tab switch at
1280×720; `OutcomeDebrief` in the outcome modal; chart axis labels crowd at 1280.

**New from this integration:**
- Valuation volatility / easy value goals (§4) — E2/E5 calibration.
- CBD land: redevelopment buy-outs make central supermarket sites cost $38M–$102M (E3a placeholder prices);
  the confirm card's "Cash after" is negative there.
- AI site evaluation adds site searches to the AI turn (memoised); the desktop engine suite went from ~28 s to
  ~43 s — measure the WASM month tick (already ~15× desktop).
- `catalog.adChannels[].costPerPoint` is one number per channel; under Realistic rules the cost is per city
  (previews and campaigns are right).
- Markets "your share, 12 months" chart can read 100 % while the realised share incl. incumbents is 3 %.
- Tutorial goal "Own a Supermarket" latches when the store is ordered (under construction).
- The AI's supermarket picks apparel (designer jeans) as a first line at prime sites — E1 store-draw balance.
- `car_dealership` is a placeholder model (W3).
- W5's `PlaceholderSource` is now dead code; signal heads not drawn; traffic step not spread over frames.
- `ProductionSlotDto.cyclesPerMonth` stays an int (all per-unit recipes have whole cycle counts).
