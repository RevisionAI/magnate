# Phase 3.25 — AdChannel.Radio + radio station wiring

Status: complete (Agent B).

## Summary

Agent A (Phase 3.21) added a `radio_station` building type, but there was no
`AdChannel.Radio` enum member, so the media-ownership advertising bonus only
applied to TV. This phase closed that loop: Radio is now a first-class ad
channel with its own cost-per-point, and radio_station owners get the 1.35×
bonus on Radio campaigns (parallel to tv_station → TV).

## Changes

1. `engine/Magnate.Engine/Simulation/AdCampaign.cs` — appended `Radio` to the
   `AdChannel` enum (after `Magazine`, ordinal 3).
2. `engine/Magnate.Engine/Simulation/SimulationConstants.cs` — added
   `RadioAdCostPerPoint = 5_000m` (cheaper than TV's 4_000 is not possible by
   spec — radio is meant to be *less* premium than TV, so 5_000 sits between
   TV and newspaper, reflecting broader-but-less-converting reach). Extended
   `AdCostPerPoint` switch with the `AdChannel.Radio` case.
3. `engine/Magnate.Engine/Simulation/World.cs` — `GetMediaOwnershipBonus` now
   maps `AdChannel.Radio` → `"radio_station"` alongside the existing TV
   mapping. Doc comment updated.
4. `engine/Magnate.Engine.Tests/AdvertisingTests.cs` — added two tests at the
   bottom (no edits to existing tests):
   - `Radio_channel_ad_campaigns_deliver_reach` — 50k budget → 10 brand
     points (50_000 / 5_000), with ledger AdvertisingCost = 50_000.
   - `Radio_station_owner_gets_radio_ad_bonus` — baseline 10.0 vs
     station-owner 13.5 (50_000 × 1.35 / 5_000); also asserts the helper
     returns 1.0 for TV/Newspaper when only a radio_station is owned.

## Enum strategy

Appended `Radio` to the end of `AdChannel` (ordinal 3). This is safe because
serialization is by string name, not int.

## Serialization finding

`WorldSaver.cs` line 197 writes `c.Channel.ToString()`; `WorldLoader.cs`
line 140 reads via `Enum.Parse<AdChannel>(ad.Channel, ignoreCase: true)`.
The only `(int)c.Channel` usage in WorldSaver is a sort key on line 192 for
deterministic ordering — appending a new member simply sorts it last, which
is harmless. No schema migration required; save files from earlier phases
remain loadable.

Grepped for `(int)AdChannel` and hard-coded ordinal equality: none found.
Only switch-expressions over named members, all of which either now handle
`Radio` explicitly or fall through to a sensible default (`AdCostPerPoint`
returns `NewspaperAdCostPerPoint` — already covered; `GetMediaOwnershipBonus`
now explicitly maps Radio → radio_station).

## Test count

- Before: 159 passing.
- After: **161 passing, 0 failing, 0 skipped.** (+2 new tests; no existing
  tests modified.)
