// One engine method over a list of argument sets (a statement column per
// period, a detail per building). Same contract as `useEngineQuery`: re-fetches
// when the engine revision changes, shares identical in-flight requests
// (coalescedCall), keeps the previous data while refetching. Entries flagged
// `closed` (a period entirely before the current month) are immutable
// (bridge-spec §4.6.2) and cached per game.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MethodArgs, MethodName, MethodResult } from '@/bridge/protocol';
import { maybeEngine, useGameStore } from '@/state/gameStore';
import { coalescedCall } from '@/state/useEngineQuery';

export interface EngineQueries<T> {
  data: (T | undefined)[];
  errors: (Error | undefined)[];
  loading: boolean;
  /** First error, if any. */
  error: Error | undefined;
}

const closedCache = new Map<string, unknown>();
let cacheGame: string | null = null;

export function useEngineQueries<M extends MethodName>(
  method: M,
  argsList: readonly MethodArgs<M>[] | null,
  closed?: readonly boolean[],
): EngineQueries<MethodResult<M>> {
  const revision = useGameStore((s) => s.revision);
  const gameId = useGameStore((s) => s.gameId);
  const keys = useMemo(() => (argsList ? argsList.map((a) => JSON.stringify(a)) : null), [argsList]);
  const keyString = keys ? keys.join('\u0001') : null;
  const closedString = closed ? closed.map((c) => (c ? '1' : '0')).join('') : '';
  const [state, setState] = useState<{ data: (MethodResult<M> | undefined)[]; errors: (Error | undefined)[]; loading: boolean }>({ data: [], errors: [], loading: false });
  const seq = useRef(0);

  useEffect(() => {
    if (!keys || !maybeEngine()) {
      setState({ data: [], errors: [], loading: false });
      return;
    }
    if (cacheGame !== gameId) {
      closedCache.clear();
      cacheGame = gameId;
    }
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const jobs = keys.map((k, i) => {
      const cacheKey = `${method}|${k}`;
      if (closedString[i] === '1' && closedCache.has(cacheKey)) return Promise.resolve({ ok: true as const, value: closedCache.get(cacheKey) as MethodResult<M> });
      return coalescedCall<MethodResult<M>>(method, k, revision).then(
        (value) => {
          if (closedString[i] === '1') closedCache.set(cacheKey, value);
          return { ok: true as const, value };
        },
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error : new Error(String(error)) }),
      );
    });
    void Promise.all(jobs).then((results) => {
      if (id !== seq.current) return;
      setState({
        data: results.map((r) => (r.ok ? r.value : undefined)),
        errors: results.map((r) => (r.ok ? undefined : r.error)),
        loading: false,
      });
    });
    // keys/closed are captured through their string forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, keyString, closedString, revision, gameId]);

  return { ...state, error: state.errors.find((e) => e !== undefined) };
}
