// Event → audio actions (audio-plan §4.12), driven by data/audio-events.json. The router is pure
// decision logic (unit-tested): it turns a bridge GameEventDto, a client bus topic or a tutorial step
// into SFX, VO and music actions and keeps the client-side rate state (profit streak, 8× every-other-
// close, once-per-game latches, per-line game-month cooldowns with "first N free / every Nth" limits,
// anchor 90 s rule, command/tick dedupe). AudioSystem executes the actions; `lastNotes` explains the
// latest decision for the audio trace.

import table from '../data/audio-events.json';
import newsMap from '../data/news-map.json';
import { canonicalLineId, voLineDef } from '../voice/voiceLines';
import type { Priority } from '../voice/VoiceQueue';
import type { RecipeParams } from '../synth/recipes';
import type { Vec3 } from '../sfx/SfxPlayer';

/** Superset of the bridge GameEventDto (bridge-spec §7.1) and the bus payloads; all fields optional. */
export interface RoutedEvent {
  kind?: string;
  severity?: string;
  message?: string;
  amount?: number;
  buildingId?: number | null;
  cityId?: string;
  productId?: string;
  priority?: number;
  isPlayer?: boolean;
  level?: number;
  maxLevel?: number;
  typeId?: string;
  goalId?: string;
  reason?: string;
  oldValue?: number;
  newValue?: number;
  threshold?: number;
  months?: number;
  /** bus.ui */
  cue?: string;
  /** bus.speedChanged (multiplier semantics: 0, 1, 2, 4, 8) */
  speed?: number;
  /** bus.buildingSelected: content category of the building */
  category?: string;
  /** bus.speedChanged: a menu/overlay holds time (no transport sounds) */
  held?: boolean;
  /** bus.panelChanged */
  drawer?: string | null;
  overlay?: string | null;
}

/** Game state the conditions and line templates read (AudioSystem supplies it from the store). */
export interface RouterContext {
  /** Player building count. */
  buildings: number;
  /** Months played in this game. */
  monthsElapsed: number;
  /** Cash runway in months (null when not burning). */
  runway: number | null;
  /** The tutorial scenario is running (rules with `tutorial: "scenario"` count as tutorial lines). */
  tutorialScenario: boolean;
}

/** Building groups of the templated first-building lines (vo_building_first_<group>). */
export type BuildingGroup = 'retail' | 'factory' | 'farm' | 'mine_well' | 'warehouse' | 'rd' | 'media' | 'seaport' | 'other';

export type MusicOp =
  | { op: 'state'; value: string }
  | { op: 'stinger'; value: string }
  | { op: 'evaluate' }
  | { op: 'warning' }
  | { op: 'tension' }
  | { op: 'tone'; value: 'normal' | 'paused' }
  | { op: 'climate'; value: string }
  | { op: 'intensity'; value: string }
  | { op: 'drawdown' };

export type AudioAction =
  | { type: 'sfx'; id: string; delay?: number; detuneCents?: number; levelDb?: number; params?: RecipeParams; at?: Vec3; atBuilding?: number }
  | {
      type: 'vo';
      lines: string[];
      priority?: Priority;
      rank: number;
      fromClose: boolean;
      scenarioEnd?: boolean;
      hint?: boolean;
      delay?: number;
      /** Tutorial line (voiced at advisor frequency "important"). */
      tutorial?: boolean;
    }
  | ({ type: 'music' } & MusicOp);

interface SfxRef {
  id: string;
  delay?: number;
  detuneCents?: number;
  levelDb?: number;
}
interface VoRef {
  /** One line, or candidates tried in order (the first that may speak wins). `${group}`, `${milestone}`,
   *  `${pct}` and `${level}` are filled from the event; an unknown resolved id is skipped. */
  line: string | string[];
  /** Atomic chain (anchor → advisor); a line in cooldown or already latched is left out of the chain. */
  chain?: string[];
  rank?: number;
  scenarioEnd?: boolean;
  newsSting?: boolean;
  hint?: boolean;
  delay?: number;
}
interface Rule {
  doc?: string;
  /** Tutorial-flagged request (plays at advisor frequency "important"); "scenario": only in the tutorial scenario. */
  tutorial?: boolean | 'scenario';
  if?: Record<string, unknown>;
  sfx?: string | (string | SfxRef)[];
  at?: 'building';
  vo?: string | VoRef;
  music?: Record<string, unknown>;
  once?: 'game';
  dedupe?: string;
  alias?: string;
}

const TABLE = table as unknown as { events: Record<string, Rule[]>; tutorial?: Record<string, string> };
const RULES = TABLE.events;
/** Tutorial step id → line id (UX §6.17 / §7; a step's own `vo` wins). */
const TUTORIAL_LINES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TABLE.tutorial ?? {}).filter(([k]) => !k.startsWith('$')),
);
interface NewsEntry {
  headline: string;
  severity: string;
  line: string | null;
}
const NEWS = (newsMap as unknown as { events: Record<string, NewsEntry> }).events;
const NEWS_BY_HEADLINE = new Map(Object.values(NEWS).map((n) => [n.headline, n]));

/** The content news entry behind an event (content id first, then the headline), if known. */
function newsEntry(e: RoutedEvent): NewsEntry | undefined {
  return (e.typeId ? NEWS[e.typeId] : undefined) ?? (e.message ? NEWS_BY_HEADLINE.get(e.message) : undefined);
}

export function routingKeys(): string[] {
  return Object.keys(RULES);
}

export function rulesFor(key: string): Rule[] {
  return RULES[key] ?? [];
}

/** The templated first-building line group of a content building category (or type id). */
export function buildingGroup(category: string | undefined, typeId?: string): BuildingGroup {
  const c = `${category ?? ''} ${typeId ?? ''}`.toLowerCase();
  if (/convenience|supermarket|department|store|retail/.test(c)) return 'retail';
  if (/factory/.test(c)) return 'factory';
  if (/farm|plantation/.test(c)) return 'farm';
  if (/mine|oil|well/.test(c)) return 'mine_well';
  if (/warehouse/.test(c)) return 'warehouse';
  if (/seaport|port\b/.test(c)) return 'seaport';
  if (/rd_center|\brd\b|r&d|lab|research/.test(c)) return 'rd';
  if (/media|tv|radio|newspaper|magazine/.test(c)) return 'media';
  return 'other';
}

/** Revenue milestone threshold → template suffix (1m, 10m, 100m, 1b). */
export function milestoneSuffix(threshold: number | undefined): string | null {
  if (threshold === undefined || !(threshold > 0)) return null;
  if (threshold >= 1e9) return `${Math.round(threshold / 1e9)}b`;
  if (threshold >= 1e6) return `${Math.round(threshold / 1e6)}m`;
  if (threshold >= 1e3) return `${Math.round(threshold / 1e3)}k`;
  return String(threshold);
}

/** Category groups for the selection sounds. */
export function selectionGroup(category: string | undefined): 'retail' | 'industrial' | 'agri' | 'knowledge' | 'any' {
  const c = (category ?? '').toLowerCase();
  if (/store|supermarket|retail|department/.test(c)) return 'retail';
  if (/factory|mine|oil|well|warehouse|seaport|port|industrial/.test(c)) return 'industrial';
  if (/farm|plantation|agri/.test(c)) return 'agri';
  if (/rd|r&d|media|lab|tv|radio|newspaper|magazine|research/.test(c)) return 'knowledge';
  return 'any';
}

/**
 * News severity tier. The content severity (news-map.json) wins when the event maps to a known content
 * event: bridge-spec §7.2 folds Notable and Info into UI severity 'info' (Major → 'warning'), which
 * would otherwise silence every Notable anchor line. Unknown news falls back to the event severity
 * (old engine: major/notable/info; bridge: warning/danger ⇒ major).
 */
export function newsTier(e: RoutedEvent): 'major' | 'notable' | 'info' {
  // content table first; then the bridge's `reason` (it carries the content severity: major/notable/info);
  // then the UI severity
  const reason = (e.reason ?? '').toLowerCase();
  const fromReason = reason === 'major' || reason === 'notable' || reason === 'info' ? reason : undefined;
  const s = (newsEntry(e)?.severity ?? fromReason ?? e.severity ?? '').toLowerCase();
  if (s === 'major' || s === 'warning' || s === 'danger') return 'major';
  if (s === 'notable') return 'notable';
  return 'info';
}

/** Anchor line for a news event (content id first, then the headline), or null. */
export function newsLine(e: RoutedEvent): string | null {
  return newsEntry(e)?.line ?? null;
}

export interface RouterDeps {
  /** Real time in ms. */
  now(): number;
  /** Game month index (monotonic) for game-month VO cooldowns. */
  gameMonth(): number;
  /** Current speed multiplier (0, 1, 2, 4, 8). */
  speed(): number;
  /** Game state for conditions/templates (default: nothing known). */
  context?(): Partial<RouterContext>;
  /** Content category of a building type id (catalog), for `${group}`. */
  buildingCategory?(typeId: string): string | undefined;
}

export interface RouteOptions {
  /** Raised by a month close (VO close budget applies). */
  fromClose?: boolean;
}

const ANCHOR_GAP_MS = 90_000;
const DEDUPE_MS = 3000;

export class AudioEventRouter {
  private streak = 0;
  private closes = 0;
  private prevSpeed = 0;
  private readonly latches = new Set<string>();
  private readonly voMonth = new Map<string, number>();
  private readonly recent = new Map<string, number>();
  private lastAnchorAt = -1e12;
  private newsIntroDone = false;
  /** Lines this router raised this game (once-per-game candidates, firstFree / every counters). */
  private readonly voCount = new Map<string, number>();
  private readonly voOccurrences = new Map<string, number>();
  private notes: string[] = [];

  constructor(private readonly deps: RouterDeps) {}

  resetGame(): void {
    this.streak = 0;
    this.closes = 0;
    this.latches.clear();
    this.voMonth.clear();
    this.recent.clear();
    this.voCount.clear();
    this.voOccurrences.clear();
  }

  /** Why the latest route() decided what it did (rule, skipped lines, suppressions) — for the trace. */
  get lastNotes(): readonly string[] {
    return this.notes;
  }

  /**
   * The line for a tutorial step: the step's own `vo` (a line id, a superseded UX id or a legacy name)
   * or the table's `tutorial` map. Null when neither names a known line.
   */
  tutorialLine(stepId: string, explicitVo?: string): string | null {
    for (const name of [explicitVo, TUTORIAL_LINES[stepId]]) {
      const id = name ? canonicalLineId(name) : undefined;
      if (id) return id;
    }
    return null;
  }

  /** Route a tutorial step's line (P1·T; once per step id per save is the tutorial store's latch). */
  routeTutorial(stepId: string, explicitVo?: string): AudioAction[] {
    this.notes = [];
    const line = this.tutorialLine(stepId, explicitVo);
    if (!line) {
      this.notes.push(`tutorial step ${stepId}: no line`);
      return [];
    }
    this.notes.push(`tutorial step ${stepId} → ${line}`);
    return [{ type: 'vo', lines: [line], rank: 0, fromClose: false, tutorial: true }];
  }

  get profitStreak(): number {
    return this.streak;
  }

  /** Route one event. `key` is the bridge kind or a 'bus.<topic>' key. */
  route(key: string, e: RoutedEvent, opts: RouteOptions = {}): AudioAction[] {
    this.notes = [];
    let rules = RULES[key];
    if (!rules) {
      this.notes.push('no rules for this key');
      return [];
    }
    const alias = rules[0]?.alias;
    if (alias) rules = RULES[alias] ?? [];
    const ctx = this.context(key, e);
    const ruleIndex = rules.findIndex((r) => this.matches(r.if, e, ctx));
    const rule = rules[ruleIndex];
    if (key === 'bus.speedChanged') this.prevSpeed = e.speed ?? 0;
    if (!rule) {
      this.notes.push('no rule matched');
      return [];
    }
    this.notes.push(`rule #${ruleIndex}${rule.doc ? ` (${rule.doc.slice(0, 60)})` : ''}`);
    const nowMs = this.deps.now();

    if (rule.once === 'game') {
      // once per kind per game (per goal for goal-scoped kinds), whatever building or city raised it
      const latch = `${key}:${e.goalId ?? ''}`;
      if (this.latches.has(latch)) {
        this.notes.push('once per game: already fired');
        return [];
      }
      this.latches.add(latch);
    }
    if (key === 'bus.buildingPlaced' && e.buildingId != null) this.recent.set(`placed:${e.buildingId}`, nowMs);
    const deduped =
      rule.dedupe === 'bus.buildingPlaced' && e.buildingId != null && nowMs - (this.recent.get(`placed:${e.buildingId}`) ?? -1e12) < DEDUPE_MS;

    const actions: AudioAction[] = [];
    // ---- sfx
    if (rule.sfx && !deduped) {
      const refs = (Array.isArray(rule.sfx) ? rule.sfx : [rule.sfx]).map((r) => (typeof r === 'string' ? { id: r } : r));
      const params: RecipeParams = {};
      let silent = false;
      if (key === 'monthClosed') {
        const ni = e.amount ?? 0;
        if (ni > 0) this.streak += 1;
        else if (ni < 0) this.streak = 0;
        params.streak = this.streak;
        this.closes += 1;
        // §4.10: at 8× only every other close sounds
        if (this.deps.speed() >= 8 && this.closes % 2 === 0) {
          silent = true;
          this.notes.push('8×: every other close is silent');
        }
      }
      if (!silent)
        for (const r of refs)
          actions.push({
            type: 'sfx',
            id: r.id,
            delay: r.delay,
            detuneCents: r.detuneCents,
            levelDb: r.levelDb,
            params: Object.keys(params).length ? params : undefined,
            atBuilding: rule.at === 'building' && e.buildingId != null ? e.buildingId : undefined,
          });
    } else if (key === 'monthClosed') {
      const ni = e.amount ?? 0;
      if (ni > 0) this.streak += 1;
      else if (ni < 0) this.streak = 0;
      this.closes += 1;
    }
    if (deduped) this.notes.push('sfx deduped (placement already sounded)');
    // ---- vo
    const tutorial = rule.tutorial === true || (rule.tutorial === 'scenario' && this.ctx().tutorialScenario);
    const vo = rule.vo ? this.voAction(key, rule.vo, e, opts, nowMs, tutorial) : null;
    if (vo) actions.push(vo);
    // ---- music
    if (rule.music) actions.push(...musicOps(rule.music));
    return actions;
  }

  // ---------------------------------------------------------------------------------------------

  private context(key: string, e: RoutedEvent): { speedChange?: 'paused' | 'faster' | 'slower' | 'resumed' } {
    if (key !== 'bus.speedChanged') return {};
    if (e.held) return { speedChange: e.speed === 0 ? 'paused' : 'resumed' };
    const s = e.speed ?? 0;
    const p = this.prevSpeed;
    if (s === 0) return { speedChange: 'paused' };
    if (p === 0) return { speedChange: 'resumed' };
    return { speedChange: s > p ? 'faster' : s < p ? 'slower' : undefined };
  }

  private matches(cond: Record<string, unknown> | undefined, e: RoutedEvent, ctx: { speedChange?: string }): boolean {
    if (!cond) return true;
    for (const [k, v] of Object.entries(cond)) {
      switch (k) {
        case 'isPlayer':
          if ((e.isPlayer ?? true) !== v) return false;
          break;
        case 'severity':
          if (!(Array.isArray(v) ? v : [v]).includes(e.severity)) return false;
          break;
        case 'newsTier':
          if (newsTier(e) !== v) return false;
          break;
        case 'anchor':
          if ((newsLine(e) !== null) !== v) return false;
          break;
        case 'reason':
          if (!(Array.isArray(v) ? v : [v]).includes(e.reason)) return false;
          break;
        case 'sign': {
          const a = e.amount ?? 0;
          if ((v === 'positive' && !(a > 0)) || (v === 'negative' && !(a < 0))) return false;
          break;
        }
        case 'dir': {
          const d = direction(e);
          if (d !== v) return false;
          break;
        }
        case 'monthsLte':
          if (!(e.months !== undefined && e.months <= (v as number))) return false;
          break;
        case 'monthsEq':
          if (e.months !== v) return false;
          break;
        case 'thresholdIn':
          if (!(v as number[]).some((x) => e.threshold !== undefined && Math.abs(e.threshold - x) < 1e-6)) return false;
          break;
        case 'speed':
          if (ctx.speedChange !== v) return false;
          break;
        case 'category':
          if (v !== 'any' && selectionGroup(e.category) !== v) return false;
          break;
        case 'cue':
          if (e.cue !== v) return false;
          break;
        case 'fast':
          if ((this.deps.speed() >= 4) !== v) return false;
          break;
        case 'held':
          if (!!e.held !== v) return false;
          break;
        case 'atMax':
          if ((e.level !== undefined && e.maxLevel !== undefined && e.level >= e.maxLevel) !== v) return false;
          break;
        case 'group':
          if (this.groupOf(e) !== v) return false;
          break;
        case 'drawer':
          if ((e.drawer ?? null) !== v) return false;
          break;
        case 'overlay':
          if ((e.overlay ?? null) !== v) return false;
          break;
        case 'buildingsEq':
          if (this.ctx().buildings !== v) return false;
          break;
        case 'buildingsGte':
          if (!(this.ctx().buildings >= (v as number))) return false;
          break;
        case 'monthsGte':
          if (!(this.ctx().monthsElapsed >= (v as number))) return false;
          break;
        case 'runwayLt': {
          const r = this.ctx().runway;
          if (!(r !== null && r < (v as number))) return false;
          break;
        }
        default:
          return false; // unknown condition: never match silently-wrong
      }
    }
    return true;
  }

  private ctx(): RouterContext {
    return { buildings: 0, monthsElapsed: 0, runway: null, tutorialScenario: false, ...(this.deps.context?.() ?? {}) };
  }

  private groupOf(e: RoutedEvent): BuildingGroup {
    const category = e.category ?? (e.typeId ? this.deps.buildingCategory?.(e.typeId) : undefined);
    return buildingGroup(category, e.typeId);
  }

  /** Fill `${…}` placeholders from the event; null when one cannot be filled. */
  private fill(template: string, e: RoutedEvent): string | null {
    if (!template.includes('${')) return template;
    let ok = true;
    const out = template.replace(/\$\{(\w+)\}/g, (_m, name: string) => {
      let v: string | null = null;
      if (name === 'group') v = this.groupOf(e);
      else if (name === 'milestone') v = milestoneSuffix(e.threshold);
      else if (name === 'pct') v = e.threshold === undefined ? null : String(Math.round(e.threshold <= 1 ? e.threshold * 100 : e.threshold));
      else if (name === 'level') v = e.threshold === undefined ? null : String(Math.round(e.threshold));
      if (v === null) ok = false;
      return v ?? '';
    });
    return ok ? out : null;
  }

  /** May this line speak now (once-per-game, game-month cooldown with firstFree/every)? Null = yes. */
  private lineBlocked(id: string, month: number, count: boolean): string | null {
    const def = voLineDef(id);
    if (!def) return 'unknown line';
    if (def.held) return null; // subtitle-only: the queue toasts it
    const plays = this.voCount.get(id) ?? 0;
    if (def.oncePerGame && plays > 0) return 'once per game';
    const free = def.firstFree ?? 0;
    // occurrences of the triggering event for this line ("first 3, then every 5th" counts them all)
    const n = (this.voOccurrences.get(id) ?? 0) + (count ? 1 : 0);
    if (count) this.voOccurrences.set(id, n);
    if (plays >= free) {
      if (def.every && def.every > 1 && n % def.every !== 0) return `every ${def.every}: occurrence ${n}`;
      const cd = def.gameMonthCooldown;
      if (cd && month - (this.voMonth.get(id) ?? -1e9) < cd) return `cooldown ${cd} game-months`;
    }
    return null;
  }

  private voAction(key: string, ref: string | VoRef, e: RoutedEvent, opts: RouteOptions, nowMs: number, tutorial: boolean): AudioAction | null {
    const r: VoRef = typeof ref === 'string' ? { line: ref } : ref;
    const month = this.deps.gameMonth();
    let lines: string[];
    if (r.chain) {
      lines = [...r.chain];
    } else {
      // candidates: the first that resolves to a known line and may speak now
      const candidates = Array.isArray(r.line) ? r.line : [r.line];
      let chosen: string | null = null;
      for (const c of candidates) {
        if (c.startsWith('$') || c === 'news.$news') {
          chosen = c;
          break;
        }
        const filled = this.fill(c, e);
        const id = filled ? canonicalLineId(filled) : undefined;
        if (!id) continue;
        const why = this.lineBlocked(id, month, true);
        if (why) {
          this.notes.push(`vo ${id}: ${why}`);
          continue;
        }
        chosen = id;
        break;
      }
      if (!chosen) return null;
      lines = [chosen];
    }
    // placeholders
    if (lines.some((l) => l === 'news.$news')) {
      const tier = newsTier(e);
      const line = newsLine(e);
      if (!line || tier === 'info') {
        this.notes.push(`vo: ${tier} news without an anchor line is never voiced`);
        lines = lines.filter((l) => l !== 'news.$news');
      } else if (this.deps.speed() >= 4 && tier !== 'major') {
        this.notes.push('vo: 4×/8× voices only Major news');
        lines = lines.filter((l) => l !== 'news.$news');
      } else lines = lines.map((l) => (l === 'news.$news' ? line : l));
      if (!lines.length) return null;
    }
    if (lines.some((l) => l === '$hint')) {
      const hint = e.reason?.startsWith('adv.hint.') ? e.reason : e.typeId?.startsWith('adv.hint.') ? e.typeId : null;
      if (!hint) return null;
      lines = lines.map((l) => (l === '$hint' ? hint : l));
    }
    lines = lines.map((l) => canonicalLineId(this.fill(l, e) ?? l) ?? l);
    if (lines.some((l) => !voLineDef(l))) {
      this.notes.push(`vo: unknown line in ${lines.join(' > ')}`);
      return null;
    }
    // chains: leave out lines that may not speak now (cooldown / once per game), keep the rest
    if (r.chain) {
      lines = lines.filter((l) => {
        const why = this.lineBlocked(l, month, true);
        if (why) this.notes.push(`vo ${l}: ${why} (left out of the chain)`);
        return !why;
      });
      if (!lines.length) return null;
    }
    // anchor: ≤ 1 line per 90 s of real time; the session's first one is prefixed with news.intro
    if (lines.some((l) => voLineDef(l)?.voice === 'anchor')) {
      if (nowMs - this.lastAnchorAt < ANCHOR_GAP_MS) {
        this.notes.push('anchor: < 90 s since the last anchor line');
        lines = lines.filter((l) => voLineDef(l)?.voice !== 'anchor');
        if (!lines.length) return null;
      } else {
        this.lastAnchorAt = nowMs;
        if (!this.newsIntroDone && newsTier(e) === 'major' && key === 'news' && voLineDef(lines[0] as string)?.voice === 'anchor') {
          this.newsIntroDone = true;
          lines = ['news.intro', ...lines];
        }
      }
    }
    for (const l of lines) {
      this.voMonth.set(l, month);
      this.voCount.set(l, (this.voCount.get(l) ?? 0) + 1);
    }
    let priority: Priority | undefined;
    if (key === 'news' && newsTier(e) === 'major') {
      const mp = lines.map((l) => voLineDef(l)?.majorPriority).find((x) => x !== undefined);
      if (mp !== undefined) priority = mp as Priority;
    }
    return {
      type: 'vo',
      lines,
      priority,
      rank: r.rank ?? 3,
      fromClose: !!opts.fromClose,
      scenarioEnd: r.scenarioEnd,
      hint: r.hint,
      delay: r.delay,
      tutorial: tutorial || undefined,
    };
  }
}

function direction(e: RoutedEvent): 'up' | 'down' | null {
  if (e.newValue !== undefined && e.oldValue !== undefined && e.newValue !== e.oldValue) return e.newValue > e.oldValue ? 'up' : 'down';
  if (e.amount !== undefined && e.amount !== 0) return e.amount > 0 ? 'up' : 'down';
  if (e.reason === 'up' || e.reason === 'down') return e.reason;
  return null;
}

function musicOps(m: Record<string, unknown>): AudioAction[] {
  const out: AudioAction[] = [];
  if (typeof m.state === 'string') out.push({ type: 'music', op: 'state', value: m.state });
  if (typeof m.climate === 'string') out.push({ type: 'music', op: 'climate', value: m.climate });
  if (typeof m.stinger === 'string') out.push({ type: 'music', op: 'stinger', value: m.stinger });
  if (m.tone === 'normal' || m.tone === 'paused') out.push({ type: 'music', op: 'tone', value: m.tone });
  if (m.warning) out.push({ type: 'music', op: 'warning' });
  if (m.tension) out.push({ type: 'music', op: 'tension' });
  if (m.drawdown) out.push({ type: 'music', op: 'drawdown' });
  if (typeof m.intensity === 'string') out.push({ type: 'music', op: 'intensity', value: m.intensity });
  if (m.evaluate) out.push({ type: 'music', op: 'evaluate' });
  return out;
}
