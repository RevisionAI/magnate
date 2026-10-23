// Seasons from the game month and the city climate (art §3.14, §5.18). Pure: month (+ progress) → SeasonState.
// Environment.ts writes `vegTint`/`vegDesat`/`snow` into CityUniforms; tree and field owners read the shares.
import * as THREE from 'three';

export type Climate = 'temperate' | 'warm' | 'cold' | 'arid';
/** 0 spring (Mar–May), 1 summer (Jun–Aug), 2 autumn (Sep–Nov), 3 winter (Dec–Feb). */
export type Season = 0 | 1 | 2 | 3;
export type FieldStage = 'ploughed' | 'sown' | 'growing' | 'ripe' | 'stubble';

export interface SeasonState {
  /** Month 0–11 (January = 0). */
  month: number;
  season: Season;
  climate: Climate;
  /** Linear multiplier for vegetation (FLAG_VEGETATION surfaces): uSeasonTint. */
  vegTint: THREE.Color;
  /** 0–1 desaturation of vegetation towards a warm grey (dormant winter grass): uVegDesat. */
  vegDesat: number;
  /** Share of deciduous trees in autumn colours (#D09A45 / #C0633A via instance colour). */
  autumnShare: number;
  /** Share of deciduous canopies that are bare (winter: canopy scale 0.6, colour #8A7F70). */
  bareShare: number;
  /** Share of deciduous trees blossoming (#F2C6D0) in spring. */
  blossomShare: number;
  /** Seasonal snow cover 0–1 (cold climates in Dec–Feb; weather adds snowfall on top). */
  snow: number;
  /** Crop stage of outskirts fields and farms. */
  fieldStage: FieldStage;
}

interface MonthKey { tint: [number, number, number]; desat: number; autumn: number; bare: number; blossom: number; coldSnow: number }

// Temperate keys at mid-month (Jan … Dec). Tints are multipliers on linear vegetation colour.
const TEMPERATE: readonly MonthKey[] = [
  { tint: [1.04, 0.95, 0.88], desat: 0.4, autumn: 0, bare: 1, blossom: 0, coldSnow: 1.0 },       // Jan
  { tint: [1.03, 0.96, 0.89], desat: 0.36, autumn: 0, bare: 1, blossom: 0, coldSnow: 0.8 },      // Feb
  { tint: [0.97, 1.04, 0.92], desat: 0.2, autumn: 0, bare: 0.45, blossom: 0.04, coldSnow: 0 },   // Mar
  { tint: [0.95, 1.08, 0.92], desat: 0, autumn: 0, bare: 0, blossom: 0.08, coldSnow: 0 },        // Apr
  { tint: [0.96, 1.06, 0.94], desat: 0, autumn: 0, bare: 0, blossom: 0.03, coldSnow: 0 },        // May
  { tint: [1, 1, 1], desat: 0, autumn: 0, bare: 0, blossom: 0, coldSnow: 0 },                     // Jun
  { tint: [1, 1, 1], desat: 0, autumn: 0, bare: 0, blossom: 0, coldSnow: 0 },                     // Jul
  { tint: [1.02, 0.99, 0.95], desat: 0.04, autumn: 0, bare: 0, blossom: 0, coldSnow: 0 },        // Aug
  { tint: [1.04, 0.98, 0.88], desat: 0.08, autumn: 0.15, bare: 0, blossom: 0, coldSnow: 0 },     // Sep
  { tint: [1.08, 0.95, 0.80], desat: 0.12, autumn: 0.4, bare: 0, blossom: 0, coldSnow: 0 },      // Oct
  { tint: [1.07, 0.94, 0.82], desat: 0.3, autumn: 0.3, bare: 0.4, blossom: 0, coldSnow: 0.3 },   // Nov
  { tint: [1.04, 0.95, 0.88], desat: 0.38, autumn: 0, bare: 1, blossom: 0, coldSnow: 0.6 },      // Dec
];

const FIELD_STAGES: readonly FieldStage[] = [
  'ploughed', 'ploughed', 'sown', 'sown', 'growing', 'growing', 'ripe', 'ripe', 'stubble', 'ploughed', 'ploughed', 'ploughed',
];

const mix = (x: number, y: number, t: number) => x + (y - x) * t;

export function seasonOfMonth(month: number): Season {
  const m = ((Math.floor(month) % 12) + 12) % 12;
  return (m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3) as Season;
}

export function createSeasonState(): SeasonState {
  return {
    month: 5, season: 1, climate: 'temperate', vegTint: new THREE.Color(1, 1, 1), vegDesat: 0, autumnShare: 0, bareShare: 0,
    blossomShare: 0, snow: 0, fieldStage: 'growing',
  };
}

/**
 * Season state for `month` (0–11) with `progress` (0–1) through it; values blend between mid-month keys so the
 * city changes continuously as the game clock runs.
 */
export function sampleSeason(month: number, progress: number, climate: Climate, out: SeasonState): SeasonState {
  // Called every frame: no allocations.
  const m = ((Math.floor(month) % 12) + 12) % 12;
  const pos = m + Math.min(1, Math.max(0, progress)) - 0.5;           // keys sit at mid-month
  const i0 = ((Math.floor(pos) % 12) + 12) % 12, i1 = (i0 + 1) % 12;
  const t = pos - Math.floor(pos);
  const a = TEMPERATE[i0], b = TEMPERATE[i1];
  let tr = mix(a.tint[0], b.tint[0], t), tg = mix(a.tint[1], b.tint[1], t), tb = mix(a.tint[2], b.tint[2], t);
  let desat = mix(a.desat, b.desat, t), autumn = mix(a.autumn, b.autumn, t), bare = mix(a.bare, b.bare, t), blossom = mix(a.blossom, b.blossom, t);
  let snow = 0;
  switch (climate) {
    case 'cold':
      snow = mix(a.coldSnow, b.coldSnow, t);
      break;
    case 'warm':
    case 'arid': {
      // Evergreen-ish: no bare canopies or autumn colours; the dry season (winter here) bleaches grass instead.
      const dry = climate === 'arid' ? 0.35 : 0.2;
      tr = 1.05; tg = 1.0; tb = 0.9;
      desat = dry + 0.15 * bare;                       // `bare` is still the temperate winter share here
      autumn = 0; bare = 0; blossom *= 0.5;
      break;
    }
    case 'temperate':
      break;
  }
  out.month = m;
  out.season = seasonOfMonth(m);
  out.climate = climate;
  out.vegTint.setRGB(tr, tg, tb);
  out.vegDesat = desat;
  out.autumnShare = autumn;
  out.bareShare = bare;
  out.blossomShare = blossom;
  out.snow = snow;
  out.fieldStage = climate === 'arid' ? 'stubble' : FIELD_STAGES[m];
  return out;
}

/** Climate for a city id when the layout does not provide one (art §5.3 request 4: `CityOverviewDto.climate`). */
export function defaultClimate(cityId: string): Climate {
  if (/port|bay|south|coast/i.test(cityId)) return 'warm';
  return 'temperate';
}
