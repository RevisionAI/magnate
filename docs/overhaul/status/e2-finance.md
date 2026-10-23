# E2 — Corporate finance + accounting — status

**Status: done** (2026-10-02). Under `EconomyRules.Realistic` the company has real books and real money
constraints: straight-line depreciation by asset class, land at cost, construction in progress, 25 % income tax
with an 80 %-capped loss carry-forward, amortising term loans, an automatic revolving credit line that replaces
negative cash, a quarterly credit rating priced off the 4.00 % policy rate, distress → 3-month cure → bankruptcy
and liquidation, sale/demolition with disposal gains, one company-value definition, and three statements that
close to the cent every month. Classic is untouched (golden masters and `Fixtures/classic-content` byte-identical).

Scope: econ-audit §4.8–4.11, §4.14–4.16, §4.18, §4.19; bridge-spec §4.6, §5.8, §8.4; UX §6.10, §6.16, §7.

## File map

### Engine (`engine/Magnate.Engine/`)

| Area | Files | What |
|---|---|---|
| Rules | `Rules/FinanceRules.cs`; `Rules/EconomyRules.cs` (Realistic `Finance = FinanceRules.Realistic` only) | ~30 knobs, all neutral by default; `FinanceRules.Realistic` holds the gameplay values; `Validate()` |
| Finance core | `Finance/AssetClasses.cs` | §4.8 component schedules by building category (store 75 % structure 30 y + 25 % fixtures 10 y, shells 30 y, R&D, media 25 y, seaport 40 y, farm/mine shells 20 y + equipment); upgrades max(120 mo, remaining life) |
| | `Finance/AssetRegister.cs` | Fixed-asset register keyed by building id: land, CIP, depreciation components; `Reconcile` picks up newly capitalised cost |
| | `Finance/CompanyFinance.cs`, `FinanceState.cs` | Per-company state (loans, revolver, rating, tax YTD/NOL, solvency counters, seasoning) and the world-level container (register, retired buildings, finance events, loan ids, tax watermarks) |
| | `Finance/TermLoan.cs`, `FinanceMath.cs` | Amortising loans (annuity payment, cents rounding, prepay + re-amortise) |
| | `Finance/CreditRating.cs` | AAA…D scale, ICR/leverage/size scoring, Damodaran spreads, labels/parse |
| | `Finance/FinanceTick.cs` | The tick logic called by the five steps (interest, instalments, revolver draw/sweep, depreciation, tax, quarter-end rating, solvency) |
| | `Finance/Liquidation.cs` | Bankruptcy liquidation: fire-sale every building, repay revolver then term loans pro rata, lenders absorb shortfall, AI unregistered, campaigns cancelled |
| | `Finance/Valuation.cs` | Fundamental company value (§4.11, operating-asset form — see "Contracts") |
| | `Finance/FinanceModels.cs` | Public read models: `CreditProfile`, `LoanQuote`, `SolvencyStatus`, `TaxPosition`, `CompanyValuation`, `DisposalResult`, `FinanceEvent`, `FinanceException`/codes |
| World | `Simulation/World.Finance.cs` (new partial) | Public finance API (below) |
| | `Simulation/World.Reports.cs` | Balance sheet / income statement / cash-flow statement as pure functions of Ledger + CogsLog + AccrualJournal + register |
| Statements | `Economics/BalanceSheet.cs`, `IncomeStatement.cs`, `Ledger.cs` | New BS lines (Land, Cip, GrossPpe, AccumulatedDepreciation, TermLoans, Revolver, PaidInCapital, RetainedEarnings, NetDebt); IS gains InterestExpense/InterestIncome/OtherGains; `Ledger.CategoryTotal` O(1) |
| Tick | `Simulation/Tick/{FinanceStep,DepreciationStep,TaxStep,QuarterEndStep,SolvencyStep}.cs` | Rule-gated; Classic no-ops |
| Save | `Persistence/Sections/FinanceSaveSection.cs` | Full finance state (companies, register, retired buildings, events, watermarks). Realistic saves without the section load without taxing history |
| Scenarios | `Scenarios/Goal.cs`, `ScenarioLoader.cs`, `ScenarioProgress.cs` (new) | New goals `totalAssets`, `netWorth`, `creditRating`, `loanTaken`; `companyValue` alias; goal `id`; `mode: reachOnce | holdAtDeadline`; `ScenarioProgress` latches and judges at the deadline; bankruptcy loses |
| Content | `content/scenarios/*.json` (all 16) | Rescaled to 2026 magnitudes, every description rewritten for the web UI (hotkeys B/K/F/R/H from `ui/panels/ids.ts`), tutorial retuned, the two unwinnable scenarios fixed |

### Engine tests (`engine/Magnate.Engine.Tests/Finance/`, 177 tests)

`AccountingPropertyTests` (A − L == E to the cent every month for every company in every live scenario under
Realistic; CFO+CFI+CFF == ΔCash; mid-run save/load lossless + deterministic; legacy Realistic save without the
section), `DepreciationTests` (incl. the E3b CIP contract), `TaxTests`, `LoanTests`, `RatingTests`,
`SolvencyTests`, `DisposalTests`, `ValuationTests`, `FinanceMathTests`, `ScenarioFeasibilityTests` (every goal
feasible, none won on day one, web-UI text, deadline/latch semantics, bankruptcy loses, tutorial action goals
latch for a player following the steps), `FinanceFixture`. Appended/repaired: `ScenarioTests`,
`TestSupport/Invariants.cs` (retired buildings keep ledger history), `EconomyRulesTests` (deleted the
"Realistic matches Classic until Wave 2" test, as its doc comment instructed).

### Bridge (`engine/Magnate.Bridge/`)

| File | What |
|---|---|
| `GameSession.Loans.cs` (new) | `creditProfile`, `loanOffers`, `loans`, `takeLoan`, `repayLoan`, `previewDisposal` (new), `sellBuilding`, `demolishBuilding` — real implementations; typed errors `credit_limit_exceeded`, `loan_not_found`, `insufficient_funds`, `feature_unavailable` (Classic) |
| `GameSession.Ext.cs` | Only the seven stub registrations deleted |
| `GameSession.Finance.cs`, `Model/Financials.cs` | Reports show depreciation, interest, tax, loans, revolver, land, CIP, paid-in capital/retained earnings; corporate value = `World.GetCorporateValue` |
| `Model/GoalTracker.cs` | New goal kinds, reach-once/hold-at-deadline, the engine insolvency outcome (`reason: 'insolvency'`), finance events published after each command and tick |
| `Model/LedgerIndex.cs` | Accrual journal folded in (depreciation/write-offs appear in monthly aggregates) |
| Tests | `FinanceTests.cs` (+ loans/credit/disposals class), `ProgressTests.cs`; repaired `ContractFixtureTests`, `DispatchTests`, `ExtTests`, `GameFlowTests`, `PersistenceTests` |

### Web

`web/src/bridge/protocol.ts` — finance/loan/goal blocks only: new ledger category ids, goal kinds/units
(`rating`), event kinds `loanRepaid`/`insolvency`, `CreditProfileDto` (+ revolver, limits, tax, solvency, value),
`LoanOfferDto.totalInterest`, `LoanDto.missedPayments`, `DisposalResultDto` breakdown + `DisposalPreviewArgs`,
balance-sheet lines, net-income drivers `depreciation | interest | tax`. Fixtures in `web/src/bridge/__fixtures__/`
regenerated by `ContractFixtureTests`.

## Contracts for other workstreams

**World API (`World.Finance.cs`)** — public: `GetCreditProfile`, `QuoteLoan`, `TakeLoan`, `RepayLoan`, `GetLoans`,
`TermLoanRate`, `RevolverRate`, `GetAvailableLiquidity`, `GetSolvency`, `IsInDistress`, `IsBankrupt`, `CanInvest`,
`EnsureCanInvest` (throws `FinanceException(Distressed)`), `GetTaxPosition`, `GetCorporateValue`, `GetValuation`,
`PreviewDisposal`, `SellBuilding`, `DemolishBuilding`, `GetLandCost`, `GetConstructionInProgress`,
`AssetRegister`, `RetiredBuildings`, `FinanceEvents`, `GetCompanyFinance`.

**E3b (land/construction) — CIP/land API** (internal, callable from `World.Construction.cs` / `ConstructionStep`):

| Call | When | Caller also books |
|---|---|---|
| `CapitalizeLand(buildingId, cost)` | plot bought for a building | `LedgerCategory.LandPurchase` (−cost, `building:`) |
| `AddConstructionInProgress(buildingId, amount)` | deposit / each instalment | `LedgerCategory.ConstructionPayment` (−amount, `building:`) |
| `CompleteConstruction(buildingId)` → amount | building finished | nothing (moves CIP into `CapitalizedCost`; depreciation starts next month) |
| `WriteOffConstruction(buildingId, recovered)` → loss | construction cancelled | the recovered cash; the loss is journalled (`AccrualKind.ConstructionWriteOff`) |
| `CapitalizeEquipment(buildingId, cost, lifeMonths?)` | equipment bought | `LedgerCategory.EquipmentPurchase` |

A staged building's `BuildingInstance.CapitalizedCost` must start at 0 while its cost sits in CIP (otherwise it is
counted twice). Land never depreciates; sale/demolition releases land, CIP and PP&E at carrying amount. Tested in
`DepreciationTests` (CIP contract) and `DisposalTests`.

**Company value (D10)** — `World.GetCorporateValue` is the only definition: legacy total assets when
`FundamentalValuation` is off (Classic), else the fundamental value: `NetCash + OperatingAssets × M`,
`M = clamp((ROIC − g)/(r − g), 0.25, 8)` on after-tax TTM ROIC and the unlevered cost of capital, blended from
1× over the first 12 months. This is a documented refinement of §4.11 (the spec's P/B-on-all-equity read idle
starting cash as a low-ROE business, so building the first store appeared to destroy value). Wave 3 (E5) should
return market cap here once listed.

**Events** (bridge `GameEventDto.kind`): `loanTaken`, `loanRepaid`, `loanPaymentMissed`, `creditRatingChanged`,
`insolvency` (reason `default | cured | bankrupt`), plus disposal events; `SnapshotDto.player.creditRating`;
`OutcomeDto.reason: 'insolvency'`. Classic games keep the interim three-negative-month rule.

**Ordering** (econ §4.16): Finance (interest + instalments, revolver draw on negative cash) → Depreciation → Tax
(YTD settlement, December NOL roll) → QuarterEnd (rating review months 3/6/9/12, max 2 notches) → Solvency
(missed payment / revolver over limit → distress; 3-month cure; equity < −20 % of assets at quarter-end →
bankruptcy).

## Scenarios (econ §4.18)

| id | start cash | deadline | goals |
|---|---|---|---|
| tutorial | $45M | none | store, soft drinks, 1 profitable month, advertise, brand 30, take a loan, bread line, value $55M |
| first_hundred_million | $45M | 2030-12 | value $250M, rating BBB |
| four_archetype_melee | $90M | 2032-12 | brand 70 ×2, profitable streak, value $100M (holdAtDeadline) — was unwinnable |
| tech_titan_clash | $75M | 2030-12 | share 30 %/25 %, value $125M (holdAtDeadline) — was unwinnable |
| others (12) | $24M–$90M | 2029–2032 | rescaled share/brand/export/net-income/value targets; sandbox has none |

Tutorial: an average supermarket of imported soft drinks clears a thin margin after wages, running costs and
depreciation; the goals walk the levers (price band, advertising, a loan, a second line). Feasibility is a
content-driven check (value ≤ max(2×, 1.45^years) of start cash, ≥ 12 months; net income ≤ 30 % of start cash
per year; exports ≤ 10 % of start cash per month; share ≤ 60 %; rating needs ≥ 15 months and ≤ AA) plus
"not won on day one" under Realistic for every scenario.

## Verification (2026-10-02, worktree HEAD before this doc)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors; the CS1591 warnings are all pre-existing files outside this workstream |
| `dotnet test Magnate.sln --no-build` | Bridge **201 passed**, 4 skipped. Engine **1038 passed, 1 failed**: `CityLayoutGeneratorTests.Metropolis_generates_within_the_desktop_budget` (wall-clock budget, machine load average ~111 with 10 teams); passes alone. Finance subset 177/177; bridge finance/progress subset 26/26 |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 611 passed, 3 skipped (30 files + 1 skipped) |
| `npx vite build` | built |
| `node scripts/build-engine.mjs` | WASM rebuilt (63 files) |
| `node scripts/smoke.mjs` | **SMOKE OK** (tutorial start, construct supermarket, advance at 8×, step, pause, quicksave) |

No screenshots: this workstream owns no UI (the finance panel belongs to the panels workstreams).

## Out-of-brief touches (small, local; flag for the merge)

- `GameSession.cs`: `Features = new(Demolish: true, Loans: true)` (the brief's "turn features.loans on"; the
  methods still answer `feature_unavailable` under Classic rules).
- `GameSession.Game.cs`: one line, `CreditRating` on the snapshot player (bridge-spec §8.4).
- `Protocol/Dtos.Ext.cs`, `Dtos.Finance.cs`, `Dtos.Buildings.cs`, `BridgeJsonContext.cs`: the finance DTO
  fields mirrored in `protocol.ts`, `DisposalPreviewArgs` registration.
- `Model/LedgerIndex.cs`: accrual journal folded into the monthly aggregates.
- `Model/PlacementModel.cs`: `EnsureAll` prunes placements of retired (sold/demolished/liquidated) buildings so
  their plots free up. **E3b/W6**: if plots move to `Land`, keep this behaviour.
- `TestSupport/Invariants.cs`: ledger entries may name retired buildings.

## Known gaps

- AI companies do not take term loans or sell buildings yet; they use the automatic revolver and are liquidated on
  bankruptcy (§4.14 "AI liquidation basics").
- Covenant tests (P1), dividends/share price/IPO (Wave 3 E5) are not modelled; `QuarterEndStep` carries the TODO.
  The policy rate is a fixed `FinanceRules.PolicyRate` knob until the Wave 3 macro model drives it.
- Realised market share counts incumbent sales via `IncumbentUnitsSold`, which is 0 until E1 records them
  (see Requests); share goals are therefore slightly easier until then.
- The tutorial goal text says "Finance (F) › Bank": the finance panel must expose a loans/bank tab with that name.
- `previewDisposal` is a new method (not in bridge-spec); `LoanOfferDto.totalInterest`, `LoanDto.missedPayments`
  are additions.

## Requests

1. **E1 (market)**: record incumbent unit sales per (product, city, month) so `World.GetRealisedMarketShare` can
   include them (hook `IncumbentUnitsSold` in `World.Reports.cs`).
2. **E3b (land)**: use the CIP/land API above; keep a staged building's `CapitalizedCost` at 0 until
   `CompleteConstruction`; call `EnsureCanInvest(company)` before starting construction/buying land so distressed
   companies cannot invest.
3. **U2/U3 (panels)**: Finance panel "Bank" tab driven by `creditProfile` / `loanOffers` / `takeLoan` /
   `repayLoan` / `loans`; balance sheet shows Land, PP&E gross/accumulated depreciation, CIP, term loans,
   revolver, paid-in capital, retained earnings; building inspector offers Sell/Demolish with `previewDisposal`;
   HUD shows `creditRating` and the insolvency countdown (`creditProfile.cureMonthsLeft`).
4. **B2 (bridge)**: if you touch `GameEventKind` or `EventDetector`, keep the finance events published from
   `GoalTracker.PublishFinanceEvents`.
5. **Wave 3 E5**: return market cap from `World.GetCorporateValue` for listed companies; drive `PolicyRate`.
