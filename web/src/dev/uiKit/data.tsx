// UiKit — data display: KPI tiles, money/delta/percent formatters, progress and
// meters, badges, the sortable table and the SVG charts.

import { Coins, Landmark, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge, BarChart, Delta, LineChart, Meter, Money, Percent, Progress, Sparkline, StackedBar, Stat, Table, type Column } from '@/ui/components';
import { money } from '@/util/format';
import styles from './UiKit.module.css';
import { Group } from './shared';

const NI = [-120e3, -60e3, 15e3, 80e3, 135e3, 210e3, 190e3, 260e3, 310e3, 280e3, 412e3, 455e3];
const CASH = [15e6, 13.8e6, 13.2e6, 13.3e6, 13.5e6, 13.9e6, 14.2e6, 14.5e6, 15.1e6, 15.6e6, 16.2e6, 16.9e6];
const MONTHS = ['Jan 26', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface BuildingRow {
  id: number;
  name: string;
  city: string;
  level: number;
  sold: number;
  ni: number;
}

const ROWS: BuildingRow[] = [
  { id: 1, name: 'Harbor Supermarket', city: 'Metropolis', level: 2, sold: 1_300_000, ni: 412_000 },
  { id: 2, name: 'Downtown Convenience', city: 'Metropolis', level: 1, sold: 240_000, ni: 38_500 },
  { id: 3, name: 'Hilltown Supermarket', city: 'Hilltown', level: 1, sold: 410_000, ni: -12_400 },
  { id: 4, name: 'Bottling Plant', city: 'Portbay', level: 3, sold: 2_100_000, ni: 205_900 },
  { id: 5, name: 'Bread Warehouse', city: 'Metropolis', level: 1, sold: 0, ni: -9_000 },
];

const COLUMNS: Column<BuildingRow>[] = [
  { id: 'name', header: 'Building', sortValue: (r) => r.name, cell: (r) => r.name, total: 'Total' },
  { id: 'city', header: 'City', sortValue: (r) => r.city, cell: (r) => r.city },
  { id: 'level', header: 'Lv', numeric: true, sortValue: (r) => r.level, cell: (r) => r.level, hint: 'Building level' },
  { id: 'sold', header: 'Sold / mo', numeric: true, sortValue: (r) => r.sold, cell: (r) => (r.sold ? r.sold.toLocaleString('en-US') : '—') },
  {
    id: 'ni',
    header: 'Net / mo',
    numeric: true,
    sortValue: (r) => r.ni,
    cell: (r) => <Money value={r.ni} signed colored />,
    total: <Money value={ROWS.reduce((s, r) => s + r.ni, 0)} signed colored />,
  },
];

export function DataDisplay() {
  const [selected, setSelected] = useState<number | null>(1);
  return (
    <>
      <Group title="KPI tiles (Stat)">
        <div className={styles.grid4}>
          <Stat tile label="Cash" icon={<Wallet size={13} />} value={<Money value={13_940_000} />} delta={<Delta value={135_000} />} foot="Runway: not burning cash" spark={<Sparkline values={CASH} tone="gold" width={180} height={28} />} />
          <Stat tile label="Company value" icon={<Landmark size={13} />} value={<Money value={15_140_000} />} delta={<Delta value={0.009} kind="percent" />} foot="Book equity" />
          <Stat tile label="Net income · month" icon={<Coins size={13} />} value={<Money value={-135_000} signed />} tone="neg" delta={<Delta value={-210_000} />} spark={<Sparkline values={NI} variant="bars" width={180} height={28} />} />
          <Stat tile label="Market share" icon={<TrendingUp size={13} />} value={<Percent value={0.472} />} tone="gold" delta={<Delta value={0.034} kind="percent" />} foot="Soft drink · Metropolis (realised, 3 mo)" tooltipTitle="Realised share" tooltip="Your units sold ÷ all units sold in this market, trailing three months." />
        </div>
      </Group>
      <div className={styles.grid2}>
        <Group title="Money · Delta · Percent">
          <div className={styles.card}>
            <div className={styles.row}>
              <Money value={13_940_000} />
              <Money value={412_000} signed colored />
              <Money value={-135_000} signed colored />
              <Money value={0} signed />
              <Money value={1_234_567} exact />
              <Percent value={0.553} />
            </div>
            <div className={styles.row} style={{ marginTop: 10 }}>
              <Delta value={135_000} />
              <Delta value={-48_000} />
              <Delta value={0} />
              <Delta value={null} />
              <Delta value={0.009} kind="percent" />
              <Delta value={12_000} invert />
              <Delta value={-0.04} kind="percent" arrowOnly />
              <Delta value={2400} kind="number" />
            </div>
          </div>
        </Group>
        <Group title="Badges">
          <div className={styles.card}>
            <div className={styles.row}>
              <Badge>Neutral</Badge>
              <Badge tone="gold">Yours</Badge>
              <Badge tone="info">Info</Badge>
              <Badge tone="success">Reach once</Badge>
              <Badge tone="warning">Hold</Badge>
              <Badge tone="danger">Insolvent in 5 mo</Badge>
              <Badge tone="opportunity">Opportunity</Badge>
            </div>
            <div className={styles.row} style={{ marginTop: 10 }}>
              <Badge tone="gold" variant="solid">
                Tutorial
              </Badge>
              <Badge tone="danger" variant="solid">
                Critical
              </Badge>
              <Badge tone="success" dot>
                Profitable
              </Badge>
              <Badge tone="warning" dot>
                Stock-out
              </Badge>
              <Badge count={3} variant="solid" tone="danger" />
              <Badge count={128} variant="solid" tone="warning" />
              <Badge square tone="info">
                Lv 3
              </Badge>
            </div>
          </div>
        </Group>
      </div>
      <div className={styles.grid2}>
        <Group title="Progress">
          <div className={styles.card}>
            <Progress value={0.71} label="First profit" valueLabel />
            <div style={{ height: 10 }} />
            <Progress value={0.42} tone="info" size="sm" label="Research: Soft drink tech 4" valueLabel="ETA 3 mo" />
            <div style={{ height: 10 }} />
            <Progress value={0.9} tone="warning" size="lg" striped label="Construction" valueLabel="27 / 30 days" />
            <div style={{ height: 10 }} />
            <Progress value={0.18} tone="danger" label="Runway" valueLabel="0.9 mo" />
            <div style={{ height: 10 }} />
            <Progress value={0} indeterminate tone="neutral" label="Loading" />
          </div>
        </Group>
        <Group title="Meter (segmented gauge)">
          <div className={styles.card}>
            {[0.15, 0.48, 0.86].map((v) => (
              <div key={v} className={styles.row} style={{ marginBottom: 10 }}>
                <span className={styles.typeMeta} style={{ width: 80 }}>
                  {Math.round(v * 100)}%
                </span>
                <Meter
                  value={v}
                  label="Runway"
                  thresholds={[
                    { at: 0, tone: 'danger' },
                    { at: 0.34, tone: 'warning' },
                    { at: 0.67, tone: 'success' },
                  ]}
                />
              </div>
            ))}
          </div>
        </Group>
      </div>
      <Group title="Table — sortable, numeric alignment, sticky header, selection, total row">
        <div className={styles.grid2}>
          <div className={styles.card}>
            <Table<BuildingRow>
              columns={COLUMNS}
              rows={ROWS}
              rowKey={(r) => r.id}
              defaultSort={{ id: 'ni', dir: 'desc' }}
              onRowClick={(r) => setSelected(r.id)}
              selectedKey={selected}
              maxHeight={220}
              showTotal
              aria-label="Your buildings"
            />
          </div>
          <div className={styles.card}>
            <Table<BuildingRow> columns={COLUMNS} rows={[]} rowKey={(r) => r.id} dense empty="You don’t own any buildings yet — press B to build." aria-label="Empty table" />
          </div>
        </div>
      </Group>
    </>
  );
}

export function Charts() {
  return (
    <>
      <div className={styles.grid2}>
        <Group title="Line chart (multi-series, hover crosshair)">
          <div className={styles.card}>
            <LineChart
              labels={MONTHS}
              yFormat={(v) => money(v, 1)}
              series={[
                { id: 'value', label: 'Company value', values: CASH.map((c, i) => c + 1.2e6 + i * 150e3), area: true },
                { id: 'cash', label: 'Cash', values: CASH },
                { id: 'rival', label: 'LocalCo value', values: CASH.map((_, i) => 9e6 + i * 260e3), dashed: true },
              ]}
              aria-label="Company value vs cash"
            />
          </div>
        </Group>
        <Group title="Bar chart (signed: profit / loss palette)">
          <div className={styles.card}>
            <BarChart data={NI.map((v, i) => ({ label: MONTHS[i]!, value: v }))} signed yFormat={(v) => money(v, 0)} aria-label="Net income by month" />
          </div>
        </Group>
      </div>
      <div className={styles.grid2}>
        <Group title="Stacked bar (composition)">
          <div className={styles.card}>
            <StackedBar
              format={(v) => money(v, 1)}
              segments={[
                { label: 'Cash', value: 9.2e6 },
                { label: 'Buildings', value: 4.1e6 },
                { label: 'Inventory', value: 1.3e6 },
                { label: 'Land', value: 0.6e6 },
              ]}
            />
          </div>
        </Group>
        <Group title="Sparklines">
          <div className={styles.card}>
            <div className={styles.row}>
              <Sparkline values={CASH} tone="gold" width={120} height={28} />
              <Sparkline values={NI} variant="bars" width={120} height={28} />
              <Sparkline values={CASH.map((c) => -c)} tone="neg" area={false} width={120} height={28} />
              <Sparkline values={[1, 2]} tone="info" width={120} height={28} />
              <Sparkline values={[]} width={120} height={28} />
            </div>
          </div>
        </Group>
      </div>
    </>
  );
}
