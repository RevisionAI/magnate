// Office tower massing shared by `ambient:office` and the company `headquarters` (art §4.3 "Office tower",
// §4.4 HQ): a podium, a shaft on 55–72% of it with 0–2 setbacks (at 60% / 85% of the height), box, chamfered or
// round plan, CURTAIN or OFFICE-ribbon facades, and a crown (plant box, pyramid, slanted top or flat with a helipad).
import type { RGB } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, ngonPts, rectPts, type Fac, type XZ } from '../common-a/ctx';
import { antenna, aviationLight, hvac } from '../common-a/kit';
import { P, shade } from '../common-a/palette';

export type Plan = 'box' | 'chamfer' | 'round';
export type Crown = 'plant' | 'pyramid' | 'slant' | 'flat' | 'helipad' | 'none';

export interface TowerSpec {
  /** Shaft footprint at its base (lot frame). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Shaft base (podium roof) and top heights. */
  y0: number;
  top: number;
  plan: Plan;
  setbacks: 0 | 1 | 2;
  fac: Fac;
  wall: RGB;
  roof: RGB;
  crown: Crown;
  /** Company main roof (owner tint at city zoom). */
  ownerRoof: boolean;
}

/** Footprint polygon for a plan inside a rectangle. */
export function planPts(plan: Plan, x0: number, z0: number, x1: number, z1: number): XZ[] {
  if (plan === 'round') return ngonPts((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 12, Math.PI / 12);
  if (plan === 'chamfer') {
    const k = Math.min(x1 - x0, z1 - z0) * 0.2;
    return [[x0 + k, z1], [x1 - k, z1], [x1, z1 - k], [x1, z0 + k], [x1 - k, z0], [x0 + k, z0], [x0, z0 + k], [x0, z1 - k]];
  }
  return rectPts(x0, z0, x1, z1);
}

/** Builds the shaft and crown; returns the top footprint rectangle and height (for antennas, emblems, cleaners). */
export function buildTower(c: Ctx, t: TowerSpec): { x0: number; z0: number; x1: number; z1: number; y: number } {
  const H = t.top - t.y0;
  const cuts = t.setbacks === 0 ? [1] : t.setbacks === 1 ? [0.6, 1] : [0.6, 0.85, 1];
  let { x0, z0, x1, z1 } = t;
  let y = t.y0;
  const lod1 = c.lod === 1;
  cuts.forEach((k, i) => {
    const yTop = i === cuts.length - 1 ? t.top : Math.round((t.y0 + H * k) / t.fac.floor) * t.fac.floor;
    const pts = planPts(lod1 ? 'box' : t.plan, x0, z0, x1, z1);
    const last = i === cuts.length - 1;
    c.prism(pts, y, yTop, t.wall, t.fac, t.roof, { vBase: t.y0, ownerRoof: t.ownerRoof && last });
    if (!last) {
      // setback terrace: inset the next section
      const inset = Math.min(4, 0.13 * Math.min(x1 - x0, z1 - z0));
      x0 += inset;
      x1 -= inset;
      z0 += inset;
      z1 -= inset;
      if (!lod1 && t.plan === 'box') c.parapet(x0 - inset, z0 - inset, x1 + inset, z1 + inset, yTop, shade(t.wall, 0.92), 1.0, 0.25);
    }
    y = yTop;
  });
  if (lod1) return { x0, z0, x1, z1, y };

  const w = x1 - x0, d = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (t.plan === 'box') c.parapet(x0, z0, x1, z1, y, shade(t.wall, 0.92), 1.0, 0.3);
  else c.prism(planPts(t.plan, x0, z0, x1, z1), y, y + 1.0, shade(t.wall, 0.92), null, null);
  switch (t.crown) {
    case 'plant': {
      const iw = w * 0.62, id = d * 0.62;
      c.prism(planPts(t.plan, mx - iw / 2, mz - id / 2, mx + iw / 2, mz + id / 2), y, y + 5, P.ind.galvanized, null, P.roof.tar);
      hvac(c, mx - iw / 4, mz, y + 5, 2.6, 2, 1.3);
      return { x0: mx - iw / 2, z0: mz - id / 2, x1: mx + iw / 2, z1: mz + id / 2, y: y + 6.3 };
    }
    case 'pyramid': {
      const rise = Math.min(w, d) * 0.55;
      if (t.plan === 'box') {
        c.withFlags(FL_SNOW, () => {
          c.ta([x0, y, z1], [x1, y, z1], [mx, y + rise, mz], t.roof);
          c.ta([x1, y, z1], [x1, y, z0], [mx, y + rise, mz], t.roof);
          c.ta([x1, y, z0], [x0, y, z0], [mx, y + rise, mz], t.roof);
          c.ta([x0, y, z0], [x0, y, z1], [mx, y + rise, mz], t.roof);
        });
      } else c.spire(mx, mz, Math.min(w, d) / 2, y, y + rise, t.plan === 'round' ? 12 : 8, t.roof, t.plan === 'round' ? Math.PI / 12 : Math.PI / 8);
      return { x0: mx - 0.5, z0: mz - 0.5, x1: mx + 0.5, z1: mz + 0.5, y: y + rise };
    }
    case 'slant': {
      // shed crown rising towards the back: glazed front slope, solid flanks
      const rise = Math.min(10, d * 0.45);
      const g = t.fac.style === 3 ? P.ind.glass2 : t.roof;
      c.withFlags(FL_SNOW, () => c.qa([x0, y, z1], [x1, y, z1], [x1, y + rise, z0], [x0, y + rise, z0], g));
      c.ta([x1, y, z1], [x1, y, z0], [x1, y + rise, z0], t.wall);
      c.ta([x0, y, z0], [x0, y, z1], [x0, y + rise, z0], t.wall);
      c.wall(x1, z0, x0, z0, y, y + rise, t.wall, null);
      return { x0, z0, x1, z1: z0 + 1, y: y + rise };
    }
    case 'helipad': {
      const r = Math.min(w, d) * 0.36;
      c.withFlags(FL_PAVED | FL_SNOW, () => c.disc(mx, mz, r, y + 0.08, 12, P.road.asphaltDark));
      const k = r * 0.45, yy = y + 0.11;
      c.line(mx - k * 0.55, mz - k, mx - k * 0.55, mz + k, k * 0.28, P.road.marking, yy);
      c.line(mx + k * 0.55, mz - k, mx + k * 0.55, mz + k, k * 0.28, P.road.marking, yy);
      c.line(mx - k * 0.55, mz, mx + k * 0.55, mz, k * 0.28, P.road.marking, yy);
      aviationLight(c, x0 + 0.6, z1 - 0.6, y + 1.0, 0.35);
      aviationLight(c, x1 - 0.6, z0 + 0.6, y + 1.0, 0.35);
      return { x0, z0, x1, z1, y: y + 1 };
    }
    case 'flat': {
      hvac(c, mx - w * 0.2, mz - d * 0.15, y, 3, 2.2, 1.6);
      hvac(c, mx + w * 0.18, mz + d * 0.12, y, 3, 2.2, 1.6);
      c.box(mx - 2.5, y, mz - 2, mx + 2.5, y + 3.2, mz + 2, shade(t.wall, 0.9), P.roof.tar);
      return { x0, z0, x1, z1, y: y + 1 };
    }
    default:
      return { x0, z0, x1, z1, y: y + 1 };
  }
}

/** Antenna + obstruction lights for tall buildings (art §4.3: above 60 m). */
export function tallBuildingLights(c: Ctx, top: { x0: number; z0: number; x1: number; z1: number; y: number }, withMast: boolean): void {
  if (c.lod === 1 || top.y < 60) return;
  const mx = (top.x0 + top.x1) / 2, mz = (top.z0 + top.z1) / 2;
  if (withMast) antenna(c, mx, mz, top.y, Math.min(24, top.y * 0.15));
  else aviationLight(c, mx, mz, top.y);
}

/** Paved forecourt with planters and trees in front of a tower podium. */
export function forecourt(c: Ctx, x0: number, z0: number, x1: number, z1: number, trees: boolean): void {
  c.ground(x0, z0, x1, z1, P.road.plaza, FL_PAVED | FL_SNOW);
  if (!trees || c.lod === 1) return;
  const n = Math.max(2, Math.floor((x1 - x0) / 9));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    const z = (z0 + z1) / 2;
    c.boxc(x, z, 2.2, 2.2, 0, 0.5, P.wall.concreteDark, P.ground.yard);
    c.tree(x, z, 'deciduous', 0.85);
  }
}
