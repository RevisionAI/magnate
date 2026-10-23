# Magnate overhaul — engine test-suite map and test strategy

**Role:** test architect (`test-map`) · **Date:** 2026-09-30 · **Phase:** read-only research
**Scope:** `engine/Magnate.Engine.Tests` (229 xUnit tests in 18 files), the compile-time coupling of the Godot client and tools to the engine, and a test strategy for the realistic-economy overhaul that keeps the invariants intact.

**Status of this report.** The intended file `docs/overhaul/research/test-map.md` was **not** created: the subagent harness refuses report files, and I did not work around that. The full content is below. Machine-readable evidence (per-test classification, mutation failures with assertion messages) is in `…/scratchpad/test-map/test-map-evidence.json`.

> **Baseline.** All numbers and `file:line` references come from a snapshot of the tree taken at 22:47 (229 tests, all passing). While this work was running, other agents changed the tree:
> - They added `engine/Magnate.Engine.Tests/PersistenceStringTests.cs` (2 tests, bringing the total to **231**).
> - They added `WorldSaver.SaveToString` (`WorldSaver.cs:168`) and `WorldLoader.LoadFromString` (`WorldLoader.cs:66`). Later lines in those two files have shifted, and the live line numbers are quoted where it matters.
> - They added `engine/Magnate.Bridge` and `engine/Magnate.Bridge.Tests` (6 tests), and `Magnate.sln` now lists 7 projects.
> - They added `web/`.
>
> None of these changes touch simulation logic.

**How the evidence was gathered.** Nothing in the project tree was modified. All experiments ran on copies under `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/test-map/`.
1. I read every test and every engine source file.
2. **Roslyn semantic scan.** A Roslyn-based scanner (`depscan/`) compiled the client, the tools and the tests with their real references, including the 169 Godot source-generator outputs, with **0 compile errors**. It then resolved every symbol that belongs to `Magnate.Engine`.
3. **46 mutation experiments** (`mutations.py`, `runmut.py`). Each one applied a single economic or formula change (or a content change, or a bundle of changes) to a copy of the engine. The full test suite was then run to record exactly which tests fail.
4. **Probe harness** (`harness/`). It reproduced pre-existing defects and captured Classic "fingerprints".

---

## 0. TL;DR

- **Current coverage (baseline snapshot):** 229 tests in 18 files, all green, runtime about 0.5 s.
  - The suite is **mostly robust to economy change.** Of the 229 tests, 147 can run unchanged under any sensible ruleset. Another 24 never build a `World` (content and loader tests).
  - Only **46 tests truly pin today's formulas or content numbers**, and 6 are weak or broken oracles that need fixing.
- **Evidence from the mutation experiments (details in §3):**
  - Most single-knob changes break 0–6 tests each.
  - A plausible "realistic bundle" breaks **11** tests: incumbent competitor, 0.85× export spread, 1.10× import markup, straight-line depreciation, 25 % tax and wages.
  - Adding a 1-month construction time breaks **46**, and the bundle plus construction time breaks **51**.
  - Content rebalancing breaks 1–8 tests per change (for example C05: halving bread demand breaks 8 AI tests, because they assume bread is the biggest market).
  - Changing the seed, removing events, adding extra RNG draws or reversing the processing order breaks **0** tests. No test is accidentally coupled to the event stream.
- **Recommendation: an injectable, immutable `EconomyRules` held by each `World`, built from neutral parameters.**
  - `Classic` sets every realism knob to its neutral value (tax 0, wages 0, construction 0 months, export and import factor 1.0, no incumbent) and uses the current constants. It is guarded by a golden master captured *before* any refactor.
  - `new World(catalog, seed, date)` defaults to Classic, so 67 test call sites, the client and the simulator stay source-compatible and behaviour-identical.
  - Gameplay entry points (Bridge `newGame`, `ScenarioRunner`) pick `Realistic`.
  - Pin the 46 numeric tests to Classic **plus a frozen copy of today's content**.
  - Run the 147 ruleset-agnostic tests as `[Theory]` tests under both presets.
  - Add property, invariant, golden-master and "business-plausibility" tests for Realistic.
  - Re-baselining numbers instead would churn about 51 tests now and a few more at every balancing pass, and would lose the regression oracle while the engine is being rewritten (§7.1).
- **Pre-existing defects that no test catches (evidence in §6):**
  - **P0 — save/load is not lossless.** RNG state is not persisted: the save writes `Seed: 0` and loading re-seeds with 0. A mid-run save and reload **diverges** as soon as an event touches state (demonstrated: ±$49,725.86 of cash moves between companies after 12 months). Three "deterministic across save/load" tests pass only by coincidence.
  - **P1 — books do not close after `UpgradeBuilding`.** Equity drops by the upgrade capex, −$720,000.
  - **P1 — runaway TechLeader and car prices.** TechLeader's price floor uses the *total* inventory cost basis instead of the unit cost, so hero prices reach $2.2M, then $10.9M, then $20M per car. Because the demand model has no price–quantity response, the four-AI melee grows AI cash to **$73 billion** in 60 months.
  - **P2 — mismatched share.** `GetMarketShare` returns a different share (0.778) from what the allocator actually sells (0.873).
  - **P2 — vacuous test.** One test asserts `0 == 0 × 18,000`.
- **Compile-time coupling.**
  - The Godot client makes 2,953 references into the engine from 22 of its 35 scripts. It **never constructs** `IncomeStatement` or `BalanceSheet` (it only reads their properties), so adding positional fields is safe for the client and the tools.
  - Breaking surfaces: the `World.Construct(owner, type, city)` shape (173 test, 3 client and 6 simulator call sites), the `new World(catalog, seed, date)` shape (67/1/1), named arguments (`price:`, `restockTarget:`, `seed:`, …), public slot setters that the client writes (`BuildingInspector.cs:591, 754–755, 804`), and the `SimulationConstants` fields the client reads (11 references).
- **Build and test time** (Intel i9-9880H, host heavily loaded by parallel agents):

  | Command | Cold (no build servers) | Warm |
  |---|---|---|
  | `dotnet build Magnate.sln` (clean) | 18.8–19.5 s | 6.3–7.5 s |
  | `dotnet build Magnate.sln` (no-op) | — | 2.4–6 s |
  | `dotnet test` (engine tests, `--no-build`) | — | 3.5–3.9 s wall (0.5–1 s execution) |
  | `dotnet test Magnate.sln` | — | 7.6–8.3 s |

---

## 1. Suite anatomy

### 1.1 Files, counts, classes

Classes: **A** = invariant/structural · **B** = numeric expectation tied to current formulas, constants or content numbers · **C** = feature behaviour (AI, patents, events, upgrades, scenarios, persistence schema) · **K** = content contract (content ids, structure and numbers; no `World` involved) · **N** = pure unit test (`Inventory` math).

| File | Tests | A | B | C | K | N | Builds a World? | Notes |
|---|---|---|---|---|---|---|---|---|
| AdaptiveAiTests | 10 | 1 | 2 | 7 | | | yes | AI; seeds 42/13 |
| AdvertisingTests | 19 | 3 | 10 | 4 | 2 | | yes | most exact-number tests (brand points) |
| AiTests | 7 | 1 | | 6 | | | yes | SimpleRetailer; seed 7 |
| BuildingUpgradeTests | 8 | 1 | 1 | 6 | | | yes | temp file |
| ContentLoaderTests | 11 | 4 | | | 7 | | no | live `content/` |
| EventTests | 9 | 3 | | 5 | 1 | | mixed | seeds 42/99/12345; temp file and temp content copy |
| MultiCityWarehouseTests | 10 | | 1 | 7 | 2 | | yes | memo-string helper |
| PatentTests | 18 | 2 | | 16 | | | yes | literal `100.0` research threshold ×10 sites |
| PerBuildingPnLTests | 8 | 8 | | | | | yes | hard-coded null-bucket whitelist |
| PersistenceTests | 28 | 28 | | | | | yes | v1–v8 back-compat strings; temp files |
| QualityBrandTechTests | 14 | | 7 | 5 | | 2 | mostly | |
| ReportingTests | 14 | 9 | 2 | 2 | 1 | | yes | contains the vacuous test |
| ResearchTests | 8 | | 5 | 3 | | | yes | |
| ReservationPriceTests | 6 | 1 | 5 | | | | yes | seed 11 |
| ScenarioTests | 29 | | 6 | 13 | 10 | | mixed | 16 scenario JSONs; seeds 1/7/11/13/42 |
| SimulationTests | 19 | 5 | 5 | 9 | | | yes | seed 7 determinism |
| TechLeaderTests | 6 | 2 | | 4 | | | yes | seed 17 |
| VerticalIntegratorTests | 5 | 1 | | 4 | | | yes | seed 21 |
| **Total** | **229** | **69** | **44** | **91** | **23** | **2** | | |

The recommended mode for each test is listed in §4. The mode tallies are:

| Mode | Meaning | Count |
|---|---|---|
| BOTH | ruleset-agnostic; run under Classic **and** Realistic | 147 (A 60, B 10, C 77) |
| CLASSIC | pin to `EconomyRules.Classic` plus frozen classic content | 31 |
| CLASSIC+TWIN | pin to Classic and add a Realistic counterpart that asserts the realistic property | 15 |
| NOWORLD | no world, not affected by the ruleset | 24 |
| SNAPSHOT | exact content or scenario numbers; turn into a re-approvable content snapshot | 6 |
| FIX | weak, vacuous or coincidental oracle; strengthen it | 6 |

### 1.2 Shared helpers and fixtures (there are none shared — everything is copy-pasted)

- **Content-root resolution.** `ContentRoot()` is duplicated in **all 18 classes**, identically. It starts at `Directory.GetCurrentDirectory()` (the test host's working directory, `bin/Debug/net8.0`), walks up until it finds a directory that contains `global.json`, then returns `<that dir>/content`. The same code is in `SimulationTests.cs:13-22` and in `ScenarioTests.RepoRoot()` (`ScenarioTests.cs:13-25`). The new `PersistenceStringTests` and `Magnate.Bridge.Tests/TestContent.cs` copy it again. Consequences:
  - Tests only work when run inside the repository layout.
  - **Adding any other `global.json` between `bin/` and the root** would silently redirect the lookup to `<that dir>/content` and fail every test. Watch `engine/` and `web/engine-host`.
  - `Assert.NotNull(dir)` is the only guard.
- **`NewWorld(int seed = 42)`** is duplicated in 14 classes, always as `new World(ContentLoader.Load(ContentRoot()), seed, new GameDate(2026,1))`. `PatentTests` and `TechLeaderTests` use `Catalog()` plus `new(Catalog(), 42, …)` instead.
- **Content loading.** `ContentLoader.Load` is called 36 times directly, plus once per `NewWorld` or `Catalog()` call, so content is re-read from disk roughly **220+ times per run**. There is no `IClassFixture` or `ICollectionFixture`. `ContentCatalog` is immutable, so a static `Lazy<ContentCatalog>` is safe.
- **Units-sold helpers, four different ways:**
  - `SimulationTests.UnitsSold` (L207-214) and `QualityBrandTechTests.SoldUnits` (L262-269) sum all of the owner's `ProductSale` entries and divide by the price of slot 0.
  - `ReservationPriceTests.SoldUnits` (L36-43) filters by `e.Building`.
  - `MultiCityWarehouseTests.SoldUnits` (L236-247) **matches the memo string** `"@ B#"`.
- **Other local helpers:**
  - `PatentTests.SetUpPatent()` (L237-247) and `AddMonths` (PatentTests L42, EventTests L67).
  - `PersistenceTests.SetUpChain` (L467-481).
  - `EventTests.CatalogWithoutEvents()` (L45-65) copies `content/data` without `events/` into a temp directory.
- **Temp files.** `Path.GetTempPath()` plus a GUID name. Cleaned up with `IDisposable` (Persistence, Patent, Event) or `try/finally` (BuildingUpgrade, TechLeader, ListSaves).
- **Internals.** Tests use 31 internal-member references, enabled by `[assembly: InternalsVisibleTo("Magnate.Engine.Tests")]`, which oddly lives in `Ai/AdaptiveStrategy.cs:11`:
  - `World.AddResearchPoints` ×10 and `InternalTech`/`InternalResearchProgress` (PatentTests).
  - `SetActivePriceEffect` ×4 and `TickActivePriceEffects` ×4 (EventTests).
  - `InternalAiStrategies` ×5 (Persistence and TechLeader).
  - `InternalPatentsEverGranted` ×4 and `InternalPatentLicenses` ×2.
- **Public back doors used by tests.** `Inventory.Add` is public. It is used 14 times to inject stock with no ledger or equity entry (`PerBuildingPnLTests.cs:73,167`, `PatentTests.cs:347,439,483,503`, `QualityBrandTechTests.cs:104-105`, `PersistenceTests.cs:114,301`). Books do not close in those worlds, which is fine for those tests. The Bridge must not expose this.
- **Parallelism.** xUnit 2.9 runs test classes in parallel. The engine currently has **no static mutable state** (`SimulationConstants` holds `const` values, and `ContentLoader.JsonOptions` is static readonly). **Any `EconomyRules.Current` or settable global would race across test classes.** Rules must be per-`World` and immutable.
- **Seeds and dates.**
  - Default seed 42. Also used: 7 (Simulation/Ai determinism, `Scenario_run_advances_goals_over_time`), 13 (AdaptiveAi, Monopolist runner), 17 (TechLeader), 21 (VI), 11 (ReservationPrice, Phase 3.11 runner), 99 and 12345 (EventTests), 1 (runner clock).
  - Start date 2026-01, except the ListSaves tests (2027-03, 2030-11, 2026-06).
  - RNG is consumed **only** by `EventEngine.RollAndApply` (one gate draw per tick, plus one pick draw when an event fires). The event schedule therefore depends only on the seed:

| Seed | Events fired in months 1–40 (month:event) |
|---|---|
| 42 | 02 consumer_electronics_craze, 04 cotton_harvest_bumper, **07 viral_ad_spot**, 15 viral_ad_spot, 18 cocoa_blight, 22 trade_summit_optimism, 23 wheat_drought, 26 cocoa_blight, 30 tariff_announcement, 34 cocoa_blight, 35 viral_ad_spot, 37 cotton_harvest_bumper |
| 0 (what every reloaded save gets today) | 16 viral_ad_spot, 23 trade_summit_optimism, 28 consumer_electronics_craze, 34 oil_glut, 39 cotton_harvest_bumper |
| 7 | 04 oil_glut, 06 wheat_drought, 12 viral_ad_spot, 17 viral_ad_spot, 19 tariff, 21 wheat_drought, 22 tariff, 26 electronics_craze, 27 cocoa_blight, 29 tariff, 33 cocoa_blight, 39 cotton |
| 11 | 02 soft_drink_health_scare, 04/10 electronics_craze, 11 trade_summit, 33 viral_ad_spot |
| 13 | 05 wheat_drought, 09 viral_ad_spot, 13/18 electronics_craze, 15 cocoa_blight, 22 viral_ad_spot, 23 tariff, 28 oil_glut |
| 17 | 04 viral_ad_spot, 08/15 tariff, 16 viral_ad_spot, 17 cocoa_blight, 28 health_scare, 31 wheat_drought, 37 viral_ad_spot, 39 trade_summit |
| 21 | 04 trade_summit, 09 viral_ad_spot, 11 health_scare, 13 trade_summit, 14 cotton, 17 tariff, 20 wheat_drought, 36 trade_summit |
| 99 | 06/07 cotton, 20 trade_summit, 24 cocoa_blight, 29 tariff, 31 cocoa, 34 tariff, 38 wheat, 39 cocoa |
| 12345 | 01 cocoa_blight, 06 viral_ad_spot, 12 electronics_craze, 14 viral_ad_spot, 17 tariff, 32 tariff |

The mutation experiments confirmed that no test depends on this schedule. Adding an extra RNG draw per tick (M24), disabling events (M25) and changing every test seed from 42 to 43 (M26) each caused **0 failures**.

### 1.3 Tests that construct buildings and operate them in the same tick

- **93 tests** call `World.Construct` and then `AdvanceMonth`, either directly or through a helper. Another **19** tests only get buildings through AI `BuildRetailerAction`, `BuildProducerAction` or `BuildResearchCenterAction`, which call `World.Construct` inside `RunAiDecisions`. Those buildings also operate in the same tick (`World.cs:593-615`).
- To measure the impact, mutation **M23** made every new building skip its first tick: no opex, no operations, no sales (`ReadyAt = Clock.Now + 2 months`, filtered in `MonthlyTick.Execute` and `AllocateDemandAndSell`). **46 tests fail.** They are listed in §5.
- Of those 46, 31 are otherwise BOTH (ruleset-agnostic) tests. Under Realistic they need an instant-construction override (§7.3).

---

## 2. Economic formulas and constants the tests depend on (legend for §4)

The codes below are used in the "Depends on" column of §4. Line numbers are for the baseline snapshot.

| Code | What | Where |
|---|---|---|
| **K.Cycles** | `CyclesPerSlotPerMonth = 200`: recipe cycles per production slot per month | `SimulationConstants.cs:10`; used at `MonthlyTick.cs:236` |
| **K.Ship** | `InterCityShippingFraction = 0.10` × effective world price, capitalised into inventory | `SimulationConstants.cs:16`; `MaterialProcurement.cs:94` |
| **K.WMQ / K.ExQ** | Quality of world-market and extracted goods, both 50 | `SimulationConstants.cs:22,25` |
| **K.BaseTech / K.BaseBrand** | Starting tech level 1, starting brand 0 | `SimulationConstants.cs:28,31` |
| **K.RP / K.RThr** | 100 research points per slot per month; threshold to go from level N to N+1 is `100 × N`; overflow carries; progress is zeroed at max level; a patent is granted at max level | `SimulationConstants.cs:34,56`; `World.cs:514-550` |
| **K.PatDur / K.Roy** | Patent lasts 24 months; royalty 5 % of the licensee's ProductSale + ExportSale for the tick | `SimulationConstants.cs:41,49`; `MonthlyTick.cs:76-128` |
| **K.AdCPP** | Cost per brand point: TV $4,000, Newspaper $6,000, Magazine $8,000, Radio $5,000 | `SimulationConstants.cs:59-68,100-107` |
| **K.Decay** | Brand decays by 2 % a month without a campaign; entry dropped below 0.1 | `SimulationConstants.cs:71`; `World.cs:439-454` |
| **K.Media** | Media-ownership multiplier on effective ad budget: broadcast 1.35, print 1.25 | `SimulationConstants.cs:79,88`; `World.cs:467-502` |
| **K.EvP** | 0.20 monthly probability that an event fires, then a weighted pick sorted by id | `SimulationConstants.cs:97`; `EventEngine.cs:47-78` |
| **F.Demand** | Bracket demand = `Population × share × BaseDemandPerCapita`, with **no price–quantity curve, no outside option and no budget cap**. A sole seller captures 100 % of the bracket at any price that is at or below the reservation price. | `MonthlyTick.cs:368-396`; duplicated in `SimpleRetailerStrategy.cs:115`, `AdaptiveStrategy.cs:254`, `VerticalIntegrator.cs:399`, `TechLeader.cs:333`, `MonthlyTick.cs:431` (unused) and inline in two tests |
| **F.Softmax** | `desirability = max((Q + 10·T + B)/3, 1)`, `weight = desirability / price^elasticity`, share = weight ÷ Σ weights of retailers under the bracket ceiling | `MonthlyTick.cs:349-395`; **re-implemented without reservation gating** in `World.GetMarketShare` (`World.cs:949-978`) |
| **F.Reserve** | Per-bracket reservation price; a missing key means no ceiling | `MonthlyTick.cs:379-395, 425-429` |
| **F.Proc** | Procurement order: own stock → same-city own source → other-city source (+ shipping) → world market | `MaterialProcurement.cs:19-77` |
| **F.Buy** | Market buy at effective world price × quantity, quality 50, with **no affordability check** | `MaterialProcurement.cs:107-127` |
| **F.Prod** | cycles = min(200, ⌊available/qty⌋); output quality = quantity-weighted input quality; output cost = Σ drawn input cost (variable costing — opex is not absorbed) | `MonthlyTick.cs:234-273` |
| **F.Extract** | Yield per slot from content, **zero cost basis**, quality 50 | `MonthlyTick.cs:192-213` |
| **F.Export** | After retail restock, a building's **entire** own output is exported at 1.00 × effective world price. `AutoExport` defaults to true. | `MonthlyTick.cs:447-483`; `BuildingInstance.cs:106` |
| **F.Opex** | `OperatingCost` = level-ladder opex, one entry per building per month | `World.cs:188-195`; `MonthlyTick.cs:172-188` |
| **F.AdLift** | lift = budget × media bonus ÷ cost per point × (1 − B/100), capped at 100 | `World.cs:402-436` |
| **F.BS** | `BuildingValue = Σ type.ConstructionCost`: no depreciation, **no upgrade capex**, no land; `Liabilities = 0` | `World.cs:920-941` |
| **F.IS** | Revenue = ProductSale + ExportSale + PatentRoyaltyIncome. Opex = OperatingCost + AdvertisingCost + PatentRoyaltyExpense. COGS comes from `CogsLog`. Capital flows and purchases are excluded. | `World.cs:981-1008` |
| **AI params** | Simple: solo ×1.20, undercut ×0.95, floor ×1.05, 6-month cushion. Adaptive: $50k ads, 6× cash rule. VI: $40k ads, $15M threshold for a large factory. TechLeader: hero = most expensive finished good (car), premium ×1.30, floor ×1.10, 2 R&D centres, $80k ads. | `Ai/*.cs` |
| **Construction** | A building exists and operates from the next tick. `Construct` charges only `ConstructionCost`. | `World.cs:95-113` |
| **C.x** | Specific content values, e.g. `soft_drink` $1.50 with recipe 1000 out per 20 sugar + 5 plastic; sugarcane yield 400; metropolis 500k people at 0.45/0.40/0.15; bread per-capita demand 8/7/5 (the largest market); car $18,000; TV station $3M/$30k | `content/data/**` |

---

## 3. Mutation sensitivity matrix (evidence)

Each row applies one change to a scratch copy of the engine or content; everything else is baseline. The full suite was then run (46 runs of 4–9 s each; the baseline was 229/229 green before and after). The patches are in `scratchpad/test-map/mutations.py`. Results are in `scratchpad/test-map/mutres/results.json`, with each failing test's assertion message.

| Id | Change applied to a scratch copy (all else baseline) | Failing tests (of 229) | Which |
|---|---|---|---|
| M01 | CyclesPerSlotPerMonth 200->180 (throughput / labor productivity) | **1** | Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled |
| M02 | InterCityShippingFraction 0.10->0.12 | **0** | — |
| M03 | WorldMarketQuality 50->45 | **0** | — |
| M04 | ExtractionQuality 50->55 | **0** | — |
| M05 | ResearchPointsPerSlotPerMonth 100->90 | **4** | Research.Different_companies_research_progress_independently; Research.Multiple_slots_advance_tech_faster; Research.One_month_of_research_with_one_slot_reaches_level_two; Research.Progress_accumulates_between_level_ups |
| M06 | BaseResearchThreshold 100->110 | **20** | Patent.Competitor_research_resumes_after_patent_expires; Patent.Competitor_research_stalls_while_rivals_patent_active; Patent.Grant_is_idempotent_and_deterministic; Patent.Granting_license_unblocks_competitor_research; Patent.Holder_does_not_receive_second_patent_after_first_expires; Patent.Holder_own_research_continues_without_exception_during_patent; Patent.Income_statement_treats_royalty_income_as_revenue_and_expense_as_opex; Patent.Patent_expiry_cascades_to_license_removal; Patent.Reaching_max_tech_grants_patent_with_24_month_expiry; Patent.Revoke_is_idempotent; Patent.Revoke_reblocks_competitor_next_tick; Patent.Royalty_stream_is_deterministic_for_same_seed; Patent.Royalty_transfers_five_percent_from_licensee_to_holder; Patent.Save_and_load_round_trips_active_license; Patent.Save_and_load_round_trips_active_patents_and_ever_granted; Patent.Save_load_midrun_yields_identical_royalty_stream; Research.Different_companies_research_progress_independently; Research.Multiple_slots_advance_tech_faster; Research.One_month_of_research_with_one_slot_reaches_level_two; Research.Progress_accumulates_between_level_ups |
| M07 | Ad cost-per-point all channels x1.1 | **6** | Advertising.Active_campaign_raises_brand_awareness; Advertising.Magazine_publisher_owner_gets_magazine_ad_bonus; Advertising.Newspaper_publisher_owner_gets_newspaper_ad_bonus; Advertising.Radio_channel_ad_campaigns_deliver_reach; Advertising.Radio_station_owner_gets_radio_ad_bonus; Advertising.Tv_station_owner_gets_ad_reach_bonus |
| M08 | BrandDecayRate 0.02->0.03 | **1** | Advertising.Brand_awareness_decays_when_no_campaign_active |
| M09 | Media ownership bonus 1.35/1.25 -> 1.30/1.20 | **6** | Advertising.Magazine_publisher_owner_gets_magazine_ad_bonus; Advertising.Newspaper_bonus_requires_newspaper_publisher_not_other_media_buildings; Advertising.Newspaper_publisher_owner_gets_newspaper_ad_bonus; Advertising.Only_the_company_that_owns_the_newspaper_publisher_gets_the_bonus; Advertising.Radio_station_owner_gets_radio_ad_bonus; Advertising.Tv_station_owner_gets_ad_reach_bonus |
| M10 | EventBaseProbabilityPerMonth 0.20->0.25 | **0** | — |
| M11 | PatentDurationMonths 24->18 | **1** | Patent.Reaching_max_tech_grants_patent_with_24_month_expiry |
| M12 | PatentRoyaltyRate 0.05->0.06 | **0** | — |
| M13 | City demand volume x0.9 (market size / demand curve) | **3** | MultiCityWarehouse.Stores_in_different_cities_dont_compete_for_demand; ReservationPrice.Reservation_in_only_some_brackets_leaves_others_untouched; ReservationPrice.Zero_ceiling_locks_a_bracket_out_entirely |
| M14 | Price elasticity exponent x1.2 (allocator + GetMarketShare) | **0** | — |
| M15 | Desirability tech weight T*10 -> T*8 (allocator + GetMarketShare) | **0** | — |
| M16 | Incumbent competitor weight in every market (desirability 30 @ 1.25x world price) | **6** | MultiCityWarehouse.Stores_in_different_cities_dont_compete_for_demand; ReservationPrice.Reservation_in_only_some_brackets_leaves_others_untouched; ReservationPrice.Zero_ceiling_locks_a_bracket_out_entirely; Scenario.Market_share_goal_achieved_at_monopoly; Scenario.Market_share_is_one_when_only_retailer; Scenario.Market_share_reflects_softmax_weights_not_just_retailer_count |
| M17 | Auto-export at 0.85x world price (export spread) | **1** | Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled |
| M18 | All market buys at 1.10x world price (import markup) | **1** | AdaptiveAi.AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy |
| M18a | RetailRestock market buys only at 1.10x (wholesale margin) | **1** | AdaptiveAi.AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy |
| M18b | InputPurchase market buys only at 1.10x | **0** | — |
| M19 | Opex charged x1.1 (GetMonthlyOpex unchanged) | **2** | BuildingUpgrade.Monthly_opex_ledger_amount_reflects_level; PerBuildingPnL.Opex_entries_carry_the_correct_building_id |
| M20 | Straight-line depreciation 240m in IS opex + BS building value | **1** | Reporting.Inter_city_shipping_capitalizes_into_inventory_not_opex |
| M21 | Corporate income tax 25% monthly, new LedgerCategory.IncomeTax (building=null), in IS opex | **2** | Patent.Royalty_transfers_five_percent_from_licensee_to_holder; PerBuildingPnL.Per_building_ledger_sums_reconcile_to_per_company_totals |
| M22 | Interest income 0.3%/month on positive cash, new LedgerCategory.InterestIncome (building=null), in IS revenue | **1** | PerBuildingPnL.Per_building_ledger_sums_reconcile_to_per_company_totals |
| M23 | Construction time: new buildings skip their first tick (no opex/ops/sales) | **46** | see §5 |
| M24 | One extra RNG draw per tick (e.g. demand noise) - shifts event stream only | **0** | — |
| M25 | No random events fire during ticks (empty catalog passed from MonthlyTick) | **0** | — |
| M26 | Tests: default seed 42 -> 43 everywhere | **0** | — |
| M27 | Reverse building iteration order in tick (determinism/order probe) | **0** | — |
| M28 | Reservation-price gating disabled | **3** | ReservationPrice.Price_above_low_ceiling_drops_low_bracket_only; ReservationPrice.Reservation_in_only_some_brackets_leaves_others_untouched; ReservationPrice.Zero_ceiling_locks_a_bracket_out_entirely |
| M29 | AutoExport defaults to false | **4** | Scenario.ExportRevenueGoal_tracks_cumulative; Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled; Simulation.Factory_produces_output_and_exports; Simulation.Standalone_factory_is_profitable_over_a_year |
| M30 | Ad lift saturation squared (stronger diminishing returns) | **1** | Advertising.Active_campaign_raises_brand_awareness |
| M31 | Inventory holding cost 1%/month booked as extra OperatingCost entry | **0** | — |
| M32 | Wages: headcount-midpoint x $3,000/month, new LedgerCategory.Wages (building-attributed), in IS opex | **1** | Reporting.Inter_city_shipping_capitalizes_into_inventory_not_opex |
| M33 | Land purchase on Construct (BaseLandPrice x footprint area x 100), new LedgerCategory.LandPurchase, capitalised in BS | **2** | Reporting.Construction_moves_value_from_cash_to_buildings_keeping_total_assets_unchanged; Simulation.Construct_charges_cost_and_adds_building_to_company |
| C01 | Content: soft_drink baseWorldMarketPrice 1.50 -> 1.20 | **1** | Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled |
| C02 | Content: soft_drink recipe outputQuantity 1000 -> 500 | **1** | Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled |
| C03 | Content: metropolis population 500k -> 800k | **2** | MultiCityWarehouse.Stores_in_different_cities_dont_compete_for_demand; QualityBrandTech.Market_bought_goods_carry_world_market_quality |
| C04 | Content: supermarket cost 1.2M -> 2.0M, opex 15k -> 40k | **1** | BuildingUpgrade.Insufficient_cash_throws_without_mutating_state |
| C05 | Content: bread demand per capita halved (8/7/5 -> 4/3.5/2.5) | **8** | AdaptiveAi.AdaptiveStrategy_floors_price_at_wholesale_markup_even_with_aggressive_competitor; AdaptiveAi.AdaptiveStrategy_reprices_existing_slots_when_a_new_competitor_arrives; AdaptiveAi.AdaptiveStrategy_starts_tv_ads_in_contested_markets; AdaptiveAi.AdaptiveStrategy_undercuts_existing_competitor; Ai.Ai_targets_the_biggest_unmet_demand_first; Ai.Ai_undercuts_an_existing_competitor_price; MultiCityWarehouse.Stores_in_different_cities_dont_compete_for_demand; VerticalIntegrator.VerticalIntegrator_advertises_contested_markets_only |
| C06 | Content: sugarcane yield 400 -> 300 | **1** | Simulation.Extraction_slot_produces_raw_each_month |
| C07 | Content: add finished good priced above car (sports_car $60k) | **4** | TechLeader.Hero_product_is_the_highest_base_price_finished_good; TechLeader.TechLeader_builds_research_center_for_hero_when_none_exists; TechLeader.TechLeader_prices_hero_at_premium_above_competitor; TechLeader.TechLeader_runs_ad_campaign_when_hero_retailer_exists |
| C08 | Content: add two more cities (6th/7th) | **0** | — |
| B1 | BUNDLE A: incumbent + export 0.85 + import 1.10 + depreciation + 25% tax + wages (no construction time) | **11** | AdaptiveAi.AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy; MultiCityWarehouse.Stores_in_different_cities_dont_compete_for_demand; Patent.Royalty_transfers_five_percent_from_licensee_to_holder; PerBuildingPnL.Per_building_ledger_sums_reconcile_to_per_company_totals; Reporting.Inter_city_shipping_capitalizes_into_inventory_not_opex; ReservationPrice.Reservation_in_only_some_brackets_leaves_others_untouched; ReservationPrice.Zero_ceiling_locks_a_bracket_out_entirely; Scenario.Market_share_goal_achieved_at_monopoly; Scenario.Market_share_is_one_when_only_retailer; Scenario.Market_share_reflects_softmax_weights_not_just_retailer_count; Simulation.AutoExport_only_dumps_surplus_after_retailers_have_pulled |
| B2 | BUNDLE B: bundle A + 1-tick construction time | **51** | exactly the union of M23 (46) and B1 (11) |
| B3 | BUNDLE C: bundle A + demand x0.5 + opex x1.5 | **13** | B1 list + BuildingUpgrade.Monthly_opex_ledger_amount_reflects_level; PerBuildingPnL.Opex_entries_carry_the_correct_building_id |

**How to read this:**
- **Numeric (B) coupling is concentrated.** Most constants are guarded by 1–6 exact-number tests, which is good: those tests are real oracles for Classic.
- **Tests hard-code engine constants.** M06 breaks 20 tests, but 16 of them are PatentTests that re-derive the research threshold as the literal `100.0` instead of reading the rule.
- **Some assertions test an unrealistic demand property.** M16 (incumbent / outside option) breaks every "sole retailer gets 100 %" assertion, because they depend on F.Demand having no outside option.
- **Construction time is the most disruptive single change** (M23: 46 tests).
- **Accounting-shape assumptions are the other hot spot:**
  - "exactly one `OperatingCost` entry per building, equal to ladder opex" (M19, B3).
  - "null-building ledger entries are only StartingCapital or Advertising" (M21, M22).
  - "`OperatingExpenses` == Σ `OperatingCost`" (M20, M32).
  - "cash after `Construct` == start − `ConstructionCost`" (M33).
- **AI profitability sits on a knife edge.** A 10 % retail-restock markup (M18a) turns Adaptive's 18-month net income into **−$6.1M**.
- **Invariant tests survived every consistent accounting change.** Depreciation added to both the income statement and the balance sheet (M20), taxes (M21) and interest (M22) all kept books-close, cash==ledger and determinism green. Those tests are well designed and should be kept.

---

## 4. Per-test classification (all 229 tests)

- **Columns:**
  - *Depends on* uses the codes in §2.
  - *Broke under* lists the mutations from §3 that turned the test red. M23 and B2 are shown in their own column.
  - *Constr.-time sensitive* marks tests that fail when new buildings skip their first tick.
  - *Mode* is the recommendation from §7.
- **Mode meanings:** BOTH = parameterise over rulesets · CLASSIC = pin · CLASSIC+TWIN = pin and write a Realistic twin · NOWORLD = unaffected · SNAPSHOT = convert to a content snapshot · FIX = strengthen.

#### AdaptiveAiTests.cs — 10 tests (class A:1, B:2, C:7; mode BOTH:4, CLASSIC:5, CLASSIC+TWIN:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 34 | `AdaptiveStrategy_builds_retail_on_first_tick` | C | AI expansion; C.supermarket cost vs cushion | — |  | BOTH |  |
| 51 | `AdaptiveStrategy_starts_tv_ads_in_contested_markets` | C | AI ads; C.bread = biggest market (competitor seeded in bread/metropolis) | C05 |  | CLASSIC | breaks if bread stops being the largest market |
| 75 | `AdaptiveStrategy_does_not_advertise_in_monopoly_markets` | C | AI ads contested-only | — |  | BOTH |  |
| 89 | `AdaptiveStrategy_skips_ads_when_cash_cushion_inadequate` | C | AI cash cushion | — |  | BOTH |  |
| 108 | `AdaptiveStrategy_undercuts_existing_competitor` | C | AI pricing; C.bread biggest | C05 |  | CLASSIC |  |
| 127 | `AdaptiveStrategy_floors_price_at_wholesale_markup_even_with_aggressive_competitor` | C | AI floor 1.05×BaseWorldMarketPrice; C.bread biggest | C05 |  | CLASSIC |  |
| 146 | `AdaptiveStrategy_reprices_existing_slots_when_a_new_competitor_arrives` | B | AI solo 1.20×C.bread 2.50=3.00; undercut 0.95×2.80=2.66 | C05 |  | CLASSIC |  |
| 171 | `AdaptiveStrategy_builds_research_center_once_retail_is_saturated` | C | AI R&D pivot; months = finished×cities+15 (=55); $240M | — |  | CLASSIC | slow-ish; content-scaled |
| 193 | `AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy` | B | AI profitability 18 months: both NI>0, adaptive ≥ 0.5×simple; F.Buy @ world price | M18, M18a, B1, B3 |  | CLASSIC+TWIN | knife-edge: +10% retail restock price → adaptive NI −$6.1M |
| 222 | `AdaptiveStrategy_is_deterministic` | A | determinism (cash, building count) | — |  | BOTH |  |

#### AdvertisingTests.cs — 19 tests (class A:3, B:10, C:4, K:2; mode BOTH:9, CLASSIC:7, CLASSIC+TWIN:1, SNAPSHOT:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 34 | `RegisterAdCampaign_rejects_negative_budget` | C | validation | — |  | BOTH |  |
| 45 | `Zero_budget_removes_the_campaign` | C | campaign registry | — |  | BOTH |  |
| 58 | `Active_campaign_charges_budget_each_month` | A | AdvertisingCost == budget × months (150k) | — |  | BOTH | keep invariant: ledger amount == budget (HANDOVER invariant) |
| 74 | `Active_campaign_raises_brand_awareness` | B | F.AdLift, K.AdCPP TV 4000 → 25.0 then 43.75 | M07, M30 |  | CLASSIC |  |
| 93 | `Brand_awareness_saturates_at_100_no_matter_how_much_spending` | B | F.AdLift saturation (range 95-100) | — |  | BOTH | range assertion; valid for any saturating model |
| 110 | `Brand_awareness_decays_when_no_campaign_active` | B | K.Decay 0.02 → 49.0 | M08 |  | CLASSIC |  |
| 127 | `TV_is_more_cost_efficient_than_magazine_per_dollar` | B | K.AdCPP ordering (qualitative) | — |  | BOTH |  |
| 147 | `Ad_spend_reports_as_marketing_cost_on_product_profitability` | A | product P&L attribution of AdvertisingCost | — |  | BOTH |  |
| 167 | `Advertising_company_wins_more_share_at_equal_price` | B | F.AdLift + F.Softmax brand term; >1.3× sales lead after 6 months | — |  | CLASSIC+TWIN |  |
| 198 | `Media_tv_station_loads_from_catalog` | K | C.tv_station cost 3M/opex 30k/3×3/MaxUnits 1; radio 800k | — |  | SNAPSHOT | exact content numbers |
| 216 | `Tv_station_owner_gets_ad_reach_bonus` | B | K.AdCPP TV 4000, K.Media 1.35 → 10.0/13.5 | M07, M09 |  | CLASSIC |  |
| 252 | `Equity_still_equals_starting_plus_net_income_with_ads_running` | A | books close | — |  | BOTH |  |
| 277 | `Radio_channel_ad_campaigns_deliver_reach` | B | K.AdCPP Radio 5000 → 10.0 | M07 |  | CLASSIC |  |
| 298 | `Radio_station_owner_gets_radio_ad_bonus` | B | K.AdCPP Radio 5000, K.Media 1.35 | M07, M09 |  | CLASSIC |  |
| 334 | `Media_newspaper_and_magazine_publishers_load_from_catalog` | K | C.publishers 2.1M/18k | — |  | SNAPSHOT | content snapshot |
| 350 | `Newspaper_publisher_owner_gets_newspaper_ad_bonus` | B | K.AdCPP News 6000, K.Media print 1.25 | M07, M09 |  | CLASSIC |  |
| 383 | `Magazine_publisher_owner_gets_magazine_ad_bonus` | B | K.AdCPP Mag 8000, K.Media print 1.25 | M07, M09 |  | CLASSIC |  |
| 416 | `Newspaper_bonus_requires_newspaper_publisher_not_other_media_buildings` | C | media→channel mapping; literals 1.25/1.35 | M09 |  | BOTH | assert against rules.MediaBonus instead of literals |
| 439 | `Only_the_company_that_owns_the_newspaper_publisher_gets_the_bonus` | C | ownership scoping; literal 1.25 | M09 |  | BOTH | assert against rules value |

#### AiTests.cs — 7 tests (class A:1, C:6; mode BOTH:4, CLASSIC:3)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 32 | `Ai_builds_a_supermarket_on_first_month` | C | AI expansion | — |  | BOTH |  |
| 46 | `Ai_targets_the_biggest_unmet_demand_first` | C | C.bread largest metropolis demand (3.575M); ComputeCityDemand copy | C05 |  | CLASSIC | derive expected product from catalog to make BOTH |
| 60 | `Ai_undercuts_an_existing_competitor_price` | C | AI undercut; floor C.bread 2.50×1.05 | C05 |  | CLASSIC |  |
| 80 | `Ai_eventually_serves_multiple_products_over_several_months` | C | AI expansion cadence (≥3 products in 10 months); city count | — |  | CLASSIC |  |
| 101 | `Ai_skips_action_when_cushion_unaffordable` | C | AI cushion | — |  | BOTH |  |
| 114 | `Player_and_ai_split_the_market_when_both_sell_same_product` | C | F.Softmax both sell (qualitative) | — | **YES** | BOTH | needs instant construction |
| 136 | `Ai_decisions_are_deterministic_for_same_seed` | A | determinism | — |  | BOTH |  |

#### BuildingUpgradeTests.cs — 8 tests (class A:1, B:1, C:6; mode BOTH:7, CLASSIC:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 38 | `New_buildings_default_to_level_one` | C | upgrade ladder | — |  | BOTH |  |
| 48 | `Upgrade_charges_cost_and_increments_level` | C | UpgradeCost ledger entry (reads ladder) | — |  | BOTH |  |
| 68 | `Upgrade_progresses_to_max_level_then_throws` | C | ladder max | — |  | BOTH |  |
| 82 | `Capacity_and_opex_track_the_current_level` | C | GetCapacity/GetMonthlyOpex vs ladder | — |  | BOTH |  |
| 102 | `Monthly_opex_ledger_amount_reflects_level` | B | F.Opex ledger amount == ladder opex; exactly-one-entry pick via Last() | M19, B3 | **YES** | CLASSIC | breaks with any opex multiplier/wages in OperatingCost |
| 125 | `Insufficient_cash_throws_without_mutating_state` | C | C.supermarket 1.2M + L2 720k vs literal 1.5M cash | C04 |  | BOTH | derive starting cash from catalog |
| 145 | `Non_upgradeable_type_throws` | C | C.rd_center has no Levels | — |  | BOTH |  |
| 156 | `Save_load_round_trips_level_on_v8` | A | persistence v8 | — |  | BOTH |  |

#### ContentLoaderTests.cs — 11 tests (class A:4, K:7; mode NOWORLD:10, SNAPSHOT:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 25 | `Loads_seed_catalog_without_errors` | A | content structural validation | — |  | NOWORLD |  |
| 35 | `Seed_catalog_contains_mvp_products` | K | content contract (ids) | — |  | NOWORLD |  |
| 53 | `Coffee_chain_loads_with_correct_tiers_and_recipes` | K | content contract (tiers/recipes/demand ordering) | — |  | NOWORLD |  |
| 80 | `Eastside_loads_with_affluent_demographics` | K | C.eastside pop 200k, .25/.40/.35, land price > metropolis | — |  | SNAPSHOT | exact numbers |
| 96 | `Raws_have_no_recipe_intermediates_and_finished_do` | A | content structural validation | — |  | NOWORLD |  |
| 116 | `All_recipe_inputs_resolve_to_known_products` | A | content structural validation | — |  | NOWORLD |  |
| 137 | `City_demographics_sum_to_one` | A | content structural validation | — |  | NOWORLD |  |
| 149 | `Plantation_building_loads_with_category` | K | content contract | — |  | NOWORLD |  |
| 160 | `Beer_chain_loads_with_expected_recipes` | K | beer avg demand < bread & soft_drink (guards AI tests' 'bread is biggest' assumption) | — |  | NOWORLD | encodes a cross-test dependency |
| 194 | `Coffee_beans_extracted_from_plantation_not_farm` | K | content contract | — |  | NOWORLD |  |
| 203 | `Recipe_cost_at_world_price_is_below_output_world_price_for_finished_goods` | K | economic sanity: input cost < output price | — |  | NOWORLD | tighten for Realistic into a margin band |

#### EventTests.cs — 9 tests (class A:3, C:5, K:1; mode BOTH:6, FIX:1, NOWORLD:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 77 | `Loading_content_with_no_events_directory_yields_empty_events` | A | content back-compat (no events dir) | — |  | NOWORLD |  |
| 94 | `Seed_events_load_at_least_eight_definitions` | K | event ids | — |  | NOWORLD |  |
| 111 | `RollAndApply_is_deterministic_given_same_seed` | A | RNG determinism; K.EvP 0.20 (≥1 fire in 24 rolls, seed 12345) | — |  | BOTH |  |
| 134 | `Price_multiplier_event_changes_effective_world_price_for_duration` | C | price overlay (internal SetActivePriceEffect/TickActivePriceEffects) | — |  | BOTH |  |
| 156 | `Price_effect_expires_after_duration_months` | C | price overlay expiry | — |  | BOTH |  |
| 179 | `Brand_shift_event_mutates_brand_awareness_within_cap` | C | brand shift clamp | — |  | BOTH |  |
| 225 | `Headline_only_event_appends_news_with_no_other_state_change` | C | news log | — |  | BOTH |  |
| 261 | `NewsLog_and_active_effects_round_trip_save_load` | A | persistence v9 | — |  | FIX | continuation check `Count >= before` is trivially true; RNG not persisted |
| 307 | `Active_price_effect_changes_market_buy_cost` | C | effective world price → F.Buy | — | **YES** | BOTH | needs instant construction |

#### MultiCityWarehouseTests.cs — 10 tests (class B:1, C:7, K:2; mode BOTH:7, CLASSIC+TWIN:1, NOWORLD:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 33 | `All_five_cities_load` | K | city ids | — |  | NOWORLD |  |
| 44 | `Demand_in_each_city_scales_with_population_and_demographics` | K | bread demand ordering; re-implements F.Demand inline | — |  | NOWORLD | inline copy of demand formula |
| 68 | `Stores_in_different_cities_dont_compete_for_demand` | B | F.Demand full capture: metropolis bread 3.575M∈[3.5M,3.65M], hilltown 640k∈[600k,700k]; C.pop/demographics/per-capita; memo '@ B#' | M13, M16, C03, C05, B1, B3 | **YES** | CLASSIC+TWIN | twin: no cross-city leakage (qualitative) |
| 93 | `Warehouse_stocks_from_world_market_when_no_internal_supply` | C | warehouse top-up to target (1,000 exact) | — | **YES** | BOTH | needs instant construction |
| 108 | `Warehouse_keeps_stock_across_months_no_auto_export` | C | warehouse no auto-export | — |  | BOTH |  |
| 122 | `Retailer_pulls_from_warehouse_in_same_city` | C | F.Proc warehouse source; memo contains store id | — | **YES** | BOTH | memo-string coupling |
| 147 | `ConfigureWarehouseSlot_rejects_non_warehouse_buildings` | C | validation | — |  | BOTH |  |
| 160 | `Inter_city_pull_charges_shipping` | C | ShippingCost on inter-city pull | — | **YES** | BOTH | needs instant construction |
| 185 | `Same_city_pull_does_not_charge_shipping` | C | no shipping same city | — |  | BOTH |  |
| 205 | `Same_city_source_is_preferred_over_other_city_source` | C | F.Proc ordering; 2 slots×300 ≥ 200 cycles×2 ore | — |  | BOTH | throughput coupling |

#### PatentTests.cs — 18 tests (class A:2, C:16; mode BOTH:17, FIX:1)

All tests except `Grant_throws_when_no_active_patent` reach max tech through `totalToMax = 100.0 * maxTech * (maxTech - 1) / 2.0`, a hard-coded copy of K.RThr (L63, 93, 121, 147, 176, 209, 244, 433, 478) or `100.0 * (maxTech - 1)` (L191). Compute it from the rules instead; M06 broke 16 of these tests.

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 52 | `Reaching_max_tech_grants_patent_with_24_month_expiry` | C | K.RThr literal + K.PatDur 24 | M06, M11 |  | BOTH |  |
| 83 | `Competitor_research_stalls_while_rivals_patent_active` | C | K.RThr literal | M06 |  | BOTH |  |
| 114 | `Holder_own_research_continues_without_exception_during_patent` | C | K.RThr literal | M06 |  | BOTH |  |
| 139 | `Competitor_research_resumes_after_patent_expires` | C | K.RThr literal + K.PatDur (25 months) | M06 |  | BOTH |  |
| 169 | `Holder_does_not_receive_second_patent_after_first_expires` | C | K.RThr literal + internal InternalTech/InternalResearchProgress | M06 |  | BOTH |  |
| 201 | `Save_and_load_round_trips_active_patents_and_ever_granted` | C | K.RThr literal; persistence v6 | M06 |  | BOTH |  |
| 250 | `Granting_license_unblocks_competitor_research` | C | K.RThr literal | M06 | **YES** | BOTH |  |
| 270 | `Grant_is_idempotent_and_deterministic` | C | K.RThr literal | M06 |  | BOTH |  |
| 285 | `Grant_throws_when_no_active_patent` | C | validation | — |  | BOTH |  |
| 297 | `Grant_throws_when_caller_is_not_holder` | C | K.RThr literal | — |  | BOTH |  |
| 307 | `Revoke_reblocks_competitor_next_tick` | C | K.RThr literal | M06 |  | BOTH |  |
| 327 | `Revoke_is_idempotent` | C | K.RThr literal | M06 |  | BOTH |  |
| 338 | `Royalty_transfers_five_percent_from_licensee_to_holder` | C | K.Roy (via constant) + 'holder cash rose ≥ royalty' + K.RThr literal | M06, M21, B1, B3 | **YES** | BOTH | cash-delta assertion breaks with income tax (M21); contains a tautological Assert (L379-380) |
| 389 | `Patent_expiry_cascades_to_license_removal` | C | K.RThr literal + K.PatDur | M06 |  | BOTH |  |
| 404 | `Save_and_load_round_trips_active_license` | C | K.RThr literal; persistence v7 | M06 |  | BOTH |  |
| 420 | `Save_load_midrun_yields_identical_royalty_stream` | A | save/load continuation (cash) | M06 |  | FIX | passes only because no fired event touches this setup; RNG not persisted |
| 467 | `Royalty_stream_is_deterministic_for_same_seed` | A | determinism | M06 |  | BOTH |  |
| 496 | `Income_statement_treats_royalty_income_as_revenue_and_expense_as_opex` | C | F.IS category mapping | M06 | **YES** | BOTH |  |

#### PerBuildingPnLTests.cs — 8 tests (class A:8; mode BOTH:8)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 37 | `Opex_entries_carry_the_correct_building_id` | A | attribution + exactly 1 OperatingCost/building + amount == MonthlyOperatingCost | M19, B3 | **YES** | BOTH | split: attribution (BOTH) vs amount (CLASSIC) |
| 65 | `Sales_entries_carry_the_retailer_building_id` | A | attribution | — | **YES** | BOTH | needs instant construction |
| 86 | `Procurement_entries_carry_the_destination_building_id` | A | attribution | — | **YES** | BOTH | needs instant construction |
| 105 | `Export_sales_carry_the_source_building_id` | A | attribution; relies on auto-export | — | **YES** | BOTH | needs instant construction + export enabled |
| 124 | `Construction_cost_entries_carry_the_new_building_id` | A | attribution (exactly one ConstructionCost) | — |  | BOTH |  |
| 139 | `Starting_capital_and_advertising_leave_building_null` | A | attribution | — |  | BOTH |  |
| 156 | `Cogs_entries_carry_the_source_building_id` | A | COGS attribution | — | **YES** | BOTH | needs instant construction |
| 190 | `Per_building_ledger_sums_reconcile_to_per_company_totals` | A | cash==Σledger; null-bucket ⊆ {StartingCapital, AdvertisingCost} (hard-coded whitelist, L238-244) | M21, M22, B1, B3 |  | BOTH | whitelist must come from engine metadata |

#### PersistenceTests.cs — 28 tests (class A:28; mode BOTH:26, FIX:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 44 | `Save_then_load_preserves_empty_world` | A | save/load round-trip | — |  | BOTH |  |
| 57 | `Save_then_load_preserves_companies_and_cash` | A | save/load round-trip | — |  | BOTH |  |
| 73 | `Save_then_load_preserves_buildings_and_slots` | A | save/load round-trip | — |  | BOTH |  |
| 109 | `Save_then_load_preserves_inventory_including_cost_and_quality` | A | save/load round-trip | — |  | BOTH |  |
| 126 | `Save_then_load_preserves_tech_brand_and_research_progress` | A | save/load round-trip | — |  | BOTH |  |
| 150 | `Save_then_load_preserves_ad_campaigns` | A | save/load round-trip | — |  | BOTH |  |
| 165 | `Save_then_load_preserves_ai_strategies` | A | save/load round-trip | — |  | BOTH |  |
| 186 | `AdaptiveStrategy_config_round_trips_through_save_load` | A | AI config persistence (internal InternalAiStrategies) | — |  | BOTH |  |
| 217 | `AdaptiveStrategy_default_config_round_trips` | A | AI config persistence | — |  | BOTH |  |
| 240 | `VerticalIntegrator_config_round_trips_through_save_load` | A | AI config persistence | — |  | BOTH |  |
| 269 | `Load_accepts_v4_save_missing_cogs_source_building` | A | schema back-compat | — |  | BOTH | v1–v9 saves must load as Classic |
| 293 | `Cogs_source_building_round_trips_through_save_load` | A | save/load round-trip | — | **YES** | BOTH |  |
| 317 | `Load_accepts_v5_save_missing_patents` | A | schema back-compat | — |  | BOTH |  |
| 341 | `Load_accepts_v8_save_missing_news_log_and_price_effects` | A | schema back-compat | — |  | BOTH |  |
| 363 | `Load_accepts_v6_save_missing_patent_licenses` | A | schema back-compat | — |  | BOTH |  |
| 388 | `Load_accepts_v2_save_missing_ai_strategy_config` | A | schema back-compat | — |  | BOTH |  |
| 416 | `Ledger_transfer_and_cogs_logs_round_trip` | A | save/load round-trip | — |  | BOTH |  |
| 444 | `Simulation_continues_deterministically_across_save_load` | A | save/load continuation (cash, ledger count, tech) | — |  | FIX | passes by coincidence: RNG reseeded with 0 on load |
| 486 | `Load_rejects_mismatched_schema_version` | A | schema back-compat | — |  | BOTH |  |
| 499 | `Save_round_trips_scenario_and_player_metadata` | A | save/load round-trip | — |  | BOTH |  |
| 518 | `Save_without_metadata_leaves_fields_null` | A | save/load round-trip | — |  | BOTH |  |
| 536 | `Load_accepts_v3_save_missing_ledger_building_field` | A | schema back-compat | — |  | BOTH |  |
| 561 | `Save_then_load_preserves_ledger_building_attribution` | A | save/load round-trip | — |  | BOTH |  |
| 590 | `Load_accepts_v1_save_with_missing_metadata_fields` | A | schema back-compat | — |  | BOTH |  |
| 609 | `Save_with_metadata_still_deterministic_across_chain_simulation` | A | same as L444 + transfer/cogs counts | — |  | FIX | passes by coincidence: RNG reseeded with 0 on load |
| 643 | `ListSaves_returns_metadata_for_each_json_in_directory` | A | save browser header parsing | — |  | BOTH | file-system based; Bridge needs string/stream equivalents |
| 682 | `ListSaves_returns_empty_when_directory_missing` | A | save browser header parsing | — |  | BOTH |  |
| 691 | `ListSaves_skips_malformed_files` | A | save browser header parsing | — |  | BOTH |  |

#### QualityBrandTechTests.cs — 14 tests (class B:7, C:5, N:2; mode BOTH:10, CLASSIC:2, NOWORLD:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 34 | `Inventory_average_quality_is_weighted_by_quantity` | N | Inventory math | — |  | NOWORLD |  |
| 46 | `Inventory_take_returns_current_average_quality` | N | Inventory math | — |  | NOWORLD |  |
| 60 | `Market_bought_goods_carry_world_market_quality` | B | K.WMQ via constant; restock 4M > metropolis soft_drink demand 3.3M | C03 | **YES** | BOTH | needs leftover stock; needs instant construction |
| 75 | `Extracted_raws_carry_extraction_quality` | B | K.ExQ via constant | — | **YES** | BOTH | needs instant construction |
| 90 | `Production_output_quality_is_weighted_average_of_inputs` | B | F.Prod quality = qty-weighted inputs → 74; C.soft_drink recipe 20/5 | — | **YES** | CLASSIC | Realistic likely adds tech/process quality |
| 116 | `Tech_level_defaults_to_base` | C | K.BaseTech via constant | — |  | BOTH |  |
| 125 | `Tech_level_cannot_exceed_product_max` | C | validation | — |  | BOTH |  |
| 137 | `Tech_level_rejects_below_one` | C | validation | — |  | BOTH |  |
| 148 | `Brand_awareness_defaults_to_zero` | C | K.BaseBrand | — |  | BOTH |  |
| 157 | `Brand_awareness_rejects_out_of_range` | C | validation | — |  | BOTH |  |
| 170 | `Higher_tech_company_wins_more_share_at_equal_price` | B | F.Softmax tech term (qualitative) | — | **YES** | BOTH | needs instant construction |
| 193 | `Higher_brand_awareness_wins_more_share_at_equal_price_in_that_city` | B | F.Softmax brand term (qualitative) | — | **YES** | BOTH | needs instant construction |
| 213 | `Premium_retailer_can_still_win_when_quality_overcomes_price_gap` | B | F.Softmax weights (T×10, B) vs price^0.7 at 30% premium | — | **YES** | CLASSIC |  |
| 239 | `Equal_attributes_and_price_give_equal_shares` | B | symmetry (0.98–1.02) | — | **YES** | BOTH | symmetry property; NaN when nothing sells |

#### ReportingTests.cs — 14 tests (class A:9, B:2, C:2, K:1; mode BOTH:11, CLASSIC+TWIN:1, FIX:1, NOWORLD:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 33 | `Initial_balance_sheet_equals_starting_capital` | A | BS at t0 | — |  | BOTH |  |
| 48 | `Construction_moves_value_from_cash_to_buildings_keeping_total_assets_unchanged` | A | TotalAssets conserved; BuildingValue == ConstructionCost | M33 |  | BOTH | keep the TotalAssets invariant; move exact cash/BuildingValue to CLASSIC |
| 64 | `Market_bought_inventory_carries_cost_basis_at_world_price` | B | F.Buy cost basis = C.car 18,000 | — |  | FIX | VACUOUS: all 10 cars sell, asserts 0 == 0×18,000 |
| 84 | `Self_produced_inventory_carries_only_input_cost_not_market_price` | B | variable costing: extracted raws cost 0 (MonthlyTick.cs:194-210) | — | **YES** | CLASSIC+TWIN | Realistic absorption costing capitalises labour/overhead |
| 108 | `Production_rolls_input_cost_into_output_inventory` | A | WAC roll-up (0 < cost < market) | — | **YES** | BOTH |  |
| 140 | `Cogs_is_recorded_when_goods_are_sold` | A | COGS recognition | — | **YES** | BOTH | needs instant construction |
| 155 | `Income_statement_separates_revenue_cogs_and_opex` | A | IS identities GP=Rev−COGS, NI=GP−Opex | — | **YES** | BOTH | generalise when IS gains D&A/interest/tax lines |
| 173 | `Equity_equals_starting_capital_plus_cumulative_net_income` | A | books close | — |  | BOTH |  |
| 201 | `Inter_city_shipping_capitalizes_into_inventory_not_opex` | A | OperatingExpenses == Σ OperatingCost exactly | M20, M32, B1, B3 | **YES** | BOTH | rewrite as 'shipping ∉ opex' |
| 233 | `Profitability_attributes_revenue_and_cost_to_correct_product` | A | product P&L | — | **YES** | BOTH | needs instant construction |
| 250 | `Profitability_excludes_opex_and_construction` | A | product P&L exclusion | — |  | BOTH |  |
| 269 | `Internal_pull_emits_a_transfer_entry` | C | exactly one transfer; C.sugarcane yield covers need | — | **YES** | BOTH | needs instant construction |
| 293 | `Vertical_chain_emits_transfer_per_internal_link` | C | transfer per link | — | **YES** | BOTH | needs instant construction |
| 322 | `Rebalanced_durables_have_realistic_annual_demand` | K | car demand 20–100 per 1000/yr; inline F.Demand | — |  | NOWORLD | already a realism test – extend the pattern |

#### ResearchTests.cs — 8 tests (class B:5, C:3; mode BOTH:4, CLASSIC:3, CLASSIC+TWIN:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 34 | `ConfigureResearchSlot_rejects_non_rd_buildings` | C | validation | — |  | BOTH |  |
| 45 | `ConfigureResearchSlot_succeeds_on_rd_center` | C | slot config | — |  | BOTH |  |
| 60 | `One_month_of_research_with_one_slot_reaches_level_two` | B | K.RP 100 / K.RThr 100 → level 2 | M05, M06 | **YES** | CLASSIC |  |
| 76 | `Progress_accumulates_between_level_ups` | B | K.RP/K.RThr → progress 100 | M05, M06 | **YES** | CLASSIC |  |
| 93 | `Multiple_slots_advance_tech_faster` | B | K.RP/K.RThr → level 3 + 100 | M05, M06 | **YES** | CLASSIC |  |
| 115 | `Tech_caps_at_max_and_progress_zeros_out` | C | tech cap | — |  | BOTH |  |
| 136 | `Different_companies_research_progress_independently` | B | K.RP/K.RThr (acme == 2) | M05, M06 | **YES** | BOTH | assert acme > 1 && rival == 1 to make it ruleset-agnostic |
| 154 | `Researched_company_eventually_wins_share_on_tech_alone` | B | K.RP/K.RThr (tech ≥ 4 in 10 months) + F.Softmax (>1.3× sales) | — |  | CLASSIC+TWIN |  |

#### ReservationPriceTests.cs — 6 tests (class A:1, B:5; mode BOTH:2, CLASSIC:3, CLASSIC+TWIN:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 53 | `Product_without_reservation_prices_behaves_unconditionally` | B | F.Demand has no price-quantity curve (bread sells fully at $50 = 20× world) | — | **YES** | CLASSIC | encodes an unrealistic property; Realistic should assert the opposite |
| 81 | `Price_above_low_ceiling_drops_low_bracket_only` | B | F.Reserve (sales at $9 < 90% of $1.80) | M28 | **YES** | CLASSIC+TWIN |  |
| 111 | `Two_retailers_split_brackets_differently_when_one_breaches_low_ceiling` | B | F.Reserve + F.Softmax (qualitative) | — | **YES** | BOTH |  |
| 155 | `Reservation_in_only_some_brackets_leaves_others_untouched` | B | F.Demand full capture: 750 ±5% (500k×0.15×0.010) | M13, M16, M28, B1, B3 | **YES** | CLASSIC |  |
| 194 | `Zero_ceiling_locks_a_bracket_out_entirely` | B | F.Demand full capture: 1,200 ±5% | M13, M16, M28, B1, B3 | **YES** | CLASSIC |  |
| 233 | `Same_seed_produces_identical_sales_with_reservation_pricing` | A | determinism | — |  | BOTH |  |

#### ScenarioTests.cs — 29 tests (class B:6, C:13, K:10; mode BOTH:13, CLASSIC+TWIN:6, NOWORLD:7, SNAPSHOT:3)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 32 | `All_seed_scenarios_load` | K | scenario JSON contract | — |  | NOWORLD |  |
| 41 | `Sandbox_has_no_goals` | K | scenario JSON contract | — |  | NOWORLD |  |
| 48 | `Soft_drink_war_has_market_share_and_value_goals` | K | scenario JSON contract | — |  | NOWORLD |  |
| 60 | `Runner_creates_player_and_ai_competitors` | C | ScenarioRunner.Apply | — |  | BOTH | Apply's default-ruleset decision lands here |
| 73 | `Runner_sets_world_clock_to_scenario_start` | C | ScenarioRunner.Apply | — |  | BOTH |  |
| 83 | `Market_share_is_zero_in_city_with_no_retailers` | C | GetMarketShare | — |  | BOTH |  |
| 91 | `Market_share_is_one_when_only_retailer` | B | F.Softmax share (no outside option/incumbent) | M16, B1, B3 |  | CLASSIC+TWIN | incumbent (M16) → 0.10 |
| 102 | `Market_share_reflects_softmax_weights_not_just_retailer_count` | B | F.Softmax share sums to 1 among player retailers | M16, B1, B3 |  | CLASSIC+TWIN |  |
| 128 | `Corporate_value_goal_achieved_when_assets_cross_threshold` | C | goal math (TotalAssets) | — |  | BOTH |  |
| 141 | `Market_share_goal_achieved_at_monopoly` | B | F.Softmax share = 1 at monopoly | M16, B1, B3 |  | CLASSIC+TWIN |  |
| 153 | `Goal_progress_reports_ratio_before_achievement` | C | goal progress | — |  | BOTH |  |
| 168 | `Scenario_run_advances_goals_over_time` | C | goal eval runs (weak: non-empty Detail only) | — |  | BOTH |  |
| 188 | `Tutorial_scenario_loads_with_five_goals` | K | scenario JSON contract | — |  | NOWORLD |  |
| 196 | `OwnsBuildingOfCategoryGoal_tracks_count` | C | goal counts constructed buildings immediately | — |  | BOTH | decide: do buildings under construction count? |
| 213 | `ProductRetailedGoal_triggers_when_any_retail_slot_added` | C | goal | — |  | BOTH | decide: does a slot on an unfinished building count? |
| 229 | `AdCampaignActiveGoal_triggers_only_for_non_zero_budget` | C | goal | — |  | BOTH |  |
| 246 | `ElapsedMonthsGoal_counts_ticks_from_scenario_start` | C | goal | — |  | BOTH |  |
| 265 | `Multi_city_mogul_loads_with_three_share_goals_and_value_capstone` | K | scenario JSON contract | — |  | NOWORLD |  |
| 286 | `Tech_race_loads_with_research_and_retail_goals` | K | scenario JSON contract | — |  | NOWORLD |  |
| 316 | `Phase_3_11_scenarios_use_valid_products_and_cities` | K | scenario JSON contract | — |  | NOWORLD |  |
| 343 | `Phase_3_11_scenarios_runner_applies_cleanly` | C | ScenarioRunner.Apply | — |  | BOTH |  |
| 359 | `NetIncomeSinceStartGoal_tracks_cumulative` | B | profitability: NI ≥ $100k in 12 months (factory→store, no export) | — |  | CLASSIC+TWIN | survived bundles A/C – has headroom |
| 388 | `TopBrandGoal_triggers_at_threshold` | C | goal | — |  | BOTH |  |
| 406 | `ExportRevenueGoal_tracks_cumulative` | B | F.Export (auto-export default) ≥ $50k in 24 months | M29 |  | CLASSIC+TWIN |  |
| 427 | `ConsecutiveProfitableMonthsGoal_counts_streak` | B | profitability streak ≥ 6 of 10 months | — |  | CLASSIC+TWIN |  |
| 452 | `Monopolist_scenario_loads_with_expected_goal_types` | K | exact scenario thresholds (8M, 24, 70) | — |  | SNAPSHOT |  |
| 477 | `Monopolist_scenario_runner_applies_cleanly` | C | ScenarioRunner.Apply | — |  | BOTH |  |
| 494 | `Export_tycoon_scenario_loads_with_single_export_revenue_goal` | K | exact scenario threshold (5M) | — |  | SNAPSHOT |  |
| 507 | `Brand_monopolist_scenario_loads_with_three_top_brand_goals` | K | exact scenario thresholds (70) | — |  | SNAPSHOT |  |

#### SimulationTests.cs — 19 tests (class A:5, B:5, C:9; mode BOTH:14, CLASSIC:2, CLASSIC+TWIN:3)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 31 | `World_starts_at_provided_date` | A | clock | — |  | BOTH |  |
| 38 | `AdvanceMonth_rolls_year_over_december` | A | GameDate.AddMonth | — |  | BOTH |  |
| 46 | `CreateCompany_logs_starting_capital_and_sets_cash` | A | ledger==cash; exactly 1 StartingCapital entry | — |  | BOTH | breaks if company creation books extra entries |
| 59 | `Construct_charges_cost_and_adds_building_to_company` | B | construction cash = ConstructionCost only | M33 |  | CLASSIC+TWIN | twin: cash delta == construction + land |
| 72 | `Construct_rejects_insufficient_cash` | C | affordability check | — |  | BOTH |  |
| 82 | `ConfigureProductionSlot_rejects_raw_products` | C | slot validation | — |  | BOTH |  |
| 98 | `Cash_equals_sum_of_ledger_entries_after_simulation` | A | cash==Σledger | — |  | BOTH |  |
| 116 | `Factory_produces_output_and_exports` | C | F.Export (auto-export default true), F.Buy | M29 | **YES** | CLASSIC+TWIN | twin: export only via explicit contract / spread |
| 131 | `Standalone_factory_is_profitable_over_a_year` | B | F.Export @ world price, C.soft_drink recipe margin (96% GM), K.Cycles | M29 |  | CLASSIC+TWIN | money-printer property; Realistic twin asserts the OPPOSITE (payback > 24 months) |
| 152 | `Retailer_sells_to_city_consumers_and_logs_product_sales` | C | F.Demand>0, F.Buy | — | **YES** | BOTH | needs instant construction |
| 168 | `Two_retailers_share_demand_by_inverse_price` | B | F.Softmax price term (qualitative) | — | **YES** | BOTH | qualitative monotonicity |
| 189 | `Simulation_is_deterministic_for_same_seed` | A | determinism (cash only) | — |  | BOTH | strengthen: compare the full state hash |
| 219 | `Extraction_slot_produces_raw_each_month` | B | C.sugarcane yield=400 (literal) | C06 | **YES** | CLASSIC | derive expected from the catalog to make it BOTH |
| 235 | `ConfigureExtractionSlot_rejects_mismatched_building_category` | C | slot validation | — |  | BOTH |  |
| 247 | `ConfigureExtractionSlot_rejects_intermediate_product` | C | slot validation | — |  | BOTH |  |
| 258 | `Factory_pulls_inputs_from_own_upstream_factory_in_same_city` | C | F.Proc; memo text 'sugar →' | — |  | BOTH | memo-string coupling (MaterialProcurement.cs:122) |
| 283 | `Retailer_pulls_inventory_from_own_factory_when_available` | C | F.Proc; K.Cycles×output(200k) ≥ target(100k) | — |  | BOTH | throughput coupling |
| 306 | `Vertical_chain_only_imports_unbacked_inputs_from_world_market` | C | F.Proc; C.sugarcane yield 400 ≥ 200 need; memo text | — | **YES** | BOTH | memo-string coupling |
| 341 | `AutoExport_only_dumps_surplus_after_retailers_have_pulled` | B | 225,000 = (K.Cycles 200 × C.output 1000 − 50,000) × C.price $1.50; F.Export @ world price | M01, M17, M29, C01, C02, B1, B3 | **YES** | CLASSIC | most formula-coupled test in the suite |

#### TechLeaderTests.cs — 6 tests (class A:2, C:4; mode BOTH:2, CLASSIC:3, FIX:1)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 34 | `Hero_product_is_the_highest_base_price_finished_good` | C | hero = max BaseWorldMarketPrice finished (= car) | C07 |  | CLASSIC | a pricier product broke 4 TechLeader tests |
| 61 | `TechLeader_builds_research_center_for_hero_when_none_exists` | C | hero = car | C07 |  | CLASSIC |  |
| 83 | `TechLeader_prices_hero_at_premium_above_competitor` | C | premium ≥ 1.29×22,000 (lower bound only) | C07 |  | FIX | misses the unit-cost bug (price → $10.9M); add an upper bound |
| 114 | `TechLeader_runs_ad_campaign_when_hero_retailer_exists` | C | hero ads $80k | C07 |  | CLASSIC |  |
| 140 | `TechLeader_config_round_trips_through_save_load` | A | AI config persistence | — |  | BOTH |  |
| 179 | `TechLeader_is_deterministic` | A | determinism | — |  | BOTH |  |

#### VerticalIntegratorTests.cs — 5 tests (class A:1, C:4; mode BOTH:3, CLASSIC:2)

| Line | Test | Cls | Depends on | Broke under | Constr. | Mode | Note |
|---|---|---|---|---|---|---|---|
| 31 | `VerticalIntegrator_builds_retailer_first` | C | VI build order | — |  | BOTH |  |
| 47 | `VerticalIntegrator_builds_factory_after_retailer` | C | VI build order | — |  | BOTH |  |
| 63 | `VerticalIntegrator_builds_full_chain_eventually` | C | VI chain within 24 months | — |  | CLASSIC | under construction time the chain takes longer |
| 78 | `VerticalIntegrator_advertises_contested_markets_only` | C | VI ads; C.bread biggest | C05 |  | CLASSIC |  |
| 100 | `VerticalIntegrator_is_deterministic` | A | determinism | — |  | BOTH |  |

**Tests added after the baseline (not in the table):**
- `PersistenceStringTests.SaveToString_then_LoadFromString_round_trips_and_advances_identically` (seed 7). Class **A**, mode **FIX**. It advances one month after the reload and compares the save JSON. That passes because no event fires in month 2 under seed 7 or seed 0, but the RNG position is not in the JSON, so identical JSON does not prove identical state.
- `PersistenceStringTests.LoadFromString_rejects_unsupported_schema`. Class **A**, mode BOTH.

---

## 5. Construction-time impact (M23: 46 tests go red if a new building skips its first tick)

- **AiTests** (1): `Player_and_ai_split_the_market_when_both_sell_same_product`
- **BuildingUpgradeTests** (1): `Monthly_opex_ledger_amount_reflects_level`
- **EventTests** (1): `Active_price_effect_changes_market_buy_cost`
- **MultiCityWarehouseTests** (4): `Inter_city_pull_charges_shipping`, `Retailer_pulls_from_warehouse_in_same_city`, `Stores_in_different_cities_dont_compete_for_demand`, `Warehouse_stocks_from_world_market_when_no_internal_supply`
- **PatentTests** (3): `Granting_license_unblocks_competitor_research`, `Income_statement_treats_royalty_income_as_revenue_and_expense_as_opex`, `Royalty_transfers_five_percent_from_licensee_to_holder`
- **PerBuildingPnLTests** (5): `Cogs_entries_carry_the_source_building_id`, `Export_sales_carry_the_source_building_id`, `Opex_entries_carry_the_correct_building_id`, `Procurement_entries_carry_the_destination_building_id`, `Sales_entries_carry_the_retailer_building_id`
- **PersistenceTests** (1): `Cogs_source_building_round_trips_through_save_load`
- **QualityBrandTechTests** (7): `Equal_attributes_and_price_give_equal_shares`, `Extracted_raws_carry_extraction_quality`, `Higher_brand_awareness_wins_more_share_at_equal_price_in_that_city`, `Higher_tech_company_wins_more_share_at_equal_price`, `Market_bought_goods_carry_world_market_quality`, `Premium_retailer_can_still_win_when_quality_overcomes_price_gap`, `Production_output_quality_is_weighted_average_of_inputs`
- **ReportingTests** (8): `Cogs_is_recorded_when_goods_are_sold`, `Income_statement_separates_revenue_cogs_and_opex`, `Inter_city_shipping_capitalizes_into_inventory_not_opex`, `Internal_pull_emits_a_transfer_entry`, `Production_rolls_input_cost_into_output_inventory`, `Profitability_attributes_revenue_and_cost_to_correct_product`, `Self_produced_inventory_carries_only_input_cost_not_market_price`, `Vertical_chain_emits_transfer_per_internal_link`
- **ResearchTests** (4): `Different_companies_research_progress_independently`, `Multiple_slots_advance_tech_faster`, `One_month_of_research_with_one_slot_reaches_level_two`, `Progress_accumulates_between_level_ups`
- **ReservationPriceTests** (5): `Price_above_low_ceiling_drops_low_bracket_only`, `Product_without_reservation_prices_behaves_unconditionally`, `Reservation_in_only_some_brackets_leaves_others_untouched`, `Two_retailers_split_brackets_differently_when_one_breaches_low_ceiling`, `Zero_ceiling_locks_a_bracket_out_entirely`
- **SimulationTests** (6): `AutoExport_only_dumps_surplus_after_retailers_have_pulled`, `Extraction_slot_produces_raw_each_month`, `Factory_produces_output_and_exports`, `Retailer_sells_to_city_consumers_and_logs_product_sales`, `Two_retailers_share_demand_by_inverse_price`, `Vertical_chain_only_imports_unbacked_inputs_from_world_market`

Notes:
- **Groups:**
  - 31 of these 46 are BOTH tests. They exercise pipeline mechanics (attribution, COGS, transfers, warehouses, quality plumbing) and should stay ruleset-agnostic.
  - 11 are CLASSIC and 4 are CLASSIC+TWIN.
  - No test failed under M23 without constructing directly.
- **Tests that survive M23 despite constructing and ticking** do so because they tick for ≥ 2 months, assert only ledger or structural invariants, or run AI logic that sees buildings under construction as "existing". Examples: `AdaptiveStrategy_starts_tv_ads_in_contested_markets` (counts a competitor that is still under construction as contesting the market) and `Equity_equals_starting_capital_plus_cumulative_net_income`.
- **Goal semantics to decide.** Should `OwnsBuildingOfCategoryGoal` and `ProductRetailedGoal` count unfinished buildings? Today they do, instantly (`ScenarioTests.cs:196-226`).

---

## 6. Pre-existing defects and weak oracles (fix these before or during the refactor)

| # | Severity | Finding | Evidence | Test gap | Fix and new test |
|---|---|---|---|---|---|
| D1 | **P0** | **Save/load is not lossless; RNG state is lost.** `WorldSaver.Snapshot` writes `Seed: 0` (`WorldSaver.cs:302` live, `:291` baseline). `WorldLoader.Rebuild` does `new World(catalog, save.Seed, …)` (`WorldLoader.cs:91` live, `:66` baseline). `DeterministicRandom` wraps `System.Random` with no exportable state (`Rng.cs:18-30`). After a reload the event stream restarts from seed 0. | Harness: two companies with TV ads plus a flour factory, seed 42. Direct 12-month run versus save at month 6 and reload: the direct news log has an extra `2026-08 viral_ad_spot`. Company 1: direct cash 18,924,282.52 vs reloaded 18,974,008.38. Company 2: 17,195,217.48 vs 17,145,491.62 (±49,725.86 — the brand shift moves share between them). A 20→30 split also diverges (29,415,156.31 vs 29,473,956.31). | `PersistenceTests.Simulation_continues_deterministically_across_save_load`, `…Save_with_metadata_still_deterministic…`, `PatentTests.Save_load_midrun_yields_identical_royalty_stream` and the new `PersistenceStringTests` all pass **by coincidence**: nothing in their setups is touched by the month 7–12 events (seed 42 fires viral_ad_spot at month 7, but those tests have no brand entries). | Schema v10 persists `seed` plus RNG state (§7.2 item 7). New test: a direct run versus a save/load mid-run with ads and commodity inputs over 24 months, comparing the **full state digest including the news log**. |
| D2 | **P1** | **Books do not close after an upgrade.** `UpgradeBuilding` books `UpgradeCost` (`World.cs:158-163`). The income statement excludes it (`World.cs:1000-1003`), and `GetBalanceSheet` adds only `type.ConstructionCost` (`World.cs:930`). | Harness: $10M company, supermarket, one upgrade, one tick. Equity **9,267,250** versus start + net income **9,987,250**, a gap of exactly −720,000 (the L2 upgrade cost). | No books-close test performs an upgrade. BuildingUpgradeTests check only cash and the ledger. | Capitalise upgrade capex into `BuildingValue` (and depreciate it under Realistic). Add upgrades to the property-test action set. |
| D3 | **P1** | **TechLeader floor uses the total cost basis.** `ownCogs = ownStore.Inventory.CostOf(product)` is the *total* cost of the stock on hand, not a unit cost; the floor is `ownCogs × 1.10` (`TechLeader.cs:170-173`). | Harness: the TechLeader car price goes 23,400 → **2,217,600** (month 4) → **10,922,740** (month 5). In the 60-month `four_archetype_melee` (auto-player, seed 42), Zenith Labs ends with **$73.1B** cash, cars are priced up to **$20.1M**, and 2030 car revenue is **$12.5B**. Adaptive and VI undercut ×0.95 against these runaway competitors, so they end with $26.1B and $18.7B. | `TechLeader_prices_hero_at_premium_above_competitor` checks only a lower bound (≥ 1.29 × 22,000). No test runs several AIs for a long time. | Use unit cost (`CostOf / Get`). Add an AI plausibility property: over 60 months with all archetypes, every retail price ≤ 5 × world price and every company's cash stays within a bounded multiple of its capacity. |
| D4 | **P1 (design)** | **Demand has no price–quantity response and no budget.** A sole seller sells the whole bracket demand at any price when no reservation price is set. The High bracket has no car ceiling, so High buys cars at $10M. | `ReservationPriceTests.Product_without_reservation_prices_behaves_unconditionally` *asserts* this: bread sells in full at $50, which is 20× the world price. The melee run above shows the effect. | Encoded as desired behaviour. | Realistic demand model with price elasticity of **quantity**, an outside option (incumbent or import) and a per-bracket spending budget. Keep the old test as CLASSIC; the Realistic twin asserts that quantity falls with price. |
| D5 | P2 | **Money printer.** One `soft_drink` slot in a $1.5M factory makes revenue **$300,000**, COGS **$11,000**, opex $20,000, net income **$269,000** a month (payback 5.6 months, 96 % gross margin). The cause is unlimited export at world price (`MonthlyTick.cs:470`) plus recipe margins (inputs ≈ $0.055 per $1.50 bottle). | Harness P4. | `Standalone_factory_is_profitable_over_a_year` *asserts* it. The content sanity test only requires input cost < price. | Realistic export spread and volume cap, labour, depreciation; tighter content margin bands. Twin test: an export-only factory has payback > 24 months. |
| D6 | P2 | **`GetMarketShare` differs from realised allocation.** It ignores reservation gating, bracket weights and stock-outs (`World.cs:949-978`), yet it drives `MarketShareGoal` and the client's MarketIntel. | Soft drink $1.50 versus $9.00: predicted **0.7780**, realised unit share **0.8732**. | Tests only check ordering and sum. | Compute share from the same allocator (or from last tick's realised units). Property test: predicted share == realised share when stock is ample. |
| D7 | P2 | **Vacuous oracle.** `ReportingTests.Market_bought_inventory_carries_cost_basis_at_world_price` restocks 10 cars, but metropolis car demand is about 1,200 a month, so all sell. The assertion becomes `0 == 0 × 18,000`. | Harness: `carsLeft=0 inventoryValue=0`. It also survived M18, the 1.10 import markup. | — | Restock ≥ demand plus slack (for example 5,000), or seed inventory. Assert `InventoryValue == carsLeft × effective buy price` with `carsLeft > 0`. |
| D8 | P2 | **Formula duplication.** The city-demand formula exists in 5 engine copies plus 2 inline test copies (`MultiCityWarehouseTests.cs:49-59`, `ReportingTests.cs:331-335`). The softmax exists twice. | — | Classic and Realistic will drift. | A single `IDemandModel` owned by the rules; the AI and `GetMarketShare` call it. |
| D9 | P2 | **Tests hard-code engine constants.** `PatentTests` uses the literal `100.0` threshold (10 sites). | M06 breaks 16 PatentTests. | — | Add a helper `TechPoints.ToMax(world.Rules, product)`. |
| D10 | P3 | **Memo-string coupling.** `SimulationTests.cs:276, 333-337` (`"sugar →"`, `"plastic →"`) and `MultiCityWarehouseTests.cs:137, 245` (`"B#"`, `"@ B#"`) depend on the memo formats at `MaterialProcurement.cs:122` and `MonthlyTick.cs:411`. | — | Any memo rewording (localisation, UI) breaks them. | Use the `Product` and `Building` fields (present since v4). |
| D11 | P3 | **Weak oracles.** `EventTests.NewsLog_and_active_effects_round_trip_save_load` checks continuation with `Count >= before` (always true). `PatentTests.cs:379-380` asserts `0 == 0`. `Scenario_run_advances_goals_over_time` checks only that `Detail` is non-empty. | — | — | Strengthen as noted in §4. |
| D12 | P3 | **Client writes engine state directly.** `BuildingInspector.cs:591` (`AutoExport`), `:754-755` (`Price`, `RestockTarget`), `:804` (`TargetStock`) bypass `World` validation. Tests inject stock through the public `Inventory.Add` (14 sites) with no ledger entry. | — | — | The Bridge should use validated commands; see §8.3. |
| D13 | P3 | **Schema and loader drift.** Every JSON schema sets `additionalProperties: false`. `ContentValidator` validates products, buildings and cities only — not events (although `event.schema.json` exists) and not scenarios. It is not run by `dotnet test`. `ContentLoader` silently ignores unknown or misspelled fields (System.Text.Json default). | — | New realism fields will fail the validator but pass the tests, or a typo will silently default. | Run schema validation in the test suite; set `UnmappedMemberHandling = Disallow` in a strict test load. |
| D14 | info | **Minor inaccuracies.** HANDOVER says the build has "0 warnings"; the actual build shows 217 unique CS1591 warnings (434 lines) from `Magnate.Engine`. `ReservationPriceTests.cs:86-89, 173-176` comments quote metropolis demographics as 0.30/0.45/0.25; the actual values are 0.45/0.40/0.15 (the tests compute from the catalog, so they still pass). | — | — | Cosmetic. |

---

## 7. Strategy: overhaul the economy with minimal churn and keep the invariants

### 7.1 Classic preset versus re-baselining

| Criterion | A: re-baseline numbers to the new economy | B: `EconomyRules` (Classic + Realistic), neutral-parameter design **(recommended)** |
|---|---|---|
| Test edits now | About 51 tests (B2 bundle, ~22 %), plus about 8 per content rebalance (C05) | **0**, as long as Classic stays bit-for-bit. Then 147 tests become `[Theory]` tests mechanically, 15 twins and 6 fixes. |
| Recurring churn | Every balancing pass breaks 1–8 exact-number tests (§3). New numbers get copied from engine output, so they are no longer an oracle. | Classic is frozen, so pinned tests never churn. Realistic uses ranges, properties and one golden master that is re-approved in the pull request (a visible diff). |
| Safety during the rewrite | Low. Code and expectations change together, so nothing independent checks the shared pipeline (procurement, WAC, COGS, attribution, persistence). | High. Classic golden master plus 46 pinned tests plus invariants under both presets prove that the pipeline refactor changed nothing. |
| Engine complexity | One code path | One code path with parameters. Only the demand model needs two implementations. Neutral fast-paths are required (§7.4 gotcha). Estimate < 300 lines of Classic-specific code. |
| Risk | Losing coverage of mechanics tests that break for unrelated reasons (construction time) | Classic rot. Mitigated by running all invariants and properties under both presets, freezing Classic, and removing it only by an explicit decision. |
| Player value | — | An optional "Classic / Arcade" mode. |

**Decision: B.** The evidence supports it:
- Invariant tests already survive consistent accounting changes (M20, M21, M22 green on books-close and cash==ledger).
- The breakage is concentrated in 46 exact-number tests that are valuable *as Classic oracles*.

### 7.2 Engine-side requirements that come from the test map (hand these to the engine and finance designers)

1. **`EconomyRules` is an immutable record owned by `World`** (`world.Rules`). There are no statics, because test classes run in parallel.
   - Constructor: `World(ContentCatalog, int seed, GameDate start, EconomyRules? rules = null)` or an options overload. `null` means `EconomyRules.Classic`.
   - This keeps 67 test sites plus `client/scripts/Main.cs:395` plus `tools/MagnateSim/Program.cs:92` compiling and behaving the same.
2. **Neutral-parameter design.** Every realism feature is a knob whose neutral value reproduces today exactly:

   | Knob | Classic (neutral) value | Realistic (example direction) |
   |---|---|---|
   | `ConstructionMonths` per building category | 0 | 1–12 |
   | `LandCostFactor` | 0 | > 0 |
   | `WagePerHead` | 0 | > 0 |
   | `DepreciationMonths` | 0 (none) | e.g. 240 |
   | `IncomeTaxRate` | 0 | e.g. 0.25 |
   | `InterestOnCash` / `LoanRates` | 0 / disabled | enabled |
   | `ExportPriceFactor` | 1 | < 1, e.g. 0.85 |
   | `ExportVolumeCap` | ∞ | finite |
   | `ImportPriceFactor` | 1 | > 1, e.g. 1.10 |
   | `AutoExportDefault` | true | false or explicit contracts |
   | `DemandModel` | `ClassicSoftmax` | `Realistic` (incumbent, quantity elasticity, budget) |
   | `OpexMultiplier` | 1 | as tuned |
   | `InventoryHoldingRate` | 0 | > 0 |
   | Today's constants: cycles 200, shipping 0.10, quality 50/50, research 100/100, patent 24 months / 5 %, ad cost per point, decay 0.02, media bonus 1.35/1.25, event probability 0.20 | current values | as tuned |
   | `CapitaliseUpgrades` | **true**, to fix D2 (a behaviour change for Classic that only touches the balance sheet; accept it and re-approve golden) | true |

3. **A single demand implementation per model.** The `IDemandModel` is used by `MonthlyTick`, `World.GetMarketShare`, `GoalEvaluation` and every AI's `ComputeCityDemand` (D8).
4. **Engine-owned ledger-category metadata.** For example `LedgerCategoryInfo.IsCompanyLevel`, `IsCapitalFlow`, `IsEquity`, `IncomeStatementLine`. The per-building null-bucket test (`PerBuildingPnLTests.cs:238-244`) and the client's report classifiers then read one source of truth instead of whitelists.
5. **Command-level mutation.** Add `World.SetRetailPrice/SetRestockTarget/SetWarehouseTarget/SetAutoExport` with validation, and make the Bridge use only these. The public setters stay for the legacy client (§8.3).
6. **Test hooks without widening the public API.** Keep `InternalsVisibleTo("Magnate.Engine.Tests")` and move it from `AdaptiveStrategy.cs:11` to the csproj (`<InternalsVisibleTo Include="Magnate.Engine.Tests" />`). Add internal `World.CompleteConstructionForTests(id)` only if the `WithInstantConstruction()` rules override is not enough.
7. **Persistence v10** (fixes D1):
   - Persist `seed`, RNG state, and the full `rules` snapshot (preset id plus every parameter value, so later retuning of `Realistic` never changes an existing save).
   - Persist new state: construction progress, plots, loans, fixed assets and accumulated depreciation, tax carry-forward.
   - v1–v9 saves load as Classic, with RNG = `seed` from the file (legacy behaviour, documented).
   - For the RNG, either keep the current algorithm but make its state serialisable, or reimplement .NET's seeded `Net5CompatSeedImpl`/`CompatPrng` (a 56-int array plus `inext`/`inextp`; `NextDouble()` and `Next(int)` each consume one sample). That is bit-identical, so Classic event schedules do not change. Guard it with a test comparing 10,000 draws against `new System.Random(seed)` for several seeds. Fallback: persist the draw count and replay it on load.

### 7.3 Test infrastructure to add (a `TestSupport/` folder in `Magnate.Engine.Tests`, shared by `Magnate.Bridge.Tests` via a linked file or a small `Magnate.Testing` project)

- **`TestContent`**
  - `Root`, resolved in this order: environment variable `MAGNATE_CONTENT_ROOT` → MSBuild-injected `AssemblyMetadata("RepoRoot", "$(MSBuildThisFileDirectory)../..")` → today's walk up to `global.json`.
  - `Live` (a lazily cached `ContentCatalog`).
  - `Classic`: a lazily cached catalog loaded from **`engine/Magnate.Engine.Tests/Fixtures/content-classic/`**, a byte-for-byte frozen copy of `content/` taken at the start of the overhaul. Classic-pinned tests use this, so Realistic content rebalancing (C01–C07 showed 1–8 failures per edit) never touches them.
- **`Worlds`**
  - `Worlds.Classic(seed = 42, start = 2026-01)` uses Classic rules and the Classic content.
  - `Worlds.Realistic(seed, instantConstruction: true)`.
  - `Rulesets.All` is the xUnit `MemberData` feeding `[Theory]` tests with `(name, rules, catalog)`.
- **Builders:** `ConstructReady(world, owner, type, city)` makes a building operational now under any ruleset; `SeedStock(building, product, qty, unitCost, quality)` also books a balancing equity or inventory entry so books close.
- **`Invariants.AssertAll(World w)`.** Call it after every tick in property, golden and scenario tests. It checks:
  1. `company.Cash == Σ ledger(company)` for every company.
  2. Books close: `Equity == Σ contributed capital (StartingCapital, EquityIssuance, −Dividends, −Buybacks) + Σ NetIncome(inception..now)`, using engine category metadata. Tolerance 0 for Classic and ≤ 0.01 for Realistic if rounding is introduced.
  3. `TotalAssets == Liabilities + Equity`.
  4. No NaN or ∞ anywhere (inventory qty and cost, prices, brand, research progress, weights).
  5. Inventory qty ≥ −1e-9 and cost ≥ 0 for every building and product.
  6. Brand ∈ [0, 100], tech ∈ [1, max], quality ∈ [0, 100].
  7. Ledger entries with `Building == null` belong only to company-level categories; entries with a building reference an existing building of the same owner.
  8. The CogsLog quantity for each product never exceeds the cumulative quantity that entered the company's inventory.
  9. Active patents are ≤ 1 per (holder, product); licences only on live patents.
  10. News-log dates are non-decreasing.
  11. Under Realistic: buildings under construction have no sales, production or restock entries.
- **`StateDigest.Of(World)`.** A canonical JSON of the whole state (ordinal-sorted, decimals normalised with `d / 1.0000000000000000000000000000m` to strip trailing zeros), plus a SHA-256. It is used by determinism, save/load and golden tests.

### 7.4 Concrete plan (ordered; each step has an exit gate)

**Step 0 — freeze the oracle (before any engine edit):**
- **Classic golden masters.** Use `MagnateSim` or an xUnit generator with `UPDATE_GOLDEN=1`. Produce a per-month digest (cash, revenue, COGS, opex, net income per company; units sold per city and product; news IDs; `StateDigest` hash) for these runs (seed 42):

  | Run | Final fingerprint at baseline |
  |---|---|
  | `magnate-sim 24 --seed 42` (cockpit) | Clock 2028-01. Acme 51,334,430.26069907220; RivalCo 178,758,800.1618223353800. 1,308 ledger / 396 COGS / 72 transfer entries, 30 buildings, 7 news items. |
  | `--scenario soft_drink_war --auto-player 36` | Acme Beverages 1,126,160.6852509609805000; RivalCo 1,417,008.9429628098985000; MegaMart 2,847,915.1328609435675000. 4,963 ledger / 1,386 COGS entries, 66 buildings. |
  | `--scenario vertical_showdown --auto-player 48` | Your Corp 50,561,106.1592802148153680000; ChainLink Industries 64,863,512.929255370084560000. 7,821 ledger entries, 54 buildings. |
  | `--scenario four_archetype_melee --auto-player 60` | Your Corp 1,168,379.8907409839655000; BasicCo 1,370,459,934.1185618918285969579; Adapta Holdings 26,111,447,726.810915253892209056; ChainLink Inc 18,704,852,406.304693299068635275; Zenith Labs 73,082,411,543.347296159944257578. 17,668 ledger entries, 108 buildings, 22 news items. |
  | A patents-and-licensing script | — |
  | An events-and-ads script | — |
  | An upgrades-and-warehouse script | — |

  After D2 is fixed, re-approve only the balance-sheet lines.
- **Freeze content.** Copy `content/` into `Fixtures/content-classic/` and point the 46 Classic-pinned tests there.
- **Add TestSupport and invariants.** Wire `Invariants.AssertAll` into a new property test (below) running on Classic. Expect D1 and D2 to fail; fix them with the regression tests from §6.
- **Exit gate:** 229 (231) green, golden masters stored, property test green on Classic.

**Step 1 — introduce `EconomyRules` (Classic only):**
- Move the `SimulationConstants` values in; `SimulationConstants` stays as an `[Obsolete]` facade returning `EconomyRules.Classic` values for the client and simulator (§8).
- Route `MonthlyTick`, `MaterialProcurement`, `World` ad and research code, `EventEngine` and the AI demand copies through `world.Rules` and one `IDemandModel`.
- **Gotcha — decimal scale.** `x * 1.0m` changes a decimal's scale (`225000m * 1.00m` = `225000.00`), which changes the save JSON and memo text even though `==` still holds. Implement neutral knobs as fast-paths (`if (f != 1m) price *= f;`), or normalise decimals in `StateDigest`. Double factors (`* 1.0`) are exact.
- **Exit gate:** all tests green **and** Classic golden digests numerically identical **and** byte-identical saves (if fast-paths are used).

**Step 2 — convert the test suite:**
- Replace the 18 copies of `ContentRoot()`/`NewWorld()` with TestSupport.
- Mark the 46 CLASSIC and CLASSIC+TWIN tests `[Trait("Ruleset", "Classic")]` and make them use `Worlds.Classic`.
- Convert the 147 BOTH tests to `[Theory][MemberData(nameof(Rulesets.All))]`. The 31 construction-sensitive ones use `instantConstruction: true` under Realistic.
- Convert the 6 SNAPSHOT tests to a content snapshot: a JSON of selected content numbers, re-approved on rebalance.
- Fix the 6 FIX tests. Replace memo-string matching (D10) and hard-coded constants (D9).
- **Exit gate:** the suite runs twice as long in count (~376 cases) and still finishes in under about 2 s of execution.

**Step 3 — build Realistic feature by feature.** For each knob:
- unit tests at non-neutral values;
- `Invariants.AssertAll` under Realistic;
- business-plausibility tests (§7.6);
- a Realistic golden master approved in the pull request (`Fixtures/golden/realistic/*.json`).

**Step 4 — flip the gameplay defaults:**
- Bridge `newGame` uses `Realistic`.
- Scenario JSON gains an optional `"economy": "realistic" | "classic"` field, default `realistic` (`ScenarioLoader`), and `ScenarioRunner.Apply(catalog, scenario, seed, rules?)` honours it.
- Save v10 persists the rules.
- Test: *Bridge `newGame` produces `Rules.Id == "realistic"`*, and *all 16 scenarios apply and run 24 months under Realistic with invariants green*.

**Step 5 — CI gates (§7.7).**

### 7.5 Which invariants to re-assert under Realistic

Run these under **both** presets:
- All 60 A-class BOTH tests. The key ones:
  - cash == ledger (`SimulationTests.Cash_equals_sum_of_ledger_entries_after_simulation`, `PerBuildingPnLTests.Per_building_ledger_sums_reconcile_to_per_company_totals` with the engine whitelist);
  - books close (`ReportingTests.Equity_equals_starting_capital_plus_cumulative_net_income`, `AdvertisingTests.Equity_still_equals_…`), generalised with contributed capital;
  - determinism (the 7 `*_is_deterministic` / same-seed tests, strengthened to `StateDigest` equality);
  - all save/load round-trips and all back-compat tests;
  - attribution (PerBuildingPnL), COGS and transfer recording, income-statement identities (generalised), `Profitability_excludes_opex_and_construction`.
- Every property from `Invariants.AssertAll` after every tick in the property and golden runs.

### 7.6 New tests to write

**Property tests** (hand-rolled, seeded with `DeterministicRandom` so a failure prints a replayable seed; 200 cases × 36 months per preset, about 3–6 s):
1. **Random action scripts.** Create 1–4 companies, then random `Construct`, `Configure*`, price changes, ads, upgrades, R&D, licences, (Realistic) loans and repayments, AI registration; advance 36 months. Call `Invariants.AssertAll` after every tick.
2. **Save/load equivalence.** For a random month k: save, load, continue, and require `StateDigest(direct) == StateDigest(reloaded)` at month 36. This catches D1. Also require `SaveToString(load(save(W))) == SaveToString(W)`.
3. **Determinism.** The same seed and script produce the same digest. Permuting the order in which same-tick player commands are issued (where the design says order is irrelevant) produces the same digest. Guards ordinal-sort iteration once contention exists; no current test pins processing order, since M27 was green.
4. **Monotonicity (Realistic demand).** With all else held equal, units sold at price p1 ≥ units sold at p2 for p1 < p2. Adding a competitor never increases an incumbent's units. More brand never reduces units.
5. **Share consistency.** `GetMarketShare` equals realised unit share when stock is ample (D6).
6. **Budget constraint (Realistic).** For each (city, month), Σ consumer spending ≤ Σ over brackets of population × income per capita × spend share.
7. **AI sanity (multi-seed, all four archetypes, 60 months, both presets).** Prices ≤ 5 × world price. Stock ≤ 6 × monthly city demand. No NaN. Cash bounded (D3).

**Realistic twins of the 15 CLASSIC+TWIN tests.** Each asserts the realistic *property* instead of a number, for example:
- `Standalone_factory…` becomes "an export-only factory's payback is > 24 months";
- `Market_share_is_one_when_only_retailer` becomes "a sole player retailer's share is in [0.3, 0.95] with incumbents";
- `ExportRevenueGoal` becomes an explicit export order;
- `AdaptiveStrategy_competes…` becomes "both AIs remain solvent over 36 months and each sells > 0 units".

**Feature tests per realistic system:**

| System | Tests |
|---|---|
| Construction | Not operational before ready. Opex and progress payments per rules. `ReadyAt` persisted. Goals count or ignore unfinished buildings per the decision in §5. The AI does not double-build while a building is pending. |
| Land and plots | Deterministic generation per (city, seed). A plot is occupied at most once. Footprint fits. Land cost is capitalised; land is not depreciated. |
| Labour | Wages booked to a separate `Wages` category with the building attached. Throughput scales with staffing. A zero-wage ruleset equals Classic. |
| Depreciation | Straight-line (or declining) schedule. BS building value + accumulated depreciation == cost. Σ depreciation over life == cost − salvage. |
| Tax | Charged only on positive taxable income. Loss carry-forward. Tax expense in the income statement equals the cash paid plus the payable. |
| Loans | Principal is in liabilities and equity is unchanged by borrowing. Interest is an expense. Amortisation schedule; default and credit limit. |
| Equity and stock market | Share issuance increases contributed capital. Dividends reduce retained earnings. Market cap comes from price × shares. The books-close generalisation holds. |
| Trade | Export spread and volume cap. Import markup. `GetEffectiveWorldPrice` events still apply. |
| Content plausibility (NOWORLD) | Every finished product's input cost / price lies in [0.25, 0.85]. Payback per building type at the reference price lies in [18, 120] months. Car demand stays at 20–100 per 1,000 people per year (extend `Rebalanced_durables…` to every durable). Schema validation of `content/` runs inside `dotnet test` (D13). |

### 7.7 CI gates

- `dotnet build Magnate.sln` with 0 errors (Godot client included).
- `dotnet test Magnate.sln` green.
- Classic golden digests match exactly.
- Realistic golden digests match the approved files; `UPDATE_GOLDEN=1` rewrites them and the diff is reviewed in the pull request.
- Property-test seed range fixed in CI plus a rotating nightly seed range.
- **Cross-runtime determinism.** Run the Classic golden scripts inside the browser-wasm host (Node or Playwright) and compare digests with native.
  - This is a risk, not a proven failure. The allocator uses `double` and `Math.Pow`, and libm results can differ by one ulp between CoreCLR on macOS and Mono/WASM; that difference would reach `(decimal)qty × price` and cash.
  - If it diverges, quantise the allocator outputs (for example round units to 1e-6) before converting to decimal.

---

## 8. Compile-time dependencies of the Godot client and the tools

Method: a Roslyn semantic scan over the real compile inputs of each project. The client's defines were taken from the `csc` command line (`GODOT;GODOT4_6_2;…`), and its references were GodotSharp 4.6.2, GodotSharpEditor, the engine and the .NET 8 reference assemblies, plus the 169 source-generator files. All projects scanned with 0 errors. Counts below exclude generated files and `using` directives.

Note that the client csproj is `Godot.NET.Sdk/4.6.2` (`client/Magnate.Client.csproj:1`), not 4.3 as HANDOVER states. `dotnet build Magnate.sln` builds it into `client/.godot/mono/temp/`.

### 8.1 Summary

| Consumer | Engine references | Files touching the engine | Constructs engine objects | Named arguments bound to engine parameter names | Internal APIs |
|---|---|---|---|---|---|
| Godot client (`client/scripts`, 35 files, 14.7k lines) | 2,953 | 22 | `GameDate` ×17, `ProductId` ×6, `CityId` ×4, `BuildingTypeId` ×3, `AdaptiveStrategy` ×3, `World` ×1 (`Main.cs:395`) | `seed:` ×4 (`World` constructor `Main.cs:395`; `ScenarioRunner.Apply` in `HeadlessSmokeTest`, `ScenarioPicker`, `TitleScreen`) | none |
| `tools/MagnateSim` (`Program.cs`, 425 lines) | 303 | 1 | `World` (L92), `GameDate` (L92,155,290), `ProductId` ×8, `CityId` ×7, `BuildingTypeId` ×6, `AdaptiveStrategy` (L130,328) | `price:` / `restockTarget:` (L108,113), `monthlyBudget:` (L124) | none |
| `tools/ContentValidator` (`Program.cs`, 198 lines) | 10 | 1 | — | — | none |
| Engine tests (reference only) | 6,548 | 18 | `ProductId` ×295, `CityId` ×222, `BuildingTypeId` ×181, `GameDate` ×84, `World` ×67, AI strategies ×35, goals ×13, `ActivePriceEffect` ×4, `EventDefinition` ×2, `Inventory` ×2 | `price` ×59, `restockTarget` ×60, `quality` ×14, `seed` ×9, `cost` ×9, `targetStock` ×4, `scenarioId`/`playerId` ×4, AI constructor parameters ×19, `Weight`/`Severity` ×2 | 31 (§1.2) |

Test call counts on the heaviest `World` members: `CreateCompany` ×210, `Construct` ×173, `AdvanceMonth` ×149, `ConfigureRetailSlot` ×74, `new World` ×67, `RegisterAi` ×34, `ConfigureProductionSlot` ×32, `GetTech` ×26, `RegisterAdCampaign` ×25, `ConfigureExtractionSlot` ×22, `GetBrandAwareness` ×21, `ConfigureResearchSlot` ×17, `GetMediaOwnershipBonus` ×16.

**No consumer constructs or deconstructs** `IncomeStatement`, `BalanceSheet`, `LedgerEntry`, `CogsEntry`, `TransferEntry`, `ProductProfitability`, `GoalEvaluation`, `Scenario*` or `SaveFileInfo`. They only read properties, so adding positional parameters to those records is compile-safe. The only positional construction sites are inside the engine:
- `World.cs:934` (`BalanceSheet`);
- `World.cs:1007` and `Goal.cs:139` (`IncomeStatement`);
- `World.cs:1054` (`ProductProfitability`);
- `ScenarioLoader`/`ScenarioRunner` (`Scenario*`);
- `WorldSaver.cs:122` (`SaveFileInfo`, by name).

### 8.2 Godot client: every engine member used

| Engine type | Members used — count (files) |
|---|---|
| `Ai.AdaptiveStrategy` | type-ref ×3 (Main, ScenarioPicker); `new(...)` ×3 (Main, ScenarioPicker) |
| `Content.ContentCatalog` | type-ref ×5 (GameState, HeadlessSmokeTest, Main, SaveBrowser); BuildingType ×19 (ActivityFeed, BuildingInspector, CityMap, FinancialStatements, Main, Manage, ReplayViewer, SaveBrowser, SlotEditor); BuildingTypes ×1 (Manage); Cities ×15 (CityMap, Manage, MarketIntel, SlotEditor, StatsDashboard); Product ×20 (BuildingInspector, Manage, Reports, SaveBrowser, SlotEditor); Products ×25 (BuildingInspector, CityMap, HeadlessSmokeTest, Manage, MarketIntel, ResearchTree, SlotEditor, StatsDashboard) |
| `Content.ContentLoader` | type-ref ×3; Load ×3 (HeadlessSmokeTest, Main, TitleScreen) |
| `Domain.BuildingType` | type-ref ×20; Category ×29 (BuildingInspector, Main, Manage, SaveBrowser); ConstructionCost ×9 (FinancialStatements, Manage); Id ×1 (Manage); MaxUnits ×11 (BuildingInspector, Manage, SlotEditor); MonthlyOperatingCost ×6 (BuildingInspector, Manage); Name ×15 (ActivityFeed, BuildingInspector, CityMap, FinancialStatements, Manage, ReplayViewer, SlotEditor); ProducibleTiers ×9 (BuildingInspector, Main, Manage); Retail ×8 (BuildingInspector, Main, Manage); TargetHeadcount ×6 (BuildingInspector, Manage) |
| `Domain.BuildingTypeId` | type-ref ×5; `new(...)` ×3 (HeadlessSmokeTest, Manage, SaveBrowser); Value ×3 (Reports, StatsDashboard) |
| `Domain.City` | type-ref ×25; BaseLandPrice ×1 (CityMap); Demographics ×6 (CityMap, MarketIntel); Geography ×5 (CityMap); Grid ×2 (CityMap); Id ×27 (CityMap, Manage, MarketIntel, StatsDashboard); Name ×14; Population ×8 (CityMap, Manage, MarketIntel) |
| `Domain.CityGeography` | Arable/Coastal/MineralRich/OilRich ×2 each (CityMap) |
| `Domain.CityGrid` | Height ×1, Width ×1 (CityMap) |
| `Domain.CityId` | type-ref ×16; `new(...)` ×4 (HeadlessSmokeTest, ReplayViewer); Equals ×10 (CityMap, MarketIntel); Value ×27; operator == ×5, != ×2 (SlotEditor) |
| `Domain.HeadcountRange` | Max ×2, Min ×2 (BuildingInspector, Manage) |
| `Domain.IncomeBracket` | type-ref ×15; High/Low/Middle ×4 each (CityMap, MarketIntel) |
| `Domain.Product` | type-ref ×48; BaseDemandPerCapita ×2 (CityMap, MarketIntel); BaseWorldMarketPrice ×5 (Reports, ResearchTree, SlotEditor); Category ×1; Extraction ×12; Id ×49; MaxTechLevel ×4 (Reports, ResearchTree, StatsDashboard); Name ×28; PriceElasticity ×3 (MarketIntel); Recipe ×23; Tier ×35; Unit ×12 (ResearchTree, SlotEditor) |
| `Domain.ProductExtraction` | SourceCategory ×4; YieldPerSlotPerMonth ×4 (BuildingInspector, ResearchTree, SlotEditor) |
| `Domain.ProductId` | type-ref ×48; `new(...)` ×6 (HeadlessSmokeTest, Manage, SaveBrowser); Equals ×8 (MarketIntel); Value ×71; operator == ×11 (Manage, ResearchTree, SlotEditor) |
| `Domain.ProductTier` | type-ref ×58; Finished ×18; Intermediate ×9; Raw ×12 |
| `Domain.Recipe` / `RecipeInput` | Inputs ×10; LaborUnits ×2 (ResearchTree, SlotEditor); OutputQuantity ×5; RecipeInput.ProductId ×12; Quantity ×5 |
| `Economics.BalanceSheet` | type-ref ×6 (FinancialStatements, GameState, HeadlessSmokeTest, Main, Reports, StatsDashboard); AsOf ×2; BuildingValue ×6; Cash ×4; Equity ×4; InventoryValue ×6; Liabilities ×3; TotalAssets ×8 |
| `Economics.CogsEntry` / `CogsLog` | Company ×1; Cost ×3; Date ×3; Quantity ×1; SourceBuilding ×2 (BuildingInspector, ReplayViewer); CogsLog.Entries ×1, EntriesFor ×1 |
| `Economics.IncomeStatement` | type-ref ×13 (ActivityFeed, FinancialStatements, GameState, HeadlessSmokeTest, Main, Reports, StatsDashboard); CostOfGoodsSold ×2; GrossProfit ×3; NetIncome ×17; OperatingExpenses ×2; Revenue ×7 |
| `Economics.Ledger` | Entries ×5 (ActivityFeed, BuildingInspector, Main, Manage); EntriesFor ×8; EntriesInRange ×1 (FinancialStatements) |
| `Economics.LedgerCategory` | type-ref ×41; AdvertisingCost ×3; ConstructionCost ×4; ExportSale ×8; InputPurchase ×2; OperatingCost ×5; ProductSale ×7; RetailRestock ×2; ShippingCost ×2; StartingCapital ×3 (not referenced: PatentRoyaltyIncome/Expense, UpgradeCost) |
| `Economics.LedgerEntry` | type-ref ×14; Amount ×31; Building ×12; Category ×17; Company ×1; Date ×15; Product ×10 |
| `Economics.ProductProfitability` | Cost, MarketingCost, NetMargin ×2, NetMarginPct ×2, Product, Revenue (Reports) |
| `Economics.TransferEntry` / `TransferLog` | Company, Date, From, Product, Quantity, To; TransferLog.Entries ×2 (ActivityFeed) |
| `Persistence.SaveFileInfo` | FileName ×3; FileSize ×2; FullPath ×4; GameDate ×1; ScenarioId ×1; SchemaVersion ×2; Timestamp ×4 (SaveMenu) |
| `Persistence.WorldLoadResult` / `WorldLoader` | PlayerId ×2; ScenarioId ×7; World ×4; WorldLoader.Load ×3 (HeadlessSmokeTest, SaveBrowser, SaveMenu) |
| `Persistence.WorldSaver` | ListSaves ×3 (SaveMenu); MinSupportedSchemaVersion ×1 and SchemaVersion ×1 (SaveBrowser); Save ×5 (GameState, HeadlessSmokeTest, Main, SaveMenu) |
| `Scenarios.*` | ExportRevenueGoal.Amount, MarketShareGoal.Threshold, TopBrandGoal, Goal (ScenarioDifficulty); GoalEvaluation.{Achieved ×11, Description ×12, Detail ×2, Progress ×2}; Scenario.{AiCompetitors, Description, EndDate, Goals ×9, Id ×10, Name ×9, Player, StartDate ×4}; ScenarioCompany.{StartingCash, Strategy}; ScenarioPlayer.StartingCash; ScenarioLoader.LoadAll ×7; ScenarioRunner.Apply ×3 (named `seed:`), EvaluateGoals ×6 |
| `Simulation.AdCampaign` / `AdChannel` | Channel ×6; City ×10; Company ×8; MonthlyBudget ×3; Product ×9; AdChannel.TV ×1 |
| `Simulation.BuildingInstance` | type-ref ×52; AutoExport ×3 (**written** at BuildingInspector.cs:591); City ×39; ExtractionSlots ×9; Id ×57; Inventory ×10; Level ×1 (SlotEditor); Owner ×36; ProductionSlots ×13; ResearchSlots ×13; RetailSlots ×21; TypeId ×16; WarehouseSlots ×9 |
| `Simulation.BuildingInstanceId` | Value ×34; operator == ×1, != ×4 |
| `Simulation.Company` / `CompanyId` | Cash ×11; Id ×25; Name ×22; CompanyId.{Equals ×13, ToString ×1, Value ×13, operator == ×15, != ×11} |
| `Simulation.EventSeverity` / `NewsEntry` | EventSeverity.Major; NewsEntry.{Headline, Severity} (Main) |
| `Simulation.*Slot` | ExtractionSlot/ProductionSlot/ResearchSlot/WarehouseSlot/RetailSlot .Index and .Product; RetailSlot.Price ×8 and RestockTarget ×6 (**written** at BuildingInspector.cs:754-755); WarehouseSlot.TargetStock ×6 (**written** at BuildingInspector.cs:804) |
| `Simulation.GameClock` / `GameDate` | Clock.Now ×38; `new GameDate(...)` ×17; AddMonth ×1; AsMonthIndex ×32; Month ×11; Year ×11; ToString ×1; operators ==, !=, <, <=, > |
| `Simulation.Inventory` | AverageQuality ×1 (MarketIntel); EntriesWithCost ×3; Get ×6 |
| `Simulation.Patent` / `PatentLicense` | ExpiresAt, Holder, Product; Licensee (Manage) |
| `Simulation.SimulationConstants` | AdCostPerPoint(); BaseResearchThreshold ×3 (Reports, ResearchTree); BaseTechLevel ×3 (GameState, HeadlessSmokeTest); BrandDecayRate ×2 (Manage); CyclesPerSlotPerMonth ×7 (BuildingInspector, SlotEditor); Tv/Radio/Newspaper/MagazineAdCostPerPoint (Manage); ResearchPointsPerSlotPerMonth ×2 (BuildingInspector, ResearchTree) |
| `Simulation.World` | `new World(catalog, seed: 42, …)` (Main.cs:395); AdCampaigns ×4; AdvanceMonth ×5; Buildings ×31; Catalog ×77; Clock ×38; CogsLog ×2; Companies ×31; Configure{Extraction,Production,Research,Warehouse}Slot ×3 each and ConfigureRetailSlot ×4 (BuildingInspector, HeadlessSmokeTest, Manage); Construct ×3 (HeadlessSmokeTest, Manage); CreateCompany ×2 (Main); GetActivePatents; GetBalanceSheet ×6; GetBrandAwareness ×6; GetIncomeStatement ×12; GetMarketShare ×5; GetMediaOwnershipBonus ×2; GetPatentLicenses; GetProductProfitability ×2; GetResearchProgress ×4; GetTech ×11; GrantPatentLicense; Ledger ×14; NewsLog ×2; RegisterAdCampaign ×3; RegisterAi ×3; RevokePatentLicense; TransferLog ×2. **Not used by the client:** UpgradeBuilding, SetTech, SetBrandAwareness, GetCapacity, GetMonthlyOpex, GetEffectiveWorldPrice, ActivePriceEffects, IsPatentBlocked, Get/CancelAdCampaign, Rng. |

**`tools/MagnateSim/Program.cs` — engine members with line numbers:**
- `ContentLoader.Load` L78; `ContentCatalog.{Products, BuildingTypes, Cities}` L79, `.BuildingType()` L165, `.Product()` L398.
- `new World(catalog, seed, new GameDate(2026,1))` L92.
- `World.CreateCompany` L95,129; `.Construct` L98,101,104,107,112,117; `.ConfigureExtractionSlot` L99; `.ConfigureProductionSlot` L102,105; `.ConfigureRetailSlot(…, price:, restockTarget:)` L108,113; `.ConfigureResearchSlot` L118; `.RegisterAdCampaign(…, AdChannel.TV, monthlyBudget:)` L122-124; `.RegisterAi` L130,328; `.AdvanceMonth` L147,283,346.
- `World.GetIncomeStatement` L149,150,204; `.GetBalanceSheet` L206; `.GetProductProfitability` L231; `.GetTech` L397; `.GetResearchProgress` L399; `.GetBrandAwareness` L407.
- `World.{Clock.Now, Buildings, Companies, Catalog, TransferLog.EntriesFor}`.
- `IncomeStatement.{Revenue, CostOfGoodsSold, GrossProfit, OperatingExpenses, NetIncome}` L198-220.
- `BalanceSheet.{AsOf, Cash, InventoryValue, BuildingValue, TotalAssets, Liabilities, Equity}` L222-228.
- `ProductProfitability.{Product, Revenue, Cost, MarketingCost, NetMargin, NetMarginPct}` L232-242.
- `WorldSaver.Save` L181,296,372; `WorldLoader.Load` L267 plus `WorldLoadResult.{World, ScenarioId, PlayerId}` L268-275.
- `ScenarioLoader.LoadAll` L306; `ScenarioRunner.Apply` L324, `.EvaluateGoals` L357.
- `Scenario.{Name, Description, Player, AiCompetitors, EndDate, StartDate, Goals}`; `ScenarioCompany.{Name, StartingCash, Strategy}`; `ScenarioPlayer.{Name, StartingCash}`; `GoalEvaluation.{Achieved, Description, Detail, Progress}` L360-365.
- `BuildingInstance.{Id, City, TypeId, Owner, Inventory, RetailSlots}`; `Inventory.Entries` L167, `.AverageQuality` L406; `RetailSlot.{Product, Price}` L408.
- `GameDate.{AddMonth, AsMonthIndex, Year, Month}`; `CompanyId.Value`/`==`; `ProductId.Value`/`==`; `Company.{Id, Name, Cash}`; `BuildingType.Name`; `Product.MaxTechLevel`.
- **`SimulationConstants.BaseResearchThreshold` L401.**

**`tools/ContentValidator/Program.cs`:** `ContentLoader.Load` (L31), `ContentCatalog.{Products, BuildingTypes, Cities}` (L32), `ContentLoadException.Errors` (L36). It also depends on `content/schemas/*.schema.json` for products, buildings and cities, all with `additionalProperties: false`, so every new content field needs a schema update.

### 8.3 Which planned engine changes would break which builds

| Planned change | Client | MagnateSim | ContentValidator | Engine tests | Compatible path |
|---|---|---|---|---|---|
| Add a required rules or options parameter to `World(…)` | 1 (`Main.cs:395`, uses named `seed:`) | 1 (L92) | — | 67 | Optional parameter or new overload; default Classic |
| `World.Construct` requires a plot or position | 3 (`HeadlessSmokeTest`, `Manage` ×2) | 6 | — | 173 (plus engine AI actions `AiAction.cs:24,59`, `VerticalIntegrator.cs:430`) | Keep a 3-argument overload that auto-assigns the lowest free plot that fits (deterministic); add `Construct(owner, type, city, PlotId)` |
| `Construct` returns an unfinished building (construction time) | runtime only (UI shows operations immediately) | runtime | — | 46 fail under Realistic | Classic 0 months; `WithInstantConstruction()` |
| Rename or remove `IncomeStatement`/`BalanceSheet` properties | yes (FinancialStatements, Reports, Main, GameState, StatsDashboard, ActivityFeed, HeadlessSmokeTest) | yes (L198-228) | — | yes | Never rename; add properties such as `Depreciation`, `InterestExpense`, `IncomeTax`, `EBIT`, `LandValue`, `Debt`; keep `NetIncome` as the bottom line |
| Add positional fields to those records | no | no | — | no (no positional construction) | Update the 3 engine-internal construction sites |
| Move constants to `EconomyRules` / delete `SimulationConstants` | 11 references: `BaseResearchThreshold` (Reports, ResearchTree ×2), `BaseTechLevel` (GameState, HeadlessSmokeTest ×2), `BrandDecayRate` (Manage ×2), `CyclesPerSlotPerMonth` (BuildingInspector ×2, SlotEditor ×5), `{Tv,Radio,Newspaper,Magazine}AdCostPerPoint` and `AdCostPerPoint()` (Manage), `ResearchPointsPerSlotPerMonth` (BuildingInspector, ResearchTree) | 1 (L401) | — | 4 (`PatentRoyaltyRate`, `WorldMarketQuality`, `ExtractionQuality`, `BaseTechLevel`) | Keep `SimulationConstants` as an `[Obsolete]` facade over `EconomyRules.Classic`; new code reads `world.Rules` |
| Append `LedgerCategory` members (Wages, IncomeTax, InterestExpense, LoanProceeds, LandPurchase, Depreciation, Dividend, …) | compiles; `switch` statements silently ignore them: `FinancialStatements.cs:484-505`, `ActivityFeed.cs:476-506`, `ReplayViewer.cs:310-333`, `BuildingInspector.cs:363+` | compiles | — | compiles; the whitelist test fails (M21, M22) | Engine metadata (§7.2 item 4); append only (serialised by name — HANDOVER invariant 6) |
| Make slot setters internal or command-only | **breaks** `BuildingInspector.cs:591` (`AutoExport`), `:754-755` (`RetailSlot.Price`, `RestockTarget`), `:804` (`WarehouseSlot.TargetStock`) | — | — | tests read them only | Keep the public setters for the legacy client or migrate it to `World.Set*` commands |
| Rename method parameters | `seed` | `price`, `restockTarget`, `monthlyBudget` | — | about 190 named-argument sites | Do not rename |
| Change the `ScenarioRunner.Apply` signature | 3 | 1 | — | 6 | Add an optional `EconomyRules? rules = null` |
| `WorldSaver.Save`/`WorldLoader.Load`/`ListSaves`, `SaveFileInfo`, `SchemaVersion`/`MinSupportedSchemaVersion` constants | used (SaveMenu, SaveBrowser, GameState, Main, HeadlessSmokeTest) | used | — | used | Additive; bump `SchemaVersion` to 10 |
| Change `Inventory` API (`Get`, `AverageQuality`, `EntriesWithCost`, `CostOf`) | `Get` ×6, `AverageQuality` ×1, `EntriesWithCost` ×3 | `Entries`, `AverageQuality` | — | `Add` ×14, `Get` ×8, `AverageQuality`, `CostOf`, `Take`, constructor ×2 | Keep; make `Add` internal only after tests move to `SeedStock` |
| AI strategy constructors or tunables | `new AdaptiveStrategy()` ×3 | ×2 | — | ×35 plus property reads | Keep default constructors and property names (also persisted as the v3 config) |

---

## 9. Build and test timings

Machine: Intel i9-9880H (8 cores / 16 threads), 16 GB RAM, macOS, .NET SDK 8.0.420. **Load average 7–12 during the measurements because of parallel agents, so treat these as upper bounds.** All runs used scratchpad copies of the repository.

| Command | Time (wall) | Notes |
|---|---|---|
| `dotnet build Magnate.sln`, clean, `--disable-build-servers` (true cold) | **18.8 s** (7 projects) / 19.5 s (5-project baseline) | NuGet cache warm (Godot.NET.Sdk 4.6.2, xunit, JsonSchema.Net already restored) |
| `dotnet build Magnate.sln`, clean, warm build servers | **6.3–7.5 s** | |
| `dotnet build Magnate.sln`, no-op incremental | 2.4–6.1 s | |
| Touch one engine `.cs` file, then rebuild the solution | 2.6 s | Reference assemblies: dependents do not recompile unless the public API changes |
| `dotnet test engine/Magnate.Engine.Tests --no-build` | **3.5–3.9 s** | Test execution 0.52 s for 229 tests (about 1 s for 231); per-test durations summed 7.65 s across parallel classes; the slowest single test (~0.5 s) is each class's first test (JIT and content-load warm-up) |
| `dotnet test engine/Magnate.Engine.Tests` (incremental build) | 4.9–5.3 s | |
| `dotnet test Magnate.sln` (incremental build + Engine.Tests + Bridge.Tests) | **7.6–8.3 s** | 231 + 6 tests |
| Mutation loop (edit engine, build test project, run 229 tests) | 4–9 s per iteration | Fast enough for per-commit Classic golden and property checks |

Warnings: every build prints **217 unique CS1591** (missing XML docs) warnings from `Magnate.Engine` (434 lines in the log). `TreatWarningsAsErrors=true` is set with CS1591 exempted. The Godot client sets `TreatWarningsAsErrors=false`, so enum-exhaustiveness warnings there never fail the build.

---

## 10. Open questions (need a decision from the lead or the user)

1. **Default ruleset of `ScenarioRunner.Apply`.** Recommendation: the scenario's `economy` field, defaulting to Realistic. That changes the legacy Godot client's gameplay too. Is that acceptable, or should the Godot client keep Classic?
2. **Classic lifetime.** Keep it permanently as an "Arcade/Classic" player mode (it costs one demand-model implementation) or only as a test oracle to delete after Realistic stabilises? The recommendation is to keep it at least until Realistic golden masters and property tests have been stable for a few months.
3. **Frozen classic content fixture versus live content.** Freezing (recommended) decouples the 46 pinned tests from rebalancing but duplicates ~144 KB. The alternative is to rewrite the pinned tests to derive expectations from the catalog.
4. **Construction semantics.**
   - Is opex charged during construction?
   - Is capex paid upfront or in progress payments?
   - Do goals and the AI count unfinished buildings?
   - Can slots be configured before completion?
5. **D2 fix in Classic.** Should Classic capitalise upgrades? It changes Classic balance-sheet numbers but no current test. The recommendation is yes: fix the bug and re-approve the Classic golden balance-sheet lines.
6. **RNG algorithm.** Keep .NET's legacy seeded algorithm (reimplemented as serialisable, so Classic event schedules are bit-identical) or move Realistic to PCG or xoshiro? The recommendation is legacy-compatible for both unless Realistic needs many more draws.
7. **Parameter snapshot in saves.** Persist the full `EconomyRules` values (recommended, so saves are immune to retuning) or only the preset id?
8. **Cross-runtime determinism.** Is bit-identical native-versus-WASM simulation required, for example for cloud saves or golden masters generated natively? If so, budget the quantisation work in the allocator.

---

## Appendix A. Reproduction (scratchpad)

The directory is `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/test-map/` (session-scoped and may be cleaned). Contents:

| Path | What it is |
|---|---|
| `repo/` | Snapshot copy of the tree at 22:47 |
| `repo2/` | Copy of the tree at 23:10 (7 projects) |
| `mut/` + `mutations.py` + `runmut.py` | Mutation harness. Run with `python3 runmut.py [ids…]`; each id is re-applied from `mut/pristine`. |
| `mutres/results.json` | Per-mutation failing tests and assertion messages |
| `test-map-evidence.json` | Machine-readable per-test classification plus mutation data |
| `depscan/` | Roslyn scanner (references the SDK's `Microsoft.CodeAnalysis*.dll`). Outputs `deps-client.json`, `deps-sim.json`, `deps-validator.json`, `deps-tests.json`, `deps-summary.txt`. |
| `harness/` | Probe program. Modes: `schedule` (event schedule per seed), `saveload` (D1), `probes` (D2, D3, D6, D5), `vacuous` (D7). |
| `golden/*.json` | Classic baseline fingerprints (§7.4) |
| `classify.py` | Per-test classification data behind §4 |
