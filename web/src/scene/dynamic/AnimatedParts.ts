// Animated building parts (art §5.20; W4 PART_SPECS + partPose): pumpjack beams and cranks, mine sheave wheels, port
// gantry trolleys, construction tower cranes and excavator arms, irrigation pivots, flags, fans and window-cleaner
// gondolas. One InstancedMesh per (kind, extent) with CityMaterial; owner faces take the owner colour as the instance
// colour. Poses come from W4's pure `partPose` on the living city's animation clock, so parts stop when the game is
// paused (or reduced motion is on) and rest at the zero pose when the building is idle, closed or not producing.
// Matrices are rewritten only for parts within 1,500 m of the camera (at most a few hundred instances per city).
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import type { AnimatedPart, AnimatedPartKind } from '../assets/AssetFactory';
import { GeoBuilder, toBufferGeometry } from '../assets/GeoBuilder';
import { PART_SPECS, partPose, type PartPose } from '../assets/familiesB';
import { ownerRgb } from '../assets/palette';
import { makeCityMaterial } from '../materials/CityMaterial';
import type { LivingCity } from './LivingCity';
import { linearRgb } from './traffic/VehicleRenderer';

const UPDATE_RANGE = 1500;

interface PartInstance {
  part: AnimatedPart;
  buildingId: number;
  active: boolean;
}

interface PartBatch {
  kind: AnimatedPartKind;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  items: PartInstance[];
}

const _yaw = new THREE.Matrix4();
const _motion = new THREE.Matrix4();
const _scale = new THREE.Matrix4();

/** World matrix of a part: T(pivot) · R_y(rotY) · Motion(axis, angle, offset) · S(scale). Pure (tested). */
export function partMatrix(part: AnimatedPart, pose: PartPose, out: THREE.Matrix4): THREE.Matrix4 {
  const k = part.scale ?? 1;
  _yaw.makeRotationY(part.rotY);
  const axis = pose.axis === 'x' ? AXIS_X : pose.axis === 'y' ? AXIS_Y : AXIS_Z;
  _motion.makeRotationAxis(axis, pose.angle);
  if (pose.offset) _motion.setPosition(axis.x * pose.offset, axis.y * pose.offset, axis.z * pose.offset);
  out.makeTranslation(part.x, part.y, part.z).multiply(_yaw).multiply(_motion);
  if (k !== 1) out.multiply(_scale.makeScale(k, k, k));
  return out;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class AnimatedPartsModule implements SceneModule {
  readonly name = 'living-city-parts';
  private ctx!: SceneContext;
  private readonly group = new THREE.Group();
  private readonly material = makeCityMaterial();
  private readonly batches = new Map<string, PartBatch>();
  private readonly offs: Array<() => void> = [];
  private readonly m = new THREE.Matrix4();
  private readonly pose: PartPose = { axis: 'y', angle: 0, offset: 0 };
  private signature = '';
  private firstFrame = true;
  /** Parts on the map (diagnostics). */
  count = 0;

  constructor(private readonly hub: LivingCity) {}

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.group.name = 'living-city-parts';
    ctx.scene.add(this.group);
    const sync = () => this.sync();
    this.offs.push(this.hub.on('buildings', sync), this.hub.on('layout', sync));
    this.sync();
  }

  private sync(): void {
    const parts: Array<PartInstance & { key: string }> = [];
    for (const b of this.hub.buildings.values()) {
      for (const p of b.parts) {
        const key = `${p.kind}:${p.extent ?? ''}`;
        parts.push({ part: p, buildingId: b.id, active: p.active !== false && (b.working || b.progress !== undefined), key });
      }
    }
    const sig = parts.map((p) => `${p.key}@${p.part.x.toFixed(1)},${p.part.z.toFixed(1)}:${p.active ? 1 : 0}:${p.part.owner}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    for (const b of this.batches.values()) b.items = [];
    for (const p of parts) {
      let batch = this.batches.get(p.key);
      if (!batch) batch = this.makeBatch(p.part, p.key);
      batch.items.push(p);
    }
    for (const [key, batch] of this.batches) {
      if (!batch.items.length) {
        batch.mesh.removeFromParent();
        batch.mesh.dispose();
        batch.geometry.dispose();
        this.batches.delete(key);
        continue;
      }
      if (batch.mesh.instanceMatrix.count < batch.items.length) {
        const fresh = this.instanced(batch.geometry, batch.items.length, batch.kind);
        batch.mesh.removeFromParent();
        batch.mesh.dispose();
        batch.mesh = fresh;
        this.group.add(fresh);
      }
      batch.mesh.count = batch.items.length;
      batch.items.forEach((it, i) => {
        const [r, g, b] = linearRgb(ownerRgb(it.part.owner));
        batch.mesh.instanceColor!.setXYZ(i, r, g, b);
        batch.mesh.setMatrixAt(i, partMatrix(it.part, partPose({ ...it.part, active: false }, 0, this.pose), this.m));
      });
      batch.mesh.instanceColor!.needsUpdate = true;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.computeBoundingSphere();
    }
    this.count = parts.length;
    this.firstFrame = true;
  }

  private makeBatch(part: AnimatedPart, key: string): PartBatch {
    const spec = PART_SPECS[part.kind];
    const b = new GeoBuilder();
    spec.build(b, part.extent ?? spec.defaultExtent);
    const geometry = toBufferGeometry(b.finish());
    const mesh = this.instanced(geometry, 8, part.kind);
    this.group.add(mesh);
    const batch: PartBatch = { kind: part.kind, mesh, geometry, items: [] };
    this.batches.set(key, batch);
    return batch;
  }

  private instanced(geometry: THREE.BufferGeometry, n: number, kind: AnimatedPartKind): THREE.InstancedMesh {
    const cap = Math.max(8, 1 << Math.ceil(Math.log2(n)));
    const mesh = new THREE.InstancedMesh(geometry, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = `parts:${kind}`;
    // moving parts never cast shadows: the sun shadow map is only re-rendered when the camera moves (art §3.10)
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
  }

  update(frame: FrameInfo): void {
    if (this.hub.frozen && !this.firstFrame) return;
    this.firstFrame = false;
    const t = this.hub.animTime;
    const cam = this.ctx.camera.position;
    const r2 = UPDATE_RANGE * UPDATE_RANGE;
    for (const batch of this.batches.values()) {
      let touched = false;
      batch.items.forEach((it, i) => {
        if (!it.active) return;
        const p = it.part;
        if ((p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > r2 && frame.cameraDistance < UPDATE_RANGE) return;
        partPose(p, t, this.pose);
        batch.mesh.setMatrixAt(i, partMatrix(p, this.pose, this.m));
        touched = true;
      });
      if (touched) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const b of this.batches.values()) {
      b.mesh.dispose();
      b.geometry.dispose();
    }
    this.batches.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
