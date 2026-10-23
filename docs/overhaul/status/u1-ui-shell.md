# U1 — UI shell + design system: status

**Status: done** (branch `u1-ui-shell`). Every brief deliverable is in; the gaps below are either blocked on other workstreams or explicitly Wave 2 work.

Resumed after a power loss: the last pre-outage commit ("WIP checkpoint after power loss") held unverified edits: advisor pacing moved to a pure, tested module; the news ticker stepping aside when a drawer squeezes it at 1280 px; `SlotRow` exported and shown on the UiKit page; a fix for the audio-unlock capture listener; a `money()` thousands band; and alert-policy tests. I re-ran every gate on that commit and checked the affected screens in screenshots (the ticker hides at 1280×720 with the inspector open, and the UiKit page shows the save slots). All of it held up. On top of the WIP I made three small polish fixes:

- The floating cash popup layer now sits above the HUD, so the month-close `−$15.0K` rises into the top bar instead of sliding behind it.
- The top-bar profit sparkline reserves 12 slots (`minSlots`). Early in a game it now draws thin bars aligned to the right instead of three fat blocks.
- Key caps show `+` / `−` for the zoom keys instead of `Equal` / `Minus`.

## File map (all under `web/`)

| Area | Files |
|---|---|
| Tokens → CSS vars | `src/theme/tokens.ts` (colours, owner palette + emblems, colour-vision remaps, type/space/radius/elevation, motion, `Z` layers), `src/theme/cssVars.ts` (generates `--c-*`, `--z-*` … onto `:root`), `src/styles/global.css` |
| Components (CSS Modules) | `src/ui/components/` — Button/IconButton/Spinner, Kbd/KeyChord, Tooltip (rich, 400 ms delay, keyboard), Panel/SectionTitle, DrawerFrame/OverlayFrame (`PanelFrame`), Tabs, Table (sortable, numeric, sticky), Stat/Money/Delta/Percent/Progress/Meter (`Data`), Slider (marks + labelled bands), Select, Badge/Toggle/Segmented/Field/TextInput/EmptyState/Skeleton (`Controls`), ToastCard, Modal/ConfirmDialog, ContextMenu(+Host), Emblem, Layout, `charts/` Sparkline · LineChart · BarChart · StackedBar (d3-scale/d3-shape) |
| UiKit (`?dev=ui`) | `src/dev/UiKit.tsx`, `src/dev/uiKit/*` — 8 sections: foundations, buttons & keys, inputs, data, charts, feedback, surfaces (incl. save slots), game pieces |
| Screens | `src/ui/screens/` — BootScreen (staged engine progress + tips), TitleScreen + SkylineBackdrop (animated CSS/SVG skyline), ScenarioSelect (filters, cards with art/difficulty/pillar, briefing pane: start/deadline/rivals/to-win (reach once vs hold)/you-lose/opening, company name, difficulty, seed), ScenarioArt, GameScreen (keeps `new CityScene(container,{onFrame})` + PlaceholderCity) |
| HUD | `src/ui/hud/` — TopBar (emblem + name, cash with runway/insolvency badges, company value Δ%, profit + 12-mo sparkline, date + 30-segment day clock + deadline, speeds 0/1/2/4/8× + step + skip, alerts bell, menu), LeftRail (10 hotkeyed destinations + badges), RightColumn (goals chip, toast stack), BottomBar (month-close chip with Why?, newspaper ticker), AdvisorDock (portrait + speech bubble queue, `advisorTiming.ts`), Minimap placeholder (city switcher), Hud.tsx (layout + pause-in-fullscreen rule) |
| Panels | `src/ui/panels/registry.ts` + `ids.ts` (id → host drawer/overlay, hotkey, icon, owner), `PanelHosts.tsx` (drawer back stack + overlay host), `PanelPlaceholder.tsx`, one `ui/panels/<id>/index.tsx` placeholder each: build (interim quick-build palette), inspector, markets, company, reports, finance, rnd, marketing, rivals, news, advisor, goals, alerts |
| Modals | `src/ui/modals/` — PauseMenu (asks before quitting with unsaved progress), SettingsModal (Audio · Graphics · Gameplay · Interface · Accessibility · Controls with rebinding + conflict detection), SaveLoadModal (slots with thumbnail/metadata, quick/auto badges, rename, export, import, delete with confirm, storage usage), OutcomeModal (win/lose debrief frame), ModalHost (controls sheet, briefing, confirm) |
| FX / tutorial / input | `src/ui/fx/FxLayers.tsx` (screen popups, confetti), `src/game/fx.ts` (popup/worldPopup/confetti helpers), `src/ui/tutorial/CoachMark.tsx`, `src/ui/input/keymap.ts` (UX §6.20 as data) + `useGameHotkeys.ts`, `src/ui/sound.ts` (audio glue), `src/ui/qa.ts` (`window.__magnate` QA handle) |
| State | `src/state/gameStore.ts` (phases, boot progress, D5 speeds, step, skip-to-event, holds/auto-pause, month-close moment, envelope consumption, saves, autosave, outcome), `uiStore.ts` (overlay/drawer stack, modals, selection, build mode, advisor queue, Esc ladder), `settingsStore.ts` (versioned localStorage) + `settingsEffects.ts`, `alerts.ts` + `alertsStore.ts` (§6.21 policy), `autopause.ts` (§6.4), `gameEvents.ts` (normalises bridge events), `hud.ts` (HUD view-model), `scenarios.ts` (card adapter), `history.ts`, `tutorialStore.ts`, `savesStore.ts`, `savegame/` (SaveStore interface, IndexedDB + memory impls, slot metadata), `useEngineQuery.ts` |
| Clock / bus / utils | `src/game/clock.ts` (D5 30-day visual clock), `src/game/events.ts` (bus, topics extended additively), `src/util/format.ts`, `random.ts`, `storage.ts`, `thumbnail.ts` |
| E2E | `scripts/smoke.mjs` (stable `data-testid`s; `--tour` screenshots every shell state) |

## How other workstreams use it

- **Open a destination:** `useUiStore.getState().openPanel(id, params?)`. The host layer (drawer or overlay) and the hotkey come from `ui/panels/ids.ts`. Wave 2 replaces `ui/panels/<id>/index.tsx` (default export, `PanelProps`). Inside a panel, use `DrawerFrame` / `OverlayFrame` from `@/ui/components` for the chrome.
- **Selection:** `useGameStore.getState().selectBuilding(id)` sets `selectedBuildingId` and opens the inspector drawer. It also emits the bus topic `buildingSelected`.
- **Game-feel:** `fx.popup({text, tone, anchor:'topbar.cash'})` (screen space); `fx.worldPopup(buildingId, …)` (world space, for the renderer); `fx.confetti()`; `bus.on('monthClosed', …)` gives the roll-up moment (revenue, NI, cash/value start→end, streak, batched).
- **Alerts:** `useAlertsStore.getState().notify({kind, severity, title, body, actions, buildingId?})` applies the §6.21 rules: at most 3 toasts, dedupe within 3 months, batching at 4×/8×, sticky critical alerts with an Ack action, short info toasts.
- **Settings:** `useSettingsStore((s) => s.graphics.quality)`. Non-React consumers use `useSettingsStore.subscribe` or the bus topic `settingsChanged`. Audio volumes are pushed through `audio.setVolumes` (0..1 per bus). Graphics (quality, resolution scale, shadows, day/night lock, ambient density, FPS cap) are stored for W1 to read.
- **Bus topics (additive):** tick, gameEvent, gameStarted, buildingPlaced, buildingSelected, ui, speedChanged (index + multiplier), monthClosed, popup, worldPopup, confetti, locate, autoPaused, panelChanged, outcome, saved, settingsChanged.
- **Saves:** the `SaveStore` interface lives in `state/savegame/types.ts`. Today it is implemented by `idbSaveStore` (main-thread IndexedDB over the bridge's string `saveGame`/`loadGame`), with a memory fallback. Wave 2 (B6) can move storage into the worker behind the same interface. The export format is `magnate.save` v1, and import also accepts a raw engine JSON save.
- **Bridge envelope:** `gameStore` feature-detects `client.onEnvelope(cb)` (or `subscribe`) and consumes `hud` + `events` when present. It falls back to a snapshot plus `tick.events` otherwise.
- **QA:** `window.__magnate` exposes `{game, ui, alerts, settings, tutorial, bus, fx}` for playtests and the smoke tour.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npx vitest run` | 9 files, 58 tests passed (clock, format, keymap, adapters, alerts + notices, settings, saves, advisor pacing, audio glue) |
| `npx vite build` | built (~16 s) |
| `node scripts/smoke.mjs` | **SMOKE OK**: boot → title → new-game browser + briefing → tutorial → construct supermarket → advance a month at 8× → step while paused → Esc pause + resume → quicksave (Mod+S) |
| `node scripts/smoke.mjs --tour` at 1920×1080 and 1280×720 | SMOKE OK; 36 shots each, all read and reviewed |

Screenshots (JPEG) in [`u1-ui-shell/`](u1-ui-shell/):

- **1920×1080:** boot, title, new-game, HUD, Reports overlay, Build drawer, inspector drawer, pause, settings (audio, accessibility), save/load, controls sheet, month close (confetti + auto-pause pill + month chip), toast stack + context menu, tutorial coach mark, outcome won/lost, UiKit (foundations, surfaces).
- **1280×720:** title, new-game, HUD, inspector (ticker steps aside), settings › controls, coach mark.

## Known gaps

1. **Saving against a real engine is not verified end to end.** The prebuilt `web/public/_framework` in this worktree predates `GameSession.Persistence.cs`: `init.methods` has no `saveGame`/`loadGame`. The UI detects this. It shows "Saving is unavailable" and disables Save/Load (the smoke run accepts either outcome). The save path itself is covered by `saves.test.ts` against a fake engine, and the slot UI appears on the UiKit page. Per the rules I did not rebuild the engine, since I changed no engine or bridge code.
2. **Placeholders:** every panel except the alerts drawer is an "in development" placeholder with live preview charts where data exists. Building them is the Wave 2 owners' job (U2/U3).
3. **Not built yet:**
   - The minimap is a placeholder (owner dots only; no camera frustum or drag-to-pan).
   - The map overlay bar (O / Shift+1..8), Undo (Mod+Z), U/Delete and Home/Tab are listed in the key map but handled by the scene or panels later.
   - The Encyclopedia is disabled ("Soon").
4. **Mid-month pending state:** the "applies at month close (in N days)" pending-command chips depend on panel commands (Wave 2). The clock already exposes `daysUntilClose`.
5. **Autosave:** follows MASTER-PLAN D17 (3 rotating slots; interval 0/3/6/12 months, default 6), not UX §6.19's 5 slots.

## Requests

- **B1 (bridge) / lead:** rebuild `web/public/_framework` after merging B1 (`node scripts/build-engine.mjs`) so `saveGame`/`loadGame` are in the engine build. Then re-run `node scripts/smoke.mjs`: the quicksave step should report `saved` instead of `engine build has no saveGame`. Also keep `init.methods` populated; the UI uses it for feature detection.
- **B1:** keep `onEnvelope(listener)` delivering `{hud, events}` on mutating calls. The store reads `envelope.hud` (SnapshotDto-shaped) and `envelope.events` (GameEventDto[]). `boot({onProgress})` stages `runtime | content | scenarios | ready` drive the boot bar (unknown stages are ignored).
- **A1 (audio):** the shell calls `audio.ui()` with extended cues `toggleOn | toggleOff | tab | slider | priceTag | placeOk | placeInvalid` (unknown cues must be no-ops). Please also implement `audio.setPreferences({advisor, subtitles, muteInBackground})` and expose `audio.contextState`; both are feature-detected.
- **W1 (render):** read `useSettingsStore.getState().graphics` (quality, resolutionScale, shadows, dayNight, ambientDensity, fpsCap) and `controls` (edgeScroll, invertRotate, zoomSensitivity), and subscribe to `settingsChanged`. Consume the bus topics `worldPopup` (draw over the building), `locate` (focus the camera) and `buildingSelected`. Handle the Home/Tab/O/WASD/Q/E keys (they are listed in `ui/input/keymap.ts` with `handler: 'scene'`).
- **Content / lead:** the tutorial scenario's goal labels still describe the Godot UI ("Open Manage (in-game button)", "Before clicking Construct…"). They show verbatim on the scenario card, goals chip and debrief, so they need rewriting for the web HUD (§7 of ux-playability).
- **U2/U3 (Wave 2):** replace `ui/panels/<id>/index.tsx` only; build from `@/ui/components` and the tokens; see the UiKit page for every state.
