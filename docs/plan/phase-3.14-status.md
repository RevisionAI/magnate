# Phase 3.14 — City Map overview scene

**Goal**: surface the game's cities as a dashboard — population, demographics, geography, and the player's footprint per city. Not a tile map; a row of cards. This is the first time the player can see *where* they operate at a glance without opening each building individually.

## Delivered

### New scene — `CityMap.tscn` + `CityMap.cs`

The `.tscn` is a minimal shell following the Manage/Reports pattern: `Panel → VBox → Header + SubLabel + ScrollContainer(Content VBox) + BackButton`. Every card is constructed programmatically in `CityMap.cs` so iteration stays cheap.

Rendered per city (one `PanelContainer` card inside a 3-column `GridContainer`):

| Element | Source |
|---|---|
| City name (20px font) | `City.Name` |
| `city_id · Pop N,NNN` | `City.Id` + `City.Population` |
| **Geography badges** — pill-shaped labels on colored `StyleBoxFlat`s: green Arable, cyan Coastal, brown Mineral, black Oil (only true flags are rendered). Falls back to "(no special geography)" when none apply. | `City.Geography` |
| **Demographics** — three rows `Low / Middle / High` with percentage + absolute headcount | `City.Demographics` (weighted by population) |
| **Your footprint** — list of `N × Building Name` rows grouped by catalog name, descending count. Shows "(no presence)" when the player owns nothing in that city. | `world.Buildings` filtered by `Owner == PlayerId && City == cityId` |
| **Demand pulse** — `soft_drink` demand per person per month, weighted against the city's demographic split | `Product.BaseDemandPerCapita ⊗ City.Demographics` |

Sub-header matches Reports:
```
Scenario: Tutorial  ·  Date: 2026-03  ·  Company: Acme Corp  ·  Cash: $30,000,000
```

### Live refresh

`_Process` calls `GameState.TickIfRunning(delta)` and re-renders if a tick fired — same pattern as Reports. Play state carries over from Main.

### Empty-state handling

If `GameState.World` is `null` (scene launched in isolation), the SubLabel reads "No active game." and the content area shows "Open a game first — start a scenario or load a save from the title screen." The Back button still works. This is the path verified by `--quit-after 30` during smoke.

### Main HUD integration

- `Main.tscn`: added a `CityMapButton` to `Hud/VBox/HBox2`, between Reports and Save.
- `Main.cs`: new `OnOpenCityMap()` handler wired to the button. Does **not** pause — CityMap is read-only + live, same as Reports.

### Typical tutorial render (after ~3 months play)

Header: `City Map` · SubLabel: `Scenario: Tutorial Scenario  ·  Date: 2026-04  ·  Company: Acme Corp  ·  Cash: $28,750,000`

Three cards side-by-side (one per tutorial city):

**Metropolis**
- metropolis · Pop 4,500,000
- [green]Arable[/green]  [cyan]Coastal[/cyan]
- Demographics
  - Low     30.0%  (1,350,000)
  - Middle  50.0%  (2,250,000)
  - High    20.0%  (900,000)
- Your footprint
  - 1 × Supermarket
- Demand · soft_drink: 2.85 units / person / month

**Midtown**
- midtown · Pop 1,200,000
- [green]Arable[/green]
- Demographics (Low/Middle/High percentages)
- Your footprint: (no presence)
- Demand · soft_drink: 2.50 units / person / month

**Riverside**
- riverside · Pop 600,000
- [brown]Mineral[/brown]
- Demographics
- Your footprint: (no presence)
- Demand · soft_drink: 2.40 units / person / month

All cards rendered in a `GridContainer` with 3 columns (`Math.Max(1, min(3, cityCount))`). Scrolls vertically if the scenario has more cities than fit on screen.

## Scene count

9 scenes total after this phase: TitleScreen, ScenarioPicker, SaveBrowser, Main, Manage, BuildingInspector, Reports, SmokeTest, **CityMap** (new).

## Verification

| Check | Result |
|---|---|
| `dotnet build client` | **0 errors** (200 pre-existing XML-doc warnings, unchanged) |
| Smoke test (`res://scenes/SmokeTest.tscn`) | **11/11 OK** |
| `CityMap.tscn --quit-after 30` | boots clean, no `GD.PushError`, no exceptions — renders the empty-state message because no `GameState.World` is set when the scene is launched directly |

## Scope discipline

- **No engine changes.** Every value read through `World.Catalog.Cities`, `World.Buildings`, `World.Companies`, and `Product.BaseDemandPerCapita` — all public API surface that already existed.
- **No changes** to `GameState.cs`, `Reports.cs`, `Manage.cs`, `BuildingInspector.cs`, `ScenarioPicker.cs`, `SaveBrowser.cs`, `HeadlessSmokeTest.cs`, any engine/content files, or any scene other than `Main.tscn` (single button added).
- Demographics bar is rendered as three rows of percentages rather than a stacked bar chart — cheaper to ship, matches the plain-text aesthetic of the Reports tab. A horizontal stacked bar would be a trivial Phase 3.14.x follow-up using the same `Sparkline` drawing pattern.

## Out of scope (future)

- **Per-product demand picker** — we surface `soft_drink` only; the UI has room for a dropdown to pick any finished product. Fine as-is for tutorial / soft-drink-war scenarios where every city has meaningful demand for it.
- **Rival footprints** — only the player's buildings are counted. A "competitive heat" view (e.g. "3 rival supermarkets") would be a natural next step once the engine exposes rival aggregates cleanly.
- **Click-through to filter Manage by city** — each card could be a button that preselects the city in Manage's Build dropdown. Easy addition once users ask for it.
- **True tile map** — this phase explicitly defers the per-tile visual; buildings-on-a-grid is a much larger future phase that needs footprint placement, grid rendering, and pathing.

## Files

Added:
- `client/scenes/CityMap.tscn`
- `client/scripts/CityMap.cs`
- `docs/plan/phase-3.14-status.md`

Modified:
- `client/scenes/Main.tscn` (CityMapButton in HBox2)
- `client/scripts/Main.cs` (CityMap button wiring + `OnOpenCityMap`)
