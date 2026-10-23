// Marketing › Brand map: city × product grid of your awareness against the
// strongest rival's, for the products you sell or advertise. A cell opens the
// campaign editor pre-filled with that product and city.

import { useMemo } from 'react';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Panel } from '@/ui/components';
import { LoadingBlock, Note } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { brandKey, useBrandIndex } from './brandData';
import type { CampaignDraftSeed } from './index';
import styles from './Marketing.module.css';

export function BrandMapTab({ onPlan }: { onPlan: (s: CampaignDraftSeed) => void }) {
  const names = useNames();
  const { data: ads } = useEngineQuery('adCampaigns', {});
  const { data: dash } = useEngineQuery('statsDashboard', {});
  const brands = useBrandIndex(names.playerId);
  const products = useMemo(() => {
    const ids = new Set<string>();
    for (const b of dash?.brandTop ?? []) ids.add(b.productId);
    for (const c of ads?.campaigns ?? []) ids.add(c.productId);
    return [...ids].sort((a, b) => names.product(a).localeCompare(names.product(b)));
  }, [dash, ads, names]);
  const cities = useMemo(() => (names.catalog?.cities ?? []).slice().sort((a, b) => b.population - a.population), [names.catalog]);
  if (!ads || !dash) return <LoadingBlock rows={8} />;
  const campaignBrand = (p: string, c: string) => {
    const list = ads.campaigns.filter((x) => x.productId === p && x.cityId === c);
    return list.length ? Math.max(...list.map((x) => x.brand)) : null;
  };
  return (
    <div className={shared.page}>
      <Note>
        Awareness by city for the products you sell or advertise. The blue bar is yours; the tick marks the strongest rival. Click a cell to plan a campaign there.
      </Note>
      {products.length === 0 ? (
        <Note tone="warn">Sell or advertise a product to see its brand map.</Note>
      ) : (
        <Panel padding="md" variant="solid" data-testid="brand-map">
          <div className={styles.map}>
            <table className={styles.mapTable}>
              <thead>
                <tr>
                  <th />
                  {products.map((p) => (
                    <th key={p}>{names.product(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cities.map((city) => (
                  <tr key={city.id}>
                    <th scope="row">
                      {city.name}
                      <span className={shared.cellSub}>{(city.population / 1000).toFixed(0)}K people</span>
                    </th>
                    {products.map((p) => {
                      const cell = brands.get(brandKey(p, city.id));
                      const you = campaignBrand(p, city.id) ?? cell?.you ?? null;
                      const leader = cell?.leader ?? null;
                      if (you === null && !leader) {
                        return (
                          <td key={p}>
                            <button type="button" className={styles.mapNone} onClick={() => onPlan({ productId: p, cityId: city.id })}>
                              No brand yet · plan
                            </button>
                          </td>
                        );
                      }
                      const lead = leader ? names.company(leader.companyId) : null;
                      const ahead = you !== null && (!leader || you >= leader.brand);
                      return (
                        <td key={p}>
                          <button
                            type="button"
                            className={`${styles.mapCell} ${ahead ? styles.mapWin : styles.mapLose}`}
                            onClick={() => onPlan({ productId: p, cityId: city.id })}
                            title={`${names.product(p)} in ${city.name}`}
                          >
                            <span className={styles.mapBars}>
                              <span className={styles.mapYou} style={{ width: `${Math.min(100, you ?? 0)}%` }} />
                              {leader && lead && <span className={styles.mapLeader} style={{ left: `${Math.min(99, leader.brand)}%`, background: lead.color }} />}
                            </span>
                            <span className={styles.mapNums}>
                              <span>
                                You <b>{you === null ? '—' : Math.round(you)}</b>
                              </span>
                              <span>
                                {lead ? lead.name : 'Rivals'} <b>{leader ? Math.round(leader.brand) : '—'}</b>
                              </span>
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
