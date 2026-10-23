// News › Business log (ActivityFeed parity, UX §6.14): every typed game event,
// newest first, filtered by the nine categories, "only mine" and search, with
// amounts and Locate.

import { AlertTriangle, CheckCircle2, Info, MapPin, Search, XOctagon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameEventDto } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { IconButton, Panel, TextInput, Toggle } from '@/ui/components';
import { monthName } from '@/util/format';
import { LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { FEED_CATEGORIES, feedCategory, type FeedCategory } from '../_shared-b/text';
import styles from './News.module.css';

const ICON = {
  info: <Info size={14} color="var(--c-blue)" />,
  success: <CheckCircle2 size={14} color="var(--c-green)" />,
  warning: <AlertTriangle size={14} color="var(--c-amber)" />,
  danger: <XOctagon size={14} color="var(--c-red)" />,
} as const;

const PAGE = 120;

export function BusinessLogTab() {
  const names = useNames();
  const fmt = useMoneyFormat();
  const [search, setSearch] = useState('');
  const [cats, setCats] = useState<Set<FeedCategory>>(new Set());
  const [mineOnly, setMineOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const { data } = useEngineQuery('activityFeed', { limit: 500, ...(search.trim() ? { search: search.trim() } : {}) });

  const rows = useMemo(() => {
    return (data?.events ?? [])
      .slice()
      .reverse()
      .filter((e) => e.kind !== 'monthClosed')
      .filter((e) => !mineOnly || e.isPlayer !== false)
      .filter((e) => cats.size === 0 || cats.has(feedCategory(e.kind, e.isPlayer, e.companyId, names.playerId)));
  }, [data, cats, mineOnly, names.playerId]);

  const toggle = (c: FeedCategory) => {
    const next = new Set(cats);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCats(next);
    setShown(PAGE);
  };
  const locate = (e: GameEventDto) => {
    useUiStore.getState().closeOverlay();
    if (e.cityId) useGameStore.getState().setActiveCity(e.cityId);
    if (e.buildingId !== undefined && e.isPlayer) useGameStore.getState().selectBuilding(e.buildingId);
    fx.locate({ buildingId: e.buildingId, cityId: e.cityId });
  };

  return (
    <div className={shared.page}>
      <div className={styles.filters}>
        {FEED_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`${shared.chip} ${cats.has(c.id) ? shared.chipOn : ''}`} onClick={() => toggle(c.id)} data-testid={`log-filter-${c.id}`}>
            {c.label}
          </button>
        ))}
        {cats.size > 0 && (
          <button type="button" className={shared.link} onClick={() => setCats(new Set())}>
            Clear
          </button>
        )}
        <span className={shared.spacer} />
        <Toggle size="sm" checked={mineOnly} onChange={setMineOnly} label="Only my company" />
        <span className={shared.cellName}>
          <Search size={14} color="var(--c-dim)" />
          <TextInput size="sm" placeholder="Search events" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search events" />
        </span>
      </div>
      {!data ? (
        <LoadingBlock rows={12} />
      ) : rows.length === 0 ? (
        <Note>No events match.</Note>
      ) : (
        <Panel padding="none" variant="solid" data-testid="business-log">
          {rows.slice(0, shown).map((e) => (
            <div key={e.seq} className={styles.logRow}>
              <span className={styles.logIcon}>{ICON[e.severity] ?? ICON.info}</span>
              <span className={styles.logDate}>
                {monthName(e.month.month)} {e.month.year}
              </span>
              <span className={styles.logText}>{e.message}</span>
              <span className={styles.logAmount}>{e.amount !== undefined && e.kind !== 'buildingConstructed' ? fmt(e.amount, { signed: e.amount !== 0 }) : ''}</span>
              {e.buildingId !== undefined || e.cityId ? <IconButton size="sm" label="Locate" icon={<MapPin size={12} />} onClick={() => locate(e)} /> : <span />}
            </div>
          ))}
          {rows.length > shown && (
            <div className={shared.pager} style={{ padding: 10 }}>
              <button type="button" className={shared.link} onClick={() => setShown(shown + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} older events
              </button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
