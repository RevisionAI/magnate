// Core of the 3D city view (art §5.1–§5.2, §5.9–§5.11, §5.23): renderer, quality tier + frame governor, tiered
// post pipeline, camera rig, environment (sky, sun/moon, fog, day/night, seasons, weather, outskirts, water), the
// AudioFrame and a registry of SceneModules (city layout, assets, traffic, interaction…) plugged in on top.
//
// Public API used by the UI (unchanged from the skeleton): `new CityScene(container, options)`, `add(module)`,
// `focusOn(point, distance?)`, `dispose()`. Everything else is additive.

import * as THREE from 'three';
import type {
  ControlsLike, FrameInfo, QualityState, SceneContext, SceneModule, SelectionOutline,
} from './SceneContext';
import { createRenderer, warmUp, watchContextLoss } from './core/RendererSetup';
import { PostPipeline, type PostHandles } from './core/PostPipeline';
import {
  FrameGovernor, TIER_SETTINGS, governorSteps, guessTier, knobsAtLevel, type GraphicsSettings, type QualityKnobs,
  type Tier, type TierGuess,
} from './core/Quality';
import { ControlsFacade } from './core/ControlsFacade';
import { OutlineController } from './core/SelectionOutline';
import { CameraRig } from './interaction/CameraRig';
import { Environment } from './env/Environment';
import { smoothstep, type DayNightMode } from './env/DayNight';
import type { WeatherKind } from './env/Weather';
import { cityRect, type SceneWorld } from './env/World';
import { AudioFrameProducer, type AudioAreaSource, type AudioFrame } from './audio/AudioFrameProducer';
import { setOwnerColors } from './materials/CityMaterial';
import { OWNER_COLORS } from '@/theme/tokens';

export interface CitySceneOptions {
  /** Called every frame before modules update; returns month progress + speed for animations. */
  onFrame?: (dt: number) => { monthProgress: number; speed: number };
  /** Extra device-pixel-ratio cap on top of the tier cap. */
  pixelRatioCap?: number;
  // ---- W1 additions (all optional) ----
  /** Quality tier, or 'auto' (default: GPU guess + frame governor). */
  tier?: Tier | 'auto';
  /** Frame-time governor (default on; dev pages turn it off for repeatable screenshots/benchmarks). */
  governor?: boolean;
  /** GPU hint (default 'high-performance'; 'low-power' picks the iGPU on dual-GPU laptops). */
  powerPreference?: WebGLPowerPreference;
  /** Day/night setting (default 'dynamic'; reduced motion defaults to 'day'). */
  dayNight?: DayNightMode;
  /** Visual hour the dynamic cycle starts at (default 10:00). */
  startHour?: number;
  /** Cosmetic weather (default on). */
  weather?: boolean;
  /** Default: the OS `prefers-reduced-motion` setting. */
  reducedMotion?: boolean;
  /** stats-gl overlay (dev). */
  stats?: boolean;
  /** Keep the drawing buffer (dev screenshots via canvas.toDataURL). */
  preserveDrawingBuffer?: boolean;
}

/** Default camera azimuth (camera-controls convention): camera south-south-west of the target, looking NNE, so the
 *  morning-to-midday sun (ESE → S) side-lights the facades and the north coast sits at the top of the screen. */
export const DEFAULT_AZIMUTH = 330;

class QualityStateImpl implements QualityState {
  tier: Tier = 'low';
  settings = TIER_SETTINGS.low;
  knobs: QualityKnobs = knobsAtLevel(TIER_SETTINGS.low, 0);
  level = 0;
  minimal = false;
  gpu = '';
  pixelRatio = 1;
}

export class CityScene implements SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly rig: CameraRig;
  readonly env: Environment;
  readonly controls: ControlsLike;
  readonly quality = new QualityStateImpl();
  readonly outline: SelectionOutline;
  world: SceneWorld | null = null;
  /** GPU classification at start-up. */
  readonly gpuGuess: TierGuess;

  private readonly options: CitySceneOptions;
  private readonly modules: SceneModule[] = [];
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly resizeObserver: ResizeObserver;
  private readonly facade: ControlsFacade;
  private readonly outlineCtl = new OutlineController();
  private readonly audio = new AudioFrameProducer();
  private readonly target = new THREE.Vector3();
  private readonly worldListeners = new Set<(w: SceneWorld) => void>();
  private readonly qualityListeners = new Set<(q: QualityState) => void>();
  private readonly cleanups: Array<() => void> = [];
  private pipeline: PostPipeline | null = null;
  private governor: FrameGovernor | null = null;
  private graphics: GraphicsSettings = { preset: 'auto' };
  private stats: { update(): void; dom: HTMLElement } | null = null;
  private statsWanted = false;
  private statsLoading = false;
  private elapsed = 0;
  private lastFrameMs = -1;
  private skipParity = 0;
  private skippedDt = 0;
  private idleSince = 0;
  private onBattery = false;
  private contextLost = false;
  private disposed = false;
  private warmed = false;
  private width = 1;
  private height = 1;

  constructor(private readonly container: HTMLElement, options: CitySceneOptions = {}) {
    this.options = options;
    const reducedMotion = options.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.renderer = createRenderer({ powerPreference: options.powerPreference, preserveDrawingBuffer: options.preserveDrawingBuffer });
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('city-canvas');
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.gpuGuess = guessTier(this.renderer.getContext());

    this.rig = new CameraRig(this.canvas, 1920, 1920, { reducedMotion });
    this.camera = this.rig.camera;
    this.facade = new ControlsFacade(this.rig);
    this.controls = this.facade;
    this.outline = this.outlineCtl;

    setOwnerColors(OWNER_COLORS);
    const tier = options.tier && options.tier !== 'auto' ? options.tier : this.gpuGuess.tier;
    this.env = new Environment(this.renderer, this.scene, {
      dayNight: options.dayNight ?? (reducedMotion ? 'day' : 'dynamic'),
      startHour: options.startHour,
      weather: options.weather,
      shadowMapSize: TIER_SETTINGS[tier].shadowMapSize,
    });
    this.graphics = { preset: options.tier ?? 'auto' };
    this.applyTier(tier, this.gpuGuess.minimal && (options.tier ?? 'auto') === 'auto');
    void this.rig.setView({ target: { x: 0, z: 0 }, distance: 900, azimuthDeg: DEFAULT_AZIMUTH }, false);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanups.push(watchContextLoss(this.canvas, {
      onLost: () => { this.contextLost = true; },
      onRestored: () => {
        this.contextLost = false;
        this.env.requestShadowUpdate();
        void warmUp(this.renderer, this.scene, this.camera).catch(() => undefined);
      },
    }));
    this.watchBattery();
    if (options.stats) this.setStatsVisible(true);

    this.timer.connect(document);
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  // ------------------------------------------------------------------------------------------------ module registry

  async add(module: SceneModule): Promise<void> {
    this.modules.push(module);
    await module.init(this);
    module.resize?.(this.width, this.height);
    this.scheduleWarmUp();
  }

  // --------------------------------------------------------------------------------------------- SceneContext API

  get post(): PostHandles | null {
    return this.pipeline?.handles ?? null;
  }

  get audioFrame(): AudioFrame {
    return this.audio.frame;
  }

  ndcFromClient(clientX: number, clientY: number, target: THREE.Vector2): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    target.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return target;
  }

  groundPointFromClient(clientX: number, clientY: number): THREE.Vector3 | null {
    const ndc = this.ndcFromClient(clientX, clientY, new THREE.Vector2());
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  /** Smoothly frame a world-space point (keeps the current viewing angle). */
  focusOn(point: THREE.Vector3, distance?: number): void {
    void this.rig.focusOn(point, distance);
  }

  /** Smoothly frame a building box (double-click focus, 0.6 s ease). */
  focusBox(box: THREE.Box3): Promise<void> {
    return this.rig.focus(box);
  }

  setWorld(world: SceneWorld): void {
    const cityChanged = this.world?.cityId !== world.cityId;
    this.world = world;
    const r = cityRect(world);
    this.rig.setCityBounds(r.maxX - r.minX, r.maxZ - r.minZ);
    this.env.setWorld(world);
    this.audio.cityId = world.cityId;
    this.audio.coastal = world.water?.some((k) => k === 1) ?? false;
    if (cityChanged) void this.rig.setView({ target: { x: 0, z: 0 }, distance: 0.55 * this.rig.controls.maxDistance, azimuthDeg: DEFAULT_AZIMUTH }, false);
    this.governor?.reset(performance.now());
    for (const l of this.worldListeners) l(world);
    this.scheduleWarmUp(true);
  }

  onWorldChanged(listener: (world: SceneWorld) => void): () => void {
    this.worldListeners.add(listener);
    return () => this.worldListeners.delete(listener);
  }

  onQualityChanged(listener: (quality: QualityState) => void): () => void {
    this.qualityListeners.add(listener);
    return () => this.qualityListeners.delete(listener);
  }

  requestShadowUpdate(): void {
    this.env.requestShadowUpdate();
  }

  onAudioFrame(listener: (frame: AudioFrame) => void): () => void {
    return this.audio.subscribe(listener);
  }

  setAudioAreaSource(source: AudioAreaSource | null): void {
    this.audio.source = source;
  }

  // ------------------------------------------------------------------------------------------------ settings API

  /** Switch tier (rebuilds the post pipeline), or 'auto' to return to the GPU guess + governor. */
  setTier(tier: Tier | 'auto'): void {
    this.graphics = { ...this.graphics, preset: tier };
    const t = tier === 'auto' ? this.gpuGuess.tier : tier;
    this.applyTier(t, tier === 'auto' && this.gpuGuess.minimal);
  }

  /** UX §6.18 Graphics settings (preset, shadows, agent density, resolution scale, FPS cap). */
  setGraphics(settings: GraphicsSettings): void {
    const prevPreset = this.graphics.preset ?? 'auto';
    this.graphics = { ...this.graphics, ...settings };
    const preset = this.graphics.preset ?? 'auto';
    if (preset !== prevPreset) this.setTier(preset);
    else this.applyKnobs();
  }

  setDayNightMode(mode: DayNightMode): void { this.env.setDayNightMode(mode); }
  setHour(hour: number): void { this.env.setHour(hour); }
  setWeatherEnabled(on: boolean): void { this.env.setWeatherEnabled(on); }
  forceWeather(kind: WeatherKind | null, instant = false): void { this.env.forceWeather(kind, instant); }
  /** Game date → seasons. `month` is 1–12 as in DateDto. */
  setGameDate(date: { year: number; month: number }): void { this.env.setGameMonth(date.month - 1); }
  /** Photo mode: tilt-shift "miniature" look (art §1.6 finding 11). */
  setTiltShift(on: boolean): void { this.pipeline?.setTiltShift(on); }

  /** Show or hide the stats-gl overlay (dev tools; loaded lazily on first use). */
  setStatsVisible(on: boolean): void {
    this.statsWanted = on;
    if (this.stats) this.stats.dom.style.display = on ? '' : 'none';
    else if (on && !this.statsLoading) void this.enableStats();
  }

  /** Resolves when the current post pipeline is complete (N8AO attached on HIGH/ULTRA). */
  get pipelineReady(): Promise<void> {
    return this.pipeline?.ready ?? Promise.resolve();
  }

  /** Stop/restart the animation loop (benchmarks drive `step()`/`render()` themselves). */
  setLoopRunning(on: boolean): void {
    if (this.disposed) return;
    this.renderer.setAnimationLoop(on ? (time) => this.frame(time) : null);
    if (on) this.lastFrameMs = -1;
  }

  // ----------------------------------------------------------------------------------------------- tiers & knobs

  private applyTier(tier: Tier, minimal: boolean): void {
    const q = this.quality;
    q.tier = tier;
    q.settings = TIER_SETTINGS[tier];
    q.minimal = minimal;
    q.gpu = this.gpuGuess.renderer;
    this.pipeline?.dispose();
    this.pipeline = null;
    if (minimal) {
      this.renderer.autoClear = true;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.outlineCtl.attach(null);
    } else {
      this.pipeline = new PostPipeline(this.renderer, this.scene, this.camera, tier);
      this.outlineCtl.attach(this.pipeline.handles.outline);
      void this.pipeline.ready.then(() => this.governor?.reset(performance.now()));
    }
    const steps = governorSteps(q.settings);
    const governed = (this.options.governor ?? true) && !minimal;
    this.governor = governed ? new FrameGovernor(steps.length, (level) => { this.quality.level = level; this.applyKnobs(); }) : null;
    this.governor?.reset(performance.now());
    q.level = 0;
    this.applyKnobs();
    this.scheduleWarmUp(true);
  }

  private applyKnobs(): void {
    const q = this.quality;
    const k = knobsAtLevel(q.settings, this.governor?.level ?? 0, this.graphics);
    if (q.minimal) { k.shadows = false; k.resolutionScale = Math.min(k.resolutionScale, 0.75 / Math.max(1, q.settings.maxDpr)); }
    q.knobs = k;
    q.level = this.governor?.level ?? 0;
    this.resize();
    for (const l of this.qualityListeners) l(q);
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.width = width;
    this.height = height;
    const q = this.quality;
    const cap = Math.min(q.settings.maxDpr, this.options.pixelRatioCap ?? Infinity);
    const dpr = Math.max(0.35, Math.min(window.devicePixelRatio || 1, cap) * q.knobs.resolutionScale);
    q.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.pipeline?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const module of this.modules) module.resize?.(width, height);
  }

  private scheduleWarmUp(force = false): void {
    if (this.warmed && !force) return;
    this.warmed = true;
    void warmUp(this.renderer, this.scene, this.camera).catch((error) => console.warn('[scene] warm-up failed', error));
  }

  private watchBattery(): void {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }> };
    if (typeof nav.getBattery !== 'function') return;
    void nav.getBattery().then((battery) => {
      if (this.disposed) return;
      const update = () => { this.onBattery = !battery.charging; };
      update();
      battery.addEventListener('chargingchange', update);
      this.cleanups.push(() => battery.removeEventListener('chargingchange', update));
    }).catch(() => undefined);
  }

  private async enableStats(): Promise<void> {
    this.statsLoading = true;
    try {
      const { default: Stats } = await import('stats-gl');
      if (this.disposed) return;
      const stats = new Stats({ trackGPU: false, trackHz: true, horizontal: true, minimal: false });
      await stats.init(this.renderer);
      if (this.disposed) return;
      stats.dom.style.position = 'absolute';
      stats.dom.style.left = '8px';
      stats.dom.style.bottom = '8px';
      stats.dom.style.top = 'auto';
      stats.dom.style.zIndex = '900';
      stats.dom.style.display = this.statsWanted ? '' : 'none';
      this.container.appendChild(stats.dom);
      this.stats = stats;
    } catch (error) {
      console.warn('[scene] stats-gl unavailable', error);
    } finally {
      this.statsLoading = false;
    }
  }

  // ------------------------------------------------------------------------------------------------------- frame

  private frame(timeMs: number): void {
    if (this.disposed || this.contextLost) return;
    this.timer.update(timeMs);
    const rawDt = this.timer.getDelta();
    const frameMs = this.lastFrameMs >= 0 ? timeMs - this.lastFrameMs : 16.7;
    this.lastFrameMs = timeMs;
    // FPS cap 30 (UX setting) or on battery with an idle camera (art §5.10): render every other rAF.
    const idle = performance.now() - this.idleSince > 10000;
    if (this.graphics.fpsCap === 30 || (this.onBattery && idle)) {
      this.skipParity ^= 1;
      if (this.skipParity) { this.skippedDt += rawDt; return; }
    }
    const dt = Math.min(rawDt + this.skippedDt, 0.1);
    this.skippedDt = 0;
    this.step(dt);
    this.render(dt);
    if (this.statsWanted) this.stats?.update();
    if (this.governor && document.visibilityState === 'visible' && this.graphics.fpsCap !== 30 && !(this.onBattery && idle)) {
      this.governor.tick(performance.now(), frameMs);
    }
  }

  /** Advance everything by `dt` seconds (no rendering). Exposed for dev tools and benchmarks. */
  step(dt: number): void {
    this.elapsed += dt;
    const game = this.options.onFrame?.(dt) ?? { monthProgress: 0, speed: 0 };
    this.facade.syncIn();
    const moved = this.rig.update(dt);
    if (moved) this.idleSince = performance.now();
    this.rig.getTarget(this.target);
    const distance = this.rig.distance;
    const zoom01 = this.rig.zoom01();
    const knobs = this.quality.knobs;
    this.env.update({
      dt, time: this.elapsed, camera: this.camera, target: this.target, distance, zoom01, cameraMoved: moved,
      monthProgress: game.monthProgress, knobs,
    });
    // Bloom policy (art §3.9): LOW only at night; the governor's notch turns it off entirely.
    if (this.pipeline) {
      const night = this.env.night;
      const on = knobs.bloom ? (this.quality.settings.bloom === 'night' ? smoothstep(0.05, 0.3, night) : 1) : 0;
      this.pipeline.setBloom(on);
    }
    const info: FrameInfo = {
      dt, elapsed: this.elapsed, monthProgress: game.monthProgress, speed: game.speed, cameraMoved: moved,
      cameraDistance: distance, zoom01, target: this.target, timeOfDay: this.env.hour, night: this.env.night,
    };
    for (const module of this.modules) module.update?.(info);
    this.facade.syncOut(moved);
    const w = this.env.weatherState;
    this.audio.update({
      dt, time: this.elapsed, camera: this.camera, target: this.target, distance, zoom01, zoomBand: this.rig.zoomBand(),
      timeOfDay: this.env.audioHour, month: this.env.gameMonth, rain: w.rain, wind: w.wind, lightning: w.lightning, speed: game.speed,
    });
  }

  /** Render one frame with the current pipeline (no simulation step). Exposed for benchmarks. */
  render(dt: number): void {
    this.renderer.info.reset();
    if (this.pipeline) this.pipeline.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------------------------------------------ dispose

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    for (const module of [...this.modules].reverse()) {
      try {
        module.dispose?.();
      } catch (error) {
        console.error(`[scene] dispose ${module.name} failed`, error);
      }
    }
    this.modules.length = 0;
    for (const fn of this.cleanups.splice(0)) fn();
    this.worldListeners.clear();
    this.qualityListeners.clear();
    this.audio.dispose();
    this.pipeline?.dispose();
    this.pipeline = null;
    this.env.dispose();
    this.rig.dispose();
    this.timer.dispose();
    this.stats?.dom.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
