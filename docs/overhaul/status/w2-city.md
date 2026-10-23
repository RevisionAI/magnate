# W2 city: status

Branch `w2-city` · Wave 2 · owner W2 (the real 3D city) · 2026-10-02

**Status: done.** The game screen renders the real generated city of each map: engine layout (`cityLayout`, cached
per city and `layoutRev`) and company buildings (`cityView` + revision deltas), built in 10 × 10-plot chunks by two
Web Workers with the W3/W4 asset factories. It covers terrain (Hilltown/Riverside), water banks, quays and beaches,
roads with markings, sidewalks, crosswalks, signals and bridges, lots and ambient buildings, and company buildings
with owner colour, level, construction stage and closed state. Props (trees, lamps, parked cars…) are partitioned
instanced families. Picking is a grid DDA.

W5 (living city) and W6 (interaction) are fed through their own contracts (§2.6, §2.7). E3b's two requests are in:
construction stages advance with the clock, and `layoutRev` updates rebuild only the chunks that changed. LOW on the
UHD 630 at 1080p is within the D7 draw-call and triangle budgets. GPU time is about 11–13 ms on an unloaded machine
and 12–18 ms on this throttled shared machine (§4.3). `PlaceholderCity` is retired.

## 1. File map

| Path | What |
|---|---|
| `web/src/scene/city/index.ts` | `createCityModules()` (GameScreen composes it) and the public exports |
| `scene/city/CityModule.ts` | The scene module: fetches the layout and views, specs per company, services, SceneWorld, audio land use, construction day interpolation, incremental layout revisions, W5/W6 adapters |
| `scene/city/CitySource.ts` | `CitySource` interface; `GameCitySource` (zustand store + engine client + game clock) |
| `scene/city/CityServices.ts` | `CityServices` contract and per-scene registry (`getCityServices`, `onCityServices`) |
| `scene/city/companies.ts` | `BuildingVisualDto` → `CompanySpec`: rotation, facing (art §5.3), stage/progress, quantised utilization/activity |
| `scene/city/layout/{types,decode,diff}.ts` | Wire types, per-plot decoding (E3a encodings), and the layout-revision diff |
| `scene/city/RoadNetwork.ts` | Road tiles, masks, nodes, edges and lanes (pure) |
| `scene/city/ChunkManager.ts` | Worker pool, dirty queue, nearest-first dispatch, swaps, LOD0/LOD1, **far blocks** (2 × 2 chunks merged at LOD1), signs, far-lamp points, picks, emitters/parts registry |
| `scene/city/chunk.worker.ts`, `chunkProtocol.ts` | Worker entry and message types (transferables) |
| `scene/city/build/buildChunk.ts` | One chunk: road tiles, open land, beaches, parcels, company lots (deterministic) |
| `scene/city/build/CityBuildContext.ts` | Decoded grid + surface model (terrain, beach dips, bridge arches, terraces, company covers) |
| `scene/city/build/ChunkWriter.ts`, `prims.ts` | Two-LOD geometry writer with height post-pass and relighting; ground/curb/wall primitives |
| `scene/city/build/RoadBuilder.ts` | Road tiles per art §3.2/§5.15: carriageway cells, curbs, corner fillets, markings, zebras, stop lines, medians, guard rails, bridge decks/parapets/piers, furniture (lamps + pools, street trees, signals, bus shelters) |
| `scene/city/build/ground.ts` | Open land, beaches, banks/quays/retaining walls, edge apron to the flat outskirts |
| `scene/city/build/lots.ts` | Parcels (ambient kinds via the registry, fallbacks, remnants around companies) and company lots (pad, walls, factory or construction site or stand-in) |
| `scene/city/build/rural.ts` | Kit-based lots no family models: fields, pastures, orchards, vineyards, scrub, forest, deposits, tank farms, sheds, vacant lots, remnants |
| `scene/city/PropLayer.ts` | Instanced prop families per 400 m cell and LOD, distance bands, tree-shadow policy, light pools |
| `scene/city/PickIndex.ts` | Grid-DDA picking of buildings, ambient lots and ground (terrace heights) |
| `scene/city/signs.ts` | Sign quads → SignAtlas slots (company wordmarks, local boards, civic text) |
| `scene/city/world.ts` | SceneWorld (water mask, highway exits), audio land-use grid, surface heights, parcel ids |
| `scene/city/interactionSource.ts` | **W6 adapter**: `CityInteractionSource` (pick index, building refs, real outline objects) |
| `scene/city/livingSource.ts` | **W5 adapter**: `CitySource` (road classes and heights, land use, traffic, buildings with emitters/parts) |
| `scene/city/__tests__/**` | 9 suites, 38 tests, with engine layout fixtures (Hilltown, Portbay) |
| `web/src/dev/CityPreview.tsx`, `dev/cityPreview/{source,demo}.ts` | `?dev=city`: all five cities, camera presets, day/night, month, tier, demo company set, benchmark |
| `dev/cityPreview/tour.mjs` | One-browser screenshot tour over cities × views × hours, with `--probe` for evaluating JS |
| ~~`web/src/scene/modules/PlaceholderCity.ts`~~ | Deleted (unused since `createCityModules()`) |

## 2. APIs and contracts for other workstreams

All coordinates are world metres (`scene/units.ts`): the city is centred on the origin, plot (0, 0) is the NW corner,
+X is east and +Z is south. Plot centres sit at `((px + 0.5 − gridW/2)·24, (pz + 0.5 − gridH/2)·24)`.

### 2.1 Getting the city: `CityServices`

`GameScreen` composes `createCityModules()` (from `scene/city/index.ts`, wired by the lead through
`scene/modules/index.ts`), which returns one `CityModule`. The module publishes a `CityServices` object per
`SceneContext` once a layout is decoded, and republishes it on every city switch or `layoutRev` change.

```ts
import { onCityServices, getCityServices, type CityServices } from '@/scene/city';

init(ctx: SceneContext) {
  this.off = onCityServices(ctx, (city) => {        // fires at once if already published; null on dispose
    if (!city) return;
    city.roads;             // RoadNetwork (§2.2)
    city.onChange((c) => {  // 'layout' | 'buildings' | 'life' | 'picks'
      if (c === 'life') this.emitters = city.getEmitters();
    });
  });
}
```

| Member | What it gives |
|---|---|
| `cityId`, `layoutRev`, `grid` | The decoded layout (`CityGrid`: per-plot `kind`, `road`, `bridge`, `district`, `slope`, `landValue`, `traffic`, `parcelAt`, `shore`, corner `heights`, `parcels`, `landmarks`, `deposits`, `cbd`, `urbanRadius`, `lanes`) |
| `roads` | `RoadNetwork` (§2.2) |
| `pick(ray)` / `pickClient(clientX, clientY)` | `CityPick` (§2.3) |
| `groundHeight(x, z)` | Ground surface at a world point: parcel and company terraces, terrain-following roads and open land, bridge decks |
| `buildings()` | `ReadonlyMap<id, CityBuilding>`: `{ id, dto: BuildingVisualDto, lot: LotInfo, utilization }` for the active city |
| `buildingBox(id)` / `parcelBox(parcelId)` | World AABB of a company building / ambient building (from the factory pick boxes), null until built |
| `lotOfBuilding(id)`, `lotOfParcel(parcelId)` | `LotInfo` (§2.4) |
| `footprintLot(px, pz, fw, fh, rotation)` | `LotInfo` for a hypothetical footprint (placement ghost); `rotation` 0/90/180/270 puts the front S/E/N/W, as `PlacementResult.Rotation`; null out of bounds |
| `facingFor(px, pz, w, h)` | Street-facing side (quarter turns) a footprint gets from road adjacency (art §5.3) |
| `getEmitters()` | `ChunkEmitter[]`: every built lot's particle emitters (W3/W4 `Emitter` + `buildingId`, `owner`), world metres, terrace height applied. Rescale `rateAtFull` by `utilization(buildingId)` |
| `getAnimatedParts()` | `ChunkAnimatedPart[]`: pumpjacks, cranes, conveyors… (W4 `AnimatedPart` + `buildingId`), pose with W4's `partPose` |
| `utilization(buildingId \| null)` | Live 0–1 utilization of a company building from the latest `cityView` activity (ambient lots: 0.6) |
| `onChange(listener)` | `'layout'` (new services object follows), `'buildings'` (cityView applied), `'life'` (emitters/parts changed after chunk swaps), `'picks'` (pick boxes changed) |
| `whenReady()` | Resolves once every chunk of the current layout is built |

### 2.2 Road network (W5 traffic, trucks, pedestrians)

`RoadNetwork` (`scene/city/RoadNetwork.ts`) is pure and deterministic, built once per layout from the per-plot kinds.

- **Tiles** (`roads.tiles`, `roads.tile(px, pz)`, `roads.tileAt[i]`): every road or bridge plot with its 4-bit mask
  (`MASK_N = 1`, `MASK_E = 2`, `MASK_S = 4`, `MASK_W = 8`), `type` (`isolated | deadEnd | straight | corner | tee |
  cross`), class `cls` (`R_LOCAL 1`, `R_COLLECTOR 2`, `R_ARTERIAL 3`, `R_HIGHWAY 4`), `lanes`, `bridge`, and its
  `node` / `edge` id.
- **Nodes** (`roads.nodes`): every non-straight tile plus edge tiles. `{ id, px, pz, x, y, z, mask, type, cls, signal,
  exit: 'N'|'E'|'S'|'W'|null, edges }`. `signal` = 3+ arms with an arterial or highway (traffic lights are drawn
  there); other 3+-arm nodes are all-way stops. `exit` marks a road leaving the map (highways continue into W1's
  outskirts).
- **Edges** (`roads.edges`): straight runs between nodes. `{ id, a, b, plots, axis, cls, lanes, length, laneOffsets,
  halfWidth, bridge }`.
- **Lanes** (right-hand traffic, art §5.16): `roads.lanePoint(edge, forward, lane, t)` returns `{ x, y, z, yaw }`
  on lane `lane` (0 = innermost) at `t ∈ [0, 1]` from a to b (`forward`) or b to a. `yaw` is a three.js
  `rotation.y` for a model whose forward is +Z. Lane offsets: streets ±1.75 m; arterials ±2.625 / ±5.875 m around a
  2 m median; highways 2 or 3 lanes per direction.
- Helpers: `carriageHalfWidth(cls, lanes)`, `laneOffsets(cls, lanes)`, `cornerRadius(cls)` (6 m, 9 m with an
  arterial), `tileTypeOf(mask)`, `roads.heightAt(x, z)` (road surface height incl. terrain), `roads.plotCenter(px, pz)`,
  `roads.classAt(px, pz)`, `roads.other(edge, node)`.

### 2.3 Picking (W6)

`city.pick(ray)` walks the plots under the ray (Amanatides–Woo DDA over the plot grid) and tests the AABB of the lot
standing on each plot; the ground hit uses each plot's surface height, so terraces and slopes pick the right plot.

```ts
type CityPick =
  | { kind: 'building'; id: number; point: Vector3; px: number; pz: number }        // company building id
  | { kind: 'parcel'; parcelId: number; point: Vector3; px: number; pz: number }    // ambient building's parcel
  | { kind: 'plot'; px: number; pz: number; point: Vector3; parcelId: number | null }; // bare ground
```

### 2.4 Lot frames (W6 ghosts, badges, labels; W5 construction FX)

```ts
interface LotInfo {
  px: number; pz: number; w: number; h: number;   // NW plot, world-aligned size (rotation applied)
  turns: 0 | 1 | 2 | 3;                           // street-facing side: 0 S, 1 E, 2 N, 3 W (AssetFactory lot frame)
  x: number; y: number; z: number;                // lot centre; y = terrace height
  widthM: number; depthM: number;                 // along the street / away from it
  bounds: THREE.Box3;                             // plots' AABB from the terrace to +1 m
}
```

To build a placement ghost with the real factory: `lotFrame(lot.x, lot.z, w, h, facing, 24)` from
`assets/AssetFactory.ts` with the content footprint, then lift the result by `lot.y`.

### 2.5 Other hooks

- **SceneWorld**: the module calls `ctx.setWorld(...)` per city (water per plot, highway exits, relief, climate,
  population), so the camera bounds, outskirts, water and fog follow the real layout.
- **Audio**: `ctx.setAudioAreaSource(LandUseGrid)` from the layout's land use, with company buildings on top
  (construction sites count as `construction`).
- **Seasons**: the game month drives `env.setGameMonth`; crops and trees rebuild with the month (only chunks with
  crops rebuild monthly; every chunk rebuilds on a season change).
- **Layers**: chunk meshes are on `LAYER_OCCLUDER`; `ctx.requestShadowUpdate()` is called after swaps.
- **Layout revisions (E3b).** When `cityView.layout.layoutRev` moves, the layout is refetched once per revision.
  `layout/diff.ts` compares the decoded grids plot by plot (kind, road, bridge, lanes, district, slope, shore, terrain
  corners, and each parcel's geometry, zone, facing, vacancy, landmark, deposit and ambient kind). Only the chunks
  that touch a changed plot or its neighbours rebuild. Old meshes stay on screen until their replacements swap in.
  A revision that only moves land value, traffic, ownership or listings rebuilds nothing. `CityServices` is still
  republished with `'layout'`; `city.roads` keeps the **same object** when the road network did not change, so W5 can
  skip rebuilding its graph.
- **Construction (E3b).** `status: 'underConstruction'` with `construction.progress` draws W4's construction site
  (foundation, structure, finishing) for the target type. Between month closes the progress is interpolated with the
  game clock (`clock.progress`): one month of an N-month schedule is 1/N. It is quantised to 1/20 steps, never steps
  backwards, and stays below 1 until the engine reports completion. Each project therefore rebuilds its chunk a few
  times a month.

### 2.6 W6 interaction: `CityInteractionSource`

`scene/city/interactionSource.ts` implements W6's contract (`wt/w6-interaction/.../scene/interaction/CitySource.ts`)
structurally. The city module registers it from `init()` (null on dispose) through an eager
`import.meta.glob('../interaction/CitySource.ts')`. That glob is empty on this branch and binds to W6's
`provideCitySource` after the merge, so no merge edit is needed.

- `getPickIndex()`: W6's packed grid index (`cellBuilding`, `boxes`, `ids`, `maxHeight`) built from the factories'
  pick boxes. It is rebuilt and `revision` bumps on every `'buildings'` / `'picks'` change.
- `getBuilding(id)` / `buildings()`: `{ id, px, pz, w, h (rotated plots), box }` for every built company building.
- `getBuildingObject(id)`: the building's **own geometry**. Its LOD1 is rebuilt on the main thread with the same
  factory and parameters the chunk worker used, lifted to its terrace, and put on `LAYER_SELECTION` only, so the
  camera never draws it twice. It stays parented while valid. When the building changes (level, stage, owner,
  footprint) the old object is removed from the scene, so W6 asks again (W6 refreshes when `obj.parent === null`).
- `getLayout()` is not provided: W6 keeps its own `cityLayout` fetch (its `LayoutGrid` uses different kind codes).

### 2.7 W5 living city: `CitySource`

`scene/city/livingSource.ts` implements W5's `CitySource` (`wt/w5-life/.../scene/dynamic/source/types.ts`). It is
registered through an eager glob of `../dynamic/source/registry.ts` (`registerCitySource`), the same way as §2.6.

- **Layout** (`'layout'`, with `rev` bumping on every install):
  - Road class per plot: 1 street, 2 arterial, 3 highway.
  - **`roadY`**: the real road surface at each plot centre, including terrain and the bridge arches, so vehicles do
    not float at W5's fallback +6 m deck.
  - Water mask, land use (W5 `USE_*` codes), traffic 0–1, highway exits, seed, population, coastal.
- **Buildings** (`'buildings'`): every company building with lot, facing, owner, level, status and progress.
  `height` comes from the factory pick box above the terrace. `parts` and `emitters` are exactly what the factory
  produced in the chunk build, grouped by building.
- Ambient buildings' emitters and parts (for example ambient factory chimneys) are only on `CityServices.getEmitters()`
  and `getAnimatedParts()`, with `buildingId: null`.

---

## 3. Decisions and deviations

| Item | Spec | Here | Why |
|---|---|---|---|
| Far LOD | LOD1 per chunk beyond 1,400 m | Plus **far blocks**: when all 4 chunks of a 2 × 2 block are at LOD1, one merged mesh replaces them (one merge per frame, rebuilt when a member changes) | Draw calls at overview fell from 213 static / 275 moving to 118–129 / 136–147 (the chunk meshes are drawn twice, by the occluder pre-pass and the colour pass, plus once in the shadow pass) |
| Remnant land | — | Parcel plots left beside a company building become a paved apron next to it (town) and the district's vacant ground beyond: gravel, yard or lawn | A large parcel with a 3 × 3 store read as an empty plaza |
| Vacant lots | — | Detail (weeds, trees) scales with lot area | Big vacant blocks read bare |
| Interim placements | art §5.3 | Square footprints with `source !== 'engine'` face their best road; engine placements keep their rotation | Interim rotations carry no meaning |
| Utilization / activity in specs | live | Quantised (utilization to 0.25 steps, activity to log buckets); live values go to emitters through `utilization(id)` | Ordinary monthly swings must not rebuild chunks |
| Construction progress | monthly from the engine | Interpolated with the clock, 1/20 steps, monotonic | E3b request 2 |

---

## 4. Verification

### 4.1 Gates (2026-10-02, final tree)

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 warnings-as-errors, 0 errors (no engine change on this branch) |
| `dotnet test Magnate.sln --no-build` | Engine 863 passed; Bridge 201 passed, 4 skipped |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run` | 39 files passed (1 skipped), 648 tests passed, 3 skipped; city suites: 9 files, 38 tests |
| `npx vite build` | built |
| `node scripts/smoke.mjs` | `SMOKE OK`: the game screen boots into the real Metropolis layout and frames the player's supermarket. One earlier run failed on an A1 audio error, not from this branch (see Requests) |

City unit tests cover:
- Layout decoding.
- Road masks, nodes, edges and lanes.
- Chunk coverage, determinism and budgets.
- Terraces and slope normals on Hilltown.
- Month and season rebuild rules.
- Company specs: rotation, facing, stages and **clock interpolation**.
- PickIndex against brute force on random rays.
- The ChunkManager in-thread build: a company change rebuilds at most 4 chunks; **far blocks** merge exactly the LOD1 triangles.
- **Layout revisions**: a developed parcel rebuilds only its chunk, value-only revisions change nothing, and the
  new house is pickable.
- The **W6 adapter**: packed index and an outline object on `LAYER_SELECTION` only, replaced on change.
- The **W5 adapter**: road classes, road heights on Hilltown, and emitter grouping.

### 4.2 Screenshots (read and iterated)

`node src/dev/cityPreview/tour.mjs --prefix final` → `web/test-results/shots/final-<city>-<view>-<hour>.png`. That is
five cities × overview/district/street × 13:00/22:30 (30 shots), plus `hills` (Hilltown, Riverside), `port`
(Metropolis, Portbay) and `site` (construction).

What they show:
- Dense CBD towers on Metropolis, varied residential and commercial blocks, and industry and the port with ships and
  cranes.
- Riverside's river with quay walls and arched bridges; Hilltown's terraced lots with retaining walls.
- Lit windows, lamp pools and the far-field lamp grid at night.
- Construction sites at their stage; the in-game smoke screenshot (`test-results/04-after-month.png`) shows the real
  city.

Checked and fixed in this session:
- The vacant land beside company buildings (plaza → apron + vacant ground, with no plot seams).

Checked and not fixed:
- The dark flat "slabs" in the CBD are the roofs of large `ambient:midrise` buildings (W4 asset; see Requests).
- Parked cars hide beyond the 700 m band, so car parks read empty at the district view (art band, as specified).

### 4.3 Performance: Metropolis, 1920 × 1080, DPR 1

Method as in w1-render §4.3: `?dev=city&bench=1` with drained throughput (median of 5 × 40 frames) and the timer query.

How to run it:
```
node src/dev/cityPreview/tour.mjs --cities metropolis --views district --hours 13 --no-shot \
  --query "&power=low-power&tier=low" --probe "window.__cityPreview.bench({tiers:['low'],hours:[13,22.5]})"
```

Measurement conditions:
- Up to 10 engineers were building on this machine (load average 7–64).
- `CPU_Speed_Limit` was 39 % at the end, and the iGPU shares that power budget.
- The table therefore shows the best (least loaded) run next to the last run.

**LOW, Intel UHD 630** (GPU ms static / moving; calls static / moving; triangles static / moving):

| Hour | View | GPU, load ≈ 14 (before far blocks) | GPU, throttled final run | Calls (final) | Triangles (final) |
|---|---|---|---|---|---|
| 13:00 | overview | 10.7 / 11.0 | 15.8 / 15.4 | 118 / 136 | 208k / 259k |
| 13:00 | district | 12.6 / 13.5 | 17.0 / 18.2 | 155 / 216 | 433k / 639k |
| 13:00 | street | 9.0 / 9.5 | 11.2 / 11.3 | 67 / 85 | 237k / 304k |
| 22:30 | overview | 11.3 / 11.7 | 12.5 / 12.1 | 129 / 147 | 208k / 259k |
| 22:30 | district | 12.8 / 13.8 | 12.8 / 14.8 | 177 / 247 | 436k / 661k |
| 22:30 | street | 9.9 / 10.6 | 10.4 / 12.1 | 83 / 105 | 239k / 319k |

**Against the D7 budgets:**
- **≤ 250 draw calls:** met. The maximum is 247 (night district, moving). Before far blocks, the overview was 275
  moving.
- **≤ 700k triangles:** met. The maximum is 661k.
- **JS submit:** 2.3–5.4 ms on the throttled CPU, which is over the 2.5 ms budget in the district view.
- **≤ 14 ms GPU:** met in every view when the machine is not throttled (9.0–13.8 ms). Under heavy throttling the
  district and day overview reach 15–18 ms. W1's governor covers that: its first notch, 90 % resolution, saves
  1.5–2 ms.

**HIGH, Radeon Pro 5500M** (load ≈ 30–64, so pessimistic): GPU 8.4–16.3 ms static / 11.9–16.9 ms moving, 139–189 calls
static, 209–443k triangles.

---

## 5. Known gaps

- **JS submit in the district view** runs 3–5 ms on the throttled CPU. The scene holds about 600 objects (549 of them
  city chunks, signs and prop cells; about 320 visible), and three.js re-sorts and re-uploads the uniforms of each
  visible one. Merging the sign meshes into the far blocks and coarser prop cells for the LOD1 tree band would trim it.
- **Dead-end roads** draw a square turning area with a dashed ring, not a rounded cul-de-sac with a continuous curb.
- **Shoreline:** the water's shallow band follows plot steps. W1's water shades it from the per-plot mask, so
  diagonal coasts look stepped from above.
- **Midrise roofs:** large `ambient:midrise` footprints show big flat dark roofs that read as empty lots from the
  district view (W4 asset).
- **LOD1 glass towers at night** glow as flat pale blocks at overview distance. This comes from W1's material
  averaging over far facades.
- **No `getLayout()` for W6.** W6 keeps its own `cityLayout` fetch.
- **Bridge road height for W5** is sampled at plot centres. Along a 3-plot arch, the plot ends sit up to about 1 m
  lower than the centre sample.

## 6. Requests

1. **W4 (assets B):** `ambient:midrise` on 2 × 3 and 3 × 3 lots needs a lighter roof and rooftop clutter (plant rooms,
   water tanks, a terrace or green roof). From the 760 m district view, their dark flat roofs read as empty asphalt
   lots in the CBD.
2. **W1 (render core):** consider a warmer, dimmer LOD1 night facade average for curtain-wall towers, and shoreline
   shading that smooths the per-plot steps (for example a distance field blurred over 2–3 plots).
3. **A1 / A3 (audio):** a flaky smoke failure happens in about 1 of 4 runs. `[bus] handler for gameEvent failed`
   comes from `NotSupportedError: setTargetAtTime … overlaps setValueCurveAtTime` in `playStinger` (music stinger
   ducking during a fade), reached through the music `execute` path on a month close at 8×.
4. **Lead (merge):** the W5/W6 adapters need no merge edits, because both bind through `import.meta.glob`.
   `modules/PlaceholderCity.ts` is deleted here. Every other branch imports it only through main's old
   `scene/city/index.ts`, which this branch replaces, so take W2's `scene/city/**` wholesale. W5's `PlaceholderSource`
   (`dynamic/source/SyntheticSource.ts`) mirrors its parameters but does not import it. It becomes dead once W2's source
   is registered. The comment in `ui/hud/Minimap.tsx` (U1) is stale.
