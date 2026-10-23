// Loads the manifest, picks the codec once (probe), and fetches + decodes files into per-class
// byte-budgeted caches (audio-plan §2.6, §4.6). Rendered procedural loops share the same caches.

import { DecodeCache, cacheBudgets } from './DecodeCache';
import {
  AudioManifest,
  loadManifest,
  pickFormat,
  resolveUrl,
  type AssetKind,
  type AudioFormat,
  type ManifestAsset,
  type PreloadGroup,
} from './manifest';

export type CacheClass = 'music' | 'ambience' | 'loops' | 'sfx';

export function cacheClassOf(kind: AssetKind): CacheClass {
  switch (kind) {
    case 'music':
    case 'stinger':
    case 'layer':
      return 'music';
    case 'bed':
      return 'ambience';
    case 'loop3d':
      return 'loops';
    default:
      return 'sfx';
  }
}

export class AssetLoader {
  manifest: AudioManifest = AudioManifest.empty();
  format: AudioFormat = 'ogg';
  readonly caches: Record<CacheClass, DecodeCache<AudioBuffer>>;
  private ready: Promise<void> | null = null;
  private readonly warned = new Set<string>();

  constructor(private readonly ctx: BaseAudioContext) {
    const b = cacheBudgets();
    this.caches = {
      music: new DecodeCache('music', b.music),
      ambience: new DecodeCache('ambience', b.ambience),
      loops: new DecodeCache('loops', b.loops),
      sfx: new DecodeCache('sfx', b.sfx),
    };
  }

  /** Load the manifest and probe the codec (idempotent). Never rejects: audio degrades to procedural. */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const [manifest, format] = await Promise.all([
          loadManifest().catch((e: unknown) => {
            console.warn('[audio] manifest unavailable; procedural sounds only', e);
            return AudioManifest.empty();
          }),
          pickFormat(this.ctx),
        ]);
        this.manifest = manifest;
        this.format = format;
      })();
    }
    return this.ready;
  }

  url(file: ManifestAsset): string {
    return resolveUrl(this.manifest.path(file, this.format));
  }

  cacheFor(file: ManifestAsset): DecodeCache<AudioBuffer> {
    return this.caches[cacheClassOf(file.kind)];
  }

  peek(file: ManifestAsset): AudioBuffer | undefined {
    return this.cacheFor(file).peek(this.url(file));
  }

  load(file: ManifestAsset): Promise<AudioBuffer> {
    const url = this.url(file);
    return this.cacheFor(file).get(url, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`audio fetch ${res.status} ${url}`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    });
  }

  /** Load, logging a single warning per file instead of throwing. */
  async tryLoad(file: ManifestAsset): Promise<AudioBuffer | null> {
    try {
      return await this.load(file);
    } catch (e) {
      const url = this.url(file);
      if (!this.warned.has(url)) {
        this.warned.add(url);
        console.warn('[audio] could not load', url, e);
      }
      return null;
    }
  }

  pin(file: ManifestAsset): void {
    this.cacheFor(file).pin(this.url(file));
  }

  unpin(file: ManifestAsset): void {
    this.cacheFor(file).unpin(this.url(file));
  }

  /** Decode every file of a preload group in the background (small SFX/VO first). */
  async preload(group: PreloadGroup, kinds?: AssetKind[]): Promise<void> {
    await this.init();
    const files = this.manifest
      .all()
      .flatMap((a) => a.variants)
      .filter((v) => v.preload === group && (!kinds || kinds.includes(v.kind)))
      .sort((a, b) => a.lengthSamples - b.lengthSamples);
    for (const f of files) await this.tryLoad(f);
  }

  stats(): Record<CacheClass, { bytes: number; budget: number; entries: number }> {
    const out = {} as Record<CacheClass, { bytes: number; budget: number; entries: number }>;
    for (const [k, c] of Object.entries(this.caches) as [CacheClass, DecodeCache<AudioBuffer>][])
      out[k] = { bytes: c.bytes, budget: c.budget, entries: c.size };
    return out;
  }
}
