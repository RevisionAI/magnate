// Economy data for the living city, read from the bridge after every closed month (bridge-spec §5.5): the city view
// (building status, construction progress, per-building activity: utilization, units sold, transfers) and the
// supply flows of the last closed month (company trucks, imports and exports). Never re-derives game logic.
import type { BuildingVisualDto, CityActivityDto, CityViewDto, FlowDto } from '@/bridge/protocol';
import { bus } from '@/game/events';
import { maybeEngine, useGameStore } from '@/state/gameStore';

export interface BuildingActivity {
  utilization: number | null;
  unitsSold: number;
  transfersIn: number;
  transfersOut: number;
  revenue: number;
  netIncome: number;
}

export interface EconomySnapshot {
  cityId: string | null;
  /** Visual DTOs of every building in the city (merged from full + delta views). */
  visuals: ReadonlyMap<number, BuildingVisualDto>;
  activity: ReadonlyMap<number, BuildingActivity>;
  flows: readonly FlowDto[];
  /** Month the activity and flows describe (`year * 12 + month - 1`), −1 when unknown. */
  monthIndex: number;
  /** Bumps on every successful refresh. */
  rev: number;
}

type Listener = (snap: EconomySnapshot) => void;

/** Minimal engine surface (tests inject a fake). */
export interface EconomyEngine {
  call(method: 'cityView', args: { cityId: string; since?: number }): Promise<CityViewDto>;
  call(method: 'supplyFlows', args: { cityId: string }): Promise<{ month: { year: number; month: number }; flows: FlowDto[] }>;
}

export class EconomyFeed {
  private visuals = new Map<number, BuildingVisualDto>();
  private activity = new Map<number, BuildingActivity>();
  private flows: FlowDto[] = [];
  private monthIndex = -1;
  private rev = 0;
  private cityId: string | null = null;
  private viewRevision: number | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly offs: Array<() => void> = [];
  private inflight = false;
  private again = false;
  private warned = false;
  private disposed = false;

  constructor(private readonly engine: () => EconomyEngine | null = () => maybeEngine() as unknown as EconomyEngine | null) {}

  get snapshot(): EconomySnapshot {
    return { cityId: this.cityId, visuals: this.visuals, activity: this.activity, flows: this.flows, monthIndex: this.monthIndex, rev: this.rev };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follow the active city and refresh after every month close and command. */
  start(): void {
    const sync = () => {
      const state = useGameStore.getState();
      const city = state.phase === 'playing' || state.phase === 'loading' || state.phase === 'starting' ? state.activeCityId : null;
      if (city !== this.cityId) this.setCity(city);
    };
    this.offs.push(useGameStore.subscribe((s, p) => {
      if (s.activeCityId !== p.activeCityId || s.phase !== p.phase) sync();
      else if (s.buildings !== p.buildings) void this.refresh();
    }));
    this.offs.push(bus.on('tick', () => void this.refresh()));
    this.offs.push(bus.on('gameStarted', () => { this.setCity(null); sync(); }));
    this.offs.push(bus.on('buildingPlaced', () => void this.refresh()));
    sync();
  }

  setCity(cityId: string | null): void {
    this.cityId = cityId;
    this.viewRevision = undefined;
    this.visuals = new Map();
    this.activity = new Map();
    this.flows = [];
    this.monthIndex = -1;
    this.emit();
    if (cityId) void this.refresh();
  }

  /** Fetch the city view (delta when possible) and the supply flows. Coalesces overlapping calls. */
  async refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return;
    }
    const engine = this.engine();
    const cityId = this.cityId;
    if (!engine || !cityId) return;
    this.inflight = true;
    try {
      const view = await engine.call('cityView', this.viewRevision !== undefined ? { cityId, since: this.viewRevision } : { cityId });
      if (this.disposed || cityId !== this.cityId) return;
      this.applyView(view);
      try {
        const flows = await engine.call('supplyFlows', { cityId });
        if (this.disposed || cityId !== this.cityId) return;
        this.flows = flows.flows ?? [];
        this.monthIndex = flows.month ? flows.month.year * 12 + flows.month.month - 1 : this.monthIndex;
      } catch (error) {
        this.warn(error);
      }
      this.rev++;
      this.emit();
    } catch (error) {
      this.warn(error);
    } finally {
      this.inflight = false;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  /** Apply a city view (exported for tests). */
  applyView(view: CityViewDto): void {
    if (view.full) this.visuals = new Map();
    for (const b of view.buildings ?? []) this.visuals.set(b.id, b);
    for (const id of view.removedIds ?? []) this.visuals.delete(id);
    this.viewRevision = view.revision;
    this.activity = activityMap(view.activity);
    if (view.activity?.month) this.monthIndex = view.activity.month.year * 12 + view.activity.month.month - 1;
  }

  private warn(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[living-city] economy feed unavailable; the city animates without live activity', error);
  }

  private emit(): void {
    const snap = this.snapshot;
    for (const l of [...this.listeners]) l(snap);
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.listeners.clear();
  }
}

export function activityMap(a: CityActivityDto | undefined | null): Map<number, BuildingActivity> {
  const out = new Map<number, BuildingActivity>();
  if (!a?.ids) return out;
  a.ids.forEach((id, i) => {
    out.set(id, {
      utilization: a.utilization?.[i] ?? null,
      unitsSold: a.unitsSold?.[i] ?? 0,
      transfersIn: a.transfersIn?.[i] ?? 0,
      transfersOut: a.transfersOut?.[i] ?? 0,
      revenue: a.revenue?.[i] ?? 0,
      netIncome: a.netIncome?.[i] ?? 0,
    });
  });
  return out;
}
