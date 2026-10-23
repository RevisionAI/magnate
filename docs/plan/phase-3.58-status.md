# Phase 3.58 — Fashion/Apparel Chain

**Goal**: add a premium apparel chain (cotton → denim fabric → designer jeans) reusing existing `farm` and `factory` building categories. No engine, schema, or building changes.

## Chain Spec

**cotton** (raw) — ALREADY EXISTS in `raws.json` (tier: raw, sourceCategory: farm, yield 150/slot/mo, base $250/ton, elasticity 1.0). Reused as-is. The existing `cotton_fabric` intermediate (1 cotton → 40 bolts) is consumed by `t_shirt`; rather than re-tune it (out of file-ownership scope) I introduced a premium parallel intermediate:

**denim_fabric** (NEW, intermediate, category `textile`) — 1 cotton → 25 bolts, 5 labor-units, base $22/bolt, elasticity 1.0, maxTechLevel 9. Scarcer conversion than cotton_fabric (25 vs 40 bolts per ton) reflects heavier fabric and finishing.

**designer_jeans** (NEW, finished, category `apparel`) — 2 denim_fabric → 10 jeans, 6 labor-units, base $120/unit, elasticity 0.7 (brand-driven, less price-sensitive), maxTechLevel 10.
- BaseDemandPerCapita: Low=0, Middle=0.0008, High=0.003.
- ReservationPrice: Low=$0 (they never buy), Middle=$150 (aspirational ceiling), High=omitted (no ceiling).

## Reservation-price rationale

Follows the `car` pattern (Low=$0, Middle=$30k) from Phase 3.44: designer jeans are a High-bracket-mostly status good. Middle's $150 ceiling is 1.25× base; if a retailer prices below it, Middle contributes a thin demand tail; above it, only High keeps buying. Low is zeroed both by demand=0 and reservation=$0 — belt-and-suspenders for clarity.

## Deviation from task brief

Task asked for new `cotton` + `fabric` + `designer_jeans` (22→25 products). `cotton` already existed at id-level collision; `cotton_fabric` already covered fabric. Reused `cotton`, introduced distinct `denim_fabric` (premium parallel to cotton_fabric), and added `designer_jeans`. Result: 22 → 24 products, not 25. Schema unchanged — existing product.schema.json already supports every field used.

## Verification

- `ContentValidator`: `Loaded 24 products, 18 building types, 5 cities. OK — no errors.`
- Building categories verified: `farm` and `factory` exist in `content/data/buildings/production.json`.
- Engine tests: 197/198 pass. **Pre-existing hard-coded test** `AdaptiveAiTests.AdaptiveStrategy_builds_research_center_once_retail_is_saturated` asserts 35 markets (7 finished × 5 cities) saturate within 38 months; adding `designer_jeans` makes it 8 × 5 = 40, so the AI no longer pivots to R&D in time. File ownership forbids touching tests — flagging for a follow-up phase to retune the loop count or make the test content-driven.

## Scenario

Shipped optional `content/scenarios/fashion_empire.json` — 5-year scenario featuring 2 AI rivals, farm/factory ownership goals, designer_jeans retail + 30% Metropolis market share + $12M net income.
