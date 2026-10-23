# Phase 3.48 — TechLeader AI archetype

## Summary

Added a fourth AI strategy `TechLeader` alongside `SimpleRetailerStrategy`,
`AdaptiveStrategy`, and `VerticalIntegrator`. Where VI wins on cost and Adaptive
plays a balanced four-lever game, TechLeader bets entirely on Quality + Tech +
Brand on a single hero product, accepting premium retail prices.

## Hero-product selection

Deterministic rule:

```
catalog.Products.Values
    .Where(p => p.Tier == ProductTier.Finished)
    .OrderByDescending(p => p.BaseWorldMarketPrice)
    .ThenBy(p => p.Id.Value, StringComparer.Ordinal)
    .First()
```

On the canonical 7-finished-good catalog (soft_drink, bread, t_shirt,
television, car, beer, coffee_drink) this resolves to **`car`**
(BaseWorldMarketPrice = 18000.0). Pinned for the lifetime of the strategy
instance via a `_hero` cache field.

## Behaviors

1. R&D coverage: ensures `RdCentersTarget` (default 2) R&D centers on the hero,
   building in the densest unoccupied city first.
2. Premium pricing: hero retail price = `1.30 × competitor.Max()`, floored at
   `1.10 × own COGS` (or `1.10 × world wholesale` if no COGS yet).
3. Brand investment: 80k/month TV ad campaigns on the hero in every city where
   it owns a hero retailer — contested or not.
4. Disciplined retail: only enters cities with `Demographics[High] ≥ 0.25`,
   capped at 2 retailers/city × 3 cities total.
5. No upstream chain — buys raws via the world market.

## Switch sites wired

- `ScenarioRunner.CreateStrategy` — `"techleader" or "tech"`
- `WorldSaver.StrategyName` — `TechLeader => "techLeader"`
- `WorldSaver.StrategyConfig` — emits all 7 tunables
- `WorldLoader.CreateStrategy` + new `BuildTechLeaderStrategy` helper

## Tunables

`RdCentersTarget=2`, `MaxRetailersPerCity=2`, `MaxCities=3`,
`PremiumMultiplier=1.30`, `PriceFloorMultiplier=1.10`,
`AdBudgetPerCityHero=80_000`, `MinHighBracketShare=0.25`.

## Verification

- `dotnet build` — succeeded, 0 warnings, 0 errors.
- `dotnet test` — 191/191 pass (185 prior + 6 new TechLeader tests).
- Tests cover: hero selection, R&D-first behavior, premium pricing,
  ad campaigns, save/load round-trip with non-default tunables, determinism.
