// Game-feel helpers (UX §8). Thin wrappers over the bus so any system can ask
// for juice without importing UI code; the HUD layers (ui/hud/FxLayers.tsx)
// render screen-space popups and confetti, the 3D layer renders world popups.

import { bus, type PopupRequest } from './events';

export const fx = {
  /** Floating label, e.g. fx.popup({ text: '+$412K', tone: 'gain', anchor: 'topbar.cash' }). */
  popup(request: PopupRequest): void {
    bus.emit('popup', request);
  },
  /** World-anchored popup over a building (rendered by the city view). */
  worldPopup(buildingId: number, text: string, tone: PopupRequest['tone'], amount: number, delayMs = 0): void {
    bus.emit('worldPopup', { buildingId, text, tone, amount, delayMs });
  },
  /** Confetti burst; origin defaults to the top centre of the screen. */
  confetti(options: { x?: number; y?: number; intensity?: number } = {}): void {
    bus.emit('confetti', options);
  },
  /** Frame a building or city in the 3D view. */
  locate(target: { buildingId?: number; cityId?: string }): void {
    bus.emit('locate', target);
  },
};
