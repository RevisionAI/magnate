// Time of day: the art-bible lighting keys, the sun/moon path and the cosmetic 12-minute day clock
// (art §2.3, §3.6, §5.18). Pure and allocation-free per frame; Environment.ts applies the result to the scene.
//
// The visual day is independent of game speed (the engine ticks months, not hours). Settings: Dynamic (12 min) |
// Fixed day (13:00) | Fixed golden hour (18:30) | Fixed night (22:30); reduced motion selects Fixed day.
import * as THREE from 'three';

/** One lighting key of art §3.6 (colours sRGB hex; intensities in three.js units, legacy lights removed). */
export interface LightKey {
  readonly h: number;
  readonly sun: string; readonly sunI: number;
  readonly skyTop: string; readonly horizon: string;
  readonly hemiSky: string; readonly hemiGround: string; readonly hemiI: number;
  readonly fog: string;
  readonly night: number;
}

/** art §3.6 table, verbatim. Hour h interpolates neighbouring keys with smoothstep (wrapping at 24 h). */
export const TIME_KEYS: readonly LightKey[] = [
  { h: 0, sun: '#9FB4FF', sunI: 0.45, skyTop: '#060B18', horizon: '#1A2540', hemiSky: '#3A4E7A', hemiGround: '#14161C', hemiI: 0.62, fog: '#16203A', night: 1.0 },
  { h: 5, sun: '#9FB4FF', sunI: 0.40, skyTop: '#0B1428', horizon: '#2C3452', hemiSky: '#3E5280', hemiGround: '#16181E', hemiI: 0.62, fog: '#262F48', night: 1.0 },
  { h: 6.3, sun: '#FF9E5E', sunI: 0.9, skyTop: '#39508A', horizon: '#F0A77A', hemiSky: '#8E96B8', hemiGround: '#4A4034', hemiI: 0.75, fog: '#D9A488', night: 0.45 },
  { h: 8, sun: '#FFE2BC', sunI: 2.4, skyTop: '#5D93D4', horizon: '#CFE0EE', hemiSky: '#B8D3EE', hemiGround: '#7C7A62', hemiI: 1.05, fog: '#CFDCE6', night: 0 },
  { h: 13, sun: '#FFF6E8', sunI: 2.9, skyTop: '#4F8FD8', horizon: '#D3E6F3', hemiSky: '#C2DBF2', hemiGround: '#86845F', hemiI: 1.15, fog: '#D4E4EF', night: 0 },
  { h: 17.2, sun: '#FFE0B0', sunI: 2.6, skyTop: '#568ED0', horizon: '#E3DDCB', hemiSky: '#C4D2E4', hemiGround: '#86785A', hemiI: 1.0, fog: '#DCD8CC', night: 0 },
  { h: 19, sun: '#FFA35C', sunI: 2.2, skyTop: '#4B6FB0', horizon: '#F5B27A', hemiSky: '#AEB2C8', hemiGround: '#6A5646', hemiI: 0.85, fog: '#E8B58E', night: 0 },
  { h: 20.1, sun: '#FF7A4A', sunI: 0.03, skyTop: '#2B3A66', horizon: '#E0957A', hemiSky: '#5A6E9E', hemiGround: '#23262F', hemiI: 0.75, fog: '#4E5878', night: 0.6 },
  { h: 21.2, sun: '#9FB4FF', sunI: 0.40, skyTop: '#0C1530', horizon: '#2D3558', hemiSky: '#3E5280', hemiGround: '#16181E', hemiI: 0.62, fog: '#262E4A', night: 1.0 },
];

export const SUNRISE_H = 6.5;
export const SUNSET_H = 19.75;
export const SUN_MAX_ELEVATION_DEG = 58;
export const MOON_ELEVATION_DEG = 48;
export const MOON_AZIMUTH_DEG = 215;
/** Lowest elevation used for *lighting* while the sun is the light source (avoids lighting from below at dawn). */
export const MIN_LIGHT_ELEVATION_DEG = 4;

export type DayNightMode = 'dynamic' | 'day' | 'golden' | 'night';
/** Static presets for the "Fixed" settings (art §3.6). */
export const FIXED_HOURS: Readonly<Record<Exclude<DayNightMode, 'dynamic'>, number>> = { day: 13, golden: 18.5, night: 22.5 };
/** Length of the cosmetic visual day (D14: 12 minutes). */
export const CYCLE_SECONDS = 720;

/** Everything the scene needs for one instant of the day. Colours are linear (three's working space). */
export interface LightingState {
  hour: number;
  /** Unit vector from the ground towards the active light (sun by day, moon by night). */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  /** 0 = sun is the light, 1 = moon. */
  moon: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  /** Unit vector towards the true sun position (may be below the horizon); drives the sky's sun disc. */
  sunDir: THREE.Vector3;
  /** 0..1 visibility of the sun disc / glow in the sky. */
  sunVisible: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyTop: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  /** 0 = day … 1 = night (window/lamp emission, bloom gate, light pools). */
  night: number;
  /** Share of windows lit at night (0.42 evening, 0.28 after 22:30). */
  litFrac: number;
  /** Shopfront lit multiplier (×2.2 while open, 0.3 after 22:00). */
  shopLit: number;
}

export function createLightingState(): LightingState {
  return {
    hour: 13, lightDir: new THREE.Vector3(0, 1, 0), lightColor: new THREE.Color(), lightIntensity: 1, moon: 0,
    sunElevationDeg: 58, sunAzimuthDeg: 180, sunDir: new THREE.Vector3(0, 1, 0), sunVisible: 1,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 1,
    skyTop: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), night: 0, litFrac: 0.42, shopLit: 2.2,
  };
}

// Pre-decoded key colours (linear) so sampling never parses strings.
interface DecodedKey { h: number; sun: THREE.Color; sunI: number; skyTop: THREE.Color; horizon: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number; fog: THREE.Color; night: number }
const KEYS: DecodedKey[] = TIME_KEYS.map((k) => ({
  h: k.h, sun: new THREE.Color(k.sun), sunI: k.sunI, skyTop: new THREE.Color(k.skyTop), horizon: new THREE.Color(k.horizon),
  hemiSky: new THREE.Color(k.hemiSky), hemiGround: new THREE.Color(k.hemiGround), hemiI: k.hemiI, fog: new THREE.Color(k.fog), night: k.night,
}));

export function wrapHour(h: number): number {
  const r = h % 24;
  return r < 0 ? r + 24 : r;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Direction (unit) from elevation/azimuth in degrees. Azimuth from north (−Z), clockwise towards east (+X). */
export function directionFromAngles(elevationDeg: number, azimuthDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg), az = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}

/** True sun position (art §3.6): elevation 58°·sin(π·f), azimuth 100° + 160°·f, f = day fraction 06:30→19:45. */
export function sunAngles(hour: number): { elevationDeg: number; azimuthDeg: number } {
  const f = (wrapHour(hour) - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
  return { elevationDeg: SUN_MAX_ELEVATION_DEG * Math.sin(Math.PI * f), azimuthDeg: 100 + 160 * f };
}

/** Share of the moon in the light direction: 1 from 20:40 to 05:30, 0 from 06:00 to 20:06, smooth in between. */
export function moonShare(hour: number): number {
  const h = wrapHour(hour);
  if (h >= 20.1) return smoothstep(20.1, 20.67, h);
  if (h < 5.5) return 1;
  if (h < 6.0) return 1 - smoothstep(5.5, 6.0, h);
  return 0;
}

/**
 * Lit window share (art §3.6): 0.42 in the evening, 0.28 from 22:30 (30-minute blend) through the small hours until
 * the night factor fades the windows out at dawn.
 */
export function litFraction(hour: number): number {
  const h = wrapHour(hour);
  return h >= 12 ? 0.42 - 0.14 * smoothstep(22.25, 22.75, h) : 0.28;
}

/** Shopfront multiplier: ×2.2 while open (07:00–22:00), 0.3 when closed, 15-minute blends. */
export function shopLit(hour: number): number {
  const h = wrapHour(hour);
  const open = smoothstep(6.875, 7.125, h) * (1 - smoothstep(21.875, 22.125, h));
  return 0.3 + 1.9 * open;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** Sample the keys + sun path at `hour` into `out` (no allocation). */
export function sampleLighting(hour: number, out: LightingState): LightingState {
  const h = wrapHour(hour);
  out.hour = h;
  // --- keys: find the segment [k0, k1) containing h (wrapping 21.2 → 24 + 0).
  let i = KEYS.length - 1;
  for (let j = 0; j < KEYS.length; j++) if (KEYS[j].h <= h) i = j;
  const k0 = KEYS[i], k1 = KEYS[(i + 1) % KEYS.length];
  const h1 = k1.h <= k0.h ? k1.h + 24 : k1.h;
  const t = smoothstep(0, 1, (h - k0.h) / (h1 - k0.h));
  out.lightColor.copy(k0.sun).lerp(k1.sun, t);
  let intensity = k0.sunI + (k1.sunI - k0.sunI) * t;
  out.skyTop.copy(k0.skyTop).lerp(k1.skyTop, t);
  out.horizon.copy(k0.horizon).lerp(k1.horizon, t);
  out.hemiSky.copy(k0.hemiSky).lerp(k1.hemiSky, t);
  out.hemiGround.copy(k0.hemiGround).lerp(k1.hemiGround, t);
  out.hemiIntensity = k0.hemiI + (k1.hemiI - k0.hemiI) * t;
  out.fog.copy(k0.fog).lerp(k1.fog, t);
  out.night = k0.night + (k1.night - k0.night) * t;

  // --- sun and moon geometry.
  const sun = sunAngles(h);
  out.sunElevationDeg = sun.elevationDeg;
  out.sunAzimuthDeg = sun.azimuthDeg;
  directionFromAngles(sun.elevationDeg, sun.azimuthDeg, out.sunDir);
  out.sunVisible = smoothstep(-2, 3, sun.elevationDeg) * (1 - moonShare(h));
  const moon = moonShare(h);
  out.moon = moon;
  directionFromAngles(Math.max(MIN_LIGHT_ELEVATION_DEG, sun.elevationDeg), sun.azimuthDeg, _a);
  directionFromAngles(MOON_ELEVATION_DEG, MOON_AZIMUTH_DEG, _b);
  out.lightDir.copy(_a).lerp(_b, moon).normalize();
  // Hand-over dip: the light swings from the sun to the moon (or back) while dimmed, so shadows do not sweep at
  // full strength. Evening hand-over happens at ~0.03 intensity anyway; the morning one dips to ~45 %.
  intensity *= 1 - 0.55 * Math.sin(Math.PI * moon) * (h < 12 ? 1 : 0.3);
  out.lightIntensity = intensity;

  out.litFrac = litFraction(h);
  out.shopLit = shopLit(h);
  return out;
}

/**
 * The cosmetic day clock. `dynamic` advances 24 visual hours per `cycleSeconds` (12 min); the fixed modes pin the
 * hour to a preset. `hour` may also be set directly (dev tools, photo mode).
 */
export class DayNightClock {
  mode: DayNightMode = 'dynamic';
  hour: number;
  cycleSeconds = CYCLE_SECONDS;
  /** Freeze a dynamic clock without changing the mode (dev tools, benchmarks). */
  paused = false;

  constructor(startHour = 10) {
    this.hour = wrapHour(startHour);
  }

  setMode(mode: DayNightMode): void {
    this.mode = mode;
    if (mode !== 'dynamic') this.hour = FIXED_HOURS[mode];
  }

  setHour(hour: number): void {
    this.hour = wrapHour(hour);
  }

  update(dt: number): void {
    if (this.mode === 'dynamic' && !this.paused) this.hour = wrapHour(this.hour + (dt * 24) / this.cycleSeconds);
  }

  /** Hour for the audio frame (audio §4.8): null = fixed daylight, so ambience uses day = 1. */
  get audioHour(): number | null {
    return this.mode === 'day' ? null : this.hour;
  }
}
