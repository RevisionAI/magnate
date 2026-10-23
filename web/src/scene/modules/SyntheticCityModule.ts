// SceneModule that puts a synthetic city into a CityScene: layout → merged chunks, trees, lamps, light pools; sets
// the SceneWorld (outskirts, water, camera bounds) and the audio land-use source; follows seasons; applies the
// lamp/tree distance bands every frame. Used by the SceneLab; PlaceholderCity reuses SyntheticCityView directly.
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import type { Climate } from '../env/Seasons';
import { layoutSyntheticCity, type SyntheticLayout } from './synthetic/Layout';
import { SyntheticCityView, worldFromLayout, type SyntheticCityStats } from './synthetic/SyntheticCityView';

export interface SyntheticCityOptions {
  cityId?: string;
  gridW?: number;
  gridH?: number;
  seed?: number;
  coastal?: boolean;
  river?: boolean;
  climate?: Climate;
  reliefM?: number;
  population?: number;
}

export class SyntheticCityModule implements SceneModule {
  readonly name = 'synthetic-city';
  layout: SyntheticLayout | null = null;
  view: SyntheticCityView | null = null;
  private ctx: SceneContext | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: SyntheticCityOptions = {}) {}

  get stats(): SyntheticCityStats | null {
    return this.view?.stats ?? null;
  }

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    const o = this.options;
    const cityId = o.cityId ?? 'scenelab';
    const layout = layoutSyntheticCity({ gridW: o.gridW ?? 40, gridH: o.gridH ?? 40, seed: o.seed ?? 20261001, coastal: o.coastal ?? true, river: o.river ?? true });
    this.layout = layout;
    const coastal = o.coastal ?? true;
    const population = o.population ?? 250000;
    this.view = new SyntheticCityView(layout, cityId, { coastal, population });
    ctx.scene.add(this.view.group);
    ctx.setWorld(worldFromLayout(layout, cityId, o.climate ?? 'temperate', o.reliefM ?? 30, population));
    ctx.setAudioAreaSource(this.view.landUse);
    this.unsubscribe = ctx.env.onSeasonChange((s) => this.view?.applySeason(s));
  }

  update(frame: FrameInfo): void {
    const ctx = this.ctx, view = this.view;
    if (!ctx || !view) return;
    if (view.update(ctx.camera.position, frame.target, frame.cameraDistance, frame.night, ctx.quality.knobs)) ctx.requestShadowUpdate();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.ctx?.setAudioAreaSource(null);
    this.view?.dispose();
    this.view = null;
  }
}
