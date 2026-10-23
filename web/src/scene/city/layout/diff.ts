// What changed between two revisions of the same city's layout, as far as the city's geometry is concerned (E3b bumps
// `layoutRev` when land is bought, sold or built on, and when cleared parcels or fields change). Land value, traffic,
// ownership and listings do not change any mesh, so a revision that only moves those rebuilds nothing.
import { isRoadKind, type CityGrid, type ParcelInfo } from './types';

/** Geometry-relevant signature of a parcel (everything the lot builders read). */
function parcelSig(p: ParcelInfo | undefined): string {
  if (!p) return '';
  const a = p.ambient;
  return `${p.id}|${p.px},${p.pz},${p.w},${p.h}|${p.zone}|${p.district}|${p.facing}|${p.vacant ? 1 : 0}|${p.landmark ?? ''}|${p.depositId ?? ''}|${a ? `${a.kind}:${a.floors}:${a.variant}` : ''}`;
}

/**
 * Plot indices whose content differs between `a` and `b`, or null when the layouts are not comparable (another city,
 * grid size, seed or climate): the caller then rebuilds everything.
 */
export function changedPlots(a: CityGrid, b: CityGrid): Set<number> | null {
  if (a.cityId !== b.cityId || a.gridW !== b.gridW || a.gridH !== b.gridH || a.seed !== b.seed || a.climate !== b.climate) return null;
  if ((a.heights === null) !== (b.heights === null)) return null;
  const W = a.gridW, H = a.gridH;
  const out = new Set<number>();
  const sigA = a.parcels.map(parcelSig), sigB = b.parcels.map(parcelSig);
  for (let i = 0; i < W * H; i++) {
    const pa = a.parcelAt[i], pb = b.parcelAt[i];
    if (
      a.kind[i] !== b.kind[i] || a.road[i] !== b.road[i] || a.bridge[i] !== b.bridge[i] || a.district[i] !== b.district[i]
      || a.lanes[i] !== b.lanes[i] || a.shore[i] !== b.shore[i] || (a.slope?.[i] ?? 0) !== (b.slope?.[i] ?? 0)
      || (pa < 0 ? '' : sigA[pa]) !== (pb < 0 ? '' : sigB[pb])
    ) out.add(i);
  }
  if (a.heights && b.heights) {
    for (let cz = 0; cz <= H; cz++) {
      for (let cx = 0; cx <= W; cx++) {
        const k = cz * (W + 1) + cx;
        if (Math.abs(a.heights[k] - b.heights[k]) < 1e-4) continue;
        for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
          const x = cx + dx, z = cz + dz;
          if (x >= 0 && z >= 0 && x < W && z < H) out.add(z * W + x);
        }
      }
    }
  }
  // A changed plot also changes whole parcels around it (a parcel is built by one chunk, terraces and fences span it).
  for (const i of [...out]) {
    for (const g of [a, b]) {
      const p = g.parcelAt[i];
      if (p < 0) continue;
      const q = g.parcels[p];
      for (let z = q.pz; z < q.pz + q.h; z++) for (let x = q.px; x < q.px + q.w; x++) out.add(z * W + x);
    }
  }
  return out;
}

/** True when the road network of `b` is the same as `a`'s (roads, bridges, classes, lanes and terrain under them). */
export function sameRoads(a: CityGrid, b: CityGrid): boolean {
  if (a.gridW !== b.gridW || a.gridH !== b.gridH) return false;
  for (let i = 0; i < a.kind.length; i++) {
    if (isRoadKind(a.kind[i]) !== isRoadKind(b.kind[i]) || a.road[i] !== b.road[i] || a.bridge[i] !== b.bridge[i] || a.lanes[i] !== b.lanes[i]) return false;
  }
  if (a.heights && b.heights) for (let k = 0; k < a.heights.length; k++) if (Math.abs(a.heights[k] - b.heights[k]) >= 1e-4) return false;
  return (a.heights === null) === (b.heights === null);
}
