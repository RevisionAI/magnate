// Main-thread client of the audio DSP worker (postprocess.worker.ts): renders procedural loops and
// cues with their PCM post-processing and noise generation off the main thread, falling back to
// inline processing where workers are unavailable or fail.

import { makeNoise, type NoiseKind } from './noise';
import { installNoise, noiseSecondsFor, releaseNoise } from './primitives';
import { postProcess, renderPcm, renderRaw, toAudioBuffer, type Builder, type PostJob, type PostOptions, type PostResult, type RenderOptions } from './render';

let worker: Worker | null = null;
let workerBroken = false;
let nextJob = 1;
const pending = new Map<number, { resolve: (c: Float32Array[]) => void; reject: (e: Error) => void }>();

function dspWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./postprocess.worker.ts', import.meta.url), { type: 'module', name: 'magnate-audio-dsp' });
    worker.onmessage = (e: MessageEvent<PostResult>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.chans) p.resolve(e.data.chans);
      else p.reject(new Error(e.data.error ?? 'audio dsp worker failed'));
    };
    worker.onerror = (e) => {
      // a broken worker (e.g. blocked by CSP) degrades to inline processing for good
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error(`audio dsp worker error: ${e.message}`));
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runJob(w: Worker, job: PostJob, transfer: Transferable[]): Promise<Float32Array[]> {
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(job.id, { resolve, reject });
    w.postMessage(job, transfer);
  });
}

/** Post-processing in the worker (buffers transferred both ways); inline if no worker is available. */
export async function postProcessOffThread(raw: Float32Array[], opts: PostOptions): Promise<Float32Array[]> {
  const w = dspWorker();
  if (!w) return postProcess(raw, opts);
  try {
    return await runJob(w, { id: nextJob++, kind: 'post', chans: raw, opts }, raw.map((c) => c.buffer as ArrayBuffer));
  } catch {
    // the input buffers were transferred away: the caller renders again inline rather than fail the sound
    return [];
  }
}

const noiseJobs = new Map<string, Promise<void>>();

/**
 * Make sure white and brown noise of at least `seconds` exist at `rate` before a render, generating
 * them in the worker (megasamples of Math.random would otherwise run inside the render's build step on
 * the main thread). Inline if no worker is available.
 */
export async function prepareNoise(rate: number, seconds: number): Promise<void> {
  await Promise.all(
    (['white', 'brown'] as NoiseKind[]).map(async (kind) => {
      const key = `${kind}:${rate}`;
      for (;;) {
        const busy = noiseJobs.get(key);
        if (busy) {
          await busy;
          continue; // a shorter job may have finished: re-check the cache
        }
        const s = noiseSecondsFor(kind, rate, seconds);
        if (s <= 0) return;
        const frames = Math.round(rate * s);
        const job = (async () => {
          const w = dspWorker();
          const chans = w ? await runJob(w, { id: nextJob++, kind: 'noise', noise: kind, frames }, []).catch(() => null) : null;
          installNoise(kind, rate, (chans ?? makeNoise(kind, frames)) as Float32Array<ArrayBuffer>[]);
        })();
        noiseJobs.set(key, job);
        try {
          await job;
        } finally {
          noiseJobs.delete(key);
        }
        return;
      }
    }),
  );
}

/** Noise longer than this is only for bed/loop renders and is released after NOISE_IDLE_MS without one. */
const NOISE_KEEP_SECONDS = 8;
const NOISE_IDLE_MS = 30_000;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Render a procedural loop or cue into an AudioBuffer of `ctx` with the noise generation and the PCM
 * post-processing off the main thread. Falls back to an inline pass if the worker fails mid-job.
 */
export async function renderBuffer(ctx: BaseAudioContext, build: Builder, opts: RenderOptions): Promise<AudioBuffer> {
  if (releaseTimer) clearTimeout(releaseTimer);
  await prepareNoise(opts.sampleRate, opts.seconds + (opts.loopSeam ?? 0) + 2);
  let pcm = await postProcessOffThread(await renderRaw(build, opts), opts);
  if (!pcm.length) pcm = await renderPcm(build, opts);
  // renders come in bursts (city load); once idle, free the long noise sources
  releaseTimer = setTimeout(() => releaseNoise(NOISE_KEEP_SECONDS), NOISE_IDLE_MS);
  return toAudioBuffer(ctx, pcm, opts.sampleRate);
}

