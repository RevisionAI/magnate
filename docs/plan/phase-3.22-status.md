# Phase 3.22 — Research Tree UI

**Goal**: give the player a single screen that visualizes their tech level for every product in the catalog, grouped by product tier, with live indication of which products are currently being researched by their R&D centers.

## Delivered

### New scene — `client/scenes/ResearchTree.tscn` + `client/scripts/ResearchTree.cs`

The `.tscn` follows the `CityMap.tscn` / `Reports.tscn` shell: `Panel → VBox → HeaderLabel + SubLabel + ScrollContainer(Content VBox) + BackButton`. Everything inside the scroll view is built programmatically in `ResearchTree.cs`, matching the style used by `CityMap.cs`.

Layout:

| Element | Source |
|---|---|
| Header | Static `"Research & Technology"` (24px font) |
| Sub-label | `Scenario · Date · Company` (pattern reused from `CityMap`) |
| Tier panels (Raw / Intermediate / Finished) | `world.Catalog.Products.Values` grouped by `Product.Tier`, emitted in `TierOrder` so the tiers always appear in dependency order, missing tiers elided |
| Per-product row | `Product.Name` (180px), `Tech N/M` label (80px), `ProgressBar` (min 0, max `Product.MaxTechLevel`, value `world.GetTech(playerId, productId)`), optional orange `(R&D in progress)` tag |
| Back button | Returns to `res://scenes/Main.tscn` |

### Data sources (engine API — used read-only, no new APIs added)

- **Tech level**: `World.GetTech(CompanyId, ProductId)` — returns the player's current tech level for a product, defaulting to `SimulationConstants.BaseTechLevel` until R&D raises it.
- **Max tech level**: `world.Catalog.Product(id).MaxTechLevel`.
- **Active R&D detection**: iterate `world.Buildings.Values` filtered by `Owner == GameState.PlayerId`, flatten `ResearchSlots`, collect each slot's `Product`. Any product in that set renders the orange `(R&D in progress)` tag.

`World.GetResearchProgress(...)` is available if we later want to show progress toward the next level as a secondary sub-bar; the phase spec asked for a progress bar over `MaxTechLevel`, so this is what the bar shows. The textual `Tech N/M` label keeps the absolute level visible.

### Live refresh

`_Process` calls `GameState.TickIfRunning(delta)` and re-renders on every tick — same pattern as `Reports` and `CityMap`. No pause when opened from Main; play state carries over.

### Main integration (minimal)

- `client/scenes/Main.tscn`: added one `ResearchButton` to the existing `HBox2` button strip between `CityMapButton` and `SaveButton`. No reorganization.
- `client/scripts/Main.cs`:
  - Fetches the new button in `_Ready`, wires `Pressed` to `OnOpenResearchTree()`.
  - Adds `Key.T` case in `_UnhandledInput` that invokes the same handler.
  - `OnOpenResearchTree()` follows the `OnOpenCityMap` / `OnOpenReports` pattern — read-only + live, no forced pause.

## Verification

- `dotnet build`: **clean** (0 errors, 200 pre-existing doc-comment warnings unchanged).
- Godot headless boots (ResearchTree / Main / SmokeTest): **not executed** — the agent's sandbox denied every attempt to invoke `/Users/eddyh/Applications/Godot_mono.app/Contents/MacOS/Godot`, including `--version`. The code has been written defensively against the `GameState.World is null` path (prints the same "no active game" fallback as CityMap), so a fresh boot with no world loaded will render cleanly rather than crash. Please run the three headless smoke commands manually to confirm:

```
export GODOT=$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot
"$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client res://scenes/ResearchTree.tscn --quit-after 15
"$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client res://scenes/Main.tscn --quit-after 15
"$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client res://scenes/SmokeTest.tscn
```

## Files touched

- `client/scripts/ResearchTree.cs` (new)
- `client/scenes/ResearchTree.tscn` (new)
- `client/scripts/Main.cs` (wire button + `T` shortcut + `OnOpenResearchTree`)
- `client/scenes/Main.tscn` (add `ResearchButton` to `HBox2`)

No engine code, content, scenarios, tests, or other client scripts were modified.
