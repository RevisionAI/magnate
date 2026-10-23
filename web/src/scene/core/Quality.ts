// Quality tiers, the GPU tier guess and the runtime frame-time governor.
//
// Tiers follow docs/overhaul/research/art-rendering.md §3.9 / §5.9 / §5.10:
//   LOW    Intel UHD/HD/Iris Plus (the declared 60 fps target): FXAA, no SSAO, bloom only at night, DPR ≤ 1.0
//   MEDIUM Iris Xe, Apple M1, AMD APUs: SMAA, bloom always, DPR ≤ 1.25
//   HIGH   discrete GPUs: + N8AO (Low, half res), 4096 shadow map, DPR ≤ 2.0
//   ULTRA  user-selected only: N8AO Medium full res, SMAA HIGH
// A fifth "minimal" pipeline (software renderers) renders direct with no composer and no shadows.
//
// The governor never trusts GPU timer queries: EXT_disjoint_timer_query_webgl2 returns nothing on ANGLE-Metal/Intel
// whenever an instance buffer is uploaded in the frame (art §1.7). It keeps an EMA of the rAF frame interval and
// walks an ordered list of notches (resolution scale first, then features). Because rAF is vsync-quantised on a
// 60 Hz display (a fast GPU still reports ~16.7 ms), "headroom" cannot be observed there; the governor therefore
// probes one notch up after a long steady period and backs off exponentially if the probe fails.

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high', 'ultra'];

export type AntiAliasing = 'fxaa' | 'smaa-medium' | 'smaa-high';
export type AmbientOcclusion = 'none' | 'n8ao-low-half' | 'n8ao-medium-full';

/** Static per-tier configuration (art §3.9). */
export interface TierSettings {
  readonly tier: Tier;
  /** Device-pixel-ratio cap; the governor scale multiplies it. */
  readonly maxDpr: number;
  /** Lowest resolution scale the governor may reach on this tier. */
  readonly minScale: number;
  readonly shadowMapSize: 1024 | 2048 | 4096;
  /** 'near': trees cast shadows only within 400 m of the camera target (LOW); 'all': every tree casts. */
  readonly treeShadows: 'near' | 'all';
  readonly ao: AmbientOcclusion;
  /** 'night': bloom runs only while the night factor > 0.05 (LOW); 'always' otherwise. */
  readonly bloom: 'night' | 'always';
  /** Resolution scale of the bloom luminance pass + mip chain (0.5 on integrated GPUs: −5 to −7 ms on the UHD 630). */
  readonly bloomScale: 0.5 | 1;
  readonly aa: AntiAliasing;
  /** Optional seasonal LUT grade (reserved; not wired in Wave 1). */
  readonly lut: boolean;
  /** Agent caps (art §5.10, §5.16, §5.17, §5.19) for the dynamic-city workstreams. */
  readonly caps: { readonly vehicles: number; readonly pedestrians: number; readonly particles: number };
}

export const TIER_SETTINGS: Readonly<Record<Tier, TierSettings>> = {
  low: {
    tier: 'low', maxDpr: 1.0, minScale: 0.7, shadowMapSize: 2048, treeShadows: 'near', ao: 'none', bloom: 'night', bloomScale: 0.5,
    aa: 'fxaa', lut: false, caps: { vehicles: 500, pedestrians: 600, particles: 800 },
  },
  medium: {
    tier: 'medium', maxDpr: 1.25, minScale: 0.7, shadowMapSize: 2048, treeShadows: 'all', ao: 'none', bloom: 'always',
    bloomScale: 0.5, aa: 'smaa-medium', lut: true, caps: { vehicles: 900, pedestrians: 1500, particles: 2000 },
  },
  high: {
    tier: 'high', maxDpr: 2.0, minScale: 0.75, shadowMapSize: 4096, treeShadows: 'all', ao: 'n8ao-low-half',
    bloom: 'always', bloomScale: 1, aa: 'smaa-medium', lut: true, caps: { vehicles: 900, pedestrians: 3000, particles: 4000 },
  },
  ultra: {
    tier: 'ultra', maxDpr: 2.0, minScale: 1.0, shadowMapSize: 4096, treeShadows: 'all', ao: 'n8ao-medium-full',
    bloom: 'always', bloomScale: 1, aa: 'smaa-high', lut: true, caps: { vehicles: 900, pedestrians: 3000, particles: 4000 },
  },
};

/** Result of classifying the GPU. `minimal` = software rasteriser: render direct, no composer, no shadows. */
export interface TierGuess {
  tier: Tier;
  minimal: boolean;
  renderer: string;
}

/** Unmasked renderer string (falls back to the masked one; Firefox exposes the real string as RENDERER). */
export function rendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** Classify a renderer string into a tier (art §5.10). Exported separately so it can be unit tested. */
export function classifyRenderer(r: string): TierGuess {
  if (/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i.test(r)) return { tier: 'low', minimal: true, renderer: r };
  // Intel Gen9-Gen11 integrated graphics: the declared target (UHD 630) and everything weaker.
  if (/Intel.*(UHD|HD Graphics|Iris\(TM\) Plus|Iris\(R\) Plus|Iris Plus|Iris Pro|Iris\(TM\) Graphics [56]\d\d)/i.test(r)) {
    return { tier: 'low', minimal: false, renderer: r };
  }
  if (/Intel.*(Iris.*Xe|Arc)|Radeon\(TM\) (Graphics|Vega)|Radeon Vega|Radeon.*Graphics(?! \d)|Apple M1(?! (Pro|Max|Ultra))|Apple GPU|Mali|Adreno|PowerVR/i.test(r)) {
    return { tier: 'medium', minimal: false, renderer: r };
  }
  return { tier: 'high', minimal: false, renderer: r };   // discrete NVIDIA/AMD, Apple M-Pro/Max and newer, …
}

export function guessTier(gl: WebGLRenderingContext | WebGL2RenderingContext): TierGuess {
  return classifyRenderer(rendererString(gl));
}

// ---------------------------------------------------------------------------------------------------------------------
// Live knobs: what the modules actually read. Tier settings + user settings + governor notches.

/** Knobs other modules read every frame (`ctx.quality.knobs`). Values only change at governor steps or settings. */
export interface QualityKnobs {
  /** Render resolution scale multiplying the tier DPR cap (0.5–1.0). */
  resolutionScale: number;
  /** False = bloom disabled (governor notch, or the LOW day pipeline). */
  bloom: boolean;
  /** True = shadows enabled at all (user setting). */
  shadows: boolean;
  /** True = trees may cast shadows (LOW: only within `treeShadowRadius` of the target). */
  treeShadows: boolean;
  /** Radius (m) around the camera target inside which trees cast shadows; Infinity = everywhere. */
  treeShadowRadius: number;
  shadowMapSize: 1024 | 2048 | 4096;
  /** Camera distance (m) beyond which trees switch to their 8-triangle LOD1 model. */
  treeLod1Distance: number;
  /** Multiplier for ambient agent counts (pedestrians, ambient traffic). */
  agentDensity: number;
}

/** One governor notch: the knob values it overrides (art §5.10, in order). */
export interface GovernorStep {
  readonly label: string;
  readonly apply: (k: QualityKnobs) => void;
}

const RESOLUTION_STEPS = [0.9, 0.8, 0.7] as const;

/** Ordered notches for a tier (resolution steps below the tier's floor are skipped). */
export function governorSteps(settings: TierSettings): GovernorStep[] {
  const steps: GovernorStep[] = [];
  for (const s of RESOLUTION_STEPS) {
    if (s >= settings.minScale - 1e-6) steps.push({ label: `resolution ${Math.round(s * 100)}%`, apply: (k) => { k.resolutionScale = Math.min(k.resolutionScale, s); } });
  }
  steps.push({
    label: settings.tier === 'low' ? 'night bloom off, tree shadows off' : 'bloom off, tree shadows off',
    apply: (k) => { k.bloom = false; k.treeShadows = false; },
  });
  steps.push({ label: 'shadow map 1024', apply: (k) => { k.shadowMapSize = 1024; } });
  steps.push({ label: 'tree LOD1 at 600 m', apply: (k) => { k.treeLod1Distance = Math.min(k.treeLod1Distance, 600); } });
  steps.push({ label: 'agents ×0.5', apply: (k) => { k.agentDensity *= 0.5; } });
  return steps;
}

/** User-facing graphics settings (UX §6.18 "Graphics"). Undefined fields keep their defaults. */
export interface GraphicsSettings {
  /** 'auto' = guess + governor. */
  preset?: Tier | 'auto';
  shadows?: boolean;
  /** Ambient agent density 0–1. */
  agentDensity?: number;
  /** Fixed resolution scale 0.5–1.0, or 'auto' (governor-driven). */
  resolutionScale?: number | 'auto';
  /** Frame-rate cap: 0 = uncapped (vsync), 30 = skip alternate frames. */
  fpsCap?: 0 | 30;
}

/** Base knobs for a tier before the governor applies any notch. */
export function baseKnobs(settings: TierSettings, user: GraphicsSettings = {}): QualityKnobs {
  const fixedScale = typeof user.resolutionScale === 'number' ? Math.min(1, Math.max(0.5, user.resolutionScale)) : 1;
  return {
    resolutionScale: fixedScale,
    bloom: true,
    shadows: user.shadows ?? true,
    treeShadows: true,
    treeShadowRadius: settings.treeShadows === 'near' ? 400 : Infinity,
    shadowMapSize: settings.shadowMapSize,
    treeLod1Distance: 900,
    agentDensity: Math.min(1, Math.max(0, user.agentDensity ?? 1)),
  };
}

/** Knobs at a governor level (0 = no notch applied). */
export function knobsAtLevel(settings: TierSettings, level: number, user: GraphicsSettings = {}): QualityKnobs {
  const k = baseKnobs(settings, user);
  const steps = governorSteps(settings);
  const fixedScale = typeof user.resolutionScale === 'number';
  for (let i = 0; i < Math.min(level, steps.length); i++) {
    const before = k.resolutionScale;
    steps[i].apply(k);
    if (fixedScale) k.resolutionScale = before;      // the user pinned the resolution: skip scale notches' effect
  }
  return k;
}

// ---------------------------------------------------------------------------------------------------------------------
// FrameGovernor

export interface GovernorOptions {
  /** EMA above this (ms) for `slowHoldMs` steps down (art: 18 ms for 3 s). */
  slowMs?: number;
  slowHoldMs?: number;
  /** EMA below this (ms) for `fastHoldMs` steps up when the display is faster than 60 Hz (art: 12 ms for 5 s). */
  fastMs?: number;
  fastHoldMs?: number;
  /** EMA at or below this counts as "keeping up with a 60 Hz display" (probe-up candidate). */
  steadyMs?: number;
  /** Initial wait before a probe-up on a vsync-bound display; doubles after each failed probe (cap `maxProbeWaitMs`). */
  probeWaitMs?: number;
  maxProbeWaitMs?: number;
  /** A probe that pushes the EMA above `slowMs` within this window is reverted immediately. */
  probeWindowMs?: number;
  /** Quiet period after any step (art: 10 s). */
  cooldownMs?: number;
  /** Samples are ignored for this long after `reset()` (shader compiles, resizes). */
  settleMs?: number;
}

/**
 * Frame-time governor (art §5.10): EMA (α = 0.05) of the rAF interval; step down one notch after 3 s above 18 ms;
 * step up after 5 s below 12 ms; 10 s cooldown after a step so it never oscillates. On vsync-bound displays it probes
 * up after a steady period instead, reverting at once (and backing off ×2) when the probe makes frames slow again.
 */
export class FrameGovernor {
  /** Current notch (0 = full quality). */
  level = 0;
  /** Smoothed frame interval (ms). */
  ema = 16.7;
  private readonly o: Required<GovernorOptions>;
  private overSince = -1;
  private underSince = -1;
  private steadySince = -1;
  private cooldownUntil = 0;
  private settleUntil = 0;
  private probeWait: number;
  private probeUntil = -1;           // > 0 while a probe is on trial
  private lastNow = -1;

  constructor(readonly maxLevel: number, private readonly onChange: (level: number, reason: string) => void, options: GovernorOptions = {}) {
    this.o = {
      slowMs: options.slowMs ?? 18,
      slowHoldMs: options.slowHoldMs ?? 3000,
      fastMs: options.fastMs ?? 12,
      fastHoldMs: options.fastHoldMs ?? 5000,
      steadyMs: options.steadyMs ?? 17.4,
      probeWaitMs: options.probeWaitMs ?? 8000,
      maxProbeWaitMs: options.maxProbeWaitMs ?? 120000,
      probeWindowMs: options.probeWindowMs ?? 4000,
      cooldownMs: options.cooldownMs ?? 10000,
      settleMs: options.settleMs ?? 2000,
    };
    this.probeWait = this.o.probeWaitMs;
  }

  /** Forget timing history (call after tier switches, resizes, city loads). */
  reset(nowMs: number): void {
    this.overSince = this.underSince = this.steadySince = -1;
    this.settleUntil = nowMs + this.o.settleMs;
    this.probeUntil = -1;
    this.ema = 16.7;
  }

  /** Force a level (e.g. user picked a preset); does not start a cooldown. */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(this.maxLevel, Math.round(level)));
  }

  /**
   * Feed one frame. `frameMs` is the rAF interval. Returns true when the level changed.
   * Call it only for frames that were actually rendered.
   */
  tick(nowMs: number, frameMs: number): boolean {
    const o = this.o;
    if (this.lastNow >= 0 && nowMs - this.lastNow > 1000) this.reset(nowMs);   // tab was hidden / long stall
    this.lastNow = nowMs;
    if (nowMs < this.settleUntil) return false;
    this.ema += (Math.min(Math.max(frameMs, 0), 100) - this.ema) * 0.05;

    // A probe on trial that made frames slow is reverted immediately (no cooldown wait).
    if (this.probeUntil > 0) {
      if (this.ema > o.slowMs) {
        this.probeUntil = -1;
        this.probeWait = Math.min(o.maxProbeWaitMs, this.probeWait * 2);
        return this.step(+1, nowMs, 'probe failed');
      }
      if (nowMs >= this.probeUntil) { this.probeUntil = -1; this.probeWait = o.probeWaitMs; }
    }
    if (nowMs < this.cooldownUntil) return false;

    if (this.ema > o.slowMs) {
      if (this.overSince < 0) this.overSince = nowMs;
      this.underSince = this.steadySince = -1;
    } else {
      this.overSince = -1;
      if (this.ema < o.fastMs) { if (this.underSince < 0) this.underSince = nowMs; } else this.underSince = -1;
      if (this.ema <= o.steadyMs) { if (this.steadySince < 0) this.steadySince = nowMs; } else this.steadySince = -1;
    }

    if (this.overSince >= 0 && nowMs - this.overSince > o.slowHoldMs && this.level < this.maxLevel) {
      return this.step(+1, nowMs, `frame time ${this.ema.toFixed(1)} ms > ${o.slowMs} ms`);
    }
    if (this.level > 0) {
      if (this.underSince >= 0 && nowMs - this.underSince > o.fastHoldMs) return this.step(-1, nowMs, `frame time ${this.ema.toFixed(1)} ms < ${o.fastMs} ms`);
      if (this.steadySince >= 0 && nowMs - this.steadySince > this.probeWait) {
        const changed = this.step(-1, nowMs, 'probe up (vsync-bound, steady)');
        this.probeUntil = nowMs + o.probeWindowMs;
        this.cooldownUntil = 0;            // the probe window replaces the cooldown
        return changed;
      }
    }
    return false;
  }

  private step(dir: 1 | -1, nowMs: number, reason: string): boolean {
    const next = Math.max(0, Math.min(this.maxLevel, this.level + dir));
    this.overSince = this.underSince = this.steadySince = -1;
    this.cooldownUntil = nowMs + this.o.cooldownMs;
    if (next === this.level) return false;
    this.level = next;
    this.ema = Math.min(this.ema, this.o.slowMs);   // give the new level a fair start
    this.onChange(next, reason);
    return true;
  }
}
