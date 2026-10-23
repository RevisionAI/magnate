// Panel ids and their host layer — pure data shared by the state layer (uiStore)
// and the React registry (registry.ts). No React or icon imports here.
//
// Layers (UX §6.2): L2 = right drawer (one at a time, back stack, never pauses),
// L3 = full-screen overlay (pauses when Settings → "Pause while in full-screen
// screens" is on).

export const PANEL_IDS = [
  'build',
  'markets',
  'reports',
  'finance',
  'rnd',
  'marketing',
  'rivals',
  'news',
  'advisor',
  'goals',
  'company',
  'alerts',
  'inspector',
] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type PanelHost = 'overlay' | 'drawer';

/** Deep-link parameters a panel may receive (tab, building, market…). */
export interface PanelParams {
  tab?: string;
  buildingId?: number;
  cityId?: string | null;
  productId?: string | null;
  [key: string]: unknown;
}

export interface PanelMeta {
  id: PanelId;
  title: string;
  /** Rail label (≤ 8 chars). */
  short: string;
  description: string;
  host: PanelHost;
  /** Default hotkey (UX §6.20); rebinding lives in Settings → Controls. */
  hotkey: string | null;
  /** Position in the left rail (null = not on the rail). */
  rail: number | null;
  /** Workstream that owns the panel directory from Wave 2 on (documentation only). */
  owner: string;
}

export const PANEL_META: Readonly<Record<PanelId, PanelMeta>> = {
  build: {
    id: 'build',
    title: 'Build',
    short: 'Build',
    description: 'Choose a building type, place it on a plot and confirm the cost.',
    host: 'drawer',
    hotkey: 'B',
    rail: 0,
    owner: 'U2',
  },
  markets: {
    id: 'markets',
    title: 'Markets',
    short: 'Markets',
    description: 'City × product demand, unmet demand, your share and the offers you compete with.',
    host: 'overlay',
    hotkey: 'I',
    rail: 1,
    owner: 'U2',
  },
  reports: {
    id: 'reports',
    title: 'Reports',
    short: 'Reports',
    description: 'Income statement, balance sheet, cash flow, products, buildings and history.',
    host: 'overlay',
    hotkey: 'R',
    rail: 2,
    owner: 'U3',
  },
  finance: {
    id: 'finance',
    title: 'Finance',
    short: 'Finance',
    description: 'Bank loans, credit rating, equity and the stock market.',
    host: 'overlay',
    hotkey: 'F',
    rail: 3,
    owner: 'U3',
  },
  rnd: {
    id: 'rnd',
    title: 'Research & Development',
    short: 'R&D',
    description: 'Technology per product versus rivals, research projects and patents.',
    host: 'overlay',
    hotkey: 'T',
    rail: 4,
    owner: 'U3',
  },
  marketing: {
    id: 'marketing',
    title: 'Marketing',
    short: 'Brand',
    description: 'Ad campaigns, brand awareness by city and media ownership.',
    host: 'overlay',
    hotkey: 'K',
    rail: 5,
    owner: 'U3',
  },
  rivals: {
    id: 'rivals',
    title: 'Rivals',
    short: 'Rivals',
    description: 'Who you compete with, where, and what they did lately.',
    host: 'overlay',
    hotkey: 'V',
    rail: 6,
    owner: 'U3',
  },
  news: {
    id: 'news',
    title: 'News & Events',
    short: 'News',
    description: 'Headlines translated into what they mean for your business, plus the event log.',
    host: 'overlay',
    hotkey: 'N',
    rail: 7,
    owner: 'U3',
  },
  advisor: {
    id: 'advisor',
    title: 'Advisor',
    short: 'Advisor',
    description: 'Your COO’s priorities, ranked by monthly impact, each with a one-click fix.',
    host: 'drawer',
    hotkey: 'H',
    rail: 8,
    owner: 'U3',
  },
  goals: {
    id: 'goals',
    title: 'Goals',
    short: 'Goals',
    description: 'Scenario goals, their rules, the deadline and how you lose.',
    host: 'drawer',
    hotkey: 'G',
    rail: 9,
    owner: 'U3',
  },
  company: {
    id: 'company',
    title: 'Company',
    short: 'Company',
    description: 'Company KPIs and every building you own.',
    host: 'overlay',
    hotkey: 'M',
    rail: null,
    owner: 'U2',
  },
  alerts: {
    id: 'alerts',
    title: 'Alerts',
    short: 'Alerts',
    description: 'Everything that needed your attention, newest first.',
    host: 'drawer',
    hotkey: 'J',
    rail: null,
    owner: 'U1',
  },
  inspector: {
    id: 'inspector',
    title: 'Building',
    short: 'Inspect',
    description: 'The selected building: overview, layout, finance and upgrades.',
    host: 'drawer',
    hotkey: null,
    rail: null,
    owner: 'U2',
  },
};

/** The ten hotkeyed rail destinations in rail order (B I R F T K V N H G). */
export const RAIL_PANEL_IDS: readonly PanelId[] = PANEL_IDS.filter((id) => PANEL_META[id].rail !== null).sort(
  (a, b) => (PANEL_META[a].rail ?? 0) - (PANEL_META[b].rail ?? 0),
);

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value);
}
