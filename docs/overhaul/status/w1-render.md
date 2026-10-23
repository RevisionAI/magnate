# W1 render core: status

Branch `w1-render` · Wave 1 · owner W1 (render core) · 2026-10-01

**Status: done.** The city view now runs on the tiered render pipeline of art §3.9/§5.9: quality tiers with a frame-time
governor, a depth pre-pass, Neutral tone mapping, a fitted and texel-snapped PCF sun shadow, and the sky drawn last.
On top of that sit the camera-controls RTS rig with the UX bindings, the full environment, an AudioFrame producer, the
interim in-game city on the new pipeline, and the scene lab (`?dev=scene`).

The environment covers the 12-minute day/night cycle (on by default), the sky, fog, seasons, weather state, the
outskirts terrain with forests and highways, and sea/river water.

Gates are green: `tsc` clean, `vite build`, **75 unit tests**, `SMOKE OK`. On the Intel UHD 630 at 1920×1080, LOW meets
the D7 14 ms budget by day in every view (GPU 9.4–12.9 ms on a Metropolis-scale city). Night costs 12.1–14.9 ms after
a bloom fix made here. Details are under §4.

---

## 1. File map

All paths are under `web/src/`. Files marked **new** did not exist in the baseline.

| File | What it is |
|---|---|
| `scene/CityScene.ts` | Core: renderer, tier + governor, post pipeline, camera rig, environment, AudioFrame and the module registry. Public API in §2.1 |
| `scene/SceneContext.ts` | `SceneModule` / `SceneContext` / `FrameInfo` contract, extended additively (§2.2) |
| `scene/units.ts` | `PLOT_SIZE = 24` and plot helpers (unchanged API) |
| `scene/core/RendererSetup.ts` | WebGL2 renderer config (no MSAA, `NoToneMapping`, `PCFShadowMap`, manual `info` reset), warm-up and context-loss handling |
| `scene/core/PostPipeline.ts` | Tiered pmndrs composer (§2.5): `DepthPrepass` → `RenderPass` → N8AO (HIGH+, lazy) → merged `EffectPass(bloom, outline, tilt-shift, Neutral, vignette)` → FXAA or SMAA. Also exports `LAYER_OCCLUDER = 1`, `LAYER_SELECTION = 2` and `mirrorCamera` |
| `scene/core/Quality.ts` | `TIER_SETTINGS`, `classifyRenderer`/`guessTier`, `QualityKnobs`, governor notches, `GraphicsSettings`, `FrameGovernor` |
| `scene/core/SelectionOutline.ts` | `OutlineController` (selection that survives tier switches) and the layer-safe `OutlineSelection` |
| `scene/core/ControlsFacade.ts` **new** | MapControls-compatible `ctx.controls` facade over the rig |
| `scene/core/FrameBench.ts` **new** | Drained-throughput benchmark (art §1.1/§1.7, Appendix B) plus a GPU timer-query cross-check |
| `scene/interaction/CameraRig.ts` | camera-controls 3.1.2 rig (§2.4) |
| `scene/materials/CityMaterial.ts` | The one Lambert city material. Vertex format **unchanged**; uniforms extended additively (§2.3) |
| `scene/env/Environment.ts` **new** | Owns the sun/moon and hemisphere lights, sky, fog, clock, seasons, weather, shadow, outskirts and water; writes `CityUniforms` |
| `scene/env/DayNight.ts` **new** | Art §3.6 key table, sun path, moon, lit-window and shopfront curves, `DayNightClock` (12 min) |
| `scene/env/Sky.ts` **new** | Art-directed dome: gradient, sun disc and glow, stars after dusk, overcast, lightning flash. Drawn last |
| `scene/env/ShadowFit.ts` | `fitSunShadow` (6-ray footprint clipped to the city, texel-snapped) and `SunShadow` (update policy of art §3.10) |
| `scene/env/Seasons.ts` **new** | Month + climate → `SeasonState` (vegetation tint and desaturation, autumn/bare/blossom shares, snow, crop stage) |
| `scene/env/Weather.ts` **new** | Seeded cosmetic weather episodes and the `WeatherState` drivers (cloud, rain, snowfall, wind, wet, snow cover, lightning, fog, sun) |
| `scene/env/World.ts` **new** | `SceneWorld` (what the city layer tells the core) and water/edge helpers |
| `scene/env/Terrain.ts` **new** | Outskirts height model: relief flattened at the city edge, sea beyond coastal edges, river valleys from the city's river mouths, highway corridors |
| `scene/env/Outskirts.ts` **new** | 12×12 km flat-shaded heightfield with a city hole, field patchwork, meadows, rock, beaches, forests and highways to the horizon. Seasonal recolour without rebuilds |
| `scene/env/Trees.ts` **new** | `TreeField`: instanced trees in cells, LOD0/LOD1, near-target shadow casting, season recolour. Reusable by W2/W3 |
| `scene/env/Water.ts` **new** | Sea/river/lake surface (MeshStandard). Shore-distance fields drive the depth tint and foam; analytic wave normals, sky PMREM reflections, overcast greying, bank skirts |
| `scene/env/rng.ts` **new** | `mulberry32`, `hash3`, `fnv1a` |
| `scene/audio/AudioFrameProducer.ts` **new** | 10 Hz `AudioFrame` (audio-plan §4.8) and `LandUseGrid` (summed-area tables + water BFS) |
| `scene/modules/PlaceholderCity.ts` | Interim in-game city (§2.8) on the new pipeline |
| `scene/modules/SyntheticCityModule.ts` **new** | The synthetic city as a `SceneModule` (scene lab) |
| `scene/modules/synthetic/{Layout,Builder,SyntheticCityView,CompanyFallback}.ts` **new** | Deterministic 24 m-plot layout, chunked geometry, instanced trees/lamps/light pools, company stand-ins |
| `dev/SceneLab.tsx` | `?dev=scene` lab (§2.9) |
| `dev/sceneLab/views.ts` **new** | Lab camera presets and the tier × view × hour benchmark |
| `scene/**/*.test.ts` **new** | 7 test files, 75 tests (§4.1) |

---

## 2. How other workstreams use it

### 2.1 `CityScene` (UI: U1 owns `GameScreen.tsx`)

`new CityScene(container, options)`, `add(module)`, `focusOn(point, distance?)` and `dispose()` are source-compatible with
the skeleton. `GameScreen.tsx` compiles unchanged.

New options (all optional):
- `tier` (`'auto'` | `'low'` | `'medium'` | `'high'` | `'ultra'`)
- `governor` (default on)
- `powerPreference` (default `'high-performance'`)
- `dayNight` (`'dynamic'` | `'day'` | `'golden'` | `'night'`; reduced motion defaults to `'day'`)
- `startHour`
- `weather`
- `reducedMotion`
- `stats`
- `preserveDrawingBuffer`

| Method | Use |
|---|---|
| `setGraphics({ preset, shadows, agentDensity, resolutionScale, fpsCap })` | UX §6.18 Graphics row. `preset 'auto'` = GPU guess + governor; `resolutionScale` 0.5–1 pins the scale; `fpsCap: 30` |
| `setTier(tier \| 'auto')` | Rebuilds the post pipeline |
| `setDayNightMode(mode)`, `setHour(h)` | Day/night setting (lock daytime = `'day'`), photo mode |
| `setWeatherEnabled(on)`, `forceWeather(kind \| null, instant?)` | "Weather: on/off"; scripted or dev weather |
| `setGameDate({ year, month })` | Seasons follow the game month (`month` 1–12 as in `DateDto`) |
| `setTiltShift(on)` | Photo-mode "miniature" (art §1.6 finding 11) |
| `focusBox(box3)` | Double-click focus (0.6 s ease) |
| `setStatsVisible(on)` | stats-gl overlay |
| `quality`, `gpuGuess`, `onQualityChanged` | Settings UI read-out (tier, GPU string, governor level, effective DPR) |

**Keyboard and mouse ownership.** The rig reads WASD/arrows, Q/E and +/− from `window`, and ignores text inputs and
any modifier chord.
- Left mouse is free for picking and placement.
- Right-drag pans.
- A right *click* without drag fires `rig.addEventListener('contextclick', e => …)` for the context menu, because
  camera-controls suppresses the native one.
- In Build mode set `scene.rig.rotateKeysEnabled = false`, so Q/E rotate the footprint instead (UX §6.20).
- `rig.edgeScroll`, `rig.setZoomSensitivity(k)` and `rig.setInvertRotate(on)` map to the UX §6.18 Controls row.

### 2.2 `SceneContext` additions (all additive)

**`FrameInfo`** gained:
- `cameraMoved`
- `cameraDistance` (m)
- `zoom01` (0 at ≤ 300 m … 1 at ≥ 1,800 m, log scale)
- `target`
- `timeOfDay` (hours)
- `night` (0–1)

**`SceneContext`** gained:

| Member | Purpose |
|---|---|
| `rig: CameraRig` | Focus, presets, zoom band, keyboard state, `contextclick` / `userinput` events |
| `quality: QualityState` | `tier`, `settings` (static `TierSettings` incl. agent `caps`), `knobs` (live: `resolutionScale`, `bloom`, `shadows`, `treeShadows`, `treeShadowRadius`, `shadowMapSize`, `treeLod1Distance`, `agentDensity`), governor `level`, `minimal`, `gpu`, `pixelRatio`. Subscribe with `onQualityChanged` |
| `env: Environment` | §2.4 |
| `post: PostHandles \| null` | Composer and effects (`bloom`, `outline`, `tilt`, `toneMapping`, `vignette`, `aa`, `ao`, `prepass`, `render`). Rebuilt on tier change; `null` on the minimal pipeline. Prefer `outline` below for selection |
| `outline: SelectionOutline` | `set(objects)`, `clear()`, `strength` (hover ≈ 0.6, selected 1.0). Survives tier switches |
| `world`, `setWorld(world)`, `onWorldChanged` | §2.6 |
| `requestShadowUpdate()` | Call after any shadow-caster change (chunk swap, building added or removed). The sun shadow is otherwise only re-rendered when the camera moves or the sun turns > 0.15° (≤ 4 Hz) |
| `audioFrame`, `onAudioFrame`, `setAudioAreaSource` | §2.7 |
| `controls` | Now a MapControls-compatible facade (read target, distance, angles; writing `target` moves the rig). Prefer `rig` |

**Layers.**
- Static opaque occluders (chunks, terrain, company buildings) should `layers.enable(LAYER_OCCLUDER)`, so the depth
  pre-pass covers them (−3.9 ms at close zoom on the UHD 630).
- Do **not** put alpha-tested or transparent geometry on that layer.
- Selection proxies may live on `LAYER_SELECTION` only.

**Budgets for modules.** Read `ctx.quality.settings.caps` (vehicles, pedestrians and particles per tier) and multiply
by `ctx.quality.knobs.agentDensity`. Read `ctx.quality.knobs.treeLod1Distance` for tree LOD.

### 2.3 `CityMaterial` (W3/W4 build against it; W1 owns it)

- **The vertex format and attribute layout are unchanged.** `GeoBuilder` output renders as before.
- The program cache key is `magnate-city-v2`.
- New uniforms are additive; "W1+" in the source marks them.

| Uniform | Driven by | Meaning |
|---|---|---|
| `uNight`, `uLitFrac`, `uSkyRefl`, `uSeasonTint`, `uSnow`, `uWet`, `uTime`, `uOwnerRoofMix`, `uCitySize` | Environment, every frame | As in Appendix A.2. `uSkyRefl` leans to the zenith colour after sunset |
| `uShopLit` | Environment | Shopfront lit multiplier: ×2.2 open, 0.3 after 22:00 |
| `uVegDesat` | Environment (seasons) | Dormant-season desaturation of `FLAG_VEGETATION` surfaces |
| `uDesaturate` | Environment | Whole-city greying = max(overcast 0.3 × cloud, `env.cityDesaturation`). **Set `env.cityDesaturation` (insolvency), not the uniform** |
| `uOverlay`, `uOverlayTex`, `uOverlayMode`, `uNeutralOwner` | W6 overlays (Wave 2) | Clay mode. Modes `OVERLAY_SEQUENTIAL`, `OVERLAY_DIVERGING` (profit), `OVERLAY_CATEGORICAL` (owners: value × 255 = colorIndex, 255 = neutral), `OVERLAY_BINNED`. See the overlay texture notes below |
| `uOwnerColors[8]` | `setOwnerColors(OWNER_COLORS)` in CityScene | From `theme/tokens.ts` |

**Overlay texture (`uOverlayTex`).**
- R8, one texel per plot, row 0 = north.
- It is sampled at `world.xz / uCitySize + 0.5`. This fixes the reference code, which was off by half a city.
- Set `texture.unpackAlignment = 1`. Odd grid widths such as 55 or 50 otherwise shear: I hit exactly this bug in the
  water shore field.

**Other changes.**
- Fixes: r186 `vColor` handling and RGB-only colour attributes.
- The INDUSTRIAL clerestory lights in bay groups at night instead of a continuous neon band.

### 2.4 `Environment` (`ctx.env`)

| Member | Use |
|---|---|
| `hour`, `night`, `lighting` (`LightingState`: light direction, colours, intensities, sky/fog colours, `litFrac`, `shopLit`) | Time-of-day consumers |
| `audioHour` | `null` in fixed-day mode (audio §4.8) |
| `clock` (`DayNightClock`: `mode`, `hour`, `cycleSeconds` = 720, `paused`) | Day clock |
| `setDayNightMode`, `setHour` | Day/night setting |
| `weatherState` (`WeatherState`) | `kind`, `cloud`, `rain`, `snowfall`, `wind`, `wet`, `snowCover`, `lightning`, `fogFar`, `fogNear`, `sunScale`, `skyDesat`. **The Wave 2 FX workstream renders rain streaks and snowflakes from `rain` / `snowfall` / `wind`**; nothing is drawn for them yet |
| `weather.onLightning(cb)` | Fires on each strike with its strength (thunder sync for A1) |
| `forceWeather`, `setWeatherEnabled` | Weather control |
| `season` (`SeasonState`), `onSeasonChange(cb)` | Fires on month or climate change: recolour trees and crops there, never per frame |
| `setGameMonth(0–11)` | Season input |
| `cityDesaturation` | 0–1 game-feel greying (insolvency, art §5.21) |
| `requestShadowUpdate()` | Same as `ctx.requestShadowUpdate()` |
| `sun`, `hemi`, `sky`, `fog`, `shadow` (`SunShadow`: `texelSize`, `updates`, `maxCasterHeight`) | Read-only by convention |
| `outskirts`, `water`, `terrain` | Read-only by convention |

### 2.5 Post pipeline and tiers (art §3.9; numbers in §4)

| | LOW | MEDIUM | HIGH | ULTRA | minimal |
|---|---|---|---|---|---|
| Picked by `guessTier` | Intel UHD/HD/Iris Plus/Iris Pro | Iris Xe, Arc, Radeon APU/Vega, Apple M1, mobile GPUs | everything else (discrete GPUs, M-Pro/Max) | user only | SwiftShader / llvmpipe |
| Max DPR × governor scale | 1.0 × 0.7–1.0 | 1.25 × 0.7–1.0 | 2.0 × 0.75–1.0 | 2.0 × 1.0 | ≤ 0.75 |
| AO | none (shader wall-base AO) | none | N8AO Low, half res | N8AO Medium, full | none |
| Bloom | night only (opacity ramps with `night`); **half-res chain** | always, half-res chain | always, full res | always, full res | none |
| AA | FXAA | SMAA medium | SMAA medium | SMAA high | none |
| Shadows | 2048, trees within 400 m of the target | 2048, all trees | 4096 | 4096 | off |

Further pipeline rules:
- Effects are toggled through `blendMode.opacity`, never by rebuilding passes. Bloom and tilt-shift also skip their
  render-target work at opacity 0.
- N8AO is a lazy chunk (`N8AO-*.js`, 184 kB), so LOW and MEDIUM never download it.
- **Governor** (art §5.10): an EMA (α 0.05) of the rAF interval.
  - It steps down after 3 s above 18 ms and up after 5 s below 12 ms, with a 10 s cooldown.
  - On vsync-capped displays it probes up after 8 s of steady frames and reverts at once (backing off ×2) if the
    probe is slow.
  - Notches, in order: resolution 90 / 80 / 70 % → bloom and tree shadows off → shadow map 1024 → tree LOD1 at 600 m
    → agents × 0.5.
- Battery with an idle camera (> 10 s) and `fpsCap: 30` render every other frame.

### 2.6 `SceneWorld` (W2's city layer sets it in Wave 2)

`ctx.setWorld({ cityId, gridW, gridH, seed, climate, water, reliefM, highways, population })` drives:
- camera bounds (city ± 10 %, max distance from the diagonal);
- the shadow clip;
- outskirts terrain, forests and highways;
- water (sea, river, lake) and banks;
- the fog scale;
- `CityUniforms.uCitySize`;
- audio defaults.

How W2 maps `CityLayoutDto` (bridge §8.1 + art §5.3 requests) onto it:
- `water` is a row-major `Uint8Array` of `WATER_NONE` / `WATER_SEA` / `WATER_RIVER` / `WATER_LAKE` per plot.
- `highways` lists the arterial exits per edge.
- `climate` comes from `CityOverviewDto.climate`, or `defaultClimate(cityId)`.
- `reliefM` comes from `defaultRelief(cityId)` (art §3.12 table) until terrain heights exist.

Calling `setWorld` with a new `cityId` re-frames the camera and reseeds the weather.

### 2.7 AudioFrame (A1)

`ctx.onAudioFrame(frame => …)` publishes at 10 Hz; `ctx.audioFrame` holds the latest frame. The shape is exactly
audio-plan §4.8: `zoom01`, `focus`, `cityId`, `coastal`, `distToWaterPlots`, `timeOfDay` (`null` = fixed day), `month`
(0–11), `rain`, `wind` and `area.{road, traffic, green, industrial, commercial, residential, construction, water}`.

Additive fields:
- `listener` (rig position = target + 0.35 × (camera − target), audio §4.3)
- `cameraDistance`
- `zoomBand` (`street` | `district` | `city`)
- `speed`
- `lightning`
- `t`

The `zoom01` mapping is art §5.11's (300 m → 1,800 m), not the audio plan's provisional 40 m → 1,800 m.

The city layer provides land use through `ctx.setAudioAreaSource(new LandUseGrid(cityId, w, h, landUseBytes, { coastal,
population }))`. `LandUseGrid` uses summed-area tables, so queries are O(1) at radius R = max(6 plots, 0.8 × camera
height). Update it with `setLandUse(px, pz, LANDUSE_*)` followed by `rebuild()`.

### 2.8 Interim in-game city (`PlaceholderCity`, replaced by W2 in Wave 2)

- **City.** A deterministic synthetic city per city id at 24 m plots:
  - arterials, streets and bridges, built to the art §3.2 road cross-sections, with lamps, light pools and the
    far-field lamp grid;
  - houses, apartments, shops, offices, towers and industry with procedural facades;
  - parks and street trees;
  - a beach or quay shore, plus a river for Riverside;
  - the outskirts and water.
- **Company buildings.** The registered `AssetFactory` is used when W3/W4 provide one; otherwise a stand-in with owner
  accents. They are placed on reserved development blocks near the CBD.
- **Other behaviour.**
  - It frames the player's first building once.
  - It follows the game month.
  - It feeds the AudioFrame land use.
- **Store access.** It reads the zustand store through narrow structural types: `activeCityId`, `buildings`,
  `snapshot.{date, companies, playerId}` and `catalog.{cities, buildingTypes}`.

### 2.9 Scene lab (`?dev=scene`)

- **Test city.** A coastal river city, 40×40 plots by default (`size=80` gives Metropolis scale: 2,838 buildings,
  193k chunk triangles, 4.7k trees, 3k lamps, built in about 0.2–0.6 s).
- **Panel controls:**
  - time slider and 12-minute cycle;
  - fixed presets;
  - tier select;
  - month;
  - weather;
  - camera presets (overview, mid, close, street, horizon);
  - stats-gl toggle;
  - the benchmark;
  - a live read-out (GPU, tier, DPR, governor level, calls and triangles, hour and night, zoom band, shadow m/texel,
    weather, season, build stats).
- **Query params:** `hour`, `cycle=1`, `tier`, `view`, `az`, `month`, `climate`, `weather`, `size`, `seed`, `relief`,
  `stats=1`, `ui=0`, `governor=1`, `power=low-power` (Intel iGPU on dual-GPU Macs), `bench=1` (+ `benchTiers`,
  `benchViews`, `benchHours`, `benchRuns`, `benchFrames`).
- **Script hooks:**
  - `window.__sceneLabReady` (true once built, compiled and rendered);
  - `window.__sceneLab` (`scene`, `city`, `setHour`, `setTier`, `setView`, `setWeather`, `setMonth`, `bench`);
  - `window.__benchResults` and `window.__benchDone`.

Screenshot example:

```bash
cd web && npx vite build && node scripts/shoot.mjs --query "?dev=scene&ui=0&tier=low&hour=22.5" --out night.png \
  --ready "() => window.__sceneLabReady === true" --wait 2000
```

Benchmark on the UHD 630 (results print as `[bench] {...}` lines):

```bash
node scripts/shoot.mjs --query "?dev=scene&ui=0&size=80&power=low-power&bench=1&benchTiers=low,medium&benchHours=13,22.5" \
  --out bench.png --ready "() => window.__benchDone === true" --wait 500
```

---

## 3. Deviations from the art bible (all deliberate; each is a single constant)

| Item | Bible | Here | Why |
|---|---|---|---|
| Light intensities | keys as listed | keys × `LIGHT_SCALE` 1.12 (sun and hemisphere) | Neutral tone mapping's 0.04 toe rendered noon ground 10–15 % darker than the palette; exposure stays 1.0 as specified |
| Vignette | offset 0.32, darkness 0.42 | 0.5 / 0.2 | With postprocessing's vignette technique, the bible values darken the corners to about 50 % |
| Water | roughness 0.22 | 0.30, `envMapIntensity` 0.6, 4 directional wave octaves fading with pixel footprint | Sun glitter turned into noise at 1080p |
| Bloom on LOW/MED | 6 levels at full resolution | half-resolution luminance + mip chain, 5 levels (same glow radius) | postprocessing's mipmap bloom ignores `resolutionScale`; full resolution cost +7–9 ms GPU on the UHD 630 |
| Weather timing | "seeded per month" | real-time episodes of 1.5–9 min; odds from month + climate; seeded per city | A month lasts 12 s at 1× (D5), shorter than the 30–60 s wetness and snow ramps |
| Overcast | sun × 0.55, sky desaturates | plus: sun colour greys, shadows fade (× 0.37 in rain), sky light × 0.91, haze starts closer (`fogNear` × 0.45–0.6), water greys, city desaturates 27 % | Rain otherwise read as "slightly darker sunny day" (screenshots `v1-low-rain` vs `w1-low-rain`) |
| Glass sky reflection | `uSkyRefl` = horizon ⟷ top | leans to the zenith colour with `night` | Curtain walls turned maroon at dusk (finding 4) |
| Stars | × night | × smoothstep(0.35, 0.9, night) | Stars appeared before sunset |
| Focus | `fitToBox(box, true, padding 20)` | fit a sphere around the box at the current azimuth with auto-tilt | camera-controls' `fitToBox` snaps azimuth and polar to 90° steps, which breaks the 35–65° tilt limits |
| Camera far | 5·d + 4000 | 5·d + 6000 | Stays beyond the fog far distance (3.2·d + 4500) |
| Default view | — | azimuth 330° (camera SSW, looking NNE) | The morning-to-noon sun side-lights the facades; a north coast sits at the top of the screen |
| Winter grass | `#A9A38A` | temperate Jan/Dec desaturation 0.38–0.4 (olive, not khaki) | The first game screen is 1 January; full khaki read as desert |

---

## 4. Verification

### 4.1 Gates (final run, branch head)

```
$ npx tsc --noEmit -p tsconfig.json        → (no output, exit 0)
$ npx vite build                            → ✓ built (N8AO-*.js 184 kB and stats-gl main-*.js 37 kB are lazy chunks)
$ npx vitest run                            → Test Files 7 passed (7) · Tests 75 passed (75)
$ node scripts/smoke.mjs                    → ✓ boot · ✓ start tutorial · ✓ construct supermarket · ✓ advance a month · SMOKE OK
```

| Test file | What it checks |
|---|---|
| `core/Quality.test.ts` (25) | GPU string → tier table; tier settings; notch order; knobs accumulate; pinned resolution; governor step-down after 3 s, the 10 s cooldown, step-up below 12 ms, the vsync probe and back-off, settle, stall reset |
| `env/DayNight.test.ts` (14) | Every art §3.6 key reproduced exactly; dusk sun 0.03 at 20:06; moonlit midnight; wrap at 24 h; light never below the horizon; sun path 06:30 / 13:07 / 19:45 at 58°; lit share and shopfront curves; 12-minute cycle; fixed modes; audio `null` |
| `env/ShadowFit.test.ts` (7) | Polygon clip; **texel snapping under an arbitrary pan** (frustum edges move by whole texels); street-versus-overview texel density; the light frustum contains every caster up to the cap height; update policy (camera, sun > 0.15° at ≤ 4 Hz, caster change); map resize |
| `env/SeasonsWeather.test.ts` (9) | Month → season; summer neutral, autumn colours, bare winter; continuity across months; cold snow; warm climates never bare; weather determinism per seed; wetness ramp and drying; snow linger and melt; lightning callbacks; weather off |
| `env/WorldTerrain.test.ts` (10) | City rectangle at 24 m; sea edges and river mouths; flat city and riverbed; sea beyond the coast; flattened fringe; river channel continued; determinism; highway grading; chamfer distance |
| `audio/AudioFrameProducer.test.ts` (6) | Summed-area shares; edge clipping; water distance; edits + rebuild; 10 Hz cadence and listener rig; fallback without a source |
| `modules/synthetic/Layout.test.ts` (4) | Layout determinism; lots never on roads or water; road grid, shore and reserved land; chunk triangle budget, 4-byte-aligned attributes, deterministic geometry |

### 4.2 Screenshots inspected

The PNGs are in `web/test-results/shots/`; they are git-ignored, so regenerate them with the lab. All are 1920×1080.

| File | View and conditions | Notes |
|---|---|---|
| `w1-low-noon.png` / `w1-high-noon.png` | mid, 13:00, LOW / HIGH | Clean scale-model look, soft PCF shadows. HIGH adds N8AO contact shading (difference image checked) |
| `w1-low-golden.png` / `w1-high-golden.png` | 18:30 | Warm low sun, long shadows |
| `w1-low-sunset.png` | 19:48 | West faces glow red-orange; windows coming on |
| `w1-low-dusk.png` / `w1-high-dusk.png` | 20:06 | Twilight; lit windows warm (residential) and cool (offices); no maroon towers since the reflection fix |
| `w1-low-night.png` / `w1-high-night.png` | 22:30 | Windows, lamp pools, far-field lamp grid, night bloom (half-res on LOW, visually unchanged) |
| `w1-low-night-street.png` | 21:30, street band | Shopfronts ×2.2, light pools ≤ 0.14, lamp heads |
| `w1-low-rain.png` | 13:00, rain | Grey light, faint shadows, darker wet roads, greyed water and city |
| `w1-high-rain-horizon.png` | storm, horizon view | Overcast sky, haze over the far city |
| `w1-low-snow.png` | January, 11:00, snow | Snow on roofs and ground, ploughed roads, bare deciduous trees, grey water |
| `w1-low-autumn-overview.png` | November overview | Autumn trees, ploughed fields in the outskirts |
| `w1-low-noon-overview.png` / `-close.png` / `-street.png` | the three zoom bands | Outskirts reach the horizon; city never floats |
| `w1-high-golden-horizon.png` / `w1-high-night-horizon.png` | below the gameplay tilt | Sky gradient, sunset glow, stars |
| `web/test-results/02-city.png`, `03-after-month.png` | in-game after starting the tutorial (smoke test) | Metropolis on the new pipeline in January (bare trees, olive grass). After building, the camera frames the player's supermarket (stand-in with a blue fascia) |

### 4.3 Performance: Intel UHD 630 at 1920×1080, DPR 1 (art D7 budgets)

**Method.**
- Drained throughput, as in art §1.1: a 1 px `readPixels` sync, 40 frames back to back, sync again; median of 5 runs.
- A `TIME_ELAPSED` timer query brackets the same frames. It returned valid results here because static frames upload
  no instance buffers, and it agrees with the drained number to within about 1 ms, so the GPU is the bottleneck.
- "Static" means the shadow map is not re-rendered, as in play when nothing moves. "Moving" re-renders the shadow map
  every frame.

**Scene.** The scene lab at `size=80`: Metropolis scale, 2,838 buildings, 193k chunk triangles, 4.7k city trees plus
about 1.5k outskirts trees, 3k lamps, the sea and a river.
- Views follow art §1.1: overview at 2,340 m and 52° elevation; mid 760 m, 46°; close 230 m, 38°.
- There are no vehicles or pedestrians yet; those are Wave 2 work.

**Conditions.** Seven other engineers' builds were running: load average 10–20, and `pmset -g therm` reported
`CPU_Speed_Limit` falling from 89 % to 31 % during the run. The iGPU shares that power budget, so these numbers are
pessimistic. The art report measured at load ≈ 8.

**LOW: the target tier.**

| Hour | View | Drained static (ms) | GPU static (ms) | Drained moving (ms) | GPU moving (ms) | JS submit (ms) | Calls static / moving | Triangles static / moving |
|---|---|---|---|---|---|---|---|---|
| 13:00 | overview | 13.9 | 12.9 | 14.6 | 13.6 | 2.3 | 167 / 231 | 478k / 671k |
| 13:00 | mid | 12.1 | 11.3 | 12.7 | 11.9 | 2.1 | 98 / 156 | 349k / 515k |
| 13:00 | close | 10.1 | 9.4 | 10.8 | 9.9 | 2.0 | 66 / 88 | 262k / 329k |
| 22:30 | overview | 16.9 | 14.9 | 17.9 | 16.0 | 1.9 | 178 / 241 | 478k / 669k |
| 22:30 | mid | 15.4 | 13.6 | 17.3 | 15.9 | 3.7 | 119 / 178 | 352k / 525k |
| 22:30 | close | 13.0 | 12.1 | 14.0 | 13.1 | 2.2 | 87 / 116 | 265k / 349k |

**LOW against the D7 budgets.**

| Budget | Day | Night | Verdict |
|---|---|---|---|
| ≤ 14 ms GPU | 9.4–12.9 static, 9.9–13.6 moving | 12.1–14.9 static, 13.1–16.0 moving | Met by day in every view. At night the overview and mid views exceed it by up to 2 ms, where the governor's first notch (90 % resolution, −1.5 to −2 ms) takes over. The art prototype measured 14.3–18.7 ms at night |
| ≤ 2.5 ms JS submit | 1.9–2.3 | one 3.7 ms outlier | Met on a throttled CPU, except the outlier |
| ≤ 250 draw calls | 66–231 | 87–241 | Met |
| ≤ 700k triangles | ≤ 671k | ≤ 669k | Met |

**Night bloom before and after the fix.** Before the half-resolution bloom chain, the same night views cost 18–23 ms
GPU on LOW.

**Other tiers on the UHD 630** (GPU ms, static; for reference only — they are never auto-selected on this GPU):
- **MEDIUM:** 15.3–19.4 by day, 15.8–21.3 at night.
- **HIGH:** 33–42 at the end of a hot run, before the N8AO fix below. N8AO Low at half resolution alone costs the
  +14–17 ms that art §1.3 predicts.
- **ULTRA:** 63–79.

**Discrete reference: Radeon Pro 5500M, same scene and views, CPU throttled to 20–47 %** (GPU ms, static):

| Tier | GPU ms |
|---|---|
| LOW | 3.4–4.5 |
| MEDIUM | 5.0–6.7 |
| HIGH | 10.2–13.6 |
| ULTRA | 24.8–32.9 |

HIGH fits 60 fps on a 2019 mid-range dGPU. The art measured HIGH at 6.5–7.1 ms on a cooler machine.

**Two cost bugs found and fixed during measurement.**
1. **Full-resolution bloom.** postprocessing's mipmap bloom filters at full resolution: +7–9 ms GPU at night on LOW.
   It now uses a half-resolution chain on LOW/MEDIUM.
2. **N8AO transparency mode.** N8AO auto-detects transparent materials every frame (light pools, lamp points) and then
   renders the scene twice more per frame. That is now disabled: HIGH on the 5500M went from 16.5–17.5 ms to
   10.2–13.3 ms.

**Measurement pitfall worth knowing.** With the other engineers' load, the same LOW configuration drifted between 14
and 21 ms GPU minutes apart (thermal throttling). Compare configurations A/B within one session, or read the GPU timer
column, before drawing conclusions.

---

## 5. Known gaps

**Wave 2 owners have the inputs they need:**
- **Rain streaks and snowflakes** are not rendered. Weather is exposed as state only (`env.weatherState`), as the brief
  assigns the particles to the Wave 2 FX workstream. Wetness, overcast, haze, snow cover and lightning flashes are
  rendered here.

**Reserved settings and deferred bible items:**
- **Seasonal LUT grade** (MED+) is reserved (`TierSettings.lut`) but not wired.
- **ULTRA glass**: MeshStandard curtain walls with a sky PMREM are not implemented. ULTRA = HIGH + N8AO Medium at full
  resolution + SMAA High.
- **Photo mode** has tilt-shift only. Free camera and AgX remain open (art open question 7).
- **Hilltown terrain**: per-plot terrain heights and Hilltown terraces (art §3.12) are not consumed. The city ground is
  flat at y = 0; the outskirts relief does follow `reliefM`.

**Interim and partial behaviour:**
- **Water shore kind**: the beach versus quay choice is decided by the synthetic layout (industrial zone = quay). The
  real `WaterRectDto.shore` arrives with W2.
- **Context loss**: geometry, render targets, DataTextures, shadows and warm-up recover; CanvasTexture atlases are W4's
  `SignAtlas`.
- **Battery 30 fps cap**: depends on `navigator.getBattery`, which is Chromium-only. Safari and Firefox never cap.

**Not built:**
- **Golden-screenshot pixel-diff tests** (art §5.24) were not added. Screenshots are reviewed by hand.

**Performance caveat:**
- **Timings under load**: the numbers were taken on a heavily loaded, thermally throttled machine. Re-run the lab bench
  on a quiet machine before Wave 4 sign-off (command in §2.9).

---

## 6. Requests

1. **U1 (`GameScreen.tsx`, settings, key map):**
   - Wire the Graphics settings to `scene.setGraphics(...)`, Day/night to `scene.setDayNightMode(...)` and Weather
     on/off to `scene.setWeatherEnabled(...)`.
   - Pass `reducedMotion` from the accessibility settings into `new CityScene(container, { reducedMotion })`.
   - Open the context menu on `scene.rig.addEventListener('contextclick', …)`, since camera-controls swallows the
     native `contextmenu` on the canvas.
   - Set `scene.rig.rotateKeysEnabled = false` while in Build mode.
   - Home = `scene.focusBox(hqBox)`.
   - Optionally call `scene.setGameDate(snapshot.date)` on each tick; PlaceholderCity does this for now.
   - Keep `UI.{text, text2, muted, stroke, strokeSoft, panel2}` and `FONTS.{ui, display, mono}` in `theme/tokens.ts`,
     which the scene lab uses.
2. **W4 (`assets/GeoBuilder.ts`, `shapes.ts`, `Instancing.ts`):** the synthetic city and the trees build with
   `GeoBuilder` (`place`, `box`, `quad`, `tri`, `tint`, `flags`, `owner`, `ownerRoof`, `finish`, `toBufferGeometry`),
   `shapes` (`boxAt`, `cylinder`, `cone`, `blob`, `triAuto`, `gableRoof`, `hipRoof`, `sawtoothRoof`) and `Instancing`
   (`buildPartitionedFamily`, `CELL_M`, `LOD_BANDS`). Keep these signatures stable, or tell the lead so the merge
   updates the callers.
3. **Lead / owner of `web/src/types/n8ao.d.ts`:** add `autoDetectTransparency: boolean` to the `N8AOPostPass` shim.
   `PostPipeline` sets it through a narrow cast today.
4. **W6 (Wave 2, interaction):**
   - Use `ctx.outline.set([...])` with the real building meshes, or with proxies on `LAYER_SELECTION` only.
     `OutlineSelection` restores each object's layer mask exactly; postprocessing's own Selection would put proxies
     on layer 0.
   - Overlay textures need `unpackAlignment = 1`.
5. **W2 (Wave 2, city):**
   - Call `ctx.setWorld(...)` per city (§2.6) and `ctx.setAudioAreaSource(LandUseGrid)`.
   - Put chunks and company buildings on `LAYER_OCCLUDER`.
   - Call `ctx.requestShadowUpdate()` after chunk swaps.
   - Recolour on `env.onSeasonChange`.
   - Reuse `TreeField` for street and park trees.
   - Replace `PlaceholderCity` in `GameScreen`.
6. **A1 (audio):**
   - Consume `ctx.onAudioFrame`; `zoom01` follows art §5.11.
   - For thunder, subscribe to `ctx.env.weather.onLightning(strength => …)`. The flash and the callback fire in the
     same frame.
7. **E3a / bridge (contract 5):** the renderer is ready for `CityOverviewDto.climate`, `WaterRectDto.kind` (sea, river,
   lake) and `shore`. It degrades gracefully without them.
