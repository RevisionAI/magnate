// Advisor / news-anchor voice queue (audio-plan §4.11). Pure scheduling logic: the clock, timers and
// the actual playback are injected, so every rule is unit-testable without an AudioContext.
//
//  * one line (or atomic chain) at a time; advisor and anchor share the channel
//  * priorities P0 critical · P1 important · P2 informative · P3 hints/flavour
//  * advisor frequency: off → subtitles only; important → P0, P1 + tutorial; all → P0–P3
//  * ≤ 1 line per month close, ranked P0 > goal > rival > opportunity; a second P0 only for scenario end
//  * TTL P0 30 s · P1 20 s · P2 12 s · P3 6 s; min silence since the last line P0 0 · P1 3 · P2 8 · P3 20 s
//  * token bucket: capacity 6, +1 per 20 s, cost P0 0 · P1 1 · P2 2 · P3 3
//  * queue ≤ 4 (overflow drops the lowest priority, newest first)
//  * P0 pre-empts a playing P2/P3 (150 ms fade); P1 pre-empts P3
//  * at 4×/8× only P0–P1 are voiced; P2/P3 become subtitle toasts
//  * hints (P3): ≤ 1 per 3 min, and never within 90 s of another line
//  * once-per-game latches (client side until the bridge persists EventDetector latches)

import type { AdvisorFrequency } from '../settings';

export type Priority = 0 | 1 | 2 | 3;

export interface VoiceLine {
  id: string;
  /** Subtitle text (the words actually spoken by the take, when one exists). */
  text: string;
  voice: 'advisor' | 'anchor';
  priority: Priority;
  /** Tutorial lines play even when advisor frequency is "important" (P1·T). */
  tutorial?: boolean;
  /** Real-time cooldown per line (ms). */
  cooldownMs?: number;
  oncePerGame?: boolean;
  /** Asset id of the recorded take, if any (otherwise subtitle-only). */
  take?: string;
  /** Seconds of the take (manifest), when known. */
  durationSec?: number;
}

export interface VoiceRequestOptions {
  /** Raised by a month close: subject to the one-line-per-close budget. */
  fromClose?: boolean;
  /** Ranking inside a close: 0 goal, 1 rival, 2 opportunity, 3 other (P0 always first). */
  rank?: number;
  /** Scenario end: may be the second P0 line of a close. */
  scenarioEnd?: boolean;
  /** P3 hint rules apply. */
  hint?: boolean;
  /** Override the line's priority (e.g. news Major → P1). */
  priority?: Priority;
  /** Tutorial request (P1·T): voiced at advisor frequency "important" whatever the line's flag. */
  tutorial?: boolean;
}

export interface SubtitleEvent {
  id: string;
  text: string;
  voice: 'advisor' | 'anchor';
  priority: Priority;
  /** Seconds the subtitle should stay up: max(duration + 1, 3). */
  showSec: number;
  /** False when only the toast is shown (no take, advisor off, fast speed, …). */
  voiced: boolean;
  /** Seconds from now until the line is heard (chains, news sting). */
  delaySec: number;
  /** Seconds of speech (0 when not voiced). */
  durationSec: number;
  /** Why a line was not voiced (toast only): see VoiceOutcome. */
  reason?: VoiceSkipReason;
}

/** Why a requested line was not voiced. */
export type VoiceSkipReason =
  | 'advisorOff' // advisor frequency setting filters it (subtitle still shown)
  | 'fastSpeed' // 4×/8×: P2/P3 become toasts
  | 'hintRules' // P3 hint spacing
  | 'noTake' // no recorded take (held line / manifest missing)
  | 'closeBudget' // ≤ 1 line per month close
  | 'queueFull'
  | 'expired' // TTL passed before it could start
  | 'locked' // audio not unlocked yet (P2/P3)
  | 'playFailed'
  | 'latched' // once-per-game line already surfaced (dropped, no toast)
  | 'cooldown'; // same line/chain too recently (dropped, no toast)

/** Decision trace (debug overlay / e2e): one record per request outcome. */
export interface VoiceTraceEvent {
  action: 'queue' | 'play' | 'toast' | 'drop' | 'interrupt' | 'end';
  key: string;
  p: Priority;
  reason?: VoiceSkipReason;
}

export interface PlaybackHandle {
  /** Seconds of audio, chain gaps included. */
  duration: number;
  /** Per-line durations (for subtitles). */
  lineDurations: number[];
  /** Per-line start offsets from now, in seconds. */
  startOffsets: number[];
  stop(fadeSec: number): void;
}

export interface VoiceQueueDeps {
  now(): number; // ms
  schedule(fn: () => void, ms: number): void;
  settings(): { advisor: AdvisorFrequency };
  /** True at 4× / 8×. */
  fast(): boolean;
  /** False while audio is locked (before the first gesture). */
  canPlay(): boolean;
  line(id: string): VoiceLine | undefined;
  /** Start the chain; resolve null if it cannot play (missing take, decode failure). */
  play(lines: VoiceLine[], onEnded: () => void): Promise<PlaybackHandle | null>;
  subtitle(ev: SubtitleEvent): void;
  /** Optional decision trace. */
  trace?(ev: VoiceTraceEvent): void;
}

interface Req {
  lines: VoiceLine[];
  p: Priority;
  at: number;
  key: string;
  fromClose: boolean;
  rank: number;
  scenarioEnd: boolean;
  hint: boolean;
  tutorial: boolean;
  seq: number;
}

export const TTL_MS: readonly number[] = [30_000, 20_000, 12_000, 6_000];
export const GAP_MS: readonly number[] = [0, 3_000, 8_000, 20_000];
export const COST: readonly number[] = [0, 1, 2, 3];
export const BUCKET = { capacity: 6, refillMs: 20_000 } as const;
export const QUEUE_MAX = 4;
export const HINT = { minGapMs: 180_000, quietMs: 90_000 } as const;
const DEFAULT_COOLDOWN_MS = 10 * 60_000;

export class VoiceQueue {
  private q: Req[] = [];
  private playing: { r: Req; handle: PlaybackHandle | null; startedAt: number } | null = null;
  private starting = false;
  private lastEnd = -1e12;
  private lastHintAt = -1e12;
  private tokens: number = BUCKET.capacity;
  private refillAt: number;
  private closeBudget = 1;
  private closeP0Used = false;
  private batch: Req[] | null = null;
  private readonly lastByKey = new Map<string, number>();
  private readonly latched = new Set<string>();
  private seq = 0;
  private pumpScheduled = false;

  constructor(private readonly deps: VoiceQueueDeps) {
    this.refillAt = deps.now();
  }

  /** Snapshot for the AudioLab / tests. */
  get state() {
    return {
      queued: this.q.map((r) => ({ key: r.key, p: r.p })),
      playing: this.playing ? { key: this.playing.r.key, p: this.playing.r.p } : null,
      tokens: Math.round(this.currentTokens() * 100) / 100,
      closeBudget: this.closeBudget,
    };
  }

  /** A new month close: reset the one-line budget. */
  onMonthClose(): void {
    this.closeBudget = 1;
    this.closeP0Used = false;
  }

  /** Collect requests raised while one tick's events are routed, then keep only the best. */
  beginCloseBatch(): void {
    this.onMonthClose();
    this.batch = [];
  }

  endCloseBatch(): void {
    const batch = this.batch ?? [];
    this.batch = null;
    if (!batch.length) return;
    batch.sort((a, b) => a.p - b.p || a.rank - b.rank || a.seq - b.seq);
    const winners: Req[] = [];
    for (const r of batch) {
      if (winners.length === 0) winners.push(r);
      else if (r.p === 0 && r.scenarioEnd && !winners.some((w) => w.scenarioEnd)) winners.push(r);
    }
    for (const r of batch) if (!winners.includes(r)) this.toast(r, 'closeBudget');
    for (const r of winners) this.enqueue(r);
  }

  /** New game / load: clear latches and the queue. */
  resetGame(): void {
    this.latched.clear();
    this.clear();
  }

  clear(): void {
    this.q = [];
    if (this.playing) this.interrupt(0.15);
  }

  /**
   * Request a line or an atomic chain (e.g. news_sting is played by the caller, then
   * ['news.recession', 'adv.macro.recession']). Returns false when it was turned into a toast or dropped.
   */
  request(ids: string | string[], opts: VoiceRequestOptions = {}): boolean {
    const lines = (Array.isArray(ids) ? ids : [ids]).map((id) => this.deps.line(id)).filter((l): l is VoiceLine => !!l);
    if (!lines.length) return false;
    const p = (opts.priority ?? (Math.min(...lines.map((l) => l.priority)) as Priority)) as Priority;
    const key = lines.map((l) => l.id).join('>');
    const r: Req = {
      lines,
      p,
      at: this.deps.now(),
      key,
      fromClose: !!opts.fromClose,
      rank: opts.rank ?? 3,
      scenarioEnd: !!opts.scenarioEnd,
      hint: !!opts.hint,
      tutorial: !!opts.tutorial,
      seq: this.seq++,
    };
    if (lines.some((l) => l.oncePerGame && this.latched.has(l.id))) return this.drop(r, 'latched');
    const cooldown = Math.max(...lines.map((l) => l.cooldownMs ?? DEFAULT_COOLDOWN_MS));
    if (r.at - (this.lastByKey.get(key) ?? -1e12) < cooldown) return this.drop(r, 'cooldown');
    const blocked = this.voiceBlocked(r) ?? (lines.some((l) => l.take) ? null : 'noTake');
    if (blocked) {
      // advisor off / fast speed / hint rules / no recorded take: the subtitle toast still appears
      this.toast(r, blocked);
      return false;
    }
    if (r.fromClose && this.batch) {
      this.batch.push(r);
      return true;
    }
    return this.enqueue(r);
  }

  /** Re-run scheduling (call when audio unlocks or the speed drops). */
  pump(): void {
    void this.pumpAsync();
  }

  // ---------------------------------------------------------------------------------------------

  /** Null when the request may be voiced, else why not. */
  private voiceBlocked(r: Req): VoiceSkipReason | null {
    const adv = this.deps.settings().advisor;
    const tutorial = r.tutorial || r.lines.some((l) => l.tutorial);
    const freqOk = adv === 'all' || (adv === 'important' && (r.p <= 1 || tutorial));
    if (!freqOk) return 'advisorOff';
    if (this.deps.fast() && r.p >= 2 && !r.tutorial) return 'fastSpeed'; // tutorial lines rank as P1·T
    if (r.hint) {
      const now = this.deps.now();
      if (now - this.lastHintAt < HINT.minGapMs || now - this.lastEnd < HINT.quietMs || this.playing) return 'hintRules';
    }
    return null;
  }

  private drop(r: Req, reason: VoiceSkipReason): false {
    this.deps.trace?.({ action: 'drop', key: r.key, p: r.p, reason });
    return false;
  }

  private enqueue(r: Req): boolean {
    if (r.fromClose && r.p > 0) {
      if (this.closeBudget <= 0) {
        this.toast(r, 'closeBudget');
        return false;
      }
      this.closeBudget -= 1;
    } else if (r.fromClose && r.p === 0) {
      if (this.closeP0Used && !r.scenarioEnd) {
        this.toast(r, 'closeBudget');
        return false;
      }
      this.closeP0Used = true;
      this.closeBudget = 0;
    }
    if (this.playing) {
      const cur = this.playing.r.p;
      if ((r.p === 0 && cur >= 2) || (r.p === 1 && cur === 3)) this.interrupt(0.15);
    }
    this.q.push(r);
    this.deps.trace?.({ action: 'queue', key: r.key, p: r.p });
    this.q.sort((a, b) => a.p - b.p || a.at - b.at);
    while (this.q.length > QUEUE_MAX) {
      // drop the lowest priority, newest first
      let worst = 0;
      for (let i = 1; i < this.q.length; i++) {
        const a = this.q[i] as Req;
        const w = this.q[worst] as Req;
        if (a.p > w.p || (a.p === w.p && a.at >= w.at)) worst = i;
      }
      const [dropped] = this.q.splice(worst, 1);
      if (dropped === r) {
        this.toast(r, 'queueFull');
        return false;
      }
      if (dropped) this.toast(dropped, 'queueFull');
    }
    this.pump();
    return true;
  }

  private currentTokens(): number {
    const now = this.deps.now();
    return Math.min(BUCKET.capacity, this.tokens + (now - this.refillAt) / BUCKET.refillMs);
  }

  private async pumpAsync(): Promise<void> {
    if (this.playing || this.starting) return;
    const now = this.deps.now();
    this.tokens = this.currentTokens();
    this.refillAt = now;
    // TTL: expired requests become toasts
    const alive: Req[] = [];
    for (const r of this.q) {
      if (now - r.at < (TTL_MS[r.p] as number)) alive.push(r);
      else this.toast(r, 'expired');
    }
    this.q = alive;
    if (!this.q.length) return;
    if (!this.deps.canPlay()) {
      // locked audio: keep P0/P1 (their TTL keeps running), drop the rest to toasts
      this.q = this.q.filter((r) => {
        if (r.p <= 1) return true;
        this.toast(r, 'locked');
        return false;
      });
      this.later(500);
      return;
    }
    const r = this.q.find((x) => now - this.lastEnd >= (GAP_MS[x.p] as number) && this.tokens >= (COST[x.p] as number));
    if (!r) {
      this.later(250);
      return;
    }
    this.q.splice(this.q.indexOf(r), 1);
    this.tokens -= COST[r.p] as number;
    this.lastByKey.set(r.key, now);
    for (const l of r.lines) if (l.oncePerGame) this.latched.add(l.id);
    if (r.hint) this.lastHintAt = now;
    this.starting = true;
    const entry = { r, handle: null as PlaybackHandle | null, startedAt: now };
    this.playing = entry;
    let handle: PlaybackHandle | null = null;
    try {
      handle = await this.deps.play(r.lines, () => this.onEnded(entry));
    } catch {
      handle = null;
    }
    this.starting = false;
    if (this.playing !== entry) {
      handle?.stop(0.05); // interrupted while loading
      return;
    }
    if (!handle) {
      this.playing = null;
      this.toast(r, 'playFailed');
      this.pump();
      return;
    }
    entry.handle = handle;
    this.deps.trace?.({ action: 'play', key: r.key, p: r.p });
    r.lines.forEach((l, i) =>
      this.deps.subtitle({
        id: l.id,
        text: l.text,
        voice: l.voice,
        priority: r.p,
        showSec: Math.max((handle.lineDurations[i] ?? 0) + 1, 3),
        voiced: !!l.take,
        delaySec: handle.startOffsets[i] ?? 0,
        durationSec: handle.lineDurations[i] ?? 0,
      }),
    );
  }

  private onEnded(entry: { r: Req }): void {
    if (this.playing?.r !== entry.r) return;
    this.deps.trace?.({ action: 'end', key: entry.r.key, p: entry.r.p });
    this.playing = null;
    this.lastEnd = this.deps.now();
    this.pump();
  }

  private interrupt(fadeSec: number): void {
    const cur = this.playing;
    if (!cur) return;
    this.deps.trace?.({ action: 'interrupt', key: cur.r.key, p: cur.r.p });
    this.playing = null;
    cur.handle?.stop(fadeSec);
    this.lastEnd = this.deps.now();
  }

  private later(ms: number): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    this.deps.schedule(() => {
      this.pumpScheduled = false;
      this.pump();
    }, ms);
  }

  private toast(r: Req, reason: VoiceSkipReason): void {
    this.deps.trace?.({ action: 'toast', key: r.key, p: r.p, reason });
    for (const l of r.lines) {
      if (l.oncePerGame) this.latched.add(l.id); // the event was surfaced once, voiced or not
      this.deps.subtitle({ id: l.id, text: l.text, voice: l.voice, priority: r.p, showSec: 3, voiced: false, delaySec: 0, durationSec: 0, reason });
    }
  }
}
