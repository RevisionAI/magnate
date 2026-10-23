// News › Archive: every story this game, newest first, grouped by month, with
// severity / product filters and search, effects translated, and Locate.

import { MapPin, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NewsEntryDto, NewsSeverity } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, IconButton, Panel, Segmented, Select, TextInput } from '@/ui/components';
import { monthYearLong } from '@/util/format';
import { LoadingBlock, Note } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { describeEffect, humanizeIds } from '../_shared-b/text';
import { exposureTo, playerExposure } from './relevance';
import styles from './News.module.css';

type Sev = 'all' | NewsSeverity;

export function ArchiveTab() {
  const names = useNames();
  const buildings = useGameStore((s) => s.buildings);
  const { data } = useEngineQuery('news', { limit: 500 });
  const [sev, setSev] = useState<Sev>('all');
  const [product, setProduct] = useState<string>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [q, setQ] = useState('');
  const exposure = useMemo(() => playerExposure(buildings, names.playerId, names.catalog), [buildings, names.playerId, names.catalog]);
  const ids = useMemo(() => [...names.productIds, ...names.cityIds], [names.productIds, names.cityIds]);
  const fix = (t: string) => humanizeIds(t, ids, (id) => (names.productIds.includes(id) ? names.product(id) : names.city(id)));
  const lookup = { product: names.product, city: names.city };

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.entries ?? [])
      .slice()
      .reverse()
      .filter((e) => sev === 'all' || e.severity === sev)
      .filter((e) => product === 'all' || e.effects.some((x) => x.productId === product))
      .filter((e) => !mineOnly || e.effects.some((x) => exposureTo(x, exposure).length > 0))
      .filter((e) => !needle || `${e.headline} ${e.description}`.toLowerCase().includes(needle));
  }, [data, sev, product, mineOnly, q, exposure]);

  if (!data) return <LoadingBlock rows={10} />;
  const groups: { key: string; label: string; items: NewsEntryDto[] }[] = [];
  for (const e of items) {
    const key = `${e.date.year}-${e.date.month}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: monthYearLong(e.date), items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  const productsInNews = [...new Set(data.entries.flatMap((e) => e.effects.map((x) => x.productId).filter((p): p is string => !!p)))].sort();
  const locate = (cityId: string) => {
    useUiStore.getState().closeOverlay();
    useGameStore.getState().setActiveCity(cityId);
    fx.locate({ cityId });
  };

  return (
    <div className={shared.page}>
      <div className={styles.filters}>
        <Segmented<Sev>
          size="sm"
          label="Severity"
          value={sev}
          onChange={setSev}
          options={[
            { value: 'all', label: 'All' },
            { value: 'major', label: 'Major' },
            { value: 'notable', label: 'Notable' },
            { value: 'info', label: 'Minor' },
          ]}
        />
        <Select<string> size="sm" aria-label="Product" value={product} options={[{ value: 'all', label: 'All products' }, ...productsInNews.map((p) => ({ value: p, label: names.product(p) }))]} onChange={setProduct} />
        <button type="button" className={`${shared.chip} ${mineOnly ? shared.chipOn : ''}`} onClick={() => setMineOnly(!mineOnly)}>
          Affects my business
        </button>
        <span className={shared.spacer} />
        <span className={shared.cellName}>
          <Search size={14} color="var(--c-dim)" />
          <TextInput size="sm" placeholder="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" />
        </span>
      </div>
      {groups.length === 0 ? (
        <Note>{data.entries.length === 0 ? 'No news yet — markets are quiet.' : 'No stories match these filters.'}</Note>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className={styles.month}>{g.label}</div>
            <Panel padding="none" variant="solid">
              {g.items.map((e) => {
                const city = e.effects.find((x) => x.cityId)?.cityId;
                const touches = e.effects.some((x) => exposureTo(x, exposure).length > 0);
                return (
                  <div key={e.seq} className={styles.archiveItem}>
                    <div>
                      <div className={shared.chips} style={{ marginBottom: 4 }}>
                        <Badge tone={e.severity === 'major' ? 'danger' : e.severity === 'notable' ? 'warning' : 'neutral'}>{e.severity === 'info' ? 'minor' : e.severity}</Badge>
                        {touches && <Badge tone="gold">Affects you</Badge>}
                      </div>
                      <div className={styles.archiveHead}>{fix(e.headline)}</div>
                      {e.description && <div className={styles.archiveBody}>{fix(e.description)}</div>}
                      {e.effects.length > 0 && <div className={`${shared.small} ${shared.gold}`} style={{ marginTop: 4 }}>{e.effects.map((x) => describeEffect(x, lookup)).join(' · ')}</div>}
                    </div>
                    {city && <IconButton size="sm" label={`Show ${names.city(city)}`} icon={<MapPin size={13} />} onClick={() => locate(city)} />}
                  </div>
                );
              })}
            </Panel>
          </div>
        ))
      )}
    </div>
  );
}
