// Real-time game clock (MASTER-PLAN D5). The engine simulates whole months; the
// client shows a 30-day visual clock in between so the city feels continuous.
// When a month's worth of real time has elapsed the clock asks the store to
// advance the engine, holding at day 30 until that tick resolves (the main
// thread never blocks on the engine).
//
//   speed index:   0 = pause · 1 = 1× · 2 = 2× · 3 = 4× · 4 = 8×
//   seconds/month: —           12      6       3       1.5
//
// Player commands issued mid-month apply at the next month close; the clock
// exposes `daysUntilClose` so the UI can say "applies at month close (in 9 days)".

/** Speed index (0 = paused). Use SPEED_MULTIPLIER for the playback rate. */
export type Speed = 0 | 1 | 2 | 3 | 4;

export const SPEEDS: readonly Speed[] = [0, 1, 2, 3, 4];

/** Playback rate per speed index (0 = paused). */
export const SPEED_MULTIPLIER: Readonly<Record<Speed, number>> = { 0: 0, 1: 1, 2: 2, 3: 4, 4: 8 };

/**
 * Real seconds per simulated month for each speed index (index 0 = paused).
 * A tuple (not a record) on purpose: audio decodes bus speeds through it.
 */
export const SECONDS_PER_MONTH = [Infinity, 12, 6, 3, 1.5] as const satisfies readonly number[];

/** Short labels for buttons and tooltips. */
export const SPEED_LABEL: Readonly<Record<Speed, string>> = { 0: 'Paused', 1: '1×', 2: '2×', 3: '4×', 4: '8×' };

/** Visual days per month (D5: a 30-day visual clock regardless of the calendar month). */
export const VISUAL_DAYS = 30;

/** Largest frame delta the clock accepts (a backgrounded tab must not skip months). */
const MAX_FRAME_SECONDS = 0.25;

export function isSpeed(value: unknown): value is Speed {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/** Visual day (1..30) for a month progress in [0, 1]. */
export function dayOfMonth(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.min(VISUAL_DAYS, 1 + Math.floor(p * VISUAL_DAYS));
}

/** Whole visual days left until the month closes (0 while the close is running). */
export function daysUntilClose(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.max(0, VISUAL_DAYS - Math.floor(p * VISUAL_DAYS));
}

export class GameClock {
  /** 0..1 progress through the current month. */
  progress = 0;
  /** Effective speed the clock runs at (0 while paused or held). */
  speed: Speed = 0;
  private ticking = false;

  constructor(private readonly onMonthElapsed: () => Promise<void>) {}

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  /** Playback rate (0 when paused). */
  get multiplier(): number {
    return SPEED_MULTIPLIER[this.speed];
  }

  /** Visual day 1..30. */
  get day(): number {
    return dayOfMonth(this.progress);
  }

  /** Days until the next month close. */
  get daysUntilClose(): number {
    return daysUntilClose(this.progress);
  }

  /** Call every animation frame with real elapsed seconds. */
  update(dtSeconds: number): void {
    if (this.speed === 0 || this.ticking) return;
    const secondsPerMonth = SECONDS_PER_MONTH[this.speed];
    const dt = Math.min(Math.max(0, dtSeconds), MAX_FRAME_SECONDS);
    this.progress += dt / secondsPerMonth;
    if (this.progress >= 1) void this.runClose();
  }

  /**
   * Close the current month now (step-one-month, skip-to-event). Resolves when
   * the engine tick has been applied; a no-op while a close is already running.
   * Returns false when it did not run.
   */
  async closeMonth(): Promise<boolean> {
    if (this.ticking) return false;
    await this.runClose();
    return true;
  }

  /** Back to day 1 (new game / load). */
  reset(): void {
    this.progress = 0;
  }

  /** True while waiting on the engine to finish a month. */
  get busy(): boolean {
    return this.ticking;
  }

  private async runClose(): Promise<void> {
    this.progress = 1;
    this.ticking = true;
    try {
      await this.onMonthElapsed();
    } catch (error) {
      console.error('[clock] month tick failed', error);
    } finally {
      this.progress = 0;
      this.ticking = false;
    }
  }
}
