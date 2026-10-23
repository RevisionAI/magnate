# W3 assets-A: status

Branch `w3-assets-a`. Status: **done** for the Wave 1 scope (see the known gaps below). Date: 2026-10-01.

W3 delivers the procedural low-poly assets for the city people live and shop in:

- **Ambient city:** houses, row houses, villas, apartments, mid-rises, shops, strip malls, office towers, ten civic landmarks, parks, plazas and car parks.
- **Company buildings:** the retail, media and R&D types, plus a headquarters tower.
- **Instanced props:** 19 families, from trees to fire engines.

Every factory is pure and deterministic, and it runs in the chunk worker. Each one has LOD0 and LOD1 builds within the art-bible budgets, an exact pick box, owner paint on company buildings only, sign quads, night light pools and emissive parts, instanced props, and a closed look. Both builds were checked in the asset gallery and in a street preview, by day and night, in all seasons, and at street and city zoom.

![Ambient street](w3-assets-a/ambient-street.jpg)

---

## 1. File map

Everything lives under `web/src/scene/assets/`.

| Path | Contents |
|---|---|
| `familiesA.ts` | `FAMILIES_A`, the 30 factories that `registry.ts` registers. It also re-exports `PROP_FAMILIES`, `PROP_IDS`, `SIGNAL_HEADS`, `billboardFaceCorners`, `treeLook` and the `FamilyParams` type. |
| `families/common-a/ctx.ts` | **`Ctx`**, the build context every factory works through. It handles: <ul><li>the lot frame (+Z is the street front) and quarter turns;</li><li>exact local bounds, from which `finish()` returns the world pick box;</li><li>the builder state (owner, owner roof, flags, tint): saved, then restored;</li><li>seeded random streams for shape, colour and props;</li><li>facade-fitted walls, masses, parapets, cornices, side-relative boxes and panels;</li><li>ground patches, paint lines, discs, domes and spires;</li><li>converting props, signs, light pools, emitters and animated parts to world space.</li></ul> |
| `families/common-a/kit.ts` | Shared parts: <ul><li>roofs: eaves, HVAC, plant rooms, water tanks, solar rows, skylights, antennas, aviation lights;</li><li>entrances: canopies, doors, awnings, boarded-up fronts, weeds;</li><li>owner paint: flagpoles, pylons, banners, emblems in the owner's shape;</li><li>clock faces, colonnades and pediments, steps;</li><li>`parkingLot` (stalls, lines and cars by fill), paths and ponds;</li><li>struts and dishes;</li><li>new in this session: `ring`, `trackPts`, `superPts`, `bandBetween`, `propLine`, `fountain` and `statue`.</li></ul> |
| `families/common-a/palette.ts` | `P`, the theme `WORLD` palette as RGB. Also `HEX` and `X`, which hold the art-bible colours that are not theme tokens (each cites its section), plus the RES, APT, OFFICE and roof palettes and `mixRgb`, `shade` and `hexOf`. |
| `families/common-a/{constants,rng,propIds,vegetation}.ts` | <ul><li>Flag, facade and emissive constants. These are mirrored from `CityMaterial` and `GeoBuilder` and checked by a test.</li><li>`mulberry32` streams (`Rng`, `mixSeed`).</li><li>The prop ids.</li><li>`treeLook`, which gives a tree's family and seasonal colour.</li></ul> |
| `families/common-a/devPreview.ts`, `devStats.ts` | Dev-only tools that the app never imports: <ul><li>a street preview of the factories **with** their props, real SignAtlas wordmarks and night light pools;</li><li>a props showcase;</li><li>a triangle, prop, sign and pool report against each budget.</li></ul> |
| `families/residential/` | `house`, `rowhouse`, `villa`, `apartment` |
| `families/commercial/` | `office`, `headquarters`, `midrise`, `shop`, `stripMall`, and the shared massing in `tower.ts` and `smallShop.ts` |
| `families/retail/` | `convenience` (`convenience_store`), `supermarket` (L1–L3), `departmentStore` |
| `families/media/` | `tvStation`, `radioStation`, `newspaper`, `magazine`, and `masts.ts` (lattice tower and guyed mast) |
| `families/rnd/` | `rdCenter` |
| `families/civic/` | `classical.ts` (portico, drum and dome, classical block, pilasters, city flag, uplights, bronze doors), `cityHall`, `exchange`, `bank`, `school`, `hospital`, `emergency` (police and fire), `university`, `stadium`, `church`, `park`, `plaza`, `parking` |
| `families/props/geometry.ts`, `meshes.ts` | `PROP_FAMILIES`, a builder for each prop id with its budgets, distance bands, shadow flag and whether it needs a colour, and `buildPropMeshes()`, the main-thread InstancedMesh helper. |
| `__tests__/familiesA.test.ts`, `familiesA.contracts.test.ts` | 182 vitest tests (§4). |
| `docs/overhaul/status/w3-assets-a/*.jpg` | The screenshots in this document. |

---

## 2. Factory catalogue

The budgets follow art §4.2 and §4.3. Where the table gives none, W3 chose one and kept LOD1 at or below 8% of LOD0. The "measured" figures are the maxima `devStats` found over 8 variants × 3 levels.

| Id | Footprints | LOD0 / LOD1 budget (measured) | Forms and seeded variety | Landmark cues, night look and props |
|---|---|---|---|---|
| `ambient:house` | 1×1 | 150 / 24 (130 / 16) | 6 shapes (gable or hip, garage, porch, L wing) × RES walls and roofs | Chimney, driveway, hedge or fence, garden trees |
| `ambient:rowhouse` | 1×1 | 260 / 24 (240 / 16) | Brownstone, terrace, townhouses, bay windows | Stoops, party walls, back yards |
| `ambient:villa` | 1×1, 2×2 | 300 / 30 (132 / 22) | Cantilevered flat roofs; 2×2 adds a court or garden | Pool that glows at night, carport, hedges |
| `ambient:apartment` | 2×2, 3×3 | 1500 / 60 (720 / 32) | Slab, point tower, L, U perimeter, twin, stepped; 4–15 floors | Balconies on 30% of blocks, water tanks, canopy, residents' car park |
| `ambient:midrise` | 1×1, 2×1, 2×2 | 600 / 40 (310 / 14) | Corniced, setback, corner turret, bays; 3–9 floors | Shop units with neutral awnings and `local:` signs |
| `ambient:shop` | 1×1 | 600 / 30 (172 / 18) | 6 forms; floors > 2 becomes a mid-rise | Neutral awning, `local:<icon>` sign, "For Lease" when closed |
| `ambient:strip_mall` | 3×1 | 700 / 40 (287 / 12) | Flat canopy or false-front centre | Five units, front car park, lamps |
| `ambient:office` | 2×2 to 4×4 | 700 / 40 (280 / 40) | Box, chamfered or round plan; 0–2 setbacks; curtain wall or ribbon; 4 crown types; 10–60 floors | Aviation light above 60 m, helipad, window-cleaner gondola (animated) |
| `ambient:civic:hall` | 4×4, 3×3 | 1200 / 60 (759 / 52) | **Capitol** (6-column portico, Ø14 m drum, copper dome to about 30 m) or **belfry** (hipped range, end pavilions, clock tower and spire about 50 m) | Plaza with parterres, fountain and city flags; uplit; staff car park |
| `ambient:civic:exchange` | 3×3 | 1000 / 50 (595 / 35) | Trading tower behind the façade, or a glazed barrel-vault hall | 8 columns and pediment; **LED ticker band** (`ticker` sign plus emissive housing); bronze bull; trees in grates |
| `ambient:civic:bank` | 2×2, 1×1 | 600 / 30 (313 / 25) | Temple front (4 columns in antis) or palazzo porch with pediment | Heavy plinth, bronze doors, pilasters, `civic:bank` sign |
| `ambient:civic:school` | 3×3, 2×2 | 800 / 40 (388 / 34) | Flat roofs with parapets, or hipped tiles (mirrored); 2–3 floors | L-plan brick, gym clerestory, **running track #C6734E around a field #7FAE5A**, basketball court, fence, bike shelter |
| `ambient:civic:hospital` | 3×3 | 900 / 40 (377 / 38) | Slab tower or deep tower, with the site plan mirrored | 9 ward floors over a 3-floor base; **emissive red cross**; **helipad with H**; emergency bay with ambulances; stair cores lit all night |
| `ambient:civic:police` | 1×1, 2×2 | 400 / 30 (158 / 28) | Greige with a flat roof, or brick with a hip roof | Blue band, lit blue canopy bar and blue lamp, radio mast, yard of `car.police`; garage on 2×2 |
| `ambient:civic:fire` | 1×1, 2×2 | 400 / 30 (212 / 24) | Tower left or right | Red bay doors under a lit header, hose tower, apron with `truck.fire`; office wing and training yard on 2×2 |
| `ambient:civic:university` | 5×5, 4×4 | 2000 / 100 (945 / 98) | Brick or limestone ranges, copper or slate dome, corners mirrored | Gate range with clock tower and archway; side ranges; **domed library with portico**; quad paths and statue; science building; car park |
| `ambient:civic:stadium` | 5×5, 4×4 | 1200 / 60 (600 / 52) | Open athletics bowl with scoreboard, or football ground under a membrane roof ring | 20-segment superellipse bowl, two tiers (4 → 16 m), striped pitch with markings and goals, **4 × 36 m floodlight masts** with emissive banks and pitch light pools, entrance portals |
| `ambient:civic:church` | 1×1, 2×2 | 500 / 40 (186 / 40) | West tower with spire, or gable front with rose window (side tower on 1×1, twin towers on 2×2) | **Spire 29–48 m**, clock, belfry louvres, cross; cruciform plan with apse on 2×2; churchyard with yews and hedges |
| `ambient:park` | 1×1 to 5×5, 2×1, 1×2, 3×2 | 400 / 20 (312 / 14) | Cross, diagonal, ring with spurs, or meander | Fountain, bandstand or statue; **pond on 3×3 and up**; playground on 2×2 and up; café kiosk on 3×3 and up; benches and path lamps; trees at about 1 per 90 m² |
| `ambient:plaza` | 1×1, 2×1, 1×2, 2×2, 3×1 | 200 / 10 (168 / 6) | Fountain, statue, obelisk, clock pillar or market stalls | Paving joints, trees in grates, benches, lamps, planters on 2×2 |
| `ambient:parking` | 1×1, 2×1, 1×2, 2×2, 3×2 | 400 / 20 (316 / 12) | Surface lot (planted margins, stall module) or multi-storey garage (2×2 and up) | Fill follows utilization; `civic:parking` "P" sign; pay machine; garage decks with roof-top cars |
| `convenience_store` | 1×1 | 350 / 30 (180 / 18) | 1 storey, or flats above | Owner awning and fascia, ATM, ice chest, bins |
| `supermarket` | 3×3 | 2000 / 120 (786 / 28) | Entrance left or right; **L2 adds a garden centre and 12 bays; L3 adds rooftop solar and click-and-collect** | Car park fill = 0.1 + 0.85 × utilization, pylon sign, trolley shelters |
| `department_store` | 4×4 | 2500 / 150 (680 / 22) | Corner rotunda or atrium bay | Five-storey emporium, marquee, banners, rooftop wordmark, plaza with fountain |
| `tv_station` | 3×3 | 2000 / 100 (1370 / 40) | Tower right or left | 100 m lattice tower in red and white, satellite dishes, OB vans in owner livery |
| `radio_station` | 2×2 | 900 / 50 (276 / 36) | Mast left or right | 70 m guyed mast, dipoles, obstruction lights |
| `newspaper_publisher` | 3×3 | 2000 / 100 (232 / 24) | Yard right or left | Brick block with masthead sign, sawtooth print hall lit all night, paper reels, vans |
| `magazine_publisher` | 3×3 | 2000 / 100 (534 / 34) | Atrium right or left | Pastel block, glass atrium, roof terrace with owner parasols, banner |
| `rd_center` | 3×3 | 2200 / 100 (502 / 34) | Rotunda right or left | Lab block, glowing glass rotunda, fume stacks (steam emitters), dish, pond |
| `headquarters` | 2×2, 3×3 | 1000 / 50 (372 / 40) | Tower massing as for `office` | **Logo crown** (emblem on 4 faces, emissive), floors from `FamilyParams.floors` or by level (14 / 26 / 40), flags, plaza |

**Owner paint.** It goes only on company factories, and only on the slots art §3.4 lists: fascia or sign band, awning, roof band, flag, pylon, banners, vehicle livery and the HQ crown. `b.ownerRoof` is set only while the company's main roof faces are emitted. Ambient factories write owner index 255 and never set the owner-roof flag; both rules are tested.

**Closed stage** (company factories):
- the sign board turns grey `#9A9A9A` and has no sign quad;
- shop glazing is boarded over (`#8A6A4A`);
- there are no light pools, emitters, animated parts or parked cars;
- three dry-grass weed patches `#C4BE82` appear on the lot.

Windows still light at night, because that needs a shader hook (§6, request R1).

---

## 3. How other workstreams use it

### 3.1 Registry, ids and parameters
- `registry.ts` (owned by W4) already merges `FAMILIES_A`. Look factories up with `factoryFor(id)`.
  - **Company ids** are content building-type ids. `headquarters` anticipates the schema category of that name; there is no content type for it yet (request R6).
  - **Ambient ids** are `ambient:<AmbientDto.kind>`, with the art §5.3 extensions, for example `ambient:civic:hall`. The contract test checks that every kind W3 owns has a factory.
- `AssetParams.variant` chooses the **form**, cycling through each factory's forms. `seed` drives everything else: colours, dimensions, props and lit-window patterns. Pass `fnv1a(cityId, px, pz, typeId)` (art §4.1). `AmbientDto.variant` maps directly onto `variant`.
- `FamilyParams` (exported from `familiesA.ts`) extends `AssetParams` with two optional fields:
  - `floors`: storeys from `AmbientDto.floors`. Apartments take 4–15, offices 10–60, mid-rises and shops 3–9; an HQ takes a band chosen by the scene from market cap. Values are clamped.
  - `companyId`: written into every company `SignQuad`. Without it, company signs carry `companyId: ''`, and the caller substitutes the owner's id.
- `utilization` (0..1) sets:
  - car-park fill on the supermarket, magazine, TV station, hospital and `ambient:parking`;
  - the police fleet size;
  - the R&D steam rate.

  For the supermarket the scene should pass `clamp01(log10(1 + unitsSold) / 6.5)` (art §3.16). Ambient callers can pass 0.7.
- `level` is honoured by `supermarket` and `headquarters`. `season` (0–3) recolours tree instances. `stage` handles `complete` and `closed`; ambient buildings always use `complete`.

### 3.2 Outputs
- **LOD.** Build every lot twice into the chunk worker's two builders: `lod: 0` for the near chunk and `lod: 1` for the chunk LOD1 mesh beyond 1,400 m. Take **props, signs and light pools from the LOD0 build only**; the LOD1 build returns none. Props carry their own distance bands (`PROP_FAMILIES[id].maxDistance` and `lod1Distance`), so trees still show as 8-triangle octahedra at city zoom.
- **Builder state.** `Ctx` saves owner, owner roof, flags and tint and restores them on `finish()`. It also resets `b.place()` to the identity world frame. A chunk worker that draws its own geometry after a factory call should therefore call `b.place(...)` itself.
- **`pickBox`** is the exact world AABB of everything emitted, including signs, clamped at y ≥ 0. Tests check that it contains every vertex and stays inside the lot.
- **`props`** is keyed by `PROP_IDS`. `PropInstance.color` is set wherever `needsColor` is true: tree leaf colours, parked-car bodies, and van livery, which is the owner colour on company lots. Note: props have no y coordinate, so the cars on a parking garage's roof deck are geometry.
- **`signs`** use this companyId vocabulary, which the contract test enforces:

  | companyId | Meaning | Sign layer should draw |
  |---|---|---|
  | `''` or the owner's id | Company wordmark | The SignAtlas company slot |
  | `local:<icon>` | Local competitor shop. Icons are `shoe`, `gem`, `sofa`, `toy`, `book`, `flower`, `bakery` and `coffee`. | A neutral slate board with the category icon |
  | `civic:<kind>` | Inscriptions: `hall`, `exchange`, `bank`, `school`, `hospital`, `police`, `fire`, `university`, `stadium`, `parking` | Neutral civic lettering ("CITY HALL" and so on); `parking` is a white "P" on blue |
  | `ticker` | The exchange's LED band | A scrolling ticker atlas row (art §4.3), emissive |

- **`lightPools`** carry a centre and radius in metres. They are emitted only on open buildings.
- **`emitters`**: R&D steam, at a rate scaled by utilization.
- **`animated`**: the office window-cleaner gondola.

### 3.3 Props on the main thread
- `buildPropMeshes(props, material, lod)` in `families/props/meshes.ts` turns a merged `props` map into partitioned `InstancedMesh` groups (400 m cells, art §5.5). Callers can also take `PROP_FAMILIES[id].build(builder, lod)` and partition the instances themselves.
- `treeLook(species, season, r1, r2, r3)` gives a tree's family and colour for a season. Factories already apply the season they are given. Switching the season of a live city means rebuilding the affected chunks.
- `billboardFaceCorners(x, z, rotY, scale)` gives the corners of a billboard's face for the ad atlas. `SIGNAL_HEADS` gives the positions of the traffic-signal aspects, so the traffic module can overlay the active-phase glow.

### 3.4 Dev tools
These run on the dev server and are not shipped.
```bash
# street preview of factories with props, signs and pools (options: only, ids, variants, owner, level, stage, night,
# season, lod, footprint, floors, az, el, dist, focus, rowWidth)
node scripts/shoot.mjs --dev --query "?dev=assets&only=__none__" --ready "() => window.__galleryReady === true" \
  --eval "import('/src/scene/assets/families/common-a/devPreview.ts').then((m) => m.mountFamiliesPreview({ only: 'ambient:civic' }))" --out x.png
# every prop family (also { night: true })
  --eval "import('/src/scene/assets/families/common-a/devPreview.ts').then((m) => m.mountPropsPreview())"
# triangle / prop / sign / pool report against budgets
npx vite-node src/scene/assets/families/common-a/devStats.ts [idPrefix]
```

---

## 4. Verification evidence

**Gates**, run in `web/` on the final commit:
- `npx tsc --noEmit -p tsconfig.json`: no output, exit 0.
- `npx vitest run`: `Test Files 2 passed (2)`, `Tests 182 passed (182)`.
- `npx vite build`: `✓ built`, with no errors.

**Tests.** `familiesA.test.ts` and `familiesA.contracts.test.ts` hold 182 tests. For each of the 30 factories, the build runs across every footprint, 8 variants, LOD 0 and 1, the complete and closed stages, levels 1–3, all four quarter turns, utilization from 0 to 1 and all four seasons. The checks are:
- the LOD0 and LOD1 triangle budgets;
- no NaN anywhere;
- no vertex below ground;
- every vertex, prop, sign, pool, emitter and animated part inside the lot;
- the pick box contains every vertex;
- the owner index appears only on company factories, and every company has owner-roof faces;
- a closed building has no signs, pools, emitters or animation;
- props are only valid prop ids, with colours where needed;
- no props at LOD1;
- the builder state is restored;
- engine floors from 1 to 99 stay inside the lot and the budget;
- byte-identical arrays and outputs for identical inputs;
- variation with seed and variant;
- the world footprint swaps on quarter turns.

The contract tests add four more checks:
- ambient-kind coverage;
- the sign vocabulary;
- landmark cues in **both** LODs: a dome or tower above 28 m, a spire above 25 m, the emissive red cross, the ticker, and four floodlight banks;
- service props keep a fixed livery and an emissive light bar.

There are also prop budget and determinism tests, and the flag and facade constants are checked against `CityMaterial` and `GeoBuilder`.

**Screenshots.** Every image below was rendered, read and critiqued, and the fixes were applied before these final captures.

| View | Image |
|---|---|
| Street preview of all ambient archetypes, LOD0 | ![](w3-assets-a/ambient-street.jpg) |
| Residential and commercial | ![](w3-assets-a/residential-commercial.jpg) |
| City hall: capitol and belfry | ![](w3-assets-a/civic-city-hall.jpg) |
| Exchange (two forms), bank (two forms), school (two forms) | ![](w3-assets-a/civic-exchange-bank-school.jpg) |
| Exchange at street zoom: ticker, inscription, bull | ![](w3-assets-a/civic-exchange-street.jpg) |
| Hospital, police and fire (1×1) | ![](w3-assets-a/civic-hospital-police-fire.jpg) |
| Police, fire and churches on 2×2 | ![](w3-assets-a/civic-2x2-stations-churches.jpg) |
| Parish churches (1×1, four forms) | ![](w3-assets-a/civic-churches.jpg) |
| University and stadiums | ![](w3-assets-a/civic-university-stadium.jpg) |
| Parks on 3×3 (four layouts) | ![](w3-assets-a/open-parks-3x3.jpg) |
| Parks, plazas and parking on 2×2 | ![](w3-assets-a/open-parks-plazas-parking.jpg) |
| Civic at night: cross, ticker, floods, uplights, pools | ![](w3-assets-a/civic-night.jpg) |
| Civic in winter: snow on roofs and lawns, bare trees | ![](w3-assets-a/civic-winter.jpg) |
| City zoom, LOD0 versus LOD1 | ![](w3-assets-a/far-lod0.jpg) ![](w3-assets-a/far-lod1.jpg) |
| Company buildings, level 3 | ![](w3-assets-a/company-level3.jpg) |
| Company buildings, closed | ![](w3-assets-a/company-closed.jpg) |
| Prop families, day and night | ![](w3-assets-a/props-day.jpg) ![](w3-assets-a/props-night.jpg) |
| Gallery `?dev=assets&variants=1` | ![](w3-assets-a/gallery-all.jpg) |
| Gallery `only=supermarket&level=3` | ![](w3-assets-a/gallery-supermarket-l3.jpg) |
| Gallery `only=supermarket&night=1` | ![](w3-assets-a/gallery-supermarket-night.jpg) |
| Gallery `only=convenience_store&variants=8` (owners 0..7) | ![](w3-assets-a/gallery-owners.jpg) |
| Gallery `only=ambient:&season=3` | ![](w3-assets-a/gallery-ambient-winter.jpg) |
| Gallery `only=ambient:&lod=1&cam=far` | ![](w3-assets-a/gallery-lod1-far.jpg) |
| Gallery `only=ambient:civic&night=1` | ![](w3-assets-a/gallery-civic-night.jpg) |

The gallery renders factory geometry only. Props, sign wordmarks and pools appear in the preview shots. The diagonal hatching on flat lots in the gallery's far LOD1 shot is shadow acne from the gallery's shadow setup, not from the asset geometry.

---

## 5. Known gaps

1. **Windows cannot be switched off per building.** Closed buildings and schools at night should be dark, but the shader's lit share is global (`uLitFrac`). The hospital's "always 0.6" is approximated with emissive stair cores and a lit lobby band. Request R1.
2. **Facade styles 7 (retail-upper) and 8 (civic arched)** are not in the shader yet. They are approximated with HOUSE windows at 4.2 m and 5–6 m floors.
3. **Flags are static geometry.** The `'flag'` animated part, satellite-dish rotation and aviation-light blinking need W5 or W1 hooks. Request R4.
4. **Stadium floodlights glow every night**, not only on match days from 19:00 to 22:00. That needs a per-building emissive switch. Request R4.
5. **No railing on waterfront plazas.** Factories get no water-adjacency information; a `FamilyParams.waterfront` flag would be enough.
6. **Ponds and fountains use flat water colours**, not the water shader, which is owned by W1.
7. **Rural ambient kinds** (`field`, `forest`, `orchard`, `vineyard`, `pasture`, `scrub`, `deposit:*`) are outside W3's scope. They belong with W4's farms and extraction or with W2's outskirts. Art §5.3 says unknown kinds fall back to `house` or `park`.
8. **`headquarters` has no content building type yet.** Request R6.
9. **Construction stages** (foundation, structure, finishing) are W4's generic family. W3 factories build the finished building for those stages.

---

## 6. Requests

| # | To | Request |
|---|---|---|
| R1 | **W1** (`CityMaterial`) | Add a per-vertex lit-window control, for example `extra.w`: 0 = default, 1 = never lit, 2–255 = lit-share multiplier. W3 would then mark closed buildings and schools "never lit" and hospitals at 1.5×. |
| R2 | **W1** (`CityMaterial`) | Add facade styles 7 (RETAIL-UPPER) and 8 (CIVIC arched, art §3.5). The constants in `families/common-a/constants.ts` and the `FACADE` table in `ctx.ts` switch over in one line each. |
| R3 | **W4** (`SignAtlas`) and **W2** (sign layer) | Support the sign vocabulary in §3.2: neutral `local:<icon>` boards, `civic:<kind>` lettering, and a scrolling `ticker` row. Closed buildings emit no quads; their boards are already grey geometry. |
| R4 | **W5** (animated parts) and **W1** (day and night) | <ul><li>A `'flag'` sway part. When it exists, `kit.flagpole` emits the part and drops its static cloth.</li><li>A blink hook for aviation lights. They are static red emissive boxes today; a `uTime`-stepped flag bit would do.</li><li>A match-day switch for stadium flood banks: a light-pool group or an emissive flag.</li></ul> |
| R5 | **W2** (chunk worker) | <ul><li>Use the LOD0 build for props, signs and pools (§3.2).</li><li>Pass `FamilyParams.floors` from `AmbientDto.floors`, and `companyId`.</li><li>Pass `utilization` as in §3.1.</li><li>Fall back to `ambient:house` or `ambient:park` for unknown kinds.</li><li>Call `b.place()` before drawing your own geometry after a factory.</li></ul> |
| R6 | **Lead** / content | Decide the HQ type id. The factory is `headquarters`; a content `headquarters` (or `office_tower`) type id would hook it up, or rename it in `FAMILIES_A`. |
| R7 | **E3a** (city generator) | Emit the civic kinds on these parcel sizes: hall 4×4 (3×3), exchange 3×3, bank 2×2 (1×1), school 3×3 (2×2), hospital 3×3, police and fire 1×1 or 2×2, university 5×5 (4×4), stadium 5×5 (4×4), church 1×1 or 2×2. Parks fit any size from 1×1 to 5×5, plus strips. Plazas fit 1×1, 2×1, 1×2, 2×2 or 3×1. Parking fits 1×1, 2×1, 1×2, 2×2 or 3×2. Other sizes also build, because layouts scale with the lot, but only these are tested. |
| R8 | **W4** (gallery) | Optional: render props in the asset gallery with `buildPropMeshes` from `familiesA.ts`, so props and pools show there too. W3's `devPreview` covers this meanwhile. |
