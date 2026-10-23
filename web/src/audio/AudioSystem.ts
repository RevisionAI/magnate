// The audio runtime: owns the engine graph, asset loading, SFX, music, ambience, positional emitters
// and the voice queue, and connects them to the app (game/events bus + game store). Presentation-only:
// it never calls a mutating bridge method and its randomness never reaches the engine (audio-plan §4.1).

import * as THREE from 'three';
import { bus, type GameBusEvents } from '@/game/events';
import { SECONDS_PER_MONTH } from '@/game/clock';
import { useGameStore } from '@/state/gameStore';
import { currentTutorialStep, useTutorialStore } from '@/state/tutorialStore';
import type { GameEventDto, SnapshotDto, TickResultDto } from '@/bridge/protocol';
import { AudioEngine, type MusicTone } from './core/AudioEngine';
import { installLifecycle, type LifecycleHandle } from './core/lifecycle';
import { AssetLoader } from './assets/AssetLoader';
import { getAudioSettings, useAudioSettings } from './settings';
import { SfxPlayer, type SfxPlayOptions, type Vec3 } from './sfx/SfxPlayer';
import { ALL_RECIPES } from './sfx/catalog';
import { ProceduralBank } from './synth/ProceduralBank';
import { prepareNoise } from './synth/offthread';
import { MusicDirector } from './music/MusicDirector';
import { normalizeMusicState, type Climate, type MusicInputs, type MusicState } from './music/musicRules';
import { AmbienceDirector } from './ambience/AmbienceDirector';
import { zoom01FromDistance, type AudioFrame } from './ambience/ambienceModel';
import { EmitterManager, type TruckSource } from './world/EmitterManager';
import type { EmitterSource } from './world/emitterModel';
import { ListenerRig } from './world/ListenerRig';
import { VoiceQueue, type SubtitleEvent, type VoiceRequestOptions } from './voice/VoiceQueue';
import { VoicePlayer } from './voice/VoicePlayer';
import { resolveVoiceLine, VO_LINES } from './voice/voiceLines';
import { AudioEventRouter, type AudioAction, type RouterContext, type RoutedEvent } from './routing/AudioEventRouter';
import { AudioTrace, type TraceRecord, type TraceSummary } from './debug/AudioTrace';

/** Plot edge in metres (web/src/scene/units.ts PLOT_SIZE; D12: 24 m plots). */
const DEFAULT_PLOT = 24;

export interface SceneAudioHostLike {
  readonly camera: THREE.Camera;
  readonly scene: THREE.Scene;
  /** Orbit/controls target on the ground (optional; else the camera ray's ground hit). */
  getTarget?: () => THREE.Vector3 | { x: number; y: number; z: number } | null;
  /** Plot size in metres (default 24). */
  plotSize?: number;
}

/** Speed value on the bus → multiplier (0, 1, 2, 4, 8). Index semantics follow game/clock.ts (1× = 12 s/month). */
export function speedMultiplier(speed: number): number {
  if (speed <= 0) return 0;
  const table = SECONDS_PER_MONTH as readonly number[];
  if (Number.isInteger(speed) && speed < table.length && Number.isFinite(table[speed] as number)) {
    return Math.round((12 / (table[speed] as number)) * 100) / 100;
  }
  return speed;
}

const PLAYER_RELEVANT = new Set(['success', 'warning', 'danger', 'major']);

/** Bus topics the audio side publishes (`subtitle`, declared in game/events.ts since the Wave 2 merge). */
export type AudioBusEvents = Pick<GameBusEvents, 'subtitle'>;
const audioBus = bus;

/** Keys whose no-op decisions are not worth a trace record (they arrive in bulk). */
const QUIET_KEYS = new Set(['bus.ui', 'bus.buildingSelected', 'buildingSales', 'exportSales', 'priceEffectEnded', 'autosaved', 'slotConfigured', 'priceChanged']);

/** Seconds a fresh first building may sit paused before the "press play" nudge (audio-plan §5.2 #6). */
const PRESS_PLAY_AFTER_MS = 10_000;

/** QA handle (playtests, tools/audio/game-audio-trace.mjs). */
export interface MagnateAudioQa {
  trace(sinceSeq?: number): TraceRecord[];
  summary(sinceSeq?: number): TraceSummary;
  lastSeq(): number;
  debug(): Record<string, unknown>;
  audition(lineId: string): Promise<number>;
}

declare global {
  interface Window {
    __magnateAudio?: MagnateAudioQa;
  }
}

export class AudioSystem {
  readonly engine: AudioEngine;
  readonly assets: AssetLoader;
  readonly sfx: SfxPlayer;
  readonly bank: ProceduralBank;
  readonly music: MusicDirector;
  readonly ambience: AmbienceDirector;
  readonly emitters: EmitterManager;
  readonly voice: VoiceQueue;
  readonly voicePlayer: VoicePlayer;
  readonly router: AudioEventRouter;
  /** Decision trace of the router, SFX, voice queue and music director. */
  readonly trace: AudioTrace;
  private lifecycle: LifecycleHandle | null = null;
  private rig: ListenerRig | null = null;
  private host: SceneAudioHostLike | null = null;
  private plotSize = DEFAULT_PLOT;
  private readonly unsubs: (() => void)[] = [];
  private readonly subtitleListeners = new Set<(e: SubtitleEvent) => void>();
  private readonly tickEvents = new WeakSet<object>();
  private rendererFrameAt = -1e12;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private speedMult = 0;
  private gameMonth = 0;
  private cashHistory: number[] = [];
  private revenueHistory: number[] = [];
  private recentEvents: number[] = [];
  private recentBuildMonths: number[] = [];
  private warningUntilMonth = -1;
  private tensionUntilMonth = -1;
  private climate: Climate = 'normal';
  private outcome: MusicInputs['outcome'] = 'playing';
  private insolvencyLeft: number | null = null;
  private drawdown = 0;
  private startMonth = 0;
  /** Context time the last news sting started (the router's SFX or the anchor's own). */
  private lastStingAt = -1e9;
  private heldBefore = false;
  private lastGameKey = '';
  private lastGameAt = -1e12;
  /** The manifest is loaded: a line's take can be resolved (before that, VO requests wait for it). */
  private manifestReady = false;
  private pressPlayTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeadlineMonths: number | null = null;
  private started = false;
  private disposed = false;

  constructor(ctx?: AudioContext) {
    this.trace = new AudioTrace(() => (useGameStore.getState().phase === 'playing' ? this.gameMonth : -1), 3000);
    this.engine = new AudioEngine(ctx);
    this.assets = new AssetLoader(this.engine.ctx);
    this.sfx = new SfxPlayer({ engine: this.engine, assets: this.assets, settings: getAudioSettings });
    this.bank = new ProceduralBank(this.engine.ctx, this.assets);
    this.music = new MusicDirector({
      engine: this.engine,
      assets: this.assets,
      ambienceDim: (db) => this.ambience?.dim(db),
      reduceSudden: () => getAudioSettings().reduceSudden,
      onChange: (what, value, detail) => this.trace.add('music', value, what, detail),
    });
    this.emitters = new EmitterManager({
      engine: this.engine,
      bank: this.bank,
      plotSize: DEFAULT_PLOT,
      listener: () => (this.rig ? { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z } : null),
      timeOfDay: () => this.ambience?.getFrame().timeOfDay ?? null,
    });
    this.ambience = new AmbienceDirector({
      engine: this.engine,
      bank: this.bank,
      sfx: this.sfx,
      fast: () => this.speedMult >= 4,
      nearby: (f) => this.emitters.nearby(f, this.focusRadius()),
      locate: (where, f) => this.emitters.locate(where, f, this.focusRadius()),
    });
    this.voicePlayer = new VoicePlayer({
      engine: this.engine,
      assets: this.assets,
      newsSting: () => this.newsSting(),
    });
    this.voice = new VoiceQueue({
      now: () => performance.now(),
      schedule: (fn, ms) => void setTimeout(fn, ms),
      settings: () => getAudioSettings(),
      fast: () => this.speedMult >= 4,
      canPlay: () => this.engine.ctx.state === 'running',
      line: (id) => resolveVoiceLine(id, this.assets.manifest),
      play: (lines, onEnded) => this.voicePlayer.play(lines, onEnded),
      subtitle: (e) => this.emitSubtitle(e),
      trace: (ev) => this.trace.add('vo', ev.key, ev.action, `P${ev.p}${ev.reason ? ` ${ev.reason}` : ''}`),
    });
    this.router = new AudioEventRouter({
      now: () => performance.now(),
      gameMonth: () => this.gameMonth,
      speed: () => this.speedMult,
      context: () => this.routerContext(),
      buildingCategory: (typeId) => useGameStore.getState().catalog?.buildingTypes.find((t) => t.id === typeId)?.category,
    });
  }

  /** Install lifecycle, settings and app subscriptions; load the manifest; start title music. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.engine.applySettings(getAudioSettings());
    void this.engine.calibrateLimiter();
    void prepareNoise(this.engine.ctx.sampleRate, 4); // live recipes' noise, made off the main thread
    this.unsubs.push(
      useAudioSettings.subscribe((s, prev) => {
        this.engine.applySettings(s);
        if (s.iosIgnoreSilentSwitch !== prev.iosIgnoreSilentSwitch) this.lifecycle?.refresh();
      }),
    );
    this.lifecycle = installLifecycle(this.engine.ctx, () => this.onRunning(), getAudioSettings);
    this.subscribeApp();
    // started after the game did (the first gesture was the "Play" click itself, or a load): catch up
    const st = useGameStore.getState();
    if ((st.phase === 'playing' || st.phase === 'starting') && st.snapshot) this.onGameStarted(st.snapshot);
    void this.assets.init().then(async () => {
      if (this.disposed) return;
      this.manifestReady = true;
      this.syncPhase();
      await this.assets.preload('title');
      await this.assets.preload('game', ['sfx']);
    });
    this.frameTimer = setInterval(() => this.cameraFrame(), 100);
    if (typeof window !== 'undefined') {
      window.__magnateAudio = {
        trace: (since) => this.trace.records(since),
        summary: (since) => this.trace.summary(since),
        lastSeq: () => this.trace.lastSeq,
        debug: () => this.debugState(),
        audition: (id) => this.audition(id),
      };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    if (this.pressPlayTimer) clearTimeout(this.pressPlayTimer);
    if (typeof window !== 'undefined' && window.__magnateAudio) delete window.__magnateAudio;
    this.lifecycle?.dispose();
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.detachScene();
    this.voice.clear();
    this.music.dispose();
    this.ambience.dispose();
    this.emitters.dispose();
    this.sfx.stopAll();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------------------------- public

  play(id: string, opts?: SfxPlayOptions): boolean {
    return this.sfx.play(id, opts);
  }

  requestVoice(ids: string | string[], opts?: VoiceRequestOptions): boolean {
    return this.voice.request(ids, opts);
  }

  onSubtitle(listener: (e: SubtitleEvent) => void): () => void {
    this.subtitleListeners.add(listener);
    return () => this.subtitleListeners.delete(listener);
  }

  /**
   * Play one line now, outside the queue rules (AudioLab voice browser, QA): clears the queue, plays
   * the take (anchor lines through the broadcast chain after the news sting) and emits its subtitle.
   * Resolves to the seconds of audio (0 when the line has no take).
   */
  async audition(lineId: string): Promise<number> {
    await this.assets.init();
    const line = resolveVoiceLine(lineId, this.assets.manifest);
    if (!line?.take) return 0;
    this.voice.clear();
    const handle = await this.voicePlayer.play([line], () => undefined);
    if (!handle) return 0;
    this.trace.add('vo', line.id, 'audition', `${handle.duration.toFixed(2)} s`);
    this.emitSubtitle({
      id: line.id,
      text: line.text,
      voice: line.voice,
      priority: line.priority,
      showSec: Math.max((handle.lineDurations[0] ?? 0) + 1, 3),
      voiced: true,
      delaySec: handle.startOffsets[0] ?? 0,
      durationSec: handle.lineDurations[0] ?? 0,
    });
    return handle.duration;
  }

  /** Summary for the AudioLab / QA handle. */
  debugState(): Record<string, unknown> {
    return {
      context: { state: this.engine.ctx.state, sampleRate: this.engine.ctx.sampleRate },
      format: this.assets.format,
      speed: this.speedMult,
      gameMonth: this.gameMonth,
      music: this.music.debug(),
      voice: this.voice.state,
      voLines: { registry: VO_LINES.length, voiced: VO_LINES.filter((l) => this.assets.manifest.has(`vo.${l.id}`)).length },
      router: { context: this.routerContext(), streak: this.router.profitStreak },
    };
  }

  setMusicState(state: string | null): void {
    this.music.force(state === null ? null : normalizeMusicState(state));
  }

  setMusicTone(mode: MusicTone): void {
    this.engine.setMusicTone(mode);
  }

  /** Renderer's AudioFrame (10 Hz). Takes precedence over the camera-derived frame for 1 s. */
  setFrame(frame: Partial<AudioFrame>): void {
    this.rendererFrameAt = performance.now();
    this.ambience.setFrame(frame);
  }

  setEmitters(list: EmitterSource[]): void {
    this.emitters.setSources(list);
  }

  upsertEmitters(list: EmitterSource[], removedIds?: number[]): void {
    this.emitters.upsertSources(list, removedIds);
  }

  setTrucks(list: TruckSource[]): void {
    this.emitters.setTrucks(list);
  }

  attachScene(host: SceneAudioHostLike | null): void {
    if (!host) return this.detachScene();
    if (this.host === host) return;
    this.detachScene();
    this.host = host;
    this.plotSize = host.plotSize ?? DEFAULT_PLOT;
    // one spatial listener per context: adopt any THREE.AudioListener a module already put on the camera
    const existing: THREE.AudioListener[] = [];
    host.camera.traverse((o) => {
      if (o instanceof THREE.AudioListener && o !== this.engine.listener) existing.push(o);
    });
    for (const l of existing) this.engine.adoptListener(l);
    this.rig = new ListenerRig(host.camera, this.engine.listener, host.getTarget);
    host.scene.add(this.rig);
  }

  detachScene(): void {
    if (this.rig) {
      this.rig.remove(this.engine.listener);
      this.rig.removeFromParent();
    }
    this.rig = null;
    this.host = null;
  }

  get hasScene(): boolean {
    return this.rig !== null;
  }

  /** Listener world position (for tests and the AudioLab). */
  listenerPosition(): Vec3 | null {
    return this.rig ? { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z } : null;
  }

  // ------------------------------------------------------------------------------------- app wiring

  private subscribeApp(): void {
    this.unsubs.push(
      bus.on('gameStarted', (snap) => this.onGameStarted(snap)),
      bus.on('tick', (result) => this.onTick(result)),
      bus.on('gameEvent', (e) => {
        if (this.tickEvents.has(e)) return; // already routed as part of its month close
        this.handle(e.kind, e as RoutedEvent, false);
      }),
      bus.on('buildingPlaced', (p) => {
        this.handle('bus.buildingPlaced', { buildingId: p.buildingId, typeId: p.typeId, cityId: p.cityId }, false);
        this.armPressPlay();
      }),
      bus.on('panelChanged', (p) => this.handle('bus.panelChanged', { drawer: p.drawer, overlay: p.overlay }, false)),
      bus.on('buildingSelected', (p) => {
        if (p.buildingId === null) return;
        const b = useGameStore.getState().buildings.find((x) => x.id === p.buildingId);
        this.handle('bus.buildingSelected', { buildingId: p.buildingId, category: b?.category ?? this.emitters.getSource(p.buildingId)?.category }, false);
      }),
      bus.on('ui', (p) => this.handle('bus.ui', { cue: p.cue }, false)),
      bus.on('speedChanged', (p) => {
        this.speedMult = typeof p.multiplier === 'number' && Number.isFinite(p.multiplier) ? p.multiplier : speedMultiplier(p.speed);
        // a menu holding time (or releasing it) is not a transport change: no pause/resume sound
        const held = !!p.held || this.heldBefore;
        this.heldBefore = !!p.held;
        this.handle('bus.speedChanged', { speed: this.speedMult, held }, false);
        this.music.setInputs({ speed: this.speedMult });
        this.voice.pump();
      }),
      useGameStore.subscribe((s, prev) => {
        if (s.phase !== prev.phase || s.activeCityId !== prev.activeCityId) this.syncPhase();
      }),
      useTutorialStore.subscribe((s, prev) => this.onTutorial(s, prev)),
    );
  }

  /** Game state for the router's conditions (player buildings, months played, runway). */
  private routerContext(): RouterContext {
    const st = useGameStore.getState();
    const snap = st.snapshot;
    const player = snap?.companies.find((c) => c.id === snap.playerId);
    return {
      buildings: snap?.player?.buildings ?? player?.buildingCount ?? 0,
      monthsElapsed: snap?.elapsedMonths ?? Math.max(0, this.gameMonth - this.startMonth),
      runway: snap?.player?.cashRunwayMonths ?? null,
      tutorialScenario: /tutorial/i.test(snap?.scenario?.id ?? ''),
    };
  }

  /** A tutorial step became current: voice its line once per step id per save (UX §6.17). */
  private onTutorial(
    s: ReturnType<typeof useTutorialStore.getState>,
    prev: ReturnType<typeof useTutorialStore.getState>,
  ): void {
    const step = currentTutorialStep(s);
    const before = currentTutorialStep(prev);
    let stepId: string | null = null;
    let vo: string | undefined;
    if (step && step.id !== before?.id) {
      stepId = step.id;
      vo = step.vo;
    } else if (s.finished && !prev.finished && s.script) {
      stepId = 'complete'; // chapter complete
    }
    if (!stepId || s.voPlayed.includes(stepId)) return;
    const actions = this.router.routeTutorial(stepId, vo);
    this.trace.add('event', `tutorial:${stepId}`, actions.length ? 'rule' : 'none', this.router.lastNotes.join('; '));
    if (!actions.length) return;
    useTutorialStore.getState().markVoPlayed(stepId);
    this.execute(actions);
  }

  /** First building placed while paused in the first month: nudge "press play" after 10 s. */
  private armPressPlay(): void {
    if (this.pressPlayTimer) clearTimeout(this.pressPlayTimer);
    const ctx = this.routerContext();
    if (this.speedMult > 0 || ctx.monthsElapsed > 0) return;
    this.pressPlayTimer = setTimeout(() => {
      this.pressPlayTimer = null;
      const now = this.routerContext();
      if (this.disposed || this.speedMult > 0 || now.monthsElapsed > 0 || useGameStore.getState().phase !== 'playing') return;
      this.handle('client.pausedAfterBuild', {}, false);
    }, PRESS_PLAY_AFTER_MS);
  }

  private syncPhase(): void {
    const st = useGameStore.getState();
    const inGame = st.phase === 'playing' || st.phase === 'starting';
    this.ambience.setActive(st.phase === 'playing');
    this.emitters.setEnabled(st.phase === 'playing');
    if (st.phase === 'bootFailed') return;
    this.music.setInputs({ inGame });
    if (inGame && st.activeCityId) {
      const city = st.catalog?.cities.find((c) => c.id === st.activeCityId);
      this.ambience.setFrame({ cityId: st.activeCityId, coastal: city?.coastal ?? false });
    }
  }

  private onRunning(): void {
    this.music.onUnlock();
    this.voice.pump();
  }

  private onGameStarted(snap: SnapshotDto): void {
    // the late-start catch-up and the store's own gameStarted can both arrive for one game
    const key = `${snap.gameId ?? ''}:${snap.revision ?? ''}:${snap.monthIndex ?? ''}`;
    const now = performance.now();
    if (key === this.lastGameKey && now - this.lastGameAt < 3000) return;
    this.lastGameKey = key;
    this.lastGameAt = now;
    this.voice.resetGame();
    this.router.resetGame();
    this.trace.add('note', 'gameStarted', 'reset', `month ${snap.monthIndex ?? 0}`);
    this.lastDeadlineMonths = null;
    if (this.pressPlayTimer) clearTimeout(this.pressPlayTimer);
    this.music.resetForNewGame();
    this.cashHistory = [];
    this.revenueHistory = [];
    this.recentEvents = [];
    this.recentBuildMonths = [];
    this.warningUntilMonth = -1;
    this.tensionUntilMonth = -1;
    this.climate = 'normal';
    this.outcome = 'playing';
    this.insolvencyLeft = null;
    this.drawdown = 0;
    this.gameMonth = snap.monthIndex ?? 0;
    this.startMonth = this.gameMonth;
    this.syncPhase();
    this.music.setInputs({ ...this.inputsFromSnapshot(snap), inGame: true, outcome: 'playing' });
    void this.assets.preload('game');
    this.handle('bus.gameStarted', {}, false);
  }

  private onTick(result: TickResultDto): void {
    for (const e of result.events) this.tickEvents.add(e);
    const snap = result.snapshot;
    this.gameMonth = snap.monthIndex ?? this.gameMonth + result.months;
    const player = snap.companies.find((c) => c.id === snap.playerId);
    if (player) {
      this.cashHistory.push(player.cash);
      this.revenueHistory.push(player.revenueThisMonth);
      if (this.cashHistory.length > 8) this.cashHistory.shift();
      if (this.revenueHistory.length > 8) this.revenueHistory.shift();
    }
    // route the close's events as one batch (≤ 1 VO per close; at 4×/8× ≤ 1 close sound + 2 alerts)
    this.voice.beginCloseBatch();
    const actions: AudioAction[] = [];
    for (const e of result.events) actions.push(...this.collect(e.kind, e as RoutedEvent, true));
    // client moment: the scenario deadline is 12 or 3 months away
    const deadline = snap.scenario?.monthsRemaining ?? null;
    if (deadline !== null && deadline !== this.lastDeadlineMonths && (deadline === 12 || deadline === 3))
      actions.push(...this.collect('client.deadline', { months: deadline }, true));
    this.lastDeadlineMonths = deadline;
    this.execute(this.limitCloseSfx(actions));
    this.voice.endCloseBatch();
    this.music.monthClosed(this.inputsFromSnapshot(snap));
  }

  /** Route one event and execute its actions immediately. */
  private handle(key: string, e: RoutedEvent, fromClose: boolean): void {
    this.execute(this.collect(key, e, fromClose));
  }

  private collect(key: string, e: RoutedEvent, fromClose: boolean): AudioAction[] {
    this.noteEvent(key, e);
    const actions = this.router.route(key, e, { fromClose });
    if (actions.length || !QUIET_KEYS.has(key)) {
      const what = actions
        .map((a) => (a.type === 'sfx' ? `sfx:${a.id}` : a.type === 'vo' ? `vo:${a.lines.join('>')}` : `music:${a.op}${'value' in a ? `=${a.value}` : ''}`))
        .join(' ');
      const notes = this.router.lastNotes.join('; ');
      this.trace.add('event', key, actions.length ? 'rule' : 'none', [what, notes].filter(Boolean).join(' | '));
    }
    return actions;
  }

  /** §4.10: at 4×/8× a close plays one month-close sound plus the two highest-severity alerts. */
  private limitCloseSfx(actions: AudioAction[]): AudioAction[] {
    if (this.speedMult < 4) return actions;
    const rank = (id: string) => (id === 'alert_critical' ? 0 : /alert|warning|heartbeat|stockout|rival/.test(id) ? 1 : 9);
    const sfx = actions.filter((a) => a.type === 'sfx') as Extract<AudioAction, { type: 'sfx' }>[];
    const close = sfx.find((a) => a.id.startsWith('month_close'));
    const alerts = sfx.filter((a) => rank(a.id) < 9).sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 2);
    const keep = new Set<AudioAction>([...(close ? [close] : []), ...alerts]);
    return actions.filter((a) => {
      if (a.type !== 'sfx' || keep.has(a)) return true;
      this.trace.add('sfx', a.id, 'suppressed', '4×/8× close: 1 close sound + 2 alerts');
      return false;
    });
  }

  /**
   * The anchor's news sting (audio-plan §4.11: the line enters 0.3 s before the sting ends). If the
   * event's own SFX already started one (Notable news), the line rides that sting instead of a second.
   * Returns the seconds of sting still to come.
   */
  private newsSting(): number {
    const ctx = this.engine.ctx;
    const len = this.stingSeconds();
    const elapsed = ctx.currentTime - this.lastStingAt;
    if (elapsed >= 0 && elapsed < len - 0.3) return len - elapsed;
    if (!this.sfx.play('news_sting', { force: true })) return 0;
    this.lastStingAt = ctx.currentTime;
    return len;
  }

  private stingSeconds(): number {
    return this.assets.manifest.get('news_sting')?.variants[0]?.durationSec ?? ALL_RECIPES.news_sting?.dur ?? 2.5;
  }

  private execute(actions: AudioAction[]): void {
    for (const a of actions) {
      if (a.type === 'sfx') {
        if (a.id === 'news_sting') this.lastStingAt = this.engine.ctx.currentTime + (a.delay ?? 0);
        const at = a.atBuilding !== undefined ? this.buildingPosition(a.atBuilding) : undefined;
        const ok = this.sfx.play(a.id, { delay: a.delay, detuneCents: a.detuneCents, levelDb: a.levelDb, params: a.params, at: at ?? undefined, refDistance: 60 });
        this.trace.add('sfx', a.id, ok ? 'play' : 'blocked', ok ? (at ? 'positional' : undefined) : 'cooldown / polyphony / locked');
      } else if (a.type === 'vo') {
        const req = () =>
          this.voice.request(a.lines, {
            fromClose: a.fromClose,
            rank: a.rank,
            scenarioEnd: a.scenarioEnd,
            hint: a.hint,
            priority: a.priority,
            tutorial: a.tutorial,
          });
        if (!this.manifestReady) {
          // the takes are unknown until the manifest loads (the first click starts both): wait for it
          this.trace.add('vo', a.lines.join('>'), 'deferred', 'manifest loading');
          void this.assets.init().then(() => {
            if (this.disposed) return;
            if (a.delay) setTimeout(req, a.delay * 1000);
            else req();
          });
        } else if (a.delay) setTimeout(req, a.delay * 1000);
        else req();
      } else {
        this.music_(a);
      }
    }
  }

  private music_(a: Extract<AudioAction, { type: 'music' }>): void {
    switch (a.op) {
      case 'state':
        if (a.value === 'victory') this.outcome = 'won';
        if (a.value === 'defeat') this.outcome = 'lost';
        this.music.setInputs({ outcome: this.outcome });
        break;
      case 'stinger': {
        const ok = this.music.playStinger(a.value);
        this.trace.add('music', a.value, ok ? 'stinger' : 'stinger-skipped', ok ? undefined : '≤ 1 per 20 s / locked');
        break;
      }
      case 'tone':
        this.engine.setMusicTone(a.value);
        break;
      case 'climate':
        this.climate = (['panic', 'recession', 'normal', 'prosperous', 'boom'].includes(a.value) ? a.value : 'normal') as Climate;
        this.music.setInputs({ climate: this.climate });
        break;
      case 'warning':
        this.warningUntilMonth = this.gameMonth + 2;
        this.music.setInputs({ warningActive: true });
        break;
      case 'tension':
        this.tensionUntilMonth = this.gameMonth + 1;
        this.music.setInputs({ warningActive: true });
        break;
      case 'drawdown':
        this.drawdown = 0.4;
        break;
      case 'intensity':
        this.recentBuildMonths.push(this.gameMonth);
        this.music.setInputs({ underConstruction: this.underConstruction() });
        break;
      case 'evaluate':
        this.music.evaluate();
        break;
    }
  }

  private noteEvent(key: string, e: RoutedEvent): void {
    const now = performance.now();
    if (key.startsWith('bus.')) return;
    if (PLAYER_RELEVANT.has(e.severity ?? '') && e.isPlayer !== false && key !== 'monthClosed') this.recentEvents.push(now);
    this.recentEvents = this.recentEvents.filter((t) => now - t < 120_000);
    if (key === 'bankruptcyWarning' || key === 'insolvencyWarning') this.insolvencyLeft = e.months ?? 3;
    if (key === 'scenarioWon') this.outcome = 'won';
    if (key === 'scenarioLost') this.outcome = 'lost';
  }

  private underConstruction(): number {
    this.recentBuildMonths = this.recentBuildMonths.filter((m) => this.gameMonth - m < 3);
    return this.recentBuildMonths.length;
  }

  /** Music inputs from the HUD snapshot (bridge-spec §5.3 fields when present, client estimates otherwise). */
  private inputsFromSnapshot(snap: SnapshotDto): Partial<MusicInputs> {
    const s = snap as SnapshotDto & {
      player?: { cash?: number; cashRunwayMonths?: number | null; buildings?: number };
      outcome?: { status?: string };
      alerts?: { bankruptcyInMonths?: number | null; lowCash?: boolean };
      elapsedMonths?: number;
    };
    const player = snap.companies.find((c) => c.id === snap.playerId);
    const cash = s.player?.cash ?? player?.cash ?? 0;
    let runway: number | null = null;
    if (s.player && 'cashRunwayMonths' in s.player) runway = s.player.cashRunwayMonths ?? null;
    else if (this.cashHistory.length >= 2) {
      const deltas: number[] = [];
      for (let i = Math.max(1, this.cashHistory.length - 3); i < this.cashHistory.length; i++)
        deltas.push((this.cashHistory[i] as number) - (this.cashHistory[i - 1] as number));
      const avg = deltas.reduce((x, y) => x + y, 0) / deltas.length;
      runway = avg < 0 ? Math.max(0, cash) / -avg : null;
    }
    const rev = this.revenueHistory;
    let revQoQ = 0;
    if (rev.length >= 6) {
      const last = rev.slice(-3).reduce((x, y) => x + y, 0);
      const prev = rev.slice(-6, -3).reduce((x, y) => x + y, 0);
      revQoQ = prev > 0 ? last / prev - 1 : last > 0 ? 1 : 0;
    }
    const status = s.outcome?.status;
    if (status === 'won' || status === 'lost') this.outcome = status;
    const insolvency = s.alerts && 'bankruptcyInMonths' in s.alerts ? (s.alerts.bankruptcyInMonths ?? null) : cash < 0 ? this.insolvencyLeft : null;
    if (cash >= 0 && !(s.alerts && s.alerts.bankruptcyInMonths)) this.insolvencyLeft = null;
    const warning = this.gameMonth <= this.warningUntilMonth || this.gameMonth <= this.tensionUntilMonth || !!s.alerts?.lowCash || cash < 0;
    return {
      cash,
      runway,
      insolvencyMonthsLeft: insolvency,
      revQoQ,
      buildings: s.player?.buildings ?? player?.buildingCount ?? 0,
      events2m: this.recentEvents.length,
      speed: this.speedMult,
      monthsElapsed: s.elapsedMonths ?? Math.max(0, this.gameMonth - this.startMonth),
      warningActive: warning,
      climate: this.climate,
      outcome: this.outcome,
      drawdown: this.drawdown,
      underConstruction: this.underConstruction(),
    };
  }

  private buildingPosition(id: number): Vec3 | null {
    const s = this.emitters.getSource(id);
    return s ? { x: s.x, y: (s.y ?? 0) + 4, z: s.z } : null;
  }

  private focusRadius(): number {
    const h = this.host?.camera.position.y ?? 300;
    return Math.max(6 * this.plotSize, 0.8 * h);
  }

  /** 10 Hz: derive the AudioFrame from the camera unless the renderer pushed one recently. */
  private cameraFrame(): void {
    if (!this.rig || performance.now() - this.rendererFrameAt < 1000) return;
    const target = this.rig.target();
    const st = useGameStore.getState();
    const month = (st.snapshot?.date.month ?? 6) - 1;
    this.ambience.setFrame({
      zoom01: zoom01FromDistance(this.rig.distance()),
      focus: { x: target.x, z: target.z },
      month,
    });
  }

  /** Voiced lines respect the Subtitles setting; unvoiced advisor toasts are the text channel and always show. */
  private emitSubtitle(e: SubtitleEvent): void {
    this.trace.add('subtitle', e.id, e.voiced ? 'voiced' : 'toast', e.text);
    if (e.voiced && !getAudioSettings().subtitles) return;
    audioBus.emit('subtitle', e);
    for (const l of this.subtitleListeners) {
      try {
        l(e);
      } catch (err) {
        console.error('[audio] subtitle listener failed', err);
      }
    }
  }
}

export type { GameEventDto, MusicState };
