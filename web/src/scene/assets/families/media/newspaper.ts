// Newspaper publisher — company building `newspaper_publisher` (art §4.2.16; 3×3): a brick office block
// 50 × 20 × 16 m (4 floors) with a masthead sign (owner board 16 × 4.5 m with the paper's wordmark) on the roof
// edge, a 50 × 40 × 10 m printing hall with a sawtooth roof whose INDUSTRIAL clerestory band is lit all night
// ("printing tonight's edition"), a yard with paper-reel stacks (instanced) and three delivery vans in owner livery
// at the docks. Variants: yard on the right (0) or left (1).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { canopy, door, flagpole, hvac, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const OFFICE_FAC: Fac = { style: FACADE.apartment.style, floor: 3.8, bay: 3.2 };
const HALL_FAC: Fac = { style: 5, floor: 10, bay: 5.0 }; // INDUSTRIAL clerestory band

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x703);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const brick = col.pick([P.wall.brick, shade(P.wall.brick, 0.9), P.wall.terracotta]);
  const hallWall = col.pick([P.wall.concrete, P.ind.silver, P.wall.greige]);
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);
  const [bx0, bx1] = span(-hw, -hw + 50);
  const oz1 = hd - 3, oz0 = oz1 - 20;
  const hz1 = oz0, hz0 = hz1 - 40;
  const [yx0, yx1] = span(-hw + 51, hw);

  c.ground(-c.hw + 0.3, hz0 - 0.5, c.hw - 0.3, c.hd - 0.3, P.road.parking, FL_PAVED | FL_SNOW);
  c.ground(bx0, oz1, bx1, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(bx0, oz0, bx1, oz1, 0, 16, brick, OFFICE_FAC, P.roof.tar, { ownerRoof: true });
    c.mass(bx0, hz0, bx1, hz1, 0, 10, hallWall, HALL_FAC, P.roof.flat, { ownerRoof: true });
    return c.finish();
  }

  // office block (brick, 4 floors) with cornice and the masthead sign on the roof edge
  c.mass(bx0, oz0, bx1, oz1, 0, 16, brick, OFFICE_FAC, P.roof.tar, { ownerRoof: true });
  c.cornice(bx0, oz0, bx1, oz1, 15.2, P.wall.stone, 0.8, 0.45);
  c.parapet(bx0, oz0, bx1, oz1, 16, shade(brick, 0.9), 0.7, 0.3);
  c.cornice(bx0, oz0, bx1, oz1, 3.6, P.wall.stone, 0.35, 0.2);
  const front = rectSides(bx0, oz0, bx1, oz1).front;
  c.signBoard(front, front.len / 2 - 8, front.len / 2 + 8, 16.7, 21.2, -0.5, 0.35);
  for (const u of [front.len / 2 - 5, front.len / 2 + 5]) c.sideBox(front, u - 0.15, u + 0.15, 16, 21, -1.7, -0.5, P.wall.concreteDark);
  door(c, front, front.len / 2, 3.2, 3.0, X.screenDark);
  canopy(c, front, front.len / 2, 7, 2.5, 3.5, c.own, 0.3, c.signEm);
  flagpole(c, front.x(front.len / 2 + 9), oz1 + 2.2, 9, c.own);
  hvac(c, (bx0 + bx1) / 2 - 12, (oz0 + oz1) / 2, 16, 3, 2, 1.5);

  // printing hall: sawtooth roof, clerestory band lit through the night, dock doors on the yard side
  c.mass(bx0, hz0, bx1, hz1, 0, 10, hallWall, HALL_FAC, null);
  c.ownerRoof(() => c.sawtooth(bx0, hz0, bx1, hz1, 10, 2.8, 5, P.roof.flat, P.ind.glass2));
  const hs = rectSides(bx0, hz0, bx1, hz1);
  const dockSide = m === 1 ? hs.right : hs.left;
  const docks = m === 1 ? [8, 14, 20] : [dockSide.len - 8, dockSide.len - 14, dockSide.len - 20];
  for (const u of docks) {
    c.panel(dockSide, u - 1.8, u + 1.8, 0, 4.2, 0.04, P.ind.dockDoors);
    c.sideBox(dockSide, u - 2, u + 2, 0, 1.2, 0, 1.4, P.wall.concreteDark);
  }
  c.sideBox(dockSide, Math.min(...docks) - 3, Math.max(...docks) + 3, 4.6, 4.9, 0, 3.0, P.wall.concreteDark, P.roof.membrane);
  // delivery vans in owner livery backed onto the docks; reel stacks in the yard
  if (!c.closed) {
    for (const u of docks) c.prop('van', dockSide.x(u, 4.4), dockSide.z(u, 4.4), dockSide.yaw, 1, c.ownerColor);
  }
  const yx = (yx0 + yx1) / 2;
  for (let i = 0; i < 6; i++) c.prop('paperRolls', yx + (i % 2 ? 3 : -3) + r.range(-0.5, 0.5), hz0 + 4 + Math.floor(i / 2) * 4.5, r.range(0, Math.PI));
  c.box(yx0 + 1, 0, hd - 7, yx0 + 1.2, 2, hd - 1, X.lampPole); // yard gate post
  const lampX = m === 1 ? yx1 - 1 : yx0 + 1;
  for (let i = 0; i < 2; i++) {
    c.prop('lamp.street', lampX, hz0 + 10 + i * 20, (-Math.PI / 2) * m, 1);
    c.pool(lampX - 2 * m, hz0 + 10 + i * 20, 7);
  }
  c.pool(front.x(front.len / 2), oz1 + 2.5, 7);
  weeds(c, [[yx0 + 1, hz0 + 1, yx1 - 1, hz1 - 1]]);
  return c.finish();
}

export const newspaperFactory: AssetFactory = {
  id: 'newspaper_publisher',
  footprints: [[3, 3]],
  triBudget: { lod0: 2000, lod1: 100 },
  build,
};
