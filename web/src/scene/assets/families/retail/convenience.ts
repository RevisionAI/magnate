// Convenience store — company building `convenience_store` (art §4.2.1; 1×1 = 24 × 24 m): a small glazed shop
// with an owner-colour awning and a glowing fascia carrying the wordmark; forecourt with painted bays, ice chest,
// ATM and bike rack; bins in the rear yard; AC units on the roof. Shape variants: single storey (4.6 m), or
// 1–2 floors of flats above. Owner paint: awning, fascia, roof flag on the main roof.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { Ctx } from '../common-a/ctx';
import { P } from '../common-a/palette';
import { buildSmallShop } from '../commercial/smallShop';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x601);
  const withFlats = (p.variant >>> 0) % 2 === 1;
  const col = c.color;
  buildSmallShop(c, {
    wall: col.pick([P.wall.warmWhite, P.wall.cream, P.wall.greige]),
    roof: P.roof.membrane,
    upperFloors: withFlats ? (c.shape.chance(0.5) ? 1 : 2) : 0,
    awning: 'plain',
    awningCols: [c.own],
    signCol: c.signC,
    signEm: c.signEm,
    flank: c.shape.chance(0.5) ? 'right' : null,
    falseFront: false,
    blade: false,
    forecourtKit: true,
    ownerRoof: true,
  });
  return c.finish();
}

export const convenienceStoreFactory: AssetFactory = {
  id: 'convenience_store',
  footprints: [[1, 1]],
  triBudget: { lod0: 350, lod1: 30 },
  build,
};
