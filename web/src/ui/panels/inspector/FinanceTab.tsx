// Finance (UX §6.7.5–6.7.6): the building's accrual P&L in three windows, a
// 12-month net income chart, book value, inventory, the upgrade ladder with its
// cost/benefit, and sell / demolish (EXT `demolish`, confirm first).

import clsx from 'clsx';
import { ArrowUpCircle, Ban, Hammer, Trash2, Tag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { BuildingDetailDto, PnlWindowDto } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useAlertsStore } from '@/state/alertsStore';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { BarChart, Button, Segmented, Table, Tooltip } from '@/ui/components';
import { addMonths, money, monthName, percent, price as fmtPrice, signedMoney } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useCatalogIndex, useFeature } from '../_shared-a/catalog';
import { isFeatureUnavailable, runCommand } from '../_shared-a/commands';
import { disposalConfirmBody, gainText, useDisposalPreview, type DisposalPreviewState } from '../_shared-a/disposal';
import { KeyValues, Notice, ProductGlyph, SectionHead } from '../_shared-a/pieces';
import { upgradeSummary } from './inspectorModel';
import styles from './Inspector.module.css';

type Window = 'thisMonth' | 'last12' | 'sinceOpen';

export function FinanceTab({ detail: d }: { detail: BuildingDetailDto }) {
  const idx = useCatalogIndex();
  const [win, setWin] = useState<Window>('thisMonth');
  const pnl: PnlWindowDto = d.pnl[win];
  const series = d.pnl.monthlyNetIncome;
  const chart = (series?.values ?? []).map((v, i) => {
    const m = addMonths(series.start, i);
    return { label: `${monthName(m.month)}${m.month === 1 ? ` ${String(m.year).slice(2)}` : ''}`, value: v ?? 0 };
  });
  const margin = pnl.revenue > 0 ? pnl.netIncome / pnl.revenue : null;

  return (
    <div className={styles.tab} data-testid="inspector-finance">
      <Segmented<Window>
        size="sm"
        full
        value={win}
        onChange={setWin}
        options={[
          { value: 'thisMonth', label: 'Last month' },
          { value: 'last12', label: '12 months' },
          { value: 'sinceOpen', label: 'Since open' },
        ]}
        label="Period"
      />
      <KeyValues
        rows={[
          { label: 'Revenue', value: money(pnl.revenue) },
          { label: 'Cost of goods', value: pnl.cogs ? `−${money(pnl.cogs)}` : money(0) },
          { label: 'Gross profit', value: money(pnl.grossProfit), tone: pnl.grossProfit < 0 ? 'neg' : undefined },
          { label: 'Running costs', value: pnl.opex ? `−${money(pnl.opex)}` : money(0) },
          { label: margin !== null ? `Net income · ${percent(margin, 0)} margin` : 'Net income', value: signedMoney(pnl.netIncome), tone: pnl.netIncome < 0 ? 'neg' : pnl.netIncome > 0 ? 'pos' : undefined, strong: true },
        ]}
      />
      <p className={styles.footNote}>Advertising is company-wide and shows in Reports, not here.</p>

      <section>
        <SectionHead right="net income per month">Last 12 months</SectionHead>
        <BarChart data={chart} height={150} yFormat={(v) => money(v, 1)} signed aria-label="Monthly net income" />
      </section>

      <section>
        <SectionHead>Value</SectionHead>
        <KeyValues
          rows={[
            { label: 'Book value', value: money(d.bookValue), strong: true },
            ...(d.book
              ? [
                  { label: 'Structure & equipment at cost', value: money(d.book.grossPpe) },
                  d.book.upgradeCost > 0.5 && { label: '· of which upgrades', value: money(d.book.upgradeCost) },
                  d.book.accumulatedDepreciation > 0.5 && { label: 'Depreciation to date', value: `−${money(d.book.accumulatedDepreciation)}`, tone: 'neg' as const },
                  d.book.land > 0.5 && { label: 'Land at cost', value: money(d.book.land) },
                  d.book.constructionInProgress > 0.5 && { label: 'Construction in progress', value: money(d.book.constructionInProgress) },
                ]
              : [
                  { label: 'Construction cost', value: money(d.constructionCost) },
                  d.bookValue - d.constructionCost > 0.5 && { label: 'Upgrades', value: money(d.bookValue - d.constructionCost) },
                ]),
            d.inventoryTotals && { label: 'Stock at cost', value: money(d.inventoryTotals.raw.cost + d.inventoryTotals.intermediate.cost + d.inventoryTotals.finished.cost) },
          ]}
        />
      </section>

      {d.inventory.length > 0 && (
        <section>
          <SectionHead>Inventory</SectionHead>
          <Table
            dense
            rowKey={(r) => r.productId}
            rows={d.inventory}
            defaultSort={{ id: 'value', dir: 'desc' }}
            columns={[
              {
                id: 'product',
                header: 'Product',
                cell: (r) => (
                  <span className={styles.invName}>
                    <ProductGlyph product={idx.products.get(r.productId)} size="sm" />
                    {r.name}
                  </span>
                ),
              },
              { id: 'qty', header: 'Qty', numeric: true, cell: (r) => compact(r.quantity) },
              { id: 'wac', header: 'Unit cost', numeric: true, cell: (r) => fmtPrice(r.unitCost) },
              { id: 'value', header: 'Value', numeric: true, sortValue: (r) => r.cost, cell: (r) => money(r.cost) },
              { id: 'q', header: 'Quality', numeric: true, cell: (r) => r.quality.toFixed(0), hint: 'Average quality on hand (0–100)' },
            ]}
          />
        </section>
      )}

      {d.isPlayer && <UpgradeCard detail={d} />}
      {d.isPlayer && <Disposal detail={d} />}
    </div>
  );
}

function UpgradeCard({ detail: d }: { detail: BuildingDetailDto }) {
  const [busy, setBusy] = useState(false);
  const cash = useGameStore((s) => s.hud?.player?.cash ?? 0);
  const type = useCatalogIndex().types.get(d.typeId);
  const sum = upgradeSummary(d);
  const ladder = type?.levels ?? [];

  if (!d.upgrade || !sum) {
    return (
      <section>
        <SectionHead>Upgrades</SectionHead>
        <Notice tone="info">{d.maxLevel > 1 && d.level >= d.maxLevel ? `Top level reached (level ${d.level}).` : 'This building type has no upgrades.'}</Notice>
      </section>
    );
  }
  const up = d.upgrade;
  const run = async () => {
    const answer = await useUiStore.getState().confirm({
      title: `Upgrade to level ${up.toLevel}?`,
      body: `Costs ${money(up.cost)} now (capitalised into the building). Units ${d.capacity} → ${up.capacity}; running cost ${money(d.monthlyOpex)} → ${money(up.monthlyOpex)}/mo.`,
      confirmLabel: `Upgrade · ${money(up.cost)}`,
    });
    if (answer !== 'confirm') return;
    setBusy(true);
    await runCommand('upgradeBuilding', { buildingId: d.id });
    setBusy(false);
  };

  return (
    <section className={styles.upgrade} data-testid="inspector-upgrade">
      <SectionHead right={`level ${d.level} of ${d.maxLevel}`}>Upgrade</SectionHead>
      {ladder.length > 1 && (
        <div className={styles.ladder}>
          {ladder.map((l) => (
            <div key={l.level} className={clsx(styles.rung, l.level <= d.level && styles.rungDone, l.level === up.toLevel && styles.rungNext)}>
              <span className={styles.rungLevel}>Lv {l.level}</span>
              <span className={styles.rungCap}>{l.capacity} units</span>
              <span className={styles.rungOpex}>{money(l.monthlyOperatingCost)}/mo</span>
            </div>
          ))}
        </div>
      )}
      <KeyValues
        rows={[
          { label: 'Extra units', value: `+${sum.extraUnits}`, tone: 'pos' },
          { label: 'Running cost', value: `${sum.opexDelta <= 0 ? '−' : '+'}${money(Math.abs(sum.opexDelta))}/mo`, tone: sum.opexDelta <= 0 ? 'pos' : 'neg' },
          sum.paybackMonths !== null && { label: 'Pays back from savings alone', value: `${sum.paybackMonths} months` },
          { label: 'Cost', value: money(up.cost), strong: true },
        ]}
      />
      <Button variant="primary" full icon={<ArrowUpCircle size={15} />} disabled={!up.affordable || !!d.construction} loading={busy} onClick={() => void run()} data-testid="inspector-upgrade-button" sound="confirm">
        {up.affordable ? `Upgrade to level ${up.toLevel}` : `Need ${money(up.cost - cash)} more cash`}
      </Button>
    </section>
  );
}

function Disposal({ detail: d }: { detail: BuildingDetailDto }) {
  const demolish = useFeature('demolish');
  const constructionTime = useFeature('constructionTime');
  const [busy, setBusy] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const name = useGameStore((s) => s.buildings.find((b) => b.id === d.id)?.name) ?? d.typeName;
  const building = d.construction !== undefined && d.construction !== null;
  const allowed = demolish && !unavailable && d.actions.canDemolish !== false && !building;
  const sale = useDisposalPreview(d.id, 'sale', allowed);
  const demolition = useDisposalPreview(d.id, 'demolition', allowed);
  const rulesOff = sale.status === 'unavailable' || demolition.status === 'unavailable';
  const enabled = allowed && !rulesOff;

  const dispose = async (method: 'sellBuilding' | 'demolishBuilding' | 'cancelConstruction') => {
    const verb = method === 'sellBuilding' ? 'Sell' : method === 'demolishBuilding' ? 'Demolish' : 'Cancel construction of';
    const preview = method === 'sellBuilding' ? sale : method === 'demolishBuilding' ? demolition : null;
    const body =
      method === 'cancelConstruction'
        ? `Construction stops and the site is cleared. ${d.construction ? `${money(d.construction.costPaid)} has been paid so far.` : ''}`
        : preview?.status === 'ready'
          ? disposalConfirmBody(preview.preview, method === 'sellBuilding' ? 'sale' : 'demolition')
          : `Its book value is ${money(d.bookValue)}; ${method === 'sellBuilding' ? 'the sale price may differ' : 'demolition recovers little of it'}. This can’t be undone.`;
    const answer = await useUiStore.getState().confirm({ title: `${verb} this ${d.typeName.toLowerCase()}?`, body, confirmLabel: verb, tone: 'danger' });
    if (answer !== 'confirm') return;
    setBusy(method);
    const res = await runCommand(method, { buildingId: d.id }, { quiet: true });
    setBusy(null);
    if (!res.ok) {
      if (isFeatureUnavailable(res.error)) setUnavailable(true);
      else useUiStore.getState().confirm({ title: 'That didn’t work', body: res.message, confirmLabel: 'OK' });
      return;
    }
    const received = res.result.proceeds;
    if (received > 0) fx.popup({ text: signedMoney(received), tone: 'gain', anchor: 'topbar.cash' });
    useAlertsStore.getState().notify({
      kind: `dispose.${method}`,
      severity: 'success',
      title: method === 'sellBuilding' ? `${name} sold` : method === 'demolishBuilding' ? `${name} demolished` : `${name} cancelled`,
      body: `${money(received)} received${Math.abs(res.result.gainOrLoss) >= 0.005 ? ` (${gainText(res.result)})` : ''}.`,
      record: false,
    });
    useGameStore.getState().selectBuilding(null);
  };

  return (
    <section className={styles.disposal} data-testid="inspector-disposal">
      <SectionHead>Sell or close</SectionHead>
      {d.construction && constructionTime && (
        <Button size="sm" variant="danger" icon={<Ban size={14} />} loading={busy === 'cancelConstruction'} onClick={() => void dispose('cancelConstruction')}>
          Cancel construction
        </Button>
      )}
      <div className={styles.disposalRow}>
        <DisposalOption
          enabled={enabled}
          state={sale}
          icon={<Tag size={14} />}
          label="Sell building"
          hint="Land, structure and stock as a going concern"
          loading={busy === 'sellBuilding'}
          onClick={() => void dispose('sellBuilding')}
          testId="inspector-sell"
        />
        <DisposalOption
          enabled={enabled}
          state={demolition}
          icon={<Trash2 size={14} />}
          label="Demolish"
          hint="Scrap the structure, sell the cleared land"
          loading={busy === 'demolishBuilding'}
          onClick={() => void dispose('demolishBuilding')}
          testId="inspector-demolish"
        />
      </div>
      {!enabled && (
        <p className={styles.footNote}>
          <Hammer size={11} />{' '}
          {building
            ? 'You can sell or demolish it once it is built.'
            : rulesOff
              ? 'Selling and demolishing are part of the Realistic economy rules; this game uses Classic rules.'
              : 'Selling and demolishing arrive with the land market in a later update.'}
        </p>
      )}
    </section>
  );
}

function DisposalOption({
  enabled,
  state,
  icon,
  label,
  hint,
  loading,
  onClick,
  testId,
}: {
  enabled: boolean;
  state: DisposalPreviewState;
  icon: ReactNode;
  label: string;
  hint: string;
  loading: boolean;
  onClick: () => void;
  testId: string;
}) {
  const ready = enabled && state.status === 'ready' ? state.preview : null;
  return (
    <div className={clsx(styles.disposalOption, !enabled && styles.disposalOff)}>
      <span className={styles.disposalHint}>{hint}</span>
      {ready ? (
        <span className={styles.disposalValue}>
          <strong>{money(ready.proceeds)}</strong>
          <span className={ready.gainOrLoss < 0 ? styles.neg : ready.gainOrLoss > 0 ? styles.pos : styles.dim}>{gainText(ready)}</span>
        </span>
      ) : enabled && state.status === 'loading' ? (
        <span className={styles.disposalValue}>
          <span className={styles.dim}>Valuing…</span>
        </span>
      ) : null}
      <DisposalButton enabled={enabled} icon={icon} label={label} loading={loading} onClick={onClick} testId={testId} />
    </div>
  );
}

function DisposalButton({ enabled, icon, label, loading, onClick, testId }: { enabled: boolean; icon: ReactNode; label: string; loading: boolean; onClick: () => void; testId: string }) {
  const button = (
    <Button size="sm" variant="danger" icon={icon} disabled={!enabled} loading={loading} onClick={onClick} data-testid={testId}>
      {label}
    </Button>
  );
  return enabled ? button : <Tooltip content="Not available in this version yet.">{button}</Tooltip>;
}
