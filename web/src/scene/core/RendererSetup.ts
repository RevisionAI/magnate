// WebGLRenderer configuration, loop, warm-up and context-loss handling (art §5.1, §5.23, Appendix A.1).
import * as THREE from 'three';

export interface RendererOptions {
  /** Canvas to render into (a new one is created when omitted). */
  canvas?: HTMLCanvasElement;
  /** Device-pixel-ratio cap applied immediately (CityScene re-applies tier cap × governor scale later). */
  maxDpr?: number;
  /**
   * GPU selection hint. Production uses 'high-performance' (users with a discrete GPU get it); on a dual-GPU Mac
   * 'default' / 'low-power' selects the integrated Intel UHD 630 the LOW tier is measured on (art §1.1).
   */
  powerPreference?: WebGLPowerPreference;
  /** Keep the drawing buffer for readPixels/screenshots after compositing (dev tools only; costs a copy). */
  preserveDrawingBuffer?: boolean;
}

/**
 * Renderer for the composer pipeline: no native MSAA (costs +4.4 to 8.2 ms on the UHD 630 and is wasted under the
 * composer), no stencil, no tone mapping on the renderer (ToneMappingEffect NEUTRAL runs in the composer), PCF
 * shadows (PCFSoftShadowMap is removed for WebGL in r182+), manual `info` reset because the composer renders several
 * passes per frame.
 *
 * Accepts the Appendix A signature `createRenderer(canvas, maxDpr)` as well as an options object.
 */
export function createRenderer(canvasOrOptions: HTMLCanvasElement | RendererOptions = {}, maxDpr?: number): THREE.WebGLRenderer {
  const o: RendererOptions = canvasOrOptions instanceof HTMLCanvasElement ? { canvas: canvasOrOptions, maxDpr } : canvasOrOptions;
  const r = new THREE.WebGLRenderer({
    canvas: o.canvas,
    antialias: false,
    powerPreference: o.powerPreference ?? 'high-performance',
    stencil: false,
    depth: true,
    alpha: false,
    preserveDrawingBuffer: o.preserveDrawingBuffer ?? false,
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio, o.maxDpr ?? 1));
  r.outputColorSpace = THREE.SRGBColorSpace;          // default since r152
  r.toneMapping = THREE.NoToneMapping;                 // composer does NEUTRAL; the minimal pipeline switches it on
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;               // soft 5-tap Vogel disk since r182 (shadow.radius)
  // Keep renderer.shadowMap.autoUpdate = true: the global gate in WebGLShadowMap.render returns early when both the
  // global autoUpdate and needsUpdate are false and would then ignore the per-light flag. Throttle per light instead
  // (sun.shadow.autoUpdate = false + needsUpdate on change; see env/ShadowFit.ts).
  r.shadowMap.autoUpdate = true;
  r.info.autoReset = false;
  return r;
}

/** Appendix A loop helper: setAnimationLoop + THREE.Timer (pause-aware), dt clamped to 0.1 s. */
export function startLoop(renderer: THREE.WebGLRenderer, frame: (dtSec: number, nowMs: number) => void): THREE.Timer {
  const timer = new THREE.Timer();                     // core since r179; Clock deprecated in r183
  timer.connect(document);
  renderer.setAnimationLoop((t) => { timer.update(t); frame(Math.min(timer.getDelta(), 0.1), t); });
  return timer;
}

/** Pre-compile every material/program in the scene (KHR_parallel_shader_compile → no first-frame hitch). */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  await renderer.compileAsync(scene, camera);
}

export interface ContextLossHandlers {
  onLost(): void;
  onRestored(): void;
}

/**
 * art §5.23: on `webglcontextlost` call preventDefault (so the browser may restore it) and pause; on restore three
 * re-uploads geometry/targets on demand, and the owner re-flags CanvasTexture/DataTexture uploads, re-compiles and
 * re-renders shadow maps. Returns an unsubscribe function.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, handlers: ContextLossHandlers): () => void {
  const lost = (e: Event) => { e.preventDefault(); handlers.onLost(); };
  const restored = () => handlers.onRestored();
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost, false);
    canvas.removeEventListener('webglcontextrestored', restored, false);
  };
}
