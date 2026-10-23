// Geometry for the synthetic city: per-chunk (10×10 plots) merged CityMaterial arrays built with GeoBuilder, plus
// instance lists for trees and street lamps. Deterministic for a given layout. Roads follow the art bible cross
// sections (§3.2: streets 12 m carriageway + 6 m sidewalks, arterials 15 m + median), buildings use the procedural
// facade styles (§3.5) and the palette (§3.3). Simplified on purpose: W2 replaces this with the real city renderer.
import { GeoBuilder, type BuiltArrays, type FacadeParams, type RGB } from '../../assets/GeoBuilder';
import { boxAt, cylinder, gableRoof, hipRoof, sawtoothRoof } from '../../assets/shapes';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { PLOT_SIZE } from '../../units';
import { hash3, mulberry32 } from '../../env/rng';
import { SPECIES_CONIFER, SPECIES_DECIDUOUS, type TreeInstance } from '../../env/Trees';
import {
  LANDUSE_COMMERCIAL, LANDUSE_GREEN, LANDUSE_INDUSTRIAL, LANDUSE_NONE, LANDUSE_RESIDENTIAL, LANDUSE_ROAD, LANDUSE_WATER,
} from '../../audio/AudioFrameProducer';
import {
  KIND_PARK, KIND_RESERVED, KIND_ROAD, KIND_SHORE, KIND_WATER, ROAD_ARTERIAL, ZONE_COMMERCIAL, ZONE_INDUSTRIAL,
  ZONE_RESIDENTIAL, ZONE_SUBURB, type Lot, type SyntheticLayout,
} from './Layout';

export const CHUNK_PLOTS = 10;

// Facade styles (art §3.5) — numeric so no const enum crosses module boundaries.
const F_HOUSE = 1, F_APARTMENT = 2, F_CURTAIN = 3, F_SHOP = 4, F_INDUSTRIAL = 5, F_OFFICE = 6;

const hex = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const shade = (c: RGB, k: number): RGB => [Math.min(255, Math.round(c[0] * k)), Math.min(255, Math.round(c[1] * k)), Math.min(255, Math.round(c[2] * k))];
const pick = <T>(list: readonly T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))];

const P = {
  grass: hex('#96B46B'), grass2: hex('#8EAD65'), park: hex('#86AE5E'), yard: hex('#A9C47A'), meadow: hex('#B4BC80'),
  sand: hex('#E6D6A8'), asphalt: hex('#5A5F67'), asphaltDark: hex('#50545B'), parking: hex('#6C7077'), sidewalk: hex('#CFCAC0'),
  curb: hex('#B8B2A7'), plaza: hex('#DDD5C6'), marking: hex('#F4F1E6'), markingYellow: hex('#F0C75E'), concrete: hex('#B9B6AE'),
  concreteDark: hex('#8E8C87'), quay: hex('#B9B6AE'), deck: hex('#9A9890'), parapet: hex('#C9C5BC'), lampPole: hex('#4A4E55'),
  lampHead: hex('#FFE6B8'), path: hex('#D8CFBE'),
};
const HOUSE_WALLS = ['#EFE8DA', '#EADCBC', '#DCC49A', '#E9C3A6', '#CD8466', '#BDB6A8', '#B0654F', '#BFD0B0', '#B6CBDB', '#C9C2D2', '#CFC8BC'].map(hex);
const HOUSE_ROOFS = ['#5B5F66', '#B8614A', '#5F6F7E', '#5B5F66', '#B8614A'].map(hex);
const APT_WALLS = ['#E4D3B5', '#D9B99B', '#EADCBC', '#DCC49A', '#CFC8BC', '#D8D2C4', '#B0654F', '#EFE8DA'].map(hex);
const FLAT_ROOFS = ['#B9B5AD', '#D3D0C8', '#A39E94', '#B9B5AD', '#8FAE6A', '#6E6F71'].map(hex);
const OFFICE_WALLS = ['#C7CDD3', '#D8D2C4', '#B9B6AE', '#9AA6B1', '#CFC8BC', '#B4BAC0'].map(hex);
const TOWER_WALLS = ['#C7CDD3', '#9AA6B1', '#B4BAC0', '#8E9AA6', '#D8D2C4'].map(hex);
const INDUSTRIAL_WALLS = ['#5C7C99', '#9FA7AE', '#B4BAC0', '#B9B6AE', '#9AA6B1', '#C9C5BC'].map(hex);
const AWNINGS = ['#B8614A', '#5F6F7E', '#6E9A86', '#8E4E3C', '#4F6B4A'].map(hex);
const TANK = hex('#E4E4DE'), CHIMNEY = hex('#8E4E3C'), DOCK = hex('#5A6068'), SOLAR = hex('#2E3B55');

export interface LampInstance { x: number; z: number; rotY: number }

export interface SyntheticCityArrays {
  chunks: Array<{ arrays: BuiltArrays; ix: number; iz: number }>;
  trees: TreeInstance[];
  lamps: LampInstance[];
  /** Land use per plot for the audio frame (LANDUSE_*). */
  landUse: Uint8Array;
  buildings: number;
  triangles: number;
}

export function buildSyntheticCity(layout: SyntheticLayout): SyntheticCityArrays {
  const { gridW: W, gridH: H, kind, road, zone, seed } = layout;
  const chunkCols = Math.ceil(W / CHUNK_PLOTS), chunkRows = Math.ceil(H / CHUNK_PLOTS);
  const builders: GeoBuilder[] = [];
  for (let i = 0; i < chunkCols * chunkRows; i++) builders.push(new GeoBuilder());
  const builderAt = (px: number, pz: number) => builders[Math.min(chunkRows - 1, Math.floor(pz / CHUNK_PLOTS)) * chunkCols + Math.min(chunkCols - 1, Math.floor(px / CHUNK_PLOTS))];
  const trees: TreeInstance[] = [];
  const lamps: LampInstance[] = [];
  const landUse = new Uint8Array(W * H);
  const at = (x: number, z: number) => z * W + x;
  const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && kind[at(x, z)] === KIND_ROAD;
  const plotX = (px: number) => (px + 0.5 - W / 2) * PLOT_SIZE;
  const plotZ = (pz: number) => (pz + 0.5 - H / 2) * PLOT_SIZE;
  let buildings = 0;

  // ------------------------------------------------------------------------------------------------- per plot
  for (let pz = 0; pz < H; pz++) {
    for (let px = 0; px < W; px++) {
      const i = at(px, pz);
      const b = builderAt(px, pz);
      const cx = plotX(px), cz = plotZ(pz);
      b.place(0, 0, 0);
      b.owner = 255; b.ownerRoof = false; b.tint = 0;
      switch (kind[i]) {
        case KIND_ROAD:
          landUse[i] = layout.water[i] ? LANDUSE_WATER : LANDUSE_ROAD;
          if (layout.water[i]) buildBridge(b, px, pz, cx, cz);
          else buildRoad(b, px, pz, cx, cz);
          break;
        case KIND_WATER:
          landUse[i] = LANDUSE_WATER;
          break;
        case KIND_PARK:
          landUse[i] = LANDUSE_GREEN;
          buildPark(b, px, pz, cx, cz);
          break;
        case KIND_SHORE: {
          landUse[i] = LANDUSE_GREEN;
          const quay = zone[i] === ZONE_INDUSTRIAL;
          b.flags = quay ? FLAG_PAVED | FLAG_SNOWABLE : FLAG_SNOWABLE;
          ground(b, cx, cz, quay ? P.quay : shade(P.sand, 0.97 + 0.05 * hash3(px, pz, seed)));
          break;
        }
        case KIND_RESERVED:
          // Vacant development land (company buildings go here): mown lawn.
          landUse[i] = LANDUSE_GREEN;
          b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
          ground(b, cx, cz, shade(hash3(px, pz, seed + 1) < 0.5 ? P.grass : P.grass2, 0.97 + 0.05 * hash3(px, pz, seed + 6)));
          break;
        default: {
          const lot = layout.lots[layout.lotOf[i]];
          const use = lot?.use ?? 'house';
          landUse[i] = use === 'industrial' ? LANDUSE_INDUSTRIAL : use === 'house' || use === 'apartment' ? LANDUSE_RESIDENTIAL : LANDUSE_COMMERCIAL;
          const paved = use === 'shop' || use === 'office' || use === 'tower' || use === 'industrial';
          b.flags = paved ? FLAG_PAVED | FLAG_SNOWABLE : FLAG_VEGETATION | FLAG_SNOWABLE;
          const base = use === 'industrial' ? P.parking : paved ? P.plaza : use === 'house' ? P.yard : hash3(px, pz, seed) < 0.5 ? P.grass : P.grass2;
          ground(b, cx, cz, shade(base, 0.97 + 0.05 * hash3(px, pz, seed + 2)));
        }
      }
    }
  }

  // --------------------------------------------------------------------------------------------------- per lot
  for (const lot of layout.lots) {
    if (lot.use === 'park' || lot.use === 'reserved') continue;
    const b = builderAt(lot.px + Math.floor(lot.w / 2), lot.pz + Math.floor(lot.h / 2));
    const cx = (lot.px + lot.w / 2 - W / 2) * PLOT_SIZE, cz = (lot.pz + lot.h / 2 - H / 2) * PLOT_SIZE;
    const turns = lot.facing;
    // Lot frame extents after rotation: local X is along the street.
    const lw = (turns % 2 === 0 ? lot.w : lot.h) * PLOT_SIZE, ld = (turns % 2 === 0 ? lot.h : lot.w) * PLOT_SIZE;
    b.place(cx, cz, turns);
    b.owner = 255; b.ownerRoof = false; b.tint = 0;
    const rnd = mulberry32(lot.seed);
    switch (lot.use) {
      case 'house': buildHouse(b, lw, ld, rnd, cx, cz, turns); break;
      case 'apartment': buildApartment(b, lw, ld, rnd); break;
      case 'shop': buildShop(b, lw, ld, rnd); break;
      case 'office': buildOffice(b, lw, ld, rnd); break;
      case 'tower': buildTower(b, lw, ld, rnd); break;
      case 'industrial': buildIndustrial(b, lw, ld, rnd); break;
    }
    buildings++;
  }

  // ---------------------------------------------------------------------------------------------------- output
  const chunks: SyntheticCityArrays['chunks'] = [];
  let triangles = 0;
  builders.forEach((b, k) => {
    if (b.triangleCount === 0) return;
    const arrays = b.finish();
    triangles += arrays.triangleCount;
    chunks.push({ arrays, ix: k % chunkCols, iz: Math.floor(k / chunkCols) });
  });
  return { chunks, trees, lamps, landUse, buildings, triangles };

  // =========================================================================================================
  // Helpers (closures over the layout).

  function ground(b: GeoBuilder, cx: number, cz: number, rgb: RGB, y = 0, half = PLOT_SIZE / 2): void {
    b.quad([cx - half, y, cz + half], [cx + half, y, cz + half], [cx + half, y, cz - half], [cx - half, y, cz - half], [0, 1, 0], rgb);
  }

  /** Axis-aligned up-facing quad in world space (corners in any order). */
  function rect(b: GeoBuilder, ax: number, az: number, bx: number, bz: number, y: number, rgb: RGB): void {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
    b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], rgb);
  }

  function buildRoad(b: GeoBuilder, px: number, pz: number, cx: number, cz: number): void {
    const arterial = road[at(px, pz)] === ROAD_ARTERIAL;
    const cw = arterial ? 7.5 : 6;                       // carriageway half width
    const n = isRoad(px, pz - 1), e = isRoad(px + 1, pz), s = isRoad(px, pz + 1), w = isRoad(px - 1, pz);
    const asphalt = shade(arterial ? P.asphaltDark : P.asphalt, 0.97 + 0.06 * hash3(px, pz, seed + 7));
    const half = PLOT_SIZE / 2;
    const xs = [cx - half, cx - cw, cx + cw, cx + half], zs = [cz - half, cz - cw, cz + cw, cz + half];
    // 3×3 cells: [col][row]; true = carriageway.
    const carriage = (c: number, r: number): boolean => {
      if (c === 1 && r === 1) return true;
      if (c === 1 && r === 0) return n;
      if (c === 1 && r === 2) return s;
      if (r === 1 && c === 0) return w;
      if (r === 1 && c === 2) return e;
      return false;
    };
    const kerb = 0.15;
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const x0 = xs[c], x1 = xs[c + 1], z0 = zs[r], z1 = zs[r + 1];
        if (carriage(c, r)) {
          b.flags = FLAG_PAVED | FLAG_SNOWABLE;
          rect(b, x0, z0, x1, z1, 0, asphalt);
          continue;
        }
        b.flags = FLAG_PAVED | FLAG_SNOWABLE;
        rect(b, x0, z0, x1, z1, kerb, P.sidewalk);
        b.flags = 0;
        // Curb faces towards carriageway cells (and towards non-road neighbours at the plot edge).
        const faceN = r > 0 ? carriage(c, r - 1) : !n;
        const faceS = r < 2 ? carriage(c, r + 1) : !s;
        const faceW = c > 0 ? carriage(c - 1, r) : !w;
        const faceE = c < 2 ? carriage(c + 1, r) : !e;
        if (faceN) b.quad([x1, 0, z0], [x0, 0, z0], [x0, kerb, z0], [x1, kerb, z0], [0, 0, -1], P.curb);
        if (faceS) b.quad([x0, 0, z1], [x1, 0, z1], [x1, kerb, z1], [x0, kerb, z1], [0, 0, 1], P.curb);
        if (faceW) b.quad([x0, 0, z0], [x0, 0, z1], [x0, kerb, z1], [x0, kerb, z0], [-1, 0, 0], P.curb);
        if (faceE) b.quad([x1, 0, z1], [x1, 0, z0], [x1, kerb, z0], [x1, kerb, z1], [1, 0, 0], P.curb);
      }
    }
    const bits = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);
    const alongX = e && w && !n && !s, alongZ = n && s && !e && !w;
    if (!alongX && !alongZ) return;                      // intersections stay clean asphalt
    b.flags = FLAG_PAVED;
    const y = 0.02;
    // Lane markings: streets get centre dashes; arterials a planted median and lane dashes.
    for (let k = 0; k < 4; k++) {
      const t = -half + 1.5 + k * 6;                     // dash start along the road
      if (arterial) {
        for (const off of [-4.25, 4.25]) {
          if (alongX) rect(b, cx + t, cz + off - 0.06, cx + t + 3, cz + off + 0.06, y, P.marking);
          else rect(b, cx + off - 0.06, cz + t, cx + off + 0.06, cz + t + 3, y, P.marking);
        }
      } else if (alongX) rect(b, cx + t, cz - 0.07, cx + t + 3, cz + 0.07, y, P.marking);
      else rect(b, cx - 0.07, cz + t, cx + 0.07, cz + t + 3, y, P.marking);
    }
    if (arterial) {
      b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
      if (alongX) boxAt(b, cx, cz, PLOT_SIZE, 2, 0, 0.15, P.curb, P.park);
      else boxAt(b, cx, cz, 2, PLOT_SIZE, 0, 0.15, P.curb, P.park);
    }
    // Zebra crossings on the side facing an intersection.
    b.flags = FLAG_PAVED;
    const isJunction = (x: number, z: number) => isRoad(x, z) && (Number(isRoad(x, z - 1)) + Number(isRoad(x + 1, z)) + Number(isRoad(x, z + 1)) + Number(isRoad(x - 1, z))) >= 3;
    const zebra = (dir: number) => {
      for (let off = -cw + 0.6; off < cw - 0.6; off += 1.2) {
        if (alongX) rect(b, cx + dir * (half - 5), cz + off, cx + dir * (half - 1), cz + off + 0.6, y, P.marking);
        else rect(b, cx + off, cz + dir * (half - 5), cx + off + 0.6, cz + dir * (half - 1), y, P.marking);
      }
    };
    if (alongX) { if (isJunction(px + 1, pz)) zebra(1); if (isJunction(px - 1, pz)) zebra(-1); }
    else { if (isJunction(px, pz + 1)) zebra(1); if (isJunction(px, pz - 1)) zebra(-1); }
    // Street lamps at the curb, staggered (one per side per plot); trees in residential planting strips.
    const lampOff = cw + 0.9;
    if (alongX) {
      lamps.push({ x: cx - 6, z: cz - lampOff, rotY: 0 }, { x: cx + 6, z: cz + lampOff, rotY: Math.PI });
    } else {
      lamps.push({ x: cx - lampOff, z: cz + 6, rotY: Math.PI / 2 }, { x: cx + lampOff, z: cz - 6, rotY: -Math.PI / 2 });
    }
    const zn = zone[at(px, pz)];
    if (!arterial && bits === 2 && (zn === ZONE_RESIDENTIAL || zn === ZONE_SUBURB || zn === ZONE_COMMERCIAL)) {
      const tOff = cw + 3.4;
      for (const along of [-9, 3]) {
        for (const side of [-1, 1]) {
          const h = hash3(px * 4 + (along > 0 ? 1 : 0), pz * 2 + (side > 0 ? 1 : 0), seed + 23);
          if (h < 0.2) continue;
          const x = alongX ? cx + along * side : cx + side * tOff, z = alongX ? cz + side * tOff : cz + along * side;
          trees.push({ x, y: 0.15, z, rotY: h * 6.28, scale: 0.75 + 0.3 * h, species: SPECIES_DECIDUOUS });
        }
      }
    }
  }

  function buildBridge(b: GeoBuilder, px: number, pz: number, cx: number, cz: number): void {
    const alongX = isRoad(px - 1, pz) || isRoad(px + 1, pz);
    const half = PLOT_SIZE / 2, deckY = 0.3, cw = road[at(px, pz)] === ROAD_ARTERIAL ? 7.5 : 6;
    b.flags = FLAG_PAVED | FLAG_SNOWABLE;
    if (alongX) {
      rect(b, cx - half, cz - cw, cx + half, cz + cw, deckY, P.asphalt);
      rect(b, cx - half, cz - cw - 2.2, cx + half, cz - cw, deckY + 0.15, P.sidewalk);
      rect(b, cx - half, cz + cw, cx + half, cz + cw + 2.2, deckY + 0.15, P.sidewalk);
      b.flags = 0;
      // Deck edges (visible slab above the water) and parapets.
      b.quad([cx + half, -0.9, cz - cw - 2.2], [cx - half, -0.9, cz - cw - 2.2], [cx - half, deckY + 0.15, cz - cw - 2.2], [cx + half, deckY + 0.15, cz - cw - 2.2], [0, 0, -1], P.deck);
      b.quad([cx - half, -0.9, cz + cw + 2.2], [cx + half, -0.9, cz + cw + 2.2], [cx + half, deckY + 0.15, cz + cw + 2.2], [cx - half, deckY + 0.15, cz + cw + 2.2], [0, 0, 1], P.deck);
      boxAt(b, cx, cz - cw - 2.05, PLOT_SIZE, 0.3, deckY + 0.15, 1.1, P.parapet);
      boxAt(b, cx, cz + cw + 2.05, PLOT_SIZE, 0.3, deckY + 0.15, 1.1, P.parapet);
      if (hash3(px, pz, seed) < 0.5) boxAt(b, cx, cz, 2.4, cw * 2 + 4, -3, 2.9, P.concreteDark);   // pier
    } else {
      rect(b, cx - cw, cz - half, cx + cw, cz + half, deckY, P.asphalt);
      rect(b, cx - cw - 2.2, cz - half, cx - cw, cz + half, deckY + 0.15, P.sidewalk);
      rect(b, cx + cw, cz - half, cx + cw + 2.2, cz + half, deckY + 0.15, P.sidewalk);
      b.flags = 0;
      b.quad([cx - cw - 2.2, -0.9, cz - half], [cx - cw - 2.2, -0.9, cz + half], [cx - cw - 2.2, deckY + 0.15, cz + half], [cx - cw - 2.2, deckY + 0.15, cz - half], [-1, 0, 0], P.deck);
      b.quad([cx + cw + 2.2, -0.9, cz + half], [cx + cw + 2.2, -0.9, cz - half], [cx + cw + 2.2, deckY + 0.15, cz - half], [cx + cw + 2.2, deckY + 0.15, cz + half], [1, 0, 0], P.deck);
      boxAt(b, cx - cw - 2.05, cz, 0.3, PLOT_SIZE, deckY + 0.15, 1.1, P.parapet);
      boxAt(b, cx + cw + 2.05, cz, 0.3, PLOT_SIZE, deckY + 0.15, 1.1, P.parapet);
      if (hash3(px, pz, seed) < 0.5) boxAt(b, cx, cz, cw * 2 + 4, 2.4, -3, 2.9, P.concreteDark);
    }
  }

  function buildPark(b: GeoBuilder, px: number, pz: number, cx: number, cz: number): void {
    b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
    ground(b, cx, cz, shade(P.park, 0.97 + 0.05 * hash3(px, pz, seed + 4)));
    b.flags = FLAG_PAVED | FLAG_SNOWABLE;
    const h = hash3(px, pz, seed + 5);
    if (h < 0.5) rect(b, cx - 1.5, cz - 12, cx + 1.5, cz + 12, 0.02, P.path);
    else rect(b, cx - 12, cz - 1.5, cx + 12, cz + 1.5, 0.02, P.path);
    const rnd = mulberry32(Math.floor(h * 2 ** 31));
    const count = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      const x = cx + (rnd() - 0.5) * 20, z = cz + (rnd() - 0.5) * 20;
      if ((h < 0.5 && Math.abs(x - cx) < 3) || (h >= 0.5 && Math.abs(z - cz) < 3)) continue;
      trees.push({ x, y: 0, z, rotY: rnd() * 6.28, scale: 0.8 + 0.5 * rnd(), species: rnd() < 0.25 ? SPECIES_CONIFER : SPECIES_DECIDUOUS });
    }
  }

  /** Dark contact apron around a footprint (baked AO, art §3.5). */
  function apron(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, rgb: RGB): void {
    const f = b.flags;
    b.flags = 0;
    b.quad([x0 - 1.5, 0.012, z1 + 1.5], [x1 + 1.5, 0.012, z1 + 1.5], [x1 + 1.5, 0.012, z0 - 1.5], [x0 - 1.5, 0.012, z0 - 1.5], [0, 1, 0], shade(rgb, 0.82));
    b.flags = f;
  }

  function fac(style: number, rnd: () => number, floorDm: number, bayDm: number): FacadeParams {
    return [style, Math.floor(rnd() * 256), floorDm, bayDm];
  }

  function buildHouse(b: GeoBuilder, lw: number, ld: number, rnd: () => number, wx: number, wz: number, turns: number): void {
    const bw = 10 + rnd() * 4, bd = 8.5 + rnd() * 2.5;
    const off = (rnd() - 0.5) * Math.max(0, lw - bw - 6) * 0.6;
    const front = ld / 2 - (5 + rnd() * 2.5);
    const x0 = off - bw / 2, x1 = off + bw / 2, z1 = front, z0 = front - bd;
    const floors = rnd() < 0.4 ? 1 : 2;
    const wallH = 0.5 + 3 * floors;
    const wall = pick(HOUSE_WALLS, rnd()), roof = pick(HOUSE_ROOFS, rnd());
    apron(b, x0, z0, x1, z1, P.yard);
    b.flags = 0;
    b.box(x0, 0, z0, x1, wallH, z1, wall, wall, fac(F_HOUSE, rnd, 30, 30), false);
    b.flags = FLAG_SNOWABLE;
    const pitch = Math.tan((34 * Math.PI) / 180);
    if (rnd() < 0.62) gableRoof(b, x0, z0, x1, z1, wallH, (Math.min(bw, bd) / 2) * pitch, roof, wall, bw >= bd);
    else hipRoof(b, x0, z0, x1, z1, wallH, (Math.min(bw, bd) / 2) * pitch, roof);
    // Path to the street.
    b.flags = FLAG_PAVED | FLAG_SNOWABLE;
    b.quad([off - 0.6, 0.02, ld / 2], [off + 0.6, 0.02, ld / 2], [off + 0.6, 0.02, z1], [off - 0.6, 0.02, z1], [0, 1, 0], P.path);
    // 0–2 garden trees behind the house (world coordinates for the instanced trees).
    const nTrees = Math.floor(rnd() * 3);
    for (let k = 0; k < nTrees; k++) {
      const lx = (rnd() - 0.5) * (lw - 6), lz = -ld / 2 + 3 + rnd() * Math.max(1, z0 + ld / 2 - 5);
      const [tx, tz] = toWorld(lx, lz, wx, wz, turns);
      trees.push({ x: tx, y: 0, z: tz, rotY: rnd() * 6.28, scale: 0.7 + 0.35 * rnd(), species: rnd() < 0.3 ? SPECIES_CONIFER : SPECIES_DECIDUOUS });
    }
  }

  function roofTop(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rnd: () => number): void {
    // Rooftop plant: 1–3 boxes; sometimes solar panels.
    b.flags = FLAG_SNOWABLE;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const w = 2 + rnd() * 3, d = 2 + rnd() * 3;
      const x = x0 + w / 2 + 1 + rnd() * Math.max(0, x1 - x0 - w - 2), z = z0 + d / 2 + 1 + rnd() * Math.max(0, z1 - z0 - d - 2);
      boxAt(b, x, z, w, d, y, 1.2 + rnd() * 1.6, P.concrete, P.concrete);
    }
    if (rnd() < 0.2 && x1 - x0 > 12) {
      b.flags = 0;
      const sx = (x0 + x1) / 2, sz = (z0 + z1) / 2;
      boxAt(b, sx, sz, (x1 - x0) * 0.5, (z1 - z0) * 0.35, y, 0.35, SOLAR, SOLAR);
    }
  }

  function buildApartment(b: GeoBuilder, lw: number, ld: number, rnd: () => number): void {
    const x0 = -lw / 2 + 2.5, x1 = lw / 2 - 2.5, z1 = ld / 2 - 3, z0 = -ld / 2 + 4;
    const floors = 4 + Math.floor(rnd() * 5);
    const h = 0.4 + floors * 3;
    const wall = pick(APT_WALLS, rnd()), roof = pick(FLAT_ROOFS, rnd());
    apron(b, x0, z0, x1, z1, P.grass);
    b.flags = 0;
    b.box(x0, 0, z0, x1, h, z1, wall, roof, fac(F_APARTMENT, rnd, 30, 33), false);
    b.flags = FLAG_SNOWABLE;
    b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], roof);
    roofTop(b, x0, z0, x1, z1, h, rnd);
  }

  function buildShop(b: GeoBuilder, lw: number, ld: number, rnd: () => number): void {
    const x0 = -lw / 2 + 1, x1 = lw / 2 - 1, z1 = ld / 2 - 1, z0 = z1 - Math.min(ld - 4, 14 + rnd() * 6);
    const floors = 2 + Math.floor(rnd() * 4);
    const h = 4.2 + (floors - 1) * 3;
    const wall = pick(APT_WALLS, rnd()), roof = pick(FLAT_ROOFS, rnd());
    apron(b, x0, z0, x1, z1, P.plaza);
    b.flags = 0;
    b.box(x0, 0, z0, x1, h, z1, wall, roof, fac(F_SHOP, rnd, 30, 30), false);
    b.flags = FLAG_SNOWABLE;
    b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], roof);
    // Awning over the shopfront.
    b.flags = FLAG_SNOWABLE;
    boxAt(b, (x0 + x1) / 2, z1 + 0.9, x1 - x0 - 1, 1.8, 3.0, 0.3, pick(AWNINGS, rnd()));
    roofTop(b, x0, z0, x1, z1, h, rnd);
  }

  function buildOffice(b: GeoBuilder, lw: number, ld: number, rnd: () => number): void {
    const x0 = -lw / 2 + 2, x1 = lw / 2 - 2, z1 = ld / 2 - 2, z0 = -ld / 2 + 2;
    const wall = pick(OFFICE_WALLS, rnd()), roof = pick(FLAT_ROOFS, rnd());
    apron(b, x0, z0, x1, z1, P.plaza);
    const podium = 8;
    b.flags = 0;
    b.box(x0, 0, z0, x1, podium, z1, wall, roof, fac(F_SHOP, rnd, 37, 45), false);
    b.flags = FLAG_SNOWABLE;
    b.quad([x0, podium, z1], [x1, podium, z1], [x1, podium, z0], [x0, podium, z0], [0, 1, 0], roof);
    const inset = 3 + rnd() * 2;
    const floors = 6 + Math.floor(rnd() * 10);
    const top = podium + floors * 3.7;
    b.flags = 0;
    b.box(x0 + inset, podium, z0 + inset, x1 - inset, top, z1 - inset, wall, roof, fac(F_OFFICE, rnd, 37, 30), false);
    b.flags = FLAG_SNOWABLE;
    b.quad([x0 + inset, top, z1 - inset], [x1 - inset, top, z1 - inset], [x1 - inset, top, z0 + inset], [x0 + inset, top, z0 + inset], [0, 1, 0], roof);
    roofTop(b, x0 + inset, z0 + inset, x1 - inset, z1 - inset, top, rnd);
  }

  function buildTower(b: GeoBuilder, lw: number, ld: number, rnd: () => number): void {
    const wall = pick(TOWER_WALLS, rnd()), roof = hex('#6E6F71');
    const w0 = Math.min(lw - 12, 30 + rnd() * 8), d0 = Math.min(ld - 12, 28 + rnd() * 8);
    apron(b, -w0 / 2, -d0 / 2, w0 / 2, d0 / 2, P.plaza);
    const floors = 20 + Math.floor(rnd() * 22);
    const total = floors * 3.7;
    const sections = 1 + Math.floor(rnd() * 3);
    let y = 0, w = w0, d = d0;
    for (let s = 0; s < sections; s++) {
      const hgt = s === sections - 1 ? total - y : total * (0.45 + 0.15 * rnd()) / sections * (s === 0 ? 1.6 : 1);
      const yTop = Math.min(total, y + hgt);
      b.flags = 0;
      b.box(-w / 2, y, -d / 2, w / 2, yTop, d / 2, wall, roof, fac(F_CURTAIN, rnd, 37, 16), false);
      b.flags = FLAG_SNOWABLE;
      b.quad([-w / 2, yTop, d / 2], [w / 2, yTop, d / 2], [w / 2, yTop, -d / 2], [-w / 2, yTop, -d / 2], [0, 1, 0], roof);
      y = yTop;
      w *= 0.78; d *= 0.78;
      if (y >= total - 0.01) break;
    }
    // Crown + aviation light (red, emissive) on tall towers.
    b.flags = 0;
    boxAt(b, 0, 0, w * 0.6, d * 0.6, y, 3.5, P.concreteDark, roof);
    if (y > 60) boxAt(b, 0, 0, 0.8, 0.8, y + 3.5, 1.2, hex('#FF4A3A'), hex('#FF4A3A'));
  }

  function buildIndustrial(b: GeoBuilder, lw: number, ld: number, rnd: () => number): void {
    const x0 = -lw / 2 + 3 + rnd() * 2, x1 = lw / 2 - 3 - rnd() * 2;
    const z1 = ld / 2 - 6 - rnd() * 4, z0 = -ld / 2 + 3;
    const h = 8 + rnd() * 6;
    const wall = pick(INDUSTRIAL_WALLS, rnd());
    const roofC = hex('#9FA7AE');
    apron(b, x0, z0, x1, z1, P.parking);
    b.flags = 0;
    b.box(x0, 0, z0, x1, h, z1, wall, roofC, fac(F_INDUSTRIAL, rnd, Math.min(255, Math.round(h * 10)), 50), false);
    b.flags = FLAG_SNOWABLE;
    if (rnd() < 0.45 && z1 - z0 > 16) sawtoothRoof(b, x0, z0, x1, z1, h, 3.2, Math.max(2, Math.round((z1 - z0) / 8)), roofC, hex('#6F8FA6'));
    else b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], roofC);
    // Loading docks on the street side.
    b.flags = 0;
    const docks = Math.max(1, Math.floor((x1 - x0) / 9));
    for (let k = 0; k < docks; k++) boxAt(b, x0 + (k + 0.5) * ((x1 - x0) / docks), z1 + 0.05, 3.6, 0.1, 0, 4.2, DOCK);
    // Tanks / silos and a chimney on some plants.
    if (rnd() < 0.5) {
      b.flags = FLAG_SNOWABLE;
      const r = 3 + rnd() * 2, tx = x1 + 0.5 - r, tz = z1 + 0.5 + r;
      if (tz + r < ld / 2) cylinder(b, tx, tz, r, 0, 7 + rnd() * 5, 10, TANK);
    }
    if (rnd() < 0.3) {
      b.flags = 0;
      cylinder(b, x0 + 3, z0 + 3, 1.2, h, h + 14 + rnd() * 12, 8, CHIMNEY);
    }
  }
}

/** Lot-frame (x, z) → world, same transform as GeoBuilder.place(cx, cz, turns). */
function toWorld(x: number, z: number, cx: number, cz: number, turns: number): [number, number] {
  const a = (turns & 3) * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return [cx + x * c + z * s, cz - x * s + z * c];
}

/** Lot centre and frame for a lot (exported for the company-building placer). */
export function lotWorldCenter(layout: SyntheticLayout, lot: Lot): { x: number; z: number } {
  return { x: (lot.px + lot.w / 2 - layout.gridW / 2) * PLOT_SIZE, z: (lot.pz + lot.h / 2 - layout.gridH / 2) * PLOT_SIZE };
}

/** LANDUSE code for a lot use (company buildings mark their plots, e.g. as industrial or commercial). */
export function landUseOf(use: string): number {
  switch (use) {
    case 'industrial': return LANDUSE_INDUSTRIAL;
    case 'house': case 'apartment': return LANDUSE_RESIDENTIAL;
    case 'park': return LANDUSE_GREEN;
    case 'reserved': return LANDUSE_NONE;
    default: return LANDUSE_COMMERCIAL;
  }
}
