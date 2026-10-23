// Scene module that draws rain streaks and snowflakes from W1's weather state (art §5.18). Budgets: rain 4,000 on
// LOW and 8,000 on MEDIUM+, snow 3,000. Hidden under reduced motion (UX: no moving decoration).
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { PrecipitationLayer } from '../env/WeatherParticles';
import type { LivingCity } from './LivingCity';

export class WeatherFxModule implements SceneModule {
  readonly name = 'living-city-weather';
  private ctx!: SceneContext;
  private readonly group = new THREE.Group();
  private rain!: PrecipitationLayer;
  private snow!: PrecipitationLayer;

  constructor(private readonly hub: LivingCity) {}

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.group.name = 'living-city-weather';
    this.rain = new PrecipitationLayer('rain', 0x5eed);
    this.snow = new PrecipitationLayer('snow', 0xf1a4e);
    this.group.add(this.rain.mesh, this.snow.mesh);
    ctx.scene.add(this.group);
  }

  update(frame: FrameInfo): void {
    const w = this.ctx.env.weatherState;
    const off = this.hub.reducedMotion || !w;
    const light = 1 - 0.7 * frame.night;
    const rainBudget = this.ctx.quality.tier === 'low' || this.ctx.quality.minimal ? 4000 : 8000;
    const camY = this.ctx.camera.position.y;
    this.rain.update(frame.elapsed, off ? 0 : w.rain, frame.target, frame.cameraDistance, w?.wind ?? 0, rainBudget, light, camY);
    this.snow.update(frame.elapsed, off ? 0 : w.snowfall, frame.target, frame.cameraDistance, w?.wind ?? 0, 3000, light, camY);
  }

  dispose(): void {
    this.rain.dispose();
    this.snow.dispose();
    this.group.removeFromParent();
  }
}
