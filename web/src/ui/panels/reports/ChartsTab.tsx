// Charts (UX §6.9): value, cash, revenue, net income, assets, equity,
// buildings, brand and tech over time — yours against every rival — from the
// persisted metrics history, plus your realised share by city and product.

import { useMemo, useState } from 'react';
import type { HistorySeries } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { LineChart, Panel, Segmented, Select, Toggle } from '@/ui/components';
import { addMonths, compact, money, percent } from '@/util/format';
import { ErrorBlock, LoadingBlock, Note } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import heat from './Heatmap.module.css';

const METRICS: { id: HistorySeries; label: string; format: (v: number) => string }[] = [
  { id: 'corporateValue', label: 'Company value', format: (v) => money(v, 1) },
  { id: 'cash', label: 'Cash', format: (v) => money(v, 1) },
  { id: 'revenue', label: 'Revenue / month', format: (v) => money(v, 1) },
  { id: 'netIncome', label: 'Net income / month', format: (v) => money(v, 1) },
  { id: 'totalAssets', label: 'Total assets', format: (v) => money(v, 1) },
  { id: 'equity', label: 'Equity', format: (v) => money(v, 1) },
  { id: 'buildings', label: 'Buildings', format: (v) => compact(v, 0) },
  { id: 'topBrand', label: 'Best brand awareness', format: (v) => `${Math.round(v)}` },
  { id: 'topTech', label: 'Best tech level', format: (v) => `${Math.round(v)}` },
];

type Range = 'all' | '24' | '12';

export function ChartsTab() {
  const names = useNames();
  const [metric, setMetric] = useState<HistorySeries>('corporateValue');
  const [rivals, setRivals] = useState(true);
  const [range, setRange] = useState<Range>('all');
  const companyIds = useMemo(() => {
    const ids = names.companies.slice().sort((a, b) => (a.isPlayer ? -1 : b.isPlayer ? 1 : a.id - b.id)).map((c) => c.id);
    return rivals ? ids : ids.filter((id) => id === names.playerId);
  }, [names.companies, names.playerId, rivals]);
  const { data, error } = useEngineQuery('history', companyIds.length ? { series: [metric], companyIds } : null);
  const def = METRICS.find((m) => m.id === metric)!;
  const cut = range === 'all' ? 0 : Math.max(0, (data?.months ?? 0) - Number(range));
  const labels = data ? Array.from({ length: data.months }, (_, i) => shortMonth(addMonths(data.start, i))).slice(cut) : [];
  const series = (data?.companies ?? []).map((c) => {
    const ref = names.company(c.companyId);
    return { id: String(c.companyId), label: ref.name + (ref.isPlayer ? ' (you)' : ''), values: (c.series[metric] ?? []).slice(cut), color: ref.color, area: ref.isPlayer };
  });

  return (
    <div className={shared.page}>
      <div className={shared.toolbar}>
        <div className={shared.toolbarGroup}>
          <span className={shared.toolbarLabel}>Metric</span>
          <Select<HistorySeries> size="sm" aria-label="Metric" value={metric} options={METRICS.map((m) => ({ value: m.id, label: m.label }))} onChange={setMetric} data-testid="charts-metric" />
        </div>
        <Segmented<Range>
          size="sm"
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '12', label: '12 mo' },
            { value: '24', label: '24 mo' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Toggle size="sm" checked={rivals} onChange={setRivals} label="Against rivals" />
      </div>
      <Panel title={`${def.label}${rivals ? ' — you against your rivals' : ''}`} padding="md" variant="solid">
        {error && !data ? <ErrorBlock error={error} /> : !data ? <LoadingBlock rows={4} chart /> : <LineChart height={300} labels={labels} yFormat={def.format} series={series} aria-label={def.label} />}
        {data?.companies.some((c) => c.missingBefore[metric]) && <Note>Some history starts late: this save predates the metric.</Note>}
      </Panel>
      <ShareHeatmap />
    </div>
  );
}


function ShareHeatmap() {
  const names = useNames();
  const openPanel = useUiStore((s) => s.openPanel);
  const { data } = useEngineQuery('statsDashboard', {});
  const map = data?.shareHeatmap;
  if (!map) return null;
  return (
    <Panel title="Your realised share by market (last month)" padding="md" variant="solid">
      {map.productIds.length === 0 ? (
        <Note>Retail a product to see your share of its market in each city.</Note>
      ) : (
        <div className={heat.wrap}>
          <table className={heat.table}>
            <thead>
              <tr>
                <th />
                {map.productIds.map((p) => (
                  <th key={p}>{names.product(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.cityIds.map((c, ci) => (
                <tr key={c}>
                  <th scope="row">{names.city(c)}</th>
                  {map.productIds.map((p, pi) => {
                    const v = map.share[ci]?.[pi] ?? null;
                    return (
                      <td key={p}>
                        {v === null ? (
                          <span className={heat.none}>no market</span>
                        ) : (
                          <button type="button" className={heat.cell} style={{ background: `rgba(47, 125, 225, ${0.08 + Math.min(1, v) * 0.75})` }} onClick={() => openPanel('markets', { cityId: c, productId: p })}>
                            {percent(v, v < 0.1 ? 1 : 0)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
