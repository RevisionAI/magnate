// Main-thread side of the chunked city (art §5.4): a pool of chunk workers, the dirty queue (layout, company and
// month changes), job dispatch nearest-first, result swaps (≤ 2 per frame once the city is up), LOD0/LOD1 switching by
// chunk distance (1,400 m), sign meshes, props and light pools (PropLayer), pick boxes (PickIndex), the far-field lamp
// grid, and the emitters / animated parts registry the living-city workstream reads.
import * as THREE from 'three';
import type { SignQuad } from '../assets/AssetFactory';
import { toBufferGeometry } from '../assets/GeoBuilder';
import { LOD_BANDS } from '../assets/Instancing';
import { LAYER_OCCLUDER } from '../core/PostPipeline';
import { buildSignGeometry, type UvRect } from '../materials/SignAtlas';
import { PLOT_SIZE } from '../units';
import { CityBuildContext } from './build/CityBuildContext';
import { buildChunk } from './build/buildChunk';
import {
  CHUNK_PLOTS, type ChunkAnimatedPart, type ChunkEmitter, type ChunkJob, type ChunkResult, type CompanyCover, type CompanySpec,
  type PickEntry, type WorkerRequest, type WorkerResponse,
} from './chunkProtocol';
import type { CityLayoutWire } from './layout/types';
import { PickIndex } from './PickIndex';
import { POOL_FAMILY, PropLayer, poolsAsProps } from './PropLayer';

/** Chunk centre distance (m) beyond which the LOD1 mesh replaces LOD0 (art §5.4). */
export const CHUNK_LOD1_DISTANCE = 1400;
/** Far blocks: B × B chunks whose LOD1 meshes merge into one draw call when every member is far (draw-call budget). */
export const FAR_BLOCK_CHUNKS = 2;
/** Chunk swaps applied per frame once the city is complete (art §5.4); more while loading. */
const SWAPS_PER_FRAME = 2;
const SWAPS_WHILE_LOADING = 6;
/** Debounce for dirty chunks after a change (art §5.4). */
const DEBOUNCE_MS = 100;

interface ChunkState {
  index: number;
  cx: number;
  cz: number;
  /** World centre. */
  x: number;
  z: number;
  lod0: THREE.Mesh | null;
  lod1: THREE.Mesh | null;
  signs: THREE.Mesh | null;
  signQuads: SignQuad[];
  picks: PickEntry[];
  emitters: ChunkEmitter[];
  animated: ChunkAnimatedPart[];
  lampHeads: Float32Array;
  monthly: boolean;
  /** Content signature of the last job sent (companies + covers + month). */
  signature: string;
  latestJob: number;
  builtJob: number;
  dirtyAt: number;
  queued: boolean;
  inflight: boolean;
  built: boolean;
  lodState: -1 | 0 | 1;
  triangles: [number, number];
}

/** A B × B group of chunks drawn as one merged LOD1 mesh when all its members are beyond the LOD1 distance. */
interface FarBlock {
  members: number[];
  mesh: THREE.Mesh | null;
  /** A member's LOD1 changed since the merged mesh was built. */
  dirty: boolean;
  far: boolean;
}

interface WorkerSlot { worker: Worker; busy: number /* chunk or -1 */; layoutKey: string }

export interface ChunkManagerOptions {
  material: THREE.Material;
  signMaterial: THREE.Material;
  /** Resolve a sign quad to its atlas rectangle. */
  uvFor(sign: SignQuad): UvRect;
  /** Fired when emitters or animated parts changed (after swaps). */
  onLifeChanged?(): void;
  /** Fired when pick boxes changed. */
  onPicksChanged?(): void;
  /** Force the in-thread builder (tests, or no module workers). */
  inline?: boolean;
  workers?: number;
}

export interface ChunkStats {
  chunks: number;
  built: number;
  pending: number;
  triangles0: number;
  triangles1: number;
  props: number;
  lamps: number;
  lastBuildMs: number;
  maxBuildMs: number;
}

export class ChunkManager {
  readonly group = new THREE.Group();
  readonly props: PropLayer;
  pickIndex: PickIndex | null = null;
  private ctx: CityBuildContext | null = null;
  /** In-thread builder's own context: jobs install their covers on it, which must not disturb the module's. */
  private buildCtx: CityBuildContext | null = null;
  private layoutKey = '';
  private chunks: ChunkState[] = [];
  private blocks: FarBlock[] = [];
  private blockOf: number[] = [];
  private readonly workers: WorkerSlot[] = [];
  private readonly ready: Array<ChunkResult> = [];
  private companies: CompanySpec[] = [];
  private covers: CompanyCover[] = [];
  private companiesByChunk = new Map<number, CompanySpec[]>();
  private month = 1;
  private nextJob = 1;
  private loading = true;
  private farLamps: THREE.Points | null = null;
  private readonly farMat: THREE.PointsMaterial;
  private lampsDirty = false;
  private lifeDirty = false;
  private picksDirty = false;
  private emittersCache: ChunkEmitter[] = [];
  private animatedCache: ChunkAnimatedPart[] = [];
  private lastBuildMs = 0;
  private maxBuildMs = 0;
  private readyWaiters: Array<() => void> = [];
  private disposed = false;
  /** Chunks whose influence rectangles (plots + owned parcels), for cover diffs. */
  private influence: Array<[number, number, number, number]> = [];

  constructor(private readonly opts: ChunkManagerOptions) {
    this.group.name = 'city-chunks';
    this.props = new PropLayer(opts.material);
    this.group.add(this.props.group);
    this.farMat = new THREE.PointsMaterial({
      size: 2, sizeAttenuation: false, color: new THREE.Color('#FFC98A').multiplyScalar(3), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    });
    if (!opts.inline && typeof Worker !== 'undefined') {
      const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
      const n = opts.workers ?? (hc >= 4 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        try {
          const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module', name: `city-chunks-${i}` });
          const slot: WorkerSlot = { worker, busy: -1, layoutKey: '' };
          worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(slot, e.data);
          worker.onerror = (e) => { console.error('[city] chunk worker error', e.message); slot.busy = -1; };
          this.workers.push(slot);
        } catch (error) {
          console.warn('[city] chunk workers unavailable; building on the main thread', error);
          break;
        }
      }
    }
  }

  get context(): CityBuildContext | null { return this.ctx; }
  get emitters(): readonly ChunkEmitter[] { return this.emittersCache; }
  get animated(): readonly ChunkAnimatedPart[] { return this.animatedCache; }

  /** All chunks built at least once and nothing queued or in flight. */
  get idle(): boolean {
    return this.chunks.length > 0 && this.chunks.every((c) => c.built && !c.queued && !c.inflight);
  }

  /** Chunks of the current layout built at least once, out of all (the loading screen's progress bar). */
  progress(): { built: number; total: number } {
    let built = 0;
    for (const c of this.chunks) if (c.built) built++;
    return { built, total: this.chunks.length };
  }

  /** Resolves when the city is idle (every chunk built). */
  whenIdle(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  // ------------------------------------------------------------------------------------------- inputs

  /** Install a new layout (city switch or layoutRev bump): drops every chunk and rebuilds. */
  setLayout(wire: CityLayoutWire, layoutKey: string, ctx: CityBuildContext, surface: Float32Array, parcelIds: Int32Array): void {
    this.clearChunks();
    this.ctx = ctx;
    this.buildCtx = this.workers.length ? null : new CityBuildContext(wire);
    this.layoutKey = layoutKey;
    this.loading = true;
    this.pickIndex = new PickIndex(ctx.W, ctx.H, surface, parcelIds);
    const n = ctx.chunkCols * ctx.chunkRows;
    this.chunks = [];
    this.influence = [];
    for (let i = 0; i < n; i++) {
      const cx = i % ctx.chunkCols, cz = Math.floor(i / ctx.chunkCols);
      const px0 = cx * CHUNK_PLOTS, pz0 = cz * CHUNK_PLOTS;
      const px1 = Math.min(ctx.W, px0 + CHUNK_PLOTS), pz1 = Math.min(ctx.H, pz0 + CHUNK_PLOTS);
      this.chunks.push({
        index: i, cx, cz, x: ctx.x0(px0) + ((px1 - px0) * PLOT_SIZE) / 2, z: ctx.z0(pz0) + ((pz1 - pz0) * PLOT_SIZE) / 2,
        lod0: null, lod1: null, signs: null, signQuads: [], picks: [], emitters: [], animated: [], lampHeads: new Float32Array(0),
        monthly: false, signature: '', latestJob: 0, builtJob: 0, dirtyAt: 0, queued: false, inflight: false, built: false, lodState: -1,
        triangles: [0, 0],
      });
      this.influence.push([px0, pz0, px1, pz1]);
    }
    this.blocks = [];
    this.blockOf = [];
    const bCols = Math.ceil(ctx.chunkCols / FAR_BLOCK_CHUNKS);
    for (const c of this.chunks) {
      const b = Math.floor(c.cz / FAR_BLOCK_CHUNKS) * bCols + Math.floor(c.cx / FAR_BLOCK_CHUNKS);
      while (this.blocks.length <= b) this.blocks.push({ members: [], mesh: null, dirty: true, far: false });
      this.blocks[b].members.push(c.index);
      this.blockOf.push(b);
    }
    this.computeInfluence(ctx);
    for (const slot of this.workers) {
      slot.layoutKey = layoutKey;
      slot.busy = -1;
      const msg: WorkerRequest = { kind: 'layout', layoutKey, layout: wire };
      slot.worker.postMessage(msg);
    }
    this.assignCompanies();
    for (const c of this.chunks) this.markDirty(c, 0);
  }

  /**
   * A new revision of the same city's layout (E3b: land bought, sold or built on). Keeps every chunk on screen and
   * rebuilds only `dirty` chunks (their old meshes stay until the replacements swap in). The grid size must match the
   * current layout; otherwise call setLayout.
   */
  updateLayout(wire: CityLayoutWire, layoutKey: string, ctx: CityBuildContext, surface: Float32Array, parcelIds: Int32Array, dirty: ReadonlySet<number>): void {
    const prev = this.ctx;
    if (!prev || prev.W !== ctx.W || prev.H !== ctx.H || !this.pickIndex) {
      this.setLayout(wire, layoutKey, ctx, surface, parcelIds);
      return;
    }
    this.ctx = ctx;
    this.buildCtx = this.workers.length ? null : new CityBuildContext(wire);
    this.layoutKey = layoutKey;
    this.pickIndex.setSurface(surface);
    this.pickIndex.setParcelIds(parcelIds);
    this.influence = this.chunks.map((c) => {
      const px0 = c.cx * CHUNK_PLOTS, pz0 = c.cz * CHUNK_PLOTS;
      return [px0, pz0, Math.min(ctx.W, px0 + CHUNK_PLOTS), Math.min(ctx.H, pz0 + CHUNK_PLOTS)] as [number, number, number, number];
    });
    this.computeInfluence(ctx);
    for (const slot of this.workers) {
      slot.layoutKey = layoutKey;
      const msg: WorkerRequest = { kind: 'layout', layoutKey, layout: wire };
      slot.worker.postMessage(msg);
    }
    this.assignCompanies();
    // Jobs cut for the previous revision are void: their chunks are rebuilt with the new one.
    const now = performance.now();
    for (const r of this.ready.splice(0)) {
      const c = this.chunks[r.chunk];
      if (r.layoutKey === layoutKey) this.ready.push(r);
      else if (c) { c.inflight = false; this.markDirty(c, now); }
    }
    for (const c of this.chunks) {
      if (c.inflight) { c.inflight = false; this.markDirty(c, now); }
      if (dirty.has(c.index)) this.markDirty(c, now);
    }
  }

  private computeInfluence(ctx: CityBuildContext): void {
    for (const p of ctx.grid.parcels) {
      const r = this.influence[ctx.chunkOfRect(p.px, p.pz, p.w, p.h)];
      r[0] = Math.min(r[0], p.px); r[1] = Math.min(r[1], p.pz); r[2] = Math.max(r[2], p.px + p.w); r[3] = Math.max(r[3], p.pz + p.h);
    }
  }

  /** Company buildings of the active city (any order). Dirties only the chunks whose content changes. */
  setCompanies(specs: readonly CompanySpec[]): void {
    this.companies = [...specs].sort((a, b) => a.id - b.id);
    this.covers = this.companies.map((c) => ({ id: c.id, px: c.px, pz: c.pz, w: c.w, h: c.h }));
    this.assignCompanies();
    const now = performance.now();
    for (const c of this.chunks) if (this.signatureOf(c) !== c.signature) this.markDirty(c, now + DEBOUNCE_MS);
  }

  /** Game month 1..12: season changes rebuild everything, month changes rebuild chunks with crops. */
  setMonth(month: number): void {
    const m = ((((Math.round(month) - 1) % 12) + 12) % 12) + 1;
    if (m === this.month) return;
    const season = (x: number) => (x >= 3 && x <= 5 ? 0 : x >= 6 && x <= 8 ? 1 : x >= 9 && x <= 11 ? 2 : 3);
    const all = season(m) !== season(this.month);
    this.month = m;
    const now = performance.now();
    for (const c of this.chunks) if (all || c.monthly) this.markDirty(c, now + DEBOUNCE_MS);
  }

  private assignCompanies(): void {
    this.companiesByChunk.clear();
    const ctx = this.ctx;
    if (!ctx) return;
    for (const c of this.companies) {
      const k = ctx.chunkOfRect(c.px, c.pz, c.w, c.h);
      let list = this.companiesByChunk.get(k);
      if (!list) { list = []; this.companiesByChunk.set(k, list); }
      list.push(c);
    }
  }

  private coversFor(c: ChunkState): CompanyCover[] {
    const [x0, z0, x1, z1] = this.influence[c.index];
    const own = this.companiesByChunk.get(c.index) ?? [];
    const ids = new Set(own.map((s) => s.id));
    // Covers that touch this chunk's plots or parcels, plus the full footprints of its own companies.
    return this.covers.filter((v) => ids.has(v.id) || (v.px < x1 && v.px + v.w > x0 && v.pz < z1 && v.pz + v.h > z0));
  }

  private signatureOf(c: ChunkState): string {
    const own = this.companiesByChunk.get(c.index) ?? [];
    const covers = this.coversFor(c);
    return JSON.stringify([own, covers.map((v) => [v.id, v.px, v.pz, v.w, v.h])]);
  }

  private markDirty(c: ChunkState, at: number): void {
    c.dirtyAt = c.queued ? Math.min(c.dirtyAt, at) : at;
    c.queued = true;
  }

  // ------------------------------------------------------------------------------------------- jobs

  private makeJob(c: ChunkState): ChunkJob {
    const job: ChunkJob = {
      layoutKey: this.layoutKey, jobId: this.nextJob++, chunk: c.index, month: this.month,
      companies: this.companiesByChunk.get(c.index) ?? [], covers: this.coversFor(c),
    };
    c.signature = this.signatureOf(c);
    c.latestJob = job.jobId;
    c.queued = false;
    c.inflight = true;
    return job;
  }

  private dispatch(target: THREE.Vector3): void {
    if (!this.ctx) return;
    const now = performance.now();
    const due = this.chunks.filter((c) => c.queued && c.dirtyAt <= now && !c.inflight);
    if (!due.length) return;
    due.sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z) || a.index - b.index);
    if (this.workers.length) {
      for (const slot of this.workers) {
        if (slot.busy >= 0 || !due.length) continue;
        const c = due.shift()!;
        const job = this.makeJob(c);
        slot.busy = c.index;
        const msg: WorkerRequest = { kind: 'build', job };
        slot.worker.postMessage(msg);
      }
    } else {
      // In-thread fallback: one chunk per frame.
      const c = due[0];
      const job = this.makeJob(c);
      try {
        this.ready.push(buildChunk(this.buildCtx ?? this.ctx, job));
      } catch (error) {
        console.error('[city] chunk build failed', error);
        c.inflight = false;
      }
    }
  }

  private onWorkerMessage(slot: WorkerSlot, msg: WorkerResponse): void {
    if (this.disposed) return;
    if (msg.kind === 'error') {
      slot.busy = -1;
      if (msg.chunk >= 0 && msg.layoutKey === this.layoutKey) {
        const c = this.chunks[msg.chunk];
        if (c && msg.jobId === c.latestJob) {
          c.inflight = false;
          if (msg.message === 'stale layout') this.markDirty(c, performance.now() + 50);
          else console.error(`[city] chunk ${msg.chunk} failed: ${msg.message}`);
        }
      } else if (msg.chunk < 0) console.error(`[city] worker could not load the layout: ${msg.message}`);
      return;
    }
    slot.busy = -1;
    if (msg.result.layoutKey !== this.layoutKey) return;
    this.ready.push(msg.result);
  }

  // ------------------------------------------------------------------------------------------- frame

  /** Per frame: dispatch, apply swaps, LOD and band switching. Returns true when shadow casters changed. */
  update(camera: THREE.Vector3, target: THREE.Vector3, knobs: import('../core/Quality').QualityKnobs, night: number): boolean {
    if (!this.ctx) return false;
    this.dispatch(target);
    let shadows = false;
    const budget = this.loading ? SWAPS_WHILE_LOADING : SWAPS_PER_FRAME;
    this.ready.sort((a, b) => a.jobId - b.jobId);
    let applied = 0;
    while (this.ready.length && applied < budget) {
      const r = this.ready.shift()!;
      if (this.apply(r)) { applied++; shadows = true; }
    }
    if (applied) shadows = this.props.flush() || shadows;
    if (this.lampsDirty) this.rebuildFarLamps();
    if (this.lifeDirty) {
      this.lifeDirty = false;
      this.emittersCache = this.chunks.flatMap((c) => c.emitters);
      this.animatedCache = this.chunks.flatMap((c) => c.animated);
      this.opts.onLifeChanged?.();
    }
    if (this.picksDirty) {
      this.picksDirty = false;
      this.opts.onPicksChanged?.();
    }
    // LOD switching per chunk; far blocks whose members are all at LOD1 draw their merged mesh instead.
    for (const c of this.chunks) {
      if (!c.lod0 && !c.lod1) continue;
      const d = Math.hypot(c.x - camera.x, c.z - camera.z, camera.y);
      const lod: 0 | 1 = d > CHUNK_LOD1_DISTANCE && c.lod1 ? 1 : 0;
      if (lod !== c.lodState) {
        c.lodState = lod;
        if (c.lod0) c.lod0.visible = lod === 0;
        if (c.signs) c.signs.visible = lod === 0;
        shadows = true;
      }
    }
    let merges = this.loading ? 0 : 1;
    for (const b of this.blocks) {
      const members = b.members.map((i) => this.chunks[i]);
      let far = members.every((c) => c.built && (c.lodState === 1 || (!c.lod0 && !c.lod1)));
      if (far && b.dirty) {
        if (merges > 0) { merges--; this.mergeBlock(b); } else far = false;
      }
      if (far && !b.mesh) far = members.every((c) => !c.lod1);
      for (const c of members) if (c.lod1) c.lod1.visible = c.lodState === 1 && !far;
      if (b.mesh) b.mesh.visible = far;
      if (far !== b.far) { b.far = far; shadows = true; }
    }
    shadows = this.props.update(camera, target, knobs, night) || shadows;
    if (this.farLamps) {
      const dist = Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z);
      this.farLamps.visible = night > 0.02 && dist > LOD_BANDS.lamps * 0.85;
      this.farMat.opacity = night * Math.min(1, (dist - LOD_BANDS.lamps * 0.85) / 200);
    }
    if (this.loading && this.idle) {
      this.loading = false;
    }
    if (this.idle && this.readyWaiters.length) {
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const w of waiters) w();
    }
    return shadows;
  }

  private apply(r: ChunkResult): boolean {
    const c = this.chunks[r.chunk];
    if (!c || r.jobId < c.builtJob) return false;
    if (r.jobId === c.latestJob) c.inflight = false;
    c.builtJob = r.jobId;
    c.built = true;
    this.lastBuildMs = r.buildMs;
    this.maxBuildMs = Math.max(this.maxBuildMs, r.buildMs);
    // Meshes.
    this.disposeChunkMeshes(c);
    const mk = (arrays: ChunkResult['lod0'], lod: 0 | 1): THREE.Mesh | null => {
      if (!arrays.triangleCount) return null;
      const mesh = new THREE.Mesh(toBufferGeometry(arrays), this.opts.material);
      mesh.name = `chunk-${c.cx}-${c.cz}-lod${lod}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(LAYER_OCCLUDER);
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    };
    c.lod0 = mk(r.lod0, 0);
    c.lod1 = mk(r.lod1, 1);
    c.triangles = [r.lod0.triangleCount, r.lod1.triangleCount];
    c.lodState = -1;
    const block = this.blocks[this.blockOf[c.index]];
    if (block) block.dirty = true;
    c.signQuads = r.signs;
    this.buildSignMesh(c);
    c.monthly = r.monthly;
    // Props and pools.
    const props: Record<string, Float32Array> = { ...r.props };
    if (r.pools.length) props[POOL_FAMILY] = poolsAsProps(r.pools);
    this.props.setChunk(c.index, props);
    // Lamps, life, picks.
    c.lampHeads = r.lampHeads;
    this.lampsDirty = true;
    c.emitters = r.emitters;
    c.animated = r.animated;
    this.lifeDirty = true;
    const pick = this.pickIndex;
    if (pick && this.ctx) {
      for (const p of c.picks) pick.remove(p.kind, p.id);
      for (const p of r.picks) pick.set(p, this.plotsOf(p));
      c.picks = r.picks;
      this.picksDirty = true;
    }
    return true;
  }

  private plotsOf(p: PickEntry): Array<[number, number]> {
    const ctx = this.ctx!;
    const out: Array<[number, number]> = [];
    if (p.kind === 'company') {
      const c = this.companies.find((s) => s.id === p.id);
      if (c) for (let z = c.pz; z < c.pz + c.h; z++) for (let x = c.px; x < c.px + c.w; x++) out.push([x, z]);
    } else {
      const parcel = ctx.grid.parcelById.get(p.id);
      if (parcel) for (let z = parcel.pz; z < parcel.pz + parcel.h; z++) for (let x = parcel.px; x < parcel.px + parcel.w; x++) out.push([x, z]);
    }
    return out;
  }

  /** Concatenate the members' LOD1 geometry into the block's single mesh. */
  private mergeBlock(b: FarBlock): void {
    b.dirty = false;
    if (b.mesh) { b.mesh.geometry.dispose(); b.mesh.removeFromParent(); b.mesh = null; }
    const parts = b.members.map((i) => this.chunks[i].lod1?.geometry).filter((g): g is THREE.BufferGeometry => !!g);
    if (!parts.length) return;
    const geo = mergeGeometries(parts);
    const mesh = new THREE.Mesh(geo, this.opts.material);
    const c0 = this.chunks[b.members[0]];
    mesh.name = `farblock-${c0.cx}-${c0.cz}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.layers.enable(LAYER_OCCLUDER);
    mesh.visible = false;
    this.group.add(mesh);
    b.mesh = mesh;
  }

  /** Rebuild every sign mesh (e.g. company names changed). */
  refreshSigns(): void {
    for (const c of this.chunks) this.buildSignMesh(c);
  }

  private buildSignMesh(c: ChunkState): void {
    if (c.signs) {
      c.signs.geometry.dispose();
      c.signs.removeFromParent();
      c.signs = null;
    }
    if (!c.signQuads.length) return;
    const mesh = new THREE.Mesh(buildSignGeometry(c.signQuads, (s) => this.opts.uvFor(s)), this.opts.signMaterial);
    mesh.name = `signs-${c.cx}-${c.cz}`;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    mesh.visible = c.lodState === 0;
    this.group.add(mesh);
    c.signs = mesh;
  }

  private rebuildFarLamps(): void {
    this.lampsDirty = false;
    const total = this.chunks.reduce((n, c) => n + c.lampHeads.length, 0);
    if (this.farLamps) {
      this.farLamps.geometry.dispose();
      this.farLamps.removeFromParent();
      this.farLamps = null;
    }
    if (!total) return;
    const pts = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { pts.set(c.lampHeads, o); o += c.lampHeads.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.computeBoundingSphere();
    this.farLamps = new THREE.Points(g, this.farMat);
    this.farLamps.name = 'far-lamps';
    this.farLamps.visible = false;
    this.farLamps.matrixAutoUpdate = false;
    this.group.add(this.farLamps);
  }

  stats(): ChunkStats {
    let built = 0, pending = 0, t0 = 0, t1 = 0, lamps = 0;
    for (const c of this.chunks) {
      if (c.built) built++;
      if (c.queued || c.inflight) pending++;
      t0 += c.triangles[0];
      t1 += c.triangles[1];
      lamps += c.lampHeads.length / 3;
    }
    return { chunks: this.chunks.length, built, pending, triangles0: t0, triangles1: t1, props: this.props.stats().instances, lamps, lastBuildMs: this.lastBuildMs, maxBuildMs: this.maxBuildMs };
  }

  /** Chunk index for a plot (W6/W5 helpers). */
  chunkOfPlot(px: number, pz: number): number {
    return this.ctx ? this.ctx.chunkOfPlot(px, pz) : -1;
  }

  private disposeChunkMeshes(c: ChunkState): void {
    for (const m of [c.lod0, c.lod1]) {
      if (!m) continue;
      m.geometry.dispose();
      m.removeFromParent();
    }
    c.lod0 = null;
    c.lod1 = null;
  }

  private clearChunks(): void {
    for (const c of this.chunks) {
      this.disposeChunkMeshes(c);
      if (c.signs) { c.signs.geometry.dispose(); c.signs.removeFromParent(); c.signs = null; }
    }
    for (const b of this.blocks) if (b.mesh) { b.mesh.geometry.dispose(); b.mesh.removeFromParent(); }
    this.blocks = [];
    this.blockOf = [];
    this.chunks = [];
    this.ready.length = 0;
    this.props.clear();
    this.emittersCache = [];
    this.animatedCache = [];
    if (this.farLamps) { this.farLamps.geometry.dispose(); this.farLamps.removeFromParent(); this.farLamps = null; }
    this.pickIndex = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearChunks();
    for (const s of this.workers) s.worker.terminate();
    this.workers.length = 0;
    this.props.dispose();
    this.farMat.dispose();
    this.group.removeFromParent();
    for (const w of this.readyWaiters) w();
    this.readyWaiters = [];
  }
}

/** Concatenate city geometries (same attribute layout: GeoBuilder's toBufferGeometry). */
function mergeGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color', 'fuv', 'facade', 'extra'] as const;
  let vertices = 0, indices = 0;
  for (const g of parts) { vertices += g.getAttribute('position').count; indices += g.getIndex()!.count; }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = parts[0].getAttribute(name) as THREE.BufferAttribute;
    const Ctor = first.array.constructor as new (n: number) => THREE.TypedArray;
    const arr = new Ctor(vertices * first.itemSize);
    let o = 0;
    for (const g of parts) { const a = g.getAttribute(name) as THREE.BufferAttribute; arr.set(a.array as ArrayLike<number>, o); o += a.array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, first.itemSize, first.normalized));
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let io = 0, base = 0;
  for (const g of parts) {
    const src = g.getIndex()!.array;
    for (let k = 0; k < src.length; k++) index[io++] = src[k] + base;
    base += g.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
