// Balance sheet tab: assets / liabilities / equity as of the latest close, the
// books-close check (A − L = E to the cent), asset composition and history,
// and a per-building drill-down (book value, inventory) that opens the
// building inspector.

import { CheckCircle2, MapPin, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BuildingInventoryDto, BuildingValueDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { IconButton, LineChart, Panel, StackedBar, Table } from '@/ui/components';
import { addMonths, integer, money, monthYear } from '@/util/format';
import { ErrorBlock, LoadingBlock, Note, pct, useMoneyFormat } from '../_shared-b/components';
import { type BalanceSheetView, type CreditProfileView, ratePct } from '../_shared-b/finance';
import { useNames } from '../_shared-b/names';
import { CompanyPicker } from '../_shared-b/PeriodPicker';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import type { ReportsNav } from './index';
import styles from './Reports.module.css';

export function BalanceTab({ nav }: { nav: ReportsNav }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const companyId = nav.companyId;
  const isPlayer = companyId === null || companyId === names.playerId;
  const { data: bsData, error } = useEngineQuery('balanceSheet', { ...(companyId !== null ? { companyId } : {}), drilldown: isPlayer });
  const historyArgs = useMemo(
    () => ({ series: ['cash', 'inventoryValue', 'buildingValue', 'totalAssets', 'equity'] as const, companyIds: [companyId ?? names.playerId ?? 0] }),
    [companyId, names.playerId],
  );
  const { data: hist } = useEngineQuery('history', { series: [...historyArgs.series], companyIds: historyArgs.companyIds });
  const { data: credit } = useEngineQuery('creditProfile', isPlayer ? {} : null);
  const tax: CreditProfileView | undefined = credit?.rating !== undefined && (credit as CreditProfileView).taxRate !== undefined ? credit : undefined;

  const bs: BalanceSheetView | undefined = bsData;
  if (error && !bs) return <ErrorBlock error={error} />;
  if (!bs) return <LoadingBlock rows={10} chart />;

  const liabilities = bs.liabilityLines && bs.liabilityLines.length > 0 ? bs.liabilityLines : bs.liabilities !== 0 ? [{ kind: 'loan' as const, label: 'Liabilities', amount: bs.liabilities }] : [];
  const series = hist?.companies[0]?.series;
  const labels = hist ? Array.from({ length: hist.months }, (_, i) => shortMonth(addMonths(hist.start, i))) : [];
  const grossBuildings = bs.grossPpe ?? (bs.accumulatedDepreciation !== undefined ? bs.buildingValue + bs.accumulatedDepreciation : null);

  return (
    <div className={shared.page}>
      <div className={shared.toolbar}>
        <span className={shared.toolbarLabel}>As of the close of {monthYear(bs.asOf)}</span>
        <CompanyPicker value={companyId} onChange={nav.setCompanyId} />
      </div>
      <div className={shared.split}>
        <div className={shared.stack}>
          <div className={styles.bsGrid}>
            <Panel title="Assets" padding="none" variant="solid">
              <table className={styles.bsTable} data-testid="bs-assets">
                <tbody>
                  <tr>
                    <td>Cash</td>
                    <td>{fmt(bs.cash)}</td>
                  </tr>
                  <tr>
                    <td>Inventory (at cost)</td>
                    <td>{fmt(bs.inventoryValue)}</td>
                  </tr>
                  {bs.landValue !== undefined && (
                    <tr>
                      <td>Land (at cost, never depreciated)</td>
                      <td>{fmt(bs.landValue)}</td>
                    </tr>
                  )}
                  {grossBuildings !== null ? (
                    <>
                      <tr>
                        <td>Buildings and equipment at cost</td>
                        <td>{fmt(grossBuildings)}</td>
                      </tr>
                      <tr className={styles.bsIndent}>
                        <td>Accumulated depreciation</td>
                        <td>{fmt(-(bs.accumulatedDepreciation ?? 0))}</td>
                      </tr>
                      <tr className={styles.bsSub}>
                        <td>Buildings and equipment, net</td>
                        <td>{fmt(bs.buildingValue)}</td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td>Buildings (construction + upgrades)</td>
                      <td>{fmt(bs.buildingValue)}</td>
                    </tr>
                  )}
                  {bs.cip !== undefined && (
                    <tr title="Construction paid for but not finished: not depreciated until the building opens.">
                      <td>Construction in progress</td>
                      <td>{fmt(bs.cip)}</td>
                    </tr>
                  )}
                  <tr className={styles.bsTotal}>
                    <td>Total assets</td>
                    <td>{fmt(bs.totalAssets)}</td>
                  </tr>
                </tbody>
              </table>
          <div className={styles.assetMix}>
            <div className={shared.toolbarLabel}>Where the assets are</div>
            <StackedBar
              height={14}
              format={(v) => money(v, 1)}
              segments={[
                { label: 'Cash', value: bs.cash, color: '#5AA7D8' },
                { label: 'Inventory', value: bs.inventoryValue, color: '#61C28F' },
                { label: 'Buildings', value: bs.buildingValue, color: '#D7B766' },
                ...(bs.landValue !== undefined ? [{ label: 'Land', value: bs.landValue, color: '#CC79A7' }] : []),
                ...(bs.cip !== undefined ? [{ label: 'Under construction', value: bs.cip, color: '#E69F00' }] : []),
              ]}
            />
          </div>
            </Panel>
            <Panel title="Liabilities and equity" padding="none" variant="solid">
              <table className={styles.bsTable} data-testid="bs-liabilities">
                <tbody>
                  <tr className={styles.bsSection}>
                    <td colSpan={2}>Liabilities</td>
                  </tr>
                  {liabilities.length === 0 && (
                    <tr className={styles.bsIndent}>
                      <td>No debt</td>
                      <td>{fmt(0)}</td>
                    </tr>
                  )}
                  {liabilities.map((l, i) => (
                    <tr key={`${l.kind}-${i}`} className={styles.bsIndent}>
                      <td>{l.label}</td>
                      <td>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className={styles.bsSub}>
                    <td>Total liabilities</td>
                    <td>{fmt(bs.liabilities)}</td>
                  </tr>
                  <tr className={styles.bsSection}>
                    <td colSpan={2}>Equity</td>
                  </tr>
                  <tr className={styles.bsIndent}>
                    <td>Paid-in capital</td>
                    <td>{fmt(bs.startingCapital)}</td>
                  </tr>
                  <tr className={styles.bsIndent}>
                    <td>Retained earnings</td>
                    <td>{fmt(bs.retainedEarnings)}</td>
                  </tr>
                  {Math.abs(bs.drift) >= 0.01 && (
                    <tr className={styles.bsIndent}>
                      <td>Unreconciled difference</td>
                      <td className={shared.neg}>{fmt(bs.drift)}</td>
                    </tr>
                  )}
                  <tr className={styles.bsSub}>
                    <td>Total equity</td>
                    <td>{fmt(bs.equity)}</td>
                  </tr>
                  <tr className={styles.bsTotal}>
                    <td>Liabilities + equity</td>
                    <td>{fmt(bs.liabilities + bs.equity)}</td>
                  </tr>
                </tbody>
              </table>
            </Panel>
          </div>


          {isPlayer && <Drilldown buildings={bs.buildings ?? []} inventory={bs.inventoryByBuilding ?? []} depreciates={bs.accumulatedDepreciation !== undefined} />}
        </div>

        <div className={shared.stack}>
          <Panel title="Books close" padding="md" variant="solid" accent data-testid="bs-books">
            <div className={styles.books}>
              {bs.booksClose ? <CheckCircle2 size={18} color="var(--c-green)" /> : <XCircle size={18} color="var(--c-red)" />}
              <b>{bs.booksClose ? 'Balanced' : 'Out of balance'}</b>
            </div>
            <p className={`${shared.small} ${shared.muted}`} style={{ margin: '8px 0 0' }}>
              {fmt(bs.totalAssets)} assets − {fmt(bs.liabilities)} liabilities = {fmt(bs.equity)} equity
              {bs.booksClose ? ', which equals paid-in capital plus every month’s net income.' : `; ${fmt(bs.drift)} is unexplained.`}
            </p>
            {Math.abs(bs.engineBuildingValue - bs.buildingValue) >= 1 && (
              <Note tone="warn" className={shared.small}>
                The engine values buildings at {fmt(bs.engineBuildingValue)}; this sheet capitalises upgrades ({fmt(bs.buildingValue)}).
              </Note>
            )}
          </Panel>
          <Panel title="Ratios" padding="md" variant="solid">
            <div className={shared.stackTight}>
              <Ratio label="Debt to equity" value={bs.equity > 0 ? (bs.liabilities / bs.equity).toFixed(2) : '—'} />
              <Ratio label="Cash share of assets" value={bs.totalAssets > 0 ? pct(bs.cash / bs.totalAssets, Math.abs(bs.cash / bs.totalAssets) < 0.1 ? 1 : 0) : '—'} />
              <Ratio label="Return on paid-in capital" value={bs.startingCapital > 0 ? pct(bs.retainedEarnings / bs.startingCapital) : '—'} />
            </div>
          </Panel>
          {tax && (
            <Panel title="Tax position" padding="md" variant="solid" data-testid="bs-tax">
              <div className={shared.stackTight}>
                <Ratio label="Income tax rate" value={ratePct(tax.taxRate ?? 0, 0)} />
                <Ratio label="Tax paid this year" value={fmt(tax.taxPaidYtd ?? 0)} />
                <Ratio label="Losses carried forward" value={fmt(tax.lossCarryForward ?? 0)} />
              </div>
              <p className={`${shared.small} ${shared.muted}`} style={{ margin: '8px 0 0' }}>
                Past losses shelter up to 80% of future profits from tax. They are not an asset on this sheet.
              </p>
            </Panel>
          )}
          <Panel title="Assets over time" padding="md" variant="solid">
            {series ? (
              <LineChart
                height={180}
                labels={labels}
                yFormat={(v) => money(v, 0)}
                series={[
                  { id: 'assets', label: 'Total assets', values: series.totalAssets ?? [] },
                  { id: 'equity', label: 'Equity', values: series.equity ?? [], area: false, dashed: true },
                  { id: 'cash', label: 'Cash', values: series.cash ?? [], area: false },
                ]}
              />
            ) : (
              <LoadingBlock rows={3} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Ratio({ label, value }: { label: string; value: string }) {
  return (
    <div className={shared.meterRow}>
      <span className={shared.muted}>{label}</span>
      <b className={shared.num}>{value}</b>
    </div>
  );
}


function Drilldown({ buildings, inventory, depreciates }: { buildings: BuildingValueDto[]; inventory: BuildingInventoryDto[]; depreciates: boolean }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const [view, setView] = useState<'buildings' | 'inventory'>('buildings');
  const locate = (id: number) => {
    useUiStore.getState().closeOverlay();
    selectBuilding(id);
  };
  return (
    <Panel
      title={view === 'buildings' ? (depreciates ? 'Asset register' : 'Buildings at book value') : 'Inventory by building'}
      padding="none"
      variant="solid"
      actions={
        <span className={shared.chips}>
          <button type="button" className={`${shared.chip} ${view === 'buildings' ? shared.chipOn : ''}`} onClick={() => setView('buildings')}>
            Buildings
          </button>
          <button type="button" className={`${shared.chip} ${view === 'inventory' ? shared.chipOn : ''}`} onClick={() => setView('inventory')} data-testid="bs-inventory-toggle">
            Inventory
          </button>
        </span>
      }
    >
      {view === 'buildings' ? (
        <Table<BuildingValueDto>
          dense
          maxHeight={320}
          rowKey={(b) => b.buildingId}
          rows={buildings}
          defaultSort={{ id: 'book', dir: 'desc' }}
          onRowClick={(b) => locate(b.buildingId)}
          showTotal
          empty="You own no buildings yet."
          columns={[
            { id: 'name', header: 'Building', sortValue: (b) => names.building(b.buildingId), cell: (b) => names.building(b.buildingId), total: 'Total' },
            { id: 'city', header: 'City', sortValue: (b) => names.city(b.cityId), cell: (b) => names.city(b.cityId) },
            { id: 'built', header: 'Construction', numeric: true, sortValue: (b) => b.constructionCost, cell: (b) => fmt(b.constructionCost), total: fmt(sum(buildings, (b) => b.constructionCost)) },
            { id: 'up', header: 'Upgrades', numeric: true, sortValue: (b) => b.upgradeCost, cell: (b) => fmt(b.upgradeCost), total: fmt(sum(buildings, (b) => b.upgradeCost)) },
            ...(depreciates
              ? [
                  {
                    id: 'dep',
                    header: 'Depreciated',
                    numeric: true,
                    sortValue: (b: BuildingValueDto) => b.constructionCost + b.upgradeCost - b.bookValue,
                    cell: (b: BuildingValueDto) => <span className={shared.muted}>{fmt(-(b.constructionCost + b.upgradeCost - b.bookValue))}</span>,
                    total: fmt(-sum(buildings, (b) => b.constructionCost + b.upgradeCost - b.bookValue)),
                  },
                ]
              : []),
            { id: 'book', header: depreciates ? 'Net book value' : 'Book value', numeric: true, sortValue: (b) => b.bookValue, cell: (b) => <b>{fmt(b.bookValue)}</b>, total: fmt(sum(buildings, (b) => b.bookValue)) },
            {
              id: 'go',
              header: '',
              width: 40,
              cell: (b) => <IconButton size="sm" label="Show building" icon={<MapPin size={13} />} onClick={(e) => (e.stopPropagation(), locate(b.buildingId))} />,
            },
          ]}
        />
      ) : (
        <Table<BuildingInventoryDto>
          dense
          maxHeight={320}
          rowKey={(b) => b.buildingId}
          rows={inventory}
          defaultSort={{ id: 'total', dir: 'desc' }}
          onRowClick={(b) => locate(b.buildingId)}
          showTotal
          empty="No stock on hand — every shelf and silo is empty."
          columns={[
            { id: 'name', header: 'Building', sortValue: (b) => names.building(b.buildingId), cell: (b) => names.building(b.buildingId), total: 'Total' },
            { id: 'city', header: 'City', sortValue: (b) => names.city(b.cityId), cell: (b) => names.city(b.cityId) },
            {
              id: 'rows',
              header: 'Stock',
              cell: (b) => (
                <span className={shared.chips}>
                  {b.rows.slice(0, 4).map((r) => (
                    <span key={r.productId} className={shared.chip} title={`${integer(r.quantity)} units at ${fmt(r.unitCost)} each`}>
                      {r.name} · {integer(r.quantity)}
                    </span>
                  ))}
                </span>
              ),
            },
            { id: 'total', header: 'Value at cost', numeric: true, sortValue: (b) => b.total, cell: (b) => <b>{fmt(b.total)}</b>, total: fmt(sum(inventory, (b) => b.total)) },
          ]}
        />
      )}
    </Panel>
  );
}

function sum<T>(rows: readonly T[], f: (r: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}
