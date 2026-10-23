// Local shop — ambient archetype `ambient:shop` (art §4.3 "Local shop"): an unbranded local competitor built like
// the convenience store but with a neutral awning (muted palette, never an owner colour) and a generic category
// sign (sign quad `companyId: 'local:<icon>'`, icon ∈ shoe|gem|sofa|toy|book|flower|bakery|coffee).
// Six archetypes. A shop lot with more than two floors (FamilyParams.floors > 2) becomes a mixed-use mid-rise.
// Stage 'closed' (a vacant unit in a recession) boards the front up and adds a "For Lease" board.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM } from '../common-a/constants';
import { Ctx, requestedFloors } from '../common-a/ctx';
import { APT_WALLS, FLAT_ROOFS, P, X, shade } from '../common-a/palette';
import { buildMidrise } from './midrise';
import { buildSmallShop, type SmallShopSpec } from './smallShop';

const ICONS = ['shoe', 'gem', 'sofa', 'toy', 'book', 'flower', 'bakery', 'coffee'] as const;

type Shape = Pick<SmallShopSpec, 'upperFloors' | 'awning' | 'flank' | 'falseFront' | 'blade'>;
const SHAPES: readonly Shape[] = [
  { upperFloors: 0, awning: 'plain', flank: null, falseFront: false, blade: false },
  { upperFloors: 1, awning: 'striped', flank: null, falseFront: false, blade: true },
  { upperFloors: 0, awning: 'canopy', flank: 'right', falseFront: true, blade: false },
  { upperFloors: 2, awning: 'plain', flank: 'left', falseFront: false, blade: false },
  { upperFloors: 0, awning: 'striped', flank: null, falseFront: true, blade: true },
  { upperFloors: 1, awning: 'canopy', flank: null, falseFront: false, blade: true },
];

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x504);
  const floors = requestedFloors(p, 1, 9);
  if (floors !== undefined && floors > 2) {
    buildMidrise(c, floors, (['cornice', 'penthouse', 'turret', 'bays'] as const)[(p.variant >>> 0) % 4]);
    return c.finish();
  }
  const shape = SHAPES[(p.variant >>> 0) % SHAPES.length];
  const col = c.color;
  const aw = col.pick(X.awnings);
  const icon = ICONS[col.int(0, ICONS.length - 1)];
  const front = buildSmallShop(c, {
    ...shape,
    upperFloors: floors !== undefined ? (Math.min(2, floors - 1) as 0 | 1 | 2) : shape.upperFloors,
    wall: col.pick(APT_WALLS),
    roof: col.pick(FLAT_ROOFS),
    awningCols: shape.awning === 'striped' ? [aw, P.wall.warmWhite] : [aw],
    signCol: c.closed ? X.signGrey : shade(aw, 0.82),
    signEm: c.closed ? 0 : EM.soft,
    signId: `local:${icon}`,
    forecourtKit: false,
    ownerRoof: false,
  });
  if (c.closed && c.lod === 0) {
    // a vacant unit (the scene passes stage 'closed' for local shops left empty in a recession, art §4.3):
    // an estate agent's "For Lease" board, white with a red header, on the boarded-up front
    c.panel(front, 1.2, 3.0, 1.1, 2.3, 0.09, X.white);
    c.panel(front, 1.2, 3.0, 1.95, 2.3, 0.11, X.cross);
  }
  return c.finish();
}

export const shopFactory: AssetFactory = {
  id: 'ambient:shop',
  footprints: [[1, 1]],
  triBudget: { lod0: 600, lod1: 30 },
  build,
};
