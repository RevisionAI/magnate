# Phase 3.10 — Brand + tech sparklines on the Trends tab

**Goal**: extend the Phase 3.8 Trends tab so it also tracks and renders brand awareness (highest across the player's active ad campaigns) and tech level (highest across any product the player has a retail / production / research slot for). This makes the Phase 2.2 (tech) and Phase 2.3/2.5 (advertising + brand) systems visible alongside the cash story.

## Delivered

### `HistoryEntry` gains two fields

```csharp
record HistoryEntry(
    GameDate Date,
    decimal Cash,
    decimal MonthlyRevenue,
    decimal MonthlyNetIncome,
    double TopBrand,      // 0..100 — max over player's ad campaigns' (product, city) pairs
    int    TopTech);      // 1..MaxTechLevel — max over player's retail/production/research slots
```

### `GameState.RecordSnapshot()` computes them

Two private helpers were added:

- `ComputeTopBrand(world, player)` — scans `world.AdCampaigns`, filters to the player, and takes the max of `world.GetBrandAwareness(player, campaign.Product, campaign.City)`. Returns `0` if the player has no campaigns.
- `ComputeTopTech(world, player)` — iterates `world.Buildings.Values` owned by the player, walks `RetailSlots ∪ ProductionSlots ∪ ResearchSlots`, and takes the max of `world.GetTech(player, slot.Product)`. Falls back to `SimulationConstants.BaseTechLevel` (1) if the player has no slots anywhere.

`RecordSnapshot()` still no-ops when `GameState.World is null`, so the Phase 3.8 contract ("safe to call from anywhere") is preserved.

### Reports Trends tab now shows 5 sparklines

Two new `BuildTrendRow` calls in `RenderTrends`:

- **Top Brand Awareness (0–100)** — magenta `(0.85, 0.55, 1.00)`
- **Top Tech Level** — yellow `(1.00, 0.95, 0.35)`

Five distinct line colors across the tab:

| Series | Color |
|---|---|
| Cash | light blue `(0.55, 0.90, 1.00)` |
| Monthly Revenue | green `(0.70, 1.00, 0.60)` |
| Monthly Net Income | amber `(1.00, 0.80, 0.55)` |
| Top Brand Awareness | magenta `(0.85, 0.55, 1.00)` |
| Top Tech Level | yellow `(1.00, 0.95, 0.35)` |

The latest/min/max detail line formats TopBrand as `F1` (one decimal, 0–100) and TopTech as a plain integer so both read sensibly against their narrow ranges.

### Smoke test asserts the new fields

`HeadlessSmokeTest`'s 11th check ("history tracking via TickIfRunning") now, after the 5 driven ticks, inspects the final `HistoryEntry` and requires:

- `TopTech ≥ SimulationConstants.BaseTechLevel` (default floor holds)
- `TopBrand > 0` (ad campaign + ticks actually move the needle)

A `GD.Print` line surfaces the values so they show up in the smoke log.

## Verification

| | |
|---|---|
| `dotnet build client` | **0 warnings, 0 errors** |
| `dotnet test` (engine) | **129/129 passing** (no regression from 125 baseline) |
| Godot headless smoke | **11/11 OK** |

Tutorial smoke run values at 2026-09 (1 supermarket + soft_drink retail slot + $50k/mo TV ad campaign in metropolis for 5 months):

```
TopBrand=48.71   TopTech=1   Date=2026-09
```

TopTech sits at 1 because the tutorial smoke never configures a research slot or raises tech — exactly the default-floor behavior we want to prove the `BaseTechLevel` fallback works.

## Why the "top" slice

Picking the max over the player's (product, city) pairs keeps the sparkline to a single scalar per snapshot without fabricating an arbitrary average. It answers "how well-known is our best-selling brand somewhere?" and "what's the highest tech we've unlocked?" — both more useful as a single-line chart than a mean. A future extension could render one line per product or per city, but that needs the Sparkline control to gain multi-series support first.

## Out of scope (future)

- **Per-product brand/tech lines** — one line per (product) or (product, city). Needs multi-series Sparkline.
- **Brand decay labels** — no indicator on the sparkline when a campaign is cancelled and brand decays.
- **Tech-at-max markers** — no visual cue when TopTech plateaus at `MaxTechLevel`.
- **History persistence** — same caveat as 3.8; saving and reloading still resets the trend.

## Files

Added:
- `docs/plan/phase-3.10-status.md`

Modified:
- `client/scripts/GameState.cs` (extended `HistoryEntry` + `ComputeTopBrand` / `ComputeTopTech`)
- `client/scripts/Reports.cs` (two extra `BuildTrendRow` calls in `RenderTrends`)
- `client/scripts/HeadlessSmokeTest.cs` (11th check now asserts TopBrand/TopTech and logs them)
