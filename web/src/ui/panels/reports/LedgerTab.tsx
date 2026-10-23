// Ledger explorer (UX §6.9): every cash entry, newest first, filtered by
// category, period, product and building, paged 100 at a time with CSV export.
// The ledger is the truth every statement is built from; player-only.

import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LedgerArgs, LedgerCategoryId, LedgerRowDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Badge, Button, Panel, Select, Table } from '@/ui/components';
import { monthYear } from '@/util/format';
import { ErrorBlock, LoadingBlock, useFeature, useMoneyFormat } from '../_shared-b/components';
import { downloadCsv } from '../_shared-b/csv';
import { useNames } from '../_shared-b/names';
import { prettyMemo } from '../_shared-b/text';
import { PRESET_LABEL, type Preset } from '../_shared-b/PeriodPicker';
import { rangeCaption } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import { ledgerCategoryLabel } from './HistoryTab';
import type { LedgerFilter } from './index';
import styles from './Reports.module.css';

const CATEGORIES: LedgerCategoryId[] = [
  'productSale',
  'exportSale',
  'patentRoyaltyIncome',
  'retailRestock',
  'inputPurchase',
  'shippingCost',
  'operatingCost',
  'advertisingCost',
  'patentRoyaltyExpense',
  'constructionCost',
  'upgradeCost',
  'startingCapital',
];

/** E2 finance categories (offered once the bridge reports `features.loans`). Strings so older protocols still build. */
const FINANCE_CATEGORIES = [
  'loanDrawdown',
  'loanRepayment',
  'revolverDraw',
  'revolverRepay',
  'interestExpense',
  'interestIncome',
  'incomeTax',
  'landPurchase',
  'constructionPayment',
  'equipmentPurchase',
  'assetSale',
  'wages',
  'utilities',
  'maintenance',
] as unknown as LedgerCategoryId[];

const PAGE = 100;
type PeriodChoice = Preset | 'drill';

export function LedgerTab({ filter, onFilter }: { filter: LedgerFilter; onFilter: (f: LedgerFilter) => void }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const finance = useFeature('loans');
  const buildings = useGameStore((s) => s.buildings);
  const playerId = names.playerId;
  const [period, setPeriod] = useState<PeriodChoice>(filter.from ? 'drill' : 'last12');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (filter.from) setPeriod('drill');
    setOffset(0);
  }, [filter]);

  const args: LedgerArgs = useMemo(
    () => ({
      period: period === 'drill' && filter.from && filter.to ? { from: filter.from, to: filter.to } : { preset: period === 'drill' ? 'last12' : period },
      ...(filter.categories?.length ? { categories: filter.categories } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.buildingId !== undefined ? { buildingId: filter.buildingId } : {}),
      offset,
      limit: PAGE,
    }),
    [period, filter, offset],
  );
  const { data, error } = useEngineQuery('ledger', args);
  const own = buildings.filter((b) => b.ownerId === playerId);
  const memoLookup = useMemo(() => {
    const ids = [...names.productIds, ...names.cityIds];
    const typeIds = names.catalog?.buildingTypes.map((t) => t.id) ?? [];
    return {
      ids: [...ids, ...typeIds],
      name: (id: string) => (names.productIds.includes(id) ? names.product(id) : names.cityIds.includes(id) ? names.city(id) : names.buildingType(id)),
      building: (id: number) => names.building(id),
    };
  }, [names]);
  const products = names.catalog?.products ?? [];

  const exportPage = () =>
    downloadCsv('ledger', [
      ['Seq', 'Month', 'Category', 'Amount', 'Product', 'Building', 'Memo'],
      ...(data?.rows ?? []).map((r) => [r.seq, monthYear(r.date), ledgerCategoryLabel(r.category), r.amount, r.productId ? names.product(r.productId) : '', r.buildingId !== undefined ? names.building(r.buildingId) : '', r.memo ? prettyMemo(r.memo, memoLookup) : '']),
    ]);

  return (
    <div className={shared.page}>
      <div className={styles.ledgerFilters}>
        <span className={shared.toolbarLabel}>Filters</span>
        <Select<PeriodChoice>
          size="sm"
          aria-label="Period"
          value={period}
          options={[
            ...(filter.from && filter.to ? [{ value: 'drill' as const, label: rangeCaption(filter.from, filter.to) }] : []),
            ...(Object.keys(PRESET_LABEL) as Preset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] })),
          ]}
          onChange={(p) => {
            setPeriod(p);
            setOffset(0);
          }}
        />
        <Select<string>
          size="sm"
          aria-label="Category"
          value={filter.categories?.length === 1 ? filter.categories[0]! : filter.categories?.length ? 'multi' : 'all'}
          options={[
            { value: 'all', label: 'All categories' },
            ...(filter.categories && filter.categories.length > 1 ? [{ value: 'multi', label: filter.categories.map(ledgerCategoryLabel).join(' + ') }] : []),
            ...(finance ? [...CATEGORIES, ...FINANCE_CATEGORIES] : CATEGORIES).map((c) => ({ value: c, label: ledgerCategoryLabel(c) })),
          ]}
          onChange={(v) => v !== 'multi' && onFilter({ ...filter, categories: v === 'all' ? undefined : [v as LedgerCategoryId] })}
          data-testid="ledger-category"
        />
        <Select<string>
          size="sm"
          aria-label="Product"
          value={filter.productId ?? 'all'}
          options={[{ value: 'all', label: 'All products' }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(v) => onFilter({ ...filter, productId: v === 'all' ? undefined : v })}
        />
        <Select<number>
          size="sm"
          aria-label="Building"
          value={filter.buildingId ?? -1}
          options={[{ value: -1, label: 'All buildings' }, ...own.map((b) => ({ value: b.id, label: b.name }))]}
          onChange={(v) => onFilter({ ...filter, buildingId: v < 0 ? undefined : v })}
        />
        {(filter.categories?.length || filter.productId || filter.buildingId !== undefined || filter.from) && (
          <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => (onFilter({}), setPeriod('last12'))}>
            Clear
          </Button>
        )}
        <span className={shared.spacer} />
        <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportPage} disabled={!data?.rows.length}>
          Export page
        </Button>
      </div>
      <Panel padding="none" variant="solid">
        {error && !data ? (
          <ErrorBlock error={error} />
        ) : !data ? (
          <LoadingBlock rows={12} />
        ) : (
          <Table<LedgerRowDto>
            dense
            maxHeight="calc(100vh - 330px)"
            rowKey={(r) => r.seq}
            rows={data.rows}
            empty="No ledger entries match these filters."
            aria-label="Ledger"
            columns={[
              { id: 'seq', header: '#', numeric: true, width: 64, cell: (r) => <span className={shared.dim}>{r.seq}</span> },
              { id: 'm', header: 'Month', width: 92, cell: (r) => monthYear(r.date) },
              { id: 'c', header: 'Category', cell: (r) => <Badge tone={r.amount >= 0 ? 'success' : 'neutral'}>{ledgerCategoryLabel(r.category)}</Badge> },
              { id: 'a', header: 'Amount', numeric: true, cell: (r) => <b className={r.amount >= 0 ? shared.pos : undefined}>{fmt(r.amount, { signed: true })}</b> },
              { id: 'p', header: 'Product', cell: (r) => (r.productId ? names.product(r.productId) : '—') },
              { id: 'b', header: 'Building', cell: (r) => (r.buildingId !== undefined ? names.building(r.buildingId) : '—') },
              { id: 'memo', header: 'Memo', cell: (r) => <span className={styles.memo}>{r.memo ? prettyMemo(r.memo, memoLookup) : ''}</span> },
            ]}
          />
        )}
      </Panel>
      {data && (
        <div className={shared.pager}>
          <span>
            {data.total === 0 ? 'No entries' : `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total.toLocaleString('en-US')} entries`}
          </span>
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Newer
          </Button>
          <Button size="sm" variant="ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
