import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest, type ManifestAsset, type ManifestJson } from './manifest';
import { DecodeCache, type BufferLike } from './DecodeCache';
import { cacheClassOf } from './AssetLoader';
import { PROBE_OGG_BASE64 } from './probe.generated';

const publicAudio = fileURLToPath(new URL('../../../public/audio/', import.meta.url));
const raw = JSON.parse(readFileSync(publicAudio + 'manifest.json', 'utf8')) as ManifestJson & {
  classes: Record<string, { target: number; tpMax: number; metric: string }>;
};
const manifest = parseManifest(raw);

const SECONDS_PER_BEAT = (bpm: number) => 60 / bpm;

describe('the shipped manifest (web/public/audio/manifest.json)', () => {
  it('parses, and every file exists in both formats', () => {
    expect(manifest.all().length).toBeGreaterThan(10);
    for (const a of manifest.all())
      for (const v of a.variants) {
        for (const fmt of ['ogg', 'm4a'] as const) {
          const path = publicAudio + v.files[fmt];
          expect(existsSync(path), path).toBe(true);
          expect(statSync(path).size, path).toBe(fmt === 'ogg' ? v.files.oggBytes : v.files.m4aBytes);
        }
      }
  });

  it('ships no MP3s and none of the broken legacy SFX', () => {
    const files = manifest.all().flatMap((a) => a.variants.flatMap((v) => [v.files.ogg, v.files.m4a]));
    expect(files.some((f) => f.endsWith('.mp3'))).toBe(false);
    const retired = manifest.retired.map((r) => r.src);
    for (const broken of ['ui_click.mp3', 'defeat.mp3', 'notify_warning.mp3']) expect(retired.some((r) => r.endsWith(broken))).toBe(true);
    expect(manifest.has('defeat')).toBe(false);
  });

  it('meets the §2.3 loudness targets (±1 LU) and true-peak ceilings as measured on the delivered .ogg', () => {
    for (const a of manifest.all())
      for (const v of a.variants) {
        const l = v.loudness;
        const measured = l.metric === 'LUFS-I' ? l.lufsI : l.mMax;
        expect(measured, `${v.id} ${l.metric}`).not.toBeNull();
        expect(Math.abs((measured as number) - l.target), `${v.id}: ${measured} vs ${l.target}`).toBeLessThanOrEqual(1);
        expect(l.truePeak as number, `${v.id} true peak`).toBeLessThanOrEqual(l.tpMax);
        expect(l.target).toBe(raw.classes[v.class]?.target);
      }
  });

  it('carries the verified loop points of §2.5 inside the content, with audio left after loopEnd', () => {
    const steady = manifest.get('music.steady')?.variants[0] as ManifestAsset;
    expect(steady.loop?.startSec).toBeCloseTo(25.8438, 3);
    expect(steady.loop?.endSec).toBeCloseTo(95.6625, 3);
    expect(steady.grid).toMatchObject({ bpm: 110, beatsPerBar: 4 });
    const body = (steady.loop?.endSec ?? 0) - (steady.loop?.startSec ?? 0);
    expect(body / SECONDS_PER_BEAT(110)).toBeCloseTo(128, 1); // 32 bars
    const title = manifest.get('music.title')?.variants[0] as ManifestAsset;
    expect(title.loop?.startSec).toBeCloseTo(12.5388, 3);
    expect(title.loop?.endSec).toBeCloseTo(80.5429, 3);
    expect(((title.loop?.endSec ?? 0) - (title.loop?.startSec ?? 0)) / SECONDS_PER_BEAT(120)).toBeCloseTo(136, 1);
    expect(title.loop?.seamSec).toBeCloseTo(2, 6); // 1-bar baked seam
    for (const cue of [steady, title]) {
      expect(cue.durationSec - (cue.loop?.endSec ?? 0)).toBeGreaterThanOrEqual(0.5);
      expect(cue.loop?.startSec).toBeGreaterThanOrEqual(0.5);
      expect(cue.loop?.endSample).toBe(Math.round((cue.loop?.endSec ?? 0) * 48000));
      // seam QA (audio-plan §2.5 acceptance)
      expect(cue.loop?.qa?.envCorr).toBeGreaterThanOrEqual(0.93);
      expect(cue.loop?.qa?.meanAbsDeltaDb).toBeLessThanOrEqual(1);
    }
    expect(manifest.get('music.victory')?.variants[0]?.loop).toBeUndefined(); // one-shot, never looped
  });

  it('keeps the original provenance', () => {
    for (const a of manifest.all())
      for (const v of a.variants)
        expect(String(v.provenance?.source ?? ''), v.id).toMatch(a.kind === 'vo' ? /^assets-src\/vo\/(advisor|anchor)\// : /^client\/assets\/audio\//);
  });

  it('ships every voiced line of the a2 batch, mastered, with its subtitle and no legacy takes', () => {
    const vo = manifest.all().filter((a) => a.kind === 'vo');
    expect(vo.length).toBe(106);
    expect(vo.some((a) => a.id.startsWith('vo.legacy.'))).toBe(false);
    for (const a of vo) {
      const v = a.variants[0]!;
      expect(a.id, a.id).toBe(`vo.${String(v.line)}`);
      expect(v.text, a.id).toBeTruthy();
      expect(['advisor', 'anchor']).toContain(v.role);
      expect(v.channels).toBe(1);
      expect(v.files.ogg).toBe(`vo/${a.id.slice(3)}.ogg`);
      expect(Math.abs((v.loudness.lufsI ?? 0) + 18), a.id).toBeLessThanOrEqual(1);
      expect(v.loudness.truePeak ?? 0, a.id).toBeLessThanOrEqual(-1.5);
      expect(v.durationSec, a.id).toBeGreaterThan(1);
      expect(v.durationSec, a.id).toBeLessThan(8);
    }
  });

  it('groups variants by id (cash_register a from the legacy cash_sale)', () => {
    const cash = manifest.get('cash_register');
    expect(cash?.variants.map((v) => v.variant)).toEqual(['a']);
    expect(cash?.class).toBe('economy');
  });

  it('inlines a decodable Ogg Opus probe', () => {
    const bytes = Buffer.from(PROBE_OGG_BASE64, 'base64');
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('OggS');
    expect(bytes.includes(Buffer.from('OpusHead', 'latin1'))).toBe(true);
    expect(bytes.length).toBeLessThan(300);
  });
});

describe('parseManifest validation', () => {
  const asset = (over: Partial<ManifestAsset> = {}): ManifestAsset =>
    ({
      id: 'x',
      kind: 'sfx',
      class: 'event',
      channels: 1,
      lengthSamples: 48000,
      durationSec: 1,
      files: { ogg: 'sfx/x.ogg', m4a: 'sfx/x.m4a', oggBytes: 1, m4aBytes: 1 },
      loudness: { metric: 'M', target: -18, tpMax: -1.5, lufsI: null, mMax: -18, truePeak: -3, gainDb: 0 },
      preload: 'game',
      ...over,
    }) as ManifestAsset;
  const doc = (assets: unknown[], version = 1) => ({ version, basePath: 'audio/', assets });

  it('rejects malformed documents with the offending id', () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest(doc([], 2))).toThrow(/version/);
    expect(() => parseManifest({ version: 1 })).toThrow(/assets/);
    expect(() => parseManifest(doc([asset({ kind: 'noise' as never })]))).toThrow(/x: bad kind/);
    expect(() => parseManifest(doc([asset({ files: { ogg: 'a.ogg' } as never })]))).toThrow(/files/);
    expect(() => parseManifest(doc([asset({ channels: 6 as never })]))).toThrow(/channels/);
    expect(() => parseManifest(doc([asset({ lengthSamples: 0 })]))).toThrow(/lengthSamples/);
    expect(() => parseManifest(doc([asset({ grid: { bpm: 0, beatsPerBar: 4, firstBeatSec: 0, key: 'F' } })]))).toThrow(/grid/);
  });

  it('rejects loops outside the file or without audio after loopEnd (codec padding safety)', () => {
    const loop = (startSec: number, endSec: number) => ({ startSec, endSec, startSample: 0, endSample: 0, seamSec: 0.25 });
    expect(() => parseManifest(doc([asset({ durationSec: 10, loop: loop(2, 11) })]))).toThrow(/outside/);
    expect(() => parseManifest(doc([asset({ durationSec: 10, loop: loop(5, 4) })]))).toThrow(/outside/);
    expect(() => parseManifest(doc([asset({ durationSec: 10, loop: loop(1, 9.9) })]))).toThrow(/loopEnd/);
    expect(() => parseManifest(doc([asset({ durationSec: 10, loop: loop(1, 9) })]))).not.toThrow();
  });

  it('requires variants of one id to agree on kind, and sorts them', () => {
    expect(() => parseManifest(doc([asset({ variant: 'a' }), asset({ variant: 'b', kind: 'vo' })]))).toThrow(/variants/);
    const m = parseManifest(doc([asset({ variant: 'b' }), asset({ variant: 'a' })]));
    expect(m.get('x')?.variants.map((v) => v.variant)).toEqual(['a', 'b']);
    expect(m.path(m.get('x')!.variants[0]!, 'm4a')).toBe('audio/sfx/x.m4a');
  });
});

describe('DecodeCache (byte-budgeted LRU, audio-plan §4.6)', () => {
  const buf = (seconds: number): BufferLike => ({ length: seconds * 1000, numberOfChannels: 1 }); // 4 kB per second
  const KB = 1000 * 4;

  it('evicts least-recently-used entries over budget, never pinned ones', async () => {
    const c = new DecodeCache<BufferLike>('t', 10 * KB);
    await c.get('a', async () => buf(4));
    await c.get('b', async () => buf(4));
    c.pin('a');
    await c.get('c', async () => buf(4)); // over budget: 'a' is pinned → 'b' goes
    expect([c.has('a'), c.has('b'), c.has('c')]).toEqual([true, false, true]);
    c.unpin('a');
    c.peek('a'); // touch: 'c' is now the LRU
    await c.get('d', async () => buf(4));
    expect([c.has('a'), c.has('c'), c.has('d')]).toEqual([true, false, true]);
    expect(c.bytes).toBe(8 * KB);
  });

  it('shares one in-flight decode between concurrent callers', async () => {
    const c = new DecodeCache<BufferLike>('t', 100 * KB);
    let decodes = 0;
    const produce = async () => {
      decodes++;
      await Promise.resolve();
      return buf(1);
    };
    const [x, y] = await Promise.all([c.get('k', produce), c.get('k', produce)]);
    expect(x).toBe(y);
    expect(decodes).toBe(1);
    await c.get('k', produce);
    expect(decodes).toBe(1);
  });

  it('does not cache failures, so the next request retries', async () => {
    const c = new DecodeCache<BufferLike>('t', 100 * KB);
    await expect(c.get('bad', () => Promise.reject(new Error('404')))).rejects.toThrow('404');
    expect(await c.get('bad', async () => buf(1))).toBeTruthy();
  });

  it('maps asset kinds onto the four cache classes', () => {
    expect(['music', 'stinger', 'layer', 'bed', 'loop3d', 'sfx', 'vo'].map((k) => cacheClassOf(k as never))).toEqual([
      'music', 'music', 'music', 'ambience', 'loops', 'sfx', 'sfx',
    ]);
  });
});
