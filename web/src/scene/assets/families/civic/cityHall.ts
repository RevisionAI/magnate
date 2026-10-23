// City hall — ambient archetype `ambient:civic:hall` (art §4.3; one per city; 4×4, also fits 3×3).
// Two seeded forms:
//  * "capitol": a neo-classical block 60 × 26 × 14 m on a rusticated base with lower wings, a portico of six
//    Ø1.1 × 12 m columns under a pediment, and a Ø14 m drum carrying a copper dome to ~30 m with a lantern;
//  * "belfry": a long hipped range with end pavilions and a central clock tower (clock faces, belfry, spire ~50 m).
// Both stand behind a civic plaza with lawn parterres, a fountain and city flags, are uplit at night and keep a
// staff car park behind. LOD1 keeps the dome / tower silhouette (≤ 60 triangles).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { clockFace, eaveFascia, fountain, parkingLot, propLine } from '../common-a/kit';
import { P, X, mixRgb, shade } from '../common-a/palette';
import { CIVIC_STONES, GRAND, bronzeDoors, cityFlag, classicalBlock, drumDome, portico, uplight } from './classical';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x601);
  const belfry = (p.variant >>> 0) % 2 === 1;
  const col = c.color, r = c.shape;
  const big = Math.min(c.W, c.D) >= 90;
  const hw = c.hw - 1, hd = c.hd - 1;
  const stone = col.pick(CIVIC_STONES);
  const roofCol = col.chance(0.75) ? P.roof.copper : P.roof.slate;
  const zf = c.hd - (big ? 30 : 22); // main front face; the plaza lies in front of it

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.park, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 0) c.ground(-hw + 0.7, zf - 3, hw - 0.7, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  const backZ = belfry ? belfryHall(c, zf, big, stone, roofCol) : capitol(c, zf, big, stone, roofCol);
  if (c.lod === 1) return c.finish();

  // --- plaza: lawn parterres either side of the axis, a fountain, city flags, lamps, benches, trees
  const axisFront = zf + (belfry ? 8 : 10);
  const pw = big ? 30 : 22;
  for (const m of [-1, 1]) {
    const x0 = m < 0 ? -pw : 7, x1 = m < 0 ? -7 : pw;
    const face = m < 0 ? Math.PI / 2 : -Math.PI / 2;
    c.ground(x0, axisFront + 2, x1, hd - 4, P.ground.park, FL_VEG | FL_SNOW, 0.06);
    propLine(c, 'hedge', x0, hd - 3.6, x1, hd - 3.6, 2.1);
    for (let z = axisFront + 4; z < hd - 5; z += 8) c.tree(m * (pw + 3), z, 'deciduous', 1.1);
    c.prop('bench', m * 5.2, (axisFront + hd) / 2 + 6, face);
    c.prop('lamp.street', m * 9, axisFront + 1, face);
    c.prop('lamp.street', m * 9, hd - 2, face);
    c.pool(m * 7, axisFront + 1, 8);
    c.pool(m * 7, hd - 2, 8);
  }
  const fz = (axisFront + hd) / 2 - 1;
  fountain(c, 0, fz, big ? 4.5 : 3.5, shade(stone, 0.95));
  c.pool(0, fz, 9);
  cityFlag(c, -3.2, hd - 2.5, 14);
  cityFlag(c, 3.2, hd - 2.5, 14);

  // --- staff car park behind, trees round the back
  const pz1 = backZ - 3, pz0 = Math.max(-hd, pz1 - 17);
  if (pz1 - pz0 >= 12) parkingLot(c, -Math.min(hw - 4, 28), pz0, Math.min(hw - 4, 28), pz1, { fill: 0.6, aisle: 6.5, maxPerRow: 18, lamps: true });
  for (let i = 0; i < 6; i++) c.tree(r.range(-hw + 2, hw - 2), r.range(-hd + 1.5, -hd + 4), r.chance(0.3) ? 'conifer' : 'deciduous');
  for (const m of [-1, 1]) for (let z = pz0 + 2; z < backZ - 4; z += 7) c.tree(m * (hw - 1.5), z, 'deciduous');
  return c.finish();
}

/** Domed capitol with lower wings; returns the z of its back face. */
function capitol(c: Ctx, zf: number, big: boolean, stone: RGB, dome: RGB): number {
  const mw = big ? 30 : 20, depth = big ? 26 : 22;
  const wing0 = mw, wing1 = big ? 44 : 33;
  const z0 = zf - depth;
  const roof = mixRgb(P.roof.slate, stone, 0.5); // lead-grey flat roofs, so the copper dome pops at city zoom
  const domeR = big ? 7 : 6, dcz = (z0 + zf) / 2;
  if (c.lod === 1) {
    c.mass(-wing1, z0 + 4, wing1, zf - 3, 0, 11.5, stone, FACADE.civic, roof, { vBase: 1.5 });
    c.mass(-mw, z0, mw, zf, 0, 14, stone, GRAND, roof, { vBase: 2 });
    drumDome(c, 0, dcz, 14, domeR, 6.5, 8.5, stone, dome);
    return z0;
  }
  // wings (lower, set back 3 m; the wall against the main block is omitted), main block, portico, dome
  for (const m of [-1, 1]) {
    const x0 = m < 0 ? -wing1 : wing0, x1 = m < 0 ? -wing0 : wing1;
    classicalBlock(c, x0, z0 + 4, x1, zf - 3, 11.5, stone, { base: 1.5, fac: FACADE.civic, roof, cornice: true, sides: m < 0 ? 13 : 7 });
    const ws = rectSides(x0, z0 + 4, x1, zf - 3).front;
    uplight(c, ws, 0.5, ws.len - 0.5);
  }
  classicalBlock(c, -mw, z0, mw, zf, 14, stone, { base: 2, fac: GRAND, roof, cornice: true, balustrade: true });
  const front = rectSides(-mw, z0, mw, zf).front;
  const um = front.len / 2, pw = big ? 11 : 9;
  portico(c, front, um - pw, um + pw, { cols: 6, r: 0.55, base: 2, colTop: 14, depth: 6, entH: 1.8, rise: 4.5, stone, roof: dome });
  c.sign(front, um - pw * 0.55, um + pw * 0.55, 14.35, 15.45, 6.03, 'civic:hall');
  bronzeDoors(c, front, um, 3.2, 5, 2);
  bronzeDoors(c, front, um - 7, 2.2, 4, 2);
  bronzeDoors(c, front, um + 7, 2.2, 4, 2);
  uplight(c, front, 0.5, um - pw - 1.5);
  uplight(c, front, um + pw + 1.5, front.len - 0.5);
  // square attic podium under the drum, then the drum and dome
  c.box(-domeR - 2.5, 14, dcz - domeR - 2.5, domeR + 2.5, 15.6, dcz + domeR + 2.5, shade(stone, 0.95), shade(stone, 1.04));
  drumDome(c, 0, dcz, 15.6, domeR, 6.5, 8.5, stone, dome);
  c.pool(0, zf + 9, 10);
  return z0;
}

/** Hipped range with end pavilions and a central clock tower; returns the z of its back face. */
function belfryHall(c: Ctx, zf: number, big: boolean, stone: RGB, roofCol: RGB): number {
  const px1 = big ? 44 : 33, pw = big ? 12 : 10, px0 = px1 - pw;
  const depth = big ? 22 : 18, z0 = zf - depth;
  const slate = P.roof.slate;
  const eave = 11.5, peave = 16.5, ty = big ? 36 : 31;
  const tx0 = -5, tx1 = 5, tz0 = zf - 6, tz1 = zf + 4, tcz = (tz0 + tz1) / 2;
  // long range (only its street and back walls: the ends sit inside the pavilions) under a hipped roof
  c.mass(-px0, z0, px0, zf, 0, eave, stone, FACADE.civic, null, { vBase: 1.5, sides: 5 });
  c.hip(-px0 - 0.4, z0, px0 + 0.4, zf, eave, 7, slate, 0.4);
  for (const m of [-1, 1]) {
    const x0 = m < 0 ? -px1 : px0, x1 = m < 0 ? -px0 : px1;
    c.mass(x0, z0 - 2, x1, zf + 2, 0, peave, stone, FACADE.civic, null, { vBase: 1.5 });
    c.hip(x0, z0 - 2, x1, zf + 2, peave, 8, slate, 0.4);
    if (c.lod === 0) eaveFascia(c, x0, z0 - 2, x1, zf + 2, peave, 0.4, 'hip', shade(stone, 1.05));
  }
  // clock tower: windowed shaft (LOD0 windows stop below the clock stage), spire
  c.mass(tx0, tz0, tx1, tz1, 0, ty, stone, c.lod === 0 ? null : FACADE.civic, null, { vBase: 1.5 });
  c.spire(0, tcz, (tx1 - tx0) * 0.72, ty + (c.lod === 0 ? 0.9 : 0), ty + 15, 4, roofCol);
  if (c.lod === 1) return z0 - 2;

  eaveFascia(c, -px0 - 0.4, z0, px0 + 0.4, zf, eave, 0.4, 'hip', shade(stone, 1.05));
  const mf = rectSides(-px0, z0, px0, zf).front;
  c.panel(mf, 0, mf.len, 0, 1.5, 0.06, shade(stone, 0.86)); // rusticated base band
  const ts = rectSides(tx0, tz0, tx1, tz1);
  for (const s of [ts.front, ts.right, ts.back, ts.left]) {
    c.panel(s, 0.6, s.len - 0.6, 0, ty - 11, 0.03, stone, 0, FACADE.civic, 1.5);
    clockFace(c, s, s.len / 2, ty - 7, 2.1, 0.08);
    for (const u of [s.len / 2 - 2.2, s.len / 2 + 2.2]) c.panel(s, u - 1.1, u + 1.1, ty - 4.2, ty - 0.8, 0.04, X.screenDark);
  }
  c.cornice(tx0, tz0, tx1, tz1, ty, shade(stone, 1.05), 0.9, 0.5);
  c.cyl(0, tcz, 0.08, ty + 15, ty + 18, 4, X.bronze, X.bronze);
  // entrance porch with steps under the tower, bronze doors, inscription, uplighting
  const front = ts.front;
  c.sideBox(front, 1.2, front.len - 1.2, 0, 0.9, 0, 3.2, shade(stone, 0.95), shade(stone, 1.05));
  c.sideBox(front, 0.6, front.len - 0.6, 0, 0.45, 3.2, 4.6, shade(stone, 0.95), shade(stone, 1.05));
  bronzeDoors(c, front, front.len / 2, 4, 5.6, 0.9);
  c.sign(front, front.len / 2 - 3.6, front.len / 2 + 3.6, 7.2, 8.4, 0.06, 'civic:hall');
  uplight(c, mf, 0.5, mf.len / 2 - 6);
  uplight(c, mf, mf.len / 2 + 6, mf.len - 0.5);
  c.panel(front, 0.4, front.len - 0.4, ty - 11.2, ty - 10.9, 0.12, X.warmLight, c.closed ? 0 : EM.soft);
  c.pool(0, zf + 8, 10);
  return z0 - 2;
}

export const cityHallFactory: AssetFactory = {
  id: 'ambient:civic:hall',
  footprints: [[4, 4], [3, 3]],
  triBudget: { lod0: 1200, lod1: 60 },
  build,
};
