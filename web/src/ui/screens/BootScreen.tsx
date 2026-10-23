// Boot / loading screen: the engine (.NET → WebAssembly, in a worker) starts while
// the skyline backdrop plays. Progress comes from the store's boot stages; between
// stage reports the bar eases forward on its own so it never looks frozen (the
// worker reports few stages). A failure shows the reason and a Retry.

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useGameStore, type BootStage } from '@/state/gameStore';
import { Button } from '@/ui/components';
import { useInterval } from '@/ui/hooks';
import { SkylineBackdrop } from './SkylineBackdrop';
import styles from './Screens.module.css';

const STAGE_LABEL: Record<BootStage, string> = {
  worker: 'Starting the engine',
  runtime: 'Starting the simulation runtime',
  content: 'Loading products, buildings and cities',
  scenarios: 'Preparing scenarios',
  catalog: 'Opening the catalogue',
  ready: 'Ready',
};

/** Loading-screen tips: how the game works, in the advisor's voice. */
export const BOOT_TIPS: readonly string[] = [
  'Revenue is vanity. Watch net income — and the cash tied up on your shelves.',
  'The books close at the end of every month. Price and stock changes apply at the close.',
  'Space pauses the clock. 1 to 4 set the speed; the full stop key steps one month.',
  'A rival undercut you? Match the price, outspend them on brand, or pick another market.',
  'Advertising builds awareness month by month. Stop paying and it slowly fades.',
  'Borrowing is fine when the new business earns more than the interest.',
  'Every number explains itself: hover it for the formula, click it for the report.',
  'Esc opens the pause menu. Magnate never throws away a game without asking.',
];

/** Simulated progress so the bar keeps moving between real stage reports (asymptotic to 0.8). */
function simulated(elapsedMs: number): number {
  return 0.8 * (1 - Math.exp(-elapsedMs / 2600));
}

export function BootScreen() {
  const phase = useGameStore((s) => s.phase);
  const error = useGameStore((s) => s.bootError);
  const stage = useGameStore((s) => s.bootStage);
  const real = useGameStore((s) => s.bootProgress);
  const [startedAt] = useState(() => performance.now());
  const [now, setNow] = useState(startedAt);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * BOOT_TIPS.length));
  const failed = phase === 'bootFailed';

  useInterval(() => setNow(performance.now()), failed ? null : 120);
  useInterval(() => setTip((t) => (t + 1) % BOOT_TIPS.length), failed ? null : 5200);

  const progress = Math.min(1, Math.max(real, simulated(now - startedAt)));

  return (
    <div className={`${styles.screen} ${styles.boot}`} data-testid="boot-screen">
      <SkylineBackdrop />
      <div className={styles.bootCard}>
        <div className={`${styles.logo} ${styles.logoShine} ${styles.bootLogo}`} data-text="Magnate">
          Magnate
        </div>
        <div className={styles.bootTag}>Build · Compete · Own the city</div>
        {failed ? (
          <>
            <div className={styles.bootError} role="alert" data-testid="boot-error">
              <b>The simulation engine failed to start.</b>
              <br />
              {error ?? 'Unknown error.'}
              <br />
              <span className="muted">Magnate needs a current browser with WebAssembly and module workers enabled.</span>
            </div>
            <Button variant="primary" icon={<RotateCcw size={15} />} onClick={() => window.location.reload()} data-testid="boot-retry">
              Try again
            </Button>
          </>
        ) : (
          <>
            <div
              className={styles.bootBar}
              role="progressbar"
              aria-label="Loading"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div className={styles.bootFill} style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
            <div className={styles.bootStage} aria-live="polite">
              {STAGE_LABEL[stage]} · {Math.round(progress * 100)}%
            </div>
            <p key={tip} className={styles.bootTip}>
              “{BOOT_TIPS[tip]}”
            </p>
          </>
        )}
      </div>
    </div>
  );
}
