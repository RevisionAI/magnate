// Company headquarters — `headquarters` (art §4.4 "office_tower, headquarters": the office tower with a
// **logo crown** — the owner's emblem on four faces, emissive — and a height that grows with market cap;
// caplab §5.6 "Signature tower"). 2×2 or 3×3.
// Height: FamilyParams.floors when given (the scene maps market-cap bands to storeys), else by level:
// L1 14 floors, L2 26, L3 40. Owner paint: crown panels + emblems, podium roof band, entrance canopy with the
// wordmark, three flags; roof faces flagged for the owner tint at city zoom.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FL_SNOW, Y_GROUND } from '../common-a/constants';
import { Ctx, FACADE, Side, rectSides, requestedFloors, type Fac } from '../common-a/ctx';
import { door, emblem, flagpole, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';
import { buildTower, forecourt, planPts, tallBuildingLights, type Plan } from './tower';

const PODIUM_H = 9;
const LOBBY: Fac = { style: FACADE.shop.style, floor: 4.5, bay: 4.5 };
const LEVEL_FLOORS = [14, 26, 40] as const;
const CROWN_H = 9;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x502);
  const plan: Plan = (p.variant >>> 0) % 2 === 0 ? 'chamfer' : 'box';
  const r = c.shape, col = c.color;
  const hw = c.hw - 1, hd = c.hd - 1;
  const floors = requestedFloors(p, 8, 70) ?? LEVEL_FLOORS[Math.max(1, Math.min(3, p.level)) - 1];
  const wall = col.pick([P.wall.aluminium, P.wall.steelBlue, P.wall.limestone]);
  const fac = FACADE.curtain;
  const plaza = Math.min(12, c.D * 0.22);
  const px0 = -hw, px1 = hw, pz0 = -hd, pz1 = hd - plaza;
  const tw = (px1 - px0) * 0.66, td = Math.min((pz1 - pz0) * 0.8, tw);
  const tcz = (pz0 + pz1) / 2 - 1;
  const shaftTop = PODIUM_H + floors * fac.floor;

  // podium with an owner-colour roof band on the street face
  c.mass(px0, pz0, px1, pz1, 0, PODIUM_H, shade(wall, 0.88), LOBBY, P.roof.gravel, { ownerRoof: true });
  if (c.lod === 0) c.parapet(px0, pz0, px1, pz1, PODIUM_H, shade(wall, 0.85), 0.9, 0.3, c.own, c.signEm);

  const top = buildTower(c, { x0: -tw / 2, z0: tcz - td / 2, x1: tw / 2, z1: tcz + td / 2, y0: PODIUM_H, top: shaftTop, plan, setbacks: plan === 'box' ? 1 : 0, fac, wall, roof: P.roof.tar, crown: 'none', ownerRoof: true });

  // logo crown: owner-colour band on the top section with the emblem on all four main faces
  const inset = 0.4;
  const cx0 = top.x0 + inset, cx1 = top.x1 - inset, cz0 = top.z0 + inset, cz1 = top.z1 - inset;
  const crownBase = top.y - 1; // buildTower reports the parapet top
  const pts = planPts(c.lod === 1 ? 'box' : plan, cx0, cz0, cx1, cz1);
  c.prism(pts, crownBase, crownBase + CROWN_H, c.signC, null, null, { em: c.signEm });
  c.roofTop(pts, crownBase + CROWN_H, P.roof.tar, true);
  if (c.lod === 1) return c.finish();

  const faces = pts.length === 4
    ? [new Side(pts[0][0], pts[0][1], pts[1][0], pts[1][1]), new Side(pts[1][0], pts[1][1], pts[2][0], pts[2][1]), new Side(pts[2][0], pts[2][1], pts[3][0], pts[3][1]), new Side(pts[3][0], pts[3][1], pts[0][0], pts[0][1])]
    : [0, 2, 4, 6].map((i) => new Side(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  const emR = Math.min(CROWN_H * 0.4, Math.min(...faces.map((f) => f.len)) * 0.3);
  const emCol = c.closed ? X.signGrey : X.white, emEm = c.closed ? 0 : EM.lamp;
  // street face: emblem on the left, wordmark to its right; the other faces carry a centred emblem
  const cf = faces[0];
  const wide = cf.len > emR * 2 + 14;
  emblem(c, cf, wide ? emR + 1.5 : cf.len / 2, crownBase + CROWN_H / 2, emR, 0.06, emCol, emEm);
  if (wide && !c.closed) c.sign(cf, emR * 2 + 2.8, cf.len - 1.5, crownBase + CROWN_H * 0.28, crownBase + CROWN_H * 0.72, 0.07);
  for (const f of faces.slice(1)) emblem(c, f, f.len / 2, crownBase + CROWN_H / 2, emR, 0.06, emCol, emEm);
  tallBuildingLights(c, { x0: cx0, z0: cz0, x1: cx1, z1: cz1, y: crownBase + CROWN_H }, true);

  // grand entrance: glazed lobby doors, owner canopy fascia carrying the wordmark
  const front = rectSides(px0, pz0, px1, pz1).front;
  const du = front.len / 2;
  door(c, front, du, 6, 4.2, X.screenDark);
  c.sideBox(front, du - 7, du + 7, 5.0, 5.4, 0, 4.0, P.wall.concreteDark, P.wall.concreteDark);
  c.signBoard(new Side(front.x(du - 7, 4.0), front.z(du - 7, 4.0), front.x(du + 7, 4.0), front.z(du + 7, 4.0)), 0, 14, 5.0, 6.2, 0, 0.2);

  // forecourt: paving, a fountain, three owner flags
  forecourt(c, px0, pz1, px1, c.hd - 0.3, false);
  const fx = r.chance(0.5) ? -hw * 0.45 : hw * 0.45, fz = (pz1 + c.hd) / 2;
  c.cyl(fx, fz, 3.2, 0, 0.6, 10, P.wall.limestone, P.wall.limestone, false);
  c.disc(fx, fz, 3.15, 0.5, 10, P.water.shallow, EM.faint);
  c.cone(fx, fz, 0.35, 0.05, 0.5, 2.2, 5, P.water.foam);
  const flagX = -fx;
  for (let i = -1; i <= 1; i++) flagpole(c, flagX + i * 3.2, fz, 10, c.own);
  c.withFlags(FL_SNOW, () => c.disc(flagX, fz, 5.2, Y_GROUND + 0.02, 8, P.wall.limestone));
  for (const tx of [px0 + 3, px1 - 3]) c.tree(tx, fz + (r.f() - 0.5) * 3, 'deciduous');
  if (!c.closed) {
    c.pool(fx, fz, 6);
    c.pool(du - front.len / 2, pz1 + 3, 8);
  }
  weeds(c, [[px0 + 1, pz1 + 1, px1 - 1, c.hd - 1.5]]);
  return c.finish();
}

export const headquartersFactory: AssetFactory = {
  id: 'headquarters',
  footprints: [[2, 2], [3, 3]],
  triBudget: { lod0: 1000, lod1: 50 },
  build,
};
