// Plaza / promenade — ambient archetype `ambient:plaza` (art §4.3; strips and squares, 1×1 to 3×1).
// Paving #DDD5C6 with a border band and a joint grid, trees in dark grates along the long edges with benches
// between them, street lamps, and a seeded centrepiece: a fountain, a statue, an obelisk, a clock pillar or a row
// of market stalls under striped awnings. LOD1: the paving and, when there is one, the monument's spire.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, Y_GROUND, Y_PAINT } from '../common-a/constants';
import { Ctx, rectSides } from '../common-a/ctx';
import { clockFace, fountain, statue } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

type Centre = 'fountain' | 'statue' | 'obelisk' | 'clock' | 'market';
const CENTRES: readonly Centre[] = ['fountain', 'statue', 'obelisk', 'clock', 'market'];

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x60c);
  const r = c.shape, col = c.color;
  const hw = c.hw, hd = c.hd;
  const along = c.W >= c.D; // long axis along x
  const minSide = Math.min(c.W, c.D);
  let centre = CENTRES[(p.variant >>> 0) % CENTRES.length];
  if (centre === 'market' && Math.max(c.W, c.D) < 40) centre = 'statue';
  const stone = col.pick([P.wall.stone, P.wall.limestone, P.wall.greige]);

  c.ground(-hw + 0.3, -hd + 0.3, hw - 0.3, hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW, 0.03);
  if (centre === 'obelisk') {
    if (c.lod === 0) c.boxc(0, 0, 2.6, 2.6, 0, 1.4, stone, shade(stone, 1.05));
    c.spire(0, 0, 1.0, c.lod === 0 ? 1.4 : 0, 14, 4, shade(stone, 1.06));
  } else if (centre === 'clock' && c.lod === 1) {
    c.spire(0, 0, 0.7, 0, 5, 4, X.lampPole);
  }
  if (c.lod === 1) return c.finish();

  // paving pattern: border band and joints every ~12 m
  const band = P.road.sidewalk, y = Y_PAINT - 0.02;
  const bx = hw - 1.4, bz = hd - 1.4;
  c.line(-bx, -bz, bx, -bz, 0.5, band, y);
  c.line(-bx, bz, bx, bz, 0.5, band, y);
  c.line(-bx, -bz, -bx, bz, 0.5, band, y);
  c.line(bx, -bz, bx, bz, 0.5, band, y);
  const nx = Math.max(0, Math.round(c.W / 12) - 1), nz = Math.max(0, Math.round(c.D / 12) - 1);
  for (let i = 1; i <= nx; i++) {
    const x = -bx + (2 * bx * i) / (nx + 1);
    if (Math.abs(x) > 4) c.line(x, -bz, x, bz, 0.25, band, y);
  }
  for (let i = 1; i <= nz; i++) {
    const z = -bz + (2 * bz * i) / (nz + 1);
    if (Math.abs(z) > 4) c.line(-bx, z, bx, z, 0.25, band, y);
  }

  // trees in grates along the long edges, benches between them, lamps at the ends
  const L = along ? hw : hd, S = along ? hd : hw;
  const rowOff = S - 3.2;
  const pt = (u: number, v: number): [number, number] => (along ? [u, v] : [v, u]);
  for (const sgn of minSide >= 24 ? [-1, 1] : [1]) {
    for (let u = -L + 4; u <= L - 4 + 1e-6; u += 8) {
      if (Math.abs(u) < (centre === 'market' ? 0 : 5.5) && minSide < 30) continue;
      const [x, z] = pt(u, sgn * rowOff);
      c.ground(x - 1.0, z - 1.0, x + 1.0, z + 1.0, P.road.asphaltDark, FL_PAVED, Y_GROUND + 0.035);
      c.tree(x, z, r.chance(0.2) ? 'poplar' : 'deciduous', 0.85);
      const [bxp, bzp] = pt(u + 4, sgn * (rowOff - 0.2));
      if (u + 4 < L - 2) c.prop('bench', bxp, bzp, along ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  for (const sgn of [-1, 1]) {
    const [x, z] = pt(sgn * (L - 1.5), -rowOff);
    c.prop('lamp.street', x, z, along ? (sgn > 0 ? -Math.PI / 2 : Math.PI / 2) : sgn > 0 ? Math.PI : 0);
    c.pool(x * 0.9, z * 0.9, 7);
  }

  // larger squares: raised planters with a tree each on the diagonals and an inner ring of benches
  if (minSide >= 40 && centre !== 'market') {
    const d = Math.min(c.W, c.D) * 0.22;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      c.withFlags(FL_SNOW, () => c.boxc(sx * d, sz * d, 3.4, 3.4, 0, 0.6, stone, P.ground.park));
      c.tree(sx * d, sz * d, 'deciduous', 0.9);
      c.prop('bench', sx * d * 0.55, sz * d * 0.55, Math.atan2(-sx, -sz));
    }
  }

  // centrepiece
  switch (centre) {
    case 'fountain':
      fountain(c, 0, 0, Math.min(5, minSide / 2 - 5), stone, minSide >= 40 ? 12 : 8);
      c.pool(0, 0, 8);
      break;
    case 'statue':
      c.disc(0, 0, 3.2, Y_GROUND + 0.04, 8, shade(P.road.plaza, 0.93));
      statue(c, 0, 0, stone, 2.4);
      c.pool(0, 0, 6);
      break;
    case 'obelisk':
      c.disc(0, 0, 3.6, Y_GROUND + 0.04, 8, shade(P.road.plaza, 0.93));
      c.pool(0, 0, 6);
      break;
    case 'clock': {
      c.cyl(0, 0, 0.18, 0, 3.4, 6, X.lampPole, X.lampPole, false);
      c.boxc(0, 0, 1.2, 1.2, 3.4, 1.2, X.lampPole, X.lampPole);
      const s = rectSides(-0.6, -0.6, 0.6, 0.6);
      for (const side of [s.front, s.back, s.left, s.right]) clockFace(c, side, 0.6, 4.0, 0.45, 0.02);
      c.pool(0, 0, 5);
      break;
    }
    case 'market': {
      const n = Math.max(2, Math.min(6, Math.floor((2 * L - 10) / 5)));
      for (let i = 0; i < n; i++) {
        const u = -((n - 1) * 5) / 2 + i * 5;
        const [x, z] = pt(u, 0);
        const aw = X.awnings[(i + Math.floor(r.f() * 6)) % X.awnings.length];
        c.boxc(x, z, along ? 3.2 : 2.2, along ? 2.2 : 3.2, 0, 2.2, P.wall.warmWhite, X.timber);
        // awning sloping down towards the shoppers (+v), wound counter-clockwise from above
        if (along) c.qa([u - 1.8, 2.35, 2.6], [u + 1.8, 2.35, 2.6], [u + 1.8, 2.75, 1.1], [u - 1.8, 2.75, 1.1], aw);
        else c.qa([1.1, 2.75, u + 1.8], [2.6, 2.35, u + 1.8], [2.6, 2.35, u - 1.8], [1.1, 2.75, u - 1.8], aw);
      }
      c.pool(0, 0, 9);
      break;
    }
  }
  return c.finish();
}

export const plazaFactory: AssetFactory = {
  id: 'ambient:plaza',
  footprints: [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1]],
  triBudget: { lod0: 200, lod1: 10 },
  build,
};
