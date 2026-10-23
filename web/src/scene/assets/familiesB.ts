// Asset factories owned by workstream W4 (industrial, extraction, logistics,
// construction stages). Each family module exports factories; list them here.
//
// Also exported for the renderer (Wave 2):
//   PROPS_B        instanced prop families the B factories emit (registry.propFamilyFor)
//   PART_SPECS     animated part geometry + motion, partPose() for the per-frame pose (AnimatedParts.ts)
//   buildConstructionSite / TYPE_SITES   construction sites for ANY company building type
//   buildUpgradeSite / LEVEL_EXTENSIONS  level-upgrade overlays (mini stage B on the extension masses)
import type { AssetFactory } from './AssetFactory';
import { makeConstructionFactory } from './families/construction/site';
import { largeFarm, smallFarm } from './families/extraction/farm';
import { ironMine } from './families/extraction/mine';
import { oilWell } from './families/extraction/oilWell';
import { smallPlantation } from './families/extraction/plantation';
import { factoryLarge, factorySmall } from './families/industrial/factory';
import { seaport } from './families/logistics/seaport';
import { warehouseLarge, warehouseSmall } from './families/logistics/warehouse';

export { PROPS_B } from './families/common-b/props';
export { PART_SPECS, partPose, type PartPose, type PartSpec } from './families/common-b/parts';
export {
  buildConstructionSite, buildUpgradeSite, LEVEL_EXTENSIONS, TYPE_SITES, siteSpecFor, type SiteOptions, type SiteRect, type SiteSpec,
} from './families/construction/site';

/** W4 types that draw their own construction stages (the generic 'construction' factory delegates to them). */
const OWN_SITES: readonly AssetFactory[] = [
  factorySmall, factoryLarge, smallFarm, largeFarm, smallPlantation, ironMine, oilWell, warehouseSmall, warehouseLarge, seaport,
];

const construction = makeConstructionFactory(Object.fromEntries(OWN_SITES.map((f) => [f.id, f])));

export const FAMILIES_B: readonly AssetFactory[] = [...OWN_SITES, construction];
