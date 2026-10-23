# Phase 3.11 — Two new authored scenarios

**Goal**: ship two new scenarios that explore strategic questions the existing set doesn't touch. Soft Drink War is single-market share pressure; First Hundred Million is a pure corporate-value sprint; Tutorial is guided onboarding. Phase 3.11 adds a multi-city dominance challenge and a research-oriented tech race.

## Delivered

### `content/scenarios/multi_city_mogul.json`

A wide geography play: win a controlling share of bread in three of the four cities simultaneously, then cap it with a balance-sheet goal. Two AI rivals — one adaptive, one simple — force the player to defend on multiple fronts.

| Goal | Type | Threshold |
|------|------|-----------|
| 40% bread share in Metropolis | marketShare | 0.40 |
| 40% bread share in Riverside  | marketShare | 0.40 |
| 40% bread share in Portbay    | marketShare | 0.40 |
| Corporate value               | corporateValue | $40M |

- **Start**: 2026-01, **End**: 2032-12 (84 months)
- **Player cash**: $25M
- **AI**: GoliathMart (adaptive, $35M) + PennyGrocer (simple, $20M)
- **Strategic question**: Can you scale horizontally without starving any single front? Each city has different demographics (Metropolis is evenly mixed; Riverside is mid-tier suburban; Portbay is coastal working-class with cheap land) so the same pricing won't dominate everywhere.

### `content/scenarios/tech_race.json`

A vertical / research play: out-research a well-funded rival on electronics and automotive. Requires standing up multiple R&D centres, getting a tech-tier product to market, and converting R&D investment into market share.

| Goal | Type | Threshold |
|------|------|-----------|
| 2 R&D centres operating       | ownsBuilding (rd_center) | count 2 |
| Television on any shelf        | productRetailed (television) | — |
| Cars on any shelf              | productRetailed (car) | — |
| Television ad campaign running | adCampaignActive (television) | — |
| 35% television share in Metropolis | marketShare | 0.35 |
| Corporate value                 | corporateValue | $40M |

- **Start**: 2026-01, **End**: 2030-12 (60 months)
- **Player cash**: $30M
- **AI**: ApexLabs (adaptive, $60M) — deliberately well-funded
- **Strategic question**: Tech, brand and quality all feed the softmax demand allocator. Can you out-research a rival with 2× your starting capital on the products with the longest, most expensive supply chains (television needs electronic_parts + plastic + steel; car needs steel + plastic + electronic_parts)?

## Playtest observations (36–84 months, adaptive auto-player)

The adaptive auto-player is not a strong proxy for a thinking human — it builds retail broadly but doesn't build R&D centres, doesn't advertise everywhere, and doesn't manage inventory targets past the first configuration. Still, it's a useful floor for "are these goals achievable at all?".

### Multi-City Mogul — seed 42, 84 months

```
[✓] 40% bread share in Metropolis  41.7% / 40.0%
[✓] 40% bread share in Riverside   41.7% / 40.0%
[✓] 40% bread share in Portbay     41.7% / 40.0%
[ ] $40M corporate value           $31.0M / $40M
```

All three market-share goals achieved by the adaptive player through sheer retail spread. The $40M capstone is the real challenge — auto-player reached $31M; a human prioritising margins should clear $40M by year 6 or 7. The multi-share pattern is deliberately "easy per-city but hard-to-maintain-simultaneously" — a human who over-focuses on Metropolis will lose Portbay to PennyGrocer.

### Tech Race — seed 42, 60 months

```
[ ] 2 R&D Centres operating        0 / 2     <-- challenge goal
[✓] Television on shelf            configured
[ ] Cars on shelf                  not yet   <-- challenge goal
[✓] Television ad campaign         running
[✓] 35% television share in Metropolis 49.8% / 35.0%
[ ] $40M corporate value           $38.2M / $40M  <-- near miss
```

The auto-player hit the television market-share goal trivially because it builds brand/quality through advertising. The **non-trivial goals** — 2 R&D centres, cars retailed, $40M corporate value — all require deliberate player action. The $40M threshold is a near-miss at 60 months on the auto-player which is exactly right: a human focusing on the right things will clear it with room, a passive player will fall just short.

## Build status

- `dotnet test engine/Magnate.Engine.Tests` → **133 / 133 passing** (4 new, up from 129)
- `dotnet run --project tools/MagnateSim -- --scenario multi_city_mogul 84 --auto-player` → loads and runs cleanly
- `dotnet run --project tools/MagnateSim -- --scenario tech_race 60 --auto-player` → loads and runs cleanly

## Tests added (`engine/Magnate.Engine.Tests/ScenarioTests.cs`)

```csharp
Multi_city_mogul_loads_with_three_share_goals_and_value_capstone
Tech_race_loads_with_research_and_retail_goals
Phase_3_11_scenarios_use_valid_products_and_cities
Phase_3_11_scenarios_runner_applies_cleanly
```

The product/city cross-check test guards against typos that ScenarioLoader itself won't catch (it trusts the JSON). If someone adds a scenario referencing `"hilltown_north"` or `"softdrink"`, this test fires.

## Files

Added:
- `content/scenarios/multi_city_mogul.json`
- `content/scenarios/tech_race.json`
- `docs/plan/phase-3.11-status.md`

Modified:
- `engine/Magnate.Engine.Tests/ScenarioTests.cs` (4 new tests at the bottom under a "Phase 3.11 scenarios" header)

## Out of scope (future)

- **Tech-level goal type** — there's no `MaxTechLevelGoal` yet. Tech Race uses `OwnsBuildingOfCategoryGoal("rd_center")` + market-share-in-flagship-city as proxies. A direct tech-level goal would be a cleaner fit and should be considered in Phase 3.12+.
- **City-scoped product-retailed goal** — `ProductRetailedGoal` currently matches any city. Adding a `City` field would let Tech Race demand "television in Metropolis AND television in Riverside" as two separate goals.
- **Negative / defensive goals** — e.g. "keep RivalCo below 30% share" or "stay profitable every month for 12 months". No current goal type supports these.
