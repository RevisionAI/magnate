# Magnate overhaul: art bible and Three.js rendering architecture

Research report by the `art-rendering` agent (technical art direction and Three.js graphics engineering). Written 2026-09-30/10-01 against **three 0.186.1**, `@types/three` 0.186.0, postprocessing 6.39.5, camera-controls 3.1.2 and n8ao 2.0.1.

**Scope.** This is a read-only research phase: the only project file created is this report. Everything below was measured or type-checked in a scratch prototype outside the tree: `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/art-rendering/`. Those files are temporary. The code that matters is reproduced in Appendix A, and every snippet there compiles with `tsc` (7.0.2, strict) against the typings above.

**How to read it.**
- §0 gives the decisions.
- §1 is the evidence, measured on the actual target GPU.
- §2 reconciles this report with the other overhaul reports and the existing `web/` skeleton.
- §3 is the art bible, §4 the per-asset specs, §5 the architecture.
- §6 covers packages, §7 API changes since r150, §8 risks and open questions.

---

## Contents

- [0. Decisions on one page](#0-decisions-on-one-page)
- [1. Evidence: a prototype measured on an Intel UHD 630](#1-evidence-a-prototype-measured-on-an-intel-uhd-630)
- [2. Alignment with the other overhaul reports and the `web/` skeleton](#2-alignment-with-the-other-overhaul-reports-and-the-web-skeleton)
- [3. Art bible](#3-art-bible)
- [4. Per-asset visual specifications](#4-per-asset-visual-specifications)
- [5. Technical architecture](#5-technical-architecture)
- [6. npm packages](#6-npm-packages)
- [7. three.js r150 to r186: API changes that matter here](#7-threejs-r150-to-r186-api-changes-that-matter-here)
- [8. Risks and open questions](#8-risks-and-open-questions)
- [Appendix A. Verified reference code](#appendix-a-verified-reference-code)
- [Appendix B. Reproducing the measurements](#appendix-b-reproducing-the-measurements)

---

## 0. Decisions on one page

| # | Decision | Why (evidence) |
|---|---|---|
| D1 | **Look: "an architect's scale model on a sunny afternoon."** Stylized-realistic low poly with real-world proportions (1 unit = 1 m). Flat-shaded vertex colours, no photo textures. Soft PCF sun shadows and a hemisphere sky light. Khronos **Neutral** tone mapping. The environment is muted and warm; **company ownership is the only saturated colour** in the world. | Prototype renders (§1.6). Neutral keeps company and UI colours exact, while ACES shifts hue. |
| D2 | **1 plot = 24 m** (align with `caplab-brief.md` §5.1; the skeleton's 12 m is too small for the content footprints). Roads are whole plots (24 m right of way). Plot (0,0) is the NW corner; +X east, +Z south, +Y up; the city is centred on the origin (keep `web/src/scene/units.ts`, change `PLOT_SIZE`). | §2.1 |
| D3 | **One material family**: `MeshLambertMaterial` plus `onBeforeCompile` injections. They add procedural windows (lit or unlit), wall-base AO, night emissive, owner-roof tint at distance, the data-overlay "clay mode", seasons, snow and rain. **Standard is 33% slower** on UHD 630 (17.9 ms vs 13.5 ms, close view), so use it only for water, and for glass on ULTRA. | §1.3 |
| D4 | **Static city = per-chunk merged `BufferGeometry`** (10×10 plots), built in a Web Worker by deterministic AssetFactories. **Repeated props = `InstancedMesh` partitioned into 400 m cells.** No `BatchedMesh` in v1: Firefox lacks `WEBGL_multi_draw`, and three then issues one draw per instance (verified in `WebGLRenderer.js`). | §1.3, §5.5 |
| D5 | **`WebGLRenderer` (WebGL2), imperative three.js, no React Three Fiber.** On the UHD 630, `WebGPURenderer` r186 was 1.2× slower with one draw call and 2.3× slower with 400. postprocessing and N8AO are WebGL-only. | §1.4 |
| D6 | **LOW pipeline** (Intel UHD/HD, the declared target), in order:<br>depth pre-pass → opaque pass → sky drawn last → bloom **only at night** → Neutral tone map and vignette → FXAA.<br>2048 shadow map, buildings only. **No SSAO**: N8AO "Performance" at half resolution costs **+14 to 17 ms** on the UHD 630; shader AO replaces it.<br>**Measured 11.3–14.8 ms per frame at 1920×1080** with every LOW feature on, while the machine was under heavy background load. | §1.2 |
| D7 | Budgets for a UHD 630 at 1080p and 60 fps: **≤ 14 ms GPU, ≤ 2.5 ms JS submit, ≤ 250 draw calls, ≤ 700k triangles across all passes, ≤ 48 MB geometry, ≤ 96 MB render targets.** Dynamic resolution scale 0.7–1.0, driven by a frame-time governor rather than GPU timer queries, which are unreliable here (§1.7). | §5.10 |
| D8 | **Camera: camera-controls 3.1.2** with FOV 35°, UX bindings (right-drag pans the ground, middle-drag rotates, Q/E rotate in 45° steps, wheel dollies to the cursor) and a tilt that follows zoom inside the UX limits of 35–65° elevation. `fitToBox` handles focus. The dynamic near plane is `clamp(0.2·d, 1, 200)`. | §5.11 |
| D9 | **Picking is CPU work**: a DDA walk over the plot grid plus an exact ray/AABB test per building. It is O(cells on the ray), needs no GPU read-back, and needs no BVH package. | §5.12 |
| D10 | **The living city reflects the economy.** Smoke scales with utilization. Trucks in owner livery follow `supplyFlows`. Parked cars and shoppers scale with units sold. Billboards come from ad campaigns, crops follow the month, construction sites show stages, and closed firms go dark. | §3.16 |
| D11 | **Packages:** `three@0.186.1` (pinned exactly), `postprocessing@6.39.5` (peer `three >= 0.168 < 0.187`, so upgrade the two together), `camera-controls@3.1.2`, `n8ao@2.0.1` (HIGH tier only, ships no types; shim in Appendix A), `stats-gl@4.2.3` (dev). **Not used:** R3F/drei, three-stdlib, detect-gpu, three-mesh-bvh (optional later). | §6 |
| D12 | **Owner colours:** the player is always **blue #2F7DE1** (bridge index 0, legacy client), and rivals take an Okabe–Ito-derived set. Emblem shapes are the redundant channel for colour-blind players. The UX report's "player = gold" becomes a **gold status badge and ring** over your firms, not paint. | §2.2, §3.4 |

---

## 1. Evidence: a prototype measured on an Intel UHD 630

### 1.1 Setup and method

**Machine.** The development Mac is a 16" MacBook Pro 2019 (i9-9880H) with both an **Intel UHD Graphics 630** and an AMD Radeon Pro 5500M. The UHD 630 is exactly the target in the task.
- Chrome 154.0.8037.92 in new-headless mode uses the real GPU through ANGLE-Metal.
- `powerPreference: 'default'` or `'low-power'` gives `ANGLE (Intel, ANGLE Metal Renderer: Intel(R) UHD Graphics 630)`; `'high-performance'` gives the Radeon.
- Available extensions: `WEBGL_multi_draw`, `KHR_parallel_shader_compile`, `EXT_disjoint_timer_query_webgl2`, `EXT_clip_control`. WebGPU is also available (adapter `intel / gen-9`).

**Scene.** A procedural 80×80-plot coastal city the size of Metropolis, at 20 m plots for the benchmark (cost scales with object counts, not metres; see §2.1). Its contents:

| Item | Count |
|---|---|
| Lots | 2,006, of which 39 are company-owned and cover all 18 building types |
| Chunk meshes | 64, holding **157k triangles** of buildings, ground, roads and markings |
| Trees | 8,323, including outskirts forest clumps |
| Street lamps | 3,042 |
| Parked cars | 2,067 |
| Moving vehicles | 500 (sedans, trucks and buses) |
| Smoke emitters | 7 |
| Other | A sea plane and a sky dome |

**Views.** All at 1920×1080 and DPR 1:
- **Overview:** the whole city, 2,350 m from the target at 52° elevation.
- **Mid:** the CBD from 760 m at 46°.
- **Close:** 230 m at 38°.

**Metric: drained throughput.**
1. `gl.readPixels` 1 px to sync.
2. Render 40 frames back to back.
3. Sync again, and report ms per frame.

This is repeated 5 times, and the median and min are reported. JS submit time is measured separately.

**Caveat.** Every run happened while the machine was under heavy background load: load average about 8, from Spotlight indexing and other agents' builds. Medians are therefore **pessimistic**, and min is closer to an idle machine.

### 1.2 Results: naive versus optimized (UHD 630, ms per frame, median with min in brackets)

"OPT" means four things:
- camera-distance LOD (trees switch to an 8-triangle model beyond 900 m; vehicles, parked cars and lamps are hidden beyond 1,100, 700 and 800 m);
- instanced families partitioned into 400 m cells;
- a depth pre-pass over the chunk meshes;
- the sky drawn after the opaque geometry.

| Configuration | Overview | Mid | Close | Tris, all passes (ov/mid/close) | Draw calls (ov) |
|---|---|---|---|---|---|
| Naive: no shadows, no post | 16.0 (15.9) | 16.7 (16.1) | 17.3 (16.5) | 671k / 608k / 554k | 76 |
| Naive + shadows 2048, all casters | 22.4 (19.7) | 22.7 (22.3) | 22.4 (21.8) | 1,062k / 958k / 825k | 143 |
| Naive + shadows + post (bloom, tone map, vignette, SMAA) | 28.1 (27.6) | 30.5 (30.3) | 41.2 (28.4) | same | 159 |
| Naive + all of the above + **N8AO Performance, half res** | 45.3 (44.2) | 47.5 (46.7) | 45.7 (43.9) | +6k | 170 |
| LOD only, no shadows, no post | 9.5 (9.3) | 14.7 (14.4) | 16.8 (16.6) | 231k / 459k / 554k | 71 |
| **OPT + shadows (buildings) + inline tone map, no post** | 14.3 (13.3) | 12.7 (12.5) | 12.3 (10.3) | 545k / 553k / 370k | 198 |
| **OPT LOW: + composer (Neutral, vignette, FXAA), no bloom** | 12.4 (11.9) | 15.3 (14.8) | 13.8 (13.2) | 545k / 553k / 370k | 200 |
| **OPT LOW, final CityMaterial (all shader features)** | **11.6 (11.3)** | **14.8 (14.8)** | **12.1 (12.0)** | 538k / 553k / 369k | 199 |
| OPT LOW + bloom (night, 22:00) | 14.6 (14.3) | 18.7 (18.6) | 25.7 (15.9) | +8k | 212 |
| OPT LOW + shadow map re-rendered every 4th frame | 13.3 (11.6) | 14.8 (14.6) | 19.2 (12.0) | 388k / 436k / 333k | 136 |
| OPT MED: + tree shadows + bloom + SMAA | 30.6 (18.7) | 37.4 (22.3) | 30.4 (18.1) | 611k / 708k / 439k | 217 |
| OPT MED + N8AO Performance, half res | 33.1 (32.4) | 37.3 (37.0) | 36.3 (33.6) | 618k / 714k / 445k | 226 |

Reference numbers on the discrete **Radeon Pro 5500M**, same scene and views:

| Tier | Contents | Overview | Mid | Close |
|---|---|---|---|---|
| HIGH | OPT + tree shadows + 4096 shadow map + bloom + SMAA + N8AO Low (half res) | 6.5 | 7.0 | 7.1 |
| ULTRA | as HIGH, plus MeshStandardMaterial everywhere and N8AO Medium at full res | 10.2 | 12.2 | 15.2 (13.2) |

**Conclusions from §1.2.**
- **The LOW pipeline meets 60 fps at 1080p on the UHD 630**, with 1–5 ms of headroom even under load.
- SSAO does not fit the iGPU budget.
- Bloom should only run when the night factor is above 0 on LOW.
- A dGPU can run everything.

### 1.3 Per-feature costs (UHD 630, 1080p; deltas are between rows measured the same way)

| Feature | Cost | Measured as |
|---|---|---|
| MeshStandardMaterial instead of Lambert | **+4.4 ms** (13.5 → 17.9) | close view, LOD and partition, no shadows or post |
| Procedural window shader | +2.3 ms (11.2 → 13.5) | close view |
| Final CityMaterial features: owner tint, season, snow, wet, overlay | +0.7 to +0.9 ms | LOW pipeline, three views |
| **Depth pre-pass over the chunk meshes** | **−3.9 ms** (13.5 → 9.6) at close view, where overdraw is highest | direct render |
| Sky dome drawn **last** instead of first | −1.5 ms (13.5 → 11.9) | close view |
| MeshBasic override (vertex, raster and minimal fragment work) | 6.4 ms | close view; shows about 7 ms of the 13.5 ms is fragment shading |
| DPR 0.75 / 0.5 | −3.9 ms / −6.7 ms | close view, from 13.5 ms |
| DPR 0.85 | −2.3 ms | mid view, LOW pipeline |
| Partitioning instanced families into 400 m cells | −3.3 ms (16.8 → 13.5), triangles 554k → 293k | close view |
| Distance LOD for trees, vehicles and lamps | −6.5 ms (16.0 → 9.5), triangles 671k → 231k | overview |
| Shadows 2048, all casters (naive scene) | +5.1 to +6.3 ms (medians) | |
| Shadow map 4096 instead of 2048 | +2.5 ms | |
| SMAA (MEDIUM) instead of FXAA | +2.5 ms | |
| Bloom (mipmap, 6 levels) | +2.8 ms | |
| Native MSAA 4× (`antialias: true`, direct) | **+4.4 to +8.2 ms** | too expensive on this iGPU |
| N8AO Performance, half res | **+14 to +17 ms** | not viable on UHD 630 |
| Unaligned vertex formats (`Int8×3` normals, `Uint8×1`) | no consistent difference after draining (14.5 / 11.7 ms unaligned vs 11.7 / 11.9 aligned) | still use 4-byte-aligned formats: ANGLE-Metal converts unaligned formats at upload (§5.4) |
| Per-frame `instanceMatrix` upload for 500 cars | no difference (12.0 vs 12.2 ms drained) | CPU traffic simulation is fine |

### 1.4 WebGLRenderer versus WebGPURenderer (three r186, UHD 630, 1080p)

This micro-benchmark renders 20,000 instanced boxes (240k triangles) with a Lambert material, drained the same way.

| Draw calls | WebGL2 | WebGPU (`three/webgpu`, Dawn/Metal) |
|---|---|---|
| 1 | 2.66 ms (2.37) | 3.28 ms (3.13) |
| 400 | 3.92 ms (3.82) | **9.15 ms (8.85)** |

`forceWebGL` mode of `WebGPURenderer` hung past a 30 s navigation timeout in this setup. **Decision: WebGL2 for v1.** Keep all shader customisation in one module, `CityMaterial`, so a later TSL port is contained (§5.6).

### 1.5 three.js post-processing add-ons versus pmndrs postprocessing

At the mid view, with bloom, tone mapping and FXAA, the two stacks measured:
- `RenderPass → UnrealBloomPass → OutputPass → FXAAPass` (three add-ons): 21.0 ms (20.8).
- `RenderPass → EffectPass(Bloom, ToneMapping, Vignette) → EffectPass(FXAA)` (postprocessing): 23.9 ms (20.2).

The difference is **within noise**. postprocessing is chosen for its **features**, not for speed:
- `SMAAEffect`;
- `OutlineEffect` with selection layers;
- `TiltShiftEffect` for photo mode;
- `ToneMappingEffect` with NEUTRAL;
- `LUT3DEffect` for colour grading;
- effect merging into one pass;
- N8AO integration.

### 1.6 What the renders taught (art findings)

1. **Procedural windows** read convincingly at all three zoom bands. Below about 1.5 px per window cell they **must fade to the average coverage**; otherwise facades show moiré.
2. **Night:**
   - Warm residential windows and cool office windows work well together.
   - Office curtain walls must emit about **0.55×** what residential windows do, and light in **per-floor 3-bay clusters**. Otherwise towers read as solid white slabs.
   - Far-field averaging must use about 0.5× the lit share.
3. **Light pools** under street lamps must stay at **≤ 0.14 opacity** and be hidden beyond about 900 m. Otherwise the city becomes "polka dots".
4. **Dusk:** direct sun must drop to about 0 between sunset and one hour after it (intensity 0.03 at 20:06). Otherwise warm walls turn maroon.
5. **Flat grey roofs dominate the mid zoom.** Roof palette variety is mandatory (membrane, gravel, green, solar, tar), along with rooftop plant.
6. **Overview:** the city floats on an empty meadow. Outskirts are required (field patchwork, forests, hills, highways), and the layout generator should vary block sizes (§8, Q6).
7. **Port cranes** modelled as solid slabs read as tables. They need truss booms and A-frame legs, and the port needs a quay wall on the water.
8. **Clay-mode overlay** reads very well: desaturate the city, then paint data colours on roofs and ground, as in SimCity 2013 data maps and Cities: Skylines info views.
9. **Owner roof tint at distance:** company roofs fade to the owner colour as the camera leaves district zoom. This makes ownership readable over the whole map.
   - It must apply to **roofs only**.
   - Tinting whole lots (fields, yards) read as noise and was removed.
10. **Snow** (up-facing mix) and **rain** (darker paving plus a sheen) work with no extra passes.
    - Roads should get only partial snow, as if ploughed (§3.14).
11. **Tilt-shift** (postprocessing `TiltShiftEffect`, focus area 0.45, feather 0.35) gives an instant "miniature" photo mode. It is optional and off by default.

### 1.7 Measurement pitfalls (these matter for the in-game governor)

- In headless Chrome, `requestAnimationFrame` is **not vsync-paced**. Timing loops must drain the GPU (`readPixels`) before and after; naive loops over-reported frame time by 3–10×.
- **`EXT_disjoint_timer_query_webgl2` returns no results** (disjoint) on ANGLE-Metal/Intel whenever an instanced buffer is uploaded in the frame. **Do not base the quality governor on GPU timer queries**: use an EMA of rAF frame time (§5.10).

---

## 2. Alignment with the other overhaul reports and the `web/` skeleton

Five sibling reports exist in `docs/overhaul/research/`, and a `web/` skeleton exists:
- `web/src/scene/CityScene.ts`, `SceneContext.ts`, `units.ts` and `modules/PlaceholderCity.ts`;
- three `^0.186.1` in `web/package.json`.

This report builds on them. Where they disagree, this section decides and gives the reason.

### 2.1 Plot size: 12 m (skeleton) versus 24 m (`caplab-brief.md` §5.1) versus 20 m (this prototype) → **24 m**

- **12 m** (`web/src/scene/units.ts:6`) is too small for the content footprints:
  - a 1×1 `convenience_store` becomes a 144 m² kiosk with no room for a forecourt;
  - a 3×3 `supermarket` becomes 36×36 m, with no car park;
  - a road plot becomes a 12 m right of way, which fits no arterial;
  - Metropolis becomes less than 1 km across.
- **24 m** gives realistic lots:
  - a house on 576 m²;
  - a supermarket on 72×72 m (a 60×34 m box plus a car park);
  - a 24 m right of way for streets (2 lanes plus parking, trees and 4 m sidewalks) and arterials (4 lanes, a median and sidewalks).
  - Metropolis becomes 1.92 km.
- It also matches `caplab-brief.md` §5.1 ("1 tile = 24 m") and its zone and block table (§5.3).
- Rendering cost is driven by object counts, not metres, so the §1 numbers transfer. The prototype's 20 m scene has the same objects.
- **LOD distance bands stay in metres.** They are set by an object's projected size (a car is 2 px tall at about 1,280 m with FOV 35° and 1080 px), so they do **not** scale with plot size.

**Action.** Change `PLOT_SIZE` to 24 in `web/src/scene/units.ts:6`. The audio plan's `setRefDistance(1.2 × max(fw, fh) × PLOT_SIZE)` (`audio-plan.md` §4.9) scales automatically.

### 2.2 Owner colours: three competing proposals → one palette

**The three proposals.**

| Source | Proposal |
|---|---|
| Bridge (`engine/Magnate.Bridge/GameSession.Game.cs:244-247`) | `#2f7de1, #e0493e, #f2a93b, #3fb68b, #9b5de5, #e86aa6, #16a3b8, #8c6d46` by `(id − 1) % 8`, with the player (id 1) blue; `colorIndex` is exposed (`bridge-spec.md` §5.3) |
| Legacy client (`client/scripts/CityMap.cs:33-41`) | Player blue, then amber, green, purple, red and cyan |
| UX (`ux-playability.md` §6.5) | Player gold accent; rivals from Okabe–Ito: `#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7` |

**Problems in a lit 3D world.**
- Gold and yellow roofs vanish against wheat fields and sand, and gold is already the UI's selection and "strategic highlight" colour (`UiChrome.cs:21`, `#d7b766`).
- Green (`#3fb68b`) competes with grass and trees.
- Brown (`#8c6d46`) reads as a roof or as soil.
- Red and green pairs fail deuteranopes.

**Decision** (§3.4 has the full table):
- Index 0 (player) is `#2F7DE1`, which keeps the bridge colour.
- Rivals use an Okabe–Ito-derived set tuned for Neutral tone mapping and the muted environment: `#E69F00, #CC79A7, #009E73, #D55E00, #56B4E9, #F0C419, #7E57C2`.
- Each company also gets an **emblem shape** (circle, triangle, square, diamond, star, hexagon, cross, ring) on signs, flags, badges and truck doors.
- "Player = gold" from UX is honoured as a **gold status badge and gold ground ring** under your firms, not as building paint.

**Actions.**
1. The bridge's `CompanyColors` should be replaced by this palette, and `colorIndex` 0 should be guaranteed to the player.
2. The palette should live in a shared tokens module (`web/src/theme/tokens.ts`) used by both the React UI and the scene.

### 2.3 Day and night: 4 min (`caplab-brief.md` §5.7) versus ≥ 8 min (`audio-plan.md` §4.8) versus "no 0.4 s/day flicker" (UX §6.5) → **cosmetic 12-minute cycle, independent of game speed**

- **Default:** a cosmetic 12-minute visual day (§3.6), independent of game speed.
- **Settings:** "Dynamic (12 min) | Fixed day (13:00) | Fixed golden hour (18:30) | Fixed night (22:30)". Reduced motion (or an OS `prefers-reduced-motion`) selects Fixed day.
- **Seasons** follow the game month (§3.14).
- The renderer publishes `timeOfDay` in hours for the audio `AudioFrame` (§5.22), or `null` when fixed.

### 2.4 Camera: follow the UX bindings (`ux-playability.md` §6.5)

- **Mouse and keys:**
  - left click selects or places;
  - **right-drag pans the ground**;
  - **middle-drag rotates**;
  - Q/E rotate in 45° steps;
  - WASD and the arrow keys pan;
  - the wheel dollies to the cursor.
- **Tilt:** 35–65° elevation, which is 25–55° polar.
- **Pan limits:** the city bounds plus 10%.
- **Focus:** a double-click focuses a building with a 0.6 s ease.

Implementation is in §5.11 (camera-controls). This replaces the skeleton's `MapControls` setup (`web/src/scene/CityScene.ts:44-53`).

### 2.5 Data contract: consume the bridge DTOs as specified

| Renderer need | Bridge method (`bridge-spec.md`) | Notes |
|---|---|---|
| Static layout: roads, parcels, water, ambient development | `cityLayout` (§8.1, `CityLayoutDto`), cached by `layoutRev` | Additive requests are in §5.3 |
| Company buildings, state and activity | `cityView` (§5.5): `BuildingVisualDto` with `visualRev` deltas, plus `CityActivityDto` | `utilization` drives smoke, `unitsSold` drives parked cars and shoppers, `transfersIn/Out` drive dock activity, `status` drives lights on or off, `construction.progress` drives site stages |
| Trucks, ships and link arcs | `supplyFlows` (§5.5), per month | Kinds `transfer`, `import`, `export`, `retail` |
| City list and minimap | `worldMap` | |
| Company colour | `colorIndex` (§5.3) | See §2.2 |

The renderer never calls the engine per frame. It diffs by `visualRev` and `layoutRev`, and schedules chunk rebuilds (§5.4).

### 2.6 Fixes needed in the existing skeleton (`web/src/scene/CityScene.ts`)

| Line | Today | Change |
|---|---|---|
| 39 | `shadowMap.type = THREE.PCFSoftShadowMap` | r186 logs "PCFSoftShadowMap has been removed. Using PCFShadowMap instead." (`three/src/renderers/webgl/WebGLShadowMap.js:99-102`). Use `PCFShadowMap` plus `light.shadow.radius`. |
| 36 | `toneMapping = ACESFilmicToneMapping` | Use `NoToneMapping` on the renderer and do Neutral in the composer (§3.8). ACES shifts saturated owner colours. |
| 33 | `antialias: true` | Set it to `false` when the composer is used: the MSAA default framebuffer is wasted, and native MSAA costs +4.4 to 8.2 ms on UHD 630. |
| 34 | `setPixelRatio(min(dpr, pixelRatioCap ?? 2))` | Use the tier cap (LOW 1.0, MED 1.25, HIGH 2.0) × the governor scale (§5.10). |
| 48-57 | `MapControls` | Replace with camera-controls (§5.11), or keep MapControls as a zero-dependency fallback. MapControls in r186 has true "grab the ground" panning. |
| 59-60 | a static background colour and `THREE.Fog('#b9d7ea', 900, 3200)` | Sky and fog are driven per time of day and camera distance (§3.7). |
| 23 | `THREE.Timer` | Correct: `Clock` is deprecated since r183. Keep it. |

Keep the `SceneModule` contract (`web/src/scene/SceneContext.ts:32-43`). §5.2 maps every render subsystem onto it.

---

## 3. Art bible

### 3.1 Pillars and references

1. **A scale model that feels real.**
   - Correct real-world proportions: doors 2.1 m, residential floors 3.0 m, office floors 3.7 m, retail ground floors 4.2–4.5 m, lanes 3.25–3.5 m, cars 4.5 m.
   - Forms are simplified to flat-shaded solids: no bevels, no photo textures, no normal maps.
   - The silhouette carries the identity.
   - Detail comes from the procedural facade shader and from small props, not from triangles.
2. **Colour carries meaning.**
   - The environment is low-chroma and warm: HSL saturation ≤ 35% (except water and sky), lightness 45–90%.
   - Saturated colour is reserved for:
     - company ownership (owner palette, emblem, livery);
     - UI semantics (gold for selection and "yours", green for profit, red for risk);
     - data overlays.
   - At any zoom a player can tell **who owns what**.
3. **The city is alive, and the life is the economy.**
   - Every moving or changing thing is driven by simulation state:
     - production drives smoke and trucks;
     - sales drive shoppers and car-park fill;
     - campaigns drive billboards;
     - construction drives cranes;
     - bankruptcy drives dark, boarded buildings;
     - the month drives crops and seasons.
   - Cosmetic-only life (ambient traffic, pedestrians, water) is density-scaled from the same data.
4. **Three zoom bands, three readings** (§3.15):
   - Street: *what is this building doing?*
   - District: *who is winning this neighbourhood?*
   - City: *where is my empire, and where is the money?*
5. **Performance is an art constraint.** An asset that breaks the UHD 630 budget (§5.10) is not finished.

**References, and what we take from each:**

| Game | What we take |
|---|---|
| Mini Motorways | Colour = gameplay meaning; calm muted maps |
| Townscaper | Soft ambient occlusion, pastel walls, a friendly sea |
| Pocket City 2 | Dense small life, day and night, weather |
| Cities: Skylines | Road hierarchy, real proportions, info views that grey out the city |
| SimCity (2013) | Tilt-shift photo mode, "clay" data maps |
| Capitalism Lab | 80×80 cities with pre-laid roads, rectangular lots, company colours on the map, land and traffic overlays |

### 3.2 Scale, units and coordinates

**Units and coordinates.**

| Quantity | Value |
|---|---|
| World unit | 1 metre |
| Plot | **24 m × 24 m** (§2.1) |
| Axes | +X east, +Z south, +Y up |
| Plot (0,0) | NW corner; the city is centred on the origin (`web/src/scene/units.ts`) |
| Plot centre | `x = (px + 0.5 − gridW/2)·24`, `z = (pz + 0.5 − gridH/2)·24` |

**City sizes.**

| City | Grid | Size |
|---|---|---|
| Metropolis | 80×80 | 1.92 km, diagonal 2.72 km |
| Riverside | 60 | 1.44 km |
| Eastside | 55 | 1.32 km |
| Portbay | 50 | 1.20 km |
| Hilltown | 40 | 0.96 km |

**Lot frame used by every AssetFactory.**
- The origin is the lot centre, **+Z is the street-facing front**, and `W × D` are the lot extents in metres after rotation.
- Rotation is a quarter turn: facing S = 0, E = 1, N = 2, W = 3 (the prototype's `frame()`).
- Facing is derived from road adjacency (§5.3).
- **Margins:** buildings stay ≥ 1.0 m inside the lot edges. Row houses may share party walls inside their own lot. Nothing may cross the lot boundary, because picking and overlap checks rely on it.

**Heights.**
- Residential floor 3.0 m, with a 0.4–1.0 m plinth.
- Office floor 3.7 m; podium 8 m.
- Retail ground floor 4.2–4.5 m.
- Industrial halls: 8–14 m to the eaves.
- Parapet 0.7 m. House roof pitch 30–38° (default 34°).

**Road cross-sections.** A road plot is a 24 m right of way.

| `RoadDto.kind` | Carriageway | Each side | Total |
|---|---|---|---|
| `street` (2 lanes) | 2 × 3.5 m lanes + 2 × 2.5 m parking lanes = 12 m | 2.0 m planting/lamp strip + 4.0 m sidewalk | 24 m |
| `arterial` (4 lanes) | 4 × 3.25 m lanes + 2.0 m planted median = 15 m | 4.5 m sidewalk (lamps at the curb, trees in grates every 12 m) | 24 m |
| `highway` (4–6 lanes) | 4 × 3.5 m + 2 m median with a guard-rail, or 6 × 3.5 m | 2–3 m grass verges, no sidewalks | 24 m |

Other road details:
- Curbs are 0.15 m high.
- Street corners get **quarter-circle curbs**: radius 6 m on streets, 9 m where an arterial is involved, 8 segments.

### 3.3 Palette (sRGB hex; decoded to linear in the shader)

**Ground and landscape**

| Token | Hex | Use |
|---|---|---|
| grass | `#96B46B` | lawns, verges (alternate plots with grass2 at 50% by hash) |
| grass2 | `#8EAD65` | lawn variation |
| park | `#86AE5E` | parks, campus lawns |
| meadow | `#A2B878` | outskirts ground |
| dryGrass | `#C4BE82` | late summer, arid (Portbay scrub) |
| yard | `#A9C47A` | back gardens, courtyards |
| soil / soilDark | `#9C7A56` / `#7C5E43` | ploughed fields, excavation |
| sand | `#E6D6A8` | beaches, the 1-plot shore strip |
| rock / gravel | `#9C968C` / `#A7A197` | slopes, oil-well pads, rail ballast |

**Roads and hardscape**

| Token | Hex | Use |
|---|---|---|
| asphalt | `#5A5F67` | streets |
| asphaltDark | `#50545B` | arterials, highways |
| parking | `#6C7077` | car parks, industrial yards |
| sidewalk / curb | `#CFCAC0` / `#B8B2A7` | sidewalk top / curb face |
| plaza | `#DDD5C6` | plazas, driveways, paths |
| marking / markingYellow | `#F4F1E6` / `#F0C75E` | lane lines, zebras / arterial centre lines |

**Walls** (residential and commercial ambient; never owner colours)

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| warmWhite | `#EFE8DA` | | brick | `#B0654F` |
| cream | `#EADCBC` | | sage | `#BFD0B0` |
| sandWall | `#DCC49A` | | powderBlue | `#B6CBDB` |
| peach | `#E9C3A6` | | lilacGrey | `#C9C2D2` |
| terracotta | `#CD8466` | | greige | `#CFC8BC` |
| stone | `#BDB6A8` | | concrete / concreteDark | `#B9B6AE` / `#8E8C87` |
| aluminium | `#C7CDD3` | | steelBlue | `#9AA6B1` |
| limestone | `#D8D2C4` | | apt extras | `#E4D3B5`, `#D9B99B` |

**Roofs**

| Token | Hex | Token | Hex |
|---|---|---|---|
| roofShingle (houses) | `#5B5F66` | roofFlat (light) | `#B9B5AD` |
| roofTile (clay) | `#B8614A` | roofMembrane (white) | `#D3D0C8` |
| roofSlate | `#5F6F7E` | roofGravel | `#A39E94` |
| roofCopper (civic domes) | `#6E9A86` | roofTar (towers) | `#6E6F71` |
| roofGreen (15% of flat roofs) | `#8FAE6A` | solar panels | `#2E3B55` |

**Glass, industry and vegetation**

| Token | Hex | Token | Hex |
|---|---|---|---|
| glass (window base) | `#46607A` | glass2 (window variation) | `#6F8FA6` |
| silver cladding | `#B4BAC0` | galvanized | `#9FA7AE` |
| industrial blue | `#5C7C99` | tank white | `#E4E4DE` |
| chimney brick | `#8E4E3C` | rust | `#9A5A3C` |
| safety yellow | `#E8B63A` | dock doors | `#5A6068` |
| leaf1 / leaf2 / leaf3 | `#5E9A4B` / `#72A852` / `#4B8743` | conifer | `#3A6B48` |
| autumn | `#D09A45`, `#C0633A` | trunk | `#6E523E` |

Tree instance tints are `#FFFFFF #E8F2D8 #F4F7E6 #DDEBCB #FFF2D0`, multiplying vegetation by ±12%.

**Crops** (ripe / growing)

| Crop | Ripe | Growing | Notes |
|---|---|---|---|
| Wheat | `#D9BE62` | `#A9B85A` | |
| Sugarcane | `#6FA548` | `#5E8F3E` | |
| Cotton | bolls `#EDEBE3` | leaf `#7E9B5A` | |
| Coffee | `#3F6B3A` | `#4F7A43` | cherries `#B8323A` at harvest |
| Hops | `#5E8F3F` | `#6FA04A` | |
| Furrows and stubble | `#8A6A4A` | | also stubble `#B8A27A` |

**Water:** deep `#2F6F93`, mid `#3F86A8`, shallow `#5FAFC4`, foam `#EAF4F4`.

**Vehicles.** The body colour distribution (by instance) is:

| White | Black | Grey | Silver | Blue | Red | Green | Beige | Yellow |
|---|---|---|---|---|---|---|---|---|
| `#EDEDED` 25% | `#2A2C30` 20% | `#8A8F96` 18% | `#BFC3C7` 12% | `#3D5F8F` 9% | `#B8322E` 8% | `#4F6B4A` 3% | `#C9B48A` 3% | `#E0B43A` 2% |

Also: taxi `#F2C230`, transit bus `#D8452F` (per-city livery allowed), trailer `#E9E9E4`.

**Night emissive** (linear HDR, multiplied by `uEmiBoost = 2.4`):

| Source | Colour |
|---|---|
| Warm window | (1.00, 0.72, 0.38) |
| Office window | (0.75, 0.85, 1.00) × 0.7 |
| Curtain wall | (0.75, 0.85, 1.00) × 0.55 |
| Lamps and signs | their own vertex colour × 1.6 |
| Light pool | (1.0, 0.72, 0.40) at opacity 0.14 × night |

**UI semantic colours** (shared with the React HUD; from `client/scripts/UiChrome.cs:17-25`): ink `#0B1117`, panel `#101A22`, stroke `#375263`, gold `#D7B766` (selection, "yours"), blue `#5AA7D8` (information), green `#61C28F` (profit, valid), red `#DF6F6A` (loss, invalid), muted `#9FB2BD`.

**Clay mode.** When a data overlay is on (§5.14), surfaces become `lum × 0.35 + 0.45` grey. Roofs and ground then take 78% of the ramp colour; walls take 35%.

### 3.4 Owner colours, emblems and badges

| colorIndex | Role | Hex | Emblem | Notes |
|---|---|---|---|---|
| 0 | **Player** | `#2F7DE1` | ● circle | Bridge index 0 and legacy blue; the most distinct hue against the warm and green environment |
| 1 | Rival | `#E69F00` | ▲ triangle | Okabe–Ito orange |
| 2 | Rival | `#CC79A7` | ■ square | Okabe–Ito reddish purple |
| 3 | Rival | `#009E73` | ◆ diamond | Okabe–Ito bluish green; distinguished from grass by its blue shift |
| 4 | Rival | `#D55E00` | ★ star | Okabe–Ito vermillion |
| 5 | Rival | `#56B4E9` | ⬢ hexagon | Okabe–Ito sky blue; paired with index 0 by lightness, not by hue |
| 6 | Rival | `#F0C419` | ✚ cross | Deeper than Okabe–Ito yellow so it separates from wheat and sand |
| 7 | Rival | `#7E57C2` | ◯ ring | Violet, replacing Okabe–Ito black (black reads as shadow in 3D) |

**Where owner colour goes.** It must never cover more than about 15% of a building's visible surface at street zoom.
- **Paint slots:** roof accent band (parapet or ridge), fascia sign and wordmark board, awning, flag, pylon sign, truck and van cab, crane counterweight and boom, pumpjack beam, construction hoarding, OB van livery.
- **At city zoom** the roof faces of company buildings are tinted to the owner colour. This is `FLAG_OWNER_ROOF`, mixed at 0.85 × `smoothstep(900, 1600, cameraDistance)`, and verified in §1.6.

**Status badges.** Instanced camera-facing quads, 28 px, from the icon atlas (§5.7), floating 6 m above the roof.
- They show only over **your** buildings at district and city zoom: green `#61C28F` = profitable, amber `#E8B63A` = warning, red `#DF6F6A` = loss.
- A **gold ring decal** (`#D7B766`, 1.5 m wide, on the lot outline) marks your firms at every zoom. This is the UX report's "player = gold".
- Rivals get a small emblem badge only on hover, or in the Owners overlay.
- Local competitors (ambient shops) and civic buildings are neutral: civic buildings are blue-grey `#8FA3B5` in the Owners overlay, as on CapLab's minimap.

### 3.5 Materials and shading model

- **One `MeshLambertMaterial`** (`vertexColors: true`) serves chunks, trees, vehicles and props. `onBeforeCompile` replaces `color_vertex`, `color_fragment` and `emissivemap_fragment` (Appendix A, `CityMaterial.ts`). One `customProgramCacheKey` means two programs in practice, one instanced and one not.
- **Vertex colours** are stored as **sRGB `Uint8×4`** and decoded to linear in the vertex shader (`m_srgb2lin`). This avoids the banding of 8-bit linear colour.
  - Alpha is **not** opacity. It is the *instance-tint weight*: 255 means `instanceColor` fully multiplies (car bodies, tree canopies); 0 means never (glass, lights, contact shadows).
- **Procedural windows.** Walls carry facade UVs in metres (u along the wall, v = height above the ground) and a facade attribute `(style, seed, floor or wall height in dm, bay in dm)`.
  - The fragment shader computes the cell as `floor(fuv / cellSize)` and the window rectangle per style, anti-aliased with `fwidth`.
  - Lit state is `hash(cellId + seed) < litFraction × litMul`. Offices use 3-bay clusters per floor.
  - The pattern **fades to average coverage when a cell is under about 1.5 px** (`smoothstep(0.35, 0.8, fwidth)`).
  - Glass colour varies per window between `glass` and `glass2`.
  - By day glass gets a fake sky reflection, `(0.08 + 0.35·fresnel³)·skyColour`.

| Style id | Name | Bay | Floor | Window rect in the cell (u0, v0, u1, v1) | Lit × | Night colour |
|---|---|---|---|---|---|---|
| 0 | none | — | — | — | — | — |
| 1 | HOUSE | 3.0 m | 3.0 m | 0.30, 0.32, 0.70, 0.78 | 1.0 | warm |
| 2 | APARTMENT | 3.3 m | 3.0 m | 0.16, 0.28, 0.84, 0.82 | 1.0 | warm |
| 3 | CURTAIN WALL | 1.6 m | 3.7 m | 0.04, 0.05, 0.96, 0.95 | 0.7 | cool × 0.55 |
| 4 | SHOP | ground band 4.5 × 4.2 m; above it, bay and floor from the attribute | | ground 0.04, 0.06, 0.96, 0.80; upper 0.20, 0.28, 0.80, 0.80 | 2.2 ground (open until 22:00, then 0.3) | warm |
| 5 | INDUSTRIAL | 5.0 m | attribute = wall height | clerestory band at 70–88% of the wall; 0.06–0.94 of the bay | 0.85 (night shifts) | cool |
| 6 | OFFICE ribbon | 3.0 m | 3.7 m | 0.03, 0.34, 0.97, 0.88 | 0.8 | cool × 0.7 |
| 7 *(to add)* | RETAIL-UPPER | 6.0 m | 4.2 m | blind panels with 2 banner slots | — | uplight strip |
| 8 *(to add)* | CIVIC arched | 3.6 m | 5.0 m | 0.25, 0.15, 0.75, 0.85, arched top | 0.6 | warm |

- **Wall-base AO** replaces SSAO on LOW and MED. Every facade fragment is darkened by `mix(0.62, 1.0, smoothstep(0, 3.5 m, height))`.
  - In addition, each building footprint gets a 1.5 m **contact apron** baked into the chunk ground: ground colour × 0.82.
  - Rooftop plant boxes get a baked 0.85 multiplier on their bottom 0.5 m.
- **Emissive** comes from the `extra.x` byte (lamp heads, signs, aviation lights, stadium banks). It glows in its *own* vertex colour × `uNight × 2.4 × 1.6`, so owner-coloured signs glow in the owner colour.
- **Exceptions to Lambert:**
  - Water uses `MeshStandardMaterial` (roughness 0.22, analytic wave normals; §3.11).
  - Signs use Lambert with the atlas `map` and `emissiveMap` (§5.7).
  - Sky, smoke, rain and light pools use small custom or `MeshBasicMaterial` shaders.
  - On ULTRA only, curtain-wall towers may use `MeshStandardMaterial` (metalness 0.2, roughness 0.15) with a PMREM of the sky.

### 3.6 Lighting rig and time of day

**Rig.**
- One `DirectionalLight` (sun by day, moon by night; it casts the only shadow).
- One `HemisphereLight` (sky and ground fill).
- No ambient light and no point lights: local night lighting is emissive plus additive light pools.

**Sun path.**

| Quantity | Value |
|---|---|
| Sunrise | 06:30 |
| Sunset | 19:45 |
| Elevation | `58°·sin(π·dayFraction)`; the maximum of 58° is at 13:07 |
| Azimuth | from north, `100° + 160°·dayFraction` (ESE to S to WSW) |
| Moon | fixed at elevation 48°, azimuth 215°, colour `#9FB4FF` |

**Cycle.** The visual day is **12 minutes** (§2.3). Hour `h` interpolates the keyframes below with smoothstep. Colours are sRGB hex; intensities are three.js units with `useLegacyLights` removed (r165+).

| Hour | Sun colour | Sun int. | Sky top | Horizon | Hemi sky | Hemi ground | Hemi int. | Fog | Night |
|---|---|---|---|---|---|---|---|---|---|
| 00:00 | `#9FB4FF` (moon) | 0.45 | `#060B18` | `#1A2540` | `#3A4E7A` | `#14161C` | 0.62 | `#16203A` | 1.0 |
| 05:00 | `#9FB4FF` | 0.40 | `#0B1428` | `#2C3452` | `#3E5280` | `#16181E` | 0.62 | `#262F48` | 1.0 |
| 06:18 | `#FF9E5E` | 0.9 | `#39508A` | `#F0A77A` | `#8E96B8` | `#4A4034` | 0.75 | `#D9A488` | 0.45 |
| 08:00 | `#FFE2BC` | 2.4 | `#5D93D4` | `#CFE0EE` | `#B8D3EE` | `#7C7A62` | 1.05 | `#CFDCE6` | 0 |
| 13:00 | `#FFF6E8` | 2.9 | `#4F8FD8` | `#D3E6F3` | `#C2DBF2` | `#86845F` | 1.15 | `#D4E4EF` | 0 |
| 17:12 | `#FFE0B0` | 2.6 | `#568ED0` | `#E3DDCB` | `#C4D2E4` | `#86785A` | 1.0 | `#DCD8CC` | 0 |
| 19:00 | `#FFA35C` | 2.2 | `#4B6FB0` | `#F5B27A` | `#AEB2C8` | `#6A5646` | 0.85 | `#E8B58E` | 0 |
| 20:06 | `#FF7A4A` | **0.03** | `#2B3A66` | `#E0957A` | `#5A6E9E` | `#23262F` | 0.75 | `#4E5878` | 0.6 |
| 21:12 | `#9FB4FF` | 0.40 | `#0C1530` | `#2D3558` | `#3E5280` | `#16181E` | 0.62 | `#262E4A` | 1.0 |

Share of windows lit: 0.42 from 19:45 to 22:30, and 0.28 from 22:30 to 05:00.
- Shopfronts: ×2.2 until 22:00, then 0.3.
- Office windows: ×0.8.
- Factories with `utilization > 0` keep their clerestory lit all night.

**Static presets** for the "Fixed" settings: 13:00 (day), 18:30 (golden hour), 22:30 (night).

### 3.7 Sky, fog and atmosphere

- **Sky.** A unit sphere with `side: BackSide`, `depthWrite: false`, the vertex z set to `w·0.99999`, re-centred on the camera every frame, and **`renderOrder = 1e6`** (drawn *after* the opaque geometry; −1.5 ms, §1.3). The shader:
  - gradient `mix(horizon, top, pow(max(dir.y, 0), 0.45))`;
  - below the horizon, `horizon × 0.85`;
  - sun disc `pow(dot, 900)·18` plus glow `pow(dot, 12)·0.35` (only by day);
  - hashed stars (`step(0.9975, hash(floor(dir·380)))`) × night × 1.6.
- The `Sky`/`SkyMesh` addon (Preetham) is **not** used. It is physically based rather than art-directed, and r183 and r186 changed its uniforms.
- **Fog.** Linear `THREE.Fog`, with colour from the time-of-day key. Distances follow the camera distance `d`: `near = 1.3·d + 600`, `far = 3.2·d + 4500`. At overview this softens the outskirts into the horizon; at street zoom it is invisible.
- **Haze by zoom.** The fog colour is lerped 20% toward the horizon colour at city zoom, which gives aerial perspective on distant hills.

### 3.8 Tone mapping and colour management

- `renderer.outputColorSpace = SRGBColorSpace` (the default since r152). `ColorManagement.enabled` stays true.
- **With the composer** (all tiers), `renderer.toneMapping = NoToneMapping` and `ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })` runs in the effect pass.
  - postprocessing's default is **AGX**, so set it explicitly.
  - Neutral (Khronos PBR Neutral, `THREE.NeutralToneMapping` since r162) keeps authored hues up to the highlights. Owner and UI colours stay identical to the React legend.
  - ACES shifts saturated blues and oranges. AgX desaturates the stylized palette. AgX is allowed as a "cinematic" option in photo mode only.
- Exposure is 1.0 at all hours: the night look is authored in the light keys and emissive values, not by exposure.
- The composer frame buffer is `HalfFloatType`, so bloom sees HDR emissive values above 1.0.
- Textures:
  - the sign atlas uses `colorSpace = SRGBColorSpace`;
  - data textures (overlays) use `NoColorSpace`;
  - vertex colours are sRGB bytes decoded in the shader.

### 3.9 Post-processing by quality tier (pmndrs postprocessing 6.39.5)

| Step | LOW (UHD 620/630, Iris Plus) | MED (Iris Xe, Apple M1, Radeon Vega) | HIGH (discrete GPU) | ULTRA |
|---|---|---|---|---|
| Depth pre-pass (chunks only) | ✔ | ✔ | ✔ | ✔ |
| RenderPass (`clearPass` off) | ✔ | ✔ | ✔ | ✔ |
| N8AO | ✘ (shader AO) | ✘; optional "Performance" half-res if the governor has ≥ 6 ms of headroom | **Low**, half res, `aoRadius 6`, `distanceFalloff 1`, `intensity 2.2`, `gammaCorrection false` | Medium, full res |
| Bloom (mipmap, threshold 1.0, smoothing 0.25, intensity 0.85, radius 0.72, levels 6) | only when night > 0.05 (`blendMode.opacity` 0 → 1) | always | always | always |
| Outline (selection and hover) | ✔ (half res) | ✔ | ✔ | ✔ |
| Tilt-shift | photo mode only | photo | photo | photo |
| Tone mapping | NEUTRAL | NEUTRAL | NEUTRAL | NEUTRAL (AgX in photo mode) |
| Vignette (offset 0.32, darkness 0.42) | ✔ | ✔ | ✔ | ✔ |
| LUT (seasonal grade, optional) | ✘ | ✔ | ✔ | ✔ |
| Anti-aliasing | **FXAA** (separate pass after tone mapping) | SMAA MEDIUM | SMAA MEDIUM | SMAA HIGH |
| Shadow map | 2048, buildings only; trees within 400 m of the target | 2048, with trees | 4096 | 4096 |
| Max DPR × governor | 1.0 × (0.7–1.0) | 1.25 × (0.7–1.0) | 2.0 × (0.75–1.0) | 2.0 |
| Measured (1080p) | UHD 630: 11.3–14.8 ms day, 14.3–18.7 night | (estimated 9–12 ms on Iris Xe) | Radeon 5500M: 6.5–7.1 ms | 5500M: 10.2–15.2 ms |

A fifth option, **"Minimal"** (software renderers, very old GPUs), renders direct with no composer: inline `NeutralToneMapping`, no shadows, DPR 0.75.

### 3.10 Shadows

- **One directional light** with `PCFShadowMap`. Since r182 it is a soft 5-tap Vogel disk; `PCFSoftShadowMap` is removed for WebGL and falls back with a warning.
  - `shadow.radius = 2.5`
  - `shadow.intensity = 0.85` (keeps a stylized 15% fill in shadow)
  - `bias = −0.0004`, `normalBias = 0.6`
- **Frustum fitting** (`fitSunShadow`, Appendix A):
  1. Intersect six NDC rays with the ground and extend the points up to 160 m (the tallest caster).
  2. Transform them into a light space **anchored at the city centre** (the light sits 3,000 m along `dirToSun`).
  3. Take the bounds and **snap them to the shadow texel** so panning does not shimmer.
- Texel density is about 1.2 m per texel at overview (2048) and about 0.15 m at street zoom. A single fitted map is enough, because the tilt range keeps the far edge within about 3× the near edge. CSM is not needed.
- **Update policy.** Throttle **per light**: `sun.shadow.autoUpdate = false`, and set `sun.shadow.needsUpdate = true` when any of these happens:
  - the camera moves (`CameraRig.update` returns true);
  - the sun direction changes by more than 0.15° (throttled to 4 Hz by default);
  - a chunk or instanced caster changes.

  Keep `renderer.shadowMap.autoUpdate = true`. The global gate (`WebGLShadowMap.js:95`) returns early when both the global `autoUpdate` and `needsUpdate` are false, and would then ignore the per-light flag (line 170).
- **Casters.** Chunk meshes, trees (MED and above, or within 400 m of the target on LOW), and large animated parts (cranes, pumpjacks) on HIGH.
- **Never casters:** vehicles and pedestrians. They carry a **baked opaque contact quad**, an asphalt-dark `#2B2E33` slab 2 cm up under the body. Particles and light pools never cast either.

### 3.11 Water, coast and river

- **Sea.** One plane (`MeshStandardMaterial`, colour `#2F6F93`, roughness 0.22, metalness 0) at y = −0.35, extending about 6 km past the coast.
  - Two octaves of analytic wave normals (`cos(p·3.1 + t)`, …, amplitude 0.06), injected at `normal_fragment_maps`.
  - The environment map is a **PMREM of the sky dome**, regenerated when the time of day changes by more than 20 min of visual time (one `PMREMGenerator.fromScene` of the sky only, about 3 ms, amortised).
  - No planar reflections: `Water.js` and `Reflector` render the scene twice.
- **Depth tint and foam.** The water mesh carries a `shore` attribute: the distance to the nearest land plot in metres, precomputed per vertex on a 12 m grid within 100 m of the shore.
  - Colour is `mix(shallow #5FAFC4, deep #2F6F93, smoothstep(0, 40, shore))`.
  - Foam is a band of `#EAF4F4` where `shore < 3 m`, animated by `step(fract(shore·0.25 − t·0.3), 0.15)`.
- **Coast.** The 1-plot shore strip is sand `#E6D6A8`, except in port zones, where there is a **concrete quay wall** (`#B9B6AE`, 2.0 m above the water, black fenders every 10 m). Promenades in the CBD get a 4 m plaza strip with lamps and benches.
- **Rivers** (Riverside): water plots with the same shader and a flow direction attribute that scrolls the normals.
  - Banks are 1.5 m grass slopes.
  - **Bridges** carry a road plot over water: a deck 1.2 m thick at +6 m, parapets 1.1 m, piers every 24 m. Arterial bridges get lamps and suspension towers if the span is 3 plots or more.
- **Ambient boats** on the water: tugs, sailboats and ferries (§4.3).

### 3.12 Terrain and outskirts (the city must not float in a void)

- City plots are flat at y = 0, except for Hilltown slope classes (see below).
- **The outskirts ring** runs from the city bounds to 5 km:
  - a heightfield mesh of 96×96 vertices over 12×12 km, flattened within 150 m of the city bounds;
  - value noise from `three/addons/math/SimplexNoise.js`, seeded by `cityId`;
  - amplitude per city: Hilltown 180 m hills, Riverside 50 m valley walls, Metropolis 25 m, Eastside 30 m, Portbay 15 m.
- **Vertex colours by biome:**
  - field patchwork: rectangles of 150–400 m cycling meadow `#A2B878`, wheat `#D9BE62`, soil `#9C7A56` and dryGrass `#C4BE82`;
  - forests: clumps of 20–60 instanced LOD1 trees, 600–1,500 per city;
  - rock `#9C968C` on slopes above 25°;
  - arid scrub for Portbay (`#C4BE82` with sparse bushes).
- **Highways** continue the city's `highway` roads outward to the horizon; lamps stop 300 m out.
- **Hilltown in the city.** Per-plot heights (a `CityLayoutDto` extension, §5.3) give terraced lots: retaining walls `#BDB6A8`, 1–3 m high, between level changes. Roads follow the heights with slope limited to 8%.

### 3.13 Night lighting

| Element | Implementation | Visible range |
|---|---|---|
| Windows | Procedural lit state, warm or cool; far field uses 0.5 × the lit share | all zooms |
| Shopfronts | ×2.2 lit share, warm; closed after 22:00 (0.3) | all |
| Street lamps | Emissive heads (`extra.x = 255`) on instanced poles | < 800 m |
| Light pools | Instanced additive quads, 14 m, radial texture, opacity 0.14 × night, `depthWrite: false` | < 900 m |
| Far-field lamps | `THREE.Points`, one per lamp, 2 px, additive, warm `#FFC98A`, so the road grid shows as strings of light | > 800 m |
| Signs and wordmarks | Atlas `emissiveMap`, `emissiveIntensity` = 1.6 × night | all |
| Aviation lights | Red `#FF4A3A` on towers over 60 m and on masts; blink 0.5 Hz (`uTime` step) | all |
| Stadium, port and yard floods | Emissive banks plus 30–40 m additive light pools; stadium lit 19:00–22:00 on "match" days (hash of the date) | all |
| Vehicles | Head and tail lights emissive (`extra.x`), front white, rear red, × night | < 1,100 m |
| Traffic signals | Instance colour per phase, emissive | < 800 m |
| Bloom | Threshold 1.0 on HDR; windows (2.4× boost) and lamps (3.8×) cross it; day surfaces never do | tier-dependent |

### 3.14 Seasons and weather

**Seasons** come from the game month and the city climate (`temperate` by default; `warm` for Portbay; `cold` optional).

| Months | Vegetation tint `uSeasonTint` (× vegetation) | Grass | Crops | Other |
|---|---|---|---|---|
| Mar–May | (0.95, 1.08, 0.92), with 8% of deciduous trees blossoming `#F2C6D0` | `#96B46B` | sown to green | |
| Jun–Aug | (1, 1, 1) | `#96B46B` | green to ripe in Aug | |
| Sep–Nov | 40% of deciduous trees `#D09A45` / `#C0633A` via instance colour; tint (1.08, 0.95, 0.80) | `#A8AC72` | harvest to stubble | |
| Dec–Feb | deciduous canopy scale 0.6 and colour `#8A7F70` (bare); conifers unchanged | `#A9A38A` | ploughed soil | `uSnow` 0.6–1.0 for cold climates in Dec–Feb, 0 for temperate unless a weather event |

**Snow** (verified):
- Up-facing surfaces flagged `FLAG_SNOWABLE` mix toward `#EDF2FA` by `uSnow × smoothstep(0.65, 0.9, n.y)`.
- Roads (`FLAG_PAVED`) take `0.35 × uSnow` (ploughed look).
- Snowfall uses particles (§5.18).

**Rain:**
- Wetness `uWet` darkens paved surfaces × 0.72 and adds a fresnel sky sheen × 0.25 (verified).
- Instanced streaks (§5.18) and a denser fog (`far × 0.6`).
- Sun intensity × 0.55; the sky desaturates toward `#9AA6B1`.
- Rain is cosmetic, seeded per month, and can be switched off.

### 3.15 Zoom bands and readability

| Band | Camera distance (target) | What reads | Enabled |
|---|---|---|---|
| **Street** | 60–300 m (elev. 35–45°) | Facades, signage text, shopfront glow, people, parked cars, lamps and pools | Pedestrians (< 420 m), LOD0 trees, all props; hover card = DOM |
| **District** | 300–1,100 m | Silhouettes, roofs, owner accents, traffic, smoke | LOD0 trees until 900 m, then LOD1; vehicles until 1,100 m; parked cars until 700 m; lamps until 800 m |
| **City** | 1,100–3,100 m (elev. up to 60°) | Owner-tinted roofs, status badges, district labels, at night the lamp-point grid | LOD1 trees; vehicles hidden (company trucks drawn as owner-coloured dots on a road decal layer); owner roof tint 1.0 |

Other readability rules:
- Hide or show ambient apartments and offices with a toggle, as CapLab does (`caplab-brief.md` §5.8), so business buildings stay readable. The toggle drops ambient chunk geometry to "footprint slabs" (LOD1 boxes 1 m high).
- Labels: at most 30 DOM labels (company name on hover and selection; district names in the city band).

### 3.16 The living economy (what moves, and why)

| Visual | Driver (bridge) | Rule |
|---|---|---|
| Chimney smoke | `activity.utilization` | puffs per second = 1.5 × utilization; colour by product family (§4.3); none when idle or closed |
| Company trucks (owner livery) | `supplyFlows` kind `transfer` | trips per month = clamp(ceil(qty / payload), 1, 6) per link, spread over the visual month; A* route on the road graph |
| Import and export trucks | `supplyFlows` kind `import`/`export` | spawn and despawn at the port quay (coastal) or the nearest highway edge; neutral white livery |
| Car-park fill (supermarket, department store) | `activity.unitsSold` | fill = 0.1 + 0.85 × clamp01(log10(1 + unitsSold) / 6.5); neutral car colours |
| Shoppers | `activity.unitsSold` | agents = min(40, round(6 × log10(1 + unitsSold))) per store (UX §6.5), walking between the entrance and the car park or bus stop |
| Dock activity | `activity.transfersIn/Out` | trailers at docks = clamp(round(log10(1 + transfers)), 0, docks) |
| Pumpjack, headframe wheels, port cranes | `status == operating` and `utilization > 0` | animate; stop when idle or closed |
| Fields | game month plus `products` | crop colour and height by growth stage |
| Billboards | ad campaigns (the `marketing` endpoints) | per city, 24 billboard slots split in proportion to each company's monthly ad spend, showing product and emblem |
| Construction | `construction.progress` | stages A/B/C (§4.1) |
| Closed or bankrupt | `status` (EXT: `closed`) | lights off, shopfront boarded `#8A6A4A`, sign grey `#9A9A9A`, weeds (`dryGrass` patches) |
| Economic mood (macro EXT) | boom / recession | boom: +20% traffic, extra cranes on ambient lots; recession: "For Lease" boards on 20% of ambient shops, −25% traffic, 70% of normal night lighting |
| Insolvency (UX event 33) | cash < 0 | whole city desaturates 20%: add a `uDesaturate` uniform to CityMaterial (a `mix(rgb, luminance, uDesaturate)` line after clay mode). Do not reuse `uOverlay`, which would tint through the ramp. |

---

## 4. Per-asset visual specifications

### 4.1 Conventions that apply to every asset

- **Plots and lots.** Dimensions assume 24 m plots: 1×1 = 24 m, 2×2 = 48 m, 3×3 = 72 m, 4×4 = 96 m, 5×5 = 120 m, 5×3 = 120 × 72 m. Everything is in the lot frame of §3.2, with +Z as the street front. Heights are absolute metres; they do not scale with plot size.
- **Footprints** come from content (`content/data/buildings/*.json`).
  - Rotation by 90° swaps W and H, and is chosen so the front faces the road (§5.3).
  - The seaport faces the water.
- **Triangle budgets** (enforced by unit test, §5.24):
  - **LOD0** is the full asset.
  - **LOD1** is the city-band version: extruded footprint boxes with correct roof colour and owner-roof flag, windows still procedural, no props. Target ≤ 8% of LOD0.
  - Instanced props (trees, cars, containers) are budgeted separately.
- **Variants.** Ambient archetypes have at least 4 seeded variants (shape, colour, roof). Company types have 2 shape variants.
  - `seed = fnv1a(cityId, px, pz, typeId)`, then mulberry32. The same seed must produce byte-identical arrays.
- **Owner paint slots** (§3.4): roof accent band, sign board and wordmark, awning, flag, pylon, vehicle livery, crane parts. The `ownerRoof` flag goes on the **roof faces of the main mass only**.
- **Night.** Windows follow the facade style (§3.5). Signs and lamps use `extra.x`. Every company building gets at least one emissive owner element: sign, band or pylon.
- **Closed** (`status` EXT `closed`), or the owner is bankrupt:
  - windows unlit;
  - signs swapped to grey `#9A9A9A` (atlas "blank" slot);
  - shop glazing replaced by boarded `#8A6A4A` (a facade flag bit);
  - no smoke or animation;
  - 3 weed patches `#C4BE82` on the lot.

#### Construction stages (all company buildings; `construction.progress` p)

| Stage | p | Visual |
|---|---|---|
| **A · Site** | 0–0.25 | **Hoarding fence** 2.4 m high around the lot (0.5 m inset), owner colour with white emblem and wordmark every 12 m (atlas).<br>**Excavation** slab `#7C5E43` inside the footprint minus 3 m.<br>1 **excavator** (animated arm ±25°, 4 s) and 1 **dump truck**; 2 site cabins (6 × 2.4 × 2.6 m, `#E4E4DE`).<br>Dust puffs at 0.5 per second. |
| **B · Structure** | 0.25–0.85 | The **final building mesh**, rendered as a separate `Mesh`, **clipped at h = H · smoothstep(0.25, 0.85, p)** (per-site uniform `uClipY`, `discard` above), with a concrete slab cap.<br>Walls render as concrete `#B9B6AE` until p = 0.7, then fade to their authored colours. Windows are off.<br>**Scaffold shell** 0.8 m outside the walls, from 0 to h + 2 m: one box mesh per site with an alpha-tested lattice shader (2 × 2 m cells, bars 8% of the cell, `#D9A441` and `#8E8C87`).<br>**Tower crane** when H > 12 m: lattice mast 1.6 m square at height H + 12 m, jib 40 m, counter-jib 12 m with an **owner-colour counterweight**. It slews ±60° with a 20 s period, and the trolley and hook move.<br>For H ≤ 12 m, use a **mobile crane** (truck with a 25 m telescopic boom) instead. |
| **C · Finishing** | 0.85–1.0 | Scaffold removed from the top down (clip at `H·(1 − (p − 0.85)/0.15)`). Crane hidden at p ≥ 0.95. Landscaping and car-park lines appear at p ≥ 0.98. |
| **Opening** | p = 1 | "Pop" (the separate mesh scales 0.96 → 1.0 over 0.25 s), **confetti** in owner colours (60 quads, 2 s), grand-opening SFX and VO (UX). Then the chunk rebuild merges the building and the separate mesh is disposed. |

Type-specific construction overrides:
- `oil_well`: a **drilling derrick** (§4.2.13) instead of a crane.
- Farms and plantations: stage A = ploughing (soil), B = sowing (rows appear from front to back along the rows), C = first green.
- `seaport`: a floating crane on a barge and 3 pile columns, then the quay deck.
- `iron_mine`: the headframe erected as a rising lattice, plus pit excavation.
- **Level upgrades** (content `levels`: supermarket, factory_small, factory_large, small_farm and oil_well in the JSON; the HANDOVER's "large_farm" is wrong) run a 1-month mini-stage B on the **extension footprint only**.

### 4.2 The 18 content building types

Footprints are cited from `content/data/buildings/*.json`.

#### 4.2.1 `convenience_store`: Convenience Store (1×1 = 24 × 24 m; `retail.json:3`)
- **Read.** A small glazed corner shop with an owner-colour awning and a glowing fascia.
- **Layout.**
  - Building 20 × 14 m (x −10..10, z −5..+9), leaving a 3 m forecourt to the lot front.
  - Height 4.6 m (60% of variants); the other 40% have 1–2 floors of flats above (+3.0 m per floor; APARTMENT style upstairs).
  - Facade: SHOP on the front and the street-side flank; plain concrete at the rear.
  - Awning 1.8 m deep, full width minus 1 m, at 3.0–3.35 m.
  - Fascia board 12 × 1.1 m at 3.5–4.6 m showing the atlas wordmark.
  - Forecourt: 2 painted bays, a bike rack, an ice chest (1.2 × 0.8 × 0.9 m white), an ATM box.
  - Rear yard: 2 bins (`#4F6B4A`); 2 AC units on the roof.
- **Colours.** Walls warmWhite, cream or greige; roof membrane.
- **Owner.** Awning, fascia and pylon-less sign; the roof flag is on the main roof.
- **Living.** Shoppers ∝ unitsSold (≤ 12 for this type).
- **Night.** Shopfront ×2.2 until 22:00; 20% of variants are "24 h" and stay lit. Fascia glows.
- **Budget.** LOD0 ≤ 350, LOD1 ≤ 30.

#### 4.2.2 `supermarket`: Supermarket (3×3 = 72 × 72 m; `retail.json:14`; levels L1–L3)
- **Read.** A wide low box behind a car park whose fill shows the store's sales.
- **Layout.**
  - Box 60 × 34 m × 8.0 m at the rear (3 m rear margin).
  - SHOP glazing across the front; blank flanks with vertical fins; cladding warmWhite or greige.
  - Owner parapet band 1.0 m across the front, returning 6 m down the sides.
  - Roof sign 20 × 3.5 m on the parapet.
  - Entrance canopy 16 × 5 m at 4.5 m: glass roof `#6F8FA6` and an owner fascia.
- **Car park** (32 m deep): 4 rows of 18 bays (2.6 × 5.0 m, white lines), 6.5 m aisles, 2 tree islands, 4 lamp poles 9 m tall with 14 m pools, 2 trolley shelters (6 × 2 × 2.4 m, owner roofs), and a **pylon sign** 10 m tall at the street entrance (owner colour with emblem).
- **Roof.** 6 HVAC boxes (3 × 2 × 1.5 m) and 2 skylight strips.
- **Rear.** Loading dock with 2 doors (3.6 × 4.2 m) and 1 trailer. 6 trees along the front edge.
- **Levels.**
  - **L2:** side wing 20 × 34 m (garden centre with a glass roof) and 12 more bays.
  - **L3:** rooftop solar over 60% of the roof (`#2E3B55` rows with 0.3 m gaps) and a click-and-collect canopy 12 × 6 m with 4 bays.
- **Living.** Car-park fill ∝ unitsSold (§3.16); shoppers; delivery truck on transfers.
- **Night.** Front glazing ×2.2 until 22:00; car-park pools; sign and pylon glow.
- **Budget.** LOD0 ≤ 2,000 (excluding cars and trees), LOD1 ≤ 120.

#### 4.2.3 `department_store`: Department Store (4×4 = 96 × 96 m; `retail.json:30`)
- **Read.** A five-storey limestone emporium with corner banners and a rooftop wordmark.
- **Layout.**
  - Block 90 × 72 m × 21.3 m (ground floor 4.5 m, 4 floors × 4.2 m) at the rear.
  - A 20 m front plaza: paving, 8 trees, bollards, benches, an optional fountain.
  - Ground floor SHOP (display windows); upper floors RETAIL-UPPER (style 7).
  - Limestone cornice.
  - **Glass rotunda** at the street corner: cylinder Ø16 m from 21.3 m to 29 m with a shallow glass dome.
  - Rooftop wordmark 30 × 5 m facing the main street.
  - Marquee canopy 24 × 4 m at 5 m, with an owner fascia and an emissive edge.
- **Owner.** 4 vertical banners (2 × 12 m) at the corners, marquee, wordmark, roof band.
- **Night.** Display windows ×2.2; an uplight strip at the first-floor line (0.3 m emissive band); banners glow.
- **Budget.** LOD0 ≤ 2,500, LOD1 ≤ 150.

#### 4.2.4 `factory_small`: Small Factory (3×3 = 72 × 72 m; `production.json:73`; L1–L3)
- **Read.** A sawtooth hall with a brick chimney whose smoke shows production.
- **Layout.**
  - Hall 52 × 36 m × 10 m eaves with a **sawtooth roof**: 5 teeth, 7.2 m pitch, 2.8 m rise, north-facing glazing.
  - Owner band 1.2 m at the eaves on the street face.
  - Office annex 20 × 12 m × 7 m (OFFICE ribbon windows) with an **owner-colour roof** and a rooftop wordmark board 14 × 2.2 m.
  - Chimney Ø3 × 32 m, brick `#8E4E3C`, with an owner band 1.2 m below the top.
  - 4 dock doors (4 × 4.5 m) on the yard side with 1–2 trucks (owner cab); yard in parking asphalt; 16 staff bays; fence 2 m (LOD0 only); flag 12 m.
- **Product props** by the first slot's product family:

  | Family (products) | Props | Emission |
  |---|---|---|
  | Food (flour, sugar, bread, malt, roasted_coffee) | 2 silos Ø5 × 14 m, galvanized, cone caps | light smoke |
  | Beverage (soft_drink, beer, coffee_drink) | 3 stainless tanks Ø4 × 9 m `#C7CDD3` and a pipe rack | steam |
  | Textile (cotton_fabric, denim_fabric, t_shirt, designer_jeans) | extra weaving shed 20 × 16 × 6 m | steam |
  | Metal (steel) | 30 m overhead gantry over a coil yard | dark smoke |
  | Polymer (plastic) | 2 horizontal tanks and a flare stack | smoke and flare |
  | Electronics (electronic_parts, television) | clean-room box 24 × 16 × 9 m, white, 6 rooftop ducts | none |
  | Automotive (car) | test lot with 12 new cars and a paint-shop stack | light smoke |

- **Levels.**
  - **L2:** a parallel hall 52 × 16 m across the yard.
  - **L3:** a second chimney, a conveyor bridge at 6 m between the halls, and 2 more props.
- **Night.** Clerestory band lit cool while `utilization > 0`; yard lamps.
- **Budget.** LOD0 ≤ 2,500, LOD1 ≤ 150.

#### 4.2.5 `factory_large`: Large Factory (5×5 = 120 × 120 m; `production.json:89`; L1–L3)
- **Layout.**
  - 2 sawtooth halls 90 × 40 m × 13 m (6 teeth each).
  - Office block 30 × 14 m × 11 m (3 floors) with an owner roof and a rooftop wordmark 20 × 3 m.
  - **2 chimneys** Ø4 × 42 m with owner bands.
  - Product props at 2× scale.
  - Pipe racks and conveyors between the halls (1.5 m wide at 7 m).
  - 8 dock doors with 4–8 trucks; 40 staff bays.
  - Optional water tower: a 25 m tank on legs with the owner emblem painted on it.
  - Rail siding (P1, only if the layout has rail).
- **Levels.** **L2:** a third hall 90 × 24 m. **L3:** a tank farm and a second office block.
- **Budget.** LOD0 ≤ 4,500, LOD1 ≤ 250.

#### 4.2.6 `warehouse_small`: Small Warehouse (2×2 = 48 × 48 m; `logistics.json:3`)
- **Layout.**
  - Portal-frame shed 42 × 26 m × 8 m eaves with a low gable (2.4 m rise, ridge along the long axis).
  - Galvanized `#9FA7AE` ribbed cladding (INDUSTRIAL clerestory).
  - Owner stripe 1.2 m under the eaves on the dock side.
  - 6 dock doors 3.6 × 4.2 m with black dock shelters and a 16 m apron.
  - 2 semi-trailers; pallet stacks (instanced); a forklift looping at street zoom.
  - Office pod 8 × 6 × 3 m.
- **Living.** Trailers at the docks ∝ transfers (§3.16).
- **Budget.** LOD0 ≤ 700, LOD1 ≤ 40.

#### 4.2.7 `warehouse_large`: Large Warehouse (4×4 = 96 × 96 m; `logistics.json:13`)
- **Layout.**
  - Distribution centre 90 × 60 m × 12 m with 16 dock doors on one long side.
  - Trailer yard with 10–14 trailers (instanced).
  - Office pod 16 × 8 m, 2 floors, owner roof; rooftop smoke vents.
  - **A giant roof logo**: the emblem and wordmark painted on the roof as a 40 × 10 m atlas quad lying on it, visible at city zoom.
- **Budget.** LOD0 ≤ 1,600, LOD1 ≤ 80.

#### 4.2.8 `seaport`: Seaport (5×3 = 120 × 72 m; coastal; `logistics.json:23`)
- **Read.** Container cranes over a quay, stacks of colourful boxes, and a ship at berth.
- **Orientation.** The 120 m side faces the **water**; this overrides road facing.
- **Quay deck.** Concrete, 2.0 m above the water, with fenders every 10 m and bollards.
- **2 ship-to-shore gantry cranes:**
  - legs 30 m apart (rail gauge), portal clearance 18 m, A-frame legs to 45 m;
  - boom 70 m (45 m outreach over the water, 15 m backreach) at 42 m, with a machinery house 10 × 6 × 5 m;
  - **legs in owner colour, boom white**;
  - boom raised to 80° when no ship is at berth.
- **Container yard.**
  - 4 blocks (2 × 2, behind a 25 m quay apron) of 6 rows × 4 bays × 1–4 tiers of 40 ft boxes (12.19 × 2.44 × 2.59 m). Each block is about 49 × 15 m; at most 384 boxes, instanced.
  - Palette: `#B3483A #2F6F9F #C99A3A #4F8A5B #8C8F94 #6C4F8C #D96C3B #E4E4DE`.
  - 2 straddle carriers (12 × 8 × 15 m) and 2 reach stackers, animated.
- **Buildings.** Terminal office 20 × 12 × 8 m with a "C" or "I" sign (`caplab-brief.md` §5.6) and the owner wordmark; a gatehouse with 3 lanes.
- **Flood masts.** 6 masts, 30 m tall.
- **Ship.** When the month has `import`/`export` flows, a **feeder container ship** is at berth:
  - hull 140 × 22 m, 12 m high, `#3A4A5C` with red antifouling `#9A3A2E` at the waterline;
  - stern superstructure 20 × 16 × 18 m in warmWhite;
  - deck containers 6 × 14 bays × 3 tiers (instanced);
  - neutral livery (shipping lines are not companies).
  - It arrives and departs on a water spline at 4 m/s.
- **Animated.** Crane trolley ±30 m along the boom at 0.6 m/s with a spreader hoist; straddle carriers loop.
- **Night.** Cool-white floods with 30 m pools; crane and ship lights.
- **Budget.** LOD0 ≤ 6,000, plus ≤ 1,200 container instances (12 triangles each); LOD1 ≤ 400.

#### 4.2.9 `small_farm`: Small Farm (3×3 = 72 × 72 m; arable; `production.json:3`; L1–L3)
- **Read.** A red barn, a silo and crop rows that change with the month.
- **Farmyard** in the rear-left 24 × 24 m:
  - farmhouse 10 × 8 m, 1.5 floors, 38° gable, warmWhite walls;
  - **red barn** 16 × 10 m × 6 m eaves plus a 4 m gable roof: walls `#A8483A`, shingle roof with an **owner ridge cap and a 4 × 4 m owner roof panel**;
  - silo Ø6 × 14 m, galvanized, cone cap;
  - a tractor (`#4F7A43` body, red wheels) driving along the rows at street zoom.
- **Fields** fill the rest of the lot in 2 strips, crop by slot product (wheat, sugarcane or cotton):
  - visual row pitch 3.2 m; heights wheat 0.9 m, sugarcane 2.6 m, cotton 0.9 m;
  - 1.5 m grass margins; fence posts at LOD0; flag 9 m.
- **Growth by game month** (temperate):

  | Months | State |
  |---|---|
  | Mar | sown (furrow brown) |
  | May | green, 30% height |
  | Jul | full green |
  | Aug–Sep | ripe colour |
  | Oct | stubble `#B8A27A` |
  | Nov–Feb | bare soil |

- **Levels.**
  - **L2:** grain dryer and a second silo.
  - **L3:** centre-pivot irrigation arm (60 m; one rotation per 120 s; visible Apr–Sep) and a machinery shed 20 × 12 m.
- **Budget.** LOD0 ≤ 1,500, LOD1 ≤ 60.

#### 4.2.10 `large_farm`: Large Farm (5×5 = 120 × 120 m; arable; `production.json:20`)
- **Layout.** 4–6 fields, 2 barns, 3 silos, a machinery shed 30 × 15 m, a gravel farm lane through the middle, a windbreak tree line on the north edge (instanced), and a pond.
- Crops and growth as in §4.2.9. No levels in content.
- **Budget.** LOD0 ≤ 2,500, LOD1 ≤ 100.

#### 4.2.11 `small_plantation`: Small Plantation (3×3 = 72 × 72 m; arable; `production.json:32`)
- **Coffee** (when the products include `coffee_beans`):
  - instanced shrub rows (Ø1.8 m blobs, 1.6 m tall, `#3F6B3A`) at a 2.5 m pitch on 2–3 terraces with 0.6 m steps;
  - shade trees every 12 m;
  - a drying patio 18 × 12 m in `#D8C7A0`, with brown bean rectangles `#6B4A2E` during the Oct–Dec harvest;
  - cherries `#B8323A` on the shrubs from Sep to Nov;
  - a processing shed 16 × 10 × 6 m with an owner roof panel.
- **Hops:**
  - trellis poles 6.0 m tall on a 10 × 2.5 m grid, with wires as 0.05 m boxes;
  - **bines** as green vertical strips `#5E8F3F` whose height follows the month: 0 in Jan–Mar, 2 m in May, 5.5 m in Jul–Aug, cut in Sep;
  - an **oast house**: kiln tower Ø6 × 8 m in brick with a conical roof and a white cowl (the iconic silhouette);
  - an owner flag.
- **Budget.** LOD0 ≤ 1,800 (plus instanced shrubs), LOD1 ≤ 60.

#### 4.2.12 `iron_mine`: Iron Mine (3×3 = 72 × 72 m; mineralRich; `production.json:44`)
- **Read.** A steel headframe with spinning wheels over red-brown ore piles.
- **Headframe.**
  - 4-leg steel lattice converging at 30 m, with back-leg struts toward the winding house.
  - **2 sheave wheels** Ø4.5 m at 28 m, rotating while operating; **owner-colour sheave housing**.
- **Other structures.**
  - Winding house 18 × 12 × 10 m with an owner roof panel and INDUSTRIAL windows.
  - Inclined conveyor gallery (2 m wide, rising from 4 m to 18 m over 30 m) to a crusher and bin 10 × 10 × 14 m.
  - **Ore stockpile** cone Ø20 × 8 m in rust `#8E5A45`; 2 spoil heaps in `#7A6A5A` / `#8B7B69`.
  - Gravel haul road with 2 yellow haul trucks (`#E0B43A`, 6 × 3.5 × 3.8 m) on a loop.
  - Dust ∝ utilization.
- **Variant (P1).** An open pit with 3 benches, each 4 m deep, for richer deposits.
- **Budget.** LOD0 ≤ 2,200, LOD1 ≤ 100.

#### 4.2.13 `oil_well`: Oil Well (2×2 = 48 × 48 m; oilRich; `production.json:56`; L1–L3)
- **Read.** A nodding pumpjack in company colours, beside white tanks.
- **Pad.** Gravel, 44 × 44 m.
- **Pumpjack:**
  - base skid 12 × 2.4 × 0.8 m, Samson post A-frame 6.5 m;
  - **walking beam 11 m and horsehead in owner colour** (real operators paint pumpjacks in company livery);
  - crank arms and counterweights in `#3F4A55`, a gearbox, a polished rod.
- **Other equipment.** Wellhead with red `#B8322E` valves; 2 tanks Ø6 × 7 m in white with an owner band; a separator skid; a 12 m flare stack (flame billboard at night); a pipeline riser.
- **Animated.** While operating, the beam rocks ±18° (7.5 s period, i.e. 8 strokes per minute) and the crank turns 360° in sync.
- **Levels.** **L2:** a second pumpjack. **L3:** a third pumpjack and a third tank.
- **Construction.** A **drilling rig**: lattice derrick 38 m (`#D9A441`), drill floor 8 × 8 m at 6 m, mud tanks, pipe racks, a generator and work lights. It is removed at completion.
- **Budget.** LOD0 ≤ 900 static, plus animated parts (beam and head ≤ 120, crank ≤ 60); LOD1 ≤ 40.

#### 4.2.14 `tv_station`: TV Station (3×3; `media.json:3`)
- **Buildings.** Studio block 44 × 28 × 14 m (OFFICE ribbon); studio wing 24 × 20 × 12 m, blind, with an owner stripe.
- **Broadcast tower.** Self-supporting lattice 100 m, 3 tapering sections, red `#D8453A` / white `#E8E4DC` bands every 12 m, **aviation lights blinking at 0.5 Hz**.
- **Other.** 3 satellite dishes (Ø4–8 m, tilted 35°); 2 **OB vans in owner livery**; a rooftop wordmark.
- **Budget.** LOD0 ≤ 2,000, LOD1 ≤ 100.

#### 4.2.15 `radio_station`: Radio Station (2×2; `media.json:14`)
- **Buildings.** Studio 22 × 14 × 8 m.
- **Mast.** Guyed, 70 m, triangular lattice 1.0 m wide, red and white bands every 10 m; 3 guy wires to anchors at 30 m radius; dipoles near the top; aviation lights.
- **Other.** A small dish and an owner sign board.
- **Budget.** LOD0 ≤ 900, LOD1 ≤ 50.

#### 4.2.16 `newspaper_publisher`: Newspaper Publisher (3×3; `media.json:25`)
- **Office.** Brick block 50 × 20 × 16 m (4 floors) with a **masthead sign** on the roof edge (owner board 16 × 4.5 m showing the paper's wordmark).
- **Printing hall.** 50 × 40 × 10 m with a sawtooth roof.
  - **Lit at night 22:00–04:00** (INDUSTRIAL band): "printing tonight's edition".
- **Yard.** Paper-roll stacks (white cylinders Ø1.2 m, instanced); 3 delivery vans in owner livery at the docks.
- **Budget.** LOD0 ≤ 2,000, LOD1 ≤ 100.

#### 4.2.17 `magazine_publisher`: Magazine Publisher (3×3; `media.json:36`)
- **Office.** A "creative" block of 5 floors (19 m) in peach or pastel, with a **glass atrium corner** (a CURTAIN box 16 × 16 m at full height).
- **Roof terrace.** Planters with trees and parasols in owner colour.
- **Print wing.** 30 × 20 × 8 m with a glass wall.
- **Owner.** A vertical banner.
- **Budget.** LOD0 ≤ 2,000, LOD1 ≤ 100.

#### 4.2.18 `rd_center`: R&D Center (3×3; `rd.json:3`)
- **Campus.**
  - Lab block 50 × 18 × 12 m (3 floors of 4 m, CURTAIN).
  - **Rotunda** Ø20 × 16 m, glass with a dome cap `#C7CDD3`.
  - 6 fume stacks on the roof.
  - Satellite dish Ø6 m that turns slowly while researching.
  - Landscaped lawn with 8–12 trees and a pond; an owner roof band.
- **Night.** Labs lit cool; the dome glows (emissive 0.3).
- **FX.** On `TechLevelUp` (UX): an owner-colour light beam (additive cylinder Ø4 × 120 m, 3 s fade) and a dome pulse.
- **Budget.** LOD0 ≤ 2,200, LOD1 ≤ 100.

### 4.3 Ambient city set

"Engine" means the kind comes from `cityLayout` `AmbientDto` (`bridge-spec.md` §8.1). The renderer maps kinds to archetypes and picks variants by seed.

| Asset | Footprint | Silhouette and parts (m) | Colours | Night | Variants | LOD0 / LOD1 |
|---|---|---|---|---|---|---|
| **Detached house** (`house`) | 1×1 | Body 9–12 × 8–10, 1–2 floors of 3.0 + 0.5 plinth; gable 30–38° (70%) or hip; chimney 0.7 × 0.7; 0.35 overhang with fascia; front setback 6; garage 3.6 × 6 × 2.8 (50%) with a plaza-colour driveway; rear garden with 1–3 trees; hedge or fence 1.2 (LOD0) | walls: RES palette; roofs: shingle, tile or slate | HOUSE windows, warm | ≥ 6 | 150 / 24 |
| **Row houses** (`house`, variant `row`) | 1×1 | 4 units, 5.8 wide × 11 deep, 2–3 floors, party walls; alternating wall colours; flat roof with a 0.6 parapet or a continuous gable; stoops 1.6 × 1.0 × 0.5; back yards | RES | HOUSE | ≥ 4 | 260 / 24 |
| **Luxury villa** (Eastside, Hilltown) | 1×1–2×2 | 2 floors, flat roof, cantilevered wing, pool (water shader, 10 × 4) and hedges | warmWhite, limestone | large glazing (SHOP style upstairs) | 3 | 300 / 30 |
| **Apartment block** (`apartment`, floors from the engine: 4–15 via land value) | 2×2–3×3 | Slab 40 × 14, U-shaped perimeter block (14-deep wings) on 3×3, or point tower 22 × 22; floor 3.0; plinth 1.0; parapet 0.7; **balconies** on 30% (1.4-deep slabs on 3 of 5 bays, LOD0 only); 1–2 rooftop plant boxes; entrance canopy; courtyard trees | APT palette; varied flat roofs; 15% green roofs | APARTMENT windows, warm | ≥ 6 | 900 (1,500 with balconies) / 60 |
| **Mixed-use mid-rise** (`shop` with floors > 2) | 1×1–2×2 | SHOP ground floor plus 2–8 APARTMENT floors above | APT | both | 4 | 600 / 40 |
| **Local shop** (`shop`) | 1×1 | As the convenience store, with a **neutral** awning (muted `#B0735F #4F7F82 #C9A45B #7C9563 #8C74A0 #5E7FA8`) and a generic category icon sign (shoe, gem, sofa, toy); "For Lease" board in a recession | APT | shopfront until 21:00 | 6 | 300 / 30 |
| **Strip mall** (collectors) | 1×3 | 5 units in a row, 12 deep × 4.5 high, a shared canopy, front car park | greige, sand | shopfronts | 2 | 700 / 40 |
| **Office tower** (`office`; floors 10–60 from the engine) | 2×2–4×4 | Podium 8 (2 floors); tower on 55–72% of the podium; 0–2 setbacks at 60% / 85% of height; CURTAIN (55%) or OFFICE ribbon; crown or plant box 4–8; antenna with a red aviation light above 60 m (0.5 Hz); rooftop helipad on 5% | alu, steel blue, limestone; tar roofs | cool clusters | ≥ 8 | 700 / 40 |
| **City hall** (civic) | 4×4 | Neo-classical block 60 × 30 × 14; portico of 6 columns Ø1.1 × 12; dome drum Ø14 up to a 30 m copper dome `#6E9A86`; flagpole with the city flag; plaza with a fountain | limestone, copper | uplit facade | 1 per city | 1,200 / 60 |
| **Stock exchange** (P1) | 3×3 | Classical facade, 8 columns; **LED ticker band** 1 m high across the front (emissive; scrolling UV into a ticker atlas row) | limestone | ticker glow | 1 | 1,000 / 50 |
| **Bank** | 2×2 | Columns and a heavy plinth; bronze doors | stone | modest | 2 | 600 / 30 |
| **School** | 3×3 | L-plan, 2–3 floors, brick (APARTMENT windows at 3.6 floor height); sports field `#7FAE5A` with a running track `#C6734E` | brick | off at night | 2 | 800 / 40 |
| **Hospital** | 3×3 | Tower of 9 floors (3.6) plus 2 wings; red-cross sign (emissive red); helipad (H marking) | warmWhite | always partly lit (0.6) | 1 | 900 / 40 |
| **Police / fire** | 1×1–2×2 | 2 floors; blue light bar or red doors; vehicles | greige | lit | 2 | 400 / 30 |
| **University** | 5×5 | Quad of 4 blocks around a lawn; library with a dome; trees | brick, limestone | lit | 1 | 2,000 / 100 |
| **Stadium** | 5×5 | Oval bowl of 16–24 segments (seating slope 4 → 16 m); pitch `#5E9E4A` with stripe variation; 4 **floodlight masts** 36 m with emissive light banks (lit 19:00–22:00 on match days) | concrete, grey seats | floods and pitch glow | 1 | 1,200 / 60 |
| **Park** (`park`) | any | Lawn `#86AE5E`, cross paths in plaza colour, a pond (water shader) on 3×3 or larger, benches, a playground (≥ 2×2), trees at 1 per 90 m² | park greens | path lamps | — | 400 + trees / 20 |
| **Plaza / promenade** | strips | Paving, benches, trees in grates, lamps; waterfront railing | plaza | lamps | — | 200 / 10 |
| **Trees** (instanced; 4 species groups) | — | Round deciduous (trunk Ø0.56 × 2.2, icosahedral crown r 2.6 at y 4.2); conifer (2 cones, 8.2 tall); columnar poplar (r 1.5, 5 high); palm (warm cities: 8 tall, 7 frond quads); scale 0.8–1.4; random yaw; **LOD1 = 8-triangle octahedron** beyond 900 m | leaf palette; tint ±12% | — | 4 | 30–38 / 8 |
| **Street lights** | per road plot | Pole Ø0.18 × 8.0, arm 1.8, LED head 0.5 × 0.25 × 0.7 (emissive); streets: one per side every 24 m, staggered; arterials: both sides every 24 m; median double-arm on boulevards | `#5D646C`, head `#FFF1C4` | head, pool, far points | 1 | 36 / 0 (points) |
| **Traffic lights** | arterial crossings | 4 corner poles 6.5 + 7 m mast arm; 3-aspect heads per approach (instance colour per phase); pedestrian heads | `#3E444B` | lamps | 1 | 90 / 0 |
| **Bus stop** | arterial, every ~6 plots | Shelter 4 × 1.5 × 2.6 (glass and a blue roof), bench, sign | | lit panel | 1 | 60 |
| **Billboards** | roadside and rooftop | Roadside 12 × 4 on an 8 m pole; rooftop 16 × 5 on a frame; content from the ad atlas (§5.7) | frame `#3E444B` | lit 2 lamps | — | 40 |
| **Cars** (instanced) | — | Sedan 4.5 × 1.8 × 1.45; hatchback 4.0 × 1.75 × 1.5; SUV 4.7 × 1.9 × 1.7; van 5.2 × 2.0 × 2.2; taxi (`#F2C230` + roof sign); body tinted by instance (tint weight 255), cabin glass `#39424C`; contact quad; head and tail lights emissive; **LOD1 12-triangle box** beyond 500 m | §3.3 distribution | lights | 5 | 60–80 / 12 |
| **Trucks and buses** | — | Box truck 8.6 × 2.5 × 3.6; semi (cab 6 + trailer 13.6); tanker (cylinder trailer); **company trucks: cab in owner colour, trailer showing the product family** (white reefer = food, silver tanker = fuel or chemicals, hopper = bulk, box = general); bus 12.4 × 2.55 × 3.1 with city livery `#D8452F`; articulated 18 m (optional) | | lights | 6 | 80–120 / 12 |
| **Construction vehicles** | sites | Excavator (animated arm), dump truck, mobile crane (telescopic boom), concrete mixer (rotating drum) | `#E0B43A` | — | 4 | 150 |
| **Pedestrians** (instanced) | sidewalks | Height 1.75: body capsule (8 triangles) + head (8) + legs (4); 12 clothing colours; walking bob and sway in the vertex shader (`uTime` + instance phase); visible below 420 m | | — | 12 colours | 20 / hidden |
| **Port ambience** | water | Tugboat 18 × 6 (orange-red hull), sailboat 10 (white hull, sail quads), ferry 40 (CBD pier), buoys; container ship and **tanker** (Portbay) on water splines | | nav lights | 5 | 150–1,200 |
| **Farm fields (rural ambient)** | 3×3–6×6 | Crop patches by region: wheat, cotton or sugarcane for arable; vineyards and orchards for Hilltown; pasture with instanced cows or sheep (12 triangles); farmstead every ~2 fields | crops | — | — | 300 / 20 |
| **Resource ambience** | rural | Pumpjack fields (Portbay, animated); headframes and open pits (Riverside); **refinery** (Portbay): tank farm, 40 m distillation columns, a flare tower with a flame billboard | industrial | flare glow | — | per asset |
| **Power lines** (outskirts) | along highways | Lattice pylons 30 m every 300 m; 3 cables as thin boxes | galvanized | — | 1 | 60 |
| **Smoke / steam / dust / flare** | emitters | Smoke: puff billboards grey `#8A8C90` rising at 1.8 m/s and lightening to `#D9DADC`, 4 → 18 m, 12 s life. Steam: white `#F4F5F6`, 6 s life. Dust: `#A89886`, low (0–15 m), 3 s. Flare: flame billboard (emissive `#FF9B3A`, flicker) | | smoke lit ×0.25–1 by day factor | — | 2 per puff |

### 4.4 Future building categories (from the `category` enum in `content/schemas/building-type.schema.json`)

These archetypes are specified now so the factory registry and the palette scale later.

| Category | Archetype family | Key visual cue | Suggested footprint |
|---|---|---|---|
| `livestock_farm` | farm | Long low barns, paddocks, instanced cows or sheep, a manure silo | 3×3–5×5 |
| `logging_camp` | extraction | Log piles (instanced cylinders), a sawmill shed, clear-cut patches in a forest | 3×3 |
| `quarry` | extraction | A terraced pale pit `#BDB6A8`, a crusher, conveyors | 3×3 |
| `distribution_center` | logistics | Mega box with a roof logo and 30+ docks | 5×5 |
| `freight_yard` | logistics | Rail sidings, a gantry crane, containers on flatcars | 5×3 |
| `specialty_store`, `fashion_store`, `hardware_store`, `furniture_store`, `pharmacy` | retail | The shop archetype with a **category icon pylon** (shoe, hanger, hammer, sofa, cross) | 1×1–2×2 |
| `auto_dealer`, `showroom` | retail | Glass showroom box and a lot of 20 instanced new cars in stock colours; bunting flags | 2×2 |
| `restaurant`, `fast_food` | retail | Pavilion with a terrace and parasols; a drive-through lane with a menu board (fast food) | 1×1 |
| `gas_station` | retail | A canopy 20 × 12 m on 4 columns (owner fascia, emissive underside), 4 pump islands, a shop box, a price pylon | 1×1–2×2 |
| `shopping_mall` | real estate | Big box with a glass atrium, anchor-store banners, multi-level parking | 5×5 |
| `office_tower`, `headquarters`, `subsidiary_hq` | real estate / HQ | The office tower; **the HQ tower height scales with market cap** and gets a **logo crown** (emblem on 4 faces, emissive) | 2×2–3×3 |
| `apartment`, `luxury_condo`, `hotel` | real estate | Apartments; condos get a glass tower with balconies; hotels a slab with star lights on the crown and a porte-cochère | 2×2–3×3 |
| `bank`, `investment_firm` | finance | Classical columns (bank); a sleek dark-glass tower (investment firm) | 2×2 |
| `college`, `training_center` | services | Campus quad (college); low-rise with a lecture hall (training centre) | 3×3–5×5 |
| `software_firm`, `internet_service` | tech | Glass campus with a rooftop garden and a data-hall annex with cooling units | 3×3 |
| `semiconductor_fab` | tech | White clean-room block with rooftop ducts and bulk-gas tanks | 4×4 |
| `automotive_plant` | industry | Long assembly halls, a paint shop, a test track loop | 5×5+ |
| `pharmaceutical_lab`, `pharmaceutical_factory` | industry | White labs with fume stacks; a stainless tank hall | 3×3 |
| `boardroom` | HQ interior | No city footprint (UI only) | — |

---

## 5. Technical architecture

### 5.1 Renderer and framework choice

- **`THREE.WebGLRenderer`** (WebGL2; WebGL1 has been gone since r163). Configuration is in `RendererSetup.ts` (Appendix A):
  - `antialias: false`, `stencil: false`, `powerPreference: 'high-performance'`;
  - `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`;
  - `shadowMap.type = PCFShadowMap` (the global `shadowMap.autoUpdate` stays true; throttling is per light, §3.10);
  - `info.autoReset = false`, because the composer renders several passes per frame.
- **Why not WebGPURenderer (r186):**
  - it measured 1.2–2.3× slower on the target (§1.4);
  - postprocessing 6.x and n8ao 2.x are WebGL-only;
  - TSL materials would replace the `onBeforeCompile` pipeline.
  - **Port path, later:** re-express `CityMaterial` as `MeshLambertNodeMaterial` with `colorNode`/`emissiveNode`, and swap the composer for `RenderPipeline` (the r183 rename of `PostProcessing`) with the TSL `bloom()`, `fxaa()`, `smaa()` and `ao()` nodes. Nothing else in the architecture depends on the renderer type.
- **Why not React Three Fiber:**
  - the world is a few hundred merged and instanced objects updated imperatively every frame;
  - React reconciliation adds nothing there, and makes per-frame work and profiling harder.
  - React stays for the HUD. The canvas is owned by `CityScene` (the existing `web/src/scene` pattern), and communication goes through zustand plus an event bus (§5.22).
- **Frame loop:** `renderer.setAnimationLoop` plus `THREE.Timer` (`timer.connect(document)`), as the skeleton already does. The clamped `dt` is at most 0.1 s. When the tab is hidden, the Timer pauses.

### 5.2 Module layout and ownership (maps onto `SceneModule`, `web/src/scene/SceneContext.ts:32-43`)

```
web/src/scene/
  CityScene.ts            core (exists): renderer, loop, module registry → add composer, tiers, governor, camera rig
  SceneContext.ts         contract (exists)
  units.ts                PLOT_SIZE = 24 (change), plotCenter/footprintCenter/plotAt (exist)
  core/        RendererSetup.ts · PostPipeline.ts (DepthPrepass) · Quality.ts (tiers, FrameGovernor) · Stats.ts (stats-gl, dev)
  env/         DayNight.ts · Seasons.ts · Weather.ts · Sky.ts · Water.ts · Outskirts.ts · ShadowFit.ts
  city/        CityLayoutModule.ts (cityLayout → PlotGrid, RoadGraph, facing) · ChunkManager.ts · chunk.worker.ts
               · RoadBuilder.ts (tile classification → geometry) · PickIndex.ts
  assets/      GeoBuilder.ts · AssetFactory.ts · registry.ts · palette.ts (re-exports web/src/theme/tokens.ts)
               families/residential/* · commercial/* · civic/* · industrial/* · extraction/* · logistics/*
               · media/* · rnd/* · construction/* · props/* · vehicles/*
  materials/   CityMaterial.ts · SignAtlas.ts · AdAtlas.ts · BadgeAtlas.ts · ScaffoldMaterial.ts · HologramMaterial.ts
  dynamic/     traffic/RoadGraph.ts · traffic/TrafficSim.ts (IDM) · traffic/VehicleRenderer.ts · Pedestrians.ts
               · AnimatedParts.ts · Particles.ts · ConstructionSites.ts · WorldFx.ts
  interaction/ CameraRig.ts · Picking.ts · Selection.ts · PlacementGhost.ts · Overlays.ts · LinkArcs.ts · Labels.ts · Badges.ts
  audio/       AudioFrameProducer.ts (feeds audio-plan.md §4.8)
  dev/         AssetGallery.tsx (route /dev/assets) · bench/ (drained-throughput harness, golden views)
```

Parallel workstreams with disjoint file ownership:

| WS | Owns | Depends on |
|---|---|---|
| W1 Core render | `core/*`, `env/*`, `CityScene.ts` | — |
| W2 City and chunks | `city/*`, `assets/GeoBuilder.ts`, `assets/AssetFactory.ts`, `assets/registry.ts` | W1, bridge `cityLayout`/`cityView` |
| W3 Families A | `families/residential`, `commercial`, `civic`, `props` | W2 interfaces only |
| W4 Families B | `families/industrial`, `extraction`, `logistics`, `media`, `rnd`, `construction` | W2 interfaces only |
| W5 Traffic and people | `dynamic/traffic/*`, `Pedestrians.ts`, `families/vehicles` | W2 (`RoadGraph`), bridge `supplyFlows` |
| W6 Interaction | `interaction/*`, `materials/HologramMaterial.ts` | W1 (outline), W2 (`PickIndex`) |
| W7 FX | `Particles.ts`, `AnimatedParts.ts`, `ConstructionSites.ts`, `WorldFx.ts`, `env/Weather.ts` | W1, W2 |
| W8 Tooling | `dev/*`, tests, CI budgets | all (read-only) |

`materials/CityMaterial.ts` has **one owner (W1)**. Other teams request shader features through that owner, because every feature costs every fragment.

### 5.3 Data flow and contracts

```
bridge worker ──cityLayout(layoutRev)──▶ CityLayoutModule ─┬─▶ PlotGrid {kind u8, roadClass u8, parcelId i32, zone u8, height f32?}
              ──cityView(revision)────▶ ChunkManager ◀────┤   RoadGraph {nodes, edges, lanes, connectors}
              ──supplyFlows(month)────▶ TrafficSim         └─▶ facing per parcel, road tile masks
              ──events (constructionStarted, …)──▶ WorldFx / ConstructionSites
ChunkManager ──BuildChunkRequest──▶ chunk.worker (AssetFactories) ──BuildChunkResult (transferables)──▶ ChunkManager
```

**Derived on the client**, so no engine change is needed:
- **Facing.**
  1. For each parcel side (S, E, N, W), score the road plots along that edge: arterial 3, street 2, highway 1.
  2. `facing = argmax`, with ties broken in the order S, E, N, W.
  3. If there is no adjacent road, use the side nearest to a road by 4-neighbour BFS.
  4. Seaports face the adjacent water side.
- **Road tile mask.** For each road plot, a 4-bit neighbour mask (N=1, E=2, S=4, W=8) gives the tile type:

  | Bits set | Type |
  |---|---|
  | 0 | isolated |
  | 1 | dead end |
  | 2, opposite | straight |
  | 2, adjacent | corner |
  | 3 | T |
  | 4 | cross |

  The class is the highest `RoadDto.kind` passing through the plot. A road plot over water is a bridge.

**Requests to the bridge and engine** (additive, for `bridge-spec.md` §8.1; the renderer degrades gracefully without them):
1. `CityLayoutDto.terrain?: { heights: number[] /* (gridW+1)·(gridH+1) corner heights, m */ }` for Hilltown and Riverside.
2. `WaterRectDto.kind?: 'sea'|'river'|'lake'` and `shore?: 'beach'|'quay'`.
3. `AmbientDto.kind`: add `rowhouse | villa | midrise | strip_mall | civic:<hall|exchange|bank|school|hospital|police|fire|university|stadium|church> | forest | orchard | vineyard | pasture | scrub | plaza | parking | deposit:<resource>`. Unknown kinds fall back to `house` or `park`.
4. `CityOverviewDto.climate?: 'temperate'|'warm'|'cold'|'arid'` and `seed?: number`.
5. `colorIndex` 0 guaranteed to the player (§2.2).
6. `BuildingStatus` add `closed` (bankrupt or closed) and `forSale`.

**BuildingVisualDto → factory params.**
- `typeId` → factory.
- `ownerId` + `colorIndex` → owner.
- `level` → level.
- `construction.progress` → stage and progress.
- `products[0]` → product family (§4.2.4).
- `activity.utilization` → emitters and animation.
- `placement {px, pz, rotation}` → lot frame. Engine rotation wins over derived facing.
- `visualRev` changed → rebuild the owning chunk.

### 5.4 Geometry pipeline

**Vertex format** (`GeoBuilder.ts`; every attribute is 4-byte aligned, which Metal and ANGLE prefer):

| Attribute | Type | Bytes | Content |
|---|---|---|---|
| position | f32×3 | 12 | world metres |
| normal | i8×4 normalized | 4 | xyz; w free (future AO) |
| color | u8×4 normalized | 4 | rgb = **sRGB** (decoded in the shader); a = instance-tint weight |
| fuv | f32×2 | 8 | facade metres (u along the wall, v = height) |
| facade | u8×4 | 4 | style, seed, floor or wall height (dm), bay (dm) |
| extra | u8×4 | 4 | emissive 0–255, flags (1 ownerRoof, 2 vegetation, 4 paved, 8 snowable), owner 0–7 or 255, reserved |
| index | u16 or u32 | 2 or 4 per index | u16 when the chunk has ≤ 65,535 vertices |

That is 36 B per vertex. Measured: **12.4 MB for 157k triangles** (79 B per triangle), against 22.7 MB with all-float32 attributes.

**Chunks.**
- 10 × 10 plots (240 m); Metropolis has 64.
- Each chunk mesh merges ground, roads, markings, sidewalks and every completed building whose lot centre falls in the chunk.
- `matrixAutoUpdate = false`; layers {0, `LAYER_OCCLUDER`}.
- A **LOD1 chunk mesh** (boxes, no markings or props) is built in the same worker job and switched when the chunk centre is more than 1,400 m from the camera.

**Workers.**
- `new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' })`: a pool of 2 (or 1 when `hardwareConcurrency < 4`).
- Requests carry plain data (plots, lots, buildings, params). Results carry `BuiltArrays` plus pick boxes, prop instances, emitters, signs and light pools, all as **transferables**.
- Measured build cost on the main thread in the prototype: about 300 ms for the whole city, or 4–5 ms per chunk. In a worker this becomes **0 ms of main-thread blocking**. The swap costs one `BufferGeometry` creation plus an upload (≤ 1 ms per chunk).

**Rebuild policy.**
- Triggers: `visualRev` or `layoutRev` changed; a building is added or removed; construction completes; the owner changes.
- Dirty chunks are debounced for 100 ms, and **at most 2 chunk swaps per frame** are allowed.
- The old geometry is disposed after the swap.
- Buildings under construction, selection proxies and the placement ghost are **not** in chunks: they are separate meshes (§4.1, §5.13).

**Determinism.**
- Every factory draws randomness only from `mulberry32(seed)` or a stateless `hash3(x, y, s)`.
- Iteration over lots and buildings is sorted by id (mirroring the engine's ordinal-sort invariant).
- The worker produces **byte-identical arrays** for the same inputs, which is tested (§5.24).

### 5.5 Instancing and batching: which primitive for what

| Content | Primitive | Why |
|---|---|---|
| Buildings, ground, roads, markings (static) | **Merged chunk `BufferGeometry`** | Fewest draws (1 per chunk), best GPU efficiency, trivial shadows and LOD, works in every browser. The rebuild cost is hidden in a worker. |
| Trees, lamps, parked cars, containers, pallets, shrubs | **`InstancedMesh` per family per 400 m cell** | InstancedMesh culls as one bounding sphere, so a global mesh means vertex work for off-screen instances. **Partitioning measured −3.3 ms and 554k → 293k triangles at close zoom.** `computeBoundingSphere()` after filling (required since r151). |
| Moving vehicles, pedestrians, animated parts | `InstancedMesh` with `DynamicDrawUsage`, one per model (per LOD), camera-distance gated | Measured: uploading 500 matrices per frame is free (§1.3). |
| Signs and billboards | One mesh per chunk with the atlas material | Needs a texture, so a different material from `CityMaterial`. |
| `BatchedMesh` | **Not in v1** | No `WEBGL_multi_draw` in Firefox, and three's fallback then does one `drawElements` plus one uniform per instance (`WebGLRenderer.js`, the `isBatchedMesh` branch). Revisit if chunk rebuild churn ever becomes a problem; `@three.ez/instanced-mesh` 0.3.16 is another option then. |

### 5.6 CityMaterial (Appendix A, `CityMaterial.ts`)

**Features.** Everything verified by rendering in the prototype:
- sRGB vertex-colour decode;
- instance-tint weight;
- procedural windows, 6 styles;
- lit clusters;
- far-field fade;
- fake glass reflection;
- wall-base AO;
- emissive (`extra.x`, in the vertex colour);
- owner-roof tint at distance;
- vegetation season tint;
- snow on up-facing surfaces;
- rain wetness;
- overlay clay mode with an R8 data texture and a 5-stop ramp.

Cost: **+0.7 to +0.9 ms over the plain window shader** on UHD 630.

**Shared uniforms** (`CityUniforms`): `uNight`, `uLitFrac`, `uWinWarm`, `uWinCool`, `uEmiBoost`, `uSkyRefl`, `uGlass`, `uGlass2`, `uOwnerColors[8]`, `uOwnerRoofMix`, `uSeasonTint`, `uSnow`, `uWet`, `uOverlay`, `uOverlayTex`, `uCitySize`, `uTime`.
- They are shared by reference: one `Object.assign` in `onBeforeCompile`.
- Updating `.value` updates every material that uses them. There is no per-object uniform upload.

**Program cache.** `customProgramCacheKey = () => 'magnate-city-v1'`. In practice there are 2 programs (instanced and non-instanced) plus the shadow depth variants. **Warm them up with `renderer.compileAsync(scene, camera)`** before the first frame; `KHR_parallel_shader_compile` is available on all the targets.

**Adding a feature.**
- Extend `FRAG_COLOR` (before lighting; `diffuseColor` is editable) or `FRAG_EMISSIVE` (after the normal is known).
- Guard it with a flag bit or a uniform.
- Measure it with the bench harness (§5.24). **Budget: ≤ 0.3 ms per feature on UHD 630 at 1080p.**

### 5.7 CanvasTexture generation

| Atlas | Size | Slots | Content | Material |
|---|---|---|---|---|
| **SignAtlas** | 2048 × 1024 RGBA, mipmapped, anisotropy ≤ 8 | 32 × (512 × 128) with 8 px padding | Company wordmark (white on owner colour, emblem at left), inverted variant, grey "closed" slot | `MeshLambertMaterial({ map, emissiveMap: same, emissiveIntensity: 1.6 × night })` |
| **AdAtlas** | 2048 × 2048 | 32 × (512 × 256) | Billboard creatives: product name, company emblem and name, tagline, product-category pictogram; redrawn when campaigns change (monthly) | same material family |
| **BadgeAtlas** | 512 × 512 | 64 × 64 icons | Status badges (check, warning, loss), resource icons, construction clock, emblems | `SpriteMaterial` or instanced billboards (§5.13) |
| **TickerAtlas** (P1) | 2048 × 64 | 1 row | Stock-exchange LED ticker; UV scrolls with `uTime` | emissive |

- **Text rendering.** Canvas 2D with `ctx.font = '700 64px "Inter Tight", "Inter", system-ui'`.
  - **`await document.fonts.load('700 64px "Inter Tight"')` before drawing**, or the first draw uses a fallback font.
  - Condense to fit with `ctx.scale(maxW / measured, 1)`.
  - Uppercase for signs.
  - Use `OffscreenCanvas` when available (`SignAtlas.ts`).
- **Update policy.** `texture.needsUpdate = true` only when a slot changes. A full atlas upload is about 8 MB, so never do it per frame.
- **Why windows are *not* a CanvasTexture** (the task asked; this decision is backed by the prototype):
  - a procedural shader costs 0 bytes and never repeats;
  - it stays crisp at every zoom, with fwidth anti-aliasing and a far-field fade;
  - it changes lit state per window by time of day with no uploads;
  - it avoids the atlas-wrapping and mip-bleeding problems of tiling a facade texture per building.
  - The window shader costs 2.3 ms at close zoom on UHD 630. A texture approach would also cost texture bandwidth.
  - Keep CanvasTexture for text and logos, where it is the right tool.

### 5.8 LOD, culling and distance bands

All distances are from the camera to the target. They are set by projected size, so they do **not** scale with plot size (§2.1).

| Family | Band | LOD action |
|---|---|---|
| Trees | ≤ 900 m LOD0 (30–38 triangles), beyond it LOD1 (8 triangles) | swap `visible` between the two partitioned groups |
| Moving vehicles | ≤ 1,100 m (LOD1 box beyond 500 m) | hidden beyond; company trucks become road-decal dots at city zoom |
| Parked cars | ≤ 700 m | hidden |
| Street lamps (mesh) | ≤ 800 m | beyond it: far-field `Points` at night only |
| Light pools | ≤ 900 m | hidden |
| Pedestrians | ≤ 420 m | hidden; simulation paused beyond 600 m |
| Smoke | ≤ 2,600 m | emitters beyond that are skipped |
| Chunk meshes | LOD0 while the chunk centre is ≤ 1,400 m from the camera | LOD1 beyond |
| Owner-roof tint | `smoothstep(900, 1600, d)` | uniform |
| Status badges | ≥ 300 m | DOM hover card below that |

- **Frustum culling** is automatic per chunk and per cell mesh (bounding spheres).
- **Shadow casters** are culled against the fitted shadow camera by three.
- There is **no occlusion culling**; the depth pre-pass covers overdraw.

### 5.9 Render pipeline per tier

The code is `PostPipeline.ts` (Appendix A). The order is:

1. `DepthPrepass` renders `LAYER_OCCLUDER` (the chunks) with `MeshBasicMaterial({ colorWrite: false })` into the composer's input buffer. Measured −3.9 ms at close zoom.
2. `RenderPass` with `clearPass.enabled = false`, so it keeps the pre-pass depth.
3. `N8AOPostPass` (HIGH and ULTRA only).
4. `EffectPass(bloom, outline, tiltShift, toneMapping NEUTRAL, vignette)`, merged into **one** fullscreen shader.
5. `EffectPass(FXAA)` on LOW or `EffectPass(SMAA)` on MED and above, **after** tone mapping so it runs on LDR.

Notes:
- Toggling effects at runtime by rebuilding passes causes a shader recompile. **Gate them with `effect.blendMode.opacity.value`** instead (0 = off): bloom by day on LOW, tilt-shift outside photo mode.
- The frame buffer is `HalfFloatType`. On resize, call `composer.setSize(w, h)`.
- The outline effect renders only proxies on `LAYER_SELECTION` (§5.13), so its cost is one small extra draw plus an edge pass at half resolution.

### 5.10 Budgets and the quality governor

**Budgets per frame, LOW tier** (UHD 630, 1920 × 1080, DPR 1):

| Resource | Budget | Measured in the prototype (Metropolis-sized city) |
|---|---|---|
| GPU frame time | **≤ 14 ms** (60 fps with 2.6 ms of slack) | 11.3–14.8 ms by day; 14.3–18.7 ms at night with bloom (so LOW gates bloom at 0.5 intensity at night, or accepts 50–60 fps; the governor decides) |
| JS render submit | ≤ 2.5 ms | 1.1–1.8 ms |
| Draw calls, all passes (pre-pass, shadow, main, post) | ≤ 250 | 85–212 |
| Triangles, all passes | ≤ 700k | 369k–553k |
| Chunk geometry (GPU) | ≤ 48 MB | 12.4 MB |
| Textures (atlases, noise, overlays) | ≤ 32 MB | SignAtlas 11 MB, AdAtlas 21 MB (mipmapped RGBA) |
| Render targets | ≤ 96 MB | about 70–90 MB (2 × RGBA16F 16.6 MB, depth 8.3 MB, bloom chain about 11 MB, FXAA/SMAA 8–17 MB, shadow 2048² 16.8 MB) |
| Instances | trees ≤ 12k, static props ≤ 8k, vehicles ≤ 500 (LOW) / 900 (MED+), pedestrians ≤ 600 (LOW) / 1,500 (MED) / 3,000 (HIGH) | 8.3k trees, 3k lamps, 2.1k parked cars, 500 vehicles |
| Worker chunk build | ≤ 8 ms per chunk | 4–5 ms per chunk |
| Picking | ≤ 0.05 ms per query | 0.33 µs per query (§5.12) |

**Tier guess, then runtime governor** (`Quality.ts`):
- `guessTier` classifies the unmasked renderer string: Intel UHD/HD/Iris Plus → low; Iris Xe, Arc, AMD APUs, Apple M1 → medium; other → high; SwiftShader or llvmpipe → low plus the "Minimal" preset.
- **`FrameGovernor`** keeps an EMA (α = 0.05) of rAF frame time.
  - Above 18 ms for 3 s: step down by one notch.
  - Below 12 ms for 5 s: step up by one notch.
  - After each step there is a 10 s cooldown, so it never oscillates.
- Notches, in order:
  1. resolution scale 1.0 → 0.9 → 0.8 → 0.7;
  2. bloom off, or trees stop casting shadows (LOW);
  3. shadow map 2048 → 1024;
  4. tree LOD1 distance 900 → 600 m;
  5. pedestrians × 0.5.
- **UX Graphics settings** (`ux-playability.md` §6.18, the "Graphics" row: preset, shadows, agent density, antialiasing, resolution scale 50–100%, FPS cap) map directly onto these switches. "Auto" means guess plus governor. An FPS cap of 30 skips alternate rAF callbacks.
- On battery (if `navigator.getBattery()` exists and is discharging): cap at 30 fps when the camera has been idle for more than 10 s.

### 5.11 Camera rig (Appendix A, `CameraRig.ts`)

| Setting | Value |
|---|---|
| Projection | Perspective, FOV 35° (vertical), dynamic near `clamp(0.2·d, 1, 200)`, far `5·d + 4000`, updated when the camera moves |
| Distance | 60 m to `max(1400, 1.15·diagonal)` (Metropolis at 24 m plots: about 3,120 m) |
| Tilt | Polar 25–55° (**elevation 65–35°**, UX §6.5). Auto-tilt follows zoom from polar 55° at the street band to 30° at the city band, and switches off once the user tilts manually |
| Mouse | Left = none (picking and placement); **right = `SCREEN_PAN`** (in camera-controls 3.x this is truck + forward on the ground plane); **middle = `ROTATE`**; wheel = `DOLLY` with `dollyToCursor` |
| Touch | 1 finger `TOUCH_SCREEN_PAN`; 2 fingers `TOUCH_DOLLY_ROTATE` |
| Keys | WASD and arrows pan at 0.9 × distance per second; Q/E rotate 45° (smooth); Home frames the HQ or first building; F focuses the selection; `[` `]` switch city (UI) |
| Smoothing | `smoothTime 0.25`, `draggingSmoothTime 0.08` |
| Focus | `fitToBox(buildingBox, true, padding 20)` on double-click; auto-tilt resumes |
| Bounds | `setBoundary(city ± 10%)`, `boundaryFriction 0.15` |
| Outputs | `update(dt)` returns "moved"; that triggers shadow re-fit, chunk LOD, labels and the audio frame. `zoom01()` gives 0 (≤ 300 m) to 1 (≥ 1,800 m) on a log scale, for LOD, labels and audio |

The zero-dependency fallback is `MapControls` (three r186 has ground-grabbing pan, `zoomToCursor`, `minTargetRadius`/`maxTargetRadius`), but it has no `fitToBox`, transitions or boundary friction.

### 5.12 Picking (Appendix A, `Picking.ts`)

- **Method.** Clip the ray to the city volume. Walk the plots under the ray's ground projection with the Amanatides–Woo DDA. For each plot that holds a building slot, test the ray against that building's AABB. Stop as soon as the best hit is nearer than the next cell boundary, or when the ray reaches the ground (then return the plot).
- **Data.**
  - `cellBuilding: Int32Array` (w·h) from placements;
  - `boxes: Float32Array` (6 per building) emitted by the factories through the worker (`AssetOutput.pickBox`);
  - `maxHeight`.
- **Validation.** In a scratch test, **20,000 random rays agreed 20,000/20,000 with a brute-force `Ray.intersectBox`** over 120 buildings on a 40 × 30 grid, at **0.33 µs per pick** in Node 22.
- **Usage.**
  - `pointermove` is coalesced to one pick per rAF, which drives hover.
  - `click` selects, and `dblclick` focuses.
  - A plot result feeds the placement ghost and land queries.
- **Vehicles** (clickable company trucks): ray against a bounding sphere for each visible company truck (≤ 100), done after the building pick. Ambient traffic is not pickable.
- **Not needed:** a GPU ID buffer (it would cost a render and a sync or async read-back) and three-mesh-bvh. Keep BVH as an option for irregular terrain rays in Hilltown; `ObjectBVH` exists in three-mesh-bvh 0.9.15.

### 5.13 Selection, hover and the placement ghost

- **Proxies.** For the hovered and the selected building, the main thread builds a **proxy mesh** from the same factory (LOD0, cached by `visualRev`), puts it on `LAYER_SELECTION` only (the main camera does not render it), and adds it to `outline.selection`.
  - Hover: white edge, `edgeStrength 3` at 60% opacity.
  - Selected: white edge at 100%, plus a **gold footprint ring** (`#D7B766`, 1.2 m wide, a dashed shader animated at 0.5 Hz on the lot outline, y = 0.25).
- **LOW fallback without a composer:** an inverted-hull outline (proxy scaled by 1.015 about the centre, `BackSide`, `MeshBasicMaterial` white). It costs nothing extra in post.
- **Placement ghost** (UX §6.6 states: palette → placing → confirm → constructing):
  - **Hologram:** the factory's LOD0 mesh with `HologramMaterial`, which is `MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })` plus an `onBeforeCompile` scanline, `0.15·step(0.9, fract(worldY·0.5 − uTime))`.
  - **Footprint cells:** an InstancedMesh of plot quads, 0.6 m inset at y 0.3, coloured green `#61C28F` (valid), **amber** `#E8B63A` (valid but cash short or runway under 3 months), red `#DF6F6A` (blocked; the reason is in the tooltip), or grey `#9FB2BD` (your own building). There is a 0.3 m border line in the same colour at 100%.
  - **Snapping.** The anchor is the plot under the cursor minus half the footprint.
  - **Rotation.** In placement mode, **Q/E or R** turn the ghost 90°, swapping W and H (UX ghost panel). Camera rotation stays on middle-drag.
  - **Validity.** From `previewBuild` (bridge), **throttled to one query per 100 ms and cached by (plot, rotation)**. The overlay auto-switches by type (UX §6.6).

### 5.14 Overlays, heatmaps and link arcs

**Scalar overlays.** One **R8 `DataTexture`** of w × h (one texel per plot), sampled by `CityMaterial` in clay mode at `vMWorld.xz / uCitySize` (`Overlay.ts`).
- Linear filtering for continuous fields (land $, traffic, demand); nearest for per-plot categories (zones).
- Ramps are chosen by a `uOverlayMode` uniform (a small extension of the verified code):
  - 0 = sequential 5-stop (verified);
  - 1 = diverging, red `#DF6F6A` → neutral `#E8E4DC` → green `#61C28F` (profit);
  - 2 = categorical, where the value is `colorIndex` into `uOwnerColors` (Owners);
  - 3 = binned into 5 bins (CapLab land-value style).
- **Per-building overlays** (Profit, Owners, Brand halo) write the building's value into **every plot of its footprint** in the same texture, so they need no extra material path.
- **Legends** are React components that import the same ramp constants from `tokens.ts`.

**Overlay list** (UX §6.5 and `caplab-brief.md` §5.8):

| Overlay | Source | Mode |
|---|---|---|
| Land $ | `ParcelDto.landValuePerPlot` | 3 (5 bins) |
| Traffic | `ParcelDto.traffic` | 0 |
| Demand (product) | `market` endpoints | 0 |
| Brand (product) | brand share | 0 plus store halos |
| Profit | `activity.netIncome` | 1 |
| Owners | `colorIndex` | 2 |
| Zones | parcel `zone` | categorical |
| Resources | deposits | badges |
| Construction | badges with months remaining | — |
| **Links** | `supplyFlows` | arcs, below |

**Links (animated arcs).**
- For each flow with both ends in the city, draw a quadratic Bézier from the source to the destination roof, with apex height = 0.25 × distance.
- Width ∝ `log10(1 + qty)`, in the owner colour.
- Implementation: `LineSegments2`/`LineMaterial` from `three/addons/lines/` (world-units width, dashed, `dashOffset -= dt·20` for the flow direction). It stays readable up to about 200 arcs.
- Import and export arcs run to the port or city edge in neutral white.

**Clay mode** fades in over 0.3 s (`uOverlay` 0 → 1). Night emission drops by 85% while an overlay is on.

### 5.15 Roads

- **Tile geometry.** Everything is merged into the chunk, per road plot.
  - Carriageway quad(s): the asphalt colour gets ±3% hash noise per plot, so repairs and patches read.
  - Sidewalks as 0.15 m slabs with curb faces along every non-road edge.
  - **Quarter-disc corner pieces** (radius 6 m, or 9 m at arterials, 8 segments) wherever two road neighbours meet a land diagonal.
  - Planting strips (streets) or the median (arterials).
- **Markings** (LOD0 chunks only; dropped in LOD1 to avoid far-field shimmer):

  | Tile | Markings |
  |---|---|
  | Straight street | centre dashes 0.14 × 3 m every 6 m; parking-bay ticks every 6 m |
  | Straight arterial | double yellow 2 × 0.12 m around the median, or lane dashes 0.12 × 3 m, gap 6 m, at ±3.25 m |
  | Tile next to an intersection | **zebra** of 0.6 m bars and 0.6 m gaps, 4 m long, starting 1 m from the intersection edge; arterials add a **stop line** 0.4 m wide 1 m behind it |
  | Intersection box | clean asphalt |
  | Corner / T | continuous edge lines around the curb arcs |
  | Dead end | turning-circle paint |

- **Furniture** (instanced, per 400 m cell):
  - lamps: streets one per side every 24 m, staggered; arterials both sides;
  - trees in strips every 12 m (streets, residential zones);
  - **traffic lights** at crossings involving an arterial (4 mast-arm poles);
  - bus stops on arterials every ~6 plots;
  - fire hydrants (LOD0, close only).
- **Bridges** (road plot over water): deck 1.2 m thick at +6 m, parapets 1.1 m, piers every 24 m. Arterial bridges get lamps and, for spans of 3 plots or more, suspension towers (P1).
- **Highways** to the city edge continue into the outskirts (§3.12): guard-rails, grass verges, no sidewalks.

### 5.16 Traffic

- **Road graph** (built once per `layoutRev` in `RoadGraph.ts`):
  - nodes at plots with a mask of 1, 3 or 4 bits and at map edges; edges along straight runs;
  - lanes offset from the centreline: streets ±1.75 m, arterials ±1.625 m and ±4.875 m around the median;
  - **turn connectors** at intersections as circular arcs: right turn r = 6 m on streets or 9 m on arterials, left turn r = 12–15 m, straight = line.
- **Agents:**
  - `TrafficIdm.ts` (Appendix A) implements the **Intelligent Driver Model**: `a = a_max[1 − (v/v0)^4 − (s*/s)^2]`, where `s* = s0 + v·T + v·Δv / (2·√(a_max·b))`.
  - Cars: v0 13.9 m/s (50 km/h) on streets, 16.7 m/s on arterials; T 1.5 s; s0 2.0 m; a 1.5; b 2.0; length 4.5 m.
  - Trucks: T 1.8, a 1.0, length 8.6 m. Buses: length 12.4 m.
  - A red light or stop line is a standing leader at the line.
  - **Signals** where an arterial is involved: fixed 50 s cycle (22 s green, 3 s amber, 1 s all-red per axis), with offsets along arterials = distance / 13.9 m/s for green waves.
  - **Street × street:** all-way stop (decelerate to the line, wait 1 s, go if the conflict box is free; the box is reserved during the crossing).
  - Integration at a fixed **20 Hz**, with render positions interpolated.
- **Ambient density.**
  - `N = clamp(round(1.1·√population), 120, 900)`. That gives Metropolis 778, Riverside 550, Eastside 492, Portbay 426 and Hilltown 348, capped at 500 on LOW.
  - Multiplied by the day curve (hours 3, 8, 13, 18, 22 → 0.25, 1.0, 0.7, 1.0, 0.35) when the day cycle is on, and by economic mood (±20–25%).
  - Spawn and despawn at highway edges and random driveway plots.
  - Turn choice: 60% straight, 25% right, 15% left.
- **Company trucks** (`supplyFlows` `transfer`):
  - trips = `clamp(ceil(qty / payload), 1, 6)` per link per visual month, spread uniformly;
  - A* on the road graph from the source frontage to the destination frontage, with paths cached by (from, to);
  - cab in owner colour, trailer showing the product family (§4.3);
  - inter-city trips drive to the nearest highway edge and despawn;
  - imports and exports use the port quay (coastal cities) or a highway edge.
  - At most 60 concurrent trucks per city, and they are pickable.
- **Rendering.** One `InstancedMesh` per model and LOD with `DynamicDrawUsage`. `count` is set to the number of visible instances each frame (compact the visible ones first). Hidden beyond 1,100 m.
- **Budget:** ≤ 1.0 ms per frame of JS for 900 vehicles (IDM plus matrix writes).

### 5.17 Pedestrians and shoppers

- **Sidewalk graph:** every sidewalk strip is a segment, and crossings sit at zebras.
- **Agents** walk at 1.3 ± 0.2 m/s. They enter and leave shop doors, bus stops and car parks.
- **Density per block** ∝ (residential floors + retail unitsSold) × day curve. Shoppers per store = `min(40, round(6·log10(1 + unitsSold)))` (UX §6.5).
- **Rendering:** an InstancedMesh of 20 triangles, 12 clothing colours via `instanceColor`, and walking bob and sway in the vertex shader from `uTime + instancePhase`. Only positions are uploaded.
- Visible and simulated only within 420 m and 600 m of the camera target respectively.
- Caps: 600 on LOW, 1,500 on MED, 3,000 on HIGH. **Reduced motion freezes agents** (UX).

### 5.18 Day and night, seasons, weather

**`DayNight.ts`:**
- A 12-minute cosmetic day, or fixed presets (§2.3).
- Interpolates the §3.6 keys and sets:
  - sun and moon direction and colour;
  - hemisphere light;
  - fog;
  - sky uniforms;
  - `uNight`, `uLitFrac`, `uSkyRefl`;
  - pool opacity;
  - bloom opacity (LOW);
  - `sign.emissiveIntensity`.
- Refreshes the water PMREM on a change of more than 20 visual minutes.
- Requests a shadow update at no more than 4 Hz when the sun has moved more than 0.15°.

**`Seasons.ts`:** month → `uSeasonTint`; grass colour (set `FLAG_VEGETATION` on lawn and verge ground quads so that `uSeasonTint` also shifts grass); tree instance recolour (autumn share, bare winter canopies), crop stages (chunk rebuild of field lots once a month, ≤ 10 chunks) and `uSnow` for cold climates.

**`Weather.ts`** (cosmetic, seeded per month, setting "Weather: on/off"):
- **Rain.**
  - About 4,000 (LOW) or 8,000 (MED+) streak quads (0.02 × 1.2 m) in a 300 × 200 × 300 m volume that follows the camera target.
  - GPU-animated: `y = mod(y0 − 9·t, 200)`, with wind slant.
  - `uWet` ramps 0 → 1 over 30 s; fog `far × 0.6`; sun × 0.55; the sky desaturates.
  - Occasional **lightning**: a 0.1 s exposure flash (+0.6), synchronised with the audio `thunder` one-shot.
- **Snow.** 3,000 flakes at 1.2 m/s with a sinusoidal sway. `uSnow` ramps to 1 over 60 s and lingers 2 minutes after the snowfall stops.
- The renderer publishes `rain` and `wind` (0–1) in the `AudioFrame`.

### 5.19 Particles (smoke, steam, dust, flare, confetti)

- **One `InstancedBufferGeometry` per kind** (a quad) with **static** per-instance attributes: emitter position, phase and seed. It is **GPU-animated**:
  - `age = fract(uTime / life + phase)`;
  - `pos = emitter + (wind·age·life) + up·(rise·age·life) + jitter(seed)`;
  - `size = mix(s0, s1, age)`, `alpha = sin(π·min(1, 1.3·age))·(1 − age)`;
  - camera-facing, built from the view matrix in the vertex shader.
  - The prototype uploaded attributes from the CPU every frame and that was fine; the GPU version removes those uploads entirely.
- **Emission rate** ∝ utilization. Each emitter owns a fixed pool of 14–18 puffs; `rate` scales an `enabled` instance attribute, or alpha, per puff, updated monthly and never per frame.
- Materials are `transparent` with `depthWrite: false`, and colour is multiplied by a day-light factor (0.25 at night).
- **Soft particles** (depth fade) only on HIGH, where the composer's depth texture is sampled.
- Caps: 800 puffs on LOW, 2,000 on MED, 4,000 on HIGH. The smoke range is ≤ 2,600 m.
- Confetti (openings) and beams (tech-up) are short-lived pools in `WorldFx.ts`.

### 5.20 Animated parts

- **Periodic motion** is shader-driven with **zero uploads**:
  - pumpjack beam ±18° over 7.5 s;
  - crank 360°;
  - sheave wheels;
  - radar and satellite dishes;
  - irrigation pivots;
  - flags (vertex sway).
  - Each is an `InstancedMesh` whose instance attributes hold the pivot, axis, amplitude, period, phase and an `active` flag (utilization > 0). The vertex shader rotates about the pivot.
  - Part geometry is authored in pivot space.
- **State-driven motion** is CPU-driven: port crane trolleys and booms (ship at berth), straddle carriers, construction cranes, excavators. There are at most about 60 instances in view; update matrices only for cells in the frustum and within 1,200 m.

### 5.21 World effects for game-feel events (`ux-playability.md` §8, game-feel catalogue)

| Event | Visual |
|---|---|
| Building opened | Pop scale (0.25 s), owner confetti (60 quads, 2 s) |
| Rival enters your market | **Red beacon**: a vertical additive cylinder Ø3 × 80 m in `#DF6F6A` that pulses for 6 s over the rival's store; the camera offers "Show me" (`fitToBox`) |
| Tech level up | Owner-colour beam from the R&D rotunda (3 s) and a dome pulse |
| Goal achieved | Gold ring shockwave on the ground (expanding decal, 1.5 s) from your HQ or first building |
| Insolvency | 20% city desaturation (`uDesaturate`); red vignette tint (vignette colour → `#3A0A0A`, darkness 0.55) |
| Construction started | Hoarding "pop-up" (fence rises from the ground over 0.4 s) |
| Month close | A subtle 0.3 s ambient brightening pulse; optional, off under reduced motion |

### 5.22 Labels, UI integration and the audio frame

- **State.**
  - zustand (`web/src/state/gameStore.ts`) holds UI state: selection id, hover id, overlay mode, placement state, time-of-day mode, graphics settings, photo mode.
  - The renderer reads it with `store.subscribe(selector, listener)` (the `subscribeWithSelector` middleware), never inside React render.
  - The renderer writes back only through a typed `EventTarget`: `hover`, `select`, `ghostValidity`, `cameraMoved`, `fps`.
  - **No per-frame React state.**
- **Labels.** A pool of 30 DOM labels positioned with `Vector3.project`: the hover card, the selected building, district names in the city band.
  - `CSS2DRenderer` (`three/addons/renderers/CSS2DRenderer.js`) is acceptable at this count.
  - Status badges are GPU instanced billboards (§3.4), not DOM.
- **AudioFrame** for `audio-plan.md` §4.8, computed at 10 Hz:

  | Field | Source |
  |---|---|
  | `zoom01` | `CameraRig.zoom01()` |
  | `focus` | the camera target |
  | `timeOfDay` | `DayNight` hours, or `null` when fixed |
  | `month` | the game date |
  | `rain`, `wind` | `Weather` |
  | `area.*` | **summed-area tables** per land-use category over the plot grid, built at layout load and on `cityView` deltas; O(1) window queries with radius `R = max(6 plots, 0.8·cameraHeight/PLOT_SIZE)` |
  | `distToWaterPlots` | a BFS distance field over the plots, precomputed |

  The listener rig position is `target + (camera.position − target)·0.35` (audio plan §4.3).

### 5.23 Context loss, memory and disposal

- On `webglcontextlost`, call `preventDefault()` and pause the loop.
- On `webglcontextrestored`, three re-uploads geometry and render targets on demand. Set `needsUpdate = true` on the CanvasTexture atlases and DataTextures, re-run `compileAsync`, and set `shadowMap.needsUpdate`.
- **City switch.** Dispose chunk geometries, instanced meshes, atlas slots (keep the atlases) and worker caches. `Object3D.dispose()` (new in r186) dispatches a `dispose` event that modules can listen to.
- The debug HUD shows `renderer.info.memory` (geometries, textures) and `renderer.info.render` (calls, triangles, reset manually per frame). **stats-gl 4.2.3** replaces the removed `GPUStatsPanel` (r169).

### 5.24 Testing and tooling

- **Asset gallery** (`/dev/assets`): every factory × variants × levels × construction stages × owner colours × day/dusk/night on a turntable. This is the art review surface.
- **Pure unit tests** (vitest, Node; `GeoBuilder` needs no GPU):
  - **determinism**: `sha1` of every attribute array for fixed seeds, snapshotted;
  - **budget**: LOD0 and LOD1 triangle counts ≤ the table values;
  - **bounds**: pick box inside the lot minus 1 m, and height > 0;
  - **aligned formats**: `itemSize × BYTES_PER_ELEMENT % 4 === 0` for every attribute.
- **Golden screenshots** with puppeteer-core (already a devDependency; see `web/scripts/smoke.mjs`):
  - fixed seed, city and camera views (overview, mid, close) at 13:00 and 22:30;
  - compare with a pixel-diff threshold of 1% of pixels at ΔE > 6.
- **Perf harness.** Port the prototype's **drained-throughput** method (Appendix B) to `/dev/bench?tier=…&view=…`. Run it by hand on the reference Intel UHD 630 laptop, and fail review if a PR regresses a view by more than 0.5 ms.
- **CI assertions** (deterministic, GPU-free): draw-call and triangle counts per standard view, from a headless scene-graph walk that sums visible geometry per pass.

---

## 6. npm packages

The versions are the latest on npm as of 2026-09-30; the peer ranges were read with `npm view <pkg> peerDependencies`.

| Package | Version | Peer / compatibility | Role | Decision |
|---|---|---|---|---|
| `three` | **0.186.1** (pin exactly: `"three": "0.186.1"`) | — | core | **Required.** `web/package.json` has `^0.186.1`. Pin it, because postprocessing's peer range ends below 0.187. |
| `@types/three` | 0.186.0 | matches | types | **Required** (already present) |
| `postprocessing` | **6.39.5** | `three >= 0.168.0 < 0.187.0` | Composer, merged `EffectPass`, mipmap Bloom, SMAA/FXAA, OutlineEffect with a selection layer, TiltShift, ToneMapping NEUTRAL, LUT, runtime gating via `blendMode.opacity` | **Required.** v7 is still beta (7.0.0-beta.16), so do not adopt it yet. Upgrade three and postprocessing together. |
| `camera-controls` | **3.1.2** | `three >= 0.126.1` | RTS camera: smooth transitions, `fitToBox`, `setBoundary`, `dollyToCursor`, `SCREEN_PAN` ground panning | **Recommended.** Fallback: `MapControls` (built in). |
| `n8ao` | **2.0.1** | `postprocessing >= 6.30.0`, `three >= 0.137` | SSAO on HIGH and ULTRA only | **Optional.** Load it with `await import('n8ao')` only on HIGH or ULTRA, so the LOW bundle stays small. It ships **no `.d.ts`**; use the shim in Appendix A. |
| `stats-gl` | 4.2.3 | `three: *` | GPU and CPU frame panel (replaces `GPUStatsPanel`, removed in r169) | dev only |
| `lil-gui` | 0.21.0 | — | Live-tune the art-bible values (time-of-day keys, bloom, tints) in `/dev` | dev only |
| `three-mesh-bvh` | 0.9.15 | `three >= 0.159` | Accelerated raycasts, `ObjectBVH`, `computeBatchedBoundsTree` | **Not needed in v1** (grid-DDA picking, §5.12). Keep it for Hilltown terrain rays if needed. |
| `troika-three-text` | 0.52.5 | `three >= 0.125` | SDF 3D text | **Not used.** Signs use CanvasTexture atlases; labels use the DOM. |
| `@react-three/fiber`, `drei`, `@react-three/postprocessing` | 9.8.1, 10.7.9, 3.1.3 | React 19 | declarative three | **Not used** (§5.1) |
| `three-stdlib` | 2.36.1 | — | re-packaged add-ons | **Not used.** It duplicates `three/addons` and lags upstream. |
| `@pmndrs/detect-gpu` / `detect-gpu` | 6.0.24 / 5.0.70 | — | GPU tier from benchmark data | **Not used.** It fetches benchmark JSON from a CDN by default, which raises offline and privacy concerns. The 30-line heuristic plus the runtime governor is enough. |
| `@three.ez/instanced-mesh` | 0.3.16 | `three >= 0.159` | InstancedMesh with per-instance culling, LOD and BVH | Not in v1; revisit if 400 m cells are not enough. |
| `realism-effects` | 1.1.2 | — | SSGI, TRAA | **Not used** (last release 2023) |
| `simplex-noise` | 4.0.3 | — | noise | **Not needed**: `three/addons/math/SimplexNoise.js` and `ImprovedNoise.js` exist |

**"Add-ons only" is viable, but not chosen.** three's own `EffectComposer`, `UnrealBloomPass`, `OutputPass`, `FXAAPass`, `SMAAPass`, `OutlinePass` and `GTAOPass` all exist in r186, and the bloom, tone map and FXAA chain measured the same as postprocessing (§1.5).

postprocessing is chosen for three reasons:
1. Merged effects and runtime toggles without shader recompiles (`blendMode.opacity`).
2. A better selection-outline workflow (a layer-based `Selection`).
3. N8AO integration and TiltShift, LUT3D and NEUTRAL tone mapping in one API.

The cost is a coupled upgrade cadence.

**Add-ons used from `three/addons/*`** (no extra packages):
- `lines/LineSegments2.js` and `LineMaterial.js` (link arcs, with `dashed` and `dashOffset`);
- `renderers/CSS2DRenderer.js` (labels);
- `math/SimplexNoise.js` (outskirts);
- `utils/BufferGeometryUtils.js` (`mergeGeometries`, `mergeVertices` for gallery and proxies);
- `controls/MapControls.js` (fallback).

## 7. three.js r150 to r186: API changes that matter here

From the official migration guide (github.com/mrdoob/three.js/wiki/Migration-Guide), cross-checked against the 0.186.1 sources:

| Release | Change | Impact on Magnate |
|---|---|---|
| r151 | `mergeBufferGeometries` → `mergeGeometries`; `mergeBufferAttributes` → `mergeAttributes` | Use the new names |
| r151 | `MapControls` moved to its own module | The skeleton already imports `three/examples/jsm/controls/MapControls.js` |
| r151 | `InstancedMesh.frustumCulled` defaults to true, and needs **`computeBoundingSphere()`** after setting matrices | Done in `Instancing.ts` |
| r152 | `outputEncoding` → `outputColorSpace`; `Texture.encoding` → `.colorSpace`; `sRGBEncoding` → `SRGBColorSpace`; `ColorManagement.enabled = true` by default | Atlas `SRGBColorSpace`; data textures `NoColorSpace`; `Color.set()` converts sRGB to linear |
| r155 → r165 | `useLegacyLights` defaults to false, then is removed; physical light units | The §3.6 intensities assume this |
| r160 / r162 | `AgXToneMapping` (r160) and `NeutralToneMapping` (r162) added; `HBAOPass` replaced by `GTAOPass` | NEUTRAL used |
| r163 | WebGL1 removed; `TextGeometry.height` → `depth`; the `stencil` context attribute defaults to false | — |
| r166 | `BatchedMesh` requires `addInstance()` after `addGeometry()` | Not used in v1 |
| r169 | `GPUStatsPanel` removed; use `stats-gl` | stats-gl |
| r171 | WebGPU and TSL imports moved to `three/webgpu` and `three/tsl` | Future port only |
| r175 | `Controls.connect(element)` requires the element; the `SMAAPass` constructor lost width and height | — |
| r176 | `CapsuleGeometry` `length` → `height` | Pedestrians use custom geometry |
| r179 | **`Timer` moved to core** (`THREE.Timer`, `connect(document)`) | The skeleton uses it; keep it |
| r180 | `RGBELoader` → `HDRLoader` | No HDR environment is used |
| r181 | PBR energy-conservation changes (rough materials brighter) | Only water uses Standard |
| r182 | **`PCFSoftShadowMap` deprecated for WebGL; `PCFShadowMap` is now soft** | Fix `CityScene.ts:39` (§2.6) |
| r183 | **`Clock` deprecated** in favour of `Timer`; `PostProcessing` → `RenderPipeline` (WebGPU); legacy gamma removed from `Sky`/`SkyMesh` | Sky add-on not used |
| r185 | `GTAONode` becomes physically correct; `DRACOLoader.setDecoderConfig` deprecated | — |
| r186 | **`Object3D.dispose()`** plus a `dispose` event; `Sky` `up` uniform removed; `SimplifyModifier` is async; `PCFSoftShadowMap` removed for WebGPU | Modules listen for `dispose` |
| r187 (next) | `setViewport`/`setScissor` no longer scaled by pixel ratio with bound render targets; PMREM becomes cube-based | Re-test the post pipeline and the water PMREM when upgrading; bump postprocessing too |

**Verified to exist in 0.186.1** (grepped in `node_modules/three`, or type-checked with `tsc`):
- `WebGLRenderer.compileAsync`, `readRenderTargetPixelsAsync`, and the `reversedDepthBuffer` constructor option (not used);
- `LightShadow.intensity`, `.radius`, `.autoUpdate`, `.needsUpdate`, `.normalBias`;
- `PCFShadowMap`, `VSMShadowMap`, `NeutralToneMapping`, `AgXToneMapping`;
- `InstancedMesh.setColorAt`, `.computeBoundingSphere`, `.count`;
- the full `BatchedMesh` API (`addGeometry`, `addInstance`, `setGeometryIdAt`, `setVisibleAt`, `optimize`, `setInstanceCount`, `setGeometrySize`, `perObjectFrustumCulled`, `sortObjects`);
- `Timer.connect`;
- `MapControls` / `OrbitControls` (`cursor`, `zoomToCursor`, `minTargetRadius`, `maxTargetRadius`, `keyPanSpeed`);
- the `CSM` add-on, `SimplexNoise`, `LineMaterial.dashOffset`, `CSS2DRenderer`;
- `BufferGeometryUtils.{mergeGeometries, mergeVertices, toCreasedNormals, mergeGroups}`;
- in postprocessing 6.39.5: `ToneMappingMode.NEUTRAL` (8) and `AGX` (7), `TiltShiftEffect`, `OutlineEffect.selection.layer`, `Pass.needsSwap`, `RenderPass.clearPass`;
- in camera-controls 3.1.2: `ACTION.SCREEN_PAN` and `TOUCH_SCREEN_PAN`, `setBoundary`, `fitToBox`, `rotatePolarTo`, `dollyToCursor`. Note that `verticalDragToForward` is **deprecated** in 3.x in favour of `SCREEN_PAN`.
- **Every file in Appendix A compiles with `tsc` 7.0.2 (`strict`) against these typings.** `CityMaterial` was also compiled to JS and rendered in Chrome, with no shader errors.

## 8. Risks and open questions

### 8.1 Risks

| Risk | Mitigation |
|---|---|
| iGPU thermals and variance. The numbers were measured under heavy load; laptops also throttle on battery. | The frame governor (§5.10), 2–5 ms of slack in the LOW budget, and the reference-laptop perf harness |
| Coupled upgrades: postprocessing's peer range is `< 0.187` | Pin three exactly and upgrade both in one PR, re-running the golden screenshots |
| `CityMaterial` complexity creep (every feature costs every fragment) | A single owner (W1), a ≤ 0.3 ms per-feature budget, and the bench harness |
| Month close with many AI builds causes chunk rebuild bursts | Worker builds, a 100 ms debounce, ≤ 2 swaps per frame, and construction sites kept out of chunks |
| HiDPI laptops (Retina 3072 × 1920 is 2.8× the pixels of 1080p) | Tier DPR caps (LOW 1.0) and resolution scale |
| Browser differences | Chrome and Edge (ANGLE D3D11/Metal) verified. Firefox (no `WEBGL_multi_draw`, not needed here) and Safari (WebGL2; `OffscreenCanvas` 2D since 16.4, with a fallback in `SignAtlas`) need a smoke test on day one of implementation. |
| Art throughput: 18 company types plus about 25 ambient archetypes, each with variants | Code-authored geometry (the prototype built all 18 types in about 600 lines), the asset gallery for review, and budget tests |
| Colour-vision accessibility | Emblem shapes, the gold ring for "yours", and the UX colour-blind mode, which remaps profit and loss to blue and orange (and should drive `uOverlayMode` 1) |

### 8.2 Open questions (decisions for the lead or the user)

1. **Plot size.** 24 m (this report and `caplab-brief.md`) or 12 m (the current skeleton)? The recommendation is 24 m, via one constant in `units.ts`.
2. **Player colour.** Blue paint plus a gold badge and ring (this report), or gold paint (UX §6.5)? Blue is recommended: gold vanishes against wheat and sand, and collides with the UI's selection gold.
3. **Day and night default.** The dynamic 12-minute cosmetic cycle ON by default (the recommendation), or fixed daytime by default with night as an option?
4. **Minimum hardware.** `caplab-brief.md` §5.11 accepts 30 fps on integrated GPUs, while this report hits 60 fps at 1080p on a UHD 630. Is UHD 620 (8th-gen U-series, about 60% of a 630) in scope at 1080p60, or at 30 fps or 900p?
5. **Road geometry.** Plot-based roads are axis-aligned and one plot wide. `caplab-brief.md` §5.2 proposes gently curved suburban streets. The recommendation is **axis-aligned only in v1**; spline roads rendered as ribbons over plots would be a P2 renderer feature, and a layout change as well.
6. **Layout variety.** The prototype's uniform 5×5 blocks read as a board game at overview. The layout workstream should vary block depth (2 lots deep for houses), add diagonal or waterfront avenues and rivers, and make the urban edge irregular (`caplab-brief.md` §5.2 already proposes much of this).
7. **Photo mode** (tilt-shift, free camera, hidden HUD, AgX): v1 or later?
8. **Weather.** Purely cosmetic, or tied to news events (a storm at the port delays imports), which would need an engine hook?

---
## Appendix A. Verified reference code

All files type-check together under `tsc` 7.0.2 (`strict`, `moduleResolution: Bundler`) against `@types/three` 0.186.0, `postprocessing` 6.39.5 and `camera-controls` 3.1.2.

- `CityMaterial.ts` was also compiled to JS and rendered in Chrome 154 on the UHD 630: day, night, snow, rain, the overlay and the owner tint all render with no shader errors.
- `Picking.ts` was validated against brute force (§5.12).

Suggested homes are under `web/src/scene/` (§5.2).

### A.1 `core/RendererSetup.ts`: renderer configuration, loop, warm-up

```ts
import * as THREE from 'three';
export function createRenderer(canvas: HTMLCanvasElement, maxDpr: number): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
  r.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
  r.outputColorSpace = THREE.SRGBColorSpace;          // default since r152
  r.toneMapping = THREE.NoToneMapping;                 // ToneMappingEffect (NEUTRAL) does it in the composer
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;               // PCFSoftShadowMap is removed for WebGL in r186 (warns, falls back)
  // Keep renderer.shadowMap.autoUpdate = true (the global gate in WebGLShadowMap.render returns early when both the
  // global autoUpdate and needsUpdate are false). Throttle per light instead: sun.shadow.autoUpdate = false and set
  // sun.shadow.needsUpdate = true on camera/sun/geometry change (see ShadowFit.ts).
  r.info.autoReset = false;                            // composer renders several passes per frame
  return r;
}
export function startLoop(renderer: THREE.WebGLRenderer, frame: (dtSec: number, nowMs: number) => void): THREE.Timer {
  const timer = new THREE.Timer();                     // core since r179; Clock deprecated in r183
  timer.connect(document);                             // pause-aware via Page Visibility API
  renderer.setAnimationLoop((t) => { timer.update(t); frame(Math.min(timer.getDelta(), 0.1), t); });
  return timer;
}
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  await renderer.compileAsync(scene, camera);          // KHR_parallel_shader_compile -> no first-frame hitch
}
```

### A.2 `materials/CityMaterial.ts`: the one city material (windows, AO, emissive, owner tint, overlay, season, snow, rain)

```ts
// CityMaterial — one Lambert material family for all opaque city geometry (chunks, trees, vehicles, props).
// Vertex format (4-byte aligned attributes, see GeoBuilder):
//   position f32x3 | normal i8x4 (normalized) | color u8x4 (normalized; rgb = sRGB, a = instance-tint weight)
//   fuv f32x2 (facade metres: u along wall, v = height above ground)
//   facade u8x4 (style, seed, floorHeight dm | wallHeight dm for INDUSTRIAL, bay dm)
//   extra u8x4 (emissive 0..255, flags bitfield, owner index 0..7 | 255 = none, reserved)
import * as THREE from 'three';

export const FLAG_OWNER_ROOF = 1;   // up-facing faces of company buildings (tinted with owner colour at distance)
export const FLAG_VEGETATION = 2;   // leaves / crops (seasonal tint, wind)
export const FLAG_PAVED = 4;        // asphalt / sidewalks (rain wetness)
export const FLAG_SNOWABLE = 8;     // receives snow when facing up

export const CityUniforms = {
  uNight: { value: 0 },                                   // 0 day .. 1 night (window/lamp emission)
  uLitFrac: { value: 0.42 },                              // share of windows lit at night
  uWinWarm: { value: new THREE.Color(1.0, 0.72, 0.38) },  // linear HDR base colours (x uEmiBoost)
  uWinCool: { value: new THREE.Color(0.75, 0.85, 1.0) },
  uEmiBoost: { value: 2.4 },                              // > 1 so lit windows cross the bloom threshold (1.0)
  uSkyRefl: { value: new THREE.Color(0.45, 0.62, 0.8) },  // sky colour reflected by glass (set by DayNight)
  uGlass: { value: new THREE.Color('#46607A') },
  uGlass2: { value: new THREE.Color('#6F8FA6') },
  uOwnerColors: { value: Array.from({ length: 8 }, () => new THREE.Color()) },
  uOwnerRoofMix: { value: 0 },                            // smoothstep(900, 1600, cameraDistance)
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },       // multiplies vegetation
  uSnow: { value: 0 },                                    // 0..1 snow cover on up-facing surfaces
  uWet: { value: 0 },                                     // 0..1 rain wetness on paved surfaces
  uOverlay: { value: 0 },                                 // 0..1 "clay mode" for data overlays
  uOverlayTex: { value: null as THREE.Texture | null },   // R8, one texel per plot
  uCitySize: { value: new THREE.Vector2(1600, 1600) },    // metres
  uTime: { value: 0 },
};

const VERT_DECL = /* glsl */ `
attribute vec2 fuv;
attribute vec4 facade;
attribute vec4 extra;
varying vec2 vFuv;
varying vec4 vFacade;
varying vec4 vExtra;
varying vec3 vMWorld;
vec3 m_srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
`;

// replaces #include <color_vertex>
const VERT_COLOR = /* glsl */ `
vColor = vec4(1.0);
float m_tintW = 1.0;
#if defined( USE_COLOR_ALPHA )
  vColor.rgb *= m_srgb2lin(color.rgb); m_tintW = color.a;   // alpha = instance-tint weight, NOT opacity
#elif defined( USE_COLOR )
  vColor.rgb *= m_srgb2lin(color);
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, m_tintW);
#endif
vFuv = fuv; vFacade = facade; vExtra = extra;
{
  vec4 mwp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mwp = instanceMatrix * mwp;
  #endif
  vMWorld = (modelMatrix * mwp).xyz;
}
`;

const FRAG_DECL = /* glsl */ `
uniform float uNight, uLitFrac, uEmiBoost, uOwnerRoofMix, uSnow, uWet, uOverlay, uTime;
uniform vec3 uWinWarm, uWinCool, uSkyRefl, uGlass, uGlass2, uSeasonTint;
uniform vec3 uOwnerColors[8];
uniform sampler2D uOverlayTex;
uniform vec2 uCitySize;
varying vec2 vFuv;
varying vec4 vFacade;
varying vec4 vExtra;
varying vec3 vMWorld;
float m_win; float m_lit; vec3 m_winCol; float m_style; int m_flags;
float m_h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float m_rect(vec2 f, vec4 r, vec2 aa) { vec2 a = smoothstep(r.xy - aa, r.xy + aa, f) * (1.0 - smoothstep(r.zw - aa, r.zw + aa, f)); return a.x * a.y; }
vec3 m_ramp(float t) {
  vec3 c0 = vec3(0.10, 0.16, 0.42), c1 = vec3(0.07, 0.45, 0.55), c2 = vec3(0.28, 0.70, 0.38), c3 = vec3(0.98, 0.82, 0.25), c4 = vec3(0.95, 0.38, 0.16);
  t = clamp(t, 0.0, 1.0) * 4.0;
  return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : mix(c3, c4, t - 3.0);
}
`;

// replaces #include <color_fragment>  (runs before lighting; diffuseColor is still editable)
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
m_win = 0.0; m_lit = 0.0; m_winCol = uWinWarm;
m_style = floor(vFacade.x + 0.5);
m_flags = int(vExtra.y + 0.5);
if (m_style > 4.5 && m_style < 5.5) {
  // INDUSTRIAL: continuous clerestory band at 70-88% of the wall height (facade.z = wall height, dm)
  float hh = vFacade.z * 0.1;
  float bay = max(vFacade.w, 10.0) * 0.1;
  float fx = vFuv.x / bay; float ax = fwidth(fx); float fxf = fract(fx);
  float mx = smoothstep(0.06 - ax, 0.06 + ax, fxf) * (1.0 - smoothstep(0.94 - ax, 0.94 + ax, fxf));
  float ay = fwidth(vFuv.y);
  float band = smoothstep(hh * 0.70 - ay, hh * 0.70 + ay, vFuv.y) * (1.0 - smoothstep(hh * 0.88 - ay, hh * 0.88 + ay, vFuv.y));
  m_win = mx * band; m_winCol = uWinCool; m_lit = m_win * 0.85;
  diffuseColor.rgb = mix(diffuseColor.rgb, uGlass2, m_win);
} else if (m_style > 0.5) {
  float seed = vFacade.y;
  vec2 cellSize = vec2(max(vFacade.w, 10.0), max(vFacade.z, 10.0)) * 0.1;   // bay, floor height (m)
  vec2 fu = vFuv;
  vec4 r = vec4(0.30, 0.32, 0.70, 0.78);                                      // 1 HOUSE
  float litMul = 1.0;
  if (m_style > 1.5 && m_style < 2.5) r = vec4(0.16, 0.28, 0.84, 0.82);       // 2 APARTMENT
  else if (m_style > 2.5 && m_style < 3.5) { r = vec4(0.04, 0.05, 0.96, 0.95); m_winCol = uWinCool * 0.55; litMul = 0.7; } // 3 CURTAIN WALL
  else if (m_style > 3.5 && m_style < 4.5) {                                  // 4 SHOP: glazed ground floor
    if (fu.y < 4.2) { cellSize = vec2(4.5, 4.2); r = vec4(0.04, 0.06, 0.96, 0.80); litMul = 2.2; }
    else { fu.y -= 4.2; r = vec4(0.20, 0.28, 0.80, 0.80); }
  }
  else if (m_style > 5.5) { r = vec4(0.03, 0.34, 0.97, 0.88); m_winCol = uWinCool * 0.7; litMul = 0.8; } // 6 OFFICE ribbon
  vec2 cell = fu / cellSize;
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 aa = fwidth(cell);
  float mask = m_rect(f, r, aa);
  float area = (r.z - r.x) * (r.w - r.y);
  float far = smoothstep(0.35, 0.8, max(aa.x, aa.y));       // cell < ~1.5 px: fade to average (no moire)
  mask = mix(mask, area, far);
  bool office = (m_style > 2.5 && m_style < 3.5) || m_style > 5.5;
  vec2 litId = office ? vec2(floor(id.x / 3.0), id.y) : id;  // offices light up in 3-bay clusters per floor
  float h = m_h12(litId + seed * 7.13);
  m_win = mask;
  m_lit = mix(step(h, uLitFrac * litMul) * mask, 0.5 * min(1.0, uLitFrac * litMul) * area, far);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uGlass, uGlass2, m_h12(id.yx + seed)), m_win);
}
// wall-base contact AO: darken the bottom 3.5 m of every facade (replaces SSAO on LOW/MED)
if (m_style > 0.5) diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 3.5, vFuv.y));
// vegetation seasonal tint
if ((m_flags & 2) != 0) diffuseColor.rgb *= uSeasonTint;
// owner roof tint at distance (ownership must read at city zoom)
float m_owner = floor(vExtra.z + 0.5);
if ((m_flags & 1) != 0 && m_owner < 7.5) {
  vec3 oc = uOwnerColors[int(m_owner)];
  diffuseColor.rgb = mix(diffuseColor.rgb, oc, uOwnerRoofMix * 0.85);
}
// rain: darker paved surfaces
if ((m_flags & 4) != 0) diffuseColor.rgb *= mix(1.0, 0.72, uWet);
// data overlay "clay mode": desaturate, then tint by the value under this fragment
if (uOverlay > 0.001) {
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 clay = vec3(lum * 0.35 + 0.45);
  float v = texture2D(uOverlayTex, vMWorld.xz / uCitySize).r;
  float wallW = m_style > 0.5 ? 0.45 : 1.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(clay, m_ramp(v), 0.78 * wallW), uOverlay);
}
`;

// replaces #include <emissivemap_fragment>  (normal is available here; lighting has not run yet)
const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);
  // snow on up-facing, snowable faces (view-space normal -> world via transpose(viewMatrix))
  vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  if ((m_flags & 8) != 0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.65, 0.9, nW.y));
  totalEmissiveRadiance += m_win * (0.08 + 0.35 * fres) * uSkyRefl * (1.0 - uNight) * (1.0 - uOverlay);   // fake sky reflection on glass
  totalEmissiveRadiance += m_lit * m_winCol * uNight * uEmiBoost * (1.0 - 0.85 * uOverlay);             // lit windows
  totalEmissiveRadiance += (vExtra.x / 255.0) * diffuseColor.rgb * uNight * uEmiBoost * 1.6;               // lamps, signs
  if ((m_flags & 4) != 0) totalEmissiveRadiance += uWet * fres * uSkyRefl * 0.25;                          // wet sheen
}
`;

export function makeCityMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <color_vertex>', VERT_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'magnate-city-v1';
  return mat;
}

export function setOwnerColors(hexes: string[]): void {
  hexes.slice(0, 8).forEach((h, i) => CityUniforms.uOwnerColors.value[i].set(h)); // Color.set converts sRGB -> linear
}
```

### A.3 `assets/GeoBuilder.ts`: typed-array low-poly builder (worker-side) and BufferGeometry wrapper

```ts
// GeoBuilder — append-only, allocation-light low-poly geometry writer used by every AssetFactory.
// Runs in a Web Worker (no THREE objects needed until toGeometry on the main thread).
// All attributes are 4-byte aligned (Metal/ANGLE friendly): 36 bytes per vertex + indices.
import * as THREE from 'three';

export type RGB = readonly [number, number, number]; // sRGB bytes 0..255
export const enum Facade { NONE = 0, HOUSE = 1, APARTMENT = 2, CURTAIN = 3, SHOP = 4, INDUSTRIAL = 5, OFFICE = 6 }
export type FacadeParams = readonly [style: number, seed: number, floorOrWallDm: number, bayDm: number];

class Grow<T extends Float32Array | Int8Array | Uint8Array | Uint32Array> {
  arr: T; len = 0;
  constructor(private make: (n: number) => T, cap: number) { this.arr = make(cap); }
  reserve(n: number) { if (this.len + n <= this.arr.length) return; const next = this.make(Math.max(this.arr.length * 2, this.len + n)); next.set(this.arr.subarray(0, this.len) as never); this.arr = next; }
  view(): T { return this.arr.subarray(0, this.len) as T; }
}

export interface BuiltArrays {
  position: Float32Array; normal: Int8Array; color: Uint8Array; fuv: Float32Array; facade: Uint8Array; extra: Uint8Array;
  index: Uint16Array | Uint32Array; vertexCount: number; triangleCount: number;
}

export class GeoBuilder {
  private pos = new Grow((n) => new Float32Array(n), 3 * 4096);
  private nrm = new Grow((n) => new Int8Array(n), 4 * 4096);
  private col = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private fuv = new Grow((n) => new Float32Array(n), 2 * 4096);
  private fac = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private ext = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private idx = new Grow((n) => new Uint32Array(n), 6 * 4096);
  private n = 0;
  // placement state (quarter-turn rotation about Y, then translation)
  private tx = 0; private ty = 0; private tz = 0; private c = 1; private s = 0;
  /** instance-tint weight written into color.a (255 = instanceColor fully applies, 0 = never) */
  tint = 255;
  /** 0..7 company owner index, 255 = none (written to extra.z). */
  owner = 255;
  /** set true by a factory while emitting ROOF faces of a company building: up-facing faces then get FLAG_OWNER_ROOF
   *  (tinted to the owner colour at city zoom). Never set it for fields, yards or parking — verified that painting whole
   *  lots reads as noise at overview. */
  ownerRoof = false;
  /** extra flags OR-ed into every vertex (FLAG_VEGETATION | FLAG_PAVED | FLAG_SNOWABLE) */
  flags = 0;

  place(x: number, z: number, quarterTurns = 0, y = 0): this {
    const a = (quarterTurns & 3) * Math.PI / 2;
    this.tx = x; this.ty = y; this.tz = z; this.c = Math.round(Math.cos(a)); this.s = Math.round(Math.sin(a));
    return this;
  }

  private vtx(x: number, y: number, z: number, nx: number, ny: number, nz: number, rgb: RGB, u: number, v: number, fac: FacadeParams | null, em: number): number {
    const { c, s } = this;
    this.pos.reserve(3); this.nrm.reserve(4); this.col.reserve(4); this.fuv.reserve(2); this.fac.reserve(4); this.ext.reserve(4);
    const P = this.pos.arr, N = this.nrm.arr, C = this.col.arr, U = this.fuv.arr, F = this.fac.arr, E = this.ext.arr;
    let o = this.pos.len; P[o] = this.tx + x * c + z * s; P[o + 1] = this.ty + y; P[o + 2] = this.tz - x * s + z * c; this.pos.len += 3;
    o = this.nrm.len; N[o] = Math.round((nx * c + nz * s) * 127); N[o + 1] = Math.round(ny * 127); N[o + 2] = Math.round((-nx * s + nz * c) * 127); N[o + 3] = 0; this.nrm.len += 4;
    o = this.col.len; C[o] = rgb[0]; C[o + 1] = rgb[1]; C[o + 2] = rgb[2]; C[o + 3] = this.tint; this.col.len += 4;
    o = this.fuv.len; U[o] = u; U[o + 1] = v; this.fuv.len += 2;
    o = this.fac.len; F[o] = fac ? fac[0] : 0; F[o + 1] = fac ? fac[1] & 255 : 0; F[o + 2] = fac ? fac[2] : 0; F[o + 3] = fac ? fac[3] : 0; this.fac.len += 4;
    const roof = this.ownerRoof && this.owner !== 255 && ny > 0.9 ? 1 : 0;
    o = this.ext.len; E[o] = em; E[o + 1] = this.flags | roof; E[o + 2] = this.owner; E[o + 3] = 0; this.ext.len += 4;
    return this.n++;
  }

  /** Quad a-b-c-d counter-clockwise seen from the normal side. uv = facade metres per corner. */
  quad(a: number[], b: number[], cc: number[], d: number[], n: RGB | number[], rgb: RGB, fac: FacadeParams | null = null, uv: number[][] | null = null, em = 0): void {
    const u = uv ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    const i0 = this.vtx(a[0], a[1], a[2], n[0], n[1], n[2], rgb, u[0][0], u[0][1], fac, em);
    const i1 = this.vtx(b[0], b[1], b[2], n[0], n[1], n[2], rgb, u[1][0], u[1][1], fac, em);
    const i2 = this.vtx(cc[0], cc[1], cc[2], n[0], n[1], n[2], rgb, u[2][0], u[2][1], fac, em);
    const i3 = this.vtx(d[0], d[1], d[2], n[0], n[1], n[2], rgb, u[3][0], u[3][1], fac, em);
    this.idx.reserve(6); const I = this.idx.arr; const o = this.idx.len;
    I[o] = i0; I[o + 1] = i1; I[o + 2] = i2; I[o + 3] = i0; I[o + 4] = i2; I[o + 5] = i3; this.idx.len += 6;
  }

  /** Axis-aligned box in the local lot frame (+Z = street front). Walls get facade UVs (u along wall, v = height). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, top = true): void {
    const fw = (w: number) => [[0, y0], [w, y0], [w, y1], [0, y1]];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wall, fac, fw(x1 - x0));
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], wall, fac, fw(x1 - x0));
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], wall, fac, fw(z1 - z0));
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], wall, fac, fw(z1 - z0));
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], roof);
  }

  get triangleCount(): number { return this.idx.len / 3; }

  /** Worker side: hand out compact typed arrays (transferable). */
  finish(): BuiltArrays {
    const idx = this.idx.view();
    const index = this.n <= 65535 ? Uint16Array.from(idx) : idx.slice();
    return {
      position: this.pos.view().slice(), normal: this.nrm.view().slice(), color: this.col.view().slice(),
      fuv: this.fuv.view().slice(), facade: this.fac.view().slice(), extra: this.ext.view().slice(),
      index, vertexCount: this.n, triangleCount: idx.length / 3,
    };
  }
}

/** Main thread: wrap worker arrays into a BufferGeometry for CityMaterial. */
export function toBufferGeometry(a: BuiltArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 4, true));      // xyz used; w free
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 4, true));        // rgb sRGB, a = tint weight
  g.setAttribute('fuv', new THREE.BufferAttribute(a.fuv, 2));
  g.setAttribute('facade', new THREE.BufferAttribute(a.facade, 4, false));
  g.setAttribute('extra', new THREE.BufferAttribute(a.extra, 4, false));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
```

### A.4 `assets/AssetFactory.ts`: the contract every asset family implements

```ts
// Contract every asset family implements. Pure + deterministic: same (seed, lot, params) => identical arrays.
import type { GeoBuilder } from './GeoBuilder';
import type { PropInstance } from './Instancing';

export type Facing = 'N' | 'E' | 'S' | 'W';
export type Stage = 'foundation' | 'structure' | 'finishing' | 'complete' | 'closed';
export interface LotFrame { cx: number; cz: number; widthM: number; depthM: number; facing: Facing; quarterTurns: 0 | 1 | 2 | 3; }
export interface AssetParams { seed: number; variant: number; level: 1 | 2 | 3; stage: Stage; progress: number; owner: number /* 0..7 | 255 */; utilization: number; lod: 0 | 1; season: 0 | 1 | 2 | 3; productIds?: string[]; }
export interface AnimatedPart { kind: 'pumpjackBeam' | 'craneJib' | 'sheaveWheel' | 'gantryTrolley' | 'windowCleaner' | 'fan' | 'flag'; x: number; y: number; z: number; rotY: number; phase: number; owner: number; }
export interface Emitter { kind: 'smoke' | 'steam' | 'dust' | 'flare'; x: number; y: number; z: number; rate: number; }
export interface SignQuad { companyId: string; corners: [number, number, number][]; }
export interface AssetOutput {
  pickBox: [number, number, number, number, number, number];   // world AABB for Picking
  props: Record<string, PropInstance[]>;                       // family id -> instances (trees, lamps, parkedCars, containers...)
  animated: AnimatedPart[]; emitters: Emitter[]; signs: SignQuad[];
  lightPools: { x: number; z: number; radius: number }[];
}
export interface AssetFactory {
  readonly id: string;                                          // building type id or ambient archetype id
  readonly footprints: ReadonlyArray<readonly [number, number]>;
  readonly triBudget: { lod0: number; lod1: number };
  build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput;
}
```

### A.5 `assets/Instancing.ts`: partitioned InstancedMesh families and LOD bands

```ts
// Repeated props (trees, lamps, parked cars, pedestrians) = InstancedMesh partitioned into 400 m cells so that
// frustum culling works (InstancedMesh culls as one bounding sphere). LOD = swap families by camera distance.
import * as THREE from 'three';
export interface PropInstance { x: number; z: number; rotY: number; scale: number; color?: THREE.ColorRepresentation; }
export const CELL_M = 400;

export function buildPartitionedFamily(geometry: THREE.BufferGeometry, material: THREE.Material, items: PropInstance[], castShadow: boolean): THREE.Group {
  const cells = new Map<string, PropInstance[]>();
  for (const it of items) { const k = `${Math.floor(it.x / CELL_M)},${Math.floor(it.z / CELL_M)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(it); }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const key of [...cells.keys()].sort()) {                      // deterministic order
    const list = cells.get(key)!;
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotY); p.set(it.x, 0, it.z); s.setScalar(it.scale);
      im.setMatrixAt(i, m.compose(p, q, s));
      if (it.color !== undefined) im.setColorAt(i, c.set(it.color));
    });
    im.castShadow = castShadow; im.receiveShadow = true;
    im.computeBoundingSphere();                                       // required for culling since r151
    group.add(im);
  }
  return group;
}

/** Distance bands (metres, camera-to-target distance) validated on UHD 630. */
export const LOD_BANDS = { treeLod1: 900, vehicles: 1100, parkedCars: 700, lamps: 800, lightPools: 900, pedestrians: 420, smoke: 2600 } as const;
```

### A.6 `core/PostPipeline.ts`: tiered postprocessing composer with a depth pre-pass

```ts
// PostPipeline — pmndrs/postprocessing 6.39.5 composer, tiered. WebGLRenderer only.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Pass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, SMAAPreset, FXAAEffect, OutlineEffect, TiltShiftEffect, KernelSize,
} from 'postprocessing';

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export const LAYER_OCCLUDER = 1;   // chunk meshes (big static opaque occluders) are also on this layer
export const LAYER_SELECTION = 2;  // selection / hover proxies, never rendered by the main camera

/** Depth-only pre-pass over the big static occluders; the following RenderPass must not clear. */
export class DepthPrepass extends Pass {
  private readonly depthCam = new THREE.PerspectiveCamera();
  private readonly mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  constructor(private readonly occScene: THREE.Scene, private readonly mainCam: THREE.PerspectiveCamera) {
    super('DepthPrepass');
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null): void {
    this.depthCam.copy(this.mainCam, false);
    this.depthCam.layers.set(LAYER_OCCLUDER);
    const prevOverride = this.occScene.overrideMaterial, prevBg = this.occScene.background;
    this.occScene.overrideMaterial = this.mat; this.occScene.background = null;
    renderer.setRenderTarget(inputBuffer); renderer.clear(true, true, false);
    renderer.render(this.occScene, this.depthCam);
    this.occScene.overrideMaterial = prevOverride; this.occScene.background = prevBg;
  }
}

export interface PostHandles { composer: EffectComposer; bloom: BloomEffect; outline: OutlineEffect; tilt: TiltShiftEffect; }

export async function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, tier: Tier): Promise<PostHandles> {
  renderer.toneMapping = THREE.NoToneMapping;               // tone mapping happens in ToneMappingEffect
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new DepthPrepass(scene, camera));
  const render = new RenderPass(scene, camera);
  render.clearPass.enabled = false;                          // keep the pre-pass depth
  composer.addPass(render);

  if (tier === 'high' || tier === 'ultra') {
    const { N8AOPostPass } = await import('n8ao');              // lazy: keeps n8ao out of the LOW/MED bundle
    const ao = new N8AOPostPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
    ao.configuration.aoRadius = 6; ao.configuration.distanceFalloff = 1; ao.configuration.intensity = 2.2;
    ao.configuration.halfRes = tier === 'high'; ao.configuration.gammaCorrection = false;   // tone mapping comes later
    ao.setQualityMode(tier === 'high' ? 'Low' : 'Medium');       // measured on Radeon Pro 5500M: HIGH 6.5-7.1 ms total
    composer.addPass(ao);
  }
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72, levels: 6 });
  const outline = new OutlineEffect(scene, camera, { edgeStrength: 3, visibleEdgeColor: 0xffffff, hiddenEdgeColor: 0x3a4a58, xRay: true, blur: false, kernelSize: KernelSize.VERY_SMALL, resolutionScale: 0.5 });
  outline.selection.layer = LAYER_SELECTION;
  const tilt = new TiltShiftEffect({ focusArea: 0.45, feather: 0.35, offset: 0.05 });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });   // library default is AGX — set explicitly
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  composer.addPass(new EffectPass(camera, bloom, outline, tilt, toneMapping, vignette));
  composer.addPass(new EffectPass(camera, tier === 'low' ? new FXAAEffect() : new SMAAEffect({ preset: tier === 'ultra' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));
  tilt.blendMode.opacity.value = 0;                          // photo mode only
  bloom.blendMode.opacity.value = tier === 'low' ? 0 : 1;    // LOW: driven by night factor (see DayNight)
  return { composer, bloom, outline, tilt };
}
```

### A.7 `env/ShadowFit.ts`: fitted, texel-snapped sun shadow

```ts
// One directional shadow map fitted to the visible ground footprint; texel-snapped in a light space anchored
// at the city centre so panning does not shimmer. Call on camera change / sun change only.
import * as THREE from 'three';
const _ray = new THREE.Raycaster(), _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _v = new THREE.Vector3(), _look = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const NDC: ReadonlyArray<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]];

export function fitSunShadow(sun: THREE.DirectionalLight, camera: THREE.PerspectiveCamera, dirToSun: THREE.Vector3, anchor: THREE.Vector3, maxCasterHeight = 160, maxDist = 6000): number {
  const pts: THREE.Vector3[] = [];
  for (const [x, y] of NDC) {
    _ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = _ray.ray.intersectPlane(_ground, new THREE.Vector3());
    pts.push(hit && hit.distanceTo(camera.position) < maxDist ? hit : _ray.ray.at(Math.min(maxDist, camera.far * 0.5), new THREE.Vector3()).setY(0));
  }
  sun.position.copy(anchor).addScaledVector(dirToSun, 3000);
  sun.target.position.copy(anchor);
  sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  _look.lookAt(sun.position, anchor, _up).setPosition(sun.position);
  _inv.copy(_look).invert();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) for (const h of [0, maxCasterHeight]) {
    _v.set(p.x, h, p.z).applyMatrix4(_inv);
    minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y); minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
  }
  const texel = Math.max(maxX - minX, maxY - minY) / sun.shadow.mapSize.x;
  const snap = (v: number) => Math.floor(v / texel) * texel;
  const cam = sun.shadow.camera;
  cam.left = snap(minX) - 2 * texel; cam.right = snap(maxX) + 2 * texel; cam.bottom = snap(minY) - 2 * texel; cam.top = snap(maxY) + 2 * texel;
  cam.near = Math.max(1, -maxZ - 400); cam.far = -minZ + 400;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  return texel; // metres per shadow texel (debug HUD)
}

export function configureSun(sun: THREE.DirectionalLight, mapSize: 1024 | 2048 | 4096): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 2.5;     // PCFShadowMap (5-tap Vogel disk since r182) softness
  sun.shadow.intensity = 0.85; // keep 15% light in shadow (stylized fill)
  sun.shadow.autoUpdate = false;
}
```

### A.8 `interaction/CameraRig.ts`: camera-controls configured to the UX bindings

```ts
// RTS camera on camera-controls 3.1.2, with UX bindings (ux-playability.md section 6.5):
// left = select/place (not a camera action), right-drag = pan on the ground, middle-drag = rotate,
// wheel = dolly to cursor, Q/E = 45-degree steps, WASD/arrows = pan, tilt 35-65 degrees elevation.
import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({ THREE: { Vector2: THREE.Vector2, Vector3: THREE.Vector3, Vector4: THREE.Vector4, Quaternion: THREE.Quaternion, Matrix4: THREE.Matrix4, Spherical: THREE.Spherical, Box3: THREE.Box3, Sphere: THREE.Sphere, Raycaster: THREE.Raycaster } });
const D2R = THREE.MathUtils.degToRad;
export const POLAR_MIN = D2R(25);   // 65 deg elevation (near top-down, city band)
export const POLAR_MAX = D2R(55);   // 35 deg elevation (street band)

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 5, 12000);
  readonly controls: CameraControls;
  private autoTilt = true;
  private readonly keys = new Set<string>();
  constructor(canvas: HTMLCanvasElement, cityWidthM: number, cityDepthM: number) {
    const c = new CameraControls(this.camera, canvas);
    c.minDistance = 60; c.maxDistance = Math.max(1400, 1.15 * Math.hypot(cityWidthM, cityDepthM));   // Metropolis @24 m plots: ~3,120 m
    c.minPolarAngle = POLAR_MIN; c.maxPolarAngle = POLAR_MAX;
    c.dollyToCursor = true; c.smoothTime = 0.25; c.draggingSmoothTime = 0.08; c.dollySpeed = 0.6; c.truckSpeed = 1.0;
    c.mouseButtons.left = CameraControls.ACTION.NONE;              // clicks go to Picking / PlacementGhost
    c.mouseButtons.right = CameraControls.ACTION.SCREEN_PAN;       // camera-controls 3.x: SCREEN_PAN = truck + forward on the ground plane
    c.mouseButtons.middle = CameraControls.ACTION.ROTATE;
    c.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    c.touches.one = CameraControls.ACTION.TOUCH_SCREEN_PAN;
    c.touches.two = CameraControls.ACTION.TOUCH_DOLLY_ROTATE;
    const mx = 0.1 * cityWidthM, mz = 0.1 * cityDepthM;           // pan limit = city bounds + 10% (target stays inside)
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-cityWidthM / 2 - mx, 0, -cityDepthM / 2 - mz), new THREE.Vector3(cityWidthM / 2 + mx, 0, cityDepthM / 2 + mz)));
    c.boundaryFriction = 0.15;
    this.controls = c;
    c.addEventListener('controlstart', () => { this.autoTilt = false; });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }
  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down && (e.code === 'KeyQ' || e.code === 'KeyE')) { void this.rotateBy45(e.code === 'KeyQ' ? 1 : -1); return; }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
  }
  /** Call every frame. Returns true when the camera moved (re-fit shadows, update LOD, labels, audio frame). */
  update(dt: number): boolean {
    const d = this.controls.distance;
    const k = this.keys, speed = 0.9 * d * dt;                     // keyboard pan ~0.9 camera-distances per second
    const fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (fx || fz) { void this.controls.truck(fx * speed, 0, false); void this.controls.forward(fz * speed, false); }
    if (this.autoTilt) {                                           // tilt follows zoom: street 35 deg elev -> city 60 deg elev
      const t = THREE.MathUtils.clamp((d - 80) / (2600 - 80), 0, 1);
      void this.controls.rotatePolarTo(THREE.MathUtils.lerp(POLAR_MAX, D2R(30), t), true);
    }
    const moved = this.controls.update(dt);
    if (moved) { this.camera.near = THREE.MathUtils.clamp(d * 0.2, 1, 200); this.camera.far = d * 5 + 4000; this.camera.updateProjectionMatrix(); }
    return moved;
  }
  /** Double-click focus (UX: 0.6 s ease): smoothTime ~0.25 s reaches the goal in ~0.6 s. */
  focus(box: THREE.Box3): Promise<void[]> { this.autoTilt = true; return this.controls.fitToBox(box, true, { paddingTop: 20, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 }); }
  rotateBy45(dir: 1 | -1): Promise<void> { return this.controls.rotate(dir * Math.PI / 4, 0, true); }
  /** 0 = street band (<= 300 m) ... 1 = city band (>= 1,800 m); used by LOD, labels and the audio frame. */
  zoom01(): number { return THREE.MathUtils.clamp((Math.log(this.controls.distance) - Math.log(300)) / (Math.log(1800) - Math.log(300)), 0, 1); }
}
```

### A.9 `interaction/Picking.ts`: grid-DDA picking

```ts
// CPU picking: Amanatides-Woo DDA over the plot grid + exact ray/AABB test per building. No GPU read-back.
// Conventions follow web/src/scene/units.ts: city centred on the origin, plot (0,0) = NW corner, +X east, +Z south.
import * as THREE from 'three';
export const PLOT_M = 24;

export interface PickIndex {
  w: number; h: number;                 // grid size in plots
  cellBuilding: Int32Array;            // per plot (pz * w + px): building slot or -1 (roads, ambient: -1)
  boxes: Float32Array;                 // per building slot: minX,minY,minZ,maxX,maxY,maxZ in WORLD metres
  ids: number[];                       // building slot -> BuildingVisualDto.id
  maxHeight: number;                   // tallest building (m), bounds the search volume
}
export type PickResult =
  | { kind: 'building'; id: number; point: THREE.Vector3 }
  | { kind: 'plot'; px: number; pz: number; point: THREE.Vector3 }
  | null;

const _inv = new THREE.Vector3();
function rayBox(o: THREE.Vector3, invD: THREE.Vector3, b: ArrayLike<number>, i: number): number {
  let t0 = -Infinity, t1 = Infinity;
  const oc = [o.x, o.y, o.z], ic = [invD.x, invD.y, invD.z];
  for (let k = 0; k < 3; k++) {
    let a = (b[i * 6 + k] - oc[k]) * ic[k], c = (b[i * 6 + 3 + k] - oc[k]) * ic[k];
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a; if (c < t1) t1 = c;
  }
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}

export function pick(ray: THREE.Ray, idx: PickIndex): PickResult {
  const d = ray.direction, o = ray.origin;
  const invD = _inv.set(1 / d.x, 1 / d.y, 1 / d.z);
  const halfW = (idx.w * PLOT_M) / 2, halfH = (idx.h * PLOT_M) / 2;
  const tEnter = rayBox(o, invD, [-halfW, 0, -halfH, halfW, idx.maxHeight, halfH], 0);   // city volume
  if (!Number.isFinite(tEnter)) return null;
  const tGround = d.y < 0 ? -o.y / d.y : Infinity;
  // DDA in grid space (gx = (x + halfW) / PLOT_M)
  const gx0 = (o.x + d.x * (tEnter + 1e-3) + halfW) / PLOT_M, gz0 = (o.z + d.z * (tEnter + 1e-3) + halfH) / PLOT_M;
  let px = Math.min(idx.w - 1, Math.max(0, Math.floor(gx0))), pz = Math.min(idx.h - 1, Math.max(0, Math.floor(gz0)));
  const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
  const tDX = d.x !== 0 ? Math.abs(PLOT_M / d.x) : Infinity, tDZ = d.z !== 0 ? Math.abs(PLOT_M / d.z) : Infinity;
  const wx = (p: number) => p * PLOT_M - halfW, wz = (p: number) => p * PLOT_M - halfH;   // plot edge -> world
  let tMaxX = d.x !== 0 ? (wx(stepX > 0 ? px + 1 : px) - o.x) / d.x : Infinity;
  let tMaxZ = d.z !== 0 ? (wz(stepZ > 0 ? pz + 1 : pz) - o.z) / d.z : Infinity;
  let best = Infinity, bestSlot = -1, last = -2;
  for (let guard = 0; guard < 4 * (idx.w + idx.h); guard++) {
    const slot = idx.cellBuilding[pz * idx.w + px];
    if (slot >= 0 && slot !== last) { const t = rayBox(o, invD, idx.boxes, slot); if (t < best) { best = t; bestSlot = slot; } last = slot; }
    const tCellExit = Math.min(tMaxX, tMaxZ);
    if (best <= tCellExit || tCellExit > tGround) break;             // nearest hit found, or the ray reached the ground
    if (tMaxX < tMaxZ) { px += stepX; tMaxX += tDX; } else { pz += stepZ; tMaxZ += tDZ; }
    if (px < 0 || pz < 0 || px >= idx.w || pz >= idx.h) break;
  }
  if (bestSlot >= 0 && best <= tGround) return { kind: 'building', id: idx.ids[bestSlot], point: ray.at(best, new THREE.Vector3()) };
  if (!Number.isFinite(tGround)) return null;
  const g = ray.at(tGround, new THREE.Vector3());
  const gpx = Math.floor((g.x + halfW) / PLOT_M), gpz = Math.floor((g.z + halfH) / PLOT_M);
  return gpx >= 0 && gpz >= 0 && gpx < idx.w && gpz < idx.h ? { kind: 'plot', px: gpx, pz: gpz, point: g } : null;
}
```

### A.10 `materials/SignAtlas.ts`: CanvasTexture wordmarks with emblems

```ts
// Company wordmarks + ad billboards drawn once into a CanvasTexture atlas (sRGB, mipmapped, padded slots).
import * as THREE from 'three';

export interface CompanyStyle { id: string; name: string; color: string; emblem: 'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'hexagon' | 'cross' | 'ring'; }
const W = 2048, H = 2048, SW = 512, SH = 128, PAD = 8, COLS = W / SW;   // 4 x 16 = 64 name slots

export class SignAtlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly slots = new Map<string, number>();
  constructor(renderer: THREE.WebGLRenderer) {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.texture.generateMipmaps = true; this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  /** Returns UV rect [u0, v0, u1, v1] for the company's wordmark slot (light-on-colour variant). */
  company(c: CompanyStyle): [number, number, number, number] {
    let slot = this.slots.get(c.id);
    if (slot === undefined) { slot = this.slots.size; this.slots.set(c.id, slot); }
    const x = (slot % COLS) * SW, y = Math.floor(slot / COLS) * SH, g = this.ctx;
    g.fillStyle = c.color; g.fillRect(x + PAD, y + PAD, SW - 2 * PAD, SH - 2 * PAD);
    g.fillStyle = '#FFFFFF'; this.emblem(c.emblem, x + PAD + 56, y + SH / 2, 34);
    g.font = '700 64px "Inter Tight", "Inter", system-ui, sans-serif'; g.textBaseline = 'middle';
    const text = c.name.toUpperCase(), maxW = SW - 2 * PAD - 120, m = g.measureText(text).width;
    g.save(); g.translate(x + PAD + 104, y + SH / 2 + 2); if (m > maxW) g.scale(maxW / m, 1); g.fillText(text, 0, 0); g.restore();
    this.texture.needsUpdate = true;
    return [x / W, 1 - (y + SH) / H, (x + SW) / W, 1 - y / H];      // flipY = true (CanvasTexture default)
  }
  private emblem(kind: CompanyStyle['emblem'], cx: number, cy: number, r: number): void {
    const g = this.ctx; g.beginPath();
    const poly = (n: number, rot: number, rr = r) => { for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
    if (kind === 'circle' || kind === 'ring') g.arc(cx, cy, r, 0, Math.PI * 2);
    else if (kind === 'triangle') poly(3, -Math.PI / 2);
    else if (kind === 'square') poly(4, Math.PI / 4, r * 1.2);
    else if (kind === 'diamond') poly(4, 0);
    else if (kind === 'hexagon') poly(6, 0);
    else if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r; if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); }
    else { g.rect(cx - r, cy - r * 0.3, 2 * r, r * 0.6); g.rect(cx - r * 0.3, cy - r, r * 0.6, 2 * r); }
    if (kind === 'ring') { g.lineWidth = r * 0.35; g.strokeStyle = '#FFFFFF'; g.stroke(); } else g.fill();
  }
}

/** Sign material: unlit colour from the atlas by day, glowing at night (emissiveIntensity driven by DayNight). */
export function makeSignMaterial(atlas: SignAtlas): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: atlas.texture, emissive: new THREE.Color(1, 1, 1), emissiveMap: atlas.texture, emissiveIntensity: 0 });
}
```

### A.11 `interaction/Overlays.ts`: per-plot data texture for clay-mode overlays

```ts
// Data overlays (land value, demand, market share...) — one R8 texel per plot, sampled by CityMaterial in "clay mode".
import * as THREE from 'three';
import { CityUniforms } from './CityMaterial';

export class OverlayLayer {
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  constructor(readonly w: number, readonly h: number, plotM = 20) {
    this.data = new Uint8Array(w * h);
    this.texture = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter; this.texture.minFilter = THREE.LinearFilter;   // smooth heat; use Nearest for per-plot categorical maps
    this.texture.colorSpace = THREE.NoColorSpace;
    CityUniforms.uCitySize.value.set(w * plotM, h * plotM);
  }
  /** values: one float per plot, normalised with [min, max] to 0..255. */
  set(values: ArrayLike<number>, min: number, max: number): void {
    const k = max > min ? 255 / (max - min) : 0;
    for (let i = 0; i < this.data.length; i++) this.data[i] = Math.max(0, Math.min(255, Math.round((values[i] - min) * k)));
    this.texture.needsUpdate = true;
    CityUniforms.uOverlayTex.value = this.texture;
  }
}
```

### A.12 `core/Quality.ts`: tier guess and frame-time governor

```ts
// Tier guess from the unmasked renderer string + runtime frame-time governor (rAF EMA; GPU timer queries are
// unreliable on ANGLE-Metal/Intel when instance buffers are updated in the frame).
export type Tier = 'low' | 'medium' | 'high' | 'ultra';   // 'ultra' is user-selected only
export function guessTier(gl: WebGL2RenderingContext): Tier {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/SwiftShader|llvmpipe|Software/i.test(r)) return 'low';
  if (/Intel.*(UHD|HD Graphics|Iris\(TM\) Plus|Iris Pro)/i.test(r)) return 'low';
  if (/Intel.*(Iris.*Xe|Arc)|Radeon\(TM\) Graphics|Radeon Vega|Apple M1(?! (Pro|Max|Ultra))|Mali|Adreno/i.test(r)) return 'medium';
  return 'high';                                                      // discrete NVIDIA/AMD, Apple M-Pro/Max, etc.
}

export class FrameGovernor {
  private ema = 16.7; private overSince = -1; private underSince = -1; private cooldownUntil = 0;
  scale = 1.0;                                                        // render resolution scale (DPR multiplier)
  constructor(private readonly apply: (scale: number, step: number) => void, private readonly minScale = 0.7) {}
  /** call from setAnimationLoop with the frame delta in ms */
  tick(nowMs: number, frameMs: number): void {
    this.ema += (Math.min(frameMs, 100) - this.ema) * 0.05;
    if (nowMs < this.cooldownUntil) return;
    if (this.ema > 18) { if (this.overSince < 0) this.overSince = nowMs; this.underSince = -1; }
    else if (this.ema < 12) { if (this.underSince < 0) this.underSince = nowMs; this.overSince = -1; }
    else { this.overSince = this.underSince = -1; }
    if (this.overSince >= 0 && nowMs - this.overSince > 3000 && this.scale > this.minScale) { this.scale = Math.max(this.minScale, this.scale - 0.1); this.apply(this.scale, -1); this.cooldownUntil = nowMs + 10000; this.overSince = -1; }
    if (this.underSince >= 0 && nowMs - this.underSince > 5000 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.1); this.apply(this.scale, +1); this.cooldownUntil = nowMs + 10000; this.underSince = -1; }
  }
}
```

### A.13 `dynamic/traffic/TrafficIdm.ts`: Intelligent Driver Model

```ts
// Intelligent Driver Model (Treiber 2000) for ambient + company vehicles on the road graph.
export interface IdmParams { v0: number; T: number; s0: number; a: number; b: number; delta: number; length: number; }
export const CAR: IdmParams = { v0: 13.9, T: 1.5, s0: 2.0, a: 1.5, b: 2.0, delta: 4, length: 4.5 };      // 50 km/h local
export const TRUCK: IdmParams = { v0: 13.9, T: 1.8, s0: 2.5, a: 1.0, b: 2.0, delta: 4, length: 8.6 };
export const BUS: IdmParams = { v0: 12.5, T: 1.8, s0: 2.5, a: 1.0, b: 2.0, delta: 4, length: 12.4 };
/** acceleration for speed v (m/s), gap s to the leader's rear bumper (m), closing speed dv = v - vLeader. */
export function idmAccel(p: IdmParams, v: number, s: number, dv: number, vLimit = p.v0): number {
  const v0 = Math.min(p.v0, vLimit);
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  return p.a * (1 - Math.pow(v / v0, p.delta) - (sStar / Math.max(s, 0.1)) ** 2);
}
/** A red light / stop line is modelled as a standing leader (v = 0) at the stop line. */
export function stepVehicle(p: IdmParams, v: number, gap: number, vLeader: number, dt: number): { v: number; ds: number } {
  const acc = Math.max(-9, idmAccel(p, v, gap, v - vLeader));
  const nv = Math.max(0, v + acc * dt);
  return { v: nv, ds: Math.max(0, (v + nv) * 0.5 * dt) };
}
```

### A.14 `types/n8ao.d.ts`: type shim (n8ao 2.0.1 ships no declarations)

```ts
// n8ao 2.0.1 ships no type declarations — minimal shim for the parts Magnate uses (HIGH tier only).
declare module 'n8ao' {
  import type { Camera, Scene, Color } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; color: Color; halfRes: boolean;
      depthAwareUpsampling: boolean; gammaCorrection: boolean; screenSpaceRadius: boolean; aoSamples: number;
      denoiseSamples: number; denoiseRadius: number; transparencyAware: boolean; accumulate: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
  }
}
```

## Appendix B. Reproducing the measurements

The scratch prototype is **temporary**; it lives in the session scratchpad and is not in the project tree:
`/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/art-rendering/`

| Path | Purpose |
|---|---|
| `bench/index.html` | Import map: three, addons, postprocessing, n8ao |
| `bench/src/layout.js` | Benchmark stand-in for the engine layout (80×80, roads every 6th plot, zones, lots, 39 company buildings) |
| `bench/src/geo.js` | GeoBuilder (JS version; `?fmt=aligned\|packed\|f32` vertex formats) |
| `bench/src/assets.js` | Archetypes: house, row house, apartment, tower, shop, park, civic, industrial, field, port, all 18 company types, construction |
| `bench/src/world.js` | Chunking, roads, markings, lamps, trees (LOD0 and LOD1), cars, light pools |
| `bench/src/materials.js`, `bench/final/CityMaterial.js` | Prototype material and the compiled final material (`?final=0\|1`) |
| `bench/src/env.js` | Sky, time-of-day keys, sun path, water, fitted shadows |
| `bench/src/main.js` | Scene assembly, traffic, smoke, views, the post pipelines (`post=1` pmndrs, `post=2` three add-ons), the depth pre-pass, and the `window.bench()` harness |
| `bench/run.mjs` | puppeteer-core driver: `shot` (screenshots) and `bench` |
| `bench/matrix.sh` | Runs a list of configs × views and appends JSON lines |
| `bench/micro*.html` | WebGL vs WebGPU instanced micro-benchmark |
| `tscheck/` | The Appendix A sources and `tsconfig.json` (`tsc -p tscheck/tsconfig.json`) |
| `picktest/` | Picking vs brute-force test |
| `shots/` | Rendered screenshots (§1.6) |
| `results_*.jsonl` | Raw benchmark results |

**Setup:**
```bash
npm install three@0.186.1 @types/three@0.186.0 postprocessing@6.39.5 n8ao@2.0.1 camera-controls@3.1.2 puppeteer-core typescript
python3 -m http.server 8765 --bind 127.0.0.1          # serve the prototype directory
node bench/run.mjs bench "view=mid&part=1&lod=1&prepass=1&skyLast=1&shadows=1&treeShadow=0&post=1&bloom=0&aa=fxaa"
./bench/matrix.sh out.jsonl overview,mid,close "<query1>" "<query2>"
```

**Headless Chrome flags:** `--enable-gpu --ignore-gpu-blocklist --use-angle=metal --disable-gpu-vsync --disable-frame-rate-limit`, viewport 1920×1080 at `deviceScaleFactor` 1. `powerPreference` is `default` for the UHD 630 and `high-performance` for the Radeon.

**Query parameters:**

| Parameter | Values |
|---|---|
| `view` | `overview`, `mid`, `close`, `street`, `industry`, `port`, `farm` |
| `hour` | 0–24 |
| `mat` | `lambert`, `standard` |
| `shadows` | 0/1 |
| `shadowSize` | 1024, 2048, 4096 |
| `treeShadow` | 0/1 |
| `shadowEvery` | N (re-render the shadow map every Nth frame) |
| `post` | 0 (direct), 1 (postprocessing), 2 (three add-ons) |
| `aa` | `none`, `native`, `fxaa`, `smaa`, `msaa` |
| `bloom` | 0/1 |
| `ao` | `none`, `n8ao-perf`, `n8ao-low`, `n8ao-med-full` |
| `tone` | `neutral`, `agx`, `aces` |
| `lod`, `part`, `prepass`, `skyLast` | 0/1 each |
| `dpr` | render scale |
| `traffic` | number of moving vehicles |
| `trees`, `lamps`, `parked`, `pools`, `smoke`, `outskirts`, `windows`, `sky`, `world` | 0/1 each |
| `anim` | 0/1 (per-frame instance uploads) |
| `overlay`, `snow`, `wet` | 0–1 each |
| `tilt` | 0/1 |
| `final` | 0/1 |
| `fmt` | `aligned`, `packed`, `f32` |
| `power` | `default`, `high-performance` |

**Harness core** (drained throughput; use this, not rAF deltas and not timer queries):
```js
const px = new Uint8Array(4); const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
await renderer.compileAsync(scene, camera);
for (let i = 0; i < 20; i++) renderFrame(1 / 60); sync();                       // warm-up, then drain
const thr = [];
for (let r = 0; r < 5; r++) { sync(); const t = performance.now(); for (let i = 0; i < 40; i++) renderFrame(1 / 60); sync(); thr.push((performance.now() - t) / 40); }
// report median(thr) and min(thr); renderer.info.render.{calls,triangles} after renderer.info.reset() per frame (autoReset=false)
```

**Caveats.**
- Load average was about 8 throughout (Spotlight indexing and parallel agent builds). Re-run on an idle machine to get cleaner absolute numbers; relative conclusions held across repeated runs.
- Headless rAF is not vsync-paced.
- `EXT_disjoint_timer_query_webgl2` fails whenever instance buffers are uploaded (§1.7).
