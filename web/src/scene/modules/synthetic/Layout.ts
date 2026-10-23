// Deterministic synthetic city layout on the 24 m plot grid — the stand-in for E3a's CityLayoutGenerator until W2
// renders the engine layout (Wave 2). Used by the SceneLab test city and the interim in-game PlaceholderCity.
//
// Arterials every ~12 plots, streets between them with varied block sizes, an optional sea along the south edge
// with a beach/quay strip, an optional river running north→south into it (roads cross on bridges), zones by
// distance from a CBD plus an industrial quarter, parks, and lots tiled per block. Pure data: no three.js objects.
import { mulberry32, hash3 } from '../../env/rng';
import { WATER_NONE, WATER_RIVER, WATER_SEA, type HighwayExit } from '../../env/World';

export const KIND_LOT = 0;
export const KIND_ROAD = 1;
export const KIND_WATER = 2;
export const KIND_PARK = 3;
export const KIND_SHORE = 4;
export const KIND_RESERVED = 5;    // empty development land (company buildings go here)

export const ROAD_NONE = 0;
export const ROAD_STREET = 1;
export const ROAD_ARTERIAL = 2;

export const ZONE_CBD = 0;
export const ZONE_COMMERCIAL = 1;
export const ZONE_RESIDENTIAL = 2;
export const ZONE_INDUSTRIAL = 3;
export const ZONE_SUBURB = 4;

export type LotUse = 'house' | 'apartment' | 'shop' | 'office' | 'tower' | 'industrial' | 'park' | 'reserved';

export interface Lot {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  use: LotUse;
  zone: number;
  /** Quarter turns so the lot frame's +Z faces the best adjacent road (0 = S, 1 = E, 2 = N, 3 = W). */
  facing: 0 | 1 | 2 | 3;
  seed: number;
}

export interface SyntheticLayoutOptions {
  gridW: number;
  gridH: number;
  seed: number;
  /** Sea along one edge (`seaEdge`, default north: behind the city in the default south-facing camera). */
  coastal?: boolean;
  seaEdge?: 'N' | 'S';
  /** River from the north edge to the sea (or the south edge). */
  river?: boolean;
  /** Fraction of central commercial blocks left empty for company buildings (0 = none). */
  reserveShare?: number;
}

export interface SyntheticLayout {
  gridW: number;
  gridH: number;
  seed: number;
  kind: Uint8Array;
  road: Uint8Array;
  water: Uint8Array;
  zone: Uint8Array;
  /** Lot id per plot, −1 for roads/water/shore. */
  lotOf: Int32Array;
  lots: Lot[];
  highways: HighwayExit[];
  /** Plots reserved for company buildings, sorted by distance to the centre. */
  reserved: Array<{ px: number; pz: number }>;
  /** CBD centre in (fractional) plot coordinates. */
  center: { px: number; pz: number };
}

/** Positions of arterial lines along an axis (indices), every 11–14 plots, never on the outermost 3 plots. */
function arterialLines(len: number, rnd: () => number): number[] {
  const out: number[] = [];
  for (let p = 5 + Math.floor(rnd() * 3); p < len - 4; p += 11 + Math.floor(rnd() * 4)) out.push(p);
  return out;
}

/** Street lines between arterials: blocks of 4–6 plots (land between two roads). */
function streetLines(len: number, arterials: number[], rnd: () => number, minBlock: number, maxBlock: number): number[] {
  const out: number[] = [];
  const bounds = [-1, ...arterials, len];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    let p = a + 1 + minBlock + Math.floor(rnd() * (maxBlock - minBlock + 1));
    while (b - p > minBlock + 1) {
      out.push(p);
      p += 1 + minBlock + Math.floor(rnd() * (maxBlock - minBlock + 1));
    }
  }
  return out;
}

export function layoutSyntheticCity(opts: SyntheticLayoutOptions): SyntheticLayout {
  const layout = layoutSouthCoast(opts);
  return opts.coastal && (opts.seaEdge ?? 'N') === 'N' ? flipNorthSouth(layout) : layout;
}

/** Mirror a layout north↔south (the generator always builds its sea on the south edge). */
function flipNorthSouth(l: SyntheticLayout): SyntheticLayout {
  const { gridW: W, gridH: H } = l;
  const flip = <T extends Uint8Array | Int32Array>(a: T): T => {
    const out = a.slice() as T;
    for (let z = 0; z < H; z++) out.set(a.subarray((H - 1 - z) * W, (H - z) * W), z * W);
    return out;
  };
  const facing = [2, 1, 0, 3] as const;              // S↔N, E and W unchanged
  return {
    ...l,
    kind: flip(l.kind), road: flip(l.road), water: flip(l.water), zone: flip(l.zone), lotOf: flip(l.lotOf),
    lots: l.lots.map((lot) => ({ ...lot, pz: H - lot.pz - lot.h, facing: facing[lot.facing] })),
    highways: l.highways.map((h) => ({ ...h, edge: h.edge === 'N' ? 'S' : h.edge === 'S' ? 'N' : h.edge })),
    reserved: l.reserved.map((r) => ({ px: r.px, pz: H - 1 - r.pz })),
    center: { px: l.center.px, pz: H - l.center.pz },
  };
}

function layoutSouthCoast(opts: SyntheticLayoutOptions): SyntheticLayout {
  const { gridW: W, gridH: H, seed } = opts;
  const rnd = mulberry32(seed ^ 0x6a09e667);
  const n = W * H;
  const kind = new Uint8Array(n);
  const road = new Uint8Array(n);
  const water = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const lotOf = new Int32Array(n).fill(-1);
  const at = (x: number, z: number) => z * W + x;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;

  // --- water: sea rows along the south edge (wobbling 3–5 plots), river from the north.
  const seaTop = new Int32Array(W).fill(H);
  if (opts.coastal) {
    let depth = 3 + Math.floor(rnd() * 2);
    for (let x = 0; x < W; x++) {
      if (x % 6 === 0) depth = Math.max(3, Math.min(5, depth + (rnd() < 0.5 ? -1 : 1)));
      seaTop[x] = H - depth;
      for (let z = H - depth; z < H; z++) { water[at(x, z)] = WATER_SEA; kind[at(x, z)] = KIND_WATER; }
    }
  }
  if (opts.river) {
    let x = Math.round(W * (0.62 + 0.06 * (rnd() - 0.5)));
    for (let z = 0; z < H; z++) {
      if (z > 0 && z % 5 === 0 && rnd() < 0.6) x += rnd() < 0.5 ? -1 : 1;
      x = Math.max(4, Math.min(W - 6, x));
      for (let dx = 0; dx < 2; dx++) {
        const i = at(x + dx, z);
        if (water[i] === WATER_NONE) { water[i] = WATER_RIVER; kind[i] = KIND_WATER; }
      }
    }
  }

  // --- roads: arterials + streets (roads over water become bridges; none inside the sea).
  const artX = arterialLines(W, rnd), artZ = arterialLines(H, rnd);
  const strX = streetLines(W, artX, rnd, 4, 7), strZ = streetLines(H, artZ, rnd, 3, 5);
  const setRoad = (x: number, z: number, cls: number) => {
    const i = at(x, z);
    if (water[i] === WATER_SEA) return;
    road[i] = Math.max(road[i], cls);
    kind[i] = KIND_ROAD;
  };
  for (const x of strX) for (let z = 0; z < H; z++) setRoad(x, z, ROAD_STREET);
  for (const z of strZ) for (let x = 0; x < W; x++) setRoad(x, z, ROAD_STREET);
  for (const x of artX) for (let z = 0; z < H; z++) setRoad(x, z, ROAD_ARTERIAL);
  for (const z of artZ) for (let x = 0; x < W; x++) setRoad(x, z, ROAD_ARTERIAL);
  // A shore road along the sea.
  if (opts.coastal) {
    for (let x = 0; x < W; x++) {
      const z = seaTop[x] - 2;
      if (z > 2) setRoad(x, z, ROAD_STREET);
    }
  }
  // Streets that would dead-end on the river bank keep going (bridges); trim stubs that run into the sea edge.
  const highways: HighwayExit[] = [];
  for (const x of artX) if (water[at(x, 0)] === WATER_NONE) highways.push({ edge: 'N', at: x });
  for (const z of artZ) {
    if (water[at(0, z)] === WATER_NONE) highways.push({ edge: 'W', at: z });
    if (water[at(W - 1, z)] === WATER_NONE) highways.push({ edge: 'E', at: z });
  }
  if (!opts.coastal) for (const x of artX) if (water[at(x, H - 1)] === WATER_NONE) highways.push({ edge: 'S', at: x });

  // --- shore strip: the land plot between the shore road and the sea (beach / quay).
  if (opts.coastal) {
    for (let x = 0; x < W; x++) {
      const z = seaTop[x] - 1;
      if (z >= 0 && kind[at(x, z)] === KIND_LOT) kind[at(x, z)] = KIND_SHORE;
    }
  }

  // --- zones by distance from the CBD centre; an industrial quarter towards the water in the south-east.
  const cx = W * (0.44 + 0.08 * rnd()), cz = H * (0.4 + 0.08 * rnd());
  const R = Math.min(W, H) * 0.5;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / R;
      const ang = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);           // 0 = east, π/2 = south
      const industrial = r > 0.42 && r < 1.05 && ang > -0.15 && ang < 1.25;
      zone[at(x, z)] = r < 0.2 ? ZONE_CBD : industrial ? ZONE_INDUSTRIAL : r < 0.42 ? ZONE_COMMERCIAL : r < 0.8 ? ZONE_RESIDENTIAL : ZONE_SUBURB;
    }
  }

  // --- blocks → lots.
  const lots: Lot[] = [];
  const reserved: Array<{ px: number; pz: number }> = [];
  const seen = new Uint8Array(n);
  const reserveShare = opts.reserveShare ?? 0;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, z);
      if (seen[i] || kind[i] !== KIND_LOT) continue;
      // Flood the block (4-connected land plots).
      const block: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        block.push(j);
        const bx = j % W, bz = (j - bx) / W;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = bx + dx, nz = bz + dz;
          if (!inside(nx, nz)) continue;
          const k = at(nx, nz);
          if (!seen[k] && kind[k] === KIND_LOT) { seen[k] = 1; stack.push(k); }
        }
      }
      block.sort((a, b) => a - b);
      const blockZone = zone[block[Math.floor(block.length / 2)]];
      const bh = hash3(block[0], block.length, seed);
      const blockId = lots.length;
      if (bh < 0.07 && blockZone !== ZONE_INDUSTRIAL && block.length >= 6) {
        for (const j of block) { kind[j] = KIND_PARK; lotOf[j] = blockId; }
        const bx = block[0] % W, bz = (block[0] - bx) / W;
        lots.push({ id: blockId, px: bx, pz: bz, w: 1, h: 1, use: 'park', zone: blockZone, facing: 0, seed: Math.floor(bh * 1e9) });
        continue;
      }
      if (reserveShare > 0 && (blockZone === ZONE_COMMERCIAL || blockZone === ZONE_CBD) && bh > 1 - reserveShare && block.length >= 9) {
        for (const j of block) { kind[j] = KIND_RESERVED; const bx = j % W; reserved.push({ px: bx, pz: (j - bx) / W }); }
        continue;
      }
      tileBlock(block);
    }
  }

  function preferredSizes(zn: number, h: number): Array<[number, number]> {
    switch (zn) {
      case ZONE_CBD: return h < 0.7 ? [[2, 2], [2, 1], [1, 1]] : [[3, 2], [2, 2], [1, 1]];
      case ZONE_COMMERCIAL: return h < 0.5 ? [[2, 2], [2, 1], [1, 1]] : [[2, 1], [1, 1]];
      case ZONE_INDUSTRIAL: return h < 0.5 ? [[3, 3], [3, 2], [2, 2], [2, 1], [1, 1]] : [[3, 2], [2, 2], [1, 1]];
      case ZONE_RESIDENTIAL: return h < 0.22 ? [[2, 1], [1, 1]] : [[1, 1]];
      default: return [[1, 1]];
    }
  }

  function useFor(zn: number, w: number, h: number, hh: number): LotUse {
    const big = w * h >= 4;
    switch (zn) {
      case ZONE_CBD: return big ? (hh < 0.62 ? 'tower' : 'office') : hh < 0.5 ? 'shop' : 'office';
      case ZONE_COMMERCIAL: return big ? (hh < 0.5 ? 'apartment' : 'office') : hh < 0.55 ? 'shop' : 'apartment';
      case ZONE_INDUSTRIAL: return w * h >= 2 ? 'industrial' : hh < 0.5 ? 'industrial' : 'house';
      case ZONE_RESIDENTIAL: return w * h >= 2 ? 'apartment' : hh < 0.12 ? 'shop' : 'house';
      default: return hh < 0.04 ? 'shop' : 'house';
    }
  }

  function fits(free: Set<number>, sx: number, sz: number, w: number, h: number): boolean {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) if (sx + dx >= W || sz + dz >= H || !free.has(at(sx + dx, sz + dz))) return false;
    }
    return true;
  }

  function tileBlock(block: number[]): void {
    const free = new Set(block);
    for (const start of block) {
      if (!free.has(start)) continue;
      const sx = start % W, sz = (start - sx) / W;
      const zn = zone[start];
      let placed: [number, number] = [1, 1];
      search: for (const [w0, h0] of preferredSizes(zn, hash3(sx, sz, seed + 3))) {
        const options: Array<[number, number]> = w0 === h0 ? [[w0, h0]] : [[w0, h0], [h0, w0]];
        for (const [w, h] of options) if (fits(free, sx, sz, w, h)) { placed = [w, h]; break search; }
      }
      const [w, h] = placed;
      const id = lots.length;
      for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) { const j = at(sx + dx, sz + dz); free.delete(j); lotOf[j] = id; }
      lots.push({
        id, px: sx, pz: sz, w, h, use: useFor(zn, w, h, hash3(sx, sz, seed + 9)), zone: zn, facing: facingFor(sx, sz, w, h),
        seed: Math.floor(hash3(sx, sz, seed + 17) * 2 ** 31),
      });
    }
  }

  /** Face the highest-class road along the lot's sides (ties: S, E, N, W — art §5.3). */
  function facingFor(px: number, pz: number, w: number, h: number): 0 | 1 | 2 | 3 {
    const score = [0, 0, 0, 0];            // S, E, N, W
    const val = (x: number, z: number) => (inside(x, z) ? [0, 2, 3][road[at(x, z)]] ?? 0 : 0);
    for (let dx = 0; dx < w; dx++) { score[0] += val(px + dx, pz + h); score[2] += val(px + dx, pz - 1); }
    for (let dz = 0; dz < h; dz++) { score[1] += val(px + w, pz + dz); score[3] += val(px - 1, pz + dz); }
    let best = 0;
    for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
    return best as 0 | 1 | 2 | 3;
  }

  reserved.sort((a, b) => Math.hypot(a.px - cx, a.pz - cz) - Math.hypot(b.px - cx, b.pz - cz) || a.pz - b.pz || a.px - b.px);
  return { gridW: W, gridH: H, seed, kind, road, water, zone, lotOf, lots, highways, reserved, center: { px: cx, pz: cz } };
}
