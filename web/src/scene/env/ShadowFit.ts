// One directional shadow map fitted to the visible ground footprint (art §3.10, Appendix A.7), texel-snapped in a
// light space anchored at the city centre so panning does not shimmer, plus the per-light update policy.
//
// Fit: intersect six NDC rays with the ground, clip that footprint to the city (+margin: nothing outside the city
// casts), extend it up to the tallest caster, take the bounds in light space and snap them to the texel grid.
// Shadows run along the light-space Z axis, so the XY bounds of the visible receivers cover every relevant caster;
// only the Z range must reach towards the sun — by maxCasterHeight / sin(elevation) at low sun angles.
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _v = new THREE.Vector3(), _hit = new THREE.Vector3(), _ndc = new THREE.Vector2();
const _look = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
/** Footprint polygon in order (bottom edge left→right, top edge right→left): convex on the ground plane. */
const NDC: ReadonlyArray<readonly [number, number]> = [[-1, -1], [0, -1], [1, -1], [1, 1], [0, 1], [-1, 1]];
/** Distance of the light from the anchor along the sun direction (beyond every caster of a 3 km city). */
const LIGHT_DISTANCE = 6000;

export interface GroundRect { minX: number; maxX: number; minZ: number; maxZ: number }

type P2 = [number, number];

/** Sutherland–Hodgman clip of a convex ground polygon (x, z) against an axis-aligned rectangle. */
export function clipPolygonToRect(poly: P2[], r: GroundRect): P2[] {
  let out = poly;
  const edges: Array<[(p: P2) => number]> = [
    [(p) => p[0] - r.minX], [(p) => r.maxX - p[0]], [(p) => p[1] - r.minZ], [(p) => r.maxZ - p[1]],
  ];
  for (const [inside] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const da = inside(a), db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (out.length === 0) break;
  }
  return out;
}

/** Quantise a texel size to steps of 2^(1/4) so small zoom changes do not re-grid the shadow map every frame. */
function quantizeTexel(t: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(t, 1e-4)) * 4) / 4);
}

/**
 * Fit `sun.shadow.camera` to what `camera` sees. Returns metres per shadow texel (debug HUD). Appendix A signature,
 * plus an optional `clip` rectangle (city bounds + margin) the footprint is clipped to.
 */
export function fitSunShadow(
  sun: THREE.DirectionalLight, camera: THREE.PerspectiveCamera, dirToSun: THREE.Vector3, anchor: THREE.Vector3,
  maxCasterHeight = 160, maxDist = 6000, clip: GroundRect | null = null,
): number {
  let poly: P2[] = [];
  for (const [x, y] of NDC) {
    _ray.setFromCamera(_ndc.set(x, y), camera);
    const hit = _ray.ray.intersectPlane(_ground, _hit);
    if (hit && hit.distanceTo(camera.position) < maxDist) poly.push([hit.x, hit.z]);
    else { _ray.ray.at(Math.min(maxDist, camera.far * 0.5), _v); poly.push([_v.x, _v.z]); }
  }
  if (clip) {
    const clipped = clipPolygonToRect(poly, clip);
    if (clipped.length >= 3) poly = clipped;      // looking outside the city: keep the raw footprint (harmless)
  }
  sun.position.copy(anchor).addScaledVector(dirToSun, LIGHT_DISTANCE);
  sun.target.position.copy(anchor);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  _look.lookAt(sun.position, anchor, _up).setPosition(sun.position);
  _inv.copy(_look).invert();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [px, pz] of poly) {
    for (const h of [0, maxCasterHeight]) {
      _v.set(px, h, pz).applyMatrix4(_inv);
      if (_v.x < minX) minX = _v.x; if (_v.x > maxX) maxX = _v.x;
      if (_v.y < minY) minY = _v.y; if (_v.y > maxY) maxY = _v.y;
      if (_v.z < minZ) minZ = _v.z; if (_v.z > maxZ) maxZ = _v.z;
    }
  }
  const size = sun.shadow.mapSize.x;
  // Separate texel sizes per axis (non-square texels use the map fully for wide footprints); each is quantised and
  // the frustum is exactly `size` texels wide, so every texel edge stays on a fixed light-space grid while panning.
  const tx = quantizeTexel((maxX - minX) / (size - 8));
  const ty = quantizeTexel((maxY - minY) / (size - 8));
  const cam = sun.shadow.camera;
  cam.left = Math.floor(minX / tx) * tx - 2 * tx;
  cam.right = cam.left + size * tx;
  cam.bottom = Math.floor(minY / ty) * ty - 2 * ty;
  cam.top = cam.bottom + size * ty;
  // Reach towards the sun far enough for tall casters at low sun angles.
  const sinEl = Math.max(0.06, dirToSun.y);
  const reach = Math.min(2500, maxCasterHeight / sinEl) + 50;
  cam.near = Math.max(1, -maxZ - reach);
  cam.far = -minZ + 100;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  return Math.max(tx, ty);
}

/** Appendix A defaults: PCF radius 2.5, intensity 0.85 (stylised 15 % fill in shadow), throttled per light. */
export function configureSun(sun: THREE.DirectionalLight, mapSize: 1024 | 2048 | 4096): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 2.5;
  sun.shadow.intensity = 0.85;
  sun.shadow.autoUpdate = false;
}

/**
 * Update policy (art §3.10): the shadow map is re-fitted and re-rendered only when the camera moved, when the sun
 * turned by more than 0.15° (throttled to 4 Hz), or when a caster changed (`requestUpdate`). A still camera at a
 * fixed hour renders no shadow pass at all.
 */
export class SunShadow {
  /** Metres per shadow texel after the last fit (debug HUD). */
  texelSize = 0;
  /** Number of shadow re-renders requested (debug HUD / tests). */
  updates = 0;
  maxCasterHeight = 160;
  private clip: GroundRect | null = null;
  private pending = true;
  private readonly lastDir = new THREE.Vector3(0, 1, 0);
  private lastSunUpdate = -Infinity;

  constructor(readonly light: THREE.DirectionalLight, mapSize: 1024 | 2048 | 4096) {
    configureSun(light, mapSize);
  }

  /** Change the shadow map resolution (governor notch / tier switch). */
  setMapSize(size: 1024 | 2048 | 4096): void {
    if (this.light.shadow.mapSize.x === size) return;
    this.light.shadow.mapSize.set(size, size);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;                 // three re-allocates it on the next render
    this.pending = true;
  }

  /** Clip rectangle for the footprint (city bounds + margin), or null. */
  setClip(rect: GroundRect | null): void {
    this.clip = rect;
    this.pending = true;
  }

  /** A caster changed (chunk swap, building added, tree shadows toggled…). */
  requestUpdate(): void {
    this.pending = true;
  }

  /**
   * Decide whether to re-fit and re-render this frame. `dirToSun` is the light direction (unit, pointing up).
   * Returns true when the shadow map will be re-rendered.
   */
  update(nowSec: number, camera: THREE.PerspectiveCamera, cameraMoved: boolean, dirToSun: THREE.Vector3, anchor: THREE.Vector3): boolean {
    const turned = dirToSun.angleTo(this.lastDir) > THREE.MathUtils.degToRad(0.15);
    const sunDue = turned && nowSec - this.lastSunUpdate >= 0.25;
    if (!(cameraMoved || this.pending || sunDue)) return false;
    if (turned) this.lastSunUpdate = nowSec;
    this.lastDir.copy(dirToSun);
    this.texelSize = fitSunShadow(this.light, camera, dirToSun, anchor, this.maxCasterHeight, 6000, this.clip);
    this.pending = false;
    this.updates++;
    return true;
  }
}
