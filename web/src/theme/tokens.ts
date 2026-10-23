// Single source of truth for colours, fonts, spacing and layering, shared by the
// React UI and the 3D scene (scene/assets/palette.ts re-exports the world palette).
// Values come from docs/overhaul/research/art-rendering.md §3.3–3.4 and the UX
// report §6.3. Owner colours are sRGB hex; the city shader linearises them.
//
// The UI never hard-codes a colour: CSS reads the custom properties generated
// from this file by `theme/cssVars.ts` (`var(--c-gold)`, `var(--space-3)`…), and
// TypeScript (charts, canvas FX) imports the constants directly.

/** Company colours by `colorIndex` (0 = the player, always). */
export const OWNER_COLORS = [
  '#2F7DE1', // 0 player — blue
  '#E69F00', // 1 orange
  '#CC79A7', // 2 reddish purple
  '#009E73', // 3 bluish green
  '#D55E00', // 4 vermillion
  '#56B4E9', // 5 sky blue
  '#F0C419', // 6 yellow
  '#7E57C2', // 7 violet
] as const;

/** Redundant emblem shapes for colour-blind players, parallel to OWNER_COLORS. */
export const OWNER_EMBLEMS = ['circle', 'triangle', 'square', 'diamond', 'star', 'hexagon', 'cross', 'ring'] as const;
export type OwnerEmblem = (typeof OWNER_EMBLEMS)[number];

/** Neutral colour for civic buildings / local competitors in the Owners overlay. */
export const NEUTRAL_OWNER = '#8FA3B5';

/** UI semantic colours (HUD, panels). */
export const UI = {
  ink: '#0B1117',
  panel: '#101A22',
  panel2: '#15222C',
  panel3: '#1B2B37',
  stroke: '#375263',
  strokeSoft: 'rgba(120, 160, 185, 0.18)',
  text: '#EAF1F5',
  text2: '#B5C4CD',
  muted: '#9FB2BD',
  dim: '#6F8290',
  gold: '#D7B766', // selection, "yours", money highlights
  goldBright: '#F0D38A',
  blue: '#5AA7D8', // information
  green: '#61C28F', // profit, valid
  red: '#DF6F6A', // loss, invalid
  amber: '#E8B63A', // warning
} as const;

/**
 * Extended UI palette: glass surfaces, strokes and accent shades derived from
 * the semantic colours above. Everything the CSS needs beyond `UI`.
 */
export const UI_EXT = {
  inkDeep: '#070C11',
  glass: 'rgba(14, 22, 30, 0.80)',
  glassStrong: 'rgba(12, 19, 26, 0.94)',
  glassSoft: 'rgba(20, 31, 41, 0.66)',
  scrim: 'rgba(5, 9, 13, 0.62)',
  hairline: 'rgba(160, 196, 218, 0.14)',
  hairlineStrong: 'rgba(170, 206, 228, 0.26)',
  highlight: 'rgba(255, 255, 255, 0.055)',
  hover: 'rgba(160, 200, 225, 0.08)',
  press: 'rgba(160, 200, 225, 0.14)',
  goldDeep: '#A8863F',
  goldInk: '#1D1606', // text on gold
  goldGlow: 'rgba(215, 183, 102, 0.32)',
  goldWash: 'rgba(215, 183, 102, 0.10)',
  blueWash: 'rgba(90, 167, 216, 0.12)',
  greenWash: 'rgba(97, 194, 143, 0.12)',
  redWash: 'rgba(223, 111, 106, 0.13)',
  amberWash: 'rgba(232, 182, 58, 0.13)',
  teal: '#4FC1B0', // opportunity
  tealWash: 'rgba(79, 193, 176, 0.12)',
  paper: '#EFE6D2', // newspaper ticker
  paperInk: '#2A2318',
} as const;

/** Status badge colours over the player's buildings. */
export const STATUS = { profitable: '#61C28F', warning: '#E8B63A', loss: '#DF6F6A', ring: '#D7B766' } as const;

/** Severity → colour (toasts, alerts, badges). Matches the alerts policy (UX §6.21). */
export const SEVERITY = {
  critical: UI.red,
  warning: UI.amber,
  opportunity: UI_EXT.teal,
  success: UI.green,
  info: UI.blue,
} as const;
export type SeverityTone = keyof typeof SEVERITY;

/**
 * Profit/loss colours per colour-vision mode (UX §6.18: colour-blind palettes
 * remap profit/loss to blue/orange and always add ▲/▼ icons).
 */
export const PROFIT_LOSS = {
  off: { pos: UI.green, neg: UI.red },
  deutan: { pos: '#5AA7E8', neg: '#E69F00' },
  protan: { pos: '#5AA7E8', neg: '#E69F00' },
  tritan: { pos: '#3FB6A8', neg: '#E2577A' },
} as const;
export type ColourVisionMode = keyof typeof PROFIT_LOSS;

/** Chart series colours (categorical), tuned to read on the dark glass panels. */
export const CHART = {
  series: ['#5AA7D8', '#D7B766', '#61C28F', '#CC79A7', '#E69F00', '#7E9CF0', '#4FC1B0', '#DF6F6A'],
  grid: 'rgba(160, 196, 218, 0.10)',
  axis: 'rgba(181, 196, 205, 0.55)',
  crosshair: 'rgba(240, 211, 138, 0.55)',
} as const;

/** Typography. Fonts are self-hosted via @fontsource-variable (imported in main.tsx). */
export const FONTS = {
  ui: "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  display: "'Fraunces Variable', 'Iowan Old Style', Georgia, serif", // headlines, newspaper, title
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

/**
 * Type scale in rem. The root font size is 16px × UI scale (Settings → Interface,
 * 80–150%), so every rem-sized element scales together while 1px strokes stay crisp.
 */
export const FONT_SIZE = {
  '2xs': '0.625rem', // 10px — micro labels
  xs: '0.6875rem', // 11px — uppercase labels
  sm: '0.75rem', // 12px
  md: '0.8125rem', // 13px — default UI text
  base: '0.875rem', // 14px
  lg: '1rem', // 16px
  xl: '1.25rem', // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '2rem', // 32px
  '4xl': '2.75rem', // 44px
} as const;

export const FONT_WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 } as const;

/** Spacing scale (rem). Index ≈ multiples of 4px at 100% UI scale. */
export const SPACE = {
  0: '0',
  px: '1px',
  0.5: '0.125rem', // 2
  1: '0.25rem', // 4
  1.5: '0.375rem', // 6
  2: '0.5rem', // 8
  3: '0.75rem', // 12
  4: '1rem', // 16
  5: '1.25rem', // 20
  6: '1.5rem', // 24
  8: '2rem', // 32
  10: '2.5rem', // 40
  12: '3rem', // 48
  16: '4rem', // 64
} as const;

export const RADIUS = {
  xs: '3px',
  sm: '5px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '999px',
} as const;

/** Elevation: drop shadows + the 1px inner top highlight that makes glass read as a bevel. */
export const ELEVATION = {
  0: 'none',
  1: '0 1px 2px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
  2: '0 6px 18px rgba(0, 0, 0, 0.38), 0 1px 3px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  3: '0 18px 44px rgba(0, 0, 0, 0.48), 0 3px 8px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  4: '0 30px 80px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  glow: '0 0 0 1px rgba(215, 183, 102, 0.55), 0 0 18px rgba(215, 183, 102, 0.28)',
} as const;

/** Motion. Durations are multiplied by --motion-scale (0 when reduced motion is on). */
export const MOTION = {
  fast: 120,
  base: 180,
  slow: 280,
  slower: 420,
  rollup: 600, // HUD money roll-up at month close (UX §6.3)
  popup: 1600, // floating +$ popup (UX §8)
  tooltipDelay: 400, // UX §6.20 (Tooltip.cs parity)
  easeOut: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/** Stacking layers for DOM overlays above the canvas. */
export const Z = {
  canvas: 0,
  worldLabels: 10,
  hud: 100,
  popups: 150, // above the HUD: the cash popup rises into the top bar, not behind it
  drawer: 200,
  overlay: 300,
  toast: 400,
  confetti: 450,
  modal: 500,
  coach: 550,
  tooltip: 600,
  contextMenu: 650,
  debug: 900,
} as const;

/** HUD geometry (px at 100% UI scale) — shared by CSS (via vars) and layout code. */
export const HUD = {
  topBarHeight: 56,
  railWidth: 64,
  drawerWidth: 440,
  tickerHeight: 34,
  minimapWidth: 212,
  minimapHeight: 150,
  gutter: 10,
} as const;

/** World palette (sRGB hex) — art bible §3.3. The 3D code converts to linear. */
export const WORLD = {
  ground: {
    grass: '#96B46B', grass2: '#8EAD65', park: '#86AE5E', meadow: '#A2B878', dryGrass: '#C4BE82', yard: '#A9C47A',
    soil: '#9C7A56', soilDark: '#7C5E43', sand: '#E6D6A8', rock: '#9C968C', gravel: '#A7A197',
  },
  road: {
    asphalt: '#5A5F67', asphaltDark: '#50545B', parking: '#6C7077', sidewalk: '#CFCAC0', curb: '#B8B2A7',
    plaza: '#DDD5C6', marking: '#F4F1E6', markingYellow: '#F0C75E',
  },
  wall: {
    warmWhite: '#EFE8DA', cream: '#EADCBC', sandWall: '#DCC49A', peach: '#E9C3A6', terracotta: '#CD8466', stone: '#BDB6A8',
    aluminium: '#C7CDD3', limestone: '#D8D2C4', brick: '#B0654F', sage: '#BFD0B0', powderBlue: '#B6CBDB', lilacGrey: '#C9C2D2',
    greige: '#CFC8BC', concrete: '#B9B6AE', concreteDark: '#8E8C87', steelBlue: '#9AA6B1', aptExtra1: '#E4D3B5', aptExtra2: '#D9B99B',
  },
  roof: {
    shingle: '#5B5F66', tile: '#B8614A', slate: '#5F6F7E', copper: '#6E9A86', green: '#8FAE6A', flat: '#B9B5AD',
    membrane: '#D3D0C8', gravel: '#A39E94', tar: '#6E6F71', solar: '#2E3B55',
  },
  industry: {
    glass: '#46607A', glass2: '#6F8FA6', silver: '#B4BAC0', galvanized: '#9FA7AE', industrialBlue: '#5C7C99',
    tankWhite: '#E4E4DE', chimneyBrick: '#8E4E3C', rust: '#9A5A3C', safetyYellow: '#E8B63A', dockDoors: '#5A6068',
  },
  vegetation: {
    leaf1: '#5E9A4B', leaf2: '#72A852', leaf3: '#4B8743', conifer: '#3A6B48', autumn1: '#D09A45', autumn2: '#C0633A', trunk: '#6E523E',
  },
  crops: {
    wheat: '#D9BE62', wheatGrowing: '#A9B85A', sugarcane: '#6FA548', sugarcaneGrowing: '#5E8F3E', cotton: '#EDEBE3',
    cottonLeaf: '#7E9B5A', coffee: '#3F6B3A', coffeeGrowing: '#4F7A43', coffeeCherry: '#B8323A', hops: '#5E8F3F',
    hopsGrowing: '#6FA04A', furrow: '#8A6A4A', stubble: '#B8A27A',
  },
  water: { deep: '#2F6F93', mid: '#3F86A8', shallow: '#5FAFC4', foam: '#EAF4F4' },
  vehicles: {
    bodies: [
      ['#EDEDED', 0.25], ['#2A2C30', 0.2], ['#8A8F96', 0.18], ['#BFC3C7', 0.12], ['#3D5F8F', 0.09],
      ['#B8322E', 0.08], ['#4F6B4A', 0.03], ['#C9B48A', 0.03], ['#E0B43A', 0.02],
    ] as ReadonlyArray<readonly [string, number]>,
    taxi: '#F2C230', bus: '#D8452F', trailer: '#E9E9E4',
  },
} as const;

/** Colour for a company given its bridge colorIndex (falls back to neutral). */
export function ownerColor(colorIndex: number | null | undefined): string {
  if (colorIndex === null || colorIndex === undefined || colorIndex < 0) return NEUTRAL_OWNER;
  return OWNER_COLORS[colorIndex % OWNER_COLORS.length] ?? NEUTRAL_OWNER;
}

/** Emblem shape for a company given its bridge colorIndex. */
export function ownerEmblem(colorIndex: number | null | undefined): OwnerEmblem {
  if (colorIndex === null || colorIndex === undefined || colorIndex < 0) return 'circle';
  return OWNER_EMBLEMS[colorIndex % OWNER_EMBLEMS.length] ?? 'circle';
}
