// Detached house — ambient archetype `ambient:house` (art §4.3): 1×1 lot, 1–2 floors on a 0.5 m plinth,
// gable (≈70%) or hip roof, chimney, front setback 6 m, garage with a driveway on half the lots, rear garden with
// trees, hedge or fence on the side and rear boundaries. Six shape archetypes × seeded colours.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { eaveFascia } from '../common-a/kit';
import { P, RES_WALLS, X } from '../common-a/palette';

const PLINTH = 0.5;
const FLOOR = 3.0;

interface HouseShape {
  floors: 1 | 2;
  roof: 'gableX' | 'gableZ' | 'hip';
  garage: boolean;
  porch: boolean;
  wing: boolean;
}

const SHAPES: readonly HouseShape[] = [
  { floors: 1, roof: 'gableX', garage: true, porch: false, wing: false }, // bungalow, eaves to the street
  { floors: 2, roof: 'gableZ', garage: false, porch: false, wing: false }, // gable end to the street
  { floors: 2, roof: 'hip', garage: true, porch: false, wing: false }, // four-square with garage
  { floors: 2, roof: 'gableX', garage: false, porch: false, wing: true }, // L-plan with a cross-gabled wing
  { floors: 2, roof: 'gableX', garage: true, porch: true, wing: false }, // porch house
  { floors: 1, roof: 'hip', garage: false, porch: true, wing: false }, // wide hip-roof bungalow
];

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x401);
  const shape = SHAPES[(p.variant >>> 0) % SHAPES.length];
  const r = c.shape, col = c.color;
  const hw = c.hw - 1, hd = c.hd - 1; // building margin (art §3.2)

  const wall = col.pick(RES_WALLS);
  const roof = col.weighted<RGB>([[P.roof.shingle, 4], [P.roof.tile, 3], [P.roof.slate, 3]]);
  const plinth = col.pick([P.wall.stone, P.wall.concreteDark, P.wall.limestone]);
  const door = col.pick(X.doors);
  const pitch = r.range(30, 38) * (Math.PI / 180);

  // Footprint: body 9–12 m wide, 8–10 m deep, front face 6 m behind the lot front.
  const bw = shape.porch && shape.floors === 1 ? r.range(11, 12) : r.range(9, 11.5);
  const bd = r.range(8, 10);
  const garageW = shape.garage ? 3.6 : 0;
  const total = bw + (shape.garage ? garageW + 0.2 : 0);
  const left = -total / 2 + r.range(-1, 1) * Math.max(0, hw - total / 2 - 0.5);
  const garageOnLeft = r.chance(0.5);
  const bx0 = shape.garage && garageOnLeft ? left + garageW + 0.2 : left;
  const bx1 = bx0 + bw;
  const fz = c.hd - 6; // front setback 6 m
  const bz1 = fz, bz0 = fz - bd;
  const eave = PLINTH + shape.floors * FLOOR;

  // --- LOD1: one extruded body with its roof, lawn under it.
  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    c.mass(bx0, bz0, bx1, bz1, 0, eave, wall, FACADE.house, null);
    houseRoof(c, shape.roof, bx0, bz0, bx1, bz1, eave, pitch, roof, wall, 0);
    return c.finish();
  }

  // --- Body: plinth band + facade walls (windows aligned to floors) + roof.
  c.mass(bx0, bz0, bx1, bz1, 0, PLINTH, plinth, null, null);
  c.mass(bx0, bz0, bx1, bz1, PLINTH, eave, wall, FACADE.house, null, { vBase: PLINTH });
  houseRoof(c, shape.roof, bx0, bz0, bx1, bz1, eave, pitch, roof, wall, 0.35);
  eaveFascia(c, bx0, bz0, bx1, bz1, eave, 0.35, shape.roof === 'hip' ? 'hip' : shape.roof === 'gableX', P.wall.warmWhite);

  // Cross-gabled wing projecting towards the street on one side (L-plan).
  let wingLeft = false, ww = 0;
  if (shape.wing) {
    ww = Math.min(5.2, bw * 0.45);
    wingLeft = r.chance(0.5);
    const wx0 = wingLeft ? bx0 : bx1 - ww, wx1 = wx0 + ww;
    const wz1 = Math.min(fz + 3.2, c.hd - 3.5);
    const wEave = PLINTH + FLOOR;
    c.mass(wx0, fz, wx1, wz1, 0, PLINTH, plinth, null, null, { sides: 11 });
    c.mass(wx0, fz, wx1, wz1, PLINTH, wEave, wall, FACADE.house, null, { vBase: PLINTH, sides: 11 });
    c.gable(wx0, fz - 0.6, wx1, wz1, wEave, (ww / 2) * Math.tan(pitch), roof, wall, false, 0.35);
  }

  // Chimney through the roof: sized from the roof surface height at its position so it clears it by ~0.9 m.
  const xm = (bx0 + bx1) / 2, zm = (bz0 + bz1) / 2;
  const chx = shape.roof === 'hip' ? xm + (r.chance(0.5) ? 1 : -1) * Math.max(0, (bw - bd) / 4) : r.chance(0.5) ? bx0 + 1.4 : bx1 - 1.4;
  const chz = shape.roof === 'gableZ' ? bz0 + 1.6 : zm - 0.9;
  const slope = Math.tan(shape.roof === 'hip' ? pitch * 0.92 : pitch);
  const along = shape.roof === 'gableZ' ? bw / 2 - Math.abs(chx - xm) : bd / 2 - Math.abs(chz - zm);
  const across = shape.roof === 'hip' ? Math.min(along, bw / 2 - Math.abs(chx - xm)) : along;
  c.boxc(chx, chz, 0.7, 0.7, eave - 0.1, across * slope + 1.0, P.ind.chimneyBrick, P.wall.concreteDark);

  // Front door on the plinth, with a step and either a small canopy or a full porch.
  const front = rectSides(bx0, bz0, bx1, bz1).front;
  // the door goes on the part of the front wall that the wing does not hide
  const free0 = shape.wing && wingLeft ? ww + 1.2 : 1.2, free1 = shape.wing && !wingLeft ? front.len - ww - 1.2 : front.len - 1.2;
  const du = free0 + r.range(0.2, 0.8) * Math.max(0, free1 - free0);
  c.panel(front, du - 0.5, du + 0.5, PLINTH, PLINTH + 2.1, 0.04, door);
  c.sideBox(front, du - 0.8, du + 0.8, 0, PLINTH, 0, 0.9, plinth);
  if (shape.porch) {
    const pu0 = Math.max(0.3, du - 2.6), pu1 = Math.min(front.len - 0.3, du + 2.6);
    c.sideBox(front, pu0, pu1, PLINTH + 2.6, PLINTH + 2.8, 0, 2.0, roof);
    for (const u of [pu0 + 0.15, pu1 - 0.15]) c.boxc(front.x(u, 1.85), front.z(u, 1.85), 0.16, 0.16, 0, PLINTH + 2.6, P.wall.warmWhite);
    c.sideBox(front, pu0, pu1, 0, PLINTH, 0.9, 2.0, plinth);
  } else {
    c.sideBox(front, du - 0.9, du + 0.9, PLINTH + 2.3, PLINTH + 2.42, 0, 1.0, P.wall.warmWhite);
  }

  // Garage with a flat roof and a pale sectional door; driveway to the street.
  if (shape.garage) {
    const gx0 = garageOnLeft ? left : bx1 + 0.2, gx1 = gx0 + garageW;
    const gz1 = fz + r.range(-0.5, 0.8), gz0 = gz1 - 6;
    c.mass(gx0, gz0, gx1, gz1, 0, 2.8, wall, null, P.roof.gravel);
    c.panel(rectSides(gx0, gz0, gx1, gz1).front, 0.4, garageW - 0.4, 0, 2.1, 0.04, P.wall.warmWhite);
    c.ground(gx0 + 0.2, gz1, gx1 - 0.2, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  }
  // Front path from the step to the pavement.
  const px = front.x(du), pz = fz + 0.9;
  c.ground(px - 0.6, pz, px + 0.6, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);

  // Boundary: hedge (seasonal) or timber fence along both sides of the rear garden and across the back.
  const hedge = r.chance(0.55);
  const bcol = hedge ? P.veg.leaf3 : P.wall.greige;
  const t = hedge ? 0.5 : 0.08, bh = hedge ? 1.2 : 1.15;
  const flags = hedge ? FL_VEG | FL_SNOW : 0;
  const zEnd = bz1 - 1;
  c.withFlags(flags, () => {
    c.box(-hw, 0, -hd, -hw + t, bh, zEnd, bcol);
    c.box(hw - t, 0, -hd, hw, bh, zEnd, bcol);
    c.box(-hw + t, 0, -hd, hw - t, bh, -hd + t, bcol);
  });

  // Trees: one to three in the back garden, sometimes one in the front yard.
  const nBack = 1 + Math.floor(r.f() * 3);
  for (let i = 0; i < nBack; i++) {
    const tx = -hw + 2.5 + ((i + r.range(0.2, 0.8)) / nBack) * (2 * hw - 5);
    c.tree(tx, r.range(-hd + 2.5, bz0 - 2.2), r.chance(0.2) ? 'conifer' : 'deciduous', 0.9);
  }
  if (r.chance(0.4)) c.tree(shape.garage && !garageOnLeft ? -hw + 3 : hw - 3, c.hd - 3, 'deciduous', 0.8);
  return c.finish();
}

/** Pitched roof over the body: gable along X / Z or hip, rise from the pitch angle. */
function houseRoof(c: Ctx, kind: HouseShape['roof'], x0: number, z0: number, x1: number, z1: number, y: number, pitch: number, roof: RGB, wall: RGB, overhang: number): void {
  if (kind === 'gableX') c.gable(x0, z0, x1, z1, y, ((z1 - z0) / 2) * Math.tan(pitch), roof, wall, true, overhang);
  else if (kind === 'gableZ') c.gable(x0, z0, x1, z1, y, ((x1 - x0) / 2) * Math.tan(pitch), roof, wall, false, overhang);
  else c.hip(x0, z0, x1, z1, y, (Math.min(x1 - x0, z1 - z0) / 2) * Math.tan(pitch * 0.92), roof, overhang);
}

export const houseFactory: AssetFactory = {
  id: 'ambient:house',
  footprints: [[1, 1]],
  triBudget: { lod0: 150, lod1: 24 },
  build,
};
