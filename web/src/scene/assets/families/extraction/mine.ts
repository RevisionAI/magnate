// iron_mine (3×3, art §4.2.12): a steel lattice headframe converging at 30 m with back-leg struts towards the winding
// house, two sheave wheels at 28 m (animated parts) under an owner-colour sheave housing, a winding house with an owner
// roof panel, an inclined conveyor gallery (4 → 18 m over 30 m) to a crusher and bin, a rust ore stockpile, two spoil
// heaps, a gravel haul road with yellow haul trucks, and dust ∝ utilization. Construction override (art §4.1): pit
// excavation, then the headframe erected as a rising lattice.
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, mixRgb, shade } from '../../palette';
import { LATTICE_ALL } from '../../shapes';
import { excavation, excavatorAt, hoarding, siteCabins, smoothstep, stageT } from '../construction/site';
import { conveyor, fence, industrialFacade, clerestoryGlass, ground, roofBoard, weeds, yardLamp } from '../common-b/details';
import { Kit, type P3 } from '../common-b/kit';

const I = WORLD_RGB.industry;
const STEEL = hexRgb('#5F6E7A');
/** Mine yard: gravel stained by iron-ore dust, and a darker compacted haul road (art §4.2.12). */
const GRAVEL = mixRgb(WORLD_RGB.ground.gravel, ASSET_RGB.ore, 0.2);
const ROAD = shade(mixRgb(WORLD_RGB.ground.gravel, ASSET_RGB.ore, 0.3), 0.8);
const HF = { x: -10, z: -10, top: 29, wheelY: 28 } as const;
const WIND = { x0: -35, z0: -17, x1: -20, z1: -3 } as const;
const PIT = { x: -19, z: 20, r: 11.5 } as const;
const BERM = ASSET_RGB.spoil1;
const BENCH = mixRgb(WORLD_RGB.ground.rock, ASSET_RGB.ore, 0.35);
const BENCH_FACE = mixRgb(ASSET_RGB.ore, WORLD_RGB.ground.soilDark, 0.4);

/** Open pit (art §4.2.12 variant): three 1.6 m benches stepping down inside a spoil berm. Built above grade — the
 *  city ground at y = 0 would hide anything dug below it — so the berm rises 4.8 m and the benches step down to a floor
 *  at ground level; from the city camera it reads as a terraced pit. LOD0 ≈ 15 triangles per segment, LOD1 15. */
function openPit(k: Kit, cx: number, cz: number, R: number): void {
  const benches = 3, w = 2.2, dh = 1.6, rim = benches * dh;
  if (!k.lod0) {
    k.cone(cx, cz, R + 3, R, 0, rim, 5, BERM);
    k.disc(cx, cz, R, 0.08, 5, shade(BENCH_FACE, 0.8));
    return;
  }
  const segs = 14;
  const at = (r: number, y: number, a: number): P3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
    const ox = Math.cos(am), oz = Math.sin(am);
    k.quad(at(R + 3, 0, a0), at(R + 3, 0, a1), at(R, rim, a1), at(R, rim, a0), [ox, 0.8, oz], BERM); // outer berm slope
    for (let b = 0; b < benches; b++) {
      const rTop = R - b * w, yTop = rim - b * dh, rIn = rTop - w * 0.55;
      k.quad(at(rTop, yTop, a0), at(rTop, yTop, a1), at(rIn, yTop, a1), at(rIn, yTop, a0), [0, 1, 0], b % 2 ? shade(BENCH, 0.94) : BENCH); // bench
      k.quad(at(rIn, yTop, a0), at(rIn, yTop, a1), at(rTop - w, yTop - dh, a1), at(rTop - w, yTop - dh, a0), [-ox, 0.45, -oz], BENCH_FACE); // face
    }
    const rf = R - benches * w;
    k.tri([cx, 0.06, cz], at(rf, 0.06, a0), at(rf, 0.06, a1), [0, 1, 0], shade(BENCH_FACE, 0.8)); // pit floor
  }
}

function headframe(k: Kit, share: number): void {
  const top = Math.max(1, HF.top * share);
  if (!k.lod0) {
    k.cone(HF.x, HF.z, 6, 6 - 4.2 * share, 0, top, 4, STEEL);
    return;
  }
  const panels = Math.max(2, Math.round(6 * share));
  k.lattice(HF.x, HF.z, 9, 9 - 6 * share, 0, top, panels, 0.55, 0.26, STEEL, LATTICE_ALL);
  if (share < 0.999) return;
  // back-leg struts towards the winding house (−X) and their cross brace
  for (const dz of [-1.6, 1.6]) k.beam([HF.x - 1.4, top - 1.5, HF.z + dz], [WIND.x1 + 1.5, 0, HF.z + dz * 2.6], 0.7, 0.7, STEEL, 4);
  k.beam([HF.x - 6.5, top * 0.55, HF.z - 3.2], [HF.x - 6.5, top * 0.55, HF.z + 3.2], 0.4, 0.4, STEEL, 3);
  // sheave deck and housing in the owner colour (art §4.2.12)
  const owner = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  k.box(HF.x - 2.6, HF.wheelY - 0.9, HF.z - 2.8, HF.x + 2.6, HF.wheelY - 0.5, HF.z + 2.8, owner, owner);
  for (const [dx, dz] of [[-2.4, -2.6], [2.4, -2.6], [-2.4, 2.6], [2.4, 2.6]] as const) k.beam([HF.x + dx, HF.wheelY - 0.5, HF.z + dz], [HF.x + dx, HF.wheelY + 2.9, HF.z + dz], 0.18, 0.18, owner, 3);
  k.box(HF.x - 2.7, HF.wheelY + 2.9, HF.z - 2.9, HF.x + 2.7, HF.wheelY + 3.25, HF.z + 2.9, owner, owner);
  // sheave wheels: axle along Z so the ropes run to the winding house; the second turns the other way
  k.part('sheaveWheel', HF.x, HF.wheelY, HF.z - 1.2, Math.PI / 2, { active: k.running });
  k.part('sheaveWheel', HF.x, HF.wheelY, HF.z + 1.2, -Math.PI / 2, { active: k.running });
  // hoist ropes down to the winding drum
  for (const dz of [-1.2, 1.2]) k.beam([HF.x - 2.25, HF.wheelY, HF.z + dz], [WIND.x1 - 0.2, 7.5, HF.z + dz * 0.6], 0.06, 0.06, ASSET_RGB.dockShelter, 3);
}

function windingHouse(k: Kit, share = 1): void {
  const r = WIND, eaves = 10 * share;
  if (eaves < 0.5) return;
  const fac = share >= 1 ? industrialFacade(k, 10) : null;
  const wall = WORLD_RGB.wall.brick;
  k.box(r.x0, 0, r.z0, r.x1, eaves, r.z1, wall, WORLD_RGB.roof.slate, fac, share < 1);
  if (share < 1) return;
  if (!fac) clerestoryGlass(k, r.x0, r.z0, r.x1, r.z1, 10, ['pz', 'nz', 'px', 'nx']);
  const rise = 2.2;
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.gable(r.x0, r.z0, r.x1, r.z1, eaves, rise, WORLD_RGB.roof.slate, wall, true, 0.4)));
  // owner roof panel on the street-side slope
  const half = (r.z1 - r.z0) / 2 + 0.4, len = Math.hypot(half, rise), ny = half / len, nz = rise / len, xm = (r.x0 + r.x1) / 2;
  const at = (x: number, f: number): [number, number, number] => [x, eaves + rise * f + 0.05 * ny, r.z1 + 0.4 - half * f + 0.05 * nz];
  k.quad(at(xm - 2, 0.2), at(xm + 2, 0.2), at(xm + 2, 0.2 + 4 / len), at(xm - 2, 0.2 + 4 / len), [0, ny, nz], k.closed ? ASSET_RGB.closedGrey : k.ownerRgb);
}

function buildIronMine(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  ground(k, -35.8, -35.8, 35.8, 35.8, GRAVEL, 0.03);

  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') {
    mineSite(k);
    return k.finish();
  }

  // haul road loop: gate → stockpile → crusher → back
  if (k.lod0) {
    const road = [[30, 35.5], [30, 24], [26, 4], [14, 1], [4, 6], [4, 24], [12, 31], [30, 31]] as const;
    for (let i = 0; i < road.length - 1; i++) k.strip(road[i][0], road[i][1], road[i + 1][0], road[i + 1][1], 7, 0.05, ROAD);
  }
  headframe(k, 1);
  // collar / head house at the shaft (hidden under the headframe stand-in at LOD1)
  if (k.lod0) k.boxAt(HF.x, HF.z, 7.5, 6.5, 0, 5.5, I.galvanized, shade(I.galvanized, 0.9));
  windingHouse(k);
  // crusher and ore bin, fed by the inclined conveyor gallery (4 → 18 m over 30 m)
  k.box(21, 0, -15, 31, 14, -5, WORLD_RGB.wall.concrete, shade(WORLD_RGB.wall.concrete, 0.9));
  k.box(19, 0, -3.5, 33, 6.5, 4.5, I.galvanized, WORLD_RGB.roof.flat);
  if (k.lod0) {
    conveyor(k, [HF.x + 3.8, 4.5, HF.z], [21, 17.6, -10], 2, 2.2, I.galvanized, 2);
    conveyor(k, [26, 13, -5], [19.5, 9.5, 9.5], 1.4, 1.4, I.galvanized, 1); // stacker to the stockpile
  } else {
    k.beam([HF.x + 3.8, 4.5, HF.z], [21, 17.6, -10], 2, 2.2, I.galvanized);
  }
  // ore stockpile cone Ø20 × 8 m, the open pit, and a spoil heap behind the winding house
  k.flagged(FLAG_SNOWABLE, () => {
    if (k.lod0) {
      k.mound(18, 14, 10, 10, 8, 12, ASSET_RGB.ore);
      k.mound(-27, -27.5, 7, 5.5, 5, 9, ASSET_RGB.spoil2);
    } else {
      k.cone(18, 14, 10, 0, 0, 8, 5, ASSET_RGB.ore);
      k.cone(-27, -27.5, 6, 0, 0, 5, 5, ASSET_RGB.spoil2);
    }
    openPit(k, PIT.x, PIT.z, PIT.r);
  });
  if (k.lod0) {
    if (k.complete) {
      k.prop('haulTruck', 27.5, 15, Math.PI * 0.05);
      k.prop('haulTruck', 8, 20, Math.PI * 0.75);
      k.prop('haulTruck', PIT.x + 1.5, PIT.z - 1, Math.PI * 0.3); // loading on the pit floor
    }
    roofBoard(k, 26, 33.5, 0, 6, 1.8, 'pz', 1.1);
    fence(k, -35.6, -35.6, 35.6, 35.6, 2, [24, 35.6]);
    yardLamp(k, 2, -1, 9, 0, 'cool');
    yardLamp(k, 31, 20, 9, -Math.PI / 2, 'cool');
    k.boxAt(HF.x + 3.2, HF.z, 0.4, 0.4, 17, 0.6, ASSET_RGB.floodHead, ASSET_RGB.floodHead); // headframe work light
  }
  k.emit('dust', 18, 7, 14, undefined, { size: 1.3 });
  k.emit('dust', 26, 6.5, 1, 0.8);
  k.emit('dust', PIT.x, 2, PIT.z, 0.6, { size: 1.2 });
  weeds(k, 3);
  return k.finish();
}

/** Mine construction: hoarding, pit excavation, then the headframe rising as a lattice and the winding house shell. */
function mineSite(k: Kit): void {
  const t = stageT(k.stage, k.progress);
  hoarding(k, -35.5, -35.5, 35.5, 35.5, [22, 31]);
  siteCabins(k, 8, 30);
  const pit = { x0: HF.x - 8, z0: HF.z - 8, x1: HF.x + 8, z1: HF.z + 8 };
  if (k.stage === 'foundation') {
    excavation(k, pit, t);
    excavatorAt(k, HF.x + 7, HF.z + 11, Math.PI);
    k.prop('dumpTruck', HF.x + 18, HF.z + 12, Math.PI / 2);
    k.emit('dust', HF.x, 1.5, HF.z, 0.5);
    return;
  }
  k.flagged(FLAG_SNOWABLE, () => (k.lod0 ? k.mound(-24, 23, 8, 6, 3.5, 8, ASSET_RGB.spoil1) : k.cone(-24, 23, 7, 0, 0, 3.5, 5, ASSET_RGB.spoil1)));
  if (k.stage === 'structure') {
    headframe(k, Math.max(0.05, smoothstep(0.25, 0.85, k.progress)));
    windingHouse(k, smoothstep(0.4, 0.85, k.progress));
    k.prop('mobileCrane', HF.x + 9, HF.z + 2, Math.PI);
  } else {
    headframe(k, 1);
    windingHouse(k);
    k.boxAt(HF.x, HF.z, 7.5, 6.5, 0, 5.5, I.galvanized, shade(I.galvanized, 0.9));
  }
  k.emit('dust', HF.x, 2, HF.z + 6, 0.3);
}

export const ironMine: AssetFactory = {
  id: 'iron_mine',
  family: 'extraction',
  footprints: [[3, 3]],
  triBudget: { lod0: 2200, lod1: 100 },
  build: buildIronMine,
};
