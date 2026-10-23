// UI kit dev page (route: ?dev=ui) — owned by U1. Every design-system component
// in all its states, rendered from the same tokens and CSS modules the game uses.
// Sections live in ./uiKit/; each carries `data-uikit-section` so the smoke tour
// (scripts/smoke.mjs --tour) can screenshot them one by one.

import { ContextMenuHost } from '@/ui/components';
import { ConfettiLayer, PopupLayer } from '@/ui/fx/FxLayers';
import { Buttons, Inputs } from './uiKit/controls';
import { Charts, DataDisplay } from './uiKit/data';
import { Foundations } from './uiKit/foundations';
import { Section } from './uiKit/shared';
import { Feedback, GamePieces, Surfaces } from './uiKit/surfaces';
import styles from './uiKit/UiKit.module.css';

const SECTIONS = [
  { id: 'foundations', title: 'Foundations', note: 'theme/tokens.ts → CSS custom properties', render: () => <Foundations /> },
  { id: 'buttons', title: 'Buttons & keys', note: 'Button · IconButton · Kbd · KeyChord', render: () => <Buttons /> },
  { id: 'inputs', title: 'Inputs', note: 'Select · Toggle · Segmented · Field · Slider · Tabs', render: () => <Inputs /> },
  { id: 'data', title: 'Data', note: 'Stat · Money · Delta · Percent · Progress · Meter · Badge · Table', render: () => <DataDisplay /> },
  { id: 'charts', title: 'Charts', note: 'SVG via d3-scale / d3-shape', render: () => <Charts /> },
  { id: 'feedback', title: 'Feedback', note: 'Toast · Tooltip · EmptyState · Skeleton · FX', render: () => <Feedback /> },
  { id: 'surfaces', title: 'Surfaces', note: 'Panel · DrawerFrame · OverlayFrame · Modal · Confirm · ContextMenu', render: () => <Surfaces /> },
  { id: 'game', title: 'Game pieces', note: 'Emblems · advisor · stars · scenario art', render: () => <GamePieces /> },
] as const;

export function UiKit() {
  return (
    <div className={styles.page} data-testid="ui-kit">
      <nav className={styles.nav} aria-label="UI kit sections">
        <div className={styles.brand}>
          Magnate
          <small>Design system</small>
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={styles.navLink} onClick={() => document.getElementById(`kit-${s.id}`)?.scrollIntoView({ block: 'start' })}>
            {s.title}
          </button>
        ))}
      </nav>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>UI kit</h1>
            <p className={styles.lede}>
              Glassy dark panels with crisp 1 px strokes and gold accents. Every colour, size and duration comes from the theme tokens; Settings → Interface
              (UI scale, colour vision, reduced motion, contrast, transparency) applies here exactly as in the game.
            </p>
          </div>
        </header>
        {SECTIONS.map((s) => (
          <Section key={s.id} id={s.id} title={s.title} note={s.note}>
            {s.render()}
          </Section>
        ))}
      </main>
      <PopupLayer />
      <ConfettiLayer />
      <ContextMenuHost />
    </div>
  );
}
