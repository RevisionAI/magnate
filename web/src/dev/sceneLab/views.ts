// SceneLab camera presets and the drained-throughput benchmark over (tier × view × hour).
import * as THREE from 'three';
import type { CityScene } from '@/scene/CityScene';
import type { Tier } from '@/scene/core/Quality';
import { benchDrained } from '@/scene/core/FrameBench';
import { POLAR_MAX, type ViewPreset } from '@/scene/interaction/CameraRig';
import type { SyntheticLayout } from '@/scene/modules/synthetic/Layout';
import { PLOT_SIZE } from '@/scene/units';

export type LabView = 'overview' | 'mid' | 'close' | 'street' | 'horizon';
export const LAB_VIEWS: readonly LabView[] = ['overview', 'mid', 'close', 'street', 'horizon'];

/**
 * Views of art §1.1 (overview 2,350 m at 52° elevation on Metropolis — scaled to the city size here; mid = the CBD
 * from 760 m at 46°; close = 230 m at 38°), plus a street-level view and a low "horizon" photo view (beyond the
 * gameplay tilt limit) that shows the sky.
 */
export function labView(view: LabView, layout: SyntheticLayout, maxDistance: number, azimuthDeg = 330): ViewPreset {
  const cbd = { x: (layout.center.px - layout.gridW / 2) * PLOT_SIZE, z: (layout.center.pz - layout.gridH / 2) * PLOT_SIZE };
  switch (view) {
    case 'overview': return { target: { x: 0, z: 0 }, distance: 0.75 * maxDistance, azimuthDeg, polarDeg: 38 };
    case 'mid': return { target: cbd, distance: 760, azimuthDeg, polarDeg: 44 };
    case 'close': return { target: cbd, distance: 230, azimuthDeg, polarDeg: 52 };
    case 'street': return { target: { x: cbd.x + 3 * PLOT_SIZE, z: cbd.z + 6 * PLOT_SIZE }, distance: 115, azimuthDeg, polarDeg: 55 };
    case 'horizon': return { target: cbd, distance: 700, azimuthDeg, polarDeg: 79 };
  }
}

/** Apply a lab view instantly; the horizon view temporarily lifts the gameplay tilt limit. */
export function applyLabView(scene: CityScene, view: LabView, layout: SyntheticLayout, azimuthDeg?: number): Promise<void> {
  scene.rig.controls.maxPolarAngle = view === 'horizon' ? THREE.MathUtils.degToRad(82) : POLAR_MAX;
  return scene.rig.setView(labView(view, layout, scene.rig.controls.maxDistance, azimuthDeg), false);
}

export interface BenchRow {
  tier: Tier;
  view: LabView;
  hour: number;
  gpu: string;
  width: number;
  height: number;
  pixelRatio: number;
  /** Static camera (shadow map not re-rendered, as in play when nothing moves). */
  staticMedian: number;
  staticMin: number;
  /** GPU timer-query ms per static frame (null when unsupported or disjoint). */
  staticGpu: number | null;
  /** Camera moving (shadow map re-rendered every frame). */
  movingMedian: number;
  movingMin: number;
  movingGpu: number | null;
  jsSubmitMs: number;
  calls: number;
  triangles: number;
  movingCalls: number;
  movingTriangles: number;
}

export interface LabBenchOptions {
  tiers: Tier[];
  views: LabView[];
  hours: number[];
  runs?: number;
  frames?: number;
}

/** Benchmark with the animation loop paused; restores the loop afterwards. */
export async function runLabBench(scene: CityScene, layout: SyntheticLayout, o: LabBenchOptions, onRow?: (row: BenchRow) => void): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  const dt = 1 / 60;
  const frame = () => { scene.step(dt); scene.render(dt); };
  const moving = () => { scene.requestShadowUpdate(); scene.step(dt); scene.render(dt); };
  scene.setLoopRunning(false);
  scene.env.clock.paused = true;
  try {
    for (const tier of o.tiers) {
      scene.setTier(tier);
      await scene.pipelineReady;
      for (const hour of o.hours) {
        scene.setHour(hour);
        for (const view of o.views) {
          await applyLabView(scene, view, layout);
          for (let i = 0; i < 12; i++) frame();       // settle camera, shadows, LOD
          const s = await benchDrained(scene.renderer, frame, { runs: o.runs ?? 5, frames: o.frames ?? 40 });
          const m = await benchDrained(scene.renderer, moving, { runs: o.runs ?? 5, frames: o.frames ?? 40, submitFrames: 4 });
          const size = scene.renderer.getDrawingBufferSize(new THREE.Vector2());
          const row: BenchRow = {
            tier, view, hour, gpu: scene.quality.gpu, width: size.x, height: size.y, pixelRatio: scene.quality.pixelRatio,
            staticMedian: s.medianMs, staticMin: s.minMs, staticGpu: s.gpuMs, movingMedian: m.medianMs, movingMin: m.minMs,
            movingGpu: m.gpuMs, jsSubmitMs: s.jsSubmitMs,
            calls: s.calls, triangles: s.triangles, movingCalls: m.calls, movingTriangles: m.triangles,
          };
          rows.push(row);
          onRow?.(row);
        }
      }
    }
  } finally {
    scene.setLoopRunning(true);
  }
  return rows;
}
