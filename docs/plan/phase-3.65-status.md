# Phase 3.65 — Events / news engine

**Status**: shipped.

## What landed

Random world events now fire during the monthly tick. Each event can apply
one or more effects (world-market price multiplier, brand shift, headline-only)
and writes a `NewsEntry` into a queryable `World.NewsLog` for client tickers.
The price multiplier flows through every existing world-market call site
(`MaterialProcurement.BuyFromMarket`, inter-city shipping cost,
`MonthlyTick.AutoExportSurplus`) via a new `World.GetEffectiveWorldPrice`
runtime overlay — `Product.BaseWorldMarketPrice` is never mutated.

### Trigger + effect design

Both modeled as sealed-record discriminated unions so the JSON loader and
`EventEngine` can pattern-match exhaustively. Phase 3.65 ships
`RandomTrigger` only; future phases will add conditional triggers
(tech > N, supply < threshold) by adding new sealed-record subtypes and
`switch` arms in `EventEngine.IsEligible`. Effects: `WorldMarketPriceMultiplierEffect`,
`BrandShiftEffect`, `HeadlineEffect`. Brand-shift acts on every existing
(company, product, city) entry with a [0, 100] clamp — it does not bootstrap
new brand records from zero, so awareness is never created from thin air.
Active price effects don't stack (one per product); a new event simply
replaces the prior overlay.

### Tick integration

`MonthlyTick.RunEvents` runs LAST, after `CollectPatentRoyalties`. It
decrements every active price effect's remaining months (removing expirees),
then rolls one global dice via `world.Rng`. If the gate (≤
`EventBaseProbabilityPerMonth = 0.20m`) passes, one event is picked
weighted by `Weight` from the (id-ordinal-sorted) eligible list. Running
after sales matches the "news arrives, market reacts in following month"
feel — a fired multiplier doesn't retroactively change this tick's already-booked
flows.

### Schema bump

v8 → v9 adds `NewsLog: IReadOnlyList<NewsEntryDto>` and
`ActivePriceEffects: IReadOnlyList<ActivePriceEffectDto>`. Both nullable;
v1–v8 saves load with both empty (verified in `PersistenceTests.Load_accepts_v8_save_missing_news_log_and_price_effects`).

## Seed events (10)

`cocoa_blight` (coffee_beans ×1.5/6mo, Notable), `oil_glut` (crude_oil ×0.7/9mo, Major),
`viral_ad_spot` (soft_drink+10 in metropolis, Info), `tariff_announcement`
(steel ×1.2/12mo, Major), `tech_breakthrough` (headline-only, Notable),
`cotton_harvest_bumper` (cotton ×0.75/8mo, Notable),
`soft_drink_health_scare` (soft_drink−8 in eastside, Notable),
`wheat_drought` (wheat ×1.35/7mo, Notable), `trade_summit_optimism`
(headline-only, Info), `consumer_electronics_craze` (television+12 in metropolis, Info).

## Tests

219 → 229 (+10): 9 new in `EventTests.cs` (no-events backward compat, seed
load, dice determinism, multiplier active/expiry, brand-shift cap, headline-only,
save/load round-trip, market-buy cost integration), +1 in `PersistenceTests` for
v8-load-with-no-news-log. All 229 pass.

## Tricky bits

- **Loaded RNG is reset**: `WorldSaveFile.Seed` is hardcoded to 0, so a
  loaded world's Rng diverges from the original. The save/load test verifies
  state equivalence at the save point + monotonic news-log growth on
  continuation, rather than fully-deterministic continuation.
- **ContentValidator**: tools/ is in MUST NOT TOUCH; the existing "Loaded N
  products, M building types, K cities" line is unchanged. Events validate
  semantically through `ContentLoader` (any malformed event fails the
  validator's load step).
