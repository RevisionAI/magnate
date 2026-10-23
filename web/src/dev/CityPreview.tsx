// City preview (route: ?dev=city) — owned by W2. The real generated city of each map (engine `cityLayout`) rendered by
// the CityModule on the full pipeline, with demo company buildings of every type. Query params (all optional):
//   city=<metropolis|riverside|eastside|portbay|hilltown>   (default metropolis)
//   view=<overview|district|street|port|hills|site>          camera preset (default district; site = a construction site)
//   az=<deg>        camera azimuth (default 330)
//   hour=<0..24>    time of day (default 13; cycle=1 runs the 12-minute day)
//   month=<1..12>   game month (seasons, crops; default 6)
//   tier=<auto|low|medium|high|ultra>, power=<low-power|high-performance>, governor=1
//   demo=0          no company buildings
//   weather=<clear|cloudy|rain|storm|snow|auto> (default clear)
//   ui=0            hide the panel (clean screenshots); stats=1 stats-gl
//   bench=1         drained-throughput benchmark: benchTiers, benchViews, benchHours, benchRuns, benchFrames
// window.__cityPreviewReady is true once every chunk is built, shaders compiled and a few frames rendered;
// window.__cityPreview exposes { scene, city, setCity, setView, setHour, setMonth, setTier, stats, bench }.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CityScene } from '@/scene/CityScene';
import { CityModule } from '@/scene/city/CityModule';
import { TIERS, type Tier } from '@/scene/core/Quality';
import { benchDrained } from '@/scene/core/FrameBench';
import { POLAR_MAX, type ViewPreset } from '@/scene/interaction/CameraRig';
import type { WeatherKind } from '@/scene/env/Weather';
import { PLOT_SIZE } from '@/scene/units';
import { UI, FONTS } from '@/theme/tokens';
import { PREVIEW_CITIES, PreviewCitySource } from './cityPreview/source';

type PreviewView = 'overview' | 'district' | 'street' | 'port' | 'hills' | 'site';
const VIEWS: readonly PreviewView[] = ['overview', 'district', 'street', 'port', 'hills', 'site'];

interface PreviewStats {
  city: string; chunks: string; tris0: number; tris1: number; props: number; lamps: number; buildMs: string;
  calls: number; drawTris: number; gpu: string; tier: string; hour: string; dist: number; buildings: number;
}

interface BenchRow {
  city: string; tier: Tier; view: PreviewView; hour: number; staticMedian: number; staticGpu: number | null; movingMedian: number;
  movingGpu: number | null; jsSubmitMs: number; calls: number; triangles: number; movingCalls: number; movingTriangles: number;
}

interface CityPreviewApi {
  scene: CityScene;
  city: CityModule;
  setCity(id: string): Promise<void>;
  setView(view: PreviewView, azimuthDeg?: number): Promise<void>;
  setHour(h: number): void;
  setMonth(m: number): void;
  setTier(t: Tier | 'auto'): void;
  stats(): PreviewStats | null;
  bench(o?: Partial<{ tiers: Tier[]; views: PreviewView[]; hours: number[]; runs: number; frames: number }>): Promise<BenchRow[]>;
}

declare global {
  interface Window {
    __cityPreviewReady?: boolean;
    __cityPreview?: CityPreviewApi;
    __cityBenchDone?: boolean;
    __cityBenchResults?: BenchRow[];
  }
}

function q(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function fmtHour(h: number): string {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Camera presets for the city's real geography (CBD, port, the hill crest). */
function presetFor(view: PreviewView, city: CityModule, maxDistance: number, azimuthDeg: number): ViewPreset {
  const grid = city.chunks?.context?.grid;
  const W = grid?.gridW ?? 60, H = grid?.gridH ?? 60;
  const toWorld = (px: number, pz: number) => ({ x: (px - W / 2) * PLOT_SIZE, z: (pz - H / 2) * PLOT_SIZE });
  const cbd = grid ? toWorld(grid.cbd.x, grid.cbd.z) : { x: 0, z: 0 };
  switch (view) {
    case 'overview': return { target: { x: 0, z: 0 }, distance: Math.min(maxDistance, Math.max(W, H) * PLOT_SIZE * 1.25), azimuthDeg, polarDeg: 36 };
    case 'district': return { target: cbd, distance: 760, azimuthDeg, polarDeg: 44 };
    case 'street': return { target: { x: cbd.x + 1.5 * PLOT_SIZE, z: cbd.z + 2 * PLOT_SIZE }, distance: 150, azimuthDeg, polarDeg: 53 };
    case 'port': {
      const port = grid?.landmarks.find((l) => l.kind === 'port') ?? grid?.parcels.find((p) => p.ambient?.kind === 'civic:port');
      const t = port ? toWorld(port.px + port.w / 2, port.pz + port.h / 2) : cbd;
      return { target: t, distance: 420, azimuthDeg, polarDeg: 48 };
    }
    case 'site': {
      // The construction sites of the demo set (or any company building).
      const specs = city.companySpecs;
      const s = specs.find((c) => c.stage !== 'complete' && c.stage !== 'closed') ?? specs[0];
      const t = s ? toWorld(s.px + s.w / 2, s.pz + s.h / 2) : cbd;
      return { target: t, distance: 190, azimuthDeg, polarDeg: 50 };
    }
    case 'hills': {
      // Steepest flank (Hilltown terraces, Riverside valley walls), else the CBD.
      let best = cbd, bestS = -Infinity;
      if (grid?.heights) {
        const h = (x: number, z: number) => grid.heights![z * (W + 1) + x];
        for (let z = 1; z < H; z++) for (let x = 1; x < W; x++) {
          const s = Math.abs(h(x + 1, z) - h(x - 1, z)) + Math.abs(h(x, z + 1) - h(x, z - 1)) - 0.02 * Math.hypot(x - grid.cbd.x, z - grid.cbd.z);
          if (s > bestS) { bestS = s; best = toWorld(x, z); }
        }
      }
      return { target: best, distance: 330, azimuthDeg, polarDeg: 52 };
    }
  }
}

export function CityPreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<CityPreviewApi | null>(null);
  const params = q();
  const [cityId, setCityState] = useState(params.get('city') ?? 'metropolis');
  const [hour, setHourState] = useState(Number(params.get('hour') ?? 13));
  const [month, setMonthState] = useState(Number(params.get('month') ?? 6));
  const [tier, setTierState] = useState<Tier | 'auto'>((params.get('tier') as Tier | 'auto' | null) ?? 'auto');
  const [stats, setStats] = useState<PreviewStats | null>(null);
  const [status, setStatus] = useState('booting the engine…');
  const showUi = params.get('ui') !== '0';

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = q();
    window.__cityPreviewReady = false;
    const scene = new CityScene(host, {
      tier: (p.get('tier') ?? 'auto') as Tier | 'auto', governor: p.get('governor') === '1',
      powerPreference: (p.get('power') as WebGLPowerPreference | null) ?? 'high-performance', dayNight: 'dynamic',
      startHour: Number(p.get('hour') ?? 13), weather: true, reducedMotion: false, stats: p.get('stats') === '1',
    });
    scene.env.clock.paused = p.get('cycle') !== '1';
    const weather = (p.get('weather') ?? 'clear') as WeatherKind | 'auto';
    scene.forceWeather(weather === 'auto' ? null : weather, true);
    const source = new PreviewCitySource(p.get('city') ?? 'metropolis', Number(p.get('month') ?? 6), p.get('demo') !== '0');
    const city = new CityModule(source);
    let disposed = false;
    const az = () => Number(q().get('az') ?? 330);
    let currentView: PreviewView = (p.get('view') as PreviewView | null) ?? 'district';

    const waitCity = async (id: string) => {
      for (let i = 0; i < 600 && !disposed; i++) {
        if (city.loaded?.cityId === id && city.chunks?.idle) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const settle = async () => {
      await scene.pipelineReady;
      await scene.renderer.compileAsync(scene.scene, scene.camera);
      await new Promise((r) => setTimeout(r, 700));
    };
    const api: CityPreviewApi = {
      scene, city,
      async setCity(id) {
        window.__cityPreviewReady = false;
        setStatus(`building ${id}…`);
        source.setCity(id);
        await waitCity(id);
        await api.setView(currentView);
        await settle();
        setStatus('');
        window.__cityPreviewReady = true;
      },
      setView(view, azimuthDeg) {
        currentView = view;
        scene.rig.controls.maxPolarAngle = POLAR_MAX;
        return scene.rig.setView(presetFor(view, city, scene.rig.controls.maxDistance, azimuthDeg ?? az()), false);
      },
      setHour: (h) => scene.setHour(h),
      setMonth: (m) => { source.setMonth(m); },
      setTier: (t) => scene.setTier(t),
      stats() {
        const m = city.chunks;
        if (!m) return null;
        const s = m.stats();
        const info = scene.renderer.info.render;
        return {
          city: city.loaded?.cityId ?? '…', chunks: `${s.built}/${s.chunks}${s.pending ? ` (${s.pending} pending)` : ''}`,
          tris0: s.triangles0, tris1: s.triangles1, props: s.props, lamps: s.lamps,
          buildMs: `${s.lastBuildMs.toFixed(0)} / max ${s.maxBuildMs.toFixed(0)} ms`, calls: info.calls, drawTris: info.triangles,
          gpu: scene.quality.gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 60), tier: scene.quality.tier, hour: fmtHour(scene.env.hour),
          dist: Math.round(scene.rig.distance), buildings: m.emitters.length,
        };
      },
      async bench(o = {}) {
        const rows: BenchRow[] = [];
        const dt = 1 / 60;
        const frame = () => { scene.step(dt); scene.render(dt); };
        const moving = () => { scene.requestShadowUpdate(); scene.step(dt); scene.render(dt); };
        scene.setLoopRunning(false);
        scene.env.clock.paused = true;
        try {
          for (const t of o.tiers ?? ['low']) {
            scene.setTier(t);
            await scene.pipelineReady;
            for (const h of o.hours ?? [13]) {
              scene.setHour(h);
              for (const v of o.views ?? (['overview', 'district', 'street'] as PreviewView[])) {
                await api.setView(v);
                for (let i = 0; i < 12; i++) frame();
                const s = await benchDrained(scene.renderer, frame, { runs: o.runs ?? 5, frames: o.frames ?? 40 });
                const mv = await benchDrained(scene.renderer, moving, { runs: o.runs ?? 5, frames: o.frames ?? 40, submitFrames: 4 });
                const row: BenchRow = {
                  city: city.loaded?.cityId ?? '', tier: t, view: v, hour: h, staticMedian: s.medianMs, staticGpu: s.gpuMs, movingMedian: mv.medianMs,
                  movingGpu: mv.gpuMs, jsSubmitMs: s.jsSubmitMs, calls: s.calls, triangles: s.triangles, movingCalls: mv.calls, movingTriangles: mv.triangles,
                };
                console.warn(`[bench] ${JSON.stringify(row)}`);
                rows.push(row);
              }
            }
          }
        } finally {
          scene.setLoopRunning(true);
        }
        return rows;
      },
    };
    apiRef.current = api;
    window.__cityPreview = api;

    void (async () => {
      await scene.add(city);
      setStatus(`building ${source.state().cityId}…`);
      await waitCity(source.state().cityId ?? '');
      if (disposed) return;
      await api.setView(currentView);
      await settle();
      if (disposed) return;
      setStatus('');
      window.__cityPreviewReady = true;
      if (p.get('bench') === '1') {
        const list = <T,>(key: string, fallback: T[], parse: (s: string) => T) => (p.get(key)?.split(',').filter(Boolean).map(parse) ?? fallback);
        const rows = await api.bench({
          tiers: list<Tier>('benchTiers', ['low'], (s) => s as Tier),
          views: list<PreviewView>('benchViews', ['overview', 'district', 'street'], (s) => s as PreviewView),
          hours: list<number>('benchHours', [13], Number),
          runs: Number(p.get('benchRuns') ?? 5), frames: Number(p.get('benchFrames') ?? 40),
        });
        window.__cityBenchResults = rows;
        window.__cityBenchDone = true;
      }
    })();

    const timer = window.setInterval(() => setStats(api.stats()), 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.__cityPreviewReady = false;
      delete window.__cityPreview;
      apiRef.current = null;
      scene.dispose();
      source.dispose();
    };
  }, []);

  const api = apiRef.current;
  const panel: CSSProperties = {
    position: 'absolute', top: 12, right: 12, width: 320, padding: 12, borderRadius: 10, background: 'rgba(11,17,23,0.86)',
    color: UI.text, font: `12px ${FONTS.ui}`, border: `1px solid ${UI.strokeSoft}`, boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
  };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', flexWrap: 'wrap' };
  const label: CSSProperties = { width: 56, color: UI.muted };
  const btn = (active: boolean): CSSProperties => ({
    padding: '3px 8px', borderRadius: 6, border: `1px solid ${active ? UI.text2 : UI.stroke}`, background: active ? UI.stroke : UI.panel2,
    color: UI.text, cursor: 'pointer', font: 'inherit',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B1117' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} data-testid="city-preview" />
      {showUi && (
        <div style={panel}>
          <div style={{ font: `600 14px ${FONTS.display}`, marginBottom: 6 }}>City preview</div>
          <div style={row}>
            <span style={label}>City</span>
            {PREVIEW_CITIES.map((c) => (
              <button key={c} style={btn(c === cityId)} onClick={() => { setCityState(c); void api?.setCity(c); }}>{c}</button>
            ))}
          </div>
          <div style={row}>
            <span style={label}>View</span>
            {VIEWS.map((v) => <button key={v} style={btn(false)} onClick={() => void api?.setView(v)}>{v}</button>)}
          </div>
          <div style={row}>
            <span style={label}>Time</span>
            <input type="range" min={0} max={24} step={0.1} value={hour} style={{ flex: 1 }} onChange={(e) => { const h = Number(e.target.value); setHourState(h); api?.setHour(h); }} />
            <span>{fmtHour(hour)}</span>
          </div>
          <div style={row}>
            <span style={label}>Preset</span>
            {([['day', 13], ['golden', 18.5], ['dusk', 20.1], ['night', 22.5]] as const).map(([n, h]) => (
              <button key={n} style={btn(Math.abs(hour - h) < 0.05)} onClick={() => { setHourState(h); api?.setHour(h); }}>{n}</button>
            ))}
          </div>
          <div style={row}>
            <span style={label}>Month</span>
            <select value={month} onChange={(e) => { const m = Number(e.target.value); setMonthState(m); api?.setMonth(m); }}>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <span style={{ ...label, width: 'auto', marginLeft: 8 }}>Tier</span>
            <select value={tier} onChange={(e) => { const t = e.target.value as Tier | 'auto'; setTierState(t); api?.setTier(t); }}>
              {(['auto', ...TIERS] as const).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {status && <div style={{ color: UI.muted, margin: '6px 0' }}>{status}</div>}
          {stats && (
            <div style={{ marginTop: 8, lineHeight: 1.55, color: UI.text2, fontFamily: FONTS.mono, fontSize: 11 }}>
              <div>{stats.gpu}</div>
              <div>tier {stats.tier} · {stats.hour} · {stats.dist} m</div>
              <div>{stats.calls} calls · {(stats.drawTris / 1000).toFixed(0)}k tris drawn</div>
              <div>chunks {stats.chunks} · build {stats.buildMs}</div>
              <div>LOD0 {(stats.tris0 / 1000).toFixed(0)}k · LOD1 {(stats.tris1 / 1000).toFixed(0)}k tris</div>
              <div>{stats.props} props · {stats.lamps} lamps · {stats.buildings} emitters</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

