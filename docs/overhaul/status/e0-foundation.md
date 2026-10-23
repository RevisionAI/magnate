# E0 engine foundation — status

**Workstream:** E0 (Wave 1) · **Branch:** `e0-foundation` · **Date:** 2026-10-01 · **State:** done (gaps listed below)

E0 restructured the engine so that Wave 2 can build the realistic economy in parallel without changing Classic behaviour. Market (E1), finance (E2) and land integration (E3b) each work behind a rules flag. Classic behaviour is unchanged to the last digit; the golden masters prove it.

The only deliberate change to Classic is in the balance sheet: upgrade capex is now capitalised (econ F8 / bridge E5). It moved one balance-sheet line in one golden master; cash and the ledger did not change (§4).

---

## 1. What exists now (file map)

### Engine (`engine/Magnate.Engine/`)

| Area | Files | What it is |
|---|---|---|
| Rules | `Rules/EconomyRules.cs`, `Rules/MarketRules.cs`, `Rules/FinanceRules.cs`, `Rules/LandRules.cs`, `Rules/MacroRules.cs` | The immutable ruleset each world holds (`world.Rules`). `EconomyRules.Classic` turns every area off; `EconomyRules.Realistic` turns every area on. Each area record is owned by one Wave 2/3 workstream. |
| World | `Simulation/World.cs` (state, constructors, companies, `RecordCashChange`, `RecordAccrual`, `RecordCogs`, persistence accessors), `World.Construction.cs`, `World.Advertising.cs`, `World.Research.cs`, `World.EventsNews.cs`, `World.Reports.cs`, `World.Ai.cs` | Partial files by area. The split is a pure move; the new members are listed in §2. |
| Tick | `Simulation/MonthlyTick.cs` (orchestrator plus `MonthlyTick.Pipeline`), `Simulation/Tick/TickContext.cs`, `Simulation/Tick/<Name>Step.cs` ×19 | The econ §4.16 order. The Classic path is today's code, moved verbatim. New steps are rule-gated no-ops marked `TODO(owner)`. |
| Ledger | `Economics/Ledger.cs` (+26 categories, per-section running totals, range index), `Economics/LedgerCategoryInfo.cs` | Every econ §4.15 category. Metadata per category: statement section, cash-flow class, company-level flag, normal sign. |
| Accruals | `Economics/AccrualJournal.cs` | Append-only non-cash journal. Kinds: `Depreciation`, `DisposalGainLoss`, `ConstructionWriteOff`, `InventoryWriteDown`. |
| Statements | `Economics/IncomeStatement.cs`, `Economics/BalanceSheet.cs`, `Economics/CashFlowStatement.cs` | Computed from the metadata. `IncomeStatement` gains `Depreciation`, `NonOperatingIncome`, `IncomeTax`, `Ebitda`, `Ebit` and `PreTaxIncome`. `GetCashFlowStatement` is new. |
| Range index | `Economics/ChronologicalIndex.cs` | Gives `EntriesInRange` O(log n + k) on all four logs (bridge E8). |
| Book value | `Simulation/BuildingInstance.cs` | New members: `CapitalizedCost` (construction plus upgrades), `AccumulatedDepreciation`, `BookValue`, `BuiltAt` (E17). |
| RNG | `Simulation/Rng.cs` | Named streams with persisted state; `RngStreams` on `World`. `LegacyRandom` is a bit-exact, serialisable copy of seeded `System.Random`; `Xoshiro256StarStar` serves new consumers. Also `SplitMix64` and `Fnv1a64`. |
| Persistence v10 | `Persistence/WorldSaveFile.cs`, `WorldSaver.cs`, `WorldLoader.cs`, `Persistence/Sections/{Land,Finance,Market,Macro}SaveSection.cs` | Saves the real seed, a full rules snapshot, RNG stream states, the accrual journal and the nullable extension sections. A save/load round trip is lossless. Loading accepts v1–v10. |
| AI registry | `Ai/AiStrategies.cs` | One name ↔ strategy ↔ config registry (E2), used by the scenario runner, saver, loader and bridge. |
| Tools | `tools/MagnateSim/Program.cs` | New `--rules classic\|realistic` flag (default `realistic`). |

### Tests (`engine/Magnate.Engine.Tests/`)

| Path | What it is |
|---|---|
| `TestSupport/TestContent.cs` | Shared content resolver. Order: `MagnateRepoRoot` assembly metadata, then the `MAGNATE_CONTENT_ROOT` override for live content, then a walk up to `global.json`. Catalogs and scenarios are cached (`Live`, `Classic`, `LiveScenarios`, `ClassicScenarios`). |
| `TestSupport/Worlds.cs` | `Worlds.Classic/Live/Realistic/On/ApplyClassicScenario`. `Rulesets.All` supplies member data for `[Theory]` tests. |
| `TestSupport/Invariants.cs` | `Invariants.AssertAll(world)` (§6.3). |
| `TestSupport/StateDigest.cs` | Canonical text of the whole world state plus its SHA-256. Supports `FirstDifference` for line-precise diffs. |
| `TestSupport/GoldenScenarios.cs` | The 8 scripted golden runs. |
| `TestSupport/TechPoints.cs` | Research-threshold helper; replaces the literal `100.0` (test-map D9). |
| `Fixtures/classic-content/` | Frozen byte copy of `content/data` and `content/scenarios` as of 2026-10-01. **Never edit.** |
| `Fixtures/golden/classic/*.txt` | Approved golden digests (monthly cash trail plus the full digest). |
| New test classes | `GoldenMasterTests`, `InvariantTests`, `RulesetInvariantTests`, `SaveLoadDeterminismTests`, `PersistenceV10Tests`, `RngTests`, `EconomyRulesTests`, `LedgerCategoryInfoTests`, `TickPipelineTests`, `EngineChangeRequestTests` |

All 18 copy-pasted `ContentRoot()`/`NewWorld()` helpers are gone. Every test class uses TestSupport.

---

## 2. How other workstreams use it

### 2.1 Where Wave 2 code goes

| Workstream | Rules record | Tick steps to fill | Persistence section | Suggested new code location |
|---|---|---|---|---|
| **E1 market** | `Rules/MarketRules.cs` | `PayrollStep` (wages, utilities, maintenance, insurance, property tax), `AdvertisingStep` (§4.20), `DemandStep` (§4.1–4.3), `RestockStep` (caps), `ExportStep` (§4.4), `IncumbentsStep` | `Persistence/Sections/MarketSaveSection.cs` | New `engine/Magnate.Engine/Market/` (demand model, world-market depth), called from the steps. Content rebalance goes in `content/` (Classic tests do not read it). |
| **E2 finance** | `Rules/FinanceRules.cs` | `FinanceStep`, `DepreciationStep`, `TaxStep`, `QuarterEndStep`, `SolvencyStep` | `FinanceSaveSection.cs` | New `engine/Magnate.Engine/Finance/` (loans, revolver, rating, tax state, asset register). Statements stay in `Economics/` and `World.Reports.cs`. |
| **E3b land integration** | `Rules/LandRules.cs` | `ConstructionStep` (instalments, completion, CIP → PP&E) | `LandSaveSection.cs` | `engine/Magnate.Engine/Land/` (E3a's generator) plus construct-at-plot overloads in `World.Construction.cs`. |
| **E5 macro / equity** (Wave 3) | `Rules/MacroRules.cs` | `MacroStep`, `WorldPricesStep`, the share-price part of `QuarterEndStep` | `MacroSaveSection.cs` | `engine/Magnate.Engine/Macro/` |

### 2.2 How rules gate behaviour

- Add fields to *your* area record as `init` properties.
  - **The default value must be the neutral value**: the one that reproduces Classic exactly (factor 1, rate 0, months 0, `false`).
  - `EconomyRules.Realistic` sets the gameplay value.
  - Saves persist the whole record, so a field missing from an older v10 save loads as its neutral default. Never rename a field; add a new one instead.
- Engine code reads `world.Rules.<Area>` (`ctx.Rules` inside tick steps). The Classic path must stay byte-identical:
  - **Use fast paths for neutral knobs.** Write `if (factor != 1m) price *= factor;`. Multiplying a decimal by `1.0m` changes its *scale*: the value is equal, but the saves and the golden digests differ.
  - **Never gate on `Preset`.** Gate on the area flags or on specific knob values.
  - **No statics.** Rules are per world, and test classes run in parallel.
- Rules fields must be JSON-serialisable with System.Text.Json defaults: primitives, strings, records, lists, and string-keyed dictionaries. Validate ranges in `EconomyRules.Validate()`.
- `ScenarioRunner.Apply(catalog, scenario, seed, rules = null)` defaults to **Realistic**. So do the bridge's `newGame`, MagnateSim and the legacy Godot client. `new World(catalog, seed, start)` defaults to **Classic**.

### 2.3 How to implement a tick step

```csharp
internal static class FinanceStep            // Simulation/Tick/FinanceStep.cs
{
    public static void Run(TickContext ctx)
    {
        if (!ctx.Rules.Finance.Enabled) return;   // Classic: no-op, keep it first
        foreach (var company in ctx.World.Companies.Values.OrderBy(c => c.Id.Value))   // ordinal order only
        {
            // cash moves: ctx.World.RecordCashChange(company.Id, LedgerCategory.InterestExpense, -interest, "interest");
            // non-cash:   ctx.World.RecordAccrual(company.Id, AccrualKind.Depreciation, -charge, "dep", buildingId);
            // randomness: ctx.World.RngStreams.Get(RngStreams.MarketStream).NextDouble();
        }
    }
}
```

`TickContext` provides:

| Member | What it holds |
|---|---|
| `World` | The world being advanced. |
| `Rules` | Shortcut for `World.Rules`. |
| `Now` | The month being simulated; the clock has already advanced. |
| `Buildings` | Every building, ascending by id, snapshotted at tick start. |
| `IsQuarterEnd` | True in months 3, 6, 9 and 12. |
| `IsYearEnd` | True in December. |

Rules for every step:

- **Do not reorder or rename** `MonthlyTick.Pipeline`. `TickPipelineTests` pins the order and the golden masters pin its effects. To add a step, insert it at the econ-§4.16 position and add it to the pipeline test.
- **Iterate in ordinal or id order.** Never iterate an unsorted dictionary when the order affects results.
- **Move cash only through `World.RecordCashChange`.** This is the only cash mutation point; it keeps `Cash == Σ ledger`. Pass `building:` for building-driven flows and `quantity:` for per-unit flows.
- **Book non-cash items only through `World.RecordAccrual`.** For a depreciation entry it also maintains `BuildingInstance.AccumulatedDepreciation`, so `BookValue` and the balance sheet stay in step.
- **Draw randomness from a named stream** (`world.RngStreams.Get(name)`). Never use `new Random()`. A new stream never shifts the `events` stream, and every stream's state is saved.
- **Operational state.** Under Land rules, E3b will add buildings that are not operational yet. Steps that run operations must then skip them (see the `TickContext.Buildings` doc).

### 2.4 Ledger categories and statements

- Every category in the econ §4.15 table exists (`LedgerCategory`, appended; saves store it by name). **Use them; do not invent new ones.** If one is genuinely missing, append it *and* map it in `LedgerCategoryInfo.BuildTable()`. The static initialiser throws if any category is left unmapped.
- **`LedgerCategoryInfo.Of(c)`** gives four fields:

  | Field | Values |
  |---|---|
  | `Section` | Revenue / InventoryCapitalized / OperatingExpense / NonOperating / IncomeTax / Capex / Financing / EquityContribution |
  | `CashFlow` | Operating / Investing / Financing |
  | `IsCompanyLevel` | true when entries may carry no building |
  | `NormalSign` | +1 inflow, −1 outflow, 0 either way |

- **The statements are computed from the metadata:**

  | Statement | Computed as |
  |---|---|
  | `GetIncomeStatement` | Revenue, OperatingExpenses (+ depreciation), NonOperatingIncome and IncomeTax by section; COGS from the COGS log + `InventoryWriteDown` accruals; gains and write-offs below EBIT. |
  | `GetBalanceSheet` | `BuildingValue` = Σ `BookValue`; `Liabilities` = the running total of the Financing section (net loan and revolver principal). |
  | `GetCashFlowStatement` | Ledger amounts by `CashFlow` class. |

- **Balance-sheet hooks Wave 2 must add.** Land, CIP and an asset register do not exist yet:
  - When E3b books `LandPurchase` or `ConstructionPayment`, it must add land and CIP to the balance sheet (new fields on `BalanceSheet` and `BuildingInstance`), or the books stop closing. `Invariants.AssertAll` will tell you.
  - E2 adds the equity split (`PaidInCapital` / `RetainedEarnings`) and loan registers. Cross-check them against `Ledger.SectionTotal(company, StatementSection.Financing)` / `EquityContribution`.

### 2.5 How to add a persistence section

1. Add optional `init` properties to your `Persistence/Sections/<Area>SaveSection.cs` record.
   - Store decimals as strings (`ToString(CultureInfo.InvariantCulture)`), the convention everywhere in the save.
   - Keep lists in engine order whenever the order affects the simulation.
2. Fill `Capture(World)`. Return `null` when there is nothing to save; the section is then omitted, which is what Classic needs.
3. Fill `Restore(World, section)`. The loader calls it after companies, buildings, logs and RNG are restored. `null` means the save had no section.
4. Add a round-trip test. `SaveLoadDeterminismTests` and `RulesetInvariantTests.Save_load_mid_run_is_lossless` must stay green. They compare the full digest and the save bytes after a load.

**What v10 already stores:**

| Field | Contents |
|---|---|
| `seed` | The real world seed (pre-v10 saves always wrote 0). |
| `rules` | The full snapshot. |
| `rng[]` | `{name, algorithm, state[]}` for every stream created so far. |
| `accrualJournal` | Omitted when empty. |
| `land` / `finance` / `market` / `macro` | The extension sections; null for now. |
| Per building | `capitalizedCost`, `builtYear`, `builtMonth`. |
| Per inventory entry | `qualityMass`. Entries are written in engine order, empty ones included. |
| Slots | Written in list order. |
| Per ledger entry | `quantity`. |

Loading older saves: v1–v9 load as **Classic**, with the RNG reseeded from the saved seed (always 0 — the documented legacy behaviour). Their capitalised cost and `builtAt` are rebuilt from the ledger.

New I/O entry points: `WorldSaver.SaveToUtf8(world, …, indented: false)` (compact) and `WorldLoader.Load(catalog, ReadOnlySpan<byte>)`. These are the bridge's binary-save path (E1).

### 2.6 How to use TestSupport

```csharp
var world = Worlds.Classic();          // pins today's numbers: Classic rules + frozen Classic content
var world = Worlds.Live();             // mechanics/invariants on live content (Classic rules)
var world = Worlds.Realistic();        // gameplay rules on live content
[Theory, MemberData(nameof(Rulesets.All), MemberType = typeof(Rulesets))]
void Test(string preset) { var world = Rulesets.World(preset); ... }
Invariants.AssertAll(world);           // after every tick in any multi-month test
Assert.Equal(StateDigest.Of(a), StateDigest.Of(b));   // whole-state equality
```

**Golden masters.**

- `GoldenMasterTests` replays `GoldenScenarios.All` under Classic rules on the Classic fixture. Each run is checked two ways:
  - against the committed digest in `Fixtures/golden/classic/<name>.txt`, which gives a line-precise diff on failure;
  - against literals in the test (SHA-256, ledger count, per-company cash, news sequence).
- **Re-approval is deliberate and reviewed:**
  1. Run `MAGNATE_UPDATE_GOLDEN=1 dotnet test --filter GoldenMasterTests` to rewrite the text files.
  2. Update the literals.
  3. Explain the diff in the commit message.
- A Wave 2 change should never need re-approval, because Realistic code paths do not touch Classic.

**Digest format v1 is frozen.** New state may only add lines that are absent for a Classic world. The digest is per-runtime: captured with .NET 8 CoreCLR on macOS x64 (D18).

### 2.7 Which tests are pinned to Classic

61 tests carry `[Trait("Ruleset", "Classic")]` (run them with `dotnet test --filter Ruleset=Classic`):

- **53 tests** from test-map §4 read the frozen fixture: 31 CLASSIC, 15 CLASSIC+TWIN, 6 SNAPSHOT, and the content-coupled FIX test `TechLeader_prices_hero_at_premium_above_competitor`.
- **8 golden masters.**

Everything else reads live content and must stay green under rebalancing. Two live tests that broke under the test-map content mutations now derive their numbers from the catalog:

- `Insufficient_cash_throws_without_mutating_state` (C04);
- `Market_bought_goods_carry_world_market_quality` (C03).

The CLASSIC+TWIN tests still need their Realistic twins (test-map §7.6). Writing them is the job of the workstream that changes the behaviour.

The following test is **expected to fail once the first Realistic mechanic lands**. Delete it then:

- `EconomyRulesTests.Realistic_matches_classic_until_wave_2_mechanics_land`

These must stay green forever:

- `RulesetInvariantTests` (16 scenarios × both presets × 24 months, invariants every tick; scripted chain books, determinism, save/load under both presets);
- `SaveLoadDeterminismTests`;
- `InvariantTests`.

---

## 3. Verification evidence

All runs were on this worktree, with machine load average 18–30 from parallel agents.

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` (includes the Godot client, tools, bridge, Wasm host deps) | `0 Error(s)`. Remaining warnings are pre-existing CS1591s, which are exempt; down from 217 to 139 unique after docs were added to the restructured files. |
| `dotnet test Magnate.sln --no-build` | Engine `Passed! - Failed: 0, Passed: 387` (baseline 231, so +156). Bridge `Passed! - Failed: 0, Passed: 6`. |
| Golden masters | 8/8 identical to the pre-refactor capture (baseline `338082f`); one re-approved for the balance sheet only (§4). The cockpit, vertical_showdown and four_archetype_melee runs reproduce the test-map §7.4 fingerprints exactly, e.g. Acme `51334430.26069907220`, Zenith Labs `73082411543.347296159944257578`, 17,668 ledger entries. |
| RNG | `LegacyRandom` matches `System.Random` over 10,000 interleaved `NextDouble`/`Next(n)` draws for 16 seeds, including `int.MinValue`. xoshiro256**, SplitMix64 and FNV-1a match published vectors. |
| Save/load | Run 60 months uninterrupted, versus 30 months + save + load + 30 more: the full digest, the RNG states and the save bytes are identical for 7 golden scenarios via `SaveToString` and 2 via file. `SaveToString(Load(SaveToString(w))) == SaveToString(w)` holds for all of them. |
| Mutation checks | Dropping the RNG restore fails all 17 save/load tests. Dropping the exact `qualityMass` restore fails 10. |
| `(cd web && node scripts/build-engine.mjs && npx vite build && node scripts/smoke.mjs)` | `copied 60 files (9.2 MB)`, `✓ built`, `SMOKE OK` (boot engine + title, start tutorial, construct supermarket, advance a month). |

---

## 4. Golden re-approval (upgrade capitalisation)

`UpgradeBuilding` now adds the upgrade cost to `BuildingInstance.CapitalizedCost`, and the balance sheet sums book values. This applies to every ruleset (test-map D2 / econ F8 / bridge E5). Before the fix, equity fell short of starting capital plus net income by exactly the upgrade capex.

Only the `upgrades_warehouse_chain_24` golden changed, and only in one line:

| Line | Before | After |
|---|---|---|
| ChainCo `buildings` | 4,650,000 | 7,020,000 |

The difference, +2,370,000, is the four upgrades: 720k + 900k + 600k + 150k. Assets and equity rose by the same amount.

Cash, every ledger, COGS and transfer entry, the inventories and the news log are bit-identical. The SHA-256 literal changed from `ae063628…` to `196ba1f6…`. Pre-v10 saves rebuild the capitalised cost from their `UpgradeCost` ledger entries.

---

## 5. Known gaps

- **Realistic mechanics are stubs.** This is by design: E1, E2, E3b and E5 fill them. Under Realistic today, only validation differs from Classic:
  - geography is enforced in `Construct` (E6, `Land.Enabled`);
  - retail slots accept finished goods only (E7, `Market.Enabled`).
- **Bridge §9 requests not done** (bigger, or owned by Wave 2):

  | Request | What it is | Owner / why |
  |---|---|---|
  | E9 | One public demand model shared by the tick, `GetMarketShare` and the AI | E1 |
  | E10 | Per-month operating report | E1 + bridge |
  | E12 | Domain events | P2 |
  | E13 | `IContentSource` / source-generated loaders | P2 |
  | E14 | Save compaction defaults | See below |
  | E15 | Cross-runtime deterministic math | P2 |
  | E16 | Demolish/sell | Needs the E2 asset register |
  | E18 | Goal ids | Scenario content is not E0's |

  E14 detail: the compact UTF-8 API exists, but the file format is still indented, memos are still persisted and there is no cent rounding — a finance/bridge decision.
- **Research slots accept any product tier.** This is bridge-spec open question Q3, still undecided.
- **No Realistic twins yet** for the 15 CLASSIC+TWIN tests, and the 147 BOTH tests are not yet `[Theory]` over `Rulesets.All`. The infrastructure exists (`Rulesets`, `Worlds.Realistic`).
  - `RulesetInvariantTests` covers the invariant core under both presets; convert the rest as each mechanic lands.
  - Tests that need instant construction under Realistic will need a `LandRules` knob (for example `ConstructionMonths = 0`) from E3b.
- **Content schema validation inside `dotnet test`** (test-map D13) is not added; `ContentValidator` is unchanged.
- **Golden digests are platform-specific.** If CI runs on another OS or CPU, regenerate there or accept per-platform fixtures.
- **`EconomyRules.EconomyScale`** exists, is validated (> 0) and is persisted. No mechanic reads it yet.
- **Live BOTH tests still encode some throughput and recipe assumptions.** Examples: `Same_city_source_is_preferred_over_other_city_source`, `Retailer_pulls_inventory_from_own_factory_when_available`, `Vertical_chain_only_imports_unbacked_inputs_from_world_market`. A per-unit recipe rebalance (econ §4.7) may require E1 to adjust them; they did not break under the test-map content mutations C01–C08.

---

## 6. Requests

1. **B1 bridge:**
   - Pre-validate geography with `World.MeetsGeographyRequirement(type, city)` and the retail tier (`Product.Tier == Finished`) before calling `Construct` or `ConfigureRetailSlot`. Under Realistic (the bridge's `newGame`) the engine now throws `InvalidOperationException` for both.
   - Switch to:
     - `AiStrategies` (E2) and `World.TryGetAiStrategy` / `UnregisterAi` (autopilot);
     - `World.SetRetailPrice` / `SetRestockTarget` / `SetWarehouseTarget` / `SetAutoExport` / `ClearSlot` (E3);
     - `WorldSaver.SaveToUtf8` / `WorldLoader.Load(catalog, ReadOnlySpan<byte>)` (E1);
     - `World.GetCashFlowStatement` and `LedgerCategoryInfo` for the cash-flow report;
     - `BuildingInstance.BookValue` / `BuiltAt` and `LedgerEntry.Quantity` (E11).
   - `WorldSaver.SchemaVersion` is now 10.
   - **Merge note:** `LedgerCategory` gained 26 members.
     - Any hand-written category table in the facade (the cash-flow mapping of bridge-spec §4.6.3, report classifiers) should read `LedgerCategoryInfo.Of(c).CashFlow` / `.Section` instead.
     - An enum-sweep test against a hand-written table will fail after the merge until it does.
   - `Magnate.Bridge.Tests/TestContent.cs` could link `engine/Magnate.Engine.Tests/TestSupport/TestContent.cs` instead of copying the resolver (test-map §7.3).
2. **Lead:**
   - The legacy Godot client now gets Realistic through `ScenarioRunner.Apply` (master plan D3), so its gameplay will change as Wave 2 lands. If it should stay Classic, pass `EconomyRules.Classic` in `client/scripts` (three call sites). E0 owns compile fixes only there and made no behavioural change.
   - Wave 2 ownership of the shared test files (`*Tests.cs` that both E1 and E2 will touch) needs one owner per file per wave. Suggestion: each workstream adds its own test classes and only appends to existing ones.
3. **E1:** pin content rebalances against the Classic fixture, not the tests. The 61 Classic tests never read `content/`.
4. **E2:** when adding `BalanceSheet` fields (`PaidInCapital`, `RetainedEarnings`, `Land`, `Cip`, `GrossPpe`), keep `BuildingValue`, `TotalAssets` and `Equity` with their current meaning. The client and tools read them (test-map §8.3).
