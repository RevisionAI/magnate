# E1 — Market economics — status

Branch `e1-market` · Wave 2 · 2026-10-02 · **Status: done** (P0 scope of the brief). The open items are listed under
Known gaps and Requests.

Under Realistic rules the game is now a real market:
- Demand falls with price, and every market has permanent local competitors (the incumbents).
- Stores have throughput and stock caps, a format that must fit the product, and a location factor.
- Exports pay a world price that falls with volume. Auto-export is off by default.
- Labour, utilities, maintenance, insurance and property tax cost money.
- Production lines and rigs are capex.
- The AI prices on expected profit and cannot spiral.

Classic is unchanged to the byte: the 8 golden masters and the frozen fixture are untouched.

---

## 1. File map

### Engine (`engine/Magnate.Engine/`)

| Area | Files | What it is |
|---|---|---|
| Rules | `Rules/MarketRules.cs`; `EconomyRules.cs` (Realistic `Market = MarketRules.Gameplay` only) | Every knob is an `init` property. Everything is gated by `Enabled` (false under Classic). The knob defaults are the §4 values. |
| Demand model | `Market/DemandModel.cs`, `Market/Normal.cs` | 1:1 port of Appendix A. Lognormal-WTP category demand per bracket, logit/CES choice on quality-adjusted price, the incumbent as offer 0, capacity, then one spill pass of 60 %. Pure and bit-identical. `DemandCurveCache` holds z(ε,σ) per world. |
| Retail | `Market/RetailMarket.cs` | Store lines: a building's slots for one product merge into one offer (F7), priced at the cheapest slot, with A ∝ √n. Also capacity, stock cap (1.5 × capacity), draw by format and category, attractiveness `L · Draw · √n · (1 + 0.10·(level−1))`, the incumbent mass (§4.2 static base × `IncumbentStrength`), tech score and offer building. |
| World trade | `Market/WorldTrade.cs` | Import price `W·ImportMult`. Export price `W·ExportMult·(1+V/Depth)^−0.5`. Marginal export revenue. |
| Costs | `Market/OperatingCosts.cs`, `Market/Equipment.cs` | Headcount by role × wage × city wage index; utilities; maintenance; insurance; property tax. Line, rig and field equipment is paid once and capitalised. |
| State | `Market/MarketState.cs` | Per-world state: 24 months of market unit sales (incumbents included), line reports with trailing sales, installed equipment, last export quote. |
| Seams | `Market/Seams.cs` | `IBuildingSiteInfo` (location factor, land cost, operational) with `NeutralSiteInfo` (L = 1, no land, always operational), and `ICreditHeadroom` (undrawn revolver). |
| World API | `Simulation/World.Market.cs` (new partial), `Simulation/World.Advertising.cs` | `GetMarketShare` moved here. Adds `PreviewDemand`, the retail and trade queries, `GetIncumbentUnitsSold`, `ApplyMarketDefaults`, `ValidateRetailProduct` and the v2 advertising queries. |
| Tick steps | `Simulation/Tick/{Payroll,Advertising,Extraction,Production,Restock,Demand,Export,Incumbents}Step.cs`, `Simulation/MaterialProcurement.cs` | The Classic path is verbatim; the Realistic path sits behind `Market.Enabled`. |
| Content | `Content/MarketContent.cs`, `Content/ContentLoader.cs`, `Domain/{Product,Recipe,BuildingType,City,MarketProfiles}.cs` | New optional fields, category defaults and legacy migrations: `reservationPrice` → WTP, `laborUnits` → `laborPerSlot`, and the 200-cycle recipes → per-unit. The frozen Classic fixture still loads. |
| AI | `Ai/MarketAi.cs` (shared §4.17 rules), `Ai/{AdaptiveStrategy,SimpleRetailerStrategy,TechLeader,VerticalIntegrator}.cs` (`PlanRealistic` branches), `Ai/AiAction.cs` (`BuildStoreAction`, `BuildPlantAction`, `SetLinePriceAction`, `SetLineRestockAction`) | See §2.5. |
| Persistence | `Persistence/Sections/MarketSaveSection.cs` | History, line reports with trailing sales, equipment and exports, in canonical order. Omitted for Classic. |

### Content and tooling

- `content/data/**`: the 2026-USD rebalance (Table 4.7-A/B/C), described in §2.6. A new building, `car_dealership`, was added.
- `content/schemas/**`: the new fields.
- `tools/ContentValidator/Program.cs`: a new market-coverage check. Every consumer good must be sellable somewhere, and its reference store must draw its category.

### Bridge and protocol

- `engine/Magnate.Bridge/GameSession.Market.cs`: under Realistic rules every market method reads `World.PreviewDemand` (`modelSource: 'engine'`). Classic and legacy saves keep the bridge replica.
- `Model/MarketModel.cs`.
- `Protocol/Dtos.Market.cs`: `IncumbentDto`, `MarketRowDto.IncumbentShare`, `MarketDetailDto.Incumbent`.
- `GameSession.cs`: one line, `Features.DemandModel = true`.
- `web/src/bridge/protocol.ts`: the market blocks only (`IncumbentDto`, `incumbentShare`, `incumbent`).

### Tests

`engine/Magnate.Engine.Tests/Market/` holds 111 test cases in 9 test classes plus a shared kit:

| Class | What it covers |
|---|---|
| `DemandModelTests` | Appendix A values; T4 grid; brand table; R2–R4 |
| `RetailMarketTests` | Exact preview; merge; capacity; stock caps; format; location; spill; realised share; incumbent units |
| `WorldTradeTests` | Spreads; depth; one aggregate price; perishables; affordability; warehouse value cap; reserve |
| `ProductionTests` | Per-unit recipes; line capex; buffer; rig; cash-capped conversion; own supply first |
| `PayrollAndAdvertisingTests` | Payroll lines; wage index; idle slots; farms; construction; v2 cost per point; sustain budgets; decay |
| `MarketAiTests` | The §4.17 AI rules |
| `EconomyRegressionTests` | R1/R8/R15 over 10 AI years |
| `ScenarioSweepReport` | R8 sweep of 16 scenarios × 60 months |
| `CalibrationReport` | The §5.2 tables |
| `MarketTestKit` | Shared helpers |

`engine/Magnate.Bridge.Tests/MarketTests.cs` has 7 tests.

Earlier E1 commits also edited existing test files. Content-coupled tests were moved to derive numbers from the catalog or pinned to Classic. `EconomyRulesTests.Realistic_matches_classic…` was deleted, as e0 §2.7 said to.

---

## 2. APIs and contracts for other workstreams

### 2.1 Demand preview (bridge-spec E9)

```csharp
MarketPreview World.PreviewDemand(CityId city, ProductId product, PreviewOffer? change = null)
// change: { Building, Price?, Stock? } to re-price an existing line, or
//         { Owner, StoreType, Price, Slots=1, Level=1, LocationFactor=1, Quality?, Stock? } for a hypothetical new store.
// → Lines[] (Building?, Owner, Price, Quality, Brand, Tech, Attractiveness, Capacity, Sellable, Demand, Sold, Share, Hypothetical),
//   IncumbentMass, IncumbentPrice, IncumbentUnits (incl. spill), IncumbentDemand (pre-spill), ReferenceDemand,
//   TotalDemand, TotalSold, Lost, Brackets[]
```

- The preview is read-only.
- The market is evaluated as the next tick will see it: lines restocked to target within the cap, and brand after the month's advertising step.
- With no command in between, the preview equals the next tick's sales exactly. Tests prove this both engine-side and through the bridge.
- `Share` and `IncumbentDemand / TotalDemand` sum to 1.

### 2.2 Market share and incumbent sales (master plan D11)

- `World.GetMarketShare(company, product, city)`: under Realistic, realised units over the trailing 3 months divided by all units, incumbents included. Classic keeps the softmax replay.
- `World.GetTrailingMarketUnits(city, product)` and `World.GetMarketUnits(city, product, month)` return units per company plus the incumbents.
- **`World.GetIncumbentUnitsSold(product, city, from, toInclusive)`** is new for E2.
  - It sums the incumbents' units over any window inside the last 24 months.
  - It is 0 under Classic.
  - It survives save and load.

### 2.3 Retail, trade and cost queries

- **Retail:**
  - `CanRetail(type, product)`, which is false for a format with no draw for the category, such as cars in a convenience store;
  - `ValidateRetailProduct(building, product)`, which throws;
  - `GetRetailCapacity`, `GetStockCap`, `GetRetailLineReport`, `GetTrailingLineSales`, `GetIncumbentMass`.
- **Trade:** `GetImportPrice(product)`, `GetExportPrice(product, totalVolume)`, `GetLastExport(product)` (one price per product per month).
- **Costs:**
  - `GetMonthlyBuildingCosts(building)` returns `BuildingCosts`: headcount, wages, utilities, maintenance, insurance, property tax, operational.
  - `GetMonthlyFixedCosts(company)`.
  - `GetInstalledEquipment(building)` returns slot → (product, cost).
- **Advertising v2 (§4.20):**
  - `GetAdCostPerPoint(city, channel)` = ChannelK × Pop/1000;
  - `GetSustainBudget(company, city, channel, awareness)`;
  - `GetProjectedBrandAwareness(company, product, city)` gives next month's brand exactly;
  - `GetMediaOwnershipBonus`.
  - Decay of 3 % applies every month, campaign or not.

### 2.4 Seams (plug in, don't edit E1 files)

| Seam | Who plugs in | Neutral default |
|---|---|---|
| `world.SiteInfo : IBuildingSiteInfo` | **E3b** | `LocationFactor` = 1 (E3b: `CityLayout.LocationFactorAt` / `LandFields.LocationFactor(mean traffic of the parcel)`, clamped 0.3–2.5); `LandCost` = 0 (E3b: the land's historical cost, the property-tax base); `IsOperational` = true (E3b: false while under construction). Not persisted: reattach after load. |
| `world.CreditHeadroom : ICreditHeadroom` | **E2** | Null: undrawn revolver credit counts as 0. With credit attached, world-market purchases are capped at `Cash + UndrawnCredit − 1 month of fixed costs`. |
| `world.ApplyMarketDefaults(building)` | **E3b** `Construct` + bridge `construct` | Under Realistic, a new building starts with `AutoExport = false` (D7). The AI build actions already call it. |

While a building is not operational it pays only insurance and property tax, and it takes no part in production, extraction, restock, sales or exports.

### 2.5 AI rules (§4.17), `Ai/MarketAi.cs`

| Rule | Behaviour |
|---|---|
| Pricing | `ChoosePrice` tries `{−5 %, −1 %, 0, +1 %, +5 %}` × the current price. It keeps the best `Contribution` (units × (price × (1 − 1.5 %) − unit cost)) and clamps to `[unit cost × 1.05, 1.6 × Pref]`. A price outside the bounds moves one step a month. |
| Entry price | Best of 0.90–1.20 × Pref. |
| TechLeader hero | `Pref · M^0.8`, floored at 1.10 × the **per-unit** cost (fixes F4). No rival × 1.3 rule (fixes F3). |
| SimpleRetailer | Sell-through repricing: +3 % when sold out, −3 % below 70 % sell-through. |
| Restock | 1.2 × trailing sales, capped at the stock cap. |
| Store choice | The format with the strongest draw: cars → car_dealership, apparel/electronics → department_store, groceries → supermarket. |
| Advertising | min(6 % of line revenue, the TV sustain budget for awareness 60). Nothing below 2 % share. |
| Expansion | A free slot first. A new store only with payback ≤ 8 years (TechLeader hero ≤ 20) and a cash cushion. |
| VerticalIntegrator | Plants only if making saves ≥ 5 % versus importing. Exports only when the netback covers the unit cost. |

### 2.6 Content (2026 USD, econ §4.7)

**Products.** All 24 have W, import/export multipliers and depth.

- 8 finished goods also carry `referencePrice`, q per bracket, ε, σ, θ, weights, κ, incumbent brand and quality, `importBrand`, `retailCategory` and `referenceStore`.
- Recipes are per unit: `outputPerSlotMonth`, `otherCostPerUnit`, `kwhPerUnit`, `laborPerSlot` and `lineCapex`.
- Raws carry `extraction.{otherCostPerUnit, laborPerSlot, equipmentCapex, fieldsCapex}`.

**Buildings.** Table 4.7-C capex and opex, L2/L3 at 60 %/50 % upgrade capex with ×1.30/×1.60 opex, plus:
- `staff {fixed, fixedRole, perSlot, slotRole}`;
- `retailFormat {capacityPerSlot, draw{category}}`;
- `storageValuePerSlot` for warehouses;
- `buildMonths`, for E3b.

**Cities.** `wageIndex`, `priceIndex`.

**Compatibility.**
- Footprints are unchanged.
- Old content loads through the loader migrations.
- The legacy Godot client compiles (it is part of `Magnate.sln`).

### 2.7 Ledger categories used

The categories are E0's; none are new:
- payroll: `Wages`, `Utilities`, `Maintenance`, `Insurance`, `PropertyTax`;
- `EquipmentPurchase` (investing, capitalised into `CapitalizedCost`);
- `OtherMaterials` and `ProductionEnergy` (capitalised into inventory, reaching the P&L via COGS);
- `RetailVariable`;
- `ExportSale`, `ProductSale`, `InputPurchase`, `RetailRestock`.

---

## 3. Verification

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | `0 Error(s)`. The only warnings are the pre-existing exempt CS1591s. |
| Engine tests | `Passed! - Failed: 0, Passed: 976` (main had 863). `CityLayoutGeneratorTests.Metropolis_generates_within_the_desktop_budget` fails intermittently at load average > 30 and passes alone. |
| Bridge tests | `MarketTests` 7/7. The whole project shows `Failed: 41, Passed: 161`. **All 41 are in other teams' test files** and assert pre-rebalance content or starting cash; triage in §5. |
| Golden masters / Classic fixture | 8/8 unchanged. `git diff main...HEAD -- engine/Magnate.Engine.Tests/Fixtures` is empty. |
| `tsc --noEmit` | Clean. |
| `vitest` | 609 passed, 1 failed (asset registry: `car_dealership` has no site spec, see Requests), 1 flaky audio-loudness timeout. |
| `vite build` | ✓ built. |
| `build-engine.mjs` + `vite build` + `smoke.mjs` | `SMOKE OK`. Screenshot `web/test-results/04-after-month.png` inspected: the build menu shows the new content (Convenience $1.40M, Supermarket $10.00M, Department Store $14.00M, the new Car Dealership $4.00M, "Cash short" badges at the old $15M tutorial cash). |
| ContentValidator | Live content OK. A mutation (dealer drawing no `auto`) fails with 2 errors as expected. |

### R-checks implemented as tests

| Check | Test(s) |
|---|---|
| R2 monopoly bound | Optimum 1.25–1.5 × Pref for every product; profit at 20 × ≈ 0. |
| R3 | Monotone total. |
| R4 | Incumbent floor. |
| R5 | Export concavity and one aggregate price. |
| R6 | Table 4.7 margins per recipe, and every recipe is negative at 50 % utilisation. |
| R7 | Store bands by site. |
| R8 | 10-year AI runs in `patent_race` and `tech_titan_clash`. Every month, for every line: price ≤ 3 × Pref and no move above 5 % + 1¢. Assets ≤ 50 × start; no negative cash. Also a 16-scenario × 60-month sweep. |
| R1 | `Invariants.AssertAll` every month in all of these, plus E0's 16 × 24 Realistic matrix. |
| R15 | A Realistic AI run is deterministic. 24 months + save/load + 24 equals 48 straight: same digest and same save bytes. |
| R16 | √n merge, $1 campaign decay, 1.5 × capacity stock cap, warehouse value cap. |

### Calibration report (`CalibrationReport`)

Pre-tax figures, §4.8 depreciation added by the report (E2 books it for real), land from the §4.3 formula, imports.

| Store (12 months after a 24-month run) | Rev/mo | GM | EBIT % | Pre-tax ROIC | §5.2 calibration (EBIT % / ROIC) |
|---|---|---|---|---|---|
| Supermarket, Metropolis, poor (L 0.6) | $1.27M | 23.7 % | −1.9 % | **−2.4 %** | −1.8 % / −2.2 % |
| Supermarket, Metropolis, average | $1.74M | 27.0 % | 7.8 % | **11.9 %** | 7.8 % / 11.4 % |
| Supermarket, Metropolis, prime (L 1.6) | $2.16M | 31.0 % | 15.1 % | **24.2 %** | 15.2 % / 23.3 % |
| Supermarket, Riverside, average | $1.63M | 27.9 % | 7.8 % | 12.2 % | 7.4 % / 11.2 % |
| Supermarket, Hilltown, average | $1.46M | 28.6 % | 5.7 % | 6.3 % | 5.7 % / 6.1 % |
| Naive: average site at 1.3 × Pref | $0.55M | 47.1 % | −10.3 % | −5.1 % | T3 negative |
| Good: prime site + brand 70 (TV sustain) | $2.68M | 43.0 % | 13.5 % | **26.7 %** | T1 20–40 % |
| Department store, average | $1.22M | 35.9 % | 6.2 % | 4.5 % | 6.3 % / 4.4 % |
| Convenience store, average | $0.22M | 37.0 % | 13.2 % | 19.6 % | 13.0 % / 18.7 % |
| Car dealer (imports), average | $0.63M | 13.7 % | −4.3 % | −5.8 % | −2.8 % / −4.9 % |

**Manufacturing.** factory_small with 6 lines and imported inputs at 100 % utilisation, valued at W. EBIT % of W against Table 4.7:

| Product | Engine | Table 4.7 |
|---|---|---|
| sugar | 9.3 | 9.8 |
| flour | 6.8 | 7.2 |
| cotton_fabric | 8.4 | 9.2 |
| denim | 9.6 | 10.2 |
| steel | 7.2 | 8.0 |
| plastic | 8.5 | 9.1 |
| electronic_parts | 8.3 | 8.9 |
| malt | 8.5 | 9.2 |
| roasted_coffee | 8.7 | 9.0 |
| soft_drink | 11.1 | 11.7 |
| bread | 9.1 | 9.8 |
| beer | 10.7 | 11.7 |
| coffee_drink | 11.3 | 12.0 |
| t_shirt | 10.8 | 11.0 |
| jeans | 15.5 | 16.0 |
| TV | 7.6 | 8.0 |
| car | 6.4 | 6.9 |

- All 17 recipes are within 1 pt of the table, slightly lower because of insurance and property tax.
- ROIC is 10–23 % (T6).
- At 50 % utilisation every recipe loses money: −3.4 % to −32.9 % (T7/R6).

**Extraction.** EBIT % of W is 25–32 % (T8 18–30 %; oil 31.8 %). Pre-tax ROIC is 16–26 %, a few points above the 12–20 % band; see Known gaps.

**AI, 10 years, Realistic, unscaled scenario cash** (`ScenarioSweepReport` with `SWEEP_MONTHS=120`):
- The highest retail price anywhere is 1.21 × Pref.
- No company's cash went negative.
- AI equity after 10 years is 1–3× the start; the best is ChainLink at $152M equity.
- NI12 runs from −$0.5M to $18M.
- There are no spirals and no explosions.
- `export_tycoon`'s player ($8M) and the tutorial's LocalCo ($10M) cannot afford any building until E2's rescale.

---

## 4. Known gaps

- **P1, not in this scope:**
  - quality formation and source-weighted brand/tech (P0 `max()` rule kept);
  - incumbent erosion and entry (`IncumbentsStep` is the P0 no-op with the static base);
  - absorption costing;
  - chain bonus and staffing factor;
  - electronics_store and fashion_boutique;
  - seaport and distance freight;
  - import price impact;
  - corporate overhead;
  - world tech drift.
- **Re-tooling.** It charges a full new line. P1 is 25 %.
- **Extraction ROIC.** Pre-tax ROIC is 16–26 % against the 12–20 % band; EBIT % is in band. The report counts fields as land but no working capital. A small rebalance would close it, for example +10 % on field/equipment capex or a lower W for iron_ore and crude. Left for the Wave 4 balance sweep.
- **AI finance and distress.** No term loans or rating checks in the expansion test, and no distress playbook (ads → 0, sell the worst building). Both need E2's API (Wave 3, E4). Expansion uses cash plus a cushion only.
- **Auto-export default for player buildings.** It is applied only where `ApplyMarketDefaults` is called: today the AI actions only. Until E3b and the bridge `construct` call it, player buildings start with auto-export on.
- **Payroll on construction sites after the E3b merge.** `PayrollStep` iterates `ctx.Buildings`. E3b says `TickContext.Buildings` will hold operating buildings only, with a new `AllBuildings`. After the merge, switch `PayrollStep.ChargeRealisticCosts` to `ctx.AllBuildings`; it is a one-word change. Construction sites then pay their insurance and property tax, because `OperatingCosts.Of` already charges only those for non-operational buildings, provided E3b's `SiteInfo.IsOperational` reports the state.
- **`EconomyScale`** is still unread.
- **`MarketRules` knob defaults.** They hold the §4 gameplay values rather than neutral ones. Everything is gated by `Enabled` (false under Classic), so Classic never reads them. A future record that sets `Enabled = true` gets the calibrated model.

---

## 5. Requests

1. **Lead (merge with E2).**
   - E2's `World.Reports.cs` still declares `GetMarketShare`, which E1 moved to `World.Market.cs`. Delete it there, or the merge will not compile.
   - Make E2's stub `IncumbentUnitsSold(product, city, from, to)` return `GetIncumbentUnitsSold(product, city, from, toInclusive)`. That is E2's request 1; the E1 side is done.
2. **E2.**
   - Attach `world.CreditHeadroom` (undrawn revolver) so purchases can use the revolver.
   - Depreciate equipment capitalised by `EquipmentPurchase` with the equipment lives of §4.8 (lines 10 y, farm 12 y, mine 20 y, well 10 y, plantation 15 y). `World.GetInstalledEquipment(building)` lists it per slot with its cost.
   - The bridge's books-close check (`FinanceTests.Balance_sheet_closes…`) fails on main's `Financials.BookValue`, which ignores equipment. E2's version reads `b.BookValue` and fixes it.
3. **E3b.**
   - In `Construct`, call `ApplyMarketDefaults(building)` (D7).
   - Implement `IBuildingSiteInfo`: plot location factor from `CityLayout`/`LandFields`, land cost, and operational state. Set it on `world.SiteInfo` at new game and on load.
   - Keep your one-line under-construction skip in `DemandStep` when merging. The Realistic path already skips non-operational stores via `SiteInfo`.
   - `buildMonths` is in the building content for your construction time.
   - See also §4: payroll and `AllBuildings`.
4. **B2 (bridge).**
   - `newGame`: map difficulty to `MarketRules.IncumbentStrength` (easy 0.6, normal 1.0, hard 1.4, D6), e.g. `rules with { Market = rules.Market with { IncumbentStrength = s } }`.
   - `construct`: call `World.ApplyMarketDefaults` (or E3b's `Construct` will).
   - The marketing preview reads the v2 engine numbers; update `MarketingTests` literals (cost per point is now 25 × Pop/1000, e.g. $6,250 in Riverside).
   - `DispatchTests` and `ExtTests` assert every feature flag is off. `demandModel` is now on, as the brief asked.
5. **Test owners (B2, E2, E3b): bridge tests to re-baseline for 2026-USD content.** None of the 41 failures is an engine defect.

   | Kind | Tests |
   |---|---|
   | **Cash too low for real capex** (supermarket $10M, factory $15M, R&D $25M) | GameFlow.Hud_runway; City.Build_preview_projects_runway, Visual_revisions; Persistence ×5; ContractFixture ×3 (rebuild fixtures); Buildings.Upgrades, Starter_plans, Production_slots, Building_lists, Auto_export_toggles; Progress.Insolvency, Goals_latch; Research.A_rival_patent |
   | **Old content literals** | Catalog ×3 (upgrade 720000→6000000, depth, potential demand); Buildings.Construct_* ×2, The_inspector (opex 15000→40000); City.Build_preview_is_a_pure_query (1.2M→10M), Supply_flows (200 → 900 for the per-unit recipes); Finance.Monthly_report, Cash_flow_maps (new cost lines), Income_statement_lines (opex now includes wages/utilities/…), Product_profitability (export depth pricing), Explaining_net_income; Progress.The_advisor (opex), Activity_feed, Stats_dashboard (R&D opex 50000); EventDetector.Losing_months (bread at $1 vs incumbents), Brand_milestones (v2 brand); LedgerIndexParity.The_workload (Year10 fixture builds 12, not 60+, buildings at real prices) |
   | **Expected** | Dispatch.Init_reports_features, Ext.Every_feature_flag_is_off (`demandModel` on); Marketing.Previews (v2 cost per point); Finance.Balance_sheet_closes (fixed by E2's `Financials`) |

6. **W2/W3/W4 (assets).** Add a `car_dealership` asset (2×2 plots, retail family) and a `TYPE_SITES` entry. `familiesB.test.ts` "every content building type has a construction site spec" fails until then. The renderer falls back to the synthetic company box.
7. **U2 (panels).** `suggestPrice` under Realistic is the engine's profit-maximising point on a 0.8–1.6 × Pref grid, with `ceilings: []`. The "$50 bracket ceiling" behaviour is the bridge replica on main and goes away with this branch. `marketDetail.incumbent` and `marketIntel.rows[].incumbentShare` carry the local competition, the "white slice".
