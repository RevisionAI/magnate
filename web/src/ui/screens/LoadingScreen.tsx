// Game-loading screen: covers the city view from the moment a game mode is chosen (or a save is opened) until the
// engine has set up the company AND every chunk of the city is built, then fades out to reveal the city.
//
// Three steps — founding the company / opening the books (engine), surveying the city (chunk workers, real
// progress), opening for business — over the dusk skyline backdrop, with a skyline that builds itself and rotating
// tips. The moving parts animate only transform / opacity so they keep playing while the main thread is busy
// (renderer start-up, shader compiles).

import { Check } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { CityScene } from '@/scene/CityScene';
import { getCityServices } from '@/scene/city/CityServices';
import { useGameStore, type Phase } from '@/state/gameStore';
import { useSavesStore } from '@/state/savesStore';
import { useInterval } from '@/ui/hooks';
import { BOOT_TIPS } from './BootScreen';
import { SkylineBackdrop } from './SkylineBackdrop';
import styles from './LoadingScreen.module.css';

type StepState = 'done' | 'active' | 'pending';

/** Share of the bar the engine step fills; the city build fills the rest up to 96 %, ready = 100 %. */
const ENGINE_SHARE = 0.3;
const CITY_SHARE = 0.66;

/** Building heights (% of the stage) for the self-building skyline. */
const TOWERS = [38, 62, 46, 84, 100, 70, 52, 90, 58, 34, 66];

export interface LoadingScreenProps {
  scene: CityScene | null;
  phase: Phase;
  /** City built: play the exit, then call `onExited`. */
  exiting: boolean;
  onExited: () => void;
}

function useTitle(): { kicker: string; title: string; sub: string | null } {
  const target = useGameStore((s) => s.loadingTarget);
  const scenarios = useGameStore((s) => s.scenarios);
  const slots = useSavesStore((s) => s.slots);
  if (target?.kind === 'load') {
    const meta = slots.find((m) => m.slotId === target.slotId);
    return {
      kicker: 'Loading save',
      title: meta?.scenarioName ?? meta?.companyName ?? 'Your saved game',
      sub: meta ? `${meta.companyName} · ${String(meta.date.month).padStart(2, '0')}/${meta.date.year}` : null,
    };
  }
  const scenario = scenarios.find((s) => s.id === target?.scenarioId);
  return {
    kicker: target?.companyName ? `New game · ${target.companyName}` : 'New game',
    title: scenario?.name ?? 'New game',
    sub: scenario?.description ?? null,
  };
}

export function LoadingScreen({ scene, phase, exiting, onExited }: LoadingScreenProps) {
  const isLoad = useGameStore((s) => s.loadingTarget?.kind === 'load');
  const { kicker, title, sub } = useTitle();
  const [startedAt] = useState(() => performance.now());
  const [city, setCity] = useState<{ built: number; total: number } | null>(null);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * BOOT_TIPS.length));
  const [, tick] = useState(0);
  const shown = useRef(0);
  const engineDone = phase === 'playing';
  const engineAt = useRef<number | null>(null);
  if (engineDone) engineAt.current ??= performance.now() - startedAt;

  // Poll the chunk build (cheap: a count over the chunks) and keep the simulated engine step easing forward.
  useInterval(() => {
    const p = scene && engineDone ? getCityServices(scene)?.buildProgress() ?? null : null;
    setCity(p && p.total > 0 ? p : null);
    tick((n) => n + 1);
  }, exiting ? null : 150);
  useInterval(() => setTip((t) => (t + 1) % BOOT_TIPS.length), exiting ? null : 5200);

  // The bar never moves backwards.
  const elapsed = performance.now() - startedAt;
  const raw = exiting
    ? 1
    : !engineDone
      ? ENGINE_SHARE * (1 - Math.exp(-elapsed / 1800))
      : // Before the first chunk lands (layout fetch, workers starting) the bar creeps so it never looks stuck.
        ENGINE_SHARE + CITY_SHARE * Math.max(city ? city.built / city.total : 0, 0.12 * (1 - Math.exp(-(elapsed - (engineAt.current ?? elapsed)) / 2500)));
  shown.current = Math.max(shown.current, raw);
  const progress = shown.current;

  // Exit: fade out, then unmount (timer fallback in case animationend never fires, e.g. reduced motion).
  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(onExited, 900);
    return () => window.clearTimeout(t);
  }, [exiting, onExited]);

  const steps: { label: string; state: StepState; detail?: string }[] = [
    { label: isLoad ? 'Opening your books' : 'Founding your company', state: engineDone ? 'done' : 'active' },
    {
      label: 'Surveying the city',
      state: exiting ? 'done' : engineDone ? 'active' : 'pending',
      detail: engineDone && !exiting && city ? `${Math.round((city.built / city.total) * 100)}%` : undefined,
    },
    { label: 'Opening for business', state: exiting ? 'done' : 'pending' },
  ];
  const active = steps.find((s) => s.state === 'active');

  return (
    <div
      className={clsx(styles.loading, exiting && styles.exiting)}
      data-testid="game-loading"
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
      onAnimationEnd={(e) => {
        if (exiting && e.target === e.currentTarget) onExited();
      }}
    >
      <SkylineBackdrop />
      <div className={styles.card}>
        <div className={styles.builder} aria-hidden="true">
          {TOWERS.map((h, i) => (
            <span key={i} className={styles.tower} style={{ height: `${h}%`, animationDelay: `${i * 0.11}s` }} />
          ))}
          <span className={styles.crane} />
          <span className={styles.ground} />
        </div>

        <div className={styles.kicker}>{kicker}</div>
        <h1 className={styles.title} data-testid="game-loading-title">
          {title}
        </h1>
        {sub && <p className={styles.sub}>{sub}</p>}

        <div className={styles.bar} role="progressbar" aria-label="Loading the game" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className={styles.fill} style={{ transform: `scaleX(${progress.toFixed(4)})` }} />
          {!exiting && <div className={styles.sweep} />}
        </div>

        <ol className={styles.steps}>
          {steps.map((s) => (
            <li key={s.label} className={clsx(styles.step, styles[s.state])}>
              <span className={styles.mark}>{s.state === 'done' ? <Check size={11} strokeWidth={3} /> : null}</span>
              <span>{s.label}</span>
              {s.detail && <span className={styles.detail}>{s.detail}</span>}
            </li>
          ))}
        </ol>
        <span className={styles.srOnly}>{active ? `${active.label}…` : 'Ready'}</span>

        <p key={tip} className={styles.tip}>
          “{BOOT_TIPS[tip]}”
        </p>
      </div>
    </div>
  );
}
