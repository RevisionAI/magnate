// The environment of the city view (art §3.6–§3.14, §5.18): sun/moon + hemisphere rig, sky, fog, the 12-minute
// day clock, seasons, weather, the fitted sun shadow, outskirts terrain and water. CityScene owns one instance and
// calls `update()` once per frame before the modules; everything it drives is exposed read-only on `ctx.env`.
import * as THREE from 'three';
import { CityUniforms, makeCityMaterial } from '../materials/CityMaterial';
import type { QualityKnobs } from '../core/Quality';
import {
  DayNightClock, createLightingState, sampleLighting, smoothstep, wrapHour, type DayNightMode, type LightingState,
} from './DayNight';
import { Sky } from './Sky';
import { SunShadow, type GroundRect } from './ShadowFit';
import { createSeasonState, sampleSeason, type Climate, type SeasonState } from './Seasons';
import { WeatherSystem, type WeatherKind, type WeatherState } from './Weather';
import { TerrainModel } from './Terrain';
import { Outskirts } from './Outskirts';
import { WaterSurface } from './Water';
import { cityRect, type SceneWorld } from './World';

export interface EnvironmentOptions {
  /** Day/night setting (default 'dynamic'; reduced motion should pass 'day'). */
  dayNight?: DayNightMode;
  /** Visual hour the dynamic cycle starts at (default 10:00). */
  startHour?: number;
  /** Cosmetic weather on/off (default on). */
  weather?: boolean;
  /** Shadow map size to start with (the tier's). */
  shadowMapSize?: 1024 | 2048 | 4096;
}

/** Per-frame inputs from CityScene. */
export interface EnvFrameInput {
  dt: number;
  /** Seconds since the scene started (shader time). */
  time: number;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  /** Camera-to-target distance (m). */
  distance: number;
  zoom01: number;
  cameraMoved: boolean;
  /** 0..1 progress through the current game month (smooth season blending). */
  monthProgress: number;
  knobs: QualityKnobs;
}

const OVERCAST = new THREE.Color('#9AA6B1');
/**
 * Global scale on the art-bible light intensities. With Neutral tone mapping (which subtracts a 0.04 toe) the bible
 * keys render surfaces ~10–15 % darker and more saturated than their palette colours; 1.12 brings noon-lit ground
 * back to the palette (scene-lab calibration; art §3.8 keeps exposure at 1.0, so the correction lives here).
 */
export const LIGHT_SCALE = 1.12;
const _tmp = new THREE.Color(), _fog = new THREE.Color();

export class Environment {
  readonly root = new THREE.Group();
  readonly sun = new THREE.DirectionalLight('#FFF6E8', 2.9);
  readonly hemi = new THREE.HemisphereLight('#C2DBF2', '#86845F', 1.15);
  readonly sky = new Sky();
  readonly fog = new THREE.Fog('#D4E4EF', 900, 5000);
  readonly clock: DayNightClock;
  readonly weather: WeatherSystem;
  /** Lighting after weather modifiers (what the scene shows this frame). */
  readonly lighting: LightingState = createLightingState();
  readonly season: SeasonState = createSeasonState();
  readonly shadow: SunShadow;
  /** CityMaterial instance for env geometry (outskirts, banks). Shares CityUniforms with every other instance. */
  readonly cityMaterial = makeCityMaterial();
  world: SceneWorld | null = null;
  terrain: TerrainModel | null = null;
  outskirts: Outskirts | null = null;
  water: WaterSurface | null = null;
  /** Shader time (seconds), also written to CityUniforms.uTime. */
  time = 0;
  /**
   * 0..1 whole-city desaturation requested by game-feel effects (insolvency, art §5.21). Environment owns the
   * `CityUniforms.uDesaturate` uniform and combines this with the weather's overcast greying, so set this field
   * rather than the uniform.
   */
  cityDesaturation = 0;

  private month = 5;
  private appliedMonth = -1;
  private climate: Climate = 'temperate';
  private readonly seasonListeners = new Set<(s: SeasonState) => void>();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly skyScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envHour = -100;
  private envDesat = -1;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: EnvironmentOptions = {}) {
    this.root.name = 'environment';
    this.clock = new DayNightClock(options.startHour ?? 10);
    if (options.dayNight && options.dayNight !== 'dynamic') this.clock.setMode(options.dayNight);
    this.weather = new WeatherSystem(1);
    this.weather.enabled = options.weather ?? true;
    this.shadow = new SunShadow(this.sun, options.shadowMapSize ?? 2048);
    this.sun.name = 'sun';
    this.hemi.name = 'sky-light';
    this.root.add(this.sun, this.sun.target, this.hemi, this.sky.mesh);
    this.skyScene.add(this.sky.createProbeMesh());
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.add(this.root);
    scene.fog = this.fog;
  }

  // ------------------------------------------------------------------------------------------------- configuration

  /** Rebuild terrain, outskirts and water for a city; reseed weather; clip the shadow to the city. */
  setWorld(world: SceneWorld): void {
    this.world = world;
    this.outskirts?.dispose();
    this.water?.dispose();
    this.terrain = new TerrainModel(world);
    this.outskirts = new Outskirts(this.terrain, this.cityMaterial);
    this.water = new WaterSurface(this.terrain, this.cityMaterial);
    this.root.add(this.outskirts.group);
    if (this.water.hasWater) this.root.add(this.water.group);
    this.climate = world.climate;
    this.appliedMonth = -1;                       // force season re-application (trees, fields)
    this.weather.reseed(world.seed);
    const r = cityRect(world);
    const m = 400;
    const clip: GroundRect = { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m };
    this.shadow.setClip(clip);
    CityUniforms.uCitySize.value.set(r.maxX - r.minX, r.maxZ - r.minZ);
    this.envHour = -100;                          // regenerate reflections for the new water
  }

  /** Game month 0–11 (January = 0) for seasons. */
  setGameMonth(month: number): void {
    this.month = ((Math.floor(month) % 12) + 12) % 12;
  }

  get gameMonth(): number {
    return this.month;
  }

  setDayNightMode(mode: DayNightMode): void {
    this.clock.setMode(mode);
  }

  /** Jump the visual clock (dev tools, photo mode). */
  setHour(hour: number): void {
    this.clock.setHour(hour);
  }

  setWeatherEnabled(on: boolean): void {
    this.weather.enabled = on;
  }

  /** Pin weather (dev tools / scripted events) or null to resume the seeded sequence. */
  forceWeather(kind: WeatherKind | null, instant = false): void {
    this.weather.force(kind, instant);
  }

  /** Called whenever the integer month or climate changes (recolour trees, crops…). Returns an unsubscribe. */
  onSeasonChange(listener: (s: SeasonState) => void): () => void {
    this.seasonListeners.add(listener);
    if (this.appliedMonth >= 0) listener(this.season);
    return () => this.seasonListeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------------- read-out

  get hour(): number { return this.clock.hour; }
  get night(): number { return this.lighting.night; }
  get weatherState(): WeatherState { return this.weather.state; }
  /** Hour for the audio frame: null = fixed daylight (audio §4.8). */
  get audioHour(): number | null { return this.clock.audioHour; }

  // -------------------------------------------------------------------------------------------------------- frame

  update(input: EnvFrameInput): void {
    const { dt, knobs } = input;
    this.time = input.time;
    this.clock.update(dt);

    // Seasons (cheap uniforms every frame; tree/field recolouring only when the month changes).
    sampleSeason(this.month, input.monthProgress, this.climate, this.season);
    if (this.season.month !== this.appliedMonth) {
      this.appliedMonth = this.season.month;
      this.outskirts?.applySeason(this.season);
      for (const l of this.seasonListeners) l(this.season);
    }
    this.weather.setSeason(this.season.season, this.climate);
    const w = this.weather.update(dt);

    // Time of day, then weather modifiers. Overcast light is flat: the direct light greys out and dims (art §3.14:
    // sun × 0.55 in rain), its shadows fade, and the cooler sky light carries the scene.
    const L = this.lighting;
    sampleLighting(this.clock.hour, L);
    L.lightIntensity *= w.sunScale;
    L.hemiIntensity *= 1 - 0.1 * w.cloud;
    const desat = w.skyDesat;
    if (desat > 0.001) {
      desaturateToward(L.lightColor, OVERCAST, desat * 0.7);
      desaturateToward(L.hemiSky, OVERCAST, desat * 0.6);
      desaturateToward(L.hemiGround, OVERCAST, desat * 0.4);
      desaturateToward(L.skyTop, OVERCAST, desat * 0.6);
      desaturateToward(L.horizon, OVERCAST, desat * 0.6);
      desaturateToward(L.fog, OVERCAST, desat * 0.7);
    }

    // Lights.
    this.sun.color.copy(L.lightColor);
    this.sun.intensity = L.lightIntensity * LIGHT_SCALE;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity * LIGHT_SCALE + 2.2 * w.lightning;
    const shadows = knobs.shadows;
    if (this.sun.castShadow !== shadows) this.sun.castShadow = shadows;
    this.sun.shadow.intensity = 0.85 * (1 - 0.7 * w.cloud);
    this.shadow.setMapSize(knobs.shadowMapSize);
    if (shadows) this.shadow.update(input.time, input.camera, input.cameraMoved, L.lightDir, ORIGIN);
    else { this.sun.position.copy(L.lightDir).multiplyScalar(3000); this.sun.target.position.set(0, 0, 0); }

    // Fog: distances follow the camera distance (art §3.7); haze towards the horizon colour at city zoom. Rain and
    // snow pull the haze in (far × 0.6 in a storm), so the far side of the city greys out.
    const d = input.distance;
    this.fog.near = (1.3 * d + 600) * w.fogNear;
    this.fog.far = (3.2 * d + 4500) * w.fogFar;
    _fog.copy(L.fog).lerp(L.horizon, 0.2 * input.zoom01);
    this.fog.color.copy(_fog);

    // Sky.
    const su = this.sky.uniforms;
    su.uTop.value.copy(L.skyTop);
    su.uHorizon.value.copy(L.horizon);
    su.uFog.value.copy(_fog);
    su.uSunDir.value.copy(L.sunDir);
    su.uSunColor.value.copy(L.lightColor);
    su.uSunVis.value = L.sunVisible;
    su.uNight.value = L.night;
    su.uDesat.value = desat;
    su.uFlash.value = 0.8 * w.lightning;

    // CityMaterial shared uniforms.
    const U = CityUniforms;
    U.uNight.value = L.night;
    U.uLitFrac.value = L.litFrac;
    U.uShopLit.value = L.shopLit;
    // Glass reflects the sky: warm horizon light by day; after sunset the glow sits only on the western horizon, so
    // reflections lean to the darker zenith (otherwise curtain walls turn maroon at dusk, art §1.6 finding 4).
    U.uSkyRefl.value.copy(L.horizon).lerp(L.skyTop, 0.4 + 0.45 * L.night);
    U.uSeasonTint.value.copy(this.season.vegTint);
    U.uVegDesat.value = this.season.vegDesat;
    U.uSnow.value = Math.max(this.season.snow, w.snowCover);
    U.uWet.value = w.wet;
    U.uDesaturate.value = Math.max(this.cityDesaturation, 0.3 * w.cloud);
    U.uTime.value = input.time;
    U.uOwnerRoofMix.value = smoothstep(900, 1600, d);

    // Outskirts trees (LOD + shadow casters) and water.
    if (this.outskirts?.update(input.camera.position, input.target, knobs)) this.shadow.requestUpdate();
    if (this.water?.hasWater) {
      this.water.update(input.time, desat);
      this.updateReflections(desat);
    }
  }

  /** Water reflections: PMREM of the sky, refreshed after 20 visual minutes or a weather change. */
  private updateReflections(desat: number): void {
    let dh = Math.abs(wrapHour(this.clock.hour - this.envHour + 12) - 12);
    if (this.envHour < -50) dh = Infinity;
    if (this.envTarget && dh < 1 / 3 && Math.abs(desat - this.envDesat) < 0.08) return;
    const target = this.pmrem.fromScene(this.skyScene, 0, 0.1, 100, { size: 128 });
    this.water?.setEnvMap(target.texture);
    this.envTarget?.dispose();
    this.envTarget = target;
    this.envHour = this.clock.hour;
    this.envDesat = desat;
  }

  /** A caster changed (chunk swap, building added…): re-render the shadow map next frame. */
  requestShadowUpdate(): void {
    this.shadow.requestUpdate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.outskirts?.dispose();
    this.water?.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.sky.dispose();
    this.cityMaterial.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.seasonListeners.clear();
    this.root.removeFromParent();
  }
}

const ORIGIN = new THREE.Vector3(0, 0, 0);

/** Pull a colour's saturation towards a grey of the same family (overcast skies). */
function desaturateToward(c: THREE.Color, grey: THREE.Color, amount: number): void {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const gl = 0.2126 * grey.r + 0.7152 * grey.g + 0.0722 * grey.b || 1;
  _tmp.copy(grey).multiplyScalar(l / gl);
  c.lerp(_tmp, Math.min(1, Math.max(0, amount)));
}
