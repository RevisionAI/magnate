# U3 — Reports, Finance, R&D, Marketing, Rivals, News, Advisor, Goals: status

**Status: done** (branch `u3-panels-b`, 2026-10-02). All eight destinations are built on the U1 shell and live bridge data. Every screen was captured in a real game at 1920×1080 and 1280×720, and I read the captures and fixed what they showed. The Bank tab follows the E2 finance contract. E2 is not in this branch's engine build, so I verified the Bank against an in-page mock with E2's DTO shapes (see Verification).

This session resumed a manual stop. The last commit was a one-file WIP checkpoint: the Exports empty state, now an `EmptyState` with a link to production buildings. I re-ran every gate on it and reviewed the screenshots. Work done after the resume:

- **The E2 finance contract** (requested by the lead):
  - Bank tab: `newLoanMax`, term range, pricing grade for unrated companies, the revolver card, a distress banner with the cure countdown, missed-payment badges, `totalInterest` and the next instalment.
  - Credit profile: net debt ÷ EBITDA, EBITDA over the last 12 months, last review.
  - Overview: runway reads "Overdrawn" or "In distress" instead of "Not burning cash" when cash is negative or the company is in distress; new Tax panel; the rules of money now come from the profile.
  - Balance sheet: land, gross PP&E with accumulated depreciation, construction in progress, an asset register with a Depreciated column, a tax position panel, and term-loan and revolver lines.
  - P&L: reads E2 statements whose `opex` already contains depreciation, so it is not counted twice. The check is per column: whichever reading reconciles to net income wins.
  - Also: "Why?" labels for the `depreciation` / `interest` / `tax` drivers; labels and ledger filters for E2 ledger categories; `rating` goal units shown as a grade (notches above D); how-to links for `creditRating` / `loanTaken` / `totalAssets` / `netWorth` goals.
  - All of this builds against both the current and the E2 `protocol.ts`. New fields are read through the optional view types in `_shared-b/finance.ts`, and exhaustive records became string-keyed.
- **Polish from screenshot review:**
  - Ledger memos format raw quantities: "sell 250,496 Soft Drink" instead of "250496.04".
  - The ledger table fills the viewport height.
  - Flag goals no longer read "Not yet of Yes".
  - The deadline card says "The game is decided" after an outcome.
  - "Cash share of assets" shows sub-10 % values with a decimal.
  - The rivals chart height follows the league size.
  - Tech ties show a "tied" badge.
  - At ≤1500 px, secondary table columns are dropped (Products: COGS, GM %, trend; Rivals: strategy), and side columns narrow at ≤1440 px. Nothing scrolls sideways at 1280×720.
- **Reproducible tour:** `web/src/ui/panels/_shared-b/dev/tour.mjs` plays real games and screenshots every U3 screen. It has two states, `healthy` and `lost`, and an optional E2 finance mock.

## File map (all under `web/src/ui/panels/`)

| Area | Files |
|---|---|
| Reports (R) | `reports/index.tsx` (tabs + cross-tab nav `ReportsNav`), `PnlTab` (income statement, period picker month/quarter/year/custom, compare with previous, company picker, CSV, "Why did it change?" waterfall), `BalanceTab` (A/L/E, books-close, ratios, tax position, asset register / inventory drill-down → inspector), `CashFlowTab` (CFO/CFI/CFF, reconcile bridge), `ProductsTab` (product profitability), `ExportsTab`, `ChartsTab` (any history metric vs rivals, realised-share heatmap), `HistoryTab` (month-by-month, ReplayViewer parity), `LedgerTab` (filters, paging, export), `why.ts`, `Heatmap`, CSS |
| Finance (F) | `finance/index.tsx`, `OverviewTab` (KPIs, cash/equity/debt chart, capital structure, rating, tax, rules), `BankTab` (borrow builder, offers, amortisation preview, confirm, loans + early repay, revolver, distress, Wave 1 gate), `RatingCard` (badge, AAA…D ladder, credit profile), `EquityTab` (IPO/dividends/buybacks/issuance as locked cards with live requirement progress), stock market gate |
| R&D (T) | `rnd/index.tsx`, `TechTab` (tech by product tier, best rival, progress, ETA, tech race), `LabsTab` (labs, research units, assignment), `PatentsTab` (yours + licensing, rivals' and their effect on you), `research.ts` |
| Marketing (K) | `marketing/index.tsx`, `CampaignsTab` (campaigns table, brand vs rivals chart, campaign editor with channel/budget, reach forecast via `previewAdCampaign`), `BrandMapTab` (awareness grid by city × product), `MediaTab` (channels, owner bonus, media businesses), `brandData.ts` |
| Rivals (V) | `rivals/index.tsx` (league table, value chart, rival cards: archetype, cash/revenue/net, where they operate, contested markets + threat, latest moves; no ledgers), `threat.ts` |
| News (N) | `news/index.tsx`, `FrontPage` (The Magnate Times, Fraunces; lead story with "What it means for you", commodity watch, your business, rival watch), `ArchiveTab` (by month, severity/product/affects-me filters, search), `BusinessLogTab` (activity feed by category), `relevance.ts` |
| Advisor (H) | `advisor/index.tsx` (Morgan: ranked priorities with $/mo impact, deep links, one-click fixes from the bridge's `fix`, "Later" = dismiss for 3 months, what Morgan said), `advice.ts`, `dismissals.ts` |
| Goals (G) | `goals/index.tsx` (live goals with latch state, progress, sparkline, how-to links, deadline), `Briefing.tsx`, `Debrief.tsx` (`OutcomeDebrief`: what happened, what would have helped, value vs rivals, revenue/NI), `goalText.ts` |
| Shared | `_shared-b/`: `statement.ts` (IS/CF row models, reconciliation, `opexIncludesDepreciation`), `StatementTable`, `periods.ts`, `PeriodPicker` (+ `CompanyPicker`, `PresetPicker`), `charts.tsx` (`ComboChart`, `Waterfall`), `finance.ts` (amortisation, ratings, E2 view types), `components.tsx` (`LoadingBlock`, `ErrorBlock`, `FeatureGate`, `LockedCard`, `Note`, `CompanyTag`, `TechPips`, `useMoneyFormat`, `useFeature`, `errorText`), `names.ts`, `text.ts`, `brand.ts`, `csv.ts`, `useEngineQueries.ts`, `useNarrow.ts`, `dev/tour.mjs` |
| Tests | `_shared-b/{periods,statement,finance,text}.test.ts`, `reports/why.test.ts`, `rivals/threat.test.ts`, `news/relevance.test.ts`, `advisor/advice.test.ts`, `goals/goalText.test.ts` (9 files, 38 tests) |

## Contracts for other workstreams

- **Deep links** (`useUiStore.getState().openPanel(id, params)`):
  - `reports`: `{ tab: pnl|balance|cashflow|products|exports|charts|history|ledger }`. Aliases are `why`, `income`, `statement`, `bs` and `cash`. Also takes `companyId`.
  - `finance`: `{ tab: overview|bank|equity|stocks }`. `loans` is an alias for `bank`.
  - `rnd`: `{ tab: products|labs|patents, productId }`.
  - `marketing`: `{ tab: campaigns|brand|media, productId, cityId, channel }`. The editor opens pre-filled.
  - `rivals`: `{ companyId }` highlights that rival.
  - `news`: `{ tab: front|archive|log }`.
  - `goals`: `{ tab: goals|briefing|debrief }`.
- **Stable test ids:**
  - Panels: `panel-<id>` and `<id>-tab-<tab>`.
  - Reports: `pnl-table`, `pnl-compare`, `why-card`, `why-waterfall`, `bs-assets`, `bs-liabilities`, `bs-books`, `bs-tax`, `bs-inventory-toggle`, `cf-table`, `cf-reconcile`, `ledger-category`, `charts-metric`, `exports-empty`.
  - Finance: `fin-cash`, `fin-runway`, `fin-tax`, `fin-open-bank`, `credit-rating`, `credit-profile`, `loan-builder`, `loan-amount`, `loan-offer-<termMonths>`, `loan-preview`, `loan-take`, `loan-confirm`, `loans-table`, `revolver`, `bank-distress`, `bank-gate`, `equity-gate`, `stocks-gate`.
  - Marketing: `campaign-editor`, `campaign-product`, `campaign-city`, `channel-<id>`, `campaign-budget`, `campaign-launch`, `campaigns-table`, `brand-map`, `media-table`.
  - Other panels: `rivals-league`, `rival-<id>`, `advisor-summary`, `advice-<code>`, `advice-fix-<code>`, `goal-<id>`.
- **`OutcomeDebrief`** (`goals/Debrief.tsx`, prop `compact?`) is the stats debrief. U1's `OutcomeModal` can render it (see Requests).
- **Feature gates:** a `feature_unavailable` error from `creditProfile`, `loanOffers` or `stockMarket` switches the screen to a "coming soon" card listing the rules. No code change is needed when E2 or E5 lands.

## Verification (2026-10-02, this worktree)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors (139 pre-existing CS1591 warnings outside U3; no engine or bridge change in this branch) |
| `dotnet test Magnate.sln --no-build` | Bridge **201 passed**, 4 skipped. Engine **862 passed, 1 failed**: `CityLayoutGeneratorTests.Metropolis_generates_within_the_desktop_budget`, a wall-clock budget test, failed at load average ~19. It **passes when run alone**; E2 reports the same flake. |
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npx vitest run` | **648 passed**, 3 skipped (39 files + 1 skipped). U3 accounts for 9 files and 38 tests. |
| `npx vite build` | built (one earlier attempt hit ENOSPC because the machine disk was full; it succeeded on retry) |
| `node scripts/smoke.mjs` | **SMOKE OK** (quicksave: saved) |
| `tour.mjs` × 4 | **U3 TOUR OK** for healthy and lost, each at 1920×1080 and 1280×720: 34 + 34 + 27 + 27 screenshots, 0 console or page errors. I read every screenshot. |

Tour states:

- **healthy:** `tech_race`, seed 42, the player on the `simple` autopilot for 24 months. That gives 10 stores, about $260M revenue a year and a live rival.
- **lost:** `four_archetype_melee` on the `adaptive` autopilot. The engine declares bankruptcy after 13 months, which exercises the outcome modal and the debrief.
- **`--mock-finance`:** answers `creditProfile` / `loanOffers` / `loans` / `takeLoan` / `repayLoan` in the page with E2-shaped data. It also adds E2 lines (depreciation, land, CIP, loans) to the real `balanceSheet` so the totals still balance. Every other call goes to the real engine.

Selected screenshots are in [`u3-panels-b/`](u3-panels-b/) as JPEG: 22 healthy and 3 lost at 1920, plus 6 at 1280. The full PNG sets are in `web/test-results/u3/` (gitignored).

Reproduce:

```
cd web && npx vite build
node src/ui/panels/_shared-b/dev/tour.mjs --state healthy --mock-finance --size 1920x1080
node src/ui/panels/_shared-b/dev/tour.mjs --state lost --size 1280x720
```

## Known gaps

1. **The Bank tab has not been verified against a real E2 engine.** This branch's prebuilt `_framework` still answers `feature_unavailable` for loans; it shows the "Opening soon" gate, which was verified live. The mock follows E2's fixtures (`creditProfile.json`, `loanOffers.json`, `takeLoan.json`, `balanceSheet.json`). After merging E2: rebuild the engine, start a Realistic game, take and repay a loan in Finance › Bank, and check the balance-sheet lines and the P&L D&A / interest / tax rows.
2. **The HUD credit rating and insolvency countdown** (E2 request 3) belong to U1's top bar, which is outside U3's files. The countdown already appears through `hud.insolvency` (U1). The rating chip is a Request below. Inside U3, the rating appears on Finance › Overview and the Bank, and the cure countdown on Overview (runway tile) and the Bank (distress banner).
3. **Sell/demolish with `previewDisposal`** belongs to the building inspector (U2), not U3.
4. **Stock market, IPO, dividends, buybacks:** locked cards with live requirement progress until Wave 3 (E5).
5. **The advisor has no client-side "distress" item.** Advice comes only from the bridge's `advisor` items. A distress code would need B1/E2 to add one.
6. **Rival chart x-axis labels can crowd at 1280** ("Jul 27 Jan 28"). The ticks come from U1's `LineChart`.

## Engine and other-workstream issues seen while touring (not U3 code)

- **The `techLeader` autopilot makes cash explode.** On `four_archetype_melee`, seed 42, the player's cash reaches $9.99 **trillion** by mid-2027. This looks like a money exploit in the current engine; reproduce with `tour.mjs --probe --autopilot techLeader`.
- **The `adaptive` autopilot runs the player bankrupt in 13 months** on `four_archetype_melee`, while the HUD shows a company value of $66M. The insolvency rule then ends the game: 3 negative month-ends, while the advisor dock says six (next section).
- **Two different "company value" numbers.** The HUD and debrief show $66.06M while the company-value goal says "$33.7M of $40M — Not reached". The goal measures total assets. E2's single definition (D10) should fix this after merge.

## Requests

1. **U1 / lead:**
   - Top bar: show `SnapshotDto.player.creditRating` (E2) next to cash. Optionally import U3's `RatingBadge` from `ui/panels/finance/RatingCard`.
   - `OutcomeModal`: consider embedding `OutcomeDebrief` from `ui/panels/goals/Debrief` for "what happened / what would have helped".
   - The advisor dock line in `state/gameStore.ts` ("Six month-ends like this and the company is finished") contradicts the engine's 3-month grace. Use `hud.insolvency.graceMonths` or `bankruptcyInMonths`.
2. **Lead (merge):** after E2 merges, rebuild the WASM engine and run the tour without `--mock-finance`. The `e2-*` shots then come from the real engine.
3. **E1 / AI owners:** investigate the `techLeader` cash explosion and the `adaptive` autopilot bankruptcy described above.
4. **B1 (bridge):** an advisor code for distress / revolver over limit, with a fix that deep-links to `finance` `{ tab: 'bank' }`, would let Morgan rank it.
