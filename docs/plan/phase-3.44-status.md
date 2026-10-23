# Phase 3.44 — Per-Bracket Reservation Prices

**Status:** Complete · 2026-04-24

## Goal
Make demand bracket-aware: a Low-income family won't buy a $1,000 finished
good even if it's on the shelf. Each Finished product may declare a
per-`IncomeBracket` price ceiling; if a retailer's price exceeds the ceiling,
that bracket contributes zero demand to that retailer (other brackets still
might).

## Algorithm sketch
Per (city, product), compute one bracket-independent perceived-value weight
per retailer (as before). Then iterate brackets in fixed order
(Low → Middle → High), computing each bracket's `population × share ×
perCapita` demand and softmax-allocating it across the *subset* of retailers
whose price is at or below that bracket's ceiling. Per-retailer demand
accumulates across brackets. Sales execute against inventory unchanged.

## Reservation prices opted in
| product       | Low      | Middle    | High |
|---------------|---------:|----------:|------|
| `soft_drink`  | $8       | $50       | ∞    |
| `beer`        | $12      | $60       | ∞    |
| `coffee_drink`| $10      | $30       | ∞    |
| `television`  | $300     | $2,000    | ∞    |
| `car`         | $0       | $30,000   | ∞    |

`bread` and `t_shirt` left without a `reservationPrice` block — they remain
fully unconstrained, exercising the backward-compat path.

## Tests
6 new tests in `engine/Magnate.Engine.Tests/ReservationPriceTests.cs` cover:
backward-compat (no opt-in), single-retailer Low-ceiling exclusion,
two-retailer share shift, partial-bracket gating (TV with no High ceiling),
hard zero-ceiling lockout (Car / Low = $0), and same-seed determinism.

Test counts: **179 → 185** passing. No baseline test changed behaviour;
existing scenarios all use prices well below the ceilings I shipped, so
backward-compat held first try.

## Files
- `engine/Magnate.Engine/Domain/Product.cs` — added `ReservationPrice`.
- `engine/Magnate.Engine/Content/ContentLoader.cs` — `ReservationDto` + `BuildReservation`.
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` — restructured `AllocateDemandAndSell`.
- `content/data/products/finished.json` — 5 opt-ins.
- `content/schemas/product.schema.json` — added `reservationPrice` object.
- `engine/Magnate.Engine.Tests/ReservationPriceTests.cs` — new.

## Verification
- `dotnet build` — 0 warnings (within engine), 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — **185 / 185 pass**.
- `dotnet run --project tools/ContentValidator` — OK, 22 products / 18 buildings / 5 cities.
