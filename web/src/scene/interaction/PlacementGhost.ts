// Placement ghost (art §5.13, UX §6.6): while uiStore.buildMode is set, a hologram of the building type follows the
// cursor snapped to plots, with per-plot validity cells, a border, a catchment ring for retail, and a cost tag.
// Validity comes from the bridge's previewBuild (≤ 1 query per 100 ms, cached by plot + rotation, cache dropped on
// every engine revision). Q/E rotate 90° (W ↔ H). The InteractionModule wires input, keys and confirmation.
import * as THREE from 'three';
import type { BuildingTypeDto, BuildPreviewDto, Rotation } from '@/bridge/protocol';
import { GeoBuilder, toBufferGeometry } from '../assets/GeoBuilder';
import type { AssetParams, LotFrame } from '../assets/AssetFactory';
import { factoryFor } from '../assets/registry';
import { fnv1a } from '../env/rng';
import { makeHologramMaterial, type HologramMaterial } from '../materials/HologramMaterial';
import { PLOT_SIZE } from '../units';
import { money } from '@/util/format';
import { rotatedSize } from './CityData';
import { circleRingGeometry, footprintRect, makeRingMaterial, rectRingGeometry, ringWidthFor, type RingMaterial } from './FootprintRing';
import type { GhostState, GhostStatus, PlotAnchor } from './interactionStore';
import { ghostColor } from './Labels';

/** Catchment radius drawn around retail ghosts, in plots (UX §6.6 "rivals within 6 plots"). */
export const CATCHMENT_PLOTS = 6;
/** Minimum spacing between previewBuild queries while the cursor moves. */
export const PREVIEW_INTERVAL_MS = 100;

// ------------------------------------------------------------------------------------------------ pure helpers

/**
 * Anchor (NW plot of the rotated footprint) for a continuous grid position: the plot under the cursor minus half the
 * footprint (art §5.13), clamped into the city. Constant across the cursor's plot, so it never flickers mid-plot.
 */
export function anchorFor(gx: number, gz: number, w: number, h: number, gridW: number, gridH: number): { px: number; pz: number } {
  const px = Math.floor(gx) - Math.floor(w / 2), pz = Math.floor(gz) - Math.floor(h / 2);
  return { px: Math.max(0, Math.min(gridW - w, px)), pz: Math.max(0, Math.min(gridH - h, pz)) };
}

export function nextRotation(r: Rotation, dir: 1 | -1): Rotation {
  return ((((r + dir * 90) % 360) + 360) % 360) as Rotation;
}

const ISSUE_TEXT: Record<string, string> = {
  outOfBounds: 'Outside the city limits',
  occupied: 'This land is taken',
  road: 'Can’t build over a road',
  zoning: 'Zoning doesn’t allow this here',
  water: 'Can’t build on water',
  needsRoad: 'Needs road frontage',
  needsCoast: 'Must face the sea',
  needsDeposit: 'Needs a resource deposit',
  notArable: 'Land isn’t arable',
  slope: 'Too steep',
};

const GEO_TEXT: Record<string, string> = {
  coastal: 'Needs a coastal city',
  arable: 'Needs arable land',
  mineralRich: 'Needs mineral deposits',
  oilRich: 'Needs oil deposits',
};

function humanIssue(code: string): string {
  if (ISSUE_TEXT[code]) return ISSUE_TEXT[code];
  const camel = code.replace(/^[A-Z_]+$/, (s) => s.toLowerCase().replace(/_(.)/g, (_, c: string) => c.toUpperCase()));
  return ISSUE_TEXT[camel] ?? camel.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Map a preview to the ghost's colour state (art §5.13 / UX §6.6). */
export function classifyPreview(p: BuildPreviewDto, ownAtAnchor: boolean): Pick<GhostState, 'status' | 'issue' | 'reason'> {
  if (!p.placementOk) {
    if (p.placementIssue === 'occupied' && ownAtAnchor) return { status: 'own', issue: 'own', reason: 'Your building is here' };
    const issue = p.placementIssue ?? 'zoning';
    return { status: 'blocked', issue, reason: humanIssue(issue) };
  }
  if (!p.geographyOk) {
    const g = p.geographyIssues[0];
    return { status: 'blocked', issue: 'geography', reason: (g && GEO_TEXT[g]) ?? 'Wrong geography for this building' };
  }
  if (!p.affordable || p.shortfall > 0) return { status: 'warning', issue: 'cash', reason: `Cash short ${money(Math.max(p.shortfall, -p.cashAfter))}` };
  if (p.runwayMonthsAfter !== undefined && p.runwayMonthsAfter !== null && p.runwayMonthsAfter < 3) {
    const m = Math.max(0, Math.floor(p.runwayMonthsAfter));
    return { status: 'warning', issue: 'runway', reason: `Only ${m} month${m === 1 ? '' : 's'} of cash left after` };
  }
  return { status: 'valid', issue: null, reason: null };
}

// ------------------------------------------------------------------------------------------------- the ghost

export type PreviewFn = (args: { typeId: string; cityId: string; at: PlotAnchor }) => Promise<BuildPreviewDto>;

interface GhostType {
  id: string;
  name: string;
  category: string;
  footprintWidth: number;
  footprintHeight: number;
  retail: boolean;
}

const _m = new THREE.Matrix4();

export class PlacementGhost {
  readonly group = new THREE.Group();
  private readonly holoMat: HologramMaterial;
  private holo: THREE.Mesh | null = null;
  private readonly holoCache = new Map<string, THREE.BufferGeometry>();
  private readonly cells: THREE.InstancedMesh;
  private readonly cellMat: THREE.MeshBasicMaterial;
  private readonly border: THREE.Mesh;
  private readonly borderMat: RingMaterial;
  /** The same border drawn without depth test at low opacity, so a footprint behind a tower stays readable. */
  private readonly borderXray: THREE.Mesh;
  private readonly borderXrayMat: RingMaterial;
  private readonly catchment: THREE.Mesh;
  private readonly catchMat: RingMaterial;
  private type: GhostType | null = null;
  private cityId = '';
  private gridW = 0;
  private gridH = 0;
  private rotation: Rotation = 0;
  private cursor: { gx: number; gz: number } | null = null;
  private anchor: PlotAnchor | null = null;
  private status: GhostStatus = 'pending';
  private issue: GhostState['issue'] = null;
  private reason: string | null = null;
  private preview: BuildPreviewDto | null = null;
  private locked = false;
  private readonly cache = new Map<string, BuildPreviewDto | Error>();
  private cacheRevision = -1;
  private inflight: string | null = null;
  private lastQuery = -Infinity;
  private flash = 0;
  private time = 0;
  private dirty = true;
  private height = 12;

  constructor(
    private readonly previewFn: PreviewFn,
    private readonly ownAt: (anchor: PlotAnchor, w: number, h: number) => boolean,
  ) {
    this.group.name = 'placement-ghost';
    this.group.visible = false;
    this.holoMat = makeHologramMaterial();
    this.cellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const cellGeo = new THREE.PlaneGeometry(PLOT_SIZE - 1.2, PLOT_SIZE - 1.2).rotateX(-Math.PI / 2);
    this.cells = new THREE.InstancedMesh(cellGeo, this.cellMat, 49);
    this.cells.frustumCulled = false;
    this.cells.renderOrder = 4;
    this.cells.count = 0;
    this.borderMat = makeRingMaterial('#61C28F', { width: 0.6, lift: 0.4 });
    this.border = new THREE.Mesh(new THREE.BufferGeometry(), this.borderMat);
    this.border.frustumCulled = false;
    this.border.renderOrder = 5;
    this.borderXrayMat = makeRingMaterial('#61C28F', { width: 0.6, lift: 0.4, opacity: 0.38 });
    this.borderXrayMat.depthTest = false;
    this.borderXray = new THREE.Mesh(this.border.geometry, this.borderXrayMat);
    this.borderXray.name = 'ghost-border-xray';
    this.borderXray.frustumCulled = false;
    this.borderXray.renderOrder = 7;
    this.catchMat = makeRingMaterial('#FFFFFF', { width: 1.2, opacity: 0.55, dash: 9, lift: 0.45 });
    this.catchment = new THREE.Mesh(circleRingGeometry(0, 0, CATCHMENT_PLOTS * PLOT_SIZE), this.catchMat);
    this.catchment.frustumCulled = false;
    this.catchment.renderOrder = 5;
    this.group.add(this.cells, this.border, this.borderXray, this.catchment);
  }

  get active(): boolean {
    return this.type !== null;
  }

  get typeId(): string | null {
    return this.type?.id ?? null;
  }

  /** Enter placement for a building type in a city of gridW × gridH plots. */
  start(type: GhostType | BuildingTypeDto, cityId: string, gridW: number, gridH: number): void {
    const t: GhostType = { id: type.id, name: type.name, category: type.category, footprintWidth: type.footprintWidth, footprintHeight: type.footprintHeight, retail: type.retail };
    const changed = this.type?.id !== t.id || this.cityId !== cityId;
    this.type = t;
    this.cityId = cityId;
    this.gridW = gridW;
    this.gridH = gridH;
    if (changed) {
      this.rotation = 0;
      this.anchor = null;
      this.locked = false;
      this.cache.clear();
      this.setHologram();
    }
    this.dirty = true;
  }

  stop(): void {
    this.type = null;
    this.anchor = null;
    this.cursor = null;
    this.locked = false;
    this.preview = null;
    this.group.visible = false;
    this.inflight = null;
  }

  /** Continuous grid position of the cursor on the ground (null = off the city). */
  setCursor(gx: number | null, gz: number | null): void {
    this.cursor = gx === null || gz === null ? null : { gx, gz };
    if (!this.locked) this.dirty = true;
  }

  rotate(dir: 1 | -1): void {
    if (!this.type || this.locked) return;
    this.rotation = nextRotation(this.rotation, dir);
    this.setHologram();
    this.dirty = true;
  }

  lock(on: boolean): void {
    this.locked = on;
    this.dirty = true;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Red flash after a click on a blocked spot. */
  reject(): void {
    this.flash = 1;
  }

  /** Engine revision changed: cached previews (cash, occupancy) are stale. */
  invalidate(revision: number): void {
    if (revision === this.cacheRevision) return;
    this.cacheRevision = revision;
    this.cache.clear();
    this.dirty = true;
  }

  state(): GhostState | null {
    if (!this.type) return null;
    const { w, h } = this.size();
    return {
      typeId: this.type.id, cityId: this.cityId, at: this.anchor, w, h, status: this.status, issue: this.issue,
      reason: this.reason, preview: this.preview, locked: this.locked,
    };
  }

  get typeName(): string {
    return this.type?.name ?? '';
  }

  /** World point above the ghost for its tag. */
  tagPoint(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.anchor || !this.group.visible) return null;
    const { w, h } = this.size();
    const r = footprintRect(this.anchor.px, this.anchor.pz, w, h, this.gridW, this.gridH);
    return out.set((r.x0 + r.x1) / 2, this.height + 6, (r.z0 + r.z1) / 2);
  }

  private size(): { w: number; h: number } {
    if (!this.type) return { w: 1, h: 1 };
    return rotatedSize(Math.max(1, this.type.footprintWidth), Math.max(1, this.type.footprintHeight), this.rotation);
  }

  /** Hologram geometry for the current type + rotation, built around the origin (lot centre). */
  private setHologram(): void {
    if (!this.type) return;
    const key = `${this.type.id}:${this.rotation}`;
    let geo = this.holoCache.get(key);
    if (!geo) {
      geo = buildHologramGeometry(this.type, this.rotation);
      this.holoCache.set(key, geo);
    }
    geo.computeBoundingBox();
    this.height = Math.max(6, geo.boundingBox?.max.y ?? 12);
    if (!this.holo) {
      this.holo = new THREE.Mesh(geo, this.holoMat);
      this.holo.name = 'ghost-hologram';
      this.holo.renderOrder = 6;
      this.holo.frustumCulled = false;
      this.group.add(this.holo);
    } else this.holo.geometry = geo;
  }

  /**
   * Per frame: move to the cursor anchor, query the preview when due, animate. Returns true when the published state
   * changed (anchor, status, preview or lock).
   */
  update(dt: number, nowMs: number, cameraDistance: number, reducedMotion: boolean): boolean {
    this.time += dt;
    this.holoMat.uniforms.uTime.value = reducedMotion ? 0 : this.time * 0.6;
    this.catchMat.uniforms.uTime.value = reducedMotion ? 0 : this.time * 0.5;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.35);
      this.holoMat.uniforms.uFlash.value = 0.35 * this.flash;
    }
    this.borderMat.uniforms.uWidth.value = ringWidthFor(cameraDistance, 0.6, 2.2);
    this.borderXrayMat.uniforms.uWidth.value = this.borderMat.uniforms.uWidth.value;
    this.catchMat.uniforms.uWidth.value = ringWidthFor(cameraDistance, 1.2, 1.6);
    if (!this.type) return false;
    let changed = false;
    const { w, h } = this.size();
    if (!this.locked) {
      const next = this.cursor ? { ...anchorFor(this.cursor.gx, this.cursor.gz, w, h, this.gridW, this.gridH), rotation: this.rotation } : null;
      if (!sameAnchor(next, this.anchor)) {
        this.anchor = next;
        changed = true;
        this.dirty = true;
      }
    }
    if (this.dirty) {
      this.dirty = false;
      changed = this.resolveFromCache() || changed;
      this.layout();
    }
    if (this.anchor && this.status === 'pending' && !this.inflight && nowMs - this.lastQuery >= PREVIEW_INTERVAL_MS) this.query(nowMs);
    return changed;
  }

  private key(a: PlotAnchor): string {
    return `${a.px},${a.pz},${a.rotation}`;
  }

  /** Take status from the cache for the current anchor (or go pending). */
  private resolveFromCache(): boolean {
    const before = `${this.status}|${this.reason}|${this.preview === null}`;
    const a = this.anchor;
    if (!a || !this.type) {
      this.status = 'pending';
      this.issue = null;
      this.reason = null;
      this.preview = null;
    } else {
      const hit = this.cache.get(this.key(a));
      if (hit instanceof Error) {
        this.status = 'warning';
        this.issue = 'unavailable';
        this.reason = 'Couldn’t check this site';
        this.preview = null;
      } else if (hit) {
        const { w, h } = this.size();
        Object.assign(this, classifyPreview(hit, this.ownAt(a, w, h)));
        this.preview = hit;
      } else {
        this.status = 'pending';
        this.issue = null;
        this.reason = null;
      }
    }
    return before !== `${this.status}|${this.reason}|${this.preview === null}`;
  }

  private query(nowMs: number): void {
    const a = this.anchor, t = this.type;
    if (!a || !t) return;
    const key = this.key(a);
    this.inflight = key;
    this.lastQuery = nowMs;
    const revision = this.cacheRevision;
    void this.previewFn({ typeId: t.id, cityId: this.cityId, at: a })
      .then((dto) => dto as BuildPreviewDto | Error)
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
      .then((result) => {
        if (this.inflight === key) this.inflight = null;
        if (revision !== this.cacheRevision || this.type?.id !== t.id) return;
        this.cache.set(key, result);
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value as string);
        this.dirty = true;
      });
  }

  /** Place the hologram, cells, border and catchment on the anchor and colour them by status. */
  private layout(): void {
    const a = this.anchor;
    if (!a || !this.type || !this.holo) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const { w, h } = this.size();
    const r = footprintRect(a.px, a.pz, w, h, this.gridW, this.gridH);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    this.holo.position.set(cx, 0.05, cz);
    const color = ghostColor(this.status);
    this.holoMat.uniforms.uTint.value.set(color);
    this.holoMat.uniforms.uTintMix.value = this.status === 'valid' ? 0.25 : 0.5;
    this.holoMat.uniforms.uOpacity.value = this.status === 'blocked' ? 0.42 : 0.55;
    this.cellMat.color.set(color);
    let i = 0;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w && i < this.cells.instanceMatrix.count; x++, i++) {
        const c = footprintRect(a.px + x, a.pz + z, 1, 1, this.gridW, this.gridH);
        this.cells.setMatrixAt(i, _m.makeTranslation((c.x0 + c.x1) / 2, 0.32, (c.z0 + c.z1) / 2));
      }
    }
    this.cells.count = i;
    this.cells.instanceMatrix.needsUpdate = true;
    this.border.geometry.dispose();
    this.border.geometry = rectRingGeometry([r], 0.3);
    this.borderXray.geometry = this.border.geometry;
    this.borderMat.uniforms.uColor.value.set(color);
    this.borderXrayMat.uniforms.uColor.value.set(color);
    this.catchment.visible = this.type.retail;
    this.catchment.position.set(cx, 0, cz);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.holoCache.values()) g.dispose();
    this.holoCache.clear();
    this.holoMat.dispose();
    this.cells.geometry.dispose();
    this.cells.dispose();
    this.cellMat.dispose();
    this.border.geometry.dispose();
    this.borderMat.dispose();
    this.borderXrayMat.dispose();
    this.catchment.geometry.dispose();
    this.catchMat.dispose();
  }
}

function sameAnchor(a: PlotAnchor | null, b: PlotAnchor | null): boolean {
  return a === b || (!!a && !!b && a.px === b.px && a.pz === b.pz && a.rotation === b.rotation);
}

/** Factory LOD0 geometry of the type at the origin (falls back to a simple massing box). */
export function buildHologramGeometry(type: GhostType, rotation: Rotation): THREE.BufferGeometry {
  const turns = (rotation / 90) as 0 | 1 | 2 | 3;
  const fw = Math.max(1, type.footprintWidth), fh = Math.max(1, type.footprintHeight);
  const widthM = fw * PLOT_SIZE, depthM = fh * PLOT_SIZE;
  const factory = factoryFor(type.id);
  if (factory) {
    try {
      const b = new GeoBuilder();
      b.owner = 0;
      b.place(0, 0, turns);
      const lot: LotFrame = { cx: 0, cz: 0, widthM, depthM, facing: (['S', 'E', 'N', 'W'] as const)[turns], quarterTurns: turns };
      const seed = fnv1a(`ghost:${type.id}`);
      const params: AssetParams = { seed, variant: 0, level: 1, stage: 'complete', progress: 1, owner: 0, utilization: 0, lod: 0, season: 1 };
      factory.build(b, lot, params);
      return toBufferGeometry(b.finish());
    } catch (error) {
      console.warn(`[ghost] factory ${type.id} failed; using a massing box`, error);
    }
  }
  const b = new GeoBuilder();
  b.place(0, 0, turns);
  const height = type.retail ? 8 : type.category === 'factory' ? 14 : 10;
  const hw = widthM / 2 - 3, hd = depthM / 2 - 3;
  b.box(-hw, 0, -hd, hw, height, hd, [215, 225, 235], [235, 240, 245]);
  return toBufferGeometry(b.finish());
}
