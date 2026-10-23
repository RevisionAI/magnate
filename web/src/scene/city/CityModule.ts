// The real city (W2): fetches the active city's layout (bridge `cityLayout`, cached per city + layoutRev) and its
// company buildings (bridge `cityView`, then revision deltas), decodes the per-plot encodings, and renders terrain,
// roads, lots, ambient and company buildings and props through the chunk workers. Publishes CityServices (road
// network, picking, lot frames, emitters and animated parts) for the living-city and interaction workstreams, the
// SceneWorld for the render core and the land-use grid for the audio frame.
import * as THREE from 'three';
import type { BuildingVisualDto, CityViewDto, Rotation } from '@/bridge/protocol';
import { stageForProgress } from '../assets/AssetFactory';
import { makeCityMaterial } from '../materials/CityMaterial';
import { SignAtlas, makeSignMaterial } from '../materials/SignAtlas';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { PLOT_SIZE } from '../units';
import { WATER_SEA } from '../env/World';
import { CityBuildContext } from './build/CityBuildContext';
import { ChunkManager } from './ChunkManager';
import type { CompanySpec } from './chunkProtocol';
import { activityById, facingFor, liveUtilization, specFromVisual, type ActivityRow } from './companies';
import type { CitySource } from './CitySource';
import { publishCityServices, type CityBuilding, type CityChange, type CityServices, type LotInfo } from './CityServices';
import type { CityLayoutWire } from './layout/types';
import { CityInteractionAdapter, provideInteractionSource } from './interactionSource';
import { changedPlots, sameRoads } from './layout/diff';
import { CityLivingSource, registerLivingSource } from './livingSource';
import type { CityPick } from './PickIndex';
import { SignResolver } from './signs';
import { landUseGrid, parcelIds, sceneWorldOf, surfaceHeights } from './world';

export interface CityModuleOptions {
  /** Force the in-thread chunk builder (tests). */
  inlineBuild?: boolean;
}

interface LoadedCity {
  cityId: string;
  layoutRev: number;
  key: string;
  wire: CityLayoutWire;
  ctx: CityBuildContext;
  population: number;
}

export class CityModule implements SceneModule {
  readonly name = 'city';
  private sc!: SceneContext;
  private manager: ChunkManager | null = null;
  private material: THREE.MeshLambertMaterial | null = null;
  private signMaterial: THREE.MeshLambertMaterial | null = null;
  private atlas: SignAtlas | null = null;
  private signs: SignResolver | null = null;
  private city: LoadedCity | null = null;
  private loadingCity: string | null = null;
  private readonly layoutCache = new Map<string, CityLayoutWire>();
  private buildingsById = new Map<number, BuildingVisualDto>();
  private activity = new Map<number, ActivityRow>();
  private specs: CompanySpec[] = [];
  private viewRevision: number | null = null;
  private viewBusy = false;
  private viewAgain = false;
  private month = 0;
  private framed = false;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(c: CityChange) => void>();
  private services: CityServices | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private disposed = false;
  private cityBuildings = new Map<number, CityBuilding>();
  private readyPromise: Promise<void> = Promise.resolve();
  /** Game clock inside the month used for the current specs (construction day interpolation). */
  private monthFraction = 0;
  private constructionCheckAt = 0;
  /** Road network published to services: kept (same object) across layout revisions that do not touch roads. */
  private roadNet: import('./RoadNetwork').RoadNetwork | null = null;
  /** layoutRev being fetched after a cityView reported a newer one. */
  private layoutFetchRev = -1;
  private readonly constructionPeak = new Map<string, number>();
  private interaction: CityInteractionAdapter | null = null;
  private living: CityLivingSource | null = null;

  constructor(private readonly source: CitySource, private readonly options: CityModuleOptions = {}) {}

  /** Company buildings as rendered (dev tools and tests). */
  get companySpecs(): readonly CompanySpec[] { return this.specs; }
  /** Chunk manager (dev tools and tests). */
  get chunks(): ChunkManager | null { return this.manager; }
  get loaded(): { cityId: string; layoutRev: number } | null { return this.city ? { cityId: this.city.cityId, layoutRev: this.city.layoutRev } : null; }

  init(ctx: SceneContext): void {
    this.sc = ctx;
    this.material = makeCityMaterial();
    this.atlas = new SignAtlas(ctx.renderer);
    this.signMaterial = makeSignMaterial(this.atlas);
    this.signs = new SignResolver(this.atlas);
    void SignAtlas.loadFonts().then(() => { if (!this.disposed) this.manager?.refreshSigns(); });
    this.manager = new ChunkManager({
      material: this.material, signMaterial: this.signMaterial, uvFor: (s) => this.signs!.uvFor(s),
      onLifeChanged: () => this.emit('life'), onPicksChanged: () => this.emit('picks'), inline: this.options.inlineBuild,
    });
    ctx.scene.add(this.manager.group);
    const self = this;
    this.interaction = new CityInteractionAdapter({
      get cityId() { return self.city?.cityId ?? null; },
      get gridW() { return self.city?.ctx.W ?? 0; },
      get gridH() { return self.city?.ctx.H ?? 0; },
      specs: () => this.specs,
      box: (id) => this.manager?.pickIndex?.box('company', id) ?? null,
      buildContext: () => this.city?.ctx ?? null,
      month: () => this.month || 6,
    }, this.material);
    ctx.scene.add(this.interaction.outlineGroup);
    provideInteractionSource(ctx, this.interaction);
    this.living = new CityLivingSource({
      buildContext: () => this.city?.ctx ?? null,
      population: () => this.city?.population ?? 250000,
      water: () => this.sc.world?.water ?? null,
      highways: () => this.sc.world?.highways ?? [],
      specs: () => this.specs,
      dto: (id) => this.buildingsById.get(id),
      box: (id) => this.manager?.pickIndex?.box('company', id) ?? null,
      emitters: () => this.manager?.emitters ?? [],
      parts: () => this.manager?.animated ?? [],
    });
    registerLivingSource(ctx, this.living);
    this.unsubscribe = this.source.subscribe(() => this.sync());
    this.sync();
  }

  /** Re-read the source: city switch, revision (buildings), month, company names. */
  sync(): void {
    if (this.disposed) return;
    const st = this.source.state();
    if (this.signs?.setCompanies(this.source.companies())) this.manager?.refreshSigns();
    if (st.month && st.month !== this.month) {
      this.month = st.month;
      this.sc.env.setGameMonth(st.month - 1);
      this.manager?.setMonth(st.month);
    }
    if (!st.cityId) return;
    if (this.city?.cityId !== st.cityId) {
      if (this.loadingCity !== st.cityId) void this.loadCity(st.cityId);
      return;
    }
    if (st.revision !== this.viewRevision) void this.refreshView();
  }

  private async loadCity(cityId: string): Promise<void> {
    this.loadingCity = cityId;
    try {
      const wire = this.layoutCache.get(cityId) ?? (await this.source.layout(cityId));
      if (this.disposed || this.loadingCity !== cityId) return;
      this.installLayout(wire);
    } catch (error) {
      if (!this.disposed) console.error(`[city] layout for ${cityId} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.loadingCity === cityId) this.loadingCity = null;
    }
  }

  private installLayout(wire: CityLayoutWire): void {
    const manager = this.manager!;
    const key = `${wire.cityId}:${wire.layoutRev}:${wire.seed ?? 1}`;
    this.layoutCache.set(wire.cityId, wire);
    const ctx = new CityBuildContext(wire);
    const population = this.source.population(wire.cityId) ?? 250000;
    const prev = this.city;
    const sameCity = prev?.cityId === wire.cityId;
    // Same city, new revision: rebuild only the chunks whose plots changed (none when only values moved).
    const changed = prev && sameCity ? changedPlots(prev.ctx.grid, ctx.grid) : null;
    if (!(prev && sameCity && sameRoads(prev.ctx.grid, ctx.grid))) this.roadNet = ctx.net;
    this.city = { cityId: wire.cityId, layoutRev: wire.layoutRev, key, wire, ctx, population };
    if (!sameCity) {
      this.buildingsById.clear();
      this.activity.clear();
      this.constructionPeak.clear();
      this.specs = [];
      this.viewRevision = null;
      this.framed = false;
    }
    this.recomputeSpecs();
    ctx.setCovers(this.specs.map((s) => ({ id: s.id, px: s.px, pz: s.pz, w: s.w, h: s.h })));
    if (changed) {
      const dirty = new Set<number>();
      for (const i of changed) {
        const px = i % ctx.W, pz = Math.floor(i / ctx.W);
        // Neighbours too: road masks, curbs and retaining walls look across the plot edge.
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = px + dx, z = pz + dz;
            if (x >= 0 && z >= 0 && x < ctx.W && z < ctx.H) dirty.add(ctx.chunkOfPlot(x, z));
          }
        }
      }
      manager.updateLayout(wire, key, ctx, surfaceHeights(ctx), parcelIds(ctx.grid), dirty);
    } else {
      manager.setLayout(wire, key, ctx, surfaceHeights(ctx), parcelIds(ctx.grid));
    }
    manager.setCompanies(this.specs);
    if (this.month) manager.setMonth(this.month);
    const world = sceneWorldOf(ctx.grid, population);
    this.sc.setWorld(world);
    this.updateAudio();
    this.readyPromise = manager.whenIdle();
    this.services = this.makeServices();
    publishCityServices(this.sc, this.services);
    this.emit('layout');
    void this.refreshView();
  }

  private updateAudio(): void {
    const c = this.city;
    if (!c) return;
    const coastal = this.sc.world?.water?.some((k) => k === WATER_SEA) ?? false;
    this.sc.setAudioAreaSource(landUseGrid(c.ctx.grid, this.specs, coastal, c.population));
  }

  /** Fetch the city view (full on first load, then deltas by revision); serialised, coalesced. */
  private async refreshView(): Promise<void> {
    const c = this.city;
    if (!c) return;
    if (this.viewBusy) { this.viewAgain = true; return; }
    this.viewBusy = true;
    try {
      const target = this.source.state().revision;
      const view = await this.source.view(c.cityId, this.viewRevision);
      if (this.disposed || this.city !== c) return;
      if (view) this.applyView(view);
      this.viewRevision = view ? view.revision : target;
    } finally {
      this.viewBusy = false;
      if (this.viewAgain) { this.viewAgain = false; void this.refreshView(); }
    }
  }

  private applyView(view: CityViewDto): void {
    const c = this.city;
    if (!c || view.cityId !== c.cityId) return;
    if (view.layout && view.layout.layoutRev !== c.layoutRev && view.layout.layoutRev !== this.layoutFetchRev) {
      // Land sales or construction changed parcels: refetch the layout once per revision; only changed chunks rebuild.
      const rev = view.layout.layoutRev;
      this.layoutFetchRev = rev;
      this.layoutCache.delete(c.cityId);
      void this.source.layout(c.cityId).then((wire) => {
        if (this.layoutFetchRev === rev) this.layoutFetchRev = -1;
        if (!this.disposed && this.city?.cityId === wire.cityId && wire.layoutRev !== this.city.layoutRev) this.installLayout(wire);
      }, (error: unknown) => {
        if (this.layoutFetchRev === rev) this.layoutFetchRev = -1;
        console.warn('[city] layout refetch failed', error);
      });
    }
    if (view.full) this.buildingsById.clear();
    for (const b of view.buildings) this.buildingsById.set(b.id, b);
    for (const id of view.removedIds ?? []) this.buildingsById.delete(id);
    this.activity = activityById(view.activity);
    this.monthFraction = this.currentMonthFraction();
    this.refreshSpecs();
    this.cityBuildings = new Map();
    for (const b of [...this.buildingsById.values()].sort((a, z) => a.id - z.id)) {
      const lot = this.lotOfSpec(this.specs.find((s) => s.id === b.id));
      if (lot) this.cityBuildings.set(b.id, { id: b.id, dto: b, lot, utilization: liveUtilization(this.activity.get(b.id)) });
    }
    this.emit('buildings');
    this.framePlayer();
  }

  /** Recompute the specs; on any change, install covers, dirty the affected chunks and refresh pads and audio. */
  private refreshSpecs(): boolean {
    const c = this.city;
    if (!c) return false;
    const before = JSON.stringify(this.specs);
    this.recomputeSpecs();
    if (JSON.stringify(this.specs) === before) return false;
    c.ctx.setCovers(this.specs.map((s) => ({ id: s.id, px: s.px, pz: s.pz, w: s.w, h: s.h })));
    this.manager?.setCompanies(this.specs);
    // Surface heights under company pads follow the new covers.
    this.manager?.pickIndex?.setSurface(surfaceHeights(c.ctx));
    this.updateAudio();
    return true;
  }

  private currentMonthFraction(): number {
    const f = this.source.monthProgress?.() ?? 0;
    return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
  }

  private recomputeSpecs(): void {
    const c = this.city;
    if (!c) { this.specs = []; return; }
    const out: CompanySpec[] = [];
    for (const b of [...this.buildingsById.values()].sort((a, z) => a.id - z.id)) {
      const s = specFromVisual(c.ctx, b, this.activity.get(b.id), this.monthFraction);
      if (!s || s.px < 0 || s.pz < 0 || s.px + s.w > c.ctx.W || s.pz + s.h > c.ctx.H) continue;
      if (b.construction && s.stage !== 'complete' && s.stage !== 'closed') {
        // Never step a site backwards: the clock restarts at a month close a moment before the new progress arrives.
        const key = `${b.id}:${b.construction.started.year}-${b.construction.started.month}`;
        const peak = this.constructionPeak.get(key) ?? 0;
        if (s.progress < peak) { s.progress = peak; s.stage = stageForProgress(peak); }
        else this.constructionPeak.set(key, s.progress);
      }
      out.push(s);
    }
    this.specs = out;
  }

  /** Frame the player's first building once per city (Home behaviour of the interim city). */
  private framePlayer(): void {
    if (this.framed || !this.source.framePlayer) return;
    const mine = this.specs.find((s) => s.owner === 0);
    if (!mine) return;
    const lot = this.lotOfSpec(mine);
    if (!lot) return;
    this.framed = true;
    const box = lot.bounds.clone();
    box.max.y += 25;
    box.expandByScalar(60);
    void this.sc.rig.focus(box);
  }

  // ------------------------------------------------------------------------------------------- services

  private lotOfSpec(s: Pick<CompanySpec, 'px' | 'pz' | 'w' | 'h' | 'turns' | 'id'> | undefined): LotInfo | null {
    const c = this.city;
    if (!s || !c) return null;
    const y = c.ctx.companyTerrace.get(s.id) ?? terraceOfRect(c.ctx, s.px, s.pz, s.w, s.h);
    return lotInfo(c.ctx, s.px, s.pz, s.w, s.h, s.turns, y);
  }

  private makeServices(): CityServices {
    const self = this;
    const c = this.city!;
    const manager = this.manager!;
    return {
      cityId: c.cityId,
      layoutRev: c.layoutRev,
      grid: c.ctx.grid,
      roads: this.roadNet ?? c.ctx.net,
      pick: (ray: THREE.Ray): CityPick | null => manager.pickIndex?.pick(ray) ?? null,
      pickClient(clientX: number, clientY: number): CityPick | null {
        self.sc.ndcFromClient(clientX, clientY, self.ndc);
        self.raycaster.setFromCamera(self.ndc, self.sc.camera);
        return manager.pickIndex?.pick(self.raycaster.ray) ?? null;
      },
      groundHeight(x: number, z: number): number {
        const px = Math.floor(x / PLOT_SIZE + c.ctx.W / 2), pz = Math.floor(z / PLOT_SIZE + c.ctx.H / 2);
        if (px < 0 || pz < 0 || px >= c.ctx.W || pz >= c.ctx.H) return 0;
        const cover = c.ctx.coveredBy(px, pz);
        if (cover >= 0) return c.ctx.companyTerrace.get(cover) ?? 0;
        const parcel = c.ctx.grid.parcelAt[pz * c.ctx.W + px];
        if (parcel >= 0) return c.ctx.terrace[parcel];
        return c.ctx.warpFn(px, pz)(x, z);
      },
      buildings: () => self.cityBuildings,
      buildingBox: (id: number) => manager.pickIndex?.box('company', id) ?? null,
      parcelBox: (id: number) => manager.pickIndex?.box('ambient', id) ?? null,
      lotOfBuilding: (id: number) => self.cityBuildings.get(id)?.lot ?? null,
      lotOfParcel(parcelId: number): LotInfo | null {
        const p = c.ctx.grid.parcelById.get(parcelId);
        return p ? lotInfo(c.ctx, p.px, p.pz, p.w, p.h, p.facing, c.ctx.terrace[p.index]) : null;
      },
      footprintLot(px: number, pz: number, fw: number, fh: number, rotation: Rotation): LotInfo | null {
        const turns = (((rotation / 90) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
        const w = turns % 2 === 0 ? fw : fh, h = turns % 2 === 0 ? fh : fw;
        if (px < 0 || pz < 0 || px + w > c.ctx.W || pz + h > c.ctx.H) return null;
        return lotInfo(c.ctx, px, pz, w, h, turns, terraceOfRect(c.ctx, px, pz, w, h));
      },
      facingFor: (px: number, pz: number, w: number, h: number) => facingFor(c.ctx, px, pz, w, h),
      getEmitters: () => manager.emitters,
      getAnimatedParts: () => manager.animated,
      utilization: (id: number | null) => (id === null ? 0.6 : liveUtilization(self.activity.get(id))),
      onChange(listener: (change: CityChange) => void): () => void {
        self.listeners.add(listener);
        return () => { self.listeners.delete(listener); };
      },
      whenReady: () => self.readyPromise,
      buildProgress: () => manager.progress(),
    };
  }

  private emit(change: CityChange): void {
    if (change === 'layout') {
      this.interaction?.reset();
      this.living?.refreshLayout();
    } else {
      if (change === 'buildings' || change === 'picks') this.interaction?.refresh();
      this.living?.refreshBuildings();
    }
    for (const l of [...this.listeners]) l(change);
  }

  // ------------------------------------------------------------------------------------------- frame

  update(frame: FrameInfo): void {
    const m = this.manager;
    if (!m) return;
    // Construction sites advance with the clock between month closes (a few chunk rebuilds per project per month).
    const now = performance.now();
    if (now >= this.constructionCheckAt) {
      this.constructionCheckAt = now + 400;
      const f = this.currentMonthFraction();
      if (f !== this.monthFraction && this.specs.some((s) => s.stage !== 'complete' && s.stage !== 'closed')) {
        this.monthFraction = f;
        if (this.refreshSpecs()) this.emit('buildings');
      } else this.monthFraction = f;
    }
    if (m.update(this.sc.camera.position, frame.target, this.sc.quality.knobs, frame.night)) this.sc.requestShadowUpdate();
    if (this.signMaterial) this.signMaterial.emissiveIntensity = 1.6 * frame.night;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    publishCityServices(this.sc, null);
    provideInteractionSource(this.sc, null);
    registerLivingSource(this.sc, null);
    this.living?.dispose();
    this.living = null;
    this.interaction?.dispose();
    this.interaction = null;
    this.sc.setAudioAreaSource(null);
    this.manager?.dispose();
    this.manager = null;
    this.material?.dispose();
    this.signMaterial?.dispose();
    this.atlas?.texture.dispose();
    this.listeners.clear();
  }
}

/** Mean natural height over a footprint (the terrace a building there would sit on). */
function terraceOfRect(ctx: CityBuildContext, px: number, pz: number, w: number, h: number): number {
  if (!ctx.hilly) return 0;
  let sum = 0, n = 0;
  for (let z = pz; z <= pz + h; z++) for (let x = px; x <= px + w; x++) { sum += ctx.corner(x, z); n++; }
  return Math.round((sum / n) * 20) / 20;
}

function lotInfo(ctx: CityBuildContext, px: number, pz: number, w: number, h: number, turns: 0 | 1 | 2 | 3, y: number): LotInfo {
  const x0 = ctx.x0(px), z0 = ctx.z0(pz), x1 = x0 + w * PLOT_SIZE, z1 = z0 + h * PLOT_SIZE;
  return {
    px, pz, w, h, turns, x: (x0 + x1) / 2, y, z: (z0 + z1) / 2,
    widthM: (turns % 2 === 0 ? w : h) * PLOT_SIZE, depthM: (turns % 2 === 0 ? h : w) * PLOT_SIZE,
    bounds: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + 1, z1)),
  };
}

