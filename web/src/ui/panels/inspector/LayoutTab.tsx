// Layout (UX §6.7.2): the CapLab-style unit grid. INPUTS on top feed the
// PROCESSING grid (3 columns, the next level's cells shown locked), which feeds
// the OUTPUT band below. Links are drawn as pipes through the grid gutters,
// width ∝ monthly volume, dashed when starved (< 90 % of need or an emptied
// shelf). Click (or Enter) a unit to configure it; arrow keys move between cells.

import clsx from 'clsx';
import { ArrowDown, Globe, Lock, Plus, ShoppingCart, Ship, Truck, Warehouse } from 'lucide-react';
import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { BuildingDetailDto, ProductDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { Tooltip } from '@/ui/components';
import { money, percent, price as fmtPrice } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useCatalogIndex } from '../_shared-a/catalog';
import { Notice, ProductGlyph } from '../_shared-a/pieces';
import { GRID_COLUMNS, bandPlacement, linkWidth, unitCells, unitFlow, type BandPlacement, type FlowNode, type NodeTone, type UnitCell } from '../_shared-a/unitGrid';
import type { InspectorTab } from './inspectorModel';
import styles from './Inspector.module.css';

const NODE_ICON: Record<NodeTone, ReactNode> = {
  own: <Truck size={13} />,
  world: <Globe size={13} />,
  shoppers: <ShoppingCart size={13} />,
  export: <Ship size={13} />,
  stock: <Warehouse size={13} />,
  transfer: <Truck size={13} />,
};

const TONE_STROKE: Record<NodeTone, string> = {
  own: 'var(--owner-0)',
  world: 'var(--c-muted)',
  shoppers: 'var(--c-gold)',
  export: 'var(--c-teal)',
  stock: 'var(--c-dim)',
  transfer: 'var(--owner-0)',
};

interface Path {
  id: string;
  d: string;
  width: number;
  color: string;
  dashed: boolean;
}

export function LayoutTab({ detail: d, go }: { detail: BuildingDetailDto; go: (tab: InspectorTab, slotIndex?: number) => void }) {
  const idx = useCatalogIndex();
  const buildings = useGameStore((s) => s.buildings);
  const type = idx.types.get(d.typeId);
  const cells = useMemo(() => unitCells(d, type?.levels ?? []), [d, type]);
  const buildingLabel = useCallback(
    (id: number) => {
      const b = buildings.find((x) => x.id === id);
      return b ? `${b.name}${b.cityId !== d.cityId ? ` (${idx.cityName(b.cityId)})` : ''}` : `building #${id}`;
    },
    [buildings, d.cityId, idx],
  );
  const flow = useMemo(() => unitFlow(d, { productName: idx.productName, buildingLabel }), [d, idx, buildingLabel]);
  const inBand = useMemo(() => bandPlacement(flow.inputs, flow.links.filter((l) => l.side === 'input')), [flow]);
  const outBand = useMemo(() => bandPlacement(flow.outputs, flow.links.filter((l) => l.side === 'output')), [flow]);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const cellRefs = useRef(new Map<number, HTMLElement>());
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rb = root.getBoundingClientRect();
    const rel = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - rb.left, right: r.right - rb.left, top: r.top - rb.top, bottom: r.bottom - rb.top, cx: r.left - rb.left + r.width / 2, cy: r.top - rb.top + r.height / 2 };
    };
    const firstCell = cellRefs.current.get(0);
    const lastCell = cellRefs.current.get(cells.length - 1);
    if (!firstCell || !lastCell) return;
    const gridTop = rel(firstCell).top;
    const gridBottom = rel(lastCell).bottom;
    const gap = 14;
    const out: Path[] = [];
    for (const link of flow.links) {
      const nodeEl = nodeRefs.current.get(link.nodeId);
      const cellEl = cellRefs.current.get(link.cellIndex);
      const node = flow.inputs.find((n) => n.id === link.nodeId) ?? flow.outputs.find((n) => n.id === link.nodeId);
      if (!nodeEl || !cellEl || !node) continue;
      const n = rel(nodeEl);
      const c = rel(cellEl);
      const width = linkWidth(link.volume, flow.maxVolume);
      const firstRow = link.cellIndex < GRID_COLUMNS;
      if (link.side === 'input' && firstRow && n.cx > c.left + 8 && n.cx < c.right - 8) {
        // Node sits right above its unit: a straight drop into the top edge.
        out.push({ id: link.id, d: `M ${n.cx} ${n.bottom} L ${n.cx} ${c.top + 2}`, width, color: TONE_STROKE[node.tone], dashed: link.starved });
      } else if (link.side === 'input') {
        const gx = c.left - gap / 2;
        const y0 = n.bottom;
        const ya = gridTop - gap / 2;
        out.push({ id: link.id, d: `M ${n.cx} ${y0} C ${n.cx} ${(y0 + ya) / 2}, ${gx} ${(y0 + ya) / 2}, ${gx} ${ya} L ${gx} ${c.cy} L ${c.left + 2} ${c.cy}`, width, color: TONE_STROKE[node.tone], dashed: link.starved });
      } else {
        const gx = c.right + gap / 2;
        const yb = gridBottom + gap / 2;
        const y1 = n.top;
        out.push({ id: link.id, d: `M ${c.right - 2} ${c.cy} L ${gx} ${c.cy} L ${gx} ${yb} C ${gx} ${(yb + y1) / 2}, ${n.cx} ${(yb + y1) / 2}, ${n.cx} ${y1 - 3}`, width, color: TONE_STROKE[node.tone], dashed: link.starved });
      }
    }
    setPaths(out);
    setSize({ w: rb.width, h: rb.height });
  }, [cells.length, flow]);

  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.cell);
    if (!Number.isFinite(current)) return;
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? GRID_COLUMNS : e.key === 'ArrowUp' ? -GRID_COLUMNS : 0;
    if (!delta) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(cells.length - 1, current + delta));
    cellRefs.current.get(next)?.focus();
  };

  if (d.slotKind === 'none') {
    return (
      <div className={styles.tab}>
        <Notice tone="info">This building has no units. {type?.mediaChannel ? `Owning it makes your ${type.mediaChannel} advertising cheaper and stronger.` : ''}</Notice>
      </div>
    );
  }

  const openCell = (cell: UnitCell) => {
    if (!d.isPlayer || cell.state === 'void') return;
    if (cell.state === 'locked') go('finance');
    else go('setup', cell.index);
  };

  return (
    <div className={styles.tab}>
      <div className={styles.layout} ref={rootRef} data-testid="inspector-layout">
        <svg className={styles.pipes} width={size.w} height={size.h} viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`} aria-hidden>
          <defs>
            {(['own', 'world', 'shoppers', 'export', 'stock', 'transfer'] as NodeTone[]).map((t) => (
              <marker key={t} id={`arrow-${t}`} viewBox="0 0 8 8" refX="6" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={TONE_STROKE[t]} />
              </marker>
            ))}
          </defs>
          {paths.map((p) => (
            <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dashed ? '5 5' : undefined} opacity={0.85} markerEnd={`url(#arrow-${toneOf(p.color)})`} />
          ))}
        </svg>

        <div className={styles.processingLabel}>
          <span>
            {d.slotKind === 'retail' ? 'Sales floor' : d.slotKind === 'research' ? 'Research units' : d.slotKind === 'warehouse' ? 'Storage' : 'Processing'} · Lv {d.level}
          </span>
          <span className={styles.dim}>
            {d.slotsUsed}/{d.capacity} units in use
          </span>
        </div>

        {d.slotKind !== 'extraction' && d.slotKind !== 'research' && (
          <Band label={d.slotKind === 'retail' ? 'Supply · where the shelves restock from' : 'Inputs · purchasing'} empty={flow.inputs.length === 0 ? 'Nothing to buy yet' : null}>
            <BandNodes placement={inBand} nodeRefs={nodeRefs.current} products={idx.products} />
          </Band>
        )}

        <div className={styles.unitGrid} role="grid" aria-label="Units" onKeyDown={onGridKey}>
          {cells.map((cell) => (
            <CellCard key={cell.index} cell={cell} detail={d} ref={(el) => setRef(cellRefs.current, cell.index, el)} onOpen={() => openCell(cell)} product={cell.slot ? idx.products.get(cell.slot.productId) : undefined} />
          ))}
        </div>

        {d.slotKind !== 'research' && (
          <Band label={d.slotKind === 'retail' ? 'Sales · shoppers' : 'Output · where it goes'} empty={flow.outputs.length === 0 ? 'No output yet' : null} below>
            <BandNodes placement={outBand} nodeRefs={nodeRefs.current} products={idx.products} />
          </Band>
        )}
      </div>
      {flow.links.length > 0 && (
        <div className={styles.legend}>
        <span>
          <i className={styles.legendSolid} style={{ background: 'var(--owner-0)' }} /> own supply
        </span>
        <span>
          <i className={styles.legendSolid} style={{ background: 'var(--c-muted)' }} /> world market
        </span>
        {d.slotKind === 'retail' ? (
          <span>
            <i className={styles.legendSolid} style={{ background: 'var(--c-gold)' }} /> sales
          </span>
        ) : (
          <span>
            <i className={styles.legendSolid} style={{ background: 'var(--c-teal)' }} /> export
          </span>
        )}
        <span>
          <i className={styles.legendDashed} /> starved / sold out
        </span>
        <span>width = monthly volume</span>
      </div>
      )}
    </div>
  );
}

function toneOf(color: string): NodeTone {
  return (Object.entries(TONE_STROKE).find(([, c]) => c === color)?.[0] as NodeTone | undefined) ?? 'world';
}

function setRef<K>(map: Map<K, HTMLElement>, key: K, el: HTMLElement | null) {
  if (el) map.set(key, el);
  else map.delete(key);
}

function Band({ label, children, empty, below }: { label: string; children: ReactNode; empty: string | null; below?: boolean }) {
  return (
    <div className={clsx(styles.band, below && styles.bandBelow)}>
      {!below && <div className={styles.bandLabel}>{label}</div>}
      {empty ? <span className={styles.bandEmpty}>{empty}</span> : children}
      {below && (
        <div className={styles.bandLabel}>
          <ArrowDown size={11} />
          {label}
        </div>
      )}
    </div>
  );
}

function BandNodes({ placement, nodeRefs, products }: { placement: BandPlacement; nodeRefs: Map<string, HTMLElement>; products: ReadonlyMap<string, ProductDto> }) {
  const compactNodes = placement.columns >= GRID_COLUMNS;
  return (
    <div className={clsx(styles.bandNodes, placement.aligned && styles.bandAligned)} style={{ gridTemplateColumns: `repeat(${placement.columns}, minmax(0, 1fr))` }}>
      {placement.slots.map(({ node, column }) => (
        <NodeCard key={node.id} node={node} compact={compactNodes} column={column} ref={(el) => setRef(nodeRefs, node.id, el)} product={products.get(node.productId)} />
      ))}
    </div>
  );
}

const NodeCard = forwardRef<HTMLDivElement, { node: FlowNode; product: ProductDto | undefined; compact?: boolean; column?: number }>(function NodeCard({ node, product, compact: small, column }, ref) {
  const volume = node.volumeIsMoney ? `${money(node.volume)}/mo` : `${compact(node.volume)}/mo`;
  return (
    <Tooltip title={node.title} content={`${node.detail}${node.warning ? ` · ${node.warning}` : ''} · ${volume}`} side={node.side === 'input' ? 'top' : 'bottom'}>
      <div ref={ref} className={clsx(styles.node, styles[`node-${node.tone}`], node.starved && styles.nodeStarved, small && styles.nodeCompact)} style={column ? { gridColumn: column } : undefined}>
        <span className={styles.nodeIcon}>{NODE_ICON[node.tone]}</span>
        <span className={styles.nodeBody}>
          <span className={styles.nodeTitle}>
            {node.side === 'input' && <ProductGlyph product={product} size="sm" />}
            {node.title}
          </span>
          <span className={styles.nodeDetail}>{node.warning ?? node.detail}</span>
        </span>
        <span className={styles.nodeVolume}>{volume}</span>
      </div>
    </Tooltip>
  );
});

const CellCard = forwardRef<HTMLButtonElement, { cell: UnitCell; detail: BuildingDetailDto; product: ProductDto | undefined; onOpen: () => void }>(function CellCard({ cell, detail, product, onOpen }, ref) {
  if (cell.state === 'void') return <span className={styles.cellVoid} ref={ref as never} aria-hidden />;
  if (cell.state === 'locked') {
    return (
      <button ref={ref} type="button" className={clsx(styles.cell, styles.cellLocked)} onClick={onOpen} data-cell={cell.index} disabled={!detail.isPlayer} title={`Unlocks at level ${cell.unlockLevel}`}>
        <Lock size={14} />
        <span className={styles.cellSmall}>Lv {cell.unlockLevel}</span>
      </button>
    );
  }
  if (cell.state === 'free') {
    return (
      <button ref={ref} type="button" className={clsx(styles.cell, styles.cellFree)} onClick={onOpen} data-cell={cell.index} disabled={!detail.isPlayer} data-testid={`layout-cell-${cell.index}`}>
        <Plus size={16} />
        <span className={styles.cellSmall}>{detail.isPlayer ? 'Add' : 'Empty'}</span>
      </button>
    );
  }
  const s = cell.slot!;
  let metric = '';
  let fill: number | null = null;
  let warn = false;
  if (s.retail) {
    metric = fmtPrice(s.retail.price);
    const f = s.retail.lastMonthDemand ?? s.retail.modelDemandUnits;
    fill = f > 0 ? Math.min(1, s.retail.lastMonthUnits / f) : null;
    warn = s.retail.belowCost;
  } else if (s.production) {
    metric = s.production.utilization !== undefined ? percent(s.production.utilization, 0) : `${compact(s.production.outputPerMonth)}/mo`;
    fill = s.production.utilization ?? null;
    warn = (s.production.utilization ?? 1) < 0.9;
  } else if (s.extraction) {
    metric = `${compact(s.extraction.yieldPerMonth)}/mo`;
  } else if (s.warehouse) {
    metric = `${compact(s.warehouse.onHand)}`;
    fill = s.warehouse.targetStock > 0 ? Math.min(1, s.warehouse.onHand / s.warehouse.targetStock) : null;
  } else if (s.research) {
    metric = `Tech ${s.research.tech}`;
    fill = s.research.threshold > 0 ? Math.min(1, s.research.progress / s.research.threshold) : null;
    warn = s.research.blocked;
  }
  return (
    <button ref={ref} type="button" className={clsx(styles.cell, styles.cellUsed, warn && styles.cellWarn)} onClick={onOpen} data-cell={cell.index} data-testid={`layout-cell-${cell.index}`} title={`${s.productName} — click to configure`}>
      <ProductGlyph product={product} size="sm" />
      <span className={styles.cellName}>{s.productName}</span>
      <span className={styles.cellMetric}>{metric}</span>
      {fill !== null && (
        <span className={styles.cellBar}>
          <span style={{ width: `${Math.max(3, fill * 100)}%` }} />
        </span>
      )}
    </button>
  );
});
