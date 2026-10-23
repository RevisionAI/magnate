# Magnate: Gameplay, Visual Language, and Modernisation

This document describes the presentation-ready prototype as it exists today. It is intentionally explicit about the boundary between implemented simulation and future ambition so playtesters and potential users are not shown a promise disguised as a feature.

## Product Position

Magnate is a modern business strategy game inspired by the systems breadth of the Capitalism lineage. Its identity is not a screen-for-screen replica. The prototype keeps the useful strategic ideas - city demand, retail pricing, multi-tier supply chains, brand, R&D, patents, accounting, and competing firms - while replacing the dated window-heavy experience with a legible command center, contextual guidance, and original visual assets.

The intended player fantasy is: **read a market, commit capital, build an operating system, and watch the consequences compound**.

## The Playable Loop

1. **Choose an operating challenge.** Scenarios define starting capital, rivals, time horizon, and measurable goals. Each scenario is presented as a strategic fantasy: retail operations, market power, vertical integration, logistics, or innovation.
2. **Scout a city-product market.** Population and income brackets determine the addressable demand. Market Intel shows active competitors, prices, estimated share, and entry opportunities.
3. **Deploy capital.** The player constructs retail, production, extraction, warehouse, media, or R&D buildings. Construction reduces cash immediately and adds a building asset.
4. **Configure operating slots.** A building only creates value when its slots have products and operating targets. Retail needs price and restock targets; factories need recipes; warehouses need target stock; R&D needs a research product.
5. **Advance the monthly simulation.** The world charges costs, runs research and advertising, produces goods, restocks inventory, allocates demand, exports surplus, settles royalties, and rolls events.
6. **Read the results.** Financial statements, per-product profitability, building P&L, market share, trends, and the activity feed reveal what worked.
7. **Iterate.** Reprice, add brand spend, integrate upstream, improve technology, upgrade facilities, enter another city, or retreat from a weak market.

The command center now generates a live executive priority from the company state. It identifies first-revenue needs, idle facilities, missing retail, operating losses, absent advertising, missing R&D, or a mature position ready to scale.

## Monthly Tick Order

The simulation is deterministic and advances one month at a time. The order is strategically important:

1. Advance the date.
2. Charge building operating costs.
3. Apply R&D progress and patent blocking.
4. Apply advertising spend, awareness lift, and brand decay.
5. Extract raw materials.
6. Produce intermediate goods.
7. Produce finished goods.
8. Restock warehouses.
9. Restock retailers.
10. Allocate consumer demand and book sales.
11. Auto-export eligible surplus.
12. Settle patent royalties.
13. Expire market effects and roll a possible news event.

Because production runs before retail restocking, a vertically integrated chain can supply stores in the same tick. Events are applied last, so a newly reported commodity shock changes the following month's procurement and export prices rather than rewriting transactions already booked.

## Demand and Competitive Choice

Demand is evaluated per **city, finished product, and income bracket**. Each product defines base demand per capita and price elasticity. Cities define population and the share of low-, middle-, and high-income consumers.

Retail offerings compete using four levers:

- **Price:** lower price increases the offer's weight according to product elasticity.
- **Quality:** inventory carries an average quality value. World-market goods begin at a neutral quality baseline; self-produced quality rolls forward from input quality.
- **Technology:** each company has a technology level per product. In consumer choice it contributes on a ten-point-per-level scale.
- **Brand:** awareness is tracked per company, product, and city. It must be rebuilt when entering a new city.

The current allocator calculates desirability from quality, technology, and brand, then divides that desirability by price raised to elasticity. Reservation prices can exclude an offering from an income bracket entirely. Available inventory caps actual units sold, so theoretical demand does not become revenue when shelves are empty.

## Supply Chains and Inventory

Products occupy one of three tiers:

- **Raw:** extracted by farms, plantations, mines, wells, and similar facilities.
- **Intermediate:** manufactured inputs such as flour, steel, plastic, fabrics, or electronic parts.
- **Finished:** consumer products sold through retail.

Recipes specify input quantities and output quantity. Each configured production slot can run up to 200 recipe cycles per month, subject to input availability. Procurement searches the company's own network before buying from the world market. Inter-city internal movement adds a shipping charge equal to 10% of the product's world-market value.

Inventory uses weighted-average cost. Input cost therefore follows a product through the chain and is recognised as COGS when units leave inventory. Internal transfers do not book artificial revenue. Vertical integration improves economics only when it genuinely lowers input cost, improves quality, protects availability, or captures downstream margin.

Warehouses maintain target stock. Retail slots restock toward their own target. High targets improve service levels but trap more cash in inventory; low targets preserve capital but risk stock-outs.

## Brand, Media, and Advertising

Advertising campaigns are scoped to company, product, city, and channel. The implemented channels are TV, radio, newspaper, and magazine. Budget buys awareness according to channel cost-per-point, with diminishing practical value near the 100-point cap.

Awareness decays by 2% per month without active support. Owning matching media in a city improves effective reach: broadcast ownership provides a 35% multiplier, while print ownership provides 25%.

This creates several valid strategies: launch narrowly and dominate one city, own media to reduce long-run acquisition cost, or spread small budgets across cities at the cost of weaker local brand power.

## R&D, Technology, and Patents

Every product begins at technology level 1 and defines its own maximum. One R&D slot produces 100 research points per month. The threshold for the next level scales with the current level, so level 1 to 2 takes 100 points while level 9 to 10 takes 900.

The first company to reach a product's maximum level can receive a 24-month patent. An active rival patent blocks unlicensed R&D on that product. Patent holders may license competitors; licensees pay 5% of patented-product sales and export revenue as royalties.

Technology is therefore a compounding commitment rather than a one-click upgrade. A company can race for exclusivity, license its advantage, or avoid the contested category and redirect R&D elsewhere.

## Finance and Accounting

The implemented financial model includes:

- Cash ledger with attributed transaction categories.
- Construction and upgrade capital expenditure.
- Building operating expense.
- Product sales and export revenue.
- Weighted-average inventory cost and COGS.
- Advertising expense and patent royalties.
- Income statements across arbitrary date ranges.
- Balance sheet values for cash, inventory, buildings, liabilities, and equity.
- Product and building profitability views.
- Corporate-value history composed from cash, inventory, buildings, and trailing earnings.

Debt, IPOs, stock trading, acquisitions, dividends, banking, real estate, and subsidiaries are part of the longer-term product direction but are not presented as implemented prototype mechanics.

## AI and Events

Scenarios can combine four AI archetypes:

- **Simple retailer:** accessible entry-level competitor.
- **Adaptive:** balances pricing, expansion, advertising, and research.
- **Vertical integrator:** constructs upstream supply before pushing into retail.
- **Technology leader:** concentrates research and brand around premium products.

At most one random event can fire per month, behind a 20% global probability gate. Current events include commodity price shocks, brand shifts, and headlines. Effects are deterministic under the world seed and are persisted in the news log.

## Scenario Structure and Victory

The prototype includes 16 scenarios. Goals can measure building ownership, product availability, elapsed time, market share, corporate value, cumulative net income, brand awareness, exports, advertising, or consecutive profitable months. Progress is visible before completion, allowing the player to understand how far a strategy is from succeeding.

Sandbox has no forced ending. Scenario play provides a clearer demonstration experience because it creates a specific operating problem and a measurable finish line.

## Original Visual Asset System

All game illustrations are original generated assets; they do not reuse Capitalism or Capitalism Lab artwork, logos, or screenshots.

### Foundation art

| Asset | Use |
|---|---|
| `client/assets/ui/title_empire.png` | Title-screen city, port, retail, and industry panorama |
| `client/assets/ui/operations_room.png` | Main command center and operating screens |
| `client/assets/ui/city_economy.png` | City map, territory overview, and diversified sandbox framing |

### Business-system art

| Asset | Strategic meaning |
|---|---|
| `client/assets/systems/retail.png` | Consumer demand, shelf availability, pricing, and last-mile delivery |
| `client/assets/systems/manufacturing.png` | Recipe conversion, throughput, input cost, and finished output |
| `client/assets/systems/logistics.png` | Warehouses, seaports, rail, trucking, and network hand-offs |
| `client/assets/systems/research.png` | Technology progression, prototypes, R&D, and patents |
| `client/assets/systems/markets.png` | Market intelligence, brand, advertising, and financial analysis |

The system images share an isometric, management-game perspective with readable facility silhouettes and space reserved for translucent UI. The interface uses the images as strategic context on scenario cards, briefings, and the field guide rather than as arbitrary wallpaper.

## Modernisation Principles

1. **Context before controls.** A screen should explain the decision currently in front of the player before presenting a wall of buttons.
2. **Progressive disclosure.** The command center summarises; Market Intel and reports diagnose; building inspection handles detailed tuning.
3. **Live recommendations, not scripted hints.** Executive priorities are derived from the current world state.
4. **One visual language.** Original art, restrained dark operational chrome, gold strategic highlights, blue information, green positive economics, and red risk.
5. **Readable density.** The game remains information-rich, but metrics are grouped by question rather than exposed as raw engine state.
6. **Fast first value.** Starter Investments create configured facilities in one action so a new player can reach a meaningful monthly tick quickly.
7. **Truthful presentation.** Prototype screens and documentation distinguish implemented systems from future Capitalism-Lab-scale ambition.

## Presentation-Ready User Journey

For a short public demonstration, use **Tutorial - Your First Company** or **Soft Drink War**:

1. Show the title art and scenario showcase.
2. Open the scenario browser and explain that each card represents a different operating model.
3. Start the tutorial and point out the live executive priority.
4. Use Build & Operate to launch the Bread Aisle or Corner Store starter investment.
5. Advance three months and show cash, monthly income, and the current goal changing.
6. Open Market Intel to compare price and share.
7. Add advertising and show local brand awareness rising.
8. Open the building inspector and financial statements to demonstrate that every visible outcome is supported by inventory and ledger entries.

That sequence communicates the project's strongest current promise: broad business systems joined by a coherent, inspectable simulation.

## Next Product Milestones

The next high-value development work is not more isolated screens. It is a stronger integrated loop:

- Interactive city placement and land economics.
- A more visual slot-and-flow supply-chain editor with warnings and throughput overlays.
- Explicit quality improvement from technology and operations.
- Difficulty and sandbox setup controls before world creation.
- Debt, credit rating, IPO, stock market, and takeover systems.
- Labor, wages, managers, and productivity.
- Multi-year macroeconomic cycles and city growth.
- Automation policies for late-game portfolios.
- User playtesting, balance telemetry, and accessibility settings.

These additions should preserve the prototype's current strengths: deterministic simulation, data-driven content, ledger-backed reporting, and original presentation.
