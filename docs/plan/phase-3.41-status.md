# Phase 3.41 — Market Intelligence drilldown

**Agent:** Sprint 9 / Phase 3.41
**Status:** Complete.

## Deliverables

- `client/scripts/MarketIntel.cs` — extended.
- `client/scenes/MarketIntel.tscn` — restructured with TabContainer and split body.
- `docs/plan/phase-3.41-status.md` — this file.

## Enhancements shipped

1. **Per-(city, product) leaderboard panel.** Rows in the main grid are now
   clickable Buttons; clicking selects the (city, product) and the right pane
   renders a softmax replay: one line per retailer slot with company name,
   price, Q, T, B, computed weight, demand share, and units/month. Sorted by
   share descending. Player rows flagged with `▶`. Replicates the exact engine
   formula `weight = max((Q+T·10+B)/3, 1) / price^elasticity` client-side, no
   new engine API.
2. **Top 3 tab.** Two ranked sections — markets to enter
   (`demand / (1 + competitorCount)` for player-absent rows) and markets to
   defend (`(topCompShare − playerShare) × demand` for contested player
   markets). Three rows each.
3. **Player share sparkline (12 mo).** Above the leaderboard, a `Sparkline`
   reconstructs the player's monthly share for the selected market by
   summing `ProductSale` ledger entries filtered by product + player buildings
   in that city, divided by an estimate of total monthly market revenue
   (current avg price × computed city demand).
4. **Filter row.** Toggleable flags — `My markets`, `Has competitor`,
   `Significant only` (>1k units/mo) — plus a product `OptionButton`. City
   filter retained from Phase 3.26.
5. **Live-tick refresh.** Mirrors `Reports._Process`: `TickIfRunning(delta) →
   Refresh()`. Refresh re-validates the selection and rebuilds detail / Top 3.

## Engine contact (read-only)

`World.GetMarketShare`, `GetTech`, `GetBrandAwareness`, `Buildings.Values`,
`Ledger.EntriesFor`, `Catalog.Cities/Products`, `Inventory.AverageQuality`.
City demand replicates `MonthlyTick.ComputeCityDemand` client-side (the engine
version is private; canonical formula copied verbatim).

## Verification

- `dotnet build` — succeeded, 0 errors.
- `dotnet test` — 179 passed, 0 failed (suite grew slightly; all green).

## Deferred

- Headless scene-boot smoke (sandbox-permission territory; mirrored Phase 3.26
  rationale).
- Retailer-name column in the leaderboard — owner names fit but not the
  building id; can add once a longer panel ships.
