// AudioLab panels: mixer + meters, every SFX id, music state switcher, ambience frame sliders,
// positional emitters on a top view, the voice queue, synthetic game events, and the level report.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import clsx from 'clsx';
import { audio, useAudioSettings, type AudioSettings } from '@/audio';
import { bus } from '@/game/events';
import { SFX, sfxIdsByClass, ALL_RECIPES } from '@/audio/sfx/catalog';
import { MUSIC_STATES, type MusicState } from '@/audio/music/musicRules';
import { BED_IDS, CITY_PRESETS, bedGains, type AudioFrame } from '@/audio/ambience/ambienceModel';
import { VO_LINES } from '@/audio/voice/voiceLines';
import { routingKeys } from '@/audio/routing/AudioEventRouter';
import type { SubtitleEvent } from '@/audio/voice/VoiceQueue';
import type { EmitterSource } from '@/audio/world/emitterModel';
import type { GameEventDto, SnapshotDto, TickResultDto } from '@/bridge/protocol';
import type { SfxClass } from '@/audio/synth/recipes';
import { measureLoops, measureRecipes, type LoopLevel, type RecipeLevel } from './measure';
import { Meters } from './Meters';
import css from './AudioLab.module.css';

export function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className={css.sliderRow}>
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className={css.value}>{props.fmt ? props.fmt(props.value) : props.value}</span>
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={css.check}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

// ------------------------------------------------------------------------------------------ mixer

export function MixerPanel() {
  const s = useAudioSettings();
  const set = (p: Partial<AudioSettings>) => s.set(p);
  return (
    <section className={css.card}>
      <h2 className={css.cardTitle}>
        Mixer <span className={css.cardHint}>persisted in localStorage (magnate.audio) · UX §6.18 defaults 80/60/80/100/50</span>
      </h2>
      <Meters />
      <div style={{ marginTop: 10 }}>
        <Slider label="Master" value={s.master} min={0} max={100} onChange={(v) => set({ master: v })} />
        <Slider label="Music" value={s.music} min={0} max={100} onChange={(v) => set({ music: v })} />
        <Slider label="SFX" value={s.sfx} min={0} max={100} onChange={(v) => set({ sfx: v })} />
        <Slider label="Voice" value={s.voice} min={0} max={100} onChange={(v) => set({ voice: v })} />
        <Slider label="Ambient" value={s.ambient} min={0} max={100} onChange={(v) => set({ ambient: v })} />
      </div>
      <div className={css.row}>
        <Check label="Muted (Ctrl/⌘+M)" checked={s.muted} onChange={(v) => set({ muted: v })} />
        <Check label="Mono" checked={s.mono} onChange={(v) => set({ mono: v })} />
        <Check label="Reduce sudden sounds" checked={s.reduceSudden} onChange={(v) => set({ reduceSudden: v })} />
        <Check label="Subtitles" checked={s.subtitles} onChange={(v) => set({ subtitles: v })} />
        <Check label="Mute in background" checked={s.muteInBackground} onChange={(v) => set({ muteInBackground: v })} />
      </div>
      <div className={css.row}>
        <span className={css.check}>Advisor voice</span>
        {(['all', 'important', 'off'] as const).map((a) => (
          <button key={a} className={clsx(css.btn, s.advisor === a && css.btnOn)} onClick={() => set({ advisor: a })}>
            {a}
          </button>
        ))}
        <button className={css.btn} onClick={() => s.reset()}>
          reset defaults
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ sfx

const CLASS_ORDER: SfxClass[] = ['ui_micro', 'ui_notice', 'economy', 'event', 'alert', 'stinger', 'world'];

export function SfxPanel() {
  useTick(1000);
  const groups = useMemo(() => sfxIdsByClass(), []);
  const sys = audio.system;
  const manifest = sys?.assets.manifest;
  const [slider, setSlider] = useState(0.5);
  const [streak, setStreak] = useState(1);
  return (
    <section className={clsx(css.card, css.wide)}>
      <h2 className={css.cardTitle}>
        Sound effects <span className={css.cardHint}>{Object.keys(SFX).length} ids · file = mastered asset, proc = §6.2 recipe, gen* = procedural stand-in for a GENERATE asset</span>
      </h2>
      <div className={css.row}>
        <Slider label="slider_tick v" value={slider} min={0} max={1} step={0.05} onChange={setSlider} fmt={(v) => v.toFixed(2)} />
        <Slider label="profit streak" value={streak} min={1} max={8} onChange={setStreak} />
      </div>
      {CLASS_ORDER.map((cls) => (
        <div className={css.row} key={cls}>
          <div className={css.groupLabel}>{cls.replace('_', ' ')}</div>
          {groups[cls].map((id) => {
            const hasFile = manifest?.has(id);
            const recipe = ALL_RECIPES[id] ?? ALL_RECIPES[SFX[id]?.recipes[0] ?? ''];
            const tag = hasFile ? (SFX[id]?.mode === 'mix' ? 'file+proc' : 'file') : recipe?.origin === 'fallback' ? 'gen*' : 'proc';
            return (
              <button
                key={id}
                data-sfx={id}
                className={css.btn}
                onClick={() => audio.play(id, { force: true, params: { v: slider, streak } })}
                title={recipe?.label ?? id}
              >
                {id}
                <span className={css.src}>{tag}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className={css.row}>
        <span className={css.cardHint}>
          voices {sys?.sfx.activeVoices ?? 0}/24 · played {sys?.sfx.stats.played ?? 0} · cooldown-suppressed {sys?.sfx.stats.suppressedCooldown ?? 0} · stolen{' '}
          {sys?.sfx.stats.stolen ?? 0}
        </span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ music

const STINGERS = ['stinger.triumph', 'stinger.tension', 'stinger.recovery', 'stinger.crash', 'stinger.boom', 'stinger.ipo'];

export function MusicPanel() {
  useTick(250);
  const sys = audio.system;
  const d = sys?.music.debug();
  const inputs = sys?.music.getInputs();
  const [forced, setForced] = useState<MusicState | null>(null);
  const setInputs = (p: Parameters<NonNullable<typeof sys>['music']['setInputs']>[0]) => sys?.music.setInputs(p);
  return (
    <section className={css.card}>
      <h2 className={css.cardTitle}>
        Music director <span className={css.cardHint}>§4.7 states, beat-quantised equal-power crossfades, stand-ins until §7 cues exist</span>
      </h2>
      <div className={css.row}>
        {MUSIC_STATES.map((s) => (
          <button
            key={s}
            data-music={s}
            className={clsx(css.btn, forced === s && css.btnOn)}
            onClick={() => {
              setForced(s);
              audio.setMusicState(s);
            }}
          >
            {s}
          </button>
        ))}
        <button
          className={clsx(css.btn, forced === null && css.btnOn, css.btnGold)}
          onClick={() => {
            setForced(null);
            audio.setMusicState(null);
          }}
        >
          auto
        </button>
      </div>
      <div className={css.row}>
        {STINGERS.map((s) => (
          <button key={s} className={css.btn} onClick={() => sys?.music.playStinger(s, { force: true })}>
            {s.replace('stinger.', '♪ ')}
          </button>
        ))}
      </div>
      <div className={css.row}>
        <Check label="in game" checked={!!inputs?.inGame} onChange={(v) => setInputs({ inGame: v })} />
        <Check label="warning active (pressure layer)" checked={!!inputs?.warningActive} onChange={(v) => setInputs({ warningActive: v })} />
        <select className={css.select} value={inputs?.climate ?? 'normal'} onChange={(e) => setInputs({ climate: e.target.value as never })}>
          {['normal', 'prosperous', 'boom', 'recession', 'panic'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <Slider label="cash ($M)" value={Math.round((inputs?.cash ?? 0) / 1e6)} min={-5} max={30} onChange={(v) => setInputs({ cash: v * 1e6 })} />
      <Slider label="buildings" value={inputs?.buildings ?? 0} min={0} max={30} onChange={(v) => setInputs({ buildings: v, monthsElapsed: 12 })} />
      <Slider label="under construction" value={inputs?.underConstruction ?? 0} min={0} max={5} onChange={(v) => setInputs({ underConstruction: v })} />
      <Slider label="revenue QoQ %" value={Math.round((inputs?.revQoQ ?? 0) * 100)} min={-50} max={50} onChange={(v) => setInputs({ revQoQ: v / 100 })} />
      <dl className={css.kv}>
        <dt>state</dt>
        <dd>
          {d?.state ?? '—'} {d?.forced ? '(forced)' : ''} · intensity {d?.intensity ?? 0}
        </dd>
        <dt>cue / deck</dt>
        <dd>
          {d?.cue ?? '—'} · deck {d?.deck ?? '—'} · pos {d?.position ?? 0}s · loops {d?.loops ?? 0}
        </dd>
        <dt>rest / pressure</dt>
        <dd>
          {d?.resting ? `resting ${d.restLeftSec}s` : 'playing'} · pressure {d?.pressure ? 'on' : 'off'}
        </dd>
        <dt>last transition</dt>
        <dd>{d?.lastTransition || '—'}</dd>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ ambience

export function AmbiencePanel() {
  useTick(200);
  const sys = audio.system;
  const [frame, setFrameState] = useState<AudioFrame | null>(null);
  const [fixedDay, setFixedDay] = useState(true);
  useEffect(() => {
    if (sys && !frame) setFrameState({ ...sys.ambience.getFrame() });
  }, [sys, frame]);
  if (!sys || !frame) return <section className={css.card}>Ambience — start audio first.</section>;
  const update = (p: Partial<AudioFrame>) => {
    const next = { ...frame, ...p, area: { ...frame.area, ...(p.area ?? {}) } };
    setFrameState(next);
    sys.setFrame(next);
  };
  const gains = bedGains(frame);
  return (
    <section className={css.card}>
      <h2 className={css.cardTitle}>
        Ambience <span className={css.cardHint}>§4.8 beds from the AudioFrame · procedural renders until amb_* files exist</span>
      </h2>
      <div className={css.row}>
        <Check label="active (city on screen)" checked={sys.ambience.isActive} onChange={(v) => sys.ambience.setActive(v)} />
        <select className={css.select} value={frame.cityId} onChange={(e) => update({ cityId: e.target.value })}>
          {Object.keys(CITY_PRESETS).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <Check label="coastal" checked={frame.coastal} onChange={(v) => update({ coastal: v })} />
        <Check
          label="fixed daylight"
          checked={fixedDay}
          onChange={(v) => {
            setFixedDay(v);
            update({ timeOfDay: v ? null : 12 });
          }}
        />
      </div>
      <Slider label="zoom (street→city)" value={frame.zoom01} min={0} max={1} step={0.01} onChange={(v) => update({ zoom01: v })} fmt={(v) => v.toFixed(2)} />
      {!fixedDay && <Slider label="time of day" value={frame.timeOfDay ?? 12} min={0} max={24} step={0.25} onChange={(v) => update({ timeOfDay: v })} fmt={(v) => `${v.toFixed(1)} h`} />}
      <Slider label="month" value={frame.month} min={0} max={11} onChange={(v) => update({ month: v })} />
      <Slider label="rain" value={frame.rain} min={0} max={1} step={0.01} onChange={(v) => update({ rain: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="wind" value={frame.wind} min={0} max={1} step={0.01} onChange={(v) => update({ wind: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="traffic" value={frame.area.traffic} min={0} max={1} step={0.01} onChange={(v) => update({ area: { ...frame.area, traffic: v } })} fmt={(v) => v.toFixed(2)} />
      <Slider label="commercial" value={frame.area.commercial} min={0} max={1} step={0.01} onChange={(v) => update({ area: { ...frame.area, commercial: v } })} fmt={(v) => v.toFixed(2)} />
      <Slider label="green" value={frame.area.green} min={0} max={1} step={0.01} onChange={(v) => update({ area: { ...frame.area, green: v } })} fmt={(v) => v.toFixed(2)} />
      <Slider label="industrial" value={frame.area.industrial} min={0} max={1} step={0.01} onChange={(v) => update({ area: { ...frame.area, industrial: v } })} fmt={(v) => v.toFixed(2)} />
      <Slider label="water" value={frame.area.water} min={0} max={1} step={0.01} onChange={(v) => update({ area: { ...frame.area, water: v } })} fmt={(v) => v.toFixed(2)} />
      <Slider label="to water (plots)" value={frame.distToWaterPlots} min={0} max={60} onChange={(v) => update({ distToWaterPlots: v })} />
      <div className={css.bars} style={{ marginTop: 8 }}>
        {BED_IDS.map((id) => (
          <BedBar key={id} id={id} gain={gains[id]} ready={sys.bank.ready(id)} />
        ))}
      </div>
    </section>
  );
}

function BedBar({ id, gain, ready }: { id: string; gain: number; ready: boolean }) {
  const db = gain > 0 ? 20 * Math.log10(gain) : -Infinity;
  return (
    <>
      <span>
        {id.replace('amb_', '')} {ready ? '' : gain > 0.001 ? '…' : ''}
      </span>
      <div className={css.bar}>
        <div className={css.barFill} style={{ width: `${Math.max(0, Math.min(1, (db + 40) / 40)) * 100}%` }} />
      </div>
      <span className={css.value}>{Number.isFinite(db) ? db.toFixed(0) : '−∞'}</span>
    </>
  );
}

// ------------------------------------------------------------------------------------------ emitters

const DEMO_CATEGORIES: { category: string; typeId?: string; fw: number; status?: string }[] = [
  { category: 'factory', fw: 3 },
  { category: 'supermarket', fw: 3 },
  { category: 'warehouse', fw: 2 },
  { category: 'farm', fw: 3 },
  { category: 'mine', fw: 3 },
  { category: 'oil_well', fw: 2 },
  { category: 'rd_center', fw: 3 },
  { category: 'media', typeId: 'newspaper_publisher', fw: 3 },
  { category: 'media', typeId: 'tv_station', fw: 3 },
  { category: 'seaport', fw: 5 },
  { category: 'convenience_store', fw: 1 },
  { category: 'factory', fw: 5, status: 'underConstruction' },
  { category: 'department_store', fw: 4 },
  { category: 'factory', fw: 3, status: 'starved' },
];

export function EmitterPanel() {
  useTick(250);
  const sys = audio.system;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const rig = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.Vector3 } | null>(null);
  const [focus, setFocus] = useState({ x: 0, z: 0, dist: 160 });
  const [sources, setSources] = useState<EmitterSource[]>([]);

  useEffect(() => {
    if (!sys) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 6000);
    const target = new THREE.Vector3();
    rig.current = { scene, camera, target };
    audio.attachScene({ camera, scene, getTarget: () => target });
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      scene.updateMatrixWorld(); // no renderer here: push the listener rig ourselves
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      audio.attachScene(null);
    };
  }, [sys]);

  useEffect(() => {
    const r = rig.current;
    if (!r) return;
    r.target.set(focus.x, 0, focus.z);
    const elev = THREE.MathUtils.degToRad(45);
    r.camera.position.set(focus.x, Math.sin(elev) * focus.dist, focus.z + Math.cos(elev) * focus.dist);
    r.camera.lookAt(r.target);
    sys?.setFrame({ focus: { x: focus.x, z: focus.z }, zoom01: Math.min(1, Math.max(0, Math.log(focus.dist / 40) / Math.log(45))) });
  }, [focus, sys]);

  const spawn = () => {
    const list: EmitterSource[] = DEMO_CATEGORIES.map((d, i) => {
      const a = (i / DEMO_CATEGORIES.length) * Math.PI * 2;
      const r = 90 + (i % 3) * 110;
      return {
        id: 1000 + i,
        category: d.category,
        typeId: d.typeId,
        status: d.status ?? 'operating',
        isPlayer: i % 2 === 0,
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        footprintW: d.fw,
        footprintH: d.fw,
        activity: { utilization: 0.8, unitsSold: 250_000, transfersIn: 5000, transfersOut: 5000 },
      };
    });
    setSources(list);
    sys?.setEmitters(list);
    sys?.setTrucks([
      { id: 1, x: 40, z: 30 },
      { id: 2, x: -120, z: 60 },
    ]);
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c || !sys) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    const scale = (c.height / 2 / 420) * 1;
    const cx = c.width / 2;
    const cz = c.height / 2;
    g.clearRect(0, 0, c.width, c.height);
    const active = new Set(sys.emitters.activeKeys());
    for (const s of sources) {
      const x = cx + s.x * scale;
      const y = cz + s.z * scale;
      g.fillStyle = s.isPlayer ? '#2F7DE1' : '#E69F00';
      g.beginPath();
      g.arc(x, y, (3 + s.footprintW) * dpr, 0, Math.PI * 2);
      g.fill();
      if (active.has(`b${s.id}`)) {
        g.strokeStyle = '#61C28F';
        g.lineWidth = 2 * dpr;
        g.beginPath();
        g.arc(x, y, (8 + s.footprintW) * dpr, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#9FB2BD';
      g.font = `${10 * dpr}px Inter, sans-serif`;
      g.fillText(s.typeId ?? s.category, x + 10 * dpr, y + 3 * dpr);
    }
    const lp = sys.listenerPosition();
    if (lp) {
      g.fillStyle = '#F0D38A';
      g.beginPath();
      g.arc(cx + lp.x * scale, cz + lp.z * scale, 5 * dpr, 0, Math.PI * 2);
      g.fill();
    }
  });

  return (
    <section className={css.card}>
      <h2 className={css.cardTitle}>
        Positional emitters <span className={css.cardHint}>§4.9 — {sys?.emitters.voiceCount ?? 0}/{sys?.emitters.maxVoices ?? 8} real voices · green ring = voiced</span>
      </h2>
      <div className={css.row}>
        <button className={clsx(css.btn, css.btnGold)} onClick={spawn}>
          spawn demo district
        </button>
        <button
          className={css.btn}
          onClick={() => {
            setSources([]);
            sys?.setEmitters([]);
            sys?.setTrucks([]);
          }}
        >
          clear
        </button>
      </div>
      <canvas ref={canvas} className={css.topView} />
      <Slider label="listener x" value={focus.x} min={-400} max={400} onChange={(v) => setFocus({ ...focus, x: v })} />
      <Slider label="listener z" value={focus.z} min={-400} max={400} onChange={(v) => setFocus({ ...focus, z: v })} />
      <Slider label="camera dist (m)" value={focus.dist} min={40} max={1800} onChange={(v) => setFocus({ ...focus, dist: v })} />
      <div className={css.cardHint}>{(sys?.emitters.lastScores ?? []).slice(0, 8).map((s) => `${s.key}:${s.loop.replace('loop_', '')} ${s.s}`).join(' · ')}</div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ voice

export function VoicePanel() {
  useTick(250);
  const sys = audio.system;
  const [log, setLog] = useState<(SubtitleEvent & { at: number })[]>([]);
  useEffect(() => audio.onSubtitle((e) => setLog((l) => [{ ...e, at: performance.now() }, ...l].slice(0, 40))), []);
  const quick = ['adv.onboard.welcome', 'adv.sales.first', 'adv.cash.negative', 'adv.end.victory', 'news.recession', 'vo_t1_city'];
  const q = sys?.voice.state;
  return (
    <section className={css.card}>
      <h2 className={css.cardTitle}>
        Voice queue <span className={css.cardHint}>§4.11 priorities, TTL, token bucket, ≤ 1 line per close, ducking −10 dB</span>
      </h2>
      <div className={css.row}>
        <div className={css.groupLabel}>through the queue (rules apply; the browser below plays any line directly)</div>
        {quick.map((id) => VO_LINES.find((l) => l.id === id)).filter((l) => !!l).map((l) => (
          <button key={l.id} className={css.btn} onClick={() => audio.requestVoice(l.id, {})} title={l.text}>
            {l.id}
            <span className={css.src}>P{l.priority}</span>
          </button>
        ))}
      </div>
      <div className={css.row}>
        <div className={css.groupLabel}>rules</div>
        <button
          className={css.btn}
          onClick={() => {
            sys?.voice.beginCloseBatch();
            audio.requestVoice('adv.onboard.press_play', { fromClose: true, rank: 3 });
            audio.requestVoice('adv.onboard.first_ad', { fromClose: true, rank: 2 });
            audio.requestVoice('adv.end.victory', { fromClose: true, rank: 0, priority: 1 });
            sys?.voice.endCloseBatch();
          }}
        >
          month close with 3 lines (1 plays)
        </button>
        <button
          className={css.btn}
          onClick={() => {
            audio.requestVoice('adv.onboard.press_play', { priority: 3 });
            setTimeout(() => audio.requestVoice('adv.end.defeat_bankrupt', { priority: 0 }), 900);
          }}
        >
          P0 pre-empts P3
        </button>
        <button className={css.btn} onClick={() => audio.requestVoice('vo_t1_intro', {})}>
          held line (toast only)
        </button>
      </div>
      <dl className={css.kv}>
        <dt>playing</dt>
        <dd>{q?.playing ? `${q.playing.key} (P${q.playing.p})` : '—'}</dd>
        <dt>queued</dt>
        <dd>{q?.queued.map((r) => `${r.key} P${r.p}`).join(', ') || '—'}</dd>
        <dt>tokens / close budget</dt>
        <dd>
          {q?.tokens ?? 0} / {q?.closeBudget ?? 0}
        </dd>
      </dl>
      <div className={css.log} style={{ marginTop: 8 }}>
        {log.length === 0 && <span className={css.cardHint}>subtitles and advisor toasts appear here</span>}
        {log.map((e, i) => (
          <div key={i} className={css.logItem}>
            <span className={css.logMeta}>
              {e.voice} P{e.priority} {e.voiced ? '🔊' : `toast${e.reason ? ` (${e.reason})` : ''}`} {e.delaySec > 0 ? `+${e.delaySec.toFixed(1)}s` : ''}
            </span>
            {e.text}
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ events

const SAMPLE_EVENTS: Record<string, Partial<GameEventDto> & Record<string, unknown>> = {
  goalAchieved: { severity: 'success', message: 'Reach $10M company value' },
  cashNegative: { severity: 'danger', message: 'Cash has gone negative.', amount: -250000 },
  rivalEnteredMarket: { severity: 'warning', message: 'LocalCo entered soft drinks in Metropolis' },
  news: { severity: 'warning', newsSeverity: 'major', message: 'Tariff announcement on imported steel — input costs rise' },
  firstSale: { severity: 'success', message: 'First sale', amount: 1200 },
  recordMonth: { severity: 'success', message: 'Record month', amount: 450000 },
  constructionCompleted: { severity: 'success', message: 'Supermarket completed', isPlayer: true },
  techLevelUp: { severity: 'success', message: 'Tech up', isPlayer: true, level: 3, maxLevel: 10 },
  patentGranted: { severity: 'success', message: 'Patent granted', isPlayer: true },
  creditRatingChanged: { severity: 'warning', message: 'Rating A → BBB', oldValue: 5, newValue: 4 },
  lowRunway: { severity: 'warning', message: 'Runway under 3 months', months: 2 },
  bankruptcyWarning: { severity: 'danger', message: 'Insolvent in 1 month', months: 1 },
  stockout: { severity: 'warning', message: 'Sold out' },
  scenarioWon: { severity: 'success', message: 'All goals met', reason: 'allGoals' },
  scenarioLost: { severity: 'danger', message: 'Bankrupt', reason: 'bankruptcy' },
  macroShift: { severity: 'warning', message: 'Recession', reason: 'recession' },
};

export function EventsPanel() {
  const [cash, setCash] = useState(8);
  const month = useRef(0);
  const keys = useMemo(() => routingKeys().filter((k) => !k.startsWith('bus.')), []);
  const fire = (kind: string) => bus.emit('gameEvent', { kind, severity: 'info', message: kind, ...(SAMPLE_EVENTS[kind] ?? {}) } as GameEventDto);
  const close = (ni: number) => {
    month.current += 1;
    const snapshot = {
      date: { year: 2026, month: (month.current % 12) + 1 },
      monthIndex: month.current,
      playerId: 1,
      companies: [{ id: 1, name: 'You', isPlayer: true, cash: cash * 1e6, totalAssets: 0, equity: 0, revenueThisMonth: Math.max(0, ni) * 3, netIncomeThisMonth: ni, buildingCount: 4, color: '#2F7DE1' }],
      revision: month.current,
    } as SnapshotDto;
    const events = [{ kind: 'monthClosed', severity: ni >= 0 ? 'success' : 'warning', message: 'month', amount: ni } as GameEventDto];
    bus.emit('tick', { months: 1, events, snapshot } as TickResultDto);
    for (const e of events) bus.emit('gameEvent', e);
  };
  return (
    <section className={clsx(css.card, css.wide)}>
      <h2 className={css.cardTitle}>
        Game events <span className={css.cardHint}>synthetic events through the real bus → router (data/audio-events.json) → SFX / VO / music</span>
      </h2>
      <div className={css.row}>
        <button className={clsx(css.btn, css.btnGold)} onClick={() => bus.emit('gameStarted', { date: { year: 2026, month: 1 }, monthIndex: 0, playerId: 1, companies: [], revision: 0 } as unknown as SnapshotDto)}>
          gameStarted
        </button>
        <button className={css.btn} onClick={() => close(120000)}>
          month close +NI
        </button>
        <button className={css.btn} onClick={() => close(-80000)}>
          month close −NI
        </button>
        <Slider label="player cash $M" value={cash} min={-3} max={30} onChange={setCash} />
        {[0, 1, 2, 3].map((s) => (
          <button key={s} className={css.btn} onClick={() => bus.emit('speedChanged', { speed: s })}>
            speed {s}
          </button>
        ))}
      </div>
      <div className={css.row}>
        {(['click', 'hover', 'open', 'close', 'toggle', 'error', 'confirm'] as const).map((c) => (
          <button key={c} className={css.btn} onClick={() => bus.emit('ui', { cue: c })}>
            ui:{c}
          </button>
        ))}
      </div>
      <div className={css.row}>
        {keys.map((k) => (
          <button key={k} className={css.btn} onClick={() => fire(k)}>
            {k}
          </button>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ levels

export function LevelsPanel() {
  const [recipes, setRecipes] = useState<RecipeLevel[] | null>(null);
  const [loops, setLoops] = useState<LoopLevel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (what: 'recipes' | 'loops') => {
    setBusy(true);
    try {
      if (what === 'recipes') setRecipes(await measureRecipes({ repeats: 2 }));
      else setLoops(await measureLoops());
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={clsx(css.card, css.wide)}>
      <h2 className={css.cardTitle}>
        Level report <span className={css.cardHint}>offline renders (OfflineAudioContext 48 kHz) · BS.1770 M-max vs class target ±2 dB · peak ceilings §2.3</span>
      </h2>
      <div className={css.row}>
        <button className={clsx(css.btn, css.btnGold)} disabled={busy} onClick={() => void run('recipes')}>
          measure all recipes
        </button>
        <button className={clsx(css.btn, css.btnGold)} disabled={busy} onClick={() => void run('loops')}>
          measure beds + loops
        </button>
        {busy && <span className={css.cardHint}>rendering…</span>}
      </div>
      {recipes && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>recipe</th>
              <th>class</th>
              <th>target</th>
              <th>M-max</th>
              <th>peak</th>
              <th>ceiling</th>
              <th>trim</th>
              <th>active s</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.cls}</td>
                <td>{r.target}</td>
                <td>{r.mMax.toFixed(1)}</td>
                <td>{r.samplePeak.toFixed(1)}</td>
                <td>{r.peakCeiling}</td>
                <td>{r.trimDb.toFixed(1)}</td>
                <td>{r.activeSec.toFixed(2)}</td>
                <td className={r.pass ? css.pass : css.fail}>{r.pass ? 'ok' : r.issues.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {loops && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>loop</th>
              <th>kind</th>
              <th>target</th>
              <th>LUFS-I</th>
              <th>TP</th>
              <th>wrap jump</th>
              <th>render ms</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {loops.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.kind}</td>
                <td>{r.target}</td>
                <td>{r.lufsI.toFixed(1)}</td>
                <td>{r.truePeak.toFixed(1)}</td>
                <td>
                  {r.wrapJump.toFixed(4)} / {r.wrapP99.toFixed(4)}
                </td>
                <td>{r.renderMs}</td>
                <td className={r.pass ? css.pass : css.fail}>{r.pass ? 'ok' : r.issues.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
