// App shell: the dev routes (?dev=assets|scene|audio|ui) or the game's phase
// router — boot → title → new game → city — plus the app-level L4 modal host
// (pause, settings, save/load, outcome, confirm), so Settings and Load also
// work from the title screen.
import { useEffect } from 'react';
import { useGameStore, type Phase } from '@/state/gameStore';
import { BootScreen } from '@/ui/screens/BootScreen';
import { TitleScreen } from '@/ui/screens/TitleScreen';
import { ScenarioSelect } from '@/ui/screens/ScenarioSelect';
import { GameScreen } from '@/ui/screens/GameScreen';
import { ModalHost } from '@/ui/modals/ModalHost';
import { DevRoute, devPageFromUrl } from '@/dev/DevRoutes';

const devPage = devPageFromUrl();

export function App() {
  if (devPage) return <DevRoute page={devPage} />;
  return <Game />;
}

const TITLES: Record<Phase, string> = {
  booting: 'Magnate',
  bootFailed: 'Magnate',
  title: 'Magnate',
  scenarioSelect: 'New game · Magnate',
  starting: 'Magnate',
  loading: 'Loading · Magnate',
  playing: 'Magnate',
};

/** Browser-level guard: closing the tab with unsaved progress asks first (UX §6.19). */
function useUnloadGuard(phase: Phase): void {
  useEffect(() => {
    if (phase !== 'playing') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useGameStore.getState().hasUnsavedProgress()) return;
      e.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);
}

function Game() {
  const phase = useGameStore((s) => s.phase);
  const boot = useGameStore((s) => s.boot);
  const company = useGameStore((s) => s.hud?.player?.name ?? null);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    document.title = phase === 'playing' && company ? `${company} · Magnate` : TITLES[phase];
  }, [phase, company]);

  useUnloadGuard(phase);

  return (
    <>
      <Screen phase={phase} />
      <ModalHost />
    </>
  );
}

function Screen({ phase }: { phase: Phase }) {
  switch (phase) {
    case 'booting':
    case 'bootFailed':
      return <BootScreen />;
    case 'title':
      return <TitleScreen />;
    case 'scenarioSelect':
      return <ScenarioSelect />;
    case 'starting':
    case 'loading':
    case 'playing':
      return <GameScreen />;
  }
}
