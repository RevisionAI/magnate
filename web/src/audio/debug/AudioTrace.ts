// The audio router's decision trace (debug overlay, AudioLab, e2e): one bounded ring of records of
// what the audio side decided for each game event, UI cue and tutorial step — which rule matched,
// which SFX played or were suppressed, which VO lines were queued / voiced / turned into subtitle
// toasts / dropped (and why), and every music state change and stinger. Cheap enough to stay on in
// production builds; `window.__magnateAudio.trace()` reads it, and `?audioTrace` (or localStorage
// `magnate.audioTrace = 1`) also echoes each record to the console.

export type TraceKind = 'event' | 'sfx' | 'vo' | 'music' | 'subtitle' | 'note';

export interface TraceRecord {
  /** Monotonic sequence number. */
  seq: number;
  /** ms since the trace started (performance.now based). */
  t: number;
  /** Game month index when recorded (-1 before a game). */
  month: number;
  kind: TraceKind;
  /** Routing key ('cashNegative', 'bus.ui', 'tutorial:build', …) or the subject (line key, sfx id, state). */
  key: string;
  /** What happened: 'play', 'suppressed', 'queue', 'toast', 'drop', 'state', 'stinger', 'rule', … */
  action: string;
  detail?: string;
}

export interface TraceSummary {
  events: number;
  sfxPlayed: Record<string, number>;
  sfxSuppressed: number;
  voPlayed: string[];
  voToasts: { key: string; reason: string }[];
  voDropped: { key: string; reason: string }[];
  musicStates: string[];
  stingers: string[];
}

export class AudioTrace {
  private readonly ring: TraceRecord[] = [];
  private seq = 0;
  private readonly t0: number;
  echo = false;

  constructor(
    private readonly month: () => number,
    private readonly capacity = 1500,
    private readonly now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ) {
    this.t0 = this.now();
    try {
      this.echo =
        (typeof location !== 'undefined' && /[?&]audioTrace\b/.test(location.search)) ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('magnate.audioTrace') === '1');
    } catch {
      this.echo = false;
    }
  }

  add(kind: TraceKind, key: string, action: string, detail?: string): void {
    const rec: TraceRecord = { seq: this.seq++, t: Math.round(this.now() - this.t0), month: this.month(), kind, key, action };
    if (detail) rec.detail = detail;
    this.ring.push(rec);
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
    if (this.echo) console.debug(`[audio] m${rec.month} ${kind} ${key} ${action}${detail ? ` — ${detail}` : ''}`);
  }

  /** Records, oldest first (optionally only those after `sinceSeq`). */
  records(sinceSeq = -1): TraceRecord[] {
    return this.ring.filter((r) => r.seq > sinceSeq);
  }

  clear(): void {
    this.ring.length = 0;
  }

  get lastSeq(): number {
    return this.seq - 1;
  }

  /** Aggregate view of the records (e2e reports). */
  summary(sinceSeq = -1): TraceSummary {
    const s: TraceSummary = { events: 0, sfxPlayed: {}, sfxSuppressed: 0, voPlayed: [], voToasts: [], voDropped: [], musicStates: [], stingers: [] };
    for (const r of this.records(sinceSeq)) {
      if (r.kind === 'event' && r.action === 'rule') s.events += 1;
      else if (r.kind === 'sfx' && r.action === 'play') s.sfxPlayed[r.key] = (s.sfxPlayed[r.key] ?? 0) + 1;
      else if (r.kind === 'sfx') s.sfxSuppressed += 1;
      else if (r.kind === 'vo' && r.action === 'play') s.voPlayed.push(r.key);
      else if (r.kind === 'vo' && r.action === 'toast') s.voToasts.push({ key: r.key, reason: r.detail ?? '' });
      else if (r.kind === 'vo' && r.action === 'drop') s.voDropped.push({ key: r.key, reason: r.detail ?? '' });
      else if (r.kind === 'music' && r.action === 'state') s.musicStates.push(r.key);
      else if (r.kind === 'music' && r.action === 'stinger') s.stingers.push(r.key);
    }
    return s;
  }
}
