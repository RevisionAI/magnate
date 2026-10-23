# W4 · assets-B — status

Workstream: **W4 asset families B + shared asset toolkit** (Wave 1). Branch `w4-assets-b`.
Status: **done**. All gates are green, and the gallery screenshots were reviewed and iterated (see §4).

What W4 delivers:
- Procedural, deterministic low-poly factories for every production, extraction and logistics building type in content.
- Construction sites that work for any company building type, plus level-upgrade overlays.
- Animated-part and prop-family specs, emitters, signs and light pools.
- The shared toolkit that W3 builds on.
- The asset gallery dev page (`?dev=assets`).

---

## 1. File map

| File | What it is |
|---|---|
| `web/src/scene/assets/GeoBuilder.ts` | Toolkit. The reference builder plus additive extensions: `setLocal`/`clearLocal`, `toWorld`/`dirToWorld`/`worldYaw`, `vertexCount`, `bounds()`, `saveState`/`restoreState`, `boxFaces` with `FACE_*` bits, `tri()`, and `ownerRoofMinNy`. |
| `web/src/scene/assets/shapes.ts` | Toolkit. The reference primitives plus `quadOut`/`triOut` (winding fixed from an outward hint), `axisFrame`, `beam`, `cylinderAlong`, `prism`, `mound`, `disc`, `strip`, `latticeTower` (`LATTICE_*`), `trussBeam`, `mulberry32` and `fnv1a`. |
| `web/src/scene/assets/palette.ts` | **New.** Re-exports `theme/tokens.ts` as sRGB byte triples: `WORLD_RGB`, `OWNER_RGB`, `NEUTRAL_RGB`, `STATUS_RGB`, `ownerRgb`/`ownerHex`. Adds per-asset bible colours (`ASSET_HEX`/`ASSET_RGB`), `CONTAINER_*` and `vehicleBodyHex`. Helpers: `hexRgb`, `rgbHex`, `shade`, `mixRgb`, `srgbToLinear`, `linearToSrgb`, `tintHex`. |
| `web/src/scene/assets/AssetFactory.ts` | The contract, with optional additions (§2.2). Pure helpers: `STAGE_RANGES`, `stageForProgress`, `progressInStage`, `monthOf`, `seasonOfMonth`, `lotFrame`. |
| `web/src/scene/assets/Instancing.ts` | The reference code plus `PropInstance.y` and the `PropFamily` contract. |
| `web/src/scene/assets/registry.ts` | `allFactories`, `factoryFor`, `familyOf`, `allPropFamilies`, `propFamilyFor`. It picks up W3's optional `PROPS_A` export automatically. |
| `web/src/scene/assets/familiesB.ts` | `FAMILIES_B` (10 types plus `construction`) and the renderer-facing re-exports (§2.3). |
| `families/common-b/kit.ts` | `Kit`: per-lot build context. It handles placement, mirrored variants, the seeded random stream, and output collection in world coordinates. It also produces a pick box clamped to the lot and restores builder state. |
| `families/common-b/details.ts` | Shared details: owner bands, dock doors, roller doors, the facade helpers, chimney, silo, tank, bullet tank, pipe rack, conveyor, see-through fence, yard lamp, flood mast, flagpole, parking, aprons, weeds, HVAC, roof/wall wordmark boards, guardhouse, seasonal `tree`/`treeTint`. |
| `families/common-b/parts.ts` | `PART_SPECS`: geometry in pivot space plus motion for 10 animated part kinds. `partPose(part, t)` is a pure pose function. |
| `families/common-b/props.ts` | `PROPS_B`: 21 instanced prop families (containers, 4 semi trucks, trailer, parked car, tractor, haul truck, dump truck, straddle carrier, reach stacker, forklift, pallet, coil, feeder ship, 2 coffee shrubs, shade tree, mobile crane, excavator body). |
| `families/common-b/products.ts` | Maps products to visual families: the factory family by first product (§4.2.4), the trailer type, the emission per family, and the crop per product. |
| `families/common-b/crops.ts` | Crop calendar by month (§3.14, §4.2.9) and the row-crop field writer. |
| `families/industrial/factory.ts` | `factory_small` (3×3) and `factory_large` (5×5), levels 1–3. |
| `families/extraction/farm.ts` | `small_farm` (3×3, levels 1–3), `large_farm` (5×5), and the farm construction override. |
| `families/extraction/plantation.ts` | `small_plantation` (coffee terraces, or a hop yard with an oast house). |
| `families/extraction/mine.ts` | `iron_mine`: headframe, sheave wheels, winding house, conveyor, crusher, ore stockpile, open pit, haul trucks. |
| `families/extraction/oilWell.ts` | `oil_well` (2×2, levels 1–3): pumpjacks, tank battery and berm, separator, flare, meter house, drilling rig while under construction. |
| `families/logistics/warehouse.ts` | `warehouse_small` (2×2) and `warehouse_large` (4×4, with the giant roof logo). |
| `families/logistics/seaport.ts` | `seaport` (5×3, facing the water): quay, 2 ship-to-shore cranes, container yard, terminal, gatehouse, flood masts, feeder ship. |
| `families/construction/site.ts` | Generic construction sites, `TYPE_SITES`, `buildConstructionSite`, `buildUpgradeSite`/`LEVEL_EXTENSIONS`, the steel hall frame, the concrete frame, scaffold and tower crane. |
| `web/src/scene/materials/SignAtlas.ts` | The reference atlas plus slot styles (`uvFor`, inverted, emblem, closed, text label), font loading, slot recycling and `buildSignGeometry`. |
| `web/src/dev/AssetGallery.tsx` | The art review page (§3). |
| `web/src/scene/assets/__tests__/shared.test.ts` | Toolkit tests (38). |
| `web/src/scene/assets/__tests__/familiesB.test.ts` | Family tests (43). |
| `web/src/scene/assets/__tests__/familiesB.report.test.ts` | Opt-in review aids, no assertions. `W4_REPORT=1` prints the triangle and output table. `W4_REPORT=bounds` prints vertices outside their lot. `W4_REPORT=bench` prints build times. |

---

## 2. How other workstreams use it

### 2.1 Building a lot (W2 chunk worker, W5 construction sites)

```ts
import { factoryFor } from '@/scene/assets/registry';
import { lotFrame } from '@/scene/assets/AssetFactory';
const f = factoryFor(dto.typeId);                       // the 10 W4 types, 'construction', and W3's ids
const lot = lotFrame(cx, cz, fw, fh, facing);           // facing S/E/N/W; widthM/depthM stay in the lot frame
const out = f.build(sharedBuilder, lot, {
  seed, variant, level, stage, progress, owner: colorIndex, utilization, lod, season, month,
  productIds: dto.products, companyId: dto.ownerId, activity: { transfersIn, transfersOut, shipAtBerth },
});
// out: pickBox (world AABB clamped to the lot) · props · animated · emitters · signs · lightPools, all in WORLD metres
```

Rules for callers:
- **Shared builder.** One `GeoBuilder` can build a whole chunk. Every W4 factory saves and restores the builder's placement, local frame, tint, owner, `ownerRoof`, `ownerRoofMinNy` and flags (this is tested).
- **Determinism.** Same inputs give byte-identical arrays and identical outputs. There is no `Math.random`, `Date` or `performance.now`; a test traps all three. Only `mulberry32(seed)` is used, so factories are safe in a Web Worker.
- **Variants.** Odd variants are the mirrored second shape variant (§4.1). `variant >> 1` picks the palette and style.
- **LOD1.** Build again with `lod: 1`. It emits no props and no animated parts. Emitters and the giant roof logo are kept. Owner-roof flags are present at both LODs (tested).
- **Footprints.** They match `content/data/buildings` (tested). Geometry stays inside the lot, with one exception: the seaport's booms and the ship hang up to 50 m over the water in front of it (tested).
- **Seaport facing.** The seaport's lot +Z must face the water, which overrides road facing (art §5.3). This is W2's facing rule.
- **Products.** `productIds` absent gives a seeded look (gallery). `[]` means unconfigured: dark windows and fallow fields.
- **Months.** `month` 1..12 drives crops, hay bales, coffee cherries and drying beans, hop bines, irrigation (Apr–Sep), seasonal shade trees and tractor positions. When it is absent, `season` is used.
- **Activity.** `activity.transfersIn/Out` sets trailers at the docks, `clamp(round(log10(1 + transfers)), 0, docks)` (§3.16). `activity.shipAtBerth` puts the feeder ship at berth and lowers the booms. When activity is absent, both fall back to `utilization`.
- **Stages.** `closed`: grey signs, boarded doors, dark windows, no smoke or motion, weeds, no vehicles. `foundation`, `structure`, `finishing`: every W4 type draws its own site, including the bible overrides: farm ploughing, sowing and first green; oil drilling derrick; mine pit and rising headframe; port barge crane, piles and quay deck.

### 2.2 Contract additions (all optional; old code compiles unchanged)

| Type | Addition |
|---|---|
| `AssetParams` | `month?`, `companyId?`, `activity?: AssetActivity`, `heightHint?`, `targetTypeId?` (the last two are for the generic `construction` factory) |
| `AnimatedPartKind` | adds `pumpjackCrank`, `excavatorArm`, `irrigationArm` |
| `AnimatedPart` | `active?` (absent means true), `scale?`, `extent?` (trolley half-travel, arm length, jib reach) |
| `Emitter` | `rateAtFull?` (puffs per second at utilization 1), `tone?: 'light'\|'dark'`, `size?` |
| `SignQuad` | `style?: 'wordmark'\|'inverted'\|'emblem'\|'closed'\|'text'`, `text?`. Corners are ordered BL, BR, TR, TL. |
| `LightPool` | `tone?: 'warm'\|'cool'` |
| `AssetFactory` | `family?` (gallery and tooling group) |
| `PropInstance` | `y?` (stacked containers, terrace shrubs) |
| `GeoBuilder` | `ownerRoofMinNy` (default 0.9, the reference). `Kit.roof()` sets it to 0.5 so 30–40° gables, barns and sheds tint at city zoom; walls never qualify. |

### 2.3 Renderer-facing exports (`familiesB.ts`)

| Export | Use |
|---|---|
| `PROPS_B` and `registry.propFamilyFor(id)` | Instanced prop geometry. Use `fam.build(gb)`, then `toBufferGeometry`, then `buildPartitionedFamily(geo, CityMaterial, out.props[id], fam.castShadow)`. Hide instances beyond `fam.maxDistance`. Faces written with tint 255 take the instance colour as a **linear multiplier**: on white faces the colour is exact (owner cabs, containers, cars); on `shadeTree` the base is `TREE_BASE` and factories pass `treeTint()` (built with `palette.tintHex`). |
| `PART_SPECS` and `partPose(part, tSec)` | Animated parts (AnimatedParts.ts, W5). Geometry: `PART_SPECS[kind].build(gb, part.extent ?? spec.defaultExtent)` in pivot space. Per frame: `world = T(pivot) · R_y(rotY) · Motion(axis, angle, offset) · S(scale)`. `part.active === false` rests at the zero pose. Owner faces take `OWNER_COLORS[part.owner]` as the instance colour. Motion follows the bible: pumpjack ±18° over 7.5 s with the crank in step; jib ±60° over 20 s; trolley ±30 m at about 0.6 m/s; excavator arm ±25° over 4 s; pivot one turn per 120 s; flags, fans and sheaves spin or sway. |
| `Emitter` | Particles (W5). Spawn at `x, y, z`. Use `rate = rateAtFull × live utilization`, because utilization is not part of `visualRev`. Kinds: smoke (tone light or dark), steam, dust, flare. |
| `SignAtlas.uvFor(sign, companyStyle)` and `buildSignGeometry(signs, uvFor)` | One sign mesh per chunk with `makeSignMaterial`. `companyId` falls back to `owner:<colorIndex>`. |
| `buildConstructionSite(b, lot, footprint \| rect, stage, progress, finalHeightHint, { owner, kind, mirror, frame, … })` | A site for **any** company type. W3 can call it for retail, media and R&D, or use the registry factory `construction` with `p.targetTypeId` and `p.heightHint`. `TYPE_SITES` holds the final masses of all 18 content types. `kind: 'hall'` gives a steel portal frame erected bay by bay with a mobile crane following the erection front. `'frame'` gives a concrete frame with floor slabs, a formwork deck, scaffold and a tower crane when H > 12 m. `frame: false` keeps only the dressing, for when the renderer draws the clipped final mesh instead (§4.1 stage B). |
| `buildUpgradeSite(b, lot, typeId, level, progress, p)` and `LEVEL_EXTENSIONS` | Level-upgrade overlay (§4.1, "mini-stage B on the extension footprint only"): owner barrier fencing, the extension rising, a mobile crane. Data covers factory_small, factory_large, small_farm and oil_well. |

### 2.4 Toolkit notes for W3

- `palette.ts` is the 3D side of `tokens.ts`; import colours from there. `hexRgb` fails loudly on malformed hex.
- The `Kit` class (`families/common-b/kit.ts`) is generic. It gives mirror-aware geometry, `prop`/`part`/`emit`/`sign`/`pool` collection in world coordinates, and a pick box from the written vertices clamped to the lot. W3 is welcome to use it.
- `familiesB.report.test.ts` shows how to print a budget table for your own families.

---

## 3. Asset gallery (`?dev=assets`)

Every control is mirrored in the URL for `scripts/shoot.mjs`:

| Parameter | Effect |
|---|---|
| `only=` | Comma-separated tokens: an id substring or a family (`factory`, `farm`, `seaport`, `industrial`, `extraction`, `logistics`, `construction`) |
| `variants=1..4` | Variants per type |
| `owner=0..7\|255` | Owner colour; absent cycles through owners |
| `level=` | Building level |
| `stage=` and `progress=` | Stage and scrubber |
| `month=` or `season=` | Crops and trees |
| `util=` | Emitters, motion, trucks, parked cars, port fill |
| `product=` | Product; absent shows a sample per variant that covers every factory family, crop and port letter |
| `night=1` | Night |
| `lod=1` | LOD1 |
| `cam=far` | City band, camera at least 1,700 m away so the owner-roof tint is on |
| `turntable=1` | Turntable |
| `ui=0`, `table=0`, `labels=0`, `post=0` | Hide the panel, table or labels; render without post-processing |

The page also provides:
- A budget table with LOD0 and LOD1 against budget, props, parts, emitters, signs, build ms and product. Over-budget rows turn red.
- Live animated parts via `partPose`, a CPU preview of the §5.19 particle formula, signs from the atlas, and light pools at night.
- The owner-roof tint driven by camera distance, as `0.85 × smoothstep(900, 1600, d)`.
- The dynamic near plane `clamp(0.2·d, 1, 200)` and fog that follows camera distance (§3.7).
- A status line showing distance, band and tint.
- Generic construction previews for four W3 target types: department store, supermarket, TV station, convenience store.
- `window.__galleryReady` and `window.__galleryRows`.

---

## 4. Verification

### 4.1 Gates

```
(cd web && npx tsc --noEmit -p tsconfig.json)            → clean (exit 0)
(cd web && npx vitest run)                               → Test Files 2 passed | 1 skipped (3); Tests 81 passed | 3 skipped (84)
                                                            (the skipped ones are the opt-in W4_REPORT review aids)
(cd web && npx vite build)                               → ✓ built (no warnings from W4 files)
(cd web && node scripts/smoke.mjs)                       → boot engine + title ✓ · start tutorial ✓ · construct supermarket ✓ · advance a month ✓ · SMOKE OK
```

### 4.2 What the tests pin

**`shared.test.ts` (38 tests)**
- Index and vertex counts of every primitive: quad 4/6, tri 3/3, box 10 triangles, `boxFaces` bits, cylinder, cone, blob, roofs, `beam`, `cylinderAlong`, `prism`, `mound`, `disc`, lattice (32 + 6·panels·faces), truss.
- Stored normals are unit length, agree with the triangle winding (front faces are counter-clockwise, so a mismatch is a culled face) and point outward on every convex solid.
- `place`, `setLocal`, `toWorld` and `worldYaw` agree with the written vertices for all quarter turns. `bounds()` and `saveState` work, and `finish()` switches from u16 to u32 indices.
- Attributes are 4-byte aligned.
- The palette mirrors `tokens.ts` exactly, `tintHex` is accurate in linear space, and `ownerRoofMinNy` behaves as documented.
- Stage, month and season helpers, and Instancing cells and height.

**`familiesB.test.ts` (43 tests)**

Matrix coverage: every factory × 5 stages (3 progress points each) × levels × LOD0/1 × 4 variants × all 4 facings × owners 0–7 and 255. For each build the tests check:
- triangles within budget;
- no NaN;
- consistent winding;
- geometry inside the lot;
- the pick box inside the lot;
- animated parts, emitters, signs, light pools and props inside it;
- props from registered families only, and no props or parts at LOD1.

They also check:
- Ids and footprints match content.
- Every content type has a site.
- Prop and part budgets, plus the bible's animation constants.
- Determinism (byte-identical arrays), purity (no `Math.random`, `Date` or `performance.now`), no state leaks on a shared builder, and translation invariance.
- Owner paint stays at or below 15 % of every complete building's surface, signs included.
- An emissive owner element exists at night, and owner-roof flags exist at both LODs (none when unowned).
- Closed and idle states behave as specified.
- Smoke = 1.5 × utilization, with tone by product family; every product family builds distinct props; the dock-trailer log rule; ship at berth with trolleys and raised booms otherwise; port fill tracks utilization.
- One pumpjack per level, out of phase; the mine's sheave wheels; dust ∝ utilization.
- The wheat calendar of §4.2.9; seasonal trees; coffee cherries; hop bines.
- Construction stages A, B and C; the frame rises monotonically; footprint or rect input; the builder owner is used; level-upgrade overlays.

### 4.3 Budgets

Triangle counts at the worst level per type, against the art §4.2 budgets (`W4_REPORT=1`):

| Type | LOD0 / budget | LOD1 / budget |
|---|---|---|
| factory_small | 1,164 / 2,500 | 60 / 150 |
| factory_large | 2,658 / 4,500 | ≤ 120 / 250 |
| small_farm | 752 / 1,500 | 50 / 60 |
| large_farm | 1,292 (2,012 with Oct hay bales) / 2,500 | 66 / 100 |
| small_plantation | 1,208 (hops) / 1,800 | 50 / 60 |
| iron_mine | 901 (915 closed) / 2,200 | 79 (87 closed) / 100 |
| oil_well | 890 / 900 | 34 / 40 |
| warehouse_small | 354 / 700 | 30 / 40 |
| warehouse_large | 848 / 1,600 | 34 / 80 |
| seaport | 1,414 / 6,000 (≤ 288 containers ≤ 1,200) | 236 / 400 |
| construction | ≤ 2,022 / 3,200 | ≤ 60 / 150 |

Build time (`W4_REPORT=bench`, warm JIT, on this shared and heavily loaded machine): median 0.5–3.1 ms per company building at LOD0 and ≤ 0.2 ms at LOD1. The largest is `factory_large` L3 at 3.1 ms.

### 4.4 Screenshots reviewed

All in `docs/overhaul/status/w4-assets-b/` (1440 px JPEG):

| File | View |
|---|---|
| `all.jpg` | Every W4 type, owners 0–7 |
| `factories.jpg` | 8 factories, one per product family: silos, tanks, weaving shed, coil gantry, bullet tanks with flare, clean room, car test lot |
| `factory-small.jpg` | Street zoom |
| `farms-may.jpg`, `farms-aug.jpg`, `farms-oct.jpg`, `farms-jan.jpg` | Crop calendar, hay bales, cotton bolls, coffee cherries and beans, bare fields, trees bare in winter |
| `plantation.jpg` | Coffee terraces and hop yard |
| `seaport.jpg`, `seaport-night.jpg` | Port by day, and at night with floods, crane lights, aviation lights and bridge windows |
| `night.jpg` | Lit clerestories, wordmarks, light pools |
| `owners.jpg` | Owners 0–7 |
| `level3.jpg` | Levels: factory halls, chimneys, tank farm and second office; farm dryer, shed and irrigation pivot; pumpjacks |
| `foundation.jpg`, `structure.jpg`, `finishing.jpg` | Construction stages, including steel halls, concrete frames and the type overrides |
| `lod1.jpg`, `far.jpg` | LOD1, and the city band at 1,700 m with the owner-roof tint on |
| `closed.jpg` | Closed state |
| `mine.jpg`, `mine-oil.jpg` | Iron mine and oil wells |
| `warehouses.jpg` | Warehouses |
| `pumpjack-t0.jpg`, `pumpjack-t1.jpg` | Two frames 1.8 s apart: the beams nod and the flare flickers |

### 4.5 Art-direction fixes made from the reviews

- **Factory roofs.** Solar arrays covered every sawtooth slope and read as solar farms, so solar is now on about 45 % of halls, partial and alternating teeth.
- **Construction of halls.** The concrete slab deck read as a parking deck. Halls now go up as a steel frame bay by bay, with formwork and rebar decks on frame buildings and a material laydown.
- **Seaport paint.** Owner paint covered 20 % of the port. Only the portal is owner-coloured now; the A-frame and boom are white.
- **Fences.** Fences read as 2 m walls. They are now see-through chain link: one outward-facing mesh quad, a rail and posts.
- **Farms at night.** Farms had no emissive owner element, so they now have gate signs. Pitched barn and shed roofs now get the owner tint at city zoom.
- **Oil well and mine.** The oil pad looked empty, so it gained a berm, a track and a meter house. The mine gained ore-dust ground tones and an open pit.
- **Lot boundaries.** Contact aprons, scaffold, the spoil heap, weeds and guardhouse arms crossed the lot boundary. They are clamped now, and a test keeps it that way.
- **Crops.** Young crops read muddy and are greener now.
- **Gallery.** Gallery framing, layout, z-fighting at distance and the far camera were fixed.

---

## 5. Known gaps

- **City climate.** It is not in `AssetParams`, so crops always use the temperate calendar and there is no warm or cold variant. W2 or a later wave can add `climate` to the params.
- **Winter tree shape.** The winter canopy is coloured bare, but the bible's "canopy scale 0.6" is not applied: instance scale would shrink the trunk too.
- **Animated vehicles.** These §4.2 items are emitted as static props, with their positions in `out.props`: the forklift loop, straddle carriers and reach stackers looping, the tractor driving the rows, and the haul-truck loop. Animating them is W5 traffic or life work.
- **Particles.** Flare and particle visuals are only previewed in the gallery (a CPU version of §5.19). The production `Particles.ts` and `AnimatedParts.ts` belong to W5 or W7.
- **Construction clipping.** Stage B draws real frame geometry; the clipped final mesh with `uClipY` is not used. CityMaterial has no clip uniform, so `frame: false` exists for when W1 adds one (see Requests).
- **Grand opening.** The opening pop and confetti (§4.1 "Opening") are WorldFx, owned by W5.
- **Rail siding.** The `factory_large` rail siding is P1 and not built (there is no rail in the layout).
- **Future categories.** §4.4 future categories (livestock farm, quarry, logging camp, distribution centre, freight yard, …) are not built. They were an optional stretch, and there are no content ids yet. The toolkit (`Kit`, details, steel halls, open pit, containers) covers most of their parts.
- **Port in the city band.** At city zoom only the terminal office roof carries the owner tint; the crane legs carry the owner colour at every zoom.

---

## 6. Requests

**W1 (render core / CityMaterial)**
1. Drive `CityUniforms.uOwnerRoofMix = 0.85 × smoothstep(900, 1600, cameraDistance)` every frame in the city scene (art §3.4). The gallery does it itself; the game needs it so roofs flagged by W3 and W4 tint at city zoom.
2. Use the dynamic near plane `clamp(0.2·d, 1, 200)` (art D8). Lot dressing layers sit 1–3 cm apart (yard, apron, markings, rebar) and z-fight at district zoom with a near plane of 1.
3. Optional: a per-site `uClipY` clip if the renderer wants the bible's "final mesh clipped at h" for stage B. W4 sites already work without it (`frame: true`).

**W2 (city and chunks)**
1. Seaport facing: the lot +Z must face the adjacent water (art §5.3). The seaport lot needs open water in front of it (booms, ship and quay face hang up to 50 m beyond the lot front).
2. Pass `month`, `productIds` (bridge `products`), `companyId`, and `activity { transfersIn, transfersOut, shipAtBerth }` into `AssetParams`.
3. Use one `GeoBuilder` per chunk freely; W4 factories restore the builder state.
4. Build LOD1 with the same factory and `lod: 1`.

**W5 / W7 (life, FX)**
1. Animated parts: `PART_SPECS` and `partPose`.
2. Emitters: rescale with live utilization through `rateAtFull`.
3. Construction sites: `buildConstructionSite`, or the `construction` factory with `targetTypeId`.
4. Upgrades: `buildUpgradeSite`.
5. Animate the static vehicles listed in Known gaps if desired.

**W3 (assets A)**
1. To register instanced props, export `PROPS_A: readonly PropFamily[]` from `familiesA.ts`; the registry picks it up with no other change.
2. For construction stages of retail, media and R&D types, either call `buildConstructionSite` (supermarket is `kind: 'hall'` in `TYPE_SITES`) or let the renderer use the `construction` factory.
3. Wrap pitched main roofs in `ownerRoof = true` with `ownerRoofMinNy = 0.5`, the way `Kit.roof()` does, so they tint at city zoom.

**Lead.** Nothing blocking. Merge order does not matter: W4 touches no file outside its ownership. `registry.ts` reads `familiesA.FAMILIES_A` and the optional `PROPS_A` through a namespace import.
