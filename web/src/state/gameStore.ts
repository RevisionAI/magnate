// Central game state (zustand). Holds the latest engine data the UI and the 3D
// scene render from, plus the actions that talk to the engine. Components
// select narrow slices: `useGameStore((s) => s.hud?.date)`.
//
// Time (MASTER-PLAN D5): `speed` is the player's choice (0 = pause, 1..4 = 1×/2×/
// 4×/8×); `holds` are menus that freeze time without changing that choice
// (L4 modals always, L3 overlays when Settings → "Pause while in full-screen
// screens" is on). The clock runs at `speed` only when nothing holds it.
//
// Month close (UX §6.4): the clock reaches day 30 → `advanceMonth()` → the tick
// result is applied: HUD snapshot, history, the `monthClosed` beat on the bus,
// alerts (policy §6.21), advisor line, auto-pause triggers, outcome and autosave.
//
// Bridge envelope (bridge-spec §5.0): when EngineClient exposes `onEnvelope()`
// (B1), HUD snapshots and command events carried by mutating envelopes are
// applied directly and the extra `snapshot` round trip is skipped. Without it,
// `syncAfterMutation()` re-fetches as before.

import { create } from 'zustand';
import { EngineClient, EngineError } from '@/bridge/engine';
import type {
  BuildingSummaryDto,
  CatalogDto,
  CompanySummaryDto,
  GameEventDto,
  InitResult,
  ScenarioSummaryDto,
  SnapshotDto,
  TickResultDto,
} from '@/bridge/protocol';
import { audio } from '@/audio';
import { bus, type MonthClosedMoment } from '@/game/events';
import { GameClock, SPEED_MULTIPLIER, type Speed } from '@/game/clock';
import { fx } from '@/game/fx';
import { addMonths, money, signedMoney } from '@/util/format';
import { randomSeed, uuid } from '@/util/random';
import { captureThumbnail } from '@/util/thumbnail';
import { useAlertsStore } from './alertsStore';
import { autoPauseDecision } from './autopause';
import { EventDeduper, normalizeEvent, type UiEvent } from './gameEvents';
import { appendRecord, historyFromDto, profitStreak, recordFromHud, type MonthRecord } from './history';
import { toHudModel, type HudModel } from './hud';
import { createSaveStore, nextAutosaveSlot, SaveError, slotIds, type SaveSlotMeta, type SlotKind, type UiSidecar } from './savegame';
import { getSaveStore, setSaveStore, useSavesStore } from './savesStore';
import { useSettingsStore } from './settingsStore';
import { useTutorialStore } from './tutorialStore';
import { useUiStore } from './uiStore';

export type Phase = 'booting' | 'bootFailed' | 'title' | 'scenarioSelect' | 'starting' | 'loading' | 'playing';

export type BootStage = 'worker' | 'runtime' | 'content' | 'scenarios' | 'catalog' | 'ready';

export interface FeedItem extends GameEventDto {
  id: number;
  at: number; // performance.now() when received
  monthIndex: number;
}

export interface NewGameOptions {
  companyName?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  /** Spectator mode: an AI strategy drives the player company (bridge-spec §5.3). */
  autopilot?: string | null;
}

export interface AutoPauseNotice {
  trigger: string;
  message: string;
}

/** What the game-loading screen is opening (set when a new game or a save starts loading). */
export interface LoadingTarget {
  kind: 'new' | 'load';
  scenarioId?: string;
  companyName?: string;
  slotId?: string;
}

interface GameState {
  phase: Phase;
  loadingTarget: LoadingTarget | null;
  bootError: string | null;
  bootStage: BootStage;
  /** 0..1, for the boot progress bar. */
  bootProgress: number;
  init: InitResult | null;
  catalog: CatalogDto | null;
  scenarios: ScenarioSummaryDto[];

  snapshot: SnapshotDto | null;
  /** Normalised view-model of `snapshot` (state/hud.ts). */
  hud: HudModel | null;
  buildings: BuildingSummaryDto[];
  activeCityId: string | null;
  selectedBuildingId: number | null;
  /** Player-selected speed index (0 = pause). */
  speed: Speed;
  /** Speed Space resumes to. */
  resumeSpeed: Exclude<Speed, 0>;
  /** Menus currently freezing time ('modal', 'overlay', 'loading'…). */
  holds: string[];
  /** Why the game auto-paused (cleared when the player resumes). */
  autoPause: AutoPauseNotice | null;
  feed: FeedItem[];
  history: MonthRecord[];
  /** The latest month-close beat. */
  monthClose: MonthClosedMoment | null;
  lastError: string | null;
  /** Engine revision; bumps after every tick / mutating call. Panels re-fetch on change. */
  revision: number;
  gameId: string | null;
  seed: number | null;
  stepping: boolean;
  skipping: boolean;
  saving: boolean;
  /** The engine build exposes save/load (bridge-spec §5.12); false on engine builds without persistence. */
  canSave: boolean;
  lastSave: { slotId: string; monthIndex: number; at: number } | null;
  /** Engine revision at the last save/load/new game (unsaved-progress detection). */
  savedRevision: number;
  playTimeSec: number;
  /** `${gameId}:${status}` once the debrief for that outcome was shown. */
  outcomeShown: string | null;

  boot(): Promise<void>;
  goTo(phase: Extract<Phase, 'title' | 'scenarioSelect'>): void;
  startNewGame(scenarioId: string, seed?: number, options?: NewGameOptions): Promise<void>;
  setSpeed(speed: Speed): void;
  togglePause(): void;
  stepMonth(): Promise<void>;
  skipToNextEvent(): Promise<void>;
  hold(reason: string): void;
  release(reason: string): void;
  clearAutoPause(): void;
  advanceMonth(): Promise<void>;
  refreshBuildings(): Promise<void>;
  construct(typeId: string, cityId: string): Promise<boolean>;
  setActiveCity(cityId: string): void;
  selectBuilding(buildingId: number | null): void;
  pushFeed(event: GameEventDto): void;
  clearError(): void;
  /** Refresh the snapshot + building list after any mutating call; bumps `revision`. */
  syncAfterMutation(): Promise<void>;
  /** Surface an engine/UI error to the player. */
  reportError(error: unknown): void;
  saveToSlot(slotId: string, options?: { slotKind?: SlotKind; label?: string | null; silent?: boolean }): Promise<SaveSlotMeta | null>;
  saveNew(label?: string | null): Promise<SaveSlotMeta | null>;
  quickSave(): Promise<void>;
  quickLoad(): Promise<void>;
  loadSlot(slotId: string): Promise<boolean>;
  quitToTitle(): void;
  hasUnsavedProgress(): boolean;
  addPlayTime(seconds: number): void;
}

let engine: EngineClient | null = null;
let feedSeq = 1;
/** True when EngineClient delivers `hud` snapshots from mutating envelopes (B1 subscription API). */
let hudStreaming = false;
let lastHudRevision = -1;
let monthsSinceAutosave = 0;
let lastEmittedSpeed: { speed: number; held: boolean } | null = null;
const deduper = new EventDeduper();

/** The engine client (throws until boot completes). */
export function getEngine(): EngineClient {
  if (!engine) throw new Error('engine not booted');
  return engine;
}

/** The engine client or null (for code that may run before boot). */
export function maybeEngine(): EngineClient | null {
  return engine;
}

/** Real-time clock that advances the engine one month at a time. */
export const clock = new GameClock(() => useGameStore.getState().advanceMonth());

const STOP_KINDS = new Set(['goalAchieved', 'scenarioWon', 'scenarioLost', 'cashNegative', 'rivalEnteredMarket', 'news']);
/** Methods whose results the store applies itself (their envelopes are ignored by the subscription). */
const SELF_APPLIED_METHODS: ReadonlySet<string> = new Set(['advance', 'newGame', 'loadGame', 'snapshot', 'init']);
const FEED_CAP = 200;

function describe(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (error instanceof SaveError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const useGameStore = create<GameState>()((set, get) => {
  /** Applies the effective speed to the clock and tells the bus when it changed. */
  function applyClock(): void {
    const s = get();
    const held = s.holds.length > 0 || s.skipping || s.phase !== 'playing';
    const effective: Speed = held ? 0 : s.speed;
    clock.setSpeed(effective);
    if (!lastEmittedSpeed || lastEmittedSpeed.speed !== effective || lastEmittedSpeed.held !== held) {
      lastEmittedSpeed = { speed: effective, held };
      bus.emit('speedChanged', {
        speed: effective,
        multiplier: SPEED_MULTIPLIER[effective],
        index: s.speed,
        held: held && s.speed !== 0,
        reason: s.holds[0] ?? null,
      });
    }
  }

  function setHud(snapshot: SnapshotDto): HudModel {
    const hud = toHudModel(snapshot, get().catalog);
    set({ snapshot, hud });
    return hud;
  }

  /** Clears every piece of presentation state (new game, load, quit). */
  function resetPresentation(): void {
    clock.setSpeed(0);
    clock.reset();
    deduper.reset();
    monthsSinceAutosave = 0;
    useUiStore.getState().reset();
    useAlertsStore.getState().reset();
    useTutorialStore.getState().stop();
    set({
      selectedBuildingId: null,
      feed: [],
      history: [],
      monthClose: null,
      speed: 0,
      holds: [],
      autoPause: null,
      lastError: null,
      skipping: false,
      stepping: false,
      outcomeShown: null,
    });
  }

  function pushEvents(events: readonly UiEvent[], monthIndex: number): void {
    if (events.length === 0) return;
    const at = perfNow();
    const items: FeedItem[] = events
      .filter((e) => e.priority > 0 || e.kind === 'news')
      .map((e) => ({ ...e.raw, id: feedSeq++, at, monthIndex }));
    if (items.length) set((s) => ({ feed: [...s.feed, ...items].slice(-FEED_CAP) }));
  }

  /** Advisor reacts to a close — at most one line per close (critical > goal > rival > other), UX §6.21. */
  function advisorReact(events: readonly UiEvent[], moment: MonthClosedMoment | null, hud: HudModel): void {
    const ui = useUiStore.getState();
    const has = (kind: string) => events.find((e) => e.kind === kind);
    // E2 finance: the revolver keeps cash positive, so distress arrives as `insolvency` (reason default).
    const distress = events.find((e) => e.kind === 'insolvency' && e.reason === 'default' && e.isPlayer !== false);
    const critical = has('cashNegative') ?? has('bankruptcyWarning') ?? distress;
    if (critical) {
      // The engine's cure window (3 month-ends under the finance rules), never a hard-coded count.
      const left = hud.insolvency.bankruptcyInMonths ?? hud.insolvency.graceMonths;
      const clock =
        left <= 0
          ? 'This month-end decides whether the company survives.'
          : `${left} more month-end${left === 1 ? '' : 's'} like this and the company is finished.`;
      ui.say({
        tone: 'critical',
        source: 'event',
        title: critical === distress ? 'We are in default' : 'We are overdrawn',
        text: critical === distress ? `${critical.message} ${clock}` : `Cash is ${money(hud.player?.cash ?? 0)}. ${clock}`,
        actions: [{ label: critical === distress ? 'Open the Bank' : 'Open Finance', panel: 'finance', ...(critical === distress ? { params: { tab: 'bank' } } : {}) }],
      });
      return;
    }
    const goal = has('goalAchieved');
    if (goal) {
      ui.say({ tone: 'success', source: 'event', title: 'Objective complete', text: goal.message || 'Another goal is done.', actions: [{ label: 'Goals', panel: 'goals' }] });
      return;
    }
    const rival = has('rivalEnteredMarket');
    if (rival) {
      ui.say({ tone: 'warning', source: 'event', title: 'A rival moved in', text: rival.message || 'A rival just opened in one of our markets.', actions: [{ label: 'Markets', panel: 'markets', params: { cityId: rival.cityId, productId: rival.productId } }] });
      return;
    }
    if (!moment || moment.batched) return;
    const first = has('firstSale');
    if (first || (moment.revenue > 0 && get().history.filter((r) => r.revenue > 0).length === 1)) {
      ui.say({ tone: 'success', source: 'event', title: 'Tills are ringing', text: `Revenue of ${money(moment.revenue)} in our first trading month.` });
      return;
    }
    const lossStreak = has('lossStreak');
    const losing = moment.netIncome < 0 && get().history.slice(-2).every((r) => r.netIncome < 0);
    if (lossStreak || losing) {
      ui.say({
        tone: 'warning',
        source: 'event',
        title: 'Still losing money',
        text: `Net ${signedMoney(moment.netIncome)} this month. Reports shows where it goes.`,
        actions: [{ label: 'Open Reports', panel: 'reports', params: { tab: 'pnl' } }],
      });
    }
  }

  function monthMoment(result: TickResultDto, before: HudModel | null, hud: HudModel, history: MonthRecord[], batched: boolean): MonthClosedMoment | null {
    const player = hud.player;
    if (!player) return null;
    const summaries = (result as TickResultDto & { monthSummaries?: { month: { year: number; month: number }; revenue: number; netIncome: number; cashStart: number; cashEnd: number }[] }).monthSummaries;
    const last = summaries && summaries.length > 0 ? summaries[summaries.length - 1] : undefined;
    const month = last?.month ?? before?.date ?? addMonths(hud.date, -1);
    return {
      month,
      revenue: last?.revenue ?? player.revenue,
      netIncome: last?.netIncome ?? player.netIncome,
      cashStart: last?.cashStart ?? before?.player?.cash ?? player.cash,
      cashEnd: last?.cashEnd ?? player.cash,
      valueStart: before?.player?.value ?? player.value,
      valueEnd: player.value,
      profitStreak: profitStreak(history),
      batched,
    };
  }

  /** UX §8: cash popup, world popups over the top buildings, confetti on records and goals. */
  function monthJuice(moment: MonthClosedMoment, result: TickResultDto, events: readonly UiEvent[], fast: boolean): void {
    if (moment.netIncome !== 0) {
      fx.popup({ text: signedMoney(moment.netIncome), tone: moment.netIncome > 0 ? 'gain' : 'loss', anchor: 'topbar.cash', delayMs: 200 });
    }
    const activity = (result as TickResultDto & { playerActivity?: { buildingId: number; netIncome: number }[] }).playerActivity ?? [];
    const top = [...activity].sort((a, b) => Math.abs(b.netIncome) - Math.abs(a.netIncome)).slice(0, fast ? 3 : 5);
    top.forEach((b, i) => fx.worldPopup(b.buildingId, signedMoney(b.netIncome), b.netIncome >= 0 ? 'gain' : 'loss', b.netIncome, i * 80));
    if (events.some((e) => e.kind === 'recordMonth' || e.kind === 'goalAchieved' || e.kind === 'revenueMilestone')) {
      fx.confetti({ intensity: events.some((e) => e.kind === 'goalAchieved') ? 1.2 : 0.8 });
    }
  }

  function checkOutcome(hud: HudModel, events: readonly UiEvent[]): boolean {
    const wonEvent = events.find((e) => e.kind === 'scenarioWon');
    const lostEvent = events.find((e) => e.kind === 'scenarioLost');
    const status = hud.outcome.status !== 'playing' ? hud.outcome.status : wonEvent ? 'won' : lostEvent ? 'lost' : 'playing';
    if (status === 'playing') return false;
    const key = `${get().gameId}:${status}`;
    if (get().outcomeShown === key) return false;
    const reason = hud.outcome.reason ?? wonEvent?.reason ?? lostEvent?.reason ?? null;
    set({ outcomeShown: key, speed: 0 });
    applyClock();
    bus.emit('outcome', { status, ...(reason ? { reason } : {}) });
    useUiStore.getState().openModal('outcome', { status, reason });
    if (status === 'won') fx.confetti({ intensity: 1.6 });
    return true;
  }

  /** Autosave every N in-game months (Settings → Gameplay; D17 rotates 3 slots). */
  async function maybeAutosave(countMonth: boolean): Promise<void> {
    const months = useSettingsStore.getState().gameplay.autosaveMonths;
    if (countMonth) monthsSinceAutosave++;
    if (months <= 0 || monthsSinceAutosave < months || get().skipping || get().phase !== 'playing') return;
    monthsSinceAutosave = 0;
    const store = getSaveStore();
    if (!store) return;
    try {
      const slots = await store.list();
      await get().saveToSlot(nextAutosaveSlot(slots), { slotKind: 'autosave', silent: true });
    } catch (error) {
      console.warn('[autosave] failed', error);
    }
  }

  /** Applies one `advance` result. Returns the normalised events (skip-to-event inspects them). */
  async function applyTick(result: TickResultDto, before: HudModel | null, batched: boolean): Promise<UiEvent[]> {
    const s = get();
    const hud = toHudModel(result.snapshot, s.catalog);
    lastHudRevision = Math.max(lastHudRevision, result.snapshot.revision);
    const events = result.events.map(normalizeEvent).filter((e) => deduper.accept(e));
    const record = recordFromHud(hud);
    const history = record ? appendRecord(s.history, record) : s.history;
    const moment = monthMoment(result, before, hud, history, batched);
    set({ snapshot: result.snapshot, hud, revision: getEngine().revision, history, monthClose: moment });
    pushEvents(events, hud.monthIndex);

    bus.emit('tick', result);
    for (const e of events) bus.emit('gameEvent', e.raw);
    if (moment) bus.emit('monthClosed', moment);

    const multiplier = batched ? 8 : SPEED_MULTIPLIER[s.speed];
    if (moment) monthJuice(moment, result, events, batched || multiplier >= 4);
    useAlertsStore.getState().ingest(events, { monthIndex: hud.monthIndex, speedMultiplier: multiplier, now: perfNow() });
    advisorReact(events, moment, hud);
    useTutorialStore.getState().evaluate({ hud, events });
    if (events.some((e) => e.kind === 'rivalEnteredMarket')) useUiStore.getState().setRailBadge('markets', '!');

    const ended = checkOutcome(hud, events);
    if (!ended && !batched) {
      const decision = autoPauseDecision(events, useSettingsStore.getState().gameplay.autoPause);
      if (decision && get().speed !== 0) {
        set({ speed: 0, autoPause: { trigger: decision.trigger, message: decision.message } });
        applyClock();
        bus.emit('autoPaused', { trigger: decision.trigger, message: decision.message });
      }
    }
    await get().refreshBuildings();
    void maybeAutosave(true);
    return events;
  }

  /** Command events delivered in mutating envelopes (B1). */
  function ingestCommandEvents(raw: readonly GameEventDto[]): void {
    const events = raw.map(normalizeEvent).filter((e) => deduper.accept(e));
    if (events.length === 0) return;
    const hud = get().hud;
    pushEvents(events, hud?.monthIndex ?? 0);
    for (const e of events) bus.emit('gameEvent', e.raw);
    useAlertsStore.getState().ingest(events, { monthIndex: hud?.monthIndex ?? 0, speedMultiplier: 1, now: perfNow() });
    useTutorialStore.getState().evaluate({ hud, events });
  }

  /**
   * Subscribes to EngineClient envelopes when the bridge client supports it
   * (feature-detected: B1's `onEnvelope(listener)`, or an older `subscribe`).
   * Flows that apply their own result (advance, newGame, loadGame, snapshot)
   * are skipped so nothing is applied twice.
   */
  function attachEnvelopes(client: EngineClient): void {
    type EnvelopeInfo = { method?: string; revision?: number; hud?: SnapshotDto; events?: GameEventDto[] };
    type Subscribe = (fn: (env: EnvelopeInfo) => void) => () => void;
    const api = client as unknown as { onEnvelope?: Subscribe; subscribe?: Subscribe };
    const subscribe = typeof api.onEnvelope === 'function' ? api.onEnvelope : typeof api.subscribe === 'function' ? api.subscribe : null;
    if (!subscribe) return;
    hudStreaming = true;
    subscribe.call(client, (env) => {
      if (env.method && SELF_APPLIED_METHODS.has(env.method)) return;
      const phase = get().phase;
      if (phase !== 'playing' && phase !== 'starting') return;
      if (env.hud && env.hud.revision >= lastHudRevision) {
        lastHudRevision = env.hud.revision;
        setHud(env.hud);
        set({ revision: Math.max(get().revision, env.revision ?? env.hud.revision) });
      }
      if (env.events && env.events.length > 0) ingestCommandEvents(env.events);
    });
  }

  /** Bridge history for the debrief/sparklines after a load (feature-detected; bridge-spec §5.10). */
  async function fetchHistory(hud: HudModel): Promise<void> {
    const init = get().init;
    if (!engine || !init?.methods.includes('history') || !hud.player) return;
    try {
      const dto = await engine.callRaw('history', { series: ['cash', 'revenue', 'netIncome', 'corporateValue', 'totalAssets'] });
      const elapsed = hud.elapsedMonths ?? 0;
      const rows = historyFromDto(dto, hud.player.id, hud.monthIndex - elapsed);
      if (rows.length > 0) set({ history: rows });
    } catch (error) {
      console.warn('[history] unavailable', error);
    }
  }

  function pickCity(buildings: readonly BuildingSummaryDto[], playerId: number | undefined, preferred?: string | null): string | null {
    const cities = get().catalog?.cities ?? [];
    if (preferred && cities.some((c) => c.id === preferred)) return preferred;
    const counts = new Map<string, number>();
    for (const b of buildings) if (b.ownerId === playerId) counts.set(b.cityId, (counts.get(b.cityId) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    for (const [city, n] of counts) {
      if (n > bestCount) {
        best = city;
        bestCount = n;
      }
    }
    return best ?? cities[0]?.id ?? null;
  }

  function sidecar(): UiSidecar {
    return { version: 1, history: get().history, tutorial: useTutorialStore.getState().persisted(), cityId: get().activeCityId };
  }

  return {
    phase: 'booting',
    loadingTarget: null,
    bootError: null,
    bootStage: 'worker',
    bootProgress: 0,
    init: null,
    catalog: null,
    scenarios: [],
    snapshot: null,
    hud: null,
    buildings: [],
    activeCityId: null,
    selectedBuildingId: null,
    speed: 0,
    resumeSpeed: 1,
    holds: [],
    autoPause: null,
    feed: [],
    history: [],
    monthClose: null,
    lastError: null,
    revision: 0,
    gameId: null,
    seed: null,
    stepping: false,
    skipping: false,
    saving: false,
    canSave: false,
    lastSave: null,
    savedRevision: 0,
    playTimeSec: 0,
    outcomeShown: null,

    async boot() {
      if (engine) return;
      const stageProgress: Record<string, number> = { runtime: 0.3, content: 0.55, scenarios: 0.72, ready: 0.82 };
      set({ bootStage: 'runtime', bootProgress: 0.06 });
      try {
        // B1 adds `boot({ onProgress })` (bridge-spec §6.1); older clients ignore the argument.
        const bootFn = EngineClient.boot as unknown as (options?: { onProgress?: (stage: string) => void }) => ReturnType<typeof EngineClient.boot>;
        const { client, init } = await bootFn.call(EngineClient, {
          onProgress: (stage: string) => {
            const p = stageProgress[stage];
            if (p !== undefined) set({ bootStage: stage as BootStage, bootProgress: Math.max(get().bootProgress, p) });
          },
        });
        engine = client;
        attachEnvelopes(client);
        setSaveStore(
          createSaveStore({
            saveGame: () => client.call('saveGame'),
            loadGame: (data) => client.call('loadGame', { data }),
            worker: client,
          }),
        );
        set({ bootStage: 'catalog', bootProgress: Math.max(get().bootProgress, 0.86) });
        const [catalog, scenarios] = await Promise.all([client.call('catalog'), client.call('listScenarios')]);
        const methods = Array.isArray(init.methods) ? init.methods : null;
        const canSave = !methods || (methods.includes('saveGame') && methods.includes('loadGame'));
        if (!canSave) console.warn('[saves] this engine build has no saveGame/loadGame — saving is disabled');
        set({ init, catalog, scenarios, canSave, bootStage: 'ready', bootProgress: 1, phase: 'title', bootError: null });
        void useSavesStore.getState().refresh();
      } catch (error) {
        console.error('[boot] engine failed to start', error);
        set({ phase: 'bootFailed', bootError: describe(error) });
      }
    },

    goTo(phase) {
      set({ phase });
      if (phase === 'title') void useSavesStore.getState().refresh();
    },

    async startNewGame(scenarioId, seed, options = {}) {
      resetPresentation();
      const companyName = options.companyName?.trim() || undefined;
      set({ phase: 'starting', loadingTarget: { kind: 'new', scenarioId, companyName }, buildings: [], snapshot: null, hud: null });
      applyClock();
      const seedValue = seed ?? randomSeed();
      try {
        // Extra fields (companyName, autopilot, createdAtIso, difficulty) are ignored by bridges that predate them.
        const args: Record<string, unknown> = { scenarioId, seed: seedValue, createdAtIso: new Date().toISOString() };
        if (options.companyName?.trim()) args.companyName = options.companyName.trim();
        if (options.autopilot) args.autopilot = options.autopilot;
        if (options.difficulty) args.difficulty = options.difficulty;
        const snapshot = await getEngine().callRaw<SnapshotDto>('newGame', args);
        lastHudRevision = snapshot.revision;
        const hud = setHud(snapshot);
        const record = recordFromHud(hud);
        const gameId = hud.gameId ?? `g-${uuid()}`;
        set({
          gameId,
          seed: seedValue,
          history: record ? [record] : [],
          revision: getEngine().revision,
          savedRevision: getEngine().revision,
          lastSave: null,
          playTimeSec: 0,
          resumeSpeed: useSettingsStore.getState().gameplay.defaultSpeed,
        });
        await get().refreshBuildings();
        set({ activeCityId: pickCity(get().buildings, hud.player?.id), phase: 'playing' });
        applyClock();
        bus.emit('gameStarted', snapshot);
        const city = get().catalog?.cities.find((c) => c.id === get().activeCityId);
        useUiStore.getState().say({
          tone: 'neutral',
          source: 'tip',
          title: `Welcome to ${city?.name ?? 'the city'}`,
          text: `${hud.player?.name ?? 'Your company'} starts with ${money(hud.player?.cash ?? 0)}. Open Build (B) to place your first store, then press Space to start the clock.`,
          actions: [{ label: 'Open Build', panel: 'build' }],
        });
      } catch (error) {
        set({ phase: 'scenarioSelect', lastError: describe(error) });
      }
    },

    setSpeed(speed) {
      const s = get();
      set({
        speed,
        resumeSpeed: speed !== 0 ? speed : s.resumeSpeed,
        // An explicit play beats the full-screen hold (UX §6.20: Space and 1–4 work in any panel).
        holds: speed !== 0 ? s.holds.filter((h) => h !== 'overlay') : s.holds,
        autoPause: speed !== 0 ? null : s.autoPause,
      });
      applyClock();
      useTutorialStore.getState().notifyAction(`speed:${speed}`);
    },

    togglePause() {
      const s = get();
      s.setSpeed(s.speed === 0 || s.holds.length > 0 ? s.resumeSpeed : 0);
    },

    async stepMonth() {
      const s = get();
      if (s.phase !== 'playing' || s.speed !== 0 || s.skipping || s.stepping || clock.busy) return;
      set({ stepping: true, autoPause: null });
      try {
        await clock.closeMonth();
      } finally {
        set({ stepping: false });
      }
      useTutorialStore.getState().notifyAction('step');
    },

    async skipToNextEvent() {
      const s = get();
      if (s.phase !== 'playing' || s.skipping || clock.busy) return;
      set({ skipping: true, autoPause: null, speed: 0 });
      applyClock();
      let stoppedBy: AutoPauseNotice | null = null;
      try {
        for (let months = 0; months < 12; months++) {
          clock.progress = 1;
          const before = get().hud;
          const result = await getEngine().call('advance', { months: 1 });
          clock.progress = 0;
          const events = await applyTick(result, before, true);
          if (get().phase !== 'playing' || get().outcomeShown) break;
          const decision = autoPauseDecision(events, useSettingsStore.getState().gameplay.autoPause);
          if (decision) {
            stoppedBy = { trigger: decision.trigger, message: decision.message };
            break;
          }
          if (events.some((e) => STOP_KINDS.has(e.kind))) {
            stoppedBy = { trigger: 'event', message: events.find((e) => STOP_KINDS.has(e.kind))?.message || 'Something happened' };
            break;
          }
        }
      } catch (error) {
        get().reportError(error);
      } finally {
        clock.progress = 0;
        set({ skipping: false, autoPause: stoppedBy });
        applyClock();
        void maybeAutosave(false);
      }
    },

    hold(reason) {
      if (get().holds.includes(reason)) return;
      set((s) => ({ holds: [...s.holds, reason] }));
      applyClock();
    },

    release(reason) {
      if (!get().holds.includes(reason)) return;
      set((s) => ({ holds: s.holds.filter((h) => h !== reason) }));
      applyClock();
    },

    clearAutoPause() {
      set({ autoPause: null });
    },

    async advanceMonth() {
      const before = get().hud;
      try {
        const result = await getEngine().call('advance', { months: 1 });
        await applyTick(result, before, false);
      } catch (error) {
        // A failed tick pauses the game instead of retrying every frame.
        set({ speed: 0 });
        applyClock();
        get().reportError(error);
      }
    },

    async refreshBuildings() {
      try {
        const buildings = await getEngine().call('buildings', {});
        set({ buildings });
      } catch (error) {
        console.warn('[store] buildings refresh failed', error);
      }
    },

    async construct(typeId, cityId) {
      try {
        const building = await getEngine().call('construct', { typeId, cityId });
        await get().syncAfterMutation();
        bus.emit('buildingPlaced', { buildingId: building.id, typeId, cityId });
        const cost = get().catalog?.buildingTypes.find((t) => t.id === typeId)?.constructionCost;
        if (cost) {
          fx.popup({ text: signedMoney(-cost), tone: 'loss', anchor: 'topbar.cash' });
          fx.worldPopup(building.id, signedMoney(-cost), 'loss', -cost);
        }
        useTutorialStore.getState().notifyAction(`construct:${typeId}`);
        useTutorialStore.getState().evaluate({ hud: get().hud, events: [] });
        return true;
      } catch (error) {
        get().reportError(error);
        return false;
      }
    },

    setActiveCity(cityId) {
      set({ activeCityId: cityId, selectedBuildingId: null });
    },

    selectBuilding(buildingId) {
      if (get().selectedBuildingId === buildingId) return;
      set({ selectedBuildingId: buildingId });
      bus.emit('buildingSelected', { buildingId });
    },

    pushFeed(event) {
      const item: FeedItem = { ...event, id: feedSeq++, at: perfNow(), monthIndex: get().hud?.monthIndex ?? 0 };
      set((s) => ({ feed: [...s.feed, item].slice(-FEED_CAP) }));
    },

    clearError() {
      set({ lastError: null });
    },

    async syncAfterMutation() {
      const client = getEngine();
      if (!hudStreaming || lastHudRevision < client.revision) {
        const snapshot = await client.call('snapshot');
        lastHudRevision = Math.max(lastHudRevision, snapshot.revision);
        setHud(snapshot);
      }
      set({ revision: client.revision });
      await get().refreshBuildings();
    },

    reportError(error) {
      const message = describe(error);
      set({ lastError: message });
      audio.ui('error');
      useAlertsStore.getState().notify({ severity: 'warning', title: 'That didn’t work', body: message, kind: 'error' });
    },

    async saveToSlot(slotId, options = {}) {
      const s = get();
      const store = getSaveStore();
      if (!store || !s.hud || !s.gameId) return null;
      const slotKind = options.slotKind ?? 'manual';
      if (!s.canSave) {
        if (!options.silent) {
          useAlertsStore.getState().notify({ kind: 'saveUnavailable', severity: 'warning', title: 'Saving is unavailable', body: 'This build of the engine cannot write saves yet.', record: false });
          audio.ui('error');
        }
        return null;
      }
      set({ saving: true });
      try {
        const thumbnail = await captureThumbnail();
        const meta = await store.save(slotId, {
          slotKind,
          label: options.label ?? null,
          gameId: s.gameId,
          hud: s.hud,
          thumbnail,
          playTimeSec: s.playTimeSec,
          sidecar: sidecar(),
        });
        set({ lastSave: { slotId, monthIndex: s.hud.monthIndex, at: Date.now() }, savedRevision: getEngine().revision });
        void useSavesStore.getState().refresh();
        bus.emit('saved', { slotId, slotKind });
        if (!options.silent) {
          useAlertsStore.getState().notify({
            kind: 'saved',
            severity: 'success',
            title: slotKind === 'quicksave' ? 'Quicksaved' : 'Game saved',
            body: `${meta.companyName} · ${meta.date.month}/${meta.date.year}`,
            record: false,
          });
          audio.ui('confirm');
        }
        return meta;
      } catch (error) {
        useAlertsStore.getState().notify({ kind: 'saveFailed', severity: 'critical', title: 'Save failed', body: describe(error) });
        audio.ui('error');
        return null;
      } finally {
        set({ saving: false });
      }
    },

    saveNew(label) {
      return get().saveToSlot(slotIds.manual(), { slotKind: 'manual', label: label ?? null });
    },

    async quickSave() {
      const gameId = get().gameId;
      if (!gameId || get().phase !== 'playing') return;
      await get().saveToSlot(slotIds.quick(gameId), { slotKind: 'quicksave' });
    },

    async quickLoad() {
      const gameId = get().gameId;
      if (!gameId) return;
      await useSavesStore.getState().refresh();
      const slots = useSavesStore.getState().slots;
      const own = slots.find((m) => m.slotId === slotIds.quick(gameId));
      const target = own ?? slots.find((m) => m.slotKind === 'quicksave');
      if (!target) {
        useAlertsStore.getState().notify({ kind: 'noQuicksave', severity: 'info', title: 'No quicksave yet', body: 'Press Ctrl/⌘+S to quicksave.', record: false });
        return;
      }
      const answer = await useUiStore.getState().confirm({
        title: 'Load quicksave?',
        body: `${target.companyName} · ${target.date.month}/${target.date.year}. Progress since then will be lost.`,
        confirmLabel: 'Load',
        tone: 'danger',
      });
      if (answer === 'confirm') await get().loadSlot(target.slotId);
    },

    async loadSlot(slotId) {
      const store = getSaveStore();
      if (!store) return false;
      if (!get().canSave) {
        useAlertsStore.getState().notify({ kind: 'loadUnavailable', severity: 'warning', title: 'Loading is unavailable', body: 'This build of the engine cannot read saves yet.', record: false });
        return false;
      }
      const from = get().phase;
      set({ phase: 'loading', loadingTarget: { kind: 'load', slotId } });
      applyClock();
      try {
        const loaded = await store.load(slotId);
        resetPresentation();
        lastHudRevision = loaded.snapshot.revision;
        const hud = setHud(loaded.snapshot);
        const record = recordFromHud(hud);
        const history = loaded.sidecar?.history?.length ? loaded.sidecar.history : record ? [record] : [];
        useTutorialStore.getState().restore(loaded.sidecar?.tutorial);
        const gameId = hud.gameId ?? loaded.meta.gameId;
        set({
          gameId,
          history,
          revision: getEngine().revision,
          savedRevision: getEngine().revision,
          lastSave: { slotId, monthIndex: hud.monthIndex, at: Date.now() },
          playTimeSec: loaded.meta.playTimeSec,
          outcomeShown: hud.outcome.status !== 'playing' ? `${gameId}:${hud.outcome.status}` : null,
          resumeSpeed: useSettingsStore.getState().gameplay.defaultSpeed,
        });
        await get().refreshBuildings();
        set({ activeCityId: pickCity(get().buildings, hud.player?.id, loaded.sidecar?.cityId), phase: 'playing' });
        applyClock();
        bus.emit('gameStarted', loaded.snapshot);
        if (!loaded.sidecar?.history?.length) void fetchHistory(hud);
        useAlertsStore.getState().notify({ kind: 'loaded', severity: 'success', title: 'Game loaded', body: `${loaded.meta.companyName} · ${loaded.meta.date.month}/${loaded.meta.date.year}`, record: false });
        return true;
      } catch (error) {
        // The engine keeps the previous game when a load fails before attaching (bridge LoadGame validates first).
        set({ phase: from === 'playing' ? 'playing' : from === 'loading' ? 'title' : from });
        applyClock();
        useAlertsStore.getState().notify({ kind: 'loadFailed', severity: 'critical', title: 'Could not load that save', body: describe(error) });
        audio.ui('error');
        return false;
      }
    },

    quitToTitle() {
      resetPresentation();
      set({ phase: 'title', snapshot: null, hud: null, buildings: [], gameId: null, lastSave: null, activeCityId: null });
      applyClock();
      void useSavesStore.getState().refresh();
    },

    hasUnsavedProgress() {
      const s = get();
      if (!s.hud || !engine) return false;
      return engine.revision !== s.savedRevision;
    },

    addPlayTime(seconds) {
      if (get().phase === 'playing' && seconds > 0) set((s) => ({ playTimeSec: s.playTimeSec + seconds }));
    },
  };
});

/** The player's company summary from the latest snapshot. */
export function selectPlayer(state: GameState): CompanySummaryDto | undefined {
  const snap = state.snapshot;
  return snap?.companies.find((c) => c.id === snap.playerId);
}

/** Effective speed index the clock is running at (0 while paused or held). */
export function selectEffectiveSpeed(state: Pick<GameState, 'speed' | 'holds' | 'skipping' | 'phase'>): Speed {
  return state.holds.length > 0 || state.skipping || state.phase !== 'playing' ? 0 : state.speed;
}
