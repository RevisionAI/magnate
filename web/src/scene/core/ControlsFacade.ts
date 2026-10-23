// MapControls-compatible facade over the camera-controls rig, for modules written against the skeleton's
// `ctx.controls` (MapControls). Reads are live; writing `target` moves the rig's target on the next frame.
import * as THREE from 'three';
import type { CameraRig } from '../interaction/CameraRig';
import type { ControlsLike } from '../SceneContext';

export class ControlsFacade implements ControlsLike {
  readonly target = new THREE.Vector3();
  private readonly synced = new THREE.Vector3();
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly rig: CameraRig) {
    rig.getTarget(this.target);
    this.synced.copy(this.target);
  }

  get enabled(): boolean { return this.rig.enabled; }
  set enabled(on: boolean) { this.rig.enabled = on; }

  getDistance(): number { return this.rig.distance; }
  getPolarAngle(): number { return this.rig.controls.polarAngle; }
  getAzimuthalAngle(): number { return this.rig.controls.azimuthAngle; }
  update(): boolean { return false; }

  addEventListener(type: 'change', listener: () => void): void {
    if (type === 'change') this.changeListeners.add(listener);
  }

  removeEventListener(type: 'change', listener: () => void): void {
    if (type === 'change') this.changeListeners.delete(listener);
  }

  /** Before the rig updates: apply external writes to `target`. */
  syncIn(): void {
    if (!this.target.equals(this.synced)) void this.rig.focusOn(this.target, undefined, false);
  }

  /** After the rig updated: mirror its target and emit `change` when the camera moved. */
  syncOut(moved: boolean): void {
    this.rig.getTarget(this.target);
    this.synced.copy(this.target);
    if (moved) for (const l of this.changeListeners) l();
  }
}
