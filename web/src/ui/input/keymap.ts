// Keyboard map (UX §6.20) as data: every action, its default chords and who
// handles it. The HUD hotkey hook dispatches the actions the UI shell owns;
// camera, overlay and building keys are listed for the Controls sheet and
// handled by the city view / Wave 2 panels.
//
// Chords: "Space", "B", "1", "Period", "Shift+Period", "Mod+S" (⌘ on macOS,
// Ctrl elsewhere), "F1", "Shift+Slash" (?), "BracketLeft", "Escape".
// Letters match by the produced key (layout-aware mnemonics); digits, Period,
// Space and brackets match the physical key so Shift does not change them.

export type KeyGroup = 'Time' | 'Panels' | 'Game' | 'Camera' | 'City view' | 'Buildings';

export interface KeyAction {
  id: string;
  label: string;
  group: KeyGroup;
  chords: readonly string[];
  /** Who handles it: 'ui' = the shell's hotkey hook; others are listed for reference. */
  handler: 'ui' | 'scene' | 'panel';
  /** Allowed while typing in a text field. */
  whileTyping?: boolean;
  /** Allowed while an L4 modal is open. */
  inModal?: boolean;
  /** Not rebindable (Escape). */
  fixed?: boolean;
}

export const KEY_ACTIONS: readonly KeyAction[] = [
  { id: 'time.pause', label: 'Pause / resume', group: 'Time', chords: ['Space'], handler: 'ui' },
  { id: 'time.speed1', label: 'Speed 1× (12 s per month)', group: 'Time', chords: ['1'], handler: 'ui' },
  { id: 'time.speed2', label: 'Speed 2× (6 s per month)', group: 'Time', chords: ['2'], handler: 'ui' },
  { id: 'time.speed4', label: 'Speed 4× (3 s per month)', group: 'Time', chords: ['3'], handler: 'ui' },
  { id: 'time.speed8', label: 'Speed 8× (1.5 s per month)', group: 'Time', chords: ['4'], handler: 'ui' },
  { id: 'time.step', label: 'Step one month (while paused)', group: 'Time', chords: ['Period'], handler: 'ui' },
  { id: 'time.skip', label: 'Skip to the next event', group: 'Time', chords: ['Shift+Period'], handler: 'ui' },

  { id: 'panel.build', label: 'Build', group: 'Panels', chords: ['B'], handler: 'ui' },
  { id: 'panel.markets', label: 'Markets', group: 'Panels', chords: ['I'], handler: 'ui' },
  { id: 'panel.reports', label: 'Reports', group: 'Panels', chords: ['R'], handler: 'ui' },
  { id: 'panel.finance', label: 'Finance', group: 'Panels', chords: ['F'], handler: 'ui' },
  { id: 'panel.rnd', label: 'Research & development', group: 'Panels', chords: ['T'], handler: 'ui' },
  { id: 'panel.marketing', label: 'Marketing', group: 'Panels', chords: ['K'], handler: 'ui' },
  { id: 'panel.rivals', label: 'Rivals', group: 'Panels', chords: ['V'], handler: 'ui' },
  { id: 'panel.news', label: 'News & events', group: 'Panels', chords: ['N'], handler: 'ui' },
  { id: 'panel.advisor', label: 'Advisor', group: 'Panels', chords: ['H'], handler: 'ui' },
  { id: 'panel.goals', label: 'Goals & briefing', group: 'Panels', chords: ['G'], handler: 'ui' },
  { id: 'panel.company', label: 'Company', group: 'Panels', chords: ['M'], handler: 'ui' },
  { id: 'panel.alerts', label: 'Alerts', group: 'Panels', chords: ['J'], handler: 'ui' },

  { id: 'menu.back', label: 'Back / close / pause menu', group: 'Game', chords: ['Escape'], handler: 'ui', fixed: true, whileTyping: true, inModal: true },
  { id: 'game.quicksave', label: 'Quicksave', group: 'Game', chords: ['Mod+S'], handler: 'ui', whileTyping: true },
  { id: 'game.quickload', label: 'Quickload', group: 'Game', chords: ['Mod+L'], handler: 'ui', whileTyping: true },
  { id: 'game.saveload', label: 'Save / load menu', group: 'Game', chords: ['Mod+O'], handler: 'ui', whileTyping: true },
  { id: 'audio.mute', label: 'Mute / unmute', group: 'Game', chords: ['Mod+M'], handler: 'ui', whileTyping: true, inModal: true },
  { id: 'help.controls', label: 'Controls sheet', group: 'Game', chords: ['Shift+Slash', 'F1'], handler: 'ui' },

  { id: 'city.next', label: 'Next city', group: 'City view', chords: ['BracketRight', 'C'], handler: 'ui' },
  { id: 'city.prev', label: 'Previous city', group: 'City view', chords: ['BracketLeft'], handler: 'ui' },
  { id: 'city.home', label: 'Frame your HQ', group: 'City view', chords: ['Home'], handler: 'scene' },
  { id: 'city.cycle', label: 'Cycle your buildings', group: 'City view', chords: ['Tab'], handler: 'scene' },
  { id: 'overlay.cycle', label: 'Cycle map overlays', group: 'City view', chords: ['O'], handler: 'scene' },

  { id: 'camera.pan', label: 'Pan', group: 'Camera', chords: ['W', 'A', 'S', 'D'], handler: 'scene' },
  { id: 'camera.rotate', label: 'Rotate 45° (rotate footprint in Build mode)', group: 'Camera', chords: ['Q', 'E'], handler: 'scene' },
  { id: 'camera.zoom', label: 'Zoom', group: 'Camera', chords: ['Equal', 'Minus'], handler: 'scene' },

  { id: 'building.upgrade', label: 'Upgrade selected building', group: 'Buildings', chords: ['U'], handler: 'panel' },
  { id: 'building.demolish', label: 'Demolish selected building', group: 'Buildings', chords: ['Delete'], handler: 'panel' },
  { id: 'edit.undo', label: 'Undo last pending command', group: 'Buildings', chords: ['Mod+Z'], handler: 'panel' },
];

export const KEY_ACTION_BY_ID: ReadonlyMap<string, KeyAction> = new Map(KEY_ACTIONS.map((a) => [a.id, a]));

export interface KeyEventLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface ParsedChord {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function parseChord(chord: string): ParsedChord {
  const parts = chord.split('+');
  const key = parts.pop() ?? '';
  const set = new Set(parts.map((p) => p.toLowerCase()));
  return { mod: set.has('mod'), ctrl: set.has('ctrl'), shift: set.has('shift'), alt: set.has('alt'), key };
}

const PHYSICAL: Record<string, string[]> = {
  Space: ['Space'],
  Period: ['Period', 'NumpadDecimal'],
  Comma: ['Comma'],
  Slash: ['Slash'],
  BracketLeft: ['BracketLeft'],
  BracketRight: ['BracketRight'],
  Equal: ['Equal', 'NumpadAdd'],
  Minus: ['Minus', 'NumpadSubtract'],
  Tab: ['Tab'],
};

function keyMatches(key: string, e: KeyEventLike): boolean {
  if (PHYSICAL[key]) return PHYSICAL[key]!.includes(e.code);
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}`;
  if (/^[A-Z]$/i.test(key)) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    // Produced letter first (layout-aware); physical key when Alt/Option turned it into a symbol.
    return k === key.toLowerCase() || (k !== '' && !/[a-z]/.test(k) && e.code === `Key${key.toUpperCase()}`);
  }
  return e.key === key || e.code === key;
}

/** True when the event matches the chord exactly (no extra modifiers). */
export function matchChord(chord: string | ParsedChord, e: KeyEventLike, mac: boolean = isMacPlatform()): boolean {
  const c = typeof chord === 'string' ? parseChord(chord) : chord;
  const wantMeta = c.mod && mac;
  const wantCtrl = c.ctrl || (c.mod && !mac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== c.alt || e.shiftKey !== c.shift) return false;
  return keyMatches(c.key, e);
}

/** Effective chords for an action (Settings overrides first, else defaults). */
export function chordsFor(actionId: string, overrides: Readonly<Record<string, readonly string[]>> = {}): readonly string[] {
  const action = KEY_ACTION_BY_ID.get(actionId);
  if (!action) return [];
  if (action.fixed) return action.chords;
  return overrides[actionId] ?? action.chords;
}

/** The UI-handled action for an event, honouring overrides. */
export function actionForEvent(e: KeyEventLike, overrides: Readonly<Record<string, readonly string[]>> = {}, mac: boolean = isMacPlatform()): KeyAction | null {
  for (const action of KEY_ACTIONS) {
    if (action.handler !== 'ui') continue;
    if (chordsFor(action.id, overrides).some((c) => matchChord(c, e, mac))) return action;
  }
  return null;
}

/** Builds a chord string from a key event (rebinding capture). Null for bare modifiers. */
export function chordFromEvent(e: KeyEventLike, mac: boolean = isMacPlatform()): string | null {
  if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return null;
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (mac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key: string;
  const physical = Object.entries(PHYSICAL).find(([, codes]) => codes.includes(e.code))?.[0];
  if (physical) key = physical;
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Key[A-Z]$/.test(e.code) && (e.altKey || e.key.length !== 1 || !/[a-z]/i.test(e.key))) key = e.code.slice(3);
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else key = e.key;
  return [...mods, key].join('+');
}

/** Actions (other than `actionId`) that already use `chord`. */
export function conflictsFor(actionId: string, chord: string, overrides: Readonly<Record<string, readonly string[]>> = {}): KeyAction[] {
  const norm = (c: string) => c.toLowerCase();
  return KEY_ACTIONS.filter((a) => a.id !== actionId && chordsFor(a.id, overrides).some((c) => norm(c) === norm(chord)));
}

/** True when keyboard focus is in a text field (letter hotkeys are ignored there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
}
