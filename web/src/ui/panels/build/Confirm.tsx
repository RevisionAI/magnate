// Confirm card (UX §6.6): land + construction cost, timing, running cost, cash
// after and runway (all from `previewBuild` at the chosen plot), a financing
// hint, and "What will it sell?" with an opening price and a stock policy so
// the building opens configured. Construct → the inspector opens on the new
// building (Setup when it opens idle). Shift+Construct places another.

import { ArrowLeft, Banknote, Check, Hammer, Landmark, MapPin, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { BuildingTypeDto, MarketRowDto, ProductDto, SlotConfigArgs } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, DrawerFrame, Segmented, Skeleton, TextInput } from '@/ui/components';
import { addMonths, integer, money, monthYear, price as fmtPrice } from '@/util/format';
import { useBuildFlow } from '../_shared-a/buildFlow';
import { useCatalogIndex, useFeature, usePlayerCash } from '../_shared-a/catalog';
import { constructBuilding } from '../_shared-a/commands';
import { sizeShelf } from '../_shared-a/lineSetup';
import { qty as compact, runwayText } from '../_shared-a/numbers';
import { ProductPicker, type ProductOption } from '../_shared-a/editors';
import { KeyValues, Notice, SectionHead, buildingIcon } from '../_shared-a/pieces';
import { openingPrice } from '../_shared-a/priceBands';
import { DEFAULT_POLICY, STOCK_POLICIES, unitsForCover } from '../_shared-a/stockPolicy';
import { opensText } from './buildModel';
import styles from './Build.module.css';

const PLACEMENT_ISSUE: Record<string, string> = {
  outOfBounds: 'That spot is outside the city.',
  occupied: 'That plot is already taken.',
  road: 'You can’t build on a road.',
  zoning: 'The zoning there doesn’t allow this building.',
};

const RUNWAY_WARN_MONTHS = 3;

export function BuildConfirm() {
  const idx = useCatalogIndex();
  const typeId = useBuildFlow((s) => s.typeId);
  const cityId = useBuildFlow((s) => s.cityId);
  const choice = useBuildFlow((s) => s.choice);
  const presetProduct = useBuildFlow((s) => s.productId);
  const back = useBuildFlow((s) => s.back);
  const date = useGameStore((s) => s.hud?.date);
  const cash = usePlayerCash();
  const loans = useFeature('loans');
  const type = typeId ? idx.types.get(typeId) : undefined;
  const at = choice?.at ?? undefined;
  const preview = useEngineQuery('previewBuild', typeId && cityId ? { typeId, cityId, ...(at ? { at } : {}) } : null);
  const p = preview.data;
  const kind = type?.slotKind ?? 'none';
  const intel = useEngineQuery('marketIntel', kind === 'retail' && cityId ? { cityId } : null);
  const rows = useMemo(() => new Map((intel.data?.rows ?? []).map((r) => [r.productId, r])), [intel.data]);
  // Biggest markets first for stores; catalog order otherwise.
  const eligible = useMemo(() => {
    const list = (p?.eligibleProductIds ?? type?.eligibleProductIds ?? []).map((id) => idx.products.get(id)).filter((x): x is ProductDto => !!x);
    return kind === 'retail' ? [...list].sort((a, b) => (rows.get(b.id)?.potentialDemand ?? 0) - (rows.get(a.id)?.potentialDemand ?? 0)) : list;
  }, [p, type, idx, kind, rows]);

  const recommended = useMemo(() => recommend(kind, eligible, rows), [kind, eligible, rows]);
  const [product, setProduct] = useState<string | null | undefined>(undefined);
  const selected = product === undefined ? (presetProduct && eligible.some((e) => e.id === presetProduct) ? presetProduct : recommended) : product;
  const [policy, setPolicy] = useState<(typeof STOCK_POLICIES)[number]['id']>(DEFAULT_POLICY.id);
  const [whTarget, setWhTarget] = useState(100_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = selected ? rows.get(selected) : undefined;
  const selectedProduct = selected ? idx.products.get(selected) : undefined;
  const starter = idx.catalog?.starterPlans.find((s) => s.productId === selected && s.typeId === typeId);
  const opening = selectedProduct ? openingPrice({ cheapestRivalPrice: row?.cheapestRivalPrice, starterPrice: starter?.price, worldPrice: selectedProduct.baseWorldMarketPrice }) : null;

  const blocked = !p || !p.geographyOk || !p.placementOk || !p.affordable;
  const runwayShort = p?.runwayMonthsAfter !== undefined && p.runwayMonthsAfter < RUNWAY_WARN_MONTHS;

  const doConstruct = async (shift: boolean) => {
    // Shift on the ghost click (W6 keepPlacing) or on Construct places another one.
    const another = shift || choice?.keepPlacing === true;
    if (!type || !cityId || !p || blocked || busy) return;
    setBusy(true);
    setError(null);
    const months = STOCK_POLICIES.find((x) => x.id === policy)?.months ?? 1;
    let initialSlot: SlotConfigArgs | undefined;
    if (selected) {
      if (kind === 'retail') {
        // Provisional shelf until the slot exists; refined below from the bridge's forecast.
        const provisional = row ? unitsForCover(months, row.potentialDemand / (row.retailerCount + 1)) : 1000;
        initialSlot = { productId: selected, slotIndex: 0, price: opening ?? undefined, restockTarget: provisional };
      } else if (kind === 'warehouse') initialSlot = { productId: selected, slotIndex: 0, targetStock: Math.max(1, Math.round(whTarget)) };
      else if (kind !== 'none') initialSlot = { productId: selected, slotIndex: 0 };
    }
    const res = await constructBuilding({ typeId: type.id, cityId, ...(at ? { at } : {}), ...(initialSlot ? { initialSlot } : {}) }, p.totalCost, `${type.name} ordered in ${idx.cityName(cityId)}`, { quiet: true });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    const built = res.result;
    if (kind === 'retail' && selected) await sizeShelf(built.id, 0, months);
    setBusy(false);
    const flow = useBuildFlow.getState();
    if (another) {
      flow.start(type.id, cityId, selected);
      return;
    }
    flow.reset();
    const ui = useUiStore.getState();
    ui.closePanel('build');
    ui.openPanel('inspector', { buildingId: built.id, tab: selected || kind === 'none' ? 'overview' : 'setup' });
    useGameStore.getState().selectBuilding(built.id);
  };

  // Enter confirms (UX §6.6 "Construct ⏎"); ignored while typing in a field.
  const constructRef = useRef(doConstruct);
  constructRef.current = doConstruct;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
      e.preventDefault();
      void constructRef.current(e.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!type || !cityId) return null;
  const Icon = buildingIcon(type);
  const opens = p?.constructionMonths && date ? monthYear(addMonths(date, p.constructionMonths)) : null;
  const plotText = choice?.source === 'auto' || !at ? (p?.suggestedPlacement ? `suggested site · plot ${p.suggestedPlacement.px}, ${p.suggestedPlacement.pz}` : 'suggested site') : `plot ${at.px}, ${at.pz}`;

  return (
    <DrawerFrame
      title={`Confirm · ${type.name}`}
      eyebrow="Build · step 3 of 3"
      icon={<Icon size={17} />}
      subtitle={
        <span className={styles.subLine}>
          <MapPin size={11} /> {idx.cityName(cityId)} · {plotText}
        </span>
      }
      data-testid="panel-build"
      footer={
        <div className={styles.footerRow}>
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={back} data-testid="build-back">
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Hammer size={15} />}
            loading={busy}
            disabled={blocked}
            kbd="Enter"
            onClick={(e: MouseEvent) => void doConstruct(e.shiftKey)}
            data-testid="build-confirm"
            sound="confirm"
          >
            Construct{p ? ` · ${money(p.totalCost)}` : ''}
          </Button>
        </div>
      }
    >
      {!p ? (
        <Skeleton height={140} />
      ) : (
        <>
          <div className={styles.costHero}>
            <div>
              <div className={styles.costLabel}>Total</div>
              <div className={styles.costValue} data-testid="build-total">
                {money(p.totalCost)}
              </div>
            </div>
            <div className={styles.costSplit}>
              {p.landCost !== undefined && <span>Land {money(p.landCost)}</span>}
              <span>Construction {money(p.constructionCost)}</span>
            </div>
          </div>
          <KeyValues
            rows={[
              { label: 'Timing', value: opens ? `${opensText(p.constructionMonths)} · opens ${opens}` : opensText(p.constructionMonths) },
              { label: 'Running cost from opening', value: `${money(p.monthlyOpex)}/mo` },
              { label: 'Units', value: `${p.capacity}${type.levels.length > 1 ? ` (up to ${Math.max(...type.levels.map((l) => l.capacity))} with upgrades)` : ''}` },
              { label: 'Cash after', value: money(p.cashAfter), tone: p.cashAfter < 0 ? 'neg' : undefined, strong: true },
              {
                label: 'Runway after',
                value: p.runwayMonthsAfter === undefined ? 'Not burning cash' : runwayText(p.runwayMonthsAfter),
                tone: runwayShort ? 'neg' : 'muted',
              },
            ]}
          />
          {p.catchment && (
            <p className={styles.catchment}>
              Catchment: about {compact(p.catchment.potentialUnitsPerMonth)} units/mo nearby · {p.catchment.rivalsWithinRadius} rival{p.catchment.rivalsWithinRadius === 1 ? '' : 's'} close by.
            </p>
          )}
        </>
      )}

      <div className={styles.notices}>
        {p && !p.geographyOk && <Notice tone="danger" icon={<TriangleAlert size={14} />}>This building needs {p.geographyIssues.join(' and ')} geography; {idx.cityName(cityId)} doesn’t have it.</Notice>}
        {p && !p.placementOk && <Notice tone="danger" icon={<TriangleAlert size={14} />}>{PLACEMENT_ISSUE[p.placementIssue ?? ''] ?? 'That plot can’t take this building.'} Go back and pick another.</Notice>}
        {p && !p.affordable && (
          <Notice
            tone="danger"
            icon={<Banknote size={14} />}
            action={
              <Button size="sm" variant="secondary" icon={<Landmark size={13} />} onClick={() => useUiStore.getState().openPanel('finance')}>
                Finance…
              </Button>
            }
          >
            You’re {money(p.shortfall)} short (cash {money(cash)}).
          </Notice>
        )}
        {p && p.affordable && runwayShort && (
          <Notice
            tone="warning"
            icon={<Banknote size={14} />}
            action={
              loans ? (
                <Button size="sm" variant="secondary" icon={<Landmark size={13} />} onClick={() => useUiStore.getState().openPanel('finance', { tab: 'loans' })}>
                  Loans…
                </Button>
              ) : undefined
            }
          >
            Only {runwayText(p.runwayMonthsAfter!)} of cash left after this at your current burn.{loans ? ' Consider financing it with a loan.' : ' Make sure it earns quickly.'}
          </Notice>
        )}
        {error && (
          <Notice tone="danger" icon={<TriangleAlert size={14} />}>
            {error}
          </Notice>
        )}
      </div>

      {kind !== 'none' && eligible.length > 0 && (
        <section className={styles.section}>
          <SectionHead right="you can change it later">{QUESTION[kind]}</SectionHead>
          <ProductPicker
            options={eligible.map((pr) => productOption(kind, pr, rows.get(pr.id), pr.id === recommended, idx.productName))}
            value={selected ?? null}
            onChange={(id) => setProduct(id)}
            allowNone
            maxHeight="15rem"
            data-testid="build-product"
          />
        </section>
      )}

      {kind === 'retail' && selected && selectedProduct && opening !== null && (
        <section className={styles.section}>
          <SectionHead>Opening price</SectionHead>
          <div className={styles.openingRow}>
            <span className={styles.openingPrice}>{fmtPrice(opening)}</span>
            <span className={styles.openingWhy}>
              {row?.cheapestRivalPrice !== undefined ? 'matches the cheapest rival' : starter?.price !== undefined ? 'a proven starter price' : 'standard markup on the world price'} — fine-tune it with the price slider once it opens.
            </span>
          </div>
          <SectionHead>Stock on the shelf</SectionHead>
          <Segmented
            size="sm"
            full
            value={policy}
            onChange={setPolicy}
            options={STOCK_POLICIES.map((s) => ({ value: s.id, label: `${s.label} ${s.months} mo`, title: s.hint, testId: `build-stock-${s.id}` }))}
            label="Stock policy"
          />
          <p className={styles.hint}>Sized from the market forecast for your store once it exists ({STOCK_POLICIES.find((s) => s.id === policy)?.months} month of demand).</p>
        </section>
      )}

      {kind === 'warehouse' && selected && (
        <section className={styles.section}>
          <SectionHead>Target stock</SectionHead>
          <div className={styles.openingRow}>
            <TextInput size="sm" type="number" min={1} value={String(whTarget)} onChange={(e) => setWhTarget(Math.max(1, Number(e.currentTarget.value) || 1))} aria-label="Target stock (units)" />
            <span className={styles.openingWhy}>{integer(whTarget)} units kept in stock for your stores and factories.</span>
          </div>
        </section>
      )}

      {kind === 'none' && type.mediaChannel && (
        <Notice tone="info" icon={<Check size={14} />}>
          No units to set up: owning it makes your {type.mediaChannel} ads cheaper and stronger.
        </Notice>
      )}

      <p className={styles.hint}>
        <Badge tone="neutral">Shift</Badge> + Construct places another one.
      </p>
    </DrawerFrame>
  );
}

const QUESTION: Record<string, string> = {
  retail: 'What will it sell?',
  production: 'What will it make?',
  extraction: 'What will it produce?',
  warehouse: 'What will it stock?',
  research: 'What will it research?',
};

/** Retail: the biggest market you don't serve yet (fewest rivals on ties). Others: none preselected. */
function recommend(kind: string, eligible: readonly ProductDto[], rows: ReadonlyMap<string, MarketRowDto>): string | null {
  if (kind !== 'retail') return null;
  const candidates = eligible
    .map((p) => rows.get(p.id))
    .filter((r): r is MarketRowDto => !!r && !r.playerPresent && r.potentialDemand > 0)
    .sort((a, b) => b.potentialDemand / (1 + b.rivalCount) - a.potentialDemand / (1 + a.rivalCount) || a.productId.localeCompare(b.productId));
  return candidates[0]?.productId ?? null;
}

function productOption(kind: BuildingTypeDto['slotKind'], product: ProductDto, row: MarketRowDto | undefined, recommended: boolean, productName: (id: string) => string): ProductOption {
  let meta: string | undefined;
  if (kind === 'retail' && row) {
    const rivals = row.rivalCount === 0 ? 'no rivals' : `${row.rivalCount} rival${row.rivalCount === 1 ? '' : 's'}${row.cheapestRivalPrice !== undefined ? ` from ${fmtPrice(row.cheapestRivalPrice)}` : ''}`;
    meta = `Demand ${compact(row.potentialDemand)}/mo · ${rivals}${row.playerPresent ? ' · you sell it here' : ''}`;
  } else if (kind === 'production' && product.recipe) {
    meta = `From ${product.recipe.inputs.map((i) => productName(i.productId).toLowerCase()).join(' + ')} · world ${fmtPrice(product.baseWorldMarketPrice)}`;
  } else if (kind === 'extraction') {
    meta = `${product.yieldPerSlotPerMonth !== undefined ? `${compact(product.yieldPerSlotPerMonth)} ${product.unit}/mo per unit · ` : ''}world ${fmtPrice(product.baseWorldMarketPrice)}`;
  } else if (kind === 'research') {
    meta = product.affectsRetailDemand ? 'Shoppers value its tech' : 'Patents only (not sold to shoppers)';
  } else {
    meta = `World ${fmtPrice(product.baseWorldMarketPrice)}`;
  }
  return { product, meta, tag: recommended ? <Badge tone="opportunity">Best bet</Badge> : undefined };
}
