# Phase 3.38 — ScenarioPicker difficulty rating + filter

## Heuristic

`ScenarioPicker.ComputeDifficulty(Scenario)` returns an integer in [1, 5] from
a weighted sum (clamped, not shifted). No `difficulty` field is added to JSON —
everything is derived from existing fields.

Contributions:

- **Cash disadvantage** `sum(ai.StartingCash) / player.StartingCash`
  - `>2.5` → +3, `>=1.5` → +2, `>1.0` → +1, else 0. Zero AIs → 0.
- **Goal count**: `>=6` → +2, `>=4` → +1, else 0.
- **AI count**: 0 → -1, 1 → 0, 2 → +1, `>=3` → +2.
- **Duration** (`EndDate - StartDate` months): `<=24` → +1, `49..72` → -1,
  no EndDate → -1, else 0.
- **Strategy toughness**: any `verticalIntegrator` AI → +1.
- **Goal mix**: each `MarketShareGoal` with `Threshold >= 0.35`, each
  `TopBrandGoal`, each `ExportRevenueGoal` with `Amount > $3M` contributes +1,
  capped at +2 total.

Map: 1-2 = Easy, 3 = Normal, 4-5 = Hard.

## Ratings (current 12 scenarios)

| Scenario              | Stars | Bucket |
|-----------------------|-------|--------|
| sandbox               | 1     | Easy   |
| tutorial              | 1     | Easy   |
| export_tycoon         | 1     | Easy   |
| brand_monopolist      | 1     | Easy   |
| first_hundred_million | 2     | Easy   |
| soft_drink_war        | 3     | Normal |
| tech_race             | 4     | Hard   |
| vertical_showdown     | 4     | Hard   |
| monopolist            | 4     | Hard   |
| coffee_monopoly       | 5     | Hard   |
| three_way_melee       | 5     | Hard   |
| multi_city_mogul      | 5     | Hard   |

Possibly off: `coffee_monopoly` prompt called "medium-hard" but lands at 5
(7 goals + cash deficit + two qualifying goal bonuses push it). `brand_monopolist`
is 1 despite three 70-awareness targets, because it has no AI competitors. Both
feel defensible — flag for integrator review.

## Filter UX

`FilterBar` (HBoxContainer) above the list with an `OptionButton`:
All / Easy (1-2) / Normal (3) / Hard (4-5). Selection re-renders the list.
Sandbox is pinned at the top regardless of filter; within the remainder,
scenarios sort ascending by difficulty then alphabetically. Each row shows a
`★★★★☆`-style star badge next to the name plus `[n/5]` in the meta line.
Auto-play CheckBox preserved.

## Build

- `dotnet build` — 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — 175/175 passing.
- `dotnet run --project tools/ContentValidator` — OK, no errors.

No new tests (client UX only, per brief).
