// Setup (UX §6.7.3–6.7.4): one editor per unit. Retail lines get the banded
// price slider and the stock policy in months of cover; factories show the
// recipe, input sources, utilisation and make-vs-buy; warehouses a target
// stock; R&D units their tech progress. Plus auto-export for producers, adding
// a unit, changing its product and clearing it. Edits are drafts until Apply
// and take effect at the month close.

import clsx from 'clsx';
import { ChevronDown, Diamond, Eraser, FlaskConical, Globe, Plus, RefreshCw, RotateCcw, Ship, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BuildingDetailDto, MarketRowDto, ProductDto, SlotDetailDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, Progress, TextInput, Toggle, Tooltip } from '@/ui/components';
import { integer, money, percent, price as fmtPrice } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useCatalogIndex } from '../_shared-a/catalog';
import { runCommand } from '../_shared-a/commands';
import { PriceEditor, ProductPicker, StockPolicyPicker, type ProductOption } from '../_shared-a/editors';
import { setUpLine } from '../_shared-a/lineSetup';
import { KeyValues, Notice, PendingChip, ProductGlyph, SectionHead } from '../_shared-a/pieces';
import { lineForecast } from '../_shared-a/stockPolicy';
import styles from './Inspector.module.css';

interface SetupProps {
  detail: BuildingDetailDto;
  focusSlot: number | null;
  onFocusSlot: (index: number | null) => void;
}

export function SetupTab({ detail: d, focusSlot, onFocusSlot }: SetupProps) {
  const freeFocused = focusSlot !== null && focusSlot >= 0 && !d.slots.some((s) => s.index === focusSlot) && focusSlot < d.capacity;
  const open = focusSlot ?? (d.slots.length === 1 ? d.slots[0].index : null);
  const addIndex = freeFocused ? focusSlot! : d.nextFreeSlotIndex;
  const producer = d.slotKind === 'production' || d.slotKind === 'extraction';

  if (d.slotKind === 'none') {
    return (
      <div className={styles.tab}>
        <Notice tone="info">Nothing to set up: this building has no units.</Notice>
      </div>
    );
  }

  return (
    <div className={styles.tab} data-testid="inspector-setup">
      <div className={styles.setupHead}>
        <span className={styles.dim}>Changes are drafts until you apply them.</span>
        <PendingChip />
      </div>

      {producer && d.actions.canToggleAutoExport && <AutoExport detail={d} />}

      {d.slots.map((s) => (
        <UnitEditor key={s.index} detail={d} slot={s} open={open === s.index} onToggle={() => onFocusSlot(open === s.index ? -1 : s.index)} />
      ))}

      {d.slots.length === 0 && <Notice tone="warning">This building is idle. Pick what it should {VERB[d.slotKind] ?? 'handle'} to start earning.</Notice>}

      {d.actions.canAddSlot && addIndex >= 0 && <AddLine detail={d} slotIndex={addIndex} startOpen={freeFocused || d.slots.length === 0} onAdded={(i) => onFocusSlot(i)} />}
      {!d.actions.canAddSlot && d.slots.length >= d.capacity && d.upgrade && (
        <Notice tone="opportunity">All {d.capacity} units are in use. Upgrade to level {d.upgrade.toLevel} on the Finance tab for {d.upgrade.capacity - d.capacity} more.</Notice>
      )}
    </div>
  );
}

const VERB: Record<string, string> = { retail: 'sell', production: 'make', extraction: 'produce', warehouse: 'stock', research: 'research' };

// ------------------------------------------------------------------ unit editor shell

function UnitEditor({ detail: d, slot: s, open, onToggle }: { detail: BuildingDetailDto; slot: SlotDetailDto; open: boolean; onToggle: () => void }) {
  const idx = useCatalogIndex();
  const product = idx.products.get(s.productId);
  const [changing, setChanging] = useState(false);
  const summary = s.retail
    ? `${fmtPrice(s.retail.price)} · ${compact(s.retail.restockTarget)} on the shelf`
    : s.production
      ? s.production.utilization !== undefined
        ? `${percent(s.production.utilization, 0)} utilised`
        : `${compact(s.production.outputPerMonth)}/mo capacity`
      : s.extraction
        ? `${compact(s.extraction.yieldPerMonth)}/mo`
        : s.warehouse
          ? `${compact(s.warehouse.onHand)} of ${compact(s.warehouse.targetStock)}`
          : s.research
            ? `Tech ${s.research.tech}/${s.research.maxTech}`
            : '';

  return (
    <section className={clsx(styles.unit, open && styles.unitOpen)} data-testid={`setup-unit-${s.index}`}>
      <button type="button" className={styles.unitHead} onClick={onToggle} aria-expanded={open}>
        <ProductGlyph product={product} />
        <span className={styles.unitTitle}>
          <span className={styles.unitName}>{s.productName}</span>
          <span className={styles.unitSummary}>
            Unit {s.index + 1} · {summary}
          </span>
        </span>
        <ChevronDown size={15} className={clsx(styles.chev, open && styles.chevOpen)} />
      </button>
      {open && (
        <div className={styles.unitBody}>
          {changing ? (
            <ChangeProduct detail={d} slot={s} onDone={() => setChanging(false)} />
          ) : (
            <>
              {s.retail && <RetailEditor detail={d} slot={s} />}
              {s.production && <ProductionEditor detail={d} slot={s} />}
              {s.extraction && <ExtractionEditor slot={s} />}
              {s.warehouse && <WarehouseEditor detail={d} slot={s} />}
              {s.research && <ResearchEditor slot={s} />}
              <div className={styles.unitTools}>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => setChanging(true)} data-testid={`setup-change-${s.index}`}>
                  Change product
                </Button>
                <ClearUnit detail={d} slot={s} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ retail

function RetailEditor({ detail: d, slot: s }: { detail: BuildingDetailDto; slot: SlotDetailDto }) {
  const r = s.retail!;
  const suggestion = useEngineQuery('suggestPrice', { buildingId: d.id, slotIndex: s.index });
  const market = useEngineQuery('marketDetail', { cityId: d.cityId, productId: s.productId });
  const [price, setPrice] = useState(r.price);
  const [restock, setRestock] = useState(r.restockTarget);
  const [busy, setBusy] = useState(false);
  // New engine values (after Apply or a month close) reset the draft.
  useEffect(() => setPrice(r.price), [r.price]);
  useEffect(() => setRestock(r.restockTarget), [r.restockTarget]);

  const sug = suggestion.data;
  const brackets = market.data?.brackets;
  const context = useMemo(
    () => ({
      unitCost: sug?.unitCost ?? r.unitCost,
      worldPrice: sug?.effectiveWorldPrice ?? r.effectiveWorldPrice,
      rivalMin: sug?.rivalMin ?? r.cheapestRivalPrice ?? null,
      rivalMedian: sug?.rivalMedian ?? null,
      suggested: sug?.suggested ?? null,
      ceilings: sug?.ceilings ?? (brackets ?? []).filter((b) => b.reservationPrice !== undefined).map((b) => ({ bracket: b.bracket, price: b.reservationPrice! })),
    }),
    [sug, r, brackets],
  );
  const forecast = lineForecast(r);
  const dirtyPrice = Math.abs(price - r.price) >= 0.005;
  const dirtyStock = Math.round(restock) !== Math.round(r.restockTarget);
  const dirty = dirtyPrice || dirtyStock;
  const source = d.supply.sources.find((x) => x.productId === s.productId && x.kind === 'transfer');

  const apply = async () => {
    setBusy(true);
    if (dirtyPrice) await runCommand('setRetailPrice', { buildingId: d.id, slotIndex: s.index, price: Math.round(price * 100) / 100 });
    if (dirtyStock) await runCommand('setRestockTarget', { buildingId: d.id, slotIndex: s.index, restockTarget: Math.max(1, Math.round(restock)) });
    setBusy(false);
  };

  return (
    <div className={styles.editor}>
      <SectionHead
        right={
          sug && Math.abs(sug.suggested - price) >= 0.005 ? (
            <Button size="sm" variant="ghost" icon={<Diamond size={12} />} onClick={() => setPrice(sug.suggested)} data-testid={`setup-use-suggested-${s.index}`}>
              Use suggested {fmtPrice(sug.suggested)}
            </Button>
          ) : undefined
        }
      >
        Price
      </SectionHead>
      <PriceEditor value={price} onChange={setPrice} context={context} brackets={brackets} expected={sug?.expectedUnitsAt} original={r.price} data-testid={`setup-price-${s.index}`} />

      <SectionHead>Stock policy</SectionHead>
      <StockPolicyPicker
        value={restock}
        onChange={setRestock}
        forecastUnits={forecast.units}
        forecastSource={forecast.source}
        unitCost={r.unitCost}
        worldPrice={r.effectiveWorldPrice}
        lastSold={r.lastMonthUnits}
        lastLost={r.lastMonthLostUnits ?? null}
        data-testid={`setup-stock-${s.index}`}
      />

      <div className={styles.sourceRow}>
        {source?.counterpartyBuildingId !== undefined ? <Truck size={13} /> : <Globe size={13} />}
        <span>
          Restocks from{' '}
          {source?.counterpartyBuildingId !== undefined ? <strong>your building #{source.counterpartyBuildingId}</strong> : <strong>the world market at {fmtPrice(r.effectiveWorldPrice)}</strong>}
          {r.rivalCount > 0 ? ` · ${r.rivalCount} rival${r.rivalCount === 1 ? '' : 's'} here${r.cheapestRivalPrice !== undefined ? `, cheapest ${fmtPrice(r.cheapestRivalPrice)}` : ''}` : ' · no rivals here'}
        </span>
      </div>

      <div className={styles.applyRow}>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={!dirty || busy} onClick={() => (setPrice(r.price), setRestock(r.restockTarget))}>
          Revert
        </Button>
        <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={() => void apply()} data-testid={`setup-apply-${s.index}`} sound="priceTag">
          Apply
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ production

function ProductionEditor({ detail: d, slot: s }: { detail: BuildingDetailDto; slot: SlotDetailDto }) {
  const idx = useCatalogIndex();
  const p = s.production!;
  const product = idx.products.get(s.productId);
  const saves = p.unitCost !== undefined ? p.effectiveWorldPrice - p.unitCost : null;
  return (
    <div className={styles.editor}>
      {p.utilization !== undefined && (
        <div>
          <SectionHead right={`${p.cyclesPerMonth} cycles/mo per unit`}>Utilisation</SectionHead>
          <Progress className={styles.utilBar} value={p.utilization} size="sm" tone={p.utilization >= 0.9 ? 'success' : p.utilization >= 0.5 ? 'warning' : 'danger'} />
          <div className={styles.meterFoot}>
            {percent(p.utilization, 0)} of {compact(p.outputPerMonth)} {product?.unit ?? 'units'}/mo
            {p.lastMonthOutput !== undefined && ` · made ${compact(p.lastMonthOutput)} last month`}
          </div>
        </div>
      )}
      <SectionHead>Recipe · per month</SectionHead>
      <div className={styles.recipe}>
        {p.inputs.map((i) => {
          const short = i.onHand < i.perMonth;
          return (
            <div key={i.productId} className={clsx(styles.recipeRow, short && (p.utilization ?? 1) < 0.9 && styles.recipeShort)}>
              <ProductGlyph product={idx.products.get(i.productId)} size="sm" />
              <span className={styles.recipeName}>{idx.productName(i.productId)}</span>
              <span className={styles.recipeQty}>{compact(i.perMonth)}</span>
              <span className={styles.recipeSource}>
                {i.source === 'worldMarket' || i.sourceBuildingId === undefined ? (
                  <>
                    <Globe size={11} /> world {fmtPrice(i.effectiveWorldPrice)}
                  </>
                ) : (
                  <>
                    <Truck size={11} /> own #{i.sourceBuildingId}
                    {i.source === 'ownOtherCity' ? ' (other city)' : ''}
                  </>
                )}
              </span>
              <span className={styles.recipeHave}>{compact(i.onHand)} on hand</span>
            </div>
          );
        })}
        <div className={clsx(styles.recipeRow, styles.recipeOut)}>
          <ProductGlyph product={product} size="sm" />
          <span className={styles.recipeName}>→ {s.productName}</span>
          <span className={styles.recipeQty}>{compact(p.outputPerMonth)}</span>
          <span className={styles.recipeSource}>{product?.unit ?? 'units'}/mo at full use</span>
        </div>
      </div>
      <KeyValues
        rows={[
          p.unitCost !== undefined && { label: 'Your unit cost', value: fmtPrice(p.unitCost) },
          { label: 'World market price', value: fmtPrice(p.effectiveWorldPrice) },
          saves !== null && { label: saves >= 0 ? 'Making it saves' : 'Making it costs extra', value: `${fmtPrice(Math.abs(saves))}/unit`, tone: saves >= 0 ? 'pos' : 'neg' },
          { label: 'Output goes to', value: outputDestination(d, s.productId) },
        ]}
      />
      {p.exportsAtLoss && <Notice tone="warning">Auto-export sells {s.productName} below its unit cost. Supply your own stores instead, or turn export off.</Notice>}
    </div>
  );
}

/** Where a producer's output ends up, from the supply flows (own buildings first, then auto-export). */
function outputDestination(d: BuildingDetailDto, productId: string): string {
  const own = d.supply.destinations.some((x) => x.productId === productId && x.kind === 'transfer');
  const exporting = d.autoExport && d.autoExportApplies;
  if (own) return exporting ? 'Your buildings, surplus exported' : 'Your buildings';
  return exporting ? 'Export (auto)' : 'Kept in stock';
}

function ExtractionEditor({ slot: s }: { slot: SlotDetailDto }) {
  const e = s.extraction!;
  return (
    <div className={styles.editor}>
      <KeyValues
        rows={[
          { label: 'Yield', value: `${compact(e.yieldPerMonth)}/mo` },
          { label: 'Quality', value: e.quality.toFixed(0) },
          { label: 'On hand', value: compact(e.onHand) },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ warehouse

function WarehouseEditor({ detail: d, slot: s }: { detail: BuildingDetailDto; slot: SlotDetailDto }) {
  const w = s.warehouse!;
  const [target, setTarget] = useState(w.targetStock);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTarget(w.targetStock), [w.targetStock]);
  const dirty = Math.round(target) !== Math.round(w.targetStock);
  return (
    <div className={styles.editor}>
      <Progress value={w.targetStock > 0 ? w.onHand / w.targetStock : 0} tone={w.onHand >= w.targetStock * 0.9 ? 'success' : 'warning'} label="Stock vs target" valueLabel={`${compact(w.onHand)} / ${compact(w.targetStock)}`} />
      <SectionHead>Target stock</SectionHead>
      <div className={styles.inlineRow}>
        <TextInput size="sm" type="number" min={1} value={String(Math.round(target))} onChange={(e) => setTarget(Math.max(1, Number(e.currentTarget.value) || 1))} aria-label="Target stock" />
        {[0.5, 2].map((f) => (
          <Button key={f} size="sm" variant="ghost" onClick={() => setTarget(Math.max(1, Math.round(target * f)))}>
            ×{f}
          </Button>
        ))}
        <span className={styles.spacer} />
        <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={async () => {
          setBusy(true);
          await runCommand('setWarehouseTarget', { buildingId: d.id, slotIndex: s.index, targetStock: Math.max(1, Math.round(target)) });
          setBusy(false);
        }}>
          Apply
        </Button>
      </div>
      <p className={styles.footNote}>
        {integer(target)} units held for your stores and factories{w.unitCost > 0 ? ` (≈ ${money(target * w.unitCost)} at today’s unit cost)` : ''}.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ research

function ResearchEditor({ slot: s }: { slot: SlotDetailDto }) {
  const r = s.research!;
  return (
    <div className={styles.editor}>
      <Progress value={r.threshold > 0 ? r.progress / r.threshold : 0} tone={r.blocked ? 'danger' : 'info'} label={`Tech ${r.tech} → ${Math.min(r.maxTech, r.tech + 1)}`} valueLabel={`${compact(r.progress)} / ${compact(r.threshold)} pts`} />
      <KeyValues
        rows={[
          { label: 'Company research on it', value: `${compact(r.companyPointsPerMonth)} pts/mo` },
          { label: 'Next level', value: r.blocked ? 'Blocked by a rival patent' : r.tech >= r.maxTech ? 'At maximum' : r.etaMonths !== undefined ? `in ${r.etaMonths} month${r.etaMonths === 1 ? '' : 's'}` : '—', tone: r.blocked ? 'neg' : undefined },
        ]}
      />
      <Button size="sm" variant="ghost" icon={<FlaskConical size={13} />} onClick={() => useUiStore.getState().openPanel('rnd', { productId: s.productId })}>
        Open R&amp;D
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ building-level

function AutoExport({ detail: d }: { detail: BuildingDetailDto }) {
  const [busy, setBusy] = useState(false);
  const loss = d.slots.some((s) => s.production?.exportsAtLoss);
  return (
    <div className={styles.exportRow}>
      <Ship size={15} />
      <span className={styles.exportText}>
        <strong>Export output</strong>
        <span>Sell what your own buildings don’t take to the world market at month close.</span>
        {loss && <span className={styles.neg}>Currently exports below unit cost.</span>}
      </span>
      <Toggle
        checked={d.autoExport}
        disabled={busy}
        onChange={async (on) => {
          setBusy(true);
          await runCommand('setAutoExport', { buildingId: d.id, enabled: on });
          setBusy(false);
        }}
        aria-label="Auto-export"
      />
    </div>
  );
}

// ------------------------------------------------------------------ add / change / clear

function useProductOptions(d: BuildingDetailDto, exclude: string | null): ProductOption[] {
  const idx = useCatalogIndex();
  const intel = useEngineQuery('marketIntel', d.slotKind === 'retail' ? { cityId: d.cityId } : null);
  const rows = useMemo(() => new Map((intel.data?.rows ?? []).map((r) => [r.productId, r])), [intel.data]);
  return useMemo(() => {
    const onSale = new Set(d.slots.filter((s) => s.retail).map((s) => s.productId));
    return d.actions.eligibleProductIds
      .map((id) => idx.products.get(id))
      .filter((p): p is ProductDto => !!p && p.id !== exclude)
      .map((p) => optionFor(d, p, rows.get(p.id), onSale.has(p.id), idx.productName));
  }, [d, exclude, idx, rows]);
}

function optionFor(d: BuildingDetailDto, p: ProductDto, row: MarketRowDto | undefined, onSale: boolean, productName: (id: string) => string): ProductOption {
  let meta = `World ${fmtPrice(p.baseWorldMarketPrice)}`;
  if (d.slotKind === 'retail' && row) meta = `Demand ${compact(row.potentialDemand)}/mo · ${row.rivalCount === 0 ? 'no rivals' : `${row.rivalCount} rival${row.rivalCount === 1 ? '' : 's'}${row.cheapestRivalPrice !== undefined ? ` from ${fmtPrice(row.cheapestRivalPrice)}` : ''}`}`;
  else if (d.slotKind === 'production' && p.recipe) meta = `From ${p.recipe.inputs.map((i) => productName(i.productId).toLowerCase()).join(' + ')}`;
  else if (d.slotKind === 'research') meta = p.affectsRetailDemand ? 'Shoppers value its tech' : 'Patents only';
  return {
    product: p,
    meta,
    tag: onSale ? <Badge tone="neutral">On sale</Badge> : row && row.rivalCount === 0 && row.potentialDemand > 0 ? <Badge tone="opportunity">No rivals</Badge> : undefined,
    disabled: onSale,
    disabledReason: onSale ? 'Already sold here — a second line would only split the same shoppers.' : undefined,
  };
}

function AddLine({ detail: d, slotIndex, startOpen, onAdded }: { detail: BuildingDetailDto; slotIndex: number; startOpen: boolean; onAdded: (index: number) => void }) {
  const [open, setOpen] = useState(startOpen);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useProductOptions(d, null);
  useEffect(() => setOpen(startOpen), [startOpen]);
  if (!open) {
    return (
      <button type="button" className={styles.addLine} onClick={() => setOpen(true)} data-testid="setup-add-line">
        <Plus size={15} /> Add a {d.slotKind === 'retail' ? 'product line' : d.slotKind === 'research' ? 'research project' : 'unit'}
        <span className={styles.dim}>
          {' '}
          · {d.capacity - d.slotsUsed} free
        </span>
      </button>
    );
  }
  return (
    <section className={clsx(styles.unit, styles.unitOpen)} data-testid="setup-add">
      <div className={styles.unitBody}>
        <SectionHead right={`unit ${slotIndex + 1}`}>{QUESTION[d.slotKind] ?? 'Choose a product'}</SectionHead>
        <ProductPicker options={options} value={choice} onChange={setChoice} maxHeight="16rem" data-testid="setup-add-product" />
        <div className={styles.applyRow}>
          {d.slots.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={13} />}
            disabled={!choice}
            loading={busy}
            data-testid="setup-add-confirm"
            onClick={async () => {
              if (!choice) return;
              setBusy(true);
              const res = await setUpLine({ buildingId: d.id, cityId: d.cityId, slotIndex, productId: choice, kind: d.slotKind });
              setBusy(false);
              if (res.ok) {
                setChoice(null);
                setOpen(false);
                onAdded(slotIndex);
              }
            }}
          >
            {d.slotKind === 'retail' ? 'Start selling' : 'Set up'}
          </Button>
        </div>
        {d.slotKind === 'retail' && <p className={styles.footNote}>Opens at the market price with a balanced shelf (one month of forecast demand). Fine-tune after.</p>}
      </div>
    </section>
  );
}

const QUESTION: Record<string, string> = {
  retail: 'What should it sell?',
  production: 'What should it make?',
  extraction: 'What should it produce?',
  warehouse: 'What should it stock?',
  research: 'What should it research?',
};

function ChangeProduct({ detail: d, slot: s, onDone }: { detail: BuildingDetailDto; slot: SlotDetailDto; onDone: () => void }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useProductOptions(d, s.productId);
  return (
    <div className={styles.editor}>
      <SectionHead right={`replaces ${s.productName}`}>{QUESTION[d.slotKind] ?? 'Choose a product'}</SectionHead>
      <ProductPicker options={options} value={choice} onChange={setChoice} maxHeight="15rem" />
      {s.retail && s.retail.onHand > 0 && <Notice tone="info">The {compact(s.retail.onHand)} {s.productName.toLowerCase()} on the shelf stay in the building’s stock.</Notice>}
      <div className={styles.applyRow}>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!choice}
          loading={busy}
          onClick={async () => {
            if (!choice) return;
            setBusy(true);
            const res = await setUpLine({ buildingId: d.id, cityId: d.cityId, slotIndex: s.index, productId: choice, kind: d.slotKind });
            setBusy(false);
            if (res.ok) onDone();
          }}
        >
          Switch product
        </Button>
      </div>
    </div>
  );
}

function ClearUnit({ detail: d, slot: s }: { detail: BuildingDetailDto; slot: SlotDetailDto }) {
  const [busy, setBusy] = useState(false);
  const stock = s.retail?.onHand ?? s.warehouse?.onHand ?? s.extraction?.onHand ?? 0;
  return (
    <Tooltip content="Stop this unit. Any stock stays in the building." side="top">
      <Button
        size="sm"
        variant="ghost"
        icon={<Eraser size={13} />}
        loading={busy}
        data-testid={`setup-clear-${s.index}`}
        onClick={async () => {
          if (stock > 0) {
            const answer = await useUiStore.getState().confirm({
              title: `Clear the ${s.productName} unit?`,
              body: `${compact(stock)} units stay in stock but stop selling. You can set the unit up again any time.`,
              confirmLabel: 'Clear unit',
              tone: 'danger',
            });
            if (answer !== 'confirm') return;
          }
          setBusy(true);
          await runCommand('clearSlot', { buildingId: d.id, slotIndex: s.index });
          setBusy(false);
        }}
      >
        Clear unit
      </Button>
    </Tooltip>
  );
}
