// Small shop massing shared by the company `convenience_store` (art §4.2.1) and the ambient local shop (§4.3):
// a 20 × 14 m single-storey shop (4.6 m) behind a 3 m forecourt, optionally with 1–2 floors of flats above,
// SHOP glazing on the front (and one flank on corner variants), concrete rear, awning at 3.0–3.35 m,
// fascia board at 3.5–4.6 m with a sign quad, service yard with bins, rooftop AC units.
import type { RGB } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW, FL_VEG, Y_PAINT } from '../common-a/constants';
import { Ctx, FACADE, Side, rectSides } from '../common-a/ctx';
import { awning, boardedUp, door, hvac, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const GROUND_H = 4.6;
const UPPER = 3.0;

export interface SmallShopSpec {
  wall: RGB;
  roof: RGB;
  upperFloors: 0 | 1 | 2;
  awning: 'plain' | 'striped' | 'canopy';
  /** Awning colours (one = plain; several alternate as stripes). */
  awningCols: readonly RGB[];
  /** Fascia board colour and emissive byte. */
  signCol: RGB;
  signEm: number;
  /** companyId for the sign quad ('' = the owning company, 'local:<icon>' for local shops). */
  signId?: string;
  /** Glaze one flank as a corner shop. */
  flank: 'left' | 'right' | null;
  /** Taller false-front parapet on single-storey shops. */
  falseFront: boolean;
  /** Projecting blade sign at the corner. */
  blade: boolean;
  /** Company forecourt kit: painted bays, ice chest, ATM, bike rack. */
  forecourtKit: boolean;
  /** Company main roof (owner tint at city zoom). */
  ownerRoof: boolean;
}

/** Builds the shop on a 1×1 lot (any lot ≥ 22 × 22 m works); returns the building's front side. */
export function buildSmallShop(c: Ctx, s: SmallShopSpec): Side {
  const r = c.shape;
  const bw = Math.min(20, c.W - 4), bx0 = -bw / 2, bx1 = bw / 2;
  const bz1 = c.hd - 3, bz0 = bz1 - Math.min(14, c.D - 10);
  const top = GROUND_H + s.upperFloors * UPPER;
  const parapetH = s.falseFront && s.upperFloors === 0 ? 1.6 : 0.6;

  // ground: forecourt paving, side strips, rear service yard
  c.ground(-c.hw + 0.3, bz1, c.hw - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, bz0, P.road.parking, FL_PAVED | FL_SNOW);
  c.ground(-c.hw + 0.3, bz0, bx0 - 0.2, bz1, P.ground.yard, FL_VEG | FL_SNOW);
  c.ground(bx1 + 0.2, bz0, c.hw - 0.3, bz1, P.ground.yard, FL_VEG | FL_SNOW);

  const shopFac = c.closed ? null : FACADE.shop;
  const flankFac = c.closed ? null : FACADE.shop;
  if (c.lod === 1) {
    c.mass(bx0, bz0, bx1, bz1, 0, top, s.wall, s.upperFloors ? FACADE.apartment : shopFac, s.roof, { ownerRoof: s.ownerRoof, facs: { front: shopFac } });
    return rectSides(bx0, bz0, bx1, bz1).front;
  }

  c.mass(bx0, bz0, bx1, bz1, 0, GROUND_H, s.wall, null, s.upperFloors ? null : s.roof, {
    ownerRoof: s.ownerRoof,
    sides: 11,
    facs: { front: shopFac, left: s.flank === 'left' ? flankFac : null, right: s.flank === 'right' ? flankFac : null },
  });
  const sides = rectSides(bx0, bz0, bx1, bz1);
  // plain concrete rear wall with a service door
  c.wall(bx1, bz0, bx0, bz0, 0, GROUND_H, P.wall.concrete, null);
  door(c, sides.back, sides.back.len * 0.7, 1.2, 2.3, P.ind.dockDoors);
  if (s.upperFloors) {
    c.mass(bx0, bz0, bx1, bz1, GROUND_H, top, s.wall, FACADE.apartment, s.roof, { vBase: GROUND_H - 2 * UPPER, ownerRoof: s.ownerRoof });
    // string course between shop and flats
    c.cornice(bx0, bz0, bx1, bz1, GROUND_H - 0.1, shade(s.wall, 0.85), 0.3, 0.15);
  }
  c.parapet(bx0, bz0, bx1, bz1, top, shade(s.wall, 0.94), parapetH, 0.25);

  const front = sides.front;
  // shop door (glass), awning or flat canopy, fascia board with the sign
  if (c.closed) {
    boardedUp(c, front, 0.4, front.len - 0.4);
    if (s.flank) boardedUp(c, s.flank === 'left' ? sides.left : sides.right, 0.4, (s.flank === 'left' ? sides.left : sides.right).len - 0.4);
  } else door(c, front, front.len / 2, 2.0, 2.4, X.screenDark);
  if (s.awning === 'canopy') c.sideBox(front, 0.3, front.len - 0.3, 3.2, 3.45, 0, 2.0, shade(s.awningCols[0], 0.9), s.awningCols[0]);
  else awning(c, front, 0.5, front.len - 0.5, 3.0, 3.35, 1.8, s.awningCols, s.awning === 'striped' ? 8 : 1);
  const fw = Math.min(12, front.len - 2);
  c.sideBox(front, front.len / 2 - fw / 2, front.len / 2 + fw / 2, 3.5, Math.min(4.55, top - 0.05), 0, 0.25, s.signCol, s.signCol, s.signEm, 0);
  if (!c.closed) c.sign(front, front.len / 2 - fw / 2 + 0.15, front.len / 2 + fw / 2 - 0.15, 3.6, Math.min(4.45, top - 0.15), 0.27, s.signId);
  if (s.blade) {
    // projecting blade sign on the right flank, just behind the front corner
    const by0 = s.upperFloors ? 4.8 : 2.4, by1 = s.upperFloors ? 7.0 : 4.3;
    c.sideBox(sides.right, 0.45, 0.6, by0, by1, 0, 1.3, s.signCol, s.signCol, s.signEm, 0);
  }

  // roof plant
  hvac(c, bx0 + 3, (bz0 + bz1) / 2 - 2, top, 2.2, 1.6, 1.2);
  if (r.chance(0.7)) hvac(c, bx1 - 3.5, (bz0 + bz1) / 2 + 1, top, 2.2, 1.6, 1.2);

  // service yard bins
  for (let i = 0; i < 2; i++) c.box(bx0 + 1 + i * 1.5, 0, bz0 - 2.2, bx0 + 2.2 + i * 1.5, 1.3, bz0 - 1.2, X.bins);

  if (s.forecourtKit) {
    // two parallel loading bays painted on the forecourt, ice chest, ATM, bike rack
    const fz0 = bz1 + 0.4, fz1 = c.hd - 0.6;
    for (const [a, b2] of [[-c.hw + 0.8, -c.hw + 6.3], [c.hw - 6.3, c.hw - 0.8]] as const) {
      c.line(a, fz0, b2, fz0, 0.12, P.road.marking, Y_PAINT);
      c.line(a, fz0, a, fz1, 0.12, P.road.marking, Y_PAINT);
      c.line(b2, fz0, b2, fz1, 0.12, P.road.marking, Y_PAINT);
    }
    c.box(bx0 + 0.6, 0, bz1 + 0.1, bx0 + 1.8, 0.9, bz1 + 0.9, P.ind.tankWhite);
    c.box(bx1 - 1.4, 0, bz1 + 0.05, bx1 - 0.6, 1.9, bz1 + 0.7, X.screenDark);
    c.panel(rectSides(bx1 - 1.4, bz1 + 0.05, bx1 - 0.6, bz1 + 0.7).front, 0.15, 0.65, 1.1, 1.5, 0.01, P.ind.glass2, c.closed ? 0 : EM.soft);
    c.box(bx0 + 2.6, 0, bz1 + 0.5, bx0 + 4.6, 0.8, bz1 + 0.58, X.lampPole);
  }
  c.pool(0, bz1 + 1.6, 6);
  weeds(c, [[-c.hw + 1, bz1 + 0.3, c.hw - 1, c.hd - 1], [-c.hw + 1, -c.hd + 1, c.hw - 1, bz0 - 0.5]]);
  return front;
}
