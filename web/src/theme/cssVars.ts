// Generates the CSS custom properties every stylesheet reads, from theme/tokens.ts.
// `installThemeVars()` runs once in main.tsx before React renders; `applyThemeOptions()`
// re-applies the settings-driven parts (UI scale, colour-vision mode, motion,
// contrast, transparency) whenever Settings change.
//
// Naming: --c-* colours, --fs-* font sizes, --fw-* weights, --space-* spacing,
// --r-* radii, --e-* elevations, --dur-* durations, --ease-* easings, --z-* layers,
// --hud-* HUD geometry, --owner-N owner colours.

import {
  CHART,
  ELEVATION,
  FONTS,
  FONT_SIZE,
  FONT_WEIGHT,
  HUD,
  MOTION,
  OWNER_COLORS,
  PROFIT_LOSS,
  RADIUS,
  SEVERITY,
  SPACE,
  UI,
  UI_EXT,
  Z,
  type ColourVisionMode,
} from './tokens';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/\./g, '_');

/** Every static token as a CSS custom property map. Pure; exported for tests and the UiKit page. */
export function themeVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(UI)) vars[`--c-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(UI_EXT)) vars[`--c-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(SEVERITY)) vars[`--c-sev-${kebab(k)}`] = v;
  OWNER_COLORS.forEach((c, i) => (vars[`--owner-${i}`] = c));
  CHART.series.forEach((c, i) => (vars[`--chart-${i}`] = c));
  vars['--chart-grid'] = CHART.grid;
  vars['--chart-axis'] = CHART.axis;
  vars['--chart-crosshair'] = CHART.crosshair;
  vars['--font-ui'] = FONTS.ui;
  vars['--font-display'] = FONTS.display;
  vars['--font-mono'] = FONTS.mono;
  for (const [k, v] of Object.entries(FONT_SIZE)) vars[`--fs-${k}`] = v;
  for (const [k, v] of Object.entries(FONT_WEIGHT)) vars[`--fw-${k}`] = String(v);
  for (const [k, v] of Object.entries(SPACE)) vars[`--space-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(RADIUS)) vars[`--r-${k}`] = v;
  for (const [k, v] of Object.entries(ELEVATION)) vars[`--e-${k}`] = v;
  for (const [k, v] of Object.entries(MOTION)) {
    if (typeof v === 'number') vars[`--dur-${kebab(k)}`] = `calc(${v}ms * var(--motion-scale, 1))`;
    else vars[k.startsWith('ease') ? `--${kebab(k)}` : `--ease-${kebab(k)}`] = v; // --ease-out, --ease-in-out, --ease-spring
  }
  for (const [k, v] of Object.entries(Z)) vars[`--z-${kebab(k)}`] = String(v);
  // HUD geometry is expressed in rem so it follows the UI scale.
  for (const [k, v] of Object.entries(HUD)) vars[`--hud-${kebab(k)}`] = `${v / 16}rem`;
  // Defaults for the settings-driven variables (overridden by applyThemeOptions).
  vars['--c-pos'] = PROFIT_LOSS.off.pos;
  vars['--c-neg'] = PROFIT_LOSS.off.neg;
  vars['--ui-scale'] = '1';
  vars['--motion-scale'] = '1';
  vars['--glass-blur'] = '14px';
  return vars;
}

/** Serialises the variables as a `:root { … }` rule. */
export function themeCss(vars: Record<string, string> = themeVariables()): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${body}\n}\n`;
}

const STYLE_ID = 'magnate-theme-vars';

/** Injects the token stylesheet into <head> (idempotent). */
export function installThemeVars(doc: Document = document): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head.prepend(style);
  }
  style.textContent = themeCss();
}

export interface ThemeOptions {
  /** 80–150 (%). */
  uiScale: number;
  colourVision: ColourVisionMode;
  /** Effective reduced motion (already resolved against the OS preference). */
  reducedMotion: boolean;
  highContrast: boolean;
  reduceTransparency: boolean;
}

/** Applies the settings-driven theme options to <html> (CSS vars + data attributes). */
export function applyThemeOptions(options: ThemeOptions, root: HTMLElement = document.documentElement): void {
  const scale = Math.min(150, Math.max(80, Math.round(options.uiScale))) / 100;
  root.style.setProperty('--ui-scale', String(scale));
  const pl = PROFIT_LOSS[options.colourVision] ?? PROFIT_LOSS.off;
  root.style.setProperty('--c-pos', pl.pos);
  root.style.setProperty('--c-neg', pl.neg);
  root.style.setProperty('--motion-scale', options.reducedMotion ? '0' : '1');
  root.style.setProperty('--glass-blur', options.reduceTransparency ? '0px' : '14px');
  root.dataset.cvd = options.colourVision;
  root.dataset.reducedMotion = options.reducedMotion ? 'true' : 'false';
  root.dataset.contrast = options.highContrast ? 'high' : 'normal';
  root.dataset.transparency = options.reduceTransparency ? 'reduced' : 'normal';
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
