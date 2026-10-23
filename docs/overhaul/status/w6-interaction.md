# W6 interaction: status

Branch `w6-interaction` · Wave 2 · 2026-10-01

**Status: done.** Every deliverable of the brief is in: CPU picking with a W2 adapter and a scene-graph fallback,
hover outline + hover card, click-to-select with outline + dashed gold ring + name tag, double-click focus, right-click
context menu, the placement ghost (hologram, per-plot validity, x-ray border, catchment ring, cost tag, Q/E rotate,
throttled `previewBuild`, confirm → `placementConfirmed`), seven clay-mode overlays with legends, supply-link arcs,
gold ring decals and status badges, world popups, and a real minimap. Gates green (§4).

---

## 1. File map (all owned by W6)

| File | What it does |
|---|---|
| `web/src/scene/interaction/index.ts` | `createInteractionModules()` (the hook GameScreen composes) + public re-exports. |
| `web/src/scene/interaction/InteractionModule.ts` | The scene module: pointer → pick → hover/select/focus/context menu; build mode → ghost; overlays; arcs; badges; labels; minimap model; bus topics; scene keys; lazy engine fetches per city + revision; `window.__magnateInteraction` QA handle. |
| `web/src/scene/interaction/interactionStore.ts` | **UI contract**: `useInteractionStore` (hover, overlay, legend, ghost, minimap, scene API) and `interactionBus` (`placementConfirmed / placementCancelled / placementRejected / buildingHovered`). |
| `web/src/scene/interaction/CitySource.ts` | **W2 contract**: `CityInteractionSource`, `provideCitySource(ctx, src)`, and `SceneGraphCitySource` (fallback over meshes tagged `userData.buildingId`). |
| `web/src/scene/interaction/Picking.ts` | `buildPickIndex()` + `pick()`: Amanatides–Woo grid DDA + exact ray/AABB per building (art §5.12, A.9). No GPU read-back. |
| `web/src/scene/interaction/Selection.ts` | Post-pipeline outline (hover 0.6 / selected 1.0) on the real mesh or a selection-layer proxy; inverted hull on the minimal pipeline. |
| `web/src/scene/interaction/FootprintRing.ts` | Flat lot outlines: gold ring decals, dashed selection ring, ghost border, catchment circle. |
| `web/src/scene/interaction/PlacementGhost.ts` | Ghost: hologram of the factory LOD0 geometry, validity cells, border + x-ray border, catchment ring (retail), status → colour, preview cache (≤ 1 query / 100 ms, keyed by plot + rotation, dropped on each engine revision). |
| `web/src/scene/materials/HologramMaterial.ts` | Unlit translucent hologram with validity tint, rising scanline and fresnel rim. |
| `web/src/scene/interaction/Overlays.ts` | Pure overlay builders (land value, traffic, zones, owners, profit, share, links) → R8 per-plot texture + legend; `OverlayController` drives W1's `CityUniforms.uOverlay*` (0.3 s fade); `autoOverlayFor(type)` (UX §6.6). |
| `web/src/scene/interaction/LinkArcs.ts` | Supply-flow arcs: quadratic Béziers roof → roof, width ∝ log10(1+qty), dashed + flowing; imports/exports to the nearest city edge in white. |
| `web/src/scene/interaction/Labels.ts` + `Labels.module.css` | DOM label pool: hover card, selection tag, ghost cost tag, world popups ("+$X"), landmark names. |
| `web/src/scene/interaction/Badges.ts` | Instanced 28 px billboards (▲ profit / ! warning / ▼ loss / ⧗ building) over your buildings; rival emblem on hover / Owners overlay; gold ring decal; colour-vision remap. |
| `web/src/scene/interaction/CityData.ts` | Decodes bridge `cityLayout` (E3a encodings) and builds the per-building model (owner, name, KPIs, status class) from `cityView`. |
| `web/src/scene/interaction/MinimapRenderer.ts` + `MinimapHud.module.css` | Pure minimap rendering (per-plot base image, owner footprints, gold ring, selection, camera frustum) and plot ↔ canvas mapping. |
| `web/src/ui/hud/Minimap.tsx` | Replaces U1's stub: canvas, click-to-select / click-drag-to-pan, city switcher, overlay bar (7 toggles), legend. |
| `web/src/scene/interaction/CameraRig.ts` | Unchanged from main this wave (now owned by W6); Q/E disabled while build mode is on. |
| `web/src/scene/interaction/__tests__/*.test.ts` | 36 unit tests: picking (20k-ray property test vs brute force), placement (anchor/rotation/status), overlays (each builder + legends), arcs + minimap mapping. |
| `web/src/scene/interaction/__tests__/interaction-shots.mjs` | Real-Chrome screenshot run: builds through the ghost and captures every state (→ `web/test-results/w6/`). |


---

## 2. Contracts for other workstreams

### 2.1 Build panel (U2) ↔ placement ghost

All in `web/src/scene/interaction/interactionStore.ts`.

1. The panel enters placement with `useUiStore.getState().setBuildMode({ typeId })` (U1's existing state). The ghost
   follows the cursor over the active city (`gameStore.activeCityId`), snapped to plots. Q/E rotate it (the camera's
   Q/E are disabled while build mode is on). `previewBuild { typeId, cityId, at: { px, pz, rotation } }` runs
   throttled (≤ 1 per 100 ms, cached by plot + rotation, cache dropped on every engine revision).
2. Live state for the panel's cost card: `useInteractionStore((s) => s.ghost)` →
   `GhostState { typeId, cityId, at: { px, pz, rotation } | null, w, h, status, issue, reason, preview, locked }`.
   `status` is `pending | valid | warning | blocked | own` (green / amber / red / grey, art §5.13). `reason` is a
   player-facing sentence; `preview` is the latest `BuildPreviewDto` for `at`.
3. Left click (or Enter) on a non-blocked ghost **locks** it on that spot (`ghost.locked = true`) and emits
   `interactionBus.emit('placementConfirmed', { typeId, cityId, at, preview, status, keepPlacing })`
   (`keepPlacing` = Shift held). A click on a blocked spot emits `placementRejected { typeId, at, issue, reason }`
   and flashes the ghost.
4. The panel shows its confirm card and then either:
   - calls `construct { typeId, cityId, at, initialSlot? }` and ends placement with `setBuildMode(null)`
     (or keeps it with `releaseGhost()` when `keepPlacing`), or
   - goes back to placing with `useInteractionStore.getState().releaseGhost()`.
5. Esc (U1's `uiStore.escape()`) clears build mode; W6 then emits `placementCancelled { typeId }`.
6. **Fallback:** if nothing listens to `placementConfirmed`, W6 constructs at `at` itself (engine `construct` with
   `at`, store sync, `buildingPlaced` bus event, cost popups) and leaves build mode unless Shift was held. The ghost
   therefore works before U2's panel lands.

### 2.2 City renderer (W2) → interaction

`web/src/scene/interaction/CitySource.ts` defines what W6 needs:

```ts
interface CityInteractionSource {
  readonly cityId: string | null; readonly gridW: number; readonly gridH: number;
  readonly revision: number;                       // bump when buildings / boxes change
  getPickIndex(): PickIndex | null;                // Picking.ts shape (cellBuilding, boxes, ids, maxHeight)
  getBuilding(id): CityBuildingRef | null;         // { id, px, pz, w, h (rotated plots), box: world AABB }
  buildings(): Iterable<CityBuildingRef>;
  getBuildingObject?(id): THREE.Object3D | null;   // optional: outline the real mesh; else W6 builds a proxy
  getLayout?(): LayoutGrid | null;                 // optional: decoded cityLayout (else W6 fetches it)
}
provideCitySource(ctx, source)   // W2 calls this from its module's init (and with null on dispose)
```

`buildPickIndex(gridW, gridH, entries)` in `Picking.ts` builds the index from `{ id, px, pz, w, h, box }` entries
(factories' `AssetOutput.pickBox`). Until a source is provided, W6 derives the same data from scene objects tagged
with `userData.buildingId` (today's `PlaceholderCity`).

### 2.3 UI (minimap, HUD) ↔ scene

- `useInteractionStore`: `overlay` (`landValue | traffic | zones | owners | profit | share | links | null`),
  `setOverlay`, `toggleOverlay`, `cycleOverlay`, `overlayLegend` (published by the scene), `hoveredBuildingId`,
  `linksFor` / `showLinksFor(id)` ("Show supply links"), `minimap` + `minimapView` (model and camera footprint in plot
  coordinates, ≤ 10 Hz), `scene.panToPlot(px, pz)` / `scene.focusBuilding(id)`.
- Bus topics consumed by W6 (U1's `game/events.ts`): `locate` (frame a building or city), `worldPopup` (floating
  "+$X" over a building), `buildingSelected` (outline + gold ring).
- Scene keys handled by W6: Home (frame HQ / first building), Tab / Shift+Tab (cycle your buildings), O / Shift+O
  (cycle overlays), Shift+1…7 (toggle a specific overlay), Q/E + Enter in build mode, double-click focus,
  right-click context menu on a building.

### 2.4 Context menu → panels

Right-click on a building opens U1's `ui.openContextMenu` with: Inspect, Focus camera, Show supply links, and for your
own buildings Set price… (`openPanel('inspector', { buildingId, tab: 'setup' })`), Advertise here…
(`openPanel('marketing', { buildingId, cityId })`), Upgrade… and Sell or demolish… (`inspector` tab `finance`).
Right-click on empty ground offers "Build here…" (`openPanel('build')`). U2/U3: honour these tab ids or tell W6 to
change them.

### 2.5 QA handle

`window.__magnateInteraction` (dev + prod builds, removed on dispose): `store`, `bus`, `screenOf(id)`,
`screenOfPlot(px, pz)`, `buildings()`, `grid()`, `focus(id)`, `panToPlot(px, pz)`, `engineCall(method, args)`.
Used by `interaction-shots.mjs`; other QA scripts may use it too.

---

## 3. Behaviour notes

- **Picking** runs once per frame only when the pointer moved or the source revision changed; it is a DDA over the
  plot grid, so cost scales with ray length, not building count.
- **Ghost anchor** is the plot under the cursor (stable under rotation, art §5.13); `at` is the NW plot of the rotated
  footprint, the bridge `PlacementDto` convention. Status: green valid, amber cash short / runway < 3 months,
  red blocked with the bridge `PlacementIssue` reason ("Can't build over a road"), grey over your own building.
- **Auto overlay while placing** (UX §6.6): if no overlay is on, build mode turns on retail → Traffic,
  farms/mines → Zones, else Land value; the previous overlay (or none) is restored when build mode ends.
- **Engine fetches**: `cityLayout` once per city; `cityView` on every engine revision; `supplyFlows` only while Links
  is on or "Show supply links" is active; `marketDetail` only while Market share is on. Missing methods degrade to an
  `console.warn` and an empty/absent overlay, never a page error.
- **Store writes**: hover and ghost on change only; camera footprint ≤ 10 Hz; no per-frame React state.

---

## 4. Verification (2026-10-02)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors (no C# touched by W6) |
| `dotnet test Magnate.sln --no-build` | Engine 863/863, Bridge 201 passed + 4 skipped |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run` | 34 files, 646 passed, 3 skipped (W6: 4 files, 36 tests) |
| `npx vite build` | OK |
| `node scripts/smoke.mjs` | SMOKE OK |
| `node src/scene/interaction/__tests__/interaction-shots.mjs` | W6 SHOTS OK: 24 steps, 0 page errors |

Screenshots in `web/test-results/w6/` (inspected): `ghost-valid` (green hologram + catchment + cost card),
`ghost-invalid` (red on a road, "Can't build over a road"), `ghost-rotated-catchment` (department store, 270°),
`hover` (outline + hover card), `selected` (outline, dashed gold ring, name tag, inspector open), `context-menu`,
`hover-rival`, `badges-district` / `badges-city` (gold rings + profit badge), `overlay-landValue / traffic / zones /
owners / profit / share / links` (each with its minimap legend), `links-building` (one store's import arc),
`world-popup` ("+$412K").

---

## 5. Known gaps

- **W2 city renderer not yet providing a source.** W6 runs on `SceneGraphCitySource` (meshes tagged
  `userData.buildingId`). When W2 lands it should call `provideCitySource(ctx, src)`; outlines then use the real mesh
  via `getBuildingObject`, otherwise a proxy box.
- **Catchment radius is a constant** (6 plots). The engine has no per-type catchment in `BuildPreviewDto`; when it
  does (E1/B2), feed it to `PlacementGhost`.
- **Traffic overlay** reads the layout's static traffic grid (E3a); it does not yet reflect live footfall.
- **Context-menu tab ids** (`setup`, `finance`) are W6's guess at U2's inspector tabs; U2 must confirm them.
- Landmark labels come from the optional `landmarks` list in `cityLayout`; a layout without it shows none.

## 6. Requests

- **W2:** call `provideCitySource(ctx, source)` from the city module's init (and with `null` on dispose); expose
  `getBuildingObject(id)` so the outline wraps the real mesh, and bump `revision` when buildings change.
- **U2:** consume `interactionBus 'placementConfirmed'` (§2.1). Until you subscribe, W6's fallback constructs directly.
- **B2/E1 (optional):** add a catchment radius (plots) to `BuildPreviewDto` for retail types.
