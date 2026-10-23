// News › Front page: a broadsheet set in Fraunces. Lead story with "what it
// means for you", the other headlines, your business briefs, rival moves and
// the markets box (active world-price effects).

import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import type { GameEventDto, NewsEntryDto } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { monthName, monthYearLong, price } from '@/util/format';
import { LoadingBlock } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { describeEffect, effectDirection, humanizeIds } from '../_shared-b/text';
import { consequence, exposureTo, playerExposure } from './relevance';
import styles from './News.module.css';

export function FrontPage({ onArchive, onLog }: { onArchive: () => void; onLog: () => void }) {
  const names = useNames();
  const date = useGameStore((s) => s.hud?.date);
  const elapsed = useGameStore((s) => s.hud?.elapsedMonths ?? 0);
  const buildings = useGameStore((s) => s.buildings);
  const { data: news } = useEngineQuery('news', { limit: 40 });
  const { data: feed } = useEngineQuery('activityFeed', { limit: 300 });
  const exposure = useMemo(() => playerExposure(buildings, names.playerId, names.catalog), [buildings, names.playerId, names.catalog]);
  const lookup = { product: names.product, city: names.city };
  const ids = useMemo(() => [...names.productIds, ...names.cityIds], [names.productIds, names.cityIds]);
  const fix = (t: string) => humanizeIds(t, ids, (id) => (names.productIds.includes(id) ? names.product(id) : names.city(id)));

  if (!news || !feed || !date) return <LoadingBlock rows={10} />;
  const entries = news.entries.slice().reverse();
  const rank = (e: NewsEntryDto) => (e.severity === 'major' ? 2 : e.severity === 'notable' ? 1 : 0);
  const recent = entries.slice(0, 12);
  const lead = recent.slice().sort((a, b) => rank(b) - rank(a) || b.seq - a.seq)[0] ?? null;
  const others = entries.filter((e) => e !== lead).slice(0, 6);
  const events = feed.events.slice().reverse();
  const mine = events.filter((e) => e.isPlayer === true && e.priority >= 2).slice(0, 6);
  const rivals = events.filter((e) => e.isPlayer === false && e.companyId !== undefined && e.kind !== 'news').slice(0, 6);

  const locate = (e: { buildingId?: number; cityId?: string }) => {
    useUiStore.getState().closeOverlay();
    if (e.cityId) useGameStore.getState().setActiveCity(e.cityId);
    fx.locate({ buildingId: e.buildingId, cityId: e.cityId });
  };
  const leadCity = lead?.effects.find((x) => x.cityId)?.cityId;

  return (
    <div className={styles.paper} data-testid="front-page">
      <header className={styles.masthead}>
        <div className={styles.mastRule}>
          <span>Vol. {Math.floor(elapsed / 12) + 1} · No. {elapsed + 1}</span>
          <span>Business · Markets · Industry</span>
          <span>{news.activePriceEffects.length ? `${news.activePriceEffects.length} market alert${news.activePriceEffects.length === 1 ? '' : 's'}` : 'Markets steady'}</span>
        </div>
        <h1 className={styles.title}>The Magnate Times</h1>
        <div className={styles.dateline}>{monthYearLong(date)}</div>
      </header>

      <div className={styles.columns}>
        <section className={styles.main}>
          {lead ? (
            <article className={styles.lead} data-testid="lead-story">
              <div className={styles.kicker}>{lead.severity === 'major' ? 'Breaking' : lead.severity === 'notable' ? 'Markets' : 'In brief'} · {monthName(lead.date.month)} {lead.date.year}</div>
              <h2 className={styles.leadHead}>{fix(lead.headline)}</h2>
              {lead.description && <p className={styles.leadBody}>{fix(lead.description)}</p>}
              <div className={styles.impact}>
                <div className={styles.impactTitle}>What it means for you</div>
                {lead.effects.length === 0 && <div className={styles.impactLine}>A headline only — no prices or brands move.</div>}
                {lead.effects.map((x, i) => {
                  const dir = effectDirection(x);
                  const exp = exposureTo(x, exposure);
                  return (
                    <div key={i} className={styles.impactBlock}>
                      <div className={styles.impactLine}>
                        {dir === 'up' ? <ArrowUpRight size={14} /> : dir === 'down' ? <ArrowDownRight size={14} /> : null}
                        <b>{describeEffect(x, lookup)}</b>
                      </div>
                      {exp.length === 0 ? (
                        <div className={styles.impactNote}>None of your buildings trade {x.productId ? names.product(x.productId) : 'it'} — no direct effect.</div>
                      ) : (
                        exp.map((kind) => {
                          const c = consequence(x, kind, x.productId ? names.product(x.productId) : 'this');
                          return (
                            <div key={kind} className={clsx(styles.impactNote, c.good === true && styles.good, c.good === false && styles.bad)}>
                              {c.text}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
                {leadCity && (
                  <button type="button" className={styles.locate} onClick={() => locate({ cityId: leadCity })}>
                    <MapPin size={12} /> Show {names.city(leadCity)}
                  </button>
                )}
              </div>
            </article>
          ) : (
            <article className={styles.lead}>
              <div className={styles.kicker}>Quiet markets</div>
              <h2 className={styles.leadHead}>No major news yet — the city goes about its business</h2>
              <p className={styles.leadBody}>Commodity swings, consumer crazes and harvests appear here, with what each means for your costs and sales.</p>
            </article>
          )}
          <div className={styles.secondary}>
            {others.map((e) => (
              <article key={e.seq} className={styles.story}>
                <div className={styles.kicker}>
                  {monthName(e.date.month)} {e.date.year}
                  {e.severity !== 'info' ? ` · ${e.severity}` : ''}
                </div>
                <h3 className={styles.storyHead}>{fix(e.headline)}</h3>
                {e.effects.length > 0 && <div className={styles.storyFx}>{e.effects.map((x) => describeEffect(x, lookup)).join(' · ')}</div>}
              </article>
            ))}
          </div>
          {entries.length > 7 && (
            <button type="button" className={styles.more} onClick={onArchive}>
              All {entries.length} stories in the archive →
            </button>
          )}
        </section>

        <aside className={styles.side}>
          <div className={styles.box}>
            <div className={styles.boxTitle}>Commodity watch</div>
            {news.activePriceEffects.length === 0 ? (
              <div className={styles.boxEmpty}>World prices at their usual levels.</div>
            ) : (
              <table className={styles.prices}>
                <tbody>
                  {news.activePriceEffects.map((p) => (
                    <tr key={p.productId}>
                      <td>{names.product(p.productId)}</td>
                      <td>{price(p.effectivePrice)}</td>
                      <td className={p.multiplier >= 1 ? styles.up : styles.down}>
                        {p.multiplier >= 1 ? '▲' : '▼'} {Math.abs((p.multiplier - 1) * 100).toFixed(0)}%
                      </td>
                      <td className={styles.small}>{p.remainingMonths} mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Briefs title="Your business" events={mine} empty="Nothing notable this season." onMore={onLog} onLocate={locate} />
          <Briefs title="Rival watch" events={rivals} empty="Rivals are quiet." onMore={onLog} onLocate={locate} />
        </aside>
      </div>
    </div>
  );
}

function Briefs({ title, events, empty, onMore, onLocate }: { title: string; events: GameEventDto[]; empty: string; onMore: () => void; onLocate: (e: GameEventDto) => void }) {
  return (
    <div className={styles.box}>
      <div className={styles.boxTitle}>{title}</div>
      {events.length === 0 ? (
        <div className={styles.boxEmpty}>{empty}</div>
      ) : (
        <ul className={styles.briefs}>
          {events.map((e) => (
            <li key={e.seq}>
              <span className={styles.briefDate}>
                {monthName(e.month.month)} {String(e.month.year).slice(2)}
              </span>
              <span className={styles.briefText}>{e.message}</span>
              {(e.buildingId !== undefined || e.cityId) && (
                <button type="button" className={styles.briefLocate} onClick={() => onLocate(e)} aria-label="Locate">
                  <MapPin size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.more} onClick={onMore}>
        Business log →
      </button>
    </div>
  );
}
