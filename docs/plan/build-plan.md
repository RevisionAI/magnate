# Build Plan — Magnate

**Decisions locked 2026-04-24**
- Name: **Magnate**
- Stack: **Godot 4 + C# (.NET 8)**, desktop 2D isometric. Sim core in pure C# (no Godot deps), renderer in Godot.
- Scope for v1.0: **full CapLab feature surface** — base game + all 8 DLC-equivalent verticals.

> Companion to `docs/research/capitalism-reference.md`. Read that first; this plan assumes it.

---

## 0. Decisions to make before coding

Locking these early prevents rewrites later. Each bullet needs a user call before Phase 1.

1. **Game name**. Candidates: *Magnate*, *Boardwalk*, *Conglomerate*, *Tycoon Street*, *Holdings*, *Empire Street*, *Industria*, *Moguls & Markets*, *Ticker*, *The Firm*. I suggest **Magnate** or **Conglomerate** — both are unclaimed in the business-sim genre and evoke the fantasy.
2. **Target platform & tech stack** — pick ONE path:
   - **A. Desktop (Unity C# or Godot 4 C#/GDScript)** — best for modding ecosystem and performance with thousands of entities. Godot is open-source, lighter; Unity has more asset/plugin support.
   - **B. Web (React + TypeScript + a sim engine in Rust/WASM)** — shareable, easy demos, harder to scale to thousands of entities and large save files; but friction-free distribution.
   - **C. Native (Rust + Bevy, or C++ + custom)** — maximum performance and control; slower iteration; strong for long-term tech base.
   - **Recommendation**: **Godot 4 with C#** for Phase 1–3 prototype, with a plan to extract the simulation core into a pure C# library so we can swap renderer later if needed. It gives desktop polish without Unity's licensing/size overhead, and the sim-heavy workload benefits from static typing.
3. **Data strategy**. All content (products, recipes, buildings, cities, scenarios, AI personalities, ad channels, tech trees, events) lives in versioned **JSON files** with a schema. Mods override by file drop. Saves use SQLite. *Build the data layer before the game layer.*
4. **Simulation tick model**. Fixed **monthly tick** for accounting / AI / reports; **daily tick** for real-estate, retail flow, price updates, and news. Animations and UI update at render rate; sim ticks decoupled.
5. **2D or 3D?** — 2D isometric is the right fidelity/effort trade. Buildings as sprites with a few animation states; city as a tile map. 3D is a trap for a solo-to-small team sim.
6. **Scope ceiling for v1.0** — decide: CapLab-base + 3 DLC equivalents (Subsidiaries / Banking / CES), or CapLab-base + full DLC suite. Affects timeline by ~12 months.

---

## Phase 1 — Simulation Core & MVP Vertical Slice (months 0–4)

**Goal**: one city, one player, five products, three building types, a working economic loop you can lose money in.

### 1.1 Data layer & schema (weeks 0–2)
- JSON schemas for: `Product`, `Recipe`, `Building`, `City`, `Demographic`, `Company`, `Scenario`.
- Seed content: 5 finished goods (soft drink, bread, t-shirt, television, car), 6 intermediates (sugar, flour, cotton fabric, steel, plastic, electronic parts), 5 raw materials (sugarcane, wheat, cotton, iron ore, oil).
- Validation CLI: `validate-content <path>`.
- SQLite save schema: Company, Building instance, Inventory, Transaction ledger, Tick log.

### 1.2 Simulation core (weeks 2–6)
- Tick scheduler: daily + monthly tick pipelines.
- Entity-component store (buildings, products, inventories, orders).
- Recipe solver: given a factory config, compute per-tick inputs/outputs.
- Demand solver: per (product × city × bracket), compute base demand; allocate to retailers via perceived-value softmax (Q, B, T, price).
- Accounting: every transaction creates a ledger entry; P&L and cash flow are queries over ledger.
- Deterministic given seed — write **property tests** (e.g. "total inventory in = total inventory out + on-hand"; "sum of sales revenue = sum of retailer income").

### 1.3 Minimal UI (weeks 6–10)
- City map (tile grid, building sprites).
- Build menu: drop Farm / Factory / Retail.
- **Factory/Retail internal editor** — slot grid, draggable units, wire arrows. This is the signature feature; spend time here.
- Product detail panel.
- Financial reports: Income Statement + Cash Flow (single-page each).
- Speed controls + pause.

### 1.4 Minimum viable AI (weeks 10–14)
- One AI corp with one personality ("generic retailer"). Utility-AI based: scores actions (expand retail, advertise, R&D) by expected marginal profit.
- AI builds, prices, re-stocks, competes for catchment share.

### 1.5 MVP playtest (weeks 14–16)
- One-city sandbox, 5 products, 1 AI, 30 in-game years.
- Success criteria: player can profitably build a supply chain, AI pushes back, game feels like a recognisable Capitalism descendant.

**Exit criteria**: 30+ min self-sustaining game session without a crash; P&L reconciles to cash-flow; AI doesn't go bankrupt in under a year.

---

## Phase 2 — Depth: Brand, R&D, Advertising, Stock Market (months 4–8)

**Goal**: single-city game with full Q/B/T attribute system, advertising, R&D, and an IPO.

### 2.1 Q / B / T attributes
- Per-product tech level; propagate through recipes (input Q contributes to output Q).
- Brand awareness per (product × city); ad campaigns build it, decay over time.
- Perceived-value function tuned against a handful of reference scenarios.

### 2.2 R&D
- R&D building; scientists with skill; projects queue; budget slider.
- Separate product-tech and manufacturing-tech tracks.
- Patents: 5-year exclusivity; licensing mechanic stub.

### 2.3 Advertising
- Channels: TV, newspaper, magazine. Each has reach/cost/demographic curves (data-driven).
- Campaign UI: pick channel, duration, budget, product or corporate brand.
- Media-buy marketplace (you buy from AI-owned stations; later, you own stations).

### 2.4 Stock market (v1)
- IPO flow: set shares, price; market subscribes based on CV and sentiment.
- Daily share-price ticker; dividends quarterly.
- Buy/sell shares of AI corps; hostile takeover at 50%.

### 2.5 Reports suite v2
- Balance Sheet, Credit Rating, Product Profitability by SKU, Stock Holdings, Market Share by Product by City.

**Exit criteria**: a full 50-year playthrough is engaging end-to-end; price wars emerge naturally; IPO + takeover produces meaningful strategic choice.

---

## Phase 3 — Breadth: Multi-city, Logistics, Real Estate, Media (months 8–12)

**Goal**: world scales out — 4 cities, import/export, property rental, media empire.

### 3.1 Multi-city
- Up to 8 cities (CapLab's 24 is a Phase 5 stretch).
- Inter-city shipping via seaports + freight yards; shipping time + cost.
- Per-city demographics that drift over time (population growth hooked to jobs).

### 3.2 Logistics layer
- Warehouses and distribution centres; route goods across cities.
- Seaport + international trade: world-price oracle for commodities (static curves initially).

### 3.3 Real-estate sector
- Apartments, office towers, hotels, shopping malls. Rent income; occupancy; prestige.
- Shopping mall: rent slots to AI or self; tenant mix affects foot traffic.

### 3.4 Media empire
- Own TV station, newspaper, magazine; programming choice affects demographic mix; sell ad slots to AI at markup.

### 3.5 Scenario system
- Scenario definition schema; 5 launch scenarios (Soft-Drink War, Real-Estate Mogul, Media Tycoon, Computer Industry, Global Domination stub).

**Exit criteria**: 2-hr playtime playthroughs stay engaging across multiple cities; at least two strategies (retail-heavy vs. manufacturing-heavy) are viable.

---

## Phase 4 — AI overhaul + onboarding (months 12–14)

**Goal**: fix CapLab's headline weakness — exploitable AI — and solve the learning-cliff problem.

### 4.1 AI personalities
- Data-driven profiles: aggressive expander, niche specialist, retailer, manufacturer, financier, media mogul.
- Utility-AI scoring with personality weightings; add a small MCTS layer for multi-step decisions (takeovers, pricing).
- AI defences: buybacks, poison pills, white knights.

### 4.2 Automation & delegation
- Set-and-forget templates (retail chain template, factory template). Clone a configured building across cities.
- Delegate-to-manager mode per building (auto-restock, auto-reprice).

### 4.3 Onboarding
- Layered tutorial campaign (6 missions: first factory → first retail → first ad → first R&D → first IPO → first takeover).
- Contextual hints, searchable encyclopaedia, tooltip glossary.

### 4.4 Accessibility & UX polish
- DPI scaling, colour-blind mode, full keyboard nav, screen reader for reports.

**Exit criteria**: new player reaches an IPO in <2 hrs without external guides; AI wins ~30% of sandbox starts on normal difficulty.

---

## Phase 5 — Modern CapLab DLC-equivalent verticals (months 14–24)

Each is shippable as its own milestone. Order reflects dependency and value.

1. **Subsidiaries** — holding companies, spin-off IPO, re-acquire, consolidated reports.
2. **Banking & Finance** — operate a bank; deposits, loan book, NPL risk, credit ratings issued to others.
3. **City Economic Simulation (CES)** — dynamic city GDP, inflation, unemployment, government budgets; recessions; Very-High income bracket.
4. **Boardroom** — hirable C-suite with whole-corp multipliers; board votes.
5. **College** — universities, graduate skill pipeline, tuition revenue.
6. **Strategic Resources** — finite oil/minerals, exploration, commodity cartels.
7. **Restaurants & Hotels** — recipe-based restaurants, star-rated hotels, occupancy.
8. **Deep Stock Market** — analyst ratings, market crashes, index funds, short-selling.

Each vertical has a typical shape: new buildings/roles + new report + new scenario + tutorial mission + balance pass.

---

## Phase 6 — Multiplayer, modding, community (months 24–30)

1. **Mod support v1**: JSON override system, mod manager UI, Workshop integration (Steam).
2. **Scenario editor** for users.
3. **Multiplayer** — async (play-by-email style), then real-time co-op / competitive. Re-learn Cap2's LAN design; use deterministic sim + lock-step.
4. **Cloud saves, replays, leaderboards** for scenario best-times.

---

## Phase 7 — Live ops (post-launch)

- Quarterly balance patches using telemetry (most-built buildings, most-profitable strategies, AI win rates).
- Event-driven macro packs (tech booms, pandemics, trade wars).
- Modern-era product packs (EVs, streaming, cloud, AI chips) as free/paid content.

---

## Cross-cutting workstreams

Run in parallel to every phase:

- **Telemetry & analytics** — from Phase 1. Log every key decision + sim invariants; essential for balance.
- **Determinism & save integrity** — sim runs on seeded RNG; saves are replayable; this prevents CapLab's long-session corruption class of bugs.
- **Automated regression suite** — golden-master playthroughs (seeded sim runs ending in known CV ±1%) catch balance drift.
- **Content pipeline** — spreadsheet → JSON → game; designers edit in Google Sheets / Excel, CI validates and imports.
- **Community loop** — Discord + closed alpha from end of Phase 2; open beta at end of Phase 3.

---

## Timeline summary

| Phase | Duration | Outcome |
|---|---|---|
| 0 — Decisions | ~1 week | Name, stack, scope locked |
| 1 — MVP | 4 months | 1 city, 5 products, working loop |
| 2 — Depth | 4 months | Q/B/T, R&D, ads, IPO |
| 3 — Breadth | 4 months | 4+ cities, media, real estate |
| 4 — AI & onboarding | 2 months | Smart AI, tutorial, polish |
| 5 — DLC verticals | 10 months | 8 modern expansions |
| 6 — MP & modding | 6 months | Community features |
| **v1.0 release target** | **~30 months** | Full CapLab-equivalent |

Solo-dev realism: double every estimate. Small team (2–4) can hold to it.

---

## Immediate next actions

1. ~~Name~~ → **Magnate**.
2. ~~Stack~~ → **Godot 4 + C#**.
3. ~~Scope~~ → **full CapLab surface**.
4. Scaffold repo: `/engine` (pure-C# sim core), `/content` (JSON), `/client` (Godot project), `/tools` (validator, importer), `/docs`. ← in progress
5. Phase 1.1: content schemas + seed data.
