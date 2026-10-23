# Phase 3.36 — Research Tree node-graph visualizer

Status: shipped.

## Layout approach

Three-column directed graph, one column per `ProductTier` (Raw left, Intermediate
middle, Finished right). Products are sorted deterministically inside each
column by `ProductId` ordinal and laid out as fixed-size panel-nodes
(240 × 92 px) at `x = margin + column × (width + gap)`,
`y = margin + row × (height + gap)`. The whole graph lives inside a
`ScrollContainer` → `ResearchCanvas` (custom `Control` subclass). The canvas
widens and tallens with content via `CustomMinimumSize` so scroll activates
only when needed.

## Edge rendering

Edges are drawn in `ResearchCanvas._Draw`: for every product with a recipe, for
every recipe input, a cubic-Bezier curve runs from the source node's
right-middle to the target node's left-middle, followed by a short arrowhead.
Horizontal tangents on the Bezier keep the curves reading clearly even when a
source is vertically far from its target. Edges touching the selected node are
highlighted in amber at 2.5 px; all other edges render in muted grey at 1.5 px.

## Node content

Each node shows product name, a tier badge (RAW/INT/FIN in the tier's color),
`Tech L/N`, and a progress bar scaled to the next-level threshold
(`100 × currentLevel`). If any player R&D center is currently researching the
product, the tech line turns amber and appends "R&D active". The node border
thickens and switches to light-grey when selected.

## Selection UX & keybinds

Selection is a single index into the flat ordered product list.

- `←` / `→` — move to the adjacent tier column, preserving approximate Y.
- `↑` / `↓` — move within the current column.
- `Enter` / `Kp Enter` — toggle a 280 px sidebar (recipe inputs, output qty,
  R&D progress vs threshold, slot-month estimate, downstream products).
- `Esc` — back to Main.
- `Back` button — same.

Selection auto-scrolls so the chosen node stays in view.

## Screenshot description

Header "Research & Technology" over a subline showing scenario, date, company.
Below, a horizontal layout: a scrollable canvas with three vertical columns of
rounded-corner node cards (green Raw left, amber Intermediate middle, blue
Finished right) connected by grey arrows that curve rightward from each input
to the recipe it feeds. The currently selected card has a bright white border
and its connected edges turn amber. A collapsible right-hand sidebar shows the
recipe inputs and R&D progress for the selected product. A hint line
("←/→ switch tier · ↑/↓ select product · Enter toggle details · Esc back")
sits above the Back button.

## Fallback

None taken — graph ships end-to-end.

## Verification

- `dotnet build` → clean (0 warnings, 0 errors).
- `dotnet test engine/Magnate.Engine.Tests` → 175 / 175 passing.
