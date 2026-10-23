# Phase 3.67 — NewsTicker Scene

**Sprint 14, parallel.** Adds an always-visible scrolling banner that surfaces
recent `World.NewsLog` entries (the field added by Phase 3.65 in the same
sprint). Standalone preview scene; final HUD-embedded version is a follow-up
integrator task.

## Files (NEW only)

- `client/scripts/NewsTicker.cs`
- `client/scenes/NewsTicker.tscn`

## Implementation

- **Approach 1** (per spec): a single `RichTextLabel` wrapped in a `Control`
  ("Scroller"); `_Process` slides `Scroller.Position.X` left at
  `ScrollPixelsPerSecond = 30f`. The strip is a `PanelContainer` with
  `clip_contents = true` so the label disappears cleanly off the left edge.
- **Wrap policy**: when `Scroller.X + Label.Size.X < 0`, reset `X` to the
  strip's right edge (`+stripWidth`). This bounds the X coordinate, so we
  never accumulate float drift across long sessions.
- **Refresh**: `_Process` polls `World.NewsLog.Count`; rebuild only when count
  changes. Cheap (one property read per frame).

## Severity color palette (BBCode)

| Severity | Color   | Style |
|----------|---------|-------|
| Info     | #888888 | grey  |
| Notable  | white   | (default) |
| Major    | #F5C050 | bold gold |

Headlines joined with `   •   `; `[` in headlines escaped to `[lb]`.

## Defensive Phase-3.65 detection

Engine types (`NewsEntry`, `EventSeverity`) are NOT referenced by name. The
ticker calls `world.GetType().GetProperty("NewsLog")` and unboxes the result
as `IList`; per-entry `Headline` and `Severity` are read by reflection too,
with `Severity.ToString()` matched against `"Info" / "Notable" / "Major"`.
If the property is missing OR the list is empty, the strip displays a static
`[i]No news yet[/i]` and does not scroll.

## Visual

Dark navy strip (`Color(0.06, 0.07, 0.10, 0.95)`) with a gold underline
(`BorderColor = (0.94, 0.78, 0.31)`, `BorderWidthBottom = 2`), 36 px tall,
full-width inside the preview scene. Header label "News Ticker" above; Back
button below.

## Integrator wiring ask

The scene is reachable as `res://scenes/NewsTicker.tscn` standalone (Esc returns
to Main). For the HUD-embedded version, the integrator should:
1. Promote the `TickerStrip + Scroller + Headlines` subtree into Main's HUD
   (top strip, anchored full-width).
2. Move the `NewsTicker` script onto that subtree's root or refactor it into a
   reusable `NewsTickerWidget` Control.
3. Drop the standalone `NewsTicker.tscn` once embedded — no other scene
   references it.

No keybind reserved for the standalone scene; final integration is HUD-resident.

## Build / test

`dotnet build` currently fails on Phase 3.65's in-flight engine work (XML
crefs to `EventEngine`, missing `ContentCatalog.Events`). Those errors are
NOT in Phase 3.67's files; the NewsTicker compiles cleanly and is decoupled
from `NewsEntry`/`EventSeverity` via reflection.
