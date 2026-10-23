// Instanced prop families used by the W4 assets (art bible §4.2, §4.3 vehicles/containers/port ambience).
// Authoring frame (Instancing.ts PropFamily): origin on the ground at the prop centre, forward / long axis +Z.
// Faces written with tint 255 on a white base take the per-instance colour (owner truck cabs, container paint, car
// bodies, canopy tint); tint 0 faces keep their own colour. Budgets are per instance and enforced by unit tests.
import { FLAG_VEGETATION } from '../../../materials/CityMaterial';
import { Facade, FACE_NX, FACE_NZ, FACE_PX, FACE_PZ, FACE_SIDES, FACE_TOP, type GeoBuilder, type RGB } from '../../GeoBuilder';
import { LOD_BANDS, type PropFamily } from '../../Instancing';
import { ASSET_RGB, CONTAINER_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import * as S from '../../shapes';

const WHITE: RGB = [255, 255, 255];
const DARK = ASSET_RGB.dockShelter;
const CONTACT = ASSET_RGB.contact;
const GLASS = hexRgb('#39424C');
const TRAILER = WORLD_RGB.vehicles.trailer;
const YELLOW = ASSET_RGB.haulTruck;

function tinted(b: GeoBuilder, tint: number, fn: () => void): void {
  const prev = b.tint;
  b.tint = tint;
  try { fn(); } finally { b.tint = prev; }
}

/** Contact shadow quad 2 cm above the ground (vehicles never cast shadows; art §3.10). */
function contact(b: GeoBuilder, hw: number, hl: number): void {
  tinted(b, 0, () => b.quad([-hw, 0.02, hl], [hw, 0.02, hl], [hw, 0.02, -hl], [-hw, 0.02, -hl], [0, 1, 0], CONTACT));
}

/** 40 ft ISO container 12.19 × 2.44 × 2.59 m (§4.2.8), 10 triangles; the door end (−Z) is a shade darker. */
function buildContainer(b: GeoBuilder): void {
  tinted(b, 255, () => {
    b.boxFaces(-1.22, 0, -6.095, 1.22, 2.59, 6.095, FACE_PZ | FACE_PX | FACE_NX | FACE_TOP, WHITE, hexRgb('#E2E2E2'));
    b.boxFaces(-1.22, 0, -6.095, 1.22, 2.59, 6.095, FACE_NZ, hexRgb('#C8C8C8'));
  });
}

type TrailerKind = 'box' | 'reefer' | 'tanker' | 'hopper';

/** Cab-over tractor unit with a 13.6 m semi-trailer (§4.3 company trucks: cab in owner colour, trailer by product). */
function buildSemi(b: GeoBuilder, kind: TrailerKind): void {
  contact(b, 1.35, 8.3);
  tinted(b, 0, () => {
    b.box(-1.1, 0.3, -8.0, 1.1, 1.15, 8.0, DARK, DARK); // chassis + wheels band
    b.box(-1.25, 0.3, 5.7, 1.25, 1.0, 8.15, DARK, DARK); // cab chassis / bumper
  });
  tinted(b, 255, () => b.box(-1.25, 1.0, 5.75, 1.25, 3.55, 8.05, WHITE, shade(WHITE, 0.92))); // cab (owner colour)
  tinted(b, 0, () => {
    b.quad([-1.1, 2.2, 8.07], [1.1, 2.2, 8.07], [1.1, 3.3, 8.07], [-1.1, 3.3, 8.07], [0, 0, 1], GLASS); // windscreen
    if (kind === 'tanker') {
      const silver = WORLD_RGB.wall.aluminium;
      S.cylinderAlong(b, [0, 2.45, -8.1], [0, 2.45, 5.2], 1.2, 8, silver, shade(silver, 0.9));
    } else if (kind === 'hopper') {
      const g = WORLD_RGB.industry.galvanized;
      b.box(-1.27, 2.0, -8.2, 1.27, 3.6, 5.3, g, shade(g, 0.85));
      b.box(-0.8, 1.15, -7.6, 0.8, 2.0, 4.6, shade(g, 0.8), shade(g, 0.8));
    } else {
      const body = kind === 'reefer' ? hexRgb('#F4F4F0') : TRAILER;
      b.box(-1.27, 1.15, -8.25, 1.27, 4.0, 5.35, body, shade(body, 0.95));
      if (kind === 'reefer') b.box(-0.9, 2.6, 5.35, 0.9, 3.7, 5.75, WORLD_RGB.industry.silver, WORLD_RGB.industry.silver); // fridge unit
    }
  });
}

/** Semi-trailer parked at a dock (no tractor), with landing legs; body takes the instance colour. */
function buildTrailer(b: GeoBuilder): void {
  contact(b, 1.3, 6.9);
  tinted(b, 0, () => {
    b.box(-1.1, 0.3, -6.6, 1.1, 1.15, -2.6, DARK, DARK); // rear bogie
    b.boxFaces(-1.0, 0.0, 4.2, -0.8, 1.15, 4.5, FACE_SIDES, DARK); // landing legs (tops hidden under the body)
    b.boxFaces(0.8, 0.0, 4.2, 1.0, 1.15, 4.5, FACE_SIDES, DARK);
  });
  tinted(b, 255, () => b.box(-1.27, 1.15, -6.8, 1.27, 4.0, 6.8, WHITE, shade(WHITE, 0.94)));
}

/** Parked sedan 4.5 × 1.8 × 1.45 m (§4.3), body in the instance colour. */
function buildCar(b: GeoBuilder): void {
  contact(b, 0.95, 2.3);
  tinted(b, 255, () => {
    b.box(-0.9, 0.22, -2.25, 0.9, 0.82, 2.25, WHITE, WHITE);
    b.quad([-0.74, 1.44, 0.9], [0.74, 1.44, 0.9], [0.74, 1.44, -1.05], [-0.74, 1.44, -1.05], [0, 1, 0], WHITE); // roof
  });
  tinted(b, 0, () => b.boxFaces(-0.8, 0.82, -1.2, 0.8, 1.43, 1.05, FACE_SIDES, GLASS)); // cabin glass
}

/** Farm tractor (§4.2.9): green body, red wheels. */
function buildTractor(b: GeoBuilder): void {
  const body = ASSET_RGB.tractor, wheel = ASSET_RGB.tractorWheel, tyre = DARK;
  contact(b, 1.2, 2.2);
  tinted(b, 0, () => {
    b.box(-0.55, 0.8, 0.1, 0.55, 1.75, 2.2, body, body); // bonnet
    b.box(-0.8, 0.8, -1.4, 0.8, 1.2, 0.2, body, body); // footplate
    b.boxFaces(-0.75, 1.2, -1.3, 0.75, 2.85, 0.15, FACE_SIDES, GLASS); // cab glass
    b.box(-0.82, 2.85, -1.4, 0.82, 2.98, 0.25, body, body); // cab roof
    for (const x of [-1.0, 1.0]) {
      S.cylinderAlong(b, [x - 0.25 * Math.sign(x), 0.88, -0.75], [x + 0.25 * Math.sign(x), 0.88, -0.75], 0.88, 8, tyre, wheel);
      S.cylinderAlong(b, [x * 0.82 - 0.17 * Math.sign(x), 0.5, 1.7], [x * 0.82 + 0.17 * Math.sign(x), 0.5, 1.7], 0.5, 6, tyre, wheel);
    }
  });
}

/** Mine haul truck 6 × 3.5 × 3.8 m in #E0B43A (§4.2.12). */
function buildHaulTruck(b: GeoBuilder): void {
  contact(b, 1.8, 3.1);
  tinted(b, 0, () => {
    for (const [x, z] of [[-1.35, -1.9], [1.35, -1.9], [-1.35, 1.9], [1.35, 1.9]] as const) b.box(x - 0.42, 0, z - 0.75, x + 0.42, 1.5, z + 0.75, DARK, DARK);
    b.box(-1.2, 0.7, -2.6, 1.2, 1.6, 2.8, shade(YELLOW, 0.7), shade(YELLOW, 0.7)); // frame
    S.prism(b, [[-1.75, -3.0], [1.75, -3.0], [1.75, 1.4], [-1.75, 1.4]], 1.6, 3.4, YELLOW, shade(YELLOW, 0.82), null, false); // dump body
    b.box(-1.75, 1.6, -3.0, 1.75, 1.65, 1.4, shade(YELLOW, 0.6), shade(YELLOW, 0.6)); // load floor (seen from above)
    S.mound(b, 0, -0.8, 1.4, 1.8, 0.9, 6, ASSET_RGB.ore, 3.0); // ore load
    b.box(0.2, 1.6, 1.5, 1.6, 3.8, 2.9, YELLOW, YELLOW); // cab
    b.quad([0.3, 2.7, 2.92], [1.5, 2.7, 2.92], [1.5, 3.6, 2.92], [0.3, 3.6, 2.92], [0, 0, 1], GLASS);
  });
}

/** Construction dump truck (§4.3 construction vehicles). */
function buildDumpTruck(b: GeoBuilder): void {
  contact(b, 1.3, 3.8);
  tinted(b, 0, () => {
    b.box(-1.1, 0.3, -3.6, 1.1, 1.1, 3.6, DARK, DARK);
    b.box(-1.25, 1.1, 1.6, 1.25, 3.1, 3.7, YELLOW, YELLOW); // cab
    b.quad([-1.1, 2.1, 3.72], [1.1, 2.1, 3.72], [1.1, 2.9, 3.72], [-1.1, 2.9, 3.72], [0, 0, 1], GLASS);
    const bodyCol = shade(YELLOW, 0.86);
    b.box(-1.3, 1.1, -3.7, 1.3, 2.7, 1.4, bodyCol, shade(bodyCol, 0.75));
    S.mound(b, 0, -1.1, 1.0, 2.0, 0.7, 6, WORLD_RGB.ground.soilDark, 2.7);
  });
}

/** Straddle carrier (§4.2.8, 12 × 8 × 15 m class): portal legs over a container row. */
function buildStraddleCarrier(b: GeoBuilder): void {
  const frame = hexRgb('#DCD8CE'), red = hexRgb('#C8503C');
  contact(b, 2.9, 5.2);
  tinted(b, 0, () => {
    for (const x of [-2.6, 2.6]) {
      b.box(x - 0.35, 0, -5.0, x + 0.35, 1.2, 5.0, DARK, DARK); // wheel girders
      S.beam(b, [x, 1.2, -4.2], [x, 13.6, -3.6], 0.5, 0.5, frame, 4);
      S.beam(b, [x, 1.2, 4.2], [x, 13.6, 3.6], 0.5, 0.5, frame, 4);
      S.beam(b, [x, 13.6, -3.8], [x, 13.6, 3.8], 0.7, 0.7, frame, 4);
    }
    b.box(-2.9, 13.3, -4.2, 2.9, 14.3, -2.6, frame, frame); // top cross girders
    b.box(-2.9, 13.3, 2.6, 2.9, 14.3, 4.2, frame, frame);
    b.box(-1.5, 14.3, -2.4, 1.5, 15.2, 1.0, red, red); // engine house
    b.box(1.8, 11.8, 2.6, 3.0, 13.6, 4.2, red, red); // cab
    b.quad([1.8, 12.4, 4.22], [3.0, 12.4, 4.22], [3.0, 13.4, 4.22], [1.8, 13.4, 4.22], [0, 0, 1], GLASS);
  });
}

/** Reach stacker: container handler with an inclined telescopic boom and spreader. */
function buildReachStacker(b: GeoBuilder): void {
  const body = hexRgb('#C8503C');
  contact(b, 2.0, 5.6);
  tinted(b, 0, () => {
    b.box(-1.9, 0.0, -5.0, 1.9, 1.6, 3.2, DARK, DARK); // chassis / tyres
    b.box(-1.8, 1.6, -5.4, 1.8, 3.0, 2.6, body, body); // body + counterweight
    b.box(-0.9, 3.0, -0.2, 0.9, 5.2, 2.0, body, body); // cab
    b.quad([-0.8, 3.8, 2.02], [0.8, 3.8, 2.02], [0.8, 5.0, 2.02], [-0.8, 5.0, 2.02], [0, 0, 1], GLASS);
    S.beam(b, [0, 3.0, -4.0], [0, 9.0, 5.2], 0.9, 1.0, shade(body, 0.9), 4, true); // boom
    b.box(-6.1, 8.4, 5.0, 6.1, 9.0, 6.4, YELLOW, YELLOW); // spreader across the boom
  });
}

/** Warehouse forklift (§4.2.6). */
function buildForklift(b: GeoBuilder): void {
  const body = WORLD_RGB.industry.safetyYellow;
  contact(b, 0.7, 1.6);
  tinted(b, 0, () => {
    b.box(-0.6, 0.15, -1.3, 0.6, 1.2, 0.8, body, body);
    b.box(-0.6, 1.2, -1.3, 0.6, 1.5, -0.6, DARK, DARK); // counterweight top
    for (const x of [-0.55, 0.55]) S.beam(b, [x, 0, 0.0], [x, 2.15, -0.1], 0.08, 0.08, DARK, 3); // overhead guard posts
    b.box(-0.62, 2.1, -0.9, 0.62, 2.18, 0.2, DARK, DARK);
    b.box(-0.45, 0.1, 0.85, 0.45, 2.9, 1.0, DARK, DARK); // mast
    b.boxFaces(-0.4, 0.1, 1.0, 0.4, 0.18, 2.1, FACE_TOP | FACE_PZ, DARK); // forks (thin: top and tips only)
  });
}

/** Wrapped pallet load 1.2 × 1.0 m, goods colour from the instance. */
function buildPallet(b: GeoBuilder): void {
  tinted(b, 0, () => b.box(-0.6, 0, -0.5, 0.6, 0.15, 0.5, hexRgb('#A8835A'), hexRgb('#B89363')));
  tinted(b, 255, () => b.box(-0.57, 0.15, -0.47, 0.57, 1.3, 0.47, WHITE, shade(WHITE, 0.94)));
}

/** Steel coil (metal factory coil yard): Ø1.8 × 1.5 m, axis along X. */
function buildCoil(b: GeoBuilder): void {
  const steel = hexRgb('#8E959C');
  tinted(b, 0, () => S.cylinderAlong(b, [-0.75, 0.9, 0], [0.75, 0.9, 0], 0.9, 8, steel, shade(steel, 0.8)));
}

/** Feeder container ship at berth (§4.2.8): hull 140 × 22 m, stern superstructure, 6 × 14 × ≤3 deck stacks. Neutral
 *  livery (shipping lines are not companies). Waterline at y ≈ −0.35 (sea plane, art §3.11). */
function buildFeederShip(b: GeoBuilder): void {
  const hull = ASSET_RGB.hull, red = ASSET_RGB.antifouling, deck = hexRgb('#6E7C6A');
  const outline: [number, number][] = [[-11, -70], [11, -70], [11, 44], [7, 60], [0, 70], [-7, 60], [-11, 44]];
  tinted(b, 0, () => {
    S.prism(b, outline, -1.6, 0.5, red, red, null, false);
    S.prism(b, outline, 0.5, 6.0, hull, deck);
    // forecastle bulwark and bow
    S.prism(b, [[-10.6, 44], [10.6, 44], [6.8, 59.5], [0, 69.4], [-6.8, 59.5]], 6.0, 7.6, hull, shade(deck, 0.9));
    // stern superstructure 20 × 16 × 18 m, warm white, with a lit bridge deck
    b.box(-8, 6, -66, 8, 22.5, -48, WORLD_RGB.wall.warmWhite, hexRgb('#D7D2C8'), [Facade.OFFICE, 7, 30, 22]);
    b.box(-11, 21.4, -52.5, 11, 23.4, -48.5, WORLD_RGB.wall.warmWhite, hexRgb('#D7D2C8')); // bridge wings
    b.box(-2.2, 22.5, -64.5, 2.2, 28.5, -59.5, hexRgb('#2E3540'), hexRgb('#2A2F36')); // funnel
    b.box(-2.25, 26.2, -64.55, 2.25, 27.4, -59.45, red, red); // funnel band
    // deck cargo: 14 bays of 20 ft stacks × 6 rows, 1–3 tiers, deterministic pattern
    for (let bay = 0; bay < 14; bay++) {
      const z0 = -44 + bay * 6.35, z1 = z0 + 6.06;
      for (let row = 0; row < 6; row++) {
        const tiers = 1 + ((bay * 7 + row * 3 + (bay % 3)) % 3 === 0 ? 0 : (bay + row) % 2 === 0 ? 2 : 1);
        const x0 = -7.4 + row * 2.48, x1 = x0 + 2.44;
        const col = CONTAINER_RGB[(bay * 5 + row * 3 + tiers) % CONTAINER_RGB.length];
        b.boxFaces(x0, 6, z0, x1, 6 + 2.59 * tiers, z1, FACE_SIDES | FACE_TOP, col, shade(col, 0.93));
      }
    }
  });
}

/** Coffee shrub Ø1.8 × 1.6 m (§4.2.11); `cherries` adds red fruit for the Sep–Nov harvest. */
function buildShrub(b: GeoBuilder, cherries: boolean): void {
  const leaf = WORLD_RGB.crops.coffee;
  const prev = b.flags;
  b.flags = prev | FLAG_VEGETATION;
  tinted(b, 255, () => S.blob(b, 0, 0.82, 0, 0.92, 0.8, 0.92, 3, 6, leaf));
  b.flags = prev;
  if (cherries) {
    tinted(b, 0, () => {
      const red = ASSET_RGB.cherry;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3, y = 0.6 + (i % 3) * 0.3, r = 0.9 - (i % 3) * 0.08;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        S.triOut(b, [x, y + 0.14, z], [x + 0.12 * Math.sin(a), y - 0.06, z - 0.12 * Math.cos(a)], [x - 0.12 * Math.sin(a), y - 0.06, z + 0.12 * Math.cos(a)], [Math.cos(a), 0.2, Math.sin(a)], red);
      }
    });
  }
}

/** Base crown colour of 'shadeTree': light enough that every seasonal leaf colour (greens, autumn ochre and rust, bare
 *  winter grey-brown) is reachable as base × instance colour (palette.tintHex). Always give shade-tree instances a
 *  colour (details.treeTint does); without one the crown shows this tan. */
export const TREE_BASE: RGB = hexRgb('#D0A870');

/** Round shade / windbreak tree (trunk Ø0.5, crown r 2.6). Crown colour = TREE_BASE × instance colour (season). */
function buildShadeTree(b: GeoBuilder): void {
  tinted(b, 0, () => S.cylinder(b, 0, 0, 0.26, 0, 3.2, 5, WORLD_RGB.vegetation.trunk, WORLD_RGB.vegetation.trunk, false));
  const prev = b.flags;
  b.flags = prev | FLAG_VEGETATION;
  tinted(b, 255, () => S.blob(b, 0, 4.6, 0, 2.7, 2.3, 2.7, 3, 7, TREE_BASE));
  b.flags = prev;
}

/** Mobile crane (§4.1, used instead of a tower crane when the building is ≤ 12 m): carrier + 25 m telescopic boom. */
function buildMobileCrane(b: GeoBuilder): void {
  contact(b, 1.5, 6.3);
  tinted(b, 0, () => {
    b.box(-1.3, 0.3, -6.0, 1.3, 1.4, 6.0, DARK, DARK);
    b.box(-1.35, 1.4, -6.0, 1.35, 2.2, 4.0, YELLOW, YELLOW); // carrier deck
    b.box(-1.3, 1.4, 4.0, 1.3, 3.3, 6.2, YELLOW, YELLOW); // cab
    b.quad([-1.15, 2.4, 6.22], [1.15, 2.4, 6.22], [1.15, 3.1, 6.22], [-1.15, 3.1, 6.22], [0, 0, 1], GLASS);
    for (const [x, z] of [[-2.6, -4.8], [2.6, -4.8], [-2.6, 3.0], [2.6, 3.0]] as const) b.box(x - 0.3, 0, z - 0.3, x + 0.3, 1.0, z + 0.3, DARK, DARK); // outriggers
    b.box(-1.2, 2.2, -4.0, 1.2, 3.6, -0.8, shade(YELLOW, 0.9), shade(YELLOW, 0.9)); // superstructure
    S.beam(b, [0, 3.2, -3.2], [0, 22.0, 13.0], 1.0, 1.1, YELLOW, 4, true); // telescopic boom (≈25 m)
    S.beam(b, [0, 22.0, 13.0], [0, 9.0, 13.0], 0.05, 0.05, DARK, 3); // hoist rope
    b.box(-0.4, 8.0, 12.6, 0.4, 9.0, 13.4, DARK, DARK); // hook block
  });
}

/** Excavator lower + upper body; the arm is the animated part 'excavatorArm' pivoting at (0, 1.9, 1.3). */
function buildExcavatorBody(b: GeoBuilder): void {
  contact(b, 1.6, 2.4);
  tinted(b, 0, () => {
    b.box(-1.6, 0, -2.3, -0.8, 0.9, 2.3, DARK, DARK); // tracks
    b.box(0.8, 0, -2.3, 1.6, 0.9, 2.3, DARK, DARK);
    b.box(-1.4, 0.9, -1.9, 1.4, 2.2, 1.3, YELLOW, YELLOW); // upper body
    b.box(-1.4, 0.9, -2.6, 1.4, 2.0, -1.9, shade(YELLOW, 0.75), shade(YELLOW, 0.75)); // counterweight
    b.box(0.1, 2.2, 0.0, 1.35, 3.6, 1.3, YELLOW, YELLOW); // cab
    b.quad([0.15, 2.6, 1.32], [1.3, 2.6, 1.32], [1.3, 3.5, 1.32], [0.15, 3.5, 1.32], [0, 0, 1], GLASS);
  });
}

function family(id: string, triBudget: number, castShadow: boolean, maxDistance: number, build: (b: GeoBuilder) => void): PropFamily {
  return { id, triBudget, castShadow, maxDistance, build };
}

/** Pivot of the excavator arm in the excavator body's frame (for factories placing both). */
export const EXCAVATOR_ARM_PIVOT = [0, 1.9, 1.3] as const;

/** Every prop family W4 assets emit. Ids are global (one InstancedMesh family each); see registry.propFamilyFor. */
export const PROPS_B: readonly PropFamily[] = [
  family('containers', 12, true, LOD_BANDS.vehicles, buildContainer),
  family('truckBox', 90, false, LOD_BANDS.vehicles, (b) => buildSemi(b, 'box')),
  family('truckReefer', 100, false, LOD_BANDS.vehicles, (b) => buildSemi(b, 'reefer')),
  family('truckTanker', 110, false, LOD_BANDS.vehicles, (b) => buildSemi(b, 'tanker')),
  family('truckHopper', 100, false, LOD_BANDS.vehicles, (b) => buildSemi(b, 'hopper')),
  family('trailer', 40, false, LOD_BANDS.vehicles, buildTrailer),
  family('parkedCars', 30, false, LOD_BANDS.parkedCars, buildCar),
  family('tractor', 160, false, LOD_BANDS.parkedCars, buildTractor),
  family('haulTruck', 140, false, LOD_BANDS.vehicles, buildHaulTruck),
  family('dumpTruck', 90, false, LOD_BANDS.vehicles, buildDumpTruck),
  family('straddleCarrier', 120, true, LOD_BANDS.vehicles, buildStraddleCarrier),
  family('reachStacker', 80, false, LOD_BANDS.vehicles, buildReachStacker),
  family('forklift', 60, false, LOD_BANDS.parkedCars, buildForklift),
  family('palletStack', 24, false, LOD_BANDS.parkedCars, buildPallet),
  family('coil', 40, false, LOD_BANDS.parkedCars, buildCoil),
  family('feederShip', 1100, true, 3200, buildFeederShip),
  family('coffeeShrub', 30, true, LOD_BANDS.treeLod1, (b) => buildShrub(b, false)),
  family('coffeeShrubCherry', 40, true, LOD_BANDS.treeLod1, (b) => buildShrub(b, true)),
  family('shadeTree', 50, true, LOD_BANDS.treeLod1, buildShadeTree),
  family('mobileCrane', 150, false, LOD_BANDS.vehicles, buildMobileCrane), // art §4.3 construction vehicles ≤ 150
  family('excavatorBody', 70, false, LOD_BANDS.vehicles, buildExcavatorBody),
];
