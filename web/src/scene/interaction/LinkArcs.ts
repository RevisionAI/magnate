// Supply-link arcs (art §5.14): one quadratic Bézier per flow from the source roof to the destination roof, apex
// 0.25 × distance above the higher roof, width ∝ log10(1 + quantity), dashed and flowing towards the destination.
// Internal transfers take the owner colour; imports and exports run to the nearest city edge in neutral white.
// Rendered with three's LineSegments2/LineMaterial (screen-space width), one draw call per width class.
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { FlowDto } from '@/bridge/protocol';
import { ownerColor } from '@/theme/tokens';

/** Imports and exports (art §5.14: neutral white). */
export const NEUTRAL_ARC = '#F4F1E6';

export interface ArcEndpoint {
  x: number;
  y: number;
  z: number;
}

export interface ArcSpec {
  from: ArcEndpoint;
  to: ArcEndpoint;
  color: string;
  /** Monthly quantity (drives the width class). */
  quantity: number;
}

/** Width classes in CSS pixels. */
export const ARC_WIDTHS = [2.5, 3.5, 5, 7] as const;
const SEGMENTS = 28;

/** Width class for a monthly quantity: log10 steps from 1k units. */
export function widthClass(quantity: number): number {
  const l = Math.log10(1 + Math.max(0, quantity) / 1000);
  return Math.max(0, Math.min(ARC_WIDTHS.length - 1, Math.floor(l)));
}

/** Points of the arc: quadratic Bézier with the apex 0.25 × horizontal distance above the higher end. */
export function arcPoints(a: ArcEndpoint, b: ArcEndpoint, segments = SEGMENTS): THREE.Vector3[] {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const apex = Math.max(a.y, b.y) + Math.max(12, 0.25 * d);
  const c = new THREE.Vector3((a.x + b.x) / 2, 2 * apex - (a.y + b.y) / 2, (a.z + b.z) / 2);   // control point so the curve peaks at `apex`
  const p0 = new THREE.Vector3(a.x, a.y, a.z), p2 = new THREE.Vector3(b.x, b.y, b.z);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, u = 1 - t;
    out.push(new THREE.Vector3(
      u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
      u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
      u * u * p0.z + 2 * u * t * c.z + t * t * p2.z,
    ));
  }
  return out;
}

export interface ArcBuildingInfo {
  /** Roof centre (world). */
  roof: ArcEndpoint;
  colorIndex: number;
}

/**
 * Flows → arcs for one city. Same-city transfers become owner-coloured arcs (duplicates merged across products);
 * imports, exports and cross-city transfers run to the nearest city edge in white. Retail flows have no arc.
 * `only` keeps the flows touching one building.
 */
export function arcsForFlows(
  flows: readonly FlowDto[],
  cityId: string,
  building: (id: number) => ArcBuildingInfo | null,
  halfW: number,
  halfH: number,
  only: number | null = null,
  limit = 200,
  /** Keep only flows with at least one end where this returns true (the Links overlay: your buildings). */
  keep: ((buildingId: number) => boolean) | null = null,
): ArcSpec[] {
  const merged = new Map<string, ArcSpec>();
  const edge = (p: ArcEndpoint): ArcEndpoint => {
    const dx = halfW - Math.abs(p.x), dz = halfH - Math.abs(p.z);
    return dx < dz ? { x: Math.sign(p.x || 1) * halfW, y: 0, z: p.z } : { x: p.x, y: 0, z: Math.sign(p.z || 1) * halfH };
  };
  for (const f of flows) {
    if (f.kind === 'retail') continue;
    if (only !== null && f.fromBuildingId !== only && f.toBuildingId !== only) continue;
    if (keep && !((f.fromBuildingId !== undefined && keep(f.fromBuildingId)) || (f.toBuildingId !== undefined && keep(f.toBuildingId)))) continue;
    const from = f.fromBuildingId !== undefined && (f.fromCityId ?? cityId) === cityId ? building(f.fromBuildingId) : null;
    const to = f.toBuildingId !== undefined && (f.toCityId ?? cityId) === cityId ? building(f.toBuildingId) : null;
    const qty = f.quantity ?? (f.amount ?? 0) / 2;
    let spec: ArcSpec | null = null;
    let key = '';
    if (from && to && f.kind === 'transfer') {
      key = `t:${f.fromBuildingId}>${f.toBuildingId}`;
      spec = { from: from.roof, to: to.roof, color: ownerColor(from.colorIndex), quantity: qty };
    } else if (to && !from) {
      key = `i:${f.toBuildingId}`;
      spec = { from: edge(to.roof), to: to.roof, color: NEUTRAL_ARC, quantity: qty };
    } else if (from && !to) {
      key = `e:${f.fromBuildingId}`;
      spec = { from: from.roof, to: edge(from.roof), color: NEUTRAL_ARC, quantity: qty };
    }
    if (!spec) continue;
    const prev = merged.get(key);
    if (prev) prev.quantity += spec.quantity;
    else merged.set(key, spec);
  }
  return [...merged.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

/** The arcs' three.js objects. */
export class LinkArcs {
  readonly group = new THREE.Group();
  private readonly lines: { mesh: LineSegments2; mat: LineMaterial; under: LineSegments2; underMat: LineMaterial }[] = [];
  private signature = '';

  constructor() {
    this.group.name = 'link-arcs';
    for (const width of ARC_WIDTHS) {
      const mat = new LineMaterial({ linewidth: width, vertexColors: true, dashed: true, dashSize: 16, gapSize: 9, transparent: true, opacity: 1, depthWrite: false, worldUnits: false });
      const mesh = new LineSegments2(new LineSegmentsGeometry(), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.visible = false;
      // Dark, solid underlay 2.5 px wider: keeps the dashes readable over bright roofs and clay overlays.
      const underMat = new LineMaterial({ linewidth: width + 2.5, color: 0x0b1117, transparent: true, opacity: 0.45, depthWrite: false, worldUnits: false });
      const under = new LineSegments2(mesh.geometry, underMat);
      under.frustumCulled = false;
      under.renderOrder = 7;
      under.visible = false;
      this.lines.push({ mesh, mat, under, underMat });
      this.group.add(under, mesh);
    }
  }

  set(arcs: readonly ArcSpec[]): void {
    const signature = arcs.map((a) => `${a.from.x.toFixed(1)},${a.from.z.toFixed(1)}>${a.to.x.toFixed(1)},${a.to.z.toFixed(1)}:${a.color}:${widthClass(a.quantity)}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    const color = new THREE.Color();
    ARC_WIDTHS.forEach((_, cls) => {
      const subset = arcs.filter((a) => widthClass(a.quantity) === cls);
      const { mesh, under } = this.lines[cls];
      mesh.geometry.dispose();
      if (subset.length === 0) {
        mesh.geometry = new LineSegmentsGeometry();
        under.geometry = mesh.geometry;
        mesh.visible = under.visible = false;
        return;
      }
      const pos: number[] = [], col: number[] = [];
      for (const a of subset) {
        const pts = arcPoints(a.from, a.to);
        color.set(a.color);
        for (let i = 0; i < pts.length - 1; i++) {
          pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          col.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(pos);
      geo.setColors(col);
      mesh.geometry = geo;
      under.geometry = geo;
      mesh.computeLineDistances();
      mesh.visible = under.visible = true;
    });
  }

  get count(): number {
    return this.signature === '' ? 0 : this.signature.split('|').length;
  }

  update(dt: number, width: number, height: number, reducedMotion: boolean): void {
    for (const { mat, underMat } of this.lines) {
      mat.resolution.set(width, height);
      underMat.resolution.set(width, height);
      if (!reducedMotion) mat.dashOffset -= dt * 20;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { mesh, mat, underMat } of this.lines) {
      mesh.geometry.dispose();
      mat.dispose();
      underMat.dispose();
    }
  }
}
