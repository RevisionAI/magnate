# Phase 3.57 — Extract ScenarioDifficulty helper

Sprint 12 parallel DRY refactor. Consolidates the near-duplicate
`ComputeDifficulty(Scenario)` heuristics that Phase 3.38 (ScenarioPicker) and
Phase 3.46 (TitleScreen) were carrying side-by-side.

## Canonical heuristic (unchanged)

`ScenarioDifficulty.Compute(Scenario)` — integer [1, 5], clamped sum of:

- **Cash disadvantage** (sum AI cash / player cash): `>2.5` → +3, `≥1.5` → +2, `>1.0` → +1.
- **Goal count**: `≥6` → +2, `≥4` → +1.
- **AI count**: 0 → −1, 2 → +1, `≥3` → +2.
- **Duration months**: `≤24` → +1, `49..72` → −1, no EndDate → −1.
- **Strategy**: any `verticalIntegrator` AI → +1.
- **Goal mix** (capped at +2): `MarketShare ≥0.35`, `TopBrand`, `ExportRevenue >$3M` each +1.

Also exposed: `FormatStars` (plain `★★★☆☆`), `FormatStarsBbcode` (gold
`[color=#d9b859]★[/color]…` variant used by TitleScreen's showcase cards), and
`Bucket(int)` → "Easy" / "Normal" / "Hard".

## Drift check

The two duplicates were byte-equivalent in logic. Only differences: comment
wording (TitleScreen dropped the inline `// 25-48 contributes 0…` comment and
the `// unbounded is easier.` comment). No operand, constant, or goal-type
handling differed. Canonical version mirrors ScenarioPicker's (slightly more
commented) copy. No behavior bug spotted to defer.

## Line counts

| File | Before | After | Δ |
|------|-------:|------:|--:|
| `ScenarioPicker.cs`     | 249 | 161 | −88 |
| `TitleScreen.cs`        | 330 | 247 | −83 |
| `ScenarioDifficulty.cs` |   0 | 132 | +132 |
| **Total**               | 579 | 540 | −39 |

Net −39 lines despite adding XML doc comments on the new helper.

## Regression check — 15-scenario ratings

From Phase 3.38 status (12) + re-derived for Phase 3.50's additions (3):

| Scenario              | Stars | Bucket |
|-----------------------|------:|--------|
| sandbox               | 1 | Easy   |
| tutorial              | 1 | Easy   |
| export_tycoon         | 1 | Easy   |
| brand_monopolist      | 1 | Easy   |
| first_hundred_million | 2 | Easy   |
| tech_titan_clash      | 2 | Easy   |
| soft_drink_war        | 3 | Normal |
| patent_race           | 3 | Normal |
| tech_race             | 4 | Hard   |
| vertical_showdown     | 4 | Hard   |
| monopolist            | 4 | Hard   |
| coffee_monopoly       | 5 | Hard   |
| three_way_melee       | 5 | Hard   |
| multi_city_mogul      | 5 | Hard   |
| four_archetype_melee  | 5 | Hard   |

## Verification

- `dotnet build` → 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` → 197/198. The one failure
  (`AdaptiveAiTests.AdaptiveStrategy_builds_research_center_once_retail_is_saturated`)
  is engine-only and pre-existing — this phase only touches `client/scripts/`,
  no engine or test files. Flagging for Sprint 12 engine owner.

## Files touched

- `client/scripts/ScenarioDifficulty.cs` (NEW, 132 lines)
- `client/scripts/ScenarioPicker.cs` (refactor: delegate to helper; drop private `StarBadge` + `ComputeDifficulty`; drop now-unused `using System.Collections.Generic`)
- `client/scripts/TitleScreen.cs` (refactor: delegate to helper; drop private `ComputeDifficulty`; inline BBCode star builder → `FormatStarsBbcode`)

No `.tscn` or engine file touched.
