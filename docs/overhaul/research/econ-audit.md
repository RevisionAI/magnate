# Magnate — Economy Audit and Proposed Economic Model (econ-audit)

**Author:** econ-audit agent (senior economist / game-economy designer) · **Date:** 2026-09-30 · **Scope:** `engine/Magnate.Engine` as of the 2026-09-30 snapshot, `content/`, all 16 scenarios.
**Status:** research output for the web/3D overhaul. Read-only audit; nothing in the project tree was modified except this file.

---

## 0. TL;DR

**The current economy is not an economy.** Every measured return is several orders of magnitude away from reality, and several mechanics are unbounded:

| # | Finding (measured) | Severity | Root cause |
|---|---|---|---|
| F1 | A $1.5M small factory making **cars** from world-market inputs and auto-exporting nets **$3.31M/month from one slot** (ROI 2,648 %/yr, payback 0.5 months). Six slots: **$19.96M/month**. Upgraded to L3 (12 slots, $3.15M total capex): **$39.95M/month, payback 2.4 days**. Materials are 1–27 % of output value for 15 of 17 recipes. | P0 | Recipes create 54–99 % value added per step; exports are an infinite buyer at the full world price; labour unused. `MonthlyTick.cs:234-273, 447-483`, `SimulationConstants.cs:10` |
| F2 | **Total demand is price-inelastic.** A lone supermarket sells the whole city's bread (3.58M loaves/month) at $2.50, $250 and $2,500 alike; at 1,000× world price it books **$8.94B/month**. With a reservation price, soft drinks still sell 300k bottles/month at $1,500 each ($450M/month). | P0 | Price only re-divides a fixed quantity between retailers; the only outside option is a hard per-bracket reservation cap, which is missing for the High bracket everywhere and for 2 of 8 products (bread, t_shirt) entirely. `MonthlyTick.cs:347-396, 425-429` |
| F3 | **AI price spiral.** In `patent_race` and `tech_titan_clash`, TechLeader (price = 1.3 × *most expensive* rival) and Adaptive (price = 0.95 × *cheapest* rival) ratchet car prices ×1.235/month to **4–5 × 10¹⁰ × world price**; the Adaptive "player" ends year 10 with **$1.0 × 10¹⁸** total assets. | P0 | `Ai/TechLeader.cs:176-182` + `Ai/AdaptiveStrategy.cs:88-103` + F2. |
| F4 | **TechLeader unit-cost bug.** Its price floor uses the *total* inventory cost basis as a *unit* price → stores priced at **$10.9M and $20.2M per car** that never sell and each hold ~$10M of dead stock. | P0 | `Ai/TechLeader.cs:170-173` (`Inventory.CostOf` returns total basis). |
| F5 | **Unlimited free credit.** Cash may go negative without interest, limit or bankruptcy: a $1M company reached **−$18.0B** in one tick via a warehouse target; 19 of 38 AI-run companies went negative (up to 40 months below zero, min −$14.7M). | P0 | No solvency check anywhere (`World.cs:880-891`, `MaterialProcurement.cs:107-127`); `BalanceSheet.Liabilities` hard-coded 0 (`World.cs:940`). |
| F6 | **No retail capacity / no competition floor.** One $200k convenience store sells **1,200 cars/month ($25.9M)**; any first entrant is a monopolist. | P0 | No store throughput, no product/store-type fit, no local incumbents (`World.cs:306-337`, `MonthlyTick.cs:308-418`). |
| F7 | **Duplicate-slot exploit:** configuring the same product in 6 slots of one store gives **85.7 %** share vs a one-slot rival at the same price. | P1 | Each slot is a separate softmax participant sharing one inventory (`MonthlyTick.cs:312-323`). |
| F8 | **Books don't close after upgrades** (−$1.65M equity gap after a two-level factory upgrade). | P0 | Upgrade capex leaves cash but never reaches `BuildingValue` (`World.cs:158-165, 927-931`). |
| F9 | **Quality is constant 50** for every unit in the game (124 inventories after a 10-year melee). The Q lever does not exist. | P1 | Extraction and imports both 50 and output quality is the input average (`SimulationConstants.cs:22,25`, `MonthlyTick.cs:270`). |
| F10 | **$1/month ad campaign freezes brand forever** (100 → 100 for 24 months; control decays to 61.6). Cost per awareness point is identical in 100k and 500k cities. | P1 | Decay only applied to triples without an active campaign (`World.cs:438-454`); `SimulationConstants.cs:59-68`. |
| F11 | **Save/load breaks determinism**: the event RNG is re-seeded with 0 on load; news diverges after reload. | P0 (for the web client's IndexedDB saves) | `Persistence/WorldSaver.cs:302` writes `Seed: 0`; RNG state never persisted (`WorldLoader.cs:89-91`). |
| F12 | Loaded-but-unused economics: `Recipe.LaborUnits`, `BuildingType.TargetHeadcount/GeographyRequirement/Footprint`, `City.BaseLandPrice/Grid`. Oil wells can be built in land-locked Hilltown. | P0/P1 | Only read by `ContentLoader.cs:258, 361-376, 421, 497`. |
| F13 | No depreciation, interest, tax, equity, construction time, macro cycle; `CorporateValueGoal` uses total assets (would count borrowed money once loans exist) while the client uses cash + inventory + buildings + 10 × TTM NI. | P0 | `World.cs:920-1008`, `Scenarios/Goal.cs:27-40`, `client/scripts/GameState.cs:200-212`. |

**Scenario outcomes today (all companies AI-driven, 10 years):** median total assets grow **18.6×** (CAGR 34 %) by doing nothing but opening supermarkets of imported goods at 1.2× world price; p75 67×; four company-runs reach 10¹⁰×. Solo scenarios (`brand_monopolist`, `export_tycoon`) turn $8–20M into **$2.6B**. The only low-growth runs are pure price wars (`three_way_melee`, 1.2–1.3×).

**Proposed model (Section 4)** replaces these with: a lognormal-WTP **category demand curve** per (city, product, bracket) plus a CES/logit **offer choice** on quality-adjusted price (perceived value from Q/B/T); a permanent, sized **incumbent local competition** offer; **store throughput** capacity and a plot **location factor**; **import/export spreads** with a world-market depth that makes marginal export revenue fall; **labour** (headcount × city wage), utilities, maintenance, property tax; a **rebalanced 24-product table** in 2026 USD with realistic value added per stage; **straight-line depreciation** with land as a non-depreciating asset; **25 % income tax with NOL carry-forward**; **bank loans** priced off a policy rate + Damodaran (Jan-2026) rating spreads with an ICR/leverage **credit rating**; **equity** (shares, IPO, residual-income share price, dividends, buybacks); **construction time** with progress payments; a **regime-switching macro** (GDP, CPI, Taylor-rule rates, population); and **bankruptcy** rules. Calibrated in a Python model of the proposed rules (Section 5): **naive play −2 % pre-tax ROIC, average play 6–11 %, good play 22–36 %**, monopoly optimum ≈1.25–1.5× reference price, revenue → 0 at 20×.

---

## 1. Method

1. **Code read:** all of `Simulation/`, `Economics/`, `Ai/`, `Scenarios/`, `Content/ContentLoader.cs`, `Persistence/`, the content JSON and all 16 scenarios, `docs/HANDOVER.md`, `docs/research/capitalism-reference.md`, `docs/design/gameplay-and-modernisation.md`, and (for alignment) `docs/overhaul/research/caplab-brief.md` written in parallel by another agent.
2. **Measurement harness** (net8.0 console) against a *copy* of the engine (so the project's `bin/obj` were never touched), assembly-named `Magnate.Engine.Tests` to see internals: `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/econ-audit/harness/` (experiments `ExpA`…`ExpF`, run with `dotnet bin/Release/net8.0/Magnate.Engine.Tests.dll a|b|c|d|d7|e|f`). Raw outputs in `…/econ-audit/out/` (`A_production.md`, `B_monopoly.md`, `C_retail.md`, `D_scenarios_seed42.md/.csv`, `D_scenarios_seed7.md`, `E_misc.md`, `F_saveload.md`). Unless stated, experiments strip the random events (clean measurements); the scenario sweep keeps them (shipped game). Seeds 42 and 7 give near-identical results.
3. **Benchmarks** from Damodaran (Jan-2026 margins, ratings/spreads, P/E, payout), BLS (Aug-2026 wages), World Bank Pink Sheet (Sep-2026 commodities), EIA (Jun-2026 electricity), USDA (2025 land), Cushman & Wakefield/RSMeans (construction), Schonfeld via RAB (2026 ad-to-sales), plus standard tax/depreciation rules. Sources at the end.
4. **Calibration model** of the *proposed* rules in Python (`…/econ-audit/calib/v2.py`, `stores.py`, `scenarios.py`, `chains.py`, `macro.py`). The essential demand code is reproduced in Appendix A so the C# port can be checked against it. The scratchpad is session-temporary; the numbers in this document are the record.

---

## 2. Audit of the current model (hard numbers)

### 2.1 Production chains with auto-export (Experiment A)

Small factory ($1.5M, opex $20k/mo) in Metropolis, inputs bought on the world market, all output auto-exported; month-6 steady state. `ROI/yr` = 12 × NI / capex.

| Product | Slots | Output/mo | Input cost/mo | Export revenue/mo | NI/mo | ROI/yr | Payback | Materials % of price |
|---|---|---|---|---|---|---|---|---|
| car | 1 | 200 | $270k | $3.60M | **$3.31M** | 2,648 % | 0.5 mo | 7.5 % |
| car | 6 | 1,200 | $1.62M | $21.60M | **$19.96M** | 15,968 % | 0.1 mo | 7.5 % |
| coffee_drink | 6 | 1.2M cups | $55k | $4.80M | $4.72M | 3,780 % | 0.3 mo | 1.2 % |
| roasted_coffee | 6 | 600k kg | $360k | $4.80M | $4.42M | 3,536 % | 0.3 mo | 7.5 % |
| plastic | 6 | 1.2M kg | $84k | $3.60M | $3.50M | 2,797 % | 0.4 mo | 2.3 % |
| beer | 6 | 1.2M | $88k | $3.60M | $3.49M | 2,794 % | 0.4 mo | 2.4 % |
| television | 6 | 6,000 | $479k | $2.40M | $1.90M | 1,521 % | 0.8 mo | 20.0 % |
| soft_drink | 6 | 1.2M | $66k | $1.80M | $1.71M | 1,371 % | 0.9 mo | 3.7 % |
| bread | 6 | 240k | $90k | $600k | $490k | 392 % | 3.1 mo | 15.0 % |
| steel | 1 | 300 t | $24k | $90k | $46k | 37 % | 32.6 mo | 26.7 % |
| cotton_fabric | 1 | 8,000 | $50k | $120k | $50k | 40 % | 30.0 mo | 41.7 % |

Full table (17 recipes × 1/6 slots) in `A_production.md`. **Scale-up** (A3): `factory_small` upgraded to L3 (12 slots, $3.15M incl. upgrades) on cars = **$39.95M/month** (payback 0.08 months); `factory_large` L3 (24 slots, $10.5M) = **$79.88M/month**. **Extraction** (A2): small farm (3 slots, $250k) exporting wheat/cotton/sugarcane nets $92–109k/month (ROI 442–521 %/yr, payback 2.3–2.7 months); plantation 525 %/yr; oil well 21.6 %/yr (payback 56 months); iron mine 36 %/yr. **Vertical integration** (A4) *lowers* ROI (soft-drink factory alone 215 %/yr vs full farm+well+sugar+plastic+bottling chain 172 %/yr) because upstream steps add capex but only capture ~5 % of value.

Why: `SimulationConstants.CyclesPerSlotPerMonth = 200` (`SimulationConstants.cs:10`) × recipes whose inputs cost 1–45 % of the output's world price; zero labour (`Recipe.LaborUnits` never read); exports at the full `BaseWorldMarketPrice` with no volume limit, spread, or price impact (`MonthlyTick.cs:447-483`); raws enter inventory at **zero** cost basis (`MonthlyTick.cs:206-210`); world-market purchases at the same price with no spread (`MaterialProcurement.cs:107-127`).

### 2.2 Monopoly and duopoly pricing (Experiment B)

**B1 — lone supermarket in Metropolis, restock = 3× city demand (no stock-outs), month 3:**

| Product | RP low/mid/high | Price multiple | Units (with RP) | Revenue (with RP) | Units (RP removed) | Revenue (RP removed) |
|---|---|---|---|---|---|---|
| bread | none | 1× / 20× / 1000× | 3.58M / 3.58M / 3.58M | $8.94M / $178.8M / **$8.94B** | same | same |
| soft_drink | 8 / 50 / ∞ | 1× / 20× / 1000× | 2.63M / 1.50M / 300k | $3.94M / $45.0M / **$450M** | 2.63M at every price | $3.94M / $78.8M / **$3.94B** |
| car | 0 / 30,000 / ∞ | 1× / 20× / 1000× | 1.2k / 600 / 600 | $21.6M / $216M / **$10.8B** | 1.4k at every price | $25.7M / $513M / **$25.7B** |
| television | 300 / 2,000 / ∞ | 1× / 1000× | 1.8k / 750 | $700k / **$300M** | 2.2k | $880k / $880M |
| t_shirt | none | 1× / 1000× | 220k / 220k | $3.30M / **$3.30B** | same | same |

Units never change with price unless a hard reservation cap excludes a whole bracket; the High bracket has no cap anywhere, so its demand is perfectly inelastic up to ∞.

**B2 — duopoly, rival fixed at 1.2× world price, same Q/B/T (RP removed):** total market units are **identical at every price** (soft_drink 2.63M, bread 3.58M, TV 2.2k, car 1.4k). For products with `priceElasticity` < 1 (soft_drink 0.7, bread 0.5, designer_jeans 0.7) gross profit rises monotonically with price (bread at 100×: 9.9 % share but $87.4M gross profit/month vs $0.9M at 1.2×). For elasticity > 1 (TV 1.3, car 1.5) there is an interior optimum at ≈ 2–5×, far above any real markup.

**B3 — duplicate slots:** both firms at $1.80 soft drink; firm B configures the product in N slots of one supermarket → B's share 50 % (N=1), 66.7 % (2), 75 % (3), **85.7 % (6)**.

### 2.3 A lone retail store's economics (Experiment C)

Supermarket ($1.2M, opex $15k), one slot, price 1.2× world (the AI's solo markup), restock 1.2× demand, month 3. Selected rows (full 40-row table in `C_retail.md`):

| City (pop) | Product | Units/mo | Revenue/mo | NI/mo | ROI/yr on $1.2M | Payback |
|---|---|---|---|---|---|---|
| Metropolis (500k) | car | 1,200 | $25.9M | $4.31M | 4,305 % | 0.3 mo |
| Metropolis | bread | 3.58M | $10.7M | $1.77M | 1,773 % | 0.7 mo |
| Metropolis | soft_drink | 2.63M | $4.73M | $773k | 773 % | 1.6 mo |
| Hilltown (100k) | car | 440 | $9.50M | $1.57M | 1,569 % | 0.8 mo |
| Portbay (150k) | television | 450 | $216k | $21k | 21 % | 57 mo |
| any | designer_jeans | 93–385 | $13–55k | **−$6k to −$13k** | negative | never |

Store type is irrelevant (C2): a **$200k convenience store** sells the same 1,200 cars/month for $4.32M NI (ROI 25,896 %/yr); a $4M department store the same volume. One store captures 100 % of city demand for its product; there is no throughput limit and no incumbent.

### 2.4 All 16 scenarios, every company AI-driven, 10 years (Experiment D)

Player company registered with `AdaptiveStrategy()` defaults; events on; seed 42 (seed 7 within ±1 %). TA = total assets (the engine's `CorporateValueGoal` metric; equals equity because liabilities are always 0). `Max price ÷ world` is the highest retail price any of the company's slots reached. Books close (equity = starting capital + cumulative NI) in all 38 runs because no AI upgrades; cash always equals the ledger sum.

| Scenario | Company (strategy) | Start cash | TA y1 | TA y5 | TA y10 | Min cash (date) / months < 0 | TTM NI y10 | Max retail price ÷ world |
|---|---|---|---|---|---|---|---|---|
| brand_monopolist | Player (→adaptive) | $20.0M | $93.7M | $1.10B | **$2.65B** | $18.8M / 0 | $310.0M | 1.2× |
| coffee_monopoly | Your Corp (→adaptive) | $22.0M | $29.6M | $48.1M | $93.0M | **−$8.92M** (2033-03) / 18 | $8.0M | 1.2× |
| coffee_monopoly | BrewHaus (adaptive) | $25.0M | $47.0M | $608.6M | $1.14B | $19.2M / 0 | $29.8M | 1.2× |
| export_tycoon | Player (→adaptive) | $8.0M | $81.7M | $1.08B | **$2.63B** | $6.8M / 0 | $310.0M | 1.2× |
| fashion_empire | Your Corp (→adaptive) | $28.0M | $32.3M | $44.0M | $45.7M | −$0.15M / 4 | −$0.4M | 1.2× |
| fashion_empire | Couture Co. (adaptive) | $25.0M | $31.9M | $173.4M | $439.6M | −$1.25M / 1 | $53.6M | 1.2× |
| fashion_empire | ValueThreads (simple) | $18.0M | $27.2M | $159.1M | $338.4M | −$10.10M / 6 | $33.4M | 1.2× |
| first_hundred_million | Startup Inc (→adaptive) | $15.0M | $20.8M | $40.0M | $66.8M | −$9.51M / 22 | $11.2M | 1.2× |
| first_hundred_million | BigCo (adaptive) | $50.0M | $84.8M | $711.6M | $1.46B | $46.1M / 0 | $106.3M | 1.2× |
| four_archetype_melee | Your Corp (→adaptive) | $30.0M | $33.3M | $38.2M | $39.8M | −$0.52M / 13 | $0.2M | 1.2× |
| four_archetype_melee | BasicCo (simple) | $30.0M | $42.9M | $1.48B | $2.02B | −$4.24M / 6 | $11.8M | **140×** car |
| four_archetype_melee | Adapta Holdings (adaptive) | $30.0M | $36.5M | $26.2B | **$29.6B** | −$1.66M / 1 | $1.2M | **654×** car |
| four_archetype_melee | ChainLink Inc (vertical) | $30.0M | $37.6M | $18.8B | **$21.5B** | $18.6M / 0 | $8.2M | **621×** car |
| four_archetype_melee | Zenith Labs (techLeader) | $30.0M | $73.6M | $73.1B | **$75.0B** | $6.2M / 0 | $6.9M | **1,122×** car |
| monopolist | Your Corp (→adaptive) | $25.0M | $32.8M | $51.5M | $95.2M | −$8.64M / 17 | $7.9M | 1.2× |
| monopolist | FizzCorp (adaptive) | $40.0M | $54.7M | $580.3M | $1.06B | $29.8M / 0 | $19.7M | 1.2× |
| multi_city_mogul | Your Corp (→adaptive) | $25.0M | $30.0M | $42.1M | $45.8M | −$2.37M / 16 | $0.5M | 1.2× |
| multi_city_mogul | GoliathMart (adaptive) | $35.0M | $42.4M | $197.4M | $475.1M | **−$14.70M** / 6 | $55.3M | 1.2× |
| multi_city_mogul | PennyGrocer (simple) | $20.0M | $29.7M | $231.2M | $409.0M | $0.03M / 0 | $33.2M | 1.2× |
| patent_race | Player (→adaptive) | $20.0M | $93.7M | $2.35T | **$1.0 × 10¹⁸** | $18.8M / 0 | $9.3 × 10¹⁷ | **4.0 × 10¹⁰×** car |
| patent_race | Vanguard R&D (techLeader) | $40.0M | $83.6M | $6.88T | **$1.8 × 10¹⁸** | $16.2M / 0 | $1.7 × 10¹⁸ | **5.3 × 10¹⁰×** car |
| sandbox | Your Corp (→adaptive) | $30.0M | $38.5M | $55.8M | $100.7M | −$8.26M / 17 | $3.4M | 1.2× |
| sandbox | RivalCo (adaptive) | $25.0M | $35.5M | $540.8M | $938.5M | $12.7M / 0 | $14.0M | 1.2× |
| soft_drink_war | Acme Beverages (→adaptive) | $30.0M | $34.2M | $46.5M | $47.0M | −$0.15M / 3 | −$0.4M | 1.2× |
| soft_drink_war | RivalCo (adaptive) | $25.0M | $31.0M | $159.0M | $449.7M | −$1.54M / 3 | $58.4M | 1.2× |
| soft_drink_war | MegaMart (simple) | $20.0M | $28.8M | $178.1M | $366.4M | −$6.26M / 4 | $35.1M | 1.2× |
| tech_race | NovaTech (→adaptive) | $30.0M | $38.5M | $55.8M | $100.7M | −$8.26M / 17 | $3.4M | 1.2× |
| tech_race | ApexLabs (adaptive) | $60.0M | $70.5M | $575.8M | $973.5M | $47.7M / 0 | $14.0M | 1.2× |
| tech_titan_clash | NovaTech (→adaptive) | $25.0M | $98.7M | $2.35T | **$1.0 × 10¹⁸** | $23.8M / 0 | $9.3 × 10¹⁷ | **4.0 × 10¹⁰×** car |
| tech_titan_clash | Zenith Labs (techLeader) | $50.0M | $93.6M | $6.88T | **$1.8 × 10¹⁸** | $26.2M / 0 | $1.7 × 10¹⁸ | **5.3 × 10¹⁰×** car |
| three_way_melee | Your Corp (→adaptive) | $25.0M | $27.6M | $31.9M | $31.7M | −$2.67M / **40** | −$0.05M | 1.2× |
| three_way_melee | ApexBev (adaptive) | $35.0M | $38.3M | $41.5M | $41.5M | −$0.38M / 8 | −$0.3M | 1.2× |
| three_way_melee | Harbor Brands (adaptive) | $30.0M | $32.0M | $36.5M | $36.9M | −$0.41M / 2 | −$0.1M | 1.2× |
| three_way_melee | Pinnacle Co (adaptive) | $40.0M | $41.4M | $528.8M | $1.43B | $17.4M / 0 | $179.5M | 1.2× |
| tutorial | Your Corp (→adaptive) | $15.0M | $35.7M | $266.4M | $613.3M | $0.95M / 0 | $69.4M | 1.2× |
| tutorial | LocalCo (simple) | $10.0M | $30.5M | $215.4M | $468.8M | $0.50M / 0 | $50.6M | 1.2× |
| vertical_showdown | Your Corp (→adaptive) | $20.0M | $54.2M | $205.8M | $266.1M | $9.8M / 0 | $12.7M | 1.2× |
| vertical_showdown | ChainLink Industries (vertical) | $45.0M | $56.9M | $133.5M | $219.9M | $34.0M / 0 | $16.6M | 1.2× |

**Readings.**
- 19 of 38 company-runs had negative cash (up to 40 months below zero; deepest −$14.7M) and carried on with no interest or consequence.
- Price spiral mechanics (patent_race): TechLeader targets `max(rival) × 1.30`; Adaptive targets `min(rival) × 0.95`; each month the car price grows × 1.30 × 0.95 = **1.235**; High-bracket buyers have no cap and aggregate demand is fixed, so revenue compounds (month 36: $2.1B/month; month 60: $479B/month; month 120: $1.9 × 10¹⁷/month).
- Goals are either trivial or unreachable for AI-like play: the tutorial's "$20M corporate value" is hit in month 6 by a passive AI; `tech_titan_clash`'s $50M CV in month 7 (spiral); every `exportRevenue` goal (coffee_monopoly, export_tycoon, monopolist) stays at **$0** because no AI ever exports; `four_archetype_melee`'s $40M CV is missed by $0.2M because the four-way price war pins everyone to a 5 % margin.
- Outcomes are driven by *who opens stores first in the biggest unit-demand market*, not by business quality: identical Adaptive strategies end at $93M (player, moves first) vs $1.14B (BrewHaus) in `coffee_monopoly`.

### 2.5 Other defects (Experiment E/F)

| ID | Experiment | Result | Code |
|---|---|---|---|
| E1 | $2M firm builds a Hilltown supermarket ($1.2M), prices soft drinks at world price, asks for 10M bottles | Cash **−$13.47M** after month 1, still −$13.81M after 24 months; no interest, no limit, no default; equity "$1.99M" | `MaterialProcurement.cs:107-127`, `World.cs:880-891` |
| E8 | $1M firm, $500k warehouse, target 1,000,000 cars | Cash **−$18.00B** after one tick; inventory $18.0B in a 2×2 building | `MonthlyTick.cs:152-168`, `World.cs:277-304` |
| E2 | Upgrade `factory_small` to L3 | Equity $8.34M vs SC + NI $9.99M → **−$1.65M** gap | `World.cs:158-165` vs `World.cs:927-931` |
| E3 | 10-year `four_archetype_melee` | 124 inventories, min Q = max Q = **50**; tech up to T12 has no effect on Q | `SimulationConstants.cs:22,25`, `MonthlyTick.cs:258-272` |
| E4 | Two bread stores at $3; A has 1,000 loaves, B unlimited | Total sold = **50.0 %** of demand; A's allocated demand is lost, not re-routed | `MonthlyTick.cs:398-416` |
| E5 | $200k TV campaign 12 months then $1/month | Awareness 100 → **100 at month 36**; cancelled control → 61.6 | `World.cs:438-454` |
| E6 | `tech_titan_clash`, TechLeader car stores | Hilltown store **$10.93M/car**, Eastside **$20.2M/car** (second store at $23.4k does all the selling) | `Ai/TechLeader.cs:170-173` |
| E7 | One R&D centre, 4 slots | Soft drink max tech (8) in 7 months ($3.35M); car max tech (12) in 17 months ($3.85M); T moves consumer weight up to ×2.8 | `World.cs:514-550`, `SimulationConstants.cs:34,56` |
| E9 | Oil well in Hilltown (not oil-rich), iron mine + farm in Portbay (not mineral-rich/arable) | All succeed | `World.cs:95-113` |
| F1 | Sandbox, 48 months straight vs 24 + save/load + 24 | News events differ from 2028-03 onward (**determinism broken across save/load**) | `Persistence/WorldSaver.cs:302`, `WorldLoader.cs:89-91` |

Also verified in code:
- `GetMarketShare` (`World.cs:949-978`) ignores reservation prices, so share goals can disagree with actual sales.
- `MonthlyTick.ComputeCityDemand` (`MonthlyTick.cs:431-443`) is dead code.
- `SimpleRetailerStrategy` never re-prices after construction (`Ai/SimpleRetailerStrategy.cs:77`).
- Every AI archetype builds only supermarkets, including for cars.
- Content quirks: `reservationPrice.low = 0` for car and designer_jeans removes the Low bracket entirely, and `designer_jeans` demand is so small (385 units/month in Metropolis) that the product can never cover a store's opex.

---

## 3. Real-world benchmarks

### 3.1 Margins by industry (Damodaran, US, January 2026)

| Industry | Gross margin | Pre-tax operating margin | Net margin | Magnate today (manufacturing gross margin at W) | Proposed (EBIT % at W, imported inputs, full utilisation) |
|---|---|---|---|---|---|
| Beverage (Soft) | 54.7 % | 20.5 % | 13.4 % | 96.3 % | 11.7 % bottler (integrated brand+retail ≈ 25–45 % GM, see §5) |
| Beverage (Alcoholic) | 47.0 % | 22.8 % | 0.6 % | 97.6 % | 11.7 % |
| Food Processing | 23.2 % | 10.6 % | 2.8 % | 85–90 % | 7–10 % |
| Apparel | 56.9 % | 9.1 % | 3.9 % | 96–97 % | 11–16 % |
| Electronics (Consumer & Office) | 38.8 % | −4.5 % | −9.4 % | 80.1 % | 8.0 % |
| Auto & Truck | 10.4 % | 2.3 % | 1.3 % | 92.5 % | 6.9 % |
| Steel | 12.3 % | 4.1 % | 1.9 % | 73.3 % | 8.0 % |
| Chemical (Basic) | 9.3 % | 2.7 % | −3.7 % | 97.7 % (plastic) | 9.1 % |
| Farming/Agriculture | 13.1 % | 5.5 % | 3.9 % | 100 % (zero cost basis) | 22–24 % EBIT (capital-heavy: pre-tax ROIC 12–17 %) |
| Metals & Mining | 34.7 % | 23.9 % | 10.5 % | 100 % | 21.8 % |
| Oil/Gas (Production & Exploration) | 57.2 % | 25.4 % | 14.6 % | 100 % | 27.8 % |
| Retail (Grocery and Food) | 26.3 % | 2.3 % | 1.3 % | 16.7 % GM at AI 1.2× markup, unbounded upward | 24–31 % GM, EBIT −2…+15 % by location |
| Retail (General) | 33.2 % | 6.8 % | 5.6 % | — | department store GM 36–46 % |
| Retail (Special Lines) | 35.3 % | 7.7 % | 5.2 % | — | — |
| Retail (Automotive) | 22.0 % | 6.2 % | 3.4 % | — | dealer GM 14–17 % on imports, 36–40 % on own branded cars |
| Total market | 37.8 % | 12.8 % | 9.7 % | — | — |

### 3.2 Other benchmarks used

| Item | Value | Use in spec |
|---|---|---|
| Wages (BLS, Aug-2026, production & non-supervisory) | Manufacturing **$30.37/h**, retail **$22.41/h** | Loaded monthly wages: production $6,842 (×173.3 h ×1.30), retail $4,855 (×1.25), farm $4,224, extraction $8,110, admin $10,138, scientist $13,517 |
| Policy rate (FOMC, 16-Sep-2026) | Fed funds **3.75–4.00 %** (first hike since 2023); prime **7.00 %** | Initial policy rate 4.00 %; prime = policy + 3.00 % |
| Default spreads by synthetic rating (Damodaran, Jan-2026, large non-financial firms) | AAA 0.40 %, AA 0.55 %, A+ 0.70 %, A 0.78 %, A− 0.89 %, BBB 1.11 %, BB+ 1.38 %, BB 1.84 %, B+ 2.75 %, B 3.21 %, B− 5.09 %, CCC 8.85 %, CC 12.61 %, C 16.00 %, D 19.00 % with interest-coverage bands 8.5 / 6.5 / 5.5 / 4.25 / 3.0 / 2.5 / 2.25 / 2.0 / 1.75 / 1.5 / 1.25 / 0.8 / 0.65 / 0.2 | Loan pricing, rating from interest cover (§4.10) |
| Dividend payout (Damodaran, Jan-2026) | Total market 34.8 %; Beverage (Soft) 72.7 %; Retail Grocery 37.4 %; Farming 41.4 %; Oil/Gas E&P 41.7 % | AI payout 30–50 % |
| P/E (Damodaran Jan-2026 sector trailing P/E is distorted by losses; S&P 500 forward ≈ 22, long-run median ≈ 15–16) | Retail Grocery 20.5, Farming 19.1, Oil/Gas E&P 31.0 | Target P/E band 6–35 via residual-income model (§4.11) |
| Corporate income tax | US federal 21 %, federal + average state ≈ 25–26 %; NOL carry-forward indefinite, limited to 80 % of taxable income, no carry-back (TCJA) | 25 % flat, NOL 80 % cap |
| Depreciation (IRS MACRS / economic life) | Non-residential real property 39 y; land improvements 15 y; most manufacturing machinery 7 y; farm machinery 7 y; farm buildings 20 y; computers 5 y | Structures 30 y, fixtures and lines 10 y, farm equipment 12 y, mine equipment 20 y, wells 10 y (§4.8) |
| Construction cost (2025) | Warehouse $85–139/sq ft (Cushman & Wakefield); manufacturing $260–420/sq ft; retail shell $250–380/sq ft; RSMeans supermarket model ≈ $139/sq ft (older) | Supermarket $10M (≈40k sq ft), small factory shell $15M, department store $14M, etc. (§4.7) |
| Farmland (USDA 2025) | Cropland **$5,830/acre** | Farm "fields" per extraction slot $2.0–2.2M (§4.7) |
| Commercial / industrial land (US, typical asking prices; approximate, not re-fetched) | Suburban commercial $10–50/sq ft ($110–540/m²), CBD $100+/sq ft ($1,000+/m²); industrial $5–20/sq ft ($55–215/m²) | `BaseLandPrice` $80–250/m² at the median plot, × zone (industrial 0.45) × L^1.2 → prime commercial ≈ $140–440/m² |
| Electricity (EIA, Jun-2026) | Industrial ≈ **9.2 ¢/kWh**, commercial ≈ **14.2 ¢/kWh** | Production energy and building base load |
| Commodities (World Bank Pink Sheet, Aug-2026 / 2025 avg) | Crude $84.4 / $67.4 per bbl; Arabica $7.97 / $8.47 per kg; wheat (HRW) $330 / $243 per t; world sugar $0.38 / $0.37 per kg; cotton $2.11 / $1.71 per kg; iron ore $96 / $100 per dmt | Base world prices near 2025–26 averages: crude $75, coffee $7,000/t, wheat $250/t, cotton $1,900/t, iron ore $100/t |
| Ad-to-sales (Schonfeld 2026 via RAB) | Bottled & canned soft drinks **8.0 %**; malt beverages **10.6 %**; beverages 6.1 %; apparel 6.1 %; household audio/video 3.1 %; motor vehicles **1.6 %**; food 3.6 %; retail grocery **0.7 %**; department stores 3.2 %; convenience stores 0.1 %; auto dealers 0.8 % | Ad cost per awareness point scaled by population; sustaining awareness 70 in Metropolis ≈ $87.5k/month (≈ 1–4 % of a mid-size brand's city sales) |
| Inventory turns | Grocery 10–15×/yr (perishables 14–20), apparel 4–6×, consumer electronics 4.5–8×, car dealers 2–4×, retail overall ≈ 10× | Store stock cap 1.5 × monthly capacity; working-capital assumptions in the calibration |
| Retail markups (derived from gross margins) | Grocery ≈ 1.35× cost, electronics ≈ 1.25–1.3×, apparel ≈ 2×, new cars ≈ 1.06–1.10× | `import landed ÷ reference retail price`: 0.70 soft drink, 0.66 beer, 0.52 t-shirt, 0.47 jeans, 0.78 TV, 0.91 car |

---

## 4. Proposed economic model (implementable spec)

### 4.0 Principles, scale and notation

**Principles.**
1. **Realistic unit economics, ratio-first.** Each stage's cost stack (materials, labour, energy, maintenance, depreciation) and margin sits inside real-world bands (§3). All targets are stated as ratios (margin, ROIC, payback), so a later global rescale is possible without re-tuning.
2. **Every market is contestable.** A permanent local-incumbent offer exists in every (city, product) market. Aggregate quantity falls as prices rise. No revenue is unbounded.
3. **Every cash move is a ledger entry; every non-cash accrual is a journal entry.** The balance sheet is derived from sub-ledgers and must satisfy `Assets = Liabilities + Equity` to the cent, every month, for every company.
4. **Deterministic monthly tick.** Iterate in ordinal order. Use named RNG streams with persisted state. Use no wall-clock or unordered iteration.
5. **Data-driven.** Every constant below is a content field or a `SimulationConstants` entry with the value given.

**Scale decision (needs lead sign-off — see open question 1).** This spec uses **2026 USD at realistic magnitudes**: consumer prices are real shelf prices, a supermarket costs $10M plus land, a small factory shell $15M plus $1.5–35M of line equipment per slot, wages are BLS rates. Consequently **scenario starting cash must rise about 3×** (§4.18). The parallel `caplab-brief.md` §7.1 proposes CapLab-scaled capex (supermarket $2–5M). Both are internally consistent only if revenue scales with capex. My calibration holds its ratios under a uniform factor `EconomyScale` applied to populations (or per-capita demand), capex, land, headcount-cost, starting cash and goal thresholds. Consumer unit prices are not scaled.

**Notation.** `t` = month; `c` = city; `p` = product; `b` ∈ {Low, Mid, High} = income bracket; `j` = offer (a retail building's line for one product); `W_p` = world FOB price; `Pref_p` = reference retail price; `CPI_t` = price level (1.0 at game start); `Φ, φ` = standard normal CDF/PDF (implement Φ with Abramowitz–Stegun 7.1.26 or a rational approximation; results are deterministic because it uses only `+ − × ÷ exp`).

---

### 4.1 (i) Aggregate demand with perceived value and a price-sensitive total

**Structure: two nested decisions per (c, p, b, t).**
1. **Category decision.** How many units the bracket buys in total depends on the *value-adjusted* market price relative to the bracket's willingness to pay (WTP). WTP is lognormally distributed.
2. **Offer decision.** Which offer (store line) each buyer picks is a CES/logit share on quality-adjusted price, weighted by store attractiveness. The incumbent local competition (§4.2) is always one of the offers.

**Reference demand (units/month).**
```
D_ref(c,p,b,t) = Pop(c,t) · share(c,b,t) · q(p,b) · MacroMult(p,c,t)
```
`q(p,b)` = content `baseDemandPerCapita` (reinterpreted as "units per capita per month when the market is served only by incumbents at Pref"). `MacroMult` = 1 in P0 (see §4.13 for P1).

**Offer set.**
- `j = 0` is the incumbent.
- For each building in city `c` owned by any company that has ≥ 1 retail slot for `p`, create **one** offer `j` (duplicate slots merge — fixes F7).
- An offer participates only if `Stock_j > 0` after this month's restock. Empty shelves are not chosen, so no demand is wasted on them (fixes E4).

**Per-offer attributes.**
```
n_j      = number of slots in the building configured for p
Cap_j    = n_j · RetailCapPerSlot$(type) · LevelCapMult(level) / (Pref_p · CPI_t)      [units]  (§4.3)
Sell_j   = min(Stock_j, Cap_j)
A_j      = L(plot_j) · Draw(type, category_p) · n_j^0.5 · (1 + 0.10·(level_j − 1))           (§4.3)
Q_j      = weighted-average quality of the building's stock of p (existing Inventory quality mass)
B_j      = max( Brand(owner_j, p, c), BrandImport_p )                          [P0; P1: source-weighted, §4.1a]
T_j      = 100 · max( Tech(owner_j, p), TechWorld_p(t) ) / MaxTech_p          [P0; P1: source-weighted]
P_j      = the slot price (all slots of p in one building share one price; ConfigureRetailSlot sets it)
```
Incumbent: `P_0 = Pref_p · CityPriceIndex_c · CPI_t`, `Q_0 = IncumbentQuality_p`, `B_0 = IncumbentBrand_p`, `T_0 = 100·TechWorld_p(t)/MaxTech_p`, `A_0` from §4.2, `Sell_0 = ∞`.

**Perceived value.**
```
wQ_b = wQ_p·{0.90, 1.00, 1.20}_b     wB_b = wB_p·{0.85, 1.00, 1.25}_b     wT_b = wT_p
S_jb = (wQ_b·Q_j + wB_b·B_j + wT_b·T_j) / (wQ_b + wB_b + wT_b)                 ∈ [0,100]
M_jb = exp( κ_p · (S_jb − 50) / 50 )                                            (value multiplier; S=100 → e^κ)
P̃_jb = P_j / M_jb                                                               (quality-adjusted price)
```

**Offer shares (CES/logit).**
```
θ_b  = θ_p · {1.25, 1.00, 0.75}_b                     (low income is more price-sensitive between offers)
w_jb = A_j · P̃_jb^(−θ_b)            s_jb = w_jb / Σ_k w_kb
P̃eff_b = Σ_j s_jb · P̃_jb           (share-weighted market price per unit of value)
```

**Category demand (lognormal WTP, price-sensitive total).**
```
ε_b  = ε_p · {1.40, 1.00, 0.60}_b                     (category elasticity at the reference point)
z_b  solves  φ(z)/(σ_p·(1−Φ(z))) = ε_b               (precompute at content load; bisection on [−8, 4], 80 iterations)
P̃ref_b = Pref_p·CityPriceIndex_c·CPI_t / M_0b          (incumbents' quality-adjusted price = reference point)
R_b  = P̃ref_b · exp(−z_b·σ_p)                         (median WTP of the bracket for an average-value unit)
Surv(x) = 1 − Φ( ln(x) / σ_p )
D_b  = D_ref · Surv(P̃eff_b / R_b) / Surv(P̃ref_b / R_b)
d_jb = D_b · s_jb ;   d_j = Σ_b d_jb
```
Properties:
- The total equals `D_ref` when only incumbents trade at `Pref`.
- The total rises when players offer better value or lower prices, with a hard ceiling of `D_ref/Surv(P̃ref/R)`.
- The total falls smoothly toward 0 as prices rise, so no reservation cliff is needed.
- A monopolist has an interior profit optimum (§5.2, monopoly bound).

**Sales, capacity, spill.**
- `x_j = min(d_j, Sell_j)`.
- Unserved demand `U = Σ_j max(0, d_j − x_j)`.
- Re-allocate `0.60·U` once across offers with residual `r_k = Sell_k − x_k > 0`, and the incumbent, in proportion to `Σ_b D_b·s_kb` and capped at `r_k`. The remainder is lost.
- Book `ProductSale = x_j · P_j` and COGS from WAC as today.

**Content changes (`content/data/products/finished.json`, schema).**

| Field | Meaning | Values (proposed) |
|---|---|---|
| `referencePrice` | Pref, $ at CPI 1, city price index 1 | Table 4.7-A, Pref column |
| `baseDemandPerCapita{low,middle,high}` | q (units/capita/month at reference) | Table 4.7-B |
| `priceElasticity` | ε_p, **category** elasticity for the Mid bracket (semantics change) | soft_drink 0.80, bread 0.35, beer 0.60, coffee_drink 0.60, t_shirt 0.90, designer_jeans 1.30, television 1.30, car 1.10 |
| `wtpSigma` | σ_p | 0.45, 0.35, 0.45, 0.50, 0.55, 0.60, 0.55, 0.50 (same order) |
| `offerElasticity` | θ_p (Mid) | 5.0, 5.0, 5.0, 4.0, 3.0, 2.5, 6.0, 8.0 |
| `attributeWeights{quality,brand,tech}` | wQ, wB, wT (sum 1) | soft_drink .20/.65/.15; bread .60/.30/.10; beer .30/.60/.10; coffee_drink .40/.45/.15; t_shirt .40/.45/.15; designer_jeans .25/.70/.05; television .30/.25/.45; car .35/.30/.35 |
| `valueSpread` | κ_p | 0.70 (bread 0.60, t_shirt 0.80, designer_jeans 1.00, car 0.60) |
| `incumbent{brand,quality}` | B_0, Q_0 | brand: 45, 30, 45, 40, 35, 55, 45, 50; quality 50 (jeans 55) |
| `importBrand` | BrandImport_p (national brands carried by imports) | = incumbent brand (P0) |
| `retailCategory` | grocery / apparel / electronics / auto | as Table 4.7-B |
| `referenceStore` | store type used to size incumbents | supermarket / department_store / car_dealership |
| `reservationPrice` | **deprecated**. If present, loader maps it to `R_b = RP_b / exp(1.645σ)` (RP becomes the 95th WTP percentile). An RP of 0 means that bracket is not a market for p (q is treated as 0). | — |

Loader rules: missing new fields fall back to category defaults. Validation requires weights > 0 summing to 1 ± 1e-6, σ ∈ [0.2, 1.0], θ ∈ [1.2, 12], κ ∈ [0.2, 1.5].

**4.1a Quality, brand and tech sources (P1).**
- **Quality formation** replaces the constant 50 (fixes F9): `Q_out = clamp(0.55·Q_in + 0.45·Q_tech + 4·(level−1), 1, 100)` with `Q_tech = 20 + 80·(Tech/MaxTech)^0.8`. This is CapLab's input-share plus tech-share rule (caplab-brief §2.6).
- Raws: `Q = 40 + 30·Tech/MaxTech + 5·(level−1) + 5·[geography matches]`.
- Imports: `Q = ImportQuality_p` (50, +0.25/yr drift).
- Other purchased materials count as Q = 50 input mass.
- **Source-weighted brand/tech.** Track an `OwnMadeFraction` mass per inventory entry, like quality mass. Then `B_j = f·Brand(owner) + (1−f)·BrandImport` and `T_j = f·Tech(owner) + (1−f)·TechWorld`. Advertising then only builds value for goods you make, as in CapLab ("imports carry no brand"). The P0 `max()` rule keeps today's "advertise anything" behaviour while removing the brand-less-entrant penalty.
- **World tech drift:** `TechWorld_p(t) = MaxTech_p · min(0.8, 0.30 + 0.01·years)`. Start = 30 % of max.

---

### 4.2 (ii) Incumbent local competition

Each (city, product) has one synthetic offer representing all unmodelled local retailers. It never runs out of stock, earns nothing for any company, and is **sized so that an average new store with average attributes at Pref runs at about 75 % of its capacity**:
```
D$_ref(c,p,t) = Σ_b D_ref(c,p,b,t) · Pref_p·CityPriceIndex_c·CPI_t
A0_base(c,p,t) = max( 0.5, D$_ref / (IncumbentUtilisation · RetailCapPerSlot$(referenceStore_p)·CPI_t) ) · IncumbentStrength(difficulty, c)
IncumbentUtilisation = 0.75 ; IncumbentStrength = 0.6 easy / 1.0 normal / 1.4 hard (city override optional, ≈ CapLab LOCALCOMP)
```
Initial masses (normal): soft_drink 63.5 / 31.8 / 25.0 / 19.1 / 12.4 equivalent slots in Metropolis / Riverside / Eastside / Portbay / Hilltown; bread 28.8 … 5.4; car 75.0 … 19.4; television 7.2 … 1.7 (full table in §5).

**Dynamics (P1, monthly; P0 = static base).**
```
s_firms  = (units sold by all companies) / (all units incl. incumbent), trailing 3 months
Pfirm    = unit-weighted mean company price / (Pref·CityPriceIndex·CPI), trailing 3 months
Entry    = 1 + min(0.5, 1.5·max(0, Pfirm − 1.10))              (fat margins attract local entrants)
Target   = A0_base · max(0.25, 1 − 0.75·s_firms) · Entry
A0(t)    = A0(t−1) + 0.03·(Target − A0(t−1))
```
Incumbents lose mass as players take share, down to a floor of 25 % of base, and come back when players over-price. There is always a competitive fringe. This is what disciplines prices (limit pricing) and prevents a repeat of F2/F3.

---

### 4.3 (iii) Retail throughput capacity, store types and location

| Store type | Capex (excl. land) | Plots | Slots L1/L2/L3 | Staff | Fixed opex $/mo | Capacity $/slot-month at Pref | Draw by category (0 = not allowed) | Build months |
|---|---|---|---|---|---|---|---|---|
| convenience_store | $1.4M | 1 | 3 | 4 + 1/slot | 6k | 70k | grocery 0.30 | 2 |
| supermarket | $10.0M | 9 | 6 / 9 / 12 | 16 + 5/slot | 40k | 450k | grocery 1.00, apparel 0.35 | 4 |
| department_store | $14.0M | 16 | 4 / 6 / 9 | 20 + 6/slot | 60k | 500k | apparel 1.00, electronics 1.00, grocery 0.25 | 6 |
| car_dealership *(new)* | $4.0M | 4 | 2 | 6 + 6/slot | 18k | 1,200k | auto 1.00 | 4 |
| electronics_store *(new, P1)* | $3.0M | 2 | 3 | 6 + 3/slot | 12k | 400k | electronics 1.20 | 3 |
| fashion_boutique *(new, P1)* | $2.0M | 1 | 2 | 4 + 2/slot | 8k | 250k | apparel 1.20 (designer_jeans 1.5) | 2 |

- `ConfigureRetailSlot` throws when `Draw(type, category) = 0`. No more cars in convenience stores (F6).
- **Stock cap:** `RestockTarget` is clamped to `1.5 · Cap_j` units. This is the storage limit.
- **Staffing (P1):** effective capacity × min(1, staff/required).
- **Level:** L2/L3 add slots; capacity per slot is unchanged; attractiveness +10 % per level.
- **Chain bonus (P1, CapLab "retail demand bonus"):** `A_j × (1 + 0.04·min(10, sameOwnerStoresOfTypeInCity − 1))`.

**Location factor.** `L(plot) = clamp(Traffic(plot)/median Traffic(city), 0.3, 2.5)`. The traffic field comes from the city-layout model (population density, road class, distance to CBD; see caplab-brief §5.4). Until the layout exists, `L = 1.0`.

**Land price** is correlated so good locations cost more:
```
PlotPrice = BaseLandPrice_c($/m²) · 2,500 m² · ZoneMult · L^1.2 · LandIndex_c(t)
ZoneMult: commercial 1.0, residential 0.8, industrial 0.45, agricultural 0.05
```
`BaseLandPrice` reinterprets the existing content field as $/m² at median location: metropolis 150, eastside 180, hilltown 250, riverside 100, portbay 80. At those values a 9-plot commercial site in Metropolis costs $3.4M, and the same site on a prime (L = 1.6) plot costs $5.9M.

Calibrated effect of location on a Metropolis supermarket selling imports (§5): poor (L = 0.6) −1.8 % EBIT; average +7.8 %; prime (L = 1.6) +15.2 %.

---

### 4.4 (iv) World market: import/export spreads, depth and price impact

```
W_p(t)       = WBase_p · CPI_t · Commodity_p(t) · EventMult_p(t)            (P0: CPI=1, Commodity=1)
ImportPrice  = W_p · ImportMult_p · (1 + 0.10 · Vimp_p(t)/Depth_p)          (impact term P1)
ExportPrice  = W_p · ExportMult_p · (1 + Vexp_p(t)/Depth_p)^(−0.5) · (Q/50)^0.3   (quality term P1)
```
- `Vexp_p(t)` = **total** units of p exported by **all** companies this tick. `AutoExportSurplus` gathers every building's export quantity first, computes one price, then books every exporter at that price (deterministic, order-independent).
- `Vimp` is defined the same way for imports.
- At `V = Depth` the price factor is 0.707 and marginal revenue is 0.53·W. At `3 × Depth` the factor is 0.50. Exporting beyond about 1–2× depth is value-destroying, which ends the infinite money printer (F1).

| Class | ImportMult | ExportMult | Tradable |
|---|---|---|---|
| raw, intermediate | 1.10 (freight 8 % + broker 2 %) | 0.92 | yes |
| finished (default) | 1.12 (freight 5 % + importer 7 %) | 0.93 | yes |
| television | 1.08 | 0.94 | yes |
| car | 1.04 | 0.95 | yes |
| bread (perishable) | 1.35 | — | **import only, not exportable** |
| coffee_drink (fresh) | 1.20 | — | **import only, not exportable** |

`Depth_p` (content `worldMarketDepth`, units/month) is about 2–4 × one L1 slot's output. The values are: soft_drink 3.0M, beer 2.0M, t_shirt 240k, designer_jeans 24k, television 20k, car 600, sugar 6.0M kg, flour 6.0M kg, cotton_fabric 36k bolts, denim_fabric 18k, steel 9k t, plastic 4.5M kg, electronic_parts 600k, malt 3.0M kg, roasted_coffee 300k kg, sugarcane 18k t, wheat 3.6k t, cotton 480 t, iron_ore 40k t, crude_oil 48k bbl, coffee_beans 120 t, hops 72 t.

**Procurement rules.**
- `MaterialProcurement.BuyFromMarket` buys `min(requested, affordable)` with `affordable = (Cash + UndrawnRevolver − CashReserve)/ImportPrice`. `CashReserve` = 1 month of fixed costs. Shortfall reduces production or restock instead of creating negative cash (fixes E1/E8).
- Import quality = `ImportQuality_p` (50). Import brand = `ImportBrand_p`.
- `AutoExport` defaults to **false** for new buildings and cannot be set on non-tradable products.
- Inter-city internal shipping stays at 10 % of W in P0. P1 changes it to a distance × `freightIndex` rate (caplab-brief §2.10).
- **Seaport (P1):** an owner in city c pays half the freight part of Import/ExportMult on own flows, and its exports see `Depth × 2`.

---
### 4.5 (v) Labour: wages by city, headcount, and what `laborUnits` becomes

**Wages.**
```
Wage(role,c,t) = BaseWage(role) · WageIndex_c · WageLevel_t
WageLevel_t    = CPI_t · 1.01^(years since start)          (P1; P0 = 1)
```

| Role | BaseWage, fully loaded $/month (2026) | Derivation |
|---|---|---|
| production | 6,842 | BLS manufacturing $30.37/h × 173.3 h × 1.30 burden |
| retail | 4,855 | BLS retail $22.41/h × 173.3 × 1.25 |
| farm | 4,224 | $19.50/h × 173.3 × 1.25 |
| extraction (mine, oil) | 8,110 | $36.00/h × 173.3 × 1.30 |
| admin / management | 10,138 | $45.00/h × 173.3 × 1.30 |
| scientist (R&D) | 13,517 | $60.00/h × 173.3 × 1.30 |
| media | 8,800 | [design] |

City `wageIndex` (new content field): metropolis 1.00, eastside 1.02, hilltown 1.00, riverside 0.97, portbay 0.92. Optional P1 `priceIndex` (Pref multiplier): 1.00, 1.04, 1.05, 0.97, 0.94.

**Headcount.** Payroll is paid monthly on the building's committed headcount:
```
Headcount(building) = FixedStaff(type) · LevelStaffMult(level) + Σ_active slots StaffPerSlot
```
- "Active" means the slot is configured. Unconfigured slots cost nothing. Idle but configured slots still pay staff, which makes idle capacity cost something.
- `LevelStaffMult`: L1 1.00, L2 1.25, L3 1.50.
- `StaffPerSlot`:
  - production: the recipe's new field **`laborPerSlot`**, which replaces the unused `laborUnits`. The loader maps an old `laborUnits` value `u` to `laborPerSlot = 5·u` when the new field is missing. The proposed values are in Table 4.7-A (soft_drink 22, car 60, …).
  - extraction: raw's `laborPerSlot`.
  - retail: store type (§4.3).
  - research: 15 scientists.
  - warehouse: 4.
- `FixedStaff`:
  - factory_small 12 admin; factory_large 30 admin
  - warehouse_small 6; warehouse_large 12; seaport 60
  - small_farm 2 farm; large_farm 4 farm; small_plantation 3 farm
  - iron_mine 10 extraction; oil_well 4 extraction
  - rd_center 10 admin
  - tv_station 40 media; radio_station 12; newspaper_publisher 30; magazine_publisher 18
  - stores as in §4.3.

Ledger: one `Wages` entry per building per month (period cost; P0). **P1 absorption costing:** direct production wages, energy, line maintenance and line depreciation are added to the cost basis of the month's output, pro-rata by `laborPerSlot × cycles`. Per-product margins and the factory/store split of profit then become correct. Unabsorbed cost from idle capacity is expensed as `IdleCapacityCost`, as ASC 330 requires.

**P2:** a city labour pool (working-age population × participation) with wage pressure `+2 %` per 1 % of pool employed by companies above 20 %.

---

### 4.6 (vi) Utilities and overhead

| Item | Rule | Values |
|---|---|---|
| Building fixed opex (existing `monthlyOperatingCost`, re-based) | base load kWh × electricity price + security, cleaning, admin supplies | convenience 6k; supermarket 40k; department 60k; car dealership 18k; factory_small 45k; factory_large 120k; warehouse_small 20k; warehouse_large 55k; seaport 250k; small_farm 8k; large_farm 18k; small_plantation 9k; iron_mine 60k; oil_well 30k; rd_center 80k; tv_station 120k; radio 25k; newspaper 60k; magazine 35k. L2 ×1.30, L3 ×1.60. |
| Electricity | industrial 0.092, commercial 0.142 $/kWh × CPI (× city priceIndex, P1) | EIA Jun-2026 |
| Production energy | `kwhPerUnit × 0.092` charged at production and **capitalised** into the output's WAC (ledger `ProductionEnergy`, treated like `InputPurchase`) | per product, Table 4.7-A |
| Other purchased materials | `otherCostPerUnit` (packaging, concentrate, components not modelled as products), charged and capitalised at production (`OtherMaterials`) | per product, Table 4.7-A |
| Maintenance | 1.5 %/yr of structure cost + 4 %/yr of equipment cost, monthly | — |
| Insurance | 0.3 %/yr of gross PP&E | — |
| Property tax | 1.2 %/yr of (land cost + building net book value); agricultural land 0.6 % | — |
| Retail variable costs | 1.5 % of retail sales (card fees, shrink, bags) | — |
| Corporate overhead (P1, HQ) | $250k/month + 0.5 % of trailing-12-month revenue, from the first building onward | — |

---

### 4.7 (vii) Rebalanced world prices, recipes and buildings

**Table 4.7-A — products** (W = world FOB base price in $ at CPI 1). Recipes are defined **per output unit** plus a slot throughput. This replaces the 200-cycle abstraction: `SimulationConstants.CyclesPerSlotPerMonth` goes away, and the loader converts old recipes with `perUnit = quantity/outputQuantity` and `outPerSlotMonth = 200 × outputQuantity` when the new fields are absent.

| id | tier | unit | W $ | Import × | Export × | World depth/mo | Pref $ | Production (per slot-month at L1) |
|---|---|---|---|---|---|---|---|---|
| sugarcane | raw | t | 40 | 1.10 | 0.92 | 18,000 | – | 4,500 t; other $21/t; 4 staff; equip $0.9M; fields $2.2M |
| wheat | raw | t | 250 | 1.10 | 0.92 | 3,600 | – | 900 t; other $140/t; 3 staff; equip $0.9M; fields $2.2M |
| cotton | raw | t | 1,900 | 1.10 | 0.92 | 480 | – | 120 t; other $1,050/t; 4 staff; equip $0.9M; fields $2.2M |
| iron_ore | raw | t | 100 | 1.10 | 0.92 | 40,000 | – | 10,000 t; other $48/t; 14 staff; equip $8.0M |
| crude_oil | raw | bbl | 75 | 1.10 | 0.92 | 48,000 | – | 12,000 bbl; other $30/bbl (lifting, royalty); 6 staff; equip $12.0M |
| coffee_beans | raw | t | 7,000 | 1.10 | 0.92 | 120 | – | 30 t; other $3,300/t; 10 staff; equip $0.6M; fields $2.0M |
| hops | raw | t | 12,000 | 1.10 | 0.92 | 72 | – | 18 t; other $5,600/t; 9 staff; equip $0.7M; fields $2.0M |
| sugar | intermediate | kg | 0.60 | 1.10 | 0.92 | 6.0M | – | 2.0M kg; sugarcane 0.009 t/kg; other $0.05; 0.12 kWh; 10 staff; line $5.0M |
| flour | intermediate | kg | 0.50 | 1.10 | 0.92 | 6.0M | – | 2.0M kg; wheat 0.00133 t/kg; other $0.02; 0.07 kWh; 9 staff; line $3.5M |
| cotton_fabric | intermediate | bolt (40 m²) | 72 | 1.10 | 0.92 | 36,000 | – | 12,000; cotton 0.0070 t; other $26.50 (spinning/dye); 25 kWh; 24 staff; line $5.0M |
| denim_fabric | intermediate | bolt (40 m²) | 180 | 1.10 | 0.92 | 18,000 | – | 6,000; cotton 0.0175 t; other $77; 45 kWh; 24 staff; line $5.0M |
| steel | intermediate | t | 760 | 1.10 | 0.92 | 9,000 | – | 3,000 t; iron_ore 1.6 t; other $343 (coke, scrap, alloys); 480 kWh; 28 staff; line $15M |
| plastic | intermediate | kg | 1.45 | 1.10 | 0.92 | 4.5M | – | 1.5M kg; crude_oil 0.011 bbl; other $0.14; 1.1 kWh; 14 staff; line $10M |
| electronic_parts | intermediate | unit (module) | 10.00 | 1.10 | 0.92 | 600,000 | – | 200,000; plastic 0.05 kg, steel 0.0004 t; other $6.40 (chips, copper); 1.5 kWh; 40 staff; line $10M |
| malt | intermediate | kg | 0.72 | 1.10 | 0.92 | 3.0M | – | 1.0M kg; wheat 0.0013 t; other $0.13; 0.25 kWh; 9 staff; line $3.5M |
| roasted_coffee | intermediate | kg | 12.50 | 1.10 | 0.92 | 300,000 | – | 100,000 kg; coffee_beans 0.0012 t; other $0.41; 0.9 kWh; 12 staff; line $3.5M |
| soft_drink | finished | bottle 500 mL | 1.10 | 1.12 | 0.93 | 3.0M | 1.75 | 1.5M; sugar 0.050 kg, plastic 0.022 kg; other $0.71 (concentrate, cap, label, CO₂, carton); 0.03 kWh; 22 staff; line $8M |
| bread | finished | loaf | 1.95 | 1.35 | n/a | not exportable | 3.20 | 450,000; flour 0.45 kg; other $0.82 (yeast, oil, bag, delivery); 0.30 kWh; 30 staff; line $4.5M |
| beer | finished | bottle 355 mL | 1.12 | 1.12 | 0.93 | 2.0M | 1.90 | 1.0M; malt 0.060 kg, hops 0.7 g, plastic 0.004 kg; other $0.62 (glass, excise); 0.10 kWh; 22 staff; line $9M |
| coffee_drink | finished | cup | 1.85 | 1.20 | n/a | not exportable | 3.25 | 600,000; roasted_coffee 0.015 kg, plastic 0.025 kg; other $0.94 (milk, sugar, cup); 0.06 kWh; 22 staff; line $6M |
| t_shirt | finished | unit | 7.00 | 1.12 | 0.93 | 240,000 | 15.00 | 120,000; cotton_fabric 0.035 bolt (1.4 m²); other $1.22 (trims); 0.4 kWh; 30 staff; line $1.5M |
| designer_jeans | finished | unit | 55.00 | 1.12 | 0.93 | 24,000 | 130.00 | 12,000; denim_fabric 0.040 bolt (1.6 m²); other $11.75 (trims, washing); 1.5 kWh; 36 staff; line $2.5M |
| television | finished | unit | 345 | 1.08 | 0.94 | 20,000 | 480 | 10,000; electronic_parts 20, plastic 5 kg, steel 0.008 t; other $38.20 (panel glass, packaging); 15 kWh; 40 staff; line $10M |
| car | finished | unit | 30,500 | 1.04 | 0.95 | 600 | 35,000 | 300; steel 1.0 t, plastic 160 kg, electronic_parts 350; other $20,500 (powertrain, tyres, glass, seats); 900 kWh; 60 staff; line $35M |

**Resulting value added and margins** at full utilisation in a `factory_small` (1/6 of the building's cost per slot):

| product | Value added % of W | Direct labour % W | Depreciation % W | EBIT % W (imported inputs) | Full unit cost with own chain | Margin at W with own chain |
|---|---|---|---|---|---|---|
| sugarcane / wheat / cotton | 48 % / 44 % / 45 % | – | – | – | $28.49 / $172.76 / $1,300 | 28.8 % / 30.9 % / 30.0 % |
| iron_ore / crude_oil | 52 % / 60 % | – | – | – | $71.72 / $49.71 | 28.3 % / 33.7 % |
| coffee_beans / hops | 53 % / 53 % | – | – | – | $5,200 / $8,600 | 25.6 % / 28.4 % |
| sugar | 24 % | 5.7 % | 4.1 % | 9.8 % | $0.40 | 33.1 % |
| flour | 22 % | 6.2 % | 3.6 % | 7.2 % | $0.33 | 34.4 % |
| cotton_fabric | 40 % | 19.0 % | 5.6 % | 9.2 % | $60.09 | 16.5 % |
| denim_fabric | 35 % | 15.2 % | 4.5 % | 10.2 % | $148.38 | 17.6 % |
| steel | 26 % | 8.4 % | 5.8 % | 8.0 % | $637.83 | 16.1 % |
| plastic | 21 % | 4.4 % | 4.2 % | 9.1 % | $0.96 | 34.0 % |
| electronic_parts | 30 % | 13.7 % | 4.5 % | 8.9 % | $9.00 | 10.0 % |
| malt | 29 % | 8.6 % | 5.0 % | 9.2 % | $0.52 | 27.6 % |
| roasted_coffee | 22 % | 6.6 % | 2.9 % | 9.0 % | $8.39 | 32.9 % |
| soft_drink | 29 % | 9.1 % | 4.5 % | 11.7 % | $0.94 | 14.2 % |
| bread | 44 % | 23.4 % | 5.1 % | 9.8 % | $1.66 | 14.9 % |
| beer | 38 % | 13.4 % | 7.3 % | 11.7 % | $0.97 | 13.7 % |
| coffee_drink | 36 % | 13.6 % | 5.1 % | 12.0 % | $1.53 | 17.2 % |
| t_shirt | 42 % | 24.4 % | 2.3 % | 11.0 % | $5.56 | 20.6 % |
| designer_jeans | 64 % | 37.3 % | 4.2 % | 16.0 % | $44.21 | 19.6 % |
| television | 21 % | 7.9 % | 2.6 % | 8.0 % | $272.59 | 21.0 % |
| car | 16 % | 4.5 % | 3.3 % | 6.9 % | $27,400 | 10.2 % |

Value-added shares sit in the BEA ranges for their industries: farms about 40 %, oil and gas extraction 60 %+, food and beverage manufacturing 25–40 %, apparel about 40 %, motor vehicles 15–20 %, primary metals about 25 %. Compare 54–99 % today. "Own chain" margins are the reason to integrate: the upstream margin plus the avoided 10–12 % import spread. Integration raises chain ROIC by 4–9 points, not explosively: plastic + own oil 15.8 % → 24.9 %, sugar + own cane 15.7 % → 20.1 %, TV + own parts 19.7 % → 25.7 % (§5.2).

**Table 4.7-B — demand per finished product** (q in units per capita per month at reference):

| id | q Low / Mid / High | Category | Reference store | Metropolis $ demand/month at Pref |
|---|---|---|---|---|
| soft_drink | 24 / 26 / 22 | grocery | supermarket | $21.4M |
| bread | 6.5 / 6.0 / 5.0 | grocery | supermarket | $9.7M |
| beer | 12 / 13 / 11 | grocery | supermarket | $11.6M |
| coffee_drink | 4 / 8 / 12 | grocery | supermarket | $11.1M |
| t_shirt | 1.2 / 1.4 / 1.6 | apparel | department_store | $10.1M |
| designer_jeans | 0 / 0.08 / 0.20 | apparel | department_store | $4.0M |
| television | 0.009 / 0.012 / 0.016 | electronics | department_store | $2.7M |
| car | 0.0025 / 0.0042 / 0.0070 | auto | car_dealership | $67.5M |

These are category-level stand-ins: "soft_drink" covers non-alcoholic packaged beverages, "t_shirt" covers basic apparel. Metropolis spends about $141/capita/month on the seven non-car goods and about $135/capita/month on new cars ($1,620/yr against a US figure of about $2,240). The car volume, 0.046 units/capita/yr, matches US new-car sales of about 0.045 per capita per year.

**Table 4.7-C — production, logistics and other buildings** (capex excludes land and per-slot line/field/equipment capex):

| id | Capex | Plots | Slots L1/L2/L3 | Upgrade capex L2 / L3 | Life (structure) | Build months |
|---|---|---|---|---|---|---|
| factory_small | $15M | 9 | 6 / 9 / 12 | 60 % / 50 % of base | 30 y | 5 |
| factory_large | $48M | 25 | 12 / 18 / 24 | 60 % / 50 % | 30 y | 8 |
| small_farm | $1.5M (+ fields $2.2M/slot, land) | 9 | 3 / 4 / 6 | 60 % / 50 % | 20 y | 2 |
| large_farm | $4.0M (+ fields $2.2M/slot) | 25 | 6 | – | 20 y | 3 |
| small_plantation | $1.8M (+ fields $2.0M/slot) | 9 | 3 | – | 20 y | 3 (+6-month first-harvest lag, P1) |
| iron_mine | $12M (+ $8M equipment/slot) | 9 | 3 | – | 20 y | 10 |
| oil_well | $6M (+ $12M equipment/slot) | 4 | 2 / 3 / 4 | 60 % / 50 % | 15 y | 4 |
| warehouse_small | $5M | 4 | 4 | – | 30 y | 3 |
| warehouse_large | $22M | 16 | 8 | – | 30 y | 5 |
| seaport | $120M | 15 | 8 | – | 40 y | 12 |
| rd_center | $25M | 9 | 4 | – | 30 y (lab equipment 25 % at 5 y) | 6 |
| tv_station | $40M | 9 | 1 | – | 25 y | 6 |
| radio_station | $5M | 4 | 1 | – | 25 y | 3 |
| newspaper_publisher | $15M | 9 | 1 | – | 25 y | 4 |
| magazine_publisher | $8M | 9 | 1 | – | 25 y | 4 |

Warehouse storage (new): each slot holds at most `$5M` (small) / `$10M` (large) of stock at W, a cap by value that fixes E8. Line equipment is bought when a production slot is first configured for a product family (P1: re-tooling to a different family costs 25 % of the new line; P0: line capex charged at first configuration).

---

### 4.8 (viii) Depreciation and land

- **Method:** straight line, monthly, zero salvage. Depreciation starts the month after the asset is completed or installed.
- **Accounting:** each depreciation charge is a **non-cash journal entry** (`AccrualJournal`, §4.15) that increases `AccumulatedDepreciation` and hits the income statement as its own line. It is not part of COGS in P0; in P1 production-line depreciation is absorbed.

| Asset class | Life | Applies to |
|---|---|---|
| Structure: retail, industrial, warehouse, R&D, HQ | 30 y (360 mo) | 75 % of store capex; 100 % of factory, warehouse and R&D shells |
| Structure: media, seaport | 25 y / 40 y | – |
| Store fixtures & equipment | 10 y | 25 % of store capex |
| Production line equipment | 10 y | per-slot `line` capex |
| Farm and plantation buildings | 20 y | shell |
| Farm equipment | 12 y | per-slot equipment |
| Plantation trees/equipment | 15 y | per-slot equipment |
| Mine equipment | 20 y | per-slot + shell |
| Oil well | 10 y | per-slot; P2 swaps to units-of-production depletion |
| R&D lab equipment | 5 y | 25 % of rd_center capex |
| Upgrades | capitalised to the building's structure; depreciated over max(120, remaining life) months | fixes F8 |
| **Land and farm fields** | **not depreciated**, carried at historical cost | market value (`LandIndex`) is tracked for net worth and valuation only |

**Disposal (P1).**
- Proceeds = land at current market value + structure at 60 % × depreciated replacement cost (replacement cost = original × CPI ratio).
- The gain or loss goes to the journal; the cash goes to the ledger as `AssetSale`.
- The building is removed; its retail draw is added to the incumbent mass of its city.

---

### 4.9 (ix) Corporate income tax with loss carry-forward

**Rate.** `TaxRate = 0.25` flat (US federal 21 % plus about 4 % state). P2: per-city or country override.

**Tax base.** `TaxableIncome = Revenue − COGS − Opex − Depreciation − Interest ± gains`. Book equals tax: same depreciation, no deferred taxes.

**Monthly year-to-date settlement** (cash-basis tax, deterministic):
```
TI_ytd      = Σ taxable income Jan..current month
NOLuse_ytd  = min(NOL_open, 0.80 · max(0, TI_ytd))
TaxDue_ytd  = TaxRate · max(0, TI_ytd − NOLuse_ytd)
Payment_t   = TaxDue_ytd − TaxPaid_ytd       (negative = refund of tax already paid this year; never below −TaxPaid_ytd)
```
**Year-end (December tick).**
```
NOL_open(next) = NOL_open − NOLuse_ytd + max(0, −TI_ytd)       (indefinite carry-forward)
TaxPaid_ytd = 0
```
- Ledger: `IncomeTax` (negative = payment, positive = refund).
- Income statement: `IncomeTaxExpense` = the month's `Payment_t`.
- Persist per company `NOL_open`, `TI_ytd`, `TaxPaid_ytd`.
- **Worked example:** year 1 taxable −$6M → NOL $6M. Year 2 taxable +$10M → usable NOL = min(6, 0.8 × 10) = $6M → tax = 25 % × $4M = **$1.0M**, and the NOL is fully used.

---
### 4.10 (x) Bank loans, credit rating, borrowing limits, amortisation

**Rates** (policy rate `i_t` from §4.13; P0 holds it at **4.00 %**, the Sep-2026 fed funds midpoint).
```
RF(term)        = i_t + TermPremium(term)         TermPremium: ≤1y 0.00 %, 5y 0.50 %, 10y 0.75 %, 20y 1.00 % (linear in between)
TermLoanRate    = RF(term) + Spread(rating) + 0.75 %          (fixed at origination)
RevolverRate    = i_t + Spread(rating) + 1.50 %               (floating, reset monthly)
DepositRate     = max(0, i_t − 1.00 %) on positive cash      (P1, ledger InterestIncome)
Spread (Damodaran Jan-2026): AAA 0.40 | AA 0.55 | A+ 0.70 | A 0.78 | A− 0.89 | BBB 1.11 | BB+ 1.38 | BB 1.84 | B+ 2.75 | B 3.21 | B− 5.09 | CCC 8.85 | CC 12.61 | C 16.00 | D 19.00 (%)
```
At `i = 4.00 %`, 10-year loans cost: AAA 5.90 %, A 6.28 %, BBB 6.61 %, BB 7.34 %, B 8.71 %, CCC 14.35 %. Revolver at BBB: 6.61 %. For comparison, prime is 7.00 % and SBA 7(a) loans run prime + 2.25–4.75 %.

**Credit rating** (recomputed quarterly in months 3/6/9/12; notch scale AAA=0 … C=13, D=14).
1. `N_icr` from TTM `EBIT / InterestExpense` using Damodaran's large-firm bands: ≥8.5 AAA, ≥6.5 AA, ≥5.5 A+, ≥4.25 A, ≥3.0 A−, ≥2.5 BBB, ≥2.25 BB+, ≥2.0 BB, ≥1.75 B+, ≥1.5 B, ≥1.25 B−, ≥0.8 CCC, ≥0.65 CC, else C. No interest expense gives AAA.
2. `N_lev` from `NetDebt / EBITDA` (TTM): ≤0.5 AAA, ≤1.0 AA, ≤1.5 A+, ≤2.0 A, ≤2.5 A−, ≤3.0 BBB, ≤3.5 BB+, ≤4.0 BB, ≤4.5 B+, ≤5.5 B, ≤6.5 B−, ≤8 CCC, ≤10 CC, else C. Net debt ≤ 0 gives AAA. EBITDA ≤ 0 with net debt > 0 gives CCC (CC if ICR < 0.65).
3. `N_size` cap by total assets: < $25M → no better than BBB; < $100M → A−; < $500M → A+; < $2B → AA.
4. Equity ≤ 0 → no better than CCC. A company younger than 12 months is **unrated**; it is priced as BBB if Debt ≤ 0.5·Equity, otherwise BB.
5. `Rating = max(N_icr, N_lev, N_size, N_equity)`, then +1 notch if `Cash + UndrawnRevolver < 1 × monthly fixed costs`. Movement is capped at ±2 notches per quarter, except a move to D, which only the default logic sets (§4.14).

Example: TTM EBIT $13M, EBITDA $18M, interest $2.4M, debt $40M, cash $6M, assets $150M. ICR 5.42 → A; net leverage 1.89 → A; size cap A+ → **A** (spread 0.78 %). A new 10-year loan then costs 6.28 %.

**Borrowing capacity.**
```
Collateral      = 0.70·LandCost + 0.60·BuildingsNBV + 0.40·EquipmentNBV + 0.50·InventoryAtCost + 0.30·CIP
CashFlowCap     = k(rating)·EBITDA_TTM        k: AAA…A− 4.0, BBB 3.5, BB+/BB 3.0, B+…B− 2.5, CCC or worse 0
DebtCapacity    = history ≥ 12 months ? min(Collateral, CashFlowCap) : 0.5·Collateral
RevolverLimit   = clamp(DebtCapacity − TermDebt, 0, 0.20·TotalAssets)
NewTermLoanMax  = DebtCapacity − TermDebt − RevolverDrawn
```
**Term loans.**
- Amount ≤ `NewTermLoanMax`; term 1–20 years; monthly annuity. Worked example: $20M over 10 years at BBB (6.61 %) → **$228,217/month**; month-1 interest $110,167 and principal $118,050.
- `payment = P·r/(1 − (1+r)^−n)`, with `r = rate/12`.
- Prepayment is free in P0 (1 % fee in P1).
- Ledger: `LoanDrawdown` (+), `LoanRepayment` (− principal), `InterestExpense` (−).

**Revolver** (automatic overdraft that replaces negative cash, fixing F5).
- After all of a tick's payments, if `Cash < 0` → draw `min(−Cash, RevolverLimit − drawn)` (`RevolverDraw`).
- If `Cash > 2 × monthly fixed costs` and the revolver is drawn → repay the excess (`RevolverRepay`).
- Interest is charged monthly on the opening balance.
- Commitment fee 0.25 %/yr on the undrawn amount (P1).

**Covenants (P1, tested quarterly).** `NetDebt/EBITDA ≤ 4.5` and `ICR ≥ 1.5`. A breach adds +2.00 % to floating debt and blocks new borrowing, dividends and buybacks until cured.

**Bonds (P2):** 5/10/15/20-year bullets priced at `RF(term) + Spread + 0.25 %`, marked to market when rates move (CapLab Banking DLC).

---

### 4.11 (xi) Equity: shares, IPO, issuance, share price, dividends, buybacks

**Founding.**
- `CreateCompany` issues `FoundingShares = 10,000,000`; `PaidInCapital = startingCash` (ledger category `StartingCapital` stays; it now maps to paid-in capital).
- The founder (player or AI owner) holds 100 %; everyone starts **private** (caplab-brief open question 2 recommends the same).

**Fundamental value** (residual-income / value-driver model; monthly):
```
RF10    = i_t + 0.75 %               ERP = 4.5 %           βU = 0.80 (P2: per-industry revenue mix)
βL      = min(3.0, βU·(1 + (1 − 0.25)·Debt/max(Equity, 1)))
r_e     = RF10 + βL·ERP + SizePremium          SizePremium = 1.0 % if TotalAssets < $250M else 0
g       = min(r_e − 2 %, clamp(0.5·RevenueCAGR_3y + 0.5·3 %, −2 %, 8 %))
ROE_n   = NI_TTM / average Equity over the last 4 quarter-ends, clamp [−50 %, 60 %]
E_f     = Equity · clamp((ROE_n − g)/(r_e − g), 0.25, 8.0)                  (= P/B × book)
if Equity ≤ 0: E_f = max(0.01·N, 0.25·max(0, 6·EBITDA_TTM − NetDebt))
```
**Sentiment and price (listed companies).**
```
s_t = clamp(0.85·s_{t−1} + 0.15·MacroSentiment(regime) + EarningsSurprise_t + 0.03·ε_t, −0.40, 0.40)      (ε from RNG stream "market")
MacroSentiment: expansion +0.05, slowdown −0.05, recession −0.20, recovery +0.05
EarningsSurprise_t (quarter months only) = 0.10·clamp((NI_q − NI_q^exp)/max(|NI_q^exp|, 0.01·Equity), −1, 1),   NI_q^exp = NI of the same quarter last year × (1 + g)
Price_t = E_f · exp(s_t) / N_t ;   MarketCap = Price·N
```
Private companies show `E_f/N` as "estimated value per share".

**Worked P/E values** (RF10 4.75 %, debt $40M, equity $90M → βL 1.07, r_e 10.55 %):

| ROE | g | P/B | P/E |
|---|---|---|---|
| 8 % | 3 % | 0.66 | 8.3 |
| 20 % | 3 % | 2.25 | 11.3 |
| 30 % | 5 % | 4.50 | 15.0 |

Rising policy rates raise `r_e` and compress valuations, as in real markets.

**Corporate actions.**

| Action | Eligibility / limits | Price | Fees / effects | Ledger |
|---|---|---|---|---|
| IPO | TTM revenue ≥ $50M, TTM NI > 0, Equity ≥ $30M (normal) | 0.90 × E_f/N | new shares ≤ 40 % of post-IPO N; underwriting 6 % of gross, charged against paid-in capital; company becomes *listed* | `ShareIssuance` (+gross), `ShareIssuanceFee` (−) |
| Secondary offering | listed; ≤ 20 % of N per rolling 12 months | 0.95 × Price | fee 4 %; sentiment −0.03 | same |
| Buyback | listed; ≤ 10 % of N per rolling 12 months; NetDebt/EBITDA ≤ 3.0; cash after ≥ 3 months of fixed costs; no covenant breach | 1.02 × Price | shares retired; reduce PaidIn by average issue price × shares, remainder from RetainedEarnings | `ShareBuyback` (−) |
| Dividend (quarterly, months 3/6/9/12) | RetainedEarnings ≥ amount; cash after ≥ 2 months of fixed costs; not in distress or breach | DPS set by player; AI pays 30–50 % of TTM NI when NetDebt/EBITDA < 2 (Damodaran market payout 34.8 %) | reduces RetainedEarnings | `DividendPaid` (−) |

- **Personal net worth (P1):** founder shares × price + personal cash (dividends net of 15 % tax). This is CapLab's PNW score and becomes the headline sandbox score.
- **Takeovers, mergers, subsidiaries, player stock trading:** P2.
- **Stock merge/split** below $1 / above $100: P2.

---

### 4.12 (xii) Construction duration and progress payments

`World.Construct(owner, type, city, plot)` becomes:
1. Validate zoning, geography (enforce `GeographyRequirement`, fixing E9), footprint, and the cash test `Cash + UndrawnRevolver ≥ LandPrice + 0.20·Capex`.
2. Pay land (`LandPurchase`, capitalised to Land) and a 20 % deposit (`ConstructionPayment` → Construction-in-Progress, CIP).
3. Create the building in state `UnderConstruction(remaining = BuildMonths)`. Slots may be configured but nothing runs. Only insurance and property tax are charged.
4. Each tick: pay `0.80·Capex/BuildMonths` (`ConstructionPayment` → CIP) and decrement `remaining`. If the payment cannot be funded (cash + revolver), construction **pauses** that month at no cost.
5. When `remaining = 0`: CIP moves to PP&E (split into structure/fixtures classes), depreciation starts next month, and the building is `Operational`.
6. Cancel: recover 50 % of CIP, recognise the rest as a loss (journal).

Upgrades use 50 % of base build time (rounded up), the same 20 %/80 % payment schedule, capitalisation (§4.8), and keep operating at the old level until done. Line equipment takes 1 month to install and is paid on order.

**BuildMonths (game-compressed ≈ 40 % of real):** convenience 2, supermarket 4, department store 6, car dealership 4, electronics store 3, boutique 2, warehouse_small 3, warehouse_large 5, seaport 12, factory_small 5, factory_large 8, small_farm 2, large_farm 3, small_plantation 3, iron_mine 10, oil_well 4, rd_center 6, tv_station 6, radio 3, newspaper 4, magazine 4.
- For new types, fall back to `ceil(k·√plots)` with k: retail 1.3, logistics 1.5, industrial 1.6, R&D 2.0, media 1.5, mine 3.3, seaport 3.1.
- `ConstructionTimeScale` setting: 1.0 by default, 2.5 for "realistic".

---

### 4.13 (xiii) Macro economy

Regime-switching business cycle with inflation and a Taylor-rule central bank. It runs monthly from RNG stream `"macro"`; P1, with P0 constants frozen at the initial state.

| Regime | Target real GDP growth (annualised) | Inflation adj. | Mean duration | Next regime |
|---|---|---|---|---|
| Expansion | +3.0 % | +0.4 pt | 54 months | Slowdown |
| Slowdown | +0.8 % | +0.2 pt | 12 months | Recession 55 % / Expansion 45 % |
| Recession | −2.5 % | −0.8 pt | 10 months | Recovery |
| Recovery | +4.5 % | −0.2 pt | 14 months | Expansion |

```
exit regime with probability 1/duration each month
g_t   = 0.85·g_{t−1} + 0.15·g_regime + N(0, 0.002)
gap_t = clamp(0.95·gap_{t−1} + (g_t − 0.02)/12, −0.08, 0.05)
π_t   = 0.92·π_{t−1} + 0.08·(0.02 + adj_regime + 0.25·gap_t) + N(0, 0.0008)
i*_t  = max(0.0025, 0.01 + π_t + 0.5·(π_t − 0.02) + 0.5·gap_t)          (Taylor rule, r* = 1 %, π* = 2 %)
i_t   = 0.90·i_{t−1} + 0.10·i*_t ;   CPI_t = CPI_{t−1}·(1 + π_t)^(1/12)
init: expansion, g 2.5 %, π 2.7 %, i 4.0 %, gap 0
```
Simulated over 20 seeds × 100 years: policy rate mean **3.96 %** (p5 1.24 %, p95 5.40 %); inflation mean **2.40 %** (p5 1.26 %, p95 3.06 %); **7.5 %** of months in recession. For reference, the US has spent about 10–13 % of months in recession since 1980. Raise the Slowdown→Recession probability to 0.65 if more cycles are wanted.

**Channels into the micro model.**
- **Demand:**
  ```
  MacroMult_p = IncomeIndex_c^η_p · (durable_p ? 1 + 3.0·(g_t − 0.02) : 1)
  IncomeIndex_c(t) = IncomeIndex_c(t−1)·(1 + (g_t − popGrowth_c)/12)
  ```
  Income elasticity η: bread 0.1, soft_drink 0.4, beer 0.5, coffee_drink 0.8, t_shirt 0.9, television 1.4, designer_jeans 1.8, car 2.0. Durables are television and car; a recession cuts them about 15–20 % (CapLab "necessity").
- **Population:** `Pop(t) = Pop(t−1)·(1 + (popGrowth_c + 0.25·(g_t − 0.02))/12)`, with popGrowth metropolis 1.0 %, riverside 1.2 %, eastside 1.5 %, portbay 0.5 %, hilltown 0.8 %/yr. Each December, move 0.5 × (real per-capita income growth) of the population from Low to Mid and 0.3 × from Mid to High (reverse if negative; each share ≥ 0.05).
- **Prices and costs:** W, Pref, capex, fixed opex and land are × CPI; wages × `WageLevel`. Player-set retail prices are nominal; the UI offers "auto-index prices" and the AI re-prices monthly.
- **Commodities:** `x_p = 0.97·x_{p,t−1} + σ_p·ε` (RNG stream `"commodities"`), `W_raw = WBase·CPI·exp(x_p)`, with monthly σ: crude 0.07, coffee 0.06, iron ore 0.055, wheat 0.05, cotton 0.045, sugarcane 0.045, hops 0.03. Intermediates and finished goods pass through input moves: `W_p = CPI·(WBase_p − Σq·WBase_in) + Σq·W_in,t`. The television's real price falls 3 %/yr (tech deflation). Existing events stay as multiplicative overlays.
- **Land:** `LandIndex_c = (Pop/Pop₀)^1.5 · IncomeIndex_c · CPI`.
- **Rates:** the revolver floats with `i_t`; term loans stay fixed; `r_e`, and so share prices, move with `i_t`.

---

### 4.14 (xiv) Bankruptcy

1. **Liquidity waterfall each tick:** payments → revolver auto-draw (§4.10). Negative cash can only occur when the revolver is exhausted.
2. **Default:** at tick end `Cash < 0` with the revolver at its limit, or a missed scheduled loan payment.
   - The company enters **Distress**: rating becomes **D**; a *DistressInterest* of 2 %/month is charged on the negative balance.
   - Blocked: construction, upgrades, new loans, dividends, buybacks; ad spend is capped at 50 % of last month.
   - A news event fires. The player gets a 3-month cure clock in the UI.
3. **Cure:** 1 full month with `Cash ≥ 0` and the revolver within its limit. The rating resets to max(computed, CCC) and is capped at B− for 12 months.
4. **Bankruptcy** triggers if the company is not cured within **3 months**, or at any quarter-end with `Equity < −20 % × TotalAssets`. **Liquidation:**
   - Buildings sell at fire-sale value: land 70 % of market, structures 40 % of NBV, inventory 50 % of cost.
   - Proceeds repay the revolver and then term loans pro-rata. Lenders absorb any shortfall; there is no cross-company contagion in P0.
   - The residual goes to shareholders.
   - The company is removed. Its retail capacity is added to the incumbent mass in each city, so demand does not vanish.
   - The player gets the Lose screen in scenarios, replacing the client's "6 months negative cash" rule (`client/scripts/Main.cs:910`). Sandbox offers CapLab's "continue as individual".
5. **AI solvency rules** (§4.17) keep AIs out of distress in normal play. A regression check fails if any AI defaults in the standard sweep.

---
### 4.15 Accounting model (ledger, journal, statements, invariants)

The cash `Ledger` stays the single source of cash, so `Company.Cash == Σ ledger` still holds. A new **`AccrualJournal`** (append-only, like `CogsLog`) records non-cash items. Statements are pure functions of: Ledger, CogsLog, AccrualJournal, inventories and the asset registers.

**Cash ledger categories** (append to `LedgerCategory`; serialization is by name, so old saves stay valid):

| Category | Sign | Income statement | Balance sheet | Cash flow |
|---|---|---|---|---|
| StartingCapital *(existing)* | + | – | Paid-in capital | Financing |
| ShareIssuance / ShareIssuanceFee | + / − | – | Paid-in capital | Financing |
| ShareBuyback | − | – | Paid-in capital / Retained earnings | Financing |
| DividendPaid | − | – | Retained earnings | Financing |
| LoanDrawdown / LoanRepayment | + / − | – | Term loans | Financing |
| RevolverDraw / RevolverRepay | + / − | – | Revolver | Financing |
| LandPurchase | − | – | Land | Investing |
| ConstructionPayment *(ConstructionCost for legacy)* | − | – | CIP → PP&E | Investing |
| EquipmentPurchase *(line equipment)* / UpgradeCost *(existing, now capitalised)* | − | – | PP&E | Investing |
| AssetSale / LiquidationProceeds | + | via journal gain/loss | derecognise | Investing |
| InputPurchase, RetailRestock, ShippingCost *(existing)*, OtherMaterials, ProductionEnergy | − | via COGS when sold | Inventory | Operating |
| ProductSale, ExportSale, PatentRoyaltyIncome *(existing)* | + | Revenue | – | Operating |
| Wages, Utilities, Maintenance, Insurance, PropertyTax, RetailVariable, CorporateOverhead, AdvertisingCost, PatentRoyaltyExpense, OperatingCost *(legacy)* | − | Operating expenses | – | Operating |
| InterestExpense, DistressInterest / InterestIncome | − / + | Net interest (below EBIT) | – | Operating |
| IncomeTax | − (refund +) | Income tax | – | Operating |

**AccrualJournal kinds:**
- `Depreciation` → IS D&A; BS accumulated depreciation.
- `DisposalGainLoss` and `ConstructionWriteOff` → IS other.
- P1: `InventoryWriteDown` (spoilage/obsolescence → COGS) and `ConversionAbsorbed`.

**Statements.**
```
Revenue      = ProductSale + ExportSale + PatentRoyaltyIncome
GrossProfit  = Revenue − COGS(CogsLog)
EBITDA       = GrossProfit − Σ operating-expense categories
EBIT         = EBITDA − Depreciation(journal)
EBT          = EBIT − InterestExpense − DistressInterest + InterestIncome + DisposalGainLoss − WriteOffs
NetIncome    = EBT − IncomeTax(ledger, sign-adjusted)
Assets       = Cash + Inventory(WAC) + LandCost + GrossPP&E − AccumulatedDepreciation + CIP
Liabilities  = TermLoansOutstanding + RevolverDrawn            (tax is settled monthly, so no payable)
Equity       = PaidInCapital + RetainedEarnings
PaidIn       = Σ StartingCapital + Σ ShareIssuance − Σ ShareIssuanceFee − buyback-at-issue-price
Retained     = Σ NetIncome − Σ DividendPaid − buyback-excess
```
- **Invariant (new regression test):** `Assets − Liabilities == Equity` exactly (decimal), every company, every month. This replaces today's "books close" identity, which breaks on upgrades (F8).
- `IncomeStatement` gains fields (`Ebitda`, `Depreciation`, `InterestNet`, `Tax`, `OtherGains`) while keeping `Revenue/CostOfGoodsSold/OperatingExpenses/GrossProfit/NetIncome` for existing callers. `OperatingExpenses` then includes everything above EBIT.
- `BalanceSheet` gains `Land, GrossPpe, AccumulatedDepreciation, Cip, TermLoans, Revolver, PaidInCapital, RetainedEarnings`. `Liabilities` is computed.
- Cash-flow statement: map ledger categories to Operating/Investing/Financing as above; `ΔCash = CFO + CFI + CFF` by construction.

### 4.16 New monthly tick order

`World.AdvanceMonth`: AI decisions (unchanged position), then:

1. Advance the clock. **Macro step:** regime, g, gap, π, i, CPI, wage level, population, income mix, land index (P1).
2. **World prices:** commodity cycles and event overlays (existing `ActivePriceEffects`).
3. **Construction progress:** instalments, completions, pauses.
4. **Payroll and building costs:** wages, fixed opex, maintenance, insurance, property tax.
5. Research: points from active slots. Scientist wages were already paid in step 4.
6. Advertising: spend, then brand update with decay applied to **all** triples (§4.20).
7. Extraction: output with its cash cost capitalised (other cost per unit).
8. Production: intermediate tier, then finished tier. Materials, other materials and energy are capitalised; slot throughput; quality formation (P1).
9. Restock warehouses, then retailers, capped by stock caps, value caps and affordability.
10. **Demand allocation and sales** (§4.1–4.3), with spill.
11. **Exports:** aggregate volume, one price per product, book all exporters.
12. Patent royalties (unchanged).
13. **Finance:** interest (loans, revolver, deposits); scheduled amortisation; revolver sweep.
14. **Depreciation** journal.
15. **Tax** (YTD settlement; December NOL roll).
16. Quarter-end only: rating update, dividends, covenant tests, share-price earnings surprise. Every month: share price.
17. **Solvency:** distress, cure and bankruptcy.
18. **Incumbent dynamics** (P1).
19. Events roll (unchanged, last).

### 4.17 AI changes required (without these the new economy still breaks)

- **Pricing** replaces `min(rival)×0.95` and `max(rival)×1.30`:
  - Add a pure read-only `World.PreviewDemand(city, product, hypotheticalOffer)` that runs the §4.1 function with everything else frozen.
  - Each month and line, evaluate candidate prices `{0.95, 1.00, 1.05} × current` and keep the best expected gross profit.
  - Clamp to `[unitCost·1.05, 1.6·Pref]`; move at most ±5 %/month.
  - Fallback without preview (sell-through rule): +3 % if sold out, −3 % if sell-through < 70 %.
- **TechLeader:** hero price = `Pref · M_j^0.8` (value-based premium), floored at `(CostOf/Get) × 1.10`, a per-unit cost (fixes F4). Delete the "max competitor × 1.3" rule (fixes F3).
- **Store choice:** cars → car_dealership, apparel/electronics → department_store (or the P1 specialty stores), groceries → supermarket or convenience.
- **Expansion test:**
  - Projected EBIT from `PreviewDemand` at L = 1 for a hypothetical store, minus the store's opex, depreciation and a 3 % capital charge.
  - Build only if simple payback ≤ 8 years (normal difficulty) and `Cash + UndrawnRevolver + NewTermLoanMax ≥ land + capex + 6 × monthly fixed costs`.
  - At most one new building per month (as today).
- **Restock:** target = 1.2 × trailing sales, capped at the stock cap.
- **Finance:**
  - Target `NetDebt/EBITDA ≤ 2.5`.
  - Take term loans for expansions when rating ≥ BB and expected ROIC > loan rate + 3 %.
  - Keep cash ≥ 2 months of fixed costs.
  - Pay 30–50 % dividends when `NetDebt/EBITDA < 2` (P1).
- **Advertising:** a campaign only where the brand lever pays: budget = min(6 % of that product's city revenue, the sustain budget for awareness 60). No campaign in markets where share < 2 %.
- **Distress playbook:** ads → 0; restock → 0.8 × sales; freeze expansion; after 6 months of negative EBITDA, sell the worst building (lowest EBITDA/capital).
- **VerticalIntegrator:** integrate upstream only if own supply saves ≥ 5 % of the downstream line's material cost, or the chain's projected ROIC > 12 %. Auto-export only when the export netback ≥ full unit cost.
- **SimpleRetailer:** add monthly re-pricing using the sell-through rule. Today it never re-prices.

### 4.18 Scenarios, goals and corporate value

- **One definition of corporate value**, engine-side: `World.GetCorporateValue(c) = listed ? MarketCap : E_f` (§4.11). The client stops computing its own (`client/scripts/GameState.cs:200-212`). `CorporateValueGoal` uses it instead of total assets, which would otherwise count borrowed money (`Scenarios/Goal.cs:27-40`).
- New goal types: `totalAssets` (legacy semantics), `netWorth` (P1), `creditRating` (e.g. "reach A"), `ipo`, `dividendYield` (P2).
- **Market share** goals and `GetMarketShare` switch to **trailing-3-month units sold ÷ all units including the incumbent**, instead of the softmax replay that ignores reservation prices (`World.cs:949-978`).
- **Rescale scenario content** (realistic-scale choice):
  - Starting cash ×3 for normal difficulty (e.g. sandbox $30M → $90M; tutorial $15M → $45M), and AI starting cash ×3. Alternative: difficulty presets Easy $150M / Normal $90M / Hard $60M / Expert $30M.
  - CV thresholds ×2.5; net-income thresholds ×3.
  - **Export-revenue thresholds ×25**. One factory slot now exports $0.6–9M/month, and exports are no longer free money. For example `export_tycoon` "$5M in 5 years" → "$125M in 5 years", which is about two soft-drink export lines.
  - Market-share and brand thresholds unchanged.
- **Tutorial retune:** an average-location supermarket selling imported soft drinks at about 0.95 × Pref shows a thin positive margin. Advertising or own production then visibly lifts price and margin, which teaches the real levers.

### 4.19 Persistence (schema v10) and determinism

**Persist:**
- company: loans `{principal, rate, termMonths, remaining, payment, originated}`, revolver drawn, rating `{notch, asOf}`, tax `{nolOpen, tiYtd, taxPaidYtd}`, equity `{shares, paidIn, retained, listed, sentiment}`, distress state
- building: state, remaining build months, CIP, land cost, asset register `{class, cost, accumulatedDep, lifeMonths, startMonth}`
- world: macro `{regime, g, gap, π, i, cpi, wageLevel}`, commodity `x_p`, city `{pop, mix, incomeIndex, landIndex}`, incumbent mass per (c,p), **RNG stream states**

**Determinism (fixes F11):**
- Replace `System.Random` with a small-state PRNG (xoshiro256** seeded by SplitMix64): one stream per subsystem (`events`, `macro`, `commodities`, `market`), `seed_stream = SplitMix64(worldSeed ⊕ FNV1a(streamName))`.
- Persist each stream's 256-bit state and the world seed. `WorldSaver.cs:302` currently writes `Seed: 0`.
- Adding a new random consumer must never shift another stream.

**Backward compatibility (v9 → v10):**
- no loans; shares 10M; `PaidIn = Σ StartingCapital`; `Retained = Equity − PaidIn`
- buildings operational with `AccDep = 0`, historical capex as cost, **land cost 0** (flagged legacy); incumbents at base; macro at initial state
- RNG streams seeded from the saved seed (0 for old saves) plus the month index

**Cross-runtime math.** `Math.Exp/Log/Pow` can differ in the last ulp between desktop CoreCLR and browser WASM. That is fine within one platform. P2: a portable math shim, if replays must match across platforms.

### 4.20 Advertising adjustments (fixes F10; P0 because it is small)

```
CostPerPoint(c, channel) = ChannelK(channel) · Pop_c/1000 · CPI_t          ChannelK: TV 25, Radio 18, Newspaper 20, Magazine 28 ($ per 1,000 residents per awareness point)
Brand_{t+1} = Brand_t·(1 − 0.03) + (Spend·MediaBonus / CostPerPoint)·(1 − Brand_t/100)    (decay applies every month, campaign or not)
```
The sustain budget for awareness `B*` is `0.03·B*/(1 − B*/100)·CostPerPoint`: Metropolis TV $12.5k/point → B 50: $37.5k/month; B 70: **$87.5k**; B 85: $212.5k. Hilltown costs 1/5 of that. At $200k/month × Pop/500k, awareness reaches 60 / 77 / 84 at months 6 / 12 / 24 in every city. A strong local brand (B 70) then costs about 1–4 % of a mid-size player's city sales in that product, against a real ad-to-sales ratio of 8 % for soft drinks and 1.6 % for cars.

---
## 5. Target balance outcomes and calibration evidence

### 5.1 Targets (acceptance bands for the implemented model)

| # | Target | Band | Proposed model (Python calibration) |
|---|---|---|---|
| T1 | Good play: integrated chain, own brand, good sites | pre-tax ROIC **20–40 %**; after-tax payback **2–6 yrs** | G1 21.7 %, G2 35.7 %; car chain incl. R&D and ads 16.8–27.5 % |
| T2 | Average play: imports, average site, sensible price | pre-tax ROIC **5–12 %**; payback 6–14 yrs | supermarket 6.1–11.4 %; 6-store chain 7.2 % |
| T3 | Naive play: poor site, or no demand check, or over-pricing | **negative** EBIT, cash burn → distress in 2–5 yrs if unmanaged | poor-site supermarket −2.2 % to −5.2 %; poor department store −5 to −7 %; import-only car dealer −4 to −16 % |
| T4 | Monopoly bound (no incumbents, uncapped) | profit-maximising price **1.2–1.6 × Pref**; gross profit at 20 × ≈ 0 | optimum 1.25–1.5 × for all 8 goods; profit at 20 × < $250 |
| T5 | Export saturation | marginal export revenue < full unit cost beyond 2 × world depth | by construction (factor 0.707 at 1×, 0.577 at 2×) |
| T6 | Manufacturing at W with imported inputs, 100 % utilisation | EBIT 6–16 %; ROIC 10–23 % | 6.9–16.0 %; 10.9–22.8 % |
| T7 | Utilisation sensitivity | ROIC at 70 % utilisation ≤ 6 % | −4.6 % to +5.4 % |
| T8 | Extraction | EBIT 18–30 %; pre-tax ROIC 12–20 % | 18.4–27.8 %; 12.0–20.1 % |
| T9 | Macro | policy rate 1–6 % (p5–p95), inflation 1–4 %, recessions 7–13 % of months | 1.24–5.40 %, 1.26–3.06 %, 7.5 % |
| T10 | Valuation | profitable listed firms P/E 6–35, P/B 0.25–8 | worked examples 8.3–15.0 |
| T11 | AI solvency | 0 AI defaults; AI NetDebt/EBITDA ≤ 3.5 | to verify in engine (§6) |
| T12 | Growth sanity | 10-year corporate-value CAGR: median AI 5–15 %, best player-like bot ≤ 40 % | today: median 34 %, max 10¹⁰× |

### 5.2 Calibration evidence

**Store P&L** (imported goods, each line at its profit-maximising price, duplicate slots merged; L = 0.6 / 1.0 / 1.6):

| Store | City | Location | Revenue/mo | Gross margin | EBIT % | Pre-tax ROIC | Payback (yrs, after tax) |
|---|---|---|---|---|---|---|---|
| supermarket (soft drink, bread, beer, coffee, t-shirt) | metropolis | poor / avg / prime | $1.29M / $1.76M / $2.18M | 23.5 / 26.8 / 30.9 % | −1.8 / **7.8** / 15.2 % | −2.2 / **11.4** / 23.3 % | ∞ / 8.3 / 4.9 |
| same | riverside | poor / avg / prime | $1.22M / $1.67M / $2.09M | 23.9 / 27.3 / 31.4 % | −2.7 / 7.4 / 15.1 % | −3.3 / 11.2 / 25.2 % | ∞ / 8.2 / 4.5 |
| same | hilltown | poor / avg / prime | $1.01M / $1.47M / $1.86M | 26.4 / 28.4 / 32.5 % | −5.8 / 5.7 / 14.1 % | −5.2 / 6.1 / 15.1 % | ∞ / 13.1 / 7.3 |
| department store (t-shirt, jeans, TV) | metropolis | poor / avg / prime | $0.87M / $1.20M / $1.51M | 32.3 / 36.4 / 41.8 % | −8.5 / 6.3 / 17.2 % | −5.0 / 4.4 / 12.3 % | ∞ / 14.9 / 8.3 |
| same | hilltown | poor / avg / prime | $0.59M / $0.85M / $1.11M | 39.8 / 42.4 / 46.1 % | −19.5 / −0.1 / 12.6 % | −7.1 / 0.0 / 5.2 % | ∞ / 35 / 16 |
| convenience store (soft drink, beer, coffee) | metropolis | poor / avg / prime | $200k / $226k / $249k | 29.9 / 36.8 / 42.8 % | 3.4 / 13.0 / 21.0 % | 4.8 / 18.7 / 28.9 % | 12.4 / 5.5 / 4.0 |
| car dealership (imported cars) | metropolis | poor / avg / prime | $0.54M / $0.89M / $1.33M | 13.7 / 13.7 / 14.5 % | −12.5 / −2.8 / 2.9 % | −15.6 / −4.9 / 6.1 % | ∞ / ∞ / 13.8 |
| car dealership (**own** cars, brand 60, tech 70) | metropolis | avg / prime | $2.95M / $3.12M | 36.4 / 39.8 % | 30.4 / 34.0 % | dealer only 156 %; **whole chain 16.8–27.5 %** with κ 0.5–0.7, incl. factory, R&D and ads | – |

Readings:
- Department stores are thin because only three content products fit them (P2 content fix: more apparel and electronics SKUs).
- Import-only car dealing is a loser by design: cars are sold profitably by their manufacturer.
- Convenience stores run hot at average sites. A tuning candidate is draw 0.30 → 0.25.

**Monopoly bound (T4)** — one store, no incumbents, unlimited capacity, Metropolis; gross profit at 0.8 / 1 / 1.25 / 1.5 / 2 / 3 / 5 / 20 × Pref:

| Product | Units at the same grid | Gross profit | Optimum |
|---|---|---|---|
| soft_drink | 14.3M / 12.3M / 9.5M / 6.9M / 3.4M / 0.75M / 44k / 0 | $2.40M / 6.35M / 9.03M / **9.64M** / 7.73M / 3.03M / 0.33M / $2 | 1.5× |
| bread | 3.20M / 3.04M / 2.62M / 2.07M / 1.04M / 175k / 3.8k / 0 | −$0.23M / 1.72M / 3.59M / **4.48M** / 3.93M / 1.22M / 50k / $0 | 1.5× |
| t_shirt | 802k / 670k / 515k / 388k / 214k / 66k / 8.3k / 1 | $3.34M / 4.80M / 5.62M / **5.68M** / 4.74M / 2.47M / 0.56M / $223 | 1.5× |
| designer_jeans | 37k / 30k / 23k / 17k / 9.4k / 3.1k / 446 / 0 | $1.57M / 2.06M / **2.30M** / 2.27M / 1.87M / 1.01M / 0.26M / $247 | 1.25× |
| television | 7.3k / 5.6k / 3.9k / 2.7k / 1.3k / 338 / 34 / 0 | $83k / 604k / 897k / **950k** / 775k / 361k / 68k / $15 | 1.5× |
| car | 2,357 / 1,928 / 1,428 / 1,025 / 510 / 127 / 10 / 0 | −$10.0M / 5.3M / 16.4M / **20.8M** / 19.2M / 9.2M / 1.5M / $85 | 1.5× |

Today, the same experiment gives unbounded revenue (§2.2).

**Brand, quality and tech lever (supermarket soft-drink slot, Metropolis, uncapped, share of the city):**

| Brand | Quality | Tech score | Share at 1.0 × Pref | Share at 1.2 × Pref | × slot capacity at 1.0 × |
|---|---|---|---|---|---|
| ≤ 45 (import floor) | 50 | 30 | 1.5 % | 0.6 % | 0.74 |
| 60 | 50 | 30 | 3.2 % | 1.2 % | 1.51 |
| 80 | 50 | 30 | 8.0 % | 3.1 % | 3.90 |
| 80 | 70 | 60 | 14.8 % | 5.9 % | 7.42 |
| 100 | 90 | 100 | 50.3 % | 27.8 % | 29.2 |

Brand matters as it should for soft drinks (weight 0.65). A capacity-bound branded store converts excess demand into price, 1.27–1.63 × Pref in G1/G2.

**Play archetypes** (Metropolis, supermarkets with 5 product lines; G cases add their own bottling line and the advertising needed to sustain the brand):

| Case | Stores | Revenue/mo | Gross margin | EBIT/mo after ads | EBIT % | Invested | Pre-tax ROIC |
|---|---|---|---|---|---|---|---|
| N1 naive: 1 store, poor site, imports | 1 | $1.29M | 23.5 % | −$23k | −1.8 % | $12.6M | **−2.2 %** |
| A1 average: 1 store, average site, imports | 1 | $1.76M | 26.8 % | $136k | 7.8 % | $14.3M | **11.4 %** |
| A2 average: 6 stores (self-cannibalising) | 6 | $9.17M | 27.3 % | $512k | 5.6 % | $85.3M | **7.2 %** |
| G1 good: 6 stores + own bottling + brand 70, Q 60, T 60 | 6 | $10.13M | 38.3 % | $1.78M | 17.6 % | $98.4M | **21.7 %** |
| G2 very good: 6 prime-site stores + own bottling + brand 80, Q 70, T 80 | 6 | $13.04M | 43.3 % | $3.43M | 26.3 % | $115.4M | **35.7 %** |

**Integration (capital of every stage counted; internal transfers at W, so the downstream stage saves the import spread):**

| Chain | Revenue/mo at W | EBIT/mo | Invested | Pre-tax ROIC |
|---|---|---|---|---|
| plastic line, imported crude | $2.17M | $198k | $15.1M | 15.8 % |
| plastic + own oil (1.38 well slots) | $3.41M | $737k | $35.5M | **24.9 %** |
| sugar line, imported cane | $1.20M | $118k | $9.0M | 15.7 % |
| sugar + own cane (4 farm slots) | $1.92M | $392k | $23.3M | **20.1 %** |
| TV line, imported parts | $3.45M | $276k | $16.8M | 19.7 % |
| TV + own electronic parts (1 slot) | $5.45M | $667k | $31.2M | **25.7 %** |

Incumbent masses at game start (normal difficulty, equivalent reference-store slots): soft_drink 63.5/31.8/25.0/19.1/12.4 (Metropolis / Riverside / Eastside / Portbay / Hilltown); bread 28.8/14.2/11.0/8.7/5.4; beer 34.5/17.2/13.6/10.4/6.8; coffee_drink 32.7/17.8/16.2/9.2/8.5; t_shirt 26.8/13.7/11.4/7.9/5.8; designer_jeans 10.7/6.6/7.1/2.7/3.9; television 7.2/3.8/3.2/2.1/1.7; car 75.0/40.5/37.0/21.2/19.4.

---

## 6. Simulation regression checks (to implement alongside the model)

Add an `EconomyRegressionTests` xUnit class, plus a CLI sweep (`tools/MagnateSim --sweep`) that runs in CI. The existing 229 tests must keep passing after content migration. Tests that assert old magnitudes (e.g. exact revenue of a supermarket) are re-baselined in the same PR.

| # | Check | Pass criterion |
|---|---|---|
| R1 | **Books close** | Every company, every month: `Assets − Liabilities == Equity` (decimal equality) and `Cash == Σ ledger` |
| R2 | **Monopoly bound** | Per finished product, one store, no incumbents: gross profit at 20 × Pref < 1 % of gross profit at the optimum; optimum in [1.1, 1.8] × Pref |
| R3 | **Downward-sloping total** | Multiplying every offer's price by k ∈ {0.8, 1, 1.25, 1.5, 2} strictly lowers total units (incumbent + firms) |
| R4 | **Incumbent floor** | Incumbents at the 25 % floor; one player whose stores' total attractiveness equals the incumbents' *base* mass, pricing at 2 × Pref with brand 100: player share < 70 % (calibration: 57.7 % for Metropolis soft_drink) |
| R5 | **Export concavity** | Revenue per unit strictly decreasing in world export volume; total export revenue concave; no NaN at V = 0 |
| R6 | **Chain bands** | Engine-run version of Table 4.7 at 100 % utilisation: EBIT % within ±2 pts of the calibration; at 50 % utilisation EBIT < 0 for all 17 recipes (calibration: −2.5 % to −32 %) |
| R7 | **Retail bands** | Average-site supermarket in each city with imports: EBIT % ∈ [0 %, 10 %]; poor site < 0; prime ≥ 8 % |
| R8 | **Scenario sweep** | 16 scenarios × seeds {1, 7, 42} × 120 months, all companies AI (player → Adaptive): no exceptions; no retail price > 3 × Pref; no company TA > 50 × starting cash at year 10; zero AI defaults; AI NetDebt/EBITDA ≤ 3.5 at every quarter-end; median AI CV CAGR within 5–15 % |
| R9 | **Tax** | Loss year then profit year reproduces the §4.9 example exactly; refunds never exceed tax paid YTD |
| R10 | **Loans** | Annuity schedule repays principal exactly (rounded to the cent in the final instalment); Σ interest = Σ opening balance × r/12 |
| R11 | **Rating** | The Damodaran table maps each ICR boundary to the listed rating; movement ≤ 2 notches per quarter except to D |
| R12 | **Depreciation** | Accumulated depreciation = cost after `life` months; NBV never negative; land never depreciates; upgrades capitalised |
| R13 | **Construction** | No production, sales or opex (other than insurance/property tax) before completion; CIP = Σ instalments; completion month exact; pause when unfunded |
| R14 | **Solvency** | Forcing a company into default → distress in the same tick; cured or liquidated within 3 months; creditors paid in waterfall order; no residual buildings |
| R15 | **Determinism** | Run N months vs N/2 + save/load + N/2: byte-identical ledger, journal and news log (fails today, F11) |
| R16 | **Exploits closed** | n duplicate slots raise attractiveness only by √n; a $1 campaign cannot stop decay; restock capped at 1.5 × capacity; warehouse value cap enforced; geography enforced |
| R17 | **Macro statistics** | 20 seeds × 100 years: policy rate p5/p95 in [0.25 %, 8 %], mean inflation 1.5–3 %, recession share 5–15 % |
| R18 | **Balance bots** | Scripted "good" bot (G1 recipe) reaches pre-tax ROIC ≥ 15 % by year 5; "naive" bot (poor sites, 1.3 × Pref, no ads) is in distress or has negative equity by year 5 |

---

## 7. Staging

**P0 — makes the game a real economy.** Required before the web client's economy UI is built on top.
1. Demand model §4.1 (P0 variant: `max()` brand/tech rule, no macro multiplier), with incumbents §4.2 (static base mass), retail capacity, draw table and stock cap §4.3 (L = 1 until the layout lands), and merged duplicate slots.
2. World-market spreads, depth, aggregate export price, tradability, affordability-capped purchases §4.4.
3. Content rebalance §4.7 (products, recipes per unit, `otherCostPerUnit`, `kwhPerUnit`, `laborPerSlot`, line/field capex, building capex/opex/staff), plus the loader migrations for old fields.
4. Labour and utilities §4.5–4.6 (period-cost wages, fixed opex, maintenance, insurance, property tax).
5. Depreciation, land as an asset, upgrade capitalisation §4.8; accounting model §4.15 (ledger categories, AccrualJournal, new BS/IS, R1).
6. Tax with NOL §4.9.
7. Loans (term + revolver), rating, borrowing capacity §4.10; the revolver replaces negative cash.
8. Bankruptcy §4.14 and AI solvency rules.
9. Construction time and progress payments §4.12; geography enforcement.
10. AI fixes §4.17 (pricing without spirals, TechLeader per-unit floor, store types, expansion test, finance rules).
11. Advertising fixes §4.20.
12. Corporate value unified; goals rescaled §4.18.
13. RNG streams, schema v10, backward-compatible load §4.19.

**P1 — completes the CapLab core loop.**
- Equity §4.11 (shares, IPO, secondary offering, dividends, buybacks, share price, personal net worth).
- Macro §4.13 (cycle, CPI, Taylor rule, population and income drift, commodity cycles, land index).
- Quality formation and source-weighted brand/tech; world tech drift.
- Incumbent dynamics (erosion and entry).
- Absorption costing.
- Chain bonus and staffing factor; specialty stores (car dealership already in P0; electronics, boutique).
- Seaport freight effects; distance freight; import price impact; covenants; deposit interest; corporate overhead.
- Line re-tooling cost.

**P2 — depth.**
- Bonds, takeovers and mergers, subsidiaries, player stock trading; banking DLC.
- B2B wholesale market between companies (CapLab lets any firm buy from any firm).
- Real-estate business; land appreciation from local development.
- Labour pool and wage pressure.
- Resource depletion.
- Content expansion so chains are CapLab-deep (packaging, concentrate, engine, tyre, glass, more apparel and electronics SKUs), which moves `otherCostPerUnit` into real intermediates and makes vertical integration matter more for soft drinks, beer and cars.
- Portable math for cross-platform replays.

Dependencies:
- 5 (accounting) blocks 6, 7, 8 and P1 equity.
- 1 and 3 block 10 and R6–R8.
- 13 should land with the first P0 merge so every later save is v10.

---

## 8. Open questions for the lead / user

1. **Scale.** Realistic 2026 magnitudes (this spec: supermarket $10M + land, starting cash ×3) or CapLab-scaled costs (caplab-brief §7.1: supermarket $2–5M, $30M normal start)? The ratios in this spec survive either choice if one `EconomyScale` factor is applied to capex, land, labour cost, city demand volume, starting cash and goal thresholds, and not to shelf prices.
2. **Incumbent strength per difficulty.** Proposed 0.6 / 1.0 / 1.4. Should the player be able to push incumbents below the 25 % floor (CapLab lets you dominate a city), perhaps with a late-game antitrust mechanic as caplab-brief proposes?
3. **Brand of imported goods in P0.** Keep "advertise anything" with an import-brand floor (P0 proposal), or go straight to CapLab's "imports carry no brand; only your own products build brand" (P1 source-weighted)?
4. **Tick granularity.** All formulas here are monthly. If the lead adopts daily/weekly sub-steps (caplab-brief open question 3), flows scale by 1/30. Demand, finance and tax logic are unchanged.
5. **Loans.** Amortising term loans plus an automatic revolver (this spec), or CapLab's interest-only, repay-any-time floating loans? The revolver already behaves like CapLab's loan; term loans add realism at a small UX cost.
6. **Car/TV value spread.** κ_car 0.5 vs 0.7 moves a fully integrated car chain's ROIC from 17 % to 28 %. 0.6 is proposed; confirm after playtest.
7. **Content breadth.** Department stores and car retail rely on too few products (3 and 1). Add products (P2), or keep store economics tuned around the current 8 finished goods?

---
## Appendix A — Reference implementation of the demand step (Python, port 1:1 to C#)

This is the calibration model's demand function, with the spill pass generalised. It reproduces every §5 number; for example it returns 1,002,498 units for the brand-80 row and 6,919,749 for soft_drink at 1.5 × with no incumbents. Port it into `MonthlyTick.AllocateDemandAndSell`, then unit-test the C# against the values in §5.2 (T4 and the brand table).

```python
import math

def Phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))   # C#: Abramowitz–Stegun 7.1.26 erf
def phi(z): return math.exp(-z * z / 2) / math.sqrt(2 * math.pi)
def surv(x, sigma): return 1 - Phi(math.log(max(x, 1e-12)) / sigma)

def zref(eps, sigma):                      # precompute per (product, bracket) at content load
    lo, hi = -8.0, 4.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if phi(mid) / (sigma * (1 - Phi(mid))) < eps: lo = mid
        else: hi = mid
    return (lo + hi) / 2

BR = {"low": dict(eps=1.40, theta=1.25, wB=0.85, wQ=0.90),
      "mid": dict(eps=1.00, theta=1.00, wB=1.00, wQ=1.00),
      "high": dict(eps=0.60, theta=0.75, wB=1.25, wQ=1.20)}

def score(Q, B, T, w, br):                 # w = (wQ, wB, wT) from content
    wq, wb, wt = w[0] * BR[br]["wQ"], w[1] * BR[br]["wB"], w[2]
    return (wq * Q + wb * B + wt * T) / (wq + wb + wt)

def allocate(prod, city, offers, A0, P0, T_world=30.0, spill=0.60):
    """prod: dict(pref, q=(low,mid,high), eps, sigma, theta, w, kappa, B0, Q0, importBrand)
       city: dict(pop, mix=(low,mid,high))
       offers: list of dict(P, Q, B, T, A, sell)  -- one per (building, product); sell = min(stock, capacity) units
       A0, P0: incumbent mass and price. Returns (units per offer, incumbent units)."""
    demand = [0.0] * len(offers); weight_mass = [0.0] * len(offers); inc = 0.0
    for bi, br in enumerate(("low", "mid", "high")):
        Dref = city["pop"] * city["mix"][bi] * prod["q"][bi]
        if Dref <= 0: continue
        eps = prod["eps"] * BR[br]["eps"]; th = prod["theta"] * BR[br]["theta"]; s = prod["sigma"]
        M0 = math.exp(prod["kappa"] * (score(prod["Q0"], prod["B0"], T_world, prod["w"], br) - 50) / 50)
        pt_ref = prod["pref"] / M0
        R = pt_ref * math.exp(-zref(eps, s) * s)
        cand = [(-1, A0, P0 / M0)]
        for i, o in enumerate(offers):
            if o["sell"] <= 0: continue                         # empty shelves are not in the choice set
            S = score(o["Q"], max(o["B"], prod["importBrand"]), o["T"], prod["w"], br)
            cand.append((i, o["A"], o["P"] / math.exp(prod["kappa"] * (S - 50) / 50)))
        ws = [a * pt ** (-th) for _, a, pt in cand]; W = sum(ws)
        sh = [x / W for x in ws]
        pt_eff = sum(si * pt for si, (_, _, pt) in zip(sh, cand))
        D = Dref * surv(pt_eff / R, s) / surv(pt_ref / R, s)
        for si, (k, _, _) in zip(sh, cand):
            if k < 0: inc += D * si
            else: demand[k] += D * si; weight_mass[k] += D * si
    sold = [min(d, o["sell"]) for d, o in zip(demand, offers)]
    unserved = sum(d - x for d, x in zip(demand, sold))
    if unserved > 0:                                            # one spill pass, pro-rata to demand mass, capped by residual
        pool = spill * unserved
        resid = [o["sell"] - x for o, x in zip(offers, sold)]
        mass = [m if r > 0 else 0.0 for m, r in zip(weight_mass, resid)]
        total = sum(mass) + inc
        for i in range(len(offers)):
            if mass[i] > 0:
                add = min(resid[i], pool * mass[i] / total); sold[i] += add
        inc += pool * inc / total if total > 0 else 0.0
    return sold, inc
```

Incumbent mass: `A0 = max(0.5, Σ_b Dref_b·Pref / (0.75·RetailCapPerSlot(referenceStore)))`. Offer attractiveness: `A = L·Draw·√n·(1 + 0.1·(level−1))`. Capacity: `n·RetailCapPerSlot/Pref`.

## Appendix B — Reproducing the audit numbers

- Harness (engine copy; the project tree is untouched): `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/econ-audit/harness/`.
  - Build: `export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1 && dotnet build -c Release`.
  - Run: `dotnet bin/Release/net8.0/Magnate.Engine.Tests.dll a` (production), `b` (monopoly/duopoly/duplicate slots), `c` (lone stores), `d` / `d7` (16-scenario sweep, seeds 42/7), `e` (negative cash, upgrade books, quality, stock-outs, brand exploit, TechLeader bug, R&D, warehouse, geography), `f` (save/load determinism).
  - The whole suite runs in about 10 s on the dev Mac.
  - The scratchpad is session-temporary. To keep the harness, move it to `tools/EconAudit/` with a `ProjectReference` to the engine (inside the tree it inherits `TreatWarningsAsErrors`; the code is warning-clean except CS1591).
- Calibration model: `…/econ-audit/calib/`. `v2.py` holds the proposed content and constants plus the P&L, demand and store functions; `report_v2.py`, `stores.py`, `scenarios.py`, `chains.py` and `macro.py` print the tables in §4.7 and §5.
- Seeds 42 and 7 give identical conclusions: all TA values within ±1 %, and the same companies go negative.

## Appendix C — Raw harness outputs (verbatim, current engine)

These copies are kept here because the scratchpad is temporary. Figures are month-6 (A) or month-3 (B, C) steady state, with events disabled. `ROI/yr` = 12 × NI ÷ capex.

#### C.1 Experiment A — production and extraction

##### A1. One small factory, inputs bought on world market, all output auto-exported (steady-state month 6)

| Product | Tier | Slots | Units out/mo | Input cost/mo | Export rev/mo | Opex/mo | NI/mo | Gross margin | Capex | ROI/yr | Payback (mo) | Materials % of price |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cotton_fabric | Intermediate | 1 | 8.0k | $50.0k | $120.0k | $20.0k | $50.0k | 58.3% | $1.50M | 40.0% | 30.0 | 41.7% |
| cotton_fabric | Intermediate | 6 | 48.0k | $300.0k | $720.0k | $20.0k | $400.0k | 58.3% | $1.50M | 320.0% | 3.8 | 41.7% |
| denim_fabric | Intermediate | 1 | 5.0k | $50.0k | $110.0k | $20.0k | $40.0k | 54.5% | $1.50M | 32.0% | 37.5 | 45.5% |
| denim_fabric | Intermediate | 6 | 30.0k | $300.0k | $660.0k | $20.0k | $340.0k | 54.5% | $1.50M | 272.0% | 4.4 | 45.5% |
| electronic_parts | Intermediate | 1 | 10.0k | $18.0k | $250.0k | $20.0k | $212.0k | 92.8% | $1.50M | 169.6% | 7.1 | 7.2% |
| electronic_parts | Intermediate | 6 | 60.0k | $108.0k | $1.50M | $20.0k | $1.37M | 92.8% | $1.50M | 1097.6% | 1.1 | 7.2% |
| flour | Intermediate | 1 | 160.0k | $24.0k | $240.0k | $20.0k | $196.0k | 90.0% | $1.50M | 156.8% | 7.7 | 10.0% |
| flour | Intermediate | 6 | 960.0k | $144.0k | $1.44M | $20.0k | $1.28M | 90.0% | $1.50M | 1020.8% | 1.2 | 10.0% |
| malt | Intermediate | 1 | 80.0k | $24.0k | $240.0k | $20.0k | $196.0k | 90.0% | $1.50M | 156.8% | 7.7 | 10.0% |
| malt | Intermediate | 6 | 480.0k | $144.0k | $1.44M | $20.0k | $1.28M | 90.0% | $1.50M | 1020.8% | 1.2 | 10.0% |
| plastic | Intermediate | 1 | 200.0k | $14.0k | $600.0k | $20.0k | $566.0k | 97.7% | $1.50M | 452.8% | 2.7 | 2.3% |
| plastic | Intermediate | 6 | 1.20M | $84.0k | $3.60M | $20.0k | $3.50M | 97.7% | $1.50M | 2796.8% | 0.4 | 2.3% |
| roasted_coffee | Intermediate | 1 | 100.0k | $60.0k | $800.0k | $20.0k | $720.0k | 92.5% | $1.50M | 576.0% | 2.1 | 7.5% |
| roasted_coffee | Intermediate | 6 | 600.0k | $360.0k | $4.80M | $20.0k | $4.42M | 92.5% | $1.50M | 3536.0% | 0.3 | 7.5% |
| steel | Intermediate | 1 | 300 | $24.0k | $90.0k | $20.0k | $46.0k | 73.3% | $1.50M | 36.8% | 32.6 | 26.7% |
| steel | Intermediate | 6 | 1.8k | $144.0k | $540.0k | $20.0k | $376.0k | 73.3% | $1.50M | 300.8% | 4.0 | 26.7% |
| sugar | Intermediate | 1 | 100.0k | $16.0k | $200.0k | $20.0k | $164.0k | 92.0% | $1.50M | 131.2% | 9.1 | 8.0% |
| sugar | Intermediate | 6 | 600.0k | $96.0k | $1.20M | $20.0k | $1.08M | 92.0% | $1.50M | 867.2% | 1.4 | 8.0% |
| beer | Finished | 1 | 200.0k | $14.6k | $600.0k | $20.0k | $565.4k | 97.6% | $1.50M | 452.3% | 2.7 | 2.4% |
| beer | Finished | 6 | 1.20M | $87.6k | $3.60M | $20.0k | $3.49M | 97.6% | $1.50M | 2793.9% | 0.4 | 2.4% |
| bread | Finished | 1 | 40.0k | $15.0k | $100.0k | $20.0k | $65.0k | 85.0% | $1.50M | 52.0% | 23.1 | 15.0% |
| bread | Finished | 6 | 240.0k | $90.0k | $600.0k | $20.0k | $490.0k | 85.0% | $1.50M | 392.0% | 3.1 | 15.0% |
| car | Finished | 1 | 200 | $270.0k | $3.60M | $20.0k | $3.31M | 92.5% | $1.50M | 2648.0% | 0.5 | 7.5% |
| car | Finished | 6 | 1.2k | $1.62M | $21.60M | $20.0k | $19.96M | 92.5% | $1.50M | 15968.0% | 0.1 | 7.5% |
| coffee_drink | Finished | 1 | 200.0k | $9.2k | $800.0k | $20.0k | $770.8k | 98.9% | $1.50M | 616.6% | 1.9 | 1.2% |
| coffee_drink | Finished | 6 | 1.20M | $55.2k | $4.80M | $20.0k | $4.72M | 98.9% | $1.50M | 3779.8% | 0.3 | 1.2% |
| designer_jeans | Finished | 1 | 2.0k | $8.8k | $240.0k | $20.0k | $211.2k | 96.3% | $1.50M | 169.0% | 7.1 | 3.7% |
| designer_jeans | Finished | 6 | 12.0k | $52.8k | $1.44M | $20.0k | $1.37M | 96.3% | $1.50M | 1093.8% | 1.1 | 3.7% |
| soft_drink | Finished | 1 | 200.0k | $11.0k | $300.0k | $20.0k | $269.0k | 96.3% | $1.50M | 215.2% | 5.6 | 3.7% |
| soft_drink | Finished | 6 | 1.20M | $66.0k | $1.80M | $20.0k | $1.71M | 96.3% | $1.50M | 1371.2% | 0.9 | 3.7% |
| t_shirt | Finished | 1 | 6.0k | $3.0k | $90.0k | $20.0k | $67.0k | 96.7% | $1.50M | 53.6% | 22.4 | 3.3% |
| t_shirt | Finished | 6 | 36.0k | $18.0k | $540.0k | $20.0k | $502.0k | 96.7% | $1.50M | 401.6% | 3.0 | 3.3% |
| television | Finished | 1 | 1.0k | $79.8k | $400.0k | $20.0k | $300.2k | 80.1% | $1.50M | 240.2% | 5.0 | 20.0% |
| television | Finished | 6 | 6.0k | $478.8k | $2.40M | $20.0k | $1.90M | 80.1% | $1.50M | 1521.0% | 0.8 | 20.0% |

##### A2. Extraction buildings, every slot filled, raw output auto-exported (month 6)

| Raw | Building | Slots | Units/mo | Export rev/mo | Opex/mo | NI/mo | Capex | ROI/yr | Payback (mo) |
|---|---|---|---|---|---|---|---|---|---|
| coffee_beans | small_plantation | 3 | 600 | $180.0k | $5.0k | $175.0k | $400.0k | 525.0% | 2.3 |
| cotton | small_farm | 3 | 450 | $112.5k | $4.0k | $108.5k | $250.0k | 520.8% | 2.3 |
| cotton | large_farm | 6 | 900 | $225.0k | $12.0k | $213.0k | $800.0k | 319.5% | 3.8 |
| crude_oil | oil_well | 2 | 1.0k | $70.0k | $25.0k | $45.0k | $2.50M | 21.6% | 55.6 |
| hops | small_plantation | 3 | 450 | $180.0k | $5.0k | $175.0k | $400.0k | 525.0% | 2.3 |
| iron_ore | iron_mine | 3 | 900 | $54.0k | $18.0k | $36.0k | $1.20M | 36.0% | 33.3 |
| sugarcane | small_farm | 3 | 1.2k | $96.0k | $4.0k | $92.0k | $250.0k | 441.6% | 2.7 |
| sugarcane | large_farm | 6 | 2.4k | $192.0k | $12.0k | $180.0k | $800.0k | 270.0% | 4.4 |
| wheat | small_farm | 3 | 900 | $108.0k | $4.0k | $104.0k | $250.0k | 499.2% | 2.4 |
| wheat | large_farm | 6 | 1.8k | $216.0k | $12.0k | $204.0k | $800.0k | 306.0% | 3.9 |

##### A3. Scale-up: factory_small upgraded to L3 (12 slots) and factory_large L3 (24 slots), all slots on one product (month 6 after upgrades)

| Product | Building | Slots | Total capex incl. upgrades | NI/mo | ROI/yr | Payback (mo) |
|---|---|---|---|---|---|---|
| car | factory_small L3 | 12 | $3.15M | $39.95M | 15217.5% | 0.08 |
| car | factory_large L3 | 24 | $10.50M | $79.88M | 9129.3% | 0.13 |
| coffee_drink | factory_small L3 | 12 | $3.15M | $9.48M | 3609.8% | 0.33 |
| coffee_drink | factory_large L3 | 24 | $10.50M | $18.94M | 2164.7% | 0.55 |
| plastic | factory_small L3 | 12 | $3.15M | $7.02M | 2673.5% | 0.45 |
| plastic | factory_large L3 | 24 | $10.50M | $14.03M | 1602.9% | 0.75 |
| soft_drink | factory_small L3 | 12 | $3.15M | $3.45M | 1315.8% | 0.91 |
| soft_drink | factory_large L3 | 24 | $10.50M | $6.90M | 788.3% | 1.52 |
| bread | factory_small L3 | 12 | $3.15M | $1.01M | 383.2% | 3.13 |
| bread | factory_large L3 | 24 | $10.50M | $2.00M | 228.7% | 5.25 |

##### A4. Vertical integration comparison — soft_drink, 1 slot each step, everything auto-exported (month 6)

| Configuration | Capex | NI/mo | ROI/yr |
|---|---|---|---|
| soft_drink factory, buys sugar+plastic | $1.50M | $269.0k | 215.2% |
| farm+oil well+sugar+plastic+soft_drink (all surplus exported) | $7.25M | $1.04M | 171.6% |

#### C.2 Experiment B — monopoly, duopoly, duplicate slots

##### B1. Lone supermarket in Metropolis, restock = 3x city demand (no stock-outs). Month-3 results.

City demand (units/month) is the engine's fixed per-capita demand; `RP` = the product's reservationPrice map from content.

| Product | World price | RP (low/mid/high) | Price multiple | Price | Units sold (with RP) | Revenue (with RP) | NI (with RP) | Units sold (RP removed) | Revenue (RP removed) | NI (RP removed) |
|---|---|---|---|---|---|---|---|---|---|---|
| soft_drink | $1.50 | 8/50/inf | 1x | $1.50 | 2.63M | $3.94M | $-15.0k | 2.63M | $3.94M | $-15.0k |
| soft_drink | $1.50 | 8/50/inf | 2x | $3.00 | 2.63M | $7.88M | $3.92M | 2.63M | $7.88M | $3.92M |
| soft_drink | $1.50 | 8/50/inf | 5x | $7.50 | 2.63M | $19.69M | $15.74M | 2.63M | $19.69M | $15.74M |
| soft_drink | $1.50 | 8/50/inf | 20x | $30.00 | 1.50M | $45.00M | $42.74M | 2.63M | $78.75M | $74.80M |
| soft_drink | $1.50 | 8/50/inf | 100x | $150.00 | 300.0k | $45.00M | $44.53M | 2.63M | $393.75M | $389.80M |
| soft_drink | $1.50 | 8/50/inf | 1000x | $1.5k | 300.0k | $450.00M | $449.53M | 2.63M | $3.94B | $3.93B |
| bread | $2.50 | none | 1x | $2.50 | 3.58M | $8.94M | $-15.0k | 3.58M | $8.94M | $-15.0k |
| bread | $2.50 | none | 2x | $5.00 | 3.58M | $17.88M | $8.92M | 3.58M | $17.88M | $8.92M |
| bread | $2.50 | none | 5x | $12.50 | 3.58M | $44.69M | $35.74M | 3.58M | $44.69M | $35.74M |
| bread | $2.50 | none | 20x | $50.00 | 3.58M | $178.75M | $169.80M | 3.58M | $178.75M | $169.80M |
| bread | $2.50 | none | 100x | $250.00 | 3.58M | $893.75M | $884.80M | 3.58M | $893.75M | $884.80M |
| bread | $2.50 | none | 1000x | $2.5k | 3.58M | $8.94B | $8.93B | 3.58M | $8.94B | $8.93B |
| beer | $3.00 | 12/60/inf | 1x | $3.00 | 1.31M | $3.94M | $-15.0k | 1.31M | $3.94M | $-15.0k |
| beer | $3.00 | 12/60/inf | 2x | $6.00 | 1.31M | $7.88M | $3.92M | 1.31M | $7.88M | $3.92M |
| beer | $3.00 | 12/60/inf | 5x | $15.00 | 750.0k | $11.25M | $8.99M | 1.31M | $19.69M | $15.74M |
| beer | $3.00 | 12/60/inf | 20x | $60.00 | 750.0k | $45.00M | $42.74M | 1.31M | $78.75M | $74.80M |
| beer | $3.00 | 12/60/inf | 100x | $300.00 | 150.0k | $45.00M | $44.53M | 1.31M | $393.75M | $389.80M |
| beer | $3.00 | 12/60/inf | 1000x | $3.0k | 150.0k | $450.00M | $449.53M | 1.31M | $3.94B | $3.93B |
| coffee_drink | $4.00 | 10/30/inf | 1x | $4.00 | 1.83M | $7.30M | $-15.0k | 1.83M | $7.30M | $-15.0k |
| coffee_drink | $4.00 | 10/30/inf | 2x | $8.00 | 1.83M | $14.60M | $7.29M | 1.83M | $14.60M | $7.29M |
| coffee_drink | $4.00 | 10/30/inf | 5x | $20.00 | 1.60M | $32.00M | $25.59M | 1.83M | $36.50M | $29.19M |
| coffee_drink | $4.00 | 10/30/inf | 20x | $80.00 | 600.0k | $48.00M | $45.59M | 1.83M | $146.00M | $138.69M |
| coffee_drink | $4.00 | 10/30/inf | 100x | $400.00 | 600.0k | $240.00M | $237.59M | 1.83M | $730.00M | $722.69M |
| coffee_drink | $4.00 | 10/30/inf | 1000x | $4.0k | 600.0k | $2.40B | $2.40B | 1.83M | $7.30B | $7.29B |
| t_shirt | $15.00 | none | 1x | $15.00 | 220.0k | $3.30M | $-15.0k | 220.0k | $3.30M | $-15.0k |
| t_shirt | $15.00 | none | 2x | $30.00 | 220.0k | $6.60M | $3.29M | 220.0k | $6.60M | $3.29M |
| t_shirt | $15.00 | none | 5x | $75.00 | 220.0k | $16.50M | $13.19M | 220.0k | $16.50M | $13.19M |
| t_shirt | $15.00 | none | 20x | $300.00 | 220.0k | $66.00M | $62.69M | 220.0k | $66.00M | $62.69M |
| t_shirt | $15.00 | none | 100x | $1.5k | 220.0k | $330.00M | $326.69M | 220.0k | $330.00M | $326.69M |
| t_shirt | $15.00 | none | 1000x | $15.0k | 220.0k | $3.30B | $3.30B | 220.0k | $3.30B | $3.30B |
| television | $400.00 | 300/2000/inf | 1x | $400.00 | 1.8k | $700.0k | $-15.0k | 2.2k | $880.0k | $-15.0k |
| television | $400.00 | 300/2000/inf | 2x | $800.00 | 1.8k | $1.40M | $685.0k | 2.2k | $1.76M | $865.0k |
| television | $400.00 | 300/2000/inf | 5x | $2.0k | 1.8k | $3.50M | $2.79M | 2.2k | $4.40M | $3.51M |
| television | $400.00 | 300/2000/inf | 20x | $8.0k | 750 | $6.00M | $5.68M | 2.2k | $17.60M | $16.71M |
| television | $400.00 | 300/2000/inf | 100x | $40.0k | 750 | $30.00M | $29.68M | 2.2k | $88.00M | $87.11M |
| television | $400.00 | 300/2000/inf | 1000x | $400.0k | 750 | $300.00M | $299.68M | 2.2k | $880.00M | $879.11M |
| car | $18.0k | 0/30000/inf | 1x | $18.0k | 1.2k | $21.60M | $-15.0k | 1.4k | $25.65M | $-15.0k |
| car | $18.0k | 0/30000/inf | 2x | $36.0k | 600 | $21.60M | $10.79M | 1.4k | $51.30M | $25.64M |
| car | $18.0k | 0/30000/inf | 5x | $90.0k | 600 | $54.00M | $43.19M | 1.4k | $128.25M | $102.59M |
| car | $18.0k | 0/30000/inf | 20x | $360.0k | 600 | $216.00M | $205.19M | 1.4k | $513.00M | $487.34M |
| car | $18.0k | 0/30000/inf | 100x | $1.80M | 600 | $1.08B | $1.07B | 1.4k | $2.57B | $2.54B |
| car | $18.0k | 0/30000/inf | 1000x | $18.00M | 600 | $10.80B | $10.79B | 1.4k | $25.65B | $25.62B |
| designer_jeans | $120.00 | 0/150/inf | 1x | $120.00 | 385 | $46.2k | $-15.0k | 385 | $46.2k | $-15.0k |
| designer_jeans | $120.00 | 0/150/inf | 2x | $240.00 | 225 | $54.0k | $12.0k | 385 | $92.4k | $31.2k |
| designer_jeans | $120.00 | 0/150/inf | 5x | $600.00 | 225 | $135.0k | $93.0k | 385 | $231.0k | $169.8k |
| designer_jeans | $120.00 | 0/150/inf | 20x | $2.4k | 225 | $540.0k | $498.0k | 385 | $924.0k | $862.8k |
| designer_jeans | $120.00 | 0/150/inf | 100x | $12.0k | 225 | $2.70M | $2.66M | 385 | $4.62M | $4.56M |
| designer_jeans | $120.00 | 0/150/inf | 1000x | $120.0k | 225 | $27.00M | $26.96M | 385 | $46.20M | $46.14M |

##### B2. Duopoly: rival fixed at 1.2x world price; our price varied. Same Q/B/T. Month-3 results (RP removed so only the softmax acts).

| Product | Elasticity | Our multiple | Our share | Our units | Our revenue | Our gross profit | Market units (both) |
|---|---|---|---|---|---|---|---|
| soft_drink | 0.7 | 0.9x | 55.0% | 1.44M | $1.95M | $-216.6k | 2.63M |
| soft_drink | 0.7 | 1.2x | 50.0% | 1.31M | $2.36M | $393.7k | 2.63M |
| soft_drink | 0.7 | 2x | 41.2% | 1.08M | $3.24M | $1.62M | 2.63M |
| soft_drink | 0.7 | 5x | 26.9% | 706.5k | $5.30M | $4.24M | 2.63M |
| soft_drink | 0.7 | 20x | 12.2% | 321.4k | $9.64M | $9.16M | 2.63M |
| soft_drink | 0.7 | 100x | 4.3% | 113.6k | $17.04M | $16.87M | 2.63M |
| bread | 0.5 | 0.9x | 53.6% | 1.92M | $4.31M | $-479.0k | 3.58M |
| bread | 0.5 | 1.2x | 50.0% | 1.79M | $5.36M | $893.7k | 3.58M |
| bread | 0.5 | 2x | 43.6% | 1.56M | $7.80M | $3.90M | 3.58M |
| bread | 0.5 | 5x | 32.9% | 1.18M | $14.69M | $11.76M | 3.58M |
| bread | 0.5 | 20x | 19.7% | 703.4k | $35.17M | $33.41M | 3.58M |
| bread | 0.5 | 100x | 9.9% | 353.0k | $88.24M | $87.36M | 3.58M |
| television | 1.3 | 0.9x | 59.2% | 1.3k | $469.2k | $-52.1k | 2.2k |
| television | 1.3 | 1.2x | 50.0% | 1.1k | $528.0k | $88.0k | 2.2k |
| television | 1.3 | 2x | 34.0% | 747.62 | $598.1k | $299.0k | 2.2k |
| television | 1.3 | 5x | 13.5% | 297.57 | $595.1k | $476.1k | 2.2k |
| television | 1.3 | 20x | 2.5% | 55.33 | $442.6k | $420.5k | 2.2k |
| television | 1.3 | 100x | 0.3% | 6.98 | $279.3k | $276.5k | 2.2k |
| car | 1.5 | 0.9x | 60.6% | 863.89 | $13.99M | $-1.55M | 1.4k |
| car | 1.5 | 1.2x | 50.0% | 712.5 | $15.39M | $2.56M | 1.4k |
| car | 1.5 | 2x | 31.7% | 452.14 | $16.28M | $8.14M | 1.4k |
| car | 1.5 | 5x | 10.5% | 149.92 | $13.49M | $10.79M | 1.4k |
| car | 1.5 | 20x | 1.4% | 20.64 | $7.43M | $7.06M | 1.4k |
| car | 1.5 | 100x | 0.1% | 1.87 | $3.37M | $3.33M | 1.4k |

##### B3. Duplicate-slot exploit: both firms price soft_drink at 1.2x; firm B configures the same product in N slots of one supermarket (month 3)

| B slots | A share | B share |
|---|---|---|
| 1 | 50.0% | 50.0% |
| 2 | 33.3% | 66.7% |
| 3 | 25.0% | 75.0% |
| 6 | 14.3% | 85.7% |

#### C.3 Experiment C — lone retail stores

##### C1. One supermarket (capex $1.2M, opex $15k/mo), one slot, price = 1.2x world (AI solo markup), restock = 1.2x city demand, month-3

| City | Pop | Product | City demand/mo | Units sold | Revenue/mo | Gross profit/mo | NI/mo | ROI/yr on $1.2M | Payback (mo) | Units per capita/yr |
|---|---|---|---|---|---|---|---|---|---|---|
| metropolis | 500.0k | soft_drink | 2.63M | 2.63M | $4.73M | $787.5k | $772.5k | 772.5% | 1.6 | 63 |
| metropolis | 500.0k | bread | 3.58M | 3.58M | $10.73M | $1.79M | $1.77M | 1772.5% | 0.7 | 85.8 |
| metropolis | 500.0k | beer | 1.31M | 1.31M | $4.73M | $787.5k | $772.5k | 772.5% | 1.6 | 31.5 |
| metropolis | 500.0k | coffee_drink | 1.83M | 1.83M | $8.76M | $1.46M | $1.44M | 1445.0% | 0.8 | 43.8 |
| metropolis | 500.0k | t_shirt | 220.0k | 220.0k | $3.96M | $660.0k | $645.0k | 645.0% | 1.9 | 5.28 |
| metropolis | 500.0k | television | 2.2k | 1.8k | $840.0k | $140.0k | $125.0k | 125.0% | 9.6 | 0.042 |
| metropolis | 500.0k | car | 1.4k | 1.2k | $25.92M | $4.32M | $4.31M | 4305.0% | 0.3 | 0.029 |
| metropolis | 500.0k | designer_jeans | 385 | 385 | $55.4k | $9.2k | $-5.8k | -5.8% | never | 0.009 |
| riverside | 250.0k | soft_drink | 1.31M | 1.31M | $2.36M | $393.7k | $378.7k | 378.8% | 3.2 | 63 |
| riverside | 250.0k | bread | 1.74M | 1.74M | $5.21M | $868.7k | $853.7k | 853.8% | 1.4 | 83.4 |
| riverside | 250.0k | beer | 656.3k | 656.3k | $2.36M | $393.7k | $378.7k | 378.8% | 3.2 | 31.5 |
| riverside | 250.0k | coffee_drink | 1.05M | 1.05M | $5.04M | $840.0k | $825.0k | 825.0% | 1.5 | 50.4 |
| riverside | 250.0k | t_shirt | 117.5k | 117.5k | $2.12M | $352.5k | $337.5k | 337.5% | 3.6 | 5.64 |
| riverside | 250.0k | television | 1.2k | 1.1k | $510.0k | $85.0k | $70.0k | 70.0% | 17.1 | 0.051 |
| riverside | 250.0k | car | 825 | 737.5 | $15.93M | $2.65M | $2.64M | 2640.0% | 0.5 | 0.035 |
| riverside | 250.0k | designer_jeans | 240 | 240 | $34.6k | $5.8k | $-9.2k | -9.2% | never | 0.012 |
| eastside | 200.0k | soft_drink | 1.01M | 1.01M | $1.82M | $303.0k | $288.0k | 288.0% | 4.2 | 60.6 |
| eastside | 200.0k | bread | 1.31M | 1.31M | $3.93M | $655.0k | $640.0k | 640.0% | 1.9 | 78.6 |
| eastside | 200.0k | beer | 505.0k | 505.0k | $1.82M | $303.0k | $288.0k | 288.0% | 4.2 | 30.3 |
| eastside | 200.0k | coffee_drink | 1.01M | 1.01M | $4.85M | $808.0k | $793.0k | 793.0% | 1.5 | 60.6 |
| eastside | 200.0k | t_shirt | 104.0k | 104.0k | $1.87M | $312.0k | $297.0k | 297.0% | 4.0 | 6.24 |
| eastside | 200.0k | television | 1.2k | 1.1k | $528.0k | $88.0k | $73.0k | 73.0% | 16.4 | 0.066 |
| eastside | 200.0k | car | 850 | 800 | $17.28M | $2.88M | $2.87M | 2865.0% | 0.4 | 0.048 |
| eastside | 200.0k | designer_jeans | 274 | 274 | $39.5k | $6.6k | $-8.4k | -8.4% | never | 0.016 |
| portbay | 150.0k | soft_drink | 795.0k | 795.0k | $1.43M | $238.5k | $223.5k | 223.5% | 5.4 | 63.6 |
| portbay | 150.0k | bread | 1.10M | 1.10M | $3.29M | $547.5k | $532.5k | 532.5% | 2.3 | 87.6 |
| portbay | 150.0k | beer | 397.5k | 397.5k | $1.43M | $238.5k | $223.5k | 223.5% | 5.4 | 31.8 |
| portbay | 150.0k | coffee_drink | 495.0k | 495.0k | $2.38M | $396.0k | $381.0k | 381.0% | 3.1 | 39.6 |
| portbay | 150.0k | t_shirt | 63.0k | 63.0k | $1.13M | $189.0k | $174.0k | 174.0% | 6.9 | 5.04 |
| portbay | 150.0k | television | 600 | 450 | $216.0k | $36.0k | $21.0k | 21.0% | 57.1 | 0.036 |
| portbay | 150.0k | car | 375 | 300 | $6.48M | $1.08M | $1.06M | 1065.0% | 1.1 | 0.024 |
| portbay | 150.0k | designer_jeans | 93 | 93 | $13.4k | $2.2k | $-12.8k | -12.8% | never | 0.007 |
| hilltown | 100.0k | soft_drink | 500.0k | 500.0k | $900.0k | $150.0k | $135.0k | 135.0% | 8.9 | 60 |
| hilltown | 100.0k | bread | 640.0k | 640.0k | $1.92M | $320.0k | $305.0k | 305.0% | 3.9 | 76.8 |
| hilltown | 100.0k | beer | 250.0k | 250.0k | $900.0k | $150.0k | $135.0k | 135.0% | 8.9 | 30 |
| hilltown | 100.0k | coffee_drink | 540.0k | 540.0k | $2.59M | $432.0k | $417.0k | 417.0% | 2.9 | 64.8 |
| hilltown | 100.0k | t_shirt | 54.0k | 54.0k | $972.0k | $162.0k | $147.0k | 147.0% | 8.2 | 6.48 |
| hilltown | 100.0k | television | 640 | 600 | $288.0k | $48.0k | $33.0k | 33.0% | 36.4 | 0.072 |
| hilltown | 100.0k | car | 460 | 440 | $9.50M | $1.58M | $1.57M | 1569.0% | 0.8 | 0.053 |
| hilltown | 100.0k | designer_jeans | 152 | 152 | $21.9k | $3.6k | $-11.4k | -11.4% | never | 0.018 |

##### C2. Store type is irrelevant: a $200k convenience store sells a whole city's cars/TVs (Metropolis, 1.2x, month 3)

| Store | Capex | Product | Units sold | Revenue/mo | NI/mo | ROI/yr |
|---|---|---|---|---|---|---|
| convenience_store | $200.0k | car | 1.2k | $25.92M | $4.32M | 25896.0% |
| convenience_store | $200.0k | television | 1.8k | $840.0k | $136.0k | 816.0% |
| convenience_store | $200.0k | bread | 3.58M | $10.73M | $1.78M | 10701.0% |
| supermarket | $1.20M | car | 1.2k | $25.92M | $4.31M | 4305.0% |
| supermarket | $1.20M | television | 1.8k | $840.0k | $125.0k | 125.0% |
| supermarket | $1.20M | bread | 3.58M | $10.73M | $1.77M | 1772.5% |
| department_store | $4.00M | car | 1.2k | $25.92M | $4.28M | 1284.0% |
| department_store | $4.00M | television | 1.8k | $840.0k | $100.0k | 30.0% |
| department_store | $4.00M | bread | 3.58M | $10.73M | $1.75M | 524.3% |

#### C.4 Experiment E/F — other defects

##### E1. Negative cash: $2M company builds a supermarket (Hilltown), prices soft_drink at world price $1.50 and asks for 10M bottles of restock

| Month | Cash | Inventory value | Total assets | Equity |
|---|---|---|---|---|
| 2026-02 | $-13.47M | $14.25M | $1.99M | $1.99M |
| 2026-03 | $-13.48M | $14.25M | $1.97M | $1.97M |
| 2026-07 | $-13.54M | $14.25M | $1.91M | $1.91M |
| 2027-01 | $-13.63M | $14.25M | $1.82M | $1.82M |
| 2028-01 | $-13.81M | $14.25M | $1.64M | $1.64M |
No exception, no interest, no bankruptcy, liabilities stay 0 — the world market extends unlimited free credit.

##### E2. Upgrade capex is not capitalised into BuildingValue (books stop closing)

| Starting capital | Cum NI | SC + NI | Equity (TA - L) | Difference |
|---|---|---|---|---|
| $10.00M | $-14.0k | $9.99M | $8.34M | $-1.65M |

##### E3. Quality is constant: every inventory in a 10-year four_archetype_melee run

Inventories: 124; min Q = 50; max Q = 50. Max tech reached by anyone: C5:car=T12, C3:car=T11
WAC scan: 0 inventory rows with negative cost or zero-qty-nonzero-cost. 
Lowest unit cost basis on hand: soft_drink $1.5; soft_drink $1.5; soft_drink $1.5

##### E4. Stock-outs: demand allocated to an empty shelf is lost (Metropolis bread, both at $3.00)

City demand 3.58M; A (1,000 on shelf) sold 1.0k; B (unlimited) sold 1.79M; total 1.79M = 50.0% of demand — B could have served everything.

##### E5. Brand decay only applies when NO campaign exists: a $1/month campaign freezes awareness forever

| Month | Budget | Awareness |
|---|---|---|
| 1 | $200k | 50.0 |
| 3 | $200k | 87.5 |
| 6 | $200k | 98.4 |
| 12 | $200k | 100.0 |
| 13 | $1 | 100.0 |
| 24 | $1 | 100.0 |
| 36 | $1 | 100.0 |
Control (campaign cancelled at m12): awareness at m36 = 61.6. Cost-per-point is identical in a 100k and a 500k city (SimulationConstants.cs:59-68).

##### E6. TechLeader price floor uses TOTAL inventory cost basis as a UNIT price (TechLeader.cs:170-173) — tech_titan_clash

| Month | TL car retailers (city: price) | TL car units sold | TL revenue/mo | TL cash |
|---|---|---|---|---|
| 1 |  | 0 | $0.00 | $46.95M |
| 2 |  | 0 | $0.00 | $43.85M |
| 3 | hilltown:$23.4k | 440 | $10.30M | $42.90M |
| 4 | hilltown:$2.22M, hilltown:$23.4k | 276.35 | $7.23M | $35.82M |
| 5 | hilltown:$10.92M, hilltown:$23.4k, eastside:$23.4k | 1.1k | $25.52M | $36.59M |
| 6 | hilltown:$10.93M, hilltown:$23.4k, eastside:$4.36M, eastside:$23.4k | 786.25 | $19.70M | $26.22M |
| 12 | hilltown:$10.93M, hilltown:$23.4k, eastside:$20.20M, eastside:$23.4k | 786.05 | $19.18M | $54.51M |
| 18 | hilltown:$10.93M, hilltown:$23.4k, eastside:$20.20M, eastside:$23.4k | 786.05 | $19.18M | $82.81M |
| 24 | hilltown:$10.93M, hilltown:$23.4k, eastside:$20.20M, eastside:$23.4k | 786.05 | $19.18M | $111.10M |

##### E7. R&D pace: months for one R&D centre (4 slots on one product) to reach max tech, and desirability effect

- soft_drink: max tech 8 reached after 7 months (4 slots); R&D cost = $3.0M capex + 7 x $50k opex = $3.35M. Desirability T-term goes 10 -> 80 (Q fixed at 50, so weight rises 2.17x with zero brand).
- car: max tech 12 reached after 17 months (4 slots); R&D cost = $3.0M capex + 17 x $50k opex = $3.85M. Desirability T-term goes 10 -> 120 (Q fixed at 50, so weight rises 2.83x with zero brand).

##### E8. Warehouses: unlimited target stock bought on credit in one tick

$1M company, $500k warehouse, target 1,000,000 cars: cash after 1 month = $-18.00B; inventory = $18.00B. No capacity limit (4 slots, 2x2 footprint).

##### E9. Geography requirements are not enforced

Built an oil well in land-locked, non-oil Hilltown, an iron mine and a farm in non-arable, non-mineral Portbay: all succeeded (World.Construct never reads GeographyRequirement).

##### F1. Save/load determinism (sandbox, seed 42): uninterrupted 48 months vs 24 + save/load + 24

News events identical: **False**. Uninterrupted: 15 events; save/load run: 9 events.
First divergences: 2028-03:cocoa_blight vs 2029-05:viral_ad_spot; 2028-07:tariff_announcement vs 2029-12:trade_summit_optimism
Company cash identical after 48 months: True (A: $30.00M, $702.96M; B: $30.00M, $702.96M).

## Sources

- Damodaran, *Operating and Net Margins by Industry (US)*, January 2026 — https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/margin.html
- Damodaran, *Ratings, Interest Coverage Ratios and Default Spread*, January 2026 — https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html
- Damodaran, *PE Ratio by Sector (US)*, January 2026 — https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pedata.html
- Damodaran, *Dividend Fundamentals by Sector (US)*, January 2026 — https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/divfund.html
- BLS, *Employment Situation, Table B-8* (Aug-2026 average hourly earnings, production and non-supervisory) — https://www.bls.gov/news.release/empsit.t24.htm
- CNBC, *Fed rate decision September 2026: rates rise to 3.75%–4%* — https://www.cnbc.com/2026/09/16/fed-rate-decision-september-2026.html ; prime rate 7.00 % — https://primerates.com/primerate/current-prime-rate/
- World Bank, *Commodity Price Data (Pink Sheet)*, September 2026 — https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Pink-Sheet-September-2026.pdf
- Schonfeld & Associates, *Advertising Ratios & Budgets 2026* (via RAB) — https://www.rab.com/research/10014.pdf
- USDA NASS, *Land Values 2025 Summary* (cropland $5,830/acre) — https://www.nass.usda.gov/Publications/Todays_Reports/reports/land0825.pdf ; DTN summary — https://www.dtnpf.com/agriculture/web/ag/news/business-inputs/article/2025/08/01/cropland-values-continue-rise-5-830
- EIA, *Electric Power Monthly* (industrial ≈ 9.2 ¢, commercial ≈ 14.2 ¢/kWh, mid-2026) — https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=table_5_03 ; https://eco3min.fr/en/us-industrial-electricity-price-dataset/
- Cushman & Wakefield, *2025 Industrial Construction Cost Guide* — https://cushwake.cld.bz/2025-Industrial-Construction-Cost-Guide ; RSMeans supermarket model — https://www.rsmeans.com/model-pages/supermarket ; commercial cost ranges — https://www.maxxbuilders.com/texas-commercial-construction-cost-2025-2026/
- Inventory-turn benchmarks — https://www.netstock.com/blog/benchmark-inventory-turnover-by-industry/ ; https://getalertr.com/blog/inventory-turnover-ratio-by-industry-benchmarks
- Tax and depreciation rules (IRS Publication 946 MACRS classes; TCJA NOL 80 % limitation; 21 % federal rate) — standard references, not re-fetched.
- Capitalism Lab mechanics as summarised in `docs/overhaul/research/caplab-brief.md` (§2.4–2.12) and `docs/research/capitalism-reference.md`.
