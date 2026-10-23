// Tiered post-processing pipeline on pmndrs/postprocessing 6.39.5 (art §3.9, §5.9, Appendix A.6). WebGL only.
//
// Order: DepthPrepass (LAYER_OCCLUDER, depth only) → RenderPass (no clear: keeps the pre-pass depth; the sky is
// drawn last inside it) → N8AO (HIGH/ULTRA, lazily imported) → one merged EffectPass(bloom, outline, tilt-shift,
// tone mapping NEUTRAL, vignette) → EffectPass(FXAA on LOW | SMAA on MED+), after tone mapping so it runs on LDR.
//
// Runtime toggles never rebuild passes (that recompiles shaders): effects are gated through
// `blendMode.opacity.value`. Bloom and tilt-shift are subclassed so that opacity 0 also skips their render-target
// work — postprocessing's EffectPass calls `effect.update()` unconditionally, so opacity alone would still pay the
// ~2.8 ms mip-blur chain on the UHD 630.
//
// The outline costs nothing while its selection is empty. With a selection it renders a depth pass (occluders only,
// through its own LAYER_OCCLUDER camera), the selected objects' mask and a half-resolution edge pass.
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, FXAAEffect, KernelSize, OutlineEffect, Pass, RenderPass, SMAAEffect,
  SMAAPreset, TiltShiftEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import type { Tier } from './Quality';
import { TIER_SETTINGS } from './Quality';
import { OutlineSelection } from './SelectionOutline';

export type { Tier } from './Quality';

/** Layer of the big static opaque occluders (city chunks, terrain); they are on layer 0 as well. */
export const LAYER_OCCLUDER = 1;
/** Layer of selection / hover proxies: rendered only by the outline effect, never by the main camera. */
export const LAYER_SELECTION = 2;

/**
 * Mirror `src` into `dst` (pose, matrices, projection) and restrict `dst` to one layer. Allocation-free, unlike
 * `Camera.copy` (which deep-copies userData through JSON every call).
 */
export function mirrorCamera(dst: THREE.PerspectiveCamera, src: THREE.PerspectiveCamera, layer: number): void {
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.matrixWorld.copy(src.matrixWorld);
  dst.matrixWorldInverse.copy(src.matrixWorldInverse);
  dst.projectionMatrix.copy(src.projectionMatrix);
  dst.projectionMatrixInverse.copy(src.projectionMatrixInverse);
  dst.fov = src.fov;
  dst.aspect = src.aspect;
  dst.zoom = src.zoom;
  dst.near = src.near;
  dst.far = src.far;
  dst.layers.set(layer);
}

/** Depth-only pre-pass over LAYER_OCCLUDER (−3.9 ms at close zoom on the UHD 630, art §1.3). */
export class DepthPrepass extends Pass {
  private readonly depthCam = new THREE.PerspectiveCamera();
  private readonly mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  constructor(private readonly occScene: THREE.Scene, private readonly mainCam: THREE.PerspectiveCamera) {
    super('DepthPrepass');
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null): void {
    mirrorCamera(this.depthCam, this.mainCam, LAYER_OCCLUDER);
    const prevOverride = this.occScene.overrideMaterial, prevBg = this.occScene.background;
    this.occScene.overrideMaterial = this.mat; this.occScene.background = null;
    renderer.setRenderTarget(inputBuffer);
    renderer.clear(true, true, false);
    renderer.render(this.occScene, this.depthCam);
    this.occScene.overrideMaterial = prevOverride; this.occScene.background = prevBg;
  }
  override dispose(): void {
    this.mat.dispose();
    super.dispose();
  }
}

/**
 * Bloom whose mip-blur chain is skipped entirely while its opacity is ~0 (LOW by day, governor notch), and which can
 * run its luminance pass + mip chain at a reduced resolution: postprocessing's mipmap bloom ignores
 * `resolutionScale` and filters at full resolution, which measured +7–9 ms on the UHD 630 at 1080p.
 */
class GatedBloomEffect extends BloomEffect {
  /** Resolution scale of the luminance pass and the mip chain (assigned after super(), see setSize). */
  private chainScale = 1;

  constructor(options: ConstructorParameters<typeof BloomEffect>[0], chainScale: number) {
    super(options);
    this.chainScale = chainScale;
  }

  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, deltaTime?: number): void {
    if (this.blendMode.opacity.value < 0.002) return;
    super.update(renderer, inputBuffer, deltaTime);
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    // The base constructor may call setSize before `chainScale` is assigned; the composer sizes us again later.
    const s = this.chainScale ?? 1;
    if (s < 1) {
      const w = Math.max(1, Math.round(width * s)), h = Math.max(1, Math.round(height * s));
      this.luminancePass.setSize(w, h);
      this.mipmapBlurPass.setSize(w, h);
    }
  }
}

/** Tilt-shift (photo mode) whose blur is skipped while its opacity is ~0. */
class GatedTiltShiftEffect extends TiltShiftEffect {
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, deltaTime?: number): void {
    if (this.blendMode.opacity.value < 0.002) return;
    super.update(renderer, inputBuffer, deltaTime);
  }
}

export interface PostHandles {
  composer: EffectComposer;
  prepass: DepthPrepass;
  render: RenderPass;
  bloom: BloomEffect;
  outline: OutlineEffect;
  tilt: TiltShiftEffect;
  toneMapping: ToneMappingEffect;
  vignette: VignetteEffect;
  aa: FXAAEffect | SMAAEffect;
  /** N8AO pass on HIGH/ULTRA once its lazy import resolved; null otherwise. */
  ao: Pass | null;
}

/** Internals of postprocessing's OutlineEffect that are not in its typings (6.39.5). */
interface OutlineInternals {
  maskPass?: { overrideMaterial?: { uniforms?: { cameraNear?: { value: number }; cameraFar?: { value: number } } } };
}

/** The composer for one tier. Rebuild (dispose + new) to change tiers; everything else is a runtime toggle. */
export class PostPipeline {
  readonly handles: PostHandles;
  /** Resolves once the pipeline is complete (N8AO attached on HIGH/ULTRA; immediately otherwise). */
  readonly ready: Promise<void>;
  /**
   * The outline effect's own camera: mirrors the main camera every frame but sees only LAYER_OCCLUDER, so the
   * effect's hidden-edge depth pass (a full scene render in postprocessing) draws the chunks, terrain and company
   * buildings instead of every tree and prop. Its mask pass switches to LAYER_SELECTION by itself.
   */
  private readonly outlineCam = new THREE.PerspectiveCamera();
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, readonly tier: Tier) {
    const settings = TIER_SETTINGS[tier];
    renderer.toneMapping = THREE.NoToneMapping;               // ToneMappingEffect does it
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    const prepass = new DepthPrepass(scene, camera);
    composer.addPass(prepass);
    const render = new RenderPass(scene, camera);
    render.clearPass.enabled = false;                          // keep the pre-pass depth
    composer.addPass(render);

    // Art §3.9 bloom (threshold 1.0, smoothing 0.25, intensity 0.85, radius 0.72, 6 levels at full resolution). At
    // half resolution one level fewer keeps the same on-screen glow radius.
    const bloom = new GatedBloomEffect({
      mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72,
      levels: settings.bloomScale < 1 ? 5 : 6,
    }, settings.bloomScale);
    mirrorCamera(this.outlineCam, camera, LAYER_OCCLUDER);
    const outline = new OutlineEffect(scene, this.outlineCam, {
      edgeStrength: 3, visibleEdgeColor: 0xffffff, hiddenEdgeColor: 0x3a4a58, xRay: true, blur: false,
      kernelSize: KernelSize.VERY_SMALL, resolutionScale: 0.5,
    });
    outline.selection = new OutlineSelection(LAYER_SELECTION, LAYER_OCCLUDER);
    const tilt = new GatedTiltShiftEffect({ focusArea: 0.45, feather: 0.35, offset: 0.05 });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });   // library default is AGX
    // Tuned in the scene lab: the bible's offset 0.32 / darkness 0.42 darkens the corners to ~50 % with
    // postprocessing's default vignette technique; 0.5 / 0.2 keeps a gentle ~86 % at the corners.
    const vignette = new VignetteEffect({ offset: 0.5, darkness: 0.2 });
    composer.addPass(new EffectPass(camera, bloom, outline, tilt, toneMapping, vignette));
    const aa = settings.aa === 'fxaa' ? new FXAAEffect() : new SMAAEffect({ preset: settings.aa === 'smaa-high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM });
    composer.addPass(new EffectPass(camera, aa));

    tilt.blendMode.opacity.value = 0;                          // photo mode only
    bloom.blendMode.opacity.value = settings.bloom === 'always' ? 1 : 0;   // LOW: driven by the night factor
    this.handles = { composer, prepass, render, bloom, outline, tilt, toneMapping, vignette, aa, ao: null };

    this.ready = settings.ao === 'none' ? Promise.resolve() : this.attachAO(renderer, scene, camera, settings.ao);
  }

  /** Lazy N8AO (keeps it out of the LOW/MED bundle). Inserted right after the RenderPass. */
  private async attachAO(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, mode: 'n8ao-low-half' | 'n8ao-medium-full'): Promise<void> {
    try {
      const { N8AOPostPass } = await import('n8ao');
      if (this.disposed) return;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const ao = new N8AOPostPass(scene, camera, size.x, size.y);
      // N8AO traverses the whole scene every frame looking for transparent materials and, on finding any (light
      // pools, far-field lamp points, particles), permanently switches to "transparency aware" mode, which renders
      // the scene twice more per frame. Our transparent layers are additive glows that need no AO: opt out.
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.configuration.aoRadius = 6;
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = mode === 'n8ao-low-half';
      ao.configuration.gammaCorrection = false;                // tone mapping comes later
      ao.setQualityMode(mode === 'n8ao-low-half' ? 'Low' : 'Medium');
      this.handles.composer.addPass(ao, 2);
      this.handles.ao = ao;
    } catch (error) {
      console.warn('[post] N8AO unavailable; continuing without SSAO', error);
    }
  }

  /** Bloom strength 0..1 (0 also skips the bloom render targets). */
  setBloom(opacity: number): void {
    this.handles.bloom.blendMode.opacity.value = Math.min(1, Math.max(0, opacity));
  }

  setTiltShift(on: boolean): void {
    this.handles.tilt.blendMode.opacity.value = on ? 1 : 0;
  }

  /** Call after renderer.setPixelRatio / CSS size changes (CSS pixels). */
  setSize(width: number, height: number): void {
    this.handles.composer.setSize(width, height, false);
  }

  render(dt: number): void {
    this.syncOutlineCamera();
    this.handles.composer.render(dt);
  }

  /**
   * Keep the outline camera on the main camera. The outline's depth-comparison material copies near/far only when
   * it is built, but the camera rig moves the near/far planes with the zoom, so they are refreshed here (writing the
   * uniforms directly; `copyCameraSettings` would flag the material for recompilation every frame).
   */
  private syncOutlineCamera(): void {
    const cam = this.outlineCam;
    mirrorCamera(cam, this.camera, LAYER_OCCLUDER);
    const outline = this.handles.outline;
    if (outline.selection.size === 0) return;
    const uniforms = (outline as unknown as OutlineInternals).maskPass?.overrideMaterial?.uniforms;
    if (uniforms?.cameraNear && uniforms.cameraFar) {
      uniforms.cameraNear.value = cam.near;
      uniforms.cameraFar.value = cam.far;
    } else {
      outline.mainCamera = cam;                                // internals changed: slower but correct
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handles.composer.dispose();                           // disposes every pass and its effects
  }
}

/** Appendix A compatible factory: resolves with the handles once N8AO (if any) is attached. */
export async function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, tier: Tier): Promise<PostHandles> {
  const pipeline = new PostPipeline(renderer, scene, camera, tier);
  await pipeline.ready;
  return pipeline.handles;
}
