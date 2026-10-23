// Advisor bubble pacing (pure, unit-tested): how long a non-critical line stays
// up before the next one replaces it.

/** About a reading time (4 s + 0.32 s/word, 9–20 s); at most 7 s while more lines are waiting. */
export function advisorReadMs(text: string, queued: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = Math.min(20000, Math.max(9000, 4000 + words * 320));
  return queued > 0 ? Math.min(ms, 7000) : ms;
}
