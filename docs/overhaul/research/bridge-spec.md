# Magnate Bridge Specification: engine to web client

**Author:** bridge-spec (principal engineer, overhaul research phase) | **Date:** 2026-09-30 | **Status:** proposal v1, ready to implement

**Scope:** this document covers five pieces:
- the `Magnate.Bridge` C# facade;
- its JSON command/query protocol;
- the TypeScript mirror of that protocol;
- the browser host (WASM runtime inside a Web Worker) and persistence;
- extension points for the engine features coming next: city layout and plots, land, construction time, loans and credit, stock market and IPO, macro economy.

**What I examined:**
- `engine/Magnate.Engine`, read in full.
- All 21 Godot client scripts named in the brief, plus `GameState.cs`, `UiChrome.cs` and `SoundManager.cs`.
- `docs/HANDOVER.md` and the research dossier.
- The UX report `docs/overhaul/research/ux-playability.md`.
- A **walking skeleton that appeared during this research**, created 2026-09-30 between 22:47 and 23:03:
  - `engine/Magnate.Bridge/*` and `engine/Magnate.Bridge.Tests/*`;
  - `web/engine-host/*` and `web/src/bridge/*`;
  - `WorldSaver.SaveToString` / `WorldLoader.LoadFromString`.

**This spec extends that skeleton; it does not replace it.** Every method below is tagged as one of:

| Tag | Meaning |
|---|---|
| **EXISTS** | In the skeleton, unchanged. |
| **CHANGE** | In the skeleton, but the spec changes it. |
| **NEW** | Implementable on today's engine. |
| **EXT** | Needs an upcoming engine feature. |

**Evidence:** every performance number here was measured on this machine: Intel Mac, .NET 8.0.26, Chrome, and the same `browser-wasm` configuration as the skeleton. The harnesses live in `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/bridge-spec/` (Appendix A). The project tree was not modified apart from this file.

---

## 0. Decisions on one page

1. **Keep the skeleton's contract:**
   - `GameSession.Dispatch(method, argsJson)` returns envelope JSON.
   - Handlers carry `[BridgeMethod("name", Mutates=…, RequiresGame=…)]` and live in `GameSession.<Area>.cs` partial files.
   - Method names are flat camelCase. Error codes are snake_case. Every envelope carries `revision`.
   - The TypeScript side keeps the `Methods` map in `web/src/bridge/protocol.ts`.

   **Add these, all additive:**
   - `error.field` and `error.details` (typed).
   - `hud` and `events` on the envelopes of mutating calls, which removes the extra `snapshot` + `buildings` round trips the web client makes after every mutation today.
   - Three binary `[JSExport]`s for saves.

   **Fill in the surface:** about 60 methods, listed in §5.2.
2. **The client becomes a renderer.** Section 3 lists 39 pieces of game logic the Godot client computes itself. All of them move into the facade.
   - 15 of them are defects today: either wrong, or lost when the scene changes or the game loads. Examples: a start date hard-coded to 2026-02; capacity and opex that ignore building level; **three** different "corporate value" formulas; a cash-flow statement that doesn't reconcile; market share that ignores reservation prices; a HUD "Buildings" figure that counts every company's buildings.
   - The web client must not re-derive any of them.
3. **The facade keeps incremental monthly indexes** over `Ledger`, `CogsLog` and `TransferLog` (§4.5).
   - Measured in Chrome/WASM, a one-month `World.GetIncomeStatement` costs **7.1–7.6 ms** at 46k ledger entries (year 10 of a 5-company game).
   - The skeleton's `snapshot` makes one income-statement call and one balance-sheet call per company. By year 10 that is **about 40–45 ms per HUD refresh**, and it grows linearly with game length.
   - With the indexes it is well under 1 ms.
4. **The .NET runtime stays in a dedicated module Web Worker.** The skeleton already does this; it is now justified by measurement (§6.4):

   | Operation (WASM) | Cost |
   |---|---|
   | Month tick | 20–38 ms |
   | `WorldSaver.Save`, 10-year game | 1.4–1.8 s |
   | `WorldLoader.Load` | 2.5–3.3 s |

   While the worker ticked 60 months, the main thread's worst frame gap was **16.8 ms**.
5. **Saves are binary and never touch the main thread.** The pipeline:
   - compact engine JSON plus a bridge sidecar;
   - gzip inside .NET (**163 ms** for 13.6 MB → 1.62 MB);
   - a `byte[]` that arrives as a `Uint8Array`;
   - written to IndexedDB **by the worker**.

   The skeleton's `saveGame` returns the save as a JSON string inside the JSON envelope. That costs 1.3–1.5 s just to marshal the 13.6 M-character string out of .NET, followed by a ~14 MB `JSON.parse` on the main thread.
6. **Raw exception text is never shown.**
   - The browser build uses `InvariantGlobalization`. Engine messages therefore render money as `¤1,000.00` (verified).
   - It also uses `UseSystemResourceKeys`, so BCL messages become bare resource keys (observed: the literal string `NoElements`).
   - The facade pre-validates every command and returns a stable code plus typed `details`. The client writes the words.
7. **I raise 18 engine change requests (§9).** Seven are verified defects, each reproduced in the scratch harness:

   | # | Defect | Evidence |
   |---|---|---|
   | 1 | Upgrades break "books close". | Equity drift of −$720,000 after one supermarket upgrade. |
   | 2 | The RNG is not persisted. | The event sequence diverges right after a load: 31 vs 35 news events by month 120, with a save/load at month 60. |
   | 3 | Geography requirements are not enforced. | An oil well was built in non-oil Hilltown. |
   | 4 | Retail slots accept unsellable intermediates. | A steel retail slot is restocked every month and never sells. |
   | 5 | `GetMarketShare` ignores reservation prices and uses post-sale quality. | Confirmed by code read. |
   | 6 | Desktop and WASM diverge. | Player cash differs by about $2×10⁻⁹ after 120 months (other companies' by up to 5×10⁻⁹). Ledger count and news sequence are identical. |
   | 7 | `PersistenceStringTests` asserts post-load determinism. | Inferred, not run: with seeds 7 vs 0, it passes only while neither stream fires a differing event in the one month it checks. |
8. **Extension points are specified now** (§8) behind `features` flags. The layout, land, construction-time, finance, stock and macro workstreams can ship engine code without breaking the protocol.
   - EXT methods are registered from day one and return `feature_unavailable` until their flag is on.
   - DTO fields for these features are reserved (optional, omitted when null).

---

## 1. Measurements

All runs are Release builds.
- **Workload:** the `four_archetype_melee` scenario (5 companies) with the player on `AdaptiveStrategy` autopilot, which yields about 111 buildings by year 10.
- **Browser:** headless Chrome 13x, launched via puppeteer.
- **Engine build:** the same `browser-wasm` flags as `web/engine-host/Magnate.Wasm.csproj`: interpreter + jiterpreter, `InvariantGlobalization`, reflection-based JSON, `TrimmerRootAssembly Magnate.Engine`.

| Measurement | Desktop (CoreCLR JIT) | Browser WASM |
|---|---|---|
| Runtime ready (`dotnet.create`) | n/a | 257 ms (worker); 443–590 ms (main thread) |
| Extract 30 embedded content files to MEMFS | n/a | 51–73 ms |
| `ContentLoader.Load` | ~210–300 ms (with scenarios) | 368–486 ms |
| `ScenarioLoader.LoadAll` (16 files) | included above | 83–138 ms |
| Month tick, 5 companies | avg 10.3 ms; p95 30.3; max 146.6 (JIT warm-up) | avg 19.1–19.9 ms (year 1); 32–38 ms (years 4–10); max 63 ms |
| Month tick, `three_way_melee` (4 companies, 75 buildings) | avg 2.0 ms | 5.8 ms (year 1) rising to 17–22 ms (years 4–10) |
| `GetIncomeStatement(month, month)` at 46k ledger entries | 6.0 ms | 7.1–7.6 ms |
| `ScenarioRunner.EvaluateGoals` (5 goals) at 46k | 6.6 ms | 7.4–8.1 ms |
| `GetMarketShare` for every (city × finished product × company) | 3.9 ms | 15.2–18.0 ms |
| All 111 buildings (slots and inventory) projected to DTOs and serialized (37.8 KB) | n/a | 28–31 ms |
| `WorldSaver.Save`, 10 years (13.6 MB indented) | 248 ms | 1,438–1,788 ms |
| `WorldLoader.Load` of the same save | 503 ms | 2,529–3,226 ms |
| Marshal a 13.6 M-character `string` from .NET to JS | n/a | 1,315–1,532 ms |
| Marshal a 13.6 MB `byte[]` to `Uint8Array` | n/a | about 690 ms |
| `GZipStream` (Fastest) inside .NET WASM | n/a | 163 ms (13.6 MB → 1.62 MB) |
| `CompressionStream('gzip')` in JS | n/a | 307–365 ms (13.6 MB → 1.24 MB) |
| Worst main-thread frame gap while the worker ticks 60 months | n/a | **16.8 ms** |
| Shipped runtime (brotli) | n/a | 1,758,542 B for the skeleton's `public/_framework` (5.1 MB uncompressed) |

**Save size.** `four_archetype_melee`, 120 months, 46,090 ledger entries, 13,311 COGS entries:

| Variant | Bytes | gzip |
|---|---|---|
| Engine today (`WriteIndented = true`, WorldSaver.cs:62) | 13,649,634 | 1,281,097 |
| Compact JSON | 9,451,752 | 1,224,108 |
| Compact JSON without ledger memos | 7,648,437 | 916,744 |

**Composition:**
- The ledger is 7.36 MB of the compact save; COGS is 1.98 MB.
- The ledger grows by about **476 entries a month** in this scenario: 111 opex, 93 advertising, 135 restock, 135 sales and 2 export entries in the final month.

**Consequence:** a 10-year save does not fit `localStorage` (≈5 MB, strings only, synchronous). Use IndexedDB with gzip (§6.3).

---

## 2. Engine public API map

Line numbers refer to the files as they stand on 2026-09-30.

### 2.1 `World` (Simulation/World.cs)

| Member | Signature | Throws | Line | Bridge use |
|---|---|---|---|---|
| ctor | `World(ContentCatalog, int seed, GameDate start)` | `ArgumentNullException` | 69 | custom games (via ScenarioRunner) |
| `Catalog`, `Clock`, `Ledger`, `TransferLog`, `CogsLog`, `Rng` | properties | n/a | 33–38 | everywhere |
| `Companies` | `IReadOnlyDictionary<CompanyId, Company>` | n/a | 40 | HUD, companies |
| `Buildings` | `IReadOnlyDictionary<BuildingInstanceId, BuildingInstance>` | n/a | 41 | city view, detail |
| `NewsLog` | `IReadOnlyList<NewsEntry>` (append-only) | n/a | 48 | news, events |
| `ActivePriceEffects` | sorted snapshot `IReadOnlyList<ActivePriceEffect>` | n/a | 56 | news, market detail |
| `CreateCompany` | `(string name, decimal startingCash) → Company` | `ArgumentException` (blank name, cash ≤ 0) | 79 | ScenarioRunner only |
| `Construct` | `(CompanyId, BuildingTypeId, CityId) → BuildingInstance` | `KeyNotFound` (company/type/city); `InvalidOperation` (cash < cost). **No geography check.** | 95 | `construct` |
| `UpgradeBuilding` | `(BuildingInstanceId)` | `KeyNotFound`; `InvalidOperation` (no ladder / max level / cash) | 129 | `upgradeBuilding` |
| `GetCapacity` | `(BuildingInstance) → int` (level-aware) | n/a | 175 | detail, validation |
| `GetMonthlyOpex` | `(BuildingInstance) → decimal` (level-aware) | n/a | 188 | detail, list |
| `ConfigureProductionSlot` | `(id, slotIndex, ProductId)` | `ArgumentOutOfRange` (index ≥ capacity); `InvalidOperation` (no recipe / tier not producible) | 197 | `configureSlot` |
| `ConfigureExtractionSlot` | `(id, slotIndex, ProductId)` | `ArgumentOutOfRange`; `InvalidOperation` (not raw / no extraction / wrong `SourceCategory`) | 224 | `configureSlot` |
| `ConfigureResearchSlot` | `(id, slotIndex, ProductId)` | `InvalidOperation` (category ≠ `rd_center`); `ArgumentOutOfRange` | 254 | `configureSlot` |
| `ConfigureWarehouseSlot` | `(id, slotIndex, ProductId, double targetStock)` | `InvalidOperation` (category not warehouse/distribution_center/seaport/freight_yard); `ArgumentOutOfRange`; `ArgumentException` (target ≤ 0) | 277 | `configureSlot` |
| `ConfigureRetailSlot` | `(id, slotIndex, ProductId, decimal price, double restockTarget)` | `InvalidOperation` (not retail); `ArgumentOutOfRange`; `ArgumentException` (price ≤ 0, restock ≤ 0). **Accepts any tier.** | 306 | `configureSlot` |
| `GetTech` / `SetTech` | `(CompanyId, ProductId) → int` / `(…, int)` | Set: `ArgumentOutOfRange` | 339 / 346 | research; Set is dev only |
| `AdCampaigns` | `IEnumerable<AdCampaign>` (unsorted dictionary values) | n/a | 358 | ads |
| `RegisterAdCampaign` | `(CompanyId, ProductId, CityId, AdChannel, decimal budget) → AdCampaign` (0 removes) | `KeyNotFound`; `ArgumentException` (budget < 0) | 366 | `setAdCampaign` |
| `CancelAdCampaign` / `GetAdCampaign` | `(company, product, city, channel)` | n/a | 390 / 393 | ads |
| `GetMediaOwnershipBonus` | `(CompanyId, CityId, AdChannel) → decimal` (1.0 / 1.25 / 1.35) | n/a | 467 | ad preview |
| `GetResearchProgress` | `(CompanyId, ProductId) → double` | n/a | 505 | research |
| `GetBrandAwareness` / `SetBrandAwareness` | `(CompanyId, ProductId, CityId) → double` 0–100 | Set: `ArgumentOutOfRange` | 561 / 568 | market, ads; Set is dev only |
| `RegisterAi` | `(CompanyId, IAiStrategy)` (replaces). **No unregister, no getter.** | `KeyNotFound` | 584 | autopilot |
| `AdvanceMonth` | `()`: AI plans run first, then `MonthlyTick.Execute` | anything an AI action throws (unguarded) | 593 | `advance` |
| `GetEffectiveWorldPrice` | `(ProductId) → decimal` (base × active multiplier) | `KeyNotFound` | 646 | market, exports |
| `RecordNewsEntry` | `(NewsEntry)` | n/a | 661 | not used by the bridge |
| `GetActivePatents` | `() → IReadOnlyList<Patent>` (sorted) | n/a | 740 | patents, research |
| `IsPatentBlocked` | `(requester, ProductId) → bool` | n/a | 756 | research |
| `GrantPatentLicense` / `RevokePatentLicense` | `(holder, licensee, ProductId)` | Grant: `KeyNotFound`, `InvalidOperation` (self, no patent, expired). Revoke: idempotent. | 781 / 814 | patents |
| `GetPatentLicenses` | `() → IReadOnlyList<PatentLicense>` | n/a | 829 | patents |
| `GetBalanceSheet` | `(CompanyId) → BalanceSheet`. `BuildingValue` = Σ `ConstructionCost` (**upgrades missing**) | `KeyNotFound` | 920 | balance sheet |
| `GetMarketShare` | `(CompanyId, ProductId, CityId) → double`. Single softmax, **no reservation gating**, unsorted iteration | `KeyNotFound` | 949 | `MarketShareGoal` parity only |
| `GetIncomeStatement` | `(CompanyId, from, toInclusive) → IncomeStatement`. O(ledger + COGS) scan | n/a | 981 | parity oracle for the index |
| `GetProductProfitability` | `(CompanyId, from, to) → IReadOnlyDictionary<ProductId, ProductProfitability>` | n/a | 1017 | parity oracle |

**Needed but internal-only:**
- `InternalAiStrategies`, `InternalPatentsEverGranted`, `RequireBuilding`, `RecordCashChange`.
- No slot removal, no demolition, no per-slot sales record, no RNG state accessor.

### 2.2 Domain and simulation records

| Type | File:line | Notes for DTO mapping |
|---|---|---|
| `CompanyId(int)` "C1", `BuildingInstanceId(int)` "B1" | Simulation/Ids.cs:4,10 | Serialize as bare numbers. Ids are monotonic and never reused (`_nextCompanyId` / `_nextBuildingId` are persisted). The player is C1 in every scenario. |
| `ProductId`, `BuildingTypeId`, `CityId` (string) | Domain/Ids.cs | Serialize as bare strings. |
| `GameDate(int Year, int Month)`, `AsMonthIndex() = Year*12+Month-1` | Simulation/GameClock.cs:6 | Serialize as `DateDto {year, month}`, the skeleton convention. |
| `Company {Id, Name, Cash, OwnedBuildings}` | Simulation/Company.cs | `OwnedBuildings` is a public mutable list. |
| `BuildingInstance {Id, TypeId, Owner, City, Inventory, *Slots, AutoExport(set), Level}` | Simulation/BuildingInstance.cs:90 | Slot lists and `RetailSlot.Price`/`RestockTarget`/`WarehouseSlot.TargetStock`/`AutoExport` are publicly mutable, which bypasses validation (§3). |
| `Inventory.Get/CostOf/AverageQuality/TotalValue/EntriesWithCost` | Simulation/Inventory.cs | WAC and quality mass. |
| `BuildingType {Id, Name, Category, ConstructionCost, MonthlyOperatingCost, Footprint(W,H), MaxUnits, ProducibleTiers, Retail, TargetHeadcount?, GeographyRequirement?, Levels?}` | Domain/BuildingType.cs:33 | 18 types; categories below. |
| `Product {Id, Name, Tier, Category, Unit, BaseWorldMarketPrice(double), PriceElasticity, MaxTechLevel, BaseDemandPerCapita{Low,Middle,High}, Recipe?, Extraction?, ReservationPrice?}` | Domain/Product.cs:25 | 24 products. |
| `City {Id, Name, Population, Demographics, Grid(W,H), Geography, BaseLandPrice}` | Domain/City.cs:13 | 5 cities; grids from 40×40 to 80×80. |
| `EventDefinition`, `NewsEntry(Date, EventId, Headline, Severity)`, `ActivePriceEffect(ProductId, Multiplier, RemainingMonths)` | Simulation/Events.cs | 10 events. At most one fires per month, with probability 0.20. |
| `Patent(Holder, Product, ExpiresAt)`, `PatentLicense(Holder, Licensee, Product)` | Simulation/Patents.cs | |
| `AdChannel {TV, Newspaper, Magazine, Radio}` | Simulation/AdCampaign.cs:6 | camelCase gives `tv`, `newspaper`, `magazine`, `radio`. |
| `LedgerEntry(Date, Company, Category, Amount, Memo, Product?, Building?)`, 13 categories | Economics/Ledger.cs:9,74 | Append-only and **date-monotonic**: the clock never goes back, and the loader replays entries in file order. |
| `CogsEntry(Date, Company, Product, Quantity, Cost, SourceBuilding?)` | Economics/CogsLog.cs:19 | One entry per retail sale or export. `Quantity` is exact units. |
| `TransferEntry(Date, Company, From, To, Product, Quantity)` | Economics/TransferLog.cs:13 | Internal moves. |
| `IncomeStatement(From, To, Revenue, CostOfGoodsSold, OperatingExpenses)`: `GrossProfit`, `NetIncome` | Economics/IncomeStatement.cs | Revenue = ProductSale + ExportSale + PatentRoyaltyIncome. Opex = OperatingCost + AdvertisingCost + PatentRoyaltyExpense. |
| `BalanceSheet(AsOf, Company, Cash, InventoryValue, BuildingValue, Liabilities=0)`: `TotalAssets`, `Equity` | Economics/BalanceSheet.cs | |
| `ProductProfitability(Product, Revenue, Cost, MarketingCost)`: `GrossMargin`, `NetMargin`, `NetMarginPct` | Economics/ProductProfitability.cs | |

**Building categories present in content:**

| Category | Type ids |
|---|---|
| `warehouse` | warehouse_small, warehouse_large |
| `seaport` | seaport |
| `media` | tv_station, radio_station, newspaper_publisher, magazine_publisher |
| `farm` | small_farm, large_farm |
| `plantation` | small_plantation |
| `mine` | iron_mine |
| `oil_well` | oil_well |
| `factory` | factory_small, factory_large |
| `rd_center` | rd_center |
| `convenience_store`, `supermarket`, `department_store` | one type each, all `Retail=true` |

The client code also mentions `distribution_center`, `freight_yard`, `livestock_farm`, `logging_camp` and `quarry`, but no content defines them.

### 2.3 Tick pipeline (Simulation/MonthlyTick.cs:25-43)

The order is: `Clock.AdvanceMonth`, then each step below.

| # | Step | Lines | What it books |
|---|---|---|---|
| 1 | Opex | 172 | `OperatingCost` per building, level-aware |
| 2 | Research | 130 | Prunes expired patents; 100 pts/slot; blocked if a rival holds a patent |
| 3 | Advertising | World.cs:402 | Charges each campaign. Lift = (budget × media bonus / cost-per-point) × (1 − brand/100). Brands without a campaign decay 2% a month. |
| 4 | Extraction | 192 | Yield per slot, quality 50, zero cost basis |
| 5 | Production, intermediate | 217 | Up to 200 cycles per slot; inputs via `MaterialProcurement` |
| 6 | Production, finished | 217 | Same as step 5 |
| 7 | Restock warehouses | 152 | Tops up to target |
| 8 | Restock retailers | 277 | Tops up to `RestockTarget` |
| 9 | Allocate demand and sell | 308–418 | Per bracket: gate out retailers above the reservation price. Weight = max((Q+10T+B)/3, 1)/price^ε. Units sold = min(demand share, on hand). |
| 10 | Auto-export | 447 | Exports **all** on-hand output of production/extraction slots at the effective world price |
| 11 | Patent royalties | 76 | 5% of the licensee's sales and exports this month |
| 12 | Events | 56 | Ticks down active price effects; rolls at most one event |

**Procurement order** (MaterialProcurement.cs:19-127):
1. Own stock on hand.
2. Own buildings that produce, extract or warehouse the product: same city first, then by city id (ordinal), then by building id. Moving between cities adds 10% of world value as shipping, which is capitalized into the goods' cost.
3. The world market at the effective price, with quality 50.

### 2.4 Scenarios, persistence and content

| API | Line | Notes |
|---|---|---|
| `ScenarioLoader.Load(path)` / `LoadAll(dir)` | Scenarios/ScenarioLoader.cs:22/38 | File-system only. Goals have **no id**; the loader stamps the scenario start date onto time-based goals. |
| `ScenarioRunner.Apply(catalog, scenario, seed) → (World, PlayerId)` | Scenarios/ScenarioRunner.cs:16 | Creates the player first (C1), then the AIs. Strategy names map through a **private** switch (line 37). |
| `ScenarioRunner.EvaluateGoals(world, scenario, player)` | :47 | Each call is an O(ledger) scan per goal. |
| 10 goal records | Scenarios/Goal.cs:27–233 | `CorporateValueGoal` uses **TotalAssets** (line 32), not the dossier's CV. |
| `WorldSaver.Save(world, path, scenarioId?, playerId?)` / `SaveToString(…)` / `ListSaves(dir)` | Persistence/WorldSaver.cs:147/168/73 | Schema v9. `WriteIndented = true` (line 62). **`Seed: 0`** is always written (line 302). |
| `WorldLoader.Load(catalog, path)` / `LoadFromString(catalog, json)` | Persistence/WorldLoader.cs:39/66 | Loads schema v1–v9. Rebuilds with `new World(catalog, save.Seed /*0*/, clock)` (line 91), so the **RNG restarts from seed 0 after every load**. |
| `ContentLoader.Load(root)` | Content/ContentLoader.cs:36 | Directory-based, reflection JSON over private DTO records. Missing `data/events` is tolerated. |
| `EventEngine.RollAndApply(world, events, rng)` | Simulation/EventEngine.cs:34 | Always rolls the gate die. The weighted pick is over events sorted by id. |
| AI strategies: `SimpleRetailerStrategy`, `AdaptiveStrategy`, `VerticalIntegrator`, `TechLeader` | Ai/*.cs | Public constructors with tunables. Names are `simple`/`retailer`, `adaptive`, `verticalIntegrator`/`vertical`, `techLeader`/`tech`, duplicated across three private switches: ScenarioRunner:37, WorldSaver `StrategyName`, WorldLoader `CreateStrategy`. |

---

## 3. The Godot client audit: what it derives, and where each piece moves

### 3.1 Engine calls used by the Godot client

| Area | Engine calls |
|---|---|
| Lifecycle | `ContentLoader.Load`, `ScenarioLoader.LoadAll`, `ScenarioRunner.Apply(…, seed: 42)`, `World.RegisterAi(player, new AdaptiveStrategy())` (the "Let AI drive" checkbox, ScenarioPicker.cs:216-220), `WorldSaver.Save/ListSaves`, `WorldLoader.Load` |
| Time | `World.AdvanceMonth()` (GameState.cs:119; Main.cs:532; Reports.cs:277; FinancialStatements.cs:226) |
| Commands | `Construct`, `Configure{Retail,Production,Extraction,Warehouse,Research}Slot`, `RegisterAdCampaign` (0 cancels), `GrantPatentLicense`, `RevokePatentLicense`. Direct field writes: `RetailSlot.Price`, `RetailSlot.RestockTarget`, `WarehouseSlot.TargetStock`, `BuildingInstance.AutoExport`. |
| Queries | `GetIncomeStatement`, `GetBalanceSheet`, `GetProductProfitability`, `GetMarketShare`, `GetTech`, `GetResearchProgress`, `GetBrandAwareness`, `GetMediaOwnershipBonus`, `GetActivePatents`, `GetPatentLicenses`, `ScenarioRunner.EvaluateGoals`. Direct walks of `Ledger.Entries`, `CogsLog.Entries`, `TransferLog.Entries`, `Buildings`, `Companies`, `NewsLog` (read via reflection in NewsTicker.cs:148). |

### 3.2 Derived logic to move into the facade

"Defect" means the client computation is wrong today, or is lost when the scene changes or the game loads. There are 39 derivations; **15 are defects**.

| # | Where (file:line) | What the client computes | Problem | Facade replacement |
|---|---|---|---|---|
| 1 | Main.cs:622-667 | HUD: cash, NI this month, total assets, building count, rival cash | **Defect:** `_world.Buildings.Count` (645-646) counts every company's buildings | `snapshot.player` (§5.3) |
| 2 | Main.cs:987-995 | "Rival" = the first non-player company | Arbitrary pick | `snapshot.companies` sorted by CV; the client highlights the top rival |
| 3 | Main.cs:669-719 | Executive brief: a static 7-rung ladder | Nags about R&D forever (ux-playability §3) | `advisor` (§5.11) |
| 4 | Main.cs:726-753 | Current-goal tip: first unmet goal, "Step k of n" | n/a | `snapshot.scenario.nextGoalId` + `goals` |
| 5 | Main.cs:880-897; ActivityFeed.cs:452-466 | Goal achieved, once per goal | Keyed by description string (collides) | `GoalTracker` with stable ids and latched `achievedAt` |
| 6 | Main.cs:900-924; GameState.cs:185-187 | Win (all goals met now), lose (6 consecutive months of negative cash, or deadline reached) | Counter lives in UI state and is lost on load | `OutcomeTracker`, persisted in the sidecar (§4.6.6) |
| 7 | Main.cs:809-867 | Toasts: NI sign flip, low cash below $1M (once), new headlines; at most 2 per tick | NI flip fires only on +→−, so a player who loses money from month 1 is never warned | Tick `events` (§7) |
| 8 | GameState.cs:171-188 | Per-tick history: cash, revenue, NI, top brand, top tech, CV | **Defect:** in memory only; cleared on load; CV starts at 0 | `MetricsHistory`, persisted, with ledger backfill (§4.6.8) |
| 9 | GameState.cs:200-213; StatsDashboard.cs:184; Goal.cs:32 | Corporate value | **Defect:** three definitions (Cash+Inv+Bldg+10×NI12; TotalAssets labelled "Corporate Value"; TotalAssets for goals) | One `CorporateValue` (§4.6.1); goal parity kept as `totalAssets` until decided (Q1) |
| 10 | GameState.cs:219-259 | Top brand (max over the player's campaigns); top tech (max over slotted products) | n/a | `history` series `topBrand`, `topTech` |
| 11 | GameState.cs:131-167 | Autosave every 12 months, keep 3 | File-system based | Worker autosave, rotating IndexedDB slots (§6.3) |
| 12 | Manage.cs:477-496; BuildingInspector.cs:876-900 | Which `Configure*Slot` to call for a building type | Duplicated if-ladders | `SlotRules.KindOf` and the `configureSlot` method (§4.6.4) |
| 13 | Manage.cs:416-454; BuildingInspector.cs:940-973 | Eligible products per building type | Duplicated; the finished-only retail rule lives in the UI, not the engine | `catalog.buildingTypes[].eligibleProductIds` plus server-side validation |
| 14 | Manage.cs:469-497 | Construct, then configure slot 0 | **Defect:** not atomic. If configure throws, the building is paid for and the message says "Construction failed" | `construct {initialSlot}`, pre-validated and atomic (§5.5) |
| 15 | Manage.cs:541-624 | Four starter plans in the most populous city | Hard-coded; defaults can bankrupt (UX) | `catalog.starterPlans` + `buildStarterPlan` |
| 16 | Manage.cs:377-414 | Cost preview and affordability badge | Level-1 numbers only | `previewBuild` |
| 17 | Manage.cs:657-702, 731; BuildingInspector.cs:140 | Per-building month cash flow; "baseline opex" | **Defect:** uses `type.MonthlyOperatingCost`, ignoring level (should be `GetMonthlyOpex`) | `buildings` / `building` |
| 18 | Manage.cs:712-718; BuildingInspector.cs:139,626,829,873; SlotEditor.cs:227 | Slots used / capacity; next free index | **Defect:** uses `type.MaxUnits`, not `GetCapacity`, so upgraded capacity is invisible and unusable | `building.capacity`, `nextFreeSlotIndex` |
| 19 | Manage.cs:843-872 | Ad reach preview | Duplicates World.cs:426-434 | `previewAdCampaign` |
| 20 | Manage.cs:1011-1216 | Patent rows: months left, license candidates, "licensed to me" | n/a | `patents` |
| 21 | BuildingInspector.cs:591, 754-755, 804 | Writes `AutoExport`, `Price`, `RestockTarget`, `TargetStock` directly | **Defect:** bypasses engine validation (spin boxes allow restock/target = 0, which `Configure*` rejects) | `setAutoExport`, `setRetailPrice`, `setRestockTarget`, `setWarehouseTarget` |
| 22 | BuildingInspector.cs:222-437 | Per-building accrual P&L (this month / last 12 / since open), open date, 12-month NI series | **Defect:** open date is the first `ConstructionCost` entry, found by an O(ledger) scan; falls back to a hard-coded 2026-02 | `building.pnl` from the index |
| 23 | BuildingInspector.cs:633-681 | Production capacity and input "deficits" | Measured after the tick consumed the inputs, so it is misleading | `building.slots[].production` (§5.5) |
| 24 | SlotEditor.cs:249-420, 937-985 | Material-flow graph and input source label | **Defect:** prefers producers over warehouses; the engine orders by same city, then city id, then building id, regardless of kind (MaterialProcurement.cs:41-47) | `building.supply` (actual last-month flows) and `supplyFlows` |
| 25 | ResearchTree.cs:348-361, 540-560; Reports.cs:560-570 | Threshold 100×tech, "slot-months to next" | Ignores slot count and patent blocking | `researchTree` |
| 26 | Reports.cs:288, 350; FinancialStatements.cs:23, 249-271 | Report periods | **Defect:** start hard-coded to `GameDate(2026, 2)`; "Year to date" actually means since the start | `PeriodArgs` presets resolved server-side (§5.1) |
| 27 | FinancialStatements.cs:313-452 | Balance-sheet drill-down and equity reconciliation | Shows drift after upgrades (engine bug E5) | `balanceSheet {drilldown}` |
| 28 | FinancialStatements.cs:470-505 | Cash-flow statement | **Defect:** `UpgradeCost`, `PatentRoyaltyIncome` and `PatentRoyaltyExpense` are unmapped, so net change ≠ actual cash change | `cashFlow` with an exhaustive mapping and a `reconciles` flag |
| 29 | Reports.cs:385-530 | Exports report | **Defect:** units = revenue ÷ *base* world price, which is wrong while a price effect is active; should use exact COGS quantities | `exports` |
| 30 | MarketIntel.cs:456-530, 743-790, 792-862, 864-932, 984-995 | Intel grid, per-retailer softmax, city demand, share history, top 3 to enter/defend | **Defect:** single softmax without reservation gating; post-sale quality is 0 for sold-out retailers; share history approximated with current prices | `marketIntel`, `marketDetail`, `marketOpportunities` (§5.9) |
| 31 | CityMap.cs:293-330, 457-480, 758-775 | Owner colours, buildings by owner, average player share, demand per product | n/a | `worldMap` |
| 32 | StatsDashboard.cs:268-600 | Share heatmap, R&D leaderboard, brand top 5, top 5 buildings by revenue and opex | n/a | `statsDashboard` |
| 33 | ActivityFeed.cs:273-470 | Event stream from diffing the ledger | **Defect:** in memory per scene instance (lost on navigation); one row per ledger entry (about 476 a month) | Persisted `activityFeed` of aggregated `GameEventDto` (§7) |
| 34 | ReplayViewer.cs:132-400 | Month summaries (revenue, expenses, COGS, royalties, NI, units, top 3 buildings, entries ≥ $250k) | n/a | `monthlyReport` |
| 35 | ScenarioDifficulty.cs:22-94 | 1–5 star heuristic | n/a | `listScenarios[].difficulty` (§4.6.7) |
| 36 | SaveBrowser.cs:137-240, 391-490 | Save preview (company, starting capital, buildings by category, top 3 products) parsed from the whole file | Parses multi-MB JSON | `SaveMetaDto`, written at save time (§6.3) |
| 37 | SaveMenu.cs:231-263; SaveBrowser.cs:323-370 | Re-resolve the scenario from `scenarioId` by reloading every scenario from disk | n/a | `loadGame` (the skeleton already does this) |
| 38 | GuidedTutorial.cs:44-186 | Tutorial step ids tied to goal index; VO per step | Voice-over replays on every HUD re-entry (UX) | Goal ids (E18); VO once per step id per save, via `achievedAt` |
| 39 | ScenarioPicker.cs:212; TitleScreen.cs:284 | `seed: 42` for every game | **Defect:** every playthrough gets the identical event sequence | `newGame {seed}`; the client sends a random 31-bit seed |

---

## 4. Facade architecture

### 4.1 Projects and files

The skeleton's layout stays. New files are marked NEW. One partial per area keeps parallel work collision-free, which the skeleton's `BridgeMethodAttribute` doc already intends.

```
engine/Magnate.Bridge/                       net8.0 classlib, refs Magnate.Engine only (EXISTS)
  GameSession.cs                             dispatch + lifecycle (CHANGE: envelope, hud/events, typed errors)
  GameSession.Game.cs                        listScenarios/newGame/snapshot/advance/catalog/buildings/construct (CHANGE)
  GameSession.Persistence.cs                 saveGame/loadGame + binary entry points (CHANGE)
  GameSession.City.cs                        cityView, worldMap, supplyFlows, previewBuild            NEW
  GameSession.Buildings.cs                   building, configureSlot, clearSlot, set*, upgrade, starter NEW
  GameSession.Marketing.cs                   adCampaigns, previewAdCampaign, setAdCampaign, cancel     NEW
  GameSession.Research.cs                    researchTree, patents, grantLicense, revokeLicense        NEW
  GameSession.Market.cs                      marketIntel, marketDetail, marketOpportunities, suggestPrice NEW
  GameSession.Finance.cs                     incomeStatement, balanceSheet, cashFlow, productProfitability,
                                             exports, ledger, explainNetIncome                          NEW
  GameSession.Progress.cs                    goals, advisor, history, monthlyReport, statsDashboard,
                                             news, activityFeed, settings, setAutopilot                 NEW
  GameSession.Ext.cs                         EXT stubs → feature_unavailable (§8)                        NEW
  GameSession.Dev.cs                         debugStats (+ DEBUG-only commands)                          NEW
  Protocol/BridgeJsonContext.cs              [JsonSerializable] for every DTO (source-gen)              NEW
  Protocol/Converters.cs                     MoneyConverter, FiniteDoubleConverter                      NEW
  Protocol/Errors.cs                         codes, ErrorDetailsDto, Guard helpers (absorbs BridgeException) CHANGE
  Model/LedgerIndex.cs                       incremental monthly aggregates                             NEW
  Model/Periods.cs                           PeriodArgs → [from,to]                                     NEW
  Model/CorporateValue.cs                    one formula                                                NEW
  Model/SlotRules.cs                         slot kind, eligibility, validation                         NEW
  Model/GoalTracker.cs                       ids, structured progress, latching, outcome                NEW
  Model/MetricsHistory.cs                    per-company monthly rows (persisted)                       NEW
  Model/EventDetector.cs                     pre/post tick diff → GameEventDto                          NEW
  Model/MarketModel.cs                       bracket-aware demand replay (retire when E9 lands)         NEW
  Model/Advisor.cs, Model/Difficulty.cs, Model/Placement.cs, Model/Explain.cs                           NEW
  Persistence/WebSave.cs                     envelope + sidecar + gzip + legacy import + content check  NEW
engine/Magnate.Bridge.Tests/                 xUnit (EXISTS); one test class per partial (+ parity, fixtures)
web/engine-host/Program.cs                   JSExports: Boot, Call (EXIST) + SaveBinary, LoadBinary, InspectSave (NEW)
web/src/bridge/protocol.ts                   TS mirror (CHANGE: §5 types, full Methods map)
web/src/bridge/engine.worker.ts              + IndexedDB save store, autosave, binary ops (CHANGE, §6)
```

### 4.2 Session state (fields on `GameSession`)

| Field | Type | Persisted in the web save | Notes |
|---|---|---|---|
| `_catalog`, `_scenarios` | as in the skeleton | no (rebuilt at boot) | Plus `_contentHash`: SHA-256 over the sorted embedded content files (path + bytes). |
| `_world`, `_playerId`, `_scenario` | as in the skeleton | engine part | A custom scenario is stored in the sidecar (`custom`). |
| `Revision` | `long` | no | EXISTS. +1 per successful mutating call; `advance` counts as one. |
| `_gameId` | `string` (32 hex, from the seed and the JS-supplied creation timestamp) | yes | Stable across save/load. Cache keys use it. |
| `_seed` | `int` | yes | The engine does not keep it (E4). |
| `_index` | `LedgerIndex` | no (rebuilt on load in O(N)) | Holds positions into the three logs. |
| `_history` | `MetricsHistory` | yes | One row per company per month close. |
| `_goals` | `GoalTracker` | yes (`achievedAt`, outcome, flags) | |
| `_events` | `EventDetector` state (latches: low cash, NI sign, milestones, first sale, brand/share thresholds) | yes | |
| `_feed` | ring buffer of `GameEventDto`, capacity 2,000 | yes | `_eventSeq` is monotonic and persisted. |
| `_placement` | `Dictionary<int, PlacementDto>` | yes | Stays in use until engine plots land (§4.6.10). |
| `_journal` | list of `{revision, month, method, argsJson}` for mutating calls since the last save | yes (optional, capped at 5,000) | Used for bug reports and, once E4 lands, deterministic replay/recovery. |
| `_settings` | `SettingsDto` | yes | |
| `_cityCache` | `Dictionary<string cityId, (long revision, Dictionary<int, int> visualRevById)>` | no | Serves `cityView {since}` deltas. |

### 4.3 Dispatch pipeline (CHANGE to GameSession.Dispatch)

1. Parse `argsJson` with `BridgeJsonContext` type info for the handler's args type. On `JsonException`, return `bad_request` with `field` set to the JSON path from `JsonException.Path`.
2. Check `RequiresGame`. Unknown method: `unknown_method`. Both exist today.
3. Run the handler. **Handlers pre-validate** through `Guard.*` helpers (§4.7) before touching the engine, so engine exceptions are the exception, not the rule.
4. On success, if `Mutates`:
   - `Revision++`;
   - `_index.CatchUp(world)`, which is O(new log entries);
   - `_goals.Refresh(world)`, cached per revision;
   - take the events the handler queued;
   - build `SnapshotDto hud` from the index (O(companies + goals));
   - append the method to `_journal`.
5. Serialize:
   - Result through `BridgeJsonContext.Default.GetTypeInfo(result.GetType())`.
   - The envelope written with `Utf8JsonWriter`: `{"ok":true,"result":<raw>,"revision":n,"hud":{…},"events":[…]}`.
   - The dynamic `object? Result` in the skeleton's `OkEnvelope` should be replaced this way, so no reflection serializer is needed on the hot path.
6. Exceptions that escape a handler:

   | Exception | Code | Notes |
   |---|---|---|
   | `BridgeException` | its own code | |
   | `KeyNotFoundException` | `not_found` | |
   | `ArgumentOutOfRangeException` / `ArgumentException` | `invalid_argument` | |
   | `InvalidOperationException` | `invalid_operation` | |
   | anything else | `internal` | Also sets `Faulted = true` when it came from `AdvanceMonth`. |

   In every case `message` is a facade-written English sentence and the engine text moves to `details.devMessage`, because in WASM the engine text is culture-less and BCL text is a resource key.
7. `advance` special case: if `World.AdvanceMonth` throws, the world may be half-mutated. The AI step runs before the tick (World.cs:593-597), and an unguarded AI action can throw mid-list.
   - Return `tick_failed`.
   - Set `Faulted`. Every later mutating call returns `tick_failed` until `loadGame` or `newGame`.
   - The client offers to load the most recent autosave.

### 4.4 JSON conventions

| Topic | Rule |
|---|---|
| Property names | camelCase (the skeleton's `BridgeJson.Options`). |
| Enums | camelCase strings (`JsonStringEnumConverter(CamelCase)`): `raw`, `tv`, `productSale`, `low`, … Facade-defined kinds are plain `string` constants, documented per DTO. |
| Nulls | Omitted (`WhenWritingNull`). Every optional TS field is `?:`. |
| Dates | `DateDto {year, month}`, month 1–12. Also `monthIndex = year*12 + month − 1` where arithmetic is needed. Periods are `PeriodArgs`, resolved server-side (§5.1). |
| Ids | Company and building ids are JSON numbers (`CompanyId.Value`, `BuildingInstanceId.Value`). Content ids are strings. Goal ids are `"g0"…` or the scenario-provided id (E18). News `seq` = index in `NewsLog`. Feed `seq` = `_eventSeq`. Ledger `seq` = index in `Ledger.Entries`. All are deterministic and never reused. |
| Money out (`decimal`) | A JSON number, **rounded half-even to 2 dp for amounts** and **4 dp for unit prices and unit costs** (`[JsonConverter(typeof(Money2))]` / `Money4`). This cuts payload (the engine carries 28 digits, e.g. `74973577156.360723454334219791`) and keeps UI equality checks stable. A JS double is exact to the cent up to about 9×10¹³ dollars. Year-10 AI cash in the harness peaked at 7.5×10¹⁰. Totals are rounded from exact sums, not summed from rounded parts, so displayed lines may differ from the total by a cent. That is normal accounting presentation. |
| Money in | JSON number, read as `decimal` from the token text (`"1.8"` → `1.8m` exactly). `Guard.Money(value, min, max, dp)` rounds half-even to the stated precision: prices 2 dp, budgets 2 dp. `NumberHandling.AllowReadingFromString` stays on (EXISTS). The client rounds before sending and must not send float artefacts such as `0.30000000000000004`. |
| Quantities, shares, quality, brand (`double`) | Shortest round-trip JSON number. **Non-finite values become `null`** (`FiniteDoubleConverter`); System.Text.Json throws on `NaN` by default and would turn a harmless divide-by-zero into `internal`. |
| Strings for display | Only facade-authored English (`message`, headlines from content, names). No money inside strings except event `message` fallbacks, formatted `$1,234` with `CultureInfo.InvariantCulture` (the skeleton's `GameSession.Money`). Formatting belongs to the client (`Intl.NumberFormat`). |
| Source generation | `BridgeJsonContext : JsonSerializerContext` lists every args, result and envelope type. This makes the bridge trim-safe and avoids first-use reflection cost. The measured one-off cost of the engine's reflection loaders (content load 368–486 ms in WASM) shows what first-use reflection costs. The engine's own loaders stay reflection-based until E13. |

### 4.5 LedgerIndex: incremental monthly aggregates

**Why it is valid:** `Ledger`, `CogsLog` and `TransferLog` are append-only and date-monotonic.
- Every entry is stamped `Clock.Now`.
- The clock only moves forward.
- `WorldLoader` replays entries in file order.

So the facade keeps `(ledgerPos, cogsPos, transferPos)` cursors and folds only the new entries after each mutation or tick.

```csharp
internal sealed class LedgerIndex
{
    int _ledgerPos, _cogsPos, _transferPos;
    // (companyId, monthIndex) → decimal[13] indexed by (int)LedgerCategory
    readonly Dictionary<(int C, int M), decimal[]> _companyMonth = new();
    // (buildingId, monthIndex) → BuildingMonth { revenueSales, revenueExport, opex, inputPurchase, retailRestock, shipping,
    //                                            construction, upgrade, cogsCost, cogsQty, transfersInQty, transfersOutQty }
    readonly Dictionary<(int B, int M), BuildingMonth> _buildingMonth = new();
    // (companyId, productId, monthIndex) → ProductMonth { sales, exports, ads, royaltyIn, royaltyOut, cogsCost, cogsQty, retailQty, exportQty }
    readonly Dictionary<(int C, string P, int M), ProductMonth> _productMonth = new();
    // realised market: (cityId, productId, companyId, monthIndex) → retail units and revenue
    readonly Dictionary<(string City, string P, int C, int M), (double Qty, decimal Rev)> _retailMarket = new();
    // per company running totals: cumulative revenue (milestones), cash by month end (Σ ledger ≤ month)
    readonly Dictionary<int, List<decimal>> _cashAtMonthEnd = new();       // dense from start month
    readonly Dictionary<int, BuildingStatic> _buildingStatic = new();       // openedAt (first ConstructionCost), bookValue (Σ Construction+Upgrade)
    public void CatchUp(World w) { /* fold new entries; classify COGS as retail vs export by the source building's type (Retail ⇒ retail) */ }
}
```

**Classification rules:**

| Question | Rule |
|---|---|
| Revenue | `ProductSale + ExportSale + PatentRoyaltyIncome` (matches World.cs:990-994). |
| Opex | `OperatingCost + AdvertisingCost + PatentRoyaltyExpense` (World.cs:995-998). |
| COGS | `CogsLog` cost. |
| Retail sale vs export | A `CogsEntry` whose `SourceBuilding` is a `Retail` building type is a retail sale; otherwise it is an export. In the engine, only retail buildings sell (MonthlyTick.cs:403-415) and only production/extraction buildings export (447-483). Entries with a null `SourceBuilding` (saves older than v5) count toward company and product totals, but not toward per-building or realised-share metrics. |
| Building "opened at" | Month of the first `ConstructionCost` entry carrying that building id. |
| Book value | Σ `ConstructionCost` + Σ `UpgradeCost`. This is the facade's workaround for E5. |

**Complexity and size:**
- Memory is about 1.7 MB at year 10 (111 buildings × 120 months).
- The cold rebuild after a load is one pass over about 60k entries.
- After that, every report is O(months × keys) instead of O(all entries).

**Parity tests (mandatory):** for every company, for 50 random `(from, to)` windows in a 120-month autopilot run, `IncomeStatement` from the index must equal `World.GetIncomeStatement` to the cent, and the product P&L must equal `World.GetProductProfitability`. For every company and month, `cashAtMonthEnd` must equal the ledger prefix sum.

### 4.6 Derived models (exact definitions)

#### 4.6.1 Corporate value, total assets, equity

```
TotalAssets(c)    = Cash + InventoryValue(WAC) + BuildingValue(book)   // book = construction + upgrades (E5)
Equity(c)         = TotalAssets − Liabilities                          // Liabilities = 0 until loans (EXT)
NetIncome12(c)    = Σ NetIncome over months [max(start, now−11) .. now]
CorporateValue(c) = Equity + 10 × NetIncome12                          // dossier §1 "CV ≈ Cash + Assets + 10 × annual profit"; GameState.cs:200-213
```

- `CorporateValueGoal` keeps its engine semantics (TotalAssets ≥ threshold). The goal DTO carries `unit: 'usd'` and `metric: 'totalAssets'` so the UI never labels it "corporate value" until Q1 is decided.
- `BuildingValue` in DTOs is the facade's book value (construction + upgrades), not `BalanceSheet.BuildingValue`, until E5 fixes the engine.
- Every place the engine balance sheet is shown, the DTO also carries `engineBuildingValue` and `drift`, so the discrepancy stays visible in tests.

#### 4.6.2 Periods

`now = Clock.Now`. `start = scenario.StartDate`; for legacy saves without a scenario, the month of the first ledger entry. Clamp everything to `[start, now]`.

| Preset | Range |
|---|---|
| `thisMonth` | `[now, now]` |
| `lastMonth` | `[now−1, now−1]` (clamped) |
| `ytd` | `[Jan now.year, now]` |
| `last12` | `[now−11, now]` |
| `sinceStart` / `allTime` | `[start, now]` |

- `from > to` returns `invalid_argument` with `field: "period"`.
- **Month semantics:** after the tick for month M, entries dated M include that month's results *plus* the player's actions before the next tick (for example construction). So `thisMonth` is "month-to-date, closed tick included".
- A month `< now` is **closed** and immutable: cacheable forever (§6.9).

#### 4.6.3 Cash-flow statement (exhaustive mapping)

| Section | Line (`category`) | Ledger categories |
|---|---|---|
| Operating | productSales | `ProductSale` |
| Operating | exportSales | `ExportSale` |
| Operating | royaltyIncome | `PatentRoyaltyIncome` |
| Operating | operatingCosts | `OperatingCost` |
| Operating | advertising | `AdvertisingCost` |
| Operating | inputPurchases | `InputPurchase` |
| Operating | retailRestock | `RetailRestock` |
| Operating | shipping | `ShippingCost` |
| Operating | royaltyExpense | `PatentRoyaltyExpense` |
| Investing | construction | `ConstructionCost` |
| Investing | upgrades | `UpgradeCost` |
| Investing | EXT | `AssetSale`, `LandPurchase`, `LandSale` |
| Financing | equityInjections | `StartingCapital` |
| Financing | EXT | `LoanProceeds`, `LoanRepayment`, `DividendPaid`, `ShareIssuance`, `ShareBuyback` |

- **Interest paid goes under Operating** (US GAAP) once it exists.
- `beginningCash` = Σ ledger with `date < from`. `endingCash` = beginning + netChange.
- `reconciles` = (`endingCash == Σ ledger with date ≤ to`) **and** every category was mapped.
- A unit test enumerates `Enum.GetValues<LedgerCategory>()` and fails if any value is missing from the mapping. That is exactly the bug FinancialStatements.cs:482-505 has.

#### 4.6.4 Slot rules (single source for UI and validation)

**Slot kind of a building type.** The first matching rule wins, mirroring the engine's validation order:

| Kind | Rule |
|---|---|
| `extraction` | Some raw product has `Extraction.SourceCategory == type.Category` (data-driven; today farm, plantation, mine, oil_well). |
| `retail` | `type.Retail`. |
| `warehouse` | Category ∈ {warehouse, distribution_center, seaport, freight_yard} (World.cs:287). |
| `research` | Category == `rd_center` (World.cs:259). |
| `production` | `ProducibleTiers` ∩ {Intermediate, Finished} ≠ ∅. |
| `none` | Everything else: media stations, which have no configurable slot but grant the ad bonus. |

**Eligible products:**

| Kind | Eligible |
|---|---|
| extraction | raws whose `SourceCategory` matches |
| retail | **finished only** (a facade rule, stricter than the engine; E7) |
| warehouse | all products |
| research | all products, but each node carries `affectsRetailDemand = (tier == Finished)`. Tech only enters the retail desirability term (MonthlyTick.cs:354), so research on raws or intermediates only buys patents (Q3). |
| production | `Recipe != null && ProducibleTiers.Contains(tier)` |

**Validation for `configureSlot` / `construct.initialSlot`, in this order:**
1. The building exists (`not_found`).
2. The player owns it (`not_owner`).
3. `0 ≤ slotIndex < GetCapacity(b)` (`slot_out_of_range {slotIndex, capacity}`).
4. The kind is not `none` (`slot_kind_unsupported`).
5. The product exists (`not_found {entityKind:'product'}`).
6. The product is eligible (`product_not_allowed {reason}`).
7. Retail: `0 < price ≤ 1,000,000,000` (a sanity cap only; price policy belongs to economics) and `0 < restockTarget ≤ 100,000,000`.
8. Warehouse: `0 < targetStock ≤ 100,000,000`.

Retail `reason` values: `notFinished`. Extraction: `notRaw`, `noExtraction`, `wrongSourceCategory`. Production: `noRecipe`, `tierNotProducible`.

**Occupied index:** re-configuring an index that holds a *different* product replaces it. That is engine behaviour (`RemoveAll` + `Add`), and the response carries `replacedProductId`.

#### 4.6.5 Goals (`GoalTracker`)

Goals are evaluated by the facade against the index, using the same formulas as Scenarios/Goal.cs. A parity test compares each against `Goal.Evaluate` on every tick of a 120-month run.

| Engine goal | `kind` | `current` | `target` | `unit` |
|---|---|---|---|---|
| CorporateValueGoal | `corporateValue` (metric `totalAssets`) | TotalAssets | Threshold | usd |
| MarketShareGoal | `marketShare` | `World.GetMarketShare` (engine definition, kept for parity) | Threshold | ratio |
| OwnsBuildingOfCategoryGoal | `ownsBuilding` | count of player buildings in the category | Count | count |
| ProductRetailedGoal | `productRetailed` | 1 if any player retail slot sells the product | 1 | flag |
| AdCampaignActiveGoal | `adCampaignActive` | 1 if any player campaign on the product has budget > 0 | 1 | flag |
| ElapsedMonthsGoal | `elapsedMonths` | months since the scenario start | Months | months |
| NetIncomeSinceStartGoal | `netIncome` | Σ NI [start, now] | Amount | usd |
| TopBrandGoal | `topBrand` | player brand in (product, city) | Threshold | points |
| ExportRevenueGoal | `exportRevenue` | Σ ExportSale [start, now] | Amount | usd |
| ConsecutiveProfitableMonthsGoal | `consecutiveProfitable` | streak of NI > 0 ending at now | Months | months |

- `met = current ≥ target`.
- `progress = clamp(current / target, 0, 1)` (1 when target ≤ 0).
- `achievedAt` = the first month `met` became true. It latches, is persisted, and fires `goalAchieved` once.
- `id` = the scenario goal `id` if present (E18), else `"g" + index`.

#### 4.6.6 Outcome

Evaluated after every tick, in this order. The result is persisted, and fires once:

1. **won** if the scenario has ≥ 1 goal and all goals are `met` now. This is Godot parity (Main.cs:903); latching is Q2.
2. **lost (bankruptcy)** if the player's month-end cash < 0 for `bankruptcyGraceMonths` consecutive month closes. The default is 6 (Main.cs:910). The counter resets when month-end cash ≥ 0.
3. **lost (deadline)** if `scenario.EndDate` is set, `now ≥ EndDate`, and the game was not won. This matches Main.cs:918-919.

Once the outcome is not `playing`, commands still work: "continue playing" is sandbox mode. `outcome` stays in every `snapshot`.

**Content defect (UX §3.5; re-verified here from the scenario JSON):** two scenarios can't be won, because they require more elapsed months than the deadline allows: `four_archetype_melee` needs 84 months but ends at month 83; `tech_titan_clash` needs 60 but ends at 59.

#### 4.6.7 Scenario difficulty (port of ScenarioDifficulty.Compute, unchanged)

```
score = 0
ais = scenario.AiCompetitors; ratio = Σ ai.StartingCash / player.StartingCash   (only if player cash > 0 and ais ≥ 1)
score += ratio > 2.5 ? 3 : ratio ≥ 1.5 ? 2 : ratio > 1.0 ? 1 : 0
score += goals ≥ 6 ? 2 : goals ≥ 4 ? 1 : 0
score += ais == 0 ? −1 : ais == 2 ? +1 : ais ≥ 3 ? +2 : 0
if EndDate: months = (end.Y − start.Y)*12 + (end.M − start.M); score += months ≤ 24 ? +1 : (49 ≤ months ≤ 72 ? −1 : 0)
else score −= 1
score += any ai.Strategy equals "verticalIntegrator" (case-insensitive) ? 1 : 0
score += min(2, #goals that are (MarketShare with Threshold ≥ 0.35) or TopBrand or (ExportRevenue with Amount > 3,000,000))
difficulty = clamp(score, 1, 5); bucket = ≤2 "easy", 3 "normal", ≥4 "hard"
```

#### 4.6.8 Metrics history (persisted)

After every month close, append one row per company:

```
{ month, cash, revenue, netIncome, totalAssets, equity, corporateValue, inventoryValue, buildingValue,
  buildings, topBrand, topTech }
```

| Field | Definition |
|---|---|
| `topBrand` | Max brand over all (product, city) keys where the company has a campaign or a retail slot. |
| `topTech` | Max tech over products in its slots; `BaseTechLevel` if none. |

**Legacy saves** (no sidecar): cash, revenue and netIncome are **backfilled exactly** from the index for every month since the start. The other series start at the load month, and `history` reports where each one begins in `missingBefore`. Five companies × 120 months × 12 numbers is about 60 KB of JSON in the save, which is negligible.

#### 4.6.9 Advisor (port and extension of Main.cs:669-719)

`priority` = the first rule that fires, in order:

| # | Code | Condition | Params |
|---|---|---|---|
| 1 | `firstRevenue` | player owns 0 buildings | |
| 2 | `activateIdle` | ≥ 1 owned building with 0 configured slots, excluding kind `none` | `count`, `buildingIds` |
| 3 | `needRetail` | no retail building | |
| 4 | `restoreProfit` | NI this month < 0 | `netIncome` |
| 5 | `buildBrand` | no active campaigns | |
| 6 | `addResearch` | no R&D building | |
| 7 | `scale` | none of the above | `retail`, `production`, `research`, `campaigns` |

`hints` are extra checks that are valid on today's engine, sorted by severity:

| Code | Condition | Params |
|---|---|---|
| `lowRunway` | `cashRunwayMonths < 3` | `months` |
| `sellingBelowCost` | a retail slot with `price < unitCost` (WAC on hand) | `buildingId`, `productId`, `price`, `unitCost` |
| `exportingAtLoss` | an auto-exporting slot whose effective world price < WAC unit cost of on-hand output | `buildingId`, `productId`, `worldPrice`, `unitCost` |
| `unsellableRetail` | a retail slot holding a non-finished product (legacy saves) | `buildingId`, `productId` |
| `rivalPatentBlocksYou` | the player has research slots on a product blocked by a rival patent | `productId`, `holderId`, `expiresAt` |
| `adsWithoutStore` | a player campaign in a city where the player has no retail slot for that product (UX X-list) | `productId`, `cityId` |

**Cash runway:**
- `opCF3` = the average operating cash flow (§4.6.3) over the last 3 closed months.
- `cashRunwayMonths` = `cash / −opCF3` if `opCF3 < 0`, else `null`.

**v2 (UX §6.15):** rank by an estimated $/month impact, with a `fixAction` suggestion such as `{method, args}`. The DTO reserves `impactPerMonth?` and `fix?` for that (§5.11).

#### 4.6.10 Placement (interim, until engine plots, EXT §8.1)

The web scene uses plot coordinates (web/src/scene/units.ts): plot (0,0) is the NW corner and `PLOT_SIZE` is 12 m. Today it lays buildings out on a client-side spiral (PlaceholderCity.ts:97). To give every building a **stable** position shared by all views and persisted across loads, the facade owns an interim `PlacementDto {px, pz, rotation, source}`:

**Player placement.** If `construct.at` (a plot and rotation) is given, validate:
- inside the grid: `0 ≤ px`, `px + w' ≤ gridW` (w', h' swap at 90°/270°);
- no overlap with an existing placement;
- not on a reserved road line (`px % 6 == 0` or `pz % 6 == 0`).

Then store it with `source: 'bridge'`. Errors: `plot_out_of_bounds`, `plot_occupied`.

**Everyone else** (AI buildings and constructs without `at`): the facade auto-places deterministically in building-id order.
- Search a spiral outward from a ring chosen by category, measured as the ring fraction of the half-grid:

  | Categories | Ring |
  |---|---|
  | retail, media, R&D | [0, 0.45) |
  | warehouse, factory | [0.35, 0.8) |
  | farm, plantation, mine, oil_well | [0.6, 1] |
  | seaport | the south edge band, if the city is coastal |

- The start angle is `(buildingId × 137.508°)`.
- Take the first legal rectangle, recorded with `source: 'auto'`.

When the engine gains plots (`features.plots`), placement comes from the engine (`source: 'engine'`). The engine's save migration adopts the sidecar map for legacy games.

### 4.7 Error model

Error codes are snake_case. The skeleton's eight stay (`unknown_method`, `bad_request`, `no_game`, `not_initialized`, `not_found`, `invalid_argument`, `invalid_operation`, `internal`, plus TS-only `transport`). These are new:

| Code | Raised when | `details` |
|---|---|---|
| `insufficient_funds` | cost > player cash (construct, upgrade, starter plan, EXT land/IPO) | `required`, `available`, `shortfall` |
| `not_owner` | a player command on a building or patent the player doesn't own | `entityKind`, `entityId` |
| `slot_out_of_range` | slotIndex ∉ [0, capacity) | `slotIndex`, `capacity` |
| `slot_kind_unsupported` | the building type has no configurable slot (media) | `entityId` (type) |
| `slot_empty` | set*/clear on an unconfigured index or a mismatched kind | `slotIndex` |
| `product_not_allowed` | §4.6.4 eligibility | `productId`, `reason` |
| `geography_mismatch` | a `GeographyRequirement` flag isn't met by the city (E6 is enforced in the facade until the engine does it) | `reason` (e.g. `"oilRich"`) |
| `not_upgradeable` / `max_level` | UpgradeBuilding preconditions | `level`, `maxLevel` |
| `patent_not_active` / `patent_self_license` / `not_patent_holder` | license commands | `productId` |
| `invalid_period` | `from > to` | |
| `save_corrupt` | not gzip/JSON, or missing required fields | `devMessage` |
| `save_version_unsupported` | engine schema or web format out of range | `schemaVersion`, `minSchemaVersion`, `maxSchemaVersion` |
| `save_content_mismatch` | the save references ids missing from the loaded catalog (checked on load **before** the world is used; otherwise the first tick throws `KeyNotFoundException`) | `missing[]` (e.g. `"product:foo"`) |
| `tick_failed` | `AdvanceMonth` threw; the session is faulted | `devMessage` |
| `feature_unavailable` | an EXT method or argument is used while its feature flag is off | `feature` |
| `plot_out_of_bounds` / `plot_occupied` | `construct.at` / `previewBuild.at` fails the interim placement checks (§4.6.10); the engine takes these over when `features.plots` is on | `reason` |
| EXT: `zoning_forbidden`, `parcel_not_owned`, `parcel_not_for_sale`, `under_construction`, `credit_limit_exceeded`, `loan_not_found`, `not_listed`, `already_listed`, `insufficient_shares`, `takeover_blocked` | §8 | per feature |

- `message` is always facade-authored English.
- `field` names the offending argument (`"price"`, `"slotIndex"`, `"at.px"`).
- The client renders the message from `code` + `details`.

### 4.8 Performance budgets (WASM, year 10, 5 companies, about 111 buildings)

| Call | Budget (p95) | Today (skeleton) | How |
|---|---|---|---|
| `snapshot` / `hud` in envelopes | ≤ 2 ms | about 40–45 ms (5 × income statement + balance sheet, plus goals) | index + cached goals |
| `advance {months:1}`, engine + facade | ≤ 60 ms | engine alone 32–38 ms; the skeleton adds 2 × `EvaluateGoals` (~15 ms) + snapshot | index, EventDetector O(buildings + slots) |
| `cityView` (full, one city) | ≤ 15 ms | n/a | projection only |
| `building` | ≤ 5 ms | n/a | index |
| Any report | ≤ 10 ms | n/a | index |
| `marketDetail` / `marketIntel` | ≤ 10 / 20 ms | n/a | MarketModel O(retail slots) |
| `SaveBinary` | ≤ 2.5 s | 1.4–1.8 s engine + 1.3–1.5 s marshal | compact JSON + gzip in .NET (§6.3) |
| `LoadBinary` | ≤ 4 s | 2.5–3.3 s | E13/E14 later |

Keep responses ≤ ~100 KB on the interactive path. Marshal plus `JSON.parse` is about 10 ms at that size (string marshal measured at about 0.1 ms/KB).

---

## 5. Protocol reference

Conventions for this section:
- C# records live in `namespace Magnate.Bridge` and are listed in `BridgeJsonContext`.
- The TypeScript interfaces go in `web/src/bridge/protocol.ts`.
- Field order in TS follows the C# positional order.
- `decimal` becomes `number`, rounded per §4.4. `double` becomes `number | null` only where noted.
- C# `IReadOnlyList<T>` becomes `T[]`. `IReadOnlyDictionary<string,T>` becomes `Record<string, T>`.

### 5.0 Envelope (CHANGE: additive)

```csharp
public sealed record OkEnvelope(bool Ok, object? Result, long Revision,
    SnapshotDto? Hud = null,                                  // NEW: present on mutating calls except `advance` (its result embeds the snapshot)
    IReadOnlyList<GameEventDto>? Events = null);              // NEW: events produced by this command (e.g. buildingConstructed)
public sealed record ErrorEnvelope(bool Ok, ErrorBody Error, long Revision);
public sealed record ErrorBody(string Code, string Message,
    string? Field = null,                                     // NEW: offending arg path
    ErrorDetailsDto? Details = null);                         // NEW
public sealed record ErrorDetailsDto(
    decimal? Required = null, decimal? Available = null, decimal? Shortfall = null,
    int? SlotIndex = null, int? Capacity = null, int? Level = null, int? MaxLevel = null,
    string? EntityKind = null, string? EntityId = null, string? ProductId = null, string? Reason = null,
    decimal? Min = null, decimal? Max = null, IReadOnlyList<string>? Missing = null, string? Feature = null,
    int? SchemaVersion = null, int? MinSchemaVersion = null, int? MaxSchemaVersion = null,
    string? DevMessage = null);
```

```ts
export interface OkEnvelope<T> { ok: true; result: T; revision: number; hud?: SnapshotDto; events?: GameEventDto[] }
export interface ErrorEnvelope { ok: false; error: BridgeError; revision: number }
export type Envelope<T> = OkEnvelope<T> | ErrorEnvelope;
export interface BridgeError { code: BridgeErrorCode; message: string; field?: string; details?: ErrorDetails }
export interface ErrorDetails {
  required?: number; available?: number; shortfall?: number; slotIndex?: number; capacity?: number;
  level?: number; maxLevel?: number; entityKind?: EntityKind; entityId?: string; productId?: string; reason?: string;
  min?: number; max?: number; missing?: string[]; feature?: FeatureName;
  schemaVersion?: number; minSchemaVersion?: number; maxSchemaVersion?: number; devMessage?: string;
}
export type EntityKind = 'scenario' | 'city' | 'product' | 'buildingType' | 'building' | 'company' | 'goal'
  | 'starterPlan' | 'save' | 'parcel' | 'loan';
export type BridgeErrorCode =
  | 'unknown_method' | 'bad_request' | 'no_game' | 'not_initialized' | 'not_found' | 'invalid_argument'
  | 'invalid_operation' | 'internal' | 'transport'
  | 'insufficient_funds' | 'not_owner' | 'slot_out_of_range' | 'slot_kind_unsupported' | 'slot_empty'
  | 'product_not_allowed' | 'geography_mismatch' | 'not_upgradeable' | 'max_level'
  | 'patent_not_active' | 'patent_self_license' | 'not_patent_holder' | 'invalid_period'
  | 'save_corrupt' | 'save_version_unsupported' | 'save_content_mismatch' | 'tick_failed' | 'feature_unavailable'
  | 'plot_occupied' | 'plot_out_of_bounds' | 'zoning_forbidden' | 'parcel_not_owned' | 'parcel_not_for_sale'
  | 'under_construction' | 'credit_limit_exceeded' | 'loan_not_found' | 'not_listed' | 'already_listed'
  | 'insufficient_shares' | 'takeover_blocked';
```

`EngineClient.unwrap` (web/src/bridge/engine.ts:106):
- keeps `revision` as it does today;
- additionally pushes `envelope.hud` into the store and fans `envelope.events` out onto the bus. This replaces `syncAfterMutation()`'s two extra calls (gameStore.ts:170-174).

### 5.1 Common types

```csharp
public sealed record DateDto(int Year, int Month);                                          // EXISTS
public sealed record PeriodArgs(string? Preset = null, DateDto? From = null, DateDto? To = null);
public sealed record PeriodDto(DateDto From, DateDto To, int Months, string Preset);       // preset or "custom"
public sealed record SeriesDto(DateDto Start, IReadOnlyList<double?> Values);              // dense monthly series
public sealed record CompanyRefDto(int CompanyId, string Name, string Color);
public sealed record ProductQtyDto(string ProductId, double Quantity);
public sealed record IdCountDto(string Id, int Count);
public sealed record PlacementDto(int Px, int Pz, int Rotation, string Source);            // rotation 0|90|180|270; source auto|bridge|engine
public sealed record PlotRefDto(int Px, int Pz, int Rotation = 0);
```

```ts
export interface DateDto { year: number; month: number }
export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'ytd' | 'last12' | 'sinceStart' | 'allTime';
export interface PeriodArgs { preset?: PeriodPreset; from?: DateDto; to?: DateDto }
export interface PeriodDto { from: DateDto; to: DateDto; months: number; preset: PeriodPreset | 'custom' }
export interface SeriesDto { start: DateDto; values: (number | null)[] }
export interface CompanyRefDto { companyId: number; name: string; color: string }
export interface ProductQtyDto { productId: string; quantity: number }
export interface IdCountDto { id: string; count: number }
export interface PlacementDto { px: number; pz: number; rotation: 0 | 90 | 180 | 270; source: 'auto' | 'bridge' | 'engine' }
export interface PlotRefDto { px: number; pz: number; rotation?: 0 | 90 | 180 | 270 }
export type SlotKind = 'production' | 'extraction' | 'retail' | 'warehouse' | 'research' | 'none';
export type ProductTier = 'raw' | 'intermediate' | 'finished';                              // EXISTS
export type AdChannelId = 'tv' | 'newspaper' | 'magazine' | 'radio';
export type Bracket = 'low' | 'middle' | 'high';
export type UiSeverity = 'info' | 'success' | 'warning' | 'danger';
export type NewsSeverity = 'info' | 'notable' | 'major';
export type LedgerCategoryId = 'startingCapital' | 'constructionCost' | 'operatingCost' | 'inputPurchase'
  | 'retailRestock' | 'productSale' | 'exportSale' | 'shippingCost' | 'advertisingCost'
  | 'patentRoyaltyIncome' | 'patentRoyaltyExpense' | 'upgradeCost';
export type FeatureName = 'plots' | 'landMarket' | 'constructionTime' | 'demolish' | 'loans' | 'stockMarket'
  | 'macro' | 'productionLog' | 'domainEvents' | 'demandModel';
```

### 5.2 Method catalog

"Mut" means the call bumps `revision` and returns `hud`. "Game" means it requires an active game.

| Method | Tag | Mut | Game | Args | Result | Main errors |
|---|---|---|---|---|---|---|
| `init` | CHANGE | yes | no | `InitArgs` | `InitResult` (+features, contentHash) | `not_found` (content root), `internal` |
| `ping` | EXISTS | no | no | none | `PingResult` | none |
| `listScenarios` | CHANGE | no | no | none | `ScenarioSummaryDto[]` (+difficulty) | `not_initialized` |
| `catalog` | CHANGE | no | no | none | `CatalogDto` (+slotKind, eligible, levels, constants, starter plans) | `not_initialized` |
| `newGame` | CHANGE | yes | no | `NewGameArgs` (+autopilot, companyName, custom) | `SnapshotDto` | `not_found`, `invalid_argument` |
| `snapshot` | CHANGE | no | yes | none | `SnapshotDto` (+player, outcome, alerts, seqs) | `no_game` |
| `companies` | NEW | no | yes | none | `CompanySummaryDto[]` | none |
| `settings` / `updateSettings` | NEW | no / yes | yes | none / `UpdateSettingsArgs` | `SettingsDto` | `invalid_argument` |
| `setAutopilot` | NEW | yes | yes | `AutopilotArgs` | `SnapshotDto` | `not_found` (strategy); `invalid_operation` for `null` until E2 |
| `advance` | CHANGE | yes | yes | `AdvanceArgs` (+stopOn, viewCityId, viewSince) | `TickResultDto` (+monthSummaries, playerActivity, cityView, autosaveDue) | `tick_failed` |
| `cityView` | NEW | no | yes | `CityViewArgs` | `CityViewDto` | `not_found` |
| `worldMap` | NEW | no | yes | none | `WorldMapDto` | none |
| `buildings` | CHANGE | no | yes | `BuildingsArgs` (+ownerId, sort) | `BuildingSummaryDto[]` (+status, cash flow, products) | none |
| `building` | NEW | no | yes | `BuildingRefArgs` | `BuildingDetailDto` | `not_found` |
| `supplyFlows` | NEW | no | yes | `SupplyFlowsArgs` | `SupplyFlowsDto` | `not_found` |
| `previewBuild` | NEW | no | yes | `PreviewBuildArgs` | `BuildPreviewDto` | `not_found` |
| `construct` | CHANGE | yes | yes | `ConstructArgs` (+initialSlot, at) | `BuildingSummaryDto` + `events` | `insufficient_funds`, `geography_mismatch`, `not_found`, `product_not_allowed`, `plot_*` |
| `buildStarterPlan` | NEW | yes | yes | `StarterPlanArgs` | `BuildingSummaryDto` | as `construct` |
| `configureSlot` | NEW | yes | yes | `ConfigureSlotArgs` | `SlotDetailDto` | `not_owner`, `slot_out_of_range`, `slot_kind_unsupported`, `product_not_allowed`, `invalid_argument` |
| `clearSlot` | NEW | yes | yes | `SlotRefArgs` | `BuildingSummaryDto` | `slot_empty`, `not_owner` |
| `setRetailPrice` | NEW | yes | yes | `SetRetailPriceArgs` | `SlotDetailDto` | `slot_empty`, `invalid_argument` |
| `setRestockTarget` | NEW | yes | yes | `SetRestockTargetArgs` | `SlotDetailDto` | same |
| `setWarehouseTarget` | NEW | yes | yes | `SetWarehouseTargetArgs` | `SlotDetailDto` | same |
| `setAutoExport` | NEW | yes | yes | `SetAutoExportArgs` | `BuildingSummaryDto` | `not_owner` |
| `upgradeBuilding` | NEW | yes | yes | `BuildingRefArgs` | `UpgradeResultDto` + `events` | `not_upgradeable`, `max_level`, `insufficient_funds` |
| `demolishBuilding` / `sellBuilding` | EXT | yes | yes | `BuildingRefArgs` | `DisposalResultDto` | `feature_unavailable` until E16 |
| `adCampaigns` | NEW | no | yes | none | `AdCampaignsDto` | none |
| `previewAdCampaign` | NEW | no | yes | `AdCampaignArgs` | `AdPreviewDto` | `not_found` |
| `setAdCampaign` | NEW | yes | yes | `AdCampaignArgs` (0 = cancel) | `AdCampaignDto` + `events` | `invalid_argument` |
| `cancelAdCampaign` | NEW | yes | yes | `AdKeyArgs` | `CancelResultDto` | none |
| `researchTree` | NEW | no | yes | none | `ResearchTreeDto` | none |
| `patents` | NEW | no | yes | none | `PatentsDto` | none |
| `grantLicense` / `revokeLicense` | NEW | yes | yes | `LicenseArgs` | `PatentsDto` | `not_patent_holder`, `patent_not_active`, `patent_self_license`, `not_found` |
| `incomeStatement` | NEW | no | yes | `CompanyPeriodArgs` | `IncomeStatementDto` | `invalid_period` |
| `balanceSheet` | NEW | no | yes | `BalanceSheetArgs` | `BalanceSheetDto` | `not_found` |
| `cashFlow` | NEW | no | yes | `CompanyPeriodArgs` | `CashFlowDto` | `invalid_period` |
| `productProfitability` | NEW | no | yes | `CompanyPeriodArgs` | `ProductProfitabilityDto` | `invalid_period` |
| `exports` | NEW | no | yes | `CompanyPeriodArgs` | `ExportsDto` | `invalid_period` |
| `ledger` | NEW | no | yes | `LedgerArgs` | `LedgerPageDto` | `invalid_argument` |
| `explainNetIncome` | NEW | no | yes | `ExplainArgs` | `ExplainDto` | `invalid_period` |
| `marketIntel` | NEW | no | yes | `MarketIntelArgs` | `MarketIntelDto` | none |
| `marketDetail` | NEW | no | yes | `MarketKeyArgs` | `MarketDetailDto` | `not_found`, `product_not_allowed` (not finished) |
| `marketOpportunities` | NEW | no | yes | none | `MarketOpportunitiesDto` | none |
| `suggestPrice` | NEW | no | yes | `SlotRefArgs` | `PriceSuggestionDto` | `slot_empty` |
| `goals` | NEW | no | yes | none | `GoalsDto` | none |
| `advisor` | NEW | no | yes | none | `AdvisorDto` | none |
| `history` | NEW | no | yes | `HistoryArgs` | `HistoryDto` | `invalid_argument` |
| `monthlyReport` | NEW | no | yes | `MonthlyReportArgs` | `MonthlyReportDto` | `invalid_period` |
| `statsDashboard` | NEW | no | yes | none | `StatsDashboardDto` | none |
| `news` | NEW | no | yes | `NewsArgs` | `NewsDto` | none |
| `activityFeed` | NEW | no | yes | `FeedArgs` | `FeedDto` | none |
| `saveGame` | EXISTS | no | yes | none | `SaveGameResult` (string; dev/tests only) | none |
| `loadGame` | CHANGE | yes | no | `LoadGameArgs` | `SnapshotDto` | `save_*` |
| `SaveBinary` / `LoadBinary` / `InspectSave` | NEW (JSExport, not `Call`) | as `save`/`load` | as `save`/`load` | bytes + args JSON | `byte[]` / envelope JSON | `save_*` |
| `exportEngineJson` | NEW (dev) | no | yes | none | `{ json: string }` (legacy Godot-compatible v9 file) | none |
| `debugStats` | NEW | no | no | none | `DebugStatsDto` | none |
| EXT: `cityLayout`, `parcels`, `buyLand`, `sellLand`, `cancelConstruction`, `creditProfile`, `loanOffers`, `loans`, `takeLoan`, `repayLoan`, `stockMarket`, `holdings`, `ipo`, `issueShares`, `buybackShares`, `tradeShares`, `setDividend`, `macro` | EXT | varies | yes | §8 | §8 | `feature_unavailable` until their flag |

### 5.3 Session, scenarios, catalog, HUD

#### `init` (CHANGE) and `ping` (EXISTS)

```csharp
public sealed record InitArgs(string ContentRoot, string? ScenarioDir = null);                       // EXISTS
public sealed record InitResult(string EngineVersion, int ProtocolVersion, int Products, int BuildingTypes,
    int Cities, int Scenarios, IReadOnlyList<string> Methods,                                         // EXISTS
    FeatureFlagsDto Features, string ContentHash, int SaveFormatVersion, int EngineSchemaVersion);    // NEW
public sealed record FeatureFlagsDto(bool Plots = false, bool LandMarket = false, bool ConstructionTime = false,
    bool Demolish = false, bool Loans = false, bool StockMarket = false, bool Macro = false,
    bool ProductionLog = false, bool DomainEvents = false, bool DemandModel = false);
public sealed record PingResult(string Pong, long Revision, bool HasGame);                            // EXISTS
```

```ts
export interface InitResult {
  engineVersion: string; protocolVersion: number; products: number; buildingTypes: number; cities: number;
  scenarios: number; methods: string[];
  features: FeatureFlags; contentHash: string; saveFormatVersion: number; engineSchemaVersion: number;
}
export interface FeatureFlags { plots: boolean; landMarket: boolean; constructionTime: boolean; demolish: boolean;
  loans: boolean; stockMarket: boolean; macro: boolean; productionLog: boolean; domainEvents: boolean; demandModel: boolean }
export interface PingResult { pong: string; revision: number; hasGame: boolean }
```

`ProtocolVersion` (GameSession.cs:183) stays `1` while every change is additive. The rules:
- **Additive changes** (new fields, new methods, new error codes): no bump.
- **Changes to meaning, renames, or removals:** bump.
- The TS client refuses to run on a major mismatch.

#### `listScenarios` (CHANGE)

```csharp
public sealed record ScenarioSummaryDto(string Id, string Name, string Description, DateDto StartDate, DateDto? EndDate,
    string PlayerName, decimal StartingCash, IReadOnlyList<ScenarioCompetitorDto> Competitors,
    IReadOnlyList<string> Goals,                                                  // EXISTS (descriptions)
    int Difficulty, string DifficultyBucket, int? DurationMonths, bool IsSandbox, // NEW (§4.6.7)
    IReadOnlyList<ScenarioGoalDto> GoalDetails, int SortKey);                     // NEW
public sealed record ScenarioCompetitorDto(string Name, decimal StartingCash, string Strategy);   // EXISTS
public sealed record ScenarioGoalDto(string Id, int Index, string Kind, string Metric, string Description,
    decimal Target, string Unit, string? ProductId, string? CityId, string? Category);
```

```ts
export interface ScenarioSummaryDto {
  id: string; name: string; description: string; startDate: DateDto; endDate?: DateDto;
  playerName: string; startingCash: number; competitors: ScenarioCompetitorDto[]; goals: string[];
  difficulty: 1 | 2 | 3 | 4 | 5; difficultyBucket: 'easy' | 'normal' | 'hard'; durationMonths?: number;
  isSandbox: boolean; goalDetails: ScenarioGoalDto[]; sortKey: number;
}
export interface ScenarioCompetitorDto { name: string; startingCash: number; strategy: AiStrategyName }
export type AiStrategyName = 'simple' | 'adaptive' | 'verticalIntegrator' | 'techLeader';
export type GoalKind = 'corporateValue' | 'marketShare' | 'ownsBuilding' | 'productRetailed' | 'adCampaignActive'
  | 'elapsedMonths' | 'netIncome' | 'topBrand' | 'exportRevenue' | 'consecutiveProfitable';
export type GoalUnit = 'usd' | 'ratio' | 'count' | 'flag' | 'months' | 'points';
export interface ScenarioGoalDto { id: string; index: number; kind: GoalKind; metric: string; description: string;
  target: number; unit: GoalUnit; productId?: string; cityId?: string; category?: string }
```

- `sortKey` puts tutorial first, then sandbox, then difficulty ascending, then name. This keeps the skeleton's order (GameSession.Game.cs:22) and the Godot picker's order.
- Strategy names are normalised to the four canonical ids. Inputs `retailer`, `vertical` and `tech` map to them.

#### `catalog` (CHANGE)

```csharp
public sealed record CatalogDto(IReadOnlyList<ProductDto> Products, IReadOnlyList<BuildingTypeDto> BuildingTypes,
    IReadOnlyList<CityDto> Cities,                                                                     // EXISTS
    IReadOnlyList<AdChannelDto> AdChannels, SimConstantsDto Constants, IReadOnlyList<EventDefDto> Events,
    IReadOnlyList<StarterPlanDto> StarterPlans, string ContentHash);                                   // NEW
public sealed record ProductDto(string Id, string Name, string Tier, string Category, string Unit,
    double BaseWorldMarketPrice, int MaxTechLevel, RecipeDto? Recipe, string? ExtractedAt,             // EXISTS
    double PriceElasticity, BracketValuesDto BaseDemandPerCapita, BracketValuesDto? ReservationPrice,  // NEW
    double? YieldPerSlotPerMonth, double? OutputPerSlotPerMonth, IReadOnlyList<string> FeedsInto,
    bool AffectsRetailDemand);
public sealed record RecipeDto(double OutputQuantity, IReadOnlyList<RecipeInputDto> Inputs,            // EXISTS
    double LaborUnits = 0);                                                                           // NEW
public sealed record RecipeInputDto(string ProductId, double Quantity, double PerSlotPerMonth = 0);    // EXISTS + NEW
public sealed record BracketValuesDto(double? Low, double? Middle, double? High);
public sealed record BuildingTypeDto(string Id, string Name, string Category, decimal ConstructionCost,
    decimal MonthlyOperatingCost, int FootprintWidth, int FootprintHeight, int MaxUnits, bool Retail,
    IReadOnlyList<string> ProducibleTiers, int MaxLevel,                                                // EXISTS
    string SlotKind, IReadOnlyList<string> EligibleProductIds, IReadOnlyList<LevelDto> Levels,          // NEW
    GeographyReqDto? Geography, HeadcountDto? Headcount, string BuildMenuGroup,
    string? MediaChannel, decimal? MediaBonus);
public sealed record LevelDto(int Level, int Capacity, decimal MonthlyOperatingCost, decimal UpgradeCost);
public sealed record GeographyReqDto(bool? Coastal, bool? Arable, bool? MineralRich, bool? OilRich);
public sealed record HeadcountDto(int Min, int Max);
public sealed record CityDto(string Id, string Name, long Population, int GridWidth, int GridHeight,
    bool Coastal, bool Arable, bool MineralRich, bool OilRich, decimal BaseLandPrice,
    IReadOnlyDictionary<string, double> Demographics,                                                  // EXISTS
    IReadOnlyDictionary<string, double> PotentialDemand);                                              // NEW: finished productId → units/month
public sealed record AdChannelDto(string Id, decimal CostPerPoint, string? MediaBuildingTypeId, decimal OwnershipBonus);
public sealed record SimConstantsDto(int CyclesPerSlotPerMonth, decimal InterCityShippingFraction,
    double WorldMarketQuality, double ExtractionQuality, int BaseTechLevel, double ResearchPointsPerSlotPerMonth,
    double BaseResearchThreshold, int PatentDurationMonths, decimal PatentRoyaltyRate, double BrandDecayRate,
    decimal EventBaseProbabilityPerMonth, int BankruptcyGraceMonths, decimal DefaultLowCashThreshold);
public sealed record EventDefDto(string Id, string Name, string Description, string Severity);
public sealed record StarterPlanDto(string Id, string Label, string TypeId, string ProductId, decimal? Price,
    double? Target, string CitySelector);                                                              // citySelector: "largestPopulation"
```

```ts
export interface CatalogDto { products: ProductDto[]; buildingTypes: BuildingTypeDto[]; cities: CityDto[];
  adChannels: AdChannelDto[]; constants: SimConstantsDto; events: EventDefDto[]; starterPlans: StarterPlanDto[]; contentHash: string }
export interface ProductDto { id: string; name: string; tier: ProductTier; category: string; unit: string;
  baseWorldMarketPrice: number; maxTechLevel: number; recipe?: RecipeDto; extractedAt?: string;
  priceElasticity: number; baseDemandPerCapita: BracketValues; reservationPrice?: BracketValues;
  yieldPerSlotPerMonth?: number; outputPerSlotPerMonth?: number; feedsInto: string[]; affectsRetailDemand: boolean }
export interface RecipeDto { outputQuantity: number; inputs: RecipeInputDto[]; laborUnits: number }
export interface RecipeInputDto { productId: string; quantity: number; perSlotPerMonth: number }
export interface BracketValues { low?: number; middle?: number; high?: number }
export interface BuildingTypeDto { id: string; name: string; category: string; constructionCost: number;
  monthlyOperatingCost: number; footprintWidth: number; footprintHeight: number; maxUnits: number; retail: boolean;
  producibleTiers: ProductTier[]; maxLevel: number;
  slotKind: SlotKind; eligibleProductIds: string[]; levels: LevelDto[]; geography?: GeographyReq; headcount?: { min: number; max: number };
  buildMenuGroup: 'retail' | 'production' | 'extraction' | 'logistics' | 'media' | 'research';
  mediaChannel?: AdChannelId; mediaBonus?: number }
export interface LevelDto { level: number; capacity: number; monthlyOperatingCost: number; upgradeCost: number }
export interface GeographyReq { coastal?: boolean; arable?: boolean; mineralRich?: boolean; oilRich?: boolean }
export interface CityDto { id: string; name: string; population: number; gridWidth: number; gridHeight: number;
  coastal: boolean; arable: boolean; mineralRich: boolean; oilRich: boolean; baseLandPrice: number;
  demographics: Record<Bracket, number>; potentialDemand: Record<string, number> }
export interface AdChannelDto { id: AdChannelId; costPerPoint: number; mediaBuildingTypeId?: string; ownershipBonus: number }
export interface SimConstantsDto { cyclesPerSlotPerMonth: number; interCityShippingFraction: number; worldMarketQuality: number;
  extractionQuality: number; baseTechLevel: number; researchPointsPerSlotPerMonth: number; baseResearchThreshold: number;
  patentDurationMonths: number; patentRoyaltyRate: number; brandDecayRate: number; eventBaseProbabilityPerMonth: number;
  bankruptcyGraceMonths: number; defaultLowCashThreshold: number }
export interface EventDefDto { id: string; name: string; description: string; severity: NewsSeverity }
export interface StarterPlanDto { id: string; label: string; typeId: string; productId: string; price?: number; target?: number; citySelector: 'largestPopulation' }
```

**Derivations:**

| Field | Rule |
|---|---|
| `levels` | `type.Levels`. Non-upgradeable types get one synthetic level `{1, MaxUnits, MonthlyOperatingCost, 0}`. |
| `buildMenuGroup` | extraction → `extraction`; retail → `retail`; warehouse kinds → `logistics`; `rd_center` → `research`; `media` → `media`; else `production`. |
| `mediaChannel` | tv_station → `tv`, radio_station → `radio`, newspaper_publisher → `newspaper`, magazine_publisher → `magazine`. |
| `mediaBonus` | 1.35 for tv/radio, 1.25 for print (World.cs:467-502). |
| `potentialDemand` | Σ_b population × share_b × perCapita_b, for finished products only (MonthlyTick.cs:431). |

**Channel costs:** `adChannels` per-point costs are TV 4,000, Newspaper 6,000, Magazine 8,000, Radio 5,000 (SimulationConstants.cs:59-68).

**Starter plans** (Manage.cs:541-544):

| id | Type | Product | Price | Target |
|---|---|---|---|---|
| `cornerStore` | convenience_store | soft_drink | 2.25 | 250,000 |
| `breadAisle` | supermarket | bread | 4.25 | 350,000 |
| `warehouseHub` | warehouse_small | bread | n/a | 500,000 |
| `softDrinkLab` | rd_center | soft_drink | n/a | n/a |

**Recommendation:** move starter plans into content (`content/data/starter_plans.json`), and have the economics workstream tune the defaults. The UX report shows the fixed $1.80 / 500,000 defaults bankrupt most products.

#### `newGame` (CHANGE)

```csharp
public sealed record NewGameArgs(string ScenarioId, int? Seed = null,                 // EXISTS
    string? Autopilot = null,                                                         // NEW: strategy name; the player company is AI-driven ("spectator")
    string? CompanyName = null,                                                       // NEW: overrides scenario.Player.Name (records support `with`)
    CustomGameDto? Custom = null,                                                     // NEW: required iff ScenarioId == "custom"
    string? CreatedAtIso = null);                                                     // NEW: JS clock, used for gameId and save metadata
public sealed record CustomGameDto(DateDto StartDate, DateDto? EndDate, decimal PlayerCash,
    IReadOnlyList<ScenarioCompetitorDto> Competitors);
```

```ts
export interface NewGameArgs { scenarioId: string; seed?: number; autopilot?: AiStrategyName; companyName?: string;
  custom?: CustomGameDto; createdAtIso?: string }
export interface CustomGameDto { startDate: DateDto; endDate?: DateDto; playerCash: number; competitors: ScenarioCompetitorDto[] }
```

**Rules:**
- `seed` defaults to `1` (skeleton). **The client must send a random value** (`crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff`).
- Custom games build `new Scenario("custom", "Custom Game", "", start, end, new ScenarioPlayer(name, cash), ais, [])` in memory. ScenarioRunner accepts any `Scenario`. The definition is written to the sidecar so a load restores it.
- `playerCash` must be > 0; `ArgumentException` from `CreateCompany` is pre-empted.
- The result also resets these structures: index, history (first row = start state), feed, goals, placement, journal.

#### `snapshot` (CHANGE). The HUD; also returned as `hud` in mutating envelopes

```csharp
public sealed record SnapshotDto(DateDto Date, int MonthIndex, int PlayerId, IReadOnlyList<CompanySummaryDto> Companies,
    ActiveScenarioDto? Scenario, long Revision,                                                       // EXISTS
    string GameId, DateDto StartDate, int ElapsedMonths, PlayerHudDto Player, OutcomeDto Outcome,     // NEW
    AlertsDto Alerts, long NewsSeq, long FeedSeq, string? Autopilot, bool Faulted);
public sealed record CompanySummaryDto(int Id, string Name, bool IsPlayer, decimal Cash, decimal TotalAssets, decimal Equity,
    decimal RevenueThisMonth, decimal NetIncomeThisMonth, int BuildingCount, string Color,             // EXISTS
    decimal CorporateValue, decimal NetIncomeLast12, int ColorIndex, string? AiStrategy);               // NEW
public sealed record ActiveScenarioDto(string Id, string Name, DateDto? EndDate, IReadOnlyList<GoalDto> Goals,  // EXISTS (Goals: see §5.11)
    int? MonthsRemaining, int GoalsAchieved, string? NextGoalId);                                      // NEW
public sealed record PlayerHudDto(int CompanyId, string Name, decimal Cash, decimal CashFlowThisMonth,
    decimal RevenueThisMonth, decimal NetIncomeThisMonth, decimal NetIncomeLast12, decimal TotalAssets,
    decimal Equity, decimal CorporateValue, int Buildings, int IdleBuildings, int ActiveCampaigns,
    double? CashRunwayMonths);
public sealed record OutcomeDto(string Status, string? Reason = null, DateDto? At = null);   // playing|won|lost ; allGoals|bankruptcy|deadline
public sealed record AlertsDto(bool LowCash, int NegativeCashMonths, int? BankruptcyInMonths, int BankruptcyGraceMonths);
```

```ts
export interface SnapshotDto {
  date: DateDto; monthIndex: number; playerId: number; companies: CompanySummaryDto[]; scenario?: ActiveScenarioDto; revision: number;
  gameId: string; startDate: DateDto; elapsedMonths: number; player: PlayerHudDto; outcome: OutcomeDto; alerts: AlertsDto;
  newsSeq: number; feedSeq: number; autopilot?: AiStrategyName; faulted: boolean;
}
export interface CompanySummaryDto { id: number; name: string; isPlayer: boolean; cash: number; totalAssets: number; equity: number;
  revenueThisMonth: number; netIncomeThisMonth: number; buildingCount: number; color: string;
  corporateValue: number; netIncomeLast12: number; colorIndex: number; aiStrategy?: AiStrategyName }
export interface ActiveScenarioDto { id: string; name: string; endDate?: DateDto; goals: GoalDto[];
  monthsRemaining?: number; goalsAchieved: number; nextGoalId?: string }
export interface PlayerHudDto { companyId: number; name: string; cash: number; cashFlowThisMonth: number; revenueThisMonth: number;
  netIncomeThisMonth: number; netIncomeLast12: number; totalAssets: number; equity: number; corporateValue: number;
  buildings: number; idleBuildings: number; activeCampaigns: number; cashRunwayMonths?: number }
export interface OutcomeDto { status: 'playing' | 'won' | 'lost'; reason?: 'allGoals' | 'bankruptcy' | 'deadline'; at?: DateDto }
export interface AlertsDto { lowCash: boolean; negativeCashMonths: number; bankruptcyInMonths?: number; bankruptcyGraceMonths: number }
```

**Size budget:** the UX report asks for ≤ 2 KB. With 5 companies and 6 goals the HUD is about 2 KB once goal text is dropped. For one release the HUD's `GoalDto` still carries the skeleton's `description` / `detail` strings (deprecated; TopBar doesn't use them), so it is about 2.5–3 KB. After that the facade omits them in HUD goals (both become `string?`, and nulls are omitted), and clients join descriptions from `listScenarios[].goalDetails` on `id`. The `goals` method always returns the full text.

**Colours:**
- `color` is the skeleton's palette by `(id − 1) % 8` (GameSession.Game.cs:244-247).
- `colorIndex` is the same index, so the Three.js scene can use its own material palette.

**`buildingCount`** stays "this company's buildings". The HUD bug in Main.cs:645-646 was the client summing `world.Buildings`.

#### `companies`, `settings`, `updateSettings`, `setAutopilot` (NEW)

```csharp
public sealed record SettingsDto(decimal LowCashThreshold, int AutosaveEveryMonths, int BankruptcyGraceMonths, int FeedCapacity);
public sealed record UpdateSettingsArgs(decimal? LowCashThreshold = null, int? AutosaveEveryMonths = null);
public sealed record AutopilotArgs(string? Strategy);
```

```ts
export interface SettingsDto { lowCashThreshold: number; autosaveEveryMonths: number; bankruptcyGraceMonths: number; feedCapacity: number }
export interface UpdateSettingsArgs { lowCashThreshold?: number; autosaveEveryMonths?: number }
export interface AutopilotArgs { strategy: AiStrategyName | null }
```

**Defaults:**

| Setting | Default | Source / notes |
|---|---|---|
| `lowCashThreshold` | 1,000,000 | Main.cs:840 |
| `autosaveEveryMonths` | 12 | GameState.cs:103. `0` disables. |
| `bankruptcyGraceMonths` | 6 | Main.cs:910. Scenario-owned and read-only; exposed for the UI countdown. |
| `feedCapacity` | 2,000 | |

**`setAutopilot`:**
- `setAutopilot {strategy}` calls `World.RegisterAi(player, AiStrategies.Create(strategy))`.
- `{strategy: null}` needs `World.UnregisterAi` (E2). Until then it returns `invalid_operation {reason:'unregisterAiMissing'}`.
- **Better:** implement E2 before the web client ships the spectator toggle.

### 5.4 Time: `advance` (CHANGE)

```csharp
public sealed record AdvanceArgs(int Months = 1,                                           // EXISTS (clamped 1..24)
    IReadOnlyList<string>? StopOn = null,                                                  // NEW: event kinds that end the batch early
    string? ViewCityId = null, long? ViewSince = null);                                    // NEW: include cityView delta for this city
public sealed record TickResultDto(int Months, IReadOnlyList<GameEventDto> Events, SnapshotDto Snapshot,   // EXISTS
    IReadOnlyList<MonthCloseDto> MonthSummaries,                                           // NEW: one per month advanced
    IReadOnlyList<BuildingActivityDto> PlayerActivity,                                     // NEW: last closed month, player buildings with activity
    CityViewDto? CityView = null,                                                          // NEW: when ViewCityId set
    string? StoppedBy = null, bool AutosaveDue = false, double EngineMs = 0, double BridgeMs = 0);
public sealed record MonthCloseDto(DateDto Month, decimal Revenue, decimal Cogs, decimal Opex, decimal NetIncome,
    decimal CashStart, decimal CashEnd, double UnitsSold, double ExportUnits);
public sealed record BuildingActivityDto(int BuildingId, string CityId, decimal Revenue, double UnitsSold,
    double ExportUnits, decimal NetIncome);
```

```ts
export interface AdvanceArgs { months: number; stopOn?: GameEventKind[]; viewCityId?: string; viewSince?: number }
export interface TickResultDto { months: number; events: GameEventDto[]; snapshot: SnapshotDto;
  monthSummaries: MonthCloseDto[]; playerActivity: BuildingActivityDto[]; cityView?: CityViewDto;
  stoppedBy?: GameEventKind; autosaveDue: boolean; engineMs: number; bridgeMs: number }
export interface MonthCloseDto { month: DateDto; revenue: number; cogs: number; opex: number; netIncome: number;
  cashStart: number; cashEnd: number; unitsSold: number; exportUnits: number }
export interface BuildingActivityDto { buildingId: number; cityId: string; revenue: number; unitsSold: number; exportUnits: number; netIncome: number }
```

**Per month the handler runs:**
1. `EventDetector.Capture(world)` (pre-state, §7.2).
2. `world.AdvanceMonth()` inside try/catch (`tick_failed`, §4.3).
3. `_index.CatchUp`.
4. `_history.Append`.
5. `_goals.Refresh` + outcome.
6. `EventDetector.Diff`, which appends events.
7. If an event kind is in `stopOn`, set `stoppedBy` and break.

**After the loop:**
- Build the snapshot.
- Compute `playerActivity` for the last month.
- Compute the city delta when requested.
- `autosaveDue = autosaveEveryMonths > 0 && monthsSinceAutosave ≥ autosaveEveryMonths`. The counter resets when the worker calls `SaveBinary` with `slotKind:'autosave'`.

**Notes:**
- Skip-to-event (UX §6.4) is `advance {months: 12, stopOn: ['goalAchieved','scenarioWon','scenarioLost','cashNegative','rivalEnteredMarket','news']}`.
- `playerActivity` feeds the world-anchored "+$X" popups. Top N by |NI| is a client choice.
- Revision bumps once per `advance`, however many months it covers.

### 5.5 City, buildings and building commands

#### `cityView` (NEW): renderer state for one city

```csharp
public sealed record CityViewArgs(string CityId, long? Since = null);
public sealed record CityViewDto(string CityId, long Revision, bool Full,
    IReadOnlyList<BuildingVisualDto> Buildings,      // Full: every building in the city; delta: upserts only
    IReadOnlyList<int> RemovedIds,                    // delta only (EXT demolish/sell)
    CityActivityDto Activity,                         // always full (columnar, aligned to Activity.Ids)
    CityLayoutRefDto? Layout = null);                 // EXT §8.1
public sealed record BuildingVisualDto(int Id, string TypeId, string Category, string SlotKind, int OwnerId, bool IsPlayer,
    string Color, int Level, int FootprintW, int FootprintH, PlacementDto Placement, string Status,
    IReadOnlyList<string> Products, int VisualRev,
    ConstructionDto? Construction = null);            // EXT §8.3
public sealed record CityActivityDto(DateDto Month, IReadOnlyList<int> Ids, IReadOnlyList<decimal> Revenue,
    IReadOnlyList<double> UnitsSold, IReadOnlyList<double> ExportUnits, IReadOnlyList<decimal> NetIncome,
    IReadOnlyList<double?> Utilization, IReadOnlyList<double> TransfersIn, IReadOnlyList<double> TransfersOut);
```

```ts
export interface CityViewArgs { cityId: string; since?: number }
export interface CityViewDto { cityId: string; revision: number; full: boolean; buildings: BuildingVisualDto[];
  removedIds: number[]; activity: CityActivityDto; layout?: CityLayoutRefDto }
export type BuildingStatus = 'operating' | 'idle' | 'passive' | 'starved' | 'soldOut' | 'underConstruction';
export interface BuildingVisualDto { id: number; typeId: string; category: string; slotKind: SlotKind; ownerId: number;
  isPlayer: boolean; color: string; level: number; footprintW: number; footprintH: number; placement: PlacementDto;
  status: BuildingStatus; products: string[]; visualRev: number; construction?: ConstructionDto }
export interface CityActivityDto { month: DateDto; ids: number[]; revenue: number[]; unitsSold: number[]; exportUnits: number[];
  netIncome: number[]; utilization: (number | null)[]; transfersIn: number[]; transfersOut: number[] }
```

**Fields:**

| Field | Rule |
|---|---|
| `status` | `idle` = 0 configured slots and kind ≠ none. `passive` = kind `none` (media). `operating` otherwise. `starved` / `soldOut` only when `features.productionLog` (E10). `underConstruction` only with `features.constructionTime`. |
| `products` | Distinct slot products in slot-index order (signage and billboards). |
| `visualRev` | 32-bit FNV-1a over `(typeId, ownerId, level, placement, status, products, construction?.progress bucket)`. The renderer rebuilds a mesh only when it changes. |
| `utilization` | Production buildings only, v1 approximation: output_m = exportUnits_m + transfersOut_m + (onHand_m − onHand_{m−1}) of the produced product, divided by Σ slots (OutputQuantity × 200). The facade keeps last month's on-hand per (building, product). Exact with E10. `null` for non-producers. |

**Delta protocol:**
- The facade keeps `(revision, visualRev by id)` for the last `cityView` served per city.
- If `since` equals that revision, it returns `full:false` with the upserts whose `visualRev` changed, plus `removedIds`.
- Otherwise it returns `full:true`.
- `activity` is always full: about 20 B per building, and it changes every month anyway.

**Size:** about 250–350 B per building when full. That is about 30 KB for 100 buildings (measured 37.8 KB for 111 buildings *with* full slot and inventory detail).

#### `worldMap` (NEW)

```csharp
public sealed record WorldMapDto(IReadOnlyList<CityOverviewDto> Cities);
public sealed record CityOverviewDto(string CityId, string Name, long Population, IReadOnlyDictionary<string, double> Demographics,
    GeographyDto Geography, int GridW, int GridH, decimal BaseLandPrice, IReadOnlyList<OwnerCountDto> BuildingsByOwner,
    int PlayerBuildings, int TotalBuildings, double PlayerAvgShare, IReadOnlyList<ProductQtyDto> TopDemand);
public sealed record GeographyDto(bool Coastal, bool Arable, bool MineralRich, bool OilRich);
public sealed record OwnerCountDto(int CompanyId, int Count);
```

```ts
export interface WorldMapDto { cities: CityOverviewDto[] }
export interface CityOverviewDto { cityId: string; name: string; population: number; demographics: Record<Bracket, number>;
  geography: { coastal: boolean; arable: boolean; mineralRich: boolean; oilRich: boolean }; gridW: number; gridH: number;
  baseLandPrice: number; buildingsByOwner: { companyId: number; count: number }[]; playerBuildings: number; totalBuildings: number;
  playerAvgShare: number; topDemand: ProductQtyDto[] }
```

`playerAvgShare` is the mean realised unit share (§5.9) over finished products retailed in the city (CityMap.cs:457-480 used the model share). `topDemand` is the top 8 by potential demand.

#### `buildings` (CHANGE): list for Manage-style tables

```csharp
public sealed record BuildingsArgs(string? CityId = null, int? OwnerId = null, string? Sort = null);   // EXISTS + NEW
public sealed record BuildingSummaryDto(int Id, string TypeId, string Category, int OwnerId, string CityId, int Level,
    int ConfiguredSlots, int Capacity,                                                                    // EXISTS
    string Name, string SlotKind, string Status, IReadOnlyList<string> Products, decimal MonthlyOpex,     // NEW
    decimal CashFlowThisMonth, decimal NetIncomeThisMonth, IReadOnlyList<ProductQtyDto> TopStock, PlacementDto Placement);
```

```ts
export interface BuildingsArgs { cityId?: string; ownerId?: number; sort?: 'id' | 'city' | 'category' | 'cashflow' | 'netIncome' }
export interface BuildingSummaryDto { id: number; typeId: string; category: string; ownerId: number; cityId: string; level: number;
  configuredSlots: number; capacity: number; name: string; slotKind: SlotKind; status: BuildingStatus; products: string[];
  monthlyOpex: number; cashFlowThisMonth: number; netIncomeThisMonth: number; topStock: ProductQtyDto[]; placement: PlacementDto }
```

- `capacity` = `GetCapacity`, which is level-aware. That fixes defect #18.
- `monthlyOpex` = `GetMonthlyOpex` (#17).
- `cashFlowThisMonth` = Σ ledger with `Building == id` in the current month (Manage.cs:659-667, now from the index).
- `topStock` = the three largest quantities on hand.

#### `building` (NEW): inspector detail

```csharp
public sealed record BuildingRefArgs(int BuildingId);
public sealed record BuildingDetailDto(int Id, string TypeId, string TypeName, string Category, string SlotKind,
    int OwnerId, string OwnerName, bool IsPlayer, string CityId, string CityName, int Level, int MaxLevel, int Capacity,
    int SlotsUsed, int NextFreeSlotIndex, decimal MonthlyOpex, decimal ConstructionCost, decimal BookValue, DateDto? OpenedAt,
    bool AutoExport, bool AutoExportApplies, UpgradeOptionDto? Upgrade, WorkforceDto? Workforce,
    IReadOnlyList<SlotDetailDto> Slots, IReadOnlyList<InventoryRowDto> Inventory, InventoryTotalsDto InventoryTotals,
    BuildingPnlDto Pnl, SupplyDto Supply, BuildingActionsDto Actions, PlacementDto Placement,
    ConstructionDto? Construction = null);                                                        // EXT
public sealed record UpgradeOptionDto(int ToLevel, decimal Cost, int Capacity, decimal MonthlyOpex, bool Affordable);
public sealed record WorkforceDto(int PerSlotMin, int PerSlotMax, int EstimatedMin, int EstimatedMax);
public sealed record SlotDetailDto(int Index, string Kind, string ProductId, string ProductName, string Tier,
    RetailSlotDto? Retail = null, WarehouseSlotDto? Warehouse = null, ProductionSlotDto? Production = null,
    ExtractionSlotDto? Extraction = null, ResearchSlotDto? Research = null, string? ReplacedProductId = null);
public sealed record RetailSlotDto(decimal Price, double RestockTarget, double OnHand, decimal UnitCost, decimal EffectiveWorldPrice,
    double LastMonthUnits, decimal LastMonthRevenue, decimal? LastMonthAvgPrice, decimal? CheapestRivalPrice, int RivalCount,
    double ModelDemandUnits, bool BelowCost,
    double? LastMonthDemand = null, double? LastMonthLostUnits = null);        // E10
public sealed record WarehouseSlotDto(double TargetStock, double OnHand, decimal UnitCost);
public sealed record ProductionSlotDto(int CyclesPerMonth, double OutputPerMonth, IReadOnlyList<InputSupplyDto> Inputs,
    double? LastMonthOutput, double? Utilization, decimal? UnitCost, decimal EffectiveWorldPrice, bool ExportsAtLoss);
public sealed record InputSupplyDto(string ProductId, double PerMonth, double OnHand, string Source,
    int? SourceBuildingId, string? SourceCityId, decimal EffectiveWorldPrice);   // source: own | ownOtherCity | worldMarket
public sealed record ExtractionSlotDto(double YieldPerMonth, double OnHand, double Quality);
public sealed record ResearchSlotDto(int Tech, int MaxTech, double Progress, double Threshold, double CompanyPointsPerMonth,
    int? EtaMonths, bool Blocked, int? PatentHolderId);
public sealed record InventoryRowDto(string ProductId, string Name, string Tier, double Quantity, decimal Cost, decimal UnitCost, double Quality);
public sealed record InventoryTotalsDto(TierTotalDto Raw, TierTotalDto Intermediate, TierTotalDto Finished);
public sealed record TierTotalDto(double Units, decimal Cost);
public sealed record BuildingPnlDto(PnlWindowDto ThisMonth, PnlWindowDto Last12, PnlWindowDto SinceOpen, SeriesDto MonthlyNetIncome);
public sealed record PnlWindowDto(DateDto From, DateDto To, decimal Revenue, decimal Cogs, decimal GrossProfit, decimal Opex, decimal NetIncome);
public sealed record SupplyDto(IReadOnlyList<SupplyLinkDto> Sources, IReadOnlyList<SupplyLinkDto> Destinations);
public sealed record SupplyLinkDto(string Kind, string ProductId, double? Quantity, decimal? Amount,
    int? CounterpartyBuildingId, string? CounterpartyCityId);     // kind: transfer|marketPurchase|export|retailSale
public sealed record BuildingActionsDto(bool CanUpgrade, bool CanAddSlot, bool CanConfigure, bool CanToggleAutoExport,
    bool CanDemolish, IReadOnlyList<string> EligibleProductIds);
```

```ts
export interface BuildingDetailDto { id: number; typeId: string; typeName: string; category: string; slotKind: SlotKind;
  ownerId: number; ownerName: string; isPlayer: boolean; cityId: string; cityName: string; level: number; maxLevel: number;
  capacity: number; slotsUsed: number; nextFreeSlotIndex: number; monthlyOpex: number; constructionCost: number; bookValue: number;
  openedAt?: DateDto; autoExport: boolean; autoExportApplies: boolean; upgrade?: UpgradeOptionDto; workforce?: WorkforceDto;
  slots: SlotDetailDto[]; inventory: InventoryRowDto[]; inventoryTotals: InventoryTotalsDto; pnl: BuildingPnlDto;
  supply: SupplyDto; actions: BuildingActionsDto; placement: PlacementDto; construction?: ConstructionDto }
export interface UpgradeOptionDto { toLevel: number; cost: number; capacity: number; monthlyOpex: number; affordable: boolean }
export interface WorkforceDto { perSlotMin: number; perSlotMax: number; estimatedMin: number; estimatedMax: number }
export interface SlotDetailDto { index: number; kind: SlotKind; productId: string; productName: string; tier: ProductTier;
  retail?: RetailSlotDto; warehouse?: WarehouseSlotDto; production?: ProductionSlotDto; extraction?: ExtractionSlotDto;
  research?: ResearchSlotDto; replacedProductId?: string }
export interface RetailSlotDto { price: number; restockTarget: number; onHand: number; unitCost: number; effectiveWorldPrice: number;
  lastMonthUnits: number; lastMonthRevenue: number; lastMonthAvgPrice?: number; cheapestRivalPrice?: number; rivalCount: number;
  modelDemandUnits: number; belowCost: boolean; lastMonthDemand?: number; lastMonthLostUnits?: number }
export interface WarehouseSlotDto { targetStock: number; onHand: number; unitCost: number }
export interface ProductionSlotDto { cyclesPerMonth: number; outputPerMonth: number; inputs: InputSupplyDto[];
  lastMonthOutput?: number; utilization?: number; unitCost?: number; effectiveWorldPrice: number; exportsAtLoss: boolean }
export interface InputSupplyDto { productId: string; perMonth: number; onHand: number; source: 'own' | 'ownOtherCity' | 'worldMarket';
  sourceBuildingId?: number; sourceCityId?: string; effectiveWorldPrice: number }
export interface ExtractionSlotDto { yieldPerMonth: number; onHand: number; quality: number }
export interface ResearchSlotDto { tech: number; maxTech: number; progress: number; threshold: number; companyPointsPerMonth: number;
  etaMonths?: number; blocked: boolean; patentHolderId?: number }
export interface InventoryRowDto { productId: string; name: string; tier: ProductTier; quantity: number; cost: number; unitCost: number; quality: number }
export interface InventoryTotalsDto { raw: TierTotal; intermediate: TierTotal; finished: TierTotal }
export interface TierTotal { units: number; cost: number }
export interface BuildingPnlDto { thisMonth: PnlWindowDto; last12: PnlWindowDto; sinceOpen: PnlWindowDto; monthlyNetIncome: SeriesDto }
export interface PnlWindowDto { from: DateDto; to: DateDto; revenue: number; cogs: number; grossProfit: number; opex: number; netIncome: number }
export interface SupplyDto { sources: SupplyLinkDto[]; destinations: SupplyLinkDto[] }
export interface SupplyLinkDto { kind: 'transfer' | 'marketPurchase' | 'export' | 'retailSale'; productId: string; quantity?: number;
  amount?: number; counterpartyBuildingId?: number; counterpartyCityId?: string }
export interface BuildingActionsDto { canUpgrade: boolean; canAddSlot: boolean; canConfigure: boolean; canToggleAutoExport: boolean;
  canDemolish: boolean; eligibleProductIds: string[] }
```

**Formulas:**

| Field | Formula |
|---|---|
| `cyclesPerMonth` | 200 |
| `outputPerMonth` | `Recipe.OutputQuantity × 200` |
| `inputs[].perMonth` | `input.Quantity × 200` |
| `inputs[].source` | Predicted with the engine's own order (MaterialProcurement.cs:41-47): the first own building with that product configured as production, extraction or warehouse; same city first, then `City` ordinal, then id. Otherwise `worldMarket`. This fixes defect #24. |
| `unitCost` | `Inventory.CostOf / Get` (0 if empty) |
| `belowCost` | `price < unitCost` (the UX "below-cost price" warning) |
| `exportsAtLoss` | `autoExport && effectiveWorldPrice < unitCost of on-hand output` |
| `lastMonthUnits` / `lastMonthRevenue` | From the index: COGS quantity with `SourceBuilding = id` and product; ledger `ProductSale` for (building, product). Kills "(last-month units sold needs engine support)", BuildingInspector.cs:771. |
| `modelDemandUnits` | The MarketModel forecast for this slot next month (§5.9), uncapped by stock. |
| `research.etaMonths` | `ceil((threshold − progress) / companyPointsPerMonth)`, where `threshold = 100 × tech` and `companyPointsPerMonth = 100 × (all the company's unblocked research slots on this product)`. `null` if blocked, at max tech, or zero points. |
| `pnl` | Per-building accrual from the index: revenue = ProductSale + ExportSale; COGS = CogsEntry with `SourceBuilding`; opex = OperatingCost. Advertising is excluded because it is company-scoped (BuildingInspector.cs:217-221). `sinceOpen.from = openedAt ?? start`. |
| `monthlyNetIncome` | Last 12 months, dense |
| `supply` | Last closed month: TransferLog (in/out), ledger `InputPurchase`/`RetailRestock` with `Building == id` (amount; quantity only with E11), ledger `ExportSale`, and retail sales |
| `workforce` | `TargetHeadcount × slotsUsed` (estimate, as today) |
| `canAddSlot` | `nextFreeSlotIndex ≥ 0 && slotKind != none && isPlayer` |

#### `previewBuild` (NEW)

The UX name `previewBuild` is adopted. The Godot client called it "cost preview".

```csharp
public sealed record PreviewBuildArgs(string TypeId, string CityId, PlotRefDto? At = null);
public sealed record BuildPreviewDto(string TypeId, string CityId, decimal ConstructionCost, decimal? LandCost, decimal TotalCost,
    decimal MonthlyOpex, int Capacity, bool Affordable, decimal Shortfall, decimal CashAfter, double? RunwayMonthsAfter,
    bool GeographyOk, IReadOnlyList<string> GeographyIssues, IReadOnlyList<string> EligibleProductIds,
    int FootprintW, int FootprintH, bool PlacementOk, string? PlacementIssue, PlacementDto? SuggestedPlacement,
    int? ConstructionMonths = null,                    // EXT §8.3
    CatchmentDto? Catchment = null);                   // EXT §8.1 (traffic / demand near plot)
public sealed record CatchmentDto(double Score, double PotentialUnitsPerMonth, int RivalsWithinRadius);
```

```ts
export interface PreviewBuildArgs { typeId: string; cityId: string; at?: PlotRefDto }
export interface BuildPreviewDto { typeId: string; cityId: string; constructionCost: number; landCost?: number; totalCost: number;
  monthlyOpex: number; capacity: number; affordable: boolean; shortfall: number; cashAfter: number; runwayMonthsAfter?: number;
  geographyOk: boolean; geographyIssues: ('coastal' | 'arable' | 'mineralRich' | 'oilRich')[]; eligibleProductIds: string[];
  footprintW: number; footprintH: number; placementOk: boolean; placementIssue?: 'outOfBounds' | 'occupied' | 'road' | 'zoning';
  suggestedPlacement?: PlacementDto; constructionMonths?: number; catchment?: CatchmentDto }
export interface CatchmentDto { score: number; potentialUnitsPerMonth: number; rivalsWithinRadius: number }
```

- This is a pure query, cheap enough to call at 10 Hz while a ghost follows the cursor (UX §6.6). The client throttles to ≤ 1 call per 100 ms and caches by `(typeId, cityId, px, pz, rot, revision)`.
- `runwayMonthsAfter` = `cashAfter / −(opCF3 − monthlyOpex)` when negative.

#### `construct` (CHANGE) and `buildStarterPlan` (NEW)

```csharp
public sealed record ConstructArgs(string TypeId, string CityId,                           // EXISTS
    SlotConfigArgs? InitialSlot = null,                                                    // NEW
    PlotRefDto? At = null);                                                                // NEW (interim bridge placement; engine plots EXT)
public sealed record SlotConfigArgs(string ProductId, int? SlotIndex = null, decimal? Price = null,
    double? RestockTarget = null, double? TargetStock = null);
public sealed record StarterPlanArgs(string PlanId);
```

```ts
export interface ConstructArgs { typeId: string; cityId: string; initialSlot?: SlotConfigArgs; at?: PlotRefDto }
export interface SlotConfigArgs { productId: string; slotIndex?: number; price?: number; restockTarget?: number; targetStock?: number }
export interface StarterPlanArgs { planId: string }
```

**Atomic algorithm:**
1. Resolve the type and city (`not_found`).
2. Check geography (`geography_mismatch`).
3. Check placement (`plot_*`).
4. Validate `initialSlot` against the **type** (§4.6.4) without a building: slot index defaults to 0 and must be `< MaxUnits` at level 1.
5. Check affordability, `cost ≤ cash`, which gives `insufficient_funds {required, available, shortfall}`.
6. Call `World.Construct`.
7. Call `Configure*Slot`.
8. Record the placement.
9. Queue `buildingConstructed` (player).

- Steps 1–5 guarantee step 7 cannot throw on today's engine. If it still throws, the error is `internal`, and the building stays; no rollback until E16.
- Result: `BuildingSummaryDto`, plus `hud` and `events`.
- `buildStarterPlan` resolves the plan (city = largest population, ties broken by city id ordinal) and delegates to `construct`.

#### Slot and building commands (NEW)

```csharp
public sealed record ConfigureSlotArgs(int BuildingId, int SlotIndex, string ProductId, decimal? Price = null,
    double? RestockTarget = null, double? TargetStock = null);
public sealed record SlotRefArgs(int BuildingId, int SlotIndex);
public sealed record SetRetailPriceArgs(int BuildingId, int SlotIndex, decimal Price);
public sealed record SetRestockTargetArgs(int BuildingId, int SlotIndex, double RestockTarget);
public sealed record SetWarehouseTargetArgs(int BuildingId, int SlotIndex, double TargetStock);
public sealed record SetAutoExportArgs(int BuildingId, bool Enabled);
public sealed record UpgradeResultDto(int BuildingId, int Level, int Capacity, decimal MonthlyOpex, decimal Cost);
public sealed record DisposalResultDto(int BuildingId, decimal Proceeds, decimal BookValue, decimal GainOrLoss);  // EXT E16
```

```ts
export interface ConfigureSlotArgs { buildingId: number; slotIndex: number; productId: string; price?: number; restockTarget?: number; targetStock?: number }
export interface SlotRefArgs { buildingId: number; slotIndex: number }
export interface SetRetailPriceArgs { buildingId: number; slotIndex: number; price: number }
export interface SetRestockTargetArgs { buildingId: number; slotIndex: number; restockTarget: number }
export interface SetWarehouseTargetArgs { buildingId: number; slotIndex: number; targetStock: number }
export interface SetAutoExportArgs { buildingId: number; enabled: boolean }
export interface UpgradeResultDto { buildingId: number; level: number; capacity: number; monthlyOpex: number; cost: number }
export interface DisposalResultDto { buildingId: number; proceeds: number; bookValue: number; gainOrLoss: number }
```

| Command | Engine path today | Validation (§4.6.4) | Events |
|---|---|---|---|
| `configureSlot` | `Configure{kind}Slot` | full | `slotConfigured` (priority 0) |
| `clearSlot` | E3 `World.ClearSlot`; v1 fallback `building.<Kind>Slots.RemoveAll(s => s.Index == i)` on the public list | owner, index configured | `slotCleared` |
| `setRetailPrice` | E3; v1 fallback `slot.Price = round2(price)` | owner, retail slot at index, `0 < price ≤ 1e9` | `priceChanged {oldValue, newValue}` |
| `setRestockTarget` | E3; v1 fallback `slot.RestockTarget = x` | `0 < x ≤ 1e8` (the Godot spin box allowed 0) | none |
| `setWarehouseTarget` | E3; v1 fallback `slot.TargetStock = x` | `0 < x ≤ 1e8` | none |
| `setAutoExport` | E3; v1 fallback `b.AutoExport = enabled` | owner | none |
| `upgradeBuilding` | `World.UpgradeBuilding` | pre-checks: `not_upgradeable` (no ladder), `max_level`, `insufficient_funds` (next `UpgradeCost` vs cash) | `buildingUpgraded` |
| `demolishBuilding` / `sellBuilding` | EXT (E16) | owner, not under construction | `buildingDemolished` |

**Mid-month semantics:** every change takes effect at the next `advance`, which is how the engine works. The UX "pending until month close" badge is purely client-side.

#### `supplyFlows` (NEW): trucks, ships and arcs for the 3D view

```csharp
public sealed record SupplyFlowsArgs(string? CityId = null, int? BuildingId = null);
public sealed record SupplyFlowsDto(DateDto Month, IReadOnlyList<FlowDto> Flows);
public sealed record FlowDto(string Kind, string ProductId, int? FromBuildingId, int? ToBuildingId, string? FromCityId,
    string? ToCityId, double? Quantity, decimal? Amount);   // kind: transfer|import|export|retail
```

```ts
export interface SupplyFlowsArgs { cityId?: string; buildingId?: number }
export interface SupplyFlowsDto { month: DateDto; flows: FlowDto[] }
export interface FlowDto { kind: 'transfer' | 'import' | 'export' | 'retail'; productId: string; fromBuildingId?: number; toBuildingId?: number;
  fromCityId?: string; toCityId?: string; quantity?: number; amount?: number }
```

**Source data (last closed month):**

| Kind | Source |
|---|---|
| `transfer` | TransferLog; quantity exact |
| `import` | Ledger `InputPurchase`/`RetailRestock` per (building, product); amount exact, quantity with E11 |
| `export` | `ExportSale` amount + COGS quantity |
| `retail` | `ProductSale` amount + COGS quantity |

The whole city is filtered to flows whose endpoints are in `cityId`. Inter-city flows are included with `fromCityId ≠ toCityId`.

### 5.6 Marketing

```csharp
public sealed record AdCampaignArgs(string ProductId, string CityId, string Channel, decimal MonthlyBudget);
public sealed record AdKeyArgs(string ProductId, string CityId, string Channel);
public sealed record AdCampaignDto(string ProductId, string CityId, string Channel, decimal MonthlyBudget, double Brand,
    decimal MediaBonus, double ProjectedBrand, bool HasRetailPresence);
public sealed record AdCampaignsDto(IReadOnlyList<AdCampaignDto> Campaigns, decimal TotalMonthlySpend, double BrandDecayRate);
public sealed record AdPreviewDto(double CurrentBrand, double ProjectedBrand, double Lift, decimal CostPerPoint, decimal MediaBonus,
    decimal EffectiveBudget, double Saturation, decimal ExistingBudget, bool HasRetailPresence);
public sealed record CancelResultDto(bool Cancelled);
```

```ts
export interface AdCampaignArgs { productId: string; cityId: string; channel: AdChannelId; monthlyBudget: number }
export interface AdKeyArgs { productId: string; cityId: string; channel: AdChannelId }
export interface AdCampaignDto { productId: string; cityId: string; channel: AdChannelId; monthlyBudget: number; brand: number;
  mediaBonus: number; projectedBrand: number; hasRetailPresence: boolean }
export interface AdCampaignsDto { campaigns: AdCampaignDto[]; totalMonthlySpend: number; brandDecayRate: number }
export interface AdPreviewDto { currentBrand: number; projectedBrand: number; lift: number; costPerPoint: number; mediaBonus: number;
  effectiveBudget: number; saturation: number; existingBudget: number; hasRetailPresence: boolean }
export interface CancelResultDto { cancelled: boolean }
```

**Preview formula.** This is exactly World.cs:426-434:
- `effective = budget × mediaBonus`
- `points = effective / costPerPoint`
- `saturation = max(0, 1 − brand/100)`
- `lift = points × saturation`
- `projected = min(100, brand + lift)`

When budget = 0, `projected = brand × (1 − 0.02)`.

**Rules:**
- `setAdCampaign` validates `0 ≤ budget ≤ 100,000,000` and rounds to 2 dp.
- `0` cancels (World.cs:379-383).
- The events are `campaignStarted` (new, budget > 0), `campaignChanged` and `campaignCancelled`.
- `hasRetailPresence` is false when the player sells the product nowhere in that city. The UX report flags "ads without a store" as a trap; the advisor hint is `adsWithoutStore`.
- The channel is validated against `tv | newspaper | magazine | radio` with case-insensitive `Enum.TryParse`.

### 5.7 Research and patents

```csharp
public sealed record ResearchTreeDto(IReadOnlyList<ResearchNodeDto> Nodes, double PointsPerSlotPerMonth, double BaseThreshold);
public sealed record ResearchNodeDto(string ProductId, string Name, string Tier, int Tech, int MaxTech, double Progress,
    double Threshold, int ResearchingSlots, double PointsPerMonth, int? EtaMonths, int? EtaToMaxMonths, bool Blocked,
    PatentRefDto? Patent, RivalTechDto? BestRival, IReadOnlyList<string> Inputs, IReadOnlyList<string> FeedsInto,
    bool AffectsRetailDemand);
public sealed record PatentRefDto(int HolderId, bool Mine, DateDto ExpiresAt, int MonthsRemaining, bool LicensedToMe);
public sealed record RivalTechDto(int CompanyId, string Name, int Tech);
public sealed record PatentsDto(IReadOnlyList<MyPatentDto> Mine, IReadOnlyList<RivalPatentDto> Rivals, decimal RoyaltyRate, int DurationMonths);
public sealed record MyPatentDto(string ProductId, DateDto ExpiresAt, int MonthsRemaining, IReadOnlyList<CompanyRefDto> Licensees,
    IReadOnlyList<CompanyRefDto> Candidates, decimal RoyaltiesLast12);
public sealed record RivalPatentDto(int HolderId, string HolderName, string ProductId, DateDto ExpiresAt, int MonthsRemaining,
    bool LicensedToMe, bool BlocksMyResearch);
public sealed record LicenseArgs(int LicenseeId, string ProductId);
```

```ts
export interface ResearchTreeDto { nodes: ResearchNodeDto[]; pointsPerSlotPerMonth: number; baseThreshold: number }
export interface ResearchNodeDto { productId: string; name: string; tier: ProductTier; tech: number; maxTech: number; progress: number;
  threshold: number; researchingSlots: number; pointsPerMonth: number; etaMonths?: number; etaToMaxMonths?: number; blocked: boolean;
  patent?: PatentRefDto; bestRival?: RivalTechDto; inputs: string[]; feedsInto: string[]; affectsRetailDemand: boolean }
export interface PatentRefDto { holderId: number; mine: boolean; expiresAt: DateDto; monthsRemaining: number; licensedToMe: boolean }
export interface RivalTechDto { companyId: number; name: string; tech: number }
export interface PatentsDto { mine: MyPatentDto[]; rivals: RivalPatentDto[]; royaltyRate: number; durationMonths: number }
export interface MyPatentDto { productId: string; expiresAt: DateDto; monthsRemaining: number; licensees: CompanyRefDto[];
  candidates: CompanyRefDto[]; royaltiesLast12: number }
export interface RivalPatentDto { holderId: number; holderName: string; productId: string; expiresAt: DateDto; monthsRemaining: number;
  licensedToMe: boolean; blocksMyResearch: boolean }
export interface LicenseArgs { licenseeId: number; productId: string }
```

**Formulas** (research threshold L→L+1 = `100 × L`, World.cs:528):

| Field | Formula |
|---|---|
| `pointsPerMonth` | `100 × researchingSlots`, or 0 if `Blocked` |
| `etaMonths` | `ceil((threshold − progress) / pointsPerMonth)` |
| `etaToMaxMonths` | `ceil((Σ_{L=tech}^{max−1} 100·L − progress) / pointsPerMonth)` |
| `monthsRemaining` | `ExpiresAt.AsMonthIndex() − now.AsMonthIndex()`. A patent is active while `now < ExpiresAt`. |
| `candidates` | Companies ≠ holder and not already licensed (Manage.cs:1130-1134) |
| `royaltiesLast12` | Σ `PatentRoyaltyIncome` for the product over the last 12 months |

- The license commands use the player as holder: `GrantPatentLicense(player, licensee, product)`.
- Pre-checks: the licensee exists (`not_found`), ≠ player (`patent_self_license`), the player holds an active patent on the product (`not_patent_holder` / `patent_not_active`).
- `revokeLicense` is idempotent, as in the engine.
- Both return the refreshed `PatentsDto`, plus the events `licenseGranted` / `licenseRevoked`.

### 5.8 Finance reports

```csharp
public sealed record CompanyPeriodArgs(PeriodArgs? Period = null, int? CompanyId = null, bool ByMonth = false);
public sealed record IncomeStatementDto(PeriodDto Period, int CompanyId, decimal Revenue, decimal ProductSales,
    decimal ExportSales, decimal RoyaltyIncome, decimal Cogs, decimal GrossProfit, decimal Opex, decimal OperatingCosts,
    decimal Advertising, decimal RoyaltyExpense, decimal NetIncome, double? GrossMargin, double? NetMargin,
    IReadOnlyList<IncomeMonthDto>? Months = null,
    decimal? Depreciation = null, decimal? InterestExpense = null, decimal? IncomeTax = null, decimal? OtherIncome = null); // EXT finance
public sealed record IncomeMonthDto(DateDto Month, decimal Revenue, decimal Cogs, decimal Opex, decimal NetIncome);
public sealed record BalanceSheetArgs(int? CompanyId = null, bool Drilldown = false);
public sealed record BalanceSheetDto(DateDto AsOf, int CompanyId, decimal Cash, decimal InventoryValue, decimal BuildingValue,
    decimal TotalAssets, decimal Liabilities, decimal Equity, decimal StartingCapital, decimal RetainedEarnings,
    decimal EngineBuildingValue, decimal Drift, bool BooksClose,
    IReadOnlyList<BuildingValueDto>? Buildings = null, IReadOnlyList<BuildingInventoryDto>? InventoryByBuilding = null,
    IReadOnlyList<LiabilityLineDto>? LiabilityLines = null, decimal? LandValue = null, decimal? AccumulatedDepreciation = null); // EXT
public sealed record BuildingValueDto(int BuildingId, string TypeName, string CityId, decimal ConstructionCost, decimal UpgradeCost, decimal BookValue);
public sealed record BuildingInventoryDto(int BuildingId, string TypeName, string CityId, IReadOnlyList<InventoryRowDto> Rows, decimal Total);
public sealed record LiabilityLineDto(string Kind, string Label, decimal Amount);                  // EXT: loan|bond|payable|tax
public sealed record CashFlowDto(PeriodDto Period, int CompanyId, decimal BeginningCash, CashFlowSectionDto Operating,
    CashFlowSectionDto Investing, CashFlowSectionDto Financing, decimal NetChange, decimal EndingCash, bool Reconciles);
public sealed record CashFlowSectionDto(IReadOnlyList<CashFlowLineDto> Lines, decimal Net);
public sealed record CashFlowLineDto(string Category, decimal Amount);
public sealed record ProductProfitabilityDto(PeriodDto Period, IReadOnlyList<ProductPnlRowDto> Rows);
public sealed record ProductPnlRowDto(string ProductId, string Name, decimal Revenue, decimal Cogs, decimal GrossMargin,
    decimal Marketing, decimal NetMargin, double? NetMarginPct, double UnitsSold);
public sealed record ExportsDto(PeriodDto Period, decimal TotalRevenue, double TotalUnits, IReadOnlyList<ExportProductRowDto> ByProduct,
    IReadOnlyList<ExportBuildingRowDto> ByBuilding);
public sealed record ExportProductRowDto(string ProductId, decimal Revenue, double Units, decimal? AvgPrice);
public sealed record ExportBuildingRowDto(int BuildingId, string TypeId, string CityId, decimal Revenue, double Units);
public sealed record LedgerArgs(PeriodArgs? Period = null, IReadOnlyList<string>? Categories = null, int? BuildingId = null,
    string? ProductId = null, int Offset = 0, int Limit = 200);
public sealed record LedgerPageDto(int Total, int Offset, IReadOnlyList<LedgerRowDto> Rows);
public sealed record LedgerRowDto(long Seq, DateDto Date, string Category, decimal Amount, string? Memo, string? ProductId, int? BuildingId);
public sealed record ExplainArgs(PeriodArgs? Base = null, PeriodArgs? Compare = null);   // default: lastMonth vs thisMonth
public sealed record ExplainDto(PeriodDto Base, PeriodDto Compare, decimal BaseNetIncome, decimal CompareNetIncome,
    IReadOnlyList<VarianceLineDto> Drivers);
public sealed record VarianceLineDto(string Driver, string? ProductId, int? BuildingId, decimal Amount);
```

```ts
export interface CompanyPeriodArgs { period?: PeriodArgs; companyId?: number; byMonth?: boolean }
export interface IncomeStatementDto { period: PeriodDto; companyId: number; revenue: number; productSales: number; exportSales: number;
  royaltyIncome: number; cogs: number; grossProfit: number; opex: number; operatingCosts: number; advertising: number;
  royaltyExpense: number; netIncome: number; grossMargin?: number; netMargin?: number; months?: IncomeMonthDto[];
  depreciation?: number; interestExpense?: number; incomeTax?: number; otherIncome?: number }
export interface IncomeMonthDto { month: DateDto; revenue: number; cogs: number; opex: number; netIncome: number }
export interface BalanceSheetArgs { companyId?: number; drilldown?: boolean }
export interface BalanceSheetDto { asOf: DateDto; companyId: number; cash: number; inventoryValue: number; buildingValue: number;
  totalAssets: number; liabilities: number; equity: number; startingCapital: number; retainedEarnings: number;
  engineBuildingValue: number; drift: number; booksClose: boolean; buildings?: BuildingValueDto[];
  inventoryByBuilding?: BuildingInventoryDto[]; liabilityLines?: LiabilityLineDto[]; landValue?: number; accumulatedDepreciation?: number }
export interface BuildingValueDto { buildingId: number; typeName: string; cityId: string; constructionCost: number; upgradeCost: number; bookValue: number }
export interface BuildingInventoryDto { buildingId: number; typeName: string; cityId: string; rows: InventoryRowDto[]; total: number }
export interface LiabilityLineDto { kind: 'loan' | 'bond' | 'payable' | 'tax'; label: string; amount: number }
export interface CashFlowDto { period: PeriodDto; companyId: number; beginningCash: number; operating: CashFlowSection;
  investing: CashFlowSection; financing: CashFlowSection; netChange: number; endingCash: number; reconciles: boolean }
export interface CashFlowSection { lines: { category: string; amount: number }[]; net: number }
export interface ProductProfitabilityDto { period: PeriodDto; rows: ProductPnlRowDto[] }
export interface ProductPnlRowDto { productId: string; name: string; revenue: number; cogs: number; grossMargin: number;
  marketing: number; netMargin: number; netMarginPct?: number; unitsSold: number }
export interface ExportsDto { period: PeriodDto; totalRevenue: number; totalUnits: number; byProduct: ExportProductRowDto[]; byBuilding: ExportBuildingRowDto[] }
export interface ExportProductRowDto { productId: string; revenue: number; units: number; avgPrice?: number }
export interface ExportBuildingRowDto { buildingId: number; typeId: string; cityId: string; revenue: number; units: number }
export interface LedgerArgs { period?: PeriodArgs; categories?: LedgerCategoryId[]; buildingId?: number; productId?: string; offset?: number; limit?: number }
export interface LedgerPageDto { total: number; offset: number; rows: LedgerRowDto[] }
export interface LedgerRowDto { seq: number; date: DateDto; category: LedgerCategoryId; amount: number; memo?: string; productId?: string; buildingId?: number }
export interface ExplainArgs { base?: PeriodArgs; compare?: PeriodArgs }
export interface ExplainDto { base: PeriodDto; compare: PeriodDto; baseNetIncome: number; compareNetIncome: number; drivers: VarianceLineDto[] }
export interface VarianceLineDto { driver: 'volume' | 'price' | 'unitCost' | 'opexExisting' | 'opexNewBuildings' | 'advertising'
  | 'exports' | 'royalties' | 'other'; productId?: string; buildingId?: number; amount: number }
```

**Rules:**

| Topic | Rule |
|---|---|
| Company visibility | `companyId` defaults to the player. Rivals are allowed for `incomeStatement`, `balanceSheet` and `cashFlow`, since public-company reports are CapLab behaviour. The `ledger` query is **player-only** (`not_owner` otherwise). |
| `RetainedEarnings` | Σ NI [start, now] |
| `Drift` | `Equity − (StartingCapital + RetainedEarnings)`, computed with the facade's book value. `BooksClose = |Drift| < 0.01`. `EngineBuildingValue` shows the engine's number (E5). |
| Margins | `GrossMargin = GrossProfit / Revenue`, `NetMargin = NetIncome / Revenue`; `null` when revenue = 0 |
| `unitsSold` in product P&L | COGS quantity (retail + export) |
| `exports` units | **Exact COGS quantity** from export COGS entries, not revenue ÷ base price (defect #29). `avgPrice = revenue / units`. |
| `ledger` paging | `limit ≤ 500`; newest first; `total` for the pager |
| `explainNetIncome` drivers, per finished product | `volume = (q₂ − q₁) × p₁`; `price = (p₂ − p₁) × q₂`, where p = realised average price (revenue/units) and q = units; `unitCost = −(c₂ − c₁) × q₂`, where c = COGS/unit |
| `explainNetIncome` drivers, other | `exports` = Δ export revenue − Δ export COGS; `opexExisting` / `opexNewBuildings` split by whether the building existed in the base period; `advertising` = −Δ ad spend; `royalties`; `other` = residual, so the drivers sum exactly to ΔNI |

### 5.9 Market intelligence

```csharp
public sealed record MarketIntelArgs(string? CityId = null, string? ProductId = null, bool PlayerOnly = false,
    bool CompetitorsOnly = false, bool SignificantOnly = false, string Sort = "share");
public sealed record MarketIntelDto(IReadOnlyList<MarketRowDto> Rows);
public sealed record MarketRowDto(string CityId, string CityName, string ProductId, string ProductName, double PotentialDemand,
    int RetailerCount, bool PlayerPresent, decimal? PlayerPrice, double PlayerModelShare, double? PlayerRealisedShare,
    decimal? CheapestRivalPrice, CompanyShareDto? TopRival, int RivalCount);
public sealed record CompanyShareDto(int CompanyId, string Name, double Share);
public sealed record MarketKeyArgs(string CityId, string ProductId);
public sealed record MarketDetailDto(string CityId, string ProductId, double PotentialDemand, double Elasticity, decimal BaseWorldPrice,
    decimal EffectiveWorldPrice, IReadOnlyList<BracketDemandDto> Brackets, IReadOnlyList<RetailerRowDto> Retailers,
    SeriesDto PlayerRealisedShareHistory, double EngineGoalShare, string ModelSource);   // modelSource: bridgeReplica|engine
public sealed record BracketDemandDto(string Bracket, double Population, double PerCapita, double Demand, decimal? ReservationPrice,
    int EligibleRetailers);
public sealed record RetailerRowDto(int BuildingId, int SlotIndex, int OwnerId, string OwnerName, bool IsPlayer, decimal Price,
    double Quality, int Tech, double Brand, double Weight, double ModelDemandUnits, double ModelShare, double OnHand,
    double LastMonthUnits, decimal LastMonthRevenue, double LastMonthRealisedShare, IReadOnlyList<string> ExcludedBrackets);
public sealed record MarketOpportunitiesDto(IReadOnlyList<EnterOpportunityDto> Enter, IReadOnlyList<DefendPressureDto> Defend);
public sealed record EnterOpportunityDto(string CityId, string ProductId, double PotentialDemand, int RivalCount, decimal? CheapestRivalPrice, double Score);
public sealed record DefendPressureDto(string CityId, string ProductId, double PlayerShare, double TopRivalShare, string TopRivalName, double Score);
public sealed record PriceSuggestionDto(int BuildingId, int SlotIndex, decimal UnitCost, decimal EffectiveWorldPrice, decimal? RivalMin,
    decimal? RivalMedian, IReadOnlyList<CeilingDto> Ceilings, decimal Suggested, IReadOnlyList<PricePointDto> ExpectedUnitsAt,
    string ModelSource);
public sealed record CeilingDto(string Bracket, decimal Price);
public sealed record PricePointDto(decimal Price, double Units, decimal Revenue, decimal GrossProfit);
```

```ts
export interface MarketIntelArgs { cityId?: string; productId?: string; playerOnly?: boolean; competitorsOnly?: boolean;
  significantOnly?: boolean; sort?: 'share' | 'price' | 'city' | 'demand' }
export interface MarketIntelDto { rows: MarketRowDto[] }
export interface MarketRowDto { cityId: string; cityName: string; productId: string; productName: string; potentialDemand: number;
  retailerCount: number; playerPresent: boolean; playerPrice?: number; playerModelShare: number; playerRealisedShare?: number;
  cheapestRivalPrice?: number; topRival?: CompanyShareDto; rivalCount: number }
export interface CompanyShareDto { companyId: number; name: string; share: number }
export interface MarketKeyArgs { cityId: string; productId: string }
export interface MarketDetailDto { cityId: string; productId: string; potentialDemand: number; elasticity: number; baseWorldPrice: number;
  effectiveWorldPrice: number; brackets: BracketDemandDto[]; retailers: RetailerRowDto[]; playerRealisedShareHistory: SeriesDto;
  engineGoalShare: number; modelSource: 'bridgeReplica' | 'engine' }
export interface BracketDemandDto { bracket: Bracket; population: number; perCapita: number; demand: number; reservationPrice?: number; eligibleRetailers: number }
export interface RetailerRowDto { buildingId: number; slotIndex: number; ownerId: number; ownerName: string; isPlayer: boolean; price: number;
  quality: number; tech: number; brand: number; weight: number; modelDemandUnits: number; modelShare: number; onHand: number;
  lastMonthUnits: number; lastMonthRevenue: number; lastMonthRealisedShare: number; excludedBrackets: Bracket[] }
export interface MarketOpportunitiesDto { enter: EnterOpportunityDto[]; defend: DefendPressureDto[] }
export interface EnterOpportunityDto { cityId: string; productId: string; potentialDemand: number; rivalCount: number; cheapestRivalPrice?: number; score: number }
export interface DefendPressureDto { cityId: string; productId: string; playerShare: number; topRivalShare: number; topRivalName: string; score: number }
export interface PriceSuggestionDto { buildingId: number; slotIndex: number; unitCost: number; effectiveWorldPrice: number; rivalMin?: number;
  rivalMedian?: number; ceilings: { bracket: Bracket; price: number }[]; suggested: number;
  expectedUnitsAt: { price: number; units: number; revenue: number; grossProfit: number }[]; modelSource: 'bridgeReplica' | 'engine' }
```

**MarketModel (bridge replica, `modelSource:'bridgeReplica'`).** It mirrors MonthlyTick.cs:340-396 exactly, until E9 replaces it with the engine's own `DemandModel` (`modelSource:'engine'`).

For every retail slot `i` selling finished product `p` in city `c`:
```
ε  = p.PriceElasticity > 0 ? p.PriceElasticity : 1
Qᵢ = onHand > 0 ? Inventory.AverageQuality(p) : WorldMarketQuality (50)      // forecast heuristic; the engine uses post-restock quality
wᵢ = max((Qᵢ + 10·Tech(ownerᵢ,p) + Brand(ownerᵢ,p,c)) / 3, 1) / priceᵢ^ε
for bracket b in [low, middle, high]:
    D_b = population × share_b × perCapita_b(p)
    E_b = { i : priceᵢ ≤ reservation_b(p) }         (no ceiling ⇒ all)
    demandᵢ += D_b × wᵢ / Σ_{j∈E_b} wⱼ              (skip if Σ = 0)
modelShareᵢ = demandᵢ / Σ demand;   excludedBracketsᵢ = { b : priceᵢ > reservation_b }
```

**Realised share:**
- `realised share(company, c, p, month)` = retail units sold by that company's buildings in `c` / all retail units in `c`, from the index's `_retailMarket`. It is exact, because every retail sale writes a `CogsEntry` with `SourceBuilding` (MonthlyTick.cs:415).
- `PlayerRealisedShareHistory` = the last 12 months, dense.
- This replaces the revenue ÷ (current demand × current average price) approximation (MarketIntel.cs:792-862).

**Engine goal share:** `EngineGoalShare = World.GetMarketShare(player, p, c)`, kept so the `marketShare` goal progress is explainable. That function has no bracket gating and uses post-sale quality (Q3/E9).

**Opportunity scores** (MarketIntel.cs:869-886):
- `enter.score = potentialDemand / (1 + rivalCount)` over markets without the player. Top 3.
- `defend.score = (topRivalShare − playerShare) × potentialDemand` over markets where the player and ≥ 1 rival are present. Top 3.
- The shares use realised share when last month had sales, else model share.

**`suggestPrice`:**
- Evaluates the model at 5 price points `{0.8, 0.9, 1.0, 1.1, 1.2} × reference`, where `reference = max(unitCost × 1.25, rivalMedian ?? effectiveWorldPrice × 1.2)`.
- Units are capped at the slot's `restockTarget`, since stock caps sales.
- `suggested` is the point that maximises gross profit, clipped just below the nearest binding reservation ceiling.
- Under today's fixed-pie demand, price barely moves total units. UX §3.3 calls this out, and the economics workstream owns the fix. `suggestPrice` must therefore switch to the engine demand model (E9) the moment it exists; the DTO is unchanged.

### 5.10 News, activity feed, history, monthly report, stats

```csharp
public sealed record NewsArgs(long? SinceSeq = null, int Limit = 50);
public sealed record NewsDto(IReadOnlyList<NewsEntryDto> Entries, long LatestSeq, IReadOnlyList<PriceEffectDto> ActivePriceEffects);
public sealed record NewsEntryDto(long Seq, DateDto Date, string EventId, string Headline, string Description, string Severity,
    IReadOnlyList<EffectDto> Effects);
public sealed record EffectDto(string Kind, string? ProductId, string? CityId, decimal? Multiplier, int? Months, int? Delta);
public sealed record PriceEffectDto(string ProductId, decimal Multiplier, int RemainingMonths, decimal BasePrice, decimal EffectivePrice);
public sealed record FeedArgs(long? SinceSeq = null, int Limit = 200, IReadOnlyList<string>? Kinds = null, string? Search = null);
public sealed record FeedDto(IReadOnlyList<GameEventDto> Events, long LatestSeq);
public sealed record HistoryArgs(IReadOnlyList<string> Series, IReadOnlyList<int>? CompanyIds = null, DateDto? From = null, DateDto? To = null);
public sealed record HistoryDto(DateDto Start, int Months, IReadOnlyList<CompanySeriesDto> Companies);
public sealed record CompanySeriesDto(int CompanyId, IReadOnlyDictionary<string, IReadOnlyList<double?>> Series,
    IReadOnlyDictionary<string, DateDto> MissingBefore);
public sealed record MonthlyReportArgs(DateDto? From = null, DateDto? To = null);
public sealed record MonthlyReportDto(IReadOnlyList<MonthSummaryDto> Months);
public sealed record MonthSummaryDto(DateDto Month, decimal Revenue, decimal Expenses, decimal NetCash, decimal Cogs,
    decimal Royalties, decimal NetIncome, double UnitsSold, int NewBuildings, int AdCampaigns, decimal CumulativeCash,
    decimal CumulativeNetIncome, IReadOnlyList<BuildingNiDto> TopBuildings, IReadOnlyList<NoteworthyDto> Noteworthy);
public sealed record BuildingNiDto(int BuildingId, string TypeName, string CityId, decimal NetIncome);
public sealed record NoteworthyDto(long Seq, string Category, string? ProductId, decimal Amount);
public sealed record StatsDashboardDto(decimal Cash, decimal CorporateValue, decimal TotalAssets, decimal NetIncomeThisMonth,
    SeriesDto CorporateValueSeries, ShareHeatmapDto ShareHeatmap, IReadOnlyList<TechBoardDto> RdLeaderboard,
    IReadOnlyList<BrandBoardDto> BrandTop, IReadOnlyList<BuildingMoneyDto> TopByRevenue, IReadOnlyList<BuildingMoneyDto> TopByOpex);
public sealed record ShareHeatmapDto(IReadOnlyList<string> CityIds, IReadOnlyList<string> ProductIds, IReadOnlyList<IReadOnlyList<double?>> Share);
public sealed record TechBoardDto(string ProductId, int MaxTech, IReadOnlyList<CompanyValueDto> Rows);
public sealed record BrandBoardDto(string ProductId, IReadOnlyList<BrandRowDto> Rows);
public sealed record BrandRowDto(int CompanyId, string CityId, double Brand);
public sealed record CompanyValueDto(int CompanyId, double Value);
public sealed record BuildingMoneyDto(int BuildingId, string TypeId, string CityId, decimal Amount);
```

```ts
export interface NewsArgs { sinceSeq?: number; limit?: number }
export interface NewsDto { entries: NewsEntryDto[]; latestSeq: number; activePriceEffects: PriceEffectDto[] }
export interface NewsEntryDto { seq: number; date: DateDto; eventId: string; headline: string; description: string;
  severity: NewsSeverity; effects: EffectDto[] }
export interface EffectDto { kind: 'priceMultiplier' | 'brandShift' | 'headline'; productId?: string; cityId?: string;
  multiplier?: number; months?: number; delta?: number }
export interface PriceEffectDto { productId: string; multiplier: number; remainingMonths: number; basePrice: number; effectivePrice: number }
export interface FeedArgs { sinceSeq?: number; limit?: number; kinds?: GameEventKind[]; search?: string }
export interface FeedDto { events: GameEventDto[]; latestSeq: number }
export type HistorySeries = 'cash' | 'revenue' | 'netIncome' | 'corporateValue' | 'totalAssets' | 'equity' | 'inventoryValue'
  | 'buildingValue' | 'buildings' | 'topBrand' | 'topTech';
export interface HistoryArgs { series: HistorySeries[]; companyIds?: number[]; from?: DateDto; to?: DateDto }
export interface HistoryDto { start: DateDto; months: number; companies: { companyId: number;
  series: Partial<Record<HistorySeries, (number | null)[]>>; missingBefore: Partial<Record<HistorySeries, DateDto>> }[] }
export interface MonthlyReportArgs { from?: DateDto; to?: DateDto }
export interface MonthlyReportDto { months: MonthSummaryDto[] }
export interface MonthSummaryDto { month: DateDto; revenue: number; expenses: number; netCash: number; cogs: number; royalties: number;
  netIncome: number; unitsSold: number; newBuildings: number; adCampaigns: number; cumulativeCash: number; cumulativeNetIncome: number;
  topBuildings: { buildingId: number; typeName: string; cityId: string; netIncome: number }[];
  noteworthy: { seq: number; category: LedgerCategoryId; productId?: string; amount: number }[] }
export interface StatsDashboardDto { cash: number; corporateValue: number; totalAssets: number; netIncomeThisMonth: number;
  corporateValueSeries: SeriesDto; shareHeatmap: { cityIds: string[]; productIds: string[]; share: (number | null)[][] };
  rdLeaderboard: { productId: string; maxTech: number; rows: { companyId: number; value: number }[] }[];
  brandTop: { productId: string; rows: { companyId: number; cityId: string; brand: number }[] }[];
  topByRevenue: BuildingMoneyDto[]; topByOpex: BuildingMoneyDto[] }
export interface BuildingMoneyDto { buildingId: number; typeId: string; cityId: string; amount: number }
```

**Rules:**
- **News:** `seq` = index in `World.NewsLog`. `description` and `effects` are joined from `catalog.Events` by `eventId`; a missing definition yields empty strings. Pass `sinceSeq` to fetch only new entries (ticker).
- **Feed:** a persisted ring (§4.2). `search` is a case-insensitive substring over `message`. Newest last.
- **History:** from `MetricsHistory`, dense between `start` and `now`. `companyIds` defaults to `[player]`; rivals are allowed. `missingBefore` marks series that did not exist before a legacy load (§4.6.8).
- **Monthly report** (ReplayViewer parity):
  - `expenses` = OperatingCost + AdvertisingCost.
  - `noteworthy` = ledger entries with |amount| ≥ $250,000 (ReplayViewer.cs:343-349).
  - `topBuildings` = top 3 by |accrual NI|, ties by id.
  - Built from the index.
- **Stats dashboard:**
  - Heatmap = player realised share per (city, finished product retailed by the player), `null` where there is no market.
  - R&D board = tech per company for the player's slotted products.
  - Brand top = top 5 (company, city) per product the player retails.
  - Top buildings = current month.

### 5.11 Goals, outcome, advisor

```csharp
public sealed record GoalDto(string? Description, bool Achieved, double Progress, string? Detail,          // EXISTS (Description/Detail become optional; omitted in HUD after one release)
    string Id, int Index, string Kind, string Metric, decimal Current, decimal Target, string Unit,        // NEW
    DateDto? AchievedAt, string? ProductId, string? CityId, string? Category);
public sealed record GoalsDto(IReadOnlyList<GoalDto> Goals, OutcomeDto Outcome, DateDto? Deadline, int? MonthsRemaining, string? NextGoalId);
public sealed record AdvisorDto(AdvisorItemDto Priority, IReadOnlyList<AdvisorItemDto> Hints);
public sealed record AdvisorItemDto(string Code, string Severity, string Message, IReadOnlyDictionary<string, string> Params,
    IReadOnlyList<int>? BuildingIds = null, string? CityId = null, string? ProductId = null,
    decimal? ImpactPerMonth = null, AdvisorFixDto? Fix = null);                        // v2 (UX §6.15)
public sealed record AdvisorFixDto(string Method, string ArgsJson, string Label);
```

```ts
export interface GoalDto { description?: string; achieved: boolean; progress: number; detail?: string;
  id: string; index: number; kind: GoalKind; metric: string; current: number; target: number; unit: GoalUnit;
  achievedAt?: DateDto; productId?: string; cityId?: string; category?: string }
export interface GoalsDto { goals: GoalDto[]; outcome: OutcomeDto; deadline?: DateDto; monthsRemaining?: number; nextGoalId?: string }
export type AdvisorCode = 'firstRevenue' | 'activateIdle' | 'needRetail' | 'restoreProfit' | 'buildBrand' | 'addResearch' | 'scale'
  | 'lowRunway' | 'sellingBelowCost' | 'exportingAtLoss' | 'unsellableRetail' | 'rivalPatentBlocksYou' | 'adsWithoutStore';
export interface AdvisorDto { priority: AdvisorItemDto; hints: AdvisorItemDto[] }
export interface AdvisorItemDto { code: AdvisorCode; severity: UiSeverity; message: string; params: Record<string, string>;
  buildingIds?: number[]; cityId?: string; productId?: string; impactPerMonth?: number; fix?: { method: MethodName; argsJson: string; label: string } }
```

- `achieved` = `met` now, the skeleton's meaning. `achievedAt` is the latch.
- `message` is English fallback text. The client localises from `code` + `params`, which are strings so they can be interpolated directly.
- `fix` lets the UI offer one-click fixes, for example `setRetailPrice` with a suggested price.
- The rules are in §4.6.5, §4.6.6 and §4.6.9.

### 5.12 Persistence

The string methods stay for tests and the dev console. The **web client uses the binary JSExports** (§6.3).

```csharp
public sealed record LoadGameArgs(string Data);                                               // EXISTS (accepts web envelope JSON or legacy engine JSON)
public sealed record SaveGameResult(string Data, int SchemaVersion, string? ScenarioId, string? ScenarioName,
    string CompanyName, DateDto Date, decimal Cash);                                          // EXISTS (dev only)
public sealed record SaveArgs(string SlotKind = "manual", string? Label = null, string? CreatedAtIso = null);  // for SaveBinary
public sealed record LoadArgs(string? ExpectedGameId = null);                                  // for LoadBinary
public sealed record SaveMetaDto(int FormatVersion, int EngineSchemaVersion, string GameId, string? ScenarioId, string? ScenarioName,
    string CompanyName, DateDto Date, int ElapsedMonths, decimal Cash, decimal StartingCapital, decimal CorporateValue,
    IReadOnlyList<IdCountDto> BuildingsByCategory, IReadOnlyList<ProductRevenueDto> TopProducts, int GoalsAchieved, int GoalsTotal,
    string OutcomeStatus, string ContentHash, string? Label, string SlotKind, string? CreatedAtIso, long RawBytes, long CompressedBytes);
public sealed record ProductRevenueDto(string ProductId, decimal Revenue);
public sealed record InspectResultDto(SaveMetaDto Meta, bool Loadable, string? Problem);      // problem = an error code if not loadable
```

```ts
export interface SaveArgs { slotKind?: 'manual' | 'autosave' | 'quicksave'; label?: string; createdAtIso?: string }
export interface SaveMetaDto { formatVersion: number; engineSchemaVersion: number; gameId: string; scenarioId?: string; scenarioName?: string;
  companyName: string; date: DateDto; elapsedMonths: number; cash: number; startingCapital: number; corporateValue: number;
  buildingsByCategory: IdCountDto[]; topProducts: { productId: string; revenue: number }[]; goalsAchieved: number; goalsTotal: number;
  outcomeStatus: 'playing' | 'won' | 'lost'; contentHash: string; label?: string; slotKind: 'manual' | 'autosave' | 'quicksave';
  createdAtIso?: string; rawBytes: number; compressedBytes: number }
export interface InspectResultDto { meta: SaveMetaDto; loadable: boolean; problem?: BridgeErrorCode }
```

`SaveMetaDto` covers everything the Godot SaveBrowser preview computed (SaveBrowser.cs:137-240). It is produced **at save time**, so listing saves never parses save bodies.

### 5.13 Dev

```csharp
public sealed record DebugStatsDto(int LedgerEntries, int CogsEntries, int TransferEntries, int Buildings, int Companies,
    double LastTickMs, double LastBridgeMs, double IndexCatchUpMs, long Revision, bool Faulted, string ProtocolVersion);
```

- DEBUG-only commands (`debugSetCash`, `debugSetTech`, `debugSetBrand`, `debugFireEvent`) are compiled only under `#if DEBUG` / `MAGNATE_DEV`.
- Release builds must not register them. A test asserts `GameSession.MethodNames` has no `debug*` except `debugStats`.

### 5.14 TypeScript `Methods` map (replaces web/src/bridge/protocol.ts:221-233)

```ts
type NoArgs = Record<never, never>;
export interface Methods {
  init: { args: { contentRoot: string; scenarioDir?: string }; result: InitResult };
  ping: { args: NoArgs; result: PingResult };
  listScenarios: { args: NoArgs; result: ScenarioSummaryDto[] };
  catalog: { args: NoArgs; result: CatalogDto };
  newGame: { args: NewGameArgs; result: SnapshotDto };
  snapshot: { args: NoArgs; result: SnapshotDto };
  companies: { args: NoArgs; result: CompanySummaryDto[] };
  settings: { args: NoArgs; result: SettingsDto };
  updateSettings: { args: UpdateSettingsArgs; result: SettingsDto };
  setAutopilot: { args: AutopilotArgs; result: SnapshotDto };
  advance: { args: AdvanceArgs; result: TickResultDto };
  cityView: { args: CityViewArgs; result: CityViewDto };
  worldMap: { args: NoArgs; result: WorldMapDto };
  buildings: { args: BuildingsArgs; result: BuildingSummaryDto[] };
  building: { args: { buildingId: number }; result: BuildingDetailDto };
  supplyFlows: { args: SupplyFlowsArgs; result: SupplyFlowsDto };
  previewBuild: { args: PreviewBuildArgs; result: BuildPreviewDto };
  construct: { args: ConstructArgs; result: BuildingSummaryDto };
  buildStarterPlan: { args: StarterPlanArgs; result: BuildingSummaryDto };
  configureSlot: { args: ConfigureSlotArgs; result: SlotDetailDto };
  clearSlot: { args: SlotRefArgs; result: BuildingSummaryDto };
  setRetailPrice: { args: SetRetailPriceArgs; result: SlotDetailDto };
  setRestockTarget: { args: SetRestockTargetArgs; result: SlotDetailDto };
  setWarehouseTarget: { args: SetWarehouseTargetArgs; result: SlotDetailDto };
  setAutoExport: { args: SetAutoExportArgs; result: BuildingSummaryDto };
  upgradeBuilding: { args: { buildingId: number }; result: UpgradeResultDto };
  demolishBuilding: { args: { buildingId: number }; result: DisposalResultDto };    // EXT
  sellBuilding: { args: { buildingId: number }; result: DisposalResultDto };        // EXT
  adCampaigns: { args: NoArgs; result: AdCampaignsDto };
  previewAdCampaign: { args: AdCampaignArgs; result: AdPreviewDto };
  setAdCampaign: { args: AdCampaignArgs; result: AdCampaignDto };
  cancelAdCampaign: { args: AdKeyArgs; result: CancelResultDto };
  researchTree: { args: NoArgs; result: ResearchTreeDto };
  patents: { args: NoArgs; result: PatentsDto };
  grantLicense: { args: LicenseArgs; result: PatentsDto };
  revokeLicense: { args: LicenseArgs; result: PatentsDto };
  incomeStatement: { args: CompanyPeriodArgs; result: IncomeStatementDto };
  balanceSheet: { args: BalanceSheetArgs; result: BalanceSheetDto };
  cashFlow: { args: CompanyPeriodArgs; result: CashFlowDto };
  productProfitability: { args: CompanyPeriodArgs; result: ProductProfitabilityDto };
  exports: { args: CompanyPeriodArgs; result: ExportsDto };
  ledger: { args: LedgerArgs; result: LedgerPageDto };
  explainNetIncome: { args: ExplainArgs; result: ExplainDto };
  marketIntel: { args: MarketIntelArgs; result: MarketIntelDto };
  marketDetail: { args: MarketKeyArgs; result: MarketDetailDto };
  marketOpportunities: { args: NoArgs; result: MarketOpportunitiesDto };
  suggestPrice: { args: SlotRefArgs; result: PriceSuggestionDto };
  goals: { args: NoArgs; result: GoalsDto };
  advisor: { args: NoArgs; result: AdvisorDto };
  history: { args: HistoryArgs; result: HistoryDto };
  monthlyReport: { args: MonthlyReportArgs; result: MonthlyReportDto };
  statsDashboard: { args: NoArgs; result: StatsDashboardDto };
  news: { args: NewsArgs; result: NewsDto };
  activityFeed: { args: FeedArgs; result: FeedDto };
  saveGame: { args: NoArgs; result: SaveGameResult };                               // dev/tests
  loadGame: { args: { data: string }; result: SnapshotDto };
  exportEngineJson: { args: NoArgs; result: { json: string } };                     // dev
  debugStats: { args: NoArgs; result: DebugStatsDto };
  // EXT (§8): cityLayout, parcels, buyLand, sellLand, cancelConstruction, creditProfile, loanOffers, loans, takeLoan,
  //           repayLoan, stockMarket, holdings, ipo, issueShares, buybackShares, tradeShares, setDividend, macro
}
```

---

## 6. The WASM host (browser)

### 6.1 Boot sequence and budget

| Step | Where | Measured |
|---|---|---|
| Page and Vite bundle; React title screen renders immediately | main | n/a |
| `new Worker(engine.worker.ts, {type:'module'})` + `import(_framework/dotnet.js)` + `dotnet.create()` | worker | 257 ms (worker) |
| `MagnateInterop.Boot()`: extract 30 embedded JSON files to MEMFS `/magnate/content` | worker | 51–73 ms |
| `init`: `ContentLoader.Load` + `ScenarioLoader.LoadAll` | worker | 368–486 + 83–138 ms |
| `catalog` + `listScenarios` (skeleton gameStore.ts:92) | worker | < 10 ms each once the index and caches are built |
| **Total to interactive title** | | the skeleton smoke test measured 2,579 ms including page load (web/test-results/smoke-report.json) |

**Recommendations:**
- Start the worker boot as the very first action in `main.tsx`, in parallel with React's first render, as the skeleton does.
- Show a progress bar driven by `{kind:'bootProgress', stage}` messages from the worker (NEW).
- Content load becomes ~3× faster with E13 (source-generated loaders); that is not required for v1.

### 6.2 Content loading: extract to MEMFS (keep) versus string overloads

**Decision: keep extract-to-MEMFS for v1** (web/engine-host/Program.cs:44-58).
- It needs zero engine change and is measured at 51–73 ms.
- `ContentLoader`, `ScenarioLoader` and `WorldLoader.Load(path)` work unmodified against MEMFS, as the harness proved.
- Content ships inside `Magnate.Wasm.wasm` as `EmbeddedResource`. It is 144 KB raw and compresses with the assembly.

**Later: add `IContentSource` (E13).** Do it when either of these lands:
- **Mods / user content packs.** The user drops a zip; the worker unpacks it into IndexedDB and passes `InMemoryContentSource` to `init`.
- **Content hot-reload in dev.** Vite serves `content/**/*.json` over HTTP; `init {contentUrls}` fetches them.

The proposed shape is `ContentLoader.Load(IContentSource)` with `IEnumerable<(string path, ReadOnlyMemory<byte> json)> Enumerate(string dir)`. The directory overload becomes a thin adapter. Scenarios get the same treatment.

**`contentHash`:** SHA-256 over `path + bytes` of every content file, sorted by path. It is computed once at boot and stored in save metadata. On load, a hash mismatch is **not** fatal; the explicit id check (§4.7 `save_content_mismatch`) is.

### 6.3 Saves: format, binary transport, IndexedDB

**Web save format v1** (JSON, then gzip):
```jsonc
{
  "format": "magnate.websave",
  "formatVersion": 1,
  "meta": { /* SaveMetaDto */ },
  "engine": { /* WorldSaveFile, schema v9 today (v10 after E4/E11/E14) — embedded raw via Utf8JsonWriter.WriteRawValue */ },
  "bridge": {
    "gameId": "…", "seed": 123456789, "custom": null,
    "history": { "start": {"year":2026,"month":1}, "companies": [ { "companyId": 1, "rows": [[/* cash,revenue,ni,ta,eq,cv,inv,bldg,buildings,topBrand,topTech */], …] } ] },
    "goals": { "achievedAt": { "g0": {"year":2026,"month":3} } },
    "outcome": { "status": "playing" },
    "events": { "seq": 1234, "latches": { "lowCash": false, "niSign": 1, "milestoneIndex": 2, "firstSale": true } },
    "feed": [ /* last ≤ 2000 GameEventDto */ ],
    "placement": { "17": {"px":12,"pz":30,"rotation":0,"source":"auto"} },
    "settings": { "lowCashThreshold": 1000000, "autosaveEveryMonths": 12 },
    "journal": [ /* optional, ≤ 5000 */ ]
  }
}
```

**Engine JSON inside the save:**
- It uses **compact** options, not `WriteIndented`, which saves 31% (E14).
- Until E14 lands, the bridge calls `WorldSaver.SaveToString`, re-parses it into a `JsonDocument`, and writes it compact. This extra parse-and-rewrite pass was not measured separately; expect it to cost roughly as much as the engine serialize itself.
- **Better:** a one-line engine overload `SaveToUtf8(World, …, bool indented=false)`.

**Load accepts three inputs:**
1. The web envelope, gzip or plain. It is detected by the leading bytes `1F 8B`, then `"format":"magnate.websave"`.
2. A **legacy engine save** (any Godot save v1–v9), detected by a root `schemaVersion`. The bridge builds an empty sidecar and backfills history from the ledger.
3. The skeleton's `loadGame {data}` string, for dev use.

**Load order:**
1. Decompress.
2. Check the envelope version (`save_version_unsupported`).
3. `WorldLoader.LoadFromString(catalog, engineJson)`.
4. Content id validation (§4.7).
5. Restore the sidecar.
6. Rebuild `LedgerIndex`.
7. `Revision++`.
8. Return the snapshot.

**JSExports** (added to `web/engine-host/Program.cs`; `Boot` and `Call` stay):
```csharp
[JSExport]
[return: JSMarshalAs<JSType.Array<JSType.Number>>]           // arrives as Uint8Array (verified: "[object Uint8Array]")
public static byte[] SaveBinary(string argsJson)              // SaveArgs → gzip(web envelope). On failure returns empty array; call LastError()
    => _session!.SaveBinary(argsJson);
[JSExport]
public static string LoadBinary([JSMarshalAs<JSType.Array<JSType.Number>>] byte[] data, string argsJson)  // → envelope JSON (SnapshotDto)
    => _session!.LoadBinary(data, argsJson);
[JSExport]
public static string InspectSave([JSMarshalAs<JSType.Array<JSType.Number>>] byte[] data)                   // → envelope JSON (InspectResultDto)
    => _session!.InspectSave(data);
[JSExport]
public static string LastError() => _session?.LastErrorJson ?? "null";                                     // error envelope for SaveBinary
```

**Measured costs** (13.6 MB raw world, WASM):

| Path | Cost |
|---|---|
| Today (string in envelope) | serialize 1.4–1.8 s + marshal 1.3–1.5 s + main-thread `JSON.parse` of a ~14 MB envelope |
| Proposed | serialize (~1 s once compact, E14) + GZip Fastest 163 ms + marshal ~80 ms for about 1.6 MB, all **inside the worker** |

The main thread only receives `SaveMetaDto`.

**IndexedDB layout.** The worker owns it; IndexedDB is available in dedicated workers.

| DB `magnate`, v1 | Key | Value |
|---|---|---|
| `saveMeta` | `slotId` | `SaveMetaDto & { slotId, updatedAt }`, used for listing (no blobs) |
| `saveData` | `slotId` | `Blob` (gzip bytes, `type: 'application/gzip'`) |
| `prefs` | string | Client settings (volume, speed, advisor verbosity). UI prefs stay client-owned, not in the save. |

**Slots and storage:**

| Rule | Value |
|---|---|
| Manual slot | `m-<uuid>` |
| Quicksave | `quick` |
| Autosave | rotating `auto-1..3`, keeping the 3 newest (GameState.cs:106) |
| Persistence request | `navigator.storage.persist()` on the first save |
| Quota check | `navigator.storage.estimate()` before writing; if free < 3 × blob size, fail with a UI error |

**Export and import:**
- Export downloads `<company>-<YYYY-MM>.magnate`, the gzip web envelope.
- Import accepts `.magnate`, `.json` (legacy Godot saves) and `.json.gz`.

**Worker protocol additions** (web/src/bridge/workerProtocol.ts):
```ts
export type WorkerRequest =
  | { id: number; kind: 'boot'; frameworkUrl: string }                                   // EXISTS
  | { id: number; kind: 'call'; method: string; argsJson: string }                       // EXISTS
  | { id: number; kind: 'save'; slotId: string; args: SaveArgs }                         // NEW → SaveMetaDto
  | { id: number; kind: 'load'; slotId: string }                                         // NEW → envelope payload (SnapshotDto)
  | { id: number; kind: 'listSaves' }                                                    // NEW → (SaveMetaDto & {slotId})[]
  | { id: number; kind: 'deleteSave'; slotId: string }                                   // NEW
  | { id: number; kind: 'exportSave'; slotId: string }                                   // NEW → ArrayBuffer (transferable)
  | { id: number; kind: 'importSave'; bytes: ArrayBuffer; slotId?: string };             // NEW → InspectResultDto
export type WorkerResponse =
  | { id: number; ok: true; payload: string; elapsedMs?: number }                        // EXISTS
  | { id: number; ok: true; binary: ArrayBuffer; meta?: string }                         // NEW (exportSave)
  | { id: number; ok: false; error: string }                                             // EXISTS
  | { id: 0; kind: 'bootProgress'; stage: 'runtime' | 'content' | 'scenarios' | 'ready' }; // NEW push
```

**Autosave:**
- When a `call` to `advance` returns `autosaveDue: true`, the **worker** chains `save {slotKind:'autosave'}` before answering the next request.
- The main thread sees `autosaved` in the next `activityFeed`, plus an optional toast.
- The skeleton's `EngineClient.call` stays promise-based; saves are just another serialized request.

### 6.4 Main thread versus Web Worker

**Decision: the worker, always.** The skeleton already does this. There is no main-thread fallback in production.

**Evidence** (§1):
- Ticks of 20–38 ms with 63 ms spikes would drop 1–4 frames per month at 60 fps. At the UX's 8× speed that is a visible hitch every 1.5 s.
- Saves and loads block for 1.4–3.3 s.
- With the worker, the worst main-thread frame gap during 60 ticks was **16.8 ms**, one frame.

**Rules for the TS side:**
- **Never** `await` the engine inside a `requestAnimationFrame` callback. The skeleton's `GameClock` does this correctly: it sets `ticking` and continues rendering (web/src/game/clock.ts:24-36).
- Requests are FIFO in the worker; the .NET runtime is single-threaded. Queries issued during a tick wait at most one tick. Coalesce identical in-flight queries by `(method, argsJson)`.
- Big payloads go worker → main as the raw JSON string. The skeleton parses on the main thread, which is fine up to about 100 KB (§4.8).
- No `SharedArrayBuffer`, no WASM threads (`WasmEnableThreads` is experimental in .NET 8), and therefore **no COOP/COEP headers needed**.

### 6.5 JSExport marshalling limits (verified)

| Type | Behaviour |
|---|---|
| `string` ↔ JS string | Works; UTF-16 copy. Measured about 0.1 ms/KB at 13.6 MB, so negligible for normal responses (≤ 100 KB ≈ 10 ms including `JSON.parse`). |
| `byte[]` with `[JSMarshalAs<JSType.Array<JSType.Number>>]` | Arrives as a **`Uint8Array`** (verified); about 50 µs/KB. |
| Parameters | `byte[]` from a JS `Uint8Array` works (verified with `LoadFromBytes`). |
| `decimal`, `long`, structs and records | Not marshallable, so everything goes through JSON. |
| Exceptions escaping a `[JSExport]` | Surface as JS `Error` with **resource-key messages** in Release (`UseSystemResourceKeys`; observed `NoElements` from `Enumerable.Average` on an empty list). |

**`Boot`, `Call`, `LoadBinary` and `InspectSave` must never throw.** The skeleton's `Dispatch` already catches everything; the new binary exports must too. `SaveBinary` returns an empty array on failure, and `LastError()` provides the envelope.

**`JSType.MemoryView` (zero-copy):** only valid during the call and awkward for returns. Not worth it at these sizes.

### 6.6 Trimming, globalization and resource keys (verified gotchas)

| Setting (Magnate.Wasm.csproj) | Effect | Bridge rule |
|---|---|---|
| `InvariantGlobalization=true` | `ToString("C")` renders `¤1,000.00` (verified with the engine's `Construct` message, World.cs:104). `N0` and `F1` are fine. | No `:C` anywhere in the bridge. Money in DTOs is numeric. Fallback messages use the `$` + `N0` helper (GameSession.Game.cs:265). |
| `UseSystemResourceKeys=true` (runtimeconfig in the spike and skeleton builds) | BCL exception messages become keys (`NoElements`, `Arg_KeyNotFoundWithKey`) | Pre-validate. `details.devMessage` carries raw text for debugging only. |
| `TrimmerRootAssembly Magnate.Engine;Magnate.Bridge` + `JsonSerializerIsReflectionEnabledByDefault=true` (EXIST) | The reflection handler discovery (GameSession.cs:202-222) and reflection JSON survive trimming | Keep them. Move bridge DTOs to `BridgeJsonContext` (source-gen) anyway, for cold-start speed and so reflection JSON can eventually be switched off. |
| `SuppressTrimAnalysisWarnings=true` (EXISTS) | Hides IL2026/IL3050 | The smoke test must exercise every method at least once in the published build (§10). |

### 6.7 Build, size, deployment

- **Size:** `npm run build:engine` → `web/public/_framework`, 1.76 MB brotli / 5.1 MB raw.
- **Serving:** the production host must serve `*.br` with `Content-Encoding: br` (and `.gz` as a fallback). Vite dev/preview serve the raw files, which is fine locally.
- **Caching:** `cacheBootResources: true` (blazor.boot.json) caches the runtime in Cache Storage after the first visit.
- **AOT:** not available. `dotnet workload list` reports **no workloads installed**; `wasm-tools` / emsdk is needed for AOT and relinking.
  - Interpreter + jiterpreter meets the budgets (tick ≤ 40 ms in the worker).
  - Revisit if AI or the macro economy pushes p95 ticks above about 150 ms. AOT makes code roughly 3–5× faster at about 2–3× the download.
- **Payload diet:** `System.Private.Uri` (57 KB) and `System.Console` (13 KB) ship only because of `Console.WriteLine` / `Uri`. Optional; not worth effort now.

### 6.8 Determinism across runtimes (verified)

**Same seed, same inputs, 120 months of `four_archetype_melee`, desktop CoreCLR versus WASM:**
- Identical: ledger count (46,090), the 35-event news sequence, and the inventory quantity sum (`33306520.772884227`).
- Different: company cash in the 9th–10th decimal. Player: `635046.2284922047155` (desktop) vs `635046.2284922062905` (WASM).

**Cause (inferred):** `Math.Pow(price, elasticity)` in the demand weights (MonthlyTick.cs:359) resolves to different libm implementations. Every other operation is IEEE-exact decimal/double arithmetic.

**Consequences:**
- (a) Saves are portable between desktop tools and the browser.
- (b) Bit-exact replay and lockstep are **only guaranteed within one runtime**.
- (c) Golden tests must run per platform. Compare desktop to desktop, and WASM to WASM (the smoke test).
- (d) If cross-platform lockstep or multiplayer is ever needed, replace `Math.Pow` with a deterministic implementation (E15).

**Within one runtime, determinism across save/load is broken today:**
- `WorldSaver` writes `Seed: 0` (WorldSaver.cs:302), and the loader seeds the RNG with it.
- Verified: continuing after a save/load at month 60 produced 31 news events instead of 35 by month 120.
- `PersistenceStringTests.SaveToString_then_LoadFromString_round_trips_and_advances_identically` (inferred; not run here) can pass only while the seed-7 and seed-0 streams happen to agree over the one month it checks.

**Fix:** E4.

### 6.9 What the JavaScript side should cache

| Data | Obtained from | Cache key | Invalidation |
|---|---|---|---|
| `InitResult`, `CatalogDto`, `ScenarioSummaryDto[]` | `init`, `catalog`, `listScenarios` | `contentHash` | Never within a session |
| HUD (`SnapshotDto`) | `envelope.hud`, `advance.snapshot`, `snapshot` | `revision` | Replaced on every response carrying one |
| City view (per city) | `cityView {since}`, `advance.cityView` | `gameId + cityId` → `revision` | Apply deltas; full reload on `gameId` change |
| City layout (EXT) | `cityLayout` | `gameId + cityId + layoutRev` | `layoutRev` change (land sales, construction) |
| Building detail | `building` | `buildingId + revision` | Refetch only while the inspector is open |
| **Closed-period reports** (`period.to < now`) | `incomeStatement`, `cashFlow`, `productProfitability`, `exports`, `monthlyReport`, `explainNetIncome` | `gameId + method + argsJson` | **Never.** Closed months are immutable (§4.6.2). |
| Open-period reports and market | as above | `method + argsJson + revision` | On `revision` |
| News and feed | `news {sinceSeq}`, `activityFeed {sinceSeq}` | seq | Append-only; keep ≤ 500 items client-side |
| History | `history` once, then append `advance.monthSummaries` and the snapshot rows | `gameId` | On load/new game |
| Save list | worker `listSaves` | n/a | After save, delete or import |

- **The skeleton's `useEngineQuery` refetches every open panel on every revision** (useEngineQuery.ts:30-51). Add a `staleTime: 'closedPeriod'` option and a request-coalescing layer (same `method+argsJson` in flight shares one promise).
- **Never cache across `gameId`.**

---

## 7. Tick events: UI juice and audio

### 7.1 Event DTO (CHANGE: additive to the skeleton's `GameEventDto`)

```csharp
public sealed record GameEventDto(string Kind, string Severity, string Message,                       // EXISTS
    decimal? Amount = null, int? BuildingId = null, string? CityId = null, string? ProductId = null,  // EXISTS
    long Seq = 0, DateDto? Month = null, int Priority = 1,                                            // NEW
    int? CompanyId = null, bool? IsPlayer = null, double? Units = null, int? Level = null, int? MaxLevel = null,
    string? TypeId = null, string? GoalId = null, long? NewsSeq = null, string? Reason = null,
    decimal? OldValue = null, decimal? NewValue = null, decimal? Threshold = null, int? Months = null,
    PlacementDto? Placement = null);
```

```ts
export type GameEventKind =
  | 'monthClosed' | 'firstSale' | 'recordMonth' | 'buildingSales' | 'exportSales' | 'netIncomeFlip' | 'lossStreak'
  | 'cashLow' | 'lowRunway' | 'cashNegative' | 'bankruptcyWarning' | 'goalAchieved' | 'goalLost' | 'scenarioWon' | 'scenarioLost'
  | 'news' | 'priceEffectEnded' | 'buildingConstructed' | 'buildingUpgraded' | 'slotConfigured' | 'slotCleared' | 'priceChanged'
  | 'techLevelUp' | 'patentGranted' | 'patentExpired' | 'patentBlocked' | 'licenseGranted' | 'licenseRevoked'
  | 'revenueMilestone' | 'rivalEnteredMarket' | 'rivalUndercut' | 'shareRankFirst' | 'shareMilestone'
  | 'campaignStarted' | 'campaignChanged' | 'campaignCancelled' | 'brandMilestone' | 'brandFading' | 'belowCostPrice' | 'autosaved'
  | 'stockout' | 'overstock' | 'inputShortage'                                                  // E10
  | 'constructionStarted' | 'constructionCompleted' | 'buildingDemolished' | 'landPurchased'    // EXT
  | 'loanTaken' | 'loanPaymentMissed' | 'creditRatingChanged' | 'dividendPaid' | 'ipoCompleted' | 'takeoverBid' | 'macroShift'; // EXT
export interface GameEventDto { kind: GameEventKind; severity: UiSeverity; message: string; amount?: number; buildingId?: number;
  cityId?: string; productId?: string; seq: number; month: DateDto; priority: 0 | 1 | 2 | 3; companyId?: number; isPlayer?: boolean;
  units?: number; level?: number; maxLevel?: number; typeId?: string; goalId?: string; newsSeq?: number; reason?: string;
  oldValue?: number; newValue?: number; threshold?: number; months?: number; placement?: PlacementDto }
```

- The flat shape is source-gen friendly.
- The table below says which fields each `kind` sets. TS consumers narrow on `kind`.
- Priority scale: 0 = ambient only, 1 = feed, 2 = toast-worthy, 3 = must interrupt (VO or auto-pause candidate).

### 7.2 Detection (EventDetector)

**Pre-tick capture**, cheap at O(buildings + slots):
- player cash;
- `NewsLog.Count`;
- building id → (owner, level) map;
- the active patent set;
- tech for every (company, product) that has a research slot anywhere or a retail/production slot for the player;
- rival retail slots in (city, product) markets where the player retails: (buildingId, slotIndex) → price;
- active price-effect keys;
- goal latch state;
- cumulative player revenue (from the index);
- latches.

**Post-tick:** diff against the capture, and read the index for the closed month. The rules below cover UX §8 items 1–38 where today's engine has the data.

| Kind | Rule | Fields | Sev | Pri | Suggested cue (client-owned) |
|---|---|---|---|---|---|
| `monthClosed` | Every month | `amount` = player NI; `month` | success if NI ≥ 0, else warning | 0 | month-close sound at 1× (UX drops the `month_tick` metronome) |
| `firstSale` | First month with player ProductSale > 0 (latched) | `amount`, `buildingId` (largest) | success | 2 | `cash_sale` + VO `vo_first_sale` (new) |
| `recordMonth` | NI > 1.10 × previous max NI and NI ≥ $100k | `amount`, `oldValue` | success | 2 | new `record` SFX |
| `buildingSales` | Per player **retail** building with revenue > 0 | `buildingId`, `cityId`, `amount`, `units` | info | 0 | world popup; `cash_sale` at most once per tick |
| `exportSales` | Per player producer with ExportSale > 0 | `buildingId`, `amount`, `units` | info | 0 | popup |
| `netIncomeFlip` | Sign of NI ≠ the last non-zero sign (zero months ignored; Main.cs:821-838) | `amount`, `reason` = `toProfit`/`toLoss` | success/warning | 2 | `cash_sale` / `notify_warning` |
| `lossStreak` | NI < 0 for 2+ consecutive months, fired at 2, 4 and 6 | `months`, `amount` | warning | 2 | advisor line (UX #6); catches the "losing from day one" gap |
| `cashLow` | Cash < `lowCashThreshold`; re-armed once cash ≥ 2× threshold | `amount`, `threshold` | warning | 2 | `notify_warning` |
| `lowRunway` | `cashRunwayMonths < 3`, once per episode | `months`, `amount` | warning | 2 | heartbeat SFX (new) |
| `cashNegative` | Month-end cash crosses below 0 | `amount` | danger | 3 | `notify_warning`; auto-pause |
| `bankruptcyWarning` | Month-end cash < 0 and not lost yet | `months` = months left until the grace period ends | danger | 3 | "INSOLVENT IN N MONTHS" badge |
| `goalAchieved` | `achievedAt` just set | `goalId`, `message` = description | success | 3 | `goal_achieved`; tutorial VO by goal id (once per save) |
| `goalLost` | A latched goal no longer met | `goalId` | warning | 1 | none |
| `scenarioWon` / `scenarioLost` | Outcome transition (§4.6.6) | `reason` | success/danger | 3 | won: `victory_theme` + `victory_fanfare` + `vo_victory`. Lost: stop music, `defeat`, `vo_defeat_bankrupt` or `vo_defeat_timeup`. |
| `news` | New NewsLog entries | `newsSeq`, `message` = headline, `productId`/`cityId` from the effect | major → warning, else info | major 2, else 1 | `notify_warning` / `notify_info`; newspaper sting for major |
| `priceEffectEnded` | An active effect disappeared | `productId` | info | 0 | none |
| `buildingConstructed` | Command (player), or new ids after a tick (AI) | `buildingId`, `companyId`, `isPlayer`, `typeId`, `cityId`, `amount` = cost, `placement` | success (player) / info (rival) | 1 / 2 | `build_construct` / `notify_info` |
| `buildingUpgraded` | Command, or level diff | `buildingId`, `level` | success | 1 | `upgrade` (asset exists, unused today) |
| `techLevelUp` | tech increased | `companyId`, `isPlayer`, `productId`, `level`, `maxLevel` | success/info | 2/1 | new `tech_up` |
| `patentGranted` | New active patent | `companyId`, `isPlayer`, `productId`, `months` = 24 | success (mine) / warning (rival on a product I research) | 3/2 | stamp SFX / `notify_warning` |
| `patentExpired` | Patent pruned | `companyId`, `productId` | info | 1 | none |
| `patentBlocked` | First month a player research slot is blocked | `productId`, `companyId` = holder | warning | 2 | `notify_warning` |
| `revenueMilestone` | Cumulative player revenue crosses 1M, 10M, 100M, 1B (UX thresholds) | `threshold` | success | 2 | `goal_achieved` |
| `rivalEnteredMarket` | A rival retail slot appears in a (city, product) where the player retails; first time per rival × city × product | `companyId`, `cityId`, `productId`, `amount` = price | warning | 2 | new `rival_alert`; auto-pause (UX) |
| `rivalUndercut` | A rival price in a player market drops ≥ 5% and is below the player's price | `companyId`, `cityId`, `productId`, `oldValue`, `newValue` | warning | 1 | new `price_war` |
| `shareRankFirst` | Player realised share becomes #1 in a market | `cityId`, `productId`, `newValue` = share | success | 2 | new `overtake` |
| `shareMilestone` | Realised share crosses 25/50/75% | `threshold` | success | 1 | none |
| `campaignStarted` / `campaignChanged` / `campaignCancelled` | Command | `productId`, `cityId`, `amount` | info | 1 | `campaign_start` |
| `brandMilestone` | Player brand in (product, city) crosses 30/50/70 | `threshold`, `productId`, `cityId` | success | 1 | new `brand_up` |
| `brandFading` | Brand < 30 after being ≥ 30 with no campaign | `productId`, `cityId` | info | 0 | none |
| `belowCostPrice` | A player retail slot with price < unit cost; first time per slot per 12 months | `buildingId`, `productId`, `newValue` = price, `oldValue` = unit cost | warning | 2 | `notify_warning` |
| `slotConfigured` / `slotCleared` / `priceChanged` | Command | `buildingId`, `productId`, `oldValue`, `newValue` | info | 0 | price-tag SFX |
| `stockout` / `overstock` / `inputShortage` | **E10** per-slot month report | `buildingId`, `productId`, `units` (lost/excess/short) | warning | 1–2 | new `stockout` |
| EXT kinds | §8 | per feature | | | |

**Ordering and volume:**
- Events carry `seq` in detection order.
- Within a month the order is: news, AI construction, rival moves, player sales, milestones, cash, goals, outcome.
- `monthClosed` is last, so the client can use it as the "month is done" marker.
- **Rate limiting is the client's job:**
  - at most 2 toasts per month (Main.cs:812), taken by priority then `seq`;
  - the same SFX at most once per 250 ms;
  - at most one VO per month close (UX §6.4).
- At 4×/8× the client shows only the top 3 world popups.
- The facade caps `buildingSales` / `exportSales` at 50 per month (by |amount|) so batches stay small.

**Persistence:**
- Every event with `priority ≥ 1` goes to the persisted feed.
- `priority 0` events go only into `advance.events` and are not persisted.

---

## 8. Extension points for upcoming engine features

**Common pattern for every feature below:**
1. The flag in `InitResult.features` starts `false`.
2. Methods are registered from day one in `GameSession.Ext.cs` and return `feature_unavailable {feature}` while the flag is off. This lets the web client build and hide the UI against a stable contract.
3. Reserved DTO fields are optional and omitted while off.
4. When the engine lands the feature, the bridge implements the methods, flips the flag, and adds events. **No protocol version bump.**

### 8.1 City layout, plots, zoning (`features.plots`)

- **Engine owner:** the city-layout workstream. The layout is generated deterministically per city from `(cityId, content)`.
- **Engine needs:**
  - `CityLayout {Grid, Roads, Parcels, Water, Ambient}` in the catalog or world;
  - `BuildingInstance.Placement {Px, Pz, Rotation}`, persisted (schema v10);
  - `World.Construct(owner, type, city, PlotRef at)` that validates bounds, overlap, zoning and roads;
  - a save migration that adopts the bridge's `placement` sidecar for legacy games.

```csharp
public sealed record CityLayoutArgs(string CityId);
public sealed record CityLayoutDto(string CityId, int LayoutRev, int GridW, int GridH, IReadOnlyList<RoadDto> Roads,
    IReadOnlyList<ParcelDto> Parcels, IReadOnlyList<WaterRectDto> Water, IReadOnlyList<AmbientDto> Ambient);
public sealed record CityLayoutRefDto(int LayoutRev);                                          // embedded in CityViewDto
public sealed record RoadDto(int Id, string Kind, IReadOnlyList<PlotRefDto> Path, int Lanes);  // kind: highway|arterial|street
public sealed record ParcelDto(int Id, int Px, int Pz, int W, int H, string Zone, decimal LandValuePerPlot, int? OwnerId,
    int? BuildingId, bool ForSale, decimal? AskingPrice, double Traffic);                      // zone: residential|commercial|industrial|agricultural|port|park|civic
public sealed record WaterRectDto(int Px, int Pz, int W, int H);
public sealed record AmbientDto(int ParcelId, string Kind, int Floors, int Variant);           // kind: house|apartment|office|shop|park|field
```

```ts
export interface CityLayoutDto { cityId: string; layoutRev: number; gridW: number; gridH: number; roads: RoadDto[]; parcels: ParcelDto[];
  water: { px: number; pz: number; w: number; h: number }[]; ambient: AmbientDto[] }
export interface CityLayoutRefDto { layoutRev: number }
export interface RoadDto { id: number; kind: 'highway' | 'arterial' | 'street'; path: PlotRefDto[]; lanes: number }
export interface ParcelDto { id: number; px: number; pz: number; w: number; h: number;
  zone: 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'port' | 'park' | 'civic';
  landValuePerPlot: number; ownerId?: number; buildingId?: number; forSale: boolean; askingPrice?: number; traffic: number }
export interface AmbientDto { parcelId: number; kind: 'house' | 'apartment' | 'office' | 'shop' | 'park' | 'field'; floors: number; variant: number }
```

- **Method:** `cityLayout {cityId}`, static-ish and cached by `layoutRev` (§6.9).
- **Changes when the flag is on:**
  - `PlacementDto.source` becomes `'engine'`;
  - `previewBuild.at` is validated by the engine (`zoning_forbidden`, `plot_occupied`, `plot_out_of_bounds`);
  - `catchment` is filled in;
  - `construct.at` becomes required, or auto-sited when omitted.
- **Ambient buildings (houses)** are layout data, not simulated companies. They make the city look like a city, and they occupy parcels.

### 8.2 Land market (`features.landMarket`)

- **Methods:**
  - `parcels {cityId, filter?}` → `ParcelDto[]`;
  - `buyLand {cityId, parcelId}` → `ParcelDto` + `landPurchased`;
  - `sellLand {cityId, parcelId}` → `ParcelDto`.
- **DTO fields:**
  - `BuildPreviewDto.landCost`;
  - `BalanceSheetDto.landValue`;
  - cash-flow investing lines `landPurchases` / `landSales` (new ledger categories `LandPurchase` / `LandSale`).
- **Errors:** `parcel_not_owned`, `parcel_not_for_sale`, `insufficient_funds`.

### 8.3 Construction time (`features.constructionTime`)

- **Engine:** `BuildingInstance.Construction {StartedAt, CompletesAt, CostPaid, CostRemaining}`. The building does not operate until complete; slots may be pre-configured.

```csharp
public sealed record ConstructionDto(DateDto Started, DateDto CompletesAt, double Progress, decimal CostPaid, decimal CostRemaining);
```
```ts
export interface ConstructionDto { started: DateDto; completesAt: DateDto; progress: number; costPaid: number; costRemaining: number }
```

- **Fields:** `BuildingVisualDto.construction`, `BuildingDetailDto.construction`, `BuildPreviewDto.constructionMonths`, `status: 'underConstruction'`.
- **Method:** `cancelConstruction {buildingId}` → `DisposalResultDto`.
- **Events:**
  - `constructionStarted` (from `construct`), with the placement for the scaffold;
  - `constructionCompleted` (tick), which feeds the UX auto-pause "completed and unconfigured".
- **Error:** `under_construction` (upgrade, configure-if-disallowed, demolish).
- **Visual interpolation:** `progress` is month-granular. The client interpolates days with the skeleton's `GameClock.progress`.

### 8.4 Loans and credit (`features.loans`)

**Methods:**

| Method | Args | Result |
|---|---|---|
| `creditProfile` | none | `CreditProfileDto` |
| `loanOffers` | `{amount?}` | `LoanOfferDto[]` |
| `loans` | none | `LoanDto[]` |
| `takeLoan` | `{offerId}` or `{amount, termMonths}` | `LoanDto` |
| `repayLoan` | `{loanId, amount}` | `LoanDto` |

```csharp
public sealed record CreditProfileDto(string Rating, decimal CreditLimit, decimal Outstanding, double InterestRate,
    double DebtToEquity, double InterestCoverage, DateDto NextReview);
public sealed record LoanOfferDto(string OfferId, decimal Amount, int TermMonths, double AnnualRate, decimal MonthlyPayment, string Rating);
public sealed record LoanDto(int LoanId, decimal Principal, decimal Outstanding, double AnnualRate, int TermMonths,
    int MonthsRemaining, decimal MonthlyPayment, DateDto Taken, bool InDefault);
public sealed record TakeLoanArgs(string? OfferId = null, decimal? Amount = null, int? TermMonths = null);
public sealed record RepayLoanArgs(int LoanId, decimal Amount);
```
```ts
export interface CreditProfileDto { rating: string; creditLimit: number; outstanding: number; interestRate: number; debtToEquity: number;
  interestCoverage: number; nextReview: DateDto }
export interface LoanOfferDto { offerId: string; amount: number; termMonths: number; annualRate: number; monthlyPayment: number; rating: string }
export interface LoanDto { loanId: number; principal: number; outstanding: number; annualRate: number; termMonths: number;
  monthsRemaining: number; monthlyPayment: number; taken: DateDto; inDefault: boolean }
```

**Reserved fields:**
- `BalanceSheetDto.liabilities` + `liabilityLines` (kind `loan`/`bond`);
- `IncomeStatementDto.interestExpense` (and `incomeTax`, `depreciation` from the finance workstream);
- cash-flow financing lines `loanProceeds` / `loanRepayments`, and interest under operating;
- `SnapshotDto.player` gains `creditRating?`;
- the outcome rule "bankruptcy" becomes the finance workstream's insolvency rule, with `reason: 'insolvency'` added to `OutcomeDto`.

**Events:** `loanTaken`, `loanPaymentMissed`, `creditRatingChanged`. **Error:** `credit_limit_exceeded`, `loan_not_found`.

### 8.5 Stock market and IPO (`features.stockMarket`)

**Methods:**

| Method | Args | Result |
|---|---|---|
| `stockMarket` | none | `StockQuoteDto[]` |
| `holdings` | `{companyId?}` | `HolderDto[]` |
| `ipo` | `{shares, price}` | `StockQuoteDto` |
| `issueShares` | `{shares, price}` | `StockQuoteDto` |
| `buybackShares` | `{shares}` | `StockQuoteDto` |
| `tradeShares` | `{companyId, shares, side}` | `HolderDto[]` |
| `setDividend` | `{perShareQuarterly}` | `StockQuoteDto` |

```csharp
public sealed record StockQuoteDto(int CompanyId, string Ticker, bool Listed, decimal SharePrice, long SharesOutstanding, decimal MarketCap,
    double? Pe, double DividendYield, double ChangePctMonth, SeriesDto PriceHistory);
public sealed record HolderDto(int? CompanyId, string Name, long Shares, double Pct);
public sealed record IpoArgs(long Shares, decimal Price);
public sealed record TradeSharesArgs(int CompanyId, long Shares, string Side);   // side: buy|sell
public sealed record DividendArgs(decimal PerShareQuarterly);
```
```ts
export interface StockQuoteDto { companyId: number; ticker: string; listed: boolean; sharePrice: number; sharesOutstanding: number;
  marketCap: number; pe?: number; dividendYield: number; changePctMonth: number; priceHistory: SeriesDto }
export interface HolderDto { companyId?: number; name: string; shares: number; pct: number }
```

- **Reserved fields:** `CompanySummaryDto.marketCap?` / `sharePrice?`; cash-flow financing lines `shareIssuance`, `shareBuybacks`, `dividends`.
- **CorporateValue:** stays the dossier formula. Market cap is shown next to it, not substituted.
- **Events:** `ipoCompleted`, `dividendPaid`, `takeoverBid`. **Errors:** `not_listed`, `already_listed`, `insufficient_shares`, `takeover_blocked`.

### 8.6 Macro economy (`features.macro`)

- **Method:** `macro` → `MacroDto`.

```csharp
public sealed record MacroDto(double GdpIndex, double Inflation, double InterestRate, double Unemployment, string Phase,
    IReadOnlyList<CityMacroDto> Cities, SeriesDto GdpHistory);
public sealed record CityMacroDto(string CityId, long Population, double IncomeIndex, double LandPriceIndex, double GrowthRate);
```
```ts
export interface MacroDto { gdpIndex: number; inflation: number; interestRate: number; unemployment: number;
  phase: 'expansion' | 'peak' | 'recession' | 'recovery'; cities: CityMacroDto[]; gdpHistory: SeriesDto }
export interface CityMacroDto { cityId: string; population: number; incomeIndex: number; landPriceIndex: number; growthRate: number }
```

- **Changes when on:**
  - `SnapshotDto` gains `macro? {phase, interestRate}` for the HUD;
  - `CityDto.population` becomes dynamic, so `worldMap` and `cityView` carry the current population;
  - `catalog` keeps the base values.
- **Event:** `macroShift {reason: phase}`.

### 8.7 Engine-side enablers the bridge will switch to

These are not player features, but each has a flag:

| Flag | Engine change | Bridge change when the flag turns on |
|---|---|---|
| `demandModel` | E9 | MarketModel → engine, `modelSource:'engine'`, `suggestPrice` becomes exact |
| `productionLog` | E10 | exact `utilization`, `lastMonthDemand`/`lostUnits`, `stockout`/`inputShortage`/`overstock` events, statuses `starved`/`soldOut` |
| `domainEvents` | E12 | EventDetector consumes `World.DrainEvents()` instead of diffing (the same DTOs) |
| `demolish` | E16 | `demolishBuilding` / `sellBuilding` |

---

## 9. Engine change requests

**Priorities:**
- **P0** = needed for bridge v1 to be correct.
- **P1** = performance or fidelity the UI depends on.
- **P2** = later.

**Schema:** every schema change is additive, targeting v10, with backward-compatible loading of v1–v9. This follows HANDOVER invariant 5.

**Naming:** the ids E1–E18 are this document's change requests. They are unrelated to the E-numbered exploit table in `econ-audit.md`; its "E9" (geography not enforced) corresponds to E6 here.

| ID | P | Change | Evidence / reason | Proposed API | Schema |
|---|---|---|---|---|---|
| E1 | P0 | String/UTF-8 save and load | **Done by the skeleton** (WorldSaver.cs:168, WorldLoader.cs:66). Remaining: a compact (non-indented) UTF-8 overload. | `WorldSaver.SaveToUtf8(World, string? scenarioId, CompanyId? player, bool indented = false) → byte[]`; `WorldLoader.Load(ContentCatalog, ReadOnlySpan<byte>)` | none |
| E2 | P0 | AI registry and accessors | Strategy-name switches are duplicated three times, all private (ScenarioRunner.cs:37; WorldSaver `StrategyName`; WorldLoader `CreateStrategy`). There is no way to read a company's strategy after a load, or to turn autopilot off. | `static class AiStrategies { IAiStrategy Create(string name, IReadOnlyDictionary<string,string>? config = null); string NameOf(IAiStrategy); IReadOnlyList<string> Names }`; `World.TryGetAiStrategy(CompanyId, out IAiStrategy)`; `World.UnregisterAi(CompanyId)` | none |
| E3 | P0 | Validated slot mutators | The Godot client bypassed validation through public setters (BuildingInspector.cs:591, 754-755, 804), and there is no slot removal. | `World.SetRetailPrice(bid, slot, decimal)`, `SetRestockTarget`, `SetWarehouseTarget`, `SetAutoExport(bid, bool)`, `ClearSlot(bid, slot)`. Then make the setters `internal`, keeping the AI's `AdjustRetailPriceAction` working via `SetRetailPrice`. | none |
| E4 | P0 | Persist RNG state and seed | `Seed: 0` always (WorldSaver.cs:302), and the loader reseeds with it (WorldLoader.cs:91). **Verified:** save/load at month 60 changes the news sequence (35 → 31 events by month 120). Breaks "save/load lossless" and any replay. | Replace `System.Random` with a small serializable PRNG (e.g. xoshiro256**, 4 × `ulong` state). `IRandomSource` gains `GetState()/SetState(ulong[])`. Persist `seed` + `rngState`. | v10: `seed`, `rngState: string[]` |
| E5 | P0 | Books close after upgrades | `GetBalanceSheet` adds only `ConstructionCost` (World.cs:930). **Verified:** one supermarket upgrade leaves equity −$720,000 off (cash 48,080,000; buildings 1,200,000; expected equity 50,000,000). | `BuildingInstance.BookValue` (construction + upgrades − accumulated depreciation later), used by `GetBalanceSheet`. Loader fallback for v≤9: construction cost + Σ ledger `UpgradeCost` for that building. | v10: `bookValue` (optional) |
| E6 | P0 | Enforce geography | **Verified:** an `oil_well` was built in Hilltown (`oilRich:false`). By code read, the same holds for inland seaports and farms in non-arable Portbay: `Construct` has no geography check at all. | Check `type.GeographyRequirement` against `city.Geography` in `Construct` and throw `InvalidOperationException`. The bridge pre-validates today. | none |
| E7 | P0 | Tier rules for retail (and research) | **Verified:** `ConfigureRetailSlot(…, "steel", …)` succeeds. The tick restocks it from the world market every month and never sells it (AllocateDemandAndSell skips non-finished, MonthlyTick.cs:340). | Require `Tier == Finished` for retail. For research, decide (Q3): restrict to finished, or document patent-only research. | none |
| E8 | P1 | Month index on the logs | `EntriesInRange` is O(N): 7.1–7.6 ms per one-month query at 46k entries in WASM, and goals call it per goal per month (ConsecutiveProfitable walks up to N months). | Logs keep `List<int> monthStartOffsets` (entries are date-monotonic; assert on `Record`). `EntriesInRange` becomes O(k). | none |
| E9 | P1 | One public demand model | `GetMarketShare` (World.cs:949) diverges from the tick's allocation: no reservation gating, post-sale quality, unsorted float summation. The bridge must replicate private math (MonthlyTick.cs:340-396). | `public static class DemandModel { MarketAllocation Allocate(World, CityId, ProductId, PriceOverride? whatIf = null) }`, used by the tick, by `GetMarketShare` and by the bridge (`suggestPrice` what-if). The economics workstream's elastic demand plugs in here. | none |
| E10 | P1 | Per-month operating report (transient) | Units sold, lost sales, stock-outs, production utilization and input shortages are computed during the tick and then discarded. The UX report calls this P0. | `World.LastMonthReport` (not persisted, or last 24 months persisted per UX): retail slot `{demand, sold, lost, endStock, revenue, cogs}`; production slot `{maxCycles, cycles, output, shortInputs[]}`; extraction `{output}` | optional v10 |
| E11 | P1 | Quantities on ledger entries | Exports and purchases only know amounts. Reports reconstructed units from revenue ÷ base price (defect #29). | `LedgerEntry.Quantity` (double?, nullable) set by sales, exports, market buys and shipping | v10 optional field |
| E12 | P2 | Domain events | The bridge diffs pre/post state to find AI actions, tech-ups, patents and so on. | `World.DrainEvents() → IReadOnlyList<DomainEvent>` (sealed records: `BuildingConstructed`, `BuildingUpgraded`, `TechLevelUp`, `PatentGranted`, `PatentExpired`, `NewsFired`, `RetailSlotChanged`, …), appended by World methods and the tick, including AI actions | none (transient) |
| E13 | P2 | `IContentSource` + source-generated loaders | Content load takes 368–486 ms in WASM (reflection JSON cold start); mods need non-directory sources. | `ContentLoader.Load(IContentSource)`, `ScenarioLoader.LoadAll(IContentSource)`; nested `JsonSerializerContext` for the private DTOs | none |
| E14 | P1 | Save compaction | 13.6 MB per 10 years: compact JSON saves 31%, dropping memos another 19% (gzip 1.28 → 0.92 MB). Long games grow without bound. | Compact JSON by default; memos not persisted (regenerated from category/product/building on load); money rounded to cents at `RecordCashChange`, which is also realistic accounting (decision with finance); optional roll-up of ledger months older than N years into per-(company, category, product, building, month) aggregates | v10 |
| E15 | P2 (P0 if multiplayer) | Cross-runtime deterministic math | **Verified:** desktop vs WASM cash differs at 1e-9 after 120 months; the cause is inferred as `Math.Pow` (MonthlyTick.cs:359). | A deterministic `Pow` (e.g. `exp(ε·log(p))` via fixed-precision managed routines), or precomputed price^ε per slot per tick in decimal | none |
| E16 | P1 | Demolish or sell a building | Required by the UX (event #36) and by the building lifecycle. | `World.DemolishBuilding(bid) → DisposalResult` / `SellBuilding(bid, buyer?)`. Liquidate or write off inventory; salvage proceeds as `AssetSale` (investing inflow); the difference to `BookValue` is a gain or loss. That needs a non-cash journal, so it is designed together with finance's depreciation. Removes the building from `_buildings` and `Company.OwnedBuildings`; campaigns are unaffected. | v10 ledger categories |
| E17 | P2 | `BuildingInstance.BuiltAt` | "Since open" needs an O(ledger) scan (BuildingInspector.cs:417-427). | `GameDate BuiltAt`, persisted; fallback to the first `ConstructionCost` entry | v10 optional |
| E18 | P2 | Goal ids and scenario metadata | Goals are keyed by description today; tutorial steps are tied to goal index (GuidedTutorial.cs:44-66). | Optional `id` (and UX's `mode: reachOnce|holdAtDeadline`, `difficulty`) on scenario goals in `ScenarioLoader`; `Goal` gains `Id`. Also fix the two unwinnable deadlines (UX §3.5). | content only |

---

## 10. Testing strategy

**1. Bridge unit tests** (`engine/Magnate.Bridge.Tests`, xUnit, desktop): one class per partial. Required cases:
- **Envelope:** every error code reachable from at least one test. `field` and `details` are asserted.
- **Parity (§4.5):** index income statement, product P&L and cash-at-month-end match the engine for all companies across a 120-month `four_archetype_melee` autopilot run (seed 42, 50 random windows).
- **Goal parity:** facade `met`/`progress` equals `Goal.Evaluate` on every month of every scenario, running 36 months with player autopilot.
- **Cash flow:** `reconciles == true` for every month of the run, and every `LedgerCategory` value is mapped (an enum sweep).
- **Atomic construct:** every invalid `initialSlot` is rejected **before** cash changes (cash is unchanged, no new building).
- **Determinism:** two sessions with the same seed and command script give byte-identical `SaveBinary` output (gzip at a fixed level; compare the uncompressed envelope). After E4, also save → load → continue equals uninterrupted.
- **Legacy import:** the Godot-era fixtures from `PersistenceTests` (v1–v9) load, and history backfill equals ledger-derived values.
- **Content mismatch:** a save referencing `product:nope` returns `save_content_mismatch {missing}`.
- **Release surface:** `MethodNames` contains no `debug*` except `debugStats`.

**2. TS ↔ C# contract fixtures:**
- A C# test (`ProtocolFixtureTests`) calls every method with canned args on a seeded session and writes `web/src/bridge/__fixtures__/<method>.json`. The fixture holds the args and the result, pretty-printed and stable.
- A vitest file imports each fixture and asserts `fixture.result satisfies MethodResult<'<method>'>` (type-level), plus a runtime key-set check (no unknown keys).
- CI fails when fixtures change without a matching `protocol.ts` change (`git diff --exit-code` on fixtures after the C# test runs).

**3. Performance** (desktop, in `Magnate.Bridge.Tests`, category `perf`, not on every CI run):
- a 120-month autopilot run;
- assert `snapshot` < 1 ms and `advance` bridge overhead < 5 ms (desktop). Desktop is about 1.2–4× faster than WASM for queries and ticks, and 5–7× faster for save/load serialization, per §1.

**4. Browser smoke** (`web/scripts/smoke.mjs`, EXISTS; extend):
- boot → newGame(tutorial) → construct with `initialSlot` → advance 12 → `building` → `incomeStatement` → `cashFlow.reconciles` → `SaveBinary` → reload page → `LoadBinary` → equal snapshot;
- one pass calling **every** registered method once, to catch trimming issues (warnings are suppressed, §6.6);
- record `engineMs` / `bridgeMs` for the year-10 budgets in §4.8.

**5. Cross-runtime golden test** (E15 status indicator): run the same 120-month script on desktop and in WASM and compare the ledger count, news sequence and cash to 1e-6. Expected to pass at 1e-6 today and fail at bit-exact.

---

## 11. Implementation plan

The plan is ordered and parallelizable. File ownership follows the skeleton's partial-per-area convention.

| Step | Owner files | Deliverable | Depends on |
|---|---|---|---|
| B0 | Protocol/*, GameSession.cs, protocol.ts, engine.ts | Envelope (`hud`, `events`, `field`, `details`), `ErrorDetailsDto`, `Guard`, `BridgeJsonContext`, money/finite converters, `Faulted`; TS types for §5.0–5.1; `unwrap` pushes `hud`/`events` | none |
| B1 | Model/LedgerIndex, Periods, CorporateValue, GoalTracker, MetricsHistory; GameSession.Game.cs | Index + parity tests; CHANGE `snapshot`, `advance` (monthSummaries, playerActivity, stopOn, autosaveDue), `goals`, `history`, `companies`, `settings` | B0 |
| B2 | Model/SlotRules, Placement; GameSession.Buildings.cs, GameSession.City.cs | `catalog` CHANGE, `building`, `buildings` CHANGE, `cityView` (+delta), `worldMap`, `previewBuild`, `construct` CHANGE (atomic, `initialSlot`, `at`), `buildStarterPlan`, slot commands, `upgradeBuilding`, `supplyFlows` | B1 |
| B3 | GameSession.Finance.cs | `incomeStatement`, `balanceSheet`, `cashFlow`, `productProfitability`, `exports`, `ledger`, `monthlyReport`, `explainNetIncome` | B1 |
| B4 | Model/MarketModel; GameSession.Market.cs, .Marketing.cs, .Research.cs | Market trio + `suggestPrice`; ads; `researchTree`, `patents`, licenses | B1 |
| B5 | Model/EventDetector, Advisor, Difficulty; GameSession.Progress.cs | Event taxonomy (§7), feed, `news`, `advisor`, `statsDashboard`, outcome, `listScenarios` CHANGE | B1–B4 |
| B6 | Persistence/WebSave; engine-host/Program.cs; engine.worker.ts; workerProtocol.ts | Web envelope + sidecar, binary JSExports, IndexedDB store, autosave rotation, import/export, legacy import, content check, `bootProgress` | B1, B5 |
| B7 | GameSession.Ext.cs; protocol.ts | EXT stubs + `features` + reserved fields (§8) | B0 |
| B8 | Tests/fixtures | Contract fixtures, smoke-test extension, perf category | continuous |

**Engine track in parallel:** E2, E3, E4, E5, E6 and E7 first (small, P0), then E8, E11 and E14, then E9 and E10 together with the economics workstream.

The bridge ships workarounds for every P0 until the engine lands:
- E2: duplicated switch;
- E3: public setters after validation;
- E5: book value computed from the ledger;
- E6/E7: facade validation.

E4 has **no bridge workaround**: determinism across load stays broken until it lands.

---

## 12. Open questions (need the lead or the user)

1. **Corporate value definition.** Goals use TotalAssets (Goal.cs:32), the HUD and dossier use Equity + 10 × trailing-12 NI, and StatsDashboard labelled TotalAssets as CV. The spec exposes both. Should `corporateValue` goals switch to CV? That changes scenario difficulty, which is the economics/scenario workstreams' call.
2. **Win rule.** "All goals met at the same time" (Godot parity), or "every goal latched at some point" (`achievedAt`), or per-goal `mode: reachOnce | holdAtDeadline` (UX)? The spec implements parity plus latching data.
3. **Tier rules.** Should the engine forbid retailing non-finished goods (E7)? Should research on non-finished products be allowed, given that it only affects patents today?
4. **Rival transparency.** Rival cash, statements, strategy names and ledgers: the spec shows statements and cash (CapLab-like), hides ledgers, and exposes the strategy name. Confirm.
5. **Market-share goal semantics.** Keep `GetMarketShare` (model share, no reservation gating, collapses when sold out), or switch the goal to **realised** unit share as the UX recommends? That changes scenario balance.
6. **Bankruptcy rule** once loans exist: 6 months of negative cash, or the finance workstream's insolvency model? Who owns the rule?
7. **Cross-runtime determinism.** Is bit-exact desktop↔browser replay a requirement (multiplayer or verified replays)? If yes, E15 becomes P0.
8. **Placement authority before engine plots.** Accept the facade's interim placement (persisted sidecar, `source:'bridge'|'auto'`), or block player placement until the layout engine lands?
9. **The skeleton's string `saveGame`.** Keep it (dev/tests) alongside the binary path, or remove it once the worker save store exists? The spec keeps it, marked dev-only.
10. **Save retention and backup.** 3 autosaves + quicksave + unlimited manual saves in IndexedDB; is cloud sync or export nudging in scope?

---

## Appendix A: Harnesses and raw results

Scratch root: `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/bridge-spec/`

| Path | What | Run |
|---|---|---|
| `engine-copy/Magnate.Engine/` | A read-only copy of the engine sources, so builds never write `obj/bin` into the project tree | n/a |
| `bench/` (assembly `Magnate.Engine.Tests`, for internals access) | Desktop harness. `tick` = tick/query/save costs for three scenarios; `upgrade` = books-close drift; `culture` = exception texts under invariant globalization, the geography gap, the retail tier gap; `rng` = save/load determinism; `size` = save-format sizes; `fp` = fingerprint | `export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet"; dotnet bench/bin/Release/net8.0/Magnate.Engine.Tests.dll <mode>` |
| `wasmbench/` | browser-wasm build of the engine with embedded content and `[JSExport]` benches (`Init`, `NewGame`, `RunMonths`, `Queries`, `SaveLoad`, `SaveBytes`, `GzipTest`, `LoadFromBytes`, `Fingerprint`); `wwwroot/main.js` (main-thread mode) and `worker.js` (worker mode with a rAF frame-gap probe) | `dotnet publish -c Release -o out` then `node run-bench.mjs wasmbench/out/wwwroot "main"`, `"worker"` or `"main&bytes=1"` |
| `run-bench.mjs` | Headless Chrome runner (puppeteer-core from `../tools/node_modules`) | as above |

**Selected raw output:**

```
[culture] InvalidOperationException: company 'Poor' has ¤1,000.00 but supermarket costs ¤1,200,000.00
[culture] KeyNotFoundException: The given key 'nope' was not present in the dictionary.
[geo] oil_well built in hilltown (oilRich=false): B2
[retail] steel accepted in a supermarket retail slot
[upgrade] cash=48,080,000 buildingValue=1,200,000 equity=49,280,000 expected(start+NI)=50,000,000 drift=-720,000
[rng] identical=False   (A: 35 news events over 120 months; B: save/load at month 60 → 31 events)
[size] indented=13,649,634 compact=9,451,752 compactNoMemo=7,648,437 gz(indented)=1,281,097 gz(compact)=1,224,108 gz(noMemo)=916,744
[four_archetype_melee] 120 ticks desktop: avg=10.31 p50=8.26 p95=30.29 max=146.55 ms; ledger=46,090 cogs=13,311 saveBytes=13,649,634
WASM worker: runtime ready 257 ms; init: extract 50.8 ms, ContentLoader 368.2 ms, ScenarioLoader 85.2 ms
WASM year 5: avg 31.96 ms/tick (p95 33.8); year 10 (main): avg 34.2 ms/tick
WASM queries @46k: IncomeStatement(month)=7.12ms EvaluateGoals=7.42ms ConsecProfit18=6.40ms MarketShareGrid=15.20ms SnapshotSerialize=28.56ms (37,756 chars)
WASM save/load: WorldSaver.Save=1,438–1,788 ms, WorldLoader.Load=2,529–3,226 ms, string marshal 13.6M chars=1,315–1,532 ms,
                byte[] marshal ≈690 ms ("[object Uint8Array]"), GZipStream Fastest 163 ms (→1,618,021 B), JS gzip 307–365 ms (→1,235,854 B)
Worker mode: main thread frames=144 worstFrameGap=16.8ms while ticking 60 months
FINGERPRINT desktop cash C1=635046.2284922047155000  WASM C1=635046.2284922062905000 (ledger 46,090 and news sequence identical)
Empty-sequence exception text in WASM Release: "NoElements" (UseSystemResourceKeys)
```
