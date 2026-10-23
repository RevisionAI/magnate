# E3a — City generator: status

**Status: done.** All 8 deliverables are in place. `dotnet build Magnate.sln` has 0 errors and `dotnet test Magnate.sln` is all green. The preview PNGs were rendered, inspected and fixed (see §5).

Branch `e3a-citygen`. Everything lives in the `Magnate.Engine.Land` namespace, a pure library: it never reads or writes `World`. The bridge exposes it as `cityLayout`.

## 1. File map

| Path | What it is |
|---|---|
| `engine/Magnate.Engine/Land/CityLayoutGenerator.cs` | Entry point: `Generate(City, int seed)` (+ an overload that takes an explicit `CityProfile`). `DefaultSeed = 1`. |
| `engine/Magnate.Engine/Land/CityLayout.cs` | Immutable result: per-plot arrays (kind, road class, district, water, parcel id, deposit id, slope, land use), corner heights, roads, parcels, water rects, landmarks, deposits, fields, CBD, R_u, `ComputeHash()`. Also defines `GeneratorVersion` and `PlotSizeMetres = 24`. |
| `engine/Magnate.Engine/Land/LayoutElements.cs` | Records: `Parcel`, `AmbientBuilding`, `Road`, `WaterRect`, `Landmark`, `Deposit`, `PlotRect`, `PlotPoint`. |
| `engine/Magnate.Engine/Land/LandTypes.cs` | Enums: `PlotKind`, `RoadClass`, `Zone`, `District`, `WaterKind`, `ShoreKind`, `DepositKind`, `Climate`, `Facing`, `LandmarkKind`, `AmbientKind`, `CivicKind`, `LandUse`. |
| `engine/Magnate.Engine/Land/CityProfile.cs` | City identity table (metropolis, riverside, eastside, portbay, hilltown), plus a `generic` profile derived from geography and population for modded cities. |
| `engine/Magnate.Engine/Land/LandFields.cs` | `CityFields` (land-value and traffic snapshot, location factor), `TrafficModel`, `LandValueModel`, `TrafficAttractor`. |
| `engine/Magnate.Engine/Land/Placement.cs` | `IPlotOccupancy`, `PlotOccupancy.None`, `PlotOccupancyMap`, `PlacementCode` and its wire names, `PlacementValidator.Validate`, `PlacementResult`, `SiteSummary`. |
| `engine/Magnate.Engine/Land/SiteRules.cs` | Building category → placement rule (the caplab §5.9 table). |
| `engine/Magnate.Engine/Land/AutoSiter.cs` | `FindSites` (ranked, valid, non-overlapping) and `SitePreference`. |
| `engine/Magnate.Engine/Land/LandWire.cs` | Wire names and codes (zones, districts, kinds, per-plot char codes) and `LandUses` (ambient kind or building category → `LandUse`). |
| `engine/Magnate.Engine/Land/Generation/*.cs` | Internal pipeline `LayoutBuilder`: Terrain (R_u, river, hills, sea, quays, CBD), Roads (avenues, waterfront and embankment roads, local streets, deep-block splitter, connectivity repair, bridge unification), Zoning (rings, wedge, strips, reservations, deposits), Lots, Development (ambient buildings, storeys, freeze). `LayoutRandom` holds the per-stage seeded streams. |
| `engine/Magnate.Bridge/GameSession.CityLayout.cs` | `cityLayout` bridge method and DTOs. |
| `engine/Magnate.Engine.Tests/Land/*.cs` | 476 test cases: invariants × 5 cities × 4 seeds, identities, fields, placement, siting, determinism, performance. |
| `engine/Magnate.Bridge.Tests/CityLayoutTests.cs` | 11 bridge tests: registration, spec shape per city, extensions, cache and determinism, game seed, errors, payload size. |
| `tools/LayoutPreview/` | Standalone PNG renderer, benchmark and siting report. Not in `Magnate.sln`. |
| `docs/overhaul/status/e3a-citygen/*.png` | The inspected previews (§5). |

## 2. Engine API (for E3b, the AI, the bridge and Wave 2)

```csharp
CityLayout layout = CityLayoutGenerator.Generate(city, seed);         // pure, deterministic, ~25–40 ms for Metropolis (Release)
PlacementResult r = PlacementValidator.Validate(layout, occupancy, type, px, pz, rotation /*0|90|180|270*/, fields /*optional*/);
IReadOnlyList<SiteCandidate> s = AutoSiter.FindSites(layout, occupancy, type, SitePreference.Auto, count /*≤50*/, fields);
CityFields f = CityFields.Compute(layout, uses /*LandUse per plot*/, attractors);  // monthly recompute (Wave 2)
```

- **`IPlotOccupancy`** has one method, `int? BuildingAt(px, pz)`. The World implements it in Wave 2 (E3b). Until then, tools, tests and the bridge use `PlotOccupancyMap` (`Occupy(id, rect)` / `Release(id)`). Ambient buildings are *not* occupancy. Building over one costs `RedevelopmentCost`, a buy-out of the whole parcel's structure.
- **`PlacementResult`** fields: `Ok`, `Issues[]` (`Code`, `CodeName`, `Message`, `At`), `Footprint` (with rotation applied), `Rotation`, `LandCost`, `RedevelopmentCost`, `SiteCost`, `ParcelIds`, and `Site`. `Site` holds `Traffic`, `PeakTraffic`, `LocationFactor`, `DistanceToCbd`, `Frontage`, `District`, `MaxSlope`, `Waterfront`, `LandValuePerPlot`, `DepositId`, `DepositQuality` and `DepositReserve`; it is null when the footprint is out of bounds.
- **Codes:** `OUT_OF_BOUNDS`, `OCCUPIED`, `ROAD`, `WATER`, `ZONE`, `NEEDS_ROAD`, `NEEDS_COAST`, `NEEDS_DEPOSIT`, `NOT_ARABLE` and `SLOPE`. `ROAD` (the footprint covers a road) is an E3a addition matching bridge-spec `placementIssue: 'road'`. One issue is reported per code, most fundamental first.
- **Site rules** (caplab §5.9; the zone checks run per plot, and the strictest frontage wins):

  | Category | Allowed districts | Frontage | Geography |
  |---|---|---|---|
  | Retail ≤ 2×2 | CBD, commercial, mixed; apartments | local; collector on apartments | — |
  | Retail 3×3–4×4 | CBD, commercial, mixed | collector or better | — |
  | Factory, warehouse | industrial, port | collector | — |
  | Seaport | port, fronting the sea along its short side | local | coastal |
  | Farm, plantation | rural | local | arable (livestock excepted) |
  | Mine, oil well | rural, entirely on a matching onshore deposit | local | resource |
  | Media, hotel | CBD, commercial, mixed | local | — |
  | Office, HQ, bank | CBD, commercial, mixed | collector | — |
  | R&D | CBD, commercial, mixed, industrial | local | — |
  | Apartments (real estate) | apartments, mixed, commercial, CBD, houses (≤ 2×2) | local | — |

  Parks, civic land, landmarks, beaches and unparcelled land are never buildable. Deposit land is reserved for extraction. Slope class 3, or class 2 under a footprint larger than 2×2, fails with `SLOPE`.
- **`SitePreference`:** `Auto` (category default), `MaxTraffic`, `Cheapest`, `BestDeposit`, `NearCbd`, `NearPort` and `BestValue` (location factor per dollar of construction + land + redevelopment). The `Auto` defaults are: retail, media, office and hotel → `BestValue`; extraction → `BestDeposit`; industry and logistics → `NearPort`; everything else → `Cheapest`. Each candidate is rotated to face its best road (a seaport faces the water).
- **Fields for Wave 2:** `CityFields.Compute(layout, uses, attractors)` recomputes land value and traffic once company buildings change land uses. Override the covered plots with `LandUses.ForCategory(type.Category)` and pass `CityFields.AmbientAttractors(layout)` plus the company malls. Pass the result as `fields` to `Validate` / `FindSites`. `layout.Fields` is the snapshot at generation time.

### Land value (whole 2026 $ per 24 m plot)

```
LV = BaseLandPrice·1000 · C(d) · Z(district, use) · (1 + 0.004·Traffic) · N · W · S   [+ deposit premium]
C(d) = 0.25 + 2.75·exp(−(d / (0.45·R_u))²)            Z: CBD/commercial/mixed 1.0, apartments 0.9, houses 0.8, civic/park 0.8,
N = clamp(1 + Σ_{r≤4} w(use)/16, 0.7, 1.6)               port 0.6, industrial 0.55, rural farm 0.15 / forest 0.2 / other 0.1
W = 1.2 within 2 plots of water (not industry/port)    S = 1 − 0.1·slope (+0.1 hill views in Hilltown housing)
deposit premium = BaseLandPrice·1000 · (0.5 + 1.5·quality/100) · (1.2 for oil)
```

This is caplab §5.4. `BaseLandPrice` is read as $ thousands per plot (econ §4.3). Calibration with seed 1, medians per plot:

| City (base) | CBD (peak) | Commercial | Apartments | Houses | Industrial | Rural |
|---|---|---|---|---|---|---|
| Metropolis (150) | $605k ($677k) | $417k | $117k | $41k | $33k | $5.8k |
| Riverside (100) | $386k ($439k) | $199k | $101k | $26k | $15k | $3.8k |
| Eastside (180) | $788k ($807k) | $568k | $344k | $54k | $31k | $7.0k |
| Portbay (80) | $316k ($329k) | $209k | $154k | $22k | $13k | $2.1k |
| Hilltown (250) | $977k ($1.11M) | $575k | $358k | $74k | $34k | $9.1k |

The caplab Metropolis targets are CBD ≈ $790k, urban edge ≈ $35k, mid-distance industry ≈ $58k and farmland ≈ $5.6k. Our CBD is about 20% low and our industry sits further out than caplab's row. Hilltown and Eastside have the dearest downtowns because their content `baseLandPrice` is higher.

### Traffic (0–100 per plot)

`T = clamp(100·[0.50·exp(−(d/(0.35·R_u))²) + 0.20·RoadFactor + 0.30·Density_r4], 0, 100)`, plus attractor boosts (max 35), then a 3×3 blur.

- **RoadFactor:** arterial 1.0, highway 0.8, collector 0.6, local 0.3.
- **Density weights:** office/retail 1.0, apartment 0.8, civic 0.6, parking 0.5, house 0.4, industry 0.2, park 0.15, extraction 0.1.
- **Location factor:** `L = clamp(T / median urban T, 0.3, 2.5)` (econ §4.3).

## 3. Bridge: `cityLayout`

- **Signature:** `[BridgeMethod("cityLayout", RequiresGame = false)]` with args `{ cityId: string, seed?: number }`.
  - `seed` applies only when no game is running; the default is 1.
  - With a game running, the method uses `ActiveLayoutSeed()`. That is also 1 for now; see Requests.
- **Caching:** the engine layout and the DTO are cached per (cityId, seed). The cache is dropped when `init` loads a new catalog.
- **Errors:** `BadRequest` (missing `cityId`) and `NotFound` (unknown city).
- **Payload sizes (JSON):** Metropolis 328 kB, Riverside 197 kB, Eastside 162 kB, Portbay 108 kB, Hilltown 98 kB.

**`CityLayoutDto` fields, in order.** The first eight are bridge-spec §8.1, with names unchanged. The rest are additions.

| Field | Type | Notes |
|---|---|---|
| `cityId` | string | |
| `layoutRev` | number | 1 while generated; bumps with land sales and construction (Wave 2) |
| `gridW`, `gridH` | number | plots |
| `roads` | `RoadDto[]` | `{id, kind: highway\|arterial\|street, path: {px,pz}[], lanes, roadClass: local\|collector\|arterial\|highway, bridge?: true}`. Straight segments; they overlap at intersections; every plot is listed. |
| `parcels` | `ParcelDto[]` | §8.1 `{id, px, pz, w, h, zone, landValuePerPlot, ownerId?, buildingId?, forSale, askingPrice?, traffic}` plus `district`, `facing` (0 S, 1 E, 2 N, 3 W, as in art §3.2), `frontage?`, `vacant`, `depositId?`, `landmark?`. `zone` ∈ residential, commercial, industrial, agricultural, port, park, civic. |
| `water` | `WaterRectDto[]` | `{px, pz, w, h, kind: sea\|river\|lake, shore?: beach\|quay}` (art §5.3 request 2) |
| `ambient` | `AmbientDto[]` | `{parcelId, kind, floors, variant 0–7}`. Kinds: house, rowhouse, villa, apartment, midrise, office, shop, strip_mall, park, plaza, parking, field, forest, orchard, vineyard, pasture, scrub, `civic:<hall\|exchange\|bank\|school\|hospital\|police\|fire\|university\|stadium\|church\|port>`, `deposit:<iron\|oil>`, plus the E3a industrial kinds factory, warehouse and tank_farm. |
| `seed` | number | art request 4 |
| `climate` | string | temperate, warm, cold or arid (art request 4) |
| `terrain?` | `{heights: number[]}` | (gridW+1)·(gridH+1) corner heights in m, row-major by corner row, water surface at 0 m. Present for Riverside and Hilltown only (art request 1). |
| `plots` | `LayoutPlotsDto` | per-plot data, row-major (`i = pz·gridW + px`); see the encoding below |
| `landmarks` | `{kind, parcelId, px, pz, w, h}[]` | kind: cityHall, stockExchange, bank, investmentBank, port, university, stadium, hospital, centralPark |
| `deposits` | `{id, resource: iron\|oil, px, pz, w, h, quality, reserve, offshore}[]` | offshore deposits are visual only (rigs) |
| `cbd` | `{x, z}` | plot space; plot centres sit at +0.5 |
| `urbanRadius` | number | R_u in plots |
| `medianTraffic` | number | the denominator of the location factor |
| `generatorVersion` | number | currently 1 |
| `profile` | string | city id, or `generic` |
| `plotSize` | number | 24 (m) |

**`plots` encoding.** Strings carry one character per plot; arrays carry one number per plot.

| Field | Format | Values |
|---|---|---|
| `kinds` | string | `p` parcel, `r` road, `b` bridge, `s` sea, `v` river, `l` lake, `h` beach, `o` open land |
| `roads` | string | `0` none, `1` local, `2` collector, `3` arterial, `4` highway |
| `districts` | string | `.` none, `C` CBD, `c` commercial, `m` mixed, `a` apartments, `h` houses, `i` industrial, `p` port, `g` rural, `k` park, `v` civic |
| `slopes?` | string | `0`–`3`; hilly cities only |
| `landValue` | number[] | whole $ (0 on roads, water and beaches) |
| `traffic` | number[] | 0–100, one decimal place |

**Differences from the spec for B1 and the lead to reconcile in `protocol.ts`:**

- `RoadDto.path` uses `{px, pz}` without the rotation of `PlotRefDto`.
- `WaterRectDto` gains `kind` and `shore`.
- `RoadDto` gains `roadClass` and `bridge`.
- `ParcelDto` gains `district`, `facing`, `frontage`, `vacant`, `depositId` and `landmark`.
- `AmbientDto.kind` is the extended union above.
- Null fields are omitted on the wire (`ownerId`, `buildingId`, `askingPrice`, `frontage`, `depositId`, `landmark`, `bridge`, `shore`, `terrain`, `slopes`).

## 4. City identities (`CityProfiles`)

| City | Identity | Key features (seed 1) |
|---|---|---|
| Metropolis | Coastal capital | Bay to the east with the CBD on the waterfront. Offices of 18–60 floors. Stock exchange, investment bank, container port and quays. Industrial wedge to the south-east, farmland to the west, 3 highways (6 lanes). |
| Riverside | River city | N–S river through the CBD, 5 bridges, valley terrain up to 36 m, iron deposits in the hills, mills along the downstream banks. |
| Eastside | Affluent, arable | Villas outnumber rowhouses, many parks, little industry, a farmland ring. |
| Portbay | Warm port city | Sea to the south, a harbour basin with quays, 5 onshore and 2 offshore oil fields, tank farms, scrub instead of farms (not arable). |
| Hilltown | Hill town | Plateau about 26 m high with the CBD on the hilltop, slopes of class 2–3 on the flanks, vineyards and forest. Small, expensive downtown. |
| *modded* | `generic` | Coast, river, deposits and farms follow the geography flags; size follows population. Covered by a test. |

The following hold in every city and seed (all tested):

- Deposits exist exactly where the geography flags say: iron only if mineralRich, oil only if oilRich.
- Farmland exists only if the city is arable; water and port parcels only if coastal.
- Districts follow the rings outward from the CBD: CBD, commercial, apartments, houses, then rural, with an industrial wedge.
- Main-street strips (mixed) line the avenues.
- Every city reserves up to 2–7 shopping-centre sites at avenue crossings (one per ~70k people; a site is skipped when no block fits) and 1–3 vacant industrial estates (one per ~150k people) that take a 5×5 factory.

## 5. Verification

**Gates**

- `dotnet build Magnate.sln` gives 0 errors. The 217 CS1591 warnings are pre-existing, in files outside E3a ownership; Land files have none.
- `dotnet test Magnate.sln --no-build`: Magnate.Engine.Tests passed 707/707 (476 of them Land), Magnate.Bridge.Tests passed 17/17 (11 of them CityLayout).

**Tests cover:**

- determinism (identical hash for the same seed, different hash for different seeds, no hidden state);
- one connected road network;
- no 2×2 road squares;
- every parcel touches a road;
- parcels tile their plots;
- the road list matches the grid;
- bridges run bank to bank in one class (new);
- water rects cover the water;
- fields are in range and highways reach the map edge;
- landmarks exist;
- identities and rings, and land value falling from the CBD;
- real 2026 land magnitudes;
- placement for all 18 building types (valid site; out of bounds, road and occupied rejections);
- zoning, public land, arable, deposits, seaport, slope and frontage rules, redevelopment cost, rotation;
- `AutoSiter`:
  - finds non-overlapping valid sites for every type in some city, and finds none for impossible ones (e.g. a seaport in Hilltown or Riverside, an oil well in Eastside, a farm in Portbay);
  - every city keeps at least 2 supermarket sites and one buy-out-free 5×5 factory site (new);
- performance: Metropolis under 50 ms in Release, under 500 ms in the Debug gate.

**Performance:** Release, `tools/LayoutPreview --bench`. The machine was shared with 7 other engineers at load average 18–22, so these are noisy minimums.

| City | Best of N |
|---|---|
| Metropolis | 26–40 ms |
| Riverside | 11–19 ms |
| Eastside | 18–24 ms |
| Portbay | 8–13 ms |
| Hilltown | 7–12 ms |

`PlaceReservations` (about 10 ms) and lot building (about 8 ms) are the largest stages.

**Preview PNGs** (`docs/overhaul/status/e3a-citygen/`, seed 1, 10 px per plot). All 20 were read and inspected:

| City | Zones (parcels, roads, landmarks in cyan, deposits hatched) | Land value (log heat map) | Traffic | Districts |
|---|---|---|---|---|
| Metropolis | `metropolis.png` | `metropolis-landvalue.png` | `metropolis-traffic.png` | `metropolis-districts.png` |
| Riverside | `riverside.png` | `riverside-landvalue.png` | `riverside-traffic.png` | `riverside-districts.png` |
| Eastside | `eastside.png` | `eastside-landvalue.png` | `eastside-traffic.png` | `eastside-districts.png` |
| Portbay | `portbay.png` | `portbay-landvalue.png` | `portbay-traffic.png` | `portbay-districts.png` |
| Hilltown | `hilltown.png` (hill-shaded) | `hilltown-landvalue.png` | `hilltown-traffic.png` | `hilltown-districts.png` |

Regenerate with:

```
dotnet run -c Release --project tools/LayoutPreview -- --modes zones,landvalue,traffic,districts [--sites] [--seed N]
```

Other options: `--bench N` and `--probe type,x,z,rot`.

**Problems found by inspection and fixed in this session:**

1. **Bridges changed class mid-river.** For example, a Riverside avenue's bridge ended one plot short and its last span was a local street. Fix: a new `UnifyBridgeClasses` pass stretches the highest class over the whole crossing, onto the road plot on each bank. A new invariant test covers this.
2. **Downtowns of the smaller cities were 1-storey shops.** Riverside's CBD had 6 one-floor shops and 1 mid-rise. Fix: small CBD lots now get mid-rise blocks and narrow offices, and commercial lots get more mid-rise. Seed 1 CBDs are now: Riverside 2 offices (up to 27 floors), 1 mid-rise and 2 shops; Eastside and Portbay 2 mid-rise each; Metropolis 7 towers (up to 50 floors). Vacant CBD lots remain on purpose, for the player.
3. **Big sites were scarce and expensive.** The siting report showed only 1–2 supermarket sites in mid-size cities, and the "best" large-factory site needed a $21.6M buy-out of an ambient factory. Fixes:
   - more shopping-centre reservations (one per 70k people instead of one per 125k);
   - more industrial estates (one per 150k people);
   - estates are always vacant;
   - a new test guards site capacity.

Previously verified and unchanged: rings, the industrial wedge, the waterfront CBD, quays and the port basin, the river valley, the Hilltown plateau, offshore rigs and the farmland ring.

## 6. Known gaps

- **Ring shares are below the caplab targets.**
  - Metropolis: apartments 4.4% (target ~10%), commercial + mixed 6.5% (target ~7%), industrial 5.7% (target ~9%). The sea takes half of the inner rings, and the civic, park and shopping-centre reservations sit in the apartment ring.
  - In the small cities (R_u ≈ 14–20 plots) the apartment ring is almost entirely reservations: apartments are 0.2–1.2% of plots. This is visually fine (mid-rise mixed use fills the role).
- **Big-box capacity is still modest outside Metropolis.** Disjoint supermarket sites: Metropolis 14–20, other cities 2–6; 5×5 factory sites: 1 in the small cities. The caplab rule keeps 3×3+ retail off residential land, and main-street strips are one lot deep. If playtests show crowding, the cheapest lever is to allow 3×3 retail on apartment land fronting an *arterial*; caplab's own message reads "retail allowed only on main streets". That is a rule change in `SiteRules`, so it is left for the lead to decide.
- **Redevelopment prices are placeholders.** They are per plot (house $320k, office $1M per floor, factory $600k, …), and an ambient factory costs more per plot to buy out than the Classic content's new `factory_large` costs to build. Wave 2 (E3b / econ) should rebalance them alongside construction costs.
- **Deposit land is priced high:** the premium is $100–200k per plot, so an iron-mine site in Riverside costs about $1.5M of land. This is caplab's `RES_COST` idea, simplified; Wave 2 should tune it with the commodity prices.
- **`layoutRev` is always 1.** Land sales and construction (Wave 2) must bump it and fill `ownerId` / `buildingId`.
- **The DTO is computed once per (city, seed);** it must be invalidated when Wave 2 starts mutating parcels.
- **No rail, lakes or bridges over the sea yet.** `WaterKind.Lake` exists, but no built-in city uses it.
- **Performance after the reservation increase:** the industrial-estate search is O(plots × sizes) and costs a few ms in Metropolis. This is within budget (Release best of N ≈ 26–40 ms on a loaded machine; WASM budget 300 ms) but is the first thing to optimise if needed.

## 7. Requests

1. **E0 / lead, layout seed.** Once `World` persists its seed (schema v10), `GameSession.ActiveLayoutSeed()` in `GameSession.CityLayout.cs` should return a per-game layout seed instead of `CityLayoutGenerator.DefaultSeed`.
   - Recommended: a dedicated `layoutSeed` saved in the world. Layouts must not change across save/load, and a v1–v9 save should keep seed 1.
   - This is E3a's file, but it needs E0's API, so it is a one-line follow-up after the merge.
2. **B1, `protocol.ts`.** Mirror the DTO in §3: the extra fields, the `plots` string encodings and `{px, pz}` road paths. Optionally copy `climate` and `seed` onto `CityOverviewDto` (art §5.3 request 4 named that DTO; E3a put them on `CityLayoutDto`).
3. **E3b (Wave 2):**
   - implement `IPlotOccupancy` on `World`;
   - call `PlacementValidator.Validate` in `Construct(…, PlotRef at)`, and `AutoSiter.FindSites` when `at` is omitted (AI too);
   - recompute `CityFields` monthly with company land uses and attractors, and pass the snapshot to validation and siting;
   - charge `LandCost` + `RedevelopmentCost`; bump `layoutRev`.
4. **W2 (renderer).**
   - Decode `plots` strings by index.
   - Bridges are `kinds[i] == 'b'`, and `RoadDto.bridge` marks bridge segments.
   - Use `terrain.heights` for Hilltown and Riverside.
   - Unknown ambient kinds should fall back to house or park (art §5.3), including `factory`, `warehouse`, `tank_farm` and `vineyard` if not modelled yet.
5. **Lead, design decision.** Whether to allow 3×3 retail on apartment land fronting an arterial (see Known gaps).
