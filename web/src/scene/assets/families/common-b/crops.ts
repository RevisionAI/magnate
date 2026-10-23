// Crop growth by game month (art bible §3.14 seasons, §4.2.9 growth table, §4.2.11 plantation calendars) and the
// row-crop field writer shared by farms, plantations and farm construction stages. Temperate calendar: the city
// climate is not in AssetParams yet (see the W4 status doc, Known gaps).
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { RGB } from '../../GeoBuilder';
import { WORLD_RGB, mixRgb, shade } from '../../palette';
import type { Kit } from './kit';
import type { CropKind } from './products';

export type GrowthStage = 'bare' | 'furrow' | 'growing' | 'ripe' | 'stubble';

/** What a field looks like this month. */
export interface CropLook {
  stage: GrowthStage;
  /** Row height (m). */
  height: number;
  /** Share of the row pitch covered by the crop band (canopy closes as it grows). */
  cover: number;
  side: RGB;
  top: RGB;
  /** Soil / ground between the rows. */
  ground: RGB;
}

/** Full-grown row heights (art §4.2.9: wheat 0.9 m, sugarcane 2.6 m, cotton 0.9 m). */
export const CROP_HEIGHT: Readonly<Record<CropKind, number>> = { wheat: 0.9, sugarcane: 2.6, cotton: 0.9, coffee: 1.6, hops: 5.5, fallow: 0.3 };

type Phase = readonly [GrowthStage, number];
const B: Phase = ['bare', 0], F: Phase = ['furrow', 0], R: Phase = ['ripe', 1];
const g = (h: number): Phase => ['growing', h];
const st = (h: number): Phase => ['stubble', h];

/** Month-by-month calendar, index 0 = January. Wheat follows the §4.2.9 table exactly (Mar sown, May 30 %, Jul full
 *  green, Aug–Sep ripe, Oct stubble, Nov–Feb bare); sugarcane is a ratoon crop harvested in Jan–Feb; cotton is sown in
 *  April and its bolls open in Sep–Oct. */
const CALENDAR: Readonly<Record<'wheat' | 'sugarcane' | 'cotton', readonly Phase[]>> = {
  wheat: [B, B, F, g(0.12), g(0.3), g(0.65), g(1), R, R, st(0.16), B, B],
  sugarcane: [st(0.1), st(0.1), F, g(0.15), g(0.3), g(0.5), g(0.7), g(0.85), g(1), g(1), R, R],
  cotton: [B, B, B, F, g(0.25), g(0.55), g(0.85), g(1), R, R, st(0.3), B],
};

const C = WORLD_RGB.crops;
const SOIL = WORLD_RGB.ground.soil;
const SOIL_DARK = WORLD_RGB.ground.soilDark;

/** Field appearance for a crop and month (1..12). Coffee and hops have their own geometry; for them this returns the
 *  ground and canopy colours only. */
export function cropLook(crop: CropKind, month: number): CropLook {
  const mi = ((((Math.round(month) - 1) % 12) + 12) % 12);
  if (crop === 'fallow') {
    const winter = mi <= 1 || mi === 11;
    const grass = winter ? WORLD_RGB.ground.dryGrass : WORLD_RGB.ground.meadow;
    return { stage: 'growing', height: 0.25, cover: 0.55, side: shade(grass, 0.92), top: grass, ground: mixRgb(SOIL, grass, 0.55) };
  }
  if (crop === 'coffee') {
    return { stage: 'growing', height: CROP_HEIGHT.coffee, cover: 0.7, side: C.coffeeGrowing, top: C.coffee, ground: shade(SOIL, 0.92) };
  }
  if (crop === 'hops') {
    return { stage: 'growing', height: CROP_HEIGHT.hops, cover: 0.3, side: C.hopsGrowing, top: C.hops, ground: SOIL };
  }
  const [stage, h01] = CALENDAR[crop][mi];
  const full = CROP_HEIGHT[crop];
  const growing = crop === 'wheat' ? C.wheatGrowing : crop === 'sugarcane' ? C.sugarcaneGrowing : C.cottonLeaf;
  switch (stage) {
    case 'bare':
      return { stage, height: 0.14, cover: 0.42, side: shade(C.furrow, 0.94), top: C.furrow, ground: SOIL };
    case 'furrow':
      return { stage, height: 0.2, cover: 0.48, side: shade(C.furrow, 0.9), top: shade(C.furrow, 0.96), ground: mixRgb(SOIL, SOIL_DARK, 0.35) };
    case 'growing': {
      // young crops already read green (art §4.2.9: "May — green, 30 % height"); rows close as they grow
      const t = 0.62 + 0.38 * h01;
      const col = mixRgb(SOIL, growing, t);
      return { stage, height: Math.max(0.22, full * h01), cover: 0.5 + 0.35 * h01, side: shade(col, 0.9), top: col, ground: mixRgb(SOIL, shade(growing, 0.75), 0.18 + 0.3 * h01) };
    }
    case 'ripe': {
      if (crop === 'cotton') return { stage, height: full, cover: 0.82, side: shade(C.cottonLeaf, 0.82), top: C.cotton, ground: mixRgb(SOIL, C.cottonLeaf, 0.3) };
      const ripe = crop === 'wheat' ? C.wheat : C.sugarcane;
      return { stage, height: full, cover: crop === 'wheat' ? 0.86 : 0.8, side: shade(ripe, 0.86), top: ripe, ground: mixRgb(SOIL, ripe, 0.35) };
    }
    case 'stubble':
    default:
      return { stage: 'stubble', height: Math.max(0.12, full * h01), cover: 0.6, side: shade(C.stubble, 0.9), top: C.stubble, ground: mixRgb(SOIL, C.stubble, 0.45) };
  }
}

export interface FieldOptions {
  /** Row pitch (m); art §4.2.9 uses 3.2 m. */
  pitch?: number;
  /** Share of rows present, sown from the front (+Z) towards the back (construction stage B "sowing"). */
  sown?: number;
  /** Override the look (construction stage C "first green", closed farms gone to weeds). */
  look?: CropLook;
  /** Rows run along X (default) or along Z. */
  alongZ?: boolean;
  /** Ground slab height (default 0.04 m). */
  y?: number;
}

/** Writes a rectangular row-crop field (soil slab plus one box per row) in the kit's authoring frame. Up-facing faces
 *  are snowable. Cost: 2 + 10 triangles per row. */
export function fieldRows(k: Kit, crop: CropKind, x0: number, z0: number, x1: number, z1: number, o: FieldOptions = {}): void {
  const look = o.look ?? cropLook(crop, k.month);
  const pitch = o.pitch ?? 3.2;
  const y = o.y ?? 0.04;
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), za = Math.min(z0, z1), zb = Math.max(z0, z1);
  k.flagged(FLAG_SNOWABLE, () => {
    k.slab(xa, za, xb, zb, y, look.ground);
    if (k.lod !== 0) return;
    const across = o.alongZ ? xb - xa : zb - za;
    const n = Math.max(1, Math.floor(across / pitch));
    const margin = (across - n * pitch) / 2;
    const band = pitch * look.cover;
    const sown = o.sown ?? 1;
    const rows = Math.max(0, Math.min(n, Math.round(n * sown)));
    for (let i = 0; i < rows; i++) {
      // rows are sown from the front (+Z, or +X when alongZ) backwards
      const c = (o.alongZ ? xb : zb) - margin - (i + 0.5) * pitch;
      if (o.alongZ) k.box(c - band / 2, y, za + 0.6, c + band / 2, y + look.height, zb - 0.6, look.side, look.top);
      else k.box(xa + 0.6, y, c - band / 2, xb - 0.6, y + look.height, c + band / 2, look.side, look.top);
    }
  });
}
