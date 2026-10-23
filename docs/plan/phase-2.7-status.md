# Phase 2.7 — Scenarios & goals

**Goal**: turn the simulation from a sandbox into a game. Scenarios define starting conditions (player + AI roster), optional end dates, and victory goals. The engine evaluates goals against current world state so the client (or cockpit) can show progress and declare victory.

## Delivered

### `Magnate.Engine.Scenarios` namespace

| Type | Responsibility |
|---|---|
| `Scenario` (record) | Immutable description: id, name, dates, player, AIs, goals |
| `ScenarioPlayer`, `ScenarioCompany` | Player + AI roster entries |
| `Goal` (abstract record) + concrete `CorporateValueGoal`, `MarketShareGoal` | Win conditions; each has an `Evaluate(World, player)` that returns a `GoalEvaluation` |
| `GoalEvaluation` | `(Description, Achieved, Progress, Detail)` — progress is a capped 0..1 ratio for UI bars |
| `ScenarioLoader` | JSON → `Scenario` (plus a `LoadAll(dir)` helper) |
| `ScenarioRunner` | `Apply(catalog, scenario, seed)` creates a fresh World, companies, and registers AIs by strategy name. `EvaluateGoals(...)` computes current status across all goals |

### New world helper — `GetMarketShare`

```csharp
double World.GetMarketShare(CompanyId company, ProductId product, CityId city)
```

Replays the demand-allocation softmax (prices × Q × T × B, weighted by product elasticity) to return a company's theoretical market share in a `(city, product)` market. Returns 0 if nobody retails that product there, 1 when it's a monopoly. Used by `MarketShareGoal` to be queryable at any tick without waiting for a sale to happen.

### Seed scenarios — `content/scenarios/`

1. **`sandbox.json`** — no goals, just Acme vs RivalCo forever
2. **`soft_drink_war.json`** — 5-year deadline, two rivals (adaptive + simple), goal: 55% soft_drink share in Metropolis + $60M corporate value
3. **`first_hundred_million.json`** — 5-year deadline, $100M corporate value with a heavily-funded BigCo adaptive rival

### Cockpit additions

```bash
magnate-sim --scenario <id> [months] [--auto-player] [--seed N]
```

- Loads the scenario, runs for `months` (capped by `endDate` if set)
- Prints player summary + goal status with progress bars
- `--auto-player` registers the player company with `AdaptiveStrategy` so cockpit demos show real competition

Example output after 36-month auto-played `soft_drink_war`:
```
────────── Goal status ──────────
  [ ] Reach 55% share of soft_drink in Metropolis
      [███████████████░░░░░]  42.0% / 55.0%
  [ ] Reach $60M corporate value
      [████████████░░░░░░░░]  $35,604,609 / $60,000,000
```

### Tests (12 new — total 110 passing)

Loading + runner:
- `All_seed_scenarios_load`
- `Sandbox_has_no_goals`
- `Soft_drink_war_has_market_share_and_value_goals`
- `Runner_creates_player_and_ai_competitors`
- `Runner_sets_world_clock_to_scenario_start`

Market-share computation:
- `Market_share_is_zero_in_city_with_no_retailers`
- `Market_share_is_one_when_only_retailer`
- `Market_share_reflects_softmax_weights_not_just_retailer_count` ← tech + brand advantage correctly translates to share

Goal evaluation:
- `Corporate_value_goal_achieved_when_assets_cross_threshold`
- `Market_share_goal_achieved_at_monopoly`
- `Goal_progress_reports_ratio_before_achievement`

End-to-end:
- `Scenario_run_advances_goals_over_time` — load → apply → advance months → evaluate

### New invariant

23. **Goal evaluation is read-only and deterministic.** `Goal.Evaluate` never mutates world state; `GetMarketShare` reads current retailer inventory/prices and applies the same softmax formula as `AllocateDemandAndSell`.

## Out of scope (future)

- **More goal types**: `RivalBankruptGoal`, `NetIncomeGoal`, `PortfolioValueGoal`, `TechMaxedGoal`. Easy additions — each is a small `Goal` subclass with its own evaluation.
- **Scenario JSON Schema** — currently only semantic validation in the loader (missing ids throw). A formal `content/schemas/scenario.schema.json` would catch malformed files earlier.
- **Scenario events / random events** — Cap2 has scripted events (recessions, tech breakthroughs). Phase 3 fits better.
- **Pre-built buildings for player** — scenarios currently start the player at zero buildings; a `preBuiltBuildings` list could give authored starts (e.g., "you already have a Metropolis soft-drink chain").
- **End-of-scenario summary in the client** — the cockpit shows a one-shot verdict. An interactive client would tick goals monthly and announce the win immediately.

## Files

Added:
- `engine/Magnate.Engine/Scenarios/Goal.cs`
- `engine/Magnate.Engine/Scenarios/Scenario.cs`
- `engine/Magnate.Engine/Scenarios/ScenarioLoader.cs`
- `engine/Magnate.Engine/Scenarios/ScenarioRunner.cs`
- `engine/Magnate.Engine.Tests/ScenarioTests.cs`
- `content/scenarios/sandbox.json`
- `content/scenarios/soft_drink_war.json`
- `content/scenarios/first_hundred_million.json`
- `docs/plan/phase-2.7-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/World.cs` (adds `GetMarketShare`)
- `tools/MagnateSim/Program.cs` (scenario mode + `--auto-player` + goal progress bars)
