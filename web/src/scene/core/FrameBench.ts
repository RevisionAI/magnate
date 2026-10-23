// Drained-throughput frame timing (art §1.1, §1.7, Appendix B). Headless Chrome's rAF is not vsync-paced and
// EXT_disjoint_timer_query_webgl2 returns nothing on ANGLE-Metal/Intel when instance buffers are uploaded, so GPU
// cost is measured by syncing with a 1-pixel readPixels, rendering N frames back to back and syncing again.
//
// The drained number includes the CPU side (JS submit + the browser's GPU process), so it rises when the machine is
// busy. As a cross-check, `gpuMs` brackets the same frames with a TIME_ELAPSED timer query: pure GPU time, valid
// only when the driver reports the interval as not disjoint (null otherwise; static scenes usually qualify).
import type * as THREE from 'three';

export interface BenchOptions {
  /** Frames rendered before measuring (shader compile, shadow map, caches). Default 20. */
  warmup?: number;
  /** Measured runs (median and min are reported). Default 5. */
  runs?: number;
  /** Frames per run. Default 40. */
  frames?: number;
  /** Frames timed individually (sync before each) for the JS submit cost. Default 20. */
  submitFrames?: number;
  /** Also time the runs with GPU timer queries (default true). */
  gpuTimer?: boolean;
}

export interface BenchResult {
  /** Median ms per frame over the runs (drained GPU+CPU throughput). */
  medianMs: number;
  minMs: number;
  runsMs: number[];
  /** Median GPU ms per frame from timer queries over the same runs; null when unsupported or disjoint. */
  gpuMs: number | null;
  /** Median CPU time to submit one frame (step + render calls, GPU idle at start). */
  jsSubmitMs: number;
  /** Draw calls and triangles of one frame, all passes (renderer.info after a frame). */
  calls: number;
  triangles: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** Resolve a TIME_ELAPSED query (ns → ms), or null when it never became available or the interval was disjoint. */
async function readQuery(gl: WebGL2RenderingContext, ext: TimerExt, q: WebGLQuery): Promise<number | null> {
  for (let tries = 0; tries < 400; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      return disjoint ? null : ns / 1e6;
    }
  }
  gl.deleteQuery(q);
  return null;
}

/** Time `frame()` (which must step and render one frame) with GPU drains around each run. */
export async function benchDrained(renderer: THREE.WebGLRenderer, frame: () => void, options: BenchOptions = {}): Promise<BenchResult> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const px = new Uint8Array(4);
  const sync = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const warmup = options.warmup ?? 20, runs = options.runs ?? 5, frames = options.frames ?? 40, submitFrames = options.submitFrames ?? 20;
  const ext = (options.gpuTimer ?? true) ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) : null;
  for (let i = 0; i < warmup; i++) frame();
  sync();
  const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
  const runsMs: number[] = [];
  const gpuRuns: number[] = [];
  let gpuValid = ext !== null;
  for (let r = 0; r < runs; r++) {
    sync();
    let q: WebGLQuery | null = null;
    if (ext && gpuValid) {
      gl.getParameter(ext.GPU_DISJOINT_EXT);              // reading clears the disjoint flag
      q = gl.createQuery();
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    }
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) frame();
    if (q && ext) gl.endQuery(ext.TIME_ELAPSED_EXT);
    sync();
    runsMs.push((performance.now() - t0) / frames);
    if (q && ext) {
      const ms = await readQuery(gl, ext, q);
      if (ms === null) gpuValid = false; else gpuRuns.push(ms / frames);
    } else {
      await nextTask();                                   // keep the page responsive between runs
    }
  }
  const submit: number[] = [];
  for (let i = 0; i < submitFrames; i++) {
    sync();
    const t0 = performance.now();
    frame();
    submit.push(performance.now() - t0);
  }
  sync();
  return {
    medianMs: median(runsMs), minMs: Math.min(...runsMs), runsMs, gpuMs: gpuValid && gpuRuns.length ? median(gpuRuns) : null,
    jsSubmitMs: median(submit), calls, triangles,
  };
}
