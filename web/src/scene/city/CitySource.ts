// Where the city layer gets its data. The game reads the zustand store and the engine client (bridge `cityLayout`,
// `cityView` with revision deltas); the ?dev=city preview supplies its own source (engine layouts plus demo
// buildings). The module only talks to this interface, so the renderer never depends on store internals.
import type { CityViewDto } from '@/bridge/protocol';
import { clock, getEngine, maybeEngine, useGameStore } from '@/state/gameStore';
import { asLayoutWire, type CityLayoutWire } from './layout/types';

export interface CityCompanyStyle {
  id: number;
  name: string;
  colorIndex: number;
}

export interface CitySourceState {
  /** Active city (null: nothing to show yet). */
  cityId: string | null;
  /** Engine revision; a change triggers a cityView delta fetch. */
  revision: number;
  /** Game month 1..12 (seasons, crops), or null when unknown. */
  month: number | null;
}

export interface CitySource {
  state(): CitySourceState;
  /** The city's layout (bridge `cityLayout`). */
  layout(cityId: string): Promise<CityLayoutWire>;
  /** Company buildings (bridge `cityView`); `since` = the revision held (delta), null = full. Null when unavailable. */
  view(cityId: string, since: number | null): Promise<CityViewDto | null>;
  /** Company names and colours for signs. */
  companies(): CityCompanyStyle[];
  /** City population (ambient density, audio), or null. */
  population(cityId: string): number | null;
  /** Fires when any input may have changed (city, revision, month, companies). */
  subscribe(listener: () => void): () => void;
  /** Frame the player's first building once per city (the game's Home behaviour). */
  readonly framePlayer: boolean;
  /** Game clock inside the current month (0..1): construction sites advance between month closes. */
  monthProgress?(): number;
}

interface CompanyLike { id: number; name?: string; colorIndex?: number; isPlayer?: boolean }
interface CityLike { id: string; population?: number }

/** The in-game source: zustand store + engine client. */
export class GameCitySource implements CitySource {
  readonly framePlayer = true;

  monthProgress(): number {
    return clock.progress;
  }

  state(): CitySourceState {
    const s = useGameStore.getState();
    const date = s.snapshot?.date as { month?: number } | undefined;
    return { cityId: s.phase === 'playing' || s.snapshot ? s.activeCityId : null, revision: s.revision, month: date?.month ?? null };
  }

  async layout(cityId: string): Promise<CityLayoutWire> {
    return asLayoutWire(await getEngine().call('cityLayout', { cityId }));
  }

  async view(cityId: string, since: number | null): Promise<CityViewDto | null> {
    const engine = maybeEngine();
    if (!engine) return null;
    try {
      return await engine.call('cityView', since === null ? { cityId } : { cityId, since });
    } catch (error) {
      console.warn('[city] cityView failed', error);
      return null;
    }
  }

  companies(): CityCompanyStyle[] {
    const list = (useGameStore.getState().snapshot?.companies ?? []) as CompanyLike[];
    return list.map((c) => ({ id: c.id, name: c.name ?? `Company ${c.id}`, colorIndex: c.colorIndex ?? (c.isPlayer ? 0 : 7) }));
  }

  population(cityId: string): number | null {
    const cities = (useGameStore.getState().catalog?.cities ?? []) as CityLike[];
    return cities.find((c) => c.id === cityId)?.population ?? null;
  }

  subscribe(listener: () => void): () => void {
    return useGameStore.subscribe((s, prev) => {
      if (s.activeCityId !== prev.activeCityId || s.revision !== prev.revision || s.snapshot !== prev.snapshot || s.catalog !== prev.catalog || s.phase !== prev.phase) listener();
    });
  }
}
