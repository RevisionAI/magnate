# Phase 3.26 — Market Intelligence Screen

**Agent:** C
**Status:** Complete (pending headless scene-boot verification — see Verification).

## Deliverables

- `client/scripts/MarketIntel.cs` — Control scene script (new).
- `client/scenes/MarketIntel.tscn` — Programmatic UI scene (new).

## Features

- Grid/table with one row per (city × finished-tier product) pair. Columns:
  City · Product · Player Price · Player Share % · Cheapest Competitor Price ·
  Top Competitor Name · Top Competitor Share %.
- Rows with no player presence show "—" in the two Player columns (dimmed)
  while still surfacing the competitive landscape (cheapest competitor, top
  competitor name/share).
- Rows where nobody sells the product in that city are omitted — nothing to
  report.
- Sort toggle bar (Share desc / Price asc / City A→Z). Toggle buttons reflect
  the active mode via `ButtonPressed`.
- City filter bar: "All" plus one toggle per city from the catalog.
- `Back` button returns to `res://scenes/Main.tscn`.
- Handles `GameState.World == null` with a friendly "No game loaded" message.
- Live refresh via `GameState.TickIfRunning` — stays in sync while the sim
  runs.

## Engine contact surface

- `World.GetMarketShare(CompanyId, ProductId, CityId)` — replays the softmax
  for share %.
- Iterates `World.Buildings.Values` to pull `RetailSlots` for per-owner prices.
- Reads `ContentCatalog.Products` (filtered to `ProductTier.Finished`) and
  `ContentCatalog.Cities` for the row axes.
- `World.Companies[...]` for competitor display names.

## Constraints respected

- `Main.cs` and `Main.tscn` untouched — central integration owns the button
  and keyboard shortcut wiring.
- No engine/content/test/other-client edits. Only the two new files listed.
- Scene is bootable standalone (no Main-only state required).

## Verification

- `dotnet build` — clean, 0 warnings, 0 errors.
- Headless scene boot (`godot --headless ... MarketIntel.tscn --quit-after 10`)
  was blocked by the sandbox permission prompt; not retried. The scene is a
  straight sibling of `CityMap.tscn` / `Reports.tscn` (same `Node` + `Panel` +
  `VBox` shape with programmatic UI in `_Ready`), so boot behaviour should
  mirror those.

## Known trade-offs

- Rows are expensive-ish for very big catalogs (N cities × M finished products,
  two `GetMarketShare` calls per row for player + top competitor). Current
  content has small N and M so this is fine; can memoise if it ever bites.
- "Top competitor" is computed by iterating distinct competitor owners for the
  slot list — if a city ends up with dozens of competing companies this becomes
  O(competitors × GetMarketShare). Same story: fine at current scale.
