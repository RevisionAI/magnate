// Scene lab (route: ?dev=scene) — owned by W1. A synthetic test city on the full render pipeline with live controls
// for time of day, the day cycle, quality tier, season, weather, camera presets and a stats-gl overlay, plus the
// drained-throughput benchmark. Query params (all optional):
//   hour=<0..24>          visual time of day (default 13; the cycle is paused unless cycle=1)
//   cycle=1               run the 12-minute day cycle
//   tier=<auto|low|medium|high|ultra>   (default auto)
//   view=<overview|mid|close|street|horizon>   camera preset (default mid)
//   az=<deg>              camera azimuth for the preset (default 330)
//   month=<1..12>         game month for seasons (default 6)
//   climate=<temperate|warm|cold|arid>
//   weather=<auto|clear|cloudy|rain|storm|snow>   (default clear; pinned instantly for screenshots)
//   size=<plots>          city size (default 40; 80 = Metropolis scale for benchmarks)
//   seed=<n>              layout seed
//   stats=1               stats-gl overlay
//   ui=0                  hide the control panel (clean screenshots)
//   governor=1            enable the frame governor (off by default here for repeatable shots)
//   power=<default|low-power|high-performance>   GPU hint (low-power = Intel UHD on dual-GPU Macs)
//   bench=1               run the benchmark: benchTiers=low,medium… benchViews=overview,mid,close benchHours=13,22.5
//                         benchRuns=5 benchFrames=40; results go to window.__benchResults and console.warn lines
// window.__sceneLabReady becomes true once the city is built, compiled and has rendered a few frames.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CityScene } from '@/scene/CityScene';
import { SyntheticCityModule } from '@/scene/modules/SyntheticCityModule';
import { TIERS, type Tier } from '@/scene/core/Quality';
import { WEATHER_KINDS, type WeatherKind } from '@/scene/env/Weather';
import type { Climate } from '@/scene/env/Seasons';
import type { DayNightMode } from '@/scene/env/DayNight';
import { UI, FONTS } from '@/theme/tokens';
import { LAB_VIEWS, applyLabView, runLabBench, type BenchRow, type LabView } from './sceneLab/views';

declare global {
  interface Window {
    __sceneLabReady?: boolean;
    __sceneLab?: SceneLabApi;
    __benchDone?: boolean;
    __benchResults?: BenchRow[];
  }
}

interface SceneLabApi {
  scene: CityScene;
  city: SyntheticCityModule;
  setHour(hour: number): void;
  setTier(tier: Tier | 'auto'): void;
  setView(view: LabView, azimuthDeg?: number): Promise<void>;
  setWeather(kind: WeatherKind | 'auto'): void;
  setMonth(month1to12: number): void;
  bench(o?: Partial<{ tiers: Tier[]; views: LabView[]; hours: number[]; runs: number; frames: number }>): Promise<BenchRow[]>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function q(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function fmtHour(h: number): string {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

interface Readout {
  gpu: string; tier: string; dpr: string; level: number; calls: number; tris: number; hour: string; night: string;
  weather: string; season: string; band: string; dist: number; shadowTexel: string; build: string; fps: string;
}

export function SceneLab() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneLabApi | null>(null);
  const params = q();
  const [hour, setHourState] = useState(Number(params.get('hour') ?? 13));
  const [cycle, setCycle] = useState(params.get('cycle') === '1');
  const [tier, setTierState] = useState<Tier | 'auto'>((params.get('tier') as Tier | 'auto' | null) ?? 'auto');
  const [month, setMonthState] = useState(Number(params.get('month') ?? 6));
  const [weather, setWeatherState] = useState<WeatherKind | 'auto'>((params.get('weather') as WeatherKind | 'auto' | null) ?? 'clear');
  const [showUi] = useState(params.get('ui') !== '0');
  const [stats, setStatsState] = useState(params.get('stats') === '1');
  const [readout, setReadout] = useState<Readout | null>(null);
  const [bench, setBench] = useState<BenchRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = q();
    const tierParam = (p.get('tier') ?? 'auto') as Tier | 'auto';
    const power = p.get('power') as WebGLPowerPreference | null;
    const scene = new CityScene(host, {
      tier: tierParam,
      governor: p.get('governor') === '1',
      powerPreference: power ?? 'high-performance',
      dayNight: 'dynamic',
      startHour: Number(p.get('hour') ?? 13),
      weather: true,
      reducedMotion: false,
      stats: p.get('stats') === '1',
    });
    scene.env.clock.paused = p.get('cycle') !== '1';
    const size = Math.max(16, Math.min(96, Number(p.get('size') ?? 40)));
    const city = new SyntheticCityModule({
      cityId: 'scenelab', gridW: size, gridH: size, seed: Number(p.get('seed') ?? 20261001), coastal: true, river: true,
      climate: (p.get('climate') as Climate | null) ?? 'temperate', reliefM: Number(p.get('relief') ?? 40), population: 250000,
    });
    let disposed = false;
    const weatherParam = (p.get('weather') ?? 'clear') as WeatherKind | 'auto';
    scene.env.setGameMonth(Number(p.get('month') ?? 6) - 1);
    scene.forceWeather(weatherParam === 'auto' ? null : weatherParam, true);

    const api: SceneLabApi = {
      scene, city,
      setHour: (h) => scene.setHour(h),
      setTier: (t) => scene.setTier(t),
      setView: (v, az) => (city.layout ? applyLabView(scene, v, city.layout, az ?? Number(q().get('az') ?? 330)) : Promise.resolve()),
      setWeather: (k) => scene.forceWeather(k === 'auto' ? null : k, true),
      setMonth: (m) => scene.env.setGameMonth(m - 1),
      bench: (o = {}) => {
        if (!city.layout) return Promise.resolve([]);
        return runLabBench(scene, city.layout, {
          tiers: o.tiers ?? ['low'], views: o.views ?? ['overview', 'mid', 'close'], hours: o.hours ?? [13], runs: o.runs, frames: o.frames,
        }, (row) => console.warn(`[bench] ${JSON.stringify(row)}`));
      },
    };
    apiRef.current = api;
    window.__sceneLab = api;

    void (async () => {
      await scene.add(city);
      if (disposed) return;
      await api.setView((p.get('view') as LabView | null) ?? 'mid');
      await scene.pipelineReady;
      await scene.renderer.compileAsync(scene.scene, scene.camera);
      // Let a few frames run (shadows, PMREM, LOD) before declaring the lab ready.
      await new Promise((r) => setTimeout(r, 600));
      if (disposed) return;
      window.__sceneLabReady = true;
      if (p.get('bench') === '1') {
        const list = <T,>(key: string, fallback: T[], parse: (s: string) => T) => (p.get(key)?.split(',').filter(Boolean).map(parse) ?? fallback);
        const rows = await api.bench({
          tiers: list<Tier>('benchTiers', ['low'], (s) => s as Tier),
          views: list<LabView>('benchViews', ['overview', 'mid', 'close'], (s) => s as LabView),
          hours: list<number>('benchHours', [13], Number),
          runs: Number(p.get('benchRuns') ?? 5), frames: Number(p.get('benchFrames') ?? 40),
        });
        window.__benchResults = rows;
        window.__benchDone = true;
        setBench(rows);
      }
    })();

    const timer = window.setInterval(() => {
      const s = scene;
      const env = s.env;
      const info = s.renderer.info.render;
      const w = env.weatherState;
      setReadout({
        gpu: s.quality.gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 64),
        tier: `${s.quality.tier}${s.quality.minimal ? ' (minimal)' : ''}`,
        dpr: s.quality.pixelRatio.toFixed(2),
        level: s.quality.level,
        calls: info.calls,
        tris: info.triangles,
        hour: fmtHour(env.hour),
        night: env.night.toFixed(2),
        weather: `${w.kind} · rain ${w.rain.toFixed(2)} · wet ${w.wet.toFixed(2)} · snow ${w.snowCover.toFixed(2)}`,
        season: `${MONTHS[env.gameMonth]} · tint ${env.season.vegTint.toArray().map((v) => v.toFixed(2)).join('/')} · desat ${env.season.vegDesat.toFixed(2)}`,
        band: s.rig.zoomBand(),
        dist: Math.round(s.rig.distance),
        shadowTexel: env.shadow.texelSize.toFixed(2),
        build: city.stats ? `${city.stats.buildings} bldg · ${(city.stats.triangles / 1000).toFixed(0)}k tris · ${city.stats.trees} trees · ${city.stats.lamps} lamps · ${city.stats.buildMs.toFixed(0)} ms` : '…',
        fps: '',
      });
      if (!s.env.clock.paused) setHourState(env.hour);
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.__sceneLabReady = false;
      delete window.__sceneLab;
      apiRef.current = null;
      scene.dispose();
    };
  }, []);

  const api = apiRef.current;
  const panel: CSSProperties = {
    position: 'absolute', top: 12, right: 12, width: 330, maxHeight: 'calc(100% - 24px)', overflowY: 'auto', padding: 12,
    borderRadius: 10, background: 'rgba(11,17,23,0.86)', color: UI.text, font: `12px ${FONTS.ui}`, border: `1px solid ${UI.strokeSoft}`,
    boxShadow: '0 8px 30px rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
  };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' };
  const label: CSSProperties = { width: 64, color: UI.muted };
  const btn: CSSProperties = { padding: '3px 8px', borderRadius: 6, border: `1px solid ${UI.stroke}`, background: UI.panel2, color: UI.text, cursor: 'pointer', font: 'inherit' };

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B1117' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {showUi && (
        <div style={panel} data-testid="scene-lab-panel">
          <div style={{ font: `600 14px ${FONTS.display}`, marginBottom: 6 }}>Scene lab</div>
          <Row style={row} label="Time" labelStyle={label}>
            <input type="range" min={0} max={24} step={0.05} value={hour} style={{ flex: 1 }}
              onChange={(e) => { const h = Number(e.target.value); setHourState(h); api?.setHour(h); }} />
            <span style={{ width: 38, textAlign: 'right' }}>{fmtHour(hour)}</span>
          </Row>
          <Row style={row} label="Cycle" labelStyle={label}>
            <label><input type="checkbox" checked={cycle} onChange={(e) => { setCycle(e.target.checked); if (api) api.scene.env.clock.paused = !e.target.checked; }} /> 12-min day</label>
            {(['day', 'golden', 'night'] as DayNightMode[]).map((m) => (
              <button key={m} style={btn} onClick={() => { api?.scene.setDayNightMode(m); api?.scene.setDayNightMode('dynamic'); if (api) api.scene.env.clock.paused = !cycle; setHourState(api?.scene.env.hour ?? hour); }}>{m}</button>
            ))}
          </Row>
          <Row style={row} label="Tier" labelStyle={label}>
            <select value={tier} onChange={(e) => { const t = e.target.value as Tier | 'auto'; setTierState(t); api?.setTier(t); }}>
              {(['auto', ...TIERS] as const).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Row>
          <Row style={row} label="Month" labelStyle={label}>
            <select value={month} onChange={(e) => { const m = Number(e.target.value); setMonthState(m); api?.setMonth(m); }}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Row>
          <Row style={row} label="Weather" labelStyle={label}>
            <select value={weather} onChange={(e) => { const k = e.target.value as WeatherKind | 'auto'; setWeatherState(k); api?.setWeather(k); }}>
              {(['auto', ...WEATHER_KINDS] as const).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Row>
          <Row style={row} label="Camera" labelStyle={label}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {LAB_VIEWS.map((v) => <button key={v} style={btn} onClick={() => void api?.setView(v)}>{v}</button>)}
            </div>
          </Row>
          <Row style={row} label="Stats" labelStyle={label}>
            <label><input type="checkbox" checked={stats} onChange={(e) => { setStatsState(e.target.checked); api?.scene.setStatsVisible(e.target.checked); }} /> stats-gl overlay</label>
          </Row>
          <Row style={row} label="Bench" labelStyle={label}>
            <button style={btn} disabled={busy} onClick={() => {
              if (!api) return;
              setBusy(true);
              void api.bench({ tiers: [api.scene.quality.tier] }).then((rows) => { setBench(rows); setBusy(false); });
            }}>{busy ? 'running…' : 'run (current tier)'}</button>
          </Row>
          {readout && (
            <div style={{ marginTop: 8, lineHeight: 1.55, color: UI.text2, fontFamily: FONTS.mono, fontSize: 11 }}>
              <div>{readout.gpu}</div>
              <div>tier {readout.tier} · dpr {readout.dpr} · governor {readout.level}</div>
              <div>{readout.calls} calls · {(readout.tris / 1000).toFixed(0)}k tris (all passes)</div>
              <div>{readout.hour} · night {readout.night} · {readout.band} {readout.dist} m · shadow {readout.shadowTexel} m/texel</div>
              <div>{readout.weather}</div>
              <div>{readout.season}</div>
              <div>{readout.build}</div>
            </div>
          )}
          {bench.length > 0 && (
            <table style={{ marginTop: 8, width: '100%', fontFamily: FONTS.mono, fontSize: 11, color: UI.text2, borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">tier/view/h</th><th align="right">static</th><th align="right">gpu</th><th align="right">moving</th><th align="right">calls</th><th align="right">ktris</th></tr></thead>
              <tbody>
                {bench.map((r, i) => (
                  <tr key={i}>
                    <td>{r.tier}/{r.view}/{r.hour}</td>
                    <td align="right">{r.staticMedian.toFixed(1)}</td>
                    <td align="right">{r.staticGpu === null ? '–' : r.staticGpu.toFixed(1)}</td>
                    <td align="right">{r.movingMedian.toFixed(1)}</td>
                    <td align="right">{r.movingCalls}</td>
                    <td align="right">{(r.movingTriangles / 1000).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ style, label, labelStyle, children }: { style: CSSProperties; label: string; labelStyle: CSSProperties; children: ReactNode }) {
  return (
    <div style={style}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}
