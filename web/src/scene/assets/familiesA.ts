// Asset factories owned by workstream W3 (residential, commercial, civic, props, retail, media, R&D, HQ).
// Each family module exports factories; they are listed here and registered by `registry.ts`.
//
// Ids: content building-type ids for company buildings ("supermarket"), "ambient:<kind>" for the ambient city
// (kinds follow `AmbientDto.kind` plus the art §5.3 extensions, e.g. "ambient:civic:exchange").
// Factories are pure and deterministic (they run in the chunk worker). See docs/overhaul/status/w3-assets-a.md.
import type { AssetFactory } from './AssetFactory';
import { bankFactory } from './families/civic/bank';
import { churchFactory } from './families/civic/church';
import { cityHallFactory } from './families/civic/cityHall';
import { fireFactory, policeFactory } from './families/civic/emergency';
import { exchangeFactory } from './families/civic/exchange';
import { hospitalFactory } from './families/civic/hospital';
import { parkFactory } from './families/civic/park';
import { parkingFactory } from './families/civic/parking';
import { plazaFactory } from './families/civic/plaza';
import { stadiumFactory } from './families/civic/stadium';
import { universityFactory } from './families/civic/university';
import { schoolFactory } from './families/civic/school';
import { headquartersFactory } from './families/commercial/headquarters';
import { midriseFactory } from './families/commercial/midrise';
import { officeFactory } from './families/commercial/office';
import { shopFactory } from './families/commercial/shop';
import { stripMallFactory } from './families/commercial/stripMall';
import { magazineFactory } from './families/media/magazine';
import { newspaperFactory } from './families/media/newspaper';
import { radioStationFactory } from './families/media/radioStation';
import { tvStationFactory } from './families/media/tvStation';
import { apartmentFactory } from './families/residential/apartment';
import { houseFactory } from './families/residential/house';
import { rowhouseFactory } from './families/residential/rowhouse';
import { villaFactory } from './families/residential/villa';
import { convenienceStoreFactory } from './families/retail/convenience';
import { carDealershipFactory } from './families/retail/carDealership';
import { departmentStoreFactory } from './families/retail/departmentStore';
import { supermarketFactory } from './families/retail/supermarket';
import { rdCenterFactory } from './families/rnd/rdCenter';

export const FAMILIES_A: readonly AssetFactory[] = [
  // residential
  houseFactory,
  rowhouseFactory,
  villaFactory,
  apartmentFactory,
  // commercial
  midriseFactory,
  shopFactory,
  stripMallFactory,
  officeFactory,
  // company buildings
  convenienceStoreFactory,
  carDealershipFactory,
  supermarketFactory,
  departmentStoreFactory,
  tvStationFactory,
  radioStationFactory,
  newspaperFactory,
  magazineFactory,
  rdCenterFactory,
  headquartersFactory,
  // civic landmarks and open space
  cityHallFactory,
  exchangeFactory,
  bankFactory,
  schoolFactory,
  hospitalFactory,
  policeFactory,
  fireFactory,
  universityFactory,
  stadiumFactory,
  churchFactory,
  parkFactory,
  plazaFactory,
  parkingFactory,
];

export { PROP_FAMILIES, SIGNAL_HEADS, billboardFaceCorners, type PropFamily } from './families/props/geometry';
export { PROP_IDS, type PropId } from './families/common-a/propIds';
export { treeLook, type TreeSpecies, type TreeFamilyId } from './families/common-a/vegetation';
export type { FamilyParams } from './families/common-a/ctx';
