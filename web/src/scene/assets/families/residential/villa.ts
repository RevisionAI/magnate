// Luxury villa — ambient archetype `ambient:villa` (art §4.3; Eastside, Hilltown): two floors under flat roofs,
// a cantilevered upper volume, floor-to-ceiling glazing (SHOP glazing band used on each floor), a pool that glows
// at night, a carport, hedged boundary. 1×1 and 2×2 lots (the larger adds a tennis court or a bigger garden).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW, FL_VEG, Y_GROUND, Y_PAINT } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { door, weeds } from '../common-a/kit';
import { P, X } from '../common-a/palette';

const GF = 3.4; // ground floor height
const UF = 3.2; // upper floor height
const GLASS: Fac = FACADE.shop; // big glazing: the SHOP ground band (0.25–3.36 m above each floor's base)

type Kind = 'cantilever' | 'ell' | 'pavilion';
const KINDS: readonly Kind[] = ['cantilever', 'ell', 'pavilion'];

function slabRoof(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, roof: RGB, edge: RGB): void {
  c.roofTop([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], y, roof);
  c.cornice(x0, z0, x1, z1, y - 0.35, edge, 0.35, 0.25);
}

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x403);
  const kind = KINDS[(p.variant >>> 0) % KINDS.length];
  const r = c.shape, col = c.color;
  const big = c.W >= 40;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick([P.wall.warmWhite, P.wall.limestone, P.wall.warmWhite]);
  const accent = col.pick([X.timber, P.wall.concreteDark, P.wall.stone]);
  const roof = col.pick([P.roof.membrane, P.roof.gravel, P.roof.green]);
  const k = big ? 1.55 : 1;

  // main volumes in the lot frame (front = +Z)
  const gw = 12 * k, gd = 9 * k;
  const gx0 = -hw + 1.5 + r.range(0, Math.max(0, 2 * hw - gw - 9)), gz1 = hd - (big ? 12 : 7.5);
  const g = { x0: gx0, z0: gz1 - gd, x1: gx0 + gw, z1: gz1 };
  let u: { x0: number; z0: number; x1: number; z1: number };
  if (kind === 'cantilever') u = { x0: g.x0 + 2 * k, z0: g.z0 - 0.5, x1: Math.min(hw - 0.5, g.x1 + 3.5 * k), z1: g.z1 - 1.5 * k };
  else if (kind === 'ell') u = { x0: g.x0, z0: g.z0, x1: g.x0 + 6 * k, z1: g.z1 + 2.5 * k };
  else u = { x0: g.x0 - 1, z0: g.z0 + 1, x1: g.x1 + 1, z1: g.z1 - 1 };
  u.z1 = Math.min(u.z1, hd - 4);
  const upperWall = kind === 'pavilion' ? accent : wall;
  const top = GF + UF;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    c.mass(g.x0, g.z0, g.x1, g.z1, 0, GF, wall, GLASS, roof);
    c.mass(u.x0, u.z0, u.x1, u.z1, GF, top, upperWall, GLASS, roof, { vBase: GF });
    return c.finish();
  }

  // ground floor: glazed pavilion, solid street flank for privacy
  c.mass(g.x0, g.z0, g.x1, g.z1, 0, GF, wall, GLASS, null, { facs: { front: kind === 'pavilion' ? GLASS : FACADE.house } });
  slabRoof(c, g.x0, g.z0, g.x1, g.z1, GF, roof, wall);
  // upper floor (cantilevered / ell wing / timber box), glazed with the same band one floor up
  c.mass(u.x0, u.z0, u.x1, u.z1, GF, top, upperWall, GLASS, null, { vBase: GF });
  slabRoof(c, u.x0, u.z0, u.x1, u.z1, top, roof, kind === 'pavilion' ? P.wall.concreteDark : wall);
  if (kind === 'cantilever') {
    // a slender steel post under the free end of the cantilever
    c.boxc(u.x1 - 0.4, u.z1 - 0.4, 0.2, 0.2, 0, GF, P.wall.concreteDark);
  }
  if (kind === 'ell') {
    // roof-terrace railing on the single-storey part
    const rs = rectSides(u.x1, g.z0, g.x1, g.z1);
    for (const s of [rs.front, rs.right, rs.back]) c.panel(s, 0, s.len, GF, GF + 1.0, -0.05, P.ind.glass2);
  }

  // entrance on the street side
  const fs = rectSides(g.x0, g.z0, g.x1, g.z1).front;
  const du = kind === 'cantilever' ? 1.6 : fs.len - 1.6;
  door(c, fs, du, 1.4, 2.6, X.screenDark);

  // terrace + pool behind the house (glows turquoise at night: pool lights)
  const pw = big ? 12 : 9, pd = big ? 5 : 3.6;
  const px = Math.min(hw - pw / 2 - 1.2, Math.max(-hw + pw / 2 + 1.2, (g.x0 + g.x1) / 2 + (kind === 'ell' ? 3 : 0)));
  const pz = Math.max(-hd + pd / 2 + 1.5, g.z0 - (big ? 6 : 4));
  c.ground(px - pw / 2 - 1.2, pz - pd / 2 - 1.2, px + pw / 2 + 1.2, Math.min(g.z0 + 0.2, pz + pd / 2 + 2.2), P.wall.limestone, FL_PAVED | FL_SNOW, Y_GROUND + 0.01);
  const wy = Y_GROUND + 0.03;
  c.q([px - pw / 2, wy, pz + pd / 2], [px + pw / 2, wy, pz + pd / 2], [px + pw / 2, wy, pz - pd / 2], [px - pw / 2, wy, pz - pd / 2], [0, 1, 0], P.water.shallow, null, null, EM.faint);

  // carport + driveway at the open side, hedge around the plot (gap at the drive)
  const right = g.x1 + 1 < hw - 4;
  const cx0 = right ? Math.max(g.x1, u.x1) + 0.8 : -hw + 0.8, cx1 = right ? hw - 0.5 : g.x0 - 0.8;
  if (cx1 - cx0 >= 3.2) {
    const cz1 = Math.min(g.z1 + 1, hd - 3), cz0 = cz1 - 6;
    c.box(cx0, 2.6, cz0, cx1, 2.85, cz1, accent, P.roof.membrane);
    for (const [xx, zz] of [[cx0 + 0.15, cz1 - 0.15], [cx1 - 0.15, cz1 - 0.15]] as const) c.boxc(xx, zz, 0.16, 0.16, 0, 2.6, P.wall.concreteDark);
    c.ground(cx0 + 0.3, cz0, cx1 - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  }
  c.withFlags(FL_VEG | FL_SNOW, () => {
    c.box(-hw, 0, -hd, hw, 1.6, -hd + 0.7, P.veg.leaf3);
    c.box(-hw, 0, -hd + 0.7, -hw + 0.7, 1.6, hd - 1.5, P.veg.leaf3);
    c.box(hw - 0.7, 0, -hd + 0.7, hw, 1.6, hd - 1.5, P.veg.leaf3);
  });

  // larger grounds: tennis court or a lawn with more trees
  let court: [number, number, number, number] | null = null;
  if (big && r.chance(0.6)) {
    const tx1 = hw - 1.5, tx0 = tx1 - 11, tz0 = -hd + 1.5, tz1 = tz0 + 23.8;
    if (tx0 > Math.max(g.x1, u.x1) + 1 || tz1 < g.z0 - 1) {
      court = [tx0 - 2, tz0 - 2, tx1 + 2, tz1 + 2];
      c.ground(tx0 - 1, tz0 - 1, tx1 + 1, tz1 + 1, X.runningTrack, FL_PAVED | FL_SNOW, Y_GROUND + 0.01);
      c.ground(tx0, tz0, tx1, tz1, X.sportsField, FL_PAVED | FL_SNOW, Y_GROUND + 0.02);
      c.line(tx0, (tz0 + tz1) / 2, tx1, (tz0 + tz1) / 2, 0.12, P.road.marking, Y_PAINT);
      c.line(tx0 + 1.4, tz0, tx0 + 1.4, tz1, 0.08, P.road.marking, Y_PAINT);
      c.line(tx1 - 1.4, tz0, tx1 - 1.4, tz1, 0.08, P.road.marking, Y_PAINT);
    }
  }
  const trees = big ? 7 : 3;
  for (let i = 0; i < trees; i++) {
    const tx = r.range(-hw + 2.5, hw - 2.5), tz = r.range(-hd + 2.5, hd - 2.5);
    const inHouse = tx > g.x0 - 3 && tx < Math.max(g.x1, u.x1) + 3 && tz > g.z0 - 3 && tz < Math.max(g.z1, u.z1) + 3;
    const inPool = Math.abs(tx - px) < pw / 2 + 3 && Math.abs(tz - pz) < pd / 2 + 3;
    const inCourt = court !== null && tx > court[0] && tx < court[2] && tz > court[1] && tz < court[3];
    if (!inHouse && !inPool && !inCourt) c.tree(tx, tz, r.chance(0.3) ? 'poplar' : 'deciduous');
  }
  weeds(c, [[-hw + 1, hd - 4, hw - 1, hd - 1]]);
  return c.finish();
}

export const villaFactory: AssetFactory = {
  id: 'ambient:villa',
  footprints: [[1, 1], [2, 2]],
  triBudget: { lod0: 300, lod1: 30 },
  build,
};
