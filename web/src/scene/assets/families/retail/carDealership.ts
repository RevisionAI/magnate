// Car dealership — company building `car_dealership` (E1 content, 2×2 = 48 × 48 m). PLACEHOLDER mapping added at the
// Wave 2 merge until W3 models the real showroom: the small-shop kit on a 2×2 lot reads as a glazed single-storey
// showroom set back behind a wide paved forecourt (the display lot) with an owner-colour awning and fascia.
// TODO(Wave 3, W3): a proper dealership (double-height glass showroom, canopy, display cars, service bay).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { Ctx } from '../common-a/ctx';
import { P } from '../common-a/palette';
import { buildSmallShop } from '../commercial/smallShop';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x60d);
  buildSmallShop(c, {
    wall: c.color.pick([P.wall.warmWhite, P.wall.greige]),
    roof: P.roof.membrane,
    upperFloors: 0,
    awning: 'plain',
    awningCols: [c.own],
    signCol: c.signC,
    signEm: c.signEm,
    flank: (p.variant >>> 0) % 2 === 1 ? 'left' : 'right',
    falseFront: (p.variant >>> 0) % 2 === 1, // a taller showroom parapet on odd variants
    blade: c.shape.chance(0.5),
    forecourtKit: true,
    ownerRoof: true,
  });
  return c.finish();
}

export const carDealershipFactory: AssetFactory = {
  id: 'car_dealership',
  footprints: [[2, 2]],
  triBudget: { lod0: 450, lod1: 40 },
  build,
};
