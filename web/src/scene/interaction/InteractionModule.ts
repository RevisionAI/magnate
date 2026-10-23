// The interaction scene module (W6): the player touching the city.
//
//   pointer → one grid-DDA pick per frame → hover outline + hover card → click selects (gameStore.selectBuilding),
//   double-click focuses, right-click opens the building's context menu;
//   uiStore.buildMode → placement ghost (previewBuild, Q/E rotate, click/Enter confirm → interactionBus);
//   interactionStore.overlay → clay-mode overlays / link arcs + legend + minimap colours;
//   your buildings → gold ring decals + status badges; selection → dashed gold ring + name tag;
//   bus 'locate' / 'worldPopup' → camera focus / floating "+$X"; Home / Tab / O / Shift+1..7 scene keys.
//
// Engine data is fetched lazily per city and revision (cityLayout once per city, cityView on every revision,
// supplyFlows / marketDetail only while their overlay is on). No per-frame React state: the store gets hover and
// ghost changes as they happen and the camera footprint at ≤ 10 Hz.
import * as THREE from 'three';
import type { CityLayoutDto, CityViewDto, FlowDto, MarketDetailDto } from '@/bridge/protocol';
import { bus } from '@/game/events';
import { fx } from '@/game/fx';
import { maybeEngine, useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useTutorialStore } from '@/state/tutorialStore';
import { useUiStore } from '@/state/uiStore';
import { ownerColor, type ColourVisionMode } from '@/theme/tokens';
import { chordsFor, isTypingTarget, matchChord } from '@/ui/input/keymap';
import { uiSound } from '@/ui/sound';
import { humanizeId, signedMoney } from '@/util/format';
import { pickTruck, type TruckPick } from '../dynamic';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { PLOT_SIZE } from '../units';
import { BadgeLayer, EMBLEM_TILE0, GoldRings, TILE_OF_STATUS, type BadgeInstance } from './Badges';
import { buildModels, decodeLayout, type BuildingModel, type LayoutGrid } from './CityData';
import { onCitySourceChanged, providedCitySource, SceneGraphCitySource, type CityBuildingRef, type CityInteractionSource } from './CitySource';
import { footprintRect } from './FootprintRing';
import {
  interactionBus, OVERLAY_IDS, useInteractionStore, type MinimapBuilding, type OverlayId, type PlacementRequest, type PlotAnchor,
} from './interactionStore';
import { ghostColor, ghostTagHtml, hoverCardHtml, LabelLayer, selectionTagHtml, truckCardHtml, type LandmarkLabel } from './Labels';
import { arcsForFlows, LinkArcs } from './LinkArcs';
import { minimapBase, type MinimapOverlay } from './MinimapRenderer';
import {
  autoOverlayFor, landValueOverlay, linksLegend, OverlayController, ownersOverlay, profitOverlay, resampleBytes, shareOverlay, trafficOverlay,
  zonesOverlay, type OverlayBytes,
} from './Overlays';
import { pick, pickGround } from './Picking';
import { PlacementGhost } from './PlacementGhost';
import { SelectionVisuals, boxProxy } from './Selection';

const HOVER_CARD_DELAY_MS = 260;
const CLICK_SLOP_PX = 5;
const MINIMAP_VIEW_INTERVAL_MS = 100;
const LANDMARK_NAMES: Record<string, string> = {
  cityHall: 'City Hall', stockExchange: 'Stock Exchange', bank: 'Bank', investmentBank: 'Investment Bank', port: 'Port',
  university: 'University', stadium: 'Stadium', hospital: 'Hospital', centralPark: 'Central Park',
};

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

interface PendingPopup {
  buildingId: number;
  text: string;
  tone: 'gain' | 'loss' | 'gold' | 'neutral';
  delayMs: number;
  until: number;
}

export class InteractionModule implements SceneModule {
  readonly name = 'interaction';
  private ctx!: SceneContext;
  private fallback!: SceneGraphCitySource;
  private provided: CityInteractionSource | null = null;
  private labels!: LabelLayer;
  private selection!: SelectionVisuals;
  private ghost!: PlacementGhost;
  private badges!: BadgeLayer;
  private rings!: GoldRings;
  private arcs!: LinkArcs;
  private readonly overlays = new OverlayController();
  private readonly cleanups: Array<() => void> = [];

  // pointer
  private pointer: { x: number; y: number } | null = null;
  private pointerDirty = false;
  private down: { x: number; y: number; t: number; shift: boolean } | null = null;
  private hoverId: number | null = null;
  /** Company truck under the pointer (W5 traffic) when no building is. */
  private hoverTruck: TruckPick | null = null;
  private hoverSince = 0;
  private hoverPoint = new THREE.Vector3();

  // data
  private cityId: string | null = null;
  private layout: LayoutGrid | null = null;
  private layoutCity: string | null = null;
  private layoutLoading: string | null = null;
  private view: CityViewDto | null = null;
  private viewKey = '';
  private flows: FlowDto[] = [];
  private flowsKey = '';
  private market: MarketDetailDto | null = null;
  private marketKey = '';
  private models = new Map<number, BuildingModel>();
  private sourceRev = -1;
  private dataRev = 0;
  private builtRev = -1;
  private minimapRev = 0;
  private lastViewPublish = 0;
  private viewDirty = true;
  private width = 1;
  private height = 1;
  private now = 0;
  private pendingPopups: PendingPopup[] = [];
  private pendingLocate: { buildingId: number; until: number } | null = null;
  private pendingConfirm: { shift: boolean; anchor: string } | null = null;
  private placingDone = false;
  private overlayBeforeBuild: OverlayId | null | undefined = undefined;
  private disposed = false;

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.fallback = new SceneGraphCitySource(ctx);
    this.provided = providedCitySource(ctx);
    this.cleanups.push(onCitySourceChanged(ctx, (s) => { this.provided = s; this.sourceRev = -1; this.layoutCity = null; }));

    const container = ctx.canvas.parentElement ?? document.body;
    this.labels = new LabelLayer(container);
    this.selection = new SelectionVisuals(ctx);
    this.ghost = new PlacementGhost(
      (args) => {
        const engine = maybeEngine();
        if (!engine) return Promise.reject(new Error('engine not ready'));
        return engine.call('previewBuild', { typeId: args.typeId, cityId: args.cityId, at: { px: args.at.px, pz: args.at.pz, rotation: args.at.rotation } });
      },
      (anchor, w, h) => this.ownAt(anchor, w, h),
    );
    this.badges = new BadgeLayer();
    this.rings = new GoldRings();
    this.arcs = new LinkArcs();
    ctx.scene.add(this.ghost.group, this.badges.mesh, this.rings.mesh, this.arcs.group);

    this.installInput();
    this.installSubscriptions();
    useInteractionStore.getState().setSceneApi({
      panToPlot: (px, pz, animate) => this.panToPlot(px, pz, animate),
      focusBuilding: (id) => this.focusBuilding(id),
      nudgeCamera: (panX, panY, orbit) => this.ctx.rig.setNudge(panX, panY, orbit),
      orbitCamera: (deg) => this.ctx.rig.orbitBy(THREE.MathUtils.degToRad(deg)),
      rotateCamera: (dir) => void this.ctx.rig.rotateBy45(dir),
      faceNorth: () => void this.ctx.rig.faceNorth(),
      zoomCamera: (factor) => void this.ctx.rig.dollyBy(factor),
      headingDeg: () => this.ctx.rig.headingDeg,
      elevationDeg: () => this.ctx.rig.elevationDeg,
      elevationRangeDeg: () => this.ctx.rig.elevationRangeDeg,
      tiltCamera: (deg, animate) => void this.ctx.rig.setElevation(deg, animate),
    });
    this.applyControls();
    this.applyVision();
    this.onBuildMode();
    (window as unknown as { __magnateInteraction?: unknown }).__magnateInteraction = this.qaHandle();
  }

  /** QA / playtest handle (window.__magnateInteraction): screen positions, state, store. */
  private qaHandle() {
    return {
      store: useInteractionStore,
      bus: interactionBus,
      /** Client-space point over a building's roof centre (null when unknown or off screen). */
      screenOf: (id: number, yOffset = 0): { x: number; y: number } | null => {
        const ref = this.source.getBuilding(id);
        if (!ref) return null;
        _v.set((ref.box[0] + ref.box[3]) / 2, ref.box[4] * 0.6 + yOffset, (ref.box[2] + ref.box[5]) / 2).project(this.ctx.camera);
        if (_v.z > 1) return null;
        const r = this.ctx.canvas.getBoundingClientRect();
        return { x: r.left + (_v.x * 0.5 + 0.5) * r.width, y: r.top + (-_v.y * 0.5 + 0.5) * r.height };
      },
      /** Client-space point of a plot centre on the ground. */
      screenOfPlot: (px: number, pz: number): { x: number; y: number } | null => {
        const W = this.source.gridW, H = this.source.gridH;
        _v.set((px + 0.5 - W / 2) * PLOT_SIZE, 0, (pz + 0.5 - H / 2) * PLOT_SIZE).project(this.ctx.camera);
        if (_v.z > 1) return null;
        const r = this.ctx.canvas.getBoundingClientRect();
        return { x: r.left + (_v.x * 0.5 + 0.5) * r.width, y: r.top + (-_v.y * 0.5 + 0.5) * r.height };
      },
      buildings: () => [...this.source.buildings()].map((b) => ({ ...b, model: this.models.get(b.id) ?? null })),
      grid: () => ({ w: this.source.gridW, h: this.source.gridH, layout: this.layout ? { cityId: this.layout.cityId, w: this.layout.gridW, h: this.layout.gridH } : null }),
      focus: (id: number) => this.focusBuilding(id),
      panToPlot: (px: number, pz: number) => this.panToPlot(px, pz, false),
      /** Raw bridge call + store sync, for scripted setups (e.g. stocking a store so supply links exist). */
      engineCall: async (method: string, args: unknown): Promise<unknown> => {
        const engine = maybeEngine();
        if (!engine) throw new Error('engine not ready');
        const result = await engine.callRaw(method, args);
        await useGameStore.getState().syncAfterMutation();
        return result;
      },
    };
  }

  // ------------------------------------------------------------------------------------------------- sources

  private get source(): CityInteractionSource {
    return this.provided ?? this.fallback;
  }

  // ---------------------------------------------------------------------------------------------------- input

  private installInput(): void {
    const canvas = this.ctx.canvas;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.pointerDirty = true;
    };
    const onLeave = () => {
      this.pointer = null;
      this.pointerDirty = true;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), shift: e.shiftKey };
    };
    const onUp = (e: PointerEvent) => {
      const d = this.down;
      if (e.button !== 0 || !d) return;
      this.down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX || performance.now() - d.t > 700) return;
      this.onClick(e.clientX, e.clientY, d.shift || e.shiftKey);
    };
    const onDbl = (e: MouseEvent) => this.onDoubleClick(e.clientX, e.clientY);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('dblclick', onDbl);
    const onContext = (e: { clientX: number; clientY: number }) => this.onContextClick(e.clientX, e.clientY);
    const onUserInput = () => { this.hoverSince = this.now + 10_000; this.labels.setHoverCard(null); };
    this.ctx.rig.addEventListener('contextclick', onContext);
    this.ctx.rig.addEventListener('userinput', onUserInput);
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('dblclick', onDbl);
      this.ctx.rig.removeEventListener('contextclick', onContext);
      this.ctx.rig.removeEventListener('userinput', onUserInput);
      window.removeEventListener('keydown', onKey);
    });
  }

  /** Hover card text of a company truck: its owner, product and route (building names, else port / edge). */
  private truckCard(t: TruckPick): string {
    const owner = [...this.models.values()].find((m) => m.colorIndex === t.owner);
    const product = useGameStore.getState().catalog?.products.find((p) => p.id === t.productId)?.name ?? humanizeId(t.productId);
    const place = (id: number | null, edge: string) => (id !== null ? this.models.get(id)?.name ?? `Building ${id}` : edge);
    return truckCardHtml({
      owner: t.owner,
      kind: t.kind,
      product,
      from: place(t.from, t.kind === 'import' ? 'World market' : 'Depot'),
      to: place(t.to, t.kind === 'export' ? 'World market' : 'Customers'),
      mine: owner?.isPlayer ?? t.owner === 0,
      ownerName: owner?.ownerName ?? 'Rival',
    });
  }

  private rayFromClient(clientX: number, clientY: number): THREE.Ray {
    this.ctx.ndcFromClient(clientX, clientY, _ndc);
    _ray.setFromCamera(_ndc, this.ctx.camera);
    return _ray.ray;
  }

  /** Building under a client point, or the ground plot. */
  private pickClient(clientX: number, clientY: number) {
    const idx = this.source.getPickIndex();
    const ray = this.rayFromClient(clientX, clientY);
    if (idx && idx.w > 0) return pick(ray, idx);
    const w = this.source.gridW, h = this.source.gridH;
    const g = w > 0 ? pickGround(ray, w, h) : null;
    return g && g.px >= 0 && g.pz >= 0 && g.px < w && g.pz < h ? { kind: 'plot' as const, px: g.px, pz: g.pz, point: g.point } : null;
  }

  private onClick(clientX: number, clientY: number, shift: boolean): void {
    if (this.ghost.active) {
      this.confirmPlacement(shift);
      return;
    }
    const hit = this.pickClient(clientX, clientY);
    const game = useGameStore.getState();
    const truck = hit?.kind === 'building' ? null : pickTruck(this.rayFromClient(clientX, clientY));
    const truckBuilding = truck ? [truck.from, truck.to].find((id) => id !== null && this.models.has(id)) ?? null : null;
    if (hit?.kind === 'building') {
      if (game.selectedBuildingId !== hit.id) uiSound('click');
      game.selectBuilding(hit.id);
    } else if (truckBuilding !== null && truckBuilding !== undefined) {
      // A click on a supply truck selects the building it serves (its source, else its destination).
      if (game.selectedBuildingId !== truckBuilding) uiSound('click');
      game.selectBuilding(truckBuilding);
    } else if (game.selectedBuildingId !== null) {
      game.selectBuilding(null);
    }
  }

  private onDoubleClick(clientX: number, clientY: number): void {
    if (this.ghost.active) return;
    const hit = this.pickClient(clientX, clientY);
    if (hit?.kind === 'building') this.focusBuilding(hit.id);
    else if (hit?.kind === 'plot') void this.ctx.rig.focusOn(hit.point);
  }

  private onContextClick(clientX: number, clientY: number): void {
    const ui = useUiStore.getState();
    if (this.ghost.active) {
      ui.setBuildMode(null);
      return;
    }
    const hit = this.pickClient(clientX, clientY);
    const game = useGameStore.getState();
    if (hit?.kind === 'building') {
      const m = this.models.get(hit.id);
      const id = hit.id;
      const mine = m?.isPlayer ?? false;
      const linksOn = useInteractionStore.getState().linksFor === id;
      ui.openContextMenu({
        x: clientX,
        y: clientY,
        title: m?.name ?? `Building ${id}`,
        subtitle: m ? `${mine ? 'You' : m.ownerName} · ${m.typeName}` : undefined,
        items: [
          { id: 'inspect', label: mine ? 'Inspect' : 'Inspect (read-only)', onSelect: () => game.selectBuilding(id) },
          { id: 'focus', label: 'Focus camera', hint: 'Double-click', onSelect: () => this.focusBuilding(id) },
          { id: 'links', label: linksOn ? 'Hide supply links' : 'Show supply links', onSelect: () => useInteractionStore.getState().showLinksFor(linksOn ? null : id) },
          ...(mine
            ? [
                { kind: 'separator' as const, id: 'sep' },
                { id: 'price', label: 'Set price…', disabled: m?.category !== undefined && !this.isRetail(m), onSelect: () => this.openInspector(id, 'setup') },
                { id: 'advertise', label: 'Advertise here…', onSelect: () => ui.openPanel('marketing', { buildingId: id, cityId: m?.cityId ?? null }) },
                { id: 'upgrade', label: 'Upgrade…', shortcut: 'U', onSelect: () => this.openInspector(id, 'finance') },
                { id: 'demolish', label: 'Sell or demolish…', shortcut: 'Del', danger: true, onSelect: () => this.openInspector(id, 'finance') },
              ]
            : []),
        ],
      });
    } else if (hit?.kind === 'plot') {
      const point = hit.point.clone();
      ui.openContextMenu({
        x: clientX,
        y: clientY,
        title: `Plot ${hit.px}, ${hit.pz}`,
        items: [
          { id: 'center', label: 'Center camera here', onSelect: () => void this.ctx.rig.focusOn(point) },
          { id: 'build', label: 'Build here…', shortcut: 'B', onSelect: () => ui.openPanel('build') },
        ],
      });
    }
  }

  private isRetail(m: BuildingModel): boolean {
    const t = useGameStore.getState().catalog?.buildingTypes.find((x) => x.id === m.typeId);
    return t?.retail ?? false;
  }

  private openInspector(id: number, tab: string): void {
    useGameStore.getState().selectBuilding(id);
    useUiStore.getState().openPanel('inspector', { buildingId: id, tab });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    const ui = useUiStore.getState();
    if (ui.modals.length > 0 || useGameStore.getState().phase !== 'playing') return;
    const bindings = useSettingsStore.getState().controls.bindings;
    const is = (action: string) => chordsFor(action, bindings).some((c) => matchChord(c, e));
    if (this.ghost.active) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) {
        this.ghost.rotate(e.code === 'KeyQ' ? 1 : -1);
        uiSound('tab');
        e.preventDefault();
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        this.confirmPlacement(e.shiftKey);
        e.preventDefault();
        return;
      }
    }
    if (is('city.home')) {
      this.frameHome();
      e.preventDefault();
    } else if (matchChord('Tab', e) || matchChord('Shift+Tab', e) || is('city.cycle')) {
      this.cycleBuildings(e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (is('overlay.cycle') || matchChord('Shift+O', e)) {
      useInteractionStore.getState().cycleOverlay(e.shiftKey ? -1 : 1);
      uiSound('toggle');
      e.preventDefault();
    } else if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      const id = OVERLAY_IDS[i];
      if (id) {
        useInteractionStore.getState().toggleOverlay(id);
        uiSound('toggle');
        e.preventDefault();
      }
    }
  }

  // ----------------------------------------------------------------------------------------- subscriptions

  private installSubscriptions(): void {
    this.cleanups.push(useUiStore.subscribe((s, p) => {
      if (s.buildMode !== p.buildMode) this.onBuildMode();
    }));
    this.cleanups.push(useGameStore.subscribe((s, p) => {
      if (s.activeCityId !== p.activeCityId) {
        if (this.ghost.active) useUiStore.getState().setBuildMode(null);
        useInteractionStore.getState().showLinksFor(null);
        this.viewDirty = true;
      }
      if (s.buildings !== p.buildings || s.snapshot !== p.snapshot || s.revision !== p.revision || s.catalog !== p.catalog || s.activeCityId !== p.activeCityId) {
        this.dataRev++;
        this.ghost.invalidate(s.revision);
      }
      if (s.selectedBuildingId !== p.selectedBuildingId) {
        this.dataRev++;
        const linksFor = useInteractionStore.getState().linksFor;
        if (linksFor !== null && linksFor !== s.selectedBuildingId) useInteractionStore.getState().showLinksFor(null);
      }
      if (s.phase !== p.phase && s.phase !== 'playing') useInteractionStore.getState().reset();
    }));
    this.cleanups.push(useInteractionStore.subscribe((s, p) => {
      if (s.overlay !== p.overlay || s.overlayProductId !== p.overlayProductId || s.linksFor !== p.linksFor) this.dataRev++;
      if (s.ghost?.locked !== p.ghost?.locked && s.ghost && !s.ghost.locked && this.ghost.isLocked) {
        this.ghost.lock(false);                       // the panel released the ghost (Back)
      }
    }));
    this.cleanups.push(useSettingsStore.subscribe((s, p) => {
      if (s.controls !== p.controls) this.applyControls();
      if (s.interface.colourVision !== p.interface.colourVision) this.applyVision();
    }));
    this.cleanups.push(bus.on('locate', (t) => this.onLocate(t)));
    this.cleanups.push(bus.on('worldPopup', (p) => {
      this.pendingPopups.push({ buildingId: p.buildingId, text: p.text, tone: p.tone, delayMs: p.delayMs ?? 0, until: this.now + 3000 });
    }));
    this.cleanups.push(bus.on('gameStarted', () => {
      this.layoutCity = null;
      this.view = null;
      this.viewKey = '';
      this.dataRev++;
    }));
    this.cleanups.push(this.ctx.onQualityChanged(() => this.selection.refresh()));
    this.cleanups.push(this.ctx.onWorldChanged(() => { this.viewDirty = true; this.dataRev++; }));
  }

  private applyControls(): void {
    const c = useSettingsStore.getState().controls;
    this.ctx.rig.edgeScroll = c.edgeScroll;
    this.ctx.rig.setInvertRotate(c.invertRotate);
    this.ctx.rig.setZoomSensitivity(c.zoomSensitivity / 100);
  }

  private applyVision(): void {
    this.badges.setVision(useSettingsStore.getState().interface.colourVision as ColourVisionMode);
  }

  // ------------------------------------------------------------------------------------------- build mode

  private onBuildMode(): void {
    const mode = useUiStore.getState().buildMode;
    const typeId = mode?.typeId ?? null;
    const game = useGameStore.getState();
    const type = typeId ? game.catalog?.buildingTypes.find((t) => t.id === typeId) : undefined;
    const cityId = game.activeCityId;
    const store = useInteractionStore.getState();
    if (type && cityId && this.source.gridW > 0) {
      const wasActive = this.ghost.active;
      this.ghost.start(type, cityId, this.source.gridW, this.source.gridH);
      this.ctx.rig.rotateKeysEnabled = false;
      this.placingDone = false;
      if (!wasActive) {
        this.overlayBeforeBuild = store.overlay;
        if (store.overlay === null) store.setOverlay(autoOverlayFor(type));
      }
      if (this.pointer) this.updateGhostCursor();
      store.setGhost(this.ghost.state());
      this.setHover(null);
      return;
    }
    if (this.ghost.active) {
      const typeIdWas = this.ghost.typeId ?? '';
      this.ghost.stop();
      store.setGhost(null);
      this.labels.setGhostTag(null, null);
      if (!this.placingDone) interactionBus.emit('placementCancelled', { typeId: typeIdWas });
      if (this.overlayBeforeBuild !== undefined) store.setOverlay(this.overlayBeforeBuild);
      this.overlayBeforeBuild = undefined;
    }
    this.pendingConfirm = null;
    this.ctx.rig.rotateKeysEnabled = true;
  }

  private ownAt(anchor: PlotAnchor, w: number, h: number): boolean {
    for (const b of this.source.buildings()) {
      if (!this.models.get(b.id)?.isPlayer) continue;
      if (b.px < anchor.px + w && b.px + b.w > anchor.px && b.pz < anchor.pz + h && b.pz + b.h > anchor.pz) return true;
    }
    return false;
  }

  private confirmPlacement(shift: boolean): void {
    const g = this.ghost.state();
    if (!g || !g.at || g.locked) return;
    if (g.status === 'pending') {
      this.pendingConfirm = { shift, anchor: `${g.at.px},${g.at.pz},${g.at.rotation}` };
      return;
    }
    if (g.status === 'blocked' || g.status === 'own') {
      this.ghost.reject();
      uiSound('placeInvalid');
      interactionBus.emit('placementRejected', { typeId: g.typeId, at: g.at, issue: g.issue, reason: g.reason });
      return;
    }
    const request: PlacementRequest = { typeId: g.typeId, cityId: g.cityId, at: { ...g.at }, preview: g.preview, status: g.status, keepPlacing: shift };
    this.ghost.lock(true);
    useInteractionStore.getState().setGhost(this.ghost.state());
    uiSound('placeOk');
    if (interactionBus.listenerCount('placementConfirmed') > 0) interactionBus.emit('placementConfirmed', request);
    else void this.constructFallback(request);
  }

  /** No build panel listening: construct at the chosen plot ourselves (same side effects as gameStore.construct). */
  private async constructFallback(req: PlacementRequest): Promise<void> {
    const engine = maybeEngine();
    const game = useGameStore.getState();
    if (!engine) return;
    try {
      const building = await engine.call('construct', { typeId: req.typeId, cityId: req.cityId, at: { px: req.at.px, pz: req.at.pz, rotation: req.at.rotation } });
      await useGameStore.getState().syncAfterMutation();
      bus.emit('buildingPlaced', { buildingId: building.id, typeId: req.typeId, cityId: req.cityId });
      const cost = req.preview?.totalCost ?? game.catalog?.buildingTypes.find((t) => t.id === req.typeId)?.constructionCost;
      if (cost) {
        fx.popup({ text: signedMoney(-cost), tone: 'loss', anchor: 'topbar.cash' });
        fx.worldPopup(building.id, signedMoney(-cost), 'loss', -cost);
      }
      useTutorialStore.getState().notifyAction(`construct:${req.typeId}`);
      useTutorialStore.getState().evaluate({ hud: useGameStore.getState().hud, events: [] });
      this.placingDone = true;
      if (req.keepPlacing) {
        this.ghost.lock(false);
        useInteractionStore.getState().setGhost(this.ghost.state());
      } else useUiStore.getState().setBuildMode(null);
    } catch (error) {
      useGameStore.getState().reportError(error);
      this.ghost.lock(false);
      useInteractionStore.getState().setGhost(this.ghost.state());
    }
  }

  private updateGhostCursor(): void {
    const p = this.pointer;
    const w = this.source.gridW, h = this.source.gridH;
    if (!p || w <= 0) {
      this.ghost.setCursor(null, null);
      return;
    }
    const r = this.ctx.canvas.getBoundingClientRect();
    const g = pickGround(this.rayFromClient(p.x + r.left, p.y + r.top), w, h);
    if (!g || g.gx < -1 || g.gz < -1 || g.gx > w + 1 || g.gz > h + 1) this.ghost.setCursor(null, null);
    else this.ghost.setCursor(g.gx, g.gz);
  }

  // ------------------------------------------------------------------------------------------ camera helpers

  private buildingBox(id: number, out: THREE.Box3): THREE.Box3 | null {
    const ref = this.source.getBuilding(id);
    if (!ref) return null;
    return out.set(_v.set(ref.box[0], ref.box[1], ref.box[2]), new THREE.Vector3(ref.box[3], ref.box[4], ref.box[5]));
  }

  focusBuilding(id: number): void {
    const box = this.buildingBox(id, new THREE.Box3());
    if (!box) return;
    box.expandByScalar(18);
    void this.ctx.rig.focus(box);
  }

  private panToPlot(px: number, pz: number, animate: boolean): void {
    const w = this.source.gridW, h = this.source.gridH;
    if (w <= 0) return;
    void this.ctx.rig.focusOn(new THREE.Vector3((px - w / 2) * PLOT_SIZE, 0, (pz - h / 2) * PLOT_SIZE), undefined, animate && !this.ctx.rig.reducedMotion);
  }

  private onLocate(t: { buildingId?: number; cityId?: string }): void {
    const game = useGameStore.getState();
    if (t.buildingId !== undefined) {
      const b = game.buildings.find((x) => x.id === t.buildingId);
      if (b && b.cityId !== game.activeCityId) game.setActiveCity(b.cityId);
      if (this.source.getBuilding(t.buildingId) && (!b || b.cityId === this.source.cityId)) this.focusBuilding(t.buildingId);
      else this.pendingLocate = { buildingId: t.buildingId, until: this.now + 6000 };
      return;
    }
    if (t.cityId) {
      if (t.cityId !== game.activeCityId) game.setActiveCity(t.cityId);
      else void this.ctx.rig.setView({ target: { x: 0, z: 0 }, distance: 0.55 * this.ctx.rig.controls.maxDistance, azimuthDeg: this.ctx.rig.azimuthDeg });
    }
  }

  /** Home: frame your HQ, else your first building in this city, else your first building anywhere. */
  private frameHome(): void {
    const game = useGameStore.getState();
    const playerId = game.snapshot?.playerId ?? null;
    const mine = game.buildings.filter((b) => b.ownerId === playerId).sort((a, b) => a.id - b.id);
    const here = mine.filter((b) => b.cityId === game.activeCityId);
    const pickOne = (list: typeof mine) => list.find((b) => b.category === 'headquarters' || b.typeId === 'headquarters') ?? list[0];
    const target = pickOne(here) ?? pickOne(mine);
    if (target) this.onLocate({ buildingId: target.id });
    else this.onLocate({ cityId: game.activeCityId ?? undefined });
  }

  /** Tab: select and frame the next of your buildings in this city. */
  private cycleBuildings(dir: 1 | -1): void {
    const game = useGameStore.getState();
    const mine = [...this.models.values()].filter((m) => m.isPlayer && this.source.getBuilding(m.id)).sort((a, b) => a.id - b.id);
    if (mine.length === 0) {
      uiSound('error');
      return;
    }
    const i = mine.findIndex((m) => m.id === game.selectedBuildingId);
    const next = mine[(i < 0 ? (dir > 0 ? 0 : mine.length - 1) : i + dir + mine.length) % mine.length];
    game.selectBuilding(next.id);
    this.focusBuilding(next.id);
  }

  // -------------------------------------------------------------------------------------------------- data

  private ensureData(): void {
    const game = useGameStore.getState();
    const cityId = game.activeCityId;
    const engine = maybeEngine();
    if (!cityId || !engine || game.phase !== 'playing') return;
    // Layout (once per city, or from the renderer).
    const provided = this.source.getLayout?.() ?? null;
    if (provided && provided.cityId === cityId) {
      if (this.layout !== provided) { this.layout = provided; this.layoutCity = cityId; this.dataRev++; }
    } else if (this.layoutCity !== cityId && this.layoutLoading !== cityId) {
      this.layoutLoading = cityId;
      engine.callRaw<CityLayoutDto>('cityLayout', { cityId })
        .then((dto) => { if (!this.disposed) { this.layout = decodeLayout(dto); this.layoutCity = cityId; this.dataRev++; } })
        .catch((error: unknown) => { console.warn('[interaction] cityLayout unavailable', error); this.layout = null; this.layoutCity = cityId; })
        .finally(() => { if (this.layoutLoading === cityId) this.layoutLoading = null; });
    }
    // City view (visuals + last month's activity), refreshed per revision.
    const viewKey = `${cityId}@${game.revision}`;
    if (viewKey !== this.viewKey) {
      this.viewKey = viewKey;
      engine.call('cityView', { cityId })
        .then((v) => { if (!this.disposed && v.cityId === useGameStore.getState().activeCityId) { this.view = v; this.dataRev++; } })
        .catch((error: unknown) => console.warn('[interaction] cityView failed', error));
    }
    const ist = useInteractionStore.getState();
    if (ist.overlay === 'links' || ist.linksFor !== null) {
      const key = `${cityId}@${game.revision}`;
      if (key !== this.flowsKey) {
        this.flowsKey = key;
        engine.call('supplyFlows', { cityId })
          .then((f) => { if (!this.disposed) { this.flows = f.flows; this.dataRev++; } })
          .catch((error: unknown) => console.warn('[interaction] supplyFlows failed', error));
      }
    }
    if (ist.overlay === 'share') {
      const productId = ist.overlayProductId ?? this.defaultShareProduct();
      const key = `${cityId}:${productId}@${game.revision}`;
      if (productId && key !== this.marketKey) {
        this.marketKey = key;
        engine.call('marketDetail', { cityId, productId })
          .then((m) => { if (!this.disposed) { this.market = m; this.dataRev++; } })
          .catch((error: unknown) => { console.warn('[interaction] marketDetail failed', error); this.market = null; this.dataRev++; });
      }
    }
  }

  /** Your best-selling product in this city, else the city's largest potential demand. */
  private defaultShareProduct(): string | null {
    const best = new Map<string, number>();
    for (const m of this.models.values()) {
      if (!m.isPlayer || !this.isRetail(m)) continue;
      for (const p of m.products) best.set(p, (best.get(p) ?? 0) + m.unitsSold + 1);
    }
    let top: string | null = null;
    for (const [p, v] of best) if (top === null || v > best.get(top)!) top = p;
    if (top) return top;
    const game = useGameStore.getState();
    const city = game.catalog?.cities.find((c) => c.id === game.activeCityId);
    const demand = Object.entries(city?.potentialDemand ?? {}).sort((a, b) => b[1] - a[1]);
    return demand[0]?.[0] ?? null;
  }

  /** Rebuild models, badges, rings, overlays, arcs and the minimap when inputs changed. */
  private rebuild(): void {
    const game = useGameStore.getState();
    const cityId = game.activeCityId;
    const snapshot = game.snapshot;
    this.cityId = cityId;
    if (!cityId) return;
    this.models = buildModels(cityId, game.buildings, this.view, snapshot?.companies ?? [], game.catalog?.buildingTypes ?? [], snapshot?.playerId ?? null);
    const W = this.source.gridW, H = this.source.gridH;
    const refs = [...this.source.buildings()];
    // Gold rings under your buildings.
    const mineRefs = refs.filter((r) => this.models.get(r.id)?.isPlayer);
    this.rings.set(mineRefs, W, H);
    this.rebuildOverlay(refs, W, H);
    this.publishMinimap(refs, W, H);
    this.refreshSelection();
    this.refreshLandmarks();
  }

  private rebuildOverlay(refs: CityBuildingRef[], W: number, H: number): void {
    const store = useInteractionStore.getState();
    const overlay = store.overlay;
    let bytes: OverlayBytes | null = null;
    const grid = this.layout && this.layout.cityId === this.cityId ? this.layout : null;
    const fp = (r: CityBuildingRef) => ({ id: r.id, px: r.px, pz: r.pz, w: r.w, h: r.h });
    const gridBytes = (b: OverlayBytes): OverlayBytes => (grid && (grid.gridW !== W || grid.gridH !== H) ? { ...b, bytes: resampleBytes(b.bytes, grid.gridW, grid.gridH, W, H) } : b);
    switch (overlay) {
      case 'landValue':
        if (grid) bytes = gridBytes(landValueOverlay(grid));
        break;
      case 'traffic':
        if (grid) bytes = gridBytes(trafficOverlay(grid));
        break;
      case 'zones':
        if (grid) bytes = gridBytes(zonesOverlay(grid));
        break;
      case 'owners':
        bytes = ownersOverlay(W, H, refs.flatMap((r) => {
          const m = this.models.get(r.id);
          return m ? [{ ...fp(r), colorIndex: m.colorIndex, ownerName: m.ownerName, isPlayer: m.isPlayer }] : [];
        }));
        break;
      case 'profit':
        bytes = profitOverlay(W, H, refs.flatMap((r) => {
          const m = this.models.get(r.id);
          return m?.isPlayer ? [{ ...fp(r), netIncome: m.netIncome }] : [];
        }));
        break;
      case 'share': {
        const productId = store.overlayProductId ?? this.defaultShareProduct();
        const name = useGameStore.getState().catalog?.products.find((p) => p.id === productId)?.name ?? productId ?? 'product';
        const shares = new Map<number, number>();
        if (this.market && this.market.productId === productId && this.market.cityId === this.cityId) {
          for (const r of this.market.retailers) shares.set(r.buildingId, (shares.get(r.buildingId) ?? 0) + (r.lastMonthRealisedShare ?? 0));
        }
        bytes = shareOverlay(W, H, refs.flatMap((r) => (shares.get(r.id) ? [{ ...fp(r), share: shares.get(r.id)!, mine: this.models.get(r.id)?.isPlayer ?? false }] : [])), name);
        break;
      }
      default:
        break;
    }
    // Clay mode.
    if (bytes && bytes.bytes.length === W * H && W > 0) this.overlays.show(bytes, W, H);
    else this.overlays.hide();
    // Arcs (Links overlay = all flows; "Show supply links" = one building's).
    const linksFor = store.linksFor;
    if (overlay === 'links' || linksFor !== null) {
      const arcs = arcsForFlows(this.flows, this.cityId ?? '', (id) => {
        const ref = this.source.getBuilding(id);
        const m = this.models.get(id);
        if (!ref) return null;
        return { roof: { x: (ref.box[0] + ref.box[3]) / 2, y: ref.box[4] + 2, z: (ref.box[2] + ref.box[5]) / 2 }, colorIndex: m?.colorIndex ?? 7 };
      }, (W * PLOT_SIZE) / 2, (H * PLOT_SIZE) / 2, overlay === 'links' ? null : linksFor, 200, overlay === 'links' ? (id) => this.models.get(id)?.isPlayer ?? false : null);
      this.arcs.set(arcs);
    } else this.arcs.set([]);
    // Legend.
    let legend = bytes?.legend ?? null;
    if (overlay === 'links') legend = linksLegend(this.arcs.count);
    else if (overlay && !bytes) legend = { overlay, title: overlay === 'landValue' ? 'Land value' : overlay === 'traffic' ? 'Traffic' : 'Zones', kind: 'ramp', colors: [], labels: [], empty: this.layoutLoading ? 'Loading city data…' : 'City data unavailable' };
    store.setLegend(legend);
    this.minimapOverlay = bytes ? { bytes: bytes.bytes, mode: bytes.mode, palette: bytes.palette } : null;
  }

  private minimapOverlay: MinimapOverlay | null = null;

  private publishMinimap(refs: CityBuildingRef[], W: number, H: number): void {
    if (W <= 0 || !this.cityId) return;
    const grid = this.layout && this.layout.cityId === this.cityId && this.layout.gridW === W && this.layout.gridH === H ? this.layout : null;
    const buildings: MinimapBuilding[] = refs.flatMap((r) => {
      const m = this.models.get(r.id);
      return m ? [{ id: r.id, px: r.px, pz: r.pz, w: r.w, h: r.h, color: ownerColor(m.colorIndex), mine: m.isPlayer }] : [];
    });
    useInteractionStore.getState().setMinimap({ cityId: this.cityId, gridW: W, gridH: H, base: minimapBase(W, H, grid, this.minimapOverlay), buildings, rev: ++this.minimapRev });
    this.viewDirty = true;
  }

  private refreshLandmarks(): void {
    // Landmark names only when the layout is the rendered one (the renderer provided it).
    const grid = this.source.getLayout?.() ?? null;
    if (!grid || grid.cityId !== this.cityId) {
      this.labels.setLandmarks([]);
      return;
    }
    const W = grid.gridW, H = grid.gridH;
    const at = (px: number, pz: number) => new THREE.Vector3((px - W / 2) * PLOT_SIZE, 30, (pz - H / 2) * PLOT_SIZE);
    const list: LandmarkLabel[] = grid.landmarks
      .filter((l) => LANDMARK_NAMES[l.kind])
      .map((l) => ({ text: LANDMARK_NAMES[l.kind], world: at(l.px + l.w / 2, l.pz + l.h / 2) }));
    if (grid.cbd) list.unshift({ text: 'Downtown', world: at(grid.cbd.x, grid.cbd.z).setY(140), cbd: true });
    this.labels.setLandmarks(list);
  }

  // ---------------------------------------------------------------------------------------- hover/selection

  private setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.hoverSince = this.now;
    this.labels.setHoverCard(null);
    useInteractionStore.getState().setHovered(id);
    if (id !== null) uiSound('hover');
    this.refreshSelection();
  }

  private objectFor(id: number | null): THREE.Object3D | null {
    if (id === null) return null;
    const own = this.source.getBuildingObject?.(id);
    if (own) return own;
    const ref = this.source.getBuilding(id);
    return ref ? boxProxy(ref) : null;
  }

  private selectedObj: { id: number | null; obj: THREE.Object3D | null } = { id: null, obj: null };
  private hoverObj: { id: number | null; obj: THREE.Object3D | null } = { id: null, obj: null };

  private refreshSelection(): void {
    const sel = useGameStore.getState().selectedBuildingId;
    const selRef = sel !== null ? this.source.getBuilding(sel) : null;
    const selId = selRef ? sel : null;
    if (this.selectedObj.id !== selId || (selId !== null && this.selectedObj.obj?.parent === null && !this.selectedObj.obj?.userData.w6Proxy)) {
      this.selectedObj = { id: selId, obj: this.objectFor(selId) };
    }
    const hov = this.hoverId !== null && this.hoverId !== selId ? this.hoverId : null;
    if (this.hoverObj.id !== hov) this.hoverObj = { id: hov, obj: this.objectFor(hov) };
    this.selection.set(this.hoverObj.obj, this.selectedObj.obj);
    const W = this.source.gridW, H = this.source.gridH;
    this.selection.setRing(selRef ? footprintRect(selRef.px, selRef.pz, selRef.w, selRef.h, W, H) : null);
    const m = selId !== null ? this.models.get(selId) : undefined;
    if (selRef && m) {
      this.labels.setSelectionTag(selectionTagHtml(m), new THREE.Vector3((selRef.box[0] + selRef.box[3]) / 2, selRef.box[4] + 6, (selRef.box[2] + selRef.box[5]) / 2));
    } else this.labels.setSelectionTag(null, null);
  }

  // --------------------------------------------------------------------------------------------- per frame

  update(frame: FrameInfo): void {
    this.now += frame.dt * 1000;
    const nowMs = performance.now();
    if (!this.provided) this.fallback.refresh(nowMs, this.pendingPopups.length > 0 || this.pendingLocate !== null);
    if (this.source.cityId !== null && this.ghost.active === false && useUiStore.getState().buildMode?.typeId && this.source.gridW > 0) this.onBuildMode();
    this.ensureData();
    if (this.source.revision !== this.sourceRev) {
      this.sourceRev = this.source.revision;
      this.dataRev++;
      this.selectedObj = { id: null, obj: null };
      this.hoverObj = { id: null, obj: null };
    }
    if (this.dataRev !== this.builtRev) {
      this.builtRev = this.dataRev;
      this.rebuild();
    }

    // Hover (one pick per frame, only when the pointer or the camera moved).
    const dragging = this.ctx.rig.dragging;
    if (this.ghost.active) {
      if (this.pointerDirty || frame.cameraMoved) this.updateGhostCursor();
    } else if ((this.pointerDirty || frame.cameraMoved) && !dragging) {
      const p = this.pointer;
      const hit = p ? this.pickClient(p.x + this.canvasLeft(), p.y + this.canvasTop()) : null;
      if (hit?.kind === 'building') this.hoverPoint.copy(hit.point);
      this.setHover(hit?.kind === 'building' ? hit.id : null);
      this.hoverTruck = p && hit?.kind !== 'building' ? pickTruck(this.rayFromClient(p.x + this.canvasLeft(), p.y + this.canvasTop())) : null;
    }
    this.pointerDirty = false;
    const menuOpen = useUiStore.getState().contextMenu !== null;
    if (this.hoverId !== null && this.pointer && !dragging && !menuOpen && this.now - this.hoverSince >= HOVER_CARD_DELAY_MS) {
      const m = this.models.get(this.hoverId);
      this.labels.setHoverCard(m ? hoverCardHtml(m) : null, this.pointer.x, this.pointer.y);
    } else if (this.hoverTruck && this.hoverId === null && this.pointer && !dragging && !menuOpen) {
      this.labels.setHoverCard(this.truckCard(this.hoverTruck), this.pointer.x, this.pointer.y);
    } else if (this.hoverId === null || dragging || menuOpen) this.labels.setHoverCard(null);

    // Ghost.
    if (this.ghost.active) {
      const changed = this.ghost.update(frame.dt, nowMs, frame.cameraDistance, this.ctx.rig.reducedMotion);
      const g = this.ghost.state();
      if (changed) useInteractionStore.getState().setGhost(g);
      if (this.pendingConfirm && g?.at) {
        if (`${g.at.px},${g.at.pz},${g.at.rotation}` !== this.pendingConfirm.anchor) this.pendingConfirm = null;
        else if (g.status !== 'pending') {
          const shift = this.pendingConfirm.shift;
          this.pendingConfirm = null;
          this.confirmPlacement(shift);
        }
      }
      const tag = this.ghost.tagPoint(_v);
      const type = useGameStore.getState().catalog?.buildingTypes.find((t) => t.id === g?.typeId);
      this.labels.setGhostTag(g && tag ? ghostTagHtml(g, type?.name ?? this.ghost.typeName) : null, tag, g ? ghostColor(g.status) : '');
    }

    // World popups waiting for their building.
    for (let i = this.pendingPopups.length - 1; i >= 0; i--) {
      const p = this.pendingPopups[i];
      const ref = this.source.getBuilding(p.buildingId);
      if (ref) {
        this.labels.popup(new THREE.Vector3((ref.box[0] + ref.box[3]) / 2, ref.box[4] + 6, (ref.box[2] + ref.box[5]) / 2), p.text, p.tone, p.delayMs);
        this.pendingPopups.splice(i, 1);
      } else if (this.now > p.until) this.pendingPopups.splice(i, 1);
    }
    if (this.pendingLocate) {
      if (this.source.getBuilding(this.pendingLocate.buildingId) && this.source.cityId === useGameStore.getState().activeCityId) {
        this.focusBuilding(this.pendingLocate.buildingId);
        this.pendingLocate = null;
      } else if (this.now > this.pendingLocate.until) this.pendingLocate = null;
    }

    // Badges: your buildings at district/city zoom; rival emblem on hover (all rivals in the Owners overlay).
    this.updateBadges(frame);
    this.rings.update(frame.cameraDistance);
    this.selection.update(frame.dt, frame.cameraDistance, this.ctx.rig.reducedMotion);
    this.arcs.update(frame.dt, this.width, this.height, this.ctx.rig.reducedMotion);
    this.overlays.update(frame.dt, this.ctx.rig.reducedMotion);
    this.labels.update(this.ctx.camera, frame.dt, frame.zoom01, this.ctx.rig.reducedMotion);

    // Minimap camera footprint (≤ 10 Hz).
    if ((frame.cameraMoved || this.viewDirty) && nowMs - this.lastViewPublish >= MINIMAP_VIEW_INTERVAL_MS) {
      this.lastViewPublish = nowMs;
      this.viewDirty = false;
      this.publishView(frame.target);
    }
  }

  private canvasLeft(): number {
    return this.ctx.canvas.getBoundingClientRect().left;
  }

  private canvasTop(): number {
    return this.ctx.canvas.getBoundingClientRect().top;
  }

  private updateBadges(frame: FrameInfo): void {
    const showStatus = frame.cameraDistance >= 300 && !this.ghost.active;
    const ownersOverlay = useInteractionStore.getState().overlay === 'owners';
    const list: BadgeInstance[] = [];
    for (const ref of this.source.buildings()) {
      const m = this.models.get(ref.id);
      if (!m) continue;
      const x = (ref.box[0] + ref.box[3]) / 2, z = (ref.box[2] + ref.box[5]) / 2, y = ref.box[4] + 6;
      if (m.isPlayer) {
        if (showStatus && m.statusClass !== 'neutral') list.push({ x, y, z, tile: TILE_OF_STATUS[m.statusClass] });
      } else if (ref.id === this.hoverId || ownersOverlay) {
        list.push({ x, y, z, tile: EMBLEM_TILE0 + Math.max(0, Math.min(7, m.colorIndex)), scale: ref.id === this.hoverId ? 1 : 0.8 });
      }
    }
    this.badges.set(list);
  }

  private publishView(target: THREE.Vector3): void {
    const W = this.source.gridW, H = this.source.gridH;
    if (W <= 0) return;
    const cam = this.ctx.camera;
    const corners: [number, number][] = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      _ndc.set(x, y);
      _ray.setFromCamera(_ndc, cam);
      const hit = _ray.ray.intersectPlane(_plane, _v);
      const p = hit ?? _ray.ray.at(6000, _v).setY(0);
      corners.push([p.x / PLOT_SIZE + W / 2, p.z / PLOT_SIZE + H / 2]);
    }
    useInteractionStore.getState().setMinimapView({ corners, target: [target.x / PLOT_SIZE + W / 2, target.z / PLOT_SIZE + H / 2] });
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.labels.resize(width, height);
    this.badges.resize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    for (const fn of this.cleanups.splice(0)) fn();
    const store = useInteractionStore.getState();
    store.setSceneApi(null);
    store.setGhost(null);
    store.setMinimap(null);
    store.setMinimapView(null);
    store.setLegend(null);
    store.setHovered(null);
    this.ctx.rig.rotateKeysEnabled = true;
    this.ctx.rig.setNudge(0, 0, 0);
    delete (window as unknown as { __magnateInteraction?: unknown }).__magnateInteraction;
    this.selection.dispose();
    this.ghost.dispose();
    this.badges.dispose();
    this.rings.dispose();
    this.arcs.dispose();
    this.overlays.dispose();
    this.labels.dispose();
  }
}
