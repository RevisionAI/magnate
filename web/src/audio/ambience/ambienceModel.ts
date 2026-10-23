// Ambience mix model (audio-plan §4.8): AudioFrame → linear gain per bed, plus the Poisson rates of
// the random world one-shots. Pure functions, unit-tested; the AmbienceDirector applies them.

import { clamp01, gauss, smoothstep } from '../core/math';

/** Produced by the renderer at 10 Hz (art-rendering §5.22); a camera-derived default is used until then. */
export interface AudioFrame {
  /** 0 = street band … 1 = city band (log of camera distance). */
  zoom01: number;
  focus: { x: number; z: number };
  cityId: string;
  coastal: boolean;
  /** Plots from the focus to the nearest water (BFS field); large when inland. */
  distToWaterPlots: number;
  /** Hours from the renderer's sun (cosmetic day/night); null = fixed daylight. */
  timeOfDay: number | null;
  /** 0–11 from the game date (season). */
  month: number;
  /** 0–1 cosmetic weather (0 when the renderer has none). */
  rain: number;
  wind: number;
  /** 0–1 land-use shares within radius R of the focus (summed-area tables). */
  area: { road: number; traffic: number; green: number; industrial: number; commercial: number; residential: number; construction: number; water: number };
}

export type BedId =
  | 'amb_city_day'
  | 'amb_city_night'
  | 'amb_traffic_street'
  | 'amb_crowd'
  | 'amb_birds'
  | 'amb_insects_night'
  | 'amb_wind_high'
  | 'amb_rain_light'
  | 'amb_rain_heavy'
  | 'amb_harbour'
  | 'amb_river'
  | 'amb_industrial';

export const BED_IDS: readonly BedId[] = [
  'amb_city_day',
  'amb_city_night',
  'amb_traffic_street',
  'amb_crowd',
  'amb_birds',
  'amb_insects_night',
  'amb_wind_high',
  'amb_rain_light',
  'amb_rain_heavy',
  'amb_harbour',
  'amb_river',
  'amb_industrial',
];

export interface CityPreset {
  bed: number;
  traffic: number;
  crowd: number;
  harbour: number;
  river: number;
  industrial: number;
  wind: number;
  /** One-shot rate multipliers. */
  oneShots: Partial<Record<string, number>>;
}

/** §4.8 city presets (content geography). */
export const CITY_PRESETS: Readonly<Record<string, CityPreset>> = {
  metropolis: { bed: 1.0, traffic: 1.0, crowd: 1.0, harbour: 0.8, river: 0, industrial: 0.6, wind: 0.6, oneShots: { siren_distant: 1.5 } },
  portbay: { bed: 0.7, traffic: 0.6, crowd: 0.5, harbour: 1.0, river: 0, industrial: 0.9, wind: 0.8, oneShots: { ship_horn: 2 } },
  riverside: { bed: 0.8, traffic: 0.7, crowd: 0.7, harbour: 0, river: 0.7, industrial: 0.8, wind: 0.6, oneShots: {} },
  eastside: { bed: 0.8, traffic: 0.6, crowd: 0.6, harbour: 0, river: 0, industrial: 0.4, wind: 0.6, oneShots: {} },
  hilltown: { bed: 0.5, traffic: 0.4, crowd: 0.4, harbour: 0, river: 0, industrial: 0.3, wind: 1.0, oneShots: { birds: 1.2 } },
};

export const DEFAULT_PRESET: CityPreset = { bed: 0.8, traffic: 0.7, crowd: 0.7, harbour: 0.8, river: 0.5, industrial: 0.6, wind: 0.6, oneShots: {} };

export function presetFor(cityId: string): CityPreset {
  return CITY_PRESETS[cityId] ?? DEFAULT_PRESET;
}

const BIRDS_SEASON = [0.3, 0.35, 0.6, 0.9, 1, 1, 0.9, 0.8, 0.6, 0.45, 0.35, 0.3];
const INSECTS_SEASON = [0, 0, 0.1, 0.3, 0.6, 0.9, 1, 1, 0.7, 0.3, 0.05, 0];
const WIND_SEASON = [1, 0.9, 0.8, 0.6, 0.5, 0.4, 0.4, 0.45, 0.6, 0.8, 0.9, 1];

const season = (table: number[], month: number) => table[((Math.floor(month) % 12) + 12) % 12] as number;

export function dayAmount(t: number | null): number {
  return t === null ? 1 : smoothstep(5, 7, t) - smoothstep(19, 21, t);
}

export function dawnAmount(t: number | null): number {
  return t === null ? 1 : 0.4 + 0.6 * Math.max(gauss(t, 6.5, 1.2), 0.6 * gauss(t, 18.5, 1.0));
}

/** Linear target gain per bed (before the bed's own −26 LUFS mastering and the ambient bus). */
export function bedGains(f: AudioFrame, zoomSpeed = 0): Record<BedId, number> {
  const C = presetFor(f.cityId);
  const z = clamp01(f.zoom01);
  const day = dayAmount(f.timeOfDay);
  const night = 1 - day;
  const rain = clamp01(f.rain);
  const a = f.area;
  const m = f.month;
  const whoosh = 0.3 * Math.min(1, Math.abs(zoomSpeed) / 0.8);
  return {
    amb_city_day: (0.35 + 0.65 * z) * day * C.bed,
    amb_city_night: (0.35 + 0.65 * z) * night * C.bed,
    amb_traffic_street: (1 - z) ** 1.5 * clamp01(a.traffic) * (0.3 + 0.7 * day) * C.traffic,
    amb_crowd: (1 - z) ** 1.5 * clamp01(a.commercial) * day * C.crowd,
    amb_birds: (1 - z) ** 2 * Math.max(clamp01(a.green), 0.15) * season(BIRDS_SEASON, m) * dawnAmount(f.timeOfDay) * (1 - rain) * (C.oneShots.birds ?? 1),
    amb_insects_night: (1 - z) * clamp01(a.green) * season(INSECTS_SEASON, m) * night * (1 - rain),
    amb_wind_high: Math.min(1, smoothstep(0.45, 1, z) * (0.4 + 0.6 * Math.max(clamp01(f.wind), 0.6 * season(WIND_SEASON, m))) * C.wind + whoosh),
    amb_rain_light: smoothstep(0.05, 0.4, rain) * (1 - smoothstep(0.6, 0.9, rain)),
    amb_rain_heavy: smoothstep(0.5, 0.9, rain),
    amb_harbour: (f.coastal ? 1 : 0) * (1 - smoothstep(0, 30, f.distToWaterPlots)) * (1 - 0.5 * z) * C.harbour,
    amb_river: clamp01(a.water) * (1 - z) * C.river,
    amb_industrial: Math.min(1, 2 * clamp01(a.industrial)) * (1 - 0.6 * z) * C.industrial,
  };
}

/** Counts of nearby things for the one-shot rates (from the emitter list within R). */
export interface NearbyCounts {
  warehouses: number;
  factories: number;
  operatingFactories: number;
  constructionSites: number;
  busyStores: number;
}

export interface OneShotRule {
  id: string;
  /** λ per minute. */
  rate: number;
  minGapSec: number;
  where: 'road' | 'warehouse' | 'factory' | 'construction' | 'shore' | 'store' | 'none';
}

/** §4.8 random world one-shots (rates halve at 4× / 8×). */
export function oneShotRules(f: AudioFrame, n: NearbyCounts, fast: boolean): OneShotRule[] {
  const C = presetFor(f.cityId);
  const z = clamp01(f.zoom01);
  const day = dayAmount(f.timeOfDay);
  const night = 1 - day;
  const k = fast ? 0.5 : 1;
  const rules: OneShotRule[] = [
    { id: 'car_horn', rate: 1.5 * clamp01(f.area.traffic) * (1 - z) ** 2 * (0.2 + 0.8 * day), minGapSec: 5, where: 'road' },
    { id: 'truck_reverse', rate: 0.6 * Math.min(1, (n.warehouses + n.factories) / 3) * day, minGapSec: 20, where: 'warehouse' },
    { id: 'forklift_beep', rate: 0.8 * Math.min(1, n.warehouses / 2), minGapSec: 12, where: 'warehouse' },
    { id: 'factory_hiss', rate: Math.min(2, 0.5 * n.operatingFactories), minGapSec: 8, where: 'factory' },
    { id: 'crane_winch', rate: 0.7 * n.constructionSites, minGapSec: 15, where: 'construction' },
    { id: 'ship_horn', rate: 0.25 * (f.coastal ? 1 : 0) * (1 - 0.5 * z) * (C.oneShots.ship_horn ?? 1), minGapSec: 45, where: 'shore' },
    { id: 'siren_distant', rate: (0.08 + 0.12 * night) * (C.oneShots.siren_distant ?? 1), minGapSec: 90, where: 'none' },
    { id: 'thunder', rate: 0.6 * smoothstep(0.7, 1, f.rain), minGapSec: 20, where: 'none' },
    { id: 'door_chime', rate: 0.4 * n.busyStores * (1 - z) ** 2 * day, minGapSec: 6, where: 'store' },
  ];
  return rules.map((r) => ({ ...r, rate: r.rate * k }));
}

/** Probability that a Poisson event with rate λ/min fires within a `dtSec` step. */
export function poissonFireProbability(ratePerMin: number, dtSec: number): number {
  return 1 - Math.exp((-ratePerMin * dtSec) / 60);
}

/** Map camera distance (m) to zoom01 with the §4.15 log mapping over [near, far]. */
export function zoom01FromDistance(d: number, near = 40, far = 1800): number {
  return clamp01(Math.log(Math.max(d, 1e-3) / near) / Math.log(far / near));
}

/** A neutral frame for when no renderer data is available yet. */
export function defaultFrame(cityId = 'metropolis', coastal = true): AudioFrame {
  return {
    zoom01: 0.5,
    focus: { x: 0, z: 0 },
    cityId,
    coastal,
    distToWaterPlots: coastal ? 20 : 999,
    timeOfDay: null,
    month: 5,
    rain: 0,
    wind: 0,
    area: { road: 0.3, traffic: 0.45, green: 0.2, industrial: 0.12, commercial: 0.3, residential: 0.4, construction: 0, water: 0 },
  };
}
