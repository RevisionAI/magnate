# Phase 3.42 — City Map enhancements

Turned the static dashboard of city cards into a live, owner-aware spatial
overview. Items shipped (1, 2, 3, 4, 5 — full set):

## Owner color palette
A static `OwnerColors` array (blue, amber, green, purple, red, cyan) keyed
by registration order, with the player pinned to index 0. `ColorFor` resolves
deterministically by sorting non-player CompanyIds. Drives the legend bar,
the per-card density bar, the dot grid, and the BBCode swatches in the
detail panel.

## Per-card content
Each city card now carries:

- Stacked Low/Mid/High demographic strip (Mix mode bumps it to 22px tall).
- A horizontal owner-density bar where each owner's segment width is its
  building share, hover-tooltipped with the company name and count.
- A dot grid (capped at 60 dots, "+N" overflow) — one dot per building,
  player-first ordering, owner-colored.
- "Details" button per card.

## View modes
Toggle bar with three exclusive modes:

- **Demographic mix** — emphasizes the stacked strip.
- **Population size** — scales the population label by `log10(pop)` so the
  500k metropolis doesn't dwarf 100k Hilltown.
- **Heat: your share** — frames each card with a cool-warm-hot lerp keyed
  to the player's mean market share across finished products with retail
  presence in the city.

## Click-to-drill detail panel
HSplitContainer hosts the card grid on the left and a `RichTextLabel` (BBCode)
panel on the right. Selecting a card highlights it with a blue border and
renders: full demographics with headcounts, all geography flags, base land
price, every building grouped by owner (with color swatch) then by type, and
the top-8 finished-product monthly demand (per-capita × city population, mix-
weighted).

## Live-tick
`_Process` invokes `TickIfRunning`; on tick, `Refresh` rebuilds cards and re-
renders the detail panel against the updated world while preserving
`_selectedCity`. World-null guard returns gracefully.

## Verification
- `dotnet build` — 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — 179/179 passing.

No engine changes; no other client files touched.
