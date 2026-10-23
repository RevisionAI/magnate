// Office tower — ambient archetype `ambient:office` (art §4.3): 2×2–4×4 lots, 10–60 floors (FamilyParams.floors
// from `AmbientDto.floors`, else seeded 10–28). 8 m podium (lobby glazing + one floor), shaft on 55–72% of the
// podium, 0–2 setbacks, CURTAIN (55%) or OFFICE-ribbon facades, crowns, antenna + aviation light above 60 m,
// helipad on ~5%, a window-cleaning gondola (animated part) on some tall towers.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { Ctx, FACADE, rectSides, requestedFloors, type Fac } from '../common-a/ctx';
import { canopy, door, hvac, weeds } from '../common-a/kit';
import { OFFICE_WALLS, P, X, shade } from '../common-a/palette';
import { buildTower, forecourt, tallBuildingLights, type Crown, type Plan } from './tower';

export const PODIUM_H = 8;
const PODIUM_FAC: Fac = { style: FACADE.shop.style, floor: 3.8, bay: 4.5 };

interface Kind {
  plan: Plan;
  setbacks: 0 | 1 | 2;
  crown: Crown;
  twin?: boolean;
}
const KINDS: readonly Kind[] = [
  { plan: 'box', setbacks: 0, crown: 'plant' },
  { plan: 'box', setbacks: 1, crown: 'flat' },
  { plan: 'box', setbacks: 2, crown: 'pyramid' },
  { plan: 'chamfer', setbacks: 0, crown: 'plant' },
  { plan: 'round', setbacks: 0, crown: 'flat' },
  { plan: 'box', setbacks: 0, crown: 'slant', twin: true },
  { plan: 'box', setbacks: 1, crown: 'helipad' },
  { plan: 'chamfer', setbacks: 1, crown: 'pyramid' },
];

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x501);
  const kind = KINDS[(p.variant >>> 0) % KINDS.length];
  const r = c.shape, col = c.color;
  const hw = c.hw - 1, hd = c.hd - 1;
  const floors = requestedFloors(p, 10, 60) ?? r.int(10, 28);
  const fac: Fac = r.chance(0.55) ? FACADE.curtain : FACADE.office;
  const wall = col.pick(OFFICE_WALLS);
  const roof = col.pick([P.roof.tar, P.roof.tar, P.roof.gravel]);
  const crown: Crown = kind.crown === 'flat' && r.chance(0.05) ? 'helipad' : kind.crown;
  const plaza = Math.min(8, c.D * 0.14);

  // podium covering the lot behind a paved forecourt
  const px0 = -hw, px1 = hw, pz0 = -hd, pz1 = hd - plaza;
  const ratio = r.range(0.55, 0.72);
  const tw = (px1 - px0) * Math.sqrt(ratio), td = Math.min((pz1 - pz0) * Math.sqrt(ratio), tw * r.range(0.7, 1.0));
  const tcx = r.range(-0.08, 0.08) * (px1 - px0), tcz = (pz0 + pz1) / 2 - r.range(0, 0.08) * (pz1 - pz0);
  const top = PODIUM_H + floors * fac.floor;

  if (c.lod === 0) forecourt(c, px0, pz1, px1, c.hd - 0.3, true);
  c.mass(px0, pz0, px1, pz1, 0, PODIUM_H, shade(wall, 0.9), PODIUM_FAC, P.roof.gravel);
  if (c.lod === 0) c.parapet(px0, pz0, px1, pz1, PODIUM_H, shade(wall, 0.85), 0.8, 0.3);

  const shafts = kind.twin && c.W >= 70
    ? [
        { x0: tcx - tw / 2, x1: tcx - 3 },
        { x0: tcx + 3, x1: tcx + tw / 2 },
      ]
    : [{ x0: tcx - tw / 2, x1: tcx + tw / 2 }];
  let highest = { x0: 0, z0: 0, x1: 0, z1: 0, y: 0 };
  shafts.forEach((s, i) => {
    const h = i === 1 ? top - Math.round(floors * 0.18) * fac.floor : top;
    const t = buildTower(c, { x0: s.x0, z0: tcz - td / 2, x1: s.x1, z1: tcz + td / 2, y0: PODIUM_H, top: h, plan: kind.plan, setbacks: kind.setbacks, fac, wall, roof, crown, ownerRoof: false });
    if (t.y > highest.y) highest = t;
  });
  if (c.lod === 1) return c.finish();

  tallBuildingLights(c, highest, crown !== 'pyramid' && crown !== 'helipad');
  // lobby entrance
  const front = rectSides(px0, pz0, px1, pz1).front;
  const du = front.len / 2 + tcx;
  door(c, front, du, 4.5, 3.2, X.screenDark);
  canopy(c, front, du, 9, 3.2, 4.6, shade(wall, 0.7), 0.35);
  // podium roof plant away from the shaft
  const freeX = px1 - (tcx + tw / 2) > 7 ? (tcx + tw / 2 + px1) / 2 : px0 - (tcx - tw / 2) < -7 ? (px0 + tcx - tw / 2) / 2 : null;
  if (freeX !== null) hvac(c, freeX, (pz0 + pz1) / 2, PODIUM_H, 3, 2.2, 1.6);
  // window-cleaning gondola on some tall towers (animated by the life module)
  if (floors >= 20 && r.chance(0.3)) c.anim('windowCleaner', tcx, highest.y, tcz + td / 2, 0, r.f());
  weeds(c, [[px0, pz1 + 1, px1, c.hd - 1]]);
  return c.finish();
}

export const officeFactory: AssetFactory = {
  id: 'ambient:office',
  footprints: [[2, 2], [3, 3], [4, 4]],
  triBudget: { lod0: 700, lod1: 40 },
  build,
};
