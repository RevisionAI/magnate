// seaport (5×3, art §4.2.8): the 120 m side faces the WATER (+Z in the lot frame; this overrides road facing).
// A concrete quay with fenders and bollards, two ship-to-shore gantry cranes (A-frame legs in the owner colour, truss
// boom in white, boom raised to 80° when no ship is at berth, trolley + spreader as an animated part), four container
// blocks (instanced 40 ft boxes, fill ∝ utilization), straddle carriers and reach stackers, a terminal office with the
// customs letter ("C"/"I", caplab §5.6) and the owner wordmark, a three-lane gatehouse on the land side, six 30 m flood
// masts with cool light pools, and a feeder container ship at berth when the month has import/export flows.
// Construction override: piles and a floating crane on a barge, then the quay deck, then the crane portals.
import { FLAG_PAVED } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import { FACE_PZ, FACE_SIDES, FACE_TOP, type GeoBuilder, type RGB } from '../../GeoBuilder';
import { ASSET_RGB, CONTAINER_HEX, CONTAINER_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import { hoarding, siteCabins, smoothstep, stageT } from '../construction/site';
import { floodMast, ground, officeFacade, ribbonGlass, roofBoard, weeds, yard } from '../common-b/details';
import { Kit } from '../common-b/kit';

const W = WORLD_RGB.wall, I = WORLD_RGB.industry;
const QUAY = shade(W.concrete, 1.02);
const FENDER = ASSET_RGB.dockShelter;
const RAIL = ASSET_RGB.rail;
const BOOM = ASSET_RGB.craneWhite;
const QUAY_FRONT = 36; // z of the quay edge (lot front)
const RAIL_SEA = 33.5, RAIL_LAND = 3.5; // 30 m gauge
const BOOM_Y = 42, OUTREACH = 45, BACKREACH = 15;
const CRANES = [-24, 22];
const FINISHED = new Set(['soft_drink', 'bread', 't_shirt', 'television', 'car', 'beer', 'coffee_drink', 'designer_jeans']);

/** Ship-to-shore gantry crane at x = cx (authoring frame). `raise` 0 = boom down (working), 1 = raised to 80°.
 *  `legShare` < 1 draws only the rising portal (construction). Owner paint goes on the portal (legs and sill
 *  girders, art §4.2.8 "legs in owner colour"); the A-frame, cross girders and boom are white, which keeps the owner
 *  colour under 15 % of the port's surface (art §3.4). ~380 triangles at LOD0. */
function stsCrane(k: Kit, cx: number, raise: number, legShare = 1): void {
  const owner: RGB = k.closed ? ASSET_RGB.closedGrey : k.owner === 255 ? hexRgb('#C8503C') : k.ownerRgb;
  const frame = shade(BOOM, 0.96);
  const portalY = 20 * legShare;
  if (!k.lod0) {
    for (const dx of [-8, 8]) for (const z of [RAIL_LAND, RAIL_SEA]) k.boxFaces(cx + dx - 0.7, 0, z - 0.7, cx + dx + 0.7, portalY, z + 0.7, 15, owner);
    if (legShare >= 1) {
      k.box(cx - 2, BOOM_Y - 2, RAIL_LAND - BACKREACH, cx + 2, BOOM_Y, raise > 0.5 ? RAIL_SEA : RAIL_SEA + OUTREACH, BOOM);
      k.beam([cx, portalY, RAIL_LAND + 4], [cx, BOOM_Y + 3, RAIL_SEA - 7], 1.2, 1.2, frame);
    }
    return;
  }
  // bogies on the rails, legs, portal beams (owner colour)
  for (const dx of [-8, 8]) {
    for (const z of [RAIL_LAND, RAIL_SEA]) {
      k.boxAt(cx + dx, z, 2.2, 3.4, 0, 1.6, FENDER);
      k.beam([cx + dx, 1.6, z], [cx + dx, portalY, z], 1.4, 1.4, owner, 4);
    }
    if (legShare >= 1) k.beam([cx + dx, portalY, RAIL_LAND - 0.7], [cx + dx, portalY, RAIL_SEA + 0.7], 1.6, 1.8, owner, 4, true);
  }
  if (legShare < 1) return;
  for (const z of [RAIL_LAND, RAIL_SEA]) k.beam([cx - 8.7, portalY, z], [cx + 8.7, portalY, z], 1.2, 1.4, frame, 4, true);
  // A-frame up to 45 m over the waterside legs, backstay to the landside legs
  const apexZ = RAIL_SEA - 7;
  for (const dx of [-7, 7]) {
    k.beam([cx + dx, portalY, RAIL_SEA], [cx + dx * 0.4, 45, apexZ], 1.1, 1.1, frame, 4);
    k.beam([cx + dx, portalY, RAIL_LAND + 4], [cx + dx * 0.4, 45, apexZ], 1.0, 1.0, frame, 4);
  }
  k.beam([cx - 3.2, 45, apexZ], [cx + 3.2, 45, apexZ], 1.0, 1.0, frame, 4, true);
  // boom (white truss): backreach + machinery house, then the outreach (down, or raised to 80°)
  const hinge = RAIL_SEA;
  k.truss([cx, BOOM_Y, RAIL_LAND - BACKREACH], [cx, BOOM_Y, hinge], 4, 3.4, 6, 0.42, 0.2, BOOM);
  k.box(cx - 5, BOOM_Y + 1.7, RAIL_LAND - BACKREACH, cx + 5, BOOM_Y + 6.7, RAIL_LAND - BACKREACH + 6, BOOM, shade(BOOM, 0.85));
  const a = (80 * Math.PI * raise) / 180;
  const tip: [number, number, number] = [cx, BOOM_Y + OUTREACH * Math.sin(a), hinge + OUTREACH * Math.cos(a)];
  k.truss([cx, BOOM_Y, hinge], tip, 4, 3.4, 9, 0.42, 0.2, BOOM);
  // forestays from the apex to the boom tip and to the backreach
  const stay = ASSET_RGB.dockShelter;
  k.beam([cx, 45.4, apexZ], tip, 0.18, 0.18, stay, 3);
  k.beam([cx, 45.4, apexZ], [cx, BOOM_Y + 1.6, RAIL_LAND - BACKREACH + 3], 0.18, 0.18, stay, 3);
  if (raise < 0.5 && !k.closed) k.part('gantryTrolley', cx, BOOM_Y - 1.8, hinge, 0, { extent: 30, active: k.running });
  // working lights under the boom (hinge, backreach) and the aviation light on the apex (art §4.2.8 night)
  const lamp = k.closed ? WORLD_RGB.industry.dockDoors : ASSET_RGB.floodHead, em = k.closed ? 0 : 255;
  for (const z of [hinge - 1, RAIL_LAND - BACKREACH + 8]) k.boxFaces(cx - 1.2, BOOM_Y - 2.3, z - 0.4, cx + 1.2, BOOM_Y - 1.7, z + 0.4, FACE_SIDES | FACE_TOP, lamp, lamp, null, em);
  k.boxFaces(cx - 0.3, 45.5, apexZ - 0.3, cx + 0.3, 46.1, apexZ + 0.3, FACE_SIDES | FACE_TOP, k.closed ? lamp : hexRgb('#FF4A3A'), k.closed ? lamp : hexRgb('#FF4A3A'), null, em);
}

/** One container block: rows along Z, 40 ft bays along X, tiers by fill (instanced 'containers'). */
function containerBlock(k: Kit, x0: number, z0: number, bays: number, rows: number, fill: number): void {
  for (let r = 0; r < rows; r++) {
    for (let b = 0; b < bays; b++) {
      const max = Math.max(0, Math.min(4, Math.round(1 + fill * 3.4 * (0.55 + 0.45 * k.rnd()))));
      const tiers = k.rnd() < 0.12 * (1 - fill) ? 0 : max;
      for (let t = 0; t < tiers; t++) {
        k.prop('containers', x0 + 6.1 + b * 12.5, z0 + 1.22 + r * 2.74, Math.PI / 2, { y: t * 2.6, color: CONTAINER_HEX[Math.floor(k.rnd() * CONTAINER_HEX.length)] });
      }
    }
  }
}

function quayAndYard(k: Kit, deckShare = 1): void {
  yard(k, -59.6, -35.6, 59.6, 2.2);
  const x1 = -60 + 120 * deckShare;
  k.flagged(FLAG_PAVED, () => k.slab(-60, 2, x1, QUAY_FRONT, 0.14, QUAY));
  // quay wall face down past the waterline, fenders every 10 m, bollards every 15 m
  k.boxFaces(-60, -3.2, QUAY_FRONT - 1, x1, 0.14, QUAY_FRONT, FACE_PZ, QUAY);
  if (!k.lod0) return;
  for (let x = -55; x <= x1 - 2; x += 10) k.boxAt(x, QUAY_FRONT + 0.25, 1.4, 0.5, -1.6, 1.6, FENDER);
  for (let x = -52.5; x <= x1 - 2; x += 15) k.cyl(x, QUAY_FRONT - 1.2, 0.35, 0.14, 0.95, 6, FENDER);
  for (const z of [RAIL_LAND, RAIL_SEA]) k.strip(-60, z, x1, z, 0.9, 0.16, RAIL);
  // apron markings: lane lines along the quay
  k.strip(-60, 18.5, x1, 18.5, 0.25, 0.16, WORLD_RGB.road.marking);
  k.strip(-60, 24, x1, 24, 0.25, 0.16, I.safetyYellow);
}

function buildSeaport(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  if (p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing') {
    portSite(k);
    return k.finish();
  }
  const shipAtBerth = !k.closed && (p.activity?.shipAtBerth ?? k.running);
  quayAndYard(k);
  for (const cx of CRANES) stsCrane(k, cx, shipAtBerth ? 0 : 1);

  // container yard: 2 × 2 blocks of 6 rows × 3 bays × 1–4 tiers (≤ 288 boxes)
  const fill = k.closed ? 0.15 : 0.25 + 0.7 * (k.complete ? k.util : 0);
  if (k.lod0) {
    for (const x0 of [-50, -6]) for (const z0 of [-34.2, -15.6]) containerBlock(k, x0, z0, 3, 6, fill);
    if (!k.closed) {
      k.prop('straddleCarrier', -11.5, -10, 0);
      k.prop('straddleCarrier', 33, -27, 0);
      k.prop('reachStacker', -40, 10, Math.PI / 2);
      k.prop('reachStacker', 12, 12, -Math.PI / 2);
      if (k.running) for (const x of [-30, -16, 4, 18]) k.prop('truckBox', x, 9.5 + (x % 3), Math.PI / 2, { color: '#E9E9E4' });
    }
  } else {
    // city band: each block as three row-bands in container colours, heights stepping with the fill (12 boxes)
    let n = 0;
    for (const x0 of [-50, -6]) {
      for (const z0 of [-34.2, -15.6]) {
        for (let b = 0; b < 3; b++, n++) {
          const col = CONTAINER_RGB[(n * 3 + 1) % CONTAINER_RGB.length];
          const h = 2.6 * Math.max(1, Math.round(1 + fill * 3 * (0.7 + 0.3 * ((n * 7) % 3) / 2)));
          k.box(x0, 0, z0 + b * 5.48, x0 + 37.5, h, z0 + b * 5.48 + 5.4, col, shade(col, 1.08));
        }
      }
    }
  }

  // terminal office with the customs letter and the owner wordmark; gatehouse with three lanes on the land side
  const O = { x0: 37, z0: -24, x1: 57, z1: -12 };
  const fac = officeFacade(k, 4);
  k.roof(() => k.box(O.x0, 0, O.z0, O.x1, 8, O.z1, W.warmWhite, WORLD_RGB.roof.flat, fac)); // main mass: owner roof tint
  if (k.lod0) {
    if (!fac) ribbonGlass(k, O.x0, O.z0, O.x1, O.z1, 2, 4, ['pz', 'nz', 'px', 'nx']);
    const letter = p.productIds?.some((id) => FINISHED.has(id)) ? 'C' : (p.productIds?.length ? 'I' : 'C');
    k.sign([O.x0 + 3.2, 6, O.z1 + 0.05], [0, 0, 1], 4.4, 1.4, { style: 'text', text: letter });
    roofBoard(k, 47, O.z0 + 6, 8, 12, 2.2, 'pz');
    const gx0 = 38, gz = -33;
    for (const dx of [0, 6, 12, 18]) k.beam([gx0 + dx, 0, gz], [gx0 + dx, 5.2, gz], 0.3, 0.3, W.aluminium, 3);
    k.box(gx0 - 1, 5.2, gz - 3, gx0 + 19, 5.8, gz + 3, W.warmWhite, k.closed ? ASSET_RGB.closedGrey : k.ownerRgb);
    for (const dx of [3, 9, 15]) k.boxAt(gx0 + dx, gz, 1.6, 2.4, 0, 2.6, W.warmWhite, WORLD_RGB.roof.flat);
    // flood masts
    for (const [x, z] of [[-55, -6], [-28, -6], [0, -6], [28, -6], [-40, 28], [40, 28]] as const) floodMast(k, x, z, 30, z > 0 ? 0 : Math.PI);
    // the feeder ship at berth (neutral livery), lying along the quay
    if (shipAtBerth) k.prop('feederShip', -2, QUAY_FRONT + 1.5 + 11, Math.PI / 2);
  }
  weeds(k, 4, [-58, -34, 34, 0]);
  return k.finish();
}

/** Port construction: piles and a floating crane on a barge (A), the quay deck advancing (B), crane portals rising
 *  and booms raised (C). */
function portSite(k: Kit): void {
  const t = stageT(k.stage, k.progress);
  hoarding(k, -59.5, -35.5, 59.5, 1.5, [36, 48]);
  siteCabins(k, 40, -30);
  ground(k, -59.5, -35.5, 59.5, 1.5, shade(WORLD_RGB.ground.gravel, 0.95), 0.035);
  if (k.stage === 'foundation') {
    // barge with a floating crane just off the quay line, three piles rising out of the water
    if (k.lod0) {
      k.box(-20, -0.6, QUAY_FRONT + 4, 12, 1.4, QUAY_FRONT + 14, hexRgb('#59636E'), hexRgb('#6B7580'));
      k.lattice(-12, QUAY_FRONT + 9, 3, 1.2, 1.4, 22, 5, 0.3, 0.15, ASSET_RGB.derrick);
      k.beam([-12, 20, QUAY_FRONT + 9], [-12, 28, QUAY_FRONT - 6], 0.8, 0.8, ASSET_RGB.derrick, 4, true);
      k.part('craneJib', -12, 22, QUAY_FRONT + 9, Math.PI, { active: true, extent: 18 });
    }
    for (let i = 0; i < 3; i++) k.cyl(-40 + i * 6, QUAY_FRONT - 2, 0.8, -3, -1 + 3.2 * Math.min(1, t * 1.5 - i * 0.15), 8, W.concrete);
    k.emit('dust', 0, 1.5, -10, 0.5);
    return;
  }
  if (k.stage === 'structure') {
    quayAndYard(k, Math.max(0.1, t));
    for (let x = -60 + 120 * t + 6; x < 58; x += 8) k.cyl(x, QUAY_FRONT - 2, 0.8, -3, 0.1, 6, W.concrete);
    for (const cx of CRANES) stsCrane(k, cx, 1, smoothstep(0.4, 1, t) * 0.999);
  } else {
    quayAndYard(k);
    for (const cx of CRANES) stsCrane(k, cx, 1);
    k.box(37, 0, -24, 57, 8 * Math.max(0.3, t), -12, W.concrete, W.concrete);
  }
  k.emit('dust', 0, 1.5, 15, 0.3);
}

export const seaport: AssetFactory = {
  id: 'seaport',
  family: 'logistics',
  footprints: [[5, 3]],
  triBudget: { lod0: 6000, lod1: 400 },
  build: buildSeaport,
};

/** Seaport props budget (art §4.2.8): ≤ 1,200 container instances. */
export const SEAPORT_MAX_CONTAINERS = 1200;

