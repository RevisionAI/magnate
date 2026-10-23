// Hover and selection visuals (art §5.13): the post-pipeline outline (hover 0.6, selected 1.0) on the building's
// own mesh or a LAYER_SELECTION-only proxy, the selected building's dashed gold footprint ring (1.2 m, 0.5 Hz), and
// an inverted-hull outline on the minimal pipeline (no composer).
import * as THREE from 'three';
import { LAYER_SELECTION, type SceneContext } from '../SceneContext';
import { STATUS } from '@/theme/tokens';
import type { CityBuildingRef } from './CitySource';
import { makeRingMaterial, rectRingGeometry, ringWidthFor, type RingMaterial, type RingRect } from './FootprintRing';

/** A box proxy for buildings the renderer cannot hand over as objects (outline only; never drawn by the camera). */
export function boxProxy(ref: CityBuildingRef): THREE.Mesh {
  const [x0, y0, z0, x1, y1, z1] = ref.box;
  const geo = new THREE.BoxGeometry(Math.max(0.5, x1 - x0), Math.max(0.5, y1 - y0), Math.max(0.5, z1 - z0));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.updateMatrixWorld(true);
  mesh.layers.set(LAYER_SELECTION);
  mesh.userData.w6Proxy = true;
  return mesh;
}

const HULL_SCALE = 1.015;

export class SelectionVisuals {
  private hover: THREE.Object3D | null = null;
  private selected: THREE.Object3D | null = null;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: RingMaterial;
  private readonly hulls = new THREE.Group();
  private readonly proxies = new THREE.Group();
  private readonly hullMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false });
  private ringKey = '';
  private time = 0;

  constructor(private readonly ctx: SceneContext) {
    this.ringMat = makeRingMaterial(STATUS.ring, { width: 1.2, dash: 7, lift: 0.5 });
    this.ring = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMat);
    this.ring.name = 'selection-ring';
    this.ring.renderOrder = 4;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    this.hulls.name = 'outline-hulls';
    this.proxies.name = 'outline-proxies';
    ctx.scene.add(this.ring, this.hulls, this.proxies);
  }

  /** Objects to outline; null clears. Proxies created by `boxProxy` are disposed when replaced. */
  set(hover: THREE.Object3D | null, selected: THREE.Object3D | null): void {
    if (hover === this.hover && selected === this.selected) return;
    for (const old of [this.hover, this.selected]) {
      if (old && old !== hover && old !== selected && old.userData.w6Proxy) disposeProxy(old);
    }
    this.hover = hover;
    this.selected = selected;
    // Proxies must be in the scene for the outline's mask pass (they live on LAYER_SELECTION only).
    for (const o of [hover, selected]) if (o?.userData.w6Proxy && !o.parent) this.proxies.add(o);
    this.apply();
  }

  /** Selected footprint ring (world rectangle) or null. */
  setRing(rect: RingRect | null): void {
    const key = rect ? `${rect.x0},${rect.z0},${rect.x1},${rect.z1}` : '';
    if (key === this.ringKey) return;
    this.ringKey = key;
    this.ring.visible = !!rect;
    if (!rect) return;
    this.ring.geometry.dispose();
    this.ring.geometry = rectRingGeometry([rect], -2.2);   // just outside the lot, clear of the gold decal
  }

  /** Re-apply after a tier switch (the outline controller keeps its list, but the hull fallback depends on post). */
  refresh(): void {
    this.apply();
  }

  private apply(): void {
    const list = [this.selected, this.hover].filter((o, i, a): o is THREE.Object3D => !!o && a.indexOf(o) === i);
    const minimal = this.ctx.post === null;
    if (minimal) {
      this.ctx.outline.clear();
      this.rebuildHulls(list);
    } else {
      this.rebuildHulls([]);
      if (list.length === 0) this.ctx.outline.clear();
      else {
        this.ctx.outline.set(list);
        this.ctx.outline.strength = this.selected ? 1 : 0.6;
      }
    }
  }

  private rebuildHulls(list: THREE.Object3D[]): void {
    // Hulls share the source geometry (never disposed here).
    for (const h of [...this.hulls.children]) this.hulls.remove(h);
    for (const o of list) {
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh) || m.userData.w6Hull) return;
        m.updateWorldMatrix(true, false);
        const geo = m.geometry as THREE.BufferGeometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const center = geo.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
        const hull = new THREE.Mesh(geo, this.hullMat);
        hull.userData.w6Hull = true;
        hull.matrixAutoUpdate = false;
        // world = T(center) · S · T(−center) · M
        hull.matrix.makeTranslation(center.x, center.y, center.z)
          .multiply(new THREE.Matrix4().makeScale(HULL_SCALE, HULL_SCALE, HULL_SCALE))
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
          .multiply(m.matrixWorld);
        hull.layers.set(0);
        this.hulls.add(hull);
      });
    }
    this.hullMat.opacity = this.selected ? 0.95 : 0.6;
  }

  update(dt: number, cameraDistance: number, reducedMotion: boolean): void {
    this.time += dt;
    this.ringMat.uniforms.uTime.value = reducedMotion ? 0 : this.time * 0.5;
    this.ringMat.uniforms.uWidth.value = ringWidthFor(cameraDistance, 1.2, 2.6);
  }

  dispose(): void {
    this.ctx.outline.clear();
    for (const o of [this.hover, this.selected]) if (o?.userData.w6Proxy) disposeProxy(o);
    this.rebuildHulls([]);
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.hulls.removeFromParent();
    this.proxies.removeFromParent();
    this.hullMat.dispose();
  }
}

function disposeProxy(o: THREE.Object3D): void {
  o.removeFromParent();
  if (o instanceof THREE.Mesh) {
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
}
