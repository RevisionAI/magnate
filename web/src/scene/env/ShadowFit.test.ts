import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SunShadow, clipPolygonToRect, fitSunShadow } from './ShadowFit';
import { directionFromAngles } from './DayNight';

function camera(targetX: number, targetZ: number, distance: number, elevationDeg: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, Math.max(1, distance * 0.2), distance * 5 + 6000);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  cam.position.set(targetX, Math.sin(el) * distance, targetZ + Math.cos(el) * distance);
  cam.lookAt(targetX, 0, targetZ);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

describe('clipPolygonToRect', () => {
  it('clips a convex polygon to a rectangle', () => {
    const out = clipPolygonToRect([[-10, -10], [10, -10], [10, 10], [-10, 10]], { minX: 0, maxX: 5, minZ: -20, maxZ: 20 });
    const xs = out.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(5);
    expect(out.length).toBe(4);
  });
  it('returns an empty polygon when fully outside', () => {
    expect(clipPolygonToRect([[0, 0], [1, 0], [1, 1]], { minX: 5, maxX: 6, minZ: 5, maxZ: 6 })).toEqual([]);
  });
});

describe('fitSunShadow', () => {
  const sunDir = directionFromAngles(50, 160, new THREE.Vector3());

  it('covers the visible ground and stays texel-snapped while panning (no shimmer)', () => {
    const sun = new THREE.DirectionalLight();
    sun.shadow.mapSize.set(2048, 2048);
    const a = camera(0, 0, 900, 50);
    const t1 = fitSunShadow(sun, a, sunDir, new THREE.Vector3());
    const c1 = sun.shadow.camera;
    const l1 = c1.left, b1 = c1.bottom, w1 = c1.right - c1.left;
    // Pan by an arbitrary non-texel amount: the texel size stays the same and the frustum edges move by whole texels.
    const b = camera(37.3, -11.9, 900, 50);
    const t2 = fitSunShadow(sun, b, sunDir, new THREE.Vector3());
    expect(t2).toBeCloseTo(t1, 9);
    const c2 = sun.shadow.camera;
    expect(c2.right - c2.left).toBeCloseTo(w1, 6);
    const tx = w1 / 2048;
    const steps = (c2.left - l1) / tx;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    const ty = (c2.top - c2.bottom) / 2048;
    const stepsY = (c2.bottom - b1) / ty;
    expect(Math.abs(stepsY - Math.round(stepsY))).toBeLessThan(1e-6);
  });

  it('gets finer at street zoom than at overview (≈ art §3.10 densities)', () => {
    const sun = new THREE.DirectionalLight();
    sun.shadow.mapSize.set(2048, 2048);
    const street = fitSunShadow(sun, camera(0, 0, 150, 38), sunDir, new THREE.Vector3(), 160, 6000, { minX: -1400, maxX: 1400, minZ: -1400, maxZ: 1400 });
    const overview = fitSunShadow(sun, camera(0, 0, 2400, 60), sunDir, new THREE.Vector3(), 160, 6000, { minX: -1400, maxX: 1400, minZ: -1400, maxZ: 1400 });
    expect(street).toBeLessThan(0.4);
    expect(overview).toBeGreaterThan(street * 4);
    expect(overview).toBeLessThan(2.5);
  });

  it('the light frustum contains every caster up to the cap height above the visible footprint', () => {
    const sun = new THREE.DirectionalLight();
    sun.shadow.mapSize.set(2048, 2048);
    const cam = camera(100, 50, 600, 45);
    fitSunShadow(sun, cam, sunDir, new THREE.Vector3());
    const sc = sun.shadow.camera;
    // What three's LightShadow.updateMatrices does before rendering the shadow map.
    sc.position.copy(sun.position);
    sc.lookAt(sun.target.position);
    sc.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
    const ray = new THREE.Raycaster();
    for (const [x, y] of [[-0.9, -0.9], [0.9, -0.9], [0, 0], [0.9, 0.9], [-0.9, 0.9]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), cam);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
      expect(frustum.containsPoint(hit)).toBe(true);
      expect(frustum.containsPoint(hit.clone().setY(150))).toBe(true);
    }
  });
});

describe('SunShadow update policy (art §3.10)', () => {
  it('re-renders only when the camera moved, the sun turned > 0.15° (≤ 4 Hz) or a caster changed', () => {
    const sun = new THREE.DirectionalLight();
    const s = new SunShadow(sun, 2048);
    expect(sun.shadow.autoUpdate).toBe(false);
    const cam = camera(0, 0, 800, 45);
    const dir = directionFromAngles(40, 150, new THREE.Vector3());
    expect(s.update(0, cam, false, dir, new THREE.Vector3())).toBe(true);      // first frame: pending
    expect(s.update(0.016, cam, false, dir, new THREE.Vector3())).toBe(false);  // nothing changed
    expect(s.update(0.032, cam, true, dir, new THREE.Vector3())).toBe(true);    // camera moved
    const turned = directionFromAngles(40.5, 150, new THREE.Vector3());
    expect(s.update(0.3, cam, false, turned, new THREE.Vector3())).toBe(true);  // sun turned 0.5°
    const turned2 = directionFromAngles(41, 150, new THREE.Vector3());
    expect(s.update(0.35, cam, false, turned2, new THREE.Vector3())).toBe(false); // throttled to 4 Hz
    expect(s.update(0.56, cam, false, turned2, new THREE.Vector3())).toBe(true);
    s.requestUpdate();
    expect(s.update(0.57, cam, false, turned2, new THREE.Vector3())).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);
  });
  it('changing the map size drops the old map and forces a refit', () => {
    const sun = new THREE.DirectionalLight();
    const s = new SunShadow(sun, 2048);
    const cam = camera(0, 0, 800, 45);
    const dir = directionFromAngles(40, 150, new THREE.Vector3());
    s.update(0, cam, false, dir, new THREE.Vector3());
    s.setMapSize(1024);
    expect(sun.shadow.mapSize.x).toBe(1024);
    expect(s.update(0.1, cam, false, dir, new THREE.Vector3())).toBe(true);
  });
});
