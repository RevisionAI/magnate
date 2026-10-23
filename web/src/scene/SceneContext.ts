// Contract between the CityScene core and the feature modules plugged into it (city layout and chunks, assets,
// traffic, particles, interaction, audio…). Each module owns its own Object3Ds and disposes them; the core owns the
// renderer, camera rig, post pipeline, environment (sky, light, weather, terrain, water) and the render loop.
//
// W1 extended this contract additively (Wave 1): FrameInfo gained camera/time-of-day fields; SceneContext gained the
// camera rig, quality state, environment, post handles + selection outline, world setup, shadow refresh and the
// AudioFrame. `controls` is now a MapControls-compatible facade over the camera-controls rig (read `target`,
// distances and angles; writing `target` still moves the camera) — prefer `rig` in new code.

import type * as THREE from 'three';
import type { CameraRig } from './interaction/CameraRig';
import type { QualityKnobs, Tier, TierSettings } from './core/Quality';
import type { PostHandles } from './core/PostPipeline';
import type { Environment } from './env/Environment';
import type { SceneWorld } from './env/World';
import type { AudioAreaSource, AudioFrame } from './audio/AudioFrameProducer';

export { LAYER_OCCLUDER, LAYER_SELECTION } from './core/PostPipeline';
export type { SceneWorld } from './env/World';
export type { AudioFrame, AudioAreaSource } from './audio/AudioFrameProducer';

export interface FrameInfo {
  /** Seconds since the previous frame (clamped to 0.1 s). */
  dt: number;
  /** Seconds since the scene started. */
  elapsed: number;
  /** 0..1 progress through the current in-game month (from the game clock). */
  monthProgress: number;
  /** Current playback speed (0 = paused). Animations may scale with it. */
  speed: number;
  // ---- W1 additions ----
  /** True when the camera moved this frame (re-fit LOD, labels, picking caches…). */
  cameraMoved: boolean;
  /** Camera-to-target distance in metres. */
  cameraDistance: number;
  /** 0 = street band (≤ 300 m) … 1 = city band (≥ 1,800 m), log scale. */
  zoom01: number;
  /** Camera orbit target on the ground (world metres). Do not mutate. */
  target: THREE.Vector3;
  /** Visual time of day in hours [0, 24). */
  timeOfDay: number;
  /** 0 = day … 1 = night (window/lamp emission, light pools, bloom). */
  night: number;
}

/** MapControls-compatible read surface over the camera rig (kept for modules written against MapControls). */
export interface ControlsLike {
  /** Live orbit target. Writing to it (e.g. `target.set(x, 0, z)`) moves the rig's target on the next frame. */
  readonly target: THREE.Vector3;
  enabled: boolean;
  getDistance(): number;
  getPolarAngle(): number;
  getAzimuthalAngle(): number;
  /** No-op (the rig updates itself); returns false. */
  update(delta?: number): boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** Live quality state (`ctx.quality`). Objects are updated in place; subscribe with `onQualityChanged`. */
export interface QualityState {
  readonly tier: Tier;
  readonly settings: TierSettings;
  /** Knobs after tier, user settings and governor notches. */
  readonly knobs: Readonly<QualityKnobs>;
  /** Governor notch (0 = full quality). */
  readonly level: number;
  /** Software rasteriser: direct rendering, no composer, no shadows. */
  readonly minimal: boolean;
  /** Unmasked GPU renderer string. */
  readonly gpu: string;
  /** Effective device pixel ratio (tier cap × resolution scale). */
  readonly pixelRatio: number;
}

/** Selection / hover outline (survives tier switches; no-op on the minimal pipeline). */
export interface SelectionOutline {
  /** Objects to outline (proxies; they get LAYER_SELECTION enabled). Replaces the previous set. */
  set(objects: readonly THREE.Object3D[]): void;
  clear(): void;
  /** 0..1 outline opacity (hover 0.6, selected 1.0 per art §5.13). */
  strength: number;
}

export interface SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: ControlsLike;
  readonly canvas: HTMLCanvasElement;
  /** Ray-cast helper: world-space hit on the ground plane (y = 0) under a client-space point, or null. */
  groundPointFromClient(clientX: number, clientY: number): THREE.Vector3 | null;
  /** Normalized device coordinates for a client-space point. */
  ndcFromClient(clientX: number, clientY: number, target: THREE.Vector2): THREE.Vector2;

  // ---- W1 additions ----
  /** RTS camera (camera-controls): focus, presets, zoom band, keyboard state, `contextclick` events. */
  readonly rig: CameraRig;
  readonly quality: QualityState;
  /** Sky, lights, fog, day/night clock, seasons, weather, terrain/outskirts, water. */
  readonly env: Environment;
  /** Post-processing handles (bloom, outline, tilt-shift…); null on the minimal pipeline. Rebuilt on tier change. */
  readonly post: PostHandles | null;
  readonly outline: SelectionOutline;
  /** Active city description (null until a city module calls setWorld). */
  readonly world: SceneWorld | null;
  /** Describe the active city: camera bounds, outskirts, water, fog, shadow clip, audio defaults. */
  setWorld(world: SceneWorld): void;
  onWorldChanged(listener: (world: SceneWorld) => void): () => void;
  onQualityChanged(listener: (quality: QualityState) => void): () => void;
  /** A shadow caster changed (chunk swap, building added/removed): re-render the sun shadow map. */
  requestShadowUpdate(): void;
  /** Latest AudioFrame (published at 10 Hz). */
  readonly audioFrame: AudioFrame;
  onAudioFrame(listener: (frame: AudioFrame) => void): () => void;
  setAudioAreaSource(source: AudioAreaSource | null): void;
}

export interface SceneModule {
  readonly name: string;
  /** Called once when the module is added. May create objects and subscribe to the store/bus. */
  init(ctx: SceneContext): void | Promise<void>;
  /** Called every frame before rendering. */
  update?(frame: FrameInfo): void;
  /** Called when the viewport size changes (CSS pixels). */
  resize?(width: number, height: number): void;
  /** Release GPU resources and unsubscribe. */
  dispose?(): void;
}
