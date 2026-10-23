// Left navigation rail (UX §6.3): the ten hotkeyed destinations — Build B,
// Markets I, Reports R, Finance F, R&D T, Marketing K, Rivals V, News N,
// Advisor H, Goals G — with badges (e.g. Markets "!" when a rival enters a
// market you serve). Hovering preloads the panel's chunk.

import clsx from 'clsx';
import { useSettingsStore } from '@/state/settingsStore';
import { topDrawer, useUiStore } from '@/state/uiStore';
import { Tooltip } from '@/ui/components';
import { chordsFor } from '@/ui/input/keymap';
import { keyLabel } from '@/ui/components/Kbd';
import { PANELS, RAIL_PANEL_IDS, preloadPanel } from '@/ui/panels/registry';
import styles from './LeftRail.module.css';

export function LeftRail() {
  const overlayId = useUiStore((s) => s.overlay?.id ?? null);
  const drawerId = useUiStore((s) => topDrawer(s)?.id ?? null);
  const badges = useUiStore((s) => s.railBadges);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const bindings = useSettingsStore((s) => s.controls.bindings);

  return (
    <nav className={styles.rail} aria-label="Destinations" data-testid="left-rail">
      {RAIL_PANEL_IDS.map((id, i) => {
        const def = PANELS[id];
        const Icon = def.icon;
        const chord = chordsFor(`panel.${id}`, bindings)[0] ?? def.hotkey ?? '';
        const active = overlayId === id || drawerId === id;
        return (
          <div key={id}>
            {i === 8 && <div className={styles.divider} />}
            <Tooltip title={def.title} content={def.description} shortcut={chord} side="right" wide block>
              <button
                type="button"
                className={clsx(styles.item, active && styles.active)}
                aria-pressed={active}
                aria-label={def.title}
                data-testid={`rail-${id}`}
                data-ui-id={`rail.${id}`}
                onPointerEnter={() => preloadPanel(id)}
                onFocus={() => preloadPanel(id)}
                onClick={() => togglePanel(id)}
              >
                {badges[id] && <span className={styles.badge}>{badges[id]}</span>}
                <span className={styles.key}>{chord.includes('+') ? '' : keyLabel(chord)}</span>
                <span className={styles.icon}>
                  <Icon size={19} strokeWidth={1.8} />
                </span>
                <span className={styles.label}>{def.short}</span>
              </button>
            </Tooltip>
          </div>
        );
      })}
    </nav>
  );
}
