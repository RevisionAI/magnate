# U2 panels A — build, inspector, markets, company: status

Branch `u2-panels-a` · Wave 2 · 2026-10-02

**Status: done.** All four panels are in, each replacing U1's placeholder. They read only bridge data and send mutations through `engineMutate`-style commands:

- the build flow (palette → placing → confirm → constructing → auto-open setup),
- the building inspector (Overview · Layout · Setup · Finance),
- the Markets overlay (matrix, detail, opportunities),
- the Company overlay.

Two contracts that landed mid-wave are now wired in. **W6** (placement ghost): the panel subscribes to `interactionBus 'placementConfirmed'`, so the building is constructed exactly once. **E2** (finance): Sell and Demolish are priced with `previewDisposal`. Gates are green (§4), and the screenshot tour was run at 1920×1080 and 1280×720 and every shot was read.

This run resumed after a manual stop. I re-verified the last WIP commit (the layout legend is only shown when there are links). On top of it:

- I fixed what the screenshots showed:
  - The "Sales floor · Lv 1" label crossed the input pipes; it is now a header row.
  - Shopper nodes were truncated ("Shoppers · So…"); the node now shows the product and "Shoppers · $2.25", and node details wrap to two lines.
  - The factory utilisation bar never lit up, because of U1's `Meter` CSS order (see Requests). I swapped it for `Progress`.
  - The Company rows did not say why a building "needs attention"; each flagged row now shows its reason, and the KPI tile shows a summary.
- I then added the W6 and E2 integrations.

---

## 1. File map (all under `web/src/ui/panels/`)

| Area | Files |
|---|---|
| Build drawer | `build/index.tsx` (routes Palette / Placing / Confirm, deep links), `build/Palette.tsx` (category tabs, type cards with cost · footprint · running cost · units · build time · requirements · affordability, "Suggested for you" starters, ⚡ quick build), `build/Placing.tsx` (ghost instructions, city switch, auto-site + `parcels` plot list fallback), `build/Confirm.tsx` (land + construction, timing, running cost, cash after, runway, financing hint, "What will it sell?" picker with opening price and stock policy, Construct ⏎ / Shift = place another), `build/buildModel.ts`, `build/Build.module.css` |
| Inspector drawer | `inspector/index.tsx` (header, status, tabs, deep links), `OverviewTab.tsx` (status/construction, last-month P&L + sparkline, per-line sold/demand/lost/cover/utilisation, inline alerts with one-click fixes), `LayoutTab.tsx` (CapLab 3×3 unit grid, inputs → processing → output pipes sized by volume, starved = dashed, click/Enter/arrow keys), `SetupTab.tsx` (per-unit editors: banded price slider, stock policy in months of cover, recipe/input sources/utilisation/make-vs-buy, warehouse targets, research, auto-export, add/change/clear unit; drafts until Apply), `FinanceTab.tsx` (accrual P&L windows, 12-month chart, book value, inventory, upgrade ladder with cost/benefit, sell/demolish with previews), `inspectorModel.ts`, `Inspector.module.css` |
| Markets overlay | `markets/index.tsx` (city × product matrix with Demand / Your share / Competition / Price metrics, Only mine / Contested filters, detail pane with income brackets + price ceilings, supply vs demand, leaderboard with Q/B/T, 12-month share chart, deep links to Build / Marketing / R&D; Opportunities tab: markets to enter, to defend, unserved table with one-click "Build here"), `marketsModel.ts`, `Markets.module.css` |
| Company overlay | `company/index.tsx` (KPI tiles, all buildings by city, sortable, needs-attention filter + reasons, row → inspector + camera locate), `companyModel.ts`, `Company.module.css` |
| Shared (`_shared-a/`) | `buildFlow.ts` (build-flow store + ghost contract), `interactionLink.ts` (optional W6 module via `import.meta.glob`), `placement.ts`, `commands.ts` (`runCommand`, `constructBuilding`), `errors.ts` (typed error → player text), `catalog.ts` (`useCatalogIndex`, `useFeature`), `lineSetup.ts`, `stockPolicy.ts` (Lean/Balanced/Deep = months of cover), `priceBands.ts` (slider marks/bands/warnings, expected-at-price from the bridge's points), `unitGrid.ts` (slot model → cells/nodes/links), `disposal.ts` (`useDisposalPreview`, confirm text), `numbers.ts`, `editors.tsx` (+css), `pieces.tsx` (+css) |
| Tests | `_shared-a/shared.test.ts`, `_shared-a/panels.test.ts`, `_shared-a/flow.test.ts` (3 files, 39 tests: stock cover, price track/warnings/expected-at, unit grid + flows, placement payloads, errors, build/markets/company/inspector models, ghost contract, disposal text) |
| Tour | `_shared-a/__tour__/u2tour.mjs`: plays the tutorial in real Chrome and screenshots every panel state to `web/test-results/u2/<W>x<H>/` |

## 2. Contracts for other workstreams

### 2.1 Opening the panels (deep links)

| Call | Effect |
|---|---|
| `openPanel('build')` | palette for the active city |
| `openPanel('build', { cityId?, productId?, typeId? })` | presets city/product; with `typeId` jumps straight to Placing (used by Markets "Build here" and Opportunities) |
| `openPanel('inspector', { buildingId, tab?, slotIndex? })` | tabs are **`overview` · `layout` · `setup` · `finance`**; `slotIndex` expands that unit in Setup |
| `openPanel('markets', { tab?: 'markets' \| 'opportunities', cityId?, productId? })` | opens the matrix with that cell's detail |
| `openPanel('company')` | the company overlay |

**W6 context menu:** `tab: 'setup'` (Set price…) and `tab: 'finance'` (Upgrade… / Sell or demolish…) are the real ids. Nothing needs to change.

### 2.2 Placement ghost (W6) ↔ build panel

I implemented it against `wt/w6-interaction/docs/overhaul/status/w6-interaction.md` §2.1:

1. Placing sets `uiStore.buildMode = { typeId }`, so W6's ghost follows the cursor.
2. When the build panel module first mounts, it subscribes to `interactionBus.on('placementConfirmed', …)`. That switches W6's construct-it-myself fallback off, so the building is constructed once, by the confirm card. A confirm the panel cannot take (nothing is being placed) calls `releaseGhost()`, so the ghost never stays stuck.
3. On a ghost confirm the panel shows the confirm card and **leaves build mode on**, so W6 keeps the ghost locked on the plot.
   - **Back** returns to Placing and calls `releaseGhost()`; build mode is not restarted.
   - **Construct** calls `construct { typeId, cityId, at, initialSlot }`.
     - Without Shift, the flow resets, which ends build mode.
     - With Shift (`keepPlacing` from W6, or Shift+Construct), it re-enters Placing with the same type and releases the ghost.
4. Build mode ending while placing or confirming a ghost plot resets the flow to the palette. This covers Esc, a right-click, and W6 clearing it on a city switch.
   - Switching city inside Placing re-enters placing in the new city.
5. Without W6, `interactionLink.ts` resolves to `null`: `import.meta.glob` finds no module, and both tsc and the bundle stay green. The fallbacks still work:
   - the bridge's suggested site (`previewBuild.suggestedPlacement`),
   - a plot list when `features.plots` is on.

   The older channels (`submitPlacement()`, bus topics `placementConfirmed` etc., DOM `magnate:placement`) are still accepted.

### 2.3 Sell / demolish (E2)

`_shared-a/disposal.ts` calls `previewDisposal { buildingId, kind: 'sale' | 'demolition' }` and types the result locally, because the method is not in this tree's `protocol.ts`. The Finance tab shows both options side by side, each with proceeds and gain/loss vs book. The confirm dialog repeats the numbers, including the stock that is sold or cleared. The button then calls `sellBuilding` / `demolishBuilding`, followed by a cash popup and a success toast.

The panel handles every engine state:

| Engine state | What the panel shows |
|---|---|
| Method missing (`unknown_method`, older build) | Plain confirm with the book value |
| `feature_unavailable` (Classic rules) | Disabled, with a note: "Selling and demolishing are part of the Realistic economy rules" |
| `features.demolish` off | Disabled, with a note that it arrives later |
| Under construction | Disabled until the building is built |

### 2.4 Alerts policy

- The panels toast only their own outcomes: construct, dispose, and command errors (`record: false`).
- Errors are worded from `code` + `details` (`errors.ts`) and shown inline where the player acted.
- Engine-driven alerts stay with U1's `alerts.ts`.

## 3. Behaviour notes

- **No re-derived game logic.** All numbers come from bridge queries: `buildingTypes`, `previewBuild`, `parcels`, `building`, `buildings`, `suggestPrice`, `marketIntel`, `marketDetail`, `supplyFlows`, `previewDisposal`. The client only does presentation maths:
  - months of cover = units ÷ the bridge's forecast,
  - slider ranges,
  - interpolation between the bridge's evaluated price points.
- **Trap defaults fixed (UX §4).**
  - A new store opens configured: product, an opening price (cheapest rival, else a starter price, else 1.5× world), and a shelf sized from the bridge's forecast for the new slot.
  - Stock is set as Lean 0.5 / Balanced 1 / Deep 1.5 months of cover instead of raw units. "Custom" shows units, months and the cash tied up.
  - Lost sales and empty shelves surface as inline alerts with a one-click fix.
- **Edits are drafts** with Apply/Revert and an "Applies at month close · in N days" chip.

## 4. Verification (2026-10-02)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors (U2 touches no C#) |
| `dotnet test Magnate.sln --no-build` | Bridge **201 passed**, 4 skipped. Engine **862/863** in the full run: `CityLayoutGeneratorTests.Metropolis_generates_within_the_desktop_budget` timed out on the wall clock (937 ms vs a 500 ms budget). The machine was under load: about 10 teams plus my screenshot tour. **Re-run alone: passed** |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run` | 33 files passed (1 skipped), **649 passed**, 3 skipped. U2's share: 3 files, 39 tests |
| `npx vite build` | built |
| `node scripts/smoke.mjs` | **SMOKE OK** (including quicksave: saved) |
| U2 tour, `node src/ui/panels/_shared-a/__tour__/u2tour.mjs --size 1920x1080` and `--size 1280x720` | 27 shots each, 0 page errors; every shot read |

The tour plays the tutorial:

1. Build palette → placing (auto-site) → confirm with soft drinks → construct; the inspector opens on the new store.
2. Quick-build a soft-drink factory and an R&D centre.
3. Run 3 months.
4. Inspect the R&D centre, the factory and the supermarket on every tab. In Setup, add bread and push the price slider below cost and above the ceiling; then run 2 more months.
5. Markets overlay: matrix → share metric → detail of an unserved cell → Opportunities → "Build here" deep link.
6. Company overlay.

Selected shots (JPEG) are in [`u2-panels-a/`](u2-panels-a/):

- **1920×1080:** palette, placing, confirm, inspector Overview / Layout (store + factory) / Setup / below-cost warning / Finance with sell & demolish, Markets matrix / detail / opportunities, Company.
- **1280×720:** confirm, layout, markets, company.

The utilisation-bar spacing fix in the factory Setup tab came after the last tour run; it is a CSS margin only and was not re-shot.

## 5. Known gaps

1. **W6 and E2 were integrated against their branches, not merged code.**
   - W6: `interactionLink.ts` finds `scene/interaction/interactionStore.ts` at build time and stays inert without it. The end-to-end ghost → confirm → construct path was unit-tested against the flow store only; it has not run in a browser with the real ghost. **After the merge, run W6's `interaction-shots.mjs` and the U2 tour.**
   - E2: this worktree's prebuilt engine predates `previewDisposal`, so the tour shows the disabled "arrives later" state. The live preview UI (proceeds / gain vs book per option) was not seen in a browser.
2. **The suggested price can sit at a bracket ceiling.** For example, it is $50.00 for soft drinks whose world price is $1.50. This is the bridge's `suggestPrice` maximising gross profit under today's fixed-pie demand, where price barely moves units. The UI shows it honestly (marker, band and "Use suggested" button) rather than second-guessing it, but under Classic it reads as a trap. It resolves when E1's demand model drives `suggestPrice`.
3. **Plots and land.** The plot-list fallback and construction progress work behind `features.plots` / `constructionTime`. They were not exercised with E3b's implementation; this build reports the features off, so the panel uses auto-site and "Opens next month".
4. **Inspector tab scroll.** Switching tabs keeps the drawer's scroll position. At 1280×720 the Layout tab can open slightly scrolled, with its header hidden under the tabs.
5. **Company overlay.** It is grouped by city with per-building rows. There is no per-product rollup and no rival comparison; those are UX §6.9 / Reports territory (U3).

## 6. Requests

- **U1 (shell, `ui/components/Data.module.css`):** the segmented `Meter` never lights up. `.segment { background }` is declared after `.fill-*`, has the same specificity, and wins. Move the `.segment` rule above the `fill-*` rules, or use `.segmentOn.fill-*`. U2 uses `Progress` instead for now.
- **W6:** no change needed. The tab ids `setup` / `finance` are correct, and U2 now consumes `placementConfirmed` (§2.2).
- **B2 / E1:** when the demand model lands, make `suggestPrice` reflect price elasticity, so the suggestion is not simply the highest bracket ceiling (see gap 2).
- **Lead (merge):** after merging E2, rebuild the WASM engine (`node scripts/build-engine.mjs`) so `previewDisposal` / `sellBuilding` / `demolishBuilding` are live. Then check the Finance tab's "Sell or close" section on a Realistic game.
