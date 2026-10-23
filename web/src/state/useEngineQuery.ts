// React hook for panel-local engine data. Re-fetches automatically whenever
// the engine revision changes (after every tick or mutating call), so panels
// never need their own store wiring:
//
//   const { data, error } = useEngineQuery('buildings', { cityId });
//   const report = useEngineQuery('incomeStatement', args, { staleTime: 'closedPeriod' });
//
// Pass `null` as args to skip fetching (e.g. nothing selected yet).
//
// Identical in-flight requests (same method + args + revision) share one
// promise (bridge-spec §6.9), so several panels asking for the same data cost
// one worker round trip.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MethodArgs, MethodName, MethodResult } from '@/bridge/protocol';
import { EngineError } from '@/bridge/engine';
import { getEngine, maybeEngine, useGameStore } from './gameStore';

export interface EngineQuery<T> {
  data: T | undefined;
  error: EngineError | Error | undefined;
  loading: boolean;
  refetch: () => void;
}

export interface EngineQueryOptions {
  /**
   * 'revision' (default): refetch on every revision.
   * 'closedPeriod': fetch once per game for these args — closed months are immutable (bridge-spec §4.6.2).
   * 'never': fetch once per mount/args.
   */
  staleTime?: 'revision' | 'closedPeriod' | 'never';
  /** Keep showing the previous data while a refetch is in flight (default true). */
  keepPrevious?: boolean;
}

const inflight = new Map<string, Promise<unknown>>();
const closedPeriodCache = new Map<string, unknown>();

/** Shares one request among identical concurrent callers. */
export function coalescedCall<T>(method: string, argsJson: string, revision: number): Promise<T> {
  const key = `${revision}|${method}|${argsJson}`;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = getEngine()
    .callRaw<T>(method, JSON.parse(argsJson))
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Forget cached closed-period reports (called when the game changes). */
export function clearQueryCache(): void {
  closedPeriodCache.clear();
}

export function useEngineQuery<M extends MethodName>(
  method: M,
  args: MethodArgs<M> | null,
  options: EngineQueryOptions = {},
): EngineQuery<MethodResult<M>> {
  const { staleTime = 'revision', keepPrevious = true } = options;
  const revision = useGameStore((s) => s.revision);
  const gameId = useGameStore((s) => s.gameId);
  const [data, setData] = useState<MethodResult<M> | undefined>(undefined);
  const [error, setError] = useState<EngineError | Error | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const argsKey = args === null ? null : JSON.stringify(args);
  const seq = useRef(0);
  // Revision only participates in the dependency list for 'revision' staleness.
  const revisionKey = staleTime === 'revision' ? revision : 0;

  useEffect(() => {
    if (argsKey === null || !maybeEngine()) {
      setData(undefined);
      return;
    }
    const cacheKey = `${gameId}|${method}|${argsKey}`;
    if (staleTime === 'closedPeriod' && nonce === 0 && closedPeriodCache.has(cacheKey)) {
      setData(closedPeriodCache.get(cacheKey) as MethodResult<M>);
      setError(undefined);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    if (!keepPrevious) setData(undefined);
    coalescedCall<MethodResult<M>>(method, argsKey, revision)
      .then((result) => {
        if (id !== seq.current) return;
        if (staleTime === 'closedPeriod') closedPeriodCache.set(cacheKey, result);
        setData(result);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // `revision` is tracked through revisionKey so 'closedPeriod'/'never' queries do not refetch per tick.
  }, [method, argsKey, revisionKey, nonce, gameId, staleTime, keepPrevious]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, refetch };
}

/**
 * Run a mutating engine call from a component. Bumps the store revision on
 * success so every useEngineQuery refreshes; surfaces errors to the store.
 */
export async function engineMutate<M extends MethodName>(method: M, args: MethodArgs<M>): Promise<MethodResult<M> | undefined> {
  try {
    const result = await getEngine().callRaw<MethodResult<M>>(method, args);
    await useGameStore.getState().syncAfterMutation();
    return result;
  } catch (error) {
    useGameStore.getState().reportError(error);
    return undefined;
  }
}
