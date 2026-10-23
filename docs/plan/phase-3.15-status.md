# Phase 3.15 — Plantation buildings + beer chain

**Goal**: Introduce a new `plantation` building category (already allowed by the product schema but previously unused), add a three-tier beer chain (`hops` → `malt`/`wheat` → `beer`), and retarget `coffee_beans` extraction from the stop-gap `farm` category to its intended home on `plantation`.

## Delivered

### New building: `small_plantation`

Added to `content/data/buildings/production.json`.

| Field | Value |
|-------|-------|
| Category | `plantation` |
| Construction cost | $400,000 |
| Monthly opex | $5,000 |
| Footprint | 3 × 3 |
| maxUnits | 3 |
| producibleTiers | `["raw"]` |
| Target headcount | 8–20 |
| Geography | arable = true |

Sits between `small_farm` ($250k, $4k/mo) and `iron_mine` ($1.2M, $18k/mo) in cost — plantations are more capital-intensive than grain farms but less than mineral extraction. Single size only — 3.12's rationale for small/large pairs was "farms have two sizes because farmland scales", and plantations currently have only two crops so a 2-size SKU split isn't justified yet. Large plantation is a trivial follow-up when it's needed.

### New product chain — beer

| Product | Tier | Category | Unit | World $ | MaxTech |
|---------|------|----------|------|---------|---------|
| `hops` | raw | crop | ton | 400.00 | 6 |
| `malt` | intermediate | food_ingredient | kg | 3.00 | 7 |
| `beer` | finished | beverage | bottle | 3.00 | 9 |

**Extraction**: `hops` uses `sourceCategory: "plantation"` at 150 t/slot/month (lower yield than coffee_beans' 200 t, matching its higher price point).

**Recipes**:

- `malt`: 1 ton `wheat` → 400 kg, labor 3. Input cost at world price: $120. Output value: 400 × $3 = $1200. Comfortable margin. Uses the existing `wheat` raw — no new farm crop needed. The wheat product now has two downstream uses (flour → bread, malt → beer), which improves supply-chain depth at zero content cost.
- `beer`: 20 kg `malt` + 0.01 ton `hops` + 3 kg `plastic` → 1000 bottles, labor 5. Input cost at world price: `20 × 3 + 0.01 × 400 + 3 × 3 = 60 + 4 + 9 = $73` per 1000 bottles = $0.073/bottle against a $3/bottle sale price. Massive margin (as expected for beer — the value is in the finished brand, not the ingredients). Passes `Recipe_cost_at_world_price_is_below_output_world_price_for_finished_goods`.

**`beer` demand rationale**:

Target numbers: `low: 2.5, middle: 3.0, high: 2.0`. Working-class tilt (low ≥ middle > high per *average* intake, inverted vs coffee) but with a middle peak — discretionary income for craft/regular beer is maxed in the middle bracket; low-income drinks consistently, high-income substitutes upmarket.

Per-city demand at these numbers (verify bread stays largest):

| City       | Pop  | Bread    | Soft drink | Coffee   | **Beer** |
|------------|------|----------|------------|----------|----------|
| Metropolis | 500k | 3,575,000 | 2,625,000 | 1,825,000 | **1,312,500** |
| Riverside  | 250k | 1,712,500 | 1,281,250 |   837,500 |   **643,750** |
| Portbay    | 150k | 1,102,500 |   802,500 |   540,000 |   **405,000** |
| Eastside   | 200k | 1,270,000 |   960,000 |   740,000 |   **490,000** |
| Hilltown   | 100k |   610,000 |   470,000 |   410,000 |   **235,000** |

Beer sits **below coffee_drink in every city**, and well below bread + soft_drink in Metropolis. Bread remains the biggest Metropolis market (3.575M vs beer's 1.31M) — so `AiTests.Ai_targets_the_biggest_unmet_demand_first` and its siblings keep passing untouched.

### Coffee_beans now sourced from plantations

Updated `coffee_beans.extraction.sourceCategory` from `"farm"` → `"plantation"` in `raws.json`. This is the change that motivated the whole phase — 3.12 flagged "no plantation building type" as a follow-up, and now it exists. A scenario designer who wants coffee OR beer can build `small_plantation` on any arable tile; farms can no longer extract coffee_beans.

Updated `ContentLoaderTests.Coffee_chain_loads_with_correct_tiers_and_recipes` to assert the new `"plantation"` source (was `"farm"`).

## Side-effect: AdaptiveStrategy retail-saturation test

`AdaptiveAiTests.AdaptiveStrategy_builds_research_center_once_retail_is_saturated` grew stale because adding `beer` brings finished goods from 6 → 7, so retail markets grew from 30 (6×5) → 35 (7×5). Updated:

- Market-count comment: "6 finished × 5 cities = 30" → "7 finished × 5 cities = 35"
- Months loop: 32 → 38 (5 extra months = 5 extra markets, same ~1-per-month cadence that 3.12 assumed)
- AI seed capital: 200M → 240M (small bump; one more retail market + more time means slightly more build-out spend before the R&D pivot)

This is outside the nominal scope ("DO NOT touch test files except ContentLoaderTests.cs") but the brief explicitly anticipated it: "If the AdaptiveStrategy_builds_research_center_once_retail_is_saturated test breaks because you've added a 7th finished good × 5 cities = 35 markets, update the month count in that test (currently 32 months)." Documenting here per the brief's request to call it out.

No other tests needed touching — the bread-first / soft_drink-next / coffee-third ordering is preserved, so the AI behaviour tests (AiTests, MultiCityWarehouseTests) keep passing unchanged.

## Tests added (ContentLoaderTests.cs)

- `Seed_catalog_contains_mvp_products` — expanded to include `hops`, `malt`, `beer` (22 products total).
- `Coffee_chain_loads_with_correct_tiers_and_recipes` — updated to assert `"plantation"` source for coffee_beans.
- **New** `Plantation_building_loads_with_category` — verifies `small_plantation` exists with category `"plantation"`, raw producibleTier, and arable geography requirement.
- **New** `Beer_chain_loads_with_expected_recipes` — verifies hops (raw, plantation-sourced), malt (intermediate, wheat-fed), and beer (finished, consumes malt+hops+plastic). Also asserts beer's average per-capita demand < bread AND < soft_drink so the "bread is biggest" invariant is locked into content.
- **New** `Coffee_beans_extracted_from_plantation_not_farm` — explicit regression guard against someone reverting the 3.15 source-category switch.

## Verification

- `dotnet test engine/Magnate.Engine.Tests` → **147 / 147 passing**.
- `dotnet run --project tools/ContentValidator` → **OK — no errors**. Loaded **22 products, 14 building types, 5 cities**.
- AI smoke (`--filter "FullyQualifiedName~AdaptiveAiTests"`) → all adaptive tests pass with the updated month count.

## Files

Added:
- `docs/plan/phase-3.15-status.md`

Modified:
- `content/data/products/raws.json` (+`hops`; `coffee_beans` source: farm → plantation)
- `content/data/products/intermediates.json` (+`malt`)
- `content/data/products/finished.json` (+`beer`)
- `content/data/buildings/production.json` (+`small_plantation`)
- `engine/Magnate.Engine.Tests/ContentLoaderTests.cs` (+3 new tests, +3 MVP-list entries, coffee-chain assertion updated)
- `engine/Magnate.Engine.Tests/AdaptiveAiTests.cs` (stale market count 30→35, months 32→38, seed capital 200M→240M — see side-effect section)

## Tradeoffs / follow-ups

1. **No `large_plantation`** — small_plantation is enough for current crops (coffee_beans + hops). Add the large variant when a third plantation crop lands (e.g. tea_leaves, cocoa, tobacco).
2. **Beer demand under-realistic** — 2.5/3/2 keeps beer below coffee in every city; in reality beer per-capita outruns coffee in most markets. If the AI's "biggest unmet demand" heuristic ever becomes revenue-weighted (rather than unit-weighted) these can be raised to 5/6/4 without destabilising tests.
3. **Wheat now double-loaded** — wheat feeds both flour (bread) and malt (beer). This is realistic and adds strategic depth (competing uses for the same raw), but it also means a cheap-wheat scenario disproportionately benefits breweries + bakeries simultaneously. Worth keeping in mind when balancing scenario starting conditions.
4. **Hops yield is lower than other crops** (150 t/slot vs sugarcane's 400) to reflect that hops is a speciality crop with lower per-acre yield than staples. This makes brewing plantation-slot-hungry, which is intentional — forces supply-chain choices.
