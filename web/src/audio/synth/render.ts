// Offline rendering of procedural content into AudioBuffers: seamless loops (beds, positional loops,
// the pressure layer) and one-shot cues (the procedural defeat cue). Rendered loops are normalised
// to their class loudness with the BS.1770 meter, so procedural beds sit exactly where generated
// ones will (audio-plan §2.3: beds −26 LUFS-I, positional loops −24 LUFS-I).
//
// Two stages: the OfflineAudioContext render (runs on the audio rendering thread) and the PCM
// post-processing (seam bake, loudness normalisation, peak limiting: plain JS over up to ~1.3 M samples
// per channel). This module is pure and also runs inside the DSP worker; in the game, offthread.ts runs
// the second stage (and the noise generation) in that worker so a city load never stalls a frame;
// tests and the AudioLab level report call renderPcm inline.

import { applyGainDb, measureLoudness } from './loudness';
import type { NoiseKind } from './noise';

export type Builder = (c: OfflineAudioContext, out: AudioNode, seconds: number) => void;

export interface PostOptions {
  seconds: number;
  sampleRate: number;
  /** Normalise integrated loudness to this LUFS value (measured single-channel for mono). */
  targetLufs?: number;
  /** Bake a loop seam of this many seconds (equal-power), making the whole buffer loop seamlessly. */
  loopSeam?: number;
  /** Peak ceiling in dBFS after normalisation (lookahead limiter; default −6.5 for loops, −2 otherwise). */
  peakCeilingDb?: number;
}

export interface RenderOptions extends PostOptions {
  channels: 1 | 2;
}

export function offlineAvailable(): boolean {
  return typeof OfflineAudioContext !== 'undefined';
}

/** Stage 1: render `build` for `seconds` (+ seam) in an OfflineAudioContext; planar raw PCM. */
export async function renderRaw(build: Builder, opts: RenderOptions): Promise<Float32Array[]> {
  const seam = opts.loopSeam ?? 0;
  const total = Math.ceil((opts.seconds + seam) * opts.sampleRate);
  const off = new OfflineAudioContext(opts.channels, total, opts.sampleRate);
  const out = new GainNode(off);
  out.channelCount = opts.channels;
  out.channelCountMode = 'explicit';
  out.connect(off.destination);
  build(off, out, opts.seconds + seam);
  const rendered = await off.startRendering();
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < opts.channels; ch++) chans.push(new Float32Array(rendered.getChannelData(ch)));
  return chans;
}

/** Stage 2 (pure): bake the loop seam, normalise loudness, limit peaks. */
export function postProcess(raw: Float32Array[], opts: PostOptions): Float32Array[] {
  const seam = opts.loopSeam ?? 0;
  const pcm = seam > 0 ? bakeLoop(raw, Math.round(opts.seconds * opts.sampleRate), Math.round(seam * opts.sampleRate)) : raw;
  if (opts.targetLufs !== undefined) {
    const lo = measureLoudness(pcm, opts.sampleRate);
    if (Number.isFinite(lo.integrated)) applyGainDb(pcm, opts.targetLufs - lo.integrated);
    limitPeaks(pcm, opts.sampleRate, opts.peakCeilingDb ?? (seam > 0 ? -6.5 : -2));
  }
  return pcm;
}

/** Render and post-process on this thread (tests, the AudioLab level report). */
export async function renderPcm(build: Builder, opts: RenderOptions): Promise<Float32Array[]> {
  return postProcess(await renderRaw(build, opts), opts);
}

// ---- worker protocol (postprocess.worker.ts; client in offthread.ts) -----------------------------

/** Post-process a render, or generate noise. */
export type PostJob =
  | { id: number; kind: 'post'; chans: Float32Array[]; opts: PostOptions }
  | { id: number; kind: 'noise'; noise: NoiseKind; frames: number };
export interface PostResult {
  id: number;
  chans?: Float32Array[];
  error?: string;
}

/**
 * Lookahead peak limiter (5 ms lookahead, 80 ms release) on planar PCM, in place. Channels are
 * linked. Used after loudness normalisation so transient-rich textures (hammering, clanks) keep
 * their loudness without crossing the class true-peak ceiling. Wraps around for loops so the gain
 * is continuous across the seam.
 */
export function limitPeaks(chans: Float32Array[], sampleRate: number, ceilingDb: number): void {
  const n = chans[0]?.length ?? 0;
  if (!n) return;
  const ceiling = 10 ** (ceilingDb / 20);
  let over = false;
  for (const ch of chans) for (let i = 0; i < n; i++) if (Math.abs(ch[i] as number) > ceiling) over = true;
  if (!over) return;
  const look = Math.max(1, Math.round(0.005 * sampleRate));
  const rel = Math.exp(-1 / (0.08 * sampleRate));
  // required gain per sample (linked across channels)
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of chans) peak = Math.max(peak, Math.abs(ch[i] as number));
    need[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // 1) centred min filter over ±look (monotonic deque, wrapping) — never above what any nearby peak needs
  const at = (k: number) => need[((k % n) + n) % n] as number;
  const W = 2 * look + 1;
  const mn = new Float32Array(n);
  const dq = new Int32Array(n + W);
  let head = 0;
  let tail = 0;
  for (let j = -look - look; j < n + look; j++) {
    const v = at(j);
    while (tail > head && at(dq[tail - 1] as number) >= v) tail--;
    dq[tail++] = j;
    while ((dq[head] as number) <= j - W) head++;
    const centre = j - look;
    if (centre >= 0 && centre < n) mn[centre] = at(dq[head] as number);
  }
  // 2) box average over ±look/2: a smooth attack ramp that still stays ≤ the need at every peak
  const half = Math.max(1, look >> 1);
  const cum = new Float64Array(n + 2 * half + 1);
  for (let k = 0; k < n + 2 * half; k++) cum[k + 1] = (cum[k] as number) + (mn[(((k - half) % n) + n) % n] as number);
  // 3) exponential release; two passes so the state is continuous across the loop wrap
  const gain = new Float32Array(n);
  let g = 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const avg = ((cum[i + 2 * half + 1] as number) - (cum[i] as number)) / (2 * half + 1);
      g = Math.min(avg, g + (1 - g) * (1 - rel));
      if (pass === 1) gain[i] = g;
    }
  }
  for (const ch of chans) for (let i = 0; i < n; i++) ch[i] = (ch[i] as number) * (gain[i] as number);
}

/**
 * Seamless loop from a render of `body + xf` frames: drop the first `xf` frames and crossfade the last
 * `xf` frames of the body with them (equal power), so sample[len−1] flows into sample[0].
 * Output length = body.
 */
export function bakeLoop(chans: Float32Array[], body: number, xf: number): Float32Array[] {
  return chans.map((a) => {
    const out = new Float32Array(body);
    // out[j] = a[xf + j] for the body, last xf frames blended with the head a[0..xf)
    for (let j = 0; j < body - xf; j++) out[j] = a[xf + j] as number;
    for (let i = 0; i < xf; i++) {
      const th = ((i + 0.5) / xf) * (Math.PI / 2);
      out[body - xf + i] = (a[body + i] as number) * Math.cos(th) + (a[i] as number) * Math.sin(th);
    }
    return out;
  });
}

/** Copy planar PCM into an AudioBuffer of the given context. */
export function toAudioBuffer(ctx: BaseAudioContext, pcm: Float32Array[], sampleRate: number): AudioBuffer {
  const buf = ctx.createBuffer(pcm.length, pcm[0]?.length ?? 1, sampleRate);
  pcm.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return buf;
}
