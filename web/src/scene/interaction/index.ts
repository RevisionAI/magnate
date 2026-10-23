// Scene modules for interaction (picking, hover/selection, placement ghost, overlays, link arcs, labels and badges).
// Owned by workstream W6. The UI-facing contract lives in interactionStore.ts; the city renderer's in CitySource.ts.
import type { SceneModule } from '../SceneContext';
import { InteractionModule } from './InteractionModule';

export function createInteractionModules(): SceneModule[] {
  return [new InteractionModule()];
}

export { provideCitySource, type CityInteractionSource, type CityBuildingRef } from './CitySource';
export { buildPickIndex, pick, type PickIndex, type PickResult } from './Picking';
export {
  useInteractionStore, interactionBus, OVERLAY_IDS, OVERLAY_LABELS, type OverlayId, type GhostState, type PlacementRequest,
} from './interactionStore';
