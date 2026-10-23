# Phase 3.6 — Tutorial scenario + live goal tips

**Goal**: onboard a new player. The feature set is deep (two gameplay menus, five report tabs, a building inspector, save/load) and without guidance a first-time player wouldn't know where to start. Phase 3.6 adds a scripted tutorial that leads them through the first session, plus a "current goal" tip panel on the Main HUD that's useful for *any* scenario with goals.

## Delivered

### Engine — 4 new Goal types

```csharp
OwnsBuildingOfCategoryGoal(description, category, count = 1)
ProductRetailedGoal(description, product)
AdCampaignActiveGoal(description, product)   // any city, any channel, budget > 0
ElapsedMonthsGoal(description, startDate, months)
```

Each computes `GoalEvaluation` (inherited contract) — descriptive text, boolean `Achieved`, 0..1 `Progress`, free-form `Detail`.

### ScenarioLoader extension

JSON now recognizes four new goal `type` discriminators: `ownsBuilding`, `productRetailed`, `adCampaignActive`, `elapsedMonths`. The `elapsedMonths` goal needs the scenario's start date to count ticks correctly — the loader threads `scenarioStart` through `ToGoal(...)` so each elapsed-months goal gets stamped with its scenario's kickoff date automatically.

`GoalDto` grows three new fields: `category`, `count`, `months`.

### New scenario — `content/scenarios/tutorial.json`

5 steps, each with a descriptive hint serving as the goal's `Description`:

| Step | Goal type | Trigger |
|---|---|---|
| 1 | `ownsBuilding` | Construct a supermarket |
| 2 | `productRetailed` | Configure a retail slot for soft_drink |
| 3 | `elapsedMonths` | Let 3 months pass (teaches Play button) |
| 4 | `adCampaignActive` | Start any TV/Newspaper/Magazine campaign for soft_drink |
| 5 | `corporateValue` | Reach $20M corporate value |

A single gentle AI (`LocalCo`, `SimpleRetailerStrategy`, $10M) provides mild competition so the player sees what a competitor looks like without getting crushed.

### Client — Tip Panel on Main HUD

A new `PanelContainer` between the Scenario label and the date. When `GameState.ActiveScenario` exists and has goals:

- **Body**: the first unachieved goal's description (auto-wrapped)
- **ProgressBar**: that goal's progress 0..1
- **Detail**: evaluation detail + "Step N of M"
- When every goal is achieved, shows "All goals achieved. You won!" with full bar.

Hidden for save-loaded games (no `ActiveScenario`) and for sandbox scenarios (no goals) — stays out of the way when there's nothing to hint.

Re-evaluated on every `UpdateHud()` call, so it refreshes on every tick (manual Advance or live Play) and every time you return from Manage/Reports/Inspector.

### Tests (5 new — total 125 passing)

```csharp
Tutorial_scenario_loads_with_five_goals
OwnsBuildingOfCategoryGoal_tracks_count
ProductRetailedGoal_triggers_when_any_retail_slot_added
AdCampaignActiveGoal_triggers_only_for_non_zero_budget
ElapsedMonthsGoal_counts_ticks_from_scenario_start
```

## Build status

- `dotnet build client` → **0 warnings, 0 errors**
- Engine: **125/125 tests passing**

## How the tutorial plays

```
Title → New Game → pick "Tutorial — Your First Company" → Start
  (Tip panel shows: Step 1 — build a supermarket)

Click Manage → Build tab → pick a city + Supermarket + soft_drink + $1.80 + 500,000 → Construct
  (Tip panel now shows: Step 2... wait — both the Step 1 and Step 2 goals
   are achieved at once because the first-slot configuration happens in the
   same click. Tip jumps to Step 3.)

Back to Main → click Play
  (Watch cash move; wait 3 months)
  (Tip panel advances to Step 4)

Manage → Campaigns → Start TV soft_drink $50k/mo → Apply
  (Tip panel advances to Step 5)

Continue playing (maybe construct more stores, start more campaigns)
  (Tip panel's progress bar tracks $X / $20M corporate value)

When you hit $20M → "All goals achieved. You won!"
```

## The non-tutorial benefit

The tip panel helps EVERY scenario now. Playing Soft Drink War shows the current priority goal — "Reach 55% share of soft_drink in Metropolis [██████████░░░░░░░░]" — without having to jump to the Reports scene's Goals tab. Players always know what they're chasing.

## Out of scope (future)

- **Scripted popups** with highlighted buttons / arrows pointing at UI elements. The current tip is text-only. A real tutorial overlay (like most modern games) would point at the Manage button, highlight the correct tab, etc.
- **Tutorial restart** — no way to replay from a specific step without starting over.
- **Branching tutorials** — the flow is strictly linear.
- **Voice / sound cues** — text only.

## Files

Added:
- `content/scenarios/tutorial.json`
- `docs/plan/phase-3.6-status.md`

Modified:
- `engine/Magnate.Engine/Scenarios/Goal.cs` (4 new Goal subclasses)
- `engine/Magnate.Engine/Scenarios/ScenarioLoader.cs` (parses new goal types; threads scenarioStart into ElapsedMonthsGoal)
- `engine/Magnate.Engine.Tests/ScenarioTests.cs` (5 new tests)
- `client/scenes/Main.tscn` (TipPanel between ScenarioLabel and DateLabel)
- `client/scripts/Main.cs` (UpdateTipPanel; re-evaluates goals every HUD refresh)
