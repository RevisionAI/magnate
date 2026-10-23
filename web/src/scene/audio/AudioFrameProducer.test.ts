import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLOT_SIZE } from '../units';
import {
  AudioFrameProducer, LANDUSE_GREEN, LANDUSE_INDUSTRIAL, LANDUSE_ROAD, LANDUSE_WATER, LandUseGrid, emptyArea, type AudioFrame,
} from './AudioFrameProducer';

/** 10×10 grid: west half industrial, east half green, a road row at z = 5, water in the last column. */
function grid(): LandUseGrid {
  const W = 10, H = 10;
  const lu = new Uint8Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      lu[z * W + x] = x === 9 ? LANDUSE_WATER : z === 5 ? LANDUSE_ROAD : x < 5 ? LANDUSE_INDUSTRIAL : LANDUSE_GREEN;
    }
  }
  return new LandUseGrid('test', W, H, lu, { coastal: true, population: 500000 });
}

const plotX = (px: number) => (px + 0.5 - 5) * PLOT_SIZE;

describe('LandUseGrid (summed-area tables)', () => {
  it('returns land-use shares in a window', () => {
    const g = grid();
    const a = g.area(plotX(2), plotX(2), 1.5 * PLOT_SIZE, emptyArea());     // 3×3 plots, all industrial
    expect(a.industrial).toBeCloseTo(1, 6);
    expect(a.green).toBe(0);
    const whole = g.area(0, 0, 10 * PLOT_SIZE, emptyArea());
    expect(whole.water).toBeCloseTo(0.1, 6);
    expect(whole.road).toBeCloseTo(0.09, 6);
    expect(whole.industrial + whole.green + whole.road + whole.water).toBeCloseTo(1, 6);
    expect(whole.traffic).toBeCloseTo(whole.road, 6);                      // population 500k → density 1
  });
  it('clips windows at the city edge and is empty outside', () => {
    const g = grid();
    expect(g.area(-5000, -5000, 100, emptyArea())).toEqual(emptyArea());
  });
  it('measures plot distance to water, including outside the grid', () => {
    const g = grid();
    expect(g.distToWaterPlots(plotX(8), plotX(3))).toBe(1);
    expect(g.distToWaterPlots(plotX(0), plotX(3))).toBe(9);
    expect(new LandUseGrid('dry', 2, 2, new Uint8Array(4)).distToWaterPlots(0, 0)).toBe(999);
  });
  it('updates after edits + rebuild', () => {
    const g = grid();
    g.setLandUse(2, 2, LANDUSE_GREEN);
    g.rebuild();
    expect(g.area(plotX(2), plotX(2), 0.5 * PLOT_SIZE, emptyArea()).green).toBeCloseTo(1, 6);
  });
});

describe('AudioFrameProducer', () => {
  it('publishes at 10 Hz with the listener rig at 35 % of the camera offset', () => {
    const p = new AudioFrameProducer();
    p.source = grid();
    const frames: AudioFrame[] = [];
    p.subscribe((f) => frames.push({ ...f, focus: { ...f.focus }, listener: { ...f.listener }, area: { ...f.area } }));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 300, 400);
    const target = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60; i++) {
      p.update({ dt: 1 / 60, time: i / 60, camera, target, distance: 500, zoom01: 0.3, zoomBand: 'district', timeOfDay: 13, month: 5, rain: 0.2, wind: 0.4, lightning: 0, speed: 1 });
    }
    expect(frames.length).toBeGreaterThanOrEqual(10);
    expect(frames.length).toBeLessThanOrEqual(11);
    const f = frames[frames.length - 1];
    expect(f.listener.x).toBeCloseTo(0, 9);
    expect(f.listener.y).toBeCloseTo(105, 9);
    expect(f.listener.z).toBeCloseTo(140, 9);
    expect(f.cityId).toBe('test');
    expect(f.coastal).toBe(true);
    expect(f.timeOfDay).toBe(13);
    expect(f.rain).toBe(0.2);
    expect(f.area.industrial + f.area.green + f.area.road + f.area.water).toBeCloseTo(1, 6);
  });
  it('falls back to empty areas without a source', () => {
    const p = new AudioFrameProducer();
    p.cityId = 'x';
    p.update({ dt: 1, time: 0, camera: new THREE.PerspectiveCamera(), target: new THREE.Vector3(), distance: 100, zoom01: 0, zoomBand: 'street', timeOfDay: null, month: 0, rain: 0, wind: 0, lightning: 0, speed: 0 });
    expect(p.frame.area).toEqual(emptyArea());
    expect(p.frame.distToWaterPlots).toBe(999);
    expect(p.frame.cityId).toBe('x');
  });
});
