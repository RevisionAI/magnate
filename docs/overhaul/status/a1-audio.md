# A1 audio — status (Wave 1)

Branch `a1-audio` · Owner: A1 · Spec: `research/audio-plan.md` (§2, §4, §6), MASTER-PLAN D16 · Date 2026-10-01

**State: done for Wave 1.** A real game-audio system runs in the browser: mastered, loop-correct assets
(Ogg Opus + m4a, loudness-verified), one shared AudioContext/bus graph with three.js, an adaptive music
director, a camera-following ambience director, positional building emitters, the 38 procedural SFX
recipes (plus procedural stand-ins for every GENERATE cue and the six stingers), a prioritised voice
queue with ducking and subtitles, and a data-driven event router keyed by the bridge event kinds. No paid
API was called; generation stays a later, user-approved step.

---

## 1. File map

### Mastering pipeline — `tools/audio/` (see its `README.md`)

| File | Role |
|---|---|
| `sources.json` | Source registry: class targets (§2.3), every kept asset (source, class, trims, loop points, grid, VO transcript), retired assets, provenance. Edit this, not the manifest. |
| `master.py` | Idempotent pipeline (48 kHz float): head trim → HPF → baked loop seam → gain → 4× oversampled limiter → Ogg Opus (constrained VBR) + m4a (`aac_at`), re-measured with ffmpeg `ebur128` and corrected (≤ 4 passes). Writes `web/public/audio/**`, `manifest.json`, `web/src/audio/assets/probe.generated.ts`. Incremental by content hash; `--force` rebuild is **byte-identical**. |
| `verify_loudness.py` | Asset CI: both formats exist, LUFS-I / M-max within ±1 LU, true peak ≤ ceiling, SFX head silence ≤ 5 ms, sample-exact Opus length, loop QA. |
| `audiolib.py` | ffmpeg discovery + PCM I/O, numpy BS.1770-4 meter, seam baking, seam QA. |
| `recipe-levels.mjs` | Offline level test / calibration of all procedural audio in headless Chrome (via the AudioLab). |
| `audiolab-check.mjs` | Live end-to-end check of the running engine in headless Chrome (+ screenshot). |
| `probe.ogg` | 182-byte silent Ogg Opus; its base64 is the runtime codec probe. |

### Delivered assets — `web/public/audio/`

`manifest.json` + `music/{title,steady,victory}`, `sfx/{build_construct,campaign_start,cash_register.a,goal_achieved,notify_info,upgrade,victory_fanfare}`,
`vo/legacy.*` (10 lines) — each as `.ogg` and `.m4a` (20 assets, 40 files; 3.9 MB Opus / 4.6 MB m4a; a client downloads one
format). No MP3s. The three unusable legacy SFX (`ui_click` silent, `defeat` sub-bass, `notify_warning` thud) and the retired
`month_tick` are listed under `retired` in the manifest and replaced by procedural sounds with the same ids.
Loop points (stored in the manifest, seam baked into the file, ≥ 0.5 s of audio after `loopEnd`):

| Cue | loopStart → loopEnd | Body | Seam QA (env r / mean Δ / onset r) |
|---|---|---|---|
| `music.steady` (gameplay_loop) | 25.8438 → 95.6625 s | 128 beats @ 110 BPM | 0.949 / 0.76 dB / 0.967 (250 ms seam) |
| `music.title` | 12.5388 → 80.5429 s | 136 beats @ 120 BPM | 0.972 / 0.57 dB / 0.920 (1-bar seam) |
| `music.victory` | one-shot (0.5 s head trimmed) | — | — |

### Runtime — `web/src/audio/`

| Path | Role |
|---|---|
| `index.ts` | **Public facade** `audio` (stub surface kept; additions below). Holds only the API object and the settings store; the engine is a lazily imported chunk (`warmup()`/`init()`), while `init()` unlocks the AudioContext synchronously inside the gesture. |
| `AudioSystem.ts` | Wires everything to the app: `game/events` bus topics + `gameStore`; month-close batching; music inputs from snapshots; positional one-shots at buildings; news sting de-dupe. |
| `settings.ts` | zustand `persist` store `useAudioSettings` (`magnate.audio`, UX §6.18 defaults 80/60/80/100/50, advisor `important`, subtitles on…), sanitised; safe storage fallback. |
| `core/AudioEngine.ts` | Graph (§4.2): music/ambient/world/sfx/ui/voice buses, duck buses (VO: music −10, ambient −6, world −4, sfx −3 dB), music tone (normal / modal 3.5 kHz −3 dB / paused 900 Hz), ambient air LPF by zoom, mono fold, safety limiter (make-up gain compensated + runtime-calibrated), per-bus analyser meters, THREE.AudioListener routing + adoption. |
| `core/lifecycle.ts` | Autoplay unlock (gesture listeners, iOS silent-buffer kick, re-arm on Safari `interrupted`), visibility suspend/resume ("mute in background"), `navigator.audioSession`. |
| `core/math.ts` | dB helpers, slider taper (§4.4), equal-power curves, shuffle bag. |
| `assets/manifest.ts`, `probe.generated.ts` | Manifest types + validation, URL resolution, `decodeAudioData` codec probe (never `canPlayType`). |
| `assets/DecodeCache.ts`, `AssetLoader.ts` | Byte-budgeted LRU per class (music 64 / beds 48 / loops 32 / sfx+vo 24 MB; halved on mobile), in-flight de-dupe, pinning; preload groups. |
| `music/musicRules.ts` | Pure §4.7.2–4.7.4 rules: intensity, desired state with hysteresis/dwell, pressure layer, transition table. |
| `music/MusicDirector.ts`, `MusicDeck.ts` | Two decks, beat/bar-quantised equal-power crossfades, stingers (next beat, ≤ 1/20 s, deck −6 dB), anti-fatigue endings + 45–90 s rests, pressure layer, victory/defeat sequences, stand-in cues until §7 music exists. |
| `ambience/ambienceModel.ts`, `AmbienceDirector.ts` | §4.8 bed gains from the `AudioFrame` (zoom band, land use, time of day, season, weather, city preset) + Poisson world one-shots; beds start at random offsets, stop after 5 s below −60 dB. |
| `world/emitterModel.ts`, `EmitterManager.ts`, `ListenerRig.ts` | §4.9 positional loops per building (category/status/activity), 8 virtual voices (5 mobile) with 1.25× hysteresis, equal-power panners into the listener; truck engine loops; listener rig at 35 % target→camera. |
| `sfx/catalog.ts`, `SfxPlayer.ts` | 71 SFX ids: class, cooldowns, polyphony (UI 2, world 2, stingers 1, default 3, global 24 with priority-then-age stealing), shuffle-bag variants, ±30 c detune on non-musical sounds, positional or panned playback, "reduce sudden sounds". |
| `synth/primitives.ts` | §6.1 kit (env/tone/noise/mallet/bell/FM + brass/pad/timpani/piano, delay, procedural reverb) and the per-voice **peak guard**. |
| `synth/recipes.ts` | **The 38 PROCEDURAL recipes of §6.2**, transcribed 1:1, + the ribbon-cut chime layer. |
| `synth/fallbacks.ts`, `synth/music.ts` | Procedural stand-ins for the 23 GENERATE one-shots (cash register, coins, stock bell, stamp, newspaper, news sting, horns, thunder…), the 6 stingers, the defeat cue and the pressure layer. |
| `synth/beds.ts`, `ProceduralBank.ts` | Procedural stand-ins for the 12 ambience beds and 14 positional loops, rendered once in an OfflineAudioContext at 32 kHz with a baked 1 s seam, normalised to −26 / −24 LUFS. A mastered file with the same id replaces each automatically. |
| `synth/render.ts`, `offthread.ts`, `postprocess.worker.ts`, `noise.ts` | Offline rendering: the render itself runs on the audio thread; the PCM post-processing (seam bake, loudness normalisation, lookahead limiter) and the shared white/brown noise sources run in a small DSP worker, so a city load never stalls a frame (inline fallback without workers). Noise buffers are context-independent, shared per sample rate, and the long ones (≈ 17 MB) are released 30 s after the last render. |
| `synth/loudness.ts`, `calibration.json` | BS.1770-4 meter (exact K-weighting; matches ffmpeg ≤ 0.05 LU); per-recipe trims + peak-bound list (generated). |
| `voice/VoiceQueue.ts`, `VoicePlayer.ts`, `voiceLines.ts` | §4.11 queue (pure logic, injected clock/player) and Web Audio playback (scheduled ducking, chains, anchor broadcast chain + news sting). |
| `routing/AudioEventRouter.ts` | Event → SFX/VO/music actions from `data/audio-events.json`; streak pitch, 8× every-other close, latches, game-month cooldowns, anchor 90 s rule, news tiering. |
| `data/audio-events.json` | Routing table (§4.12) for every bridge-spec §7.1 kind, the proposed kinds and the bus topics. |
| `data/vo-lines.json`, `data/news-map.json` | 60 advisor + 13 anchor lines (+2 legacy tutorial lines), content news → anchor mapping. |
| `**/*.test.ts` | 9 vitest files, 136 tests (below). |

### Dev page — `web/src/dev/AudioLab.tsx` + `web/src/dev/audioLab/**` (`?dev=audio`)

Mixer with per-bus peak/RMS meters and every setting · all 71 SFX ids by class (file / proc / stand-in tags, slider value and
profit-streak params) · music state switcher + auto, stinger buttons, director inputs (cash, buildings, construction, revenue,
climate, warning) with live debug (state, cue, deck, position, loops, rest, pressure, last transition) · ambience frame sliders
(zoom, time of day, month, rain, wind, land use, water, city preset) with live bed gains · positional emitters on a top view with
a movable listener · voice queue (any line, chains, tokens, queue, subtitle log) · synthetic game events through the real bus ·
offline level report. The page calls `audio.warmup()` on mount, like the game's title screen should. `window.__audioLabReady` /
`window.__audioLab` (start, play, music, emit, voice, readMeters, subtitles, measureRecipes, measureLoops, calibrate, debug).

---

## 2. How other workstreams use it

```ts
import { audio, useAudioSettings } from '@/audio';

audio.warmup();                    // optional, at boot / title mount: context + engine before any gesture
audio.init();                      // FIRST user gesture (title "click anywhere"), called synchronously in the handler
audio.ui('click');                 // UI cues: click hover open close toggle error confirm (+ toggleOn toggleOff tab slider priceTag placeOk placeInvalid)
audio.ui('slider', { value: 0.4 });
audio.setVolumes({ master: 0.8, music: 0.6, sfx: 0.8, voice: 1, ambience: 0.5 });   // 0–1, persisted
audio.setMuted(true); audio.toggleMute();                                            // Ctrl/⌘+M
audio.setOverlayOpen(true);        // full-screen Reports/Finance overlay: music → modal tone
audio.onSubtitle((e) => …);        // { id, text, voice: 'advisor'|'anchor', priority 0–3, showSec, voiced, delaySec }
audio.contextState;                // 'none' | 'suspended' | 'running' | 'interrupted' → "Enable sound" chip
audio.attachScene({ camera, scene, getTarget: () => controls.target });   // or scene.addModule(audio.sceneModule())
audio.setFrame(frame);             // renderer AudioFrame at 10 Hz (art §5.22)
audio.setEmitters(list); audio.upsertEmitters(list, removedIds); audio.setTrucks(list);
audio.play('car_horn', { at: { x, y, z } });          // positional one-shot (world metres)
audio.listener;                    // the shared THREE.AudioListener for any PositionalAudio
audio.requestVoice('adv.sales.first'); audio.setMusicState('tension' | null);   // debug/tutorial hooks
```

`audio.ui(cue)` and `bus.emit('ui', { cue })` both work; use one per interaction (a duplicate inside the cue's
30–80 ms cooldown is dropped anyway).

**Driven automatically (no calls needed):** `bus` topics `gameStarted`, `tick` (one batch per month close: ≤ 1 VO line, at 4×/8×
≤ 1 close sound + 2 alerts), `gameEvent`, `buildingPlaced` (positional construction sound, music intensity), `buildingSelected`
(category sound), `ui`, `speedChanged` (pause/resume/faster/slower sounds, paused music tone, VO speed gating); `gameStore`
`phase`/`activeCityId`/`catalog.cities[].coastal` (title vs game music, ambience on/off, city preset), `snapshot.date.month`
(season) and `buildings[].category` (selection sound); `game/clock` `SECONDS_PER_MONTH` (speed multiplier). These are the only
U1-owned symbols the audio code reads — a rename there needs a one-line change in `AudioSystem.ts`.

**Contracts read** (all optional, newer fields used when present): `GameEventDto` `kind severity message amount buildingId cityId
productId isPlayer typeId goalId reason oldValue newValue threshold months`; `SnapshotDto` `monthIndex companies[].cash/revenueThisMonth/
buildingCount`, and from bridge-spec §5.3 `player.cashRunwayMonths`, `alerts.bankruptcyInMonths`, `outcome.status`, `elapsedMonths`.
`EmitterSource` = `{ id, category, typeId?, status?, isPlayer?, x, y?, z (world m), footprintW, footprintH (plots), activity? {
utilization, unitsSold, transfersIn, transfersOut, hasResearch } }`. `AudioFrame` = audio-plan §4.8 / art §5.22.

**Speed values:** the bus `speedChanged.speed` is read as the clock **index** and converted to a multiplier with
`SECONDS_PER_MONTH` (12 s/month = 1×), so it follows U1's D5 table automatically. Raw multipliers (2, 4, 8) are also accepted
when they are not valid indices.

---

## 3. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npx vitest run` | **9 files, 136 tests passed** |
| `npx vite build` | OK — the engine is its own lazy chunk (imported by `init()`/`warmup()`) plus a 4 kB DSP worker, so importing the facade does not pull the engine into the main bundle |
| `node scripts/smoke.mjs` | **SMOKE OK** (boot + title, tutorial, construct, a month at max speed) |
| `python3 tools/audio/verify_loudness.py` | **verify-loudness OK (20 assets, 40 files)** |
| `python3 tools/audio/master.py --force` | 3 min 56 s, verify OK, `git status web/public/audio` clean → **bit-exact rebuild** |
| `node tools/audio/recipe-levels.mjs` | **LEVELS OK — recipes 67/67, beds/loops 28/28** |
| `node tools/audio/audiolab-check.mjs` | **AUDIOLAB CHECK OK (21 checks)** |

**Unit tests (vitest, Node, no AudioContext):** voice queue (19: priority order, TTL, silence gaps, pre-emption, token bucket,
cooldowns, once-per-game latches, ≤ 1 line per close with ranking + scenario-end exception, advisor frequency, 4×/8× gating, queue
cap, hint rules, locked audio, subtitles) · music rules (33: intensity, every §4.7.3 rule incl. hysteresis edges 0.60/0.40 and boom
0.45/0.30, 60 s dwell, tension exit after 2 closes/runway > 6/30 s, pressure layer, transition table) · router (24: every bridge
§7.1 kind + bus topic has a rule, table references only playable SFX / existing lines / stingers, content news mapping vs
`content/data/events/seed.json`, streak pitch, 8× closes, speed sounds, selection sounds, placement dedupe, once-per-game, crises,
outcomes, news tiers + anchor 90 s + intro, macro chains, game-month cooldowns) · manifest (14: shipped manifest parses, files exist
in both formats with matching sizes, loudness within ±1 LU, loop points of §2.5 with audio after loopEnd, provenance, probe;
validation errors; DecodeCache LRU/pinning/in-flight) · loudness/DSP (13: BS.1770-4 coefficients, EBU 3341 case 1 = −23.0 LUFS,
dual-mono, 32 kHz, gating, true peak, loop baking, offline limiter, peak-guard curve, noise sources) · catalog (6: all 38 recipes, detune policy,
calibration coverage, cooldowns/polyphony, beds and loops for every emitter) · ambience/emitters (12) · settings/facade (6) · math (9).

**Mastering report** (ffmpeg `ebur128`, decoded delivered files; targets ±1 LU):

| Asset | Metric | Target | .ogg | .m4a | TP .ogg / .m4a | Ceiling |
|---|---|---|---|---|---|---|
| music.steady / title / victory | LUFS-I | −20 | −20.0 / −20.0 / −20.0 | −20.0 / −20.0 / −20.1 | −3.8/−3.9 · −6.2/−6.7 · −9.1/−9.2 | −1.5 |
| build_construct / campaign_start / goal_achieved / upgrade | M-max | −18 | −18.0 each | −18.0 / −18.1 / −18.1 / −18.1 | −7.5 · −4.8 · −8.2 · −10.2 | −1.5 |
| cash_register.a | M-max | −22 | −22.0 | −22.1 | −7.8 / −8.4 | −1.5 |
| notify_info | M-max | −26 | −25.9 | −26.1 | −7.9 / −7.9 | −6 |
| victory_fanfare | M-max | −14 | −14.0 | −14.0 | −6.7 / −7.0 | −1 |
| 10 × vo.legacy.* | LUFS-I (dual mono) | −18 | −18.0 … −18.1 | −18.0 … −18.1 | −2.3 … −6.0 | −1.5 |

**Per-recipe level report** (`node tools/audio/recipe-levels.mjs`: offline, 48 kHz, through the live trim + peak-guard chain,
4 renders each, BS.1770 M-max): **67/67 procedural cues pass.** 55 are loudness-bound and land on their class target (mean
|Δ| 0.06 dB, max 0.58 dB); 12 transients shorter than the 400 ms window are peak-bound and held at their class ceiling
(`ui_click` 40 ms: M-max −37.8 LUFS at a −13.9 dBFS peak under the −12 dBFS ceiling; `slider_tick` −35.4; `place_ok` −21.3 at
−2.5 dBFS; `stockout` −18.2 at −2.4). No cue is silent, every sample peak sits ≥ 0.3 dB under its class ceiling, no NaN, none rings
past its declared length. Examples on target: `cash_register` b/c −22.0, `coins_large` −22.1, `month_close_up` −22.0,
`alert_critical` −18.1, `heartbeat_soft` −18.1, `newspaper` −18.1, `ipo_bell` −14.2, `news_sting` −14.0, `stinger.*` −13.9…−14.1,
`thunder` −19.6. **Beds/loops 28/28:** 12 beds at −26.0 LUFS-I, 14 positional loops at −24.0…−24.5, pressure layer −20.0, defeat
cue −20.0; true peaks ≤ −6.4 dBTP on beds/loops; click-free wraps.

The JS meter used here was found reading 0.26 dB low against the EBU 3341 reference (RBJ-style shelf instead of the BS.1770
design) and fixed; it now matches the BS.1770-4 coefficient tables and ffmpeg `ebur128` within 0.05 LU on the shipped files
(`goal_achieved` I −23.16 vs −23.2, `cash_register.a` −24.23 vs −24.2, `music.steady` −20.00 vs −20.0, `legacy.welcome` −18.00 vs
−18.0).

**Live e2e** (`node tools/audio/audiolab-check.mjs`, headless Chrome, the real AudioContext graph, 48 kHz, base latency
5.3 ms): unlocked by a real click; manifest + probe → `.ogg`; **start-up: 1 long task > 50 ms (67 ms) in the 7 s in which the
title cue decodes and 6 procedural beds render** (before the DSP worker and shared noise buffers: 10 long tasks, longest
823 ms); 7 cues of every class reach the sfx bus and master (peaks −16.4…−4.0 dBFS, master ≤ −5.7); `gameStarted` → `calm`
on `music.steady` and voices the advisor welcome with its transcript subtitle; a 6 s tutorial line peaks −7.6 dBFS on the voice bus
and **ducks the music −9.8 dB** (spec −10), which recovers after the line; a month close with cash < 0 → `tension` (beat-quantised
1.5 s crossfade + stinger + pressure layer) and raises the P0 line (subtitle only: no take yet); `scenarioWon` → `victory`
(fanfare + one-shot cue); master peak ≤ −6.9 dBFS throughout.

Screenshot reviewed: `web/test-results/shots/audiolab-e2e.png`.

---

## 4. Known gaps

- **Generated content is not in yet (by design: needs the user's approval and a key with the audio-plan §3.2 scopes).** Until then
  procedural stand-ins play for the 23 GENERATE SFX, the 12 beds, the 14 positional loops, the pressure layer, the 6 stingers and
  the defeat cue; the 5 new music cues (§7) fall back to `steady`/`title` variants (tone/gain) per state. Everything upgrades
  automatically when `tools/audio` masters a file with the same id.
- **VO:** only the 10 legacy Hope takes exist. They are mapped to the closest §5.2 lines (welcome, restock, press-play, first-ad,
  tutorial-complete, victory, both defeats, two legacy tutorial lines) with their own transcripts as subtitles; every other line is a
  subtitle toast (`voiced: false`). The broadcast chain and news-sting timing are implemented but unheard until anchor takes exist.
- **Music segments:** v1 single-buffer decks (audio-plan §4.7.5 shortcut). `SegmentPlayer`/`segment-music.py` (8-bar segments,
  lower memory) are only needed for the generated cues; the steady cue costs 46 MB decoded (within the 64 MB music budget).
- **Hint lines (P3)** route from a `playerIdle` event with `reason: 'adv.hint.*'`; the predicates themselves (idle cash, no ads …)
  need advisor data from the bridge (Wave 2/3).
- Once-per-game VO latches are client-side and reset on load; the save-persisted latches belong to the bridge's EventDetector (§4.11).
- Not implemented: `soft_drink_health_scare` → `notify_warning` only when the player sells soft drinks in Eastside (needs market data);
  an in-game F9 audio overlay (the AudioLab covers it for now); the manual browser matrix (Safari/iOS/Firefox) — only headless Chrome
  was exercised.
- The AudioLab's CSS uses its own dev-page palette rather than `theme/tokens.ts` (dev-only page).

## 5. Requests

**U1 (ui-shell)**
1. Call `audio.init()` synchronously inside the first user-gesture handler (title screen) — not after an `await`. Optionally call
   `audio.warmup()` when the app boots: opening the audio device can block the main thread (≈ 0.8 s measured in headless Chrome),
   and warmup pays that before the click; any later gesture then unlocks audio.
2. Show an "Enable sound" chip when `audio.contextState !== 'running'` 3 s into gameplay (audio-plan §4.5); clicking it calls `audio.init()`.
3. Key map: Ctrl/⌘+M → `audio.toggleMute()`.
4. Settings screen (UX §6.18): bind to `useAudioSettings` (master/music/sfx/voice/ambient 0–100, muted, muteInBackground — show as
   "keep playing in background" inverted —, advisor all/important/off, subtitles, mono, reduceSudden, iosIgnoreSilentSwitch) or use
   `audio.setVolumes`/`setMuted`. Defaults live in `AUDIO_DEFAULTS`.
5. Advisor dock / toasts: subscribe `audio.onSubtitle`; show for `showSec` after `delaySec`; `aria-live="polite"` only for priority 0–1.
6. Full-screen overlays (Reports, Finance…): `audio.setOverlayOpen(true/false)`.
7. Keep `speedChanged.speed` = clock index (see §2); if it becomes a multiplier, tell A1 (an index of 4 is ambiguous).

**W1 (render-core)** — add `audio.sceneModule()` to `CityScene` (or `audio.attachScene({ camera, scene, getTarget: () => controls.target })`),
and publish `audio.setFrame(frame)` at 10 Hz with the art §5.22 fields. Don't create another `THREE.AudioListener`; use `audio.listener`
(one created anyway is adopted and re-routed, provided it was made after `audio.init()`).

**W2 / W5 (Wave 2)** — `audio.setEmitters/upsertEmitters` from the city layer (`EmitterSource`, world metres, footprint in plots, cityView
`status` + `activity`), `audio.setTrucks` from the traffic agents (positions), and `audio.play(id, { at })` for world FX one-shots.

**B1/B2 (bridge)** — for `news` events please set `typeId` to the content event id (e.g. `oil_glut`); the router keeps the content
severity tier from it (bridge §7.2 folds Notable into `info`), with the headline as a fallback. The routing table already carries the
proposed kinds (`quarterClosed`, `loanApproved/Denied/Repaid`, `taxPaid`, `ipoEligible`, `sharePriceMove`, `indexMove`, `stakeAlert`,
`climateChanged`, `policyRateChanged`, `companyBankrupt`, `cashRecovered`, `insolvencyWarning`, `marketLeaderGained/Lost`,
`stockOut`) — adopt these names or tell A1 the final ones; snapshot fields of §2 are read when present.

**Lead / user** — ElevenLabs generation (VO batch §5, GENERATE SFX §6.2, beds/loops §6.3, music §7) needs a key with the §3.2 scopes
and approval of ≈ $8 of credits; then `tools/audio/sources.json` + `master.py` take the files in with no code change.
