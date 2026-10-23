// Scene modules for the city itself (terrain, roads, lots, ambient + company buildings) — workstream W2.
// GameScreen composes createCityModules(); other workstreams read the city through CityServices:
//
//   import { onCityServices } from '@/scene/city';
//   onCityServices(ctx, (city) => { city?.roads … city?.pick(ray) … city?.getEmitters() … });
import type { SceneModule } from '../SceneContext';
import { CityModule } from './CityModule';
import { GameCitySource } from './CitySource';

export function createCityModules(): SceneModule[] {
  return [new CityModule(new GameCitySource())];
}

export { CityModule, type CityModuleOptions } from './CityModule';
export { GameCitySource, type CitySource, type CitySourceState, type CityCompanyStyle } from './CitySource';
export {
  getCityServices, onCityServices, type CityServices, type CityBuilding, type CityChange, type LotInfo,
} from './CityServices';
export type { CityPick } from './PickIndex';
export {
  RoadNetwork, MASK_N, MASK_E, MASK_S, MASK_W, carriageHalfWidth, laneOffsets, cornerRadius, tileTypeOf,
  type RoadNode, type RoadEdge, type RoadTile, type TileType, type LanePoint,
} from './RoadNetwork';
export type { ChunkEmitter, ChunkAnimatedPart } from './chunkProtocol';
export { decodeLayout, terrainHeightAt, parcelTerrace } from './layout/decode';
export * from './layout/types';
