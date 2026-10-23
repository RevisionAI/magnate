// Markets overlay (UX §6.8): every city × finished product, unserved markets
// included. Pick a metric (demand, your realised share, competition, price),
// filter to your markets or contested ones, and open a cell for the detail:
// shoppers by income bracket with price ceilings, supply vs demand, every offer
// with Q/B/T and realised sales, your 12-month share, and deep links into Build,
// Marketing and R&D. The Opportunities tab lists where to enter and what to defend.
// Deep link: openPanel('markets', { tab, cityId, productId }).

import clsx from 'clsx';
import { Crown, FlaskConical, Hammer, Megaphone, ShieldAlert, Sparkles, Store, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MarketDetailDto, MarketRowDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, EmptyState, LineChart, OverlayFrame, Segmented, Skeleton, StackedBar, Stat, Table, Toggle, Tooltip, type TabItem } from '@/ui/components';
import { addMonths, compact as population0, monthName, percent, price as fmtPrice } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useCatalogIndex } from '../_shared-a/catalog';
import { OwnerChip, ProductGlyph, QbtBars, SectionHead } from '../_shared-a/pieces';
import { BRACKET_LABEL } from '../_shared-a/priceBands';
import type { PanelProps } from '../registry';
import { METRICS, buildMatrix, cellKey, filterRows, metricFill, metricText, metricValue, playerShare, shareTint, unservedMarkets, type MarketMetric } from './marketsModel';
import styles from './Markets.module.css';

type Tab = 'matrix' | 'opportunities';
const population = (n: number) => population0(n, 0);

const TABS: TabItem<Tab>[] = [
  { id: 'matrix', label: 'Markets' },
  { id: 'opportunities', label: 'Opportunities' },
];

export default function MarketsPanel({ params }: PanelProps) {
  const [tab, setTab] = useState<Tab>(params.tab === 'opportunities' ? 'opportunities' : 'matrix');
  const [sel, setSel] = useState<{ cityId: string; productId: string } | null>(
    typeof params.cityId === 'string' && typeof params.productId === 'string' ? { cityId: params.cityId, productId: params.productId } : null,
  );
  useEffect(() => {
    if (typeof params.cityId === 'string' && typeof params.productId === 'string') {
      setSel({ cityId: params.cityId, productId: params.productId });
      setTab('matrix');
    }
  }, [params.cityId, params.productId]);
  const intel = useEngineQuery('marketIntel', {});
  const rows = intel.data?.rows ?? [];

  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="Where the demand is — and who serves it" flush data-testid="panel-markets">
      {!intel.data ? (
        <div className={styles.loading}>
          <Skeleton height={320} />
        </div>
      ) : tab === 'matrix' ? (
        <MatrixView rows={rows} sel={sel} onSelect={setSel} />
      ) : (
        <OpportunitiesView rows={rows} onOpen={(cityId, productId) => (setSel({ cityId, productId }), setTab('matrix'))} />
      )}
    </OverlayFrame>
  );
}

// ------------------------------------------------------------------ matrix

function MatrixView({ rows, sel, onSelect }: { rows: readonly MarketRowDto[]; sel: { cityId: string; productId: string } | null; onSelect: (s: { cityId: string; productId: string }) => void }) {
  const idx = useCatalogIndex();
  const [metric, setMetric] = useState<MarketMetric>('demand');
  const [onlyMine, setOnlyMine] = useState(false);
  const [contested, setContested] = useState(false);
  const visible = useMemo(() => filterRows(rows, { onlyMine, contested }), [rows, onlyMine, contested]);
  const matrix = useMemo(() => buildMatrix(rows), [rows]);
  const visibleKeys = useMemo(() => new Set(visible.map((r) => cellKey(r.cityId, r.productId))), [visible]);
  const max = useMemo(() => Math.max(0, ...visible.map((r) => metricValue(r, metric) ?? 0)), [visible, metric]);
  const selected = sel ?? (visible[0] ? { cityId: visible[0].cityId, productId: visible[0].productId } : null);
  const products = matrix.products.filter((p) => matrix.cities.some((c) => visibleKeys.has(cellKey(c.id, p.id))));

  return (
    <div className={styles.split}>
      <div className={styles.matrixPane}>
        <div className={styles.toolbar}>
          <Segmented<MarketMetric> size="sm" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.id, label: m.label, title: m.hint, testId: `markets-metric-${m.id}` }))} label="Metric" />
          <span className={styles.toolbarSpacer} />
          <Toggle size="sm" checked={onlyMine} onChange={setOnlyMine} label="Only mine" />
          <Toggle size="sm" checked={contested} onChange={setContested} label="Contested" />
        </div>
        {products.length === 0 ? (
          <EmptyState compact icon={<Store size={18} />} title="No markets match" body={onlyMine ? 'You don’t sell anything yet. Build a store (B) to enter a market.' : 'Clear a filter to see more.'} />
        ) : (
          <div className={styles.matrixWrap}>
            <table className={styles.matrix} data-testid="markets-matrix">
              <thead>
                <tr>
                  <th className={styles.corner}>Product</th>
                  {matrix.cities.map((c) => (
                    <th key={c.id} className={styles.cityHead}>
                      {c.name}
                      <span className={styles.cityPop}>{population(idx.cities.get(c.id)?.population ?? 0)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <th className={styles.productHead}>
                      <ProductGlyph product={idx.products.get(p.id)} size="sm" />
                      {p.name}
                    </th>
                    {matrix.cities.map((c) => {
                      const row = matrix.cell.get(cellKey(c.id, p.id));
                      const shown = row && visibleKeys.has(cellKey(c.id, p.id));
                      if (!row || !shown) return <td key={c.id} className={styles.cellEmpty} />;
                      const share = playerShare(row);
                      const tint = shareTint(share);
                      const unserved = row.retailerCount === 0 && row.potentialDemand > 0;
                      const isSel = selected?.cityId === c.id && selected?.productId === p.id;
                      return (
                        <td key={c.id} className={styles.td}>
                          <button
                            type="button"
                            className={clsx(styles.cell, unserved && styles.cellUnserved, row.playerPresent && styles.cellMine, isSel && styles.cellSel)}
                            style={{ ['--tint' as string]: String(tint) }}
                            onClick={() => onSelect({ cityId: c.id, productId: p.id })}
                            data-testid={`markets-cell-${c.id}-${p.id}`}
                          >
                            <span className={styles.cellValue}>{metricText(row, metric)}</span>
                            <span className={styles.cellBar}>
                              <span style={{ width: `${metricFill(row, metric, max) * 100}%` }} />
                            </span>
                            <span className={styles.cellMeta}>
                              {unserved ? (
                                <span className={styles.unservedTag}>Unserved</span>
                              ) : (
                                <>
                                  {row.playerPresent && <span className={styles.youDot} title="You sell here" />}
                                  {row.retailerCount} seller{row.retailerCount === 1 ? '' : 's'}
                                  {share !== null && metric !== 'share' ? ` · you ${percent(share, 0)}` : ''}
                                </>
                              )}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.legend}>
              <span>
                <i className={styles.legendRamp} /> your share 0% → 100%
              </span>
              <span>
                <i className={styles.legendUnserved} /> unserved: nobody sells it yet
              </span>
              <span>bar = {METRICS.find((m) => m.id === metric)?.hint.toLowerCase()}</span>
            </div>
          </div>
        )}
      </div>
      <aside className={styles.detailPane}>{selected ? <MarketDetail key={`${selected.cityId}|${selected.productId}`} cityId={selected.cityId} productId={selected.productId} row={matrix.cell.get(cellKey(selected.cityId, selected.productId))} /> : null}</aside>
    </div>
  );
}

// ------------------------------------------------------------------ detail

function MarketDetail({ cityId, productId, row }: { cityId: string; productId: string; row: MarketRowDto | undefined }) {
  const idx = useCatalogIndex();
  const q = useEngineQuery('marketDetail', { cityId, productId });
  const d = q.data;
  const product = idx.products.get(productId);
  return (
    <div className={styles.detail} data-testid="markets-detail">
      <div className={styles.detailHead}>
        <ProductGlyph product={product} size="lg" />
        <div>
          <div className={styles.detailTitle}>{idx.productName(productId)}</div>
          <div className={styles.detailSub}>
            {idx.cityName(cityId)} · {population(idx.cities.get(cityId)?.population ?? 0)} people
          </div>
        </div>
      </div>
      {!d ? (
        <Skeleton height={260} />
      ) : (
        <>
          <div className={styles.kpis}>
            <Stat tile size="sm" label="Demand" value={`${compact(d.potentialDemand)}/mo`} />
            <Stat tile size="sm" label="Your share" value={row && playerShare(row) !== null ? percent(playerShare(row)!, 0) : '—'} foot={row?.playerPresent ? 'realised, last month' : 'not selling here'} />
            <Stat tile size="sm" label="World price" value={fmtPrice(d.effectiveWorldPrice)} foot={`elasticity ${d.elasticity.toFixed(1)}`} />
          </div>
          <Actions cityId={cityId} productId={productId} present={row?.playerPresent ?? false} />
          <Brackets d={d} />
          <SupplyDemand d={d} />
          <Offers d={d} techMax={product?.maxTechLevel ?? 10} />
          <ShareHistory d={d} />
          {d.modelSource === 'bridgeReplica' && <p className={styles.note}>Model shares are a forecast; realised shares count units actually sold.</p>}
        </>
      )}
    </div>
  );
}

function Actions({ cityId, productId, present }: { cityId: string; productId: string; present: boolean }) {
  const go = (panel: 'build' | 'marketing' | 'rnd', params: Record<string, unknown>) => {
    const ui = useUiStore.getState();
    ui.closeOverlay();
    ui.openPanel(panel, params);
  };
  return (
    <div className={styles.actions}>
      <Button size="sm" variant={present ? 'secondary' : 'primary'} icon={<Hammer size={13} />} onClick={() => go('build', { cityId, productId })} data-testid="markets-build-here">
        {present ? 'Open another store' : 'Open a store here'}
      </Button>
      <Button size="sm" variant="ghost" icon={<Megaphone size={13} />} onClick={() => go('marketing', { cityId, productId })}>
        Advertise
      </Button>
      <Button size="sm" variant="ghost" icon={<FlaskConical size={13} />} onClick={() => go('rnd', { productId })}>
        Research
      </Button>
    </div>
  );
}

function Brackets({ d }: { d: MarketDetailDto }) {
  return (
    <section>
      <SectionHead right="and their price ceilings">Shoppers by income</SectionHead>
      <StackedBar segments={d.brackets.map((b) => ({ label: BRACKET_LABEL[b.bracket], value: b.demand }))} format={(v) => `${compact(v)}/mo`} legend={false} />
      <div className={styles.brackets}>
        {d.brackets.map((b) => (
          <div key={b.bracket} className={styles.bracket}>
            <span className={styles.bracketName}>{BRACKET_LABEL[b.bracket]}</span>
            <span>{compact(b.demand)}/mo</span>
            <span className={styles.dim}>{population(b.population)} people</span>
            <span className={b.reservationPrice !== undefined ? styles.ceiling : styles.dim}>{b.reservationPrice !== undefined ? `max ${fmtPrice(b.reservationPrice)}` : 'no ceiling'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SupplyDemand({ d }: { d: MarketDetailDto }) {
  const sold = d.retailers.reduce((s, r) => s + r.lastMonthUnits, 0);
  const max = Math.max(d.potentialDemand, sold, 1);
  return (
    <section>
      <SectionHead>Supply vs demand · last month</SectionHead>
      <div className={styles.sd}>
        <span className={styles.sdLabel}>Demand</span>
        <span className={styles.sdTrack}>
          <span className={styles.sdDemand} style={{ width: `${(d.potentialDemand / max) * 100}%` }} />
        </span>
        <span className={styles.sdValue}>{compact(d.potentialDemand)}</span>
      </div>
      <div className={styles.sd}>
        <span className={styles.sdLabel}>Sold</span>
        <span className={styles.sdTrack}>
          <span className={styles.sdSupply} style={{ width: `${(sold / max) * 100}%` }} />
        </span>
        <span className={styles.sdValue}>{compact(sold)}</span>
      </div>
    </section>
  );
}

function Offers({ d, techMax }: { d: MarketDetailDto; techMax: number }) {
  // Selecting returns to the city and opens the inspector (Hud keeps them in sync).
  const selectBuilding = (id: number) => useGameStore.getState().selectBuilding(id);
  const ranked = [...d.retailers].sort((a, b) => b.lastMonthRealisedShare - a.lastMonthRealisedShare || b.modelShare - a.modelShare);
  return (
    <section>
      <SectionHead right={`${d.retailers.length} offer${d.retailers.length === 1 ? '' : 's'}`}>Leaderboard</SectionHead>
      {d.retailers.length === 0 ? (
        <p className={styles.note}>Nobody sells it here yet — first movers set the price.</p>
      ) : (
        <div className={styles.board} data-testid="markets-leaderboard">
          {ranked.map((r, i) => (
            <button key={`${r.buildingId}:${r.slotIndex}`} type="button" className={clsx(styles.boardRow, r.isPlayer && styles.boardYou)} onClick={() => selectBuilding(r.buildingId)}>
              <span className={styles.boardRank}>{i === 0 && r.lastMonthRealisedShare > 0 ? <Crown size={13} className={styles.crown} /> : i + 1}</span>
              <span className={styles.boardMain}>
                <span className={styles.boardTop}>
                  <OwnerChip companyId={r.ownerId} name={r.ownerName} isPlayer={r.isPlayer} compact />
                  <span className={styles.boardPrice}>{fmtPrice(r.price)}</span>
                </span>
                <span className={styles.boardBottom}>
                  <QbtBars quality={r.quality} brand={r.brand} tech={r.tech} techMax={techMax} />
                  <Tooltip content={`Forecast share ${percent(r.modelShare, 0)} · ${compact(r.onHand)} in stock`} side="left">
                    <span className={styles.boardShare}>
                      <span className={styles.boardShareTrack}>
                        <span style={{ width: `${Math.min(1, r.lastMonthRealisedShare) * 100}%` }} />
                      </span>
                      {percent(r.lastMonthRealisedShare, 0)} · {compact(r.lastMonthUnits)} sold
                    </span>
                  </Tooltip>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ShareHistory({ d }: { d: MarketDetailDto }) {
  const values = d.playerRealisedShareHistory.values;
  if (values.length < 2 || values.every((v) => v === null || v === 0)) return null;
  const labels = values.map((_, i) => monthName(addMonths(d.playerRealisedShareHistory.start, i).month));
  return (
    <section>
      <SectionHead>Your share · 12 months</SectionHead>
      <LineChart series={[{ id: 'share', label: 'Your share', values: values.map((v) => (v === null ? null : v * 100)), area: true }]} labels={labels} height={130} yFormat={(v) => `${Math.round(v)}%`} zeroBased legend={false} aria-label="Your realised share" />
    </section>
  );
}

// ------------------------------------------------------------------ opportunities

function OpportunitiesView({ rows, onOpen }: { rows: readonly MarketRowDto[]; onOpen: (cityId: string, productId: string) => void }) {
  const idx = useCatalogIndex();
  const opps = useEngineQuery('marketOpportunities', {});
  const unserved = useMemo(() => unservedMarkets(rows), [rows]);
  const build = (cityId: string, productId: string) => {
    const ui = useUiStore.getState();
    ui.closeOverlay();
    ui.openPanel('build', { cityId, productId });
  };
  const advertise = (cityId: string, productId: string) => {
    const ui = useUiStore.getState();
    ui.closeOverlay();
    ui.openPanel('marketing', { cityId, productId });
  };
  return (
    <div className={styles.opps}>
      <div className={styles.oppCols}>
        <section>
          <SectionHead right="big demand, few rivals, you’re not there">
            <Sparkles size={12} /> Markets to enter
          </SectionHead>
          {!opps.data ? (
            <Skeleton height={160} />
          ) : opps.data.enter.length === 0 ? (
            <p className={styles.note}>You already sell in every market with demand.</p>
          ) : (
            <div className={styles.oppList}>
              {opps.data.enter.map((o, i) => (
                <div key={`${o.cityId}|${o.productId}`} className={clsx(styles.oppCard, i === 0 && styles.oppBest)} data-testid={`opp-enter-${i}`}>
                  <ProductGlyph product={idx.products.get(o.productId)} size="lg" />
                  <div className={styles.oppBody}>
                    <div className={styles.oppTitle}>
                      {idx.productName(o.productId)} in {idx.cityName(o.cityId)}
                      {i === 0 && <Badge tone="opportunity">Best bet</Badge>}
                    </div>
                    <div className={styles.oppMeta}>
                      <span>
                        <Users size={11} /> {compact(o.potentialDemand)}/mo demand
                      </span>
                      <span>{o.rivalCount === 0 ? 'no rivals' : `${o.rivalCount} rival${o.rivalCount === 1 ? '' : 's'}${o.cheapestRivalPrice !== undefined ? ` from ${fmtPrice(o.cheapestRivalPrice)}` : ''}`}</span>
                    </div>
                  </div>
                  <div className={styles.oppActions}>
                    <Button size="sm" variant="ghost" onClick={() => onOpen(o.cityId, o.productId)}>
                      Details
                    </Button>
                    <Button size="sm" variant="primary" icon={<Hammer size={13} />} onClick={() => build(o.cityId, o.productId)} data-testid={`opp-build-${i}`}>
                      Build here
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <SectionHead right="a rival out-sells you">
            <ShieldAlert size={12} /> Markets to defend
          </SectionHead>
          {!opps.data ? (
            <Skeleton height={160} />
          ) : opps.data.defend.length === 0 ? (
            <p className={styles.note}>Nobody is out-selling you anywhere you trade.</p>
          ) : (
            <div className={styles.oppList}>
              {opps.data.defend.map((o, i) => (
                <div key={`${o.cityId}|${o.productId}`} className={clsx(styles.oppCard, styles.oppDefend)} data-testid={`opp-defend-${i}`}>
                  <ProductGlyph product={idx.products.get(o.productId)} size="lg" />
                  <div className={styles.oppBody}>
                    <div className={styles.oppTitle}>
                      {idx.productName(o.productId)} in {idx.cityName(o.cityId)}
                    </div>
                    <div className={styles.oppShare}>
                      <span className={styles.oppYou} style={{ width: `${o.playerShare * 100}%` }} />
                      <span className={styles.oppThem} style={{ width: `${o.topRivalShare * 100}%` }} />
                    </div>
                    <div className={styles.oppMeta}>
                      <span>You {percent(o.playerShare, 0)}</span>
                      <span>
                        {o.topRivalName} {percent(o.topRivalShare, 0)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.oppActions}>
                    <Button size="sm" variant="ghost" onClick={() => onOpen(o.cityId, o.productId)}>
                      Details
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Megaphone size={13} />} onClick={() => advertise(o.cityId, o.productId)}>
                      Advertise
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section>
        <SectionHead right={`${unserved.length} market${unserved.length === 1 ? '' : 's'} nobody serves`}>Unserved markets</SectionHead>
        <Table
          dense
          rowKey={(r) => `${r.cityId}|${r.productId}`}
          rows={unserved}
          defaultSort={{ id: 'demand', dir: 'desc' }}
          onRowClick={(r) => onOpen(r.cityId, r.productId)}
          empty="Every market with demand has at least one seller."
          columns={[
            {
              id: 'product',
              header: 'Product',
              sortValue: (r) => r.productName,
              cell: (r) => (
                <span className={styles.ownerCell}>
                  <ProductGlyph product={idx.products.get(r.productId)} size="sm" />
                  {r.productName}
                </span>
              ),
            },
            { id: 'city', header: 'City', sortValue: (r) => r.cityName, cell: (r) => r.cityName },
            { id: 'demand', header: 'Demand / mo', numeric: true, sortValue: (r) => r.potentialDemand, cell: (r) => compact(r.potentialDemand) },
            { id: 'world', header: 'World price', numeric: true, sortValue: (r) => idx.products.get(r.productId)?.baseWorldMarketPrice ?? 0, cell: (r) => fmtPrice(idx.products.get(r.productId)?.baseWorldMarketPrice ?? 0) },
            {
              id: 'go',
              header: '',
              align: 'right',
              cell: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Hammer size={12} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    build(r.cityId, r.productId);
                  }}
                >
                  Build here
                </Button>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
