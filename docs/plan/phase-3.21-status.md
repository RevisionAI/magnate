# Phase 3.21 — Media Buildings (Status)

**Status:** complete
**Date:** 2026-04-24
**Agent:** A (parallel sprint)

## Scope

Introduce a `media` building category. Companies that own a TV station in a
city get a 35% effective-budget bonus on their TV ad campaigns in that city.
Radio station building ships for future use but does not yet boost any channel
(the `AdChannel` enum has no `Radio` today).

## Content

- `content/data/buildings/media.json` — new file with `tv_station` and
  `radio_station`, both `category: "media"`, `producibleTiers: []`, `maxUnits: 1`.
  - `tv_station` — $3M construction, $30k/mo opex, 3×3 footprint, 10–30 headcount.
  - `radio_station` — $800k construction, $12k/mo opex, 2×2 footprint, 5–15 headcount.
- `content/schemas/building-type.schema.json` — added `"media"` to the
  category enum so the validator accepts the new rows. No other categories
  changed.

## Engine

- `engine/Magnate.Engine/Simulation/SimulationConstants.cs` — new constant
  `MediaOwnershipAdBonus = 1.35m`.
- `engine/Magnate.Engine/Simulation/World.cs`
  - New public helper
    `decimal GetMediaOwnershipBonus(CompanyId, CityId, AdChannel)` returning
    `1.35m` when the company owns a `tv_station` in that city and the channel
    is `AdChannel.TV`, otherwise `1.0m`. Radio/Newspaper/Magazine fall through
    to `1.0m` — no matching media building yet.
  - `ApplyMonthlyAdvertising` now scales `MonthlyBudget` by the bonus before
    dividing by `AdCostPerPoint`, so the multiplier goes straight into the
    reach calculation. Ad cost is charged at the actual `MonthlyBudget` — the
    bonus is additional reach for the same dollar, not a cost discount on the
    ledger. (This preserves ledger invariants and keeps the existing
    `AdvertisingCost` total from changing.)

## Tests

`engine/Magnate.Engine.Tests/AdvertisingTests.cs` — added two tests:

1. `Media_tv_station_loads_from_catalog` — asserts the catalog exposes
   `tv_station` (category=media, $3M, 3×3, 1 slot, no producible tiers) and
   `radio_station` (category=media, $800k).
2. `Tv_station_owner_gets_ad_reach_bonus` — parallel worlds: acme without
   station gets 10.0 brand points from $40k TV spend; acme with station gets
   13.5 points (10 × 1.35). Also verifies the helper returns `1.0` for
   Newspaper channel and for a non-owner.

Test total: **154 passing** (was 151). Validator reports **16 building types**
(was 14). Build clean, zero warnings.

## Notes / follow-ups

- `AdChannel` has no `Radio` yet. When introduced, wire `radio_station` →
  `AdChannel.Radio` in `GetMediaOwnershipBonus`. The helper's `switch` already
  yields `null` (→ 1.0) for any unknown channel, so the radio building is
  currently inert for the ad system.
- Schema now allows either `"media"` or the legacy per-outlet categories
  (`tv_station`, `newspaper`, `magazine`, `internet_service`) that were
  already enumerated. Migration of those legacy slots to `"media"` is out
  of scope for this phase.
