// Interaction contract between the 3D city view (W6, scene/interaction/**) and the React UI (U1 shell, U2 panels).
//
// The existing seams stay where they are (read-only for W6):
//   • uiStore.buildMode = { typeId }  → the placement ghost follows the cursor (set by the build panel; Esc clears it).
//   • gameStore.selectBuilding(id)   → selection (the HUD opens the inspector); W6 calls it on click.
//   • bus 'locate' / 'worldPopup' / 'buildingSelected' → consumed here (camera focus, floating "+$X", outline).
//
// What is new lives in this file:
//   • useInteractionStore — hover, overlay, placement-ghost state and the minimap model (no per-frame writes: the
//     scene publishes hover/ghost on change and the camera footprint at ≤ 10 Hz).
//   • interactionBus      — 'placementConfirmed' (the build panel consumes it), 'placementCancelled', 'buildingHovered'.
//
// Contract for the build panel (U2) — see docs/overhaul/status/w6-interaction.md §2:
//   1. Panel: useUiStore.getState().setBuildMode({ typeId })   → ghost appears, Q/E rotate it, previewBuild runs.
//   2. Player clicks a valid (green/amber) spot or presses Enter → the ghost LOCKS on that spot and W6 emits
//      interactionBus 'placementConfirmed' { typeId, cityId, at, preview, keepPlacing }.
//   3. Panel shows its confirm card and calls construct { typeId, cityId, at, initialSlot? }, then either
//      setBuildMode(null) (done) or useInteractionStore.getState().releaseGhost() (Back → keep placing).
//   Without any 'placementConfirmed' listener W6 constructs at `at` itself (fallback) so the ghost works standalone.
import { create } from 'zustand';
import { EventBus } from '@/game/events';
import type { BuildPreviewDto, PlacementIssue, Rotation } from '@/bridge/protocol';

// ---------------------------------------------------------------------------------------------------- overlays

/** Map overlays (UX §6.5, art §5.14). Order = Shift+1..7 and the `O` cycle. */
export const OVERLAY_IDS = ['landValue', 'traffic', 'zones', 'owners', 'profit', 'share', 'links'] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export const OVERLAY_LABELS: Readonly<Record<OverlayId, string>> = {
  landValue: 'Land value',
  traffic: 'Traffic',
  zones: 'Zones',
  owners: 'Owners',
  profit: 'Profit',
  share: 'Market share',
  links: 'Supply links',
};

/** Legend published by the scene for the active overlay (the minimap renders it). */
export interface OverlayLegend {
  overlay: OverlayId;
  title: string;
  /** Short qualifier, e.g. the product of the market-share overlay or "last month". */
  subtitle?: string;
  /** 'ramp' = continuous gradient between labelled ends; 'bins' = discrete swatches; 'categories' = swatch + label. */
  kind: 'ramp' | 'bins' | 'categories';
  /** CSS colours (sRGB hex) in order. */
  colors: string[];
  /** Labels: two (low, high) for a ramp; one per swatch otherwise. */
  labels: string[];
  /** Shown instead of the swatches when there is nothing to show (e.g. no stores sell the product). */
  empty?: string;
}

// ------------------------------------------------------------------------------------------------- placement

/**
 * Ghost validity (art §5.13): green = valid and affordable; amber = valid but cash short or runway < 3 months after;
 * red = blocked (reason); grey = over your own building; pending = waiting for previewBuild.
 */
export type GhostStatus = 'pending' | 'valid' | 'warning' | 'blocked' | 'own';

export interface PlotAnchor {
  /** North-west plot of the ROTATED footprint (bridge PlacementDto convention). */
  px: number;
  pz: number;
  rotation: Rotation;
}

export interface GhostState {
  typeId: string;
  cityId: string;
  /** Anchor under the cursor, or null while the cursor is off the city. */
  at: PlotAnchor | null;
  /** Footprint in plots after rotation. */
  w: number;
  h: number;
  status: GhostStatus;
  /** Machine reason: a bridge PlacementIssue, or 'geography' | 'cash' | 'runway' | 'own' | 'unavailable'. */
  issue: PlacementIssue | 'geography' | 'cash' | 'runway' | 'own' | 'unavailable' | null;
  /** Player-facing reason ("Needs a coastal city", "Cash short $0.8M"…). */
  reason: string | null;
  /** Latest previewBuild result for `at` (null while pending or off the city). */
  preview: BuildPreviewDto | null;
  /** True after a confirm click until the panel constructs, cancels or releases the ghost. */
  locked: boolean;
}

/** Payload of interactionBus 'placementConfirmed'. */
export interface PlacementRequest {
  typeId: string;
  cityId: string;
  at: PlotAnchor;
  preview: BuildPreviewDto | null;
  status: Exclude<GhostStatus, 'pending' | 'blocked' | 'own'>;
  /** Shift+click: the player wants to place another of the same type after this one. */
  keepPlacing: boolean;
}

// ---------------------------------------------------------------------------------------------------- minimap

/** One building on the minimap, in plot coordinates (rotated footprint). */
export interface MinimapBuilding {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  color: string;
  mine: boolean;
}

/** Static-ish minimap model (changes with the city, the buildings or the overlay). */
export interface MinimapModel {
  cityId: string;
  gridW: number;
  gridH: number;
  /** RGBA bytes, one pixel per plot (row 0 = north). */
  base: Uint8ClampedArray;
  buildings: MinimapBuilding[];
  /** Bumps whenever `base` or `buildings` change (renderers cache on it). */
  rev: number;
}

/** Camera view on the ground, in plot coordinates (4 corners, may extend beyond the city). */
export interface MinimapView {
  corners: [number, number][];
  /** Orbit target (plots). */
  target: [number, number];
}

// ---------------------------------------------------------------------------------------------------- store

/** Scene-side actions the UI may call (registered by the interaction module while the city view is mounted). */
export interface InteractionSceneApi {
  /** Move the camera target to a plot-space point (minimap click/drag). */
  panToPlot(px: number, pz: number, animate: boolean): void;
  /** Frame a building (double-click focus). */
  focusBuilding(buildingId: number): void;
  /** HUD navigation buttons held down: pan (x = right, y = forward) and orbit (+1 = the Q direction), each −1…1;
   *  all zeros stops. */
  nudgeCamera(panX: number, panY: number, orbit: number): void;
  /** Orbit by `deg` immediately (compass drag); wraps a full 360°. */
  orbitCamera(deg: number): void;
  /** Rotate 45° (+1 = the Q direction), like Q/E. */
  rotateCamera(dir: 1 | -1): void;
  /** Turn back to a north-up view. */
  faceNorth(): void;
  /** Multiply the camera distance (< 1 zooms in), like +/−. */
  zoomCamera(factor: number): void;
  /** Compass bearing the camera looks along, clockwise from north, 0…360 (read per frame by the compass). */
  headingDeg(): number;
  /** Camera elevation above the ground in degrees (read per frame by the tilt slider). */
  elevationDeg(): number;
  /** Elevation limits in degrees, [min = towards the horizon, max = almost top-down]. */
  elevationRangeDeg(): [number, number];
  /** Tilt to an elevation in degrees (clamped); stops auto-tilt. */
  tiltCamera(deg: number, animate: boolean): void;
}

interface InteractionState {
  hoveredBuildingId: number | null;
  /** Active overlay, or null. */
  overlay: OverlayId | null;
  /** Product for the market-share overlay (null = automatic: your best seller in this city). */
  overlayProductId: string | null;
  overlayLegend: OverlayLegend | null;
  /** "Show supply links" for one building (context menu); null = none (the Links overlay shows all). */
  linksFor: number | null;
  ghost: GhostState | null;
  minimap: MinimapModel | null;
  minimapView: MinimapView | null;
  scene: InteractionSceneApi | null;

  setOverlay(overlay: OverlayId | null, productId?: string | null): void;
  /** Toggle: the same overlay again turns it off. */
  toggleOverlay(overlay: OverlayId): void;
  /** O / Shift+O: next / previous overlay, wrapping through "none". */
  cycleOverlay(dir?: 1 | -1): void;
  showLinksFor(buildingId: number | null): void;
  /** Unlock the ghost after a confirm (the panel's "Back"): placement continues under the cursor. */
  releaseGhost(): void;

  // ---- written by the scene (W6) ----
  setHovered(buildingId: number | null): void;
  setLegend(legend: OverlayLegend | null): void;
  setGhost(ghost: GhostState | null): void;
  setMinimap(model: MinimapModel | null): void;
  setMinimapView(view: MinimapView | null): void;
  setSceneApi(api: InteractionSceneApi | null): void;
  /** Clear presentation state (new game, load, quit). */
  reset(): void;
}

export interface InteractionEvents {
  /** The player confirmed a placement (click / Enter on a non-blocked ghost). The build panel (U2) consumes it. */
  placementConfirmed: PlacementRequest;
  /** Build mode ended without a placement (Esc, panel closed, city switched). */
  placementCancelled: { typeId: string };
  /** A click on a blocked spot (the panel may show the reason; the scene already flashes the ghost red). */
  placementRejected: { typeId: string; at: PlotAnchor; issue: GhostState['issue']; reason: string | null };
  /** Hover changed (null = nothing). Fires on change only. */
  buildingHovered: { buildingId: number | null };
}

/** Interaction events (additive to game/events.ts, which W6 does not own). */
export const interactionBus = new EventBus<InteractionEvents>();

/** Next overlay in the cycle (null = none). */
export function nextOverlay(current: OverlayId | null, dir: 1 | -1 = 1): OverlayId | null {
  const order: (OverlayId | null)[] = [null, ...OVERLAY_IDS];
  const i = order.indexOf(current);
  return order[(i + dir + order.length) % order.length] ?? null;
}

export const useInteractionStore = create<InteractionState>()((set, get) => ({
  hoveredBuildingId: null,
  overlay: null,
  overlayProductId: null,
  overlayLegend: null,
  linksFor: null,
  ghost: null,
  minimap: null,
  minimapView: null,
  scene: null,

  setOverlay(overlay, productId) {
    const patch: Partial<InteractionState> = { overlay };
    if (productId !== undefined) patch.overlayProductId = productId;
    if (overlay === null) patch.overlayLegend = null;
    set(patch);
  },

  toggleOverlay(overlay) {
    get().setOverlay(get().overlay === overlay ? null : overlay);
  },

  cycleOverlay(dir = 1) {
    get().setOverlay(nextOverlay(get().overlay, dir));
  },

  showLinksFor(buildingId) {
    set({ linksFor: buildingId });
  },

  releaseGhost() {
    const g = get().ghost;
    if (g?.locked) set({ ghost: { ...g, locked: false } });
  },

  setHovered(buildingId) {
    if (get().hoveredBuildingId === buildingId) return;
    set({ hoveredBuildingId: buildingId });
    interactionBus.emit('buildingHovered', { buildingId });
  },

  setLegend(legend) {
    set({ overlayLegend: legend });
  },

  setGhost(ghost) {
    set({ ghost });
  },

  setMinimap(model) {
    set({ minimap: model });
  },

  setMinimapView(view) {
    set({ minimapView: view });
  },

  setSceneApi(api) {
    set({ scene: api });
  },

  reset() {
    set({ hoveredBuildingId: null, overlay: null, overlayProductId: null, overlayLegend: null, linksFor: null, ghost: null });
  },
}));
