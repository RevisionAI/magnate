// The living city's hub (added first by createDynamicModules): resolves the CitySource (registered by the city module,
// the PlaceholderCity adapter, or the bridge), follows the economy (EconomyFeed), merges both into live building
// state, builds the road graph when the layout changes, and owns the shared animation clock. The feature modules
// (traffic, pedestrians, particles, animated parts, ships, world FX, weather) read everything from here.
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { useSettingsStore, effectiveReducedMotion } from '@/state/settingsStore';
import { prefersReducedMotion } from '@/theme/cssVars';
import { buildRoadGraph, type RoadGraph } from './traffic/RoadGraph';
import { EconomyFeed, type EconomySnapshot } from './source/EconomyFeed';
import { BridgeSource } from './source/BridgeSource';
import { PlaceholderSource } from './source/SyntheticSource';
import { onCitySource, registeredCitySource } from './source/registry';
import type { CitySource, DynamicBuilding, DynamicLayout, DynamicStatus } from './source/types';

/** A company building with this month's live activity. */
export interface LiveBuilding extends DynamicBuilding {
  /** Production utilization 0..1 (null for non-producers). */
  utilization: number | null;
  unitsSold: number;
  transfersIn: number;
  transfersOut: number;
  /** Working right now: operating-type status (not idle, closed or under construction). */
  working: boolean;
}

export interface LivingCityOptions {
  /** Use this source instead of auto-detection (scene lab, tests). */
  source?: CitySource;
  /** Follow the bridge economy (default true; off in labs without an engine). */
  economy?: boolean;
  /** Render world popups for `worldPopup` bus events (default true; see the W5 status doc about W6). */
  worldPopups?: boolean;
}

type HubEvent = 'layout' | 'buildings' | 'economy';

const WORKING: ReadonlySet<DynamicStatus> = new Set(['operating', 'soldOut', 'starved']);

export class LivingCity implements SceneModule {
  readonly name = 'living-city';
  ctx!: SceneContext;
  source: CitySource | null = null;
  readonly feed = new EconomyFeed();
  layout: DynamicLayout | null = null;
  graph: RoadGraph | null = null;
  readonly buildings = new Map<number, LiveBuilding>();
  economy: EconomySnapshot = this.feed.snapshot;
  /** Agents and animated parts stop while the game is paused or reduced motion is on. */
  frozen = false;
  reducedMotion = false;
  /** Seconds of unfrozen time (animated parts, agents). */
  animTime = 0;
  /** Latest frame info (other modules may read it in event handlers). */
  frame: FrameInfo | null = null;
  readonly options: LivingCityOptions;
  private readonly listeners = new Map<HubEvent, Set<() => void>>();
  private readonly offs: Array<() => void> = [];
  private sourceOff: (() => void) | null = null;
  private ownsSource = false;
  private graphRev = -1;
  private graphCity = '';

  constructor(options: LivingCityOptions = {}) {
    this.options = options;
  }

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    const settings = () => {
      const s = useSettingsStore.getState();
      this.reducedMotion = effectiveReducedMotion(s.interface.reducedMotion, prefersReducedMotion());
    };
    settings();
    this.offs.push(useSettingsStore.subscribe((s, p) => { if (s.interface !== p.interface) settings(); }));
    if (this.options.economy !== false) {
      this.offs.push(this.feed.onChange((snap) => {
        this.economy = snap;
        this.mergeBuildings();
        this.emit('economy');
      }));
      this.feed.start();
    }
    this.offs.push(onCitySource(ctx, (s) => { if (s && !this.options.source) this.useSource(s, false); }));
    this.resolveSource();
  }

  /** Subscribe to hub changes; returns an unsubscribe function. */
  on(what: HubEvent, cb: () => void): () => void {
    let set = this.listeners.get(what);
    if (!set) {
      set = new Set();
      this.listeners.set(what, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  private emit(what: HubEvent): void {
    for (const cb of [...(this.listeners.get(what) ?? [])]) {
      try {
        cb();
      } catch (error) {
        console.error(`[living-city] ${what} listener failed`, error);
      }
    }
  }

  private resolveSource(): void {
    const ctx = this.ctx;
    if (this.options.source) return this.useSource(this.options.source, false);
    const registered = registeredCitySource(ctx);
    if (registered) return this.useSource(registered, false);
    if (PlaceholderSource.detect(ctx.scene)) return this.useSource(new PlaceholderSource(ctx.scene), true);
    if (this.options.economy !== false) this.useSource(new BridgeSource(this.feed), true);
  }

  private useSource(source: CitySource, owned: boolean): void {
    if (this.source === source) return;
    this.sourceOff?.();
    if (this.ownsSource) this.source?.dispose?.();
    this.source = source;
    this.ownsSource = owned;
    this.sourceOff = source.onChange((what) => {
      if (what === 'layout') this.syncLayout();
      else this.mergeBuildings();
    });
    this.syncLayout();
  }

  private syncLayout(): void {
    const layout = this.source?.layout ?? null;
    this.layout = layout;
    if (!layout) {
      this.graph = null;
      this.buildings.clear();
      this.emit('layout');
      return;
    }
    if (layout.rev !== this.graphRev || layout.cityId !== this.graphCity) {
      this.graphRev = layout.rev;
      this.graphCity = layout.cityId;
      this.graph = buildRoadGraph({ gridW: layout.gridW, gridH: layout.gridH, road: layout.road, surfaceY: layout.roadY ?? null });
      this.buildings.clear();
      this.emit('layout');
    }
    this.mergeBuildings();
  }

  /** Merge source buildings with the economy feed (status, utilization, units, transfers). */
  private mergeBuildings(): void {
    const src = this.source?.buildings;
    this.buildings.clear();
    if (!src || !this.layout) {
      this.emit('buildings');
      return;
    }
    const sameCity = this.economy.cityId === this.layout.cityId;
    for (const [id, b] of src) {
      const visual = sameCity ? this.economy.visuals.get(id) : undefined;
      const act = sameCity ? this.economy.activity.get(id) : undefined;
      const status = (visual?.status as DynamicStatus | undefined) ?? b.status;
      const progress = visual?.construction && visual.construction.progress < 1 ? visual.construction.progress : b.progress;
      const utilization = act ? act.utilization : null;
      this.buildings.set(id, {
        ...b,
        status,
        progress,
        utilization,
        unitsSold: act?.unitsSold ?? 0,
        transfersIn: act?.transfersIn ?? 0,
        transfersOut: act?.transfersOut ?? 0,
        working: WORKING.has(status) && progress === undefined && (utilization === null || utilization > 0),
      });
    }
    this.emit('buildings');
  }

  update(frame: FrameInfo): void {
    this.frame = frame;
    this.source?.update?.();
    this.frozen = frame.speed <= 0 || this.reducedMotion;
    if (!this.frozen) this.animTime += frame.dt;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.sourceOff?.();
    if (this.ownsSource) this.source?.dispose?.();
    this.source = null;
    this.feed.dispose();
    this.listeners.clear();
  }
}
