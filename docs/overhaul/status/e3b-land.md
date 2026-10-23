# E3b — Land, plots & construction (Wave 2) — status

**Status: done.** All engine, bridge and protocol deliverables are in. Every gate is green.
E2 (finance) asked for three integration points; this branch handles them through an interim shim that carries E2's exact signatures (§6). The merge recipe is in §6.

Under Realistic rules (every new game), each building now stands on real plots of its generated city:

- **Site check.** The engine validates zoning, frontage, coast, deposits, slope, geography, occupancy and land titles.
- **Land.** The engine buys the land at its plot value, plus a buy-out of any ambient structure.
- **Construction.** A deposit is paid at the start. Monthly instalments flow into construction in progress (CIP).
- **Opening.** The building does not operate until it is complete. On completion, CIP moves into PP&E.

Players and AI can also buy and sell land, and players can cancel a building while it is under construction.

Land-value and traffic fields are recomputed at each month close from the development standing at that point. `layoutRev` bumps on every land change.

Classic is unchanged, byte for byte: golden masters and the frozen fixture are untouched.

## 1. File map

| Area | Files | What |
|---|---|---|
| Rules | `Rules/LandRules.cs`, `Rules/EconomyRules.cs` (Realistic `Land` block only) | Knobs: `Enabled`, `ConstructionTime`, `ConstructionMonths` (override; `0` = instant, for tests), `BuildMonths` (per type; `DefaultBuildMonths` = econ §4.12 table), `ConstructionTimeScale`, `DepositShare`, `CancelRecoveryShare`. Neutral defaults; Realistic: on, time on, table months, deposit 20 %, cancel recovery 50 %. |
| Land model | `Land/LandState.cs` (`PlotRef`, `CityLand`: occupancy implementing `IPlotOccupancy`, titles/held plots, cleared parcels, fields-at-month, development signature), `Land/ConstructionSchedule.cs` (deposit/instalments/final instalment, months), `Land/Placement.cs`, `Land/AutoSiter.cs` (E3a's, extended with land context: titles, owner) | Pure land logic |
| World | `Simulation/World.Land.cs` (new partial), `Simulation/World.Construction.cs`, `Simulation/BuildingInstance.cs` | Layouts per world, layout seed, quotes, sites, land market, construction lifecycle, month close |
| Finance seam | `Land/FinanceRegisterShim.cs` (new) | **Interim** copy of E2's asset-register API (§6). Delete on merge. |
| Tick | `Simulation/Tick/ConstructionStep.cs`; **out-of-brief:** `Tick/TickContext.cs`, `Tick/DemandStep.cs` (§7) | Instalments, completion, site retries for waiting orders, land month close; under-construction buildings do not operate |
| Persistence | `Persistence/Sections/LandSaveSection.cs` | v10 `land` section (omitted when land rules are off): layout seed, per city rev/signature/cleared/held plots, per building site/land/CIP/schedule/retirement. Old and Classic saves keep layout seed 1. Realistic saves without a section are migrated: buildings are auto-sited for free. |
| Bridge | `GameSession.Buildings.cs`, `GameSession.City.cs`, `GameSession.CityLayout.cs`, `Model/PlacementModel.cs`, `Protocol/Dtos.City.cs`, `GameSession.Ext.cs` (stubs deleted) | §3 |
| Protocol | `web/src/bridge/protocol.ts` (city/layout/building/placement blocks), `web/src/bridge/__fixtures__/*` (regenerated under Realistic) | §3 |
| Tests | `Magnate.Engine.Tests/Land/{ConstructionTimelineTests, WorldPlacementTests, LandMarketTests, LandPersistenceTests, AiLandTests, LayoutPerformanceTests, LandWorlds}.cs`; `Magnate.Bridge.Tests/{BuildingsTests, CityTests, CityLayoutTests}.cs` (+ small repairs §7) | §5 |

## 2. Engine API (contracts for others)

### Construction

- **`World.Construct(owner, type, city, PlotRef at)`**
  - Validates the site (`QuoteConstruction`), then calls `EnsureCanInvest(owner)` and checks funds.
  - Buys the land, pays the deposit and starts the schedule.
  - Throws `PlacementRejectedException` (with the quote) for an invalid site, and `InvalidOperationException` for a distressed company or missing funds.
  - With `ConstructionMonths = 0` the building is instant: it is fully charged as `ConstructionCost` and capitalised at once.
- **`World.Construct(owner, type, city)`** (legacy: AI and Godot client)
  - Under land rules it auto-sites with `ChooseAutoSite`: the best site by category preference that the company can afford up front, else the cheapest affordable one.
  - If there is no site, the company cannot afford one, or it may not invest, the call returns an **order waiting for a site** (`Construction.AwaitingSite`). Nothing is paid, and slots may be configured.
  - `ConstructionStep` retries waiting orders each month: up to 3 per company, memoised by layout revision and cheapest price. It never fails for lack of land.
  - Geography is still enforced (it throws).
- **`QuoteConstruction(owner, type, city, at)`**
  - Returns a `ConstructionQuote`: `Ok`, `Placement` (issues, footprint, parcels, site metrics), `Schedule`, `LandCost`, `RedevelopmentCost`, `HeldLandBasis`, `SiteCost`, `UpfrontCost`, `TotalCost`.
  - It is pure.
- **`FindConstructionSites(owner, type, city, preference, count)`** and **`ChooseAutoSite`**: site search.
- **`GetConstructionMonths(type)`**, **`GetConstructionSchedule(type)`**.
- **`CancelConstruction(id)`**, **`QuoteCancellation(id)`**:
  - Cancellation returns `CancelRecoveryShare` of CIP as cash. The rest goes to `WriteOffConstruction`, which journals a `ConstructionWriteOff`.
  - The site is sold back at its market value (`AssetSale`), with the gain or loss booked as a `DisposalGainLoss` accrual.
  - The building is retired: it gets `RetiredAt`, loses its slots and frees its plots, but stays in `World.Buildings` as history.

### Land market and fields

- **Land market:** `GetParcel` / `GetParcels`, `BuyLand` (calls `EnsureCanInvest`; `LandPurchase`; the land becomes held), `SellLand` (`AssetSale` + gain/loss), `GetLandHoldings`, `GetHeldLandAtCost`, `GetLandAtCost`, `GetConstructionInProgress(CompanyId)`.
  - Errors are `LandMarketException` (`NotForSale` / `NotOwned` / `InsufficientFunds`).
  - Building on plots you already hold costs no land. Their cost basis is absorbed into the building's land.
- **Layout and fields:**
  - `LayoutSeed`, `GetCityLayout(city)`, `GetLayoutRevision(city)`, `GetLandFields(city)`.
  - `GetLandFields` returns the fields recomputed from development sited before this month, with cleared ambient parcels.
  - Also: `BuildingAtPlot`, `LandOwnerAt`.
- **`AvailableFunds(company)`**: cash. The partial seam `AdjustAvailableFunds` lets E2 add undrawn revolver credit.
- **`ReleaseSite(BuildingInstance)`** (internal, new for E2): frees a disposed building's plots and bumps `layoutRev`. See Request 1.

### `BuildingInstance`

| Member | Meaning |
|---|---|
| `Placement` (`PlotRef`: NW plot + rotation), `SitedAt` | The building's site |
| `Construction` (`ConstructionState`) | `OrderedAt`, `StartedAt`, `CompletesAt`, `AwaitingSite`, `MonthsTotal`, `MonthsRemaining`, `CostPaid`, `CostRemaining`, `Deposit`, `Instalment`, `FinalInstalment`, `PausedMonths`, `NextInstalment`, `Progress` |
| `RetiredAt` | Set when construction is cancelled |
| `IsUnderConstruction`, `IsRetired`, `IsOperational` | State flags |
| `StructureBookValue` | Structure only |
| `BookValue` | Structure + interim land + interim CIP (§6) |

**Operations.**

- `TickContext.Buildings` now yields **operating** buildings only, evaluated when read. A building that completes in step 3 therefore operates in the later steps of the same month.
- `TickContext.AllBuildings` is the full snapshot.
- `GetMonthlyOpex` is 0 while a building is not operational.
- Upgrades need an operational building. Slots may be configured during construction.
- An instalment that cannot be funded pauses the project: nothing is paid and `CompletesAt` moves out by one month.

## 3. Bridge / protocol

### Methods

| Method | Behaviour |
|---|---|
| `previewBuild {typeId, cityId, at?}` | `placementOk`, `placementIssue`, `placementIssues[]` (codes `outOfBounds, occupied, road, zoning, water, needsRoad, needsCoast, needsDeposit, notArable, slope, noSite`), `landCost` (incl. buy-out), `redevelopmentCost`, `constructionCost`, `totalCost`, `upfrontCost`, `deposit`, `monthlyInstalment`, `constructionMonths`, `opensAt`, `affordable` (upfront ≤ funds and may invest), `shortfall`, `site` (traffic, locationFactor, distance to the CBD, frontage, district, slope, waterfront, land value, parcels, deposit), `catchment` (score, potential units, rivals within radius, traffic, radius), and `suggestedPlacement` (only when `at` is omitted: a city-wide search). |
| `construct {…, at?}` | `at` picks the site. Without `at` the server auto-sites. Atomic: every check passes before money moves. Errors: `plot_occupied` / `plot_out_of_bounds` / `zoning_forbidden` with `details.reason` = issue code and `field: "at.px"`, `insufficient_funds`, `invalid_operation` with reason `distressed`. Emits `constructionStarted` (amount = upfront, months). The summary has `status: 'underConstruction'` and `placement.source: 'engine'`. |
| `cancelConstruction {buildingId}` | Returns a `DisposalResultDto`. Emits `buildingDemolished` with reason `constructionCancelled`. The building drops from `buildings` and `cityView` (`removedIds`). |
| `parcels {cityId, filter?}` | `all \| forSale \| owned \| vacant` |
| `buyLand {cityId, parcelId}` | `parcel_not_for_sale`, `insufficient_funds`, `distressed`. Emits `landPurchased`. |
| `sellLand {cityId, parcelId}` | Sells the plots of a parcel held without a building. |
| `cityLayout` | Live under land rules: `layoutRev`, the game's `seed`, parcels with owner, building, `forSale`, `askingPrice` and current `landValuePerPlot`/`traffic`, cleared ambient removed. Also every E3a extra field and the `plots` string encodings (mirrored in `protocol.ts`). |
| `cityView` | `layout.layoutRev`. Each visual's `placement` comes from the engine (`source: 'engine'`); `status: 'underConstruction'` plus `construction`. `visualRev` changes as progress moves. |
| `building` | Detail carries a `construction` field (`ConstructionDto`: started, completesAt, progress, costPaid, costRemaining, monthsTotal, monthsRemaining, nextInstalment, awaitingSite, pausedMonths, cancelRefund). `openedAt` is absent until the building opens. `actions.canUpgrade` is false until then, and `upgradeBuilding` returns `under_construction`. |

### Events and features

- `constructionCompleted` is a month-close event. It carries `isPlayer` and priority 2 for the player.
- Rivals' `constructionStarted`, sent when a waiting order breaks ground, comes from `PlacementModel.DrainEvents`.
- `features.plots`, `landMarket` and `constructionTime` are **on**. A Classic world answers those methods with `feature_unavailable` and keeps the interim placement grid (`source: 'auto'`).
- Bridge tests default to `Bridge.LandOff` (Realistic with land off), so pre-existing tests keep instant construction. Land tests opt into `EconomyRules.Realistic`.

## 4. Persistence

The `land` v10 section is described in §1.

Layouts and fields are not stored. They are pure functions of the layout seed and the persisted development, so a load rebuilds them bit for bit.

`LandPersistenceTests` covers four cases:

- A save taken mid-construction (month 3), loaded and run on to month 20, matches an uninterrupted run. Both `StateDigest` and the land digest are identical.
- A round trip keeps every land field: site, land, CIP, schedule, retirement, held plots and cleared parcels.
- Classic saves have no `land` section.
- Realistic saves from before the land integration keep seed 1 and get their buildings sited.

The bridge's `Construction_survives_save_and_load_through_the_bridge` covers the same through the bridge.

## 5. Verification (2026-10-02, after resume)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors. The 139 CS1591 warnings are all pre-existing files outside this workstream (`Domain/BuildingType.cs`, `GameClock.cs`, …), and E2 sees the same. |
| `dotnet test Magnate.sln --no-build` | Engine **995/995**, Bridge **214 passed**, 4 skipped. Land subset: engine `Magnate.Engine.Tests.Land` 609/609 (includes E3a's), bridge Buildings/City/CityLayout 44/44. |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 610 passed, 3 skipped (30 files + 1 skipped) |
| `npx vite build` | built |
| `node scripts/build-engine.mjs` | WASM rebuilt (63 files) |
| `node scripts/smoke.mjs` | **SMOKE OK**, with the WASM rebuilt before `vite build`. |

**Screenshot `web/test-results/04-after-month.png`, inspected.** After building the tutorial supermarket:

- The toast reads "Construction Started — opens in 4 months".
- Cash is −$240K this month, which is the instalment.
- Revenue and net are $0: no trading or wages before opening. Before this resume's fix it showed −$15K of wages.
- Company value stays at $15.00M, so land and CIP are carried at cost.

**Tests added or finished on resume:**

- `A_preconfigured_store_neither_trades_nor_costs_anything_until_it_opens`
- `Releasing_a_site_frees_its_plots_for_others`
- Repaired the WIP bridge tests. They read envelope events after a `snapshot` call had replaced the envelope, and one did not filter rival completions.

**Brief test list:**

- Placement rules: all 18 types × 5 cities (`WorldPlacementTests`).
- AI keeps building on valid sites for 4 years under Realistic (`AiLandTests`).
- Timeline, instalments and ledger, with `Invariants.AssertAll` every month (`ConstructionTimelineTests`).
- Save/load equivalence (`LandPersistenceTests`).

## 6. E2 (finance) integration — the lead's three points

E2 finished on branch `e2-finance` (contracts in its status doc). Its API cannot be compiled against on this branch, so `Land/FinanceRegisterShim.cs` implements **E2's exact member names and signatures**: `GetLandCost(BuildingInstanceId)`, `GetConstructionInProgress(BuildingInstanceId)`, internal `CapitalizeLand`, `AddConstructionInProgress`, `CompleteConstruction`, `WriteOffConstruction`, plus `CanInvest` and `EnsureCanInvest`. For now the shim stores the amounts on `BuildingInstance.LandCost` / `ConstructionInProgress`.

All E3b code (engine, bridge, tests) writes land and CIP **only** through those calls and reads them **only** through `GetLandCost` / `GetConstructionInProgress`.

1. **Use E2's land/CIP API.** Done, via the shim:
   - Land bought for a site, plus the absorbed basis of held plots → `CapitalizeLand`.
   - Deposit and each instalment → `AddConstructionInProgress`. The caller books `ConstructionPayment`.
   - Completion → `CompleteConstruction`.
   - Cancellation → `WriteOffConstruction(id, recovered)`, plus `ReleaseLand(id)`, which is not in E2's API (see the merge recipe).
2. **CapitalizedCost stays 0 while staged.** Done: it is 0 until `CompleteConstruction` moves the CIP in. `Supermarket_pays_land_and_deposit_…` asserts it.
   - Instant schedules, used only in tests, keep main's direct capitalisation (`ConstructionCost` ledger + `CapitalizedCost`). E2's `Reconcile` picks that up.
3. **EnsureCanInvest before construction and land purchase.** Done:
   - `Construct(…, at)` and `BuyLand` call `EnsureCanInvest`.
   - The legacy auto-siting `Construct` and the waiting-order retry check `CanInvest`. A distressed company's AI order waits rather than throwing inside the AI turn, since AI actions are not caught.
   - The bridge pre-checks `CanInvest` in `construct` and `buyLand` and refuses like E2 does: `invalid_operation`, `details.reason: "distressed"`. `previewBuild.affordable` is false while distressed.
   - On this branch `CanInvest` is always true; there is no solvency model here.

**E2's `PlacementModel` change** (pruning placements of retired buildings): under land rules this branch serves placements from the engine, from each building's `Placement`. A building E2 removes from `World.Buildings` therefore drops out of `cityView` by itself. Keep E2's pruning for the Classic interim grid when merging `PlacementModel.cs` (both branches edited it).

**Merge recipe (e3b + e2):**

1. Delete `engine/Magnate.Engine/Land/FinanceRegisterShim.cs`'s "E2 API" block. CS0111 duplicate-member errors point at it until you do.
2. Re-implement the shim's `ReleaseLand(BuildingInstanceId)` over E2's register:
   ```csharp
   var r = _finance.Assets.Find(id);
   var land = r?.Land ?? 0m;
   if (r is not null) r.Land = 0m;
   return land;
   ```
3. In E2's `Retire(b)` (sale, demolition, liquidation), call `ReleaseSite(b)` before `_buildings.Remove`, so the plots free up and `layoutRev` bumps. E2's disposal must also refuse buildings with `Construction != null`; those use `cancelConstruction`.
4. **E2's balance sheet Land line must add `world.GetHeldLandAtCost(company)`.** That is land held without a building, kept outside the per-building register in E3b's `CityLand`. Then the `Invariants` books close with held land: today `LandWorlds.AssertBooksCloseWithHeldLand` adds it by hand.
5. `Model/Financials.cs` (bridge): both branches edited it. Take E2's version and add held land at cost to the company's assets. E3b's edit (book value = `b.BookValue` under land rules + held land) existed only because the interim balance sheet lived in `BookValue`.
6. Optional cleanup: drop `BuildingInstance.LandCost` / `ConstructionInProgress` (always 0 after step 1), the `BookValue` sum, and the two fields in `LandSaveSection.BuildingLandSaveDto`.
7. `AdjustAvailableFunds` (partial seam in `World.Land.cs`) can add E2's undrawn revolver (`GetAvailableLiquidity`) so construction may draw on credit (econ §4.12).

## 7. Out-of-brief touches (small, local; flag for the merge)

- **`Simulation/Tick/TickContext.cs`**:
  - `Buildings` now returns operating buildings only, evaluated when read. In Classic it returns the same list instance, so Classic does no extra work.
  - New `AllBuildings` holds the full snapshot.
  - E0's status doc (§2.3 "Operational state") assigned this to E3b. Steps owned by others need no change.
- **`Simulation/Tick/DemandStep.cs`**: one line skips non-operational buildings. The step iterates `world.Buildings` directly, not `ctx.Buildings`. **E1:** keep that line (or iterate `ctx.Buildings`) when the realistic demand model lands.
- `GameSession.cs`: `Features` gains plots, landMarket and constructionTime. E2 also edited this line (Demolish, Loans), so merge both sets.
- `GameSession.Game.cs`: two lines.
  - `newGame` honours a test-only `NewGameRules`.
  - The month tick drains `PlacementModel.DrainEvents` (rival construction started/completed).
- `Protocol/BridgeJsonContext.cs` (3 registrations), `Protocol/Dtos.City.cs` (city/placement DTOs), `Model/Financials.cs` (see §6.5).
- Tests:
  - `Bridge.Tests/Bridge.cs`: `LandOff` default, `rules:` parameters.
  - `ContractFixtureTests`: fixtures generated under Realistic.
  - `DispatchTests` / `ExtTests`: feature flags.
  - `EconomyRulesTests`: deleted `Realistic_matches_classic_until_wave_2_mechanics_land`, as its own doc asked once a Realistic mechanic landed.
  - E3a's Metropolis timing test moved to `LayoutPerformanceTests`.

## 8. Known gaps

- **Rendering of construction (W2).** `cityView` sends `status: 'underConstruction'` and `construction.progress`, but the city scene still draws the finished model. W4's families already have `stage`/`progress` (`stageForProgress`). See Requests.
- **Build placement UI (W6/U2).** The Build panel is still the interim "placed automatically" menu. The protocol for a ghost-placement flow is complete: `previewBuild` with `at` (cheap, no city-wide search), reasons, costs, catchment, `opensAt`, and `construct` with `at`.
- **E2 solvency** exists only after the merge. On this branch `CanInvest` is always true, so the distressed paths are untested here; E2's tests cover `EnsureCanInvest`.
- **Two retirement models until the merge.** E2 removes disposed buildings from `World.Buildings`. E3b keeps cancelled ones there with `RetiredAt`, as history: the ledger and invariants keep their ids, and retired buildings are skipped everywhere. Folding cancellation into E2's `Retire` is a possible follow-up.
- **Land in the balance sheet on this branch.** Building land and CIP are inside `BookValue`, so the engine balance sheet closes. Land held *without* a building is not on the engine balance sheet until E2 adds it (§6.4); the bridge's `Financials` adds it for display.
- **Redevelopment buy-out prices** are still E3a's placeholders (their Known gaps). Balancing them against construction costs is a P1 tuning pass.
- **AI** uses the legacy auto-siting `Construct`. It does not buy land speculatively and never cancels.

## 9. Requests

1. **E2 / integrator:** apply the §6 merge recipe: delete the shim's E2 block, add `ReleaseLand` over the register, call `ReleaseSite` in `Retire`, add held land to the balance sheet's Land line, and refuse disposal of buildings under construction.
2. **W2 (city renderer):** render `BuildingVisualDto.status === 'underConstruction'` with the asset family's construction stage at `construction.progress`, interpolating days with the clock. Re-fetch `cityLayout` when `cityView.layout.layoutRev` changes: parcels cleared, owned or listed, and land value and traffic fields moving monthly.
3. **W6 / U2 (build flow):** ghost placement over the plot grid.
   - Call `previewBuild {at}` per hover cell and show the `placementIssues` messages, `upfrontCost` / `landCost` / `redevelopmentCost` / `deposit` + `monthlyInstalment`, `opensAt`, `site.traffic`, `catchment` and `suggestedPlacement`.
   - Confirm with `construct {at, initialSlot?}`.
   - Inspector: a construction progress bar plus a "Cancel construction" action showing `cancelRefund`.
   - Land tab: `parcels {filter:'forSale'}`, `buyLand`, `sellLand`.
4. **E1 (market/AI):** keep the `IsOperational` skip in `DemandStep` (§7). AI planners may want to skip new builds while `!world.CanInvest(actor)` (after the E2 merge); today the order just waits.
5. **Audio (A3):** `underConstruction` statuses now really occur and last months, so construction ambience will trigger. No change is needed; just a heads-up.
