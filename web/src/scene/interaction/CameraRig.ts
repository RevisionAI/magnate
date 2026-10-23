// RTS camera on camera-controls 3.1.2 (art §2.4, §5.11; UX §6.5, §6.20). Production version of Appendix A.8.
//
// Bindings: left-drag = pan on the ground (SCREEN_PAN; a click without dragging still picks / places) · Option+left-drag,
// right-drag or middle-drag = orbit (horizontal drag turns 360°, vertical drag tilts) · wheel = dolly to the cursor · trackpad pinch = dolly (not FOV zoom) · Q/E = rotate in 45° steps
// (disabled while build mode uses Q/E for the footprint) · WASD/arrows = pan, Shift = faster · +/− = zoom ·
// right-click without dragging = `contextclick` event (context menu). Optional edge scrolling (UX setting, off).
// The HUD navigation cluster drives the same pan through `setNudge` (held buttons) and orbits a full 360° through
// `setNudge` / `orbitBy` (compass drag) / `faceNorth`.
//
// Tilt 12–87° elevation (polar 3–78°). Auto-tilt follows zoom within 35–60° elevation (low angle at street level,
// steeper at city zoom) until the user tilts by hand (drag or the HUD tilt slider); focusing a building or applying a view preset re-enables it. FOV 35°, dynamic near
// plane clamp(0.2·d, 1, 200). The target is bounded to the city ± 10 %.
import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2, Vector3: THREE.Vector3, Vector4: THREE.Vector4, Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4, Spherical: THREE.Spherical, Box3: THREE.Box3, Sphere: THREE.Sphere, Raycaster: THREE.Raycaster,
  },
});

const D2R = THREE.MathUtils.degToRad;
const R2D = THREE.MathUtils.radToDeg;
/** Manual tilt limits: 87° elevation (almost top-down) … 12° elevation (towards the horizon). */
export const POLAR_MIN = D2R(3);
export const POLAR_MAX = D2R(78);
/** Polar angle auto-tilt reaches at the street band (35° elevation). */
const POLAR_STREET = D2R(55);
/** Polar angle auto-tilt reaches at the city band (60° elevation). */
const POLAR_CITY = D2R(30);
export const CAMERA_FOV = 35;
export const MIN_DISTANCE = 60;
/** Held HUD rotate buttons orbit at this rate (one full turn in 4 s). */
const ORBIT_RATE = D2R(90);

export type ZoomBand = 'street' | 'district' | 'city';

/** Camera pose for presets. `azimuthDeg` is camera-controls' azimuth: 0 = camera south of the target looking north,
 *  90 = camera east of the target looking west. `polarDeg` omitted = auto-tilt for the distance. */
export interface ViewPreset {
  target: { x: number; z: number };
  distance: number;
  azimuthDeg: number;
  polarDeg?: number;
}

export interface CameraRigOptions {
  /** Where keyboard events are read (default: window). */
  keyTarget?: Window | HTMLElement;
  /** Prefers-reduced-motion: programmatic camera moves (focus, presets) become instant. */
  reducedMotion?: boolean;
}

export interface CameraRigEvents {
  /** Right button pressed and released without dragging (≤ 5 px, ≤ 600 ms): open a context menu. */
  contextclick: { clientX: number; clientY: number };
  /** The user started dragging / wheeling the camera (hover cards may hide). */
  userinput: object;
}

const _v = new THREE.Vector3(), _box = new THREE.Box3(), _sph = new THREE.Spherical();

export class CameraRig extends THREE.EventDispatcher<CameraRigEvents> {
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 5, 12000);
  readonly controls: CameraControls;
  /** Tilt follows zoom until the user tilts by hand. */
  autoTilt = true;
  /** WASD/arrows/+−/Q/E handled at all. */
  keyboardEnabled = true;
  /** Q/E rotate the camera; build mode turns this off so Q/E rotate the placement footprint. */
  rotateKeysEnabled = true;
  /** Pan when the pointer rests within 10 px of the canvas edge (UX setting, default off). */
  edgeScroll = false;
  reducedMotion: boolean;
  /** Camera-to-target distance before which `zoom01()` is 0 / after which it is 1 (log scale between). */
  static readonly ZOOM_NEAR = 300;
  static readonly ZOOM_FAR = 1800;

  private readonly canvas: HTMLCanvasElement;
  private readonly keyTarget: Window | HTMLElement;
  private readonly keys = new Set<string>();
  private readonly keyVel = new THREE.Vector2();
  /** Held HUD navigation: pan (x = right, y = forward) and orbit (+1 = the Q direction), each −1…1. */
  private readonly nudgePan = new THREE.Vector2();
  private nudgeOrbit = 0;
  private readonly pointer = { x: -1, y: -1, inside: false };
  private rightDown: { x: number; y: number; t: number } | null = null;
  private dragStartPolar = 0;
  private wheelSensitivity = 1;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, cityWidthM = 1920, cityDepthM = 1920, options: CameraRigOptions = {}) {
    super();
    this.canvas = canvas;
    this.keyTarget = options.keyTarget ?? window;
    this.reducedMotion = options.reducedMotion ?? false;
    const c = new CameraControls(this.camera, canvas);
    c.minDistance = MIN_DISTANCE;
    c.minPolarAngle = POLAR_MIN;
    c.maxPolarAngle = POLAR_MAX;
    c.dollyToCursor = true;
    c.smoothTime = 0.25;
    c.draggingSmoothTime = 0.08;
    c.dollySpeed = 0.6;
    // camera-controls trucks d·tan(fov/2)/height metres per pixel: half the ground span under the cursor. ×2 makes a
    // right-drag "grab the ground" at the target (UX §6.5), so the ground follows the pointer.
    c.truckSpeed = 2.0;
    c.minZoom = 1;                      // ctrl+wheel would otherwise change the FOV; pinch is re-routed to dolly below
    c.maxZoom = 1;
    c.mouseButtons.left = CameraControls.ACTION.SCREEN_PAN;
    c.mouseButtons.right = CameraControls.ACTION.ROTATE;
    c.mouseButtons.middle = CameraControls.ACTION.ROTATE;
    c.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    c.touches.one = CameraControls.ACTION.TOUCH_SCREEN_PAN;
    c.touches.two = CameraControls.ACTION.TOUCH_DOLLY_ROTATE;
    c.boundaryFriction = 0.15;
    this.controls = c;
    this.setCityBounds(cityWidthM, cityDepthM);

    this.listen(c, 'controlstart', () => {
      this.dragStartPolar = c.getSpherical(_sph, true).phi;
      this.dispatchEvent({ type: 'userinput' });
    });
    this.listen(c, 'controlend', () => { canvas.style.cursor = ''; });
    this.listen(c, 'control', () => {
      // A vertical middle-drag changes the polar angle: the user took over the tilt.
      // Compare the drag's end state: auto-tilt is suspended while rotating, so the current angle may still be easing.
      if ((c.currentAction & CameraControls.ACTION.ROTATE) !== 0 && Math.abs(c.getSpherical(_sph, true).phi - this.dragStartPolar) > D2R(1.5)) this.autoTilt = false;
      const A = CameraControls.ACTION;
      if ((c.currentAction & A.ROTATE) !== 0) canvas.style.cursor = 'move';
      else if ((c.currentAction & A.SCREEN_PAN) !== 0) canvas.style.cursor = 'grabbing';
    });

    const onKeyDown = (e: Event) => this.onKey(e as KeyboardEvent, true);
    const onKeyUp = (e: Event) => this.onKey(e as KeyboardEvent, false);
    const onBlur = () => { this.keys.clear(); };
    this.keyTarget.addEventListener('keydown', onKeyDown);
    this.keyTarget.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => {
      this.keyTarget.removeEventListener('keydown', onKeyDown);
      this.keyTarget.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    // Trackpad pinch arrives as ctrl+wheel, which camera-controls maps to FOV zoom: re-route it to a dolly.
    const onWheelCapture = (e: WheelEvent) => {
      this.dispatchEvent({ type: 'userinput' });
      if (!e.ctrlKey || !c.enabled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const factor = Math.exp(THREE.MathUtils.clamp(e.deltaY, -50, 50) * 0.012 * this.wheelSensitivity);
      void c.dollyTo(THREE.MathUtils.clamp(c.distance * factor, c.minDistance, c.maxDistance), true);
    };
    canvas.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    this.cleanups.push(() => canvas.removeEventListener('wheel', onWheelCapture, { capture: true }));

    // Option+left-drag orbits instead of panning (trackpads have no middle button). Capture phase, so the binding is set
    // before camera-controls reads it for this press.
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.button === 0) c.mouseButtons.left = e.altKey ? CameraControls.ACTION.ROTATE : CameraControls.ACTION.SCREEN_PAN;
    };
    canvas.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
    this.cleanups.push(() => canvas.removeEventListener('pointerdown', onPointerDownCapture, { capture: true }));
    const onPointerDown = (e: PointerEvent) => { if (e.button === 2) this.rightDown = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onPointerUp = (e: PointerEvent) => {
      const down = this.rightDown;
      if (e.button !== 2 || !down) return;
      this.rightDown = null;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5 && performance.now() - down.t <= 600) {
        this.dispatchEvent({ type: 'contextclick', clientX: e.clientX, clientY: e.clientY });
      }
    };
    const onPointerMove = (e: PointerEvent) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; };
    const onPointerLeave = () => { this.pointer.inside = false; };
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerleave', onPointerLeave);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
    });
  }

  private listen(c: CameraControls, type: 'controlstart' | 'control' | 'controlend', fn: () => void): void {
    c.addEventListener(type, fn);
    this.cleanups.push(() => c.removeEventListener(type, fn));
  }

  /** Pan bounds = city ± 10 % (the target stays inside); max distance scales with the city diagonal. */
  setCityBounds(widthM: number, depthM: number): void {
    const c = this.controls;
    c.maxDistance = Math.max(1400, 1.15 * Math.hypot(widthM, depthM));   // Metropolis @24 m plots: ~3,120 m
    const mx = 0.1 * widthM, mz = 0.1 * depthM;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-widthM / 2 - mx, 0, -depthM / 2 - mz), new THREE.Vector3(widthM / 2 + mx, 0, depthM / 2 + mz)));
  }

  get enabled(): boolean {
    return this.controls.enabled;
  }

  set enabled(on: boolean) {
    this.controls.enabled = on;
    if (!on) {
      this.keys.clear();
      this.setNudge(0, 0, 0);
    }
  }

  /** HUD navigation buttons held down: pan (x = right, y = forward) and orbit (+1 = the Q direction), each −1…1.
   *  Pans with the same speed and easing as WASD; all zeros stops. */
  setNudge(panX: number, panY: number, orbit: number): void {
    const k = (v: number) => THREE.MathUtils.clamp(v, -1, 1);
    this.nudgePan.set(k(panX), k(panY));
    this.nudgeOrbit = k(orbit);
    if (panX !== 0 || panY !== 0 || orbit !== 0) this.dispatchEvent({ type: 'userinput' });
  }

  /** Orbit around the target by `rad` immediately (compass drag); there is no azimuth limit, so it wraps 360°. */
  orbitBy(rad: number): void {
    if (!this.controls.enabled || rad === 0) return;
    void this.controls.rotate(rad, 0, false);
    this.dispatchEvent({ type: 'userinput' });
  }

  /** Turn the shortest way back to a north-up view (azimuth a multiple of 360°). */
  faceNorth(): Promise<void> {
    const c = this.controls;
    const turn = Math.PI * 2;
    return c.rotateAzimuthTo(Math.round(c.getSpherical(_sph, true).theta / turn) * turn, !this.reducedMotion);
  }

  /** Camera elevation above the ground plane in degrees (12 = towards the horizon … 87 = almost top-down). */
  get elevationDeg(): number {
    return 90 - R2D(this.controls.polarAngle);
  }

  /** Elevation limits in degrees, [min, max]. */
  get elevationRangeDeg(): [number, number] {
    return [90 - R2D(this.controls.maxPolarAngle), 90 - R2D(this.controls.minPolarAngle)];
  }

  /** Tilt to an elevation (degrees, clamped); a manual tilt, so auto-tilt stops following zoom. */
  setElevation(deg: number, animate = false): Promise<void> {
    const c = this.controls;
    this.autoTilt = false;
    this.dispatchEvent({ type: 'userinput' });
    return c.rotatePolarTo(THREE.MathUtils.clamp(D2R(90 - deg), c.minPolarAngle, c.maxPolarAngle), animate && !this.reducedMotion);
  }

  /** Compass bearing the camera looks along, clockwise from north (−z), 0…360. */
  get headingDeg(): number {
    return THREE.MathUtils.euclideanModulo(-R2D(this.controls.azimuthAngle), 360);
  }

  /** UX "zoom sensitivity" (0.25–4, default 1). */
  setZoomSensitivity(k: number): void {
    this.wheelSensitivity = THREE.MathUtils.clamp(k, 0.25, 4);
    this.controls.dollySpeed = 0.6 * this.wheelSensitivity;
  }

  /** UX "invert rotate". */
  setInvertRotate(on: boolean): void {
    this.controls.azimuthRotateSpeed = on ? -1 : 1;
    this.controls.polarRotateSpeed = on ? -1 : 1;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.key === 'Shift') { if (down) this.keys.add('Shift'); else this.keys.delete('Shift'); return; }
    if (!down) { this.keys.delete(e.code); return; }
    if (!this.keyboardEnabled || !this.controls.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
    switch (e.code) {
      case 'KeyQ':
      case 'KeyE':
        if (this.rotateKeysEnabled && !e.repeat) void this.rotateBy45(e.code === 'KeyQ' ? 1 : -1);
        return;
      case 'Equal': case 'NumpadAdd':
        void this.dollyBy(0.8);
        return;
      case 'Minus': case 'NumpadSubtract':
        void this.dollyBy(1.25);
        return;
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD':
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        if (e.code.startsWith('Arrow') && (t === document.body || t === this.canvas)) e.preventDefault();
        this.keys.add(e.code);
        return;
      default:
        return;
    }
  }

  /**
   * Call every frame. Returns true when the camera moved (re-fit shadows, LOD, labels, audio frame).
   */
  update(dt: number): boolean {
    const c = this.controls;
    const d = c.distance;
    // Keyboard / edge panning with a short acceleration so taps nudge and holds glide.
    const k = this.keys;
    let fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let fz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.edgeScroll && this.pointer.inside && c.enabled && document.hasFocus()) {
      const r = this.canvas.getBoundingClientRect(), m = 10;
      if (this.pointer.x - r.left < m) fx -= 1; else if (r.right - this.pointer.x < m) fx += 1;
      if (this.pointer.y - r.top < m) fz += 1; else if (r.bottom - this.pointer.y < m) fz -= 1;
    }
    if (c.enabled) {
      fx += this.nudgePan.x;
      fz += this.nudgePan.y;
      if (this.nudgeOrbit !== 0) void c.rotate(this.nudgeOrbit * ORBIT_RATE * dt, 0, false);
    }
    const speed = 0.9 * d * (k.has('Shift') ? 2 : 1);
    const len = Math.hypot(fx, fz) || 1;
    const a = 1 - Math.exp(-dt / 0.09);
    this.keyVel.x += ((fx / len) * speed - this.keyVel.x) * a;
    this.keyVel.y += ((fz / len) * speed - this.keyVel.y) * a;
    if (Math.abs(this.keyVel.x) > 0.01 * d || Math.abs(this.keyVel.y) > 0.01 * d) {
      void c.truck(this.keyVel.x * dt, 0, false);
      void c.forward(this.keyVel.y * dt, false);
    } else this.keyVel.set(0, 0);

    if (this.autoTilt && (c.currentAction & CameraControls.ACTION.ROTATE) === 0) {
      const polar = this.autoPolar(d);
      if (Math.abs(polar - c.getSpherical(_sph, true).phi) > 1e-4) void c.rotatePolarTo(polar, true);
    }
    const moved = c.update(dt);
    if (moved) {
      this.camera.near = THREE.MathUtils.clamp(c.distance * 0.2, 1, 200);
      this.camera.far = c.distance * 5 + 6000;      // beyond the fog far distance (3.2·d + 4500)
      this.camera.updateProjectionMatrix();
      // camera-controls sets position/quaternion but leaves matrixWorld to the renderer; shadow fitting, picking and
      // LOD run before rendering and need this frame's matrices.
      this.camera.updateMatrixWorld();
    }
    return moved;
  }

  /** Auto-tilt: 35° elevation at street level → 60° at city zoom, smooth on a log-distance scale. */
  autoPolar(distance: number): number {
    const t = THREE.MathUtils.smoothstep(Math.log(Math.max(distance, 1)), Math.log(150), Math.log(2600));
    return THREE.MathUtils.lerp(POLAR_STREET, POLAR_CITY, t);
  }

  /**
   * Smoothly frame a building box (UX: double-click, 0.6 s ease) keeping the current azimuth. The target goes to the
   * box's ground centre; the distance fits a sphere around that centre that contains the whole box.
   */
  focus(box: THREE.Box3, padding = 1.15): Promise<void> {
    this.autoTilt = true;
    const center = box.getCenter(_v);
    const size = _box.copy(box).getSize(new THREE.Vector3());
    const radius = Math.hypot(size.x / 2, Math.max(size.y, 1), size.z / 2) * padding;
    const c = this.controls;
    const distance = THREE.MathUtils.clamp(c.getDistanceToFitSphere(radius), c.minDistance, c.maxDistance);
    const animate = !this.reducedMotion;
    return Promise.all([
      c.moveTo(center.x, 0, center.z, animate),
      c.dollyTo(distance, animate),
      c.rotatePolarTo(this.autoPolar(distance), animate),
    ]).then(() => undefined);
  }

  /** Move the target to a ground point, optionally changing the distance (keeps the angle). */
  focusOn(point: THREE.Vector3, distance?: number, animate = !this.reducedMotion): Promise<void> {
    const c = this.controls;
    const moves: Promise<void>[] = [c.moveTo(point.x, 0, point.z, animate)];
    if (distance !== undefined) moves.push(c.dollyTo(THREE.MathUtils.clamp(distance, c.minDistance, c.maxDistance), animate));
    return Promise.all(moves).then(() => undefined);
  }

  /** Apply a full pose (presets, Home, dev tools). Re-enables auto-tilt when `polarDeg` is omitted. */
  setView(view: ViewPreset, animate = !this.reducedMotion): Promise<void> {
    const c = this.controls;
    const distance = THREE.MathUtils.clamp(view.distance, c.minDistance, c.maxDistance);
    this.autoTilt = view.polarDeg === undefined;
    const polar = view.polarDeg === undefined ? this.autoPolar(distance) : THREE.MathUtils.clamp(D2R(view.polarDeg), c.minPolarAngle, c.maxPolarAngle);
    return Promise.all([
      c.moveTo(view.target.x, 0, view.target.z, animate),
      c.dollyTo(distance, animate),
      c.rotateTo(D2R(view.azimuthDeg), polar, animate),
    ]).then(() => undefined);
  }

  /** Q/E: rotate to the next multiple of 45° (smooth). */
  rotateBy45(dir: 1 | -1): Promise<void> {
    const c = this.controls;
    const step = Math.PI / 4;
    const end = c.getSpherical(_sph, true).theta;
    const next = (Math.round(end / step) + dir) * step;
    return c.rotateAzimuthTo(next, !this.reducedMotion);
  }

  /** Multiply the distance (keyboard zoom). */
  dollyBy(factor: number): Promise<void> {
    const c = this.controls;
    const end = c.getSpherical(_sph, true).radius;
    return c.dollyTo(THREE.MathUtils.clamp(end * factor, c.minDistance, c.maxDistance), true);
  }

  /** Current camera-to-target distance (m). */
  get distance(): number {
    return this.controls.distance;
  }

  /** Current orbit target (on the ground). */
  getTarget(out: THREE.Vector3): THREE.Vector3 {
    return this.controls.getTarget(out);
  }

  get azimuthDeg(): number {
    return R2D(this.controls.azimuthAngle);
  }

  get polarDeg(): number {
    return R2D(this.controls.polarAngle);
  }

  /** True while the user drags the camera (pickers may suppress hover). */
  get dragging(): boolean {
    return this.controls.currentAction !== CameraControls.ACTION.NONE;
  }

  /** 0 = street band (≤ 300 m) … 1 = city band (≥ 1,800 m), log scale; drives LOD, labels and the audio frame. */
  zoom01(): number {
    const d = this.controls.distance;
    return THREE.MathUtils.clamp((Math.log(d) - Math.log(CameraRig.ZOOM_NEAR)) / (Math.log(CameraRig.ZOOM_FAR) - Math.log(CameraRig.ZOOM_NEAR)), 0, 1);
  }

  /** Zoom band of art §3.15 (street < 300 m ≤ district < 1,100 m ≤ city). */
  zoomBand(): ZoomBand {
    const d = this.controls.distance;
    return d < 300 ? 'street' : d < 1100 ? 'district' : 'city';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.cleanups.splice(0)) fn();
    this.keys.clear();
    this.controls.dispose();
  }
}
