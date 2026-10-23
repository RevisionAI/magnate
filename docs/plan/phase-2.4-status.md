# Phase 2.4 — Smarter AI (AdaptiveStrategy)

**Goal**: make the AI use the levers built in 2.2 / 2.3 / 2.5 (price, R&D, ads) instead of sitting passively as a one-trick retailer. After this phase the AI competes meaningfully with a human using the full toolkit.

## Delivered

### Three new action types (`AiAction.cs`)

```csharp
record AdjustRetailPriceAction(BuildingInstanceId Retailer, int SlotIndex, decimal NewPrice);
record BuildResearchCenterAction(CityId City, ProductId InitialResearch);
record SetAdCampaignAction(ProductId Product, CityId City, AdChannel Channel, decimal MonthlyBudget);
```

Each is an `AiAction` subclass; `Execute(World, CompanyId)` applies the move through the public World API. All guard against bad state (wrong owner, missing slot, etc.) by silently no-op-ing.

### `AdaptiveStrategy` — the new default AI

Each monthly plan returns three categories of actions:

**1. Continuous price adjustments** — iterate every owned retail slot, compare its price to `min(competitor price) × 0.95` with a floor at `worldPrice × 1.05`; emit an `AdjustRetailPriceAction` if it differs by ≥ $0.01. This makes the AI responsive to new entrants and stable against price wars (won't undercut below wholesale).

**2. Ad campaign adjustments** — for every `(city, product)` the AI serves:
- If the market is contested (another owner has a retailer there), target `AdBudgetPerCity` ($50k/mo TV default)
- If monopoly (no competitor), target 0 — spending on brand in an uncontested market is pure waste
- If cash cushion inadequate (below `AdBudgetPerCity × 6`), target 0

**3. One expansion action per month**:
- Biggest unserved `(city, finished-product)` demand gets a new retailer (same scoring as `SimpleRetailerStrategy`)
- Once retail is saturated, build an R&D center in the AI's first city, targeting its top-revenue product

All iterations use ordinal sorting (by `CompanyId.Value`, then `CityId.Value`, then `ProductId.Value`, then `BuildingInstanceId.Value`) for determinism.

### Tests (10 new — total 98 passing)

Retail:
- `AdaptiveStrategy_builds_retail_on_first_tick`
- `AdaptiveStrategy_builds_research_center_once_retail_is_saturated` (22 months, $200M)

Ads:
- `AdaptiveStrategy_starts_tv_ads_in_contested_markets`
- `AdaptiveStrategy_does_not_advertise_in_monopoly_markets` ← the key optimization
- `AdaptiveStrategy_skips_ads_when_cash_cushion_inadequate`

Pricing:
- `AdaptiveStrategy_undercuts_existing_competitor`
- `AdaptiveStrategy_floors_price_at_wholesale_markup_even_with_aggressive_competitor`
- `AdaptiveStrategy_reprices_existing_slots_when_a_new_competitor_arrives`

Head-to-head + determinism:
- `AdaptiveStrategy_competes_successfully_against_SimpleRetailerStrategy` (18-month H2H, both profitable, adaptive within 2× of simple)
- `AdaptiveStrategy_is_deterministic`

### Cockpit — RivalCo swapped to AdaptiveStrategy

| | Phase 2.5 (SimpleRetailerStrategy) | Phase 2.4 (AdaptiveStrategy) |
|---|---|---|
| RivalCo Metropolis soft_drink price | $1.71 | **$1.71** (still undercuts) |
| RivalCo brand in Metropolis | 0 | **73.7** |
| RivalCo brand in Riverside | 0 | **65.6** |
| RivalCo brand in monopoly markets | 0 | **0** (correctly avoids waste) |
| RivalCo soft_drink revenue | $36.22M | **$44.13M** (+22%) |
| RivalCo marketing spend on soft_drink | $0 | **$0.9M** |
| Acme total revenue | $64.70M | **$56.38M** (–13%) |
| Acme NetIncome | $13.59M | **$12.08M** |

RivalCo reclaimed ~$8M of soft-drink revenue by countering Acme's brand with its own targeted campaigns. Acme's previous dominance is now contested.

### New invariant

22. **Adaptive AI is deterministic.** All iteration and decision paths use ordinal sorting; a given seed and scenario always produces the same outcome.

## Out of scope (future work)

- **Multiple personality variants** — only `AdaptiveStrategy` exists. Premium-brand / cost-cutter / vertical-integrator archetypes are Phase 2.4.1.
- **Multi-slot supermarkets** — adaptive still builds one supermarket per (city, product) instead of filling free slots in existing stores.
- **Factory/chain building by the AI** — still pure retailer; Phase 2.4.2 can teach the AI to chase vertical integration when it's cheaper than world-market restocking.
- **Budget-sizing by expected ROI** — adaptive uses a flat $50k ad budget. A smarter version would size budget by (demand × elasticity × margin).
- **Repricing cadence dampening** — today's reprice triggers on any $0.01 change, which in multi-AI games may create high-frequency oscillation. A minimum-delta threshold would fix it.

## Files

Added:
- `engine/Magnate.Engine/Ai/AdaptiveStrategy.cs`
- `engine/Magnate.Engine.Tests/AdaptiveAiTests.cs`
- `docs/plan/phase-2.4-status.md`

Modified:
- `engine/Magnate.Engine/Ai/AiAction.cs` (three new action subclasses)
- `tools/MagnateSim/Program.cs` (RivalCo uses AdaptiveStrategy)
