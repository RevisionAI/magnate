// Small React hooks shared by the design system and the HUD.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MOTION } from '@/theme/tokens';

/** Size of an element, tracked with ResizeObserver (0×0 until mounted). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize((s) => (s.width === rect.width && s.height === rect.height ? s : { width: rect.width, height: rect.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

type FrameCallback = (dt: number, now: number) => void;
const frameCallbacks = new Set<FrameCallback>();
let frameHandle = 0;
let lastFrame = 0;

function runFrames(now: number): void {
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  for (const cb of [...frameCallbacks]) {
    try {
      cb(dt, now);
    } catch (error) {
      console.error('[frame] callback failed', error);
    }
  }
  frameHandle = frameCallbacks.size > 0 ? requestAnimationFrame(runFrames) : 0;
  if (!frameHandle) lastFrame = 0;
}

/**
 * Runs `callback` every animation frame from one shared rAF loop. Use it to write
 * to the DOM directly (refs) for 60 Hz visuals without re-rendering React.
 */
export function useFrame(callback: FrameCallback, enabled = true): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!enabled) return;
    const cb: FrameCallback = (dt, now) => saved.current(dt, now);
    frameCallbacks.add(cb);
    if (!frameHandle) frameHandle = requestAnimationFrame(runFrames);
    return () => {
      frameCallbacks.delete(cb);
    };
  }, [enabled]);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true';
}

/**
 * Animates a number toward `target` (the HUD money roll-up, UX §6.3: 600 ms ease-out).
 * Returns the current displayed value. Jumps immediately with reduced motion.
 */
export function useAnimatedNumber(target: number, durationMs: number = MOTION.rollup): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const start = useRef(0);
  const current = useRef(target);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setValue(target);
      return;
    }
    if (reducedMotion() || !Number.isFinite(current.current) || durationMs <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    from.current = current.current;
    start.current = performance.now();
    setAnimating(true);
  }, [target, durationMs]);

  useFrame(
    (_dt, now) => {
      const t = Math.min(1, (now - start.current) / durationMs);
      const v = from.current + (target - from.current) * easeOutCubic(t);
      current.current = t >= 1 ? target : v;
      setValue(current.current);
      if (t >= 1) setAnimating(false);
    },
    animating,
  );
  return value;
}

/** setInterval as a hook (null delay pauses it). */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setInterval(() => saved.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}

/** Calls `handler` on pointerdown outside every given element. */
export function useOutsideClick(refs: readonly RefObject<HTMLElement | null>[], handler: () => void, enabled = true): void {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (refs.some((r) => r.current && target && r.current.contains(target))) return;
      saved.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
    // refs are stable RefObjects
  }, [enabled, refs]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab focus inside `ref` while active and restores the previous focus on release. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? root;
    first.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/** A stable id for aria attributes. */
let idCounter = 0;
export function useStableId(prefix = 'ui'): string {
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}

/** Latest value in a ref (for event handlers registered once). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Forces a re-render every `ms` (relative timestamps). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

/** Stable callback identity with fresh closure. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
