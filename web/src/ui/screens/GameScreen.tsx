// The city screen: L0 three.js world (CityScene + the modules from scene/modules —
// city (W2), living city (W5), interaction (W6)) under the L1–L3 HUD. The scene is created once per
// game screen; graphics settings are pushed to it live when the renderer exposes
// the settings API (feature-detected so older scene builds keep working).
//
// Starting a game or opening a save shows the LoadingScreen until the engine has the company AND the city's chunks
// are all built; the scene is created only after that screen has painted (renderer start-up blocks the main thread),
// and the clock is held while it is up.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CityScene } from '@/scene/CityScene';
import { onCityServices } from '@/scene/city/CityServices';
import { createGameModules } from '@/scene/modules';
import { clock, useGameStore } from '@/state/gameStore';
import { effectiveReducedMotion, useSettingsStore, type GraphicsSettings } from '@/state/settingsStore';
import { prefersReducedMotion } from '@/theme/cssVars';
import { Hud } from '@/ui/hud/Hud';
import { LoadingScreen } from './LoadingScreen';
import styles from './Screens.module.css';

/** The loading screen stays at least this long (no flash when a save of the same city opens instantly)… */
const LOADING_MIN_MS = 900;
/** …and gives up waiting for the city after this long once the engine is ready (never strands the player). */
const CITY_TIMEOUT_MS = 45_000;

/** The renderer's optional settings surface (W1: CityScene.setGraphics / setDayNightMode). */
interface SceneSettingsApi {
  setGraphics?: (settings: { preset?: string; shadows?: boolean; agentDensity?: number; resolutionScale?: number | 'auto'; fpsCap?: 0 | 30 }) => void;
  setDayNightMode?: (mode: GraphicsSettings['dayNight']) => void;
}

function applyGraphics(scene: CityScene, g: GraphicsSettings): void {
  const api = scene as unknown as SceneSettingsApi;
  try {
    api.setGraphics?.({
      preset: g.quality,
      shadows: g.shadows,
      agentDensity: g.ambientDensity / 100,
      resolutionScale: g.resolutionScale >= 100 && g.quality === 'auto' ? 'auto' : g.resolutionScale / 100,
      fpsCap: g.fpsCap,
    });
    api.setDayNightMode?.(g.dayNight);
  } catch (error) {
    console.warn('[scene] graphics settings not applied', error);
  }
}

/** The scene's current city: its id and whether every chunk is built (re-armed on every layout). */
function useCityBuilt(scene: CityScene | null): { cityId: string | null; built: boolean } {
  const [state, setState] = useState<{ cityId: string | null; built: boolean }>({ cityId: null, built: false });
  useEffect(() => {
    if (!scene) return;
    let current: unknown = null;
    return onCityServices(scene, (services) => {
      current = services;
      setState({ cityId: services?.cityId ?? null, built: false });
      void services?.whenReady().then(() => {
        if (current === services) setState({ cityId: services.cityId, built: true });
      });
    });
  }, [scene]);
  return state;
}

/** Loading-screen lifecycle: opens with each new game / load, exits once the engine and the active city are ready. */
function useLoadingScreen(scene: CityScene | null) {
  const phase = useGameStore((s) => s.phase);
  const activeCityId = useGameStore((s) => s.activeCityId);
  const city = useCityBuilt(scene);
  const engineBusy = phase === 'starting' || phase === 'loading';
  const [open, setOpen] = useState(engineBusy);
  const [exiting, setExiting] = useState(false);
  const openedAt = useRef(performance.now());
  const playingAt = useRef<number | null>(null);

  // A load started from inside a game re-opens it.
  useEffect(() => {
    if (!engineBusy) return;
    setOpen(true);
    setExiting(false);
    openedAt.current = performance.now();
    playingAt.current = null;
  }, [engineBusy]);

  const ready = phase === 'playing' && city.built && city.cityId === activeCityId;
  useEffect(() => {
    if (!open || exiting || phase !== 'playing') return;
    playingAt.current ??= performance.now();
    // Give the first frames of the finished city a moment (shader warm-up) before revealing it.
    const wait = ready
      ? Math.max(LOADING_MIN_MS - (performance.now() - openedAt.current), 250)
      : CITY_TIMEOUT_MS - (performance.now() - playingAt.current);
    const t = window.setTimeout(() => setExiting(true), Math.max(0, wait));
    return () => window.clearTimeout(t);
  }, [open, exiting, phase, ready]);

  // Time stands still while the player cannot see the city.
  useEffect(() => {
    const { hold, release } = useGameStore.getState();
    if (open && !exiting) hold('loading');
    else release('loading');
  }, [open, exiting]);
  useEffect(() => () => useGameStore.getState().release('loading'), []);

  const onExited = useCallback(() => {
    setOpen(false);
    setExiting(false);
  }, []);
  return { open, exiting, onExited, phase };
}

export function GameScreen() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const phase = useGameStore((s) => s.phase);
  const [scene, setScene] = useState<CityScene | null>(null);
  const loading = useLoadingScreen(scene);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    let instance: CityScene | null = null;
    let offSettings: (() => void) | null = null;
    let cancelled = false;
    let timer = 0;
    // Let the loading screen paint (and its compositor animations start) before the renderer blocks the thread.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        raf = 0;
        timer = window.setTimeout(create, 0);
      });
    });

    function create(): void {
      if (cancelled || !container) return;
      const settings = useSettingsStore.getState();
      const reducedMotion = effectiveReducedMotion(settings.interface.reducedMotion, prefersReducedMotion());
      // W1 accepts more options (dayNight, reducedMotion…); older scene builds ignore them.
      const options = {
        onFrame: (dt: number) => {
          clock.update(dt);
          return { monthProgress: clock.progress, speed: clock.multiplier };
        },
        dayNight: reducedMotion && settings.graphics.dayNight === 'dynamic' ? 'day' : settings.graphics.dayNight,
        reducedMotion,
        // QA hook (as in ?dev=city): ?power=low-power picks the integrated GPU on dual-GPU Macs for
        // the LOW-tier frame-time budget runs.
        ...(powerParam() ? { powerPreference: powerParam() } : {}),
      } as ConstructorParameters<typeof CityScene>[1];
      const created = new CityScene(container, options);
      instance = created;
      void (async () => {
        for (const module of createGameModules()) await created.add(module);
      })();
      applyGraphics(created, settings.graphics);
      offSettings = useSettingsStore.subscribe((next, prev) => {
        if (next.graphics !== prev.graphics) applyGraphics(created, next.graphics);
      });
      (window as unknown as { __magnateScene?: CityScene }).__magnateScene = created;
      setScene(created);
    }

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      offSettings?.();
      instance?.dispose();
      delete (window as unknown as { __magnateScene?: CityScene }).__magnateScene;
    };
  }, []);

  return (
    <div className={styles.game} data-testid="game-screen">
      <div className={styles.viewport} ref={viewportRef} />
      {phase === 'playing' && <Hud />}
      {loading.open && <LoadingScreen scene={scene} phase={loading.phase} exiting={loading.exiting} onExited={loading.onExited} />}
    </div>
  );
}

/** `?power=low-power|high-performance` (QA only); null otherwise. */
function powerParam(): WebGLPowerPreference | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('power');
  return v === 'low-power' || v === 'high-performance' ? v : null;
}
