// Panel registry: every HUD destination → a lazily-loaded component at the fixed
// path `ui/panels/<id>/index.tsx` (default export, PanelProps). Wave 2 workstreams
// own those directories and replace the placeholders without touching the shell:
//
//   ui/panels/build/       U2   build palette → placement → confirm
//   ui/panels/inspector/   U2   building inspector drawer (opens on selection)
//   ui/panels/markets/     U2   markets overlay
//   ui/panels/company/     U2   company / portfolio overlay
//   ui/panels/reports/     U3   ui/panels/finance/  U3   ui/panels/rnd/     U3
//   ui/panels/marketing/   U3   ui/panels/rivals/   U3   ui/panels/news/    U3
//   ui/panels/advisor/     U3   ui/panels/goals/    U3
//   ui/panels/alerts/      U1   alerts history drawer
//
// Open one with `useUiStore.getState().openPanel(id, params)`; the host layer
// (drawer or overlay) comes from ids.ts.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Bell,
  Building,
  Building2,
  ChartLine,
  FlaskConical,
  Hammer,
  Landmark,
  Megaphone,
  Newspaper,
  ShoppingBasket,
  Swords,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { PANEL_IDS, PANEL_META, type PanelHost, type PanelId, type PanelMeta, type PanelParams } from './ids';

export type { PanelId, PanelHost, PanelParams } from './ids';
export { PANEL_IDS, PANEL_META, RAIL_PANEL_IDS, isPanelId } from './ids';

/** Props every panel component receives from its host. */
export interface PanelProps {
  /** Deep-link parameters (tab, buildingId, cityId, productId…). */
  params: PanelParams;
  /** Close this panel (drawer: pops the back stack entry; overlay: closes it). */
  close: () => void;
  host: PanelHost;
}

export type PanelModule = { default: ComponentType<PanelProps> };

export interface PanelDef extends PanelMeta {
  icon: LucideIcon;
  load: () => Promise<PanelModule>;
}

const ICONS: Record<PanelId, LucideIcon> = {
  build: Hammer,
  markets: ShoppingBasket,
  reports: ChartLine,
  finance: Landmark,
  rnd: FlaskConical,
  marketing: Megaphone,
  rivals: Swords,
  news: Newspaper,
  advisor: UserRound,
  goals: Target,
  company: Building2,
  alerts: Bell,
  inspector: Building,
};

const LOADERS: Record<PanelId, () => Promise<PanelModule>> = {
  build: () => import('./build/index'),
  markets: () => import('./markets/index'),
  reports: () => import('./reports/index'),
  finance: () => import('./finance/index'),
  rnd: () => import('./rnd/index'),
  marketing: () => import('./marketing/index'),
  rivals: () => import('./rivals/index'),
  news: () => import('./news/index'),
  advisor: () => import('./advisor/index'),
  goals: () => import('./goals/index'),
  company: () => import('./company/index'),
  alerts: () => import('./alerts/index'),
  inspector: () => import('./inspector/index'),
};

export const PANELS: Readonly<Record<PanelId, PanelDef>> = Object.fromEntries(
  PANEL_IDS.map((id) => [id, { ...PANEL_META[id], icon: ICONS[id], load: LOADERS[id] }]),
) as Record<PanelId, PanelDef>;

const lazyCache = new Map<PanelId, LazyExoticComponent<ComponentType<PanelProps>>>();

/** The React.lazy component for a panel (cached, so its chunk loads once). */
export function panelComponent(id: PanelId): LazyExoticComponent<ComponentType<PanelProps>> {
  let component = lazyCache.get(id);
  if (!component) {
    component = lazy(PANELS[id].load);
    lazyCache.set(id, component);
  }
  return component;
}

/** Warm a panel's chunk (e.g. on rail hover) so opening it is instant. */
export function preloadPanel(id: PanelId): void {
  void PANELS[id].load().catch(() => {});
}
