// Optional link to W6's interaction contract (scene/interaction/interactionStore.ts).
//
// W6 is built concurrently on another branch, so the module may not exist in
// this tree. An eager `import.meta.glob` resolves to the module when it is
// there and to nothing when it is not, so the build panel compiles and runs
// either way. Only the members U2 uses are typed here (structurally, the same
// shapes as W6's `interactionBus` / `useInteractionStore`).

import type { BuildPreviewDto, PlotRefDto } from '@/bridge/protocol';

/** W6 `PlacementRequest` (the parts the build panel reads). */
export interface GhostPlacementRequest {
  typeId: string;
  cityId: string;
  at: PlotRefDto;
  preview: BuildPreviewDto | null;
  status: string;
  /** Shift+click: place another of the same type after this one. */
  keepPlacing: boolean;
}

export interface InteractionModuleLike {
  interactionBus: {
    on(type: 'placementConfirmed', handler: (payload: GhostPlacementRequest) => void): () => void;
  };
  useInteractionStore: {
    getState(): { releaseGhost(): void };
  };
}

const modules = import.meta.glob<InteractionModuleLike>('/src/scene/interaction/interactionStore.ts', { eager: true });

/** W6's interaction module, or null when this build does not have it. */
export const interaction: InteractionModuleLike | null = Object.values(modules)[0] ?? null;

/** Unlocks W6's ghost after a confirm (Back / keep placing / a refused placement). No-op without W6. */
export function releaseGhost(): void {
  interaction?.useInteractionStore.getState().releaseGhost();
}
