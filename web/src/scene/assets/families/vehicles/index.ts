// Moving-vehicle geometry family (W5, art §3.3 vehicle colours, §4.3 vehicles, §5.16 traffic): low-poly cars, vans,
// rigid box trucks, buses, taxis and a container ship, each with an LOD0 model and an LOD1 box (art §5.8: moving
// vehicles switch to a box beyond 500 m). Semi-trailer trucks reuse W4's PROPS_B semis (`truckBox`, `truckReefer`,
// `truckTanker`, `truckHopper`) so moving and parked trucks look the same.
//
// Authoring frame (as Instancing.ts PropFamily): origin on the ground at the vehicle centre, forward = +Z, metres.
// Faces written with tint 255 on a white base take the per-instance colour (car body, owner livery, bus livery);
// tint 0 faces keep their own colour (glass, tyres, lamps). Head and tail lamps carry emission (extra.x), which
// CityMaterial lights only at night. Vehicles never cast shadows: each model carries a contact-shadow quad (§3.10).
// Pure and deterministic: no randomness at all.
import { FACE_NX, FACE_PX, FACE_PZ, FACE_SIDES, FACE_TOP, type GeoBuilder, type RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import * as S from '../../shapes';

export type VehicleModelId = 'sedan' | 'hatchback' | 'suv' | 'van' | 'boxTruck' | 'bus' | 'taxi' | 'containerShip';

/** Which IDM parameter set (TrafficIdm) drives the model. */
export type VehicleClass = 'car' | 'truck' | 'bus' | 'ship';

export interface VehicleModel {
  readonly id: VehicleModelId;
  readonly cls: VehicleClass;
  /** Bumper-to-bumper length (m); the traffic model's vehicle length. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  /** Triangle budgets per instance (unit-tested). */
  readonly triBudget: { readonly lod0: number; readonly lod1: number };
  build(b: GeoBuilder, lod: 0 | 1): void;
}

const WHITE: RGB = [255, 255, 255];
const GLASS: RGB = hexRgb('#39424C');
const TYRE: RGB = ASSET_RGB.dockShelter;
const CONTACT: RGB = ASSET_RGB.contact;
const HEAD: RGB = hexRgb('#FFF4D6');
const TAIL: RGB = hexRgb('#C8302A');
const TAXI_SIGN: RGB = hexRgb('#F7F3E3');

function tinted(b: GeoBuilder, tint: number, fn: () => void): void {
  const prev = b.tint;
  b.tint = tint;
  try {
    fn();
  } finally {
    b.tint = prev;
  }
}

/** Contact shadow 2 cm above the road (vehicles never cast shadows). */
function contact(b: GeoBuilder, hw: number, hl: number): void {
  tinted(b, 0, () => b.quad([-hw, 0.02, hl], [hw, 0.02, hl], [hw, 0.02, -hl], [-hw, 0.02, -hl], [0, 1, 0], CONTACT));
}

/** Head lamps on the +Z face and tail lamps on the −Z face (emissive at night). */
function lamps(b: GeoBuilder, hw: number, zf: number, zr: number, y0: number, y1: number): void {
  tinted(b, 0, () => {
    for (const s of [-1, 1]) {
      const xa = s * (hw - 0.12), xb = s * (hw - 0.42);
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      b.quad([x0, y0, zf + 0.01], [x1, y0, zf + 0.01], [x1, y1, zf + 0.01], [x0, y1, zf + 0.01], [0, 0, 1], HEAD, null, null, 255);
      b.quad([x1, y0, zr - 0.01], [x0, y0, zr - 0.01], [x0, y1, zr - 0.01], [x1, y1, zr - 0.01], [0, 0, -1], TAIL, null, null, 200);
    }
  });
}

/** A plain box in the instance colour (LOD1 of every road vehicle): 5 faces, 10 triangles. */
function lod1Box(b: GeoBuilder, hw: number, hl: number, h: number): void {
  tinted(b, 255, () => b.box(-hw, 0.15, -hl, hw, h, hl, WHITE, shade(WHITE, 0.94)));
}

/** Three-box passenger car: dark wheel band, body in the instance colour, glasshouse, roof. */
function car(b: GeoBuilder, o: { hl: number; hw: number; beltY: number; roofY: number; cabinFront: number; cabinRear: number; roofFront: number; roofRear: number }): void {
  const { hl, hw, beltY, roofY } = o;
  contact(b, hw + 0.05, hl + 0.05);
  tinted(b, 0, () => b.boxFaces(-hw + 0.08, 0.0, -hl + 0.45, hw - 0.08, 0.32, hl - 0.45, FACE_PX | FACE_NX, TYRE));
  tinted(b, 255, () => {
    b.boxFaces(-hw, 0.24, -hl, hw, beltY, hl, FACE_SIDES | FACE_TOP, WHITE, shade(WHITE, 0.96));
    b.quad([-hw + 0.14, roofY, o.roofFront], [hw - 0.14, roofY, o.roofFront], [hw - 0.14, roofY, o.roofRear], [-hw + 0.14, roofY, o.roofRear], [0, 1, 0], WHITE);
  });
  tinted(b, 0, () => {
    // glasshouse: sloped windscreen and rear screen, flat sides
    const xa = -hw + 0.1, xb = hw - 0.1, xr0 = -hw + 0.14, xr1 = hw - 0.14;
    S.quadOut(b, [xa, beltY, o.cabinFront], [xb, beltY, o.cabinFront], [xr1, roofY, o.roofFront], [xr0, roofY, o.roofFront], [0, 0.6, 1], GLASS);
    S.quadOut(b, [xb, beltY, o.cabinRear], [xa, beltY, o.cabinRear], [xr0, roofY, o.roofRear], [xr1, roofY, o.roofRear], [0, 0.6, -1], GLASS);
    S.quadOut(b, [xb, beltY, o.cabinFront], [xb, beltY, o.cabinRear], [xr1, roofY, o.roofRear], [xr1, roofY, o.roofFront], [1, 0, 0], GLASS);
    S.quadOut(b, [xa, beltY, o.cabinRear], [xa, beltY, o.cabinFront], [xr0, roofY, o.roofFront], [xr0, roofY, o.roofRear], [-1, 0, 0], GLASS);
  });
  lamps(b, hw, hl, -hl, beltY - 0.28, beltY - 0.08);
}

function buildSedan(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return lod1Box(b, 0.9, 2.25, 1.35);
  car(b, { hl: 2.25, hw: 0.9, beltY: 0.86, roofY: 1.45, cabinFront: 1.05, cabinRear: -1.35, roofFront: 0.45, roofRear: -0.9 });
}

function buildHatchback(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return lod1Box(b, 0.86, 1.95, 1.4);
  car(b, { hl: 1.95, hw: 0.86, beltY: 0.88, roofY: 1.48, cabinFront: 0.85, cabinRear: -1.85, roofFront: 0.3, roofRear: -1.65 });
}

function buildSuv(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return lod1Box(b, 0.96, 2.35, 1.7);
  car(b, { hl: 2.35, hw: 0.96, beltY: 1.08, roofY: 1.78, cabinFront: 1.05, cabinRear: -2.2, roofFront: 0.55, roofRear: -2.1 });
}

function buildTaxi(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return lod1Box(b, 0.9, 2.3, 1.35);
  car(b, { hl: 2.3, hw: 0.9, beltY: 0.86, roofY: 1.45, cabinFront: 1.05, cabinRear: -1.35, roofFront: 0.45, roofRear: -0.9 });
  // roof sign (lit at night)
  tinted(b, 0, () => b.boxFaces(-0.35, 1.45, -0.35, 0.35, 1.72, -0.12, FACE_SIDES | FACE_TOP, TAXI_SIGN, TAXI_SIGN, null, 140));
}

/** Panel van 5.2 × 2.0 × 2.3 m: body in the instance colour (owner livery on company vans). */
function buildVan(b: GeoBuilder, lod: 0 | 1): void {
  const hl = 2.6, hw = 1.0;
  if (lod === 1) return lod1Box(b, hw, hl, 2.3);
  contact(b, hw + 0.05, hl + 0.05);
  tinted(b, 0, () => b.boxFaces(-hw + 0.08, 0.0, -hl + 0.5, hw - 0.08, 0.36, hl - 0.5, FACE_PX | FACE_NX, TYRE));
  tinted(b, 255, () => {
    b.boxFaces(-hw, 0.3, -hl, hw, 2.3, hl - 1.1, FACE_SIDES | FACE_TOP, WHITE, shade(WHITE, 0.95));
    b.boxFaces(-hw, 0.3, hl - 1.1, hw, 1.05, hl, FACE_PZ | FACE_PX | FACE_NX | FACE_TOP, WHITE, shade(WHITE, 0.96)); // bonnet
  });
  tinted(b, 0, () => {
    S.quadOut(b, [-hw + 0.08, 1.05, hl - 0.25], [hw - 0.08, 1.05, hl - 0.25], [hw - 0.08, 2.15, hl - 1.1], [-hw + 0.08, 2.15, hl - 1.1], [0, 0.7, 1], GLASS);
    b.quad([hw + 0.01, 1.15, hl - 1.15], [hw + 0.01, 1.15, hl - 2.0], [hw + 0.01, 1.95, hl - 2.0], [hw + 0.01, 1.95, hl - 1.15], [1, 0, 0], GLASS);
    b.quad([-hw - 0.01, 1.15, hl - 2.0], [-hw - 0.01, 1.15, hl - 1.15], [-hw - 0.01, 1.95, hl - 1.15], [-hw - 0.01, 1.95, hl - 2.0], [-1, 0, 0], GLASS);
  });
  lamps(b, hw, hl, -hl, 0.7, 0.92);
}

/** Rigid box truck 8.2 × 2.5 × 3.6 m (city deliveries): white cab, box in the instance colour (owner livery). */
function buildBoxTruck(b: GeoBuilder, lod: 0 | 1): void {
  const hl = 4.1, hw = 1.25;
  if (lod === 1) return lod1Box(b, hw, hl, 3.6);
  contact(b, hw + 0.05, hl + 0.05);
  tinted(b, 0, () => {
    b.box(-hw + 0.1, 0.25, -hl + 0.2, hw - 0.1, 0.95, hl - 0.1, TYRE, TYRE); // chassis and wheels band
    b.boxFaces(-hw, 0.95, hl - 2.1, hw, 3.0, hl, FACE_SIDES | FACE_TOP, hexRgb('#ECEBE6'), hexRgb('#E0DFDA')); // cab
    b.quad([-hw + 0.12, 2.0, hl + 0.01], [hw - 0.12, 2.0, hl + 0.01], [hw - 0.12, 2.85, hl + 0.01], [-hw + 0.12, 2.85, hl + 0.01], [0, 0, 1], GLASS);
  });
  tinted(b, 255, () => b.boxFaces(-hw - 0.02, 0.95, -hl, hw + 0.02, 3.6, hl - 2.2, FACE_SIDES | FACE_TOP, WHITE, shade(WHITE, 0.95)));
  lamps(b, hw, hl, -hl, 1.0, 1.25);
}

/** 12.4 m city bus (art §3.3 transit livery #D8452F via the instance colour): window band, roof pod. */
function buildBus(b: GeoBuilder, lod: 0 | 1): void {
  const hl = 6.2, hw = 1.27;
  if (lod === 1) return lod1Box(b, hw, hl, 3.1);
  contact(b, hw + 0.05, hl + 0.05);
  tinted(b, 0, () => b.boxFaces(-hw + 0.08, 0.0, -hl + 0.8, hw - 0.08, 0.45, hl - 0.8, FACE_PX | FACE_NX, TYRE));
  tinted(b, 255, () => {
    b.boxFaces(-hw, 0.35, -hl, hw, 1.25, hl, FACE_SIDES, WHITE);
    b.boxFaces(-hw, 2.5, -hl, hw, 3.05, hl, FACE_SIDES | FACE_TOP, WHITE, hexRgb('#E8E8E4'));
  });
  tinted(b, 0, () => {
    b.boxFaces(-hw + 0.02, 1.25, -hl + 0.02, hw - 0.02, 2.5, hl - 0.02, FACE_SIDES, GLASS); // window band
    b.box(-0.8, 3.05, -2.5, 0.8, 3.35, 1.5, hexRgb('#D8DADC'), hexRgb('#CFD1D4')); // roof AC pod
    b.quad([-0.7, 2.62, hl + 0.01], [0.7, 2.62, hl + 0.01], [0.7, 2.92, hl + 0.01], [-0.7, 2.92, hl + 0.01], [0, 0, 1], hexRgb('#F2B23A'), null, null, 180); // destination sign
  });
  lamps(b, hw, hl, -hl, 0.55, 0.85);
}

const CONTAINER_COLS: readonly RGB[] = ['#B3483A', '#2F6F9F', '#C99A3A', '#4F8A5B', '#8C8F94', '#6C4F8C', '#D96C3B', '#E4E4DE'].map(hexRgb);

/** Container ship 140 × 22 m (sea traffic and port calls): hull, deck stacks in 8 container colours, aft bridge. */
function buildContainerShip(b: GeoBuilder, lod: 0 | 1): void {
  const hull = ASSET_RGB.hull, band = ASSET_RGB.antifouling, deck = hexRgb('#5C6670');
  const hw = 11, hl = 70;
  tinted(b, 0, () => {
    // Hull: pointed bow towards +Z, transom at −Z; the waterline band shows the antifouling red.
    const outline: Array<readonly [number, number]> = [[-hw, -hl], [hw, -hl], [hw, hl - 22], [hw * 0.55, hl - 6], [0, hl], [-hw * 0.55, hl - 6], [-hw, hl - 22]];
    S.prism(b, outline, -0.5, 0.9, band, band, null, false);
    S.prism(b, outline, 0.9, 8.0, hull, deck);
    if (lod === 1) {
      b.box(-hw + 1, 8, -hl + 18, hw - 1, 15, hl - 24, CONTAINER_COLS[1], CONTAINER_COLS[0]);
      b.box(-hw + 1.5, 8, -hl + 2, hw - 1.5, 26, -hl + 14, WHITE, hexRgb('#D3D0C8'));
      return;
    }
    // Container bays: 8 bays of 12.4 m between the bridge and the bow, stacked 2–4 high, colour per row.
    for (let bay = 0; bay < 8; bay++) {
      const z0 = -hl + 18 + bay * 12.6, z1 = z0 + 12.2;
      const tiers = 2 + ((bay * 7) % 3);
      for (let row = 0; row < 3; row++) {
        const x0 = -hw + 1.2 + row * 6.6, x1 = x0 + 6.4;
        const col = CONTAINER_COLS[(bay * 3 + row * 5) % CONTAINER_COLS.length];
        b.boxFaces(x0, 8, z0, x1, 8 + tiers * 2.6, z1, FACE_SIDES | FACE_TOP, col, shade(col, 1.06));
      }
    }
    // Aft accommodation block and bridge wings, funnel.
    b.box(-hw + 1.5, 8, -hl + 3, hw - 1.5, 22, -hl + 13, WHITE, hexRgb('#D3D0C8'), [1, 7, 28, 30]);
    b.box(-hw - 1, 22, -hl + 9, hw + 1, 25, -hl + 13.5, WHITE, hexRgb('#D3D0C8'));
    b.boxFaces(-hw - 0.9, 22.6, -hl + 13.45, hw + 0.9, 24.4, -hl + 13.55, FACE_PZ, GLASS);
    b.box(-1.8, 25, -hl + 4, 1.8, 31, -hl + 8, hexRgb('#B8322E'), hexRgb('#2A2C30'));
    // Navigation lights (emissive at night): masthead, port red, starboard green.
    b.boxFaces(-0.3, 30.8, -hl + 5.6, 0.3, 31.4, -hl + 6.2, FACE_SIDES | FACE_TOP, HEAD, HEAD, null, 255);
    b.boxFaces(-hw - 1.1, 24.0, -hl + 12, -hw - 0.8, 24.5, -hl + 12.6, FACE_SIDES, hexRgb('#E03A2E'), hexRgb('#E03A2E'), null, 255);
    b.boxFaces(hw + 0.8, 24.0, -hl + 12, hw + 1.1, 24.5, -hl + 12.6, FACE_SIDES, hexRgb('#2EC46A'), hexRgb('#2EC46A'), null, 255);
  });
}

export const VEHICLE_MODELS: Readonly<Record<VehicleModelId, VehicleModel>> = {
  sedan: { id: 'sedan', cls: 'car', length: 4.5, width: 1.8, height: 1.45, triBudget: { lod0: 48, lod1: 10 }, build: buildSedan },
  hatchback: { id: 'hatchback', cls: 'car', length: 3.9, width: 1.72, height: 1.48, triBudget: { lod0: 48, lod1: 10 }, build: buildHatchback },
  suv: { id: 'suv', cls: 'car', length: 4.7, width: 1.92, height: 1.78, triBudget: { lod0: 48, lod1: 10 }, build: buildSuv },
  taxi: { id: 'taxi', cls: 'car', length: 4.6, width: 1.8, height: 1.72, triBudget: { lod0: 60, lod1: 10 }, build: buildTaxi },
  van: { id: 'van', cls: 'truck', length: 5.2, width: 2.0, height: 2.3, triBudget: { lod0: 60, lod1: 10 }, build: buildVan },
  boxTruck: { id: 'boxTruck', cls: 'truck', length: 8.2, width: 2.5, height: 3.6, triBudget: { lod0: 60, lod1: 10 }, build: buildBoxTruck },
  bus: { id: 'bus', cls: 'bus', length: 12.4, width: 2.54, height: 3.35, triBudget: { lod0: 70, lod1: 10 }, build: buildBus },
  containerShip: { id: 'containerShip', cls: 'ship', length: 140, width: 22, height: 31, triBudget: { lod0: 400, lod1: 60 }, build: buildContainerShip },
};

export const VEHICLE_MODEL_IDS = Object.keys(VEHICLE_MODELS) as VehicleModelId[];

/** Semi-trailer models borrowed from W4's PROPS_B (same frame: forward +Z, cab tinted by the instance colour). */
export const SEMI_PROP_IDS = ['truckBox', 'truckReefer', 'truckTanker', 'truckHopper'] as const;
export type SemiPropId = (typeof SEMI_PROP_IDS)[number];
/** Semi length (W4 buildSemi spans z −8.25 … 8.15). */
export const SEMI_LENGTH = 16.4;

/** Body colour for ambient traffic: art §3.3 distribution from a uniform 0..1 value (deterministic). */
export function ambientBodyRgb(u: number): RGB {
  let acc = 0;
  for (const [rgb, share] of WORLD_RGB.vehicles.bodies) {
    acc += share;
    if (u < acc) return rgb;
  }
  return WORLD_RGB.vehicles.bodies[0][0];
}

/** Gold-standard colours for the special liveries. */
export const LIVERY = {
  taxi: WORLD_RGB.vehicles.taxi,
  bus: WORLD_RGB.vehicles.bus,
  /** Neutral white livery of import/export trucks (art §3.16). */
  neutral: hexRgb('#ECECE8'),
} as const;
