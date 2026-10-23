// What the buttons on toasts and alert rows do: Locate frames the building or
// city (and selects the building), Open jumps to a panel, Acknowledge clears a
// sticky critical.

import { fx } from '@/game/fx';
import type { Alert, AlertAction } from '@/state/alerts';
import { useAlertsStore } from '@/state/alertsStore';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { isPanelId } from '@/ui/panels/ids';

export function runAlertAction(alert: Alert, action: AlertAction): void {
  switch (action.kind) {
    case 'locate': {
      if (alert.cityId && alert.cityId !== useGameStore.getState().activeCityId) useGameStore.getState().setActiveCity(alert.cityId);
      if (alert.buildingId !== null) useGameStore.getState().selectBuilding(alert.buildingId);
      fx.locate({ ...(alert.buildingId !== null ? { buildingId: alert.buildingId } : {}), ...(alert.cityId ? { cityId: alert.cityId } : {}) });
      break;
    }
    case 'open':
      if (action.panel && isPanelId(action.panel)) useUiStore.getState().openPanel(action.panel, action.params ?? {});
      break;
    case 'ack':
      useAlertsStore.getState().acknowledge(alert.id);
      return;
  }
  if (!alert.sticky) useAlertsStore.getState().dismissToast(alert.id);
}
