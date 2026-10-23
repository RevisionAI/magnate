// Cosmetic weather (art §3.14, §5.18). Exposes the *state* (uniform drivers + intensities); rain streaks and snow
// flakes are rendered by the Wave 2 FX workstream from `WeatherState.rain/snowfall/wind`, and the audio engine reads
// `rain`/`wind` through the AudioFrame.
//
// Deviation from art §5.18 ("seeded per month"): one game month lasts 12 s at 1× (D5), shorter than the 30–60 s
// wetness/snow ramps, so weather runs as real-time *episodes* of 1.5–9 minutes (like the 12-minute day). The game
// month/season and the city climate set the odds of the next episode; episodes are seeded (city seed + index), so
// a given city replays the same sequence. Purely presentational: nothing here reaches the engine.
import type { Climate, Season } from './Seasons';
import { mulberry32 } from './rng';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow'];

export interface WeatherState {
  /** Current episode. */
  kind: WeatherKind;
  /** 0–1 overcast (ramped): dims the sun, desaturates the sky. */
  cloud: number;
  /** 0–1 rain intensity (ramped): rain streak density, `AudioFrame.rain`. */
  rain: number;
  /** 0–1 snowfall intensity (ramped): flake density. */
  snowfall: number;
  /** 0–1 wind: streak slant, smoke drift, `AudioFrame.wind`. */
  wind: number;
  /** 0–1 surface wetness → CityUniforms.uWet (rises over 30 s of rain, dries over 90 s). */
  wet: number;
  /** 0–1 snow cover from snowfall (rises over 60 s, lingers 2 min, melts over 60 s); combined with seasonal snow. */
  snowCover: number;
  /** 0–1 lightning flash envelope for this frame. */
  lightning: number;
  /** Multiplier on the fog far distance (storm: ×0.6). */
  fogFar: number;
  /** Multiplier on the fog near distance (haze starts closer in rain and snow). */
  fogNear: number;
  /** Multiplier on the direct sun (rain: ×0.55). */
  sunScale: number;
  /** 0–1 sky desaturation towards #9AA6B1. */
  skyDesat: number;
  /** Seconds left in the current episode (Infinity while forced). */
  remaining: number;
}

interface Targets { cloud: number; rain: number; snowfall: number; wind: number }
const TARGETS: Readonly<Record<WeatherKind, Targets>> = {
  clear: { cloud: 0, rain: 0, snowfall: 0, wind: 0.2 },
  cloudy: { cloud: 0.6, rain: 0, snowfall: 0, wind: 0.35 },
  rain: { cloud: 0.9, rain: 0.7, snowfall: 0, wind: 0.45 },
  storm: { cloud: 1, rain: 1, snowfall: 0, wind: 0.85 },
  snow: { cloud: 0.8, rain: 0, snowfall: 0.8, wind: 0.3 },
};

/** Episode durations in real seconds [min, max]. */
const DURATION: Readonly<Record<WeatherKind, readonly [number, number]>> = {
  clear: [240, 540], cloudy: [120, 240], rain: [120, 300], storm: [90, 180], snow: [180, 360],
};

type Odds = Readonly<Partial<Record<WeatherKind, number>>>;
/** Odds of the next episode by climate and season (spring, summer, autumn, winter). */
const ODDS: Readonly<Record<Climate, readonly [Odds, Odds, Odds, Odds]>> = {
  temperate: [
    { clear: 0.55, cloudy: 0.2, rain: 0.2, storm: 0.05 },
    { clear: 0.6, cloudy: 0.15, rain: 0.12, storm: 0.13 },
    { clear: 0.4, cloudy: 0.25, rain: 0.28, storm: 0.07 },
    { clear: 0.45, cloudy: 0.25, rain: 0.12, snow: 0.18 },
  ],
  cold: [
    { clear: 0.5, cloudy: 0.25, rain: 0.2, snow: 0.05 },
    { clear: 0.6, cloudy: 0.2, rain: 0.15, storm: 0.05 },
    { clear: 0.4, cloudy: 0.3, rain: 0.2, snow: 0.1 },
    { clear: 0.3, cloudy: 0.3, snow: 0.4 },
  ],
  warm: [
    { clear: 0.7, cloudy: 0.15, rain: 0.15 },
    { clear: 0.75, cloudy: 0.1, storm: 0.15 },
    { clear: 0.6, cloudy: 0.2, rain: 0.15, storm: 0.05 },
    { clear: 0.6, cloudy: 0.2, rain: 0.2 },
  ],
  arid: [
    { clear: 0.85, cloudy: 0.15 },
    { clear: 0.8, cloudy: 0.12, storm: 0.08 },
    { clear: 0.85, cloudy: 0.15 },
    { clear: 0.8, cloudy: 0.2 },
  ],
};

export function createWeatherState(): WeatherState {
  return { kind: 'clear', cloud: 0, rain: 0, snowfall: 0, wind: 0.2, wet: 0, snowCover: 0, lightning: 0, fogFar: 1, fogNear: 1, sunScale: 1, skyDesat: 0, remaining: 0 };
}

const approach = (v: number, target: number, dt: number, tau: number) => target + (v - target) * Math.exp(-dt / tau);

export class WeatherSystem {
  readonly state: WeatherState = createWeatherState();
  /** Settings "Weather: on/off". Off = clear skies (current wetness/snow dries out). */
  enabled = true;
  private forced: WeatherKind | null = null;
  private episode = 0;
  private season: Season = 1;
  private climate: Climate = 'temperate';
  private snowLinger = 0;
  private strikeIn = 8;
  private flashT = -1;
  private strikes = 0;
  private readonly listeners = new Set<(strength: number) => void>();

  constructor(private seed = 1) {
    this.beginEpisode(true);
  }

  /** Re-seed (city change): restarts the episode sequence. */
  reseed(seed: number): void {
    this.seed = seed >>> 0;
    this.episode = 0;
    this.beginEpisode(true);
  }

  setSeason(season: Season, climate: Climate): void {
    this.season = season;
    this.climate = climate;
  }

  /** Pin a weather kind (dev tools, scripted events), or null to resume the seeded sequence. `instant` skips ramps. */
  force(kind: WeatherKind | null, instant = false): void {
    this.forced = kind;
    if (kind === null) { this.beginEpisode(false); return; }
    this.state.kind = kind;
    this.state.remaining = Infinity;
    if (instant) {
      const t = TARGETS[kind];
      this.state.cloud = t.cloud; this.state.rain = t.rain; this.state.snowfall = t.snowfall; this.state.wind = t.wind;
      this.state.wet = t.rain > 0 ? 1 : 0;
      this.state.snowCover = t.snowfall > 0 ? 1 : 0;
      this.snowLinger = t.snowfall > 0 ? 120 : 0;
      this.derive();
    }
  }

  get forcedKind(): WeatherKind | null {
    return this.forced;
  }

  /** Called on every lightning strike with its strength 0–1 (audio thunder sync). Returns an unsubscribe. */
  onLightning(listener: (strength: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(dt: number): WeatherState {
    const s = this.state;
    if (this.forced === null) {
      s.remaining -= dt;
      if (s.remaining <= 0) this.beginEpisode(false);
    }
    const kind: WeatherKind = this.enabled || this.forced !== null ? s.kind : 'clear';
    const t = TARGETS[kind];
    s.cloud = approach(s.cloud, t.cloud, dt, 15);
    s.rain = approach(s.rain, t.rain, dt, 10);
    s.snowfall = approach(s.snowfall, t.snowfall, dt, 12);
    s.wind = approach(s.wind, t.wind, dt, 8);
    // Wetness: 0 → 1 over ~30 s of rain; dries over ~90 s.
    s.wet = s.rain > 0.2 ? Math.min(1, s.wet + dt / 30) : Math.max(0, s.wet - dt / 90);
    // Snow cover: builds over 60 s while snowing, lingers 2 min after, then melts over 60 s.
    if (s.snowfall > 0.2) { s.snowCover = Math.min(1, s.snowCover + dt / 60); this.snowLinger = 120; }
    else if (this.snowLinger > 0) this.snowLinger -= dt;
    else s.snowCover = Math.max(0, s.snowCover - dt / 60);
    this.updateLightning(dt, kind);
    this.derive();
    return s;
  }

  private derive(): void {
    const s = this.state;
    const precip = Math.max(s.rain, 0.6 * s.snowfall);
    s.fogFar = 1 - 0.4 * precip;
    s.fogNear = 1 - 0.55 * precip;
    s.sunScale = 1 - 0.45 * s.cloud;
    s.skyDesat = 0.85 * s.cloud;
  }

  private updateLightning(dt: number, kind: WeatherKind): void {
    const s = this.state;
    if (kind === 'storm' && s.rain > 0.6) {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        const rnd = mulberry32((this.seed ^ Math.imul(++this.strikes, 0x85ebca6b) ^ Math.imul(this.episode, 0x9e3779b1)) >>> 0);
        this.strikeIn = 6 + 14 * rnd();
        this.flashT = 0;
        const strength = 0.6 + 0.4 * rnd();
        for (const l of this.listeners) l(strength);
      }
    }
    if (this.flashT >= 0) {
      this.flashT += dt;
      const f = this.flashT;
      // Main 0.1 s flash plus a dimmer flicker 0.15 s later.
      s.lightning = f < 0.1 ? 1 - f / 0.1 * 0.3 : f < 0.15 ? 0 : f < 0.22 ? 0.55 : 0;
      if (f > 0.25) { this.flashT = -1; s.lightning = 0; }
    } else s.lightning = 0;
  }

  private beginEpisode(first: boolean): void {
    const rnd = mulberry32((this.seed ^ Math.imul(this.episode + 1, 0x9e3779b1)) >>> 0);
    this.episode++;
    // The first episode of a session is always clear so a new game opens on a sunny city.
    let kind: WeatherKind = 'clear';
    if (!first) {
      const odds = ODDS[this.climate][this.season];
      let total = 0;
      for (const k of WEATHER_KINDS) total += odds[k] ?? 0;
      let r = rnd() * total;
      for (const k of WEATHER_KINDS) {
        r -= odds[k] ?? 0;
        if (r <= 0 && (odds[k] ?? 0) > 0) { kind = k; break; }
      }
    }
    const [lo, hi] = DURATION[kind];
    this.state.kind = kind;
    this.state.remaining = lo + (hi - lo) * rnd();
    this.strikeIn = 4 + 6 * rnd();
  }
}
