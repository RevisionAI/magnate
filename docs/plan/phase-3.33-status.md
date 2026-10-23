# Phase 3.33 — Three New Scenarios

Status: **complete**. 3 new scenarios added; scenario count now 12.

## Deliverables

### `vertical_showdown.json` — Vertical Showdown (medium-hard)
- Theme: player with a shallow chain vs. a much richer rival; must out-manoeuvre, not outspend.
- Player $20M vs. ChainLink Industries $45M (adaptive). 60-month window, 48-month survival floor.
- Goals (6): `ownsBuilding` factory ≥ 1, `ownsBuilding` farm ≥ 1 (forces 2-tier chain), `productRetailed` television, `marketShare` television/metropolis ≥ 30%, `corporateValue` ≥ $35M, `elapsedMonths` ≥ 48.
- Tuning: TV share of 30% (below `tech_race`'s 35%) offsets lower starting cash; dual `ownsBuilding` goals create the vertical-integration pressure mechanically.

### `three_way_melee.json` — Three-Way Melee (hard)
- Theme: four-company brawl in Metropolis — the densest-demographic city.
- Player $25M vs. three adaptive AIs ($35M, $30M, $40M). 7-year window.
- Goals (4): `topBrand` soft_drink/metropolis ≥ 75, `marketShare` soft_drink/metropolis ≥ 40%, `consecutiveProfitable` ≥ 12 months, `corporateValue` ≥ $55M.
- Tuning: 40% share in a four-horse race is a plurality; brand 75 is harder than `monopolist`'s 70 because three rivals are advertising back.

### `coffee_monopoly.json` — Coffee Monopoly (niche vertical)
- Theme: plantation → roasted_coffee → coffee_drink chain plus exports; one mid-cash rival.
- Player $22M vs. BrewHaus $25M (adaptive). 48-month window.
- Goals (7): 2× `ownsBuilding` (plantation ≥ 2, factory ≥ 2), `productRetailed` coffee_drink, `marketShare` coffee_drink in metropolis ≥ 35% and eastside ≥ 30%, `exportRevenue` ≥ $4M, `netIncome` ≥ $10M.
- Tuning: cash parity with the AI forces the player to lean on export revenue and the two-city share to break ahead.

## Verification
- `dotnet run --project tools/ContentValidator --no-build` → **OK — no errors** (22 products, 16 building types, 5 cities).
- `jq .` on all three files → parses cleanly.
- `dotnet run --project tools/MagnateSim -- --scenario <id> 1` for each new id → loads, applies, simulates one month without error.
- Product ids verified: `television`, `soft_drink`, `coffee_drink`, `roasted_coffee`, `coffee_beans` all present in `content/data/products/`.
- City ids verified: `metropolis`, `eastside` present in `content/data/cities/`.
- Building categories verified: `farm`, `factory`, `plantation` all present in `content/data/buildings/production.json`.

## Finding for integrator
`engine/Magnate.Engine/Ai/VerticalIntegrator.cs` exists and has tests, but `ScenarioRunner.CreateStrategy` (line 37) only recognises `"adaptive"`, `"simple"`, `"retailer"` — the `"verticalIntegrator"` string is **not wired**. Using it in a scenario throws `InvalidOperationException` at apply time. Per phase spec the `vertical_showdown` scenario was supposed to reference `verticalIntegrator`; I substituted `"adaptive"` with $45M starting cash to preserve the "deeper pockets" dynamic. Flagging for the integrator: either add `"verticalintegrator" => new VerticalIntegrator()` to the `CreateStrategy` switch, or rename the spec.
