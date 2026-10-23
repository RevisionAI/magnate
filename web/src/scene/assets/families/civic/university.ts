// University — ambient archetype `ambient:civic:university` (art §4.3; 5×5, also 4×4).
// A quad of four blocks round a lawn: the gate range on the street with a clock tower and archway, two long
// four-storey side ranges under slate roofs, and the domed library with a portico closing the axis. Paths cross
// the quad (axis, cross walk, diagonals) to a statue on a round plaza; trees line the lawn. A glass science
// building and a staff car park fill the back corners. Seeded: brick or limestone ranges, copper or slate dome,
// mirrored back corners.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FAC, FL_SNOW, FL_VEG, Y_GROUND } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { clockFace, eaveFascia, hvac, parkingLot, path, statue } from '../common-a/kit';
import { OFFICE_WALLS, P, X, mixRgb, shade } from '../common-a/palette';
import { GRAND, cityFlag, classicalBlock, drumDome, portico, uplight } from './classical';

const COLLEGE: Fac = { style: FAC.HOUSE, floor: 4.0, bay: 3.2 };
const PLINTH = 0.8;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x608);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1; // science building corner (+1 = back-left)
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const k = Math.min(c.W, c.D) / 120; // 1 on 5×5, 0.8 on 4×4
  const brick = col.chance(0.6);
  const wall: RGB = brick ? col.pick([P.wall.brick, P.wall.terracotta]) : col.pick([P.wall.limestone, P.wall.sandWall, P.wall.stone]);
  const trim = brick ? P.wall.limestone : shade(wall, 1.06);
  const stone = brick ? P.wall.limestone : wall;
  const slate = P.roof.slate;
  const dome = col.chance(0.6) ? P.roof.copper : slate;

  // plan (lot frame, scaled for 4×4)
  const fz1 = hd - 11 * k, fz0 = fz1 - 12; // gate range
  const fx = 46 * k;
  const sx0 = 40 * k, sx1 = 52 * k, sz0 = -30 * k, sz1 = fz0 - 2; // side ranges at ±[sx0, sx1]
  const lz1 = -32 * k, lz0 = lz1 - 20, lx = 24 * k; // library
  const eave = PLINTH + 3 * COLLEGE.floor, sEave = PLINTH + 4 * COLLEGE.floor;
  const ty = 26, tx = 8; // the gate tower is square (16 × 16) so its pyramid roof closes it
  const qx = sx0 - 4, qz0 = lz1 + 4, qz1 = fz0 - 4; // quad lawn

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.park, FL_VEG | FL_SNOW, 0.03);
  // science building and car park corners
  const [scx0, scx1] = m === 1 ? [-hw + 2, -hw + 2 + 26 * k] : [hw - 2 - 26 * k, hw - 2];
  const scz0 = -hd + 2, scz1 = scz0 + 20 * k;
  const glass = col.pick(OFFICE_WALLS);
  const sciTop = 1 + 4 * FACADE.curtain.floor;

  if (c.lod === 1) {
    c.mass(-fx, fz0, fx, fz1, 0, eave, wall, COLLEGE, null, { vBase: PLINTH });
    c.hip(-fx, fz0, fx, fz1, eave, 5, slate, 0.4);
    c.mass(-tx, fz0 - 2, tx, fz1 + 2, 0, ty, wall, COLLEGE, null, { vBase: PLINTH });
    c.spire(0, (fz0 + fz1) / 2, tx * 2 * 0.72, ty, ty + 9, 4, slate);
    for (const s of [-1, 1]) c.mass(s < 0 ? -sx1 : sx0, sz0, s < 0 ? -sx0 : sx1, sz1, 0, sEave, wall, COLLEGE, slate, { vBase: PLINTH });
    c.mass(-lx, lz0, lx, lz1, 0, 14, stone, GRAND, mixRgb(slate, stone, 0.5), { vBase: 2 });
    drumDome(c, 0, (lz0 + lz1) / 2, 14, 8 * k, 5, 9, stone, dome);
    c.mass(scx0, scz0, scx1, scz1, 0, sciTop, glass, FACADE.curtain, P.roof.membrane);
    return c.finish();
  }

  // --- quad: lawn, paths, central plaza with a statue
  c.ground(-qx, qz0, qx, qz1, P.ground.grass2, FL_VEG | FL_SNOW, 0.05);
  path(c, 0, fz0, 0, lz1 + 9, 5);
  path(c, -sx0, 0, sx0, 0, 3.5);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) path(c, dx * (qx - 1), dz > 0 ? qz1 - 1 : qz0 + 1, 0, 0, 2.5);
  c.disc(0, 0, 7.5, Y_GROUND + 0.02, 12, P.road.plaza);
  statue(c, 0, 0, stone, 2.6);
  for (const [x, z, yaw] of [[-5.5, 3, Math.PI * 0.75], [5.5, 3, -Math.PI * 0.75], [-5.5, -3, Math.PI * 0.25], [5.5, -3, -Math.PI * 0.25]] as const) c.prop('bench', x, z, yaw);
  for (let z = qz0 + 4; z <= qz1 - 3; z += 9) {
    c.tree(-qx + 2, z, 'deciduous', 1.1);
    c.tree(qx - 2, z, 'deciduous', 1.1);
    if (Math.abs(z) > 6 && z < qz1 - 6) for (const x of [-3.6, 3.6]) c.prop('lamp.path', x, z, 0);
  }
  for (let x = -qx + 8; x <= qx - 8; x += 10) if (Math.abs(x) > 5) c.tree(x, qz1 - 2, 'deciduous', 0.9);

  // --- gate range with the clock tower and archway
  c.mass(-fx, fz0, fx, fz1, 0, PLINTH, shade(wall, 0.8), null, null);
  c.mass(-fx, fz0, fx, fz1, PLINTH, eave, wall, COLLEGE, null, { vBase: PLINTH });
  c.hip(-fx, fz0, fx, fz1, eave, 5, slate, 0.4);
  eaveFascia(c, -fx, fz0, fx, fz1, eave, 0.4, 'hip', trim);
  c.mass(-tx, fz0 - 2, tx, fz1 + 2, 0, ty, wall, null, shade(wall, 0.9));
  const ts = rectSides(-tx, fz0 - 2, tx, fz1 + 2);
  for (const s of [ts.front, ts.back]) {
    c.panel(s, s.len / 2 - 2.6, s.len / 2 + 2.6, 0, 7.5, 0.04, X.screenDark); // archway
    c.panel(s, 0.5, s.len - 0.5, 8.5, ty - 9, 0.03, wall, 0, COLLEGE, PLINTH);
    clockFace(c, s, s.len / 2, ty - 4.5, 2.2, 0.08);
  }
  for (const s of [ts.left, ts.right]) c.panel(s, 0.5, s.len - 0.5, eave + 0.6, ty - 9, 0.03, wall, 0, COLLEGE, PLINTH);
  c.cornice(-tx, fz0 - 2, tx, fz1 + 2, ty, trim, 0.8, 0.45);
  c.spire(0, (fz0 + fz1) / 2, tx * 2 * 0.74, ty + 0.8, ty + 10, 4, slate);
  c.cyl(0, (fz0 + fz1) / 2, 0.08, ty + 10, ty + 12.5, 4, X.bronze, X.bronze);
  c.sign(ts.front, ts.front.len / 2 - 4, ts.front.len / 2 + 4, 8.0, 9.1, 0.08, 'civic:university');
  for (const x of [-fx + 8, -fx * 0.45, fx * 0.45, fx - 8]) chimney(c, x, (fz0 + fz1) / 2, eave + 6.2, trim);

  // --- side ranges (gable roofs along z)
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -sx1 : sx0, x1 = s < 0 ? -sx0 : sx1;
    c.mass(x0, sz0, x1, sz1, 0, PLINTH, shade(wall, 0.8), null, null);
    c.mass(x0, sz0, x1, sz1, PLINTH, sEave, wall, COLLEGE, null, { vBase: PLINTH });
    c.gable(x0, sz0, x1, sz1, sEave, 5, slate, wall, false, 0.4);
    eaveFascia(c, x0, sz0, x1, sz1, sEave, 0.4, false, trim);
    const inner = rectSides(x0, sz0, x1, sz1)[s < 0 ? 'right' : 'left'];
    c.sideBox(inner, inner.len / 2 - 2.5, inner.len / 2 + 2.5, 3.3, 3.6, 0, 2, trim); // door canopy on the quad side
    c.panel(inner, inner.len / 2 - 1.2, inner.len / 2 + 1.2, 0, 3.0, 0.04, X.doors[2]);
    for (const z of [sz0 + 10, sz1 - 10]) chimney(c, (x0 + x1) / 2, z, sEave + 6.2, trim);
  }

  // --- library with portico and dome closing the axis
  classicalBlock(c, -lx, lz0, lx, lz1, 14, stone, { base: 2, fac: GRAND, roof: mixRgb(slate, stone, 0.5), cornice: true, balustrade: true });
  const lf = rectSides(-lx, lz0, lx, lz1).front;
  portico(c, lf, lf.len / 2 - 10, lf.len / 2 + 10, { cols: 6, r: 0.6, base: 2, colTop: 12.4, depth: 5, entH: 1.6, rise: 4, stone, roof: dome });
  c.panel(lf, lf.len / 2 - 1.8, lf.len / 2 + 1.8, 2, 6.5, 0.05, X.bronze);
  uplight(c, lf, 0.5, lf.len / 2 - 11.5);
  uplight(c, lf, lf.len / 2 + 11.5, lf.len - 0.5);
  c.box(-9.5 * k, 14, (lz0 + lz1) / 2 - 9.5 * k, 9.5 * k, 15.4, (lz0 + lz1) / 2 + 9.5 * k, shade(stone, 0.95), shade(stone, 1.04));
  drumDome(c, 0, (lz0 + lz1) / 2, 15.4, 8 * k, 5, 9, stone, dome);
  c.pool(0, lz1 + 8, 9);

  // --- science building and car park in the back corners
  c.mass(scx0, scz0, scx1, scz1, 0, 1, shade(glass, 0.8), null, null);
  c.mass(scx0, scz0, scx1, scz1, 1, sciTop, glass, FACADE.curtain, P.roof.membrane, { vBase: 1 });
  c.parapet(scx0, scz0, scx1, scz1, sciTop, shade(glass, 0.9), 0.8, 0.3);
  hvac(c, (scx0 + scx1) / 2 - 4, (scz0 + scz1) / 2, sciTop, 3.5, 2.4, 1.6);
  hvac(c, (scx0 + scx1) / 2 + 4, (scz0 + scz1) / 2, sciTop, 3.5, 2.4, 1.6);
  const [px0, px1] = m === 1 ? [hw - 1.5 - 26 * k, hw - 1.5] : [-hw + 1.5, -hw + 1.5 + 26 * k];
  parkingLot(c, px0, -hd + 1, px1, -hd + 1 + 18 * k, { fill: 0.4 + 0.5 * Math.max(0, Math.min(1, p.utilization)), aisle: 6, lamps: true });

  // --- street front: lawn trees, lamps, flag at the gate
  for (let x = -hw + 4; x <= hw - 4; x += r.range(9, 12)) if (Math.abs(x) > 8) c.tree(x, r.range(fz1 + 3, c.hd - 2.5), 'deciduous');
  path(c, 0, fz1 + 2, 0, c.hd - 0.3, 5);
  cityFlag(c, 8.5, fz1 + 4, 12);
  for (const s of [-1, 1]) {
    c.prop('lamp.street', s * 4.2, c.hd - 3, s < 0 ? Math.PI / 2 : -Math.PI / 2);
    c.pool(s * 2.5, c.hd - 3, 7);
    for (let z = sz0 + 4; z < sz1 - 2; z += 11) c.tree(s * (hw - 1.5), z, r.chance(0.3) ? 'conifer' : 'deciduous');
  }
  c.panel(ts.front, ts.front.len / 2 - 2.6, ts.front.len / 2 + 2.6, 7.6, 7.9, 0.1, X.warmLight, c.closed ? 0 : EM.soft); // lit archway
  return c.finish();
}

/** Brick chimney stack on a pitched roof. */
function chimney(c: Ctx, x: number, z: number, top: number, cap: RGB): void {
  c.box(x - 0.6, top - 4, z - 0.6, x + 0.6, top, z + 0.6, P.wall.brick, cap);
}

export const universityFactory: AssetFactory = {
  id: 'ambient:civic:university',
  footprints: [[5, 5], [4, 4]],
  triBudget: { lod0: 2000, lod1: 100 },
  build,
};
