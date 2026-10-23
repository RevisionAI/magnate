// The game screen's module list, in add order: city first (it publishes the layout
// other modules read), then the living city, then interaction on top. Each part is
// owned by one workstream; this file only composes them.
import type { SceneModule } from '../SceneContext';
import { createCityModules } from '../city';
import { createDynamicModules } from '../dynamic';
import { createInteractionModules } from '../interaction';

export function createGameModules(): SceneModule[] {
  // W6 draws the "+$X" world popups (DOM labels), so the living city's sprite popups are off:
  // each popup is drawn once (W5 status §2.2).
  return [...createCityModules(), ...createDynamicModules({ worldPopups: false }), ...createInteractionModules()];
}
