# Phase 3.71 — Tool-screen chrome pass

Applied the game's established visual system (UiChrome / GamePresentation) to five
sub-scenes that were still default-Godot grey, plus verified null-world empty states.
Presentation-only: no simulation, engine, or behavior changes beyond styled empty states.

## Approach

Code-only chrome, matching the `CityMap.ApplyVisualPolish` precedent (no .tscn
restructuring, so every `GetNode<T>("path")` still resolves and all keybinds /
tooltips / live-tick refresh stay intact). Each scene gained a private
`ApplyChrome()` called first in `_Ready`:

- `UiChrome.InstallBackdrop` on the root `Panel` using `operations_room.png` as a
  faint operational texture, with a dark shade overlay.
- Root `Panel` stylebox made near-transparent (borderWidth 0) so the backdrop reads.
- Header title recolored to `UiChrome.Gold` at 30pt; sub/hint labels to `UiChrome.Muted`.
- Readable semi-opaque plates behind text/graph content so it stays crisp over art.
- Side panels styled with gold-stroked `UiChrome.Box`.
- `BuildAccentBanner` helper (replicated locally per scene, per ownership rules) adds
  a slim system-art accent strip with a one-line strategic caption where there is
  vertical room.

Palette kept to the house system: dark operational chrome, gold strategic
highlights, blue information, existing green/red positive/negative, `C0`/`MoneyShort`
number formatting untouched.

## Per scene

- **ActivityFeed** — ops backdrop, gold header, blue accent banner, dark plate behind
  the streaming feed (`RichTextLabel` `normal` stylebox). Filter chips / search / live
  tick untouched. Empty state reworded to "No active game — start a scenario…".
- **ResearchTree** — ops backdrop (heavy overlay so tier nodes + bezier edges stay
  crisp), gold header, `research.png` accent banner, gold-stroked sidebar. Node-graph
  drawing and ←/→/↑/↓/Enter navigation preserved. Null-world placeholder tinted blue.
- **ReplayViewer** — ops backdrop, gold header, `markets.png` accent banner, dark plate
  behind the month-by-month `RichTextLabel`. Sparklines and Esc/Back preserved.
- **BuildingInspector** — ops backdrop, gold header, gold section headers, dark plate
  behind the dense scrolling content (`ScrollContainer` `panel` stylebox). All 17
  tooltips, editable spinboxes/toggles, add-slot form, and live re-render preserved.
  Existing "No building selected" guard kept.
- **SlotEditor** — ops backdrop (heaviest overlay; the transparent canvas draws its own
  dark cards + arrows on top), gold title, gold-stroked inspector panel. Card/arrow
  rendering (`SlotCanvas`, not owned — left untouched) and ←/→/↑/↓/Enter/Esc navigation
  preserved. Existing "No building selected" guard kept.

## Null-world guards

All five scenes already guarded `GameState.World` (and BuildingInspector +
SlotEditor also guard `GameState.SelectedBuilding`) before dereferencing — no crash
paths were found. Work here was limited to making those empty states friendly and
palette-consistent.

## Files touched

- `client/scripts/ActivityFeed.cs`
- `client/scripts/ResearchTree.cs`
- `client/scripts/ReplayViewer.cs`
- `client/scripts/BuildingInspector.cs`
- `client/scripts/SlotEditor.cs`

No `.tscn` files needed changes (chrome is fully code-driven). `SlotCanvas.cs`,
`UiChrome.cs`, `GamePresentation.cs` read-only, not modified.

## Build

`dotnet build client/Magnate.Client.csproj`: my five files compile with 0 errors /
0 warnings. At the time of writing the shared project link fails only on
`Main.cs` and `FinancialStatements.cs`, which other agents are editing concurrently
(errors: `ApplyChrome`, `EmbedNewsTicker`, `OnMonthTicked` not defined) — none of
those errors reference my files. Godot boot unverified (sandbox cannot run the engine
binary).
