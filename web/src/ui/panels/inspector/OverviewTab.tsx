// Overview (UX §6.7.1): status and construction, last month's P&L with a
// 12-month net sparkline, one row per unit (sold vs demand, lost, cover,
// utilisation), inline alerts with one-click fixes, and quick actions.

import clsx from 'clsx';
import { ArrowUpCircle, ChevronRight, CircleAlert, HardHat, Lightbulb, Plus, ShoppingBasket, TriangleAlert } from 'lucide-react';
import type { BuildingDetailDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { Button, Progress, Sparkline, Tooltip } from '@/ui/components';
import { money, monthYear, signedMoney } from '@/util/format';
import { useCatalogIndex } from '../_shared-a/catalog';
import { Notice, ProductGlyph, SectionHead } from '../_shared-a/pieces';
import { buildingAlerts, lineRow, type InspectorAlert, type InspectorTab } from './inspectorModel';
import styles from './Inspector.module.css';

const ALERT_ICON = {
  danger: <TriangleAlert size={14} />,
  warning: <CircleAlert size={14} />,
  opportunity: <Lightbulb size={14} />,
  info: <HardHat size={14} />,
} as const;

export function OverviewTab({ detail: d, go }: { detail: BuildingDetailDto; go: (tab: InspectorTab, slotIndex?: number) => void }) {
  const idx = useCatalogIndex();
  const cash = useGameStore((s) => s.hud?.player?.cash ?? 0);
  const alerts = buildingAlerts(d, { productName: idx.productName, cash });
  const last = d.pnl.thisMonth;
  const series = d.pnl.monthlyNetIncome?.values ?? [];
  const rows = d.slots.map(lineRow);
  const now = useGameStore((s) => s.hud?.date);
  // Built this month: nothing has closed yet, so last month's zeros would mislead.
  const fresh = !d.openedAt || (now !== undefined && d.openedAt.year === now.year && d.openedAt.month === now.month && last.revenue === 0 && last.opex === 0);
  const unitWord = d.slotKind === 'retail' ? 'product line' : d.slotKind === 'research' ? 'project' : 'unit';

  return (
    <div className={styles.tab}>
      <div className={styles.factStrip}>
        <span>{d.openedAt ? `Open since ${monthYear(d.openedAt)}` : 'Not open yet'}</span>
        {d.slotKind !== 'none' && (
          <span>
            Units {d.slotsUsed}/{d.capacity}
          </span>
        )}
        <span>Opex {money(d.monthlyOpex)}/mo</span>
        {d.workforce && d.workforce.estimatedMax > 0 && (
          <Tooltip content="Estimate from the building type; staffing arrives with the labour model." side="bottom">
            <span>
              Staff {d.workforce.estimatedMin}–{d.workforce.estimatedMax} (est.)
            </span>
          </Tooltip>
        )}
      </div>

      {d.construction && (
        <div className={styles.construction} data-testid="inspector-construction">
          <Progress
            value={d.construction.progress}
            tone="info"
            striped
            label={<span className={styles.constructionLabel}><HardHat size={13} /> Under construction · opens {monthYear(d.construction.completesAt)}</span>}
            valueLabel
          />
          <div className={styles.constructionFoot}>
            Paid {money(d.construction.costPaid)} · {money(d.construction.costRemaining)} still to pay
          </div>
        </div>
      )}

      <section className={styles.pnlCard}>
        <div className={styles.pnlHead}>
          <span className={styles.pnlTitle}>{fresh ? 'No trading yet · opens at the month close' : `Last month · ${monthYear(last.to)}`}</span>
          {series.length > 1 && (
            <Tooltip content="Net income, last 12 months" side="left">
              <span>
                <Sparkline values={series} width={110} height={26} variant="bars" tone={series.some((v) => (v ?? 0) < 0) ? 'neg' : 'pos'} minSlots={12} aria-label="12-month net income" />
              </span>
            </Tooltip>
          )}
        </div>
        <div className={styles.pnlGrid}>
          <div>
            <span className={styles.pnlLabel}>Revenue</span>
            <span className={styles.pnlValue}>{money(last.revenue)}</span>
          </div>
          <div>
            <span className={styles.pnlLabel}>Gross profit</span>
            <span className={styles.pnlValue}>{money(last.grossProfit)}</span>
          </div>
          <div>
            <span className={styles.pnlLabel}>Net</span>
            <span className={clsx(styles.pnlValue, last.netIncome < 0 ? styles.neg : last.netIncome > 0 ? styles.pos : undefined)} data-testid="inspector-net">
              {signedMoney(last.netIncome)}
            </span>
          </div>
        </div>
        {!fresh && last.revenue === 0 && d.supply.destinations.some((x) => x.kind === 'transfer') && (
          <div className={styles.pnlNote}>Goods shipped to your own buildings move at cost — the profit shows up where they are sold.</div>
        )}
      </section>

      {alerts.length > 0 && (
        <div className={styles.alerts} data-testid="inspector-alerts">
          {alerts.map((a: InspectorAlert) => (
            <Notice
              key={a.id}
              tone={a.tone}
              icon={ALERT_ICON[a.tone]}
              action={
                a.action ? (
                  <Button size="sm" variant="ghost" iconRight={<ChevronRight size={13} />} onClick={() => go(a.action!.tab, a.action!.slotIndex)}>
                    {a.action.label}
                  </Button>
                ) : undefined
              }
            >
              {a.text}
            </Notice>
          ))}
        </div>
      )}

      {d.slotKind !== 'none' && (
        <section>
          <SectionHead right={d.slotKind === 'retail' ? 'sold / demand · stock cover' : undefined}>
            {d.slotKind === 'retail' ? 'Product lines' : d.slotKind === 'research' ? 'Research projects' : 'Units'}
          </SectionHead>
          <div className={styles.lines}>
            {rows.map((r) => {
              const product = idx.products.get(r.slot.productId);
              return (
                <button key={r.slot.index} type="button" className={clsx(styles.line, r.warn && styles.lineWarn)} onClick={() => (d.isPlayer ? go('setup', r.slot.index) : go('layout'))} data-testid={`inspector-line-${r.slot.index}`}>
                  <ProductGlyph product={product} />
                  <span className={styles.lineMain}>
                    <span className={styles.lineName}>{r.slot.productName}</span>
                    <span className={styles.lineVolume}>{r.volume}</span>
                    {r.fill !== null && (
                      <span className={styles.lineBar}>
                        <span className={clsx(styles.lineFill, styles[`fill-${r.fillTone}`])} style={{ width: `${Math.max(2, r.fill * 100)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className={styles.lineSide}>
                    <span className={styles.linePrimary}>{r.primary}</span>
                    <span className={styles.lineStock}>{r.stock}</span>
                  </span>
                  {d.isPlayer && <ChevronRight size={14} className={styles.lineChevron} />}
                </button>
              );
            })}
            {d.isPlayer && d.actions.canAddSlot && d.nextFreeSlotIndex >= 0 && (
              <button type="button" className={clsx(styles.line, styles.lineAdd)} onClick={() => go('setup', d.nextFreeSlotIndex)} data-testid="inspector-add-line">
                <span className={styles.addIcon}>
                  <Plus size={14} />
                </span>
                <span className={styles.lineMain}>
                  <span className={styles.lineName}>Add a {unitWord}</span>
                  <span className={styles.lineVolume}>
                    {d.capacity - d.slotsUsed} free unit{d.capacity - d.slotsUsed === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      {d.isPlayer && (
        <div className={styles.quickActions}>
          {d.upgrade && (
            <Button size="sm" variant="secondary" icon={<ArrowUpCircle size={14} />} onClick={() => go('finance')}>
              Upgrade to Lv {d.upgrade.toLevel} · {money(d.upgrade.cost)}
            </Button>
          )}
          {d.slots[0] && d.slotKind === 'retail' && (
            <Button size="sm" variant="ghost" icon={<ShoppingBasket size={14} />} onClick={() => useUiStore.getState().openPanel('markets', { tab: 'matrix', cityId: d.cityId, productId: d.slots[0].productId })}>
              Market for {d.slots[0].productName}
            </Button>
          )}
        </div>
      )}
      {d.construction === undefined && !d.openedAt && d.isPlayer && <p className={styles.footNote}>Opens at the next month close.</p>}
    </div>
  );
}
