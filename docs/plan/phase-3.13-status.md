# Phase 3.13 — Four new goal types + showcase scenario

**Goal**: expand scenario design space by adding four new victory-condition primitives (cumulative net income, top-brand, cumulative export revenue, consecutive profitable months) and ship one showcase scenario — `monopolist` — that uses three of them.

## Delivered

### New goal types (`engine/Magnate.Engine/Scenarios/Goal.cs`)

| Goal type | Loader keys | Fields |
|---|---|---|
| `NetIncomeSinceStartGoal` | `netIncome` / `net_income` | `StartDate` (stamped by loader), `Amount` |
| `TopBrandGoal` | `topBrand` / `top_brand` | `Product`, `City`, `Threshold` (0..100 scale) |
| `ExportRevenueGoal` | `exportRevenue` / `export_revenue` | `StartDate` (stamped), `Amount` |
| `ConsecutiveProfitableMonthsGoal` | `consecutiveProfitable` / `consecutive_profitable` | `Months` |

All four follow the existing pattern: `abstract record Goal` subclass returning a `GoalEvaluation(description, achieved, progress 0..1, detail string)`. Evaluators are read-only — they call `World.GetIncomeStatement`, `World.GetBrandAwareness`, and `World.Ledger.EntriesInRange` (filtered on `LedgerCategory.ExportSale`). The per-month streak counter in `ConsecutiveProfitableMonthsGoal` walks backward from `world.Clock.Now`, stopping at the first non-positive month; the walk is bounded (`4 × months`, min 1200) so a misconfigured goal can't loop forever.

### ScenarioLoader (`engine/Magnate.Engine/Scenarios/ScenarioLoader.cs`)

- Extended `ToGoal` switch with four new cases.
- Added `decimal? Amount` to `GoalDto` for NetIncome / Export targets. Existing `Threshold`, `Product`, `City`, `Months` are reused.
- Existing six goal types and every existing scenario continue to parse unchanged.

### Showcase scenario — `content/scenarios/monopolist.json`

**Pitch**: build a soft-drink empire that wins on brand, exports, sustained profitability, and balance-sheet capstone.

| Goal | Type | Threshold |
|------|------|-----------|
| 70 brand awareness for soft_drink in Metropolis | topBrand | 70.0 |
| $8M cumulative export revenue | exportRevenue | $8,000,000 |
| 24 consecutive profitable months | consecutiveProfitable | 24 |
| $50M corporate value | corporateValue | $50,000,000 |

- **Start**: 2026-01, **End**: 2031-12 (72 months)
- **Player cash**: $25M
- **AI**: FizzCorp (adaptive, $40M) — deliberately overfunded to force brand investment
- **Strategic question**: three of the four goals pull you in different directions. Retail + advertising drives brand and the 24-month streak, but exports require building standalone farms/mines whose surplus ships at world-market price — a deliberate capital detour that the naive expansion path doesn't include.

## Playtest observations — seed 42, 72-month run, adaptive auto-player

```
[✓] Reach 70 brand awareness (soft_drink, metropolis)   99.7 / 70.0
[ ] Bank $8M cumulative export revenue                  $0 / $8,000,000
[✓] 24 consecutive profitable months                    24 / 24
[✓] $50M corporate value                                $51.9M / $50M
```

Three-of-four achieved by the auto-player. The export goal is the deliberate "hard goal that requires specific player action" — the adaptive AI builds retail broadly, configures factories that feed that retail, and never stands up a pure-export extraction building. A human will need to allocate capital to a large_farm or mine and let its surplus auto-export.

Corporate-value capstone is tight: the auto-player clears it by +$2M at 72 months and +$0.5M at 60 months. A human who focuses on margins rather than footprint should clear it with room; a passive player scrapes by.

Brand awareness overshoots massively (99.7 vs 70) because the auto-player floods ads across all cities. If we want the brand goal to actually bite, we'd need to raise the threshold to ~90 or city-gate it differently — but 70 keeps it approachable for the narrative "become a household name" and isn't supposed to be the hard goal.

## Build status

- `dotnet test engine/Magnate.Engine.Tests` → **141 total, 135 passing, 6 failing**. The 6 failures are in `AiTests.cs` / `AdaptiveAiTests.cs` (AI subsystem), touch files I don't own, and the error messages (bread → coffee_drink substitution, pricing thresholds, R&D-build logic) are unrelated to goal definitions. Other agents are actively working on the AI area per phase 3.13 scope notes.
- Scenario-only subset: `dotnet test --filter "FullyQualifiedName~ScenarioTests"` → **27 / 27 passing** (21 pre-existing + 6 new).
- `dotnet run --project tools/MagnateSim -- --scenario monopolist 72 --auto-player` → loads and runs cleanly.

## Tests added (`engine/Magnate.Engine.Tests/ScenarioTests.cs`)

```
NetIncomeSinceStartGoal_tracks_cumulative
TopBrandGoal_triggers_at_threshold
ExportRevenueGoal_tracks_cumulative
ConsecutiveProfitableMonthsGoal_counts_streak
Monopolist_scenario_loads_with_expected_goal_types
Monopolist_scenario_runner_applies_cleanly
```

The export test uses a `large_farm` with a sugarcane extraction slot and AutoExport on — the farm ships surplus at world-market price every tick, producing `ExportSale` ledger entries directly. No need to stage inventory manually.

## Threshold choices — why these numbers

- **70 brand** in Metropolis — the flagship market; 70 is the "household name" band on the 0..100 awareness scale. Auto-player hit 99+ so this is approachable.
- **$8M export revenue** — at world-market price, a single `large_farm` of sugarcane exports roughly $3–5k/month; a dedicated export farm of a mid-tier raw like iron ships ~$20–30k/month. $8M over 72 months implies an average ~$110k/month of exports, i.e. a deliberate 3–4 standalone-producer investment. Not trivial but not bank-breaking.
- **24 consecutive profitable months** — two calendar years. The auto-player clears this because a well-configured retail chain is structurally profitable once it fills; the goal exists to punish scenarios where the player over-leverages on construction.
- **$50M corporate value** — auto-player grazes it at $51.9M at month 72. A focused human strategy (margins, exports) should clear $55–65M.

## Files

Added:
- `content/scenarios/monopolist.json`
- `docs/plan/phase-3.13-status.md`

Modified:
- `engine/Magnate.Engine/Scenarios/Goal.cs` (4 new goal subclasses + `using Magnate.Engine.Economics;`)
- `engine/Magnate.Engine/Scenarios/ScenarioLoader.cs` (4 new switch cases, `Amount` added to `GoalDto`)
- `engine/Magnate.Engine.Tests/ScenarioTests.cs` (6 new tests under `// Phase 3.13 goals` header)

## Out of scope (future)

- **Per-month net income goal** — `NetIncomeSinceStartGoal` is cumulative. A monthly run-rate variant ("sustain $500k/month over the last quarter") would let a scenario demand "scale efficiency" rather than "endurance".
- **Brand-differential goal** — "reach brand awareness X and stay ahead of all rivals by Y". The current `TopBrandGoal` is absolute, not relative.
- **Per-city export goal** — `ExportRevenueGoal` is company-wide; a city-scoped variant would let scenarios reward industrial specialization ("become Portbay's export backbone").
