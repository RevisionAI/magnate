# Capitalism Series — Design Reference Dossier

Research compiled 2026-04-24 as the source-of-truth spec for the clone project. Covers **Capitalism** (1995), **Capitalism II** (2001), and **Capitalism Lab** (2012–present). Where Cap2 and CapLab diverge, CapLab is the canonical target.

---

## 1. Core gameplay loop

- **Real-time with pause**; monthly accounting tick is the atomic unit for reports, dividends, R&D progress, AI decisions.
- Speed control (slow / normal / fast / ultra). Games typically span 30–100+ in-game years; no hard end in sandbox.
- Moment-to-moment cycle: **scout unmet demand → buy land → drop building → wire internal supply chain → set price/ads/staff → watch reports → iterate**.
- **Win/scoring**
  - Sandbox: no victory; graded by **Corporate Value (CV)** and **Personal Net Worth (PNW)**.
  - Scenarios: explicit goals (CV by year Y; % market share in city X; bankrupt rival; reach IPO of $Y; achieve AAA rating).
  - `CV ≈ Cash + Asset Value + 10 × annual net profit` (earnings dominate).
  - Stock price ∝ CV/shares ± earnings momentum, dividend yield, sentiment (news events, macro in CES DLC).
  - PNW = personal cash + personal stockholdings + capitalised dividends. Often the scenario objective.

## 2. Map & city

- Cap1: single grid. Cap2: 1–8 cities. CapLab: up to 24 cities, plus international trade (Strategic Resources DLC).
- Each city = own grid (~80×80 tiles); roads pre-laid, player cannot edit.
- Buildings come in small/medium/large footprints; land lots are rectangular, bought then built upon.
- No granular traffic; retail uses **abstract catchment**: population × income × distance × brand awareness × competitor proximity.
- **Real estate** is a first-class business: apartments, office towers, hotels, shopping malls, luxury condos. Land prices appreciate with adjacent development, population growth, prestige buildings. CES DLC ties land price to city-wide GDP curve.

## 3. Buildings / facilities

**Retail** (sells finished goods): Convenience store, Supermarket, Department store, Specialty store, Auto dealer, Fashion store, Restaurant, Fast food, Hardware store, Furniture store, Pharmacy, Gas station, Showroom (jewellery/watches).

**Manufacturing**: Factory (slot grid — place purchase/manufacture/sales units; multi-product lines; sub-product chains internal).

**Logistics**: Warehouse, Distribution Center (CapLab), Seaport (import/export + overseas), Freight Yard (CapLab cross-city).

**Raw materials**: Farm (crops), Livestock farm, Plantation, Mining, Oil well, Logging camp, Quarry. Strategic Resources DLC adds finite reserves + exploration.

**Real estate**: Apartment, Office tower, Hotel (star-rated), Shopping mall (player rents slots to AI or self), Luxury condo.

**Services**: HQ, R&D Center, Training Center, TV station, Newspaper, Magazine, Internet/online service (CapLab patches).

**CapLab-exclusive / DLC**:
- Bank (deposits, loans, spread profit, NPL risk)
- Investment firm / mutual fund
- College / University (graduate-quality labour pool)
- Software firm (OS, productivity, games)
- Semiconductor fab
- Automotive plant
- Pharmaceutical lab + factory (patent expiry → generics)
- Fast-food chain HQ
- Subsidiary HQ (spin-off divisions)
- Boardroom (C-suite hires: CEO/CFO/COO/CMO/CTO/CPO)

## 4. Product & supply chain

- Cap2 ~60 products; CapLab 120+ baseline (modded 200+).
- Three-tier: **Raw → Intermediate (steel, plastic, fabric, flour, chips, etc.) → Finished**.
- Recipe example: Car = Steel + Plastic + Tire + Glass + Electronic Parts.
- **Signature UI**: factory / retail interior is a slot-and-arrow flowchart.
  - Purchase units (source preference, max price, target inventory).
  - Manufacturing units (one product each; recipe consumes upstream outputs).
  - Sub-product chains inside one factory.
  - Sales / shipping units push to warehouses or retail with priority list.
  - Broken wires flag warnings.
- **Three product attributes** on 0–100 scales: **Quality (Q)**, **Brand (B)**, **Technology (T)**. All independent.
  - Q = f(input quality, factory tech, worker skill) — recursive up the supply chain.
  - B = per-product per-city brand awareness; built by ads, decays when ads stop.
  - T = product tech level; raised by R&D; increases Q ceiling and appeal.
- **Sales model**: consumer in catchment picks softmax over perceived-value(Q, B, T, Price, competitors).

## 5. Marketing & brand

- Ad channels: TV (highest reach/cost, booked via TV stations), Newspaper, Magazine (niche targeted), Internet (CapLab patches), Sponsorships/events (corp-wide), Billboards (DLC/mods).
- Reach × frequency drives brand awareness; diminishing returns; saturate ~80–90%.
- Decay ~1–3% / month without ads.
- Per-city localisation — re-advertise when entering new city.
- **Product brand vs. corporate brand**: corporate uplifts all existing + future products (strategic: build corporate brand early, launch SKUs cheap).
- **Media empire**: own TV/newspaper/magazine; revenue from ad sales (your ads at cost, AI ads at premium); programming choice affects demographic mix.

## 6. R&D & technology

- Each product has tech level 1–9 (Cap2) / 1–10+ (CapLab).
- R&D Centers run projects: product + scientists + budget; completes when accumulated points pass threshold (exponential in level).
- Separate tracks: **product tech** (raises Q/appeal) and **manufacturing tech** (raises throughput / lowers cost).
- **Patents** (CapLab): ~5-yr exclusivity on new level; can be licensed to AI for royalties. Pharma patents with generic drop-off on expiry.
- Scientists have skill 1–9; trained at universities or training centers.

## 7. Finance

- **Cash & debt**: cash → solvency; negative cash → penalty loans → bankruptcy. Loans (4–12% by credit rating), corporate bonds, mortgages (CapLab). Credit rating AAA→D recomputed quarterly.
- **Equity**: IPO (player sets shares + price, market reacts), secondary offering, buyback, quarterly dividend.
- **Stock market**: all AI corps listed; buy/sell; hostile takeover at >50% (AI defends: buyback, poison pill, white knight); friendly merger at premium. Subsidiaries DLC adds spin-off IPOs + re-acquisition.
- **Banking DLC** (CapLab): branches collect deposits; issue loans; spread = profit; NPL risk; capital adequacy; bank runs possible in recession.
- **Reports** (all exportable, drilldown): Income Statement (by product/division/city/consolidated), Balance Sheet, Cash Flow, Product Profitability, City Report, Stock Holdings, Credit Report.

## 8. HR & operations

- Roles: CEO (player or hired w/ Boardroom DLC), C-suite (CFO/COO/CMO/CTO/CPO — each skill 1–9, whole-corp multiplier), building Managers, Engineers, Scientists, Salesmen, Workers.
- Each building has headcount target; shortage caps output.
- Salary → morale → productivity; attrition when below market.
- Training via training centers or college DLC.
- City labor pool finite; over-expansion → local wage inflation.

## 9. Competitors & AI

- 1–7 AI in Cap2; up to 15 in CapLab. AI has **personality profile** (aggressive expander, niche specialist, retailer, manufacturer, financier…). Data-driven → moddable.
- AI builds, advertises, R&Ds, IPOs, takes over weaker rivals, engages price wars.
- **City demographics**: population × income brackets (Low/Middle/High; CES adds Very High).
- **Demand**: per (product × city × bracket) = base per-capita rate × bracket weight × pop.
- Unmet demand is the headline scouting indicator (city demand chart red cells).

## 10. Game modes

- **Sandbox / Free Play** (city count, AI count, starting capital, starting year).
- **Entrepreneur** (small, no IPO) vs **Capitalist** (full corp with stock market).
- **Scenarios** — Soft Drink War, Computer Industry Tycoon, Real Estate Mogul, Media Tycoon, Global Domination, etc. (~20 in Cap2).
- **Tutorial campaign**.
- CapLab adds: Grand Campaign, Banker mode (Banking DLC), Scenario editor.
- **Multiplayer**: Cap2 had LAN up to 4 players; CapLab effectively none.
- Difficulty: easy / normal / hard / very hard, + AI aggressiveness slider, + starting capital $10M–$1B.

## 11. Capitalism Lab DLC timeline (canonical feature phases)

| DLC | Adds |
|---|---|
| Subsidiaries | Spin-off divisions, holding-company trees, separate IPOs |
| Banking & Finance | Operate own bank, loan book, deposits, NPL risk |
| Stock Market & Investment | Deep markets, funds, analyst ratings, crashes |
| City Economic Simulation (CES) | Dynamic city GDP, inflation, unemployment, government budgets |
| Boardroom | C-suite hires with whole-corp skill multipliers |
| College | Universities, graduate skill pipeline, tuition revenue |
| Strategic Resources | Finite oil/minerals, exploration, OPEC-like cartels |
| Realism Module | Toggle suite raising sim fidelity / difficulty |
| Restaurants & Hotels | Recipe-based restaurants, star-rated hotels |

## 12. UI patterns worth keeping

Product Detail Panel (Q/B/T, cost breakdown, competitor offerings) · Factory/Store Internal Editor (slot + arrow flowchart) · City Demand Chart (unmet demand red) · Financial Reports Suite (drilldowns, export) · News Ticker · Map Overlays (land price, density, brand awareness, own vs. competitor) · Stock Market Window · Corporate Ownership Diagram · Org Chart (Boardroom).

## 13. Modding / data

CapLab is heavily moddable. Products (recipes, costs, base demand, tech levels), cities (population, demographics, geography), buildings (footprint, capacity), AI personalities, scenarios (goals, events), ad rates, tech curves are all plain text / CSV / ini / some XML. Mod manager in-game. Community mods rebalance economy, add modern products (smartphones, EVs, streaming), expand city packs.

**Design lesson**: build the data layer first (JSON / SQLite); engine is a thin runtime over it. Every game object is a row.

## 14. Known weaknesses (non-goals for the clone)

1. Dated UI — modal Win9x-style, no DPI scaling, overlapping panels.
2. AI exploitable — doesn't aggressively undercut or contest ad spend at scale; predictable expansion.
3. Late-game tedium — dominance = click-work; no endgame challenge.
4. Micromanagement explosion — hundreds of buildings, weak automation.
5. Tutorial cliff.
6. Long-session crashes / save corruption (historically).
7. No real labor market dynamics — workers ex nihilo.
8. Weak event system — macro events scripted/repetitive.
9. Limited / absent multiplayer.
10. Flat 2D visuals.
11. Unbalanced DLC interactions (banks as cash printers, over-harsh recessions).
12. Stock-market cheese (predatory pricing to short).

## 15. Modern competitors / positioning

- **Big Ambitions** — first-person retail entrepreneur; narrower scope.
- **Software Inc / Mad Games Tycoon 2** — single-industry R&D tycoons.
- **Industry Giant II** — logistics-heavy supply chain.
- **Anno** — city-builder framing; no stock market or R&D.
- **Offworld Trading Company** — RTS market; no city sim.
- **Workers & Resources: Soviet Republic** — deepest supply chain, planned-economy framing.
- **Tropico** — political-economy city-builder.

**No direct competitor** currently matches CapLab's combined surface (multi-industry + multi-city + finance + R&D + marketing + AI corps + stock market). The clone's moat is **integrated breadth** plus modern UX, smarter AI, and proper multiplayer.

## Cap2 vs CapLab decision table

| Subsystem | Cap2 | CapLab |
|---|---|---|
| Cities | 1–8 | 1–24 |
| AI | ≤7 | ≤15 |
| Products | ~60 | 120+ (200+ modded) |
| Banking | passive | full (DLC) |
| Stock market | basic | deep (DLC) |
| Macro economy | static | dynamic CES |
| Subsidiaries | — | DLC |
| C-suite | — | DLC |
| Universities | — | DLC |
| Strategic resources | abstract | DLC |
| Multiplayer | LAN ×4 | ≈none |
| Modding | minimal | extensive |

**Target for clone**: CapLab feature surface, DLCs = natural release boundaries, multiplayer as Cap2-inspired stretch.
