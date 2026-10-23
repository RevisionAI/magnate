# Phase 3.73 — Audio system + Sprint 15 integration

**Status:** COMPLETE — all 24 audio assets generated and boot-verified. Sprint 15 = phases 3.69–3.73.

**2026-07-17 final:** VO (10) generated with the config key; music (3) + SFX (11)
required a second key with `music_generation`/`sound_generation` permissions
(user-provided). SoundManager race fixed: host node enters the tree deferred, so
playback now routes through `RunWhenReady` (deferred FIFO). Headless boots of
TitleScreen + Main show zero playback errors; only Godot's benign
"resources still in use at exit" notice remains (static stream cache).

## What shipped

### SoundManager (`client/scripts/SoundManager.cs`, NEW)
Static audio helper in the Notifications/ScorePopup style — no autoload, no
project.godot changes. Players parent to a host node under the *tree root* (not
CurrentScene) so music survives scene transitions.

- `PlayMusic(name, fadeSec)` — crossfades between two players; loop flag set at
  runtime per stream type (mp3/ogg/wav).
- `PlaySfx(name)` — 8-player round-robin pool; same-effect-same-frame debounce.
- `PlayVoice(name)` — single channel; ducks music −18dB while speaking, restores on finish.
- `SetMuted(bool)` — master mute.
- Assets resolve from `res://assets/audio/{music,sfx,vo}/<name>.{mp3,ogg,wav}`.
  **Missing files are silent no-ops** — the game runs with a partial or absent set.

### Call sites wired (integration pass)
| Where | Sound |
|---|---|
| TitleScreen `_Ready` | `title_theme` music; `vo_welcome` once per app run; `ui_click` on menu buttons |
| Main `_Ready` | `gameplay_loop` music (crossfades from title); `GuidedTutorial.TryAttach(this)` |
| Main `OnMonthTicked` | `month_tick` at 1× speed only; `notify_warning` / `cash_sale` on NI flips; `notify_warning` low-cash; `notify_info`/`notify_warning` per headline |
| Main `CheckGoalsAndEndStates` | `goal_achieved` per newly-completed goal |
| Main `ShowEndScreen` | win: `victory_theme` + `victory_fanfare` + `vo_victory`; lose: music stop + `defeat` + `vo_defeat_bankrupt`/`vo_defeat_timeup`; continue → back to `gameplay_loop` |
| Manage | `build_construct` on construct + starter plans; `campaign_start` on campaign start |
| GuidedTutorial | `vo_tutorial_step1..5` on step transition; `vo_tutorial_complete` at the end (step ids build-store / stock-shelf / let-time-pass / run-campaign / grow-value) |

### Asset manifest (generated via ElevenLabs REST API)
Script: session scratchpad `gen_audio.sh` → `client/assets/audio/`, log at
`client/assets/audio/generation_log.txt`. Voice: "Hope" (user's configured
ElevenLabs default). 3 music tracks (title_theme 90s / gameplay_loop 120s /
victory_theme 30s), 11 SFX, 10 VO lines. **Run blocked by the permission
classifier in-session — the user runs the script once (`! bash …`), then assets
are picked up with zero further code changes.**

## Known gaps
- `upgrade.mp3` SFX has no call site: the engine's building-upgrade ladder
  (phase 3.59) has **no client UI at all** — no `UpgradeBuilding` caller exists in
  `client/scripts/`. When an upgrade button lands in BuildingInspector, add
  `ScorePopup.Spawn(pos, -cost)` + `SoundManager.PlaySfx("upgrade")`.
- No mute/volume UI — `SoundManager.SetMuted` exists; a settings toggle is a
  future polish item.
- `cash_sale` doubles as the "back in the black" sting; a per-sale trigger was
  deliberately skipped (would fire every tick).

## Sprint 15 phase map
- 3.69 gamefeel — toasts/popups on real events, NewsTicker in Main HUD, WinLoseScreen, hotkey hints, borderless fullscreen.
- 3.70 chrome A — Reports / FinancialStatements / MarketIntel / StatsDashboard styled + friendly empty states.
- 3.71 chrome B — ActivityFeed / ResearchTree / ReplayViewer / BuildingInspector / SlotEditor styled (code-only, no .tscn edits).
- 3.72 guided tutorial — GuidedTutorial overlay, auto-advancing 5-step checklist, `StepChanged(stepId)` signal.
- 3.73 this doc — SoundManager + cross-phase wiring + audio manifest.
