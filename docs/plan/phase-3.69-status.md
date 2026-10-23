# Phase 3.69 — Game-feel wiring + win/lose states

Wires the built-but-unused game-feel frameworks (Notifications, ScorePopup,
NewsTicker) into real gameplay, adds win/lose modals, HUD hotkey hints, and a
borderless-fullscreen launch. Presentation-only: `engine/` untouched, sim stays
deterministic.

## What shipped

### 1. Notification toasts on real events (`Main.OnMonthTicked`)
Fired per real sim tick, rate-limited to **2 toasts/tick** so 5× speed can't spam:
- **Net-income sign flip** — positive→negative (Warning), negative→positive
  (Success). Tracks last non-zero sign in `GameState.LastNetIncomeSign`; only the
  actual transition toasts.
- **Cash below $1M** — one-shot Warning (`GameState.LowCashWarned`).
- **Headlines fired this month** — each new `World.NewsLog` entry beyond
  `GameState.LastNewsCountSeen`; `EventSeverity.Major` → Warning styling, else Info.
- **Goal achieved** — Success toast per newly-completed scenario goal (in
  `CheckGoalsAndEndStates`).

### 2. ScorePopup on player actions
- **Manage** — construct building (`OnConstruct`, `BuildPreset`) spawns a red
  `-$cost` at screen centre; starting an ad campaign spawns a gold
  "Ad campaign: <product>".
- **Main** — gold "Goal achieved!" per goal completion; gold "You win!" on victory.

### 3. NewsTicker embedded in Main HUD (`Main.EmbedNewsTicker`)
Instances `NewsTicker.tscn`, disables its Escape/Back input handler
(`SetProcessUnhandledInput(false)`), hides preview chrome (header/sub/spacer/back),
and re-anchors the strip to a thin band pinned to the HUD bottom. Reads
`World.NewsLog` live via the ticker's existing reflection path. `DashboardShell`
bottom inset moved to `-60` to clear the band.

### 4. Win/Lose modal (`WinLoseScreen.tscn` + `.cs`, CanvasLayer 120)
Modal overlay instanced into Main, fires **once per game**
(`GameState.WinLoseShown`, reset in `GameState.Clear`):
- **WIN** — all scenario goals achieved → gold panel (scenario, elapsed months,
  final cash, corporate value, goal list) + [Continue playing] [Back to title].
- **LOSE** — red panel + [Keep playing (sandbox)] [Back to title], two conditions:
  - *Bankruptcy* — cash < 0 for 6 consecutive months. Counted authoritatively in
    `GameState.RecordSnapshot` (`ConsecutiveNegativeCashMonths`) so it holds
    regardless of which scene ticked.
  - *Time's up* — `scenario.EndDate` passed with goals unmet.
- Auto-pauses playback; buttons route through `OnContinue` / `OnBackToTitle`
  callbacks Main wires. Continue frees the overlay and leaves `WinLoseShown` set.

### 5. Hotkey hints (`Main._Ready`)
Every keybound HUD button now shows its key: Manage (M), Reports (R), City Map (C),
Research (T), Save/Load (S), Financials (F), Market Intel (I), Activity (A),
Replay (P), Stats (X), Help (?), Back to Title (Esc), Advance 1 Month (.),
Play/Pause (Space), speed 1×/2×/5× (1/2/3). Set in code so they don't depend on
`.tscn` text.

### 6. Borderless fullscreen (`project.godot`)
`[display]` gains `window/size/mode=3` + `window/size/borderless=true`. 1600×900
design resolution and `stretch/mode="canvas_items"` unchanged.

## Files touched
- `client/scripts/GameState.cs` — detection state fields + reset; negative-cash
  counter in `RecordSnapshot`.
- `client/scripts/Main.cs` — tick toasts, goal/end-state checks, ticker embed,
  win/lose instancing, hotkey hints, shell inset.
- `client/scripts/Manage.cs` — 3 ScorePopup call sites + `ScreenCenter` helper.
- `client/scripts/WinLoseScreen.cs` + `client/scenes/WinLoseScreen.tscn` — new.
- `client/project.godot` — fullscreen display settings.

## Build
`dotnet build client/Magnate.Client.csproj` → **0 errors, 0 warnings**.
Boot **unverified** (Godot binary unavailable in sandbox) — integrator should
boot-test.

## Known gaps / integrator notes
- **"Upgrade purchased" ScorePopup not wired** — building upgrades live in
  `BuildingInspector.cs`, which this phase does not own. The construct + campaign
  popups are in Manage; the upgrade popup needs a one-liner
  (`ScorePopup.Spawn(pos, -cost)`) added by whoever owns BuildingInspector.
- **Toasts/win-lose only evaluate while Main is the active scene.** Sim ticks in
  Manage/Reports still advance the world (and the bankruptcy counter, which is in
  RecordSnapshot), but toasts and the modal surface on return to Main. This
  matches the "modal overlay in Main" spec.
- **Escape with the modal open** still triggers Main's back-to-title (the dim
  blocks mouse, not keyboard) — harmless since that's one of the modal's buttons.
- NewsTicker embed relies on `NewsTicker.tscn` node paths
  (`Panel/VBox/TickerStrip/...`); if that scene is restructured, update
  `EmbedNewsTicker`.
