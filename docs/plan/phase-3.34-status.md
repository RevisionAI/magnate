# Phase 3.34 — Newspaper & Magazine ad channels wired end-to-end

## What was added
- `content/data/buildings/media.json`: two new `media`-category buildings,
  `newspaper_publisher` and `magazine_publisher`, mirroring the shape of
  `tv_station` / `radio_station`.
- `engine/Magnate.Engine/Simulation/World.cs`: extended
  `GetMediaOwnershipBonus` to map `AdChannel.Newspaper` → `newspaper_publisher`
  and `AdChannel.Magazine` → `magazine_publisher`. Rewrote the switch so each
  channel also carries its own bonus multiplier (so print and broadcast can
  differ).
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs`: added
  `MediaOwnershipAdBonusPrint = 1.25m` alongside the existing broadcast
  `MediaOwnershipAdBonus = 1.35m`. Both are documented.
- `engine/Magnate.Engine.Tests/AdvertisingTests.cs`: +5 additive tests
  (catalog load, newspaper bonus, magazine bonus, channel-specificity, and
  two-company isolation).

## Tuning chosen
- `newspaper_publisher` / `magazine_publisher`: ConstructionCost 2.1M (70% of
  tv_station's 3M), MonthlyOperatingCost 18k (60% of tv_station's 30k),
  3×3 footprint, 8–25 headcount. Print is cheaper than broadcast.
- Print bonus multiplier **1.25×** (vs broadcast 1.35×) — print converts
  ownership into reach slightly less efficiently. Added as a second
  `SimulationConstants` entry rather than reusing the 1.35× value.

## Invariants preserved
- `AdvertisingCost` ledger entries still carry `Building = null` (Phase 3.29
  channel-scope invariant) — untouched.
- Zero Godot deps; bonus lookup remains single-building city-scoped (no
  cross-city leak); content still validates.

## Results
- Engine tests: **170 → 175 pass** (0 failed).
- Building types: **16 → 18**.
- `dotnet build`: 0 errors.
- `ContentValidator`: OK — 22 products, 18 building types, 5 cities.

## Notes for integrator
- Two-constant tuning (broadcast 1.35×, print 1.25×) is intentional; flip
  `MediaOwnershipAdBonusPrint` to 1.35m if a uniform bonus is preferred.
- No `MonthlyTick.cs`, `AdCampaign.cs`, or `ContentLoader.cs` change was
  needed — the existing call site picks up the new mappings automatically.
