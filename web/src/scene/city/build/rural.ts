// Lot builders for the layout kinds no asset family models (status w3-assets-a §5 gap 7, e3a-citygen §7 request 4):
// fields, pastures, orchards, vineyards, scrub, forest, iron and oil deposits, tank farms, small sheds for ambient
// industry on lots too small for a W4 factory, and vacant lots. They are written through W4's `Kit` (lot frame,
// seeded stream, world-space props, pick box), so they behave exactly like registered factories.
import type { AssetOutput, AssetParams, LotFrame } from '../../assets/AssetFactory';
import { seasonOfMonth } from '../../assets/AssetFactory';
import type { GeoBuilder, RGB } from '../../assets/GeoBuilder';
import { WORLD_RGB, mixRgb, shade } from '../../assets/palette';
import { treeLook, type TreeSpecies } from '../../assets/familiesA';
import { Kit } from '../../assets/families/common-b/kit';
import { cropLook, fieldRows } from '../../assets/families/common-b/crops';
import type { CropKind } from '../../assets/families/common-b/products';
import { industrialFacade, tank } from '../../assets/families/common-b/details';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';

export type LotFn = (k: Kit) => void;

/** Run a Kit-based lot builder like a registered factory. */
export function kitBuild(b: GeoBuilder, lot: LotFrame, p: AssetParams, fn: LotFn): AssetOutput {
  const k = new Kit(b, lot, p);
  fn(k);
  return k.finish();
}

const G = WORLD_RGB.ground;
const VEG = FLAG_VEGETATION | FLAG_SNOWABLE;

function season(k: Kit): number {
  return seasonOfMonth(k.month);
}

function tree(k: Kit, species: TreeSpecies, x: number, z: number, scale: number): void {
  const look = treeLook(species, season(k), k.rnd(), k.rnd(), k.rnd());
  k.prop(look.family, x, z, k.rnd() * Math.PI * 2, { scale, color: look.color });
}

/** Ground over the whole lot (slightly inset, or flush for plots that tile a larger area), flagged for seasons/snow. */
function ground(k: Kit, rgb: RGB, flags = VEG, y = 0.03, inset = 0.2): void {
  k.flagged(flags, () => k.slab(-k.hw + inset, -k.hd + inset, k.hw - inset, k.hd - inset, y, rgb));
}

function cropFor(variant: number, climate: string): CropKind {
  if (variant % 4 === 3) return 'fallow';
  if (climate === 'warm' || climate === 'arid') return variant % 2 === 0 ? 'cotton' : 'sugarcane';
  return 'wheat';
}

/** Field: crop rows with a grass margin, rows along the longer side. */
export function field(climate: string, variant: number): LotFn {
  return (k) => {
    const crop = cropFor(variant, climate);
    const look = cropLook(crop, k.month);
    ground(k, mixRgb(G.meadow, look.ground, 0.4));
    const m = 1.6;
    if (k.lod === 1) {
      // Far field: one slab in the canopy colour weighted by cover, so crops read green or golden at city zoom.
      k.flagged(VEG, () => k.slab(-k.hw + m, -k.hd + m, k.hw - m, k.hd - m, 0.06, mixRgb(look.ground, look.top, look.stage === 'bare' || look.stage === 'furrow' ? 0.2 : look.cover)));
    } else {
      fieldRows(k, crop, -k.hw + m, -k.hd + m, k.hw - m, k.hd - m, { alongZ: k.hd > k.hw, y: 0.05 });
    }
    // A tree or two on the field edge.
    const n = k.int(0, 2);
    for (let i = 0; i < n; i++) tree(k, 'deciduous', (k.rnd() - 0.5) * (2 * k.hw - 4), k.hd - 0.8, 0.9 + 0.3 * k.rnd());
  };
}

/** Pasture: meadow with a timber rail fence, a few shade trees and sometimes a field barn. */
export function pasture(k: Kit): void {
  const winter = season(k) === 3;
  ground(k, winter ? G.dryGrass : shade(G.meadow, 0.98));
  if (k.lod0) {
    const rail: RGB = [0x8a, 0x6e, 0x52];
    const y1 = 0.75, y2 = 1.2, t = 0.1, e = 0.6;
    const x0 = -k.hw + e, x1 = k.hw - e, z0 = -k.hd + e, z1 = k.hd - e;
    for (const y of [y1, y2]) {
      k.box(x0, y, z0, x1, y + t, z0 + t, rail);
      k.box(x0, y, z1 - t, x1, y + t, z1, rail);
      k.box(x0, y, z0, x0 + t, y + t, z1, rail);
      k.box(x1 - t, y, z0, x1, y + t, z1, rail);
    }
    for (let x = x0; x <= x1 + 0.01; x += 12) { k.box(x - 0.08, 0, z0 - 0.08, x + 0.08, 1.4, z0 + 0.08, rail); k.box(x - 0.08, 0, z1 - 0.08, x + 0.08, 1.4, z1 + 0.08, rail); }
    for (let z = z0 + 12; z < z1; z += 12) { k.box(x0 - 0.08, 0, z - 0.08, x0 + 0.08, 1.4, z + 0.08, rail); k.box(x1 - 0.08, 0, z - 0.08, x1 + 0.08, 1.4, z + 0.08, rail); }
  }
  const n = k.int(1, 4);
  for (let i = 0; i < n; i++) tree(k, k.rnd() < 0.3 ? 'conifer' : 'deciduous', (k.rnd() - 0.5) * (2 * k.hw - 8), (k.rnd() - 0.5) * (2 * k.hd - 8), 1 + 0.4 * k.rnd());
  if (k.hw >= 24 && k.rnd() < 0.5) {
    const barn: RGB = [0xa4, 0x4a, 0x3a];
    k.box(-6, 0, -k.hd + 3, 6, 4.2, -k.hd + 12, barn, barn);
    k.flagged(FLAG_SNOWABLE, () => k.gable(-6, -k.hd + 3, 6, -k.hd + 12, 4.2, 3.2, WORLD_RGB.roof.slate, barn, true));
  }
}

/** Orchard: trees on an 8 m grid over mown grass (blossom in spring, autumn colour, bare in winter). */
export function orchard(k: Kit): void {
  ground(k, shade(G.grass, 1.02));
  const s = 8;
  const nx = Math.max(1, Math.floor((2 * k.hw - 4) / s)), nz = Math.max(1, Math.floor((2 * k.hd - 4) / s));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -((nx - 1) * s) / 2 + i * s, z = -((nz - 1) * s) / 2 + j * s;
      tree(k, 'deciduous', x, z, 0.55 + 0.1 * k.rnd());
    }
  }
}

/** Vineyard: rows of vines on posts (LOD0), green stripes at LOD1. */
export function vineyard(k: Kit): void {
  const sea = season(k);
  const leaf: RGB = sea === 3 ? [0x8a, 0x7f, 0x70] : sea === 2 ? [0xb0, 0x8a, 0x40] : [0x5e, 0x8f, 0x3f];
  ground(k, mixRgb(G.soil, G.grass, 0.45));
  const along = k.hd > k.hw;
  const pitch = 2.6;
  const across = along ? 2 * k.hw - 2 : 2 * k.hd - 2;
  const n = Math.max(1, Math.floor(across / pitch));
  k.flagged(VEG, () => {
    for (let i = 0; i < n; i++) {
      const c = -across / 2 + (i + 0.5) * pitch;
      if (k.lod0) {
        if (along) k.box(c - 0.35, 0.2, -k.hd + 1.5, c + 0.35, 1.5, k.hd - 1.5, shade(leaf, 0.9), leaf);
        else k.box(-k.hw + 1.5, 0.2, c - 0.35, k.hw - 1.5, 1.5, c + 0.35, shade(leaf, 0.9), leaf);
      } else if (i % 2 === 0) {
        if (along) k.slab(c - 0.8, -k.hd + 1.5, c + 0.8, k.hd - 1.5, 0.08, leaf);
        else k.slab(-k.hw + 1.5, c - 0.8, k.hw - 1.5, c + 0.8, 0.08, leaf);
      }
    }
  });
}

/** Scrub (Portbay): dry grass, sparse bushes and the odd palm. */
export function scrub(k: Kit): void {
  ground(k, shade(G.dryGrass, 0.97 + 0.05 * k.rnd()));
  const area = (2 * k.hw) * (2 * k.hd);
  const n = Math.min(14, Math.round(area / 700));
  for (let i = 0; i < n; i++) {
    const x = (k.rnd() - 0.5) * (2 * k.hw - 4), z = (k.rnd() - 0.5) * (2 * k.hd - 4);
    if (k.rnd() < 0.25) tree(k, 'palm', x, z, 0.8 + 0.3 * k.rnd());
    else tree(k, 'conifer', x, z, 0.35 + 0.25 * k.rnd());
  }
}

/** Forest: dense jittered trees (mostly deciduous, a third conifers) over a dark understorey. */
export function forest(k: Kit): void {
  ground(k, shade(G.park, 0.86));
  const s = 9;
  const nx = Math.max(1, Math.floor((2 * k.hw - 2) / s)), nz = Math.max(1, Math.floor((2 * k.hd - 2) / s));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -((nx - 1) * s) / 2 + i * s + (k.rnd() - 0.5) * 5, z = -((nz - 1) * s) / 2 + j * s + (k.rnd() - 0.5) * 5;
      tree(k, k.rnd() < 0.35 ? 'conifer' : 'deciduous', x, z, 0.95 + 0.5 * k.rnd());
    }
  }
}

/** Iron deposit: rocky outcrops and gravel scree on rough grass. */
export function ironDeposit(k: Kit): void {
  ground(k, mixRgb(G.meadow, G.rock, 0.45));
  const rock = G.rock;
  const n = k.int(3, 6);
  k.flagged(FLAG_SNOWABLE, () => {
    for (let i = 0; i < n; i++) {
      const x = (k.rnd() - 0.5) * (2 * k.hw - 16), z = (k.rnd() - 0.5) * (2 * k.hd - 16);
      k.mound(x, z, 4 + 5 * k.rnd(), 3 + 4 * k.rnd(), 1.5 + 3 * k.rnd(), 7, shade(rock, 0.9 + 0.15 * k.rnd()), 0.02);
    }
  });
  for (let i = 0; i < 4; i++) tree(k, 'conifer', (k.rnd() - 0.5) * (2 * k.hw - 6), (k.rnd() - 0.5) * (2 * k.hd - 6), 0.8 + 0.4 * k.rnd());
}

/** Oil deposit: dry grass with a survey pad and marker. */
export function oilDeposit(k: Kit): void {
  ground(k, mixRgb(G.dryGrass, G.meadow, 0.3));
  k.flagged(FLAG_PAVED | FLAG_SNOWABLE, () => k.slab(-6, -6, 6, 6, 0.05, G.gravel));
  k.box(-0.15, 0, -0.15, 0.15, 2.2, 0.15, WORLD_RGB.industry.safetyYellow);
  for (let i = 0; i < 3; i++) tree(k, 'conifer', (k.rnd() - 0.5) * (2 * k.hw - 6), (k.rnd() - 0.5) * (2 * k.hd - 6), 0.4 + 0.3 * k.rnd());
}

/** Tank farm: bunded gravel yard with storage tanks and a pipe run. */
export function tankFarm(k: Kit): void {
  ground(k, G.gravel, FLAG_PAVED | FLAG_SNOWABLE);
  const berm: RGB = shade(G.gravel, 0.85);
  const e = 3;
  k.box(-k.hw + e, 0, -k.hd + e, k.hw - e, 0.8, -k.hd + e + 0.8, berm);
  k.box(-k.hw + e, 0, k.hd - e - 0.8, k.hw - e, 0.8, k.hd - e, berm);
  k.box(-k.hw + e, 0, -k.hd + e, -k.hw + e + 0.8, 0.8, k.hd - e, berm);
  k.box(k.hw - e - 0.8, 0, -k.hd + e, k.hw - e, 0.8, k.hd - e, berm);
  const r = Math.min(9, Math.min(k.hw, k.hd) / 2 - 3);
  const cols = Math.max(1, Math.floor((2 * k.hw - 8) / (2 * r + 4))), rows = Math.max(1, Math.floor((2 * k.hd - 8) / (2 * r + 4)));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -((cols - 1) * (2 * r + 4)) / 2 + i * (2 * r + 4), z = -((rows - 1) * (2 * r + 4)) / 2 + j * (2 * r + 4);
      tank(k, x, z, r, 9 + 3 * k.rnd(), WORLD_RGB.industry.tankWhite, null, k.lod0 ? 14 : 8);
    }
  }
}

/** Small industrial shed for ambient industry on lots too small for a W4 factory. */
export function shed(k: Kit): void {
  ground(k, WORLD_RGB.road.parking, FLAG_PAVED | FLAG_SNOWABLE);
  const wallC = k.pick([WORLD_RGB.industry.industrialBlue, WORLD_RGB.industry.galvanized, WORLD_RGB.industry.silver, WORLD_RGB.wall.concrete]);
  const x0 = -k.hw + 2.5, x1 = k.hw - 2.5, z0 = -k.hd + 2.5, z1 = k.hd - 6;
  const h = 7 + 3 * k.rnd();
  k.box(x0, 0, z0, x1, h, z1, wallC, WORLD_RGB.industry.galvanized, industrialFacade(k, h));
  const docks = Math.max(1, Math.floor((x1 - x0) / 9));
  for (let i = 0; i < docks; i++) {
    const c = x0 + (i + 0.5) * ((x1 - x0) / docks);
    k.box(c - 1.8, 0, z1, c + 1.8, 4.2, z1 + 0.1, WORLD_RGB.industry.dockDoors);
  }
}

/**
 * One plot of a parcel left over beside a company building (the building takes part of the parcel): no fences or
 * street furniture, just open ground — a lawn with the odd tree, a paved apron with planters next to the building,
 * vacant gravel in town, or a yard with weeds and the odd pallet stack.
 */
export function remnant(kind: 'lawn' | 'paved' | 'yard' | 'gravel'): LotFn {
  // Remnant plots tile the rest of a parcel, so their ground is flush and evenly toned (no seams, no checkerboard);
  // details are sparse so a large leftover reads as one open site rather than a pattern.
  return (k) => {
    if (kind === 'lawn') {
      ground(k, shade(G.grass, 1.02), VEG, 0.03, 0);
      if (k.rnd() < 0.3) tree(k, 'deciduous', (k.rnd() - 0.5) * 12, (k.rnd() - 0.5) * 12, 0.8 + 0.3 * k.rnd());
      return;
    }
    if (kind === 'paved') {
      ground(k, WORLD_RGB.road.plaza, FLAG_PAVED | FLAG_SNOWABLE, 0.03, 0);
      if (k.rnd() < 0.35) {
        const x = (k.rnd() - 0.5) * 10, z = (k.rnd() - 0.5) * 10;
        k.flagged(VEG, () => k.box(x - 1.6, 0, z - 1.6, x + 1.6, 0.5, z + 1.6, [0x9b, 0x95, 0x8a], G.park));
        tree(k, 'deciduous', x, z, 0.75);
      }
      return;
    }
    if (kind === 'gravel') {
      ground(k, mixRgb(G.gravel, G.sand, 0.35), FLAG_PAVED | FLAG_SNOWABLE, 0.03, 0);
      if (k.rnd() < 0.4) {
        k.flagged(VEG, () => {
          const x = (k.rnd() - 0.5) * 12, z = (k.rnd() - 0.5) * 12, sx = 2 + 2 * k.rnd(), sz = 1.5 + 1.5 * k.rnd();
          k.slab(x - sx, z - sz, x + sx, z + sz, 0.05, G.dryGrass);
        });
      }
      return;
    }
    ground(k, mixRgb(G.gravel, G.dryGrass, 0.45), FLAG_PAVED | FLAG_SNOWABLE, 0.03, 0);
    if (k.rnd() < 0.45) {
      k.flagged(VEG, () => {
        const x = (k.rnd() - 0.5) * 12, z = (k.rnd() - 0.5) * 12, sx = 2 + 2 * k.rnd(), sz = 1.5 + 1.5 * k.rnd();
        k.slab(x - sx, z - sz, x + sx, z + sz, 0.05, shade(G.dryGrass, 0.92 + 0.08 * k.rnd()));
      });
    }
    if (k.lod0 && k.rnd() < 0.12) {
      const x = (k.rnd() - 0.5) * 12, z = (k.rnd() - 0.5) * 12;
      k.box(x - 1.2, 0, z - 0.8, x + 1.2, 1.1, z + 0.8, [0x9a, 0x7a, 0x55]);
    }
  };
}

/** Vacant lot: lawn (residential), gravel with a low fence (commercial), rough yard (industrial). */
export function vacant(kind: 'lawn' | 'gravel' | 'yard'): LotFn {
  return (k) => {
    // Detail scales with the lot: about one weed patch (or tree) per two plots, so big vacant blocks never read bare.
    const plots = (4 * k.hw * k.hd) / 576;
    const scatter = (n: number, inset: number, draw: (x: number, z: number) => void) => {
      for (let i = 0; i < n; i++) draw((k.rnd() - 0.5) * (2 * k.hw - inset), (k.rnd() - 0.5) * (2 * k.hd - inset));
    };
    if (kind === 'lawn') {
      ground(k, shade(G.grass, 1.03));
      const n = plots <= 1 ? (k.rnd() < 0.5 ? 1 : 0) : Math.round(plots * 0.3);
      scatter(n, 6, (x, z) => tree(k, 'deciduous', x, z, 0.8 + 0.3 * k.rnd()));
    } else if (kind === 'gravel') {
      ground(k, mixRgb(G.gravel, G.sand, 0.35), FLAG_PAVED | FLAG_SNOWABLE);
      // Weedy patches and a low site fence along the street.
      k.flagged(VEG, () => scatter(Math.max(3, Math.round(plots * 0.6)), 6, (x, z) => {
        const sx = 1.5 + 1.5 * k.rnd(), sz = 1 + 1.5 * k.rnd();
        k.slab(x - sx, z - sz, x + sx, z + sz, 0.05, shade(G.dryGrass, 0.95 + 0.08 * k.rnd()));
      }));
      if (k.lod0) k.box(-k.hw + 0.6, 0, k.hd - 0.7, k.hw - 0.6, 1.1, k.hd - 0.6, [0x8e, 0x8c, 0x87]);
    } else {
      ground(k, mixRgb(G.gravel, G.dryGrass, 0.5), FLAG_PAVED | FLAG_SNOWABLE);
      k.flagged(VEG, () => scatter(Math.max(4, Math.round(plots * 0.6)), 8, (x, z) => {
        const sx = 2 + 1.5 * k.rnd(), sz = 1.5 + 1 * k.rnd();
        k.slab(x - sx, z - sz, x + sx, z + sz, 0.05, shade(G.dryGrass, 0.92 + 0.06 * k.rnd()));
      }));
      if (k.lod0) k.box(-k.hw + 0.6, 0, k.hd - 0.7, k.hw - 0.6, 2.0, k.hd - 0.6, [0x9f, 0xa7, 0xae]);
    }
  };
}
