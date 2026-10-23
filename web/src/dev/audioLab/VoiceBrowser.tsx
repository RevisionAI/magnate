// AudioLab voice-line browser (A3): every line of the VO batch — the mastered take, its subtitle,
// loudness, old names, and which events / tutorial steps route to it. Each row auditions the take
// directly (outside the queue rules); "play all" walks the filtered list in order.

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { audio } from '@/audio';
import { VO_LINES, canonicalLineId, takeAssetId, type VoLineDef } from '@/audio/voice/voiceLines';
import { routingKeys, rulesFor } from '@/audio/routing/AudioEventRouter';
import type { ManifestAsset } from '@/audio/assets/manifest';
import table from '@/audio/data/audio-events.json';
import newsMap from '@/audio/data/news-map.json';
import css from './AudioLab.module.css';

type Role = 'all' | 'advisor' | 'anchor';
type Prio = 'all' | '0' | '1' | '2' | '3';

const TEMPLATE_VALUES: Record<string, string[]> = {
  group: ['retail', 'factory', 'farm', 'mine_well', 'warehouse', 'rd', 'media', 'seaport'],
  milestone: ['1m', '10m', '100m', '1b'],
  pct: ['10', '25', '50', '75'],
};

function expand(t: string): string[] {
  const m = /\$\{(\w+)\}/.exec(t);
  if (!m) return [t];
  return (TEMPLATE_VALUES[m[1] as string] ?? []).flatMap((v) => expand(t.replace(m[0], v)));
}

/** line id → the routing keys / tutorial steps / news events that can raise it. */
function routedBy(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, via: string) => {
    const id = canonicalLineId(name);
    if (!id) return;
    const list = out.get(id) ?? [];
    if (!list.includes(via)) list.push(via);
    out.set(id, list);
  };
  for (const key of routingKeys())
    for (const rule of rulesFor(key)) {
      const v = rule.vo as string | { line: string | string[]; chain?: string[] } | undefined;
      if (!v) continue;
      const names = typeof v === 'string' ? [v] : [...(v.chain ?? []), ...(Array.isArray(v.line) ? v.line : [v.line])];
      for (const n of names.flatMap(expand)) add(n, key);
    }
  for (const [step, line] of Object.entries((table as { tutorial?: Record<string, string> }).tutorial ?? {}))
    if (!step.startsWith('$')) add(line, `tutorial:${step}`);
  for (const [id, e] of Object.entries((newsMap as { events: Record<string, { line: string | null }> }).events)) if (e.line) add(e.line, `news:${id}`);
  for (const l of VO_LINES) if (l.id.startsWith('adv.hint.')) add(l.id, 'playerIdle');
  add('news.intro', 'news (first Major of a session)');
  return out;
}

interface Row {
  def: VoLineDef;
  take: ManifestAsset | undefined;
  via: string[];
}

export function VoiceBrowser() {
  const [role, setRole] = useState<Role>('all');
  const [prio, setPrio] = useState<Prio>('all');
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [sequence, setSequence] = useState(false);
  const [, setManifestTick] = useState(0);
  const stopRef = useRef(false);
  const via = useMemo(routedBy, []);
  const sys = audio.system;

  // the manifest loads asynchronously after the engine starts
  useEffect(() => {
    const id = setInterval(() => {
      if (audio.system?.assets.manifest.has('vo.adv.onboard.welcome')) {
        setManifestTick((n) => n + 1);
        clearInterval(id);
      }
    }, 300);
    return () => clearInterval(id);
  }, []);

  const rows: Row[] = VO_LINES.map((def) => ({
    def,
    take: def.held ? undefined : sys?.assets.manifest.get(takeAssetId(def))?.variants[0],
    via: via.get(def.id) ?? [],
  }));
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (role === 'all' || r.def.voice === role) &&
      (prio === 'all' || String(r.def.priority) === prio) &&
      (!q ||
        r.def.id.toLowerCase().includes(q) ||
        r.def.text.toLowerCase().includes(q) ||
        (r.def.legacyAlias ?? '').toLowerCase().includes(q) ||
        (r.def.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
        r.via.some((v) => v.toLowerCase().includes(q))),
  );
  const voiced = rows.filter((r) => r.take);
  const totalSec = voiced.reduce((s, r) => s + (r.take?.durationSec ?? 0), 0);
  const bytes = voiced.reduce((s, r) => s + (sys?.assets.format === 'm4a' ? (r.take?.files.m4aBytes ?? 0) : (r.take?.files.oggBytes ?? 0)), 0);

  const audition = async (id: string): Promise<number> => {
    setPlaying(id);
    const sec = await audio.audition(id);
    return sec;
  };

  const playOne = async (id: string) => {
    stopRef.current = true;
    setSequence(false);
    const sec = await audition(id);
    window.setTimeout(() => setPlaying((p) => (p === id ? null : p)), Math.max(500, sec * 1000));
  };

  const playAll = async () => {
    stopRef.current = false;
    setSequence(true);
    for (const r of shown) {
      if (stopRef.current) break;
      if (!r.take) continue;
      const sec = await audition(r.def.id);
      await new Promise((res) => window.setTimeout(res, sec * 1000 + 450));
    }
    setSequence(false);
    setPlaying(null);
  };

  const stop = () => {
    stopRef.current = true;
    setSequence(false);
    setPlaying(null);
    audio.system?.voice.clear();
  };

  return (
    <section className={clsx(css.card, css.wide)} data-testid="voice-browser">
      <h2 className={css.cardTitle}>
        Voice lines{' '}
        <span className={css.cardHint}>
          {voiced.length} voiced / {rows.length} lines · {totalSec.toFixed(0)} s · {(bytes / 1048576).toFixed(1)} MB .{sys?.assets.format ?? 'ogg'} · −18 LUFS-I ·
          anchor lines play through the broadcast chain after the news sting
        </span>
      </h2>
      <div className={css.row}>
        <select className={css.select} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="role">
          <option value="all">all roles</option>
          <option value="advisor">advisor (Morgan)</option>
          <option value="anchor">news anchor</option>
        </select>
        <select className={css.select} value={prio} onChange={(e) => setPrio(e.target.value as Prio)} aria-label="priority">
          <option value="all">all priorities</option>
          <option value="0">P0 critical</option>
          <option value="1">P1 important</option>
          <option value="2">P2 informative</option>
          <option value="3">P3 hint</option>
        </select>
        <input
          className={clsx(css.select, css.voSearch)}
          placeholder="search id, text, old name or event…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="search lines"
        />
        <button className={clsx(css.btn, css.btnGold)} onClick={() => void playAll()} disabled={sequence || !sys}>
          ▶ play {shown.filter((r) => r.take).length} in order
        </button>
        <button className={css.btn} onClick={stop}>
          ■ stop
        </button>
        <span className={css.cardHint}>{shown.length} shown</span>
      </div>
      <div className={css.voScroll}>
        <table className={css.voTable}>
          <thead>
            <tr>
              <th />
              <th>line</th>
              <th>P</th>
              <th>sec</th>
              <th>LUFS</th>
              <th>TP</th>
              <th>subtitle</th>
              <th>old names</th>
              <th>raised by</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.def.id} className={clsx(playing === r.def.id && css.voPlaying, !r.take && css.voMuted)} data-line={r.def.id}>
                <td>
                  <button
                    className={css.voPlay}
                    onClick={() => void playOne(r.def.id)}
                    disabled={!r.take || !sys}
                    title={r.take ? `audition ${r.def.id}` : r.def.held ? 'held: not recorded yet' : 'no take'}
                    aria-label={`play ${r.def.id}`}
                  >
                    {playing === r.def.id ? '♪' : '▶'}
                  </button>
                </td>
                <td className={css.voId}>
                  <span className={r.def.voice === 'anchor' ? css.voAnchor : css.voAdvisor}>{r.def.voice === 'anchor' ? 'ANC' : 'ADV'}</span> {r.def.id}
                  {r.def.tutorial && <span className={css.voTag}>T</span>}
                  {r.def.oncePerGame && <span className={css.voTag}>once</span>}
                  {r.def.gameMonthCooldown ? <span className={css.voTag}>{r.def.gameMonthCooldown} mo</span> : null}
                  {r.def.held && <span className={clsx(css.voTag, css.voHeld)}>held</span>}
                  {r.def.legacyOnly && <span className={css.voTag}>legacy</span>}
                </td>
                <td>P{r.def.priority}</td>
                <td>{r.take ? r.take.durationSec.toFixed(2) : '—'}</td>
                <td>{r.take?.loudness.lufsI?.toFixed(1) ?? '—'}</td>
                <td>{r.take?.loudness.truePeak?.toFixed(1) ?? '—'}</td>
                <td className={css.voText}>{r.def.text}</td>
                <td className={css.voSmall}>{[r.def.legacyAlias, ...(r.def.aliases ?? [])].filter(Boolean).join(', ')}</td>
                <td className={css.voSmall}>{r.via.join(', ') || (r.def.legacyOnly ? 'legacy name only' : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
