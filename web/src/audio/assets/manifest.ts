// The audio manifest written by tools/audio/master.py (web/public/audio/manifest.json): types,
// validation, variant grouping, URL resolution and the runtime codec probe (audio-plan §2.2, §4.6).

import { PROBE_OGG_BASE64 } from './probe.generated';

export type AssetKind = 'music' | 'stinger' | 'layer' | 'bed' | 'loop3d' | 'sfx' | 'vo';
export type AudioFormat = 'ogg' | 'm4a';
export type PreloadGroup = 'boot' | 'title' | 'game' | 'lazy';

export interface LoopPoints {
  startSec: number;
  endSec: number;
  startSample: number;
  endSample: number;
  seamSec: number;
  qa?: Record<string, number>;
}

export interface MusicGrid {
  bpm: number;
  beatsPerBar: number;
  firstBeatSec: number;
  key: string;
  bars?: number;
}

export interface AssetLoudness {
  metric: string;
  target: number;
  tpMax: number;
  lufsI: number | null;
  mMax: number | null;
  truePeak: number | null;
  gainDb: number;
}

/** One file (one variant) as listed in the manifest. */
export interface ManifestAsset {
  id: string;
  kind: AssetKind;
  class: string;
  channels: 1 | 2;
  lengthSamples: number;
  durationSec: number;
  files: { ogg: string; m4a: string; oggBytes: number; m4aBytes: number };
  loudness: AssetLoudness;
  preload: PreloadGroup;
  variant?: string;
  loop?: LoopPoints;
  tail?: { startSec: number; endSec: number };
  grid?: MusicGrid;
  /** VO: subtitle text (the words of the take). */
  text?: string;
  voice?: 'advisor' | 'anchor';
  /** VO line fields (tools/audio/master.py voSets): line id, role, script priority, old names. */
  line?: string;
  role?: 'advisor' | 'anchor';
  priority?: string | null;
  legacyAlias?: string | null;
  aliases?: string[];
  /** Spoken text when it differs from the subtitle. */
  tts?: string;
  provenance?: Record<string, unknown>;
}

/** The manifest's top-level VO section (master.py voSets). */
export interface ManifestVoSection {
  lines: number;
  held: { line: string; role: string; text: string; status: string }[];
  /** Legacy Godot name → asset id. */
  legacyMap: Record<string, string>;
  /** Superseded UX id → asset id. */
  aliasMap: Record<string, string>;
}

export interface ManifestJson {
  version: number;
  sampleRate: number;
  basePath: string;
  formats: AudioFormat[];
  assets: ManifestAsset[];
  retired?: { src: string; reason: string; replacedBy: string }[];
  vo?: ManifestVoSection;
}

/** All variants of one id (variants share kind/class/loop/grid). */
export interface AudioAsset {
  id: string;
  kind: AssetKind;
  class: string;
  variants: ManifestAsset[];
}

export class ManifestError extends Error {}

const KINDS: ReadonlySet<string> = new Set(['music', 'stinger', 'layer', 'bed', 'loop3d', 'sfx', 'vo']);

/** Validate and index a parsed manifest. Throws ManifestError with the offending id on bad data. */
export function parseManifest(json: unknown): AudioManifest {
  if (!json || typeof json !== 'object') throw new ManifestError('manifest is not an object');
  const m = json as Partial<ManifestJson>;
  if (m.version !== 1) throw new ManifestError(`unsupported manifest version ${String(m.version)}`);
  if (!Array.isArray(m.assets)) throw new ManifestError('manifest.assets missing');
  const basePath = typeof m.basePath === 'string' ? m.basePath : 'audio/';
  const byId = new Map<string, AudioAsset>();
  for (const raw of m.assets) {
    const a = raw as Partial<ManifestAsset>;
    const where = typeof a?.id === 'string' ? a.id : '<no id>';
    if (typeof a?.id !== 'string' || !a.id) throw new ManifestError(`asset without id`);
    if (!a.kind || !KINDS.has(a.kind)) throw new ManifestError(`${where}: bad kind ${String(a.kind)}`);
    if (!a.files || typeof a.files.ogg !== 'string' || typeof a.files.m4a !== 'string')
      throw new ManifestError(`${where}: files.ogg/m4a missing`);
    if (a.channels !== 1 && a.channels !== 2) throw new ManifestError(`${where}: channels must be 1 or 2`);
    if (!(Number(a.lengthSamples) > 0)) throw new ManifestError(`${where}: lengthSamples must be > 0`);
    if (a.loop) {
      const l = a.loop;
      const dur = Number(a.durationSec);
      if (!(l.startSec >= 0.0 && l.endSec > l.startSec && l.endSec <= dur))
        throw new ManifestError(`${where}: loop ${l.startSec}..${l.endSec} outside 0..${dur}`);
      if (dur - l.endSec < 0.25)
        throw new ManifestError(`${where}: loopEnd must keep audio after it (codec padding safety)`);
    }
    if (a.grid && !(a.grid.bpm > 0 && a.grid.beatsPerBar > 0))
      throw new ManifestError(`${where}: bad grid`);
    const asset = a as ManifestAsset;
    const group = byId.get(asset.id);
    if (group) {
      if (group.kind !== asset.kind) throw new ManifestError(`${where}: variants disagree on kind`);
      group.variants.push(asset);
    } else {
      byId.set(asset.id, { id: asset.id, kind: asset.kind, class: asset.class, variants: [asset] });
    }
  }
  for (const g of byId.values()) g.variants.sort((x, y) => (x.variant ?? '').localeCompare(y.variant ?? ''));
  return new AudioManifest(basePath, byId, (m.retired ?? []) as NonNullable<ManifestJson['retired']>);
}

export class AudioManifest {
  constructor(
    readonly basePath: string,
    private readonly byId: Map<string, AudioAsset>,
    readonly retired: NonNullable<ManifestJson['retired']>,
  ) {}

  static empty(): AudioManifest {
    return new AudioManifest('audio/', new Map(), []);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): AudioAsset | undefined {
    return this.byId.get(id);
  }

  ids(kind?: AssetKind): string[] {
    return [...this.byId.values()].filter((a) => !kind || a.kind === kind).map((a) => a.id);
  }

  all(): AudioAsset[] {
    return [...this.byId.values()];
  }

  /** Path of a variant's file relative to the site root (resolve against document.baseURI). */
  path(file: ManifestAsset, fmt: AudioFormat): string {
    return this.basePath + file.files[fmt];
  }

  totalBytes(fmt: AudioFormat, group?: PreloadGroup): number {
    let n = 0;
    for (const a of this.byId.values())
      for (const v of a.variants) if (!group || v.preload === group) n += fmt === 'ogg' ? v.files.oggBytes : v.files.m4aBytes;
    return n;
  }
}

/** Resolve a site-relative path (e.g. "audio/music/title.ogg") against the page (vite base './'). */
export function resolveUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(path, base).toString();
}

export async function loadManifest(url = resolveUrl('audio/manifest.json')): Promise<AudioManifest> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new ManifestError(`manifest fetch failed: ${res.status}`);
  return parseManifest(await res.json());
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Runtime codec probe: decode 20 ms of Ogg Opus. Success → '.ogg' for everything, else '.m4a'.
 * Never `canPlayType` (WebKit once claimed WebM Opus while decodeAudioData failed, bug 226922).
 */
export async function pickFormat(ctx: BaseAudioContext): Promise<AudioFormat> {
  try {
    const buf = await ctx.decodeAudioData(base64ToArrayBuffer(PROBE_OGG_BASE64));
    return buf.length > 0 ? 'ogg' : 'm4a';
  } catch {
    return 'm4a';
  }
}
