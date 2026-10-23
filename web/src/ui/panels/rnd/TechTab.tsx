// R&D › Technology: every product grouped by tier with your tech against the
// best rival, research units, progress to the next level, ETAs and patent
// status; "Research this" assigns a free unit; the tech race per product.

import { FlaskConical, Lock, Play, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProductTier, ResearchNodeDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Badge, Button, Panel, Progress, Segmented, Stat, Table, Tooltip } from '@/ui/components';
import { durationMonths, monthYear } from '@/util/format';
import { CompanyTag, ErrorBlock, LoadingBlock, Note, TechPips } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { openBuildLab, playerLabs, researchProduct } from './research';
import styles from './Rnd.module.css';

const TIERS: { tier: ProductTier; title: string; note: string }[] = [
  { tier: 'finished', title: 'Finished goods', note: 'Tech here raises quality, and quality wins shoppers.' },
  { tier: 'intermediate', title: 'Intermediate goods', note: 'Research earns patents; quality passes on to what you make from them.' },
  { tier: 'raw', title: 'Raw materials', note: 'Research earns patents and better yields.' },
];

type Filter = 'all' | 'active' | 'behind';

export function TechTab({ focusProductId, go }: { focusProductId: string | null; go: (tab: 'labs' | 'patents') => void }) {
  const names = useNames();
  const { data, error } = useEngineQuery('researchTree', {});
  const buildings = useGameStore((s) => s.buildings);
  const labs = playerLabs(buildings, names.playerId);
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string; action?: 'build' | 'labs' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const shown = nodes.filter((n) => (filter === 'active' ? n.researchingSlots > 0 : filter === 'behind' ? !!n.bestRival && n.bestRival.tech > n.tech : true));
  const lead = nodes.filter((n) => n.bestRival && n.tech > n.bestRival.tech).length;
  const behind = nodes.filter((n) => n.bestRival && n.bestRival.tech > n.tech).length;
  const points = nodes.reduce((s, n) => s + n.pointsPerMonth, 0);
  const units = labs.reduce((s, b) => s + b.capacity, 0);
  const used = labs.reduce((s, b) => s + b.configuredSlots, 0);
  const patents = nodes.filter((n) => n.patent?.mine).length;

  const research = async (n: ResearchNodeDto) => {
    setBusy(n.productId);
    const r = await researchProduct(n.productId);
    setBusy(null);
    if (r.kind === 'started') setMessage({ tone: 'ok', text: `${names.building(r.buildingId)} now researches ${n.name}. Progress shows after the month closes.` });
    else if (r.kind === 'noLab') setMessage({ tone: 'warn', text: 'You have no R&D centre yet. Build one to start researching.', action: 'build' });
    else if (r.kind === 'noFreeUnit') setMessage({ tone: 'warn', text: `Every research unit in your ${r.labs === 1 ? 'lab' : `${r.labs} labs`} is busy. Reassign one, or build another centre.`, action: 'labs' });
    else setMessage({ tone: 'warn', text: 'The lab refused that assignment.' });
  };

  if (error && !data) return <ErrorBlock error={error} />;
  if (!data) return <LoadingBlock rows={10} />;

  return (
    <div className={shared.page}>
      <div className={shared.kpis}>
        <Stat tile size="sm" label="You lead in" value={`${lead} product${lead === 1 ? '' : 's'}`} tone={lead > 0 ? 'pos' : 'default'} />
        <Stat tile size="sm" label="Rivals lead in" value={`${behind} product${behind === 1 ? '' : 's'}`} tone={behind > 0 ? 'warn' : 'default'} />
        <Stat tile size="sm" label="Research units" value={`${used} / ${units}`} foot={labs.length ? `${labs.length} R&D centre${labs.length === 1 ? '' : 's'}` : 'No R&D centre'} />
        <Stat tile size="sm" label="Research points" value={`${points.toLocaleString('en-US')}/mo`} foot={`${data.pointsPerSlotPerMonth} per unit per month`} />
        <Stat tile size="sm" label="Patents held" value={patents} />
      </div>
      <div className={shared.toolbar}>
        <Segmented<Filter>
          size="sm"
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All products' },
            { value: 'active', label: 'Being researched' },
            { value: 'behind', label: 'Rival ahead' },
          ]}
        />
        <span className={shared.spacer} />
        <span className={`${shared.small} ${shared.muted}`}>Level L → L+1 needs {data.baseThreshold.toLocaleString('en-US')} × L points</span>
      </div>
      {message && (
        <Note tone={message.tone === 'ok' ? 'ok' : 'warn'}>
          <span>{message.text} </span>
          {message.action === 'build' && (
            <button type="button" className={shared.link} onClick={() => openBuildLab()}>
              Build an R&D centre
            </button>
          )}
          {message.action === 'labs' && (
            <button type="button" className={shared.link} onClick={() => go('labs')}>
              Open Labs
            </button>
          )}
        </Note>
      )}
      <div className={shared.split}>
        <div className={shared.stack}>
          {TIERS.map(({ tier, title, note }) => {
            const rows = shown.filter((n) => n.tier === tier);
            if (rows.length === 0) return null;
            return (
              <Panel key={tier} title={title} padding="none" variant="solid" actions={<span className={shared.tiny}>{note}</span>}>
                <Table<ResearchNodeDto>
                  dense
                  rowKey={(n) => n.productId}
                  rows={rows}
                  selectedKey={focusProductId}
                  defaultSort={{ id: 'gap', dir: 'asc' }}
                  columns={[
                    { id: 'name', header: 'Product', sortValue: (n) => n.name, cell: (n) => <b>{n.name}</b>, width: '16%' },
                    {
                      id: 'tech',
                      header: 'Your tech',
                      sortValue: (n) => n.tech,
                      cell: (n) => (
                        <span className={styles.techCell}>
                          <TechPips tech={n.tech} max={n.maxTech} rival={n.bestRival?.tech ?? null} />
                          <span className={shared.num}>
                            {n.tech}/{n.maxTech}
                          </span>
                        </span>
                      ),
                    },
                    {
                      id: 'gap',
                      header: 'Best rival',
                      sortValue: (n) => (n.bestRival ? n.tech - n.bestRival.tech : 99),
                      cell: (n) =>
                        n.bestRival ? (
                          <span className={styles.rivalCell}>
                            <CompanyTag company={names.company(n.bestRival.companyId)} size={12} you={false} />
                            <span className={shared.num}>{n.bestRival.tech}</span>
                            {n.tech > n.bestRival.tech ? <Badge tone="success">+{n.tech - n.bestRival.tech}</Badge> : n.tech < n.bestRival.tech ? <Badge tone="warning">−{n.bestRival.tech - n.tech}</Badge> : <Badge>tied</Badge>}
                          </span>
                        ) : (
                          <span className={shared.dim}>No rival</span>
                        ),
                    },
                    { id: 'units', header: 'Units', numeric: true, sortValue: (n) => n.researchingSlots, cell: (n) => (n.researchingSlots ? n.researchingSlots : <span className={shared.dim}>—</span>) },
                    {
                      id: 'progress',
                      header: 'Progress to next level',
                      width: '20%',
                      sortValue: (n) => (n.threshold ? n.progress / n.threshold : 0),
                      cell: (n) =>
                        n.tech >= n.maxTech ? (
                          <Badge tone="gold">Maximum</Badge>
                        ) : (
                          <Progress size="sm" value={n.threshold ? n.progress / n.threshold : 0} tone={n.blocked ? 'danger' : n.researchingSlots ? 'info' : 'neutral'} label={<span className={shared.tiny}>{Math.round(n.progress)} / {Math.round(n.threshold)}</span>} />
                        ),
                    },
                    {
                      id: 'eta',
                      header: 'Next level',
                      numeric: true,
                      sortValue: (n) => n.etaMonths ?? null,
                      cell: (n) => (n.blocked ? <span className={shared.neg}>Blocked</span> : n.etaMonths !== undefined ? durationMonths(n.etaMonths) : <span className={shared.dim}>—</span>),
                    },
                    { id: 'max', header: 'To max', numeric: true, sortValue: (n) => n.etaToMaxMonths ?? null, cell: (n) => (n.etaToMaxMonths !== undefined ? durationMonths(n.etaToMaxMonths) : <span className={shared.dim}>—</span>) },
                    {
                      id: 'patent',
                      header: 'Patent',
                      cell: (n) =>
                        n.patent ? (
                          <Tooltip content={`Until ${monthYear(n.patent.expiresAt)} (${durationMonths(n.patent.monthsRemaining)})`}>
                            {n.patent.mine ? (
                              <Badge tone="gold">
                                <ShieldCheck size={11} /> Yours
                              </Badge>
                            ) : n.patent.licensedToMe ? (
                              <Badge tone="info">Licensed</Badge>
                            ) : (
                              <Badge tone="danger">
                                <Lock size={11} /> {names.company(n.patent.holderId).name}
                              </Badge>
                            )}
                          </Tooltip>
                        ) : (
                          <span className={shared.dim}>—</span>
                        ),
                    },
                    {
                      id: 'go',
                      header: '',
                      align: 'right',
                      cell: (n) =>
                        n.tech < n.maxTech && !n.blocked ? (
                          <Button size="sm" variant={n.productId === focusProductId ? 'primary' : 'ghost'} icon={<Play size={12} />} loading={busy === n.productId} onClick={() => void research(n)} data-testid={`research-${n.productId}`}>
                            Research
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            );
          })}
          {shown.length === 0 && <Note>No products match this filter.</Note>}
        </div>
        <div className={shared.stack}>
          <TechRace />
          <Panel title="How research works" padding="md" variant="solid">
            <ul className={styles.rules}>
              <li>Each research unit adds {data.pointsPerSlotPerMonth} points a month to one product.</li>
              <li>Reaching the top level grants a patent: rivals cannot out-research you on it until it expires.</li>
              <li>A rival’s patent blocks your research on that product — license it or research something else.</li>
              <li>Only finished goods’ tech reaches shoppers directly; the rest earns patents and better inputs.</li>
            </ul>
            {labs.length === 0 && (
              <Button size="sm" variant="primary" icon={<FlaskConical size={14} />} onClick={() => openBuildLab()} style={{ marginTop: 10 }}>
                Build an R&D centre
              </Button>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Tech per company for the products you work with (bridge statsDashboard.rdLeaderboard). */
function TechRace() {
  const names = useNames();
  const { data } = useEngineQuery('statsDashboard', {});
  const boards = data?.rdLeaderboard ?? [];
  return (
    <Panel title="Tech race" padding="md" variant="solid" accent>
      {boards.length === 0 ? (
        <Note>Your products’ tech against every rival appears here once you make or sell something.</Note>
      ) : (
        <div className={styles.race}>
          {boards.map((b) => (
            <div key={b.productId} className={styles.raceRow}>
              <div className={styles.raceName}>{names.product(b.productId)}</div>
              {b.rows
                .slice()
                .sort((x, y) => y.value - x.value)
                .map((r) => {
                  const c = names.company(r.companyId);
                  return (
                    <div key={r.companyId} className={styles.raceBar} title={`${c.name}: ${r.value} of ${b.maxTech}`}>
                      <span className={styles.raceLabel}>{c.name}</span>
                      <span className={styles.raceTrack}>
                        <span className={styles.raceFill} style={{ width: `${(r.value / Math.max(1, b.maxTech)) * 100}%`, background: c.color, boxShadow: c.isPlayer ? '0 0 0 1px var(--c-gold)' : undefined }} />
                      </span>
                      <span className={shared.num}>{r.value}</span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
