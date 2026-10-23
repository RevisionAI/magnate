// Build flow state (UX §6.6): Palette → Placing → Confirm → (constructing).
//
// Contract with the placement ghost (W6, built concurrently):
//   - Placing drives `useUiStore.buildMode = { typeId }`; the ghost follows the
//     cursor while it is set. Esc clears it (uiStore ladder) → the flow steps
//     back to the palette.
//   - When the player clicks a valid plot, W6 locks the ghost on it and emits
//     `interactionBus 'placementConfirmed' { typeId, cityId, at, preview, keepPlacing }`
//     (scene/interaction/interactionStore.ts). The build panel subscribes, so W6's
//     own construct fallback stays off (it only runs with no listener): the
//     building is constructed once, by the confirm card. While the confirm card
//     is up the ghost stays locked (build mode stays on); Back releases it
//     (`releaseGhost()`), Construct ends build mode (or releases it again when
//     the player keeps placing). Equivalent legacy channels, also accepted:
//       1. `submitPlacement({ typeId, cityId, at: { px, pz, rotation } })` (import from
//          'ui/panels/_shared-a/buildFlow');
//       2. a bus topic in PLACEMENT_TOPICS (e.g. `bus.emit('placementConfirmed', …)`),
//          payload `{ typeId?, cityId?, at | plot | placement | {px, pz, rotation} }`;
//       3. a DOM event `window.dispatchEvent(new CustomEvent('magnate:placement', { detail }))`.
//   - Without a ghost the panel offers the bridge's auto-site
//     (`previewBuild.suggestedPlacement`) and, when `features.plots` is on, a
//     plot list from `parcels`.

import { create } from 'zustand';
import type { PlotRefDto } from '@/bridge/protocol';
import { bus } from '@/game/events';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { interaction, releaseGhost } from './interactionLink';
import { normalizePlacement } from './placement';

export { normalizePlacement } from './placement';

export type BuildStep = 'palette' | 'placing' | 'confirm';
export type PlotSource = 'ghost' | 'auto' | 'parcel';

export interface PlacementChoice {
  /** Null = let the bridge auto-site it (no `at` on construct). */
  at: PlotRefDto | null;
  source: PlotSource;
  /** Parcel id when picked from the plot list. */
  parcelId?: number;
  /** The ghost was confirmed with Shift: place another of the same type afterwards. */
  keepPlacing?: boolean;
}

export interface BuildFlowState {
  step: BuildStep;
  typeId: string | null;
  cityId: string | null;
  choice: PlacementChoice | null;
  /** Product pre-selected by a deep link ("Open store here") or a starter suggestion. */
  productId: string | null;
  /** Bumps on every change, so the panel can key animations. */
  seq: number;

  /** Pick a building type → Placing (the ghost follows the cursor). */
  start(typeId: string, cityId: string, productId?: string | null): void;
  /** A plot was chosen (ghost, auto-site or plot list) → Confirm. */
  place(choice: PlacementChoice, typeId?: string, cityId?: string): void;
  /** Confirm → Placing → Palette. */
  back(): void;
  setProduct(productId: string | null): void;
  setCity(cityId: string): void;
  reset(): void;
}

export const useBuildFlow = create<BuildFlowState>()((set, get) => ({
  step: 'palette',
  typeId: null,
  cityId: null,
  choice: null,
  productId: null,
  seq: 0,

  start(typeId, cityId, productId = get().productId) {
    set((s) => ({ step: 'placing', typeId, cityId, choice: null, productId: productId ?? null, seq: s.seq + 1 }));
    enterBuildMode(typeId);
  },

  place(choice, typeId, cityId) {
    const s = get();
    set({ step: 'confirm', choice, typeId: typeId ?? s.typeId, cityId: cityId ?? s.cityId, seq: s.seq + 1 });
    // A ghost confirm keeps build mode on: W6 holds the ghost locked on the chosen
    // plot while the confirm card is up. Any other source stops the ghost.
    if (choice.source !== 'ghost' && useUiStore.getState().buildMode) useUiStore.getState().setBuildMode(null);
  },

  back() {
    const s = get();
    if (s.step === 'confirm' && s.typeId) {
      set({ step: 'placing', choice: null, seq: s.seq + 1 });
      enterBuildMode(s.typeId);
      return;
    }
    get().reset();
  },

  setProduct(productId) {
    set((s) => ({ productId, seq: s.seq + 1 }));
  },

  setCity(cityId) {
    set((s) => ({ cityId, choice: s.step === 'confirm' ? null : s.choice, step: s.step === 'confirm' ? 'placing' : s.step, seq: s.seq + 1 }));
  },

  reset() {
    set((s) => ({ step: 'palette', typeId: null, choice: null, seq: s.seq + 1 }));
    if (useUiStore.getState().buildMode) useUiStore.getState().setBuildMode(null);
  },
}));

/** Turns build mode on for a type; when it already is (a locked ghost), unlocks the ghost instead of restarting it. */
function enterBuildMode(typeId: string): void {
  const ui = useUiStore.getState();
  if (ui.buildMode?.typeId === typeId) releaseGhost();
  else ui.setBuildMode({ typeId });
}

// ------------------------------------------------------------------ ghost → panel

/** Bus topics the build panel accepts a confirmed plot on (W6 picks one; all are equivalent). */
export const PLACEMENT_TOPICS = ['placementConfirmed', 'placementConfirm', 'buildPlacementConfirmed', 'buildConfirmed'] as const;
export const PLACEMENT_DOM_EVENT = 'magnate:placement';

/**
 * The ghost confirmed a plot. Accepted while the flow is Placing (or the shell's
 * build mode is on); returns false when nothing is being placed.
 */
export function submitPlacement(payload: unknown): boolean {
  const norm = normalizePlacement(payload);
  if (!norm) return false;
  const flow = useBuildFlow.getState();
  const mode = useUiStore.getState().buildMode;
  const typeId = norm.typeId ?? flow.typeId ?? mode?.typeId ?? null;
  if (!typeId) return false;
  if (flow.step !== 'placing' && !mode) return false;
  const cityId = norm.cityId ?? flow.cityId ?? useGameStore.getState().activeCityId;
  if (!cityId) return false;
  const keepPlacing = (payload as { keepPlacing?: unknown }).keepPlacing === true;
  flow.place({ at: norm.at, source: 'ghost', ...(keepPlacing ? { keepPlacing } : {}) }, typeId, cityId);
  // Make sure the drawer shows the confirm card even if the player closed it while placing.
  useUiStore.getState().openPanel('build');
  return true;
}

let installed = false;

/** Wires the ghost → panel channels once (idempotent; called by the build panel). */
export function installPlacementBridge(): void {
  if (installed) return;
  installed = true;
  // The bus is typed to the shell's topics; the ghost's topic is not known at compile time.
  const looseBus = bus as unknown as { on(type: string, handler: (payload: unknown) => void): () => void };
  for (const topic of PLACEMENT_TOPICS) looseBus.on(topic, (payload) => void submitPlacement(payload));
  // W6's ghost. Subscribing switches W6's construct-it-myself fallback off; a
  // confirm the panel cannot take (nothing being placed) unlocks the ghost again.
  interaction?.interactionBus.on('placementConfirmed', (request) => {
    if (!submitPlacement(request)) releaseGhost();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener(PLACEMENT_DOM_EVENT, (e) => void submitPlacement((e as CustomEvent).detail));
  }
  // Esc (uiStore ladder), a right-click or a city switch clears build mode while
  // placing, or while confirming a ghost plot → back to the palette.
  useUiStore.subscribe((state, prev) => {
    if (!prev.buildMode || state.buildMode) return;
    const flow = useBuildFlow.getState();
    if (flow.step === 'placing' || (flow.step === 'confirm' && flow.choice?.source === 'ghost')) flow.reset();
  });
  // A new game or a load clears the flow.
  bus.on('gameStarted', () => useBuildFlow.getState().reset());
}
