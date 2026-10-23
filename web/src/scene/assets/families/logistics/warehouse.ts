// warehouse_small (2×2, art §4.2.6) and warehouse_large (4×4, §4.2.7): galvanized portal-frame sheds with an owner
// stripe under the eaves on the dock side, dock doors with black shelters, trailers at the docks ∝ transfers
// (art §3.16), pallet stacks and a forklift on the apron, an office pod, and on the large distribution centre a
// trailer yard and a giant roof logo (emblem + wordmark, 40 × 10 m) that reads at city zoom.
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { WORLD_RGB, mixRgb, shade } from '../../palette';
import { buildSiteForType } from '../construction/site';
import {
  clerestoryGlass, dockDoor, fence, floodMast, guardhouse, hvac, industrialFacade, officeFacade, ownerBand, parkCars, parkingRow,
  ribbonGlass, wallSign, weeds, yard, yardLamp,
} from '../common-b/details';
import { Kit } from '../common-b/kit';

const I = WORLD_RGB.industry, W = WORLD_RGB.wall, R = WORLD_RGB.roof;
const CONCRETE = shade(W.concrete, 0.94);

/** Trailers at the docks: art §3.16 clamp(round(log10(1 + transfers)), 0, docks); utilization fallback. */
function trailersAtDocks(k: Kit, docks: number, minShare: number): number {
  if (!k.complete) return 0;
  const a = k.p.activity;
  if (a && (a.transfersIn !== undefined || a.transfersOut !== undefined)) {
    const t = Math.max(0, (a.transfersIn ?? 0) + (a.transfersOut ?? 0));
    return Math.max(0, Math.min(docks, Math.round(Math.log10(1 + t))));
  }
  if (!k.running) return 0;
  return Math.min(docks, Math.round(docks * (minShare + (1 - minShare) * k.util) * 0.6));
}

/** Pick `n` distinct dock indices deterministically. */
function pickDocks(k: Kit, docks: number, n: number): number[] {
  const order = Array.from({ length: docks }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(k.rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, n).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------------------
// warehouse_small — 48 × 48 m
// ---------------------------------------------------------------------------------------------------------------

function buildWarehouseSmall(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') return buildSiteForType('warehouse_small', b, lot, p);
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const S = { x0: -21, z0: -22, x1: 21, z1: 4 }, eaves = 8, rise = 2.4;
  const cladding = (p.variant >> 1) % 2 === 0 ? I.galvanized : shade(I.industrialBlue, 1.25);

  yard(k, -23.5, -23.5, 23.5, 23.5);
  k.slab(-21, 4, 21, 20, 0.05, CONCRETE); // 16 m dock apron
  const fac = industrialFacade(k, eaves);
  if (k.lod0) {
    k.box(S.x0, 0, S.z0, S.x1, eaves, S.z1, cladding, R.membrane, fac, false);
    k.box(S.x0 - 0.05, 0, S.z0 - 0.05, S.x1 + 0.05, 0.9, S.z1 + 0.05, W.concreteDark, W.concreteDark, null, false);
    k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.gable(S.x0, S.z0, S.x1, S.z1, eaves, rise, (p.seed >>> 5) % 2 ? R.membrane : I.galvanized, cladding, true, 0.35)));
    // translucent roof-light strips down both slopes (12 triangles)
    const zm = (S.z0 + S.z1) / 2, run = (S.z1 - S.z0) / 2 + 0.35, len = Math.hypot(run, rise);
    const light = mixRgb(I.glass2, W.warmWhite, 0.45);
    for (const side of [1, -1] as const) {
      const ny = run / len, nz = (side * rise) / len;
      const at = (x: number, f: number): [number, number, number] => [x, eaves + rise * f + 0.04 * ny, zm + side * run * (1 - f) + 0.04 * nz];
      for (const x of [-12.5, 0, 12.5]) k.quad(at(x - 1.1, 0.22), at(x + 1.1, 0.22), at(x + 1.1, 0.8), at(x - 1.1, 0.8), [0, ny, nz], light);
    }
    if (!fac) clerestoryGlass(k, S.x0, S.z0, S.x1, S.z1, eaves, ['pz', 'nz', 'px', 'nx']);
    ownerBand(k, 'pz', S.z1, S.x0, S.x1, eaves - 1.4, eaves - 0.2); // owner stripe under the eaves, dock side
    wallSign(k, 'pz', S.z1, -12.5, 5.6, 11, 1.4);
    // 6 dock doors 3.6 × 4.2 m with shelters, office pod at the right end
    const doors = [-17, -11.8, -6.6, -1.4, 3.8, 9.0];
    for (const x of doors) dockDoor(k, 'pz', S.z1, x, 3.6, 4.2);
    for (const i of pickDocks(k, doors.length, trailersAtDocks(k, doors.length, 0.2))) k.prop('trailer', doors[i], S.z1 + 0.6 + 6.9, 0, { color: '#E9E9E4' });
    const pod = { x0: 13, z0: 4, x1: 21, z1: 10 };
    const pf = officeFacade(k, 3.2);
    k.box(pod.x0, 0, pod.z0, pod.x1, 3.2, pod.z1, W.warmWhite, R.flat, pf);
    if (!pf) ribbonGlass(k, pod.x0, pod.z0, pod.x1, pod.z1, 1, 3.2, ['pz', 'px']);
    hvac(k, 17, 7, 3.2, 2.2, 1.6, 1.0);
    // pallets and the forklift working the apron
    if (!k.closed) {
      for (let i = 0; i < 8; i++) k.prop('palletStack', -20 + (i % 4) * 1.5, 14 + Math.floor(i / 4) * 1.3, 0, { color: ['#C9B48A', '#E4E4DE', '#B98F5A'][i % 3] });
      if (k.running) k.prop('forklift', 4 + k.rnd() * 6, 15, Math.PI * (0.4 + 0.3 * k.rnd()));
    }
    parkCars(k, parkingRow(k, 4.5, 22.6, 6, 4.6, 2.5, -1), k.complete ? 0.3 + 0.6 * k.util : 0, 0);
    fence(k, -23.6, -23.6, 23.6, 23.6, 2, [-14, 2]);
    yardLamp(k, -21.5, 10, 9, Math.PI / 2, 'cool');
    yardLamp(k, 21.5, 14, 9, -Math.PI / 2, 'cool');
  } else {
    k.roof(() => k.box(S.x0, 0, S.z0, S.x1, eaves + rise * 0.5, S.z1, cladding, (p.seed >>> 5) % 2 ? R.membrane : I.galvanized, fac));
    k.box(13, 0, 4, 21, 3.2, 10, W.warmWhite, R.flat);
  }
  weeds(k, 3, [-20, 6, 20, 21]);
  return k.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// warehouse_large — 96 × 96 m
// ---------------------------------------------------------------------------------------------------------------

function buildWarehouseLarge(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') return buildSiteForType('warehouse_large', b, lot, p);
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const D = { x0: -45, z0: -47, x1: 45, z1: 13 }, h = 12;
  const cladding = (p.variant >> 1) % 2 === 0 ? W.aluminium : shade(I.industrialBlue, 1.3);
  const roofRgb = (p.seed >>> 5) % 2 ? R.membrane : R.gravel;

  yard(k, -47.5, -47.5, 47.5, 47.5);
  k.slab(-26, 13, 45, 31, 0.05, CONCRETE); // dock apron
  const fac = industrialFacade(k, h, 6);
  // distribution centre 90 × 60 × 12 m, flat roof behind a parapet
  k.box(D.x0, 0, D.z0, D.x1, h, D.z1, cladding, roofRgb, fac, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.slab(D.x0, D.z0, D.x1, D.z1, h - 0.15, roofRgb)));
  // giant roof logo, emblem + wordmark, 40 × 10 m, kept at LOD1 (art §4.2.7)
  k.sign([-2, h - 0.15, -17], [0, 1, 0], 40, 10, { lod1: true, offset: 0.08 });
  if (k.lod0) {
    k.box(D.x0 - 0.2, h - 0.2, D.z0 - 0.2, D.x1 + 0.2, h + 0.7, D.z0 + 0.3, shade(cladding, 0.92), shade(cladding, 1.04)); // parapets
    k.box(D.x0 - 0.2, h - 0.2, D.z1 - 0.3, D.x1 + 0.2, h + 0.7, D.z1 + 0.2, shade(cladding, 0.92), shade(cladding, 1.04));
    k.box(D.x0 - 0.2, h - 0.2, D.z0, D.x0 + 0.3, h + 0.7, D.z1, shade(cladding, 0.92), shade(cladding, 1.04));
    k.box(D.x1 - 0.3, h - 0.2, D.z0, D.x1 + 0.2, h + 0.7, D.z1, shade(cladding, 0.92), shade(cladding, 1.04));
    k.box(D.x0 - 0.06, 0, D.z0 - 0.06, D.x1 + 0.06, 1.0, D.z1 + 0.06, W.concreteDark, W.concreteDark, null, false);
    if (!fac) clerestoryGlass(k, D.x0, D.z0, D.x1, D.z1, h, ['pz', 'nz', 'px', 'nx']);
    ownerBand(k, 'pz', D.z1, -26, D.x1, h - 1.6, h - 0.3);
    // rooftop smoke vents in three rows, away from the logo
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) k.boxAt(D.x0 + 8 + i * 15, D.z0 + 6 + r * 1.0 + (r === 2 ? 46 : r * 0), 2.2, 1.6, h, 0.9, I.galvanized, shade(I.galvanized, 0.8));
    // 16 dock doors on the long front side
    const doors = Array.from({ length: 16 }, (_, i) => -23.5 + i * 4.4);
    for (const x of doors) dockDoor(k, 'pz', D.z1, x, 3.6, 4.2);
    for (const i of pickDocks(k, doors.length, trailersAtDocks(k, doors.length, 0.3))) k.prop('trailer', doors[i], D.z1 + 0.6 + 6.9, 0, { color: '#E9E9E4' });
    // trailer yard: a row of parked trailers and a couple of tractor units in owner livery
    if (!k.closed) {
      const parked = 10 + Math.round(4 * (k.complete ? k.util : 0));
      for (let i = 0; i < parked; i++) k.prop('trailer', -40 + i * 3.6, 40, 0, { color: i % 4 === 0 ? '#E4E4DE' : '#E9E9E4' });
      if (k.running) {
        k.prop('truckBox', 30, 36, Math.PI / 2, { color: k.ownerHex });
        k.prop('truckBox', 12, 27, -Math.PI / 2, { color: k.ownerHex });
      }
    }
    // office pod 16 × 8 m, two floors, owner roof
    const pod = { x0: -45, z0: 13, x1: -29, z1: 21 };
    const pf = officeFacade(k, 3.5);
    const podRoof = k.closed ? R.flat : k.ownerRgb;
    k.box(pod.x0, 0, pod.z0, pod.x1, 7, pod.z1, W.warmWhite, podRoof, pf, false);
    k.roof(() => k.slab(pod.x0, pod.z0, pod.x1, pod.z1, 7, podRoof));
    if (!pf) ribbonGlass(k, pod.x0, pod.z0, pod.x1, pod.z1, 2, 3.5, ['pz', 'px', 'nx']);
    wallSign(k, 'pz', pod.z1, -37, 5.6, 10, 1.3);
    parkCars(k, parkingRow(k, -45, 24, 6, 5, 2.6, 1), k.complete ? 0.4 + 0.5 * k.util : 0, Math.PI);
    fence(k, -47.6, -47.6, 47.6, 47.6, 2, [20, 44]);
    guardhouse(k, 46, 44, -1);
    floodMast(k, 0, 33, 18, 0);
    floodMast(k, 30, 33, 18, 0);
    yardLamp(k, -24, 30, 9, 0, 'cool');
  } else {
    k.box(-45, 0, 13, -29, 7, 21, W.warmWhite, k.closed ? R.flat : k.ownerRgb);
    if (!k.closed) k.box(-41.8, 0, 38.7, -41.8 + 13 * 3.6, 4, 41.3, WORLD_RGB.vehicles.trailer);
  }
  weeds(k, 4, [-44, 22, 44, 46]);
  return k.finish();
}

export const warehouseSmall: AssetFactory = {
  id: 'warehouse_small',
  family: 'logistics',
  footprints: [[2, 2]],
  triBudget: { lod0: 700, lod1: 40 },
  build: buildWarehouseSmall,
};

export const warehouseLarge: AssetFactory = {
  id: 'warehouse_large',
  family: 'logistics',
  footprints: [[4, 4]],
  triBudget: { lod0: 1600, lod1: 80 },
  build: buildWarehouseLarge,
};

