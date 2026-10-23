// R&D center — company building `rd_center` (art §4.2.18; 3×3): a campus with a 50 × 18 × 12 m lab block
// (three 4 m floors, curtain wall, lit cool at night), a Ø20 × 16 m glass rotunda with an aluminium dome cap that
// glows softly at night (emissive ≈ 0.3), a glazed link, six fume stacks (steam while researching), a Ø6 m
// satellite dish (static until an animated "dish" part exists), a landscaped lawn with 8–12 trees and a pond,
// owner roof band, entrance sign and flag. Variants: rotunda right (0) or left (1).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, Side, ngonPts, type Fac } from '../common-a/ctx';
import { dish, door, flagpole, hvac, parkingLot, path, pond, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const LAB_FAC: Fac = { style: FACADE.curtain.style, floor: 4.0, bay: 1.6 };

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x801);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick([P.wall.aluminium, P.wall.warmWhite, P.wall.limestone]);
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);
  const [lx0, lx1] = span(-hw, -hw + 50);
  const lz0 = -hd + 1, lz1 = lz0 + 18;
  const rc = { x: m * 18, z: 4, r: 10 };
  const util = Math.max(0, Math.min(1, p.utilization));

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.park, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    c.mass(lx0, lz0, lx1, lz1, 0, 12, wall, LAB_FAC, P.roof.membrane, { ownerRoof: true });
    c.prism(ngonPts(rc.x, rc.z, rc.r, rc.r, 8), 0, 16, P.ind.glass2, FACADE.curtain, P.wall.aluminium, { ownerRoof: true });
    return c.finish();
  }

  // lab block with an owner band on the street-facing parapet
  c.mass(lx0, lz0, lx1, lz1, 0, 12, wall, LAB_FAC, P.roof.membrane, { ownerRoof: true });
  c.parapet(lx0, lz0, lx1, lz1, 12, shade(wall, 0.92), 0.8, 0.3, c.own, c.signEm);
  // six fume stacks along the roof; two of them steam while researching
  for (let i = 0; i < 6; i++) {
    const sx = Math.min(lx0, lx1) + 6 + i * 7.5, sz = (lz0 + lz1) / 2 + (i % 2 ? 3 : -3);
    c.cyl(sx, sz, 0.5, 12, 16.5, 6, P.ind.galvanized, X.screenDark);
    if (i === 1 || i === 4) c.emit('steam', sx, 16.8, sz, 0.6 * util);
  }
  hvac(c, (lx0 + lx1) / 2, lz1 - 3, 12, 3, 2, 1.4);

  // glass rotunda with an aluminium dome that glows at night
  const pts = ngonPts(rc.x, rc.z, rc.r, rc.r, 16);
  c.prism(pts, 0, 16, P.ind.glass2, FACADE.curtain, null);
  c.cornice(rc.x - rc.r * 0.97, rc.z - rc.r * 0.97, rc.x + rc.r * 0.97, rc.z + rc.r * 0.97, 15.6, P.wall.aluminium, 0.4, 0.05);
  c.ownerRoof(() => c.dome(rc.x, 16, rc.z, rc.r, 5.5, 4, 16, P.wall.aluminium, c.closed ? 0 : 77));
  c.cyl(rc.x, rc.z, 1.4, 21, 22.5, 8, P.wall.aluminium, P.ind.glass2);
  // glazed link from the rotunda to the lab block
  const linkX = rc.x - m * 3;
  c.mass(linkX - 2.5, lz1, linkX + 2.5, rc.z - rc.r + 0.5, 0, 6, P.ind.glass2, FACADE.curtain, P.wall.aluminium);
  // entrance on the rotunda's street side
  const rs = new Side(rc.x - 3, rc.z + rc.r - 0.6, rc.x + 3, rc.z + rc.r - 0.6);
  c.sideBox(rs, -1, 7, 3.6, 3.9, 0, 3, P.wall.aluminium, P.wall.aluminium);
  door(c, rs, 3, 3, 3, X.screenDark);
  // sign board on low plinths in the lawn and the owner flag
  const ss = new Side(rc.x - 6, c.hd - 4, rc.x + 2, c.hd - 4);
  c.box(ss.ax, 0, ss.az - 0.4, ss.bx, 0.6, ss.az + 0.4, P.wall.concreteDark);
  c.signBoard(ss, 0, 8, 0.6, 2.4, -0.15, 0.3);
  flagpole(c, rc.x + 5 * m, c.hd - 4, 10, c.own);

  // satellite dish on a pad behind the rotunda
  const dx = m * (hw - 4), dz = -10;
  c.box(dx - 3, 0, dz - 3, dx + 3, 0.4, dz + 3, P.wall.concrete);
  dish(c, dx, 4.2, dz, 3, (40 * Math.PI) / 180, m * 0.6, P.ind.tankWhite);

  // landscaped lawn: pond, paths, 8–12 trees
  const pondX = -m * 10, pondZ = 16;
  pond(c, pondX, pondZ, 7, 4.5);
  path(c, rc.x, rc.z + rc.r, rc.x, c.hd - 0.3, 3);
  path(c, rc.x, 20, pondX + m * 8, pondZ, 2);
  const trees = 8 + Math.floor(r.f() * 5);
  for (let i = 0; i < trees; i++) {
    const tx = r.range(-hw + 3, hw - 3), tz = r.range(lz1 + 4, hd - 3);
    const nearRotunda = Math.hypot(tx - rc.x, tz - rc.z) < rc.r + 4;
    const nearPond = Math.abs(tx - pondX) < 10 && Math.abs(tz - pondZ) < 7;
    const onPath = Math.abs(tx - rc.x) < 3;
    const onPad = Math.abs(tx - dx) < 6 && Math.abs(tz - dz) < 6;
    if (!nearRotunda && !nearPond && !onPath && !onPad) c.tree(tx, tz, r.chance(0.25) ? 'conifer' : 'deciduous');
  }
  // staff car park on the far side of the lab block
  const [px0, px1] = span(-hw + 52, hw);
  parkingLot(c, px0, -hd, px1, lz1 - 1, { fill: 0.3 + 0.5 * util, aisle: 6 });
  c.ground(Math.min(px0, px1), lz1 - 1, Math.max(px0, px1), lz1 + 1.5, P.road.parking, FL_PAVED | FL_SNOW);
  c.pool(rc.x, rc.z + rc.r + 3, 8);
  weeds(c, [[-hw + 2, lz1 + 3, hw - 2, hd - 2]]);
  return c.finish();
}

export const rdCenterFactory: AssetFactory = {
  id: 'rd_center',
  footprints: [[3, 3]],
  triBudget: { lod0: 2200, lod1: 100 },
  build,
};
