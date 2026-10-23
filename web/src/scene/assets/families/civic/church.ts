// Church — ambient archetype `ambient:civic:church` (art §4.3 civic list; 1×1 parish church, 2×2 town church).
// A steep-roofed nave with tall lancet windows and either a west tower with a spire (clock, belfry louvres,
// finial cross) or a gable front with a glowing rose window (twin towers on 2×2); the 2×2 church is cruciform
// with a transept and an apse. A churchyard with a path, hedges, yews and benches surrounds it. The spire is
// the landmark: it reads at city zoom (LOD1 keeps nave, roof, tower and spire).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FAC, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, ngonPts, rectSides, type Fac, type Side } from '../common-a/ctx';
import { clockFace, path, propLine } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';
import { uplight } from './classical';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x60a);
  const steeple = (p.variant >>> 0) % 2 === 0;
  const col = c.color, r = c.shape;
  const big = Math.min(c.W, c.D) >= 40;
  const hw = c.hw - 1, hd = c.hd - 1;
  const stone: RGB = col.pick([P.wall.stone, P.wall.sandWall, P.wall.limestone, P.wall.brick, P.wall.warmWhite]);
  const roof: RGB = col.pick([P.roof.slate, P.roof.slate, P.roof.tile, P.roof.shingle]);
  const spireCol: RGB = col.chance(0.4) ? P.roof.copper : roof;
  // dimensions
  const nw = big ? 7 : 4.5, wallH = big ? 12 : 7.5, rise = big ? 8 : 5.5;
  const lancet: Fac = { style: FAC.HOUSE, floor: wallH, bay: big ? 3.6 : 3.2 };
  const nz0 = big ? -16 : -hd + 1, nz1 = big ? (steeple ? 9 : 11) : steeple ? 4.2 : 6.5;
  const tw = big ? 8 : 5.2; // west tower width (steeple form)
  const tz0 = nz1 - 0.6, tz1 = tz0 + tw;
  const towerH = big ? 26 : 16, spireTop = big ? 48 : 29;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.park, FL_VEG | FL_SNOW, 0.03);
  // nave (walls without a lid) + gable roof along z
  c.mass(-nw, nz0, nw, nz1, 0, wallH, stone, c.lod === 0 ? null : lancet, null, { facs: { left: lancet, right: lancet } });
  c.gable(-nw, nz0, nw, nz1, wallH, rise, roof, stone, false, 0.35);
  // west front: tower + spire, or gable front (+ twin towers on 2×2)
  // twin west towers, 6 × 6 so their pyramid caps close them
  const twins: [number, number][] = big && !steeple ? [[-nw - 3.5, -nw + 2.5], [nw - 2.5, nw + 3.5]] : [];
  const sideTower = !big && !steeple;
  const stw = 4.2, stx0 = nw, stx1 = nw + stw, stz1 = nz1, stz0 = nz1 - stw; // 1×1 corner tower
  if (steeple) {
    c.mass(-tw / 2, tz0, tw / 2, tz1, 0, towerH, stone, null, null);
    c.spire(0, (tz0 + tz1) / 2, (tw / 2) * 1.08, towerH + (c.lod === 0 ? 0.7 : 0), spireTop, c.lod === 0 ? 8 : 4, spireCol, Math.PI / 8);
  } else if (sideTower) {
    c.mass(stx0, stz0, stx1, stz1, 0, 18, stone, null, null);
    c.spire((stx0 + stx1) / 2, (stz0 + stz1) / 2, stw * 0.75, 18, 26, 4, spireCol);
  }
  for (const [x0, x1] of twins) {
    c.mass(x0, nz1 - 5.4, x1, nz1 + 0.6, 0, 24, stone, null, null);
    c.spire((x0 + x1) / 2, nz1 - 2.4, 6 * 0.75, 24, 31, 4, spireCol);
  }
  if (big && c.lod === 0) {
    // transept and apse (2×2 only; the city band keeps the nave)
    c.mass(-14, -9, 14, -1, 0, wallH, stone, null, null, { facs: { front: lancet, back: lancet } });
    c.gable(-14, -9, 14, -1, wallH, rise, roof, stone, true, 0.35);
    c.prism(ngonPts(0, nz0, 6, 6, 8, Math.PI / 8), 0, wallH - 2, stone, lancet, null);
    c.cone(0, nz0, 6.4, 0, wallH - 2, wallH + 4, 8, roof);
  }
  if (c.lod === 1) return c.finish();

  // --- details
  const nf = rectSides(-nw, nz0, nw, nz1).front;
  if (steeple) {
    const ts = rectSides(-tw / 2, tz0, tw / 2, tz1);
    for (const s of [ts.front, ts.left, ts.right, ts.back]) {
      belfry(c, s, towerH);
      if (s !== ts.back) clockFace(c, s, s.len / 2, towerH - 6.2, big ? 1.4 : 0.95, 0.06);
    }
    c.cornice(-tw / 2, tz0, tw / 2, tz1, towerH, shade(stone, 1.05), 0.7, 0.3);
    cross(c, 0, (tz0 + tz1) / 2, spireTop);
    entrance(c, ts.front, ts.front.len / 2, big);
    uplight(c, ts.front, 0.3, ts.front.len - 0.3);
  } else {
    // gable front with the rose window and a central door
    const gy = wallH + rise * 0.42;
    roseWindow(c, nf, nf.len / 2, gy, big ? 2.4 : 1.35);
    entrance(c, nf, nf.len / 2, big);
    uplight(c, nf, 0.3, nf.len - 0.3);
    if (sideTower) {
      const ts = rectSides(stx0, stz0, stx1, stz1);
      for (const s of [ts.front, ts.right]) belfry(c, s, 18);
      cross(c, (stx0 + stx1) / 2, (stz0 + stz1) / 2, 26);
    }
    for (const [x0, x1] of twins) {
      const ts = rectSides(x0, nz1 - 5.4, x1, nz1 + 0.6);
      for (const s of [ts.front, ts.left, ts.right]) belfry(c, s, 24);
      cross(c, (x0 + x1) / 2, nz1 - 2.4, 31);
    }
  }
  // churchyard: path to the door, hedge along the street, yews and trees, benches, lamps
  const doorZ = steeple ? tz1 : nz1;
  path(c, 0, doorZ + 0.5, 0, c.hd - 0.3, big ? 3 : 2);
  propLine(c, 'hedge', -c.hw + 0.8, c.hd - 0.8, -2.2, c.hd - 0.8, 2.1);
  propLine(c, 'hedge', 2.2, c.hd - 0.8, c.hw - 0.8, c.hd - 0.8, 2.1);
  const yz = (doorZ + c.hd) / 2;
  for (const m of [-1, 1]) {
    if (!sideTower || m < 0) c.tree(m * (big ? 12 : 8), yz, 'conifer', big ? 0.9 : 0.6);
    c.prop('lamp.path', m * (big ? 2.4 : 1.8), c.hd - 2.5, 0);
    c.pool(m * 1.5, c.hd - 2.5, 4);
  }
  if (big) {
    for (let i = 0; i < 6; i++) c.tree(r.chance(0.5) ? r.range(-hw + 2, -16) : r.range(16, hw - 2), r.range(-hd + 2, 6), r.chance(0.4) ? 'conifer' : 'deciduous');
    for (const m of [-1, 1]) c.prop('bench', m * 4.5, c.hd - 6, m < 0 ? Math.PI / 2 : -Math.PI / 2);
  } else {
    c.tree(-hw + 1.2, -hd + 1.5, 'deciduous', 0.7);
  }
  return c.finish();
}

/** Dark louvred belfry openings near the top of a tower side. */
function belfry(c: Ctx, s: Side, top: number): void {
  const w = Math.min(1.6, s.len * 0.18);
  for (const u of s.len > 6 ? [s.len / 2 - w * 1.2, s.len / 2 + w * 1.2] : [s.len / 2]) c.panel(s, u - w / 2, u + w / 2, top - 4.2, top - 1.2, 0.04, X.screenDark);
}

/** Finial cross on a spire tip. */
function cross(c: Ctx, x: number, z: number, y: number): void {
  c.box(x - 0.07, y - 0.2, z - 0.07, x + 0.07, y + 1.6, z + 0.07, X.bronze);
  c.box(x - 0.5, y + 0.9, z - 0.07, x + 0.5, y + 1.05, z + 0.07, X.bronze);
}

/** Pointed-arch door (dark timber) with a stone surround and a step. */
function entrance(c: Ctx, s: Side, u: number, big: boolean): void {
  const w = big ? 2.6 : 1.8, h = big ? 4.2 : 3.0;
  c.panel(s, u - w / 2 - 0.35, u + w / 2 + 0.35, 0, h + 0.5, 0.05, P.wall.limestone);
  c.panel(s, u - w / 2, u + w / 2, 0.25, h, 0.08, X.doors[0]);
  c.sideBox(s, u - w / 2 - 0.6, u + w / 2 + 0.6, 0, 0.25, 0, 1.2, P.wall.stone);
}

/** Rose window: a stone ring round a glowing disc of glass. */
function roseWindow(c: Ctx, s: Side, u: number, v: number, rad: number): void {
  const n = 10, centre = s.p(u, v, 0.06);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    c.ta(centre, s.p(u + Math.cos(a0) * rad, v + Math.sin(a0) * rad, 0.06), s.p(u + Math.cos(a1) * rad, v + Math.sin(a1) * rad, 0.06), i % 2 ? P.ind.glass : shade(X.warmLight, 0.75), c.closed ? 0 : EM.soft);
  }
}

export const churchFactory: AssetFactory = {
  id: 'ambient:civic:church',
  footprints: [[1, 1], [2, 2]],
  triBudget: { lod0: 500, lod1: 40 },
  build,
};
