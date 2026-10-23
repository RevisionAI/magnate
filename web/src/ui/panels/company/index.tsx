// Company overlay (M): the whole company at a glance — value, cash, profit and
// runway, then every building you own grouped by city with status, units,
// products and last month's profit. Sortable; "Needs attention" filters to idle,
// starved, sold-out and loss-making buildings. Click a row to jump to it (the
// city frames it and the inspector opens).

import clsx from 'clsx';
import { Building2, CircleAlert, Hammer, LocateFixed, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BuildingSummaryDto } from '@/bridge/protocol';
import { bus } from '@/game/events';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Button, EmptyState, IconButton, Money, OverlayFrame, Segmented, Skeleton, Sparkline, Stat, Table, Tooltip, type Column, type SortDir } from '@/ui/components';
import { money, signedMoney } from '@/util/format';
import { useCatalogIndex } from '../_shared-a/catalog';
import { runwayText } from '../_shared-a/numbers';
import { ProductGlyph, StatusBadge, buildingIcon } from '../_shared-a/pieces';
import type { PanelProps } from '../registry';
import { attentionReason, attentionSummary, groupByCity, needsAttention, portfolioTotals } from './companyModel';
import styles from './Company.module.css';

type Filter = 'all' | 'attention';

export default function CompanyPanel(_props: PanelProps) {
  const idx = useCatalogIndex();
  const player = useGameStore((s) => s.hud?.player);
  const history = useGameStore((s) => s.history);
  const q = useEngineQuery('buildings', player ? { ownerId: player.id } : null);
  const mine = useMemo(() => (q.data ?? []).filter((b) => b.ownerId === player?.id), [q.data, player?.id]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>({ id: 'net', dir: 'desc' });
  const groups = useMemo(() => groupByCity(mine, idx.catalog?.cities ?? [], filter), [mine, idx.catalog, filter]);
  const totals = useMemo(() => portfolioTotals(mine), [mine]);
  const netSeries = history.slice(-12).map((h) => h.netIncome);
  const companies = useGameStore((s) => s.hud?.companies ?? []);
  const rank = [...companies].sort((a, b) => b.value - a.value).findIndex((c) => c.isPlayer) + 1;
  const standing = companies.length > 1 && rank > 0 ? `#${rank} of ${companies.length} companies` : undefined;

  const jump = (b: BuildingSummaryDto) => {
    bus.emit('locate', { buildingId: b.id });
    useGameStore.getState().selectBuilding(b.id);
  };

  const columns: Column<BuildingSummaryDto>[] = [
    {
      id: 'name',
      header: 'Building',
      sortValue: (b) => b.name,
      cell: (b) => {
        const Icon = buildingIcon(idx.types.get(b.typeId));
        const reason = attentionReason(b);
        return (
          <span className={styles.nameCell}>
            <span className={styles.typeIcon}>
              <Icon size={13} />
            </span>
            <span className={styles.nameText}>{b.name}</span>
            {reason && (
              <span className={styles.reason}>
                <CircleAlert size={12} />
                {reason}
              </span>
            )}
          </span>
        );
      },
    },
    { id: 'status', header: 'Status', sortValue: (b) => (needsAttention(b) ? 0 : 1), cell: (b) => <StatusBadge status={b.status} />, width: '9.5rem' },
    { id: 'level', header: 'Lv', numeric: true, sortValue: (b) => b.level, cell: (b) => b.level, width: '3rem' },
    { id: 'units', header: 'Units', numeric: true, sortValue: (b) => b.configuredSlots, cell: (b) => (b.slotKind === 'none' ? '—' : `${b.configuredSlots}/${b.capacity}`), width: '4.5rem' },
    {
      id: 'products',
      header: 'Products',
      cell: (b) =>
        b.products.length === 0 ? (
          <span className={styles.dim}>—</span>
        ) : (
          <span className={styles.products}>
            {b.products.slice(0, 5).map((p) => (
              <Tooltip key={p} content={idx.productName(p)} side="top">
                <ProductGlyph product={idx.products.get(p)} size="sm" />
              </Tooltip>
            ))}
            {b.products.length > 5 && <span className={styles.dim}>+{b.products.length - 5}</span>}
          </span>
        ),
    },
    { id: 'opex', header: 'Opex/mo', numeric: true, sortValue: (b) => b.monthlyOpex, cell: (b) => money(b.monthlyOpex), width: '6rem' },
    {
      id: 'net',
      header: 'Net last month',
      numeric: true,
      sortValue: (b) => b.netIncomeThisMonth,
      cell: (b) => <span className={clsx(styles.net, b.netIncomeThisMonth < 0 ? styles.neg : b.netIncomeThisMonth > 0 ? styles.pos : undefined)}>{signedMoney(b.netIncomeThisMonth)}</span>,
      width: '8rem',
    },
    {
      id: 'go',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (b) => (
        <IconButton
          size="sm"
          label="Locate"
          icon={<LocateFixed size={14} />}
          onClick={(e) => {
            e.stopPropagation();
            bus.emit('locate', { buildingId: b.id });
          }}
          tooltipSide="left"
        />
      ),
    },
  ];

  return (
    <OverlayFrame title={player?.name ?? 'Company'} subtitle="Your company at a glance" icon={<Building2 size={18} />} data-testid="panel-company">
      {!player ? (
        <Skeleton height={300} />
      ) : (
        <div className={styles.body}>
          <div className={styles.kpis}>
            <Stat tile label="Company value" value={<Money value={player.value} />} foot={standing} data-testid="company-value" />
            <Stat tile label="Cash" value={<Money value={player.cash} />} foot={player.runwayMonths !== null ? `${runwayText(player.runwayMonths)} of runway` : 'not burning cash'} />
            <Stat
              tile
              label="Net income · last month"
              value={<Money value={player.netIncome} signed colored />}
              spark={netSeries.length > 1 ? <Sparkline values={netSeries} width={120} height={22} variant="bars" tone={netSeries.some((v) => v < 0) ? 'neg' : 'pos'} minSlots={12} /> : undefined}
            />
            <Stat tile label="Buildings" value={totals.count} foot={totals.unitsTotal > 0 ? `${totals.unitsUsed}/${totals.unitsTotal} units in use` : undefined} />
            <Stat tile label="Need attention" value={totals.problems} tone={totals.problems > 0 ? 'warn' : 'default'} foot={attentionSummary(mine)} />
          </div>

          <div className={styles.toolbar}>
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All buildings (${totals.count})` },
                { value: 'attention', label: `Needs attention (${totals.problems})`, icon: <CircleAlert size={12} /> },
              ]}
              label="Filter"
            />
            <span className={styles.spacer} />
            <span className={styles.totalsLine}>
              Opex {money(totals.opex)}/mo · net <span className={totals.netIncome < 0 ? styles.neg : styles.pos}>{signedMoney(totals.netIncome)}</span> last month
            </span>
          </div>

          {q.data === undefined ? (
            <Skeleton height={220} />
          ) : mine.length === 0 ? (
            <EmptyState
              icon={<Building2 size={20} />}
              title="You don’t own any buildings yet"
              body="Open a store where shoppers are waiting — the Build menu suggests where to start."
              action={
                <Button variant="primary" icon={<Hammer size={14} />} onClick={() => (useUiStore.getState().closeOverlay(), useUiStore.getState().openPanel('build'))}>
                  Build (B)
                </Button>
              }
            />
          ) : groups.length === 0 ? (
            <EmptyState compact icon={<CircleAlert size={18} />} title="Nothing needs attention" body="Every building is trading." />
          ) : (
            <div className={styles.groups} data-testid="company-groups">
              {groups.map((g) => (
                <section key={g.cityId} className={styles.group}>
                  <header className={styles.groupHead}>
                    <MapPin size={13} />
                    <span className={styles.groupName}>{g.cityName}</span>
                    <span className={styles.groupMeta}>
                      {g.buildings.length} building{g.buildings.length === 1 ? '' : 's'}
                      {g.problems > 0 && <span className={styles.warn}> · {g.problems} need attention</span>}
                    </span>
                    <span className={styles.spacer} />
                    <span className={clsx(styles.groupNet, g.netIncome < 0 ? styles.neg : styles.pos)}>{signedMoney(g.netIncome)}</span>
                  </header>
                  <Table<BuildingSummaryDto> dense rowKey={(b) => b.id} rows={g.buildings} columns={columns} sort={sort} onSortChange={setSort} onRowClick={jump} />
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </OverlayFrame>
  );
}
