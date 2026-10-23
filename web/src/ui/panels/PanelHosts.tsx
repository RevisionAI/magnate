// Hosts for the two panel layers. Each mounts the registry's lazy component for
// the open id inside Suspense + an error boundary, provides the frame chrome
// (title, icon, close, back) and keeps the panel mounted briefly so its exit
// animation can play.

import { AlertTriangle } from 'lucide-react';
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '@/audio';
import { useUiStore, type PanelRef } from '@/state/uiStore';
import { Button, PanelChromeProvider, Spinner } from '@/ui/components';
import { MOTION } from '@/theme/tokens';
import { PANELS, panelComponent } from './registry';
import styles from './PanelHosts.module.css';

/** Keeps the last value rendered for `ms` after it becomes null (exit animations). */
function usePresence<T>(value: T | null, ms: number): { item: T | null; closing: boolean } {
  const [state, setState] = useState<{ item: T | null; closing: boolean }>({ item: value, closing: false });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (value !== null) {
      setState({ item: value, closing: false });
      return;
    }
    const reduced = document.documentElement.dataset.reducedMotion === 'true';
    if (reduced) {
      setState({ item: null, closing: false });
      return;
    }
    setState((s) => (s.item === null ? s : { item: s.item, closing: true }));
    timer.current = window.setTimeout(() => setState({ item: null, closing: false }), ms);
    return () => window.clearTimeout(timer.current);
  }, [value, ms]);
  return state;
}

class PanelErrorBoundary extends Component<{ children: ReactNode; onClose: () => void; title: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`[panel] ${this.props.title} crashed`, error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.error} role="alert">
        <AlertTriangle size={22} color="var(--c-red)" />
        <div>{this.props.title} ran into a problem and was closed safely.</div>
        <Button size="sm" onClick={this.props.onClose}>
          Close
        </Button>
      </div>
    );
  }
}

function PanelMount({ panel, closing, close, back }: { panel: PanelRef; closing: boolean; close: () => void; back?: () => void }) {
  const def = PANELS[panel.id];
  const Lazy = panelComponent(panel.id);
  const Icon = def.icon;
  return (
    <PanelChromeProvider value={{ title: def.title, icon: <Icon size={17} />, hotkey: def.hotkey, close, back, closing }}>
      <PanelErrorBoundary key={panel.key} title={def.title} onClose={close}>
        <Suspense
          fallback={
            <div className={styles.fallback}>
              <Spinner />
            </div>
          }
        >
          <Lazy params={panel.params} close={close} host={def.host} />
        </Suspense>
      </PanelErrorBoundary>
    </PanelChromeProvider>
  );
}

/** L3 full-screen overlay host (one at a time). */
export function OverlayHost() {
  const overlay = useUiStore((s) => s.overlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const { item, closing } = usePresence(overlay, MOTION.base);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const id = overlay?.id ?? null;
    if (id !== prev.current) audio.ui(id ? 'open' : 'close');
    prev.current = id;
  }, [overlay?.id]);
  if (!item) return null;
  return (
    <>
      <div className={`${styles.scrim} ${closing ? styles.scrimClosing : ''}`} onPointerDown={closeOverlay} />
      <div className={styles.overlayLayer} data-testid={`overlay-${item.id}`}>
        <PanelMount panel={item} closing={closing} close={closeOverlay} />
      </div>
    </>
  );
}

/** L2 right drawer host (top of the back stack). */
export function DrawerHost() {
  const drawers = useUiStore((s) => s.drawers);
  const top = drawers[drawers.length - 1] ?? null;
  const closePanel = useUiStore((s) => s.closePanel);
  const backDrawer = useUiStore((s) => s.backDrawer);
  const { item, closing } = usePresence(top, MOTION.base);
  const prevId = useRef<string | null>(null);
  useEffect(() => {
    const id = top?.id ?? null;
    if (id && id !== prevId.current) audio.ui('open');
    else if (!id && prevId.current) audio.ui('close');
    prevId.current = id;
  }, [top?.id]);
  if (!item) return null;
  return (
    <div className={styles.drawerLayer} data-testid={`drawer-${item.id}`}>
      <PanelMount panel={item} closing={closing} close={() => closePanel(item.id)} back={drawers.length > 1 && !closing ? backDrawer : undefined} />
    </div>
  );
}
