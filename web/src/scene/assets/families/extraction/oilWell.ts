// oil_well (2×2, art §4.2.13, L1–L3): gravel pad with a nodding pumpjack (walking beam + horsehead in the owner colour
// and the crank are animated parts, ±18° / 360° over 7.5 s), two white tanks with owner bands, a separator skid, a 12 m
// flare stack (flame at night) and a pipeline riser. L2 adds a second pumpjack; L3 a third pumpjack and tank.
// Construction override: a 38 m drilling derrick (#D9A441) on a drill floor at 6 m, mud tanks, pipe racks, generator
// and work lights, removed at completion.
import { FLAG_PAVED } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import { FACE_NX, FACE_PX, FACE_SIDES, FACE_TOP, type GeoBuilder } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import { LATTICE_ALL } from '../../shapes';
import { excavatorAt, hoarding, siteCabins, smoothstep, stageT } from '../construction/site';
import { fence, ground, hTank, roofBoard, tank, weeds, yardLamp } from '../common-b/details';
import { Kit } from '../common-b/kit';

const IRON = ASSET_RGB.pumpjackIron;
const PAD = WORLD_RGB.ground.gravel;
const PIPE = hexRgb('#7D858C');

/** Static pumpjack (skid, Samson post, gearbox, motor, wellhead) + its two animated parts. ~100 triangles. */
function pumpjack(k: Kit, x: number, z: number, phase: number): void {
  const concrete = WORLD_RGB.wall.concrete;
  k.slab(x - 2, z - 7.5, x + 2, z + 7.5, 0.06, shade(concrete, 0.95));
  k.box(x - 1.2, 0, z - 6.5, x + 1.2, 0.8, z + 5.5, IRON, shade(IRON, 1.1)); // base skid 12 × 2.4 × 0.8
  for (const [dx, dz] of [[-1.0, 1.4], [1.0, 1.4], [-1.0, -1.4], [1.0, -1.4]] as const) k.beam([x + dx, 0.8, z + dz], [x, 6.5, z], 0.3, 0.3, IRON, 4); // Samson post
  k.box(x - 0.9, 0.8, z - 5.4, x + 0.9, 2.8, z - 3.6, IRON, shade(IRON, 1.15)); // gearbox
  k.box(x - 0.6, 0.8, z - 6.45, x + 0.6, 1.8, z - 5.4, hexRgb('#5C6670'), hexRgb('#5C6670')); // motor
  // wellhead ("Christmas tree") with red valves and the polished rod
  k.cyl(x, z + 6.3, 0.5, 0, 0.6, 6, PIPE);
  k.boxAt(x, z + 6.3, 0.45, 0.45, 0.6, 1.3, PIPE);
  k.boxAt(x + 0.42, z + 6.3, 0.3, 0.55, 1.15, 0.18, ASSET_RGB.valveRed);
  k.boxAt(x - 0.42, z + 6.3, 0.3, 0.55, 1.15, 0.18, ASSET_RGB.valveRed);
  k.beam([x, 1.9, z + 6.3], [x, 3.6, z + 6.3], 0.09, 0.09, WORLD_RGB.wall.aluminium, 3);
  k.part('pumpjackBeam', x, 6.95, z, 0, { phase });
  k.part('pumpjackCrank', x, 2.3, z - 4.5, 0, { phase });
}

/** Drilling rig for the construction stages (art §4.2.13). `share` raises the derrick. */
function drillingRig(k: Kit, x: number, z: number, share: number): void {
  const yellow = ASSET_RGB.derrick, steel = hexRgb('#6A6F75');
  const h = Math.max(1, 38 * share);
  if (!k.lod0) {
    k.box(x - 4, 0, z - 4, x + 4, 6, z + 4, steel, shade(steel, 1.1));
    k.cone(x, z, 4, 1.5, 6, 6 + h, 4, yellow);
    return;
  }
  // substructure + drill floor 8 × 8 at 6 m
  for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]] as const) k.beam([x + dx, 0, z + dz], [x + dx, 6, z + dz], 0.6, 0.6, steel, 4);
  k.box(x - 4, 5.5, z - 4, x + 4, 6, z + 4, steel, shade(steel, 1.1));
  k.lattice(x, z, 7.5, 2.0 + (1 - share) * 5, 6, 6 + h, Math.max(3, Math.round(9 * share)), 0.32, 0.16, yellow, LATTICE_ALL);
  {
    k.box(x + 4, 6, z - 2, x + 7.5, 8.6, z + 2, hexRgb('#C8503C'), hexRgb('#B0463A')); // doghouse
    k.boxAt(x - 10, z - 6, 10, 3, 0, 3, shade(steel, 0.9)); // mud tanks
    k.boxAt(x - 10, z - 2, 10, 3, 0, 3, shade(steel, 0.95));
    k.boxAt(x + 10, z + 8, 4, 6, 0, 3.2, hexRgb('#E0B43A')); // generator
    for (let i = 0; i < 5; i++) k.cylAlong([x - 14, 0.9 + (i % 2) * 0.35, z + 9 + i * 0.5], [x - 2, 0.9 + (i % 2) * 0.35, z + 9 + i * 0.5], 0.17, 5, PIPE, null); // pipe rack
    if (share > 0.5) for (const y of [20, 32]) k.boxAt(x + 1.2, z + 1.2, 0.5, 0.5, 6 + y * share, 0.5, ASSET_RGB.workLight, ASSET_RGB.workLight);
  }
}

function buildOilWell(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const L = k.level;
  ground(k, -22, -22, 22, 22, PAD, 0.04);

  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') {
    const t = stageT(p.stage, k.progress);
    hoarding(k, -23.5, -23.5, 23.5, 23.5, [6, 16]);
    siteCabins(k, 6, 16);
    if (p.stage === 'foundation') {
      excavatorAt(k, -6, 4, Math.PI * 0.8);
      k.prop('dumpTruck', 10, 6, -Math.PI / 2);
      k.flagged(0, () => k.slab(-14, -14, -14 + 26 * Math.max(0.1, t), 12, 0.07, shade(PAD, 0.85)));
      k.emit('dust', -6, 1.5, 4, 0.5);
    } else {
      drillingRig(k, -6, -2, p.stage === 'structure' ? Math.max(0.05, smoothstep(0.25, 0.55, k.progress)) : 1);
      if (p.stage === 'finishing' && k.lod0) tank(k, 14, -14, 3, 7, WORLD_RGB.industry.tankWhite, null, 12);
      k.emit('dust', -6, 7, -2, 0.3);
    }
    return k.finish();
  }

  // pumpjacks (L1 one, L2 two, L3 three), phases offset so they never nod in unison
  const jacks: [number, number][] = [[-11, 3]];
  if (L >= 2) jacks.push([-11, -14.5]);
  if (L >= 3) jacks.push([0.5, 3]);
  if (k.lod0) jacks.forEach(([x, z], i) => pumpjack(k, x, z, (i * 0.37 + (p.seed % 97) / 97) % 1));
  else k.box(-13, 0, L >= 2 ? -21 : -4, L >= 3 ? 3 : -9, 3.5, 11, IRON);

  // tanks with owner bands, separator skid, flare stack, pipes
  const band = k.closed ? null : k.ownerRgb;
  const tanks: [number, number][] = [[14, -15.5], [14, -7]];
  if (L >= 3) tanks.push([14, 1.5]);
  if (k.lod0) {
    // the tank battery is the lease's main mass: its roofs carry the owner tint at city zoom
    k.roof(() => { for (const [x, z] of tanks) tank(k, x, z, 3, 7, WORLD_RGB.industry.tankWhite, band, 8); });
    // tank battery berm: a low concrete firewall around the tanks (the classic oil-lease silhouette)
    const bz0 = -20, bz1 = tanks[tanks.length - 1][1] + 4.2, bx0 = 9.6, bx1 = 18.6, wall = shade(WORLD_RGB.wall.concrete, 0.92);
    k.boxFaces(bx0, 0, bz0, bx1, 0.9, bz0 + 0.4, FACE_SIDES | FACE_TOP, wall, wall);
    k.boxFaces(bx0, 0, bz1 - 0.4, bx1, 0.9, bz1, FACE_SIDES | FACE_TOP, wall, wall);
    k.boxFaces(bx0, 0, bz0 + 0.4, bx0 + 0.4, 0.9, bz1 - 0.4, FACE_PX | FACE_NX | FACE_TOP, wall, wall);
    k.boxFaces(bx1 - 0.4, 0, bz0 + 0.4, bx1, 0.9, bz1 - 0.4, FACE_PX | FACE_NX | FACE_TOP, wall, wall);
    k.box(10.5, 0, 7.5, 17.5, 1.2, 12.5, IRON, shade(IRON, 1.1)); // separator skid
    hTank(k, [11.5, 2.4, 10], [16.5, 2.4, 10], 0.9, WORLD_RGB.industry.tankWhite);
    // flare stack with guy ropes and the knock-out drum
    k.cyl(-18, -18, 0.45, 0, 12, 6, PIPE, ASSET_RGB.dockShelter);
    for (const [dx, dz] of [[3, 0], [-1.5, 2.6], [-1.5, -2.6]] as const) k.beam([-18, 11, -18], [-18 + dx, 0, -18 + dz], 0.05, 0.05, ASSET_RGB.dockShelter, 3);
    hTank(k, [-15, 1.1, -14.5], [-12, 1.1, -14.5], 0.8, PIPE);
    // pipeline riser from each wellhead to the separator, then to the tanks
    for (const [x, z] of jacks) {
      k.beam([x, 0.45, z + 6.3], [x + 3, 0.45, z + 6.3], 0.22, 0.22, PIPE, 3);
      k.beam([x + 3, 0.45, z + 6.3], [x + 3, 0.45, 10], 0.22, 0.22, PIPE, 3);
      k.beam([x + 3, 0.45, 10], [10.5, 0.45, 10], 0.22, 0.22, PIPE, 3);
    }
    k.beam([14, 0.45, 7.5], [14, 0.45, tanks[tanks.length - 1][1] + 3], 0.22, 0.22, PIPE, 3);
    k.beam([17.5, 0.6, 9], [21.5, 0.6, 9], 0.3, 0.3, PIPE, 4); // pipeline riser leaving the pad
    k.beam([21.5, 0, 9], [21.5, 1.4, 9], 0.34, 0.34, PIPE, 4);
    fence(k, -22.6, -22.6, 22.6, 22.6, 2, [5, 18], 0);
    roofBoard(k, 20, 21, 0, 4, 1.4, 'pz', 1.1);
    // compacted access track from the gate to the separator, and the lease's meter house (owner door)
    k.flagged(FLAG_PAVED, () => k.slab(6.5, 13, 16.5, 21.9, 0.06, shade(PAD, 0.84)));
    k.box(2.5, 0, 14.5, 5.5, 2.6, 17.5, WORLD_RGB.wall.greige, WORLD_RGB.roof.flat);
    k.quad([5.52, 0.05, 15.4], [5.52, 0.05, 16.6], [5.52, 2.1, 16.6], [5.52, 2.1, 15.4], [1, 0, 0], k.closed ? ASSET_RGB.boarded : k.ownerRgb);
    yardLamp(k, -2, -21, 7, 0, 'warm');
    yardLamp(k, 21, -2, 7, -Math.PI / 2, 'warm');
  } else {
    k.roof(() => k.box(11, 0, -18.5, 17, 7, tanks[tanks.length - 1][1] + 3, WORLD_RGB.industry.tankWhite));
    k.cyl(-18, -18, 0.6, 0, 12, 3, PIPE, PIPE, false);
  }
  if (k.running) k.emit('flare', -18, 12.6, -18, 1);
  weeds(k, 3, [-20, -20, 20, 20]);
  return k.finish();
}

export const oilWell: AssetFactory = {
  id: 'oil_well',
  family: 'extraction',
  footprints: [[2, 2]],
  triBudget: { lod0: 900, lod1: 40 },
  build: buildOilWell,
};
