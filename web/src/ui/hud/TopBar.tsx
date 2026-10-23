// HUD top bar (UX §6.3): company chip, Cash (roll-up + last month's cash flow,
// runway and insolvency badges), Company Value (Δ%), month profit with a 12-month
// sparkline, the date with a smooth 30-day clock and deadline chip, speed
// controls (pause · 1× · 2× · 4× · 8× · step · skip), alerts bell and menu.

import clsx from 'clsx';
import { Bell, Menu, Pause, SkipForward, StepForward, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audio } from '@/audio';
import { bus } from '@/game/events';
import { SECONDS_PER_MONTH, SPEED_LABEL, VISUAL_DAYS, dayOfMonth, type Speed } from '@/game/clock';
import { unreadSummary, useAlertsStore } from '@/state/alertsStore';
import { clock, useGameStore } from '@/state/gameStore';
import { scenarioTitle } from '@/state/scenarios';
import { useSettingsStore } from '@/state/settingsStore';
import { useUiStore } from '@/state/uiStore';
import { Badge, Delta, Emblem, IconButton, Sparkline, Tooltip } from '@/ui/components';
import { useAnimatedNumber, useFrame } from '@/ui/hooks';
import { moneyFmt, monthYear, relativeChange, signedMoney } from '@/util/format';
import styles from './TopBar.module.css';

const SPEED_BUTTONS: { speed: Exclude<Speed, 0>; testId: string; uiId: string }[] = [
  { speed: 1, testId: 'speed-1x', uiId: 'speed.1x' },
  { speed: 2, testId: 'speed-2x', uiId: 'speed.2x' },
  { speed: 3, testId: 'speed-4x', uiId: 'speed.4x' },
  { speed: 4, testId: 'speed-8x', uiId: 'speed.8x' },
];

/** Re-renders `true` for a moment after each month close (value flash). */
function useCloseFlash(): number {
  const [n, setN] = useState(0);
  useEffect(() => bus.on('monthClosed', () => setN((v) => v + 1)), []);
  return n;
}

/** Month label row + the smooth 30-day bar, written straight to the DOM every frame (no React re-render). */
function DayClock({ children }: { children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLSpanElement>(null);
  const last = useRef({ p: -1, day: -1, busy: false });
  useFrame(() => {
    const p = clock.progress;
    const busy = clock.busy;
    if (Math.abs(p - last.current.p) > 0.0005 || busy !== last.current.busy) {
      barRef.current?.style.setProperty('--p', p.toFixed(4));
      barRef.current?.classList.toggle(styles.closing, busy);
      last.current.p = p;
      last.current.busy = busy;
    }
    const day = dayOfMonth(p);
    if (day !== last.current.day && dayRef.current) {
      dayRef.current.textContent = `Day ${day}`;
      last.current.day = day;
    }
  });
  return (
    <>
      <div className={styles.dateRow}>
        {children}
        <span ref={dayRef} className={styles.day} data-testid="day">
          Day 1
        </span>
      </div>
      <div ref={barRef} className={styles.dayBar} aria-hidden>
        <div className={styles.dayFill} />
      </div>
    </>
  );
}

export function TopBar() {
  const hud = useGameStore((s) => s.hud);
  const history = useGameStore((s) => s.history);
  const speed = useGameStore((s) => s.speed);
  const held = useGameStore((s) => s.holds.length > 0 || s.skipping);
  const holdReason = useGameStore((s) => s.holds[0] ?? null);
  const skipping = useGameStore((s) => s.skipping);
  const stepping = useGameStore((s) => s.stepping);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  const stepMonth = useGameStore((s) => s.stepMonth);
  const skip = useGameStore((s) => s.skipToNextEvent);
  const numberFormat = useSettingsStore((s) => s.gameplay.numberFormat);
  const muted = useSettingsStore((s) => s.audio.muted);
  const updateSettings = useSettingsStore((s) => s.update);
  const alerts = useAlertsStore((s) => s.history);
  const openPanel = useUiStore((s) => s.togglePanel);
  const openModal = useUiStore((s) => s.openModal);
  const activeCity = useGameStore((s) => s.catalog?.cities.find((c) => c.id === s.activeCityId)?.name);
  const flash = useCloseFlash();

  const player = hud?.player ?? null;
  const cash = useAnimatedNumber(player?.cash ?? 0);
  const value = useAnimatedNumber(player?.value ?? 0);
  const unread = useMemo(() => unreadSummary(alerts), [alerts]);

  if (!hud || !player) return null;

  const prev = history.length >= 2 ? history[history.length - 2] : undefined;
  const cashDelta = player.cashFlow ?? (prev ? player.cash - prev.cash : null);
  const valueDelta = prev ? relativeChange(prev.value, player.value) : null;
  const niSeries = history.slice(-12).map((r) => r.netIncome);
  const months = hud.scenario?.monthsRemaining ?? null;
  const deadlineTone = months === null ? null : months <= 3 ? 'danger' : months <= 12 ? 'warning' : null;
  const runwayLow = player.runwayMonths !== null && player.runwayMonths < 3;
  const insolventIn = hud.insolvency.bankruptcyInMonths;
  const paused = speed === 0 || held;
  const speedPressed = (s: Speed) => speed === s;

  return (
    <header className={styles.bar} data-testid="topbar">
      <div className={styles.segment}>
        <Tooltip title={player.name} content="Company overview — every building you own." shortcut="M" side="bottom">
          <button type="button" className={styles.company} onClick={() => openPanel('company')} data-ui-id="topbar.company">
            <Emblem shape={player.emblem} color={player.color} size={30} ring title="Your company" />
            <span className={styles.companyText}>
              <span className={styles.companyName}>{player.name}</span>
              <span className={styles.companySub}>
                {[activeCity, hud.scenario ? scenarioTitle(hud.scenario) : null].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        </Tooltip>
      </div>

      <div className={styles.segment}>
        <Tooltip
          side="bottom"
          wide
          title="Cash on hand"
          content={
            <>
              {cashDelta !== null && <div>Last month’s net cash flow: {signedMoney(cashDelta)}</div>}
              <div>Runway: {player.runwayMonths === null ? 'not burning cash' : `${player.runwayMonths.toFixed(1)} months at the recent burn rate`}</div>
              <div>Click for the cash-flow report.</div>
            </>
          }
        >
          <div
            className={clsx(styles.kpi, runwayLow && styles.lowRunway)}
            onClick={() => useUiStore.getState().openPanel('reports', { tab: 'cashflow' })}
            data-ui-id="topbar.cash"
          >
            <span className={styles.kpiLabel}>
              Cash
              {insolventIn !== null && (
                <Badge tone="danger" variant="solid" title="Cash below zero at month-end">
                  Insolvent in {insolventIn} mo
                </Badge>
              )}
              {insolventIn === null && runwayLow && <Badge tone="warning">Runway {player.runwayMonths!.toFixed(1)} mo</Badge>}
              {player.creditRating && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    useUiStore.getState().openPanel('finance', { tab: 'bank' });
                  }}
                  data-testid="topbar-credit-rating"
                >
                  <Badge tone={ratingTone(player.creditRating)} title="Credit rating (reviewed quarterly) · click for the Bank">
                    {player.creditRating}
                  </Badge>
                </span>
              )}
            </span>
            <span className={styles.kpiRow}>
              <span key={`c${flash}`} className={clsx(styles.kpiValue, player.cash < 0 && styles.neg, flash > 0 && styles.flash)} data-testid="cash">
                {moneyFmt(cash, numberFormat)}
              </span>
              <Delta value={cashDelta} kind="money" />
            </span>
          </div>
        </Tooltip>

        <Tooltip
          side="bottom"
          wide
          title="Company value"
          content={
            player.valueIsFallback
              ? 'Total assets (cash + inventory + buildings) until the engine’s Company Value is available. Click for the balance sheet.'
              : 'The unified Company Value — book equity, or market cap once listed. Click for the balance sheet.'
          }
        >
          <div className={styles.kpi} onClick={() => useUiStore.getState().openPanel('reports', { tab: 'balance' })} data-ui-id="topbar.value">
            <span className={styles.kpiLabel}>Company value</span>
            <span className={styles.kpiRow}>
              <span key={`v${flash}`} className={clsx(styles.kpiValue, flash > 0 && styles.flash)} data-testid="value">
                {moneyFmt(value, numberFormat)}
              </span>
              <Delta value={valueDelta} kind="percent" />
            </span>
          </div>
        </Tooltip>

        <Tooltip side="bottom" wide title="Net income this month" content="Revenue minus every cost booked this month. The bars show the last 12 months. Click for the income statement.">
          <div className={styles.kpi} onClick={() => useUiStore.getState().openPanel('reports', { tab: 'pnl' })} data-ui-id="topbar.profit">
            <span className={styles.kpiLabel}>Profit · month</span>
            <span className={styles.kpiRow}>
              <span className={clsx(styles.kpiValue, player.netIncome < 0 ? styles.neg : player.netIncome > 0 ? styles.pos : undefined)} data-testid="profit">
                {signedMoney(player.netIncome)}
              </span>
              <span className={styles.spark}>
                <Sparkline values={niSeries} variant="bars" minSlots={12} width={72} height={20} aria-label="Net income, last 12 months" />
              </span>
            </span>
          </div>
        </Tooltip>
      </div>

      <div className={styles.spacer} />

      <div className={styles.segment}>
        <Tooltip
          side="bottom"
          wide
          title={monthYear(hud.date)}
          content={
            <>
              <div>The books close at day {VISUAL_DAYS}; changes you make apply then.</div>
              <div>
                {hud.scenario?.endDate
                  ? `Deadline ${monthYear(hud.scenario.endDate)} · ${months ?? 0} months left`
                  : 'No deadline in this game.'}
              </div>
            </>
          }
        >
          <div className={clsx(styles.date, deadlineTone === 'warning' && styles.deadlineWarn, deadlineTone === 'danger' && styles.deadlineDanger)} onClick={() => openPanel('goals')} data-ui-id="topbar.date">
            <DayClock>
              <span className={styles.month} data-testid="date">
                {monthYear(hud.date)}
              </span>
              {deadlineTone && (
                <Badge tone={deadlineTone === 'danger' ? 'danger' : 'warning'} className={styles.deadline}>
                  {months} mo left
                </Badge>
              )}
            </DayClock>
          </div>
        </Tooltip>

        <div className={clsx(styles.speeds, held && styles.held)} role="group" aria-label="Game speed">
          <Tooltip title={paused ? (held && speed !== 0 ? `Paused by ${holdReason === 'overlay' ? 'a full-screen panel' : 'a menu'}` : 'Paused') : 'Pause'} shortcut="Space" side="bottom">
            <button
              type="button"
              className={clsx(styles.speed, styles.pauseBtn)}
              aria-pressed={paused}
              aria-label="Pause"
              data-testid="speed-pause"
              data-ui-id="speed.pause"
              onClick={() => {
                audio.ui('toggle');
                togglePause();
              }}
            >
              <Pause size={14} fill="currentColor" />
            </button>
          </Tooltip>
          {SPEED_BUTTONS.map((b) => (
            <Tooltip key={b.speed} title={`${SPEED_LABEL[b.speed]} — ${SECONDS_PER_MONTH[b.speed]} s per month`} shortcut={String(b.speed)} side="bottom">
              <button
                type="button"
                className={styles.speed}
                aria-pressed={speedPressed(b.speed)}
                data-testid={b.testId}
                data-ui-id={b.uiId}
                onClick={() => {
                  audio.ui('toggle');
                  setSpeed(b.speed);
                }}
              >
                {SPEED_LABEL[b.speed]}
              </button>
            </Tooltip>
          ))}
          <span className={styles.sep} />
          <Tooltip title="Step one month" content={speed !== 0 ? 'Pause first.' : 'Runs the month close once.'} shortcut="Period" side="bottom">
            <button
              type="button"
              className={styles.speed}
              aria-label="Step one month"
              disabled={speed !== 0 || stepping || skipping}
              data-testid="step-month"
              data-ui-id="speed.step"
              onClick={() => {
                audio.ui('click');
                void stepMonth();
              }}
            >
              <StepForward size={15} />
            </button>
          </Tooltip>
          <Tooltip title="Skip to the next event" content="Runs up to 12 months and stops at the next goal, warning, rival move or headline." shortcut="Shift+Period" side="bottom">
            <button
              type="button"
              className={clsx(styles.speed, styles.skipBtn)}
              aria-label="Skip to the next event"
              aria-pressed={skipping}
              disabled={stepping}
              data-testid="skip-event"
              data-ui-id="speed.skip"
              onClick={() => {
                audio.ui('click');
                void skip();
              }}
            >
              <SkipForward size={15} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={clsx(styles.segment, styles.right)}>
        {muted && (
          <IconButton
            label="Sound is muted"
            description="Click to unmute."
            kbd="Mod+M"
            icon={<VolumeX size={17} className={styles.mutedIcon} />}
            onClick={() => updateSettings('audio', { muted: false })}
          />
        )}
        <span className={styles.bell}>
          <IconButton
            label="Alerts"
            description={unread.count ? `${unread.count} unread` : 'Nothing new'}
            kbd="J"
            icon={<Bell size={18} />}
            onClick={() => openPanel('alerts')}
            data-testid="alerts-bell"
            data-ui-id="alerts.bell"
          />
          {unread.count > 0 && (
            <span className={styles.bellBadge}>
              <Badge
                count={unread.count}
                variant="solid"
                tone={unread.severity === 'critical' ? 'danger' : unread.severity === 'warning' ? 'warning' : unread.severity === 'opportunity' ? 'opportunity' : 'success'}
              />
            </span>
          )}
        </span>
        <IconButton label="Menu" description="Save, load, settings, quit." kbd="Escape" icon={<Menu size={19} />} onClick={() => openModal('pause')} data-testid="menu-button" data-ui-id="menu.button" />
      </div>
    </header>
  );
}

/** Badge tone of a credit rating (E2 scale AAA…D; NR while unrated). */
function ratingTone(rating: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  const r = rating.toUpperCase();
  if (r === 'NR') return 'neutral';
  if (r.startsWith('AA') || r === 'A' || r.startsWith('A+') || r.startsWith('A-') || r.startsWith('A−')) return 'success';
  if (r.startsWith('BBB')) return 'info';
  if (r.startsWith('BB') || r.startsWith('B')) return 'warning';
  return 'danger';
}
