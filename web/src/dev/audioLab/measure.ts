// Offline level measurement for the AudioLab and tools/audio/recipe-levels.mjs (audio-plan §4.14):
// every procedural recipe is rendered in an OfflineAudioContext at 48 kHz through the same trim +
// peak-guard chain it plays through live, and measured with the BS.1770 meter (K-weighting, 400 ms
// momentary max) against its class target and peak ceiling. Non-positional cues are measured
// dual-mono (a mono voice played on both speakers, +3 dB), world one-shots single-channel (they play
// through an equal-power panner).

import { ALL_RECIPES, CLASS_TARGETS, PEAK_LIMITED, RECIPE_TRIM_DB, recipeVoiceInput } from '@/audio/sfx/catalog';
import { Synth } from '@/audio/synth/primitives';
import { measureLoudness } from '@/audio/synth/loudness';
import { BEDS, LOOPS } from '@/audio/synth/beds';
import { renderPcm } from '@/audio/synth/render';
import { pressureLayer, defeatCue, DEFEAT_CUE_SECONDS } from '@/audio/synth/music';
import type { RecipeParams, SfxClass } from '@/audio/synth/recipes';

const SR = 48000;

export interface RecipeLevel {
  id: string;
  cls: SfxClass;
  origin: string;
  target: number;
  peakCeiling: number;
  trimDb: number;
  /** Momentary max (LUFS) with the trim applied (mean over repeats). */
  mMax: number;
  /** Untrimmed momentary max (LUFS). */
  rawMMax: number;
  samplePeak: number;
  truePeak: number;
  /** Seconds until the render decays below −60 dBFS for good. */
  activeSec: number;
  declaredSec: number;
  nonFinite: number;
  /**
   * 'loudness' = M-max on its class target; 'peak' = a transient too short for the 400 ms momentary
   * window to reach the target under the class peak ceiling, so the calibration holds it at the ceiling.
   */
  bound: 'loudness' | 'peak';
  pass: boolean;
  issues: string[];
}

export interface MeasureOptions {
  /** Override trims (dB) instead of the compiled calibration table. */
  trims?: Record<string, number>;
  /** Override the peak-limited set (ids held at their ceiling) instead of the compiled calibration. */
  peakLimited?: string[];
  /** Renders per recipe (randomised recipes are averaged; the peak is the max over the renders). */
  repeats?: number;
  ids?: string[];
  params?: Record<string, RecipeParams>;
  /** Route through the class peak guard like live playback (default true; calibration measures raw). */
  guard?: boolean;
}

/** Render one recipe (mono, 48 kHz) through its live trim + peak-guard chain and return the samples. */
export async function renderRecipe(id: string, trimDb: number, params: RecipeParams = {}, guard = true): Promise<Float32Array> {
  const def = ALL_RECIPES[id];
  if (!def) throw new Error(`unknown recipe ${id}`);
  const seconds = Math.max(1.5, def.dur * 1.6 + 3.5);
  const off = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const input = recipeVoiceInput(off, id, off.destination, { trimDb, guard });
  const s = new Synth(off, input, 0.05, def.cents?.(params) ?? 0);
  def.fn(s, params);
  const buf = await off.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

function activeSeconds(x: Float32Array): number {
  const thr = 10 ** (-60 / 20);
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i] as number) > thr) return Math.max(0, i / SR - 0.05);
  return 0;
}

export async function measureRecipes(opts: MeasureOptions = {}): Promise<RecipeLevel[]> {
  const ids = opts.ids ?? Object.keys(ALL_RECIPES);
  const repeats = Math.max(1, opts.repeats ?? 3);
  const limited = opts.peakLimited ? new Set(opts.peakLimited) : PEAK_LIMITED;
  const out: RecipeLevel[] = [];
  for (const id of ids) {
    const def = ALL_RECIPES[id];
    if (!def) continue;
    const tgt = CLASS_TARGETS[def.cls];
    const trim = opts.trims?.[id] ?? RECIPE_TRIM_DB[id] ?? 0;
    const dual = def.cls !== 'world';
    let mSum = 0;
    let rawSum = 0;
    let sp = -Infinity;
    let tp = -Infinity;
    let act = 0;
    let nonFinite = 0;
    for (let r = 0; r < repeats; r++) {
      const x = await renderRecipe(id, trim, opts.params?.[id] ?? {}, opts.guard ?? true);
      const lo = measureLoudness([x], SR, { dualMono: dual });
      mSum += lo.momentaryMax;
      rawSum += lo.momentaryMax - trim;
      sp = Math.max(sp, lo.samplePeak);
      tp = Math.max(tp, lo.truePeak);
      act = Math.max(act, activeSeconds(x));
      nonFinite += lo.nonFinite;
    }
    const mMax = mSum / repeats;
    const issues: string[] = [];
    // A transient much shorter than the 400 ms momentary window cannot reach its class M-max without
    // crossing the class peak ceiling; the calibration flags those and holds them at the ceiling. They
    // must still not exceed the target, and must not be near-silent (a broken recipe). Longer sounds get
    // no such pass: if one cannot reach its target, its recipe's crest factor needs fixing.
    const peakBound = limited.has(id) && def.dur < TRANSIENT_SEC;
    if (!Number.isFinite(mMax)) issues.push('silent');
    else if (peakBound) {
      if (mMax > tgt.mMax + 2) issues.push(`M-max ${mMax.toFixed(1)} above ${tgt.mMax}+2`);
      if (mMax < tgt.mMax - PEAK_BOUND_MAX_SHORTFALL_DB) issues.push(`M-max ${mMax.toFixed(1)} too quiet even for a transient`);
    } else if (Math.abs(mMax - tgt.mMax) > 2) issues.push(`M-max ${mMax.toFixed(1)} vs ${tgt.mMax}±2`);
    if (sp > tgt.peak + 0.05) issues.push(`peak ${sp.toFixed(1)} > ${tgt.peak}`);
    if (nonFinite > 0) issues.push(`${nonFinite} non-finite samples`);
    if (act > def.dur * 1.25 + 1.0) issues.push(`rings ${act.toFixed(2)} s (declared ${def.dur} s)`);
    out.push({
      id,
      cls: def.cls,
      origin: def.origin,
      target: tgt.mMax,
      peakCeiling: tgt.peak,
      trimDb: Math.round(trim * 100) / 100,
      mMax: Math.round(mMax * 100) / 100,
      rawMMax: Math.round((rawSum / repeats) * 100) / 100,
      samplePeak: Math.round(sp * 100) / 100,
      truePeak: Math.round(tp * 100) / 100,
      activeSec: Math.round(act * 100) / 100,
      declaredSec: def.dur,
      nonFinite,
      bound: peakBound ? 'peak' : 'loudness',
      pass: issues.length === 0,
      issues,
    });
  }
  return out;
}

/** A peak-bound transient may sit at most this far under its class M-max target. */
export const PEAK_BOUND_MAX_SHORTFALL_DB = 12;

/** Sounds shorter than the 400 ms momentary window are "transients" (may be peak-bound). */
export const TRANSIENT_SEC = 0.4;

/** Transients: margin (dB) kept under the ceiling for the loudest of the calibration renders. */
export const CALIBRATION_PEAK_MARGIN_DB = 0.5;

/**
 * Longer sounds: how far (dB) the loudest calibration render may reach *over* the ceiling before the
 * peak guard. The guard's soft shoulder (knee −3.1 dB) brings such a peak back under the ceiling with
 * ≈ 1–2 dB of gain reduction on a few samples; typical renders peak 2–3 dB lower and are untouched.
 */
export const GUARD_ALLOWANCE_DB = 1.5;

/**
 * Trim that lands the recipe on its class target within its peak budget. `level` comes from an
 * unguarded raw measurement: `samplePeak` is the max over many renders, `rawMMax` the mean. Transients
 * stay clean under the ceiling (they become "peak-bound" when the target is out of reach); longer
 * sounds may lean on the peak guard by up to GUARD_ALLOWANCE_DB. Returns the trim and whether the peak
 * budget limited it.
 */
export function calibrate(
  level: Pick<RecipeLevel, 'rawMMax' | 'target' | 'peakCeiling' | 'samplePeak' | 'trimDb' | 'declaredSec'>,
): { trim: number; peakLimited: boolean } {
  const want = level.target - level.rawMMax;
  const rawPeak = level.samplePeak - level.trimDb;
  const budget = level.declaredSec < TRANSIENT_SEC ? -CALIBRATION_PEAK_MARGIN_DB : GUARD_ALLOWANCE_DB;
  const maxByPeak = level.peakCeiling + budget - rawPeak;
  return want <= maxByPeak ? { trim: round2(want), peakLimited: false } : { trim: round2(maxByPeak), peakLimited: true };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface LoopLevel {
  id: string;
  kind: 'bed' | 'loop3d' | 'layer' | 'cue';
  seconds: number;
  channels: number;
  target: number;
  lufsI: number;
  truePeak: number;
  tpCeiling: number;
  /** Sample jump at the loop wrap vs the 99th percentile of normal sample-to-sample motion. */
  wrapJump: number;
  wrapP99: number;
  renderMs: number;
  pass: boolean;
  issues: string[];
}

function wrapStats(ch: Float32Array): { jump: number; p99: number } {
  const n = ch.length;
  const jump = Math.abs((ch[0] as number) - (ch[n - 1] as number));
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(n, 48000); i++) diffs.push(Math.abs((ch[i] as number) - (ch[i - 1] as number)));
  diffs.sort((a, b) => a - b);
  return { jump, p99: diffs[Math.floor(diffs.length * 0.99)] ?? 0 };
}

/** Render every procedural bed / positional loop / music layer and check loudness, peak and seam. */
export async function measureLoops(ids?: string[]): Promise<LoopLevel[]> {
  const jobs: { id: string; kind: LoopLevel['kind']; seconds: number; channels: 1 | 2; target: number; tp: number; build: Parameters<typeof renderPcm>[0]; seam: number; rate: number }[] = [];
  for (const [id, d] of Object.entries(BEDS)) jobs.push({ id, kind: 'bed', seconds: d.seconds, channels: d.channels, target: d.lufs, tp: -6, build: d.build, seam: 1, rate: 32000 });
  for (const [id, d] of Object.entries(LOOPS)) jobs.push({ id, kind: 'loop3d', seconds: d.seconds, channels: d.channels, target: d.lufs, tp: -6, build: d.build, seam: 1, rate: 32000 });
  jobs.push({ id: 'layer.pressure', kind: 'layer', seconds: 20, channels: 2, target: -20, tp: -1.5, build: pressureLayer, seam: 2, rate: 32000 });
  jobs.push({ id: 'music.defeat', kind: 'cue', seconds: DEFEAT_CUE_SECONDS, channels: 2, target: -20, tp: -1.5, build: defeatCue, seam: 0, rate: 48000 });
  const out: LoopLevel[] = [];
  for (const j of jobs) {
    if (ids && !ids.includes(j.id)) continue;
    const t0 = performance.now();
    const pcm = await renderPcm(j.build, { seconds: j.seconds, channels: j.channels, sampleRate: j.rate, targetLufs: j.target, loopSeam: j.seam || undefined });
    const renderMs = Math.round(performance.now() - t0);
    const lo = measureLoudness(pcm, j.rate);
    const w = wrapStats(pcm[0] as Float32Array);
    const issues: string[] = [];
    if (Math.abs(lo.integrated - j.target) > 1) issues.push(`LUFS-I ${lo.integrated.toFixed(1)} vs ${j.target}`);
    if (lo.truePeak > j.tp) issues.push(`true peak ${lo.truePeak.toFixed(1)} > ${j.tp}`);
    if (j.seam && w.jump > Math.max(w.p99 * 1.5, 0.002)) issues.push(`wrap jump ${w.jump.toFixed(4)} > 1.5 × p99 ${w.p99.toFixed(4)}`);
    if (lo.nonFinite) issues.push('non-finite samples');
    out.push({
      id: j.id,
      kind: j.kind,
      seconds: j.seconds,
      channels: j.channels,
      target: j.target,
      lufsI: round2(lo.integrated),
      truePeak: round2(lo.truePeak),
      tpCeiling: j.tp,
      wrapJump: Math.round(w.jump * 10000) / 10000,
      wrapP99: Math.round(w.p99 * 10000) / 10000,
      renderMs,
      pass: issues.length === 0,
      issues,
    });
  }
  return out;
}
