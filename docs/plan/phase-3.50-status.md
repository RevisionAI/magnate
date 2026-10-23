# Phase 3.50 — Status

Sprint 11 (3rd attempt; prior two aborted at API 529 before any work). Ships three new scenarios that showcase the Phase 3.48 `techLeader` AI archetype.

## Deliverables

- `content/scenarios/tech_titan_clash.json`
- `content/scenarios/four_archetype_melee.json`
- `content/scenarios/patent_race.json`

## Scenarios

**Tech Titan Clash** (medium-hard, 60 mo). Player $25M vs single `techLeader` at $50M. Goals: ≥30% car share in Eastside (TechLeader's likely hero-city per High-bracket share), ≥25% TV share in Metropolis, $50M corporate value, 60 months elapsed. Pitch: out-engineer the premium-brand rival on their home turf.

**Four-Archetype Melee** (hard, 84 mo). Player $30M vs `simple` + `adaptive` + `verticalIntegrator` + `techLeader` (each $30M) in a single-city brawl in Metropolis. Goals: topBrand soft_drink (70), topBrand car (70), 18 consecutive profitable months, $40M corporate value, 84 months elapsed. Validates that each archetype plays a distinct role and player can hold against the full roster.

**Patent Race** (medium, 42 mo). Player $20M vs single `techLeader` at $40M. Goals: productRetailed television + car, ≥20% car share in Eastside, $35M corporate value, 42 months elapsed. Deliberately avoids any Phase 3.49 patent-system dependency — all goal types predate Phase 3.49.

## Tuning rationale

Starting-cash ratios match existing tech_race (1:2) and vertical_showdown (1:2.25). TechLeader defaults place R&D hero on `car` (highest `BaseWorldMarketPrice`), premium-prices aisles at 1.30× competitor max, and targets High-bracket cities (Eastside in particular) — all three scenarios lean into those behaviors. Goal thresholds sit below Sprint-10 comparables (tech_race @ 35% TV; vertical_showdown @ 30% TV) so that beating a premium-brand opponent on its own game stays reachable but firm.

## Verification

`dotnet run --project tools/ContentValidator --no-build` → `Loaded 22 products, 18 building types, 5 cities. OK — no errors.` All product ids (`car`, `television`, `soft_drink`) and city ids (`metropolis`, `eastside`) verified against `content/data/`. Strategy discriminator `techLeader` matches Phase 3.48 camelCase convention.
