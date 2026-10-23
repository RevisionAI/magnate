// The audio listener rig (audio-plan §4.3): an Object3D in the scene that sits 35 % of the way from
// the camera's ground target to the camera, with the camera's orientation. The THREE.AudioListener
// is its child, so three's render-time updateMatrixWorld pushes position/orientation to WebAudio.
// Street zoom is intimate, city zoom distant without being deaf; the beds cover the far view.

import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _target = new THREE.Vector3();

export class ListenerRig extends THREE.Object3D {
  /** Fraction of the way from the target to the camera. */
  static readonly LERP = 0.35;

  constructor(
    private readonly camera: THREE.Camera,
    listener: THREE.AudioListener,
    private readonly getTarget?: () => THREE.Vector3 | { x: number; y: number; z: number } | null,
  ) {
    super();
    this.name = 'audio-listener-rig';
    this.add(listener);
  }

  /** The camera's ground target: supplied by the host, else the camera ray's hit on y = 0. */
  target(out = _target): THREE.Vector3 {
    const t = this.getTarget?.();
    if (t) return out.set(t.x, t.y, t.z);
    this.camera.getWorldDirection(_fwd);
    const cam = this.camera.position;
    if (_fwd.y < -1e-3) {
      const k = -cam.y / _fwd.y;
      return out.copy(cam).addScaledVector(_fwd, Math.min(k, 20000));
    }
    return out.set(cam.x, 0, cam.z);
  }

  /** Camera-to-target distance in metres (drives zoom01 when the renderer provides none). */
  distance(): number {
    return this.camera.position.distanceTo(this.target());
  }

  override updateMatrixWorld(force?: boolean): void {
    const t = this.target();
    this.position.copy(t).lerp(this.camera.position, ListenerRig.LERP);
    this.quaternion.copy(this.camera.quaternion);
    super.updateMatrixWorld(force);
  }
}
