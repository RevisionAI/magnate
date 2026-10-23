# W5 · life — the living city — status

Workstream: **W5, the living city** (Wave 2). Branch `w5-life`.
Status: **done.** All web gates and the smoke test are green. The engine gates are green apart from one timing test that
fails only under machine load; it passes on its own (§4.1). The real game was driven headlessly through the tutorial
and run for several months at 8×. The screenshots were read and the work iterated on what they showed (§4.2).

What W5 delivers (art §3.16, §5.16–5.21, Appendix A.13; UX §8):
- **Traffic:** IDM traffic on a road graph. Cars, hatchbacks, SUVs, vans, box trucks, taxis and buses move at a density
  driven by population, the traffic field, the time of day and the graphics setting.
- **Company trucks** on the player's and rivals' real `supplyFlows` transfers. Each truck is A*-routed and painted in
  its owner's colour. Import/export trucks run in neutral white to and from the port quay or a highway exit.
- **Pedestrians and shoppers:** people walk the sidewalks, and shoppers gather around busy stores.
- **Particles:** smoke, steam, dust and flares from working buildings, scaled by utilization.
- **Animated parts:** pumpjacks, sheave wheels, port gantries, flags and site cranes.
- **Construction sites:** workers on site, and delivery trucks running to the site gate.
- **Ships:** ships on the shipping lanes, and ships at anchor off a trading seaport.
- **Weather:** rain and snow particles.
- **World effects:** popups, confetti, coin and dust bursts, the rival beacon, beams, the gold ring and insolvency
  desaturation.

---

## 1. File map

All files are new unless marked. Paths are relative to `web/src/scene/`.

| File | What it is |
|---|---|
| `dynamic/index.ts` (prep stub, now filled) | `createDynamicModules(options)`, the hook `modules/index.ts` composes. Also `createLivingCity(options)`, which returns every module and is published as `window.__livingCity` for diagnostics. Re-exports `registerCitySource` and the source types. |
| `dynamic/LivingCity.ts` | **Hub module, added first.** Resolves the city source and follows the economy (`EconomyFeed`). It merges both into `LiveBuilding`s, rebuilds the road graph per layout `rev`, owns the animation clock (`animTime`) and decides `frozen` (paused or reduced motion). Events: `layout`, `buildings`, `economy`. |
| `dynamic/source/types.ts` | **The W2 ↔ W5 contract** (§2.1): `CitySource`, `DynamicLayout`, `DynamicBuilding`, `SourceEvents`, the `USE_*` land-use codes and `isRetail`/`RETAIL_CATEGORIES`. |
| `dynamic/source/registry.ts` | `registerCitySource(ctx, source)`, `registeredCitySource`, `onCitySource`. Keyed by `THREE.Scene`, with no import cycle. |
| `dynamic/source/EconomyFeed.ts` | Reads `cityView` (full, then deltas) and `supplyFlows` on every tick (bus `tick`), after a construction (`buildingPlaced`), on a new game and on a city switch. Produces visuals, `activity` (utilization, unitsSold, transfersIn/Out, revenue, NI) and flows. Never re-derives game logic. |
| `dynamic/source/buildingFx.ts` | Re-runs a building's AssetFactory (pure and deterministic) to recover its `animated` parts, `emitters` and roof height. Also has `facingByFrontage` and `frontPlot`. |
| `dynamic/source/SyntheticSource.ts` | `PlaceholderSource` adapts W1's interim `PlaceholderCity`: it regenerates the same synthetic layout and reads each company lot back from the `company-buildings` meshes. `StaticSyntheticSource` serves labs and tests. |
| `dynamic/source/BridgeSource.ts` | The fallback when nothing is registered and no PlaceholderCity exists. It builds the layout from bridge `cityLayout` (E3a plot strings, roads, terrain, bridges) and the buildings from `cityView` placements. |
| `dynamic/traffic/RoadGraph.ts` | Nodes, edges and lanes (art §3.2 lane offsets), and turn connectors (Bézier turns and U-turns). Also signals (50 s-class cycle, green-wave offsets), all-way stops, `findRoute` (A* over arms) and `roadAccess`. |
| `dynamic/traffic/TrafficIdm.ts` (reference A.13) | IDM. Only change: the `delta = 4` fast path (r⁴ by multiplies instead of `Math.pow`). |
| `dynamic/traffic/TrafficSim.ts` | Pure simulation at a fixed 20 Hz with interpolated poses. It covers car following, red lights, stop lines, a junction box reservation, left turns yielding, don't-block-the-box, and a 40 s stuck watchdog. Routed vehicles drive to a stop position. Deterministic per seed. |
| `dynamic/traffic/TrafficModule.ts` | Ambient density, spawn and retire, truck dispatch from `Trucks.ts`, `dispatchService` (site deliveries) and `pickTruck(ray)`. Owns the `VehicleRenderer`. |
| `dynamic/traffic/VehicleRenderer.ts` | One InstancedMesh per model and LOD (`DynamicDrawUsage`), compacted each frame, with per-vehicle frustum culling. LOD1 boxes beyond 500 m, ambient traffic hidden beyond the 1,100 m band, company trucks drawn as owner-coloured road dots at city zoom. |
| `dynamic/Trucks.ts` | `planTrips`: trips = clamp(ceil(qty / 400), 1, 6) per transfer link, spread over the visual month by a month seed. Also `truckModelFor` (box truck to stores, semi with a product trailer otherwise) and `TripScheduler`. |
| `dynamic/Pedestrians.ts` | Sidewalk corner graph (crossings at zebras), wanderers by land use × day curve × tier cap, and shoppers per store = min(40, round(6·log10(1 + unitsSold))). Simulated within 600 m, drawn within the 420 m band. |
| `dynamic/Particles.ts` | GPU particles: one `InstancedBufferGeometry` per kind with static per-puff attributes and an animated vertex shader. Pools of 16 puffs per emitter, with `rate` switching puffs on and off. |
| `dynamic/ParticlesModule.ts` | Collects building emitters plus extras (site dust), rates them by live utilization (`rateAtFull × utilization`), keeps the nearest within 2,600 m under the tier cap, and rewrites attributes only when the set changes. |
| `dynamic/AnimatedParts.ts` | W4 `PART_SPECS` geometry per part kind, instanced and owner-tinted. Poses come from W4 `partPose` on the hub clock. Parts animate only while the building is working or under construction. |
| `dynamic/ConstructionSites.ts` | Hi-vis site workers by footprint and three deliveries per visual month from the nearest highway exit to the site gate. |
| `dynamic/Ships.ts` | Shipping lanes offshore of each sea edge with transit container ships, and anchorage ships off a working seaport while the city trades. Poses are a pure function of the clock. |
| `dynamic/WeatherFx.ts` | Draws W1's `env.weatherState` (`rain`, `snowfall`, `wind`) through `env/WeatherParticles.ts`. Hidden under reduced motion. |
| `env/WeatherParticles.ts` | `PrecipitationLayer`: GPU rain streaks (4,000 LOW / 8,000 MED+) and snowflakes (3,000) on a world-anchored lattice inside a volume that follows the target and stops at the camera height. |
| `dynamic/WorldFx.ts` | UX §8 effects: `worldPopup` sprites, confetti, coins, dust bursts, the red rival beacon, tech and milestone beams, the goal ring, and `env.cityDesaturation` = 0.2 while cash < 0. |
| `assets/families/vehicles/index.ts` | Vehicle geometry family: sedan, hatchback, SUV, taxi, van, box truck, bus and container ship, each with LOD0 and LOD1. Lamps are emissive at night and every model has a contact-shadow quad. Semis reuse W4's `PROPS_B` semis. |
| `dynamic/__tests__/traffic.test.ts`, `life.test.ts`, `vehicles.test.ts` | 37 tests (§4.1). |

No file outside the brief's ownership was edited. `modules/index.ts` already composes `createDynamicModules()` (lead
prep commit).

## 2. Contracts for other workstreams

### 2.1 City renderer (W2) → living city: `CitySource`

The living city needs three things only the city layer knows:
- the road plots;
- where each company lot stands;
- the animated parts and emitters the building's AssetFactory produced.

A city module publishes them once in `init` and emits changes:

```ts
import { registerCitySource, type CitySource } from '@/scene/dynamic';
registerCitySource(ctx, source);               // before or after the living city initialises; null clears it
source.onChange(cb) / SourceEvents.emit('layout' | 'buildings')
```

`DynamicLayout` contains:
- `cityId` and `rev` (bump it on any layout change);
- `gridW` and `gridH`;
- `seed`, `population` and `coastal`;
- `road`: a row-major Uint8Array with 0 none, 1 street, 2 arterial, 3 highway;
- optional `roadY`: the road surface height per plot (bridge decks, terrain);
- `water` (`WATER_*`);
- optional `use`: `USE_*` land use, which drives pedestrian density and spawn weights;
- optional `traffic`: 0..1 per plot, from E3a `plots.traffic`;
- `highways`.

`DynamicBuilding` contains:
- `id`, `typeId` and `category` (the content category, e.g. `supermarket`);
- `ownerId`, `owner` (colour index, 0 = player) and `isPlayer`;
- the rotated footprint `px`, `pz`, `w`, `h`, and `facing` (0 = S, 1 = E, 2 = N, 3 = W);
- `level`, `status`, `products` and `progress?`;
- `height`;
- `parts` and `emitters`, in world metres exactly as the factory returned them.

Ownership rules:
- **W5 draws animated parts and particles.** The city layer must not draw `out.animated` or `out.emitters` itself.
- **Live status comes from the economy.** The hub overrides `status` and `progress` from `cityView` for the same city,
  so a source may leave them at `'operating'` and `undefined`.

The source is chosen in this order:
1. an explicit `createLivingCity({ source })`;
2. a registered source;
3. `PlaceholderSource` when the scene contains `company-buildings`;
4. `BridgeSource`.

`BridgeSource` follows the art §4.1 / §5.3 conventions:
- seed `fnv1a(cityId, px, pz, typeId)`, variant `seed % 2`;
- facing `rotation / 90`;
- bridge decks at +6 m.

A W2 module that follows the same conventions lines up even without registering. Registering is still preferred.

### 2.2 Interaction (W6) and UI
- **Truck picking:** `window.__livingCity.traffic.pickTruck(ray, radius = 6)` returns the nearest company truck or null.
  - `vehicle.spec.tag` is `"<kind>:<productId>:<from>><to>"` and `vehicle.spec.owner` is the owner colour index.
  - The modules are also reachable from `createLivingCity()`'s return value.
- **World popups:** W5 renders `bus.emit('worldPopup', …)` (the `game/fx.ts` requests) as rising world sprites.
  - They follow UX §8 conventions: rise 60 px over 1.6 s, at most 3 per close at 4×/8×.
  - If W6 renders popups itself, construct with `createDynamicModules({ worldPopups: false })` so they are not drawn
    twice.
- **Desaturation:** `WorldFx` writes `ctx.env.cityDesaturation` (0 → 0.2 while the player's HUD cash is negative). Other
  modules should not also drive it.

### 2.3 Settings, tiers and budgets (art §5.8–5.10)

| Item | Rule |
|---|---|
| Ambient vehicles | clamp(round(1.1·√population), 120, 900) × day curve (3/8/13/18/22 h → 0.25/1/0.7/1/0.35) × `knobs.agentDensity` (Settings "City life density" × governor), capped by the tier (`caps.vehicles` 500 LOW / 900 MED+) minus trucks on the road |
| Company trucks | at most 60 concurrently; trips spread over the visual month; pickable |
| Vehicle LOD | LOD0 under 500 m from the camera, LOD1 box to 2,400 m; ambient traffic hidden when the camera-to-target distance exceeds 1,100 m; company trucks become owner dots at city zoom |
| Pedestrians | `caps.pedestrians` (600 / 1,500 / 3,000) × agentDensity; simulated within 600 m of the target, drawn when the camera distance ≤ 420 m |
| Particles | `caps.particles / 16` emitters (800 / 2,000 / 4,000 puffs), the nearest within 2,600 m |
| Rain / snow | 4,000 streaks on LOW or Minimal, 8,000 on MED+; 3,000 flakes |
| Freezing | a paused game or reduced motion freezes agents, parts and ships (`hub.frozen`); reduced motion also hides precipitation and skips event effects (confetti, beams, rings) except desaturation; money popups still show |

## 3. Deviations from the art bible (deliberate)

- **Particle opacity.** Smoke 0.9, steam 0.85, dust 0.65; the light smoke tone is `#C4C2BB`. With the §5.19 alpha curve
  (peak ≈ 0.64), the earlier 0.55 opacity was invisible over light roofs in the real game.
- **Rain streaks.** 1.8 m long, ~2 px wide (`0.0017 × view depth`), opacity 0.5. The literal 0.02 × 1.2 m streak is
  sub-pixel at any game zoom.
  - The volume height is `min(200 m, 1.1 × camera height above the target)`, so no drops are spent above a camera that
    looks down.
- **Animated parts.** Matrices are written on the CPU for parts in range (a few dozen) rather than in a vertex shader.
  This reuses W4's `partPose` exactly.
- **Signals.** The cycle is 22 s green / 3 s amber / 1 s all-red per axis, which matches §5.16. The `aspect()` query
  exists, but signal heads are not drawn (§5).

## 4. Verification

### 4.1 Gates (branch head)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run` | 33 files passed (+1 skipped), 647 tests passed, 3 skipped. W5's own suites: 37 tests in 3 files. |
| `npx vite build` | built (15.6 s) |
| `node scripts/smoke.mjs` | **SMOKE OK**: boot, tutorial, construct, month at 8×, step, pause, quicksave |
| `dotnet build Magnate.sln` | 0 errors. No engine or bridge files changed on this branch; the WASM engine is the prebuilt one from main. |
| `dotnet test Magnate.sln --no-build` | Bridge 201 passed / 4 skipped (perf). Engine 862 / 863. The failure is `CityLayoutGeneratorTests.Metropolis_generates_within_the_desktop_budget` (831 ms against a 500 ms budget at load average ~20–50 on the shared machine). It **passes when run alone**, and no engine code changed here. |

### 4.2 In-game verification (real game, headless Chrome / Metal)

**How it was driven.** A scratch puppeteer script (git-ignored, `web/test-results/w5-verify.mjs`):
1. Starts the tutorial (Metropolis, 500k population).
2. Builds a farm (wheat), a factory (flour), a warehouse and a seaport, and hands the company to the
   `verticalIntegrator` autopilot.
3. Runs 2–5 months at 8×, dismissing auto-pauses and the victory modal.
4. Visits street, factory, chimney, port, district and city zooms, plus rain, snow and night, and records the
   `__livingCity` diagnostics.

A scene-lab probe (`web/test-results/lab.mjs`) checked rain, snow, smoke, night lamps and the pumpjack and headframe
animation in isolation.

What the screenshots showed, and what changed because of them:

| Finding | Fix |
|---|---|
| Rain was invisible in every shot. The streak quads face away from the camera (their winding follows the fall direction), and a reversed `smoothstep(1.0, 0.85, …)` is undefined in GLSL (0 on ANGLE/Metal). | Double-sided material, valid smoothstep, camera-capped volume, ~2 px streaks. Now clearly visible in-game (`w5e-rain.png`) |
| Shoppers never appeared. Code compared `category === 'retail'`, but the bridge sends content categories (`supermarket`, …). The same bug wrongly chose semis for store deliveries and broke the rival-beacon store lookup. | `isRetail()` over the content category enum. Shoppers now stream along the store frontage |
| Shoppers queued in one clump at the lot centre. | Spread over 70 % of the frontage, then a stroll along the sidewalk |
| Chimney smoke was too faint to read. | Opacity and tone (§3). The plume is visible from the factory chimney (`w5e-chimney.png`) |
| After a city switch, company buildings never appeared. `PlaceholderSource` read the scene once, before PlaceholderCity had built its meshes. | It re-scans every 250 ms (up to 10 s) while lots are missing |
| A new `THREE.Euler` was created per confetti quad per frame. | Reused |

Diagnostics from the last run (`w5h`, Metropolis, HIGH tier, 1600 × 900; load average ~10):

| View | Vehicles (target) | Drawn | Trucks | Pedestrians | Emitters | Calls | Triangles |
|---|---|---|---|---|---|---|---|
| Street (90 m) | 663 (658) | 4 | 5 | 1,469 | 3 | 79 | 246k |
| District (600 m) | 648 (622) | 145 | 9 | 1,503 | 3 | 113 | 322k |
| City (2,200 m) | 644 (609) | 1 dot | 11 | 0 (hidden) | 3 | 198 | 470k |
| Night (21:30) | 182 (132) | 14 | 21 | 454 | 3 | 94 | 253k |

Night lowers the targets, and excess vehicles are retired gradually, farthest from the target first.

**Frame time** (rAF deltas over 3–4 s; vsync 60 Hz; shared machine):

| Measurement | Result |
|---|---|
| Street, district, city (mean / p50) | 16.6–23.6 ms / 16.7 ms |
| District, traffic on vs off, quieter run (`w5f`) | 18.9 vs 16.6 ms mean; p50 16.7 both |
| Same comparison, final run (`w5h`) | 26.9 vs 24.0 ms mean (higher machine load); p50 16.7 both |

**Traffic sim JS.** In the browser, one 20 Hz step takes 0.5–1.8 ms with 180–670 vehicles, which amortises to
≈0.2–0.6 ms per 60 Hz frame. In Node (`web/test-results/bench/`), 900 vehicles on a 96 × 96 synthetic city take
1.5–2.3 ms per step at load average ~20, about 0.5–0.8 ms per frame. That is within the §5.16 budget of ≤ 1 ms per
frame for 900 vehicles, but each step lands as a spike on one frame in three (§5).

Screenshots read: `web/test-results/shots/`:
- in-game: `w5c-*`, `w5d-*`, `w5e-*`, `w5f-*`, `w5h-*` (street, factory, chimney, port, district, city, rain, snow,
  night);
- scene lab: `w5-lab-rain*`, `w5-lab-snow`, `w5-lab-smoke*`, `w5-lab-parts*`, `w5-lab-night`.

## 5. Known gaps

- **Construction sites** (workers, deliveries, crane and dust) are unit-tested but not seen in-game: Wave 1 construction
  is instant (`features.constructionTime` is false).
- **Pumpjacks and mine headframes** were verified in the scene lab only: the beam matrices change over time and the
  geometry sits on the lot. In the game, the tutorial city is neither oil- nor mineral-rich, and PlaceholderCity draws no
  company buildings in the other cities (Requests).
- **Economic mood** (boom +20 % / recession −25 % traffic) is not wired, because the macro EXT feature is off.
  `ambientVehicleTarget` is the single place to multiply it in.
- **Signal heads** are not drawn (`TrafficSim.aspect(node, arm)` is ready for a road-furniture layer). Soft-particle
  depth fade on HIGH is not implemented.
- **Traffic stepping** is not spread across frames. A full 20 Hz step runs in one frame (≈1–2 ms at 900 vehicles).
- **Reduced motion** freezes agents, parts and ships and hides precipitation. Chimney smoke keeps drifting (UX lists
  agents, not smoke).

## 6. Requests

1. **W2 (city renderer):** call `registerCitySource(ctx, source)` with the §2.1 contract.
   - Pass each building's factory `animated` and `emitters` through untouched, and do not draw them.
   - For car-park fill, pass `utilization = clamp01(log10(1 + unitsSold) / 6.5)` to the supermarket and department store
     factories (art §3.16; W3 §3.1). The player's busy supermarket currently shows an empty car park.
2. **W1 / W2 (PlaceholderCity, while it is still the game's city):** after `setActiveCity` to another city (observed
   with Portbay and Riverside), the `company-buildings` group stays empty, so company lots are not drawn there.
3. **W6:** use `traffic.pickTruck(ray)` for truck tooltips and selection.
   - If W6 renders `worldPopup` itself, ask the lead to compose `createDynamicModules({ worldPopups: false })`.
4. **Engine / bridge:** construction time (`features.constructionTime`) and macro mood would light up the existing
   construction-site and traffic-mood paths. No W5 change is needed for the former.
5. **Lead:** `Metropolis_generates_within_the_desktop_budget` is load-sensitive on the shared machine. Consider the
   `perf` category, as the bridge perf tests do.
