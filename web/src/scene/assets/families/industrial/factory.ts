// factory_small (3×3, art §4.2.4) and factory_large (5×5, §4.2.5): sawtooth halls whose chimney smoke shows
// production, an office with the owner roof and a rooftop wordmark, loading docks with trucks in owner livery,
// product props by family (silos, tanks, weaving shed, coil gantry, bullet tanks + flare, clean room, car test lot),
// and levels 2–3 adding halls, chimneys and conveyors. Odd variants mirror the layout (second shape variant).
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { ASSET_RGB, CONTAINER_HEX, WORLD_RGB, shade } from '../../palette';
import { hash01 } from '../../shapes';
import { buildSiteForType } from '../construction/site';
import {
  apron, chimney, clerestoryGlass, conveyor, dockDoor, fence, flagpole, ground, guardhouse, hTank, hvac, industrialFacade,
  officeFacade, ownerBand, parkCars, parkingRow, pipeRack, ribbonGlass, roofBoard, silo, tank, tree, weeds, yard, yardLamp,
} from '../common-b/details';
import { Kit, type P3 } from '../common-b/kit';
import { FAMILY_EMISSION, factoryFamily, trailerFor, type FactoryFamily } from '../common-b/products';

const W = WORLD_RGB.wall, R = WORLD_RGB.roof, I = WORLD_RGB.industry;
const YARD = WORLD_RGB.road.parking;
const LAWN = WORLD_RGB.ground.grass2;
const GLASS2 = I.glass2;

/** Wall / roof palettes for halls (variant pick). Roofs avoid one flat grey (art §1.6 finding 5). */
const HALL_STYLES: readonly { wall: RGB; roof: RGB; plinth: RGB }[] = [
  { wall: W.brick, roof: I.galvanized, plinth: W.concreteDark },
  { wall: I.silver, roof: R.gravel, plinth: shade(I.industrialBlue, 0.9) },
  { wall: shade(I.industrialBlue, 1.18), roof: R.flat, plinth: W.concreteDark },
  { wall: W.concrete, roof: R.tar, plinth: shade(W.concreteDark, 0.9) },
];

/** Roof treatment of a hall: plain with ventilators, solar on the south slopes, or both. */
type RoofKit = 'vents' | 'solar' | 'mixed';

const SOLAR = R.solar;
const GUTTER = shade(I.dockDoors, 0.85);

/** One sawtooth production hall (walls with a plinth + north-light roof with valley gutters, ridge highlights and a
 *  roof treatment). ~60 + 4·teeth triangles (+ vents / solar) and a clerestory fallback when unlit. */
function sawtoothHall(k: Kit, x0: number, z0: number, x1: number, z1: number, eaves: number, teeth: number, rise: number, wall: RGB, roofRgb: RGB, plinth: RGB, roofKit: RoofKit): void {
  const fac = industrialFacade(k, eaves);
  k.box(x0, 0, z0, x1, eaves, z1, wall, roofRgb, fac, false);
  // concrete plinth band so the walls sit on the ground (and the brick reads as brick, not paint)
  k.box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 1.1, z1 + 0.06, plinth, plinth, null, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.sawtooth(x0, z0, x1, z1, eaves, rise, teeth, roofRgb, GLASS2, k.lit ? 72 : 0)));
  const step = (z1 - z0) / teeth;
  const ny = step / Math.hypot(step, rise), nz = rise / Math.hypot(step, rise);
  const onSlope = (za: number, f0: number, f1: number, xa: number, xb: number, rgb: RGB, lift = 0.03) => {
    // a band lying on the slope of the tooth that starts at za (high edge) and falls to za + step (valley)
    const p = (x: number, f: number): [number, number, number] => [x, eaves + rise * (1 - f) + lift * ny, za + step * f + lift * nz];
    k.quad(p(xa, f0), p(xb, f0), p(xb, f1), p(xa, f1), [0, ny, nz], rgb);
  };
  for (let i = 0; i < teeth; i++) {
    const za = z0 + i * step;
    onSlope(za, 0.9, 1.0, x0, x1, GUTTER, 0.02); // valley gutter
    onSlope(za, 0.0, 0.07, x0, x1, shade(roofRgb, 1.12), 0.02); // ridge flashing
    const solarHere = roofKit === 'solar' ? i < teeth - 1 : roofKit === 'mixed' && i % 2 === 1;
    if (solarHere && k.lod0) {
      // panel arrays ~10 m long with maintenance gaps (rows of #2E3B55, art §3.3), on the upper part of the slope
      const arrays = Math.max(1, Math.round((x1 - x0 - 4) / 11));
      const len = (x1 - x0 - 4) / arrays;
      for (let a = 0; a < arrays; a++) onSlope(za, 0.2, 0.66, x0 + 2 + a * len + 0.9, x0 + 2 + (a + 1) * len - 0.9, SOLAR, 0.05);
    }
  }
  if (k.lod0 && roofKit !== 'solar') {
    // ridge ventilators along alternate ridges (on the plain teeth when mixed)
    const n = Math.max(2, Math.floor((x1 - x0) / 9));
    for (let i = roofKit === 'mixed' ? 0 : 1; i < teeth; i += 2) {
      for (let j = 0; j < n; j++) {
        const x = x0 + ((j + 0.5) / n) * (x1 - x0);
        k.boxAt(x, z0 + i * step + 0.9, 1.4, 1.4, eaves + rise - 0.2, 1.1, shade(I.galvanized, 0.92), shade(I.galvanized, 0.8));
      }
    }
  }
  if (!fac) clerestoryGlass(k, x0, z0, x1, z1, eaves, ['pz', 'nz', 'px', 'nx']);
  apron(k, x0, z0, x1, z1, YARD);
}

/** Roof treatment per hall: mostly plain galvanized slopes with ridge ventilators (the sawtooth must read), solar on
 *  some halls only — dark panel arrays on every slope turn a factory into a solar farm at district zoom. */
function roofKitFor(seed: number, hall: number): RoofKit {
  const u = hash01(seed, 0x5a17 + hall * 977);
  return u < 0.55 ? 'vents' : u < 0.85 ? 'mixed' : 'solar';
}

/** Office block with OFFICE ribbon windows and an owner-colour roof (art §4.2.4 annex / §4.2.5 office block). */
function officeBlock(k: Kit, x0: number, z0: number, x1: number, z1: number, floors: number, wall: RGB): void {
  const h = floors * 3.6;
  const fac = officeFacade(k, 3.6);
  const roofRgb = k.closed ? R.flat : k.ownerRgb;
  k.box(x0, 0, z0, x1, h, z1, wall, roofRgb, fac, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.slab(x0, z0, x1, z1, h, roofRgb)));
  k.box(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, h + 0.6, z0 + 0.3, shade(wall, 0.9), shade(wall, 0.95)); // back parapet lip
  if (!fac) ribbonGlass(k, x0, z0, x1, z1, floors, 3.6, ['pz', 'nz', 'px', 'nx']);
  apron(k, x0, z0, x1, z1, YARD);
}

interface Zone { x0: number; z0: number; x1: number; z1: number; }

/** Product props for a family inside a zone (zone in the authoring frame). Returns the stack tops that smoke. */
function familyProps(k: Kit, fam: FactoryFamily, z: Zone, scale: number, extra: boolean): { stacks: P3[]; flare: P3 | null } {
  if (!k.lod0) return familyPropsLod1(k, fam, z, scale, extra);
  const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2, w = z.x1 - z.x0, d = z.z1 - z.z0;
  const stacks: P3[] = [];
  let flare: P3 | null = null;
  const lod0 = k.lod0;
  switch (fam) {
    case 'food': {
      const r = 2.5 * scale, h = 14 * scale;
      const cols = 2, rows = extra ? 2 : 1;
      const gx = w / cols, gz = d / Math.max(rows, 1.6);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) silo(k, z.x0 + gx * (i + 0.5), z.z0 + gz * (j + 0.5) + (rows === 1 ? d * 0.18 : 0), r, h);
      if (lod0) {
        // bucket elevator leg and spouts to the silo tops
        const ex = z.x0 + 1, ez = z.z0 + gz * 0.5 + (rows === 1 ? d * 0.18 : 0);
        k.boxAt(ex, ez, 1.4, 1.4, 0, h + 5, I.galvanized, shade(I.galvanized, 0.9));
        for (let i = 0; i < cols; i++) k.beam([ex, h + 4.6, ez], [z.x0 + gx * (i + 0.5), h + r * 0.4, ez], 0.4, 0.4, shade(I.galvanized, 0.85), 3);
      }
      break;
    }
    case 'beverage': {
      const r = 2 * scale, h = 9 * scale;
      const n = extra ? 5 : 3;
      const per = Math.min(3, n);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / per), col = i % per;
        tank(k, z.x0 + (w / per) * (col + 0.5), z.z0 + d * 0.3 + row * (2 * r + 2.5), r, h, W.aluminium, null, 10);
      }
      if (lod0) pipeRack(k, z.x0 + 0.5, z.z1 - 1.5, z.x1 - 0.5, z.z1 - 1.5, 5.5 * Math.min(scale, 1.3));
      stacks.push([z.x1 - 2, h + 1.5, z.z0 + d * 0.3]);
      break;
    }
    case 'textile': {
      const sw = Math.min(w, 16 * scale), sd = Math.min(d, 20 * scale);
      const x0 = cx - sw / 2, z0 = z.z0, x1 = cx + sw / 2, z1 = z.z0 + sd;
      const eaves = 6;
      const fac = industrialFacade(k, eaves);
      k.box(x0, 0, z0, x1, eaves, z1, W.cream, R.flat, fac, false);
      k.flagged(FLAG_SNOWABLE, () => k.sawtooth(x0, z0, x1, z1, eaves, 2.4, 3, R.flat, GLASS2, k.lit ? 72 : 0));
      if (!fac) clerestoryGlass(k, x0, z0, x1, z1, eaves, ['pz', 'nz', 'px', 'nx']);
      if (extra && lod0) for (let i = 0; i < 4; i++) k.prop('palletStack', x0 + 2 + i * 2.2, z1 + 2.5, 0, { color: '#EDEBE3' });
      stacks.push([x1 - 1.5, eaves + 4, z0 + 2]);
      if (lod0) k.cyl(x1 - 1.5, z0 + 2, 0.6, eaves, eaves + 4, 6, I.galvanized);
      break;
    }
    case 'metal': {
      // overhead gantry crane over a coil yard (art §4.2.4)
      const gx0 = z.x0 + 0.8, gx1 = z.x1 - 0.8, gz0 = z.z0 + 0.5, gz1 = z.z1 - 0.5, gy = 10 * Math.min(scale, 1.3);
      const yellow = I.safetyYellow;
      if (lod0) {
        for (const x of [gx0, gx1]) {
          k.beam([x, 0, gz0], [x, gy, gz0], 0.6, 0.6, shade(yellow, 0.9), 4);
          k.beam([x, 0, gz1], [x, gy, gz1], 0.6, 0.6, shade(yellow, 0.9), 4);
          k.beam([x, gy, gz0], [x, gy, gz1], 0.8, 1.0, yellow, 4, true); // runway girders
        }
        const bz = gz0 + (gz1 - gz0) * (0.3 + 0.4 * k.rnd());
        k.beam([gx0, gy + 0.9, bz], [gx1, gy + 0.9, bz], 1.0, 1.2, yellow, 4, true); // bridge girder
        k.boxAt((gx0 + gx1) / 2, bz, 2.4, 2.2, gy + 1.5, 1.6, shade(yellow, 0.85)); // hoist trolley
        const rows = extra ? 4 : 3;
        for (let r = 0; r < rows; r++) for (let i = 0; i < Math.floor((gz1 - gz0 - 2) / 2.2); i++) k.prop('coil', gx0 + 2.5 + r * ((gx1 - gx0 - 5) / Math.max(1, rows - 1)), gz0 + 1.6 + i * 2.2, 0);
      } else {
        k.box(gx0, 0, gz0, gx1, gy, gz1, shade(yellow, 0.9), yellow, null);
      }
      break;
    }
    case 'polymer': {
      const r = 1.8 * scale, len = Math.min(d - 3, 14 * scale);
      const xs = [z.x0 + w * 0.28, z.x0 + w * 0.68];
      for (const x of xs) hTank(k, [x, r + 0.9, z.z0 + 1], [x, r + 0.9, z.z0 + 1 + len], r, W.warmWhite);
      if (extra) tank(k, z.x0 + w * 0.28, z.z1 - 2.8, 2.2, 8, W.warmWhite, null, 10);
      // flare stack
      const fx = z.x1 - 1.6, fz = z.z1 - 1.6, fh = 24 * Math.min(scale, 1.4);
      k.cyl(fx, fz, 0.55, 0, fh, 6, I.galvanized, ASSET_RGB.dockShelter);
      if (lod0) for (let i = 1; i < 4; i++) k.beam([fx, fh * (i / 4), fz], [fx + 2.2, 0, fz + (i % 2 ? 2.2 : -2.2)], 0.12, 0.12, shade(I.galvanized, 0.8), 3);
      flare = [fx, fh + 1.2, fz];
      stacks.push([z.x0 + w * 0.5, 9, z.z0 + 1]);
      break;
    }
    case 'electronics': {
      const bw = Math.min(w, 24 * scale), bd = Math.min(d, 16 * scale) + (scale > 1.2 ? 0 : d * 0.25);
      const x0 = cx - bw / 2, z0 = z.z0, x1 = cx + bw / 2, z1 = Math.min(z.z1, z.z0 + bd);
      const h = 9 * Math.min(scale, 1.35);
      const white = ASSET_RGB.siteCabin;
      k.box(x0, 0, z0, x1, h, z1, white, R.membrane);
      k.box(x0 - 0.15, h * 0.62, z0 - 0.15, x1 + 0.15, h * 0.66, z1 + 0.15, shade(I.industrialBlue, 1.1), shade(I.industrialBlue, 1.1));
      if (lod0) {
        for (let i = 0; i < 6; i++) {
          const dx = x0 + ((i % 3) + 0.5) * (bw / 3), dz = z0 + (Math.floor(i / 3) + 0.5) * ((z1 - z0) / 2);
          k.cyl(dx, dz, 0.7, h, h + 2.2, 6, I.silver, shade(I.silver, 0.7));
          if (i % 2 === 0) k.part('fan', dx, h + 2.25, dz, 0, { active: k.running });
        }
        if (extra) {
          tank(k, x0 + 1.5, z1 + 2.5, 1.3, 9, W.warmWhite, null, 8);
          tank(k, x0 + 4.5, z1 + 2.5, 1.3, 9, W.warmWhite, null, 8);
        }
      }
      break;
    }
    case 'automotive': {
      // test lot of new cars in factory paint + paint-shop stack
      ground(k, z.x0, z.z0, z.x1, z.z1, shade(YARD, 1.08), 0.05);
      const rows = extra ? 4 : 3;
      const per = Math.max(2, Math.floor((w - 2) / 3.3));
      const paints = ['#B8322E', '#EDEDED', '#2A2C30', '#3D5F8F', '#BFC3C7', '#4F6B4A'];
      for (let r = 0; r < rows; r++) {
        const rz = z.z0 + 3 + r * ((d - 6) / Math.max(1, rows - 1));
        for (let i = 0; i < per; i++) k.prop('parkedCars', z.x0 + 1.8 + i * 3.3, rz, 0, { color: paints[(r * per + i) % paints.length] });
      }
      const sx = z.x1 - 1.2, sz = z.z0 - 1.6;
      k.cyl(sx, sz, 0.75, 0, 18 * Math.min(scale, 1.3), 6, I.galvanized, ASSET_RGB.dockShelter);
      stacks.push([sx, 18 * Math.min(scale, 1.3) + 0.4, sz]);
      break;
    }
    case 'general':
    default: {
      tank(k, z.x0 + 3.5, z.z0 + 4, 2.4, 7, W.warmWhite, null, 10);
      if (lod0) {
        for (let i = 0; i < (extra ? 8 : 5); i++) k.prop('palletStack', z.x0 + 2 + (i % 4) * 2.4, z.z1 - 3 - Math.floor(i / 4) * 2.4, 0, { color: '#C9B48A' });
        k.prop('containers', z.x1 - 3, cz, 0, { color: CONTAINER_HEX[k.int(0, 7)] });
      }
      break;
    }
  }
  return { stacks, flare };
}

/** City-band stand-in for the product props: one or two boxes of the right height and colour, plus the same stack and
 *  flare points as LOD0 (smoke reads at city zoom). ≤ 24 triangles. */
function familyPropsLod1(k: Kit, fam: FactoryFamily, z: Zone, scale: number, extra: boolean): { stacks: P3[]; flare: P3 | null } {
  const w = z.x1 - z.x0, d = z.z1 - z.z0;
  const stacks: P3[] = [];
  let flare: P3 | null = null;
  const s = Math.min(scale, 1.35);
  switch (fam) {
    case 'food': k.box(z.x0 + 0.5, 0, z.z0 + d * (extra ? 0.1 : 0.35), z.x1 - 0.5, 15 * scale, z.z0 + d * (extra ? 0.9 : 0.8), I.galvanized, shade(I.galvanized, 1.1)); break;
    case 'beverage': k.box(z.x0 + 0.5, 0, z.z0 + d * 0.15, z.x1 - 0.5, 9 * scale, z.z0 + d * (extra ? 0.85 : 0.5), W.aluminium); stacks.push([z.x1 - 2, 9 * scale + 1.5, z.z0 + d * 0.3]); break;
    case 'textile': k.box(z.x0 + (w - Math.min(w, 16 * scale)) / 2, 0, z.z0, z.x1 - (w - Math.min(w, 16 * scale)) / 2, 7.2, z.z0 + Math.min(d, 20 * scale), W.cream, R.flat); stacks.push([z.x1 - 1.5 - (w - Math.min(w, 16 * scale)) / 2, 10, z.z0 + 2]); break;
    case 'metal': k.box(z.x0 + 0.8, 9.5 * s, z.z0 + 0.5, z.x1 - 0.8, 10.5 * s, z.z1 - 0.5, I.safetyYellow); break;
    case 'polymer':
      k.box(z.x0 + w * 0.12, 0, z.z0 + 1, z.x1 - w * 0.2, 3.6 * scale + 0.9, z.z0 + 1 + Math.min(d - 3, 14 * scale), W.warmWhite);
      flare = [z.x1 - 1.6, 24 * Math.min(scale, 1.4) + 1.2, z.z1 - 1.6];
      k.box(z.x1 - 2.2, 0, z.z1 - 2.2, z.x1 - 1.0, 24 * Math.min(scale, 1.4), z.z1 - 1.0, I.galvanized);
      stacks.push([z.x0 + w * 0.5, 9, z.z0 + 1]);
      break;
    case 'electronics': k.box(z.x0 + (w - Math.min(w, 24 * scale)) / 2, 0, z.z0, z.x1 - (w - Math.min(w, 24 * scale)) / 2, 9 * s, Math.min(z.z1, z.z0 + Math.min(d, 16 * scale) + (scale > 1.2 ? 0 : d * 0.25)), ASSET_RGB.siteCabin, R.membrane); break;
    case 'automotive': stacks.push([z.x1 - 1.2, 18 * s + 0.4, z.z0 - 1.6]); k.box(z.x1 - 1.6, 0, z.z0 - 2.0, z.x1 - 0.8, 18 * s, z.z0 - 1.2, I.galvanized); break;
    default: k.box(z.x0 + 1, 0, z.z0 + 1.6, z.x0 + 6, 7, z.z0 + 6.4, W.warmWhite); break;
  }
  return { stacks, flare };
}

/** Concrete dock apron in front of a row of doors with yellow truck guide lines (2 per door). `axis` is the direction
 *  trucks back in along: 'z' for doors on a ±Z wall (doors listed by x), 'x' for doors on a ±X wall (listed by z). */
function dockApron(k: Kit, x0: number, z0: number, x1: number, z1: number, doors: readonly number[], axis: 'x' | 'z'): void {
  k.flagged(0, () => k.slab(x0, z0, x1, z1, 0.05, shade(W.concrete, 0.92)));
  const line = I.safetyYellow;
  for (const d of doors) {
    for (const o of [-1.7, 1.7]) {
      if (axis === 'z') k.strip(d + o, z0 + 1.2, d + o, z1 - 1.5, 0.15, 0.065, line);
      else k.strip(x0 + 1.2, d + o, x1 - 1.5, d + o, 0.15, 0.065, line);
    }
  }
}

/** Trucks at docks: art §3.16 trailers = clamp(round(log10(1 + transfers)), 0, docks); without activity data the
 *  utilization picks between min and max. */
function trucksAtDocks(k: Kit, docks: number, min: number, max: number): number {
  if (!k.complete) return 0;
  const a = k.p.activity;
  if (a && (a.transfersIn !== undefined || a.transfersOut !== undefined)) {
    const t = Math.max(0, (a.transfersIn ?? 0) + (a.transfersOut ?? 0));
    return Math.max(0, Math.min(docks, Math.round(Math.log10(1 + t))));
  }
  if (!k.running) return 0;
  return Math.min(docks, min + Math.round((max - min) * k.util));
}

function chimneySmoke(k: Kit, fam: FactoryFamily, top: P3, size: number): void {
  const e = FAMILY_EMISSION[fam];
  if (e.kind) k.emit(e.kind, top[0], top[1], top[2], undefined, { tone: e.tone, size });
}

// ---------------------------------------------------------------------------------------------------------------
// factory_small — 72 × 72 m (lot frame x, z ∈ [−36, 36]; front = +Z)
// ---------------------------------------------------------------------------------------------------------------

function buildFactorySmall(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') return buildSiteForType('factory_small', b, lot, p);
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const style = HALL_STYLES[(p.variant >> 1) % HALL_STYLES.length] ?? HALL_STYLES[0];
  const fam = factoryFamily(p.productIds, p.seed);
  const L = k.level;
  const hallB = L >= 2;

  // ground: paved yard, lawn strip along the street, contact aprons come with each building
  yard(k, -35.5, -35.5, 35.5, 35.5);
  const gateX0 = hallB ? 28.5 : 21;
  ground(k, -35.5, 32.5, gateX0 - 1, 35.5, LAWN, 0.06);

  // hall A — 52 × 36 × 10 m, 5 teeth of 7.2 m with 2.8 m rise
  const A = { x0: -35, z0: -35, x1: 17, z1: 1 };
  if (k.lod0) {
    sawtoothHall(k, A.x0, A.z0, A.x1, A.z1, 10, 5, 2.8, style.wall, style.roof, style.plinth, roofKitFor(p.seed, 0));
    ownerBand(k, 'pz', A.z1, A.x0 + 20.5, A.x1, 8.8, 10.0);
  } else {
    k.roof(() => k.box(A.x0, 0, A.z0, A.x1, 11.4, A.z1, style.wall, style.roof, industrialFacade(k, 10)));
  }

  // office annex 20 × 12 × 7 m in front of the hall's left end, owner roof + rooftop wordmark 14 × 2.2 m
  const O = { x0: -35, z0: 1, x1: -15, z1: 13 };
  if (k.lod0) {
    officeBlock(k, O.x0, O.z0, O.x1, O.z1, 2, W.warmWhite);
    roofBoard(k, -25, 10.5, 7.2, 14, 2.2, 'pz');
    hvac(k, -31, 4.5, 7.2);
  } else {
    k.roof(() => k.box(O.x0, 0, O.z0, O.x1, 7.2, O.z1, W.warmWhite, k.closed ? R.flat : k.ownerRgb, officeFacade(k)));
    k.sign([-25, 9.0, 13], [0, 0, 1], 14, 2.2, { lod1: true });
  }

  // dock doors on the hall front (4 × 4.5 m), a concrete dock apron with guide lines, trucks in owner livery
  const doors = [-9, -2, 5, 12];
  if (k.lod0) {
    for (const x of doors) dockDoor(k, 'pz', A.z1, x, 4, 4.5);
    dockApron(k, -13.5, A.z1, 17, A.z1 + 18, doors, 'z');
  }
  const trucks = trucksAtDocks(k, doors.length, 1, 2);
  const trailer = trailerFor(fam);
  for (let i = 0; i < trucks; i++) k.prop(trailer, doors[(i * 2 + (p.seed & 1)) % doors.length], A.z1 + 0.55 + 8.3, 0, { color: k.ownerHex });

  // staff parking: 16 bays (12 when hall B takes the front)
  const per = hallB ? 6 : 8;
  if (k.lod0) {
    const rowA = parkingRow(k, -34.6, 17, per, 5, 2.6, 1);
    const rowB = parkingRow(k, -34.6, 32, per, 5, 2.6, -1);
    const fill = k.complete ? 0.3 + 0.6 * k.util : 0;
    parkCars(k, rowA, fill, Math.PI);
    parkCars(k, rowB, fill, 0);
  }

  // hall B (L2): a parallel hall across the yard
  if (hallB) {
    const B = { x0: -17, z0: 19, x1: 27, z1: 35 };
    if (k.lod0) {
      sawtoothHall(k, B.x0, B.z0, B.x1, B.z1, 8, 2, 2.6, style.wall, style.roof, style.plinth, roofKitFor(p.seed, 1));
      ownerBand(k, 'pz', B.z1, B.x0, B.x1, 6.9, 8.0);
      for (const x of [-6, 4]) dockDoor(k, 'nz', B.z0, x, 4, 4.2);
    } else {
      k.roof(() => k.box(B.x0, 0, B.z0, B.x1, 9.3, B.z1, style.wall, style.roof, industrialFacade(k, 8)));
    }
  }

  // L3: conveyor bridge at 6 m between the halls
  if (L >= 3 && k.lod0) conveyor(k, [-13, 6.5, A.z1 + 0.2], [-13, 6.5, 18.8], 2.2, 2.2, I.galvanized, 1);

  // product props zone (right strip) and chimneys at the back
  const zone: Zone = { x0: 20.5, z0: -27, x1: 35, z1: -4 };
  const { stacks, flare } = familyProps(k, fam, zone, 1, L >= 3);
  const chimneyRgb = fam === 'electronics' ? I.galvanized : (p.seed >>> 6) % 3 === 0 ? W.concrete : I.chimneyBrick;
  const chimneys: P3[] = [[24.5, 0, -31.5]];
  if (L >= 3) chimneys.push([31.2, 0, -31.5]);
  for (const c of chimneys) {
    const top = fam === 'electronics'
      ? (k.cyl(c[0], c[2], 1.0, 0, 24, 8, chimneyRgb, ASSET_RGB.dockShelter), [c[0], 24.5, c[2]] as P3)
      : chimney(k, c[0], c[2], 1.5, 32, chimneyRgb, k.lod0 ? 10 : 4);
    chimneySmoke(k, fam, top, 1);
  }
  for (const s of stacks) k.emit(FAMILY_EMISSION[fam].kind ?? 'steam', s[0], s[1], s[2], 0.8, { tone: FAMILY_EMISSION[fam].tone, size: 0.6 });
  if (flare) k.emit('flare', flare[0], flare[1], flare[2]);

  // fence, gate, flag, lamps, trees
  if (k.lod0) {
    fence(k, -35.6, -35.6, 35.6, 35.6, 2, [gateX0, 35.6]);
    // L1: booth at the left end of the gate, arm across the lane; L2: hall B fills the front, so the booth stands
    // inside the lane by the fence with a shorter arm
    if (hallB) guardhouse(k, 33.8, 28, -1, 4.6);
    else guardhouse(k, gateX0 + 1.8, 31.5);
    flagpole(k, hallB ? -18.2 : -11.5, hallB ? 34.2 : 33.6, 12);
    yardLamp(k, 18.5, 16, 9, -Math.PI / 2);
    yardLamp(k, -13.2, 15.5, 9, Math.PI / 2);
    yardLamp(k, 19, -1.5, 9, -Math.PI / 2);
    if (!hallB) for (let i = 0; i < 4; i++) tree(k, -4 + i * 6.5, 34, 0.8 + 0.25 * k.rnd());
  }
  weeds(k, 3);
  return k.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// factory_large — 120 × 120 m (lot frame x, z ∈ [−60, 60]; front = +Z)
// ---------------------------------------------------------------------------------------------------------------

function buildFactoryLarge(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') return buildSiteForType('factory_large', b, lot, p);
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const style = HALL_STYLES[((p.variant >> 1) + 1) % HALL_STYLES.length] ?? HALL_STYLES[0];
  const fam = factoryFamily(p.productIds, p.seed);
  const L = k.level;

  yard(k, -59.5, -59.5, 59.5, 59.5);

  // two production halls 90 × 36 × 13 m (6 teeth) with a 6 m service lane between them
  const A = { x0: -59, z0: -59, x1: 31, z1: -23 };
  const B = { x0: -59, z0: -17, x1: 31, z1: 19 };
  for (const h of [A, B]) {
    if (k.lod0) sawtoothHall(k, h.x0, h.z0, h.x1, h.z1, 13, 6, 3.0, style.wall, style.roof, style.plinth, roofKitFor(p.seed, h === A ? 0 : 1));
    else k.roof(() => k.box(h.x0, 0, h.z0, h.x1, 14.5, h.z1, style.wall, style.roof, industrialFacade(k, 13)));
  }
  if (k.lod0) {
    ownerBand(k, 'px', B.x1, B.z0, B.z1, 11.6, 13);
    ownerBand(k, 'px', A.x1, A.z0, A.z1, 11.6, 13);
    // service lane: pipe rack at 7 m and a conveyor gallery crossing it (art §4.2.5)
    pipeRack(k, -55, -20, 28, -20, 7);
    conveyor(k, [-30, 7.5, A.z1 + 0.1], [-30, 7.5, B.z0 - 0.1], 1.5, 1.8, I.galvanized, 0);
    conveyor(k, [6, 7.5, A.z1 + 0.1], [6, 7.5, B.z0 - 0.1], 1.5, 1.8, I.galvanized, 0);
  }

  // docks on the east walls: 7 on hall B + 1 on hall A, trucks backed in from the truck yard
  const doorZ = [-14, -9, -4, 1, 6, 11, 16, -27];
  if (k.lod0) {
    for (const z of doorZ) dockDoor(k, 'px', 31, z, 4, 4.5);
    dockApron(k, 31, -31, 49, 19.5, doorZ, 'x');
  }
  const trucks = trucksAtDocks(k, doorZ.length, 4, 8);
  const trailer = trailerFor(fam);
  for (let i = 0; i < trucks; i++) k.prop(trailer, 31 + 0.55 + 8.3, doorZ[(i * 3 + (p.seed & 3)) % doorZ.length], Math.PI / 2, { color: k.ownerHex });

  // storage yard in front of hall B (L1) — replaced by hall C at L2
  const C = { x0: -59, z0: 23, x1: 31, z1: 41 };
  if (L >= 2) {
    if (k.lod0) {
      sawtoothHall(k, C.x0, C.z0, C.x1, C.z1, 10, 3, 2.6, style.wall, style.roof, style.plinth, roofKitFor(p.seed, 2));
      ownerBand(k, 'pz', C.z1, C.x0 + 31, C.x1, 8.8, 10);
    } else {
      k.roof(() => k.box(C.x0, 0, C.z0, C.x1, 11.3, C.z1, style.wall, style.roof, industrialFacade(k, 10)));
    }
  } else if (k.lod0) {
    ground(k, C.x0, C.z0, C.x1, C.z1, WORLD_RGB.wall.concrete, 0.06);
    for (let i = 0; i < 14; i++) k.prop('palletStack', C.x0 + 4 + (i % 7) * 3.0, C.z0 + 3 + Math.floor(i / 7) * 2.6, 0, { color: i % 3 ? '#C9B48A' : '#E4E4DE' });
    for (let i = 0; i < 6; i++) k.prop('containers', C.x0 + 30 + i * 3.2, (C.z0 + C.z1) / 2, 0, { color: CONTAINER_HEX[(p.seed + i * 3) % CONTAINER_HEX.length] });
    if (k.complete && k.running) k.prop('forklift', C.x0 + 25, C.z0 + 5, 0.8);
  }

  // front strip: office block 30 × 14 × 11 m (3 floors) + staff car park (40 bays); L3 adds a second office
  const O = { x0: -59, z0: 44, x1: -29, z1: 58 };
  const O2 = { x0: -26, z0: 44, x1: -4, z1: 58 };
  if (k.lod0) {
    officeBlock(k, O.x0, O.z0, O.x1, O.z1, 3, W.limestone);
    roofBoard(k, -44, 54.5, 10.8, 20, 3, 'pz');
    hvac(k, -54, 48, 10.8);
    hvac(k, -35, 48, 10.8, 2.4, 2, 1.3);
    if (L >= 3) {
      officeBlock(k, O2.x0, O2.z0, O2.x1, O2.z1, 3, W.warmWhite);
      hvac(k, -15, 50, 10.8);
    }
    const parkX0 = L >= 3 ? -1 : -26;
    const per = Math.floor((30.5 - parkX0) / 2.6);
    const fill = k.complete ? 0.3 + 0.6 * k.util : 0;
    parkCars(k, parkingRow(k, parkX0, 44.2, per, 5, 2.6, 1), fill, Math.PI);
    parkCars(k, parkingRow(k, parkX0, 58.2, per, 5, 2.6, -1), fill, 0);
  } else {
    k.roof(() => k.box(O.x0, 0, O.z0, O.x1, 10.8, O.z1, W.limestone, k.closed ? R.flat : k.ownerRgb, officeFacade(k)));
    k.sign([-44, 13.3, 55], [0, 0, 1], 20, 3, { lod1: true });
    if (L >= 3) k.roof(() => k.box(O2.x0, 0, O2.z0, O2.x1, 10.8, O2.z1, W.warmWhite, k.closed ? R.flat : k.ownerRgb, officeFacade(k)));
  }

  // right zone: chimneys (Ø4 × 42 m, owner bands) and 1.6× product props at the back
  const chimneyRgb = fam === 'electronics' ? I.galvanized : (p.seed >>> 6) % 3 === 0 ? W.concrete : I.chimneyBrick;
  for (const x of [40.5, 52.5]) {
    const top = fam === 'electronics'
      ? (k.cyl(x, -53, 1.4, 0, 30, 8, chimneyRgb, ASSET_RGB.dockShelter), [x, 30.5, -53] as P3)
      : chimney(k, x, -53, 2, 42, chimneyRgb, k.lod0 ? 12 : 4);
    chimneySmoke(k, fam, top, 1.6);
  }
  const zone: Zone = { x0: 35, z0: -47, x1: 58.5, z1: -30 };
  const { stacks, flare } = familyProps(k, fam, zone, 1.6, L >= 3);
  for (const s of stacks) k.emit(FAMILY_EMISSION[fam].kind ?? 'steam', s[0], s[1], s[2], 0.8, { tone: FAMILY_EMISSION[fam].tone, size: 0.9 });
  if (flare) k.emit('flare', flare[0], flare[1], flare[2]);

  // L3: tank farm in the front right; otherwise the water tower with the owner emblem
  if (L >= 3) {
    if (k.lod0) {
      for (let i = 0; i < 4; i++) tank(k, 39 + (i % 2) * 11, 36 + Math.floor(i / 2) * 11, 4, 9, W.warmWhite, k.closed ? null : k.ownerRgb, 12);
      pipeRack(k, 36, 30.5, 58, 30.5, 5);
    } else {
      k.box(35, 0, 32, 54, 9.5, 51, W.warmWhite);
    }
  } else if (k.lod0) {
    waterTower(k, 48, 40);
  }

  if (k.lod0) {
    fence(k, -59.6, -59.6, 59.6, 59.6, 2, [34, 50]);
    guardhouse(k, 52, 55.5, -1);
    flagpole(k, -26.5, 58.6, 12);
    yardLamp(k, 45, 25, 10, -Math.PI / 2);
    yardLamp(k, 45, 2, 10, -Math.PI / 2);
    yardLamp(k, 45, -21, 10, -Math.PI / 2);
    yardLamp(k, 33.5, 44, 9, 0);
    for (let i = 0; i < 5; i++) tree(k, -57 + i * 6.8, 42.5, 0.75 + 0.3 * k.rnd());
  }
  weeds(k, 3);
  return k.finish();
}

/** Water tower 25 m: tank on four legs with the owner emblem painted on it (art §4.2.5). ~110 triangles. */
function waterTower(k: Kit, x: number, z: number): void {
  const legs = I.galvanized, top = 25;
  for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]] as const) k.beam([x + dx * 1.25, 0, z + dz * 1.25], [x + dx * 0.8, top - 6, z + dz * 0.8], 0.45, 0.45, legs, 4);
  k.beam([x - 3.2, 9, z + 3.2], [x + 3.2, 9, z + 3.2], 0.25, 0.25, legs, 3);
  k.beam([x - 3.2, 9, z - 3.2], [x + 3.2, 9, z - 3.2], 0.25, 0.25, legs, 3);
  k.cyl(x, z, 4.4, top - 6, top, 12, W.warmWhite, W.warmWhite, false);
  k.flagged(FLAG_SNOWABLE, () => k.cone(x, z, 4.6, 0.4, top, top + 2.4, 12, R.slate));
  k.sign([x, top - 3, z + 4.42], [0, 0, 1], 4.2, 4.2, { style: 'emblem', offset: 0.05 });
}

const FACTORY_FOOTPRINT_SMALL = [[3, 3]] as const;
const FACTORY_FOOTPRINT_LARGE = [[5, 5]] as const;

export const factorySmall: AssetFactory = {
  id: 'factory_small',
  family: 'industrial',
  footprints: FACTORY_FOOTPRINT_SMALL,
  triBudget: { lod0: 2500, lod1: 150 },
  build: buildFactorySmall,
};

export const factoryLarge: AssetFactory = {
  id: 'factory_large',
  family: 'industrial',
  footprints: FACTORY_FOOTPRINT_LARGE,
  triBudget: { lod0: 4500, lod1: 250 },
  build: buildFactoryLarge,
};
