# Phase 1.4 — Minimum viable AI

**Goal**: a competitor that observes the world, decides actions, and visibly contests the player. The simulation stops being a single-player sandbox.

## Delivered

### New `Magnate.Engine.Ai` namespace

| Type | Responsibility |
|---|---|
| `IAiStrategy` | Interface: given `(World, CompanyId)`, returns a list of actions to execute this month. Pure — strategies must not mutate the world directly. |
| `AiAction` (abstract record) | Discriminated base for AI moves; concrete actions implement `Execute(World, CompanyId)` |
| `BuildRetailerAction` | Concrete: construct a retail building + configure first slot with product, price, restock target |
| `SimpleRetailerStrategy` | MVP utility AI: scout biggest unmet demand, undercut competitors, size restock to expected market share |

### Engine wiring

- `World.RegisterAi(companyId, strategy)` registers a strategy for a company.
- `World.AdvanceMonth()` now calls `RunAiDecisions()` **before** the monthly tick — strategies plan against current state, then their actions execute, then the tick simulates the month.
- AI strategies run in `CompanyId` order so multiple AIs are deterministic.

### `SimpleRetailerStrategy` algorithm

1. Enumerate `(city, finished-product)` pairs the AI does not yet serve.
2. Sort by total city demand, pick biggest.
3. Affordability check: skip if cash below `construction + 6 months opex`.
4. Pricing: undercut cheapest competitor by 5%, with a wholesale + 5% floor; if no competitors, charge wholesale × 1.20.
5. Restock target: `demand × expectedShare × 1.2` where `expectedShare = 1 / (existingRetailerCount + 1)` — sized to actual share the softmax will give us, not raw demand.
6. Emit one `BuildRetailerAction`.

This ships one supermarket per month per AI until all finished-product markets in the city are covered.

### Tests (7 new — total 32 passing)

- `Ai_builds_a_supermarket_on_first_month`
- `Ai_targets_the_biggest_unmet_demand_first` (bread, the largest market)
- `Ai_undercuts_an_existing_competitor_price`
- `Ai_eventually_serves_multiple_products_over_several_months`
- `Ai_skips_action_when_cushion_unaffordable` (broke company can't expand)
- `Player_and_ai_split_the_market_when_both_sell_same_product`
- `Ai_decisions_are_deterministic_for_same_seed`

### Cockpit upgraded

`magnate-sim` now registers a `RivalCo` AI competitor alongside Acme and reports both companies' net + cash month by month, plus a final standings block.

## What the cockpit revealed (and why it matters)

Running 12 months with the new scenario, RivalCo ends at **$176M cash** vs Acme's $33M. That's not because the AI is overpowered — it's because the seed content overstates per-capita demand for cars (0.03/month at high income → 36% of high earners buy a car each year) and TVs (0.08/month at high income → 96% per year).

The AI uncovered this immediately because it expands into uncontested markets while a human would stay in the soft-drink chain we wrote the demo for. **This is exactly the use the AI was supposed to deliver** — a stress test the human won't run by hand.

**Phase 2 balance pass should** halve `baseDemandPerCapita` for high-priced durables (car, TV) by ~5-10× to land at realistic annual purchase rates.

## Out of scope (future phases)

- **Repricing existing slots**: AI sets price at construction time and never adjusts. A real AI watches market share and reprices monthly.
- **Building factories**: AI is pure retailer; restocks from world market. Phase 1.5+ adds vertical-integration AI.
- **Multi-slot supermarkets**: AI builds a new supermarket per product, ignoring spare slots in existing buildings.
- **Targeting weak competitors**: AI doesn't pick fights with the smallest player; it just chases biggest demand.
- **Cash defense / bankruptcy**: cash can go negative; nothing stops a runaway loss.
- **Multiple personalities**: only `SimpleRetailerStrategy` exists. Phase 2 adds aggressive expander, niche specialist, financier, etc.

## New invariant

9. **AI decisions are deterministic for a given seed and game state.** Strategies iterate cities and products in ordinal order; tie-breaking on demand uses LINQ's stable sort.

## Files

Added:
- `engine/Magnate.Engine/Ai/IAiStrategy.cs`
- `engine/Magnate.Engine/Ai/AiAction.cs`
- `engine/Magnate.Engine/Ai/SimpleRetailerStrategy.cs`
- `engine/Magnate.Engine.Tests/AiTests.cs`
- `docs/plan/phase-1.4-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/World.cs` (RegisterAi + AdvanceMonth wiring)
- `tools/MagnateSim/Program.cs` (RivalCo competitor + dual-company reporting)
