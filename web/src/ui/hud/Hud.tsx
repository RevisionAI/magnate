// The in-game HUD frame (UX §6.2–6.3): L1 HUD (top bar, rail, goals + toasts,
// minimap, ticker, month-close chip, advisor dock), the L2 drawer host and the L3
// overlay host, plus FX layers, the context menu and the tutorial coach mark.
// L4 modals live in the app-level ModalHost.
//
// Time rules wired here: L4 modals always hold the clock; L3 overlays hold it
// when Settings → "Pause while in full-screen screens" is on. Building selection
// opens the inspector drawer; closing the drawer clears the selection.

import clsx from 'clsx';
import { useEffect } from 'react';
import { useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { topDrawer, useUiStore } from '@/state/uiStore';
import { ContextMenuHost } from '@/ui/components';
import { ConfettiLayer, PopupLayer } from '@/ui/fx/FxLayers';
import { useGameHotkeys } from '@/ui/input/useGameHotkeys';
import { DrawerHost, OverlayHost } from '@/ui/panels/PanelHosts';
import { CoachMark } from '@/ui/tutorial/CoachMark';
import { useInterval } from '@/ui/hooks';
import { AdvisorDock } from './AdvisorDock';
import { AutoPauseBanner, MonthCloseChip, NewsTicker } from './BottomBar';
import { CameraNav } from './CameraNav';
import { LeftRail } from './LeftRail';
import { Minimap } from './Minimap';
import minimapStyles from './Minimap.module.css';
import { RightColumn } from './RightColumn';
import { TopBar } from './TopBar';
import styles from './Hud.module.css';

/** Keeps the inspector drawer and `selectedBuildingId` in sync (both directions). */
function useSelectionDrawer(): void {
  const selected = useGameStore((s) => s.selectedBuildingId);
  const drawers = useUiStore((s) => s.drawers);
  const openPanel = useUiStore((s) => s.openPanel);

  useEffect(() => {
    const ui = useUiStore.getState();
    if (selected === null) {
      if (ui.drawers.some((d) => d.id === 'inspector')) ui.closePanel('inspector');
      return;
    }
    // Selecting from a full-screen overlay (Company table, Markets…) returns to the city.
    if (ui.overlay) ui.closeOverlay();
    const top = topDrawer(ui);
    if (top?.id !== 'inspector' || top.params.buildingId !== selected) openPanel('inspector', { buildingId: selected });
  }, [selected, openPanel]);

  useEffect(() => {
    const game = useGameStore.getState();
    if (game.selectedBuildingId !== null && !drawers.some((d) => d.id === 'inspector')) game.selectBuilding(null);
  }, [drawers]);
}

/** L4 modals hold time; L3 overlays hold it when the setting asks for it (UX §6.2). */
function useTimeHolds(): void {
  const modalOpen = useUiStore((s) => s.modals.length > 0);
  const overlayOpen = useUiStore((s) => s.overlay !== null);
  const pauseInFullscreen = useSettingsStore((s) => s.gameplay.pauseInFullscreen);
  const hold = useGameStore((s) => s.hold);
  const release = useGameStore((s) => s.release);

  useEffect(() => {
    if (modalOpen) hold('modal');
    else release('modal');
  }, [modalOpen, hold, release]);

  useEffect(() => {
    if (overlayOpen && pauseInFullscreen) hold('overlay');
    else release('overlay');
  }, [overlayOpen, pauseInFullscreen, hold, release]);

  useEffect(
    () => () => {
      release('modal');
      release('overlay');
    },
    [release],
  );
}

export function Hud() {
  const drawerOpen = useUiStore((s) => s.drawers.length > 0);
  const addPlayTime = useGameStore((s) => s.addPlayTime);
  useGameHotkeys(true);
  useSelectionDrawer();
  useTimeHolds();
  useInterval(() => {
    if (document.visibilityState === 'visible') addPlayTime(5);
  }, 5000);

  return (
    <div className={clsx(styles.hud, drawerOpen && styles.withDrawer)} data-testid="hud">
      <div className={styles.vignette} />
      <PopupLayer />
      <TopBar />
      <LeftRail />
      <RightColumn />
      <div className={minimapStyles.dock}>
        <CameraNav />
        <Minimap />
      </div>
      <NewsTicker />
      <MonthCloseChip />
      <AutoPauseBanner />
      <AdvisorDock />
      <DrawerHost />
      <OverlayHost />
      <ConfettiLayer />
      <ContextMenuHost />
      <CoachMark />
    </div>
  );
}
