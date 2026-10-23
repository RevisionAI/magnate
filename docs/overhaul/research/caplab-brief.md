# Capitalism Lab Design Brief for the Magnate Web/3D Overhaul

- **Author:** caplab-brief (game-design research agent)
- **Date:** 2026-09-30
- **Status:** research input for the overhaul. The project tree was read-only while this was written; the only file created is this one.
- **Read with:** `docs/research/capitalism-reference.md` (April dossier), `docs/design/gameplay-and-modernisation.md`, `docs/HANDOVER.md`.
- **Conventions:** **[CapLab]** marks a documented fact about Capitalism II or Capitalism Lab, with a source in §10. **[Design]** marks a recommendation for Magnate. Numbers under [Design] are starting values for tuning, not final balance. `path:line` references are to `engine/Magnate.Engine/` unless a different path is given.

---

## 0. Executive summary

1. **CapLab gets its identity from six systems working together.** (1) Each city is a land market: plots are priced by location, and customer traffic decides where stores succeed. (2) Every firm is a 3×3 grid of functional units joined by links, which makes throughput a puzzle. (3) Each product has a rating built from price, quality and brand, weighted by that product's own "concerns" and measured against a hidden standard price. (4) Vertical integration and B2B trade decide who captures the margin. (5) Corporate finance runs from loans to share issues, buybacks and hostile takeovers, and ends in rankings on the billionaires list. (6) A macro cycle and a growing city mean the timing of investments matters.
2. **Magnate's engine has good bones but no market yet.** The ledger, weighted-average cost, Q/B/T, R&D, patents, events, scenarios, determinism and saves are all solid. I ran seven probes against a copy of the engine (§1). A $250k farm pays for itself in **2.7 months**, and a $1.5M factory in **0.9 months**. A single 1×1 convenience store sells **the entire city's demand** and sells the **same volume at $1.60 and at $7.90**. It can also sell cars. Cash can go to **−$1.67B at 0% interest**. Geography requirements are not enforced. After a building upgrade the **books no longer close**. If the "real-world finance" goal is to hold, fixing these comes before any visual work.
3. **P0 turns Magnate into a real market inside a real city.** It covers:
   - a deterministic plot and land model with construction time;
   - a location-aware retail model: a CapLab-style rating plus a logit choice against "no purchase" and against **local competitors**, store capacity and product ranges by store type;
   - finite seaports and exports in place of the infinite world market;
   - labor and wages;
   - a corporate-finance core: credit line, interest, no negative cash, depreciation, tax, three statements that close;
   - basic valuation and equity;
   - a business-cycle v1;
   - a content rebalance against explicit unit-economics targets.
   
   I also recommend that P0 moves the firm interior to the **3×3 unit and link data model** with auto-layout, so that saves are not migrated twice (§4).
4. **City visual spec (§5).** Each city is generated from a seed on the existing grid, in concentric zones:
   - a CBD of towers biased towards the waterfront;
   - commercial strips along the arterials;
   - rings of apartments, then houses;
   - an industrial wedge towards the port, river or rail;
   - farmland, forests, mines and oil fields at the edges;
   - parks and civic landmarks: city hall, **stock exchange, bank and investment bank as clickable finance buildings**, a stadium and a university.
   
   Land value and traffic fields are computed per tile and drive both the simulation and the overlays. Placing a building is a ghost footprint with live validation and a cost panel, followed by a construction site that finishes in a "grand opening".
5. **Core loop (§6).** At the scale of seconds: scout, then buy land, build, configure and price, watch the rating and the P&L, and iterate. Over a session: import, then build a retail chain, then integrate backwards into factory and farm, then add brand and R&D, then dominate a city. Over the whole game: leverage, then IPO, buybacks, takeovers, multiple cities, real estate and media, and finally the billionaires list. Late-game tedium is fixed with templates, policy-based delegation and exception inboxes. Late-game pressure comes from macro shocks, technology disruption, rival mergers and (P2) antitrust.

---

## 1. Evidence: how the current engine behaves (probe results)

**Harness.** The harness is at `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/caplab-brief/harness/Probe/Program.cs`. It runs against a copy of the engine and content taken on 2026-09-30, with seed 1 and a start date of 2026-01. The project tree was not touched.

| # | Experiment | Result | Root cause (file:line) |
|---|---|---|---|
| E1 | `small_farm` ($250k) in Metropolis, 3 × sugarcane, default AutoExport | Net income **$92,000/month** (revenue $96k, opex $4k). Payback **2.7 months**, annual ROI on capex **442%**. | Extraction books **zero cost basis** (`Simulation/MonthlyTick.cs:192-213`). AutoExport defaults to **true** (`Simulation/BuildingInstance.cs:106`). Export is an **infinite buyer** at the base price (`Simulation/MonthlyTick.cs:447-484`). |
| E2 | `factory_small` ($1.5M), 6 × soft_drink, inputs bought on the world market, AutoExport | Net income **$1.71M/month** on $66k of inputs. Payback **0.88 months**. ROI **1,371%/yr**. | Recipe value-add is about 27× (1,000 bottles from $55 of sugar and plastic). `LaborUnits` is never used (`Domain/Recipe.cs:9`, parsed at `Content/ContentLoader.cs:258`). Output is fixed at 200 cycles per slot per month (`Simulation/SimulationConstants.cs:10`). Supply and export demand are both infinite. |
| E3 | One `convenience_store` ($200k), soft drink restocked at world price, no rivals, price sweep | **31.5M units/yr at $1.60, $3.00 and $7.90 alike**, which is 100% of Metropolis demand. Net income is $3.1M, then $47M, then **$201M a year** on $200k of capex. | Total demand is fixed. Price only changes *share* between retailers (`Simulation/MonthlyTick.cs:347-399`). There are no local competitors, no outside option, no store capacity (`World.cs:306-337` accepts any restock target), and no location. |
| E4 | `convenience_store` selling **cars** | Sells 14,400 cars a year. Cash ends at **−$1.67B**. | No store-type product ranges. The restock target is unconstrained. |
| E5 | `iron_mine` in Metropolis (mineralRich=false), `seaport` in inland Hilltown, `oil_well` in Hilltown (oilRich=false) | All three are **allowed**. | `World.Construct` (`Simulation/World.cs:95-115`) ignores `GeographyRequirement`, `Footprint`, `City.Grid` and `BaseLandPrice`. Grep finds no use of any of these under `Simulation/`, `Ai/`, `Economics/` or `Scenarios/`. |
| E6 | Start with $1M, convenience store with a restock target of 10,000 cars | Cash is **−$166M** after one month. No interest, no default. | `MaterialProcurement.BuyFromMarket` (`Simulation/MaterialProcurement.cs:107-127`) never checks cash. `BalanceSheet.Liabilities` is hard-coded to 0 (`Simulation/World.cs:940`). |
| E7 | Upgrade a supermarket to L2 ($720k) | Equity comes out **$720,000 below** starting capital plus net income. **The books do not close.** | `GetBalanceSheet` values buildings at `type.ConstructionCost` only (`Simulation/World.cs:930`). Upgrade capex leaves cash but never reaches assets. Invariant #4 in HANDOVER §5 is broken whenever a building is upgraded. |

**Also verified in code:**
- Quality is only the average of input quality (`Simulation/MonthlyTick.cs:258-273`). Technology does not raise quality. Instead, tech enters the consumer's choice directly as `T×10` (`Simulation/MonthlyTick.cs:354`).
- The corporate-value goal uses **total assets** (`Scenarios/Goal.cs:27-41`). The client's corporate value (HANDOVER 3.63) is assets + 10 × net income. The two definitions disagree.
- Intra-city freight is zero. Inter-city internal freight is a flat 10% of world value (`Simulation/MaterialProcurement.cs:85-105`).
- There is no inter-company trade. Procurement means own buildings first, then the world market (`Simulation/MaterialProcurement.cs:35-77`).

**Implication.** Every scenario today can be won by exporting anything. Retail pricing has no downside. Finance has no constraint. Once any real opponent exists, each of these becomes something a player can exploit. They have to be fixed in the engine, not in the client.

---

## 2. Capitalism Lab reference (mechanics, with numbers)

### 2.1 Time, speed and scope
- [CapLab] Real time with pause. The simulation runs on days. Reports, dividends and goals work on months and years. Speeds are 0 (pause) to 5. Sandbox games run 30–100+ years. After 50 years the score starts to decay (Cap2 manual, "Game Score").
- [CapLab] 1–10 cities (15 with CES). The start year is 1900–2100; products that need inventing unlock by year. City population is 500k–5M in the base game, or 50k–500k under CES (whose model is about ten times more detailed per citizen). Each city has a real wage rate of 20/30–100 and 0–4 consumer (C) and 0–4 industrial (I) seaports.
- [CapLab] **Construction is instant** in Cap2 ("The building will be immediately available for use"). Magnate's construction time is a deliberate [Design] departure, and a good one.

### 2.2 City map and land
- [CapLab] Each city is its own isometric map. Roads are pre-laid; under CES the mayor can build roads and zone land. Terrain is seeded ("map seeds"), and a random factor decides whether there is a river. Natural-resource deposits appear on the map as letters (`ITEM_CHAR`). Civilian buildings (houses, stadiums) and government buildings are simulation scenery. In Cap2 the **Bank, Investment Bank, Stock Market and Information Center are clickable government buildings** that open the loan, share-issue, stock-market and report screens.
- [CapLab] Building footprints are **1×1 to 4×4** (`LOC_WIDTH`/`LOC_HEIGHT` 1–4 in `Buildings.DBF`). Examples:

  | Building | Footprint |
  |---|---|
  | Convenience, drug, apparel, footwear, jewellery, leather, cosmetic and toy stores | 2×2 |
  | Supermarket, department store, auto outlet, electronics, computer, furniture and sports stores | 3×3 |
  | Discount megastore | 4×4 |
  | Factories: small / medium / large | 2×2 / 3×3 / 4×4 |
  | Apartments and commercial buildings | 2×2 and 3×3; taller versions on the same footprint cost more |
  | Mansions | 2×2 |

  Retail internal space is 50 for a 2×2 store, 100 for 3×3 and 200 for 4×4.
- [CapLab] **Land plots** can be bought, held and sold on their own ("downtown land strategy": buy cheap early, sell into a bubble). Hovering a plot shows its market value and the investment gain.
- [CapLab] **What moves land value:**
  - macro conditions: inflation and real wages;
  - natural-resource reserves on the site, which make it much more expensive;
  - surrounding development, where offices, apartments and retail raise value more than factories do;
  - traffic volume and the number of buildings; closures and falling traffic lower it;
  - community and sports facilities;
  - city wage rate: low-wage cities have cheaper land.
  
  Since v10, a new firm's effect on neighbouring land prices ramps in gradually, as an anti-exploit measure. Under CES, agricultural zones cost "significantly less than any other zone".
- [CapLab] **Overlays and minimap modes:**
  - buildings;
  - land value (red/orange high, yellow middle, uncoloured low; a red dot marks the CBD);
  - customer traffic (same colour scale);
  - profit/loss;
  - land ownership and natural resources (green = acquired, white = available);
  - links (product, firm and corporate flows);
  - population and pollution, population and public-service coverage (CES);
  - zone colours (CES);
  - "My Firms" filter;
  - a toggle to hide apartments and offices so business buildings stay readable.
- [CapLab] **Customer traffic index** runs 0–100 per location. It is shown while choosing where to build and at the top right of each store. "Stores in high-traffic areas see greater demand." The **CBD moves**: another district can take the title by developing more densely.
- [CapLab] **City dynamics.** Population grows with low unemployment and enough housing, and with quality of living: community and sports facilities, green space and shopping access. It stops, or reverses, when housing is short or unemployment is high. "Every building shapes the city — yours and the AI companies'. Land values and traffic volumes both rise in areas where new buildings go up."

### 2.3 Firms and the 3×3 unit layout (the signature mechanic)
- [CapLab] Each firm has a **3×3 grid of 9 unit slots**. Units are linked through connectors between neighbouring cells, and the UI draws orthogonal and diagonal "crossing pipes". An unlinked unit sits idle. There is an **Auto Link** for purchasing units, a **Layout Plan Library** (save and apply layouts, search by product), **Auto-setup factory/farm production**, **Add Product** (adds a purchasing unit plus a linked sales unit if there is room) and **firm duplication**. With the Subsidiary DLC, retail stores can have **up to 3 floors**, each with its own 3×3 grid; overhead scales with floors.
- [CapLab] **Unit catalogue** (Cap2 manual):

  | Unit | Found in | Setup cost | Workers |
  |---|---|---|---|
  | Purchasing | retail, factory, farm | $50,000 | 2 (4 in medium/large firms) |
  | Sales | nearly all | $100,000 | 4 (8 in medium/large) |
  | Inventory | retail, factory, farm, resource sites | $50,000 | 1 (capacity is several times a normal unit; opex is a fraction) |
  | Advertising | retail, factory, farm, resource sites | $5,000 | 1 (never levels up; the CMO improves it) |
  | Private labeling | department store, factory | $100,000 | 6 |
  | Manufacturing | factory | $300,000 | 6 / 12 / 24 (small / medium / large factory) |
  | Crop growing, livestock raising, livestock processing | farm | $100,000 each | 16 |
  | Mining, oil, logging | resource sites | — | — |
  | R&D | R&D centre, up to 9 per centre | — | — |
  | Warehouse input / storage / output | warehouse | — | — (3× the capacity and throughput of factory units) |

  HQ offices and departments: CEO, COO, CMO, CTO, Financial, HR, PR, Investor Relations, Real Estate, Community Engagement. Worker salary in Cap2 is a flat **$2,000/month**. In CapLab it scales with the city wage rate and with inflation.
- [CapLab] **Unit level** starts at 1 and trains up to 9. Workers learn faster when their unit is busy. Changing a unit's product drops its level; applying new technology to a manufacturing unit drops it too (unless the manager has industry expertise).

  Purchasing, sales, manufacturing and private-labeling units:

  | Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  |---|---|---|---|---|---|---|---|---|---|
  | Productivity % | 100 | 130 | 160 | 200 | 250 | 300 | 360 | 430 | 500 |
  | Capacity % | 100 | 125 | 175 | 200 | 250 | 300 | 375 | 437 | 500 |

  Other unit types:
  - crop growing capacity: 100% at level 1, then +50 points per level, to 500% at level 9;
  - livestock raising: 100% at level 1, then +20 points per level, to 260% at level 9;
  - farm product quality: level 1 ≈ 30, levels 8–9 ≈ 93.
- [CapLab] **Bottleneck diagnosis** for sales units (the manual's table):
  - supply < demand and utilization = 100%: capacity is at peak;
  - supply > demand and utilization = 100%: capacity is at peak;
  - supply < demand and utilization < 100%: insufficient supply;
  - supply > demand and utilization < 100%: low demand.
- [CapLab] **Ratios** (v11 onwards): one purchasing unit feeds up to **3 sales units** (it was 2). One floor supplies at most 6 sales units, so a retail floor carries **up to 4 products**, and a 3-floor store up to 12. Farms want 6 crop + 1 inventory + 2 sales units. Livestock is 1 raising unit to 1 processing unit. Mines use mining → inventory → output.
- [CapLab] **Cargo is value-based.** One cargo unit holds a few cars or thousands of shampoos, but "the value of each cargo unit is about the same". Capacity is therefore measured in value, not in units.
- [CapLab] **High-priced products** (v12): products priced at $20,000 or more take price ÷ $20,000 days per unit to make.

### 2.4 Retail
- [CapLab] Cap2 store costs (setup / monthly):

  | Store | Setup | Monthly |
  |---|---|---|
  | Discount megastore | $1.8M | $180k |
  | Department store, supermarket | $1.0M | $100k |
  | Convenience store | $500k | $50k |
  | Specialty stores (most) | $500k | $50k |
  | Auto outlet, hardware, furniture | $1.0M | $100k |

  In CapLab v10 supermarkets and convenience stores were made cheaper than department stores to create an incentive to build them. **Specialty stores** sell only their product class but "enjoy greater demand" than a department store selling the same goods. General stores exist only in CES survival mode, or when switched on under the Service Industry DLC.
- [CapLab] **Location factors** (manual): competitor strength in that part of the city; city population; land cost (urban above rural, centre above edge); freight from suppliers ("for goods with a high ratio of weight to value … not too far from the suppliers"); and availability of central sites ("the flow of customers reaches its maximum in the city center and decreases toward the city border").
- [CapLab] **Retail Demand Bonus** (shown as stars) magnifies traffic. It rises with specialization, with more stores of the same type in the city, and with those stores sitting in high-traffic locations. "A network of stores beats standalone outlets." Chain stores partly cannibalize each other, but the chain bonus makes up for it.
- [CapLab] **Local competitors** are unnamed firms in every city. They are not drawn on the map but "compete directly with all of the corporations … sometimes they can even be the major competing force". They appear as the white slice of the market-share pies. Their strength per product class is `LOCALCOMP` (0–100).
- [CapLab] **Price agreements:** when a manufacturer also retails its own brand, other retailers cannot undercut its retail price. Private labeling is the way around this. **Internal Sale** blocks competitors from buying from your firms, but existing contracts persist.
- [CapLab] **Product Detail report:** the product's price, quality, brand and overall rating against the city average; bars for yellow = price attractiveness, green = quality, orange = brand; one pie for producers' shares and one for retailers' shares (white = local competitors); necessity index; the product browser.

### 2.5 Product rating (the heart of demand)
- [CapLab] Every product has three **concerns** (price, quality and brand, summing to 100%) that vary slightly by city, a **necessity index** (0–100), and a hidden **standard price** that drifts with the city wage rate and inflation. Some products also carry an `RD_PREMIUM`, a price component immune to wages and inflation. Cap2 manual formula:

  ```
  Rating = QR×QC/60 + BR×BC/60 + PC×(StdPr − SellPr)/StdPr
  ```

  QR and BR are the quality and brand ratings (0–100). QC, BC and PC are the concerns in percent.
- **Calibration** from the manual's example: a bed with brand 24, quality 89 and price $325 has an overall rating of 75, against a city average of 71. With roughly equal concerns this implies a standard price of about $530.
- [CapLab] "Most people will prefer a product with a higher overall rating … there is always a group of consumers who are more price-sensitive." A low absolute rating sells almost nothing. The example is a car with rating 6 (brand 0, quality 35, too expensive) that had "very few customers". The advice: cut price first, because brand and quality take time.
- [CapLab] **Necessity:** demand for high-necessity goods (food, toothpaste at 90%) is stable across wage levels and economic states. Low-necessity goods (cars at 10%, perfume at 20%) swing with spending level and wealth.
- [CapLab] Sample product data from the wiki (this is the kind of data Magnate's catalogue should carry):

  | Product | Necessity | Price / Quality / Brand concern | Quality from raw / tech | Recipe (per batch) |
  |---|---|---|---|---|
  | Bread | 70% | 35 / 35 / 30 | 40 / 60 | 2 flour → 5 bread |
  | Cola | 50% | 30 / 20 / 50 | 20 / 80 | 1 aluminium + 5 corn syrup → 50 |
  | Car | 10% | 30 / 35 / 35 | 30 / 70 | body + engine + 4 wheels → 1 (speed 300) |
  | Mobile phone | 30% | 30 / 40 / 30 | 20 / 80 | electronic components + plastic → 1 |
  | Television | 30% | 30 / 40 / 30 | 20 / 80 | 10 aluminium + 3 components + 5 glass → 1 |
  | Jeans | 50% | 25 / 30 / 45 | 50 / 50 | dyestuff + 2 textiles → 1 |
  | Wine | 20% | 20 / 30 / 50 | 50 / 50 | 5 grapes + glass → 3 |
  | Cigarettes | 30% | 25 / 15 / 60 | 50 / 50 | paper + tobacco → 10 |
  | Toothpaste | 90% | 25 / 30 / 45 | 20 / 80 | 3 chemicals + plastic → 20 |
  | Sofa | 40% | 35 / 40 / 25 | 55 / 45 | 10 leather + 5 cotton + 30 timber → 1 |
  | Desktop PC | 20% | 35 / 35 / 30 | 32 / 68 | CPU + components + steel → 1 (speed 200) |
  | Gold ring | 10% | 40 / 40 / 20 | 60 / 40 | gold → 2 |

### 2.6 Manufacturing and quality
- [CapLab] A recipe has 1–3 inputs, each with a quantity and a quality share `IQUA`, where the input shares sum to less than 100. **Technology contributes the rest** (100 − Σ input shares). Production speed is 100–1000% of standard.
- [CapLab] **Quality formula** (manual worked example):

  ```
  Q_out = Σ_i IQUA_i% × Q_input_i + TechShare% × 100 × (FactoryTech / TopTechInWorld)
  ```

  Example: cotton quality 71 at a 50% share contributes 35; factory tech 30 against a world top of 100 at a 50% share contributes 15; quality is 50. Top technology starts at 100 and rises whenever someone launches higher tech, so **everyone else's quality falls relatively**. To use new technology a manufacturing unit must be upgraded, and that costs it unit levels.
- [CapLab] Factories in Cap2: small $750k + $50k/month, medium $1.5M + $100k/month, large $2.5M + $180k/month. Output depends on the product ("Automobiles, Computers or Frozen Meat" need large plants; "Glass, Rubber or Plastic" small ones).

### 2.7 Farms, livestock and natural resources
- [CapLab] Farms in Cap2: small $750k + $50k/month, medium $1M + $100k/month, large $1.8M + $180k/month. **Crops are seasonal**, with a sow month and a harvest month; the crop is not available until the end of the harvest month, so an inventory unit is needed to buffer. Livestock goes from raising to processing; if processing demand exceeds supply, breeding stock is slaughtered, which raises output now and lowers it later. Farm quality comes from unit level. The Experimental DLC's **farm equipment** changes the formula to `Q = 10 + min(45, 5×level) + 45 × equipmentQuality/100 × boughtQty/requiredQty`, with training costs reduced to 70%. **Farm extension** lets you drag out extra farm tiles.
- [CapLab] Natural resources in Cap2: mine or oil well $5M + $300k/month; logging camp $1.5M + $100k/month.
  - Sites are fixed and **finite**. Quality is set by the site (e.g. timber 50–90) and **training cannot raise it**.
  - Buying a site costs a reserve premium, `RES_COST%` of the standard price × the reserve. The reserve is a corporate asset, and **depletion is booked as the unit cost**.
  - New sites appear once existing ones are taken, and **each new site costs sharply more**. Operators pass the premium on in their prices.
  - An optional "unlimited resources" mode continues production after depletion at `cost/unit = acquisition cost / original reserve × inflation`.

### 2.8 R&D and technology
- [CapLab] R&D centre in Cap2: $1.5M + $100k/month, up to 9 R&D units.
- Technology gain from one level-1 unit by project length:

  | Duration | 6 months | 1 year | 2 years | 3 years | 5 years | 10 years |
  |---|---|---|---|---|---|---|
  | Tech gain | 1 | 3 | 7 | 11 | 20 | 50 |

- Team multiplier when units are linked:

  | Units linked | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  |---|---|---|---|---|---|---|---|---|---|
  | Multiplier % | 100 | 170 | 240 | 295 | 350 | 390 | 430 | 455 | 480 |

- Each unit level adds **+20%**. Research is faster when a competitor already sells a higher technology (diffusion, reverse engineering). Technology can be **bought** from rivals (CEO or CTO office); rivals rarely sell their best.
- [CapLab] **Inventions** have an earliest research year (`CANINV_YR`), an invention time in years (`INVENT_YR`) and up to two parent inventions.
  - **Phase-out:** `OUTBY`, `OUTSPEED` and `OUTREMAIN` (e.g. smartphones take mobile-phone demand; notebooks keep 40% of theirs after tablets arrive).
  - **Built-in decline:** `OBSOLETE`, e.g. cigarettes lose 2% of demand a year.
  - **Technology disruption** (optional): every technology value falls 10% a year.
  - **Radical R&D:** +200% technology at a 50% success rate, or +400% at 25%; a failed project loses everything. Tech-focused AI companies get 10–30 point breakthroughs.
  - **Intangible asset: technology** is carried on the balance sheet, so tech firms can raise equity against it.
  - Product-class expertise adds +1% R&D speed per point.
  - A CTO with expertise 90 means new R&D units start at level 5.

### 2.9 Brand, advertising and media
- [CapLab] **Brand rating = awareness + loyalty.**
  - Awareness rises with advertising frequency and reach (3–4 exposures are needed before a brand is recognised), with years on sale, with distribution and with the size of the customer base.
  - Loyalty needs prior purchase. It rises with satisfying, consistent quality and can go **negative** after bad quality.
  - The manual's four cases: heavy advertising of a poor product produces high awareness, low loyalty, and demand that fades.
- [CapLab] **Brand strategies:** *corporate* (one umbrella brand; new products inherit it; poor products hurt everything), *range* (one brand per product class) and *unique* (a brand per product). Switching strategy **resets brand to 0**. A merger relabels the target's products; under a unique strategy they reset to 0. The **PR department** only helps a corporate brand.
- [CapLab] **Advertising** runs through media firms: TV, radio and newspapers, plus internet advertising with the Digital Age DLC. Each has rating points (% of the potential audience), CPM and daily frequency. Ads are placed through an **advertising unit linked to a sales or manufacturing unit**, or through the built-in advertising unit, which takes no grid space and has a budget per product. A CMO sets bulk budgets.
- [CapLab] **Media firms as businesses.**
  - In Cap2, cities start with city-owned stations that can be bought and sold; CapLab also lets you build them.
  - Revenue comes from corporate and local advertisers, and depends on rating points and the price per impression.
  - Ratings rise with a content-quality budget, but more slowly against competing stations and in bigger or richer cities.
  - Advertising in your own media is "free": the spend comes back as the media firm's revenue. Heavy self-advertising crowds out paying advertisers.
  - Advice from the strategy guide: fund content at maximum for several years, then cut to a maintenance level.

### 2.10 Seaports, import/export, B2B trade and freight
- [CapLab] **Seaports** are city-owned import points.
  - **C** ports import consumer goods and **I** ports import industrial goods. Games have 0–4 of each per city.
  - Import quality is set per game (Low / Moderate / High / Random). Typical quality is 30–50, "mostly over 40". Imports carry **no brand**.
  - "When more companies are buying from the same seaport for the same products, it will drive up the import prices."
  - Unless *Constant Import Supply* is on, supply **can stop**, and ports rotate the products they carry.
  - Game difficulty is tuned partly through seaport count and quality.
  - Opening strategy: sell seaport goods whose rating depends little on brand (livestock products, furniture, golf clubs, gold rings), in cities with high wages.
- [CapLab] **Freight** is charged per km and per product, using a `FREIGHT` index (1–100) against price. Examples from a fan analysis: a car costs about $12.50/km, an engine $6, flour $0.00175/km. The supplier does not receive the freight. Freight is shown in the store's sales unit and broken down per input in factories. "Cluster your factories and farms … close to a seaport."
- [CapLab] **B2B trade.** Every factory, farm and mine sales unit sells to anyone unless Internal Sale is on. AI firms choose suppliers by rating (price + freight, quality, brand) and available supply. You can "skip the retail stage entirely and just let your competitors sell your goods". **View Clients** lists buyers and their volumes. Relying on a supplier is risky: "they can crank up their prices".
- [CapLab] **Service Industry DLC.** An **Import Company** (one per corporation, 10 products at a time; consumer goods and semi-products, and the official strategy guide says raw and farm products are excluded; options for quality, variety, variety growth and constant supply; Knowledge Points unlock extra deals). An **Export Company** (two per corporation). It finds clients with a search budget; you get a Deal Point every year plus one per five clients, or buy a deal for 3 KP. Each deal has an **expiry date** and a **daily export demand that depends on the product's overall rating**, and revenue is booked at the factory. A **Logistics Company** (one per corporation; per-route capacity budgets; an IT investment saves up to 40% of fixed and 20% of variable cost).

### 2.11 Finance and the stock market
- [CapLab] **Bank loans (base game).**
  - The credit limit depends on **equity and profitability**; early on you can borrow up to about 100% of current assets.
  - Loans are **interest-only**; principal is repaid whenever you choose.
  - The rate **floats** with the market.
  - Worked example from the official beginners' guide: $400M borrowed costs $15M a year in interest, about 3.75%.
  - Inflation erodes debt. Advice: repay when rates are high and inflation is low.
- [CapLab] **Out of cash** is a forced choice: borrow, issue shares, sell stocks, close firms, or declare bankruptcy. **Bankruptcy** liquidates everything; proceeds repay loans first and the rest goes to shareholders. In single player it ends the game (an option now lets you continue as an individual).
- [CapLab] **Stock market (Cap2 manual).**
  - Earnings per share = **operating** earnings over the last 365 days ÷ shares, so that swings in stock holdings do not move it. The screen also shows P/E, equity per share, dividend yield and total return.
  - **Issuing shares:** the issue price must be at or below the current price. The number you can issue is limited by profitability, the issue price and how recently you last issued ("the market needs time to absorb").
  - **Dividends:** a payout ratio of earnings per share, paid **annually**, set in the HQ Financial Department. The ratio starts at 0.
  - **Buybacks** raise remaining holders' percentages. Manual example: 1,000,000 shares, the CEO holds 50%, the company buys back 5% → the CEO holds 52.63%.
  - **Tender offers** are needed to buy from non-public holders and must be above market. Some holders will never sell.
  - **Takeover** at **more than 50%**; control reverts to the CEO if nobody holds over 50%. Mutual control goes to whoever moved first. **Merger** at **75% or more**, paid in cash or in new shares; the target's assets and technology are consolidated.
  - **Trading rules:** your controlled companies cannot buy stock you personally hold, and so on.
- [CapLab] **What drives stock prices** (forum and official guide): "determined mainly by the profitability and the net worth of the company"; "more correlated to book value or equity per share"; dividends have little effect, rising earnings a lot. The goals guide adds: a history of profits, dividends, valuable assets (land, technology, brand, stakes in other companies) and no dilution. An **Investor Relations** budget helps. The "Alternative Stock Sim" option takes out macro sentiment and blocks trading between parent and subsidiary. A stock merge (reverse split) happens below $1; a split is available above $100.
- [CapLab] **Banking & Finance DLC.**
  - Loans come from **banks run by corporations**, each with its own limit and rate; longer terms cost more.
  - **Corporate bonds** of 5, 10, 15 or 20 years with ratings from AAA to D. Example coupons: 5.5% on a 5-year bond and 6.5% on a 10-year bond. A bond market exists; prices fall when the central bank raises rates. Companies can buy back their own bonds; bonds default in bankruptcy.
  - **Treasury notes** of 3, 5 and 10 years, in unlimited supply.
  - **Special dividends** up to the lower of cash and retained earnings; needs at least 75% control.
  - **Venture capitalists** (0–10 of them, e.g. $3B of capital with at most 5% per company).
  - **Realistic Money Supply:** a finite pool of public investors' money that grows with national GDP and shrinks with every share or bond issue.
  - Own **bank** (deposits, loans, a capital ratio of equity ÷ loans against a requirement) and **insurance** (the float is invested).
- [CapLab] **Subsidiary DLC.**
  - New subsidiaries need at least $20M of capital.
  - At 50% or more a subsidiary appears on the financial screen; at **75% or more** you control it directly (build for it, replace its CEO, transfer firms, merge subsidiaries, where the larger market value acquires the smaller).
  - Capital injection needs 100%; issuing shares to the public needs 50% and a listing; privatization needs 100%.
  - **IPO:** a company may start private; going public raises funds and usually a higher valuation.

### 2.12 Macro economy and inflation
- [CapLab] **Cap2 "Complex City Economy".**
  - Per-city **economic climate**: Boom, Prosperous, Normal, Recession or Panic.
  - **Spending level:** a richer city spends more; necessities are less sensitive to it.
  - **Salary level:** labour cost rises in a boom.
  - Business openings improve a city's climate; mass closures can drag it into recession.
- [CapLab] **CapLab macro.**
  - Six indicators: GDP growth, unemployment, real wage, inflation, loan interest rate and CPI.
  - The central bank cycle: growth lifts wages and inflation; inflation forces rate rises; the rate rises end the boom. Asset bubbles need **high GDP growth plus low rates together**.
  - As incomes rise, demand moves up the value scale (Shanghai 1990 to 2010: basics, then cars and leather bags). A luxury product launched too early finds no buyers.
  - Inflation touches prices, land, construction, salaries and opex. The CEO office can auto-adjust prices and ad budgets for inflation. Hyperinflation above 10,000% triggers a currency revaluation.
  - Boom-bust volatility can be set Low, Moderate or High.
- [CapLab] **CES DLC.**
  - GDP made of consumption, investment, government spending and net exports.
  - City budget and taxes: consumer tax, income tax, and a corporate profit tax where about 20% is treated as "neutral".
  - A quality-of-life index with 11 components.
  - City industry competitiveness, which feeds R&D effectiveness.
  - Mayor elections, zoning (mixed, residential, commercial, industrial, agricultural, not for sale), building roads, landmarks with bonuses, founding new cities, and a survival mode.

### 2.13 People: CEO, C-suite, HQ and AI personalities
- [CapLab] **HQ** in Cap2: $3M + $100k/month, with 9 office slots, one of each type.
  - **CEO:** your own salary, capped by last year's profit, is a way to build personal cash without paying dividends to other shareholders. Knowledge Points raise your expertise.
  - **COO:** can manage any firm.
  - **CMO:** increases advertising efficiency and sets bulk ad budgets.
  - **CTO:** runs R&D and buys technology.
  - Departments: Financial (dividend ratio), HR (company-wide or crash training programmes), PR (corporate brand only), Investor Relations, Real Estate (auto-rent), Community Engagement (donations).
- [CapLab] **Expertise** runs 0–100 per field (retailing, farming, manufacturing, R&D, raw materials, advertising, training, and specific product classes).
  - Every **20 points** raises the level of units in the firms that person manages by 1.
  - Advertising expertise of 100 doubles awareness gained; training expertise of 100 doubles training speed.
  - Executives ask for raises and may resign; firing costs one month plus a week of pay per year of service.
  - **COO pricing policy:** Normal (rating level with competitors), Aggressive (+10), Very Aggressive (+20). "Only if you want to trigger a price war." When demand exceeds supply, the COO raises prices regardless of policy.
  - Players report that manager pricing is weak: "better to set prices yourself".
- [CapLab] **AI persons:** character (Conservative, Moderate, Aggressive, Very Aggressive) plus concerns scored 0–100: R&D, training, upgrades, advertising, dividends, stock investing, **takeovers**, strengthening ownership, avoiding layoffs, buying from own firms. Corporate strategies: Diversified, Retail-focused, Production-focused, Stock-focused.

### 2.14 Real estate
- [CapLab] Apartments cost $5–10M plus $100–200k/month; commercial (office) buildings $10–18M plus $200–360k/month (Cap2).
  - **Apartment occupancy and rent** depend on the economy, spending level, land value, rent, and amenities: community and sports facilities, green environment and shopping convenience.
  - **Offices** depend on distance to the CBD and **commuting convenience** (being near apartments).
  - Rent changes take several months to feed through; mall rents are fixed for at least 5 years.
  - Buildings report ROA on market value and on cost.
  - Real estate is "slow and relatively small" but "stable and low risk" and "resistant to recessions". Land is an inflation hedge.
  - AI real-estate firms buy cheap land on the edge of town and build **suburbs** gradually, leaving holes for retail.
  - Shanghai 1990 to 2010: over **800% return in 19 years**.
- [CapLab] **Malls** (Service DLC): mall traffic comes from area traffic, a service-firm boost, the range of products, and the average rating of tenants. Tenants lease space; you are alerted when a renewal comes in 10% or more above market. **Retail space in buildings:** one store on the ground floor, with the same footprint as the building.

### 2.15 Scoring, goals and net worth
- [CapLab] **Score** (Cap2) is made of: stock value, personal wealth, position held (CEO, or CEO and chairman), market value of the companies you control, industries dominated, products dominated, difficulty, and a bonus for goals. It **decreases after 50 years**.
- [CapLab] **Definitions** (goals guide):
  - **Dominance** means the *largest* share, not a majority. For a product class it is measured by **manufacturing** share (buying the goods counts for nothing); for an industry, by revenue.
  - **Corporate net worth** is assets minus liabilities.
  - **Market cap** is price × shares, "higher with a history of profits, dividends, valuable assets, no dilution".
  - **Personal net worth** is cash + mansions + your % of the companies.
  - **Profit** in goals excludes interest, inflation effects, asset revaluations and new buildings.
- [CapLab] **Goal types** (script catalogue):
  - player wealth; company revenue, profit, net worth and market cap (also consolidated with subsidiaries); number of controlled companies;
  - employees; operating margin; ROE; stock price; ownership %; lifetime shareholder return;
  - number of product classes or types produced; CEO-to-employee pay ratio; average training level; target unit levels; target quality or brand for x% of products;
  - launch a product; product market share (by production); monthly class retail or trade revenue;
  - revenue, profit, market-cap and billionaire rankings; number of dominated classes; export revenue; tech lead;
  - subsidiary goals; city, quality-of-life and national goals; digital goals.
  
  Goals can be chained as parent and sub-goals, and grant Knowledge Points or penalties.

### 2.16 Audio and voice in CapLab
- [CapLab] Music plays at random from a MUSIC folder, and players can add their own files or the Cap2 soundtrack.
- [CapLab] **Speeches** (voice lines) since v10:
  - "Your company is now the leader in the {product} market."
  - "Your company has lost its leadership in the {product} market."
  - "The first {product} has been invented."
  
  Each speech category can be switched on or off ("Speech Preference"). Other audio feedback includes the Event Tracker (a flashing alert for broken supply links, bank capital shortfalls and similar), newspaper headlines, and a news log.

### 2.17 What makes CapLab fun, and where it gets tedious (evidence)
Evidence: 336 English Steam reviews of Capitalism 2 (268 positive, 69 negative), the fandom tips pages and the official strategy guides. Reddit could not be used: it blocks both crawlers and the API.

**Fun:**
1. **Legible cause and effect.** The rating bars show *why* customers buy.
2. **The throughput puzzle.** "What makes this game is when you do vertical integration of the 3 sectors, which turns this game into a throughput optimization game … similar to Factorio" (56 h). The 3×3 layout is called out by name.
3. **Capturing margin.** "Nearly every expenditure stays inside your own corporate family" (official market-domination guide).
4. **Competitive pressure.** "Expand or die". Price wars. Market-share pies.
5. **The financial power fantasy.** Leverage, IPOs, buybacks and takeovers: "I forcibly bought out [rival]'s last shares … absorbing it into my humongous conglomerate … TASTE CAPITALISM" (33 h); "the ONLY game … with robust stock market play". Resource plays: "take out a gigantic loan to buy up a gold deposit, then … jewellery" (293 h).
6. **Land speculation** tied to a city that grows.
7. **Long arcs.** Tech races, obsolescence, macro cycles: "Sim City on crack, macro + micro economics = utterly addictive" (139 h).

**Tedium and weaknesses:**
1. **Click-work grows with the number of firms.** "Extremely repetitive and laborious when you have a big corporation … very micromanagement focused" (89 h); "the micro managing needed to maximise profits becomes tedious … the AI execs … demand such high salaries" (272 h).
2. **Snowball, with no endgame.** "Turn 10 million into 10 billion, but after that tedium will start" (293 h). "AI is weak — too easy even on hardest custom settings."
3. **Weak information design.** "Every factory looking the exact same so you have to hover over each individually" (293 h).
4. **Untrustworthy delegation.** "The AI for managers is terrible (it's better to set prices yourself)" (56 h).
5. **Exploits.** "Mass produce beef at a loss … 100% market share and then just dominate" (2 h). "Lower the rent to an obscenely low amount, then when your apartment fills up you raise the rent" (0 h), which CapLab later closed with rent stickiness.
6. **A steep learning curve** and a weak tutorial.

---

## 3. Gap matrix: Magnate today versus CapLab

| System | CapLab | Magnate engine today | Gap | Priority |
|---|---|---|---|---|
| City layout and land | Isometric city, plots 1×1–4×4, land-value field, zoning (CES), buy and sell land | `City.Grid` and `BaseLandPrice` are loaded but unused (`Domain/City.cs:11-20`). Building has only a `City` (`Simulation/BuildingInstance.cs:90-122`). | Total | P0 |
| Placement rules | Footprint, road, resource site, coastal port | None. `Construct(owner, type, city)` checks cash only (`Simulation/World.cs:95-115`). Geography is ignored (E5). | Total | P0 |
| Construction | Instant | Instant | [Design] add time | P0 |
| Retail location and traffic | Traffic index 0–100, retail demand bonus, chains, specialty | None. Demand is city-wide (`Simulation/MonthlyTick.cs:308-423`). | Total | P0 |
| Store capacity and product range | Unit capacity by level and size; store type limits products | Unlimited (E3, E4) | Total | P0 |
| Local competitors | Per class (`LOCALCOMP`) | None | Total | P0 |
| Demand curve | Rating-dependent; low rating sells little; necessity | Fixed total demand, share only (E3) | Critical | P0 |
| Rating formula | Concerns-weighted Q/B/price vs standard price | `(Q + 10T + B)/3 / P^ε` (`Simulation/MonthlyTick.cs:347-359`) | Replace | P0 |
| Quality | Input shares + tech share relative to top tech | Weighted input Q only; T used directly in demand | Replace | P0 |
| Imports | Seaports C/I, finite, price rises with purchases, rotation, no brand | Infinite world market at base price, Q50 (`Simulation/MaterialProcurement.cs:107-127`) | Critical | P0 |
| Exports | Export company deals with rating-based demand (Service DLC) | Infinite auto-export, on by default (E1, E2) | Critical | P0 |
| Extraction | Finite reserves, site premium, depletion cost | Zero-cost infinite yield | Critical | P0 |
| Labor | Workers per unit, wage by city and inflation | `LaborUnits` and headcount unused | High | P0 |
| B2B between companies | Core (clients, internal sale, price agreements, private labeling) | None | High | P1 (P0 stub: wholesale market) |
| 3×3 units and links | Signature mechanic | Flat slots (`Simulation/BuildingInstance.cs:6-87`); read-only SlotEditor in the client | High | P0 data model, P1 editor |
| Unit levels and training | Levels 1–9, training budgets, crash programmes | Building upgrade L1–3 only (`Simulation/World.cs:129-195`) | Medium | P1 |
| Loans, credit and interest | Credit line from equity and profit, floating rate | None; negative cash unlimited (E6) | Critical | P0 |
| Depreciation and tax | Asset values; CES corporate tax | None; books break on upgrade (E7) | Critical | P0 |
| Shares, valuation, dividends, buybacks | Full | None; corporate value defined inconsistently | High | P0 (basics), P1 (M&A) |
| Takeovers and mergers | Over 50% control, 75% merger | None | High | P1 |
| Bonds, banks, insurance, subsidiaries | DLC | None | — | P2 |
| Macro cycle | Boom → Panic climate, rates, inflation | Random events only (`Simulation/EventEngine.cs`, `Simulation/SimulationConstants.cs:97`) | High | P0 v1, P1 full |
| Brand | Awareness + loyalty, strategies | Awareness only, 2% decay (`Simulation/SimulationConstants.cs:71`) | Medium | P1 |
| Media firms | Businesses with ratings and CPM | Ownership bonus multiplier only (`Simulation/SimulationConstants.cs:79,88`) | Medium | P1 |
| R&D | Duration × team × level; inventions; phase-out | Points per slot; 100×N threshold; **patents** (a Magnate addition, keep) | Medium | P1 |
| HQ and C-suite | COO, CMO, CTO, HR, PR, IR | None | Medium | P1 |
| Real estate | Apartments, offices, malls, land speculation | None | Medium | P1 (land trading P0) |
| Farms | Seasons, livestock | Flat yield | Medium | P1 |
| City growth | Population, housing, jobs, QoL | Static population | Medium | P1 |
| Scoring | Composite score, billionaires list | Goals only | Medium | P1 |
| AI | Personalities with 10 concerns, stock-focused AIs | 4 archetypes; no plot logic (`Ai/AiAction.cs:15-30`) | High | P0 (placement and credit), P1 (finance AI) |

---

## 4. (a) Prioritized feature list for Magnate's web version

**How to read this.**
- **P0** means the first web build is not playable or credible without it. It has to be economically sane and has to feel like CapLab.
- **P1** completes the CapLab core loop.
- **P2** is DLC-level depth and polish.

Each item gives the **design**, the **engine touch points**, and **acceptance** criteria. Wherever possible the acceptance criteria are probes in the style of §1, and they should be added to the regression suite.

### P0: a real market in a real city

**P0.1 City layout and land market** (spec in §5)
- The engine generates a `CityLayout` deterministically from the city seed, `Grid`, geography flags and population. Each tile carries:
  - terrain: land, water, beach, slope, forest;
  - road class: none, local, collector, arterial, highway;
  - zone: CBD, commercial, mixed, residential-high, residential-low, industrial, agricultural, park, civic, port;
  - a resource deposit (type, quality, reserve);
  - owner: city, vacant-for-sale, company id, or local occupant;
  - an occupying building id;
  - a land value and a traffic index, both recomputed monthly with smoothing.
- Plots can be bought and sold with no building on them. Land is a **non-depreciating asset held at cost** in the books. Market value is shown alongside and used in net worth and valuation (IFRS-style disclosure, and it keeps the ledger invariant intact).
- Touch points: `Domain/City.cs` (add `Seed`, `WageIndex`, `ConsumerPorts`, `IndustrialPorts`, terrain flags `River` and `Hills`); new `Simulation/CityLayout*`; save schema v10 (layout is regenerated from the seed, and only mutable tile state is saved).
- Acceptance:
  - The same seed produces a byte-identical layout.
  - Land value in the CBD is 8–20× that of agricultural tiles.
  - The land-value and traffic queries answer in under 2 ms for a full 80×80 city in WASM.

**P0.2 Placement and construction**
- New placement is `Construct(owner, type, city, x, y, rotation)`, validated by the rules in §5.9:
  - the footprint fits;
  - at least one tile has road frontage;
  - the zone allows the building;
  - geography matches (deposit, coast, arable);
  - the tiles are vacant and for sale, or already owned by the company;
  - the company can pay the land plus the first construction installment from cash plus available credit.
- A read-only query `PreviewPlacement(...)` returns `{ok, reasonCodes[], landCost, constructionCost, monthlyOpex, buildMonths, trafficIndex, distanceToCbd, zone, estDemandHint}` so the client can hover at interactive rates.
- **Construction time and progress billing** [Design]:

  | Building | Months |
  |---|---|
  | 2×2 retail | 2 |
  | 3×3 retail | 3 |
  | 4×4 retail | 4 |
  | Factory | 4–6 |
  | Warehouse | 2 |
  | Farm | 2 (first harvest follows the season) |
  | Mine or oil well | 6–9 |
  | R&D centre | 4 |
  | HQ | 6 |
  | Apartments | 6–12 (scales with floors) |
  | Office tower | 9–18 |

  Land is paid 100% up front. Construction is paid 20% at start and the rest in equal monthly installments. Capex accumulates in **construction in progress (CIP)** and becomes property, plant and equipment when complete. Depreciation starts in service.
- Fix E7: upgrade capex must go to PP&E.
- Touch points: `Simulation/World.cs:95-195` (Construct, UpgradeBuilding), `Simulation/BuildingInstance.cs` (add `X`, `Y`, `Rotation`, `State {UnderConstruction, Operating, Closed}`, `CompletesOn`), `Ai/AiAction.cs:15-30`.
- Acceptance:
  - E5 is rejected with reason codes.
  - A retail store opens N months after purchase with capex spread as specified.
  - The books close in every month, including upgrade months (E7 passes).

**P0.3 Retail demand model v2** (replaces `Simulation/MonthlyTick.cs:308-423`)
1. **Addressable demand** per (city, finished product, month):
   `D0 = Σ_brackets pop × share_b × perCapita_b × Spend(city, product)`
   `Spend = 1 + (1 − nec) × (SpendingIndex − 1)`
   SpendingIndex: Panic 0.75, Recession 0.88, Normal 1.00, Prosperous 1.07, Boom 1.15.
   The existing reservation prices can stay as a hard ceiling for each bracket.
2. **Rating** (0–100) for each offer, whether a player store, an AI store or the local competitors:
   `Rating = (QC×Q + BC×B + PC×Ps) / 100`
   `Ps = clamp(50 + 50 × (StdPr − Price)/StdPr, 0, 100)`
   So selling at the standard price gives Ps = 50, a free product gives 100, and twice the standard price gives 0. (Cap2's raw formula is in §2.5 for anyone who wants the original.)
   `StdPr = baseStdPrice × wageFactor(city) × CPI + rdPremium`
3. **Choice** is a multinomial logit with an **outside option** (no purchase) and a **local-competitor** option:
   ```
   u_j  = Rating_j/τ + ln(Loc_j)           τ = 5 rating points
   u_0  = R0/τ,   R0 = 20 + 30 × (1 − nec) + CycleShift   (CycleShift: Panic +8, Recession +4, Boom −3)
   u_L  = R_local/τ,  R_local from LOCALCOMP (e.g. Q 40–55, B 20–35, price = StdPr)
   s_j  = exp(u_j) / (exp(u_0) + exp(u_L) + Σ_k exp(u_k))
   sales_j = min(D0 × s_j, stock_j, capacity_j)
   ```
   Then **spill-over**: demand a capacity- or stock-limited store could not serve is re-offered **once** to the other options in proportion to their shares. This is what makes "open a second store" pay off.
4. **Location multiplier:**
   `Loc_j = (0.35 + 0.65 × Traffic_j/100) × ChainBonus × SpecialtyBonus`
   `ChainBonus = 1 + min(0.25, 0.03 × sameTypeStoresInCity + 0.02 × thoseInTopQuartileTraffic)`
   `SpecialtyBonus` = 1.15 for a specialty store inside its class, 1.0 otherwise.
5. **Store capacity** is value-based, as in CapLab. Each product line (a sales unit) can sell up to `V0(size) × LevelMult` per month at standard price:

   | Store size | V0 per month |
   |---|---|
   | 2×2 | $150k |
   | 3×3 | $300k |
   | 4×4 | $600k |

   LevelMult follows the §2.3 table. Floors hold at most 4 products each.
6. **Product ranges by store type**, from a new `retailRange` content table following CapLab's `Retail_Store_Products`.

- Worked check with this model: bread at StdPr $2.50, marginal cost $1.60, Q 50 / B 0 against a local rating of 40.
  - The profit-maximizing price is about $2.50, with a 24% share.
  - At $7.50 the share falls to 1%.
  - As a pure monopolist the optimum is about $3.00–3.50 (1.2–1.4× StdPr), with 45–60% of addressable demand. That is a sane monopoly: the price goes up and volume is lost.
  - These figures use R0 = 29 (bread's necessity is 70). Checked values: at $2.50 the share is 24.9%; at $2.80 it is 17.9%; at $7.50 it is 1.0%. As a monopolist the share is 62% at $3.00 and 45% at $3.50.
- Acceptance:
  - E3's price sweep shows units falling as price rises. The profit-maximizing price lies between 1.0× and 2.0× StdPr.
  - A rating of 6 sells under 5% of D0 (CapLab's car example).
  - E4 is rejected (product not in the store's range).

**P0.4 Supply-side sanity: seaports, exports and resources**
- **Seaports** are city-owned infrastructure placed by the generator: C and I ports, 0–4 each, derived from `coastal`. Each port offers 6–10 products drawn from the catalogue with a seeded rotation; offers last 24–120 months unless *Constant Supply* is on.
  - Import price: `P_imp = StdPr × ImportFactor(difficulty 1.00–1.15) × (1 + 0.5 × (Q_month/Cap_month)²)`. Purchases above capacity are rationed in proportion.
  - Capacity for a finished good is about 25% of the host city's addressable demand; for inputs, enough to run 3–6 medium factory lines.
  - Quality by difficulty: Low 30±5, Moderate 45±8, High 60±8. Brand is 0.
  - Inland cities import through the nearest port city and pay inter-city freight.
- **Exports** are a finite channel, off by default:
  - demand `D_exp = E0 × (Rating/50)²`, capped at 10–20% of the home-market addressable demand;
  - price `0.80 × StdPr` (FOB discount);
  - only for cities with a port, or a rail link in P1.
  
  Remove `AutoExport = true` (`Simulation/BuildingInstance.cs:106`). Migrate old saves to the export channel with a minimum price.
- **Wholesale market for raw and intermediate goods** (a P0 stand-in until B2B arrives in P1): local industry buys with finite depth, `P_sell = 0.85 × StdPr × (1 − 0.4 × Q_sold/Depth)`, where Depth scales with city population and industrial zone size.
- **Extraction cost basis:**
  - mines, oil and timber buy a reserve at `RES_COST% × StdPr × reserveQty` and deplete it per unit extracted;
  - reserves are finite;
  - each new site costs more (+25% per site of that resource already taken in the city);
  - farms use **absorption costing**: allocate the month's operating cost, wages and depreciation to the units harvested.
  
  This changes the "variable costing" comment in `Simulation/MonthlyTick.cs:194-196`.
- Acceptance: E1 payback is 36 months or more and E2 payback is 30 months or more under default content. There is no path to unlimited revenue.

**P0.5 Labor and wages**
- Headcount per unit follows the CapLab table in §2.3. Wage per month is `$2,000 × WageIndex/60 × CPI`, where WageIndex is 20–100 per city. Construction cost is also multiplied by `(0.6 + 0.4 × WageIndex/60)`.
- Wages are booked as `Salaries` opex per building. Recipe `LaborUnits` becomes labor minutes per unit, which drives headcount for manufacturing units.
- Acceptance: low-wage cities are measurably cheaper for factories and have measurably lower standard prices, which is CapLab's "produce cheap, sell rich".

**P0.6 Corporate finance core** (full spec in §7.3)
- **Revolving credit line** (CapLab-style interest-only):
  - limit = max(0, min(0.8 × tangible assets at book + 0.5 × land market uplift, 4 × EBITDA_ttm) − debt);
  - for the first 12 months: 1.0 × book equity;
  - rate = policy rate + rating spread, floating;
  - interest accrues monthly to `InterestExpense`, which sits below EBIT.
- **No negative cash.** Purchases draw on the line automatically ("auto-draw", on by default, with a warning toast). When the line is exhausted, the Out-of-Cash modal offers the CapLab options.
- **Bankruptcy:** unpaid interest for 3 months, or out of cash with no options left, triggers liquidation. Firms sell at 60% of net book, land at market value; debt is repaid first and the remainder goes to shareholders. Game over (with a continue-as-individual option in P1).
- **Depreciation**, straight-line, monthly:

  | Asset | Life |
  |---|---|
  | Retail, office, apartment buildings | 40 years |
  | Factories, warehouses, farms | 25 years |
  | R&D centre | 20 years |
  | Units and equipment | 10 years |
  | Upgrades | remaining life of the building |
  | Land | not depreciated |

  Resource reserves deplete per unit instead.
- **Corporate income tax** at 21% of positive taxable income, with unlimited loss carry-forward, accrued monthly and paid annually. The rate becomes city-set in P2 (CES treats 20% as neutral).
- **Statements:**
  - Income statement: Revenue → COGS → Gross profit → Opex (salaries, building, advertising, R&D, HQ) → EBITDA → D&A → EBIT → Interest → EBT → Tax → Net income.
  - Balance sheet: Cash, Inventory, Land, PP&E net, CIP, Investments | Debt, Interest and tax payable | Paid-in capital, Retained earnings, Treasury stock.
  - Cash-flow statement: operating, investing, financing.
  - **Invariant:** Assets = Liabilities + Equity in every month.
- Touch points: `Economics/Ledger.cs` (new categories `InterestExpense`, `LoanDraw`, `LoanRepay`, `Depreciation` (non-cash, in a separate journal), `TaxExpense`, `TaxPayment`, `Dividend`, `ShareIssue`, `Buyback`, `LandPurchase`, `LandSale`); `Economics/BalanceSheet.cs:11-21`; `Economics/IncomeStatement.cs`; `Simulation/World.cs:920-1015`.
- Why a separate journal for depreciation: the ledger is cash-only today ("cash = ledger sum"). Keep cash entries for cash, and add a **non-cash journal** (depreciation, accruals) so the P&L is accrual-based and the invariant survives.
- Acceptance: E6 cannot happen; a 20-year sandbox run always satisfies A = L + E; interest and tax show on the P&L.

**P0.7 Valuation and equity basics**
- Each company has `SharesOutstanding` (default 10,000,000), a shareholder register (persons, companies, public float) and treasury stock. The player's company **starts private at 100% owned** [Design, like the Subsidiary DLC's "Private Company" option]. **IPO** is an early mid-game goal: float 20–40% at `P*` (below) minus a 10% IPO discount.
- The share price model [Design, faithful to "profitability and net worth; closer to book value"]:
  ```
  BVPS = book equity (land at market) / shares
  EPS  = NOPAT_ttm / shares          (operating profit after tax, like Cap2's use of operating earnings)
  PE   = PE_sector(10–16) × (1 + clamp(g_ttm, −0.3, 0.6)) × Sentiment(Panic .65, Recession .85, Normal 1, Prosperous 1.1, Boom 1.25) × LevFactor(1 − 0.1 × max(0, Debt/EBITDA − 2))
  P*   = max(0.6 × BVPS, 0.35 × BVPS + 0.65 × PE × max(EPS, 0))
  P_t+1 = P_t + 0.30 × (P* − P_t) + ε,   ε ~ N(0, 4%·P_t) seeded;  + IR effect up to +8%
  ```
  New issues are priced at or below the market, with dilution applied immediately. The yearly issue cap is 20% of shares, or tighter under Realistic Money Supply (P2).
- **Dividends:** a payout ratio of net income, paid **quarterly** [Design; Cap2 pays annually].
- **Buyback:** at market, into treasury.
- **CEO salary:** capped at 1% of last year's net income (P0) and paid to the player's **personal cash**.
- **One engine-side valuation API** (`CompanyValuation`: BookEquity, NetWorthAtMarket, MarketCap or PrivateValue, PersonalNetWorth) used by goals, the UI and AI. `CorporateValueGoal` (`Scenarios/Goal.cs:27-41`) is redefined as NetWorthAtMarket, or MarketCap if the company is listed. The client-side "cash + inv + bldg + 10×NI" corporate value is retired.
- Acceptance: the manual's buyback example reproduces exactly (52.63%). Price falls on dilution and rises with earnings growth. Goals and the UI read the same value.

**P0.8 Macro economy v1**
- A national 5-state climate (Panic, Recession, Normal, Prosperous, Boom) as a Markov chain on the world seed. Target average durations [Design]: an expansion (Normal to Boom) lasts about 6 years and a recession about 12 months. Each city follows the national state with a correlation of about 0.7.
- The policy rate follows a Taylor-style rule: `r = 2% + π + 0.5(π − 2%) + 0.5 × gap`, clamped to 0.25–12%. Inflation runs at 1–4%, higher in booms. The **CPI** scales standard prices, wages, construction costs and land.
- The climate feeds the SpendingIndex (P0.3), the outside option R0, land prices, stock sentiment and wage growth.
- Existing events stay as flavour and shocks.
- Acceptance: a 30-year run shows 3–5 cycles. In recessions, low-necessity goods sell 15–30% less and necessities 0–8% less.

**P0.9 Quality and technology aligned with CapLab**
- `Q_out = Σ inputShare_i × Q_i + techShare × 100 × ownTech/topTech`. Add `qualityMix` to recipes. Tech still comes from R&D; the level scale can stay (1–12) and be mapped to "tech points", or switch to CapLab's open-ended tech values (top tech starts at 100).
- Remove the `T×10` term from demand (`Simulation/MonthlyTick.cs:354`). Technology now reaches consumers **through quality**, which is how CapLab works. Keep **patents and licensing** as a Magnate feature.
- Acceptance: when a rival raises top tech, your quality falls relatively without any action on your part.

**P0.10 Content rebalance** (targets in §7)
- Products gain: `standardPrice`, `concerns {price, quality, brand}`, `necessity` (0–100), `qualityMix`, `freightIndex`, `rdPremium`, `retailClass`.
- Recipes are re-quantified so that, at standard prices, **input cost is 45–70% of the factory-gate price** and labour plus overhead take a further 10–25%.
- Buildings gain `units` layout defaults, `workersPerUnit`, `space`, and `zonesAllowed`. **Footprints are capped at 4×4 in urban zones**, in line with CapLab: `factory_large` 5×5 becomes 4×4 and the convenience store 1×1 becomes 2×2. Farms and mines can stay larger because they sit in rural zones.
- Cities gain `seed`, `wageIndex`, `consumerPorts`, `industrialPorts`, `river`, `hills`, and a local-competitor strength per retail class.
- Acceptance: every building class lands inside its payback band (§7.1) in a fixed-seed "reference operator" simulation, which becomes a golden-master test.

**P0.11 Firm interior: 3×3 units and links as the data model, with auto-layout**
- Replace slots with `Unit {type, cell(0..8), product, level, stock, links[]}`. Links are directed and allowed only between adjacent cells, including diagonals [Design, matching CapLab's connector UI].
- P0 UI verbs are CapLab's own shortcuts: **Add Product** (places purchasing + sales units and links them), **Auto-setup production** (purchasing units for each input → manufacturing → sales), **Apply layout template**. Capacity and throughput are computed per unit, which makes the bottleneck table in §2.3 computable.
- Save migration v9 → v10:
  - RetailSlot → purchasing + sales;
  - ProductionSlot → purchasing units for each input + manufacturing + sales;
  - ExtractionSlot → extraction + sales;
  - WarehouseSlot → input, storage and output;
  - ResearchSlot → R&D unit.
- Why P0: the engine and save format change only once. The 3D client's building interior is built directly on the final model. Manual drag-editing and training can follow in P1.
- *Open question 1* (§8) if the lead prefers to defer.

**P0.12 AI that understands land and credit**
- AI placement uses the same scoring the player sees:
  - retail: maximize `Traffic × 1/landCost^0.5`, subject to the chain bonus;
  - factory: minimize land plus freight to suppliers and the port;
  - farm: agricultural zone;
  - mine: best deposit quality per premium.
- AI respects cash and credit and borrows according to personality (Conservative up to 0.3× equity, Moderate 0.6×, Aggressive 1.0×). It prices by policy (CapLab's rating deltas 0, +10 and +20) and never below marginal cost for more than 3 months unless the personality is "price-war".
- Touch points: `Ai/*.cs`, `Ai/AiAction.cs:15-30`.

**P0.13 Information essentials the 3D client needs** (queries, not screens)
- Market Intel per city: D0, unmet demand, local baseline and the best offer for each product. This is CapLab's red "unmet demand" cell.
- Product detail: the rating breakdown in yellow, green and orange, plus the producer and retailer pies with local competitors as the white slice.
- Building status: utilization per unit and a bottleneck state from the §2.3 table.
- Overlays: land value, traffic, zone, ownership, resources, profit/loss.
- An **event stream** for voice and SFX: market leadership gained or lost, invention, first sale, broken supply, low cash, credit downgrade, IPO, takeover threat.

### P1: complete the CapLab core loop
1. **3×3 manual editor, unit levels and training.** Drag units and draw links. Level table as in §2.3. Training budget per firm, plus HR bulk and crash programmes. Layout library. **Duplicate firm** and **Roll out to N plots** (template expansion). Bottleneck overlay on the supply-chain graph.
2. **B2B trade** replaces the P0 wholesale stub. Sales units post price and quantity; buyers' purchasing units pick the best *supplier rating* (price + freight, quality, brand) with inertia (switch only on a gain above 5%, and at most once per quarter). **Internal Sale**, **View Clients**, **price agreements** and **private labeling**.
3. **Brand v2.** Awareness plus loyalty (loyalty moves with quality satisfaction and can go negative); corporate, range and unique strategies; PR department; merger relabelling.
4. **Media firms as businesses.** City-owned TV, radio and newspaper at the start; buy or build them. Rating points, CPM price, content budget; ad revenue from AI advertisers; self-advertising crowds out others.
5. **HQ and C-suite.** COO, CMO and CTO, plus a CFO as a Magnate addition: auto-borrow and repay rules and dividend policy. Expertise gives +1 unit level per 20 points. Policies (pricing 0/+10/+20; supplier search from own firms or any firm; auto-restock). Salaries, raise requests and resignations. **Delegation log**: every manager decision is written to an activity feed, which fixes CapLab's "untrustworthy managers" complaint.
6. **Stock market trading and M&A.** Buy and sell AI stocks; tender offers; **over 50% takeover and 75% merger** (cash or shares); AI defences (buybacks by "strengthen ownership" concern, white knight); trading regulations; split above $100 and reverse split below $1; special dividends. **Tender offers must reach 50% through a sequence of purchases the player can see coming**, and AI raiders telegraph intent through a "stake above 10% / 20% / 30%" news series.
7. **Real estate.** Apartments and offices with an occupancy model (the economy, land value, rent, amenities; for offices, CBD distance and commute access). Rents are sticky: changes take 3–6 months to phase in, and existing leases hold (this kills the rent exploit). ROA readouts. Civic amenity effects. Personal **mansions**.
8. **Farms v2.** Sow and harvest months; livestock raising → processing at 1:1; quality from unit level; seasonal visuals.
9. **Natural resources v2.** Seeded deposits with a reserve and a quality range; new sites appear with escalating premiums; depletion visuals.
10. **R&D v2.** Linked teams and projects using CapLab's duration and team tables (or keep points and map them); **inventions** (earliest year, invention time, parents); **phase-out** (OUTBY, OUTSPEED, OUTREMAIN); built-in obsolescence; technology buy and sell between companies.
11. **City dynamics.** Population growth `g = 0.5% + 2% × jobsIndex − housingShortagePenalty ± QoL`, clamped to −3% to +6% a year. Demographic brackets shift with real wages. The CBD drifts to the densest commercial district. Civic buildings are added by the city; AI builds suburbs.
12. **Weekly sub-ticks** for production and sales (4 per month). Accounting stays monthly. Visual and financial feedback becomes smoother.
13. **Neighbourhood catchment (Huff model)**, going beyond CapLab. Residential tiles are demand nodes. `u_jn = Rating_j/τ + ln(Loc_j) − d_jn/λ`, with λ = 6 tiles for convenience goods and 20 for durables. This produces cannibalization and "location matters by neighbourhood".
14. **Scoring and rankings.** A composite score in the style of §2.15; a billionaires list with a rising bar over time; market-cap and revenue rankings; dominance by product class, measured by production as in CapLab; goal ladders with Knowledge Point rewards.
15. **Freight by distance** inside and between cities using the product `freightIndex`. Warehouses get 3× unit capacity. Truck visuals along real supply links.

### P2: DLC depth and polish
- **Subsidiaries:** spin-off IPOs, the 50% and 75% thresholds, mass transfer, merging subsidiaries, privatization. **Venture capitalists.**
- **Banking and bonds:** your own bank (deposits, loan book, capital ratio); corporate bonds and a bond market; Treasury notes; Realistic Money Supply; insurance float.
- **CES:** mayor and government mode; zoning and road building; city budget and taxes (a city-set corporate tax); elections; landmarks; industry competitiveness; universities and talent; founding new cities; survival mode; forced relocation.
- **Service Industry:** malls with tenants; service firms (coffee shop, pizzeria; Magnate already has a coffee chain); retail space inside buildings; import, export and logistics companies; hotels.
- **Digital Age:** software, internet, telecom and e-commerce.
- **Experimental:** farm equipment, farm extension, new cities emerging, industry-expertise-only, technology disruption, radical R&D, product customization, multi-floor retail and warehouses.
- **Billionaire Life:** mansions, art and lifestyle satisfaction.
- **Late-game pressure** (Magnate additions):
  - antitrust review when a company holds more than 60% of a product in a city (fines, forced divestiture of stores);
  - activist investors when ROE is below the cost of equity;
  - AI mega-mergers.
- Multiplayer (lock-step), a modding UI, a scenario editor, and challenge games with leaderboards.

### Sequencing and dependencies
1. P0.1 → P0.2 → P0.12. The layout blocks placement, and placement blocks AI.
2. P0.10 content fields → P0.3, P0.4, P0.5, P0.9, which all read the new fields.
3. P0.6 → P0.7. Valuation needs the balance sheet.
4. P0.8 feeds P0.3, P0.6 and P0.7 through SpendingIndex, the rate and sentiment. Stub it as a constant "Normal" climate until it lands.
5. P0.11 can proceed in parallel with engine finance work. It touches `Simulation/BuildingInstance.cs`, `Simulation/MonthlyTick.cs`, `Simulation/MaterialProcurement.cs` and persistence.
6. Probes E1–E7 become the first regression gate; everything else is tuning.

---

## 5. (b) City visual specification

### 5.1 Scale and grid
- One **tile** is one land lot. For visuals, 1 tile = 24 m, which reads well in a perspective or isometric camera. For economics (freight and catchment), 1 tile = 250 m, so Metropolis's 80 tiles span about 20 km. The two scales are deliberately different abstractions, as in CapLab, where a city map is roughly 200 km across but drawn as a compact isometric town.
- Keep the existing grid sizes: Metropolis 80, Riverside 60, Eastside 55, Portbay 50, Hilltown 40. [Design] Allow up to 128 later; instancing handles 16k tiles.
- Footprints: urban buildings 1×1 to 4×4; farms, mines and ports up to 6×6 in rural and port zones.
- Population is **not literal** in the visuals. It sets the urban radius, the density of development and building heights.

### 5.2 Generation pipeline (engine-side, deterministic from `city.seed`)
1. **Terrain.**
   - If coastal: pick a coast side (seeded N/E/S/W, or a bay) and a noisy coastline; the sea covers 8–14% of tiles, with a beach strip.
   - If `river` (Riverside by default, 30% chance elsewhere): a meandering river 1–2 tiles wide from edge to edge, passing within 0.2R of the centre; bridges wherever arterials cross it.
   - If `hills` (Hilltown): a height-map; slope classes 0–3; slope 3 cannot be built on, and slope 2 only takes buildings of 2×2 or smaller.
   - Forest patches cover 5–10% of the rural ring and double as timber deposits.
2. **CBD centre.** The land centroid, shifted 15–25% towards the coast or river (historic cities grow from the waterfront).
3. **Urban radius.** `R_u = R × u(pop)`, with u = 0.45 at 100k, 0.60 at 250k and 0.75 at 500k, interpolated on log(pop). Add ±10% of seeded noise per angle for an organic edge.
4. **Roads.**
   - Arterial grid every 12 tiles, aligned with the CBD.
   - A ring road at 0.55 R_u.
   - 2–4 radial highways to the map edges (the links to other cities).
   - A waterfront road.
   - Collectors subdivide blocks by zone (§5.3). Suburbs get gently curved local streets (seeded).
   - Country lanes every 16–24 tiles in the rural ring.
   - P1: a freight rail line from the port or industrial zone to one edge, with a rail yard.
5. **Zones** by normalized distance `ρ = d/R_u`, with angular noise, using the table in §5.3.
   - The **industrial wedge** is a 60–90° sector centred on the port, river or rail direction, covering ρ 0.35–1.1.
   - **Agricultural** land is everything beyond ρ 1.0 when arable, and scrub when not (Portbay).
6. **Special sites.**
   - Seaports on the coast inside the industrial wedge: C ports near the CBD waterfront, I ports in the industrial harbour.
   - Resource deposits: 2–6 per resource the city has (mineralRich → iron, coal, silica, gold; oilRich → oil fields, plus offshore rigs if coastal). Each has a seeded quality (e.g. 35–85) and reserve, and sits in the rural ring at least 2 tiles from roads.
   - Civic landmarks: city hall and **stock exchange** in the CBD; **bank** and **investment bank** in the CBD; university at ρ 0.3–0.5; stadium at ρ 0.5–0.8; hospitals, schools and police spread through residential areas; a central park of 2–4% of urban tiles next to the CBD; a waterfront promenade.
7. **Initial occupancy.** Residential and civic tiles are pre-built. Commercial tiles are 55–70% occupied by **local-competitor shops**: unbranded generic storefronts whose number reflects that city's local-competitor strength, so the city looks alive and the simulation has a visible counterpart. Offices fill 60–80% of the CBD.
   - **Vacant and for sale:** 30–45% of commercial and mixed tiles, 20–30% of residential, 40–60% of industrial, and all agricultural tiles apart from pre-placed farmsteads.
   - AI companies start with nothing and build like the player.
8. **Fields.** Land value and traffic per tile (§5.4), recomputed monthly. The effects of new buildings ramp in over 12 months (CapLab v10).

### 5.3 Zone model (Metropolis values; others scale with R_u)

| Zone | ρ range | Block (tiles, incl. road) | Typical lot | What stands there | Height rule |
|---|---|---|---|---|---|
| CBD | 0–0.15 | 6×6 | 2×2–4×4 | Office towers, department stores, banks, exchange, city hall, plaza | Towers of 15–60 floors; height rises with the land-value percentile |
| Commercial / main streets | 0.15–0.30, plus 2-tile strips along arterials out to ρ 0.9 | 6×6 | 2×2–3×3 | Mid-rise mixed use (shops below, flats or offices above), malls at arterial crossings | 3–10 floors |
| Apartments (residential-high) | 0.30–0.55 | 6×8 | 2×2–3×3 | Apartment blocks, schools, clinics, pocket parks | 4–15 floors |
| Houses (residential-low) | 0.55–1.00 | 8×10 | 1×1 | Detached houses and townhouses, strip malls on collectors, stadium, golf course at the edge | 1–3 floors |
| Industrial wedge | 0.35–1.10, within the sector | 12×12 | 2×2–4×4 | Factories, warehouses, tank farms, rail yard, I-port | Sheds; chimneys and cranes as props |
| Port | coast | — | 5×3 (existing) | Quays, container cranes, stacks, ships (C and I signage) | — |
| Agricultural / rural | > 1.0 | 16–24 lanes | 3×3–6×6 fields | Farms, plantations, orchards, pasture, forests, mines, oil fields | — |
| Parks and civic | anywhere | — | — | Central park, river or coast promenade, university, hospital, police | — |

Tile-share targets for Metropolis (80×80 = 6,400 tiles):

| Water | Roads | CBD | Commercial | Apartments | Houses | Industrial | Rural | Parks and civic |
|---|---|---|---|---|---|---|---|---|
| ~10% | ~15% | ~1.5% | ~7% | ~10% | ~15% | ~9% | ~30% | ~3% |

### 5.4 Land value and traffic fields (simulation and overlays share them)

Land value per tile, in dollars:

```
LV = BaseLandPrice × 1,000 × C(d) × Z(zone) × (1 + 0.004 × Traffic) × N × W × S × M_t
```

Where:
- `BaseLandPrice` is the content value (80–250). [Design] Interpret it as **$ thousands per tile** at C = Z = 1.
- `C(d) = 0.25 + 2.75 × exp(−(d / (0.45 × R_u))²)`. It is 3.0 at the CBD, about 1.26 at 0.45 R_u, about 0.27 at R_u, and tends to 0.25 far out.
- `Z`: CBD, commercial and mixed 1.0; apartments 0.9; houses 0.8; industrial 0.55; agricultural 0.15; forest 0.2; a resource deposit adds `RES_COST% × StdPr × reserve`.
- `N = clamp(1 + Σ_{buildings within 4 tiles} w × footprintTiles/16, 0.7, 1.6)`, with w: office +0.06, apartment +0.05, retail +0.04, civic or park +0.05, service firm +0.04, house +0.02, warehouse −0.01, factory −0.03, mine or oil −0.05.
- `W` = 1.2 on waterfront (except industrial). `S` = 1 − 0.1 × slope class, and +0.1 for villa views in Hilltown.
- `M_t` = CPI × a land-cycle index. The index rises with GDP growth and falls with real rates. A **bubble** appears when growth is high and rates are low at the same time (CapLab), and **bursts** on rate hikes.

Resulting prices for Metropolis:

| Location | Per tile | Example lot |
|---|---|---|
| CBD | ≈ $790k | 3×3 supermarket: **$7.1M of land** |
| Urban edge (houses) | ≈ $35k | 3×3: $315k |
| Industrial, mid-distance | ≈ $58k | 3×3 factory: $525k |
| Farmland | ≈ $5.6k | 5×5 farm: $140k |

Assumptions behind these rows: the CBD row uses traffic 85 and N = 1.3. The urban-edge row uses C = 0.27, Z = 0.8 and traffic 20. The industrial row uses d = 0.6 R_u, so C = 0.715, with traffic 25 and N = 0.9.

So land is about 60–85% of downtown retail capex and about 25–35% of industrial capex, which is realistic.

Traffic index per tile:

```
Traffic = clamp(100 × [0.50 × exp(−(d/(0.35 × R_u))²) + 0.20 × RoadClass + 0.30 × Density_r4], 0, 100)
          + serviceFirmBoost (0–15 within 3 tiles) + mallBoost (0–20 within 5 tiles)
```

- RoadClass: arterial 1.0, collector 0.6, local 0.3, none 0.
- Density_r4 is the weighted share of developed tiles within radius 4: office and retail 1.0, apartment 0.8, civic 0.6, house 0.4, industrial 0.2, farm 0.
- Smooth with a 3×3 blur. Display with CapLab's colour ramp: red and orange high, yellow middle, none low.

### 5.5 Identity of the five existing cities

| City | Grid / population | Identity [Design] | Signature visuals |
|---|---|---|---|
| **Metropolis** | 80 / 500k, coastal, arable | The capital and financial centre | 40–60 storey skyline on a bay; the exchange on the plaza; 2 C and 2 I ports; container harbour; western farmland |
| **Eastside** | 55 / 200k, inland, wealthy (35% high income), land 180 | Upscale, leafy | Low-rise boutiques, villas and parks; almost no industry; high land prices; freight arrives by highway from Metropolis |
| **Riverside** | 60 / 250k, inland, mineral-rich, river | The workshop city | River through the centre with bridges; mills and factories along the river; open-pit mines and headframes in the north-east hills; cheap land (100) |
| **Portbay** | 50 / 150k, coastal, oil-rich, not arable | Oil and port | Container port, refinery flares, tank farms, offshore rigs, pumpjacks inland; arid scrub instead of farms; working-class housing |
| **Hilltown** | 40 / 100k, inland, wealthy (40% high), land 250 | A small historic hill town | A tiny CBD square and church-like city hall; terraced villas; vineyards and orchards on the slopes; the most expensive land |

### 5.6 Building archetype catalogue (low-poly, stylized "diorama"; readable at distance)

General rules:
- One company colour per corporation, applied to roof trims, signage, flags and truck livery. Local competitors are grey or neutral, city buildings blue-grey (CapLab shows government buildings in blue on the minimap).
- Height encodes value: towers grow with land-value percentile, and the **HQ tower grows with the company's market cap**. This gives a trophy moment in the skyline.
- Activity encodes throughput: parking-lot fill, shoppers, truck frequency and chimney smoke all scale with utilization or sales.
- A status badge floats over your own firms: green is profitable, amber a supply or bottleneck warning, red a loss or a broken link (CapLab's Event Tracker, made spatial).

| Type | Footprint | 3D read |
|---|---|---|
| Convenience, drug and specialty stores | 2×2 | One or two storeys, glass front, coloured awning, pylon sign with a category icon (shoe, gem, sofa, toy) |
| Supermarket | 3×3 | Wide low box, big sign, **parking lot whose cars show customers**, cart corral |
| Department store | 3×3–4×4 | 4–6 storey block, display windows, rooftop sign |
| Discount megastore | 4×4 | Big box with a huge lot |
| Factory S / M / L | 2×2 / 3×3 / 4×4 | Sawtooth-roof halls, chimneys (smoke ∝ utilization), loading docks with trucks. **Product props:** silos for food, tanks for beverages and chemicals, a crane for steel, a clean-room box for electronics |
| Warehouse | 2×2 / 4×4 | Long shed, roll-up doors, truck bays |
| Farm | 3×3–6×6 | Farmhouse, barn and silo plus field tiles. **Crop colour by season:** brown when sown, green, golden, stubble after harvest. Pens with instanced animals |
| Plantation | 3×3 | Rows of shrubs or trees (coffee, hops) |
| Mine | 3×3 | Terraced open pit, headframe, conveyor, dump trucks; ore pile coloured by resource |
| Oil well | 2×2 | Animated pumpjack, tanks, flare; offshore rig if coastal |
| R&D centre | 3×3 | Glass campus, lab dome, satellite dish |
| HQ | 2×2–3×3 | Signature tower with the logo crown; height ∝ market cap |
| TV, radio, newspaper | 2×2–3×3 | Broadcast mast, radio tower, printing plant |
| Apartments | 2×2 / 3×3 | 4–30 floors by land value; balconies; **lit windows ∝ occupancy** |
| Office tower | 2×2 / 3×3 | Glass tower of 10–60 floors; lit windows ∝ occupancy |
| Houses | 1×1 | Pitched roofs, yards and trees, varied colours |
| Civic | varies | City hall (dome), **stock exchange** (classical facade with a ticker LED band), **bank**, **investment bank**, schools, hospital (red cross), police, stadium bowl, university quad, parks with ponds |
| Seaport | 5×3 | Quay, animated container cranes, container stacks, ships docking; "C" or "I" signage |
| Construction site | the target footprint | Fence, excavation, crane, scaffolding; progress ring |

### 5.7 Life and motion
- **Traffic.** Instanced cars on lane splines. Density per road segment = f(traffic index, time of day, economic climate). Buses on arterials.
- **Logistics you can see.** Trucks spawn along *real* supply links (factory → warehouse → store; port → factory). Each truck stands for N cargo units, and its livery is the owner's colour. This is the cheapest way to make vertical integration visible.
- **Customers.** Pedestrians near retail in the CBD and commercial ring, and car-park fill at big boxes, both scaled to the store's sales.
- **Day and night** is cosmetic, on a 4-minute cycle independent of game speed, and can be switched off: headlights, street lights, lit windows. **Seasons** follow the game month (fields, trees, and optional snow in winter for northern cities).
- **Economic mood.** In a boom, cranes rise on the skyline, streets are busier and store signs are lit. In a recession, "For Lease" signs appear on vacant local shops, traffic thins and night lighting dims. In a panic, add news-ticker red and trading-floor murmur (audio).

### 5.8 Overlays, minimap and labels
- **Overlays** are ground decals using CapLab's ramps:
  - land value;
  - traffic;
  - zones;
  - ownership (company colours);
  - resources (deposit icons with quality and reserve);
  - profit/loss by firm;
  - demand heat for a selected product (unmet demand);
  - brand awareness for a selected product;
  - (P1) catchment rings, pollution, and civic service coverage.
- **Minimap** with the same modes. City switcher on the left and right arrows (CapLab's arrow keys). A "My Firms" filter, and **Space to cycle through my firms** (a CapLab shortcut).
- **Labels:** hover shows firm name, type, owner and key numbers; zoomed out, icon badges only; a toggle hides apartments and offices so business buildings stay readable (CapLab).

### 5.9 Placement: what the player sees and does
1. **Build menu (B).** Tabs: Retail, Factory, Farm, Natural Resources, Warehouse, R&D, HQ, Real Estate, Media, and **Land (buy plot only)**. Each card shows footprint, construction cost (wage-adjusted), monthly opex, build time, what it does, requirements (zone, coast, deposit), and a one-line placement hint ("Retail: busy streets; Factory: cheap land near suppliers and port").
2. **Placement mode** switches on the relevant overlay automatically:

   | Building | Overlay and extras |
   |---|---|
   | Retail | Traffic, plus competitor stores for the same class with their ratings |
   | Factory | Land value, plus freight arrows to chosen suppliers and the nearest I-port |
   | Farm | Agricultural zone and soil or season notes |
   | Mine | Deposits with quality, reserve and premium |
   | Real estate | Land value, plus amenity coverage and the housing or office supply-demand index |

3. **Ghost footprint** snaps to tiles. R or a right-drag rotates it. It is **green** when valid and **red** with a reason when not:

   | Reason code | Message |
   |---|---|
   | `NEEDS_ROAD` | Needs road frontage |
   | `ZONE_<zone>` | Zoned Residential (retail allowed only on main streets) |
   | `OCCUPIED` | Owned by Riverside Foods (P1: offer to buy) |
   | `NEEDS_COAST` / `NEEDS_DEPOSIT` / `NEEDS_ARABLE` | Geography not met |
   | `SLOPE` | Too steep |
   | `NO_FUNDS` | Needs $X; you have $Y cash + $Z credit |

4. **Live info panel** while hovering:
   - land cost (sum over tiles), construction cost, total capex, monthly opex (building + wages), build time;
   - traffic index, distance to CBD, zone;
   - for retail: estimated monthly customers for a chosen product at the city-average rating;
   - for factories: freight cost index to inputs;
   - for mines: resource quality and years of reserve;
   - for real estate: comparable rent.
5. **Confirm:** a pop-over with the financing split (cash or credit line) and a **payback estimate band**.
6. **Construction:** a fenced site with a crane and a progress ring showing months remaining. Capex is billed as in §4 P0.2. The construction SFX loops quietly.
7. **Opening:** a "pop" animation, a ribbon or confetti, the grand-opening SFX and a voice line. The interior opens with an **auto-setup suggestion**: accept the template in one click, or edit the 3×3 grid.
8. **Afterwards:** the company colour appears on the building, a status badge floats over it, and activity visuals scale with throughput. A right-click menu offers inspect, reprice, advertise, duplicate (P1), sell or close.

Validation rules (the engine is the authority; the client only displays them):

| Building category | Allowed zones | Frontage | Geography |
|---|---|---|---|
| Retail 2×2 | CBD, commercial, mixed, apartments (on collectors) | local road or better | — |
| Retail 3×3–4×4 | CBD, commercial, mixed | collector or better | — |
| Factory, warehouse | industrial | collector or better | — |
| Farm, plantation | agricultural | any road | arable |
| Mine, oil well | deposit tile of the matching resource | any road | resource |
| R&D, HQ, media | CBD, commercial, mixed, industrial (R&D) | local or better | — |
| Apartments | apartments, houses (2×2 only), mixed | local or better | — |
| Office | CBD, commercial, mixed | collector or better | — |
| Land-only purchase | any zone that is for sale | — | — |

### 5.10 How the city grows over time
- **Monthly:** land value and traffic are recomputed (with ramps). Local-competitor shops open or close as the local share changes. AI firms build.
- **Yearly, in P1 city dynamics:** population changes, new houses appear at the fringe and infill, apartment and office heights rise where land value increases, the city adds civic buildings, and the CBD may move.
- **Recession:** vacancies and "For Lease" signs appear. **Boom:** cranes and new towers.
- The visible city is a **history of the economy**, which is what "being a capitalist in that city" should feel like.

### 5.11 Performance notes for the renderer team
- An 80×80 grid (6,400 tiles) holds roughly 2–5k building instances, 500–1,500 moving vehicles (instanced) and 1–3k pedestrians (instanced and billboarded when far).
- Roads use merged geometry per block.
- Far zoom: a per-block impostor or merged mesh.
- One directional shadow; baked AO on archetypes.
- Target 60 fps on desktop and 30 fps on an integrated-GPU laptop.
- The layout comes from the engine once per city load; monthly updates are deltas (changed tiles, new or removed buildings, field textures).

---

## 6. (c) Core gameplay loop and progression

### 6.1 Three nested loops
1. **Moment to moment** (seconds to minutes; 1 game month ≈ 20 s at 1×, [Design]): look at the city and its overlays → spot an opportunity (unmet-demand heat, a rating gap against the local baseline, cheap land) → act (buy a plot, build, configure, price, advertise) → watch the feedback (customers, trucks, cash pop-ups, rating bars, badges) → adjust price and supply.
2. **Session** (30–120 min): a **business line**. Start with a retail chain selling seaport imports → integrate back into a factory using I-port inputs → then a farm or mine → then R&D (quality) and advertising (brand) → **dominate the category in one city** → roll out to the next city.
3. **Campaign** (hours): **corporate finance and empire.** Leverage (credit line) → profits → IPO → buybacks and dividends → rival stakes → takeover and merger → diversify into real estate and media ("keep money in the family") → macro timing (build in recessions, sell land into bubbles) → rankings (market cap, billionaires).

### 6.2 The first hour (tutorial scenario "First Steps in Metropolis")
| Time | Beat | Systems taught |
|---|---|---|
| 0:00 | A camera fly-over of the 3D city (waterfront CBD, exchange, port, farms at the edge); welcome VO | Tone, the city as a place |
| 0:02 | HUD: $20M cash, a private company at 100%. Executive priority: "Open your first store". Market Intel shows bread and soft drinks with high unmet demand | Scouting, demand heat |
| 0:04 | Build a convenience store (2×2): the traffic overlay comes up and the player picks a main-street plot. Preview: land $0.9M + build $0.5M, 2 months | Land, traffic, capex, time |
| 0:06 | Opening, then Add Product with bread and soft drinks from the C-port. The pricing panel shows the rating against the local baseline (e.g. 52 vs 48) and projected sales and margin | Rating, standard price, concerns |
| 0:10 | First month's P&L (revenue about $150k, gross margin about 30%). VO: "Your first profitable month" | P&L |
| 0:15 | Link an ad on the city TV station; awareness rises month by month | Brand |
| 0:20 | A second store elsewhere; the chain bonus appears (stars) | Chains, location |
| 0:30 | A bakery factory in the industrial wedge buying flour from the I-port; trucks run factory → stores; margin rises | Vertical integration, freight |
| 0:40 | Credit line: borrow $5M at 5.5% to build faster; interest shows below EBIT | Leverage, interest |
| 0:50 | Wheat farm and flour mill: the full chain, with seasonal harvest visuals | Seasons, buffers |
| 1:00 | Goal: "Lead the bread market in Metropolis" → VO: "Your company is now the leader in the bread market" | Dominance |

### 6.3 Mid-game goals (hours 2–8)
- **IPO** at a market cap of $X or more. Choosing the float % trades off cash raised against takeover risk.
- **Enter a second city**: premium goods in wealthy Eastside or Hilltown ("produce cheap, sell rich" via wage and demographic differences).
- **Win a tech race**: be first to invent or reach top tech (with the patent option).
- **Own the media**: buy the city TV station; your own advertising becomes internal and AI advertising becomes revenue.
- **Real-estate play**: buy CBD plots early, build apartments next to your stores, hold through a boom.
- **Take a stake in a rival**, then **take it over** (over 50%) and **merge** it (75%).
- **Survive a recession** with no firm closures and positive operating cash flow.

### 6.4 Late game and the endgame (8 hours onwards)
- **Goals:** dominate N product classes across M cities; market-cap rank #1; top 10 on the billionaires list; control 5 public companies (CapLab's "Legendary Investor"); lifetime shareholder return of X%.
- **Pressure systems against snowball tedium:**
  - macro cycles with real downside;
  - technology frontier and obsolescence (P1; optional 10% yearly disruption);
  - rising wages and land costs;
  - AI mergers creating stronger rivals;
  - (P2) antitrust and activist investors;
  - new cities emerging (P2).
- **A score that rewards efficiency,** not just accumulation: composite score, with the 50-year decay from Cap2.

### 6.5 Anti-tedium design (the modern answer to CapLab's biggest complaint)
1. **Templates everywhere:** layout templates; **Duplicate firm** and **Roll out to the N best plots** (engine-ranked by traffic and land cost); "Clone this supply chain into another city".
2. **Delegation by policy, with a log:** COO, CMO, CTO and CFO follow explicit rules (target rating delta, minimum margin, restock days of cover, borrowing ceiling). Every automated action goes to the activity feed with a reason. The player can pin a firm as manual.
3. **Exception-based management:** an inbox of problems (broken link, stock-out, rating below local baseline, a loss for 3 months, credit headroom under 10%), each with a **Fix** action (switch supplier, add a sales unit, cut price to the target rating, draw on credit).
4. **Bulk operations:** reprice a product across all stores; set ad budgets per product per city; set training company-wide.
5. **Spatial information design:** unique silhouettes, status badges, overlays and supply-link trucks, so the player never has to hover every factory to find the broken one.

### 6.6 Additions to the goal and scenario catalogue
- New goal types:
  - `MarketCap` and `SharePrice`;
  - `PersonalNetWorth` and `BillionairesRank`;
  - `ControlCompanies(n)`;
  - `DominateProductClass` (by production share, CapLab definition);
  - `IpoCompleted`;
  - `ReturnOnEquity`;
  - `OperatingMargin`;
  - `NoClosuresThroughRecession`;
  - `LandGain` (unrealized land appreciation);
  - `OwnMedia`.
- New or rebuilt scenarios, mapped to CapLab's:
  - *Real Estate Mogul* (Shanghai-style: buy land in 1990, develop, sell);
  - *Legendary Investor* ($1B of personal wealth and control of 5 public companies);
  - *Media Empire*;
  - *Farm Family Business*;
  - *Camera Maker's Dilemma* (an obsolescence race);
  - *Corporate Leadership* (share price $500, revenue $1B and profit $100M; sub-goals in 10 years).
  
  Rebase the 16 existing scenarios' corporate-value goals on the new valuation API.

### 6.7 Audio and voice cues tied to the loop
This is for the audio workstream; the engine should expose each trigger as an event.
- **VO (CapLab-style speeches, each category switchable):**
  - market leadership gained or lost for {product} in {city};
  - {product} invented, or first to top tech;
  - first sale and first profitable month;
  - construction complete ("Grand opening: {firm}");
  - supply link broken;
  - cash low or credit line nearly exhausted;
  - credit rating upgraded or downgraded;
  - IPO completed;
  - a rival crossed 20%, 30% or 50% of your shares (takeover threat);
  - takeover completed (yours or theirs);
  - recession begins or boom begins;
  - goal achieved or failed;
  - bankruptcy warning.
  
  Cooldown: at most one VO per 20 s; priority order = financial danger > goals > market events > construction.
- **SFX:** placement valid or invalid; construction loop; opening fanfare; cash register (throttled); truck horn at a port; stock bell on month close; alert chime.
- **Music:** a rotating playlist with mood layers by climate (boom = upbeat, recession = sparse), a crossfade on climate change, and victory and defeat stingers.
- **Reuse:** the existing assets in `client/assets/audio/` (music: title_theme, gameplay_loop, victory_theme; 11 SFX; 10 VO) can be used by the web client.

---

## 7. Balance targets and content schema additions

### 7.1 Unit-economics bands ([Design]; used by the golden-master reference simulation)

| Building class | Capex (land + build, Metropolis mid-ring) | Steady-state monthly revenue | Gross margin | Monthly opex (building + wages) | Target payback |
|---|---|---|---|---|---|
| 2×2 convenience or specialty store | $0.7–1.5M | $150–400k | 25–35% (apparel up to 50%) | $35–60k | 2–4 yr |
| 3×3 supermarket | $2–5M | $0.6–1.5M | 20–28% | $90–150k | 3–5 yr |
| 4×4 department store or megastore | $5–12M | $1.5–4M | 28–40% (megastore 15–22%) | $180–350k | 3–6 yr |
| 3×3 factory | $2–4M | $0.5–2M at factory gate | value-add 15–30% after inputs and labour | $80–160k | 3–6 yr |
| Farm | $0.8–2M | seasonal | 20–35% | $40–120k | 3–6 yr |
| Mine or oil well (incl. reserve) | $5–15M | $0.4–1.5M | 30–45% before depletion | $150–300k | 4–8 yr; reserve lasts 15–40 yr |
| R&D centre | $2–4M | — | — | $100–250k | pays back through quality and brand |
| Apartments | $5–15M | rent | NOI yield 5–8% on value | — | 12–20 yr, plus land gain |
| Office tower | $10–30M | rent | NOI yield 6–9% | — | 11–17 yr; vacancy risk |
| Media station | $1–3M | ad sales | — | content budget | 3–5 yr to profit |

- **Price chain** (retail ÷ factory gate): groceries 1.25–1.40×, beverages 1.3–1.6×, apparel 2.0–2.5×, electronics 1.15–1.30×, cars 1.08–1.15×. Factory gate ≈ 1.2–1.6× variable cost (inputs + labour + freight). Commodities ≈ 1.1–1.5× extraction cost.
- **Integration premium:** owning the whole chain should raise the operating margin by roughly 10–25 points over pure retail, at 3–5× the capital employed. That is the real trade-off CapLab rewards.

### 7.2 Constants to replace in `Simulation/SimulationConstants.cs`

| Constant (line) | Today | Proposal |
|---|---|---|
| `CyclesPerSlotPerMonth` (10) | 200 flat | Derive from unit capacity × level × production speed |
| `InterCityShippingFraction` (16) | 10% of world value | Distance × `freightIndex` |
| `WorldMarketQuality` (22) | 50 | Import quality setting |
| `ExtractionQuality` (25) | 50 | Per site |
| `BrandDecayRate` (71) | 2%/month | Keep for awareness; add loyalty dynamics (P1) |
| Ad cost per point (58–68) | fixed | Media rating and CPM (P1) |

### 7.3 Finance defaults
- **Starting capital by difficulty:** Easy $50M, Normal $30M, Hard $20M, Expert $10M. Personal cash $1M (the CapLab default).
- **Policy rate:** starts at 4.0%, range 0.25–12%, Taylor-style rule (P0.8).
- **Credit-rating bands** [Design, approximating real-world synthetic-rating practice]:

  | Rating | EBIT / interest | Debt / EBITDA | Spread over policy rate |
  |---|---|---|---|
  | AAA | > 12 | < 1.0 | +0.7% |
  | AA | 8–12 | < 1.5 | +1.0% |
  | A | 6–8 | < 2.25 | +1.4% |
  | BBB | 4–6 | < 3.0 | +2.0% |
  | BB | 2.5–4 | < 4.0 | +3.0% |
  | B | 1.5–2.5 | < 5.5 | +4.5% |
  | CCC | 1.0–1.5 | < 7 | +7% |
  | CC/C | < 1.0 | ≥ 7 | +10–14% |

  A new company with no history is rated BBB if equity ≥ debt.
- **Taxes:** 21%, losses carried forward.
- **Depreciation lives:** as in P0.6.
- **Dividends:** quarterly.
- **Issue discount** 5–15%; IPO discount 10%.
- **Control thresholds:** takeover over 50%, merger 75% (CapLab); subsidiary control 75% (P2).

### 7.4 Product fields, and mapping the current 24 products to CapLab analogues
Add to `content/schemas/product.schema.json`: `standardPrice`, `concerns{price,quality,brand}`, `necessity`, `qualityMix{inputs:{id:%}, tech:%}`, `freightIndex`, `rdPremium`, `retailClass`, `localCompetition` (per class), and later (P1) `inventYear`, `inventYears`, `parents`, `phasedOutBy`.

| Magnate product | CapLab analogue | Necessity | Concerns P / Q / B | Quality raw / tech | Notes |
|---|---|---|---|---|---|
| bread | Bread | 70 | 35 / 35 / 30 | 40 / 60 | 1 wheat → flour → bread; the recipe needs rescaling |
| soft_drink | Cola | 50 | 30 / 20 / 50 | 20 / 80 | Brand-led category; re-quantify sugar and plastic per bottle |
| beer | Wine (closest) | 30 | 25 / 25 / 50 | 50 / 50 | [Design] |
| coffee_drink | Coffee-shop products (Service DLC) | 40 | 30 / 35 / 35 | 50 / 50 | [Design] |
| t_shirt | Apparel (Jeans class) | 50 | 30 / 30 / 40 | 50 / 50 | [Design] |
| designer_jeans | Jeans (premium) | 20 | 15 / 35 / 50 | 50 / 50 | Keep reservation prices |
| television | Television | 30 | 30 / 40 / 30 | 20 / 80 | Tech-led |
| car | Car | 10 | 30 / 35 / 35 | 30 / 70 | Needs a multi-day build (≥ $20k price rule) |
| Intermediates (sugar, flour, malt, roasted_coffee, cotton_fabric, denim_fabric) | Semi-products | — | 30 / 30 / 40 (B2B) | 50 / 50 | — |
| steel | Steel | — | 30 / 30 / 40 | 60 / 40 | — |
| plastic | Plastic | — | 30 / 30 / 40 | 30 / 70 | — |
| electronic_parts | Electronic components | — | 30 / 30 / 40 | 30 / 70 | — |
| Raws (sugarcane, wheat, cotton, coffee_beans, hops) | Farm products | — | — | quality from unit level and season | — |
| Raws (iron_ore, crude_oil) | Mine / oil products | — | — | quality from site | — |

### 7.5 Building and city fields
- **Buildings:** `zonesAllowed[]`, `frontage` (local, collector, arterial), `space` (50/100/200 for retail), `defaultLayout` (a units template), `workersPerUnit`, `buildMonths`, `floorsMax`, `archetype` (visual key), `heightRule`.
- **Cities:** `seed`, `wageIndex` (20–100), `consumerPorts`, `industrialPorts` (0–4), `river`, `hills`, `climateZone` (for seasons), `localCompetition` {class: 0–100}.

---

## 8. Open questions for the lead or the user
1. **3×3 units in P0 or P1?** I recommend P0 for the *data model* plus auto-layout, and P1 for the manual editor and training. This avoids a second save migration and gives the 3D interior view its final shape. Deferring saves about 2–3 weeks now and costs more later.
2. **Start private or public?** I recommend starting private (IPO as a goal) for onboarding, with "start public" as a sandbox option. CapLab's default is public; its Subsidiary DLC offers private.
3. **Tick granularity.** Monthly accounting with P1 weekly sub-steps, or daily from the start as in CapLab? Daily is richer, but the 229 tests and the determinism harness assume months.
4. **Patents.** They are not in the CapLab base game; Magnate has them. Keep them as a differentiator (I recommend yes), or make them optional so the game stays a strict replica?
5. **Land accounting.** Land held at cost in the books, with market value shown in net worth and valuation (my recommendation, which keeps the ledger invariant), or CapLab-style revaluation through "net profit"?
6. **Visual and economic scale split** (24 m per tile for visuals, 250 m for freight and catchment). Is that acceptable, or should the grids be enlarged (Metropolis to 128) so the two scales converge?
7. **Late-game antitrust.** Is it acceptable as a Magnate addition that goes beyond CapLab? It is the cleanest fix for snowball tedium.
8. **Target session length and speed.** 1 game month ≈ 20 s at 1× is proposed, which makes the first hour about 3 game years. Confirm with the user.

---

## 9. What I did not verify
- CapLab's exact internal formulas for demand allocation, traffic, the land-value update and stock pricing are not published. Where §4–§5 give formulas, they are [Design] reconstructions consistent with the documented behaviour and the Cap2 manual's rating and quality formulas.
- "Links are adjacent-only, including diagonals" comes from the grid UI's connectors and forum descriptions ("crossing pipes"), not from a formal statement.
- Reddit could not be read: the API returned 403 and the search tool is blocked for that domain. Player sentiment comes from Steam reviews, the fandom wiki and the official forum instead.
- **Line references may drift.** While this brief was being written, another workstream was adding `engine/Magnate.Bridge/` and `web/` and editing `engine/Magnate.Engine/Persistence/WorldSaver.cs` and `WorldLoader.cs`; the save schema was still v9. The `path:line` references into `Simulation/`, `Domain/`, `Economics/`, `Scenarios/` and `Ai/` were checked against files last modified on 2026-04-25. Re-check them if those files have changed since.

---

## 10. Sources

**Official site** (capitalismlab.com; 277 pages downloaded to the scratchpad and read as text):
- Beginners guide, gameplay basics: https://www.capitalismlab.com/beginners-guide-gameplay-basics/
- Land plots: https://www.capitalismlab.com/new-features/land-plots/
- City dynamics: https://www.capitalismlab.com/new-features/city-dynamics/
- Retail simulation enhancement: https://www.capitalismlab.com/new-content/retail-simulation-enhancement/
- Apartments and commercial buildings: https://www.capitalismlab.com/new-features/enhanced-sim-apts-commercial-bldgs/
- Inflation: https://www.capitalismlab.com/new-features/inflation/
- Macroeconomic simulation: https://www.capitalismlab.com/new-features/enhanced-macroeconomic-simulation/
- Community and sports facilities: https://www.capitalismlab.com/new-features/community-and-sports-facilities/
- Product class expertise: https://www.capitalismlab.com/new-features/product-class-expertise/
- Intangible asset, technology disruption and tech-focused AI: https://www.capitalismlab.com/new-features/intangible-asset-technology/, /technology-disruption/, /tech-focused-ai-companies/
- Headquarters: https://www.capitalismlab.com/improvements/headquarters/
- Natural resources: https://www.capitalismlab.com/improvements/natural-resources/
- Mini-map: https://www.capitalismlab.com/improvements/mini-map/
- Warehouse: https://www.capitalismlab.com/new-content/warehouse/
- Stock market enhancement: https://www.capitalismlab.com/new-content/stock-market-enhancement/
- Banking and Finance DLC pages: https://www.capitalismlab.com/banking-dlc/ (bank-loans, corporate-bonds, special-dividends, stock-split, venture-capitalists, realistic-money-supply, sovereign-bonds, bank-capital-requirements, bank-deposits, make-investments-opm)
- Acquiring companies facing bankruptcy: https://www.capitalismlab.com/acquire-companies-facing-bankruptcy/
- Subsidiary DLC pages: https://www.capitalismlab.com/subsidiary-dlc/ (IPO, merging, set-new-subsidiary, subsidiary-control, privatization, subsidiary-financial-management, mass-transfer-firms, radical-rd-unit, multiple-floors-system-retail-stores)
- City Economic Simulation DLC pages: https://www.capitalismlab.com/ces-dlc/ (new-minimap-modes, landmarks, build-new-city, government-mode, city-competitiveness-ratings, general-store, forced-firm-relocation, ultra-realistic-city-economic-simulation)
- Increasing GDP growth: https://www.capitalismlab.com/increase-gdp-growth/
- New cities will emerge: https://www.capitalismlab.com/new-cities-will-emerge/
- Service Industry DLC pages: new-apartments-commercial-buildings, apartment-retail-space, shopping-mall, import-company, export-company, logistics-company, import-strategy, service-firms, knowledge-points, built-advertising-unit
- Experimental DLC: farm-extension, farm-equipment, industry-expertise-only
- Media and real-estate guide: https://www.capitalismlab.com/media-real-estate-guide/
- Real estate empire: https://www.capitalismlab.com/resources/building-real-estate-empire/
- The Shanghai evolution: https://www.capitalismlab.com/resources/the-shanghai-evolution/
- Goals guide: https://www.capitalismlab.com/goals-guide/
- Script reference (goal values, environment, cities, products): https://www.capitalismlab.com/scripts/ (script-goals/script-goal-values, script-environment, script-cities, script-products)
- Advanced modding (buildings, adding new buildings, cities, products, manufacturing, farming, natural resources): https://www.capitalismlab.com/mod/advanced-modding/
- High-priced products: https://www.capitalismlab.com/high-priced-products/
- Strategies for market domination: https://www.capitalismlab.com/strategies-market-domination/
- Version notes: https://www.capitalismlab.com/version100/, /version110/, /version120/
- Custom music: https://www.capitalismlab.com/add-custom-music/

**Capitalism II manual** (Steam CDN): https://cdn.cloudflare.steamstatic.com/steam/apps/638200/manuals/Cap2_manual.pdf. Used for the unit table and level tables, store, factory, farm, resource, R&D, HQ and real-estate costs, the rating formula, the quality formula, the stock-market and finance chapter, the score, and AI personality.

**Capitalism Lab fandom wiki** (read through the MediaWiki API): https://capitalismlab.fandom.com/wiki/ pages Beginners_Tips, Manufacturing, Marketing, Retail, Seaport, Price_Agreement, Private_labeling, Freight_Charge_Analysis, Scenario_Games, and product pages (Bread, Cola, Car, Mobile_phone, Television, Jeans, Wine, Cigarettes, Toothpaste, Shampoo, Sofa, Bed, Desktop_computer, Smart_phone, Ice_cream, Canned_soup, Bottled_milk, Cookies, Perfume, Gold_Ring, Steel, Plastic, Flour, Textiles, Electronic_components, Glass).

**Official forum** (capitalism2.com):
- Layout best practices: t=10275
- Basic layouts: t=945
- Retail capacity: t=5589
- Import quality: f=10&t=929
- Primary products: t=4643
- Dividends and stock price: t=5086
- Stock market improvements: f=10&t=1318
- B2C/B2B profitability: f=39&t=8260

**Steam reviews** of Capitalism 2 (app 638200), read through the appreviews API on 2026-09-30: 336 English reviews.

**Local sources:** `docs/research/capitalism-reference.md`, `docs/design/gameplay-and-modernisation.md`, `docs/HANDOVER.md`, `docs/plan/build-plan.md`, `engine/Magnate.Engine/**`, `content/**`, `client/assets/audio/**`.

**Probe harness:** `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/caplab-brief/harness/Probe/Program.cs` (experiments E1–E7).
