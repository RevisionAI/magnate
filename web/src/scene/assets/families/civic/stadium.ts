// Stadium — ambient archetype `ambient:civic:stadium` (art §4.3; 5×5, also 4×4).
// A superellipse bowl of 20 segments: a pitch-side wall, a lower tier rising 4 → 10 m, a concourse step and an
// upper tier to 16 m behind a parapet; the outer wall carries a glazed concourse band and entrance portals on
// the street side. The pitch #5E9E4A is mown in stripes with full markings and goals; four 36 m floodlight
// masts carry emissive light banks and drop light pools on the pitch at night. Seeded forms: an open athletics
// bowl with a running track and an external scoreboard, or a football ground under a membrane roof ring.
// LOD1: outer wall plus one seating slope (or the roof ring) over the pitch (≤ 60 triangles).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FAC, FL_PAVED, FL_SNOW, FL_VEG, Y_GROUND, Y_PAINT } from '../common-a/constants';
import { Ctx, Side, type XZ } from '../common-a/ctx';
import { bandBetween, ring, superPts } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const SUPER_N = 4; // superellipse exponent: straight-ish stands with rounded corners

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x609);
  const roofed = (p.variant >>> 0) % 2 === 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const k = Math.min(c.W, c.D) / 120;
  const N = c.lod === 0 ? 20 : 12;
  const cz = -3.5 * k;
  const concrete = col.pick([P.wall.concrete, P.wall.greige, P.wall.stone]);
  const seats = col.pick([P.ind.dockDoors, shade(P.ind.dockDoors, 1.15), P.wall.concreteDark]);
  const ring0 = (a: number, bb: number): XZ[] => superPts(0, cz, a * k, bb * k, SUPER_N, N);
  const inner = ring0(38, 27), mid = ring0(47, 37.5), outer = ring0(56, 48.5), rin = ring0(45, 35.5);
  const yIn = 4, yMid = 10, yUp = 11, yTop = 16, yPar = 17.2, yRoof = 21;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW, 0.03);
  const pa = 32 * k, pb = 20 * k; // pitch half extents (long axis along x)

  if (c.lod === 1) {
    c.ground(-pa, cz - pb, pa, cz + pb, X.pitch, FL_VEG | FL_SNOW, Y_GROUND + 0.03);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      c.wall(outer[i][0], outer[i][1], outer[j][0], outer[j][1], 0, roofed ? yRoof : yPar, concrete, null);
      if (roofed) roofQuad(c, outer[i], outer[j], rin[j], rin[i], yRoof, yRoof + 1.5, P.roof.membrane);
      else c.qa([outer[i][0], yTop, outer[i][1]], [outer[j][0], yTop, outer[j][1]], [inner[j][0], yIn, inner[j][1]], [inner[i][0], yIn, inner[i][1]], seats);
    }
    return c.finish();
  }

  // --- pitch surround (track or grass), striped pitch, markings, goals
  c.groundFan(0, cz, inner, roofed ? P.ground.park : X.runningTrack, roofed ? FL_VEG | FL_SNOW : FL_SNOW, Y_GROUND + 0.01);
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const x0 = -pa + (2 * pa * i) / stripes, x1 = -pa + (2 * pa * (i + 1)) / stripes;
    c.ground(x0, cz - pb, x1, cz + pb, i % 2 ? X.pitch : X.pitchStripe, FL_VEG | FL_SNOW, Y_GROUND + 0.03);
  }
  pitchLines(c, 0, cz, pa - 2, pb - 2);

  // --- the bowl
  const parIn = ring0(56 - 0.6 / k, 48.5 - 0.6 / k);
  const concourse: { style: number; floor: number; bay: number } = { style: FAC.INDUSTRIAL, floor: roofed ? yRoof : yPar, bay: 6 };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const [oi, oj, mi, mj, ii, ij] = [outer[i], outer[j], mid[i], mid[j], inner[i], inner[j]];
    c.wall(ij[0], ij[1], ii[0], ii[1], 0, yIn, shade(concrete, 0.9), null); // pitch-side wall
    c.qa([mi[0], yMid, mi[1]], [mj[0], yMid, mj[1]], [ij[0], yIn, ij[1]], [ii[0], yIn, ii[1]], shade(seats, 1.12)); // lower tier
    c.wall(mj[0], mj[1], mi[0], mi[1], yMid, yUp, concrete, null); // concourse step
    c.qa([oi[0], yTop, oi[1]], [oj[0], yTop, oj[1]], [mj[0], yUp, mj[1]], [mi[0], yUp, mi[1]], i % 2 ? seats : shade(seats, 1.07)); // upper tier, blocks
    c.wall(oi[0], oi[1], oj[0], oj[1], 0, roofed ? yRoof : yPar, concrete, concourse); // outer wall
    // structural pier at each segment joint gives the outer wall its rhythm at street zoom
    c.sideBox(new Side(oi[0], oi[1], oj[0], oj[1]), -0.45, 0.45, 0, (roofed ? yRoof : yPar) + 0.3, 0, 0.55, shade(concrete, 1.07));
    if (roofed) {
      roofQuad(c, oi, oj, rin[j], rin[i], yRoof, yRoof + 1.5, P.roof.membrane);
      c.qa([rin[i][0], yRoof + 1.4, rin[i][1]], [rin[j][0], yRoof + 1.4, rin[j][1]], [oj[0], yRoof - 0.1, oj[1]], [oi[0], yRoof - 0.1, oi[1]], P.ind.galvanized); // underside
      c.wall(rin[j][0], rin[j][1], rin[i][0], rin[i][1], yRoof + 0.6, yRoof + 1.5, P.wall.warmWhite, null); // roof fascia
    } else {
      c.wall(parIn[j][0], parIn[j][1], parIn[i][0], parIn[i][1], yTop, yPar, concrete, null); // parapet inner face
    }
  }
  if (!roofed) bandBetween(c, outer, parIn, yPar, shade(concrete, 1.06), FL_SNOW);

  // --- entrance portals and the name on the street side
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const s = new Side(outer[i][0], outer[i][1], outer[j][0], outer[j][1]);
    if ((outer[i][1] + outer[j][1]) / 2 < cz + 44 * k || s.len < 8) continue;
    c.panel(s, s.len / 2 - 2.2, s.len / 2 + 2.2, 0, 3.4, 0.05, X.screenDark);
    c.panel(s, s.len / 2 - 2.6, s.len / 2 + 2.6, 3.5, 3.75, 0.08, X.warmLight, c.closed ? 0 : EM.soft);
    if ((outer[i][1] + outer[j][1]) / 2 >= cz + 47 * k) c.sign(s, s.len / 2 - 4, s.len / 2 + 4, 5.2, 6.6, 0.07, 'civic:stadium');
    c.pool(s.x(s.len / 2, 3), s.z(s.len / 2, 3), 8);
  }

  // --- floodlight masts with emissive banks aimed at the centre spot
  for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const ct = Math.cos(t), st = Math.sin(t), e = 2 / SUPER_N;
    const mx = (56 * k + 3.5) * Math.sign(ct) * Math.abs(ct) ** e, mz = cz + (48.5 * k + 3.5) * Math.sign(st) * Math.abs(st) ** e;
    const dl = Math.hypot(mx, cz - mz) || 1, dx = -mx / dl, dz = (cz - mz) / dl;
    c.cyl(mx, mz, 0.55, 0, 33, 6, shade(concrete, 0.85), shade(concrete, 0.85), false);
    const s = new Side(mx - dz * 3.6, mz + dx * 3.6, mx + dz * 3.6, mz - dx * 3.6);
    c.sideBox(s, 0, 7.2, 32.4, 36, -0.4, 0.25, X.lampHead, X.lampPole, c.closed ? 0 : EM.lamp, 0);
    c.panel(new Side(s.bx, s.bz, s.ax, s.az), 0, 7.2, 32.4, 36, 0.4, X.lampPole); // back of the bank
    c.pool(mx * 0.35, cz + (mz - cz) * 0.35, 26 * k);
  }

  // --- scoreboard behind the open bowl's back stand
  if (!roofed) {
    const sz = cz - 48.5 * k - 2.6;
    for (const x of [-6, 6]) c.boxc(x, sz, 0.6, 0.6, 0, 18, shade(concrete, 0.85));
    c.box(-8.5, 18, sz - 0.6, 8.5, 25, sz + 0.6, X.screenDark, shade(concrete, 0.9));
    c.panel(new Side(-8.5, sz + 0.6, 8.5, sz + 0.6), 0.4, 16.6, 18.5, 24.5, 0.02, P.ind.glass, c.closed ? 0 : EM.soft);
  }

  // --- plaza in front: ticket booths, flags, lamps, trees in the corners
  const front = cz + 48.5 * k;
  for (const m of [-1, 1]) {
    const bx = m * 18 * k, bz = Math.min(hd - 3, front + 6);
    c.boxc(bx, bz, 4.4, 2.6, 0, 3, shade(concrete, 1.04), P.roof.tar);
    c.panel(new Side(bx - 2.2, bz + 1.3, bx + 2.2, bz + 1.3), 0.4, 4.0, 1.0, 2.2, 0.02, P.ind.glass2, c.closed ? 0 : EM.faint);
    c.prop('lamp.street', m * 30 * k, hd - 1.5, m < 0 ? Math.PI / 2 : -Math.PI / 2);
    c.pool(m * 28 * k, hd - 1.5, 8);
    for (const zc of [-hd + 3, -hd + 9]) c.tree(m * (hw - 3), zc, 'deciduous');
    c.tree(m * (hw - 2.5), hd - 3, 'deciduous');
  }
  c.prop('busShelter', 0, hd - 1.6, 0);
  for (const x of [-4, 0, 4]) c.prop('bench', x + r.range(-0.3, 0.3), hd - 5.5, 0);
  return c.finish();
}

/** Top face of one roof-ring segment from the outer edge (height y0) up to the inner edge (height y1). */
function roofQuad(c: Ctx, oi: XZ, oj: XZ, rj: XZ, ri: XZ, y0: number, y1: number, col: RGB): void {
  c.withFlags(FL_SNOW, () => c.qa([oi[0], y0, oi[1]], [oj[0], y0, oj[1]], [rj[0], y1, rj[1]], [ri[0], y1, ri[1]], col));
}

/** Football markings centred at (x, z): touchlines a × b, halfway line, centre circle and spot, boxes, goals. */
function pitchLines(c: Ctx, x: number, z: number, a: number, b: number): void {
  const y = Y_PAINT + 0.03, w = 0.14, col = P.road.marking;
  c.line(x - a, z - b, x + a, z - b, w, col, y);
  c.line(x - a, z + b, x + a, z + b, w, col, y);
  c.line(x - a, z - b, x - a, z + b, w, col, y);
  c.line(x + a, z - b, x + a, z + b, w, col, y);
  c.line(x, z - b, x, z + b, w, col, y);
  ring(c, x, z, 5.4, 5.4 + w, y, 14, col);
  for (const s of [-1, 1]) {
    const gx = x + s * a, bx = gx - s * 10;
    c.line(gx, z - 10, bx, z - 10, w, col, y);
    c.line(gx, z + 10, bx, z + 10, w, col, y);
    c.line(bx, z - 10, bx, z + 10, w, col, y);
    // goal frame: two posts and the crossbar
    for (const gz of [z - 3.66, z + 3.66]) c.boxc(gx, gz, 0.14, 0.14, 0, 2.44, X.white);
    c.box(gx - 0.07, 2.3, z - 3.66, gx + 0.07, 2.44, z + 3.66, X.white);
  }
}

export const stadiumFactory: AssetFactory = {
  id: 'ambient:civic:stadium',
  footprints: [[5, 5], [4, 4]],
  triBudget: { lod0: 1200, lod1: 60 },
  build,
};
