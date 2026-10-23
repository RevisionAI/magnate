import { describe, expect, it } from 'vitest';
import type { AdvisorFrequency } from '../settings';
import {
  BUCKET,
  GAP_MS,
  HINT,
  QUEUE_MAX,
  TTL_MS,
  VoiceQueue,
  type PlaybackHandle,
  type Priority,
  type SubtitleEvent,
  type VoiceLine,
  type VoiceTraceEvent,
} from './VoiceQueue';

/**
 * A deterministic harness: virtual clock, manual timers, and a fake player whose lines last `lineSec`
 * and end only when the test advances the clock past them.
 */
class Harness {
  t = 0;
  advisor: AdvisorFrequency = 'all';
  fast = false;
  unlocked = true;
  lineSec = 4;
  readonly lines = new Map<string, VoiceLine>();
  readonly played: string[] = [];
  readonly stopped: string[] = [];
  readonly subtitles: SubtitleEvent[] = [];
  readonly trace: VoiceTraceEvent[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private active: { key: string; endAt: number; onEnded: () => void; stopped: boolean } | null = null;
  readonly q: VoiceQueue;

  constructor() {
    this.q = new VoiceQueue({
      now: () => this.t,
      schedule: (fn, ms) => void this.timers.push({ at: this.t + ms, fn }),
      settings: () => ({ advisor: this.advisor }),
      fast: () => this.fast,
      canPlay: () => this.unlocked,
      line: (id) => this.lines.get(id),
      play: async (lines, onEnded) => {
        const key = lines.map((l) => l.id).join('>');
        this.played.push(key);
        const dur = lines.length * this.lineSec;
        const entry = { key, endAt: this.t + dur * 1000, onEnded, stopped: false };
        this.active = entry;
        const handle: PlaybackHandle = {
          duration: dur,
          lineDurations: lines.map(() => this.lineSec),
          startOffsets: lines.map((_, i) => i * this.lineSec),
          stop: () => {
            entry.stopped = true;
            this.stopped.push(key);
          },
        };
        return handle;
      },
      subtitle: (e) => this.subtitles.push(e),
      trace: (e) => this.trace.push(e),
    });
  }

  add(id: string, priority: Priority, extra: Partial<VoiceLine> = {}): this {
    this.lines.set(id, { id, text: id, voice: 'advisor', priority, take: `take.${id}`, cooldownMs: 0, ...extra });
    return this;
  }

  /** Let pending promises (the async pump) settle. */
  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  /** Advance the virtual clock, firing timers and line ends in order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await this.flush();
      const nextTimer = this.timers.reduce((m, x) => Math.min(m, x.at), Infinity);
      const lineEnd = this.active && !this.active.stopped ? this.active.endAt : Infinity;
      const next = Math.min(nextTimer, lineEnd);
      if (next > end) break;
      this.t = Math.max(this.t, next);
      if (next === lineEnd && this.active) {
        const a = this.active;
        this.active = null;
        a.onEnded();
      } else {
        const due = this.timers.filter((x) => x.at <= this.t);
        this.timers = this.timers.filter((x) => x.at > this.t);
        for (const d of due) d.fn();
      }
    }
    this.t = end;
    await this.flush();
  }

  toasts(): string[] {
    return this.subtitles.filter((s) => !s.voiced).map((s) => s.id);
  }
}

describe('VoiceQueue (audio-plan §4.11)', () => {
  it('plays one line at a time, highest priority first, then by arrival', async () => {
    const h = new Harness().add('first', 0).add('a', 1).add('b', 1).add('c', 0).add('d', 1);
    h.lineSec = 1;
    h.q.request('first');
    await h.flush();
    for (const id of ['a', 'b', 'c', 'd']) h.q.request(id);
    await h.advance(30_000);
    expect(h.played).toEqual(['first', 'c', 'a', 'b', 'd']);
  });

  it('expires queued requests after their TTL (P0 30 s, P1 20 s, P2 12 s, P3 6 s)', async () => {
    const h = new Harness().add('busy', 0).add('p2', 2).add('p3', 3);
    h.lineSec = 1;
    h.q.request('busy');
    await h.flush();
    h.q.request('p3');
    h.q.request('p2');
    await h.advance(60_000);
    // after 'busy' ends at 1 s, P2 needs 8 s of silence (→ 9 s, inside its 12 s TTL); P3 needs 20 s (> 6 s TTL)
    expect(h.played).toEqual(['busy', 'p2']);
    expect(h.toasts()).toEqual(['p3']);
  });

  it('honours the minimum silence since the last line per priority (P1 3 s, P2 8 s, P3 20 s)', async () => {
    const h = new Harness().add('a', 1).add('b', 2);
    h.lineSec = 2;
    h.q.request('a');
    await h.flush();
    h.q.request('b');
    await h.advance(2000); // 'a' ends at 2 s
    expect(h.played).toEqual(['a']);
    await h.advance(GAP_MS[2]! - 300);
    expect(h.played).toEqual(['a']);
    await h.advance(600);
    expect(h.played).toEqual(['a', 'b']);
  });

  it('pre-empts: P0 interrupts a playing P2/P3; P1 interrupts only P3', async () => {
    const h = new Harness().add('hint', 3).add('info', 2).add('important', 1).add('critical', 0);
    h.q.request('info');
    await h.flush();
    h.q.request('important'); // P1 does not interrupt P2
    await h.flush();
    expect(h.stopped).toEqual([]);
    h.q.request('critical'); // P0 interrupts P2
    await h.flush();
    expect(h.stopped).toEqual(['info']);
    expect(h.played).toEqual(['info', 'critical']);

    const h2 = new Harness().add('hint', 3).add('important', 1);
    h2.q.request('hint');
    await h2.flush();
    h2.q.request('important');
    await h2.flush();
    expect(h2.stopped).toEqual(['hint']);
  });

  it('drops a request that waited past its TTL behind a long line, and toasts it', async () => {
    const h = new Harness().add('long', 0).add('info', 2);
    h.lineSec = 20; // the P0 line outlives the P2 TTL
    h.q.request('long');
    await h.flush();
    h.q.request('info');
    await h.advance(30_000);
    expect(h.played).toEqual(['long']);
    expect(h.toasts()).toContain('info');
    expect(TTL_MS).toEqual([30_000, 20_000, 12_000, 6_000]);
  });

  it('rate-limits with the token bucket (capacity 6, +1 per 20 s; P1 1 · P2 2 · P3 3)', async () => {
    const h = new Harness();
    for (let i = 0; i < 4; i++) h.add(`l${i}`, 2);
    h.lineSec = 1;
    // P2 every 10 s: 6 → 4 → 4.5−2 → 3−2 tokens; the fourth must wait for the bucket
    for (let i = 0; i < 3; i++) {
      h.q.request(`l${i}`);
      await h.advance(10_000);
    }
    expect(h.played).toEqual(['l0', 'l1', 'l2']);
    expect(h.q.state.tokens).toBeCloseTo(1.5, 5);
    h.q.request('l3'); // t = 30 s: 1.5 tokens < 2
    await h.advance(9_000);
    expect(h.played).toHaveLength(3);
    await h.advance(1_500); // t = 40 s: 1 + 20 s / BUCKET.refillMs = 2 tokens
    expect(h.played).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(BUCKET).toEqual({ capacity: 6, refillMs: 20_000 });
  });

  it('P0 lines cost no tokens and need no silence gap', async () => {
    const h = new Harness().add('a', 0).add('b', 0);
    h.lineSec = 1;
    for (let i = 0; i < 10; i++) {
      h.q.request(i % 2 ? 'a' : 'b');
      await h.advance(1000);
    }
    expect(h.played).toHaveLength(10);
  });

  it('applies per-line real-time cooldowns', async () => {
    const h = new Harness().add('x', 1, { cooldownMs: 60_000 });
    h.lineSec = 1;
    expect(h.q.request('x')).toBe(true);
    await h.advance(10_000);
    expect(h.q.request('x')).toBe(false);
    await h.advance(60_000);
    expect(h.q.request('x')).toBe(true);
  });

  it('latches once-per-game lines until resetGame()', async () => {
    const h = new Harness().add('first_sale', 1, { oncePerGame: true });
    h.lineSec = 1;
    h.q.request('first_sale');
    await h.advance(5_000);
    expect(h.q.request('first_sale')).toBe(false);
    h.q.resetGame();
    expect(h.q.request('first_sale')).toBe(true);
  });

  it('allows at most one line per month close, ranked P0 > goal > rival > opportunity', async () => {
    const h = new Harness().add('opportunity', 2).add('rival', 1).add('goal', 1).add('other', 2);
    h.q.beginCloseBatch();
    h.q.request('opportunity', { fromClose: true, rank: 2 });
    h.q.request('rival', { fromClose: true, rank: 1 });
    h.q.request('other', { fromClose: true, rank: 3 });
    h.q.request('goal', { fromClose: true, rank: 0 });
    h.q.endCloseBatch();
    await h.advance(120_000);
    expect(h.played).toEqual(['goal']);
    expect(h.toasts()).toEqual(expect.arrayContaining(['opportunity', 'rival', 'other']));
  });

  it('lets a scenario-end P0 be the second line of a close (and only that)', async () => {
    const h = new Harness().add('cash_negative', 0).add('defeat', 0).add('goal', 1);
    h.lineSec = 1;
    h.q.beginCloseBatch();
    h.q.request('goal', { fromClose: true, rank: 0 });
    h.q.request('cash_negative', { fromClose: true, rank: 0 });
    h.q.request('defeat', { fromClose: true, rank: 0, scenarioEnd: true });
    h.q.endCloseBatch();
    await h.advance(30_000);
    expect(h.played).toEqual(['cash_negative', 'defeat']);
    expect(h.toasts()).toContain('goal');
  });

  it('a new close resets the budget', async () => {
    const h = new Harness().add('a', 1).add('b', 1);
    h.lineSec = 1;
    for (const id of ['a', 'b']) {
      h.q.beginCloseBatch();
      h.q.request(id, { fromClose: true });
      h.q.endCloseBatch();
      await h.advance(10_000);
    }
    expect(h.played).toEqual(['a', 'b']);
  });

  it('advisor frequency: important = P0, P1 and tutorial lines; off = toasts only', async () => {
    const h = new Harness().add('p1', 1).add('p2', 2).add('tutorial', 2, { tutorial: true });
    h.advisor = 'important';
    h.lineSec = 1;
    expect(h.q.request('p2')).toBe(false);
    expect(h.q.request('tutorial')).toBe(true);
    await h.advance(10_000);
    expect(h.q.request('p1')).toBe(true);
    await h.advance(10_000);
    expect(h.played).toEqual(['tutorial', 'p1']);
    expect(h.toasts()).toEqual(['p2']);

    const off = new Harness().add('p0', 0);
    off.advisor = 'off';
    expect(off.q.request('p0')).toBe(false);
    expect(off.toasts()).toEqual(['p0']);
  });

  it('at 4×/8× only P0–P1 are voiced; P2/P3 become toasts', async () => {
    const h = new Harness().add('p1', 1).add('p2', 2);
    h.fast = true;
    expect(h.q.request('p2')).toBe(false);
    expect(h.q.request('p1')).toBe(true);
    await h.flush();
    expect(h.played).toEqual(['p1']);
    expect(h.toasts()).toEqual(['p2']);
  });

  it('keeps the queue at 4, dropping the lowest priority (newest first)', async () => {
    const h = new Harness().add('playing', 0).add('a', 3).add('b', 3).add('c', 2).add('d', 1).add('e', 3);
    h.lineSec = 1000;
    h.q.request('playing');
    await h.flush();
    for (const id of ['a', 'b', 'c', 'd']) h.q.request(id);
    expect(h.q.state.queued).toHaveLength(QUEUE_MAX);
    h.q.request('e'); // P3, newest → dropped itself
    expect(h.q.state.queued.map((x) => x.key)).toEqual(['d', 'c', 'a', 'b']);
    expect(h.toasts()).toContain('e');
  });

  it('hints (P3) need 90 s of quiet and are spaced ≥ 3 min apart', async () => {
    const h = new Harness().add('line', 1).add('hint_a', 3).add('hint_b', 3);
    h.lineSec = 1;
    h.q.request('line');
    await h.advance(5_000);
    expect(h.q.request('hint_a', { hint: true })).toBe(false); // too soon after a line
    await h.advance(HINT.quietMs);
    expect(h.q.request('hint_a', { hint: true })).toBe(true);
    await h.advance(30_000);
    expect(h.played).toEqual(['line', 'hint_a']);
    await h.advance(HINT.quietMs);
    expect(h.q.request('hint_b', { hint: true })).toBe(false); // < 3 min since the last hint
    await h.advance(HINT.minGapMs);
    expect(h.q.request('hint_b', { hint: true })).toBe(true);
  });

  it('while audio is locked keeps P0/P1 (TTL running) and toasts the rest', async () => {
    const h = new Harness().add('p1', 1).add('p2', 2);
    h.unlocked = false;
    h.q.request('p1');
    h.q.request('p2');
    await h.advance(1_000);
    expect(h.played).toEqual([]);
    expect(h.toasts()).toEqual(['p2']);
    h.unlocked = true;
    await h.advance(1_000);
    expect(h.played).toEqual(['p1']);
  });

  it('lines without a recorded take are surfaced as subtitle toasts', () => {
    const h = new Harness().add('script_only', 1, { take: undefined });
    expect(h.q.request('script_only')).toBe(false);
    expect(h.toasts()).toEqual(['script_only']);
  });

  it('emits voiced subtitles shown for max(duration + 1 s, 3 s), chains included', async () => {
    const h = new Harness().add('news.recession', 1, { voice: 'anchor' }).add('adv.macro.recession', 1);
    h.lineSec = 4;
    h.q.request(['news.recession', 'adv.macro.recession']);
    await h.flush();
    const voiced = h.subtitles.filter((s) => s.voiced);
    expect(voiced.map((s) => [s.id, s.showSec, s.delaySec])).toEqual([
      ['news.recession', 5, 0],
      ['adv.macro.recession', 5, 4],
    ]);
    expect(h.played).toEqual(['news.recession>adv.macro.recession']);
  });

  it('a tutorial request is voiced at advisor frequency "important" even for a P2 line', async () => {
    const h = new Harness().add('tip', 2);
    h.advisor = 'important';
    expect(h.q.request('tip')).toBe(false);
    expect(h.subtitles.at(-1)).toMatchObject({ id: 'tip', voiced: false, reason: 'advisorOff' });
    const h2 = new Harness().add('tip', 2);
    h2.advisor = 'important';
    expect(h2.q.request('tip', { tutorial: true })).toBe(true);
    await h2.advance(100);
    expect(h2.played).toEqual(['tip']);
    expect(h2.subtitles.at(-1)).toMatchObject({ id: 'tip', voiced: true, durationSec: 4 });
  });

  it('says why a line was not voiced (subtitle reason + trace)', async () => {
    const h = new Harness().add('noTake', 1, { take: undefined }).add('fastP2', 2).add('once', 1, { oncePerGame: true });
    h.q.request('noTake');
    expect(h.subtitles.at(-1)).toMatchObject({ id: 'noTake', voiced: false, reason: 'noTake', durationSec: 0 });
    h.fast = true;
    h.q.request('fastP2');
    expect(h.subtitles.at(-1)).toMatchObject({ id: 'fastP2', reason: 'fastSpeed' });
    h.fast = false;
    h.q.request('once');
    await h.advance(10_000);
    h.q.request('once');
    const actions = h.trace.map((e) => `${e.action}:${e.key}${e.reason ? `:${e.reason}` : ''}`);
    expect(actions).toEqual(['toast:noTake:noTake', 'toast:fastP2:fastSpeed', 'queue:once', 'play:once', 'end:once', 'drop:once:latched']);
  });
});

