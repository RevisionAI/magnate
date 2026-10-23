// City preview data source: layouts from the real engine (WASM worker, `cityLayout` needs no game), company buildings
// from the demo placer (or none), a fixed month. Same CitySource contract the game uses.
import type { CityViewDto } from '@/bridge/protocol';
import { EngineClient } from '@/bridge/engine';
import type { CitySource, CitySourceState, CityCompanyStyle } from '@/scene/city/CitySource';
import { asLayoutWire, type CityLayoutWire } from '@/scene/city/layout/types';
import { DEMO_COMPANIES, demoView } from './demo';

export const PREVIEW_CITIES = ['metropolis', 'riverside', 'eastside', 'portbay', 'hilltown'] as const;
const POPULATION: Record<string, number> = { metropolis: 500000, riverside: 250000, eastside: 200000, portbay: 150000, hilltown: 100000 };

export class PreviewCitySource implements CitySource {
  readonly framePlayer = false;
  private cityId: string;
  private month: number;
  private revision = 1;
  private readonly listeners = new Set<() => void>();
  private engine: Promise<EngineClient> | null = null;
  demo: boolean;

  constructor(cityId: string, month: number, demo: boolean) {
    this.cityId = cityId;
    this.month = month;
    this.demo = demo;
  }

  private client(): Promise<EngineClient> {
    this.engine ??= EngineClient.boot().then((r) => r.client);
    return this.engine;
  }

  setCity(cityId: string): void { this.cityId = cityId; this.revision++; this.emit(); }
  setMonth(month: number): void { this.month = month; this.emit(); }
  setDemo(on: boolean): void { this.demo = on; this.revision++; this.emit(); }

  state(): CitySourceState {
    return { cityId: this.cityId, revision: this.revision, month: this.month };
  }

  async layout(cityId: string): Promise<CityLayoutWire> {
    const c = await this.client();
    return asLayoutWire(await c.call('cityLayout', { cityId }));
  }

  async view(cityId: string): Promise<CityViewDto | null> {
    const wire = await this.layout(cityId);
    const v = this.demo ? demoView(wire, this.month) : { cityId, revision: 1, full: true, buildings: [], removedIds: [], activity: { month: { year: 2026, month: this.month }, ids: [], revenue: [], unitsSold: [], exportUnits: [], netIncome: [], utilization: [], transfersIn: [], transfersOut: [] } };
    return { ...v, revision: this.revision, full: true };
  }

  companies(): CityCompanyStyle[] {
    return DEMO_COMPANIES;
  }

  population(cityId: string): number | null {
    return POPULATION[cityId] ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  dispose(): void {
    void this.engine?.then((c) => c.dispose());
  }
}
