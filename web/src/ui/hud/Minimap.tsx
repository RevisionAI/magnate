// Minimap (UX §6.3, §6.20; W6): the active city from the engine layout — districts, roads, water, company footprints
// in owner colours with the gold ring on yours — plus the camera's ground footprint. Click a building to select and
// frame it; click or drag anywhere else to move the camera. Below the map, the overlay bar (O / Shift+1…7) and, above
// it, the active overlay's legend. The model is published by the interaction scene module (scene/interaction).

import { CircleDollarSign, Car, ChevronLeft, ChevronRight, LayoutGrid, PieChart, TrendingUp, Users, Waypoints } from 'lucide-react';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useGameStore } from '@/state/gameStore';
import { IconButton, Tooltip } from '@/ui/components';
import { buildingAt, canvasToPlot, MinimapRenderer, type MinimapFit } from '@/scene/interaction/MinimapRenderer';
import { OVERLAY_IDS, OVERLAY_LABELS, useInteractionStore, type OverlayId, type OverlayLegend } from '@/scene/interaction/interactionStore';
import styles from './Minimap.module.css';
import mm from '@/scene/interaction/MinimapHud.module.css';

const OVERLAY_ICONS: Record<OverlayId, ReactNode> = {
  landValue: <CircleDollarSign size={14} />,
  traffic: <Car size={14} />,
  zones: <LayoutGrid size={14} />,
  owners: <Users size={14} />,
  profit: <TrendingUp size={14} />,
  share: <PieChart size={14} />,
  links: <Waypoints size={14} />,
};

const OVERLAY_HELP: Record<OverlayId, string> = {
  landValue: 'Plot prices in five bands — cheap land on the edge, premium downtown.',
  traffic: 'Customer footfall per plot. Shops do best on busy plots.',
  zones: 'What may be built where: downtown, commercial, housing, industry, port, farmland.',
  owners: 'Every company building in its owner’s colour.',
  profit: 'Your buildings, red to green by last month’s net income.',
  share: 'Each store’s share of last month’s sales of a product, spread over its catchment.',
  links: 'Animated arcs for last month’s supply flows between buildings, imports and exports.',
};

function Legend({ legend }: { legend: OverlayLegend }) {
  return (
    <div className={mm.legend} data-testid="overlay-legend">
      <div className={mm.legendHead}>
        <span className={mm.legendTitle}>{legend.title}</span>
        {legend.subtitle && <span className={mm.legendSub}>{legend.subtitle}</span>}
      </div>
      {legend.empty ? (
        <div className={mm.legendEmpty}>{legend.empty}</div>
      ) : legend.kind === 'ramp' ? (
        <>
          <div className={mm.ramp} style={{ background: `linear-gradient(90deg, ${legend.colors.join(', ')})` }} />
          <div className={mm.rampLabels}>
            <span>{legend.labels[0]}</span>
            <span>{legend.labels[legend.labels.length - 1]}</span>
          </div>
        </>
      ) : legend.kind === 'bins' ? (
        <div className={mm.bins}>
          {legend.colors.map((c, i) => (
            <span key={c + i} className={mm.bin}>
              <i style={{ background: c }} />
              {legend.labels[i]}
            </span>
          ))}
        </div>
      ) : (
        <div className={mm.cats}>
          {legend.colors.map((c, i) => (
            <span key={c + i} className={mm.cat}>
              <i style={{ background: c }} />
              {legend.labels[i]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Minimap() {
  const catalog = useGameStore((s) => s.catalog);
  const cityId = useGameStore((s) => s.activeCityId);
  const setActiveCity = useGameStore((s) => s.setActiveCity);
  const overlay = useInteractionStore((s) => s.overlay);
  const legend = useInteractionStore((s) => s.overlayLegend);
  const model = useInteractionStore((s) => s.minimap);
  const toggleOverlay = useInteractionStore((s) => s.toggleOverlay);
  const cities = catalog?.cities ?? [];
  const city = cities.find((c) => c.id === cityId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fitRef = useRef<MinimapFit | null>(null);
  const rendererRef = useRef(new MinimapRenderer());
  const dragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const [hot, setHot] = useState(false);

  // Draw on any change of the model, the camera footprint, the selection or the hover (coalesced per frame).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cssW = 0, cssH = 0;
    const draw = () => {
      raf = 0;
      const g = canvas.getContext('2d');
      if (!g) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      if (rect.width !== cssW || rect.height !== cssH) {
        cssW = rect.width;
        cssH = rect.height;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = useInteractionStore.getState();
      fitRef.current = rendererRef.current.draw(g, cssW, cssH, s.minimap, s.minimapView, useGameStore.getState().selectedBuildingId, s.hoveredBuildingId);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const offA = useInteractionStore.subscribe((s, p) => {
      if (s.minimap !== p.minimap || s.minimapView !== p.minimapView || s.hoveredBuildingId !== p.hoveredBuildingId) schedule();
    });
    const offB = useGameStore.subscribe((s, p) => {
      if (s.selectedBuildingId !== p.selectedBuildingId) schedule();
    });
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    return () => {
      offA();
      offB();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const toPlot = useCallback((e: { clientX: number; clientY: number }): [number, number] | null => {
    const canvas = canvasRef.current, fit = fitRef.current;
    if (!canvas || !fit) return null;
    const r = canvas.getBoundingClientRect();
    return canvasToPlot(fit, e.clientX - r.left, e.clientY - r.top);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = toPlot(e);
    const s = useInteractionStore.getState();
    if (!p || !s.minimap || !s.scene) return;
    const hit = buildingAt(s.minimap.buildings, p[0], p[1]);
    if (hit) {
      useGameStore.getState().selectBuilding(hit.id);
      s.scene.focusBuilding(hit.id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, moved: false };
    s.scene.panToPlot(p[0], p[1], true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPlot(e);
    const s = useInteractionStore.getState();
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      drag.moved = true;
      if (p) s.scene?.panToPlot(p[0], p[1], false);
      return;
    }
    const over = !!(p && s.minimap && buildingAt(s.minimap.buildings, p[0], p[1]));
    if (over !== hot) setHot(over);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const step = (dir: 1 | -1) => {
    if (cities.length === 0) return;
    const i = Math.max(0, cities.findIndex((c) => c.id === cityId));
    const next = cities[(i + dir + cities.length) % cities.length];
    if (next) setActiveCity(next.id);
  };

  const gw = city?.gridWidth ?? model?.gridW ?? 0;
  const gh = city?.gridHeight ?? model?.gridH ?? 0;
  const count = model?.buildings.length ?? 0;
  const mine = model?.buildings.filter((b) => b.mine).length ?? 0;

  return (
    <section className={styles.minimap} aria-label="Minimap" data-testid="minimap">
      {overlay && legend && legend.overlay === overlay && <Legend legend={legend} />}
      <div className={styles.head}>
        <IconButton size="sm" label="Previous city" kbd="BracketLeft" icon={<ChevronLeft size={14} />} onClick={() => step(-1)} />
        <Tooltip
          title={city?.name ?? 'City'}
          content={city ? `${(city.population / 1000).toFixed(0)}K residents · ${gw}×${gh} plots · ${count} company building${count === 1 ? '' : 's'}, ${mine} yours` : undefined}
          side="top"
          block
        >
          <span className={styles.city} data-testid="minimap-city">
            {city?.name ?? '—'}
          </span>
        </Tooltip>
        <IconButton size="sm" label="Next city" kbd="BracketRight" icon={<ChevronRight size={14} />} onClick={() => step(1)} />
      </div>
      <div className={clsx(styles.map, mm.mapArea)}>
        <canvas
          ref={canvasRef}
          className={clsx(mm.canvas, hot && mm.canvasHot)}
          role="img"
          aria-label={`Map of ${city?.name ?? 'the city'}`}
          data-testid="minimap-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHot(false)}
        />
        {!model && <div className={mm.empty}>Surveying the city…</div>}
      </div>
      <div className={mm.bar} role="toolbar" aria-label="Map overlays">
        {OVERLAY_IDS.map((id, i) => (
          <IconButton
            key={id}
            size="sm"
            label={OVERLAY_LABELS[id]}
            description={OVERLAY_HELP[id]}
            kbd={`Shift+${i + 1}`}
            tooltipSide="top"
            icon={OVERLAY_ICONS[id]}
            pressed={overlay === id}
            sound="toggle"
            data-testid={`overlay-${id}`}
            onClick={() => toggleOverlay(id)}
          />
        ))}
      </div>
    </section>
  );
}
