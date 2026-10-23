// Editors shared by the inspector's Setup tab and the build confirm card:
// the banded price slider (UX §6.7.3), the stock policy in months of cover
// (UX §4.5) and the rich product picker ("What will it sell?").

import clsx from 'clsx';
import { AlertTriangle, Check, TrendingUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { BracketDemandDto, PriceSuggestionDto, ProductDto } from '@/bridge/protocol';
import { Segmented, Slider, TextInput, Tooltip } from '@/ui/components';
import { integer, money, price as fmtPrice } from '@/util/format';
import { qty as compact } from './numbers';
import { expectedAt, priceTrack, priceWarnings, type PriceContext } from './priceBands';
import { ProductGlyph } from './pieces';
import { STOCK_POLICIES, cashTiedUp, classifyPolicy, coverMonths, unitsForCover, type ForecastSource, type StockPolicyId } from './stockPolicy';
import styles from './editors.module.css';

// ------------------------------------------------------------------ price

export interface PriceEditorProps {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  context: PriceContext;
  brackets?: readonly BracketDemandDto[];
  expected?: PriceSuggestionDto['expectedUnitsAt'];
  /** Shown after the price ("was $2.10"). */
  original?: number | null;
  disabled?: boolean;
  compactLayout?: boolean;
  'data-testid'?: string;
}

export function PriceEditor({ value, onChange, onCommit, context, brackets, expected, original, disabled, compactLayout, ...rest }: PriceEditorProps) {
  const track = useMemo(() => priceTrack({ ...context, current: value }), [context, value]);
  const warnings = priceWarnings(value, context, brackets);
  const outlook = expected && expected.length > 0 ? expectedAt(expected, value) : null;
  const margin = value - track.costFloor;
  return (
    <div className={clsx(styles.price, compactLayout && styles.priceCompact)}>
      <div className={styles.priceHead}>
        <span className={styles.priceValue} data-testid={rest['data-testid'] ? `${rest['data-testid']}-value` : undefined}>
          {fmtPrice(value)}
        </span>
        <span className={clsx(styles.priceMargin, margin < 0 ? styles.neg : styles.pos)}>
          {margin >= 0 ? '+' : '−'}
          {fmtPrice(Math.abs(margin))} / unit {context.unitCost > 0 ? 'over cost' : 'over est. cost'}
        </span>
        {original !== null && original !== undefined && Math.abs(original - value) >= 0.005 && <span className={styles.priceWas}>was {fmtPrice(original)}</span>}
      </div>
      <Slider
        value={value}
        min={track.min}
        max={track.max}
        step={track.step}
        scale="log"
        format={fmtPrice}
        marks={track.marks}
        bands={track.bands}
        onChange={onChange}
        onCommit={onCommit}
        disabled={disabled}
        showScale
        bubble={false}
        aria-label="Price"
        data-testid={rest['data-testid']}
      />
      {outlook && (
        <div className={styles.outlook}>
          <TrendingUp size={13} />
          <span>
            At {fmtPrice(value)}: about <strong>{compact(outlook.units)}</strong> units/mo · revenue <strong>{money(outlook.revenue)}</strong> · gross{' '}
            <strong className={outlook.grossProfit < 0 ? styles.neg : styles.pos}>{money(outlook.grossProfit)}</strong>
            {outlook.extrapolated && <span className={styles.dim}> (nearest forecast)</span>}
          </span>
        </div>
      )}
      {warnings.map((w) => (
        <div key={w.text} className={clsx(styles.warning, w.tone === 'danger' ? styles.warnDanger : styles.warnAmber)}>
          <AlertTriangle size={13} />
          {w.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ stock

const SOURCE_TEXT: Record<ForecastSource, string> = {
  lastMonthDemand: 'last month’s demand',
  soldPlusLost: 'last month’s sales + lost sales',
  model: 'the market forecast',
  none: 'no forecast yet',
};

export interface StockPolicyPickerProps {
  /** Restock target in units. */
  value: number;
  onChange: (units: number) => void;
  forecastUnits: number;
  forecastSource: ForecastSource;
  unitCost: number;
  worldPrice: number;
  unitLabel?: string;
  lastSold?: number | null;
  lastLost?: number | null;
  disabled?: boolean;
  'data-testid'?: string;
}

export function StockPolicyPicker({ value, onChange, forecastUnits, forecastSource, unitCost, worldPrice, unitLabel = 'units', lastSold, lastLost, disabled, ...rest }: StockPolicyPickerProps) {
  const classified = classifyPolicy(value, forecastUnits);
  const [customOpen, setCustomOpen] = useState(classified === 'custom');
  const policy: StockPolicyId = customOpen ? 'custom' : classified;
  const cover = coverMonths(value, forecastUnits);
  const options = [
    ...STOCK_POLICIES.map((p) => ({ value: p.id as StockPolicyId, label: `${p.label} ${p.months} mo`, title: p.hint, disabled: disabled || forecastUnits <= 0, testId: `${rest['data-testid'] ?? 'stock'}-${p.id}` })),
    { value: 'custom' as StockPolicyId, label: 'Custom', title: 'Set raw units yourself', disabled, testId: `${rest['data-testid'] ?? 'stock'}-custom` },
  ];
  return (
    <div className={styles.stock} data-testid={rest['data-testid']}>
      <Segmented<StockPolicyId>
        size="sm"
        full
        options={options}
        value={policy}
        onChange={(id) => {
          if (id === 'custom') {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          const p = STOCK_POLICIES.find((x) => x.id === id);
          if (p) onChange(unitsForCover(p.months, forecastUnits));
        }}
        label="Stock policy"
      />
      {policy === 'custom' && (
        <div className={styles.customRow}>
          <TextInput
            size="sm"
            type="number"
            min={1}
            step={1}
            value={String(Math.round(value))}
            disabled={disabled}
            onChange={(e) => {
              const n = Math.floor(Number(e.currentTarget.value));
              if (Number.isFinite(n) && n >= 1) onChange(n);
            }}
            aria-label="Restock target (units)"
          />
          <span className={styles.dim}>{unitLabel} kept on the shelf</span>
        </div>
      )}
      <div className={styles.stockFacts}>
        <span>
          = <strong>{integer(value)}</strong> {unitLabel} on the shelf
        </span>
        <span>
          <strong>{money(cashTiedUp(value, unitCost, worldPrice))}</strong> tied up
        </span>
        {cover !== null && (
          <span>
            <strong>{cover >= 10 ? cover.toFixed(0) : cover.toFixed(1)}</strong> months of cover
          </span>
        )}
      </div>
      <div className={styles.stockBasis}>
        {forecastUnits > 0 ? (
          <>
            Demand basis: {compact(forecastUnits)}/mo from {SOURCE_TEXT[forecastSource]}.
          </>
        ) : (
          'No demand forecast yet — set units by hand.'
        )}
        {lastSold !== undefined && lastSold !== null && (
          <>
            {' '}
            Last month: {compact(lastSold)} sold
            {lastLost !== undefined && lastLost !== null ? (
              <>
                , <span className={lastLost > 0 ? styles.neg : undefined}>{compact(lastLost)} lost</span>
              </>
            ) : null}
            .
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ product picker

export interface ProductOption {
  product: ProductDto;
  /** One-line context, e.g. "Demand 2.6M/mo · 1 rival at $2.14". */
  meta?: ReactNode;
  /** Small right-hand tag ("No rivals", "Recommended"). */
  tag?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export interface ProductPickerProps {
  options: readonly ProductOption[];
  value: string | null;
  onChange: (productId: string | null) => void;
  /** Adds a "Decide later" row (build confirm). */
  allowNone?: boolean;
  maxHeight?: number | string;
  'data-testid'?: string;
}

export function ProductPicker({ options, value, onChange, allowNone, maxHeight = '17rem', ...rest }: ProductPickerProps) {
  return (
    <div className={styles.picker} role="radiogroup" style={{ maxHeight }} data-testid={rest['data-testid']}>
      {options.map((o) => {
        const selected = o.product.id === value;
        const row = (
          <button
            key={o.product.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            className={clsx(styles.option, selected && styles.optionOn)}
            onClick={() => onChange(o.product.id)}
            data-testid={rest['data-testid'] ? `${rest['data-testid']}-${o.product.id}` : undefined}
          >
            <ProductGlyph product={o.product} />
            <span className={styles.optionBody}>
              <span className={styles.optionName}>{o.product.name}</span>
              {o.meta && <span className={styles.optionMeta}>{o.meta}</span>}
            </span>
            {o.tag && <span className={styles.optionTag}>{o.tag}</span>}
            <span className={styles.optionCheck}>{selected && <Check size={14} />}</span>
          </button>
        );
        return o.disabled && o.disabledReason ? (
          <Tooltip key={o.product.id} content={o.disabledReason} block>
            {row}
          </Tooltip>
        ) : (
          row
        );
      })}
      {allowNone && (
        <button type="button" role="radio" aria-checked={value === null} className={clsx(styles.option, styles.optionNone, value === null && styles.optionOn)} onClick={() => onChange(null)}>
          <span className={styles.optionBody}>
            <span className={styles.optionName}>Decide later</span>
            <span className={styles.optionMeta}>Opens idle — set it up in the inspector</span>
          </span>
          <span className={styles.optionCheck}>{value === null && <Check size={14} />}</span>
        </button>
      )}
    </div>
  );
}
