// Bottom-of-screen HUD pieces: the newspaper-style news ticker (UX §6.3, 30 px/s,
// click → News), the month-close chip (UX §6.4: roll-up, auto-hides after 6 s
// unless hovered, [Why?] → Reports) and the auto-pause banner.

import clsx from 'clsx';
import { PauseCircle, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bus, type MonthClosedMoment } from '@/game/events';
import { useGameStore } from '@/state/gameStore';
import { normalizeEvent } from '@/state/gameEvents';
import { useUiStore } from '@/state/uiStore';
import { Button } from '@/ui/components';
import { useAnimatedNumber, useElementSize } from '@/ui/hooks';
import { compact, money, monthName, monthYear, signedMoney } from '@/util/format';
import styles from './BottomBar.module.css';

const TICKER_PX_PER_SEC = 30;
/** Below this width the ticker hides (a drawer is open on a small screen). */
const TICKER_MIN_PX = 380;
const TICKER_KINDS = new Set(['news', 'rivalEnteredMarket', 'rivalUndercut', 'patentGranted', 'buildingConstructed', 'revenueMilestone', 'goalAchieved']);

interface TickerItem {
  id: string;
  text: string;
  tone: 'major' | 'notable' | 'info';
}

export function NewsTicker() {
  const feed = useGameStore((s) => s.feed);
  const hud = useGameStore((s) => s.hud);
  const city = useGameStore((s) => s.catalog?.cities.find((c) => c.id === s.activeCityId));
  const openPanel = useUiStore((s) => s.openPanel);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(40);
  // When a drawer squeezes the ticker on small screens, it steps aside rather than show a sliver.
  const [rootRef, { width }] = useElementSize<HTMLDivElement>();
  const squeezed = width > 0 && width < TICKER_MIN_PX;

  const items: TickerItem[] = useMemo(() => {
    const news = feed
      .filter((f) => TICKER_KINDS.has(f.kind) && (f.kind !== 'buildingConstructed' || (f as { isPlayer?: boolean }).isPlayer === false))
      .slice(-5)
      .reverse()
      .map((f) => {
        const e = normalizeEvent(f);
        return { id: `f${f.id}`, text: e.message, tone: e.newsSeverity === 'major' ? 'major' : e.newsSeverity === 'notable' || e.priority >= 2 ? 'notable' : 'info' } as TickerItem;
      })
      .filter((i) => i.text);
    if (news.length > 0) return news;
    // Quiet market: honest scene-setting lines from the snapshot.
    const lines: TickerItem[] = [];
    if (city) lines.push({ id: 'city', text: `${city.name} at a glance: ${compact(city.population, 0)} residents and growing demand for everyday goods`, tone: 'info' });
    if (hud) {
      const rivals = hud.rivals.filter((r) => r.buildings > 0).length;
      lines.push({ id: 'rivals', text: rivals > 0 ? `${rivals} rival ${rivals === 1 ? 'company operates' : 'companies operate'} in the region` : 'No rival has opened a store yet — first movers set the price', tone: 'info' });
      if (hud.player) lines.push({ id: 'you', text: `${hud.player.name} holds ${money(hud.player.cash)} in cash, ready to invest`, tone: 'info' });
    }
    return lines;
  }, [feed, hud, city]);

  // Duration so the track moves at a constant 30 px/s regardless of content length.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 2;
    setDuration(Math.max(12, half / TICKER_PX_PER_SEC));
  }, [items]);

  const doubled = [...items, ...items];
  return (
    <div ref={rootRef} className={clsx(styles.ticker, squeezed && styles.squeezed)} data-testid="news-ticker" aria-hidden={squeezed || undefined}>
      <button type="button" className={styles.masthead} onClick={() => openPanel('news')} title="Open News & Events (N)">
        <span className={styles.mastTitle}>The Magnate Times</span>
        {hud && <span className={styles.mastDate}>{`${monthName(hud.date.month)} ${hud.date.year}`}</span>}
      </button>
      <div className={styles.viewport}>
        <div ref={trackRef} className={styles.track} style={{ animationDuration: `${duration}s` }}>
          {doubled.map((item, i) => (
            <button
              key={`${item.id}-${i}`}
              type="button"
              className={clsx(styles.headline, item.tone === 'major' && styles.major)}
              onClick={() => openPanel('news')}
              tabIndex={i < items.length ? 0 : -1}
              aria-hidden={i >= items.length}
            >
              <span className={clsx(styles.dot, item.tone === 'major' && styles.dotMajor, item.tone === 'notable' && styles.dotNotable)} />
              {item.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const CHIP_MS = 6000;

export function MonthCloseChip() {
  const [moment, setMoment] = useState<MonthClosedMoment | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const openPanel = useUiStore((s) => s.openPanel);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () =>
      bus.on('monthClosed', (m) => {
        setMoment(m);
        setLeaving(false);
      }),
    [],
  );

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!moment || hovered) return;
    timer.current = window.setTimeout(() => setLeaving(true), CHIP_MS);
    return () => window.clearTimeout(timer.current);
  }, [moment, hovered]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setMoment(null), 320);
    return () => window.clearTimeout(t);
  }, [leaving]);

  const revenue = useAnimatedNumber(moment?.revenue ?? 0);
  const net = useAnimatedNumber(moment?.netIncome ?? 0);
  const cash = useAnimatedNumber(moment?.cashEnd ?? 0);

  if (!moment) return null;
  return (
    <div
      className={clsx(styles.close, leaving && styles.closeOut)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      role="status"
      aria-live="polite"
      data-testid="month-close"
    >
      <span className={styles.closeLabel}>{monthYear(moment.month)} closed</span>
      <span className={styles.closeStat}>
        Revenue <b>{money(revenue)}</b>
      </span>
      <span className={styles.closeStat}>
        Net <b className={moment.netIncome >= 0 ? styles.pos : styles.neg}>{signedMoney(net)}</b>
      </span>
      <span className={styles.closeStat}>
        Cash <b>{money(cash)}</b>
      </span>
      {moment.profitStreak >= 3 && <span className={styles.streak}>{moment.profitStreak} profitable months</span>}
      <Button size="sm" variant="secondary" onClick={() => openPanel('reports', { tab: 'pnl' })}>
        Why?
      </Button>
    </div>
  );
}

export function AutoPauseBanner() {
  const notice = useGameStore((s) => s.autoPause);
  const speed = useGameStore((s) => s.speed);
  const resume = useGameStore((s) => s.togglePause);
  if (!notice || speed !== 0) return null;
  return (
    <div className={styles.pauseBanner} role="status" data-testid="autopause-banner">
      <span className={styles.pauseIcon}>
        <PauseCircle size={16} />
      </span>
      Paused — {notice.message}
      <Button size="sm" variant="primary" icon={<Play size={12} fill="currentColor" />} kbd="Space" onClick={resume}>
        Resume
      </Button>
    </div>
  );
}
