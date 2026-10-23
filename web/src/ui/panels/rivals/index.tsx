// Rivals overlay (V) — UX §6.13. Who you compete with: the league table and
// company value over time, then one profile per rival — strategy in plain
// words, value and footprint, the cities and buildings they run, the markets
// you contest (their share against yours, a threat level) and a timeline of
// their moves with Locate. Rivals' books stay private (no ledger): public
// statements open in Reports.

import { ChartLine, MapPin, ShoppingBasket } from 'lucide-react';
import { useMemo } from 'react';
import type { BuildingSummaryDto, GameEventDto, MarketRowDto } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import type { CompanyView } from '@/state/hud';
import { ARCHETYPES, normalizeArchetype } from '@/state/scenarios';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, Emblem, IconButton, LineChart, Meter, OverlayFrame, Panel, Table } from '@/ui/components';
import { addMonths, money, monthName } from '@/util/format';
import { CompanyTag, LoadingBlock, Note, pct, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import { useEngineQueries } from '../_shared-b/useEngineQueries';
import type { PanelProps } from '../registry';
import { contestedMarkets, threatLevel } from './threat';
import styles from './Rivals.module.css';
import { dropColumns, useNarrow } from '../_shared-b/useNarrow';

export default function RivalsPanel({ params }: PanelProps) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const scenarioId = useGameStore((s) => s.hud?.scenario?.id);
  const scenarios = useGameStore((s) => s.scenarios);
  const competitors = scenarios.find((sc) => sc.id === scenarioId)?.competitors ?? [];
  const strategyOf = (c: CompanyView) => c.strategy ?? competitors.find((k) => k.name === c.name)?.strategy ?? null;
  const companies = names.companies;
  const rivals = useMemo(() => companies.filter((c) => !c.isPlayer).sort((a, b) => b.value - a.value), [companies]);
  const focus = typeof params.companyId === 'number' ? params.companyId : null;

  const buildingArgs = useMemo(() => rivals.map((r) => ({ ownerId: r.id })), [rivals]);
  const rivalBuildings = useEngineQueries('buildings', buildingArgs);
  const { data: intel } = useEngineQuery('marketIntel', {});
  const { data: feed } = useEngineQuery('activityFeed', { limit: 400 });
  const ids = companies.map((c) => c.id);
  const { data: hist } = useEngineQuery('history', ids.length ? { series: ['corporateValue'], companyIds: ids } : null);
  const ranked = companies.slice().sort((a, b) => b.value - a.value);
  const narrow = useNarrow();
  const allBuildings = useGameStore((s) => s.buildings);
  const playerCities = useMemo(() => new Set(allBuildings.filter((b) => b.ownerId === names.playerId).map((b) => b.cityId)), [allBuildings, names.playerId]);

  return (
    <OverlayFrame subtitle="Know who you are up against" data-testid="panel-rivals">
      <div className={shared.page}>
        <div className={shared.split}>
          <Panel title="League table" padding="none" variant="solid" data-testid="rivals-league">
            <Table<CompanyView>
              rowKey={(c) => c.id}
              rows={ranked}
              columns={dropColumns(narrow, ['a'], [
                { id: 'rank', header: '#', width: 32, cell: (_, i) => <b>{i + 1}</b> },
                { id: 'n', header: 'Company', cell: (c) => <CompanyTag company={names.company(c.id)} /> },
                {
                  id: 'a',
                  header: 'Strategy',
                  cell: (c) => {
                    const s = strategyOf(c);
                    return c.isPlayer ? <span className={shared.dim}>You</span> : s ? ARCHETYPES[normalizeArchetype(s)].label : '—';
                  },
                },
                { id: 'v', header: 'Company value', numeric: true, cell: (c) => <b>{fmt(c.value)}</b> },
                { id: 'r', header: 'Revenue / mo', numeric: true, cell: (c) => fmt(c.revenue) },
                { id: 'ni', header: 'Net income, 12 mo', numeric: true, cell: (c) => (c.netIncomeLast12 === null ? '—' : <span className={c.netIncomeLast12 >= 0 ? shared.pos : shared.neg}>{fmt(c.netIncomeLast12, { signed: true })}</span>) },
                { id: 'b', header: 'Buildings', numeric: true, cell: (c) => c.buildings },
              ])}
            />
          </Panel>
          <Panel title="Company value over time" padding="md" variant="solid">
            {hist ? (
              <LineChart
                height={Math.max(120, Math.min(200, 40 + ranked.length * 36))}
                labels={Array.from({ length: hist.months }, (_, i) => shortMonth(addMonths(hist.start, i)))}
                yFormat={(v) => money(v, 0)}
                series={hist.companies
                  .slice()
                  .sort((a, b) => (a.companyId === names.playerId ? -1 : b.companyId === names.playerId ? 1 : 0))
                  .map((c) => {
                    const ref = names.company(c.companyId);
                    return { id: String(c.companyId), label: ref.name, values: c.series.corporateValue ?? [], color: ref.color, area: ref.isPlayer };
                  })}
              />
            ) : (
              <LoadingBlock rows={3} chart />
            )}
          </Panel>
        </div>

        {rivals.length === 0 ? (
          <Note>No rivals in this game — the market is yours to lose.</Note>
        ) : (
          <div className={styles.cards}>
            {rivals.map((r, i) => (
              <RivalCard
                key={r.id}
                rival={r}
                strategy={strategyOf(r)}
                buildings={rivalBuildings.data[i]}
                intel={intel?.rows ?? null}
                feed={feed?.events ?? null}
                focused={focus === r.id}
                playerCities={playerCities}
              />
            ))}
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}

function RivalCard({
  rival,
  strategy,
  buildings,
  intel,
  feed,
  focused,
  playerCities,
}: {
  rival: CompanyView;
  strategy: string | null;
  buildings: BuildingSummaryDto[] | undefined;
  intel: MarketRowDto[] | null;
  feed: GameEventDto[] | null;
  focused: boolean;
  playerCities: Set<string>;
}) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const openPanel = useUiStore((s) => s.openPanel);
  const archetype = strategy ? ARCHETYPES[normalizeArchetype(strategy)] : null;
  const ref = names.company(rival.id);
  const byCity = new Map<string, number>();
  const products = new Set<string>();
  for (const b of buildings ?? []) {
    byCity.set(b.cityId, (byCity.get(b.cityId) ?? 0) + 1);
    for (const p of b.products) products.add(p);
  }
  const contested = intel ? contestedMarkets(intel, rival.id) : [];
  const threat = threatLevel(contested);
  const moves = (feed ?? []).filter((e) => e.companyId === rival.id && e.priority >= 1).slice(-6).reverse();
  const locate = (e: GameEventDto) => {
    useUiStore.getState().closeOverlay();
    if (e.cityId) useGameStore.getState().setActiveCity(e.cityId);
    fx.locate({ buildingId: e.buildingId, cityId: e.cityId });
  };

  return (
    <Panel padding="none" variant="solid" accent={focused} className={styles.card} data-testid={`rival-${rival.id}`}>
      <div className={styles.cardHead} style={{ ['--rival' as string]: ref.color }}>
        <Emblem shape={ref.emblem} color={ref.color} size={34} />
        <div className={styles.cardTitle}>
          <div className={styles.cardName}>{rival.name}</div>
          <div className={styles.cardType}>{archetype ? archetype.label : 'Competitor'}</div>
        </div>
        <div className={styles.cardValue}>
          <span className={shared.toolbarLabel}>Value</span>
          <b>{fmt(rival.value)}</b>
        </div>
      </div>
      {archetype && <p className={styles.blurb}>“{archetype.blurb}”</p>}
      <div className={styles.facts}>
        <Fact label="Cash" value={fmt(rival.cash)} />
        <Fact label="Revenue / mo" value={fmt(rival.revenue)} />
        <Fact label="Net / mo" value={fmt(rival.netIncome, { signed: true })} tone={rival.netIncome >= 0 ? 'pos' : 'neg'} />
        <Fact label="Buildings" value={String(rival.buildings)} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Where they operate</div>
        {buildings === undefined ? (
          <LoadingBlock rows={1} />
        ) : byCity.size === 0 ? (
          <span className={shared.dim}>No buildings yet</span>
        ) : (
          <div className={shared.chips}>
            {[...byCity.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([city, n]) => (
                <button key={city} type="button" className={`${shared.chip} ${playerCities.has(city) ? styles.chipShared : ''}`} onClick={() => (useUiStore.getState().closeOverlay(), useGameStore.getState().setActiveCity(city), fx.locate({ cityId: city }))} title={playerCities.has(city) ? 'You operate here too' : undefined}>
                  <MapPin size={10} /> {names.city(city)} · {n}
                </button>
              ))}
          </div>
        )}
        {products.size > 0 && (
          <div className={shared.chips} style={{ marginTop: 6 }}>
            {[...products].map((p) => (
              <span key={p} className={shared.chip}>
                {names.product(p)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Contested with you
          <span className={styles.threat}>
            Threat
            <Meter value={threat.score} segments={5} thresholds={[{ at: 0, tone: 'success' }, { at: 0.4, tone: 'warning' }, { at: 0.7, tone: 'danger' }]} label="Threat level" />
            <span>{threat.label}</span>
          </span>
        </div>
        {contested.length === 0 ? (
          <span className={`${shared.small} ${shared.dim}`}>They lead none of your markets.</span>
        ) : (
          <div className={styles.contested}>
            {contested.slice(0, 4).map((m) => (
              <button key={`${m.cityId}:${m.productId}`} type="button" className={styles.contestRow} onClick={() => openPanel('markets', { cityId: m.cityId, productId: m.productId })}>
                <span className={styles.contestName}>
                  {names.product(m.productId)} · {names.city(m.cityId)}
                </span>
                <span className={styles.shareBar} aria-label={`Them ${pct(m.theirShare, 0)}, you ${pct(m.yourShare, 0)}`}>
                  <span style={{ width: `${m.theirShare * 100}%`, background: ref.color }} />
                  <span style={{ width: `${m.yourShare * 100}%`, background: 'var(--owner-0)' }} />
                </span>
                <span className={styles.contestNums}>
                  {pct(m.theirShare, 0)} <span className={shared.dim}>vs</span> {pct(m.yourShare, 0)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Latest moves</div>
        {feed === null ? (
          <LoadingBlock rows={2} />
        ) : moves.length === 0 ? (
          <span className={`${shared.small} ${shared.dim}`}>Nothing notable yet.</span>
        ) : (
          <ul className={styles.moves}>
            {moves.map((e) => (
              <li key={e.seq}>
                <span className={styles.moveDate}>
                  {monthName(e.month.month)} {String(e.month.year).slice(2)}
                </span>
                <span className={styles.moveText}>{e.message}</span>
                {(e.buildingId !== undefined || e.cityId) && <IconButton size="sm" label="Locate" icon={<MapPin size={12} />} onClick={() => locate(e)} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.cardFoot}>
        <Button size="sm" variant="ghost" icon={<ChartLine size={13} />} onClick={() => openPanel('reports', { tab: 'pnl', companyId: rival.id })}>
          Public statements
        </Button>
        <Button size="sm" variant="ghost" icon={<ShoppingBasket size={13} />} onClick={() => openPanel('markets', {})}>
          Markets
        </Button>
        {threat.score >= 0.4 && <Badge tone="warning">Watch closely</Badge>}
      </div>
    </Panel>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className={styles.fact}>
      <span className={shared.toolbarLabel}>{label}</span>
      <b className={tone === 'pos' ? shared.pos : tone === 'neg' ? shared.neg : undefined}>{value}</b>
    </div>
  );
}
