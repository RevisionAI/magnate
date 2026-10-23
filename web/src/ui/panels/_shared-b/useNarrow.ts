// True while the viewport is narrower than `maxWidth` CSS px — screens drop
// secondary table columns at 1280×720 instead of scrolling sideways.

import { useSyncExternalStore } from 'react';

export function useNarrow(maxWidth = 1500): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Drops the columns with these ids while `narrow`. */
export function dropColumns<C extends { id: string }>(narrow: boolean, ids: readonly string[], columns: C[]): C[] {
  return narrow ? columns.filter((c) => !ids.includes(c.id)) : columns;
}
