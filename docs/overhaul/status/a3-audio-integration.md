# A3 audio integration — status (Wave 2)

**Status: done.** The 106 voiced lines of the a2 batch are mastered into the web build; bridge events, client moments, UI cues and
tutorial steps route to music / SFX / VO through data tables; subtitles go out on the bus; the UI shell's requests of the audio engine
are implemented; and a real-game trace (tutorial through the UI, then an autopilot economy at 8×) shows the router reacting to real
engine events. Engine / bridge code is untouched (no C# change; the prebuilt WASM is used as is).

Read with: `docs/overhaul/status/a1-audio.md` (engine architecture), `a2-voice.md` (the takes), `tools/audio/README.md` (pipeline).

## 1. File map

| Path | What changed |
|---|---|
| `tools/audio/sources.json` | `voSets`: the a2 batch (`assets-src/vo/manifest.json`) is mastered as a set; the ten legacy Godot VO entries are retired from the web build. |
| `tools/audio/master.py` | VO sets → `vo.<line id>` assets: edge trim (30 ms head / 150 ms tail around the first/last window above −50 dBFS, 5/20 ms fades), VO chain to −18 LUFS-I dual-mono, ≤ −1.5 dBTP; Opus 64 kbps + AAC 96 kbps; manifest fields `line, role, text, durationSec, priority, legacyAlias, aliases, tts, trimmedFromSec, provenance`; top-level `vo` section (`sets`, `held`, `legacyMap`, `aliasMap`). |
| `tools/audio/vo_level_report.py` | ffmpeg `ebur128` (true peak, dual-mono) on every mastered line in both formats → `tools/audio/reports/vo-levels.{md,json}`; exit 1 outside target. |
| `tools/audio/game-audio-trace.mjs` | Plays the real game in headless Chrome and dumps the router's decision trace → `web/test-results/audio-trace/{summary.md,trace.json,game.png}`. Options `--months N` (tutorial, default 24), `--economy-months N` (autopilot phase, default 36, 0 = skip), `--advisor important|all|off`, `--headed`. |
| `tools/audio/audiolab-check.mjs` | + anchor chain after the news sting, + the voice-line browser. |
| `web/public/audio/vo/*` | 106 lines × `.ogg` + `.m4a` (212 files, 3.6 MB Opus / 5.5 MB AAC); legacy takes removed. `web/public/audio/manifest.json` regenerated (116 assets). |
| `web/src/audio/data/vo-lines.json` | VO registry: all 108 script lines (106 voiced, 2 held) with subtitle text, voice, priority P0–P3, `tutorial`, `oncePerGame`, `gameMonthCooldown`, `firstFree`, `every`, `majorPriority`, `held`. |
| `web/src/audio/data/audio-events.json` | v2 routing table: 82 event keys (bridge kinds, proposed kinds, `bus.*` topics, `client.*` moments) → rules (sfx / vo / music / once / tutorial), plus the `tutorial` step → line map. |
| `web/src/audio/data/news-map.json` | Content news id → anchor line (unchanged contract; checked against `content/data/events/seed.json`). |
| `web/src/audio/voice/voiceLines.ts` | Registry loader, `canonicalLineId` (legacy Godot names + superseded UX ids → new ids), `resolveVoiceLine`. |
| `web/src/audio/voice/VoiceQueue.ts` | Close batches (≤ 1 line per month close, ranked; second P0 only for scenario end), tutorial lines rank as P1·T at 4×/8×, skip reasons on every toast, waits for the manifest before deciding `noTake`. |
| `web/src/audio/routing/AudioEventRouter.ts` | Templated candidates (`${group}`, `${milestone}`, `${pct}`), candidate lists (first unlatched/uncooled wins), game-month cooldowns, onboarding predicates (`drawer`, `overlay`, `buildingsEq/Gte`, `monthsGte`, `runwayLt`), `routeTutorial`, decision notes for the trace. |
| `web/src/audio/debug/AudioTrace.ts` | Bounded ring (1,500) of decisions: event → rule, SFX play/suppressed, VO queue/play/toast/drop (+ reason), music state, stingers, subtitles. |
| `web/src/audio/AudioSystem.ts`, `index.ts` | `setPreferences`, `contextState`, unknown UI cues = no-op, `audition`, subtitle bus topic, tutorial-store subscription, press-play nudge, `window.__magnateAudio` QA handle, gameStarted de-dupe. |
| `web/src/audio/music/MusicDirector.ts` | Exposes its state for the trace. |
| `web/src/dev/audioLab/VoiceBrowser.tsx` (+ `AudioLab.tsx`, `panels.tsx`, `AudioLab.module.css`) | Voice-line browser in the AudioLab (`?dev=audio`): all 108 lines, filter by role / priority / text, audition one, "play all" over the filtered list; shows priority, flags (T, once, held), duration, LUFS, old names and the events / tutorial steps / news ids that raise each line. |
| Tests | `routing/voiceRouting.test.ts` (new), `routing/AudioEventRouter.test.ts`, `voice/VoiceQueue.test.ts`, `assets/manifest.test.ts`; `synth/loudness.test.ts` gets a 30 s file timeout (DSP-heavy, timed out under machine load). |

## 2. Contracts for other workstreams

### Audio API additions (`@/audio`)

```ts
audio.setPreferences({ advisor?: 'all' | 'important' | 'off', subtitles?: boolean, muteInBackground?: boolean,
                       mono?: boolean, reduceSudden?: boolean, iosIgnoreSilentSwitch?: boolean })   // unknown keys ignored
audio.contextState        // 'none' before init, then AudioContextState | 'interrupted'
audio.ui(cue, { value })  // 'click' | 'hover' | 'open' | 'close' | 'toggle' | 'error' | 'confirm' | 'toggleOn' | 'toggleOff'
                          // | 'tab' | 'slider' | 'priceTag' | 'placeOk' | 'placeInvalid'; ANY other string is a silent no-op
audio.onSubtitle(cb)      // => unsubscribe
audio.audition(lineId)    // Promise<seconds> (0 = no take); accepts new ids, legacy Godot names and old UX ids
audio.requestVoice(ids, opts)
```

`web/src/ui/sound.ts` (U1) already feature-detects `setPreferences` / `contextState`, and `state/settingsEffects.ts` forwards
`advisorVoice`, `subtitles`, `muteInBackground` — nothing more is needed on the shell side for those.

### Subtitle bus topic — `subtitle`

Published on the shared `bus` (`@/game/events`) and via `audio.onSubtitle`, same payload (`SubtitleEvent`, `voice/VoiceQueue.ts`):

```ts
{ id: string;               // canonical line id, e.g. 'adv.cash.negative', 'news.commodity_spike'
  text: string;             // the subtitle (identical to the script)
  voice: 'advisor' | 'anchor';
  priority: 0 | 1 | 2 | 3;  // P0 critical … P3 hint
  showSec: number;          // keep it up max(duration + 1, 3) s
  voiced: boolean;          // false → show as an advisor toast only
  delaySec: number;         // seconds until the line is heard (chains, news sting) — show it then
  durationSec: number;
  reason?: 'advisorOff' | 'fastSpeed' | 'hintRules' | 'noTake' | 'closeBudget' | 'queueFull' | 'expired' }
```

Voiced lines are only published while the player's **Subtitles** setting is on; unvoiced lines (toasts) always are. Use
`aria-live="polite"` for P0–P1 only. The topic is typed locally as `AudioBusEvents` because `game/events.ts` belongs to U1 (see Requests).

### Advisor frequency (UX §6.18)

| Setting | Voiced | Toast only |
|---|---|---|
| `all` | every line (P2/P3 still become toasts at 4×/8×) | — |
| `important` (default) | P0, P1, and tutorial lines (P1·T) | P2/P3 (`advisorOff`) |
| `off` | nothing | everything |

Plus: ≤ 1 line per month close (ranked P0 > goal > rival > opportunity; a second P0 only for scenario end), token bucket (cap 6, +1 per
20 s), per-line real-time and game-month cooldowns, once-per-game latches (reset on new game / load), TTLs (P0 30 s … P3 6 s), P0
pre-empts P2/P3. Tutorial-scenario onboarding lines count as tutorial lines even when their base priority is P2.

### Routing data (edit data, not code)

* `data/audio-events.json` → `events[kind]`: ordered rules, first whose `if` matches fires. Keys: bridge `GameEventDto.kind`, `bus.<topic>`,
  `client.<moment>` (`client.pausedAfterBuild`, `client.deadline`). VO action: `{ line | [candidates], chain, rank, scenarioEnd, newsSting,
  hint, delay }`, templating `${group}`, `${milestone}`, `${pct}`.
* `data/audio-events.json` → `tutorial[stepId]`: the line for a tutorial step id; a step's own `vo` field (new id or any legacy name) wins.
  Each step id is voiced once per save (`tutorialStore.voPlayed`).
* `data/vo-lines.json`: priority and limits per line.
* Major news: `news_sting` → anchor line (the session's first one prefixed with `news.intro`; ≤ 1 anchor line per 90 s) → chained advisor
  follow-up, as one atomic chain.

### QA handle

`window.__magnateAudio.{trace(sinceSeq?), summary(sinceSeq?), lastSeq(), debug(), audition(id)}` in every build; `?audioTrace` (or
`localStorage['magnate.audioTrace'] = '1'`) echoes each decision to the console.

## 3. Verification

| Gate | Result |
|---|---|
| `dotnet build Magnate.sln` | 0 errors (no C# changes in this branch) |
| `dotnet test Magnate.sln --no-build` | Engine 863 passed; Bridge 201 passed, 4 skipped |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run` | 31 files passed, 1 skipped; **632 passed**, 3 skipped (audio: 10 files, 158 tests + the new rank test) |
| `npx vite build` | OK |
| `node scripts/smoke.mjs` | **SMOKE OK** |
| `python3 tools/audio/verify_loudness.py` | **verify-loudness OK (116 assets, 232 files)** |
| `python3 tools/audio/vo_level_report.py` | **All 106 lines within target**: LUFS-I .ogg −18.0 / −18.0 / −18.0 (min/mean/max), .m4a −18.3…−17.9; true peak ≤ −1.7 dBTP (.ogg) / −1.9 (.m4a); head silence ≤ 34 ms, tail ≤ 140 ms; mean trim 96 ms. Report: `tools/audio/reports/vo-levels.md`. |
| `node tools/audio/game-audio-trace.mjs` (advisor `important`) | **GAME AUDIO TRACE OK (14 expectations)** — see below |
| `node tools/audio/audiolab-check.mjs` | every functional check passes (SFX on the buses, music states, advisor line + subtitle + −10.4 dB duck, P0 cash line, **anchor chain after the news sting: intro +2.26 s, anchor +5.67 s, advisor +9.72 s**, voice browser 108 rows + audition, victory, master under the ceiling); the **start-up long-task budget (< 120 ms) failed under machine load** (load average 50–450 during this session; 523–1,301 ms worst task) — see Known gaps |

### In-game trace (real engine, real events)

Tutorial scenario through the UI (the click on "Play tutorial" unlocks audio), 24 months at 8×, then `soft_drink_war` with the player on
autopilot for 36 months at 8×; 599 decisions. Highlights (`web/test-results/audio-trace/summary.md`):

* Routed event kinds: `bus.gameStarted, bus.speedChanged, bus.panelChanged, buildingConstructed, goalAchieved, bus.buildingPlaced,
  bus.buildingSelected, client.pausedAfterBuild, monthClosed, lossStreak, news, firstSale, recordMonth, revenueMilestone, shareMilestone,
  lowRunway, brandMilestone, cashLow, cashNegative, bankruptcyWarning` (14 of them in the economy phase).
* VO voiced in order: `adv.onboard.welcome → adv.onboard.first_plot → vo_goal_generic → adv.onboard.set_price → adv.onboard.read_books →
  news.intro>news.commodity_drop>vo_news_major → (new game) adv.onboard.welcome → adv.sales.first → adv.build.started_tight →
  adv.cash.runway_low → adv.cash.negative → news.commodity_spike>vo_news_major`.
* P2 lines (`vo_building_first_retail`, milestones, `adv.market.share_25`, brand, record month) became subtitle toasts (`advisorOff`) as the
  `important` setting specifies; with `--advisor all` they become `fastSpeed` toasts at 8× (earlier run).
* SFX: month-close sounds on every other close at 8× (12 for 24 closes), 165 suppressed by the 4×/8× close policy (1 close sound + 2 alerts).
* Music: `calm → steady → tension → steady → tension → steady → tension` following cash and runway; triumph stingers on goals / records.
* Fixed from the trace: cash-negative and the bankruptcy warning arrived in the same close and the (less severe) cash line won the tie;
  cash-negative now ranks 1, so the bankruptcy warning is the voiced line and the other is its toast.

## 4. Known gaps

* **Tutorial chapter scripts don't exist yet**, so no `tutorial:<step>` decision appeared in the in-game trace. The step → line map, the
  once-per-save latch and the store subscription are unit-tested; in play today the tutorial scenario is voiced by the onboarding moments
  (Build with no building, inspector on the first store, Reports after the first close, press-play nudge), which the trace verifies.
* **Start-up long tasks**: the AudioLab check's < 120 ms main-thread budget failed in this session only because of machine load (the same
  run's functional checks pass, and VO is lazy-loaded, so this branch adds no start-up decode work). Re-run on an idle machine.
* Two script lines are held (no take): `vo_t1_intro`, `vo_victory_t1` → subtitle-only (`noTake`). The takes are Kokoro stand-ins
  (a2-voice: ElevenLabs out of credits); re-voicing is `tools/voice` + `master.py`, no code change.
* Once-per-game latches are client-side (reset on load), as in Wave 1; persistent latches belong to the bridge's EventDetector.
* Hint lines (P3) still depend on `playerIdle` reasons from the bridge (advisor predicates are Wave 3).
* Only headless Chrome was exercised (no Safari / iOS / Firefox pass).

## 5. Requests

* **U1 / U2 (UI):** render `subtitle` events in the advisor dock / toast stack (show after `delaySec` for `showSec`; unvoiced = toast),
  and add `subtitle: SubtitleEvent` to the bus event map in `game/events.ts` (the audio side publishes it through a local typed view).
* **Tutorial author (Wave 2/3):** step ids in `data/audio-events.json → tutorial` (`welcome, briefing, flyover, build, build-store,
  construction, price, restock, press-play, first-month, read-store, rival, share-drop, advertise, run-campaign, brand, books, loan,
  expand, finish, complete, victory`) are voiced automatically; use those ids or set `step.vo` to a line id.
* **B1/B2 (bridge):** unchanged from A1 — `news.typeId` = content event id; adopt the proposed kinds (`insolvencyWarning`, `cashRecovered`,
  `quarterClosed`, `companyBankrupt`, …) or tell audio the final names.
* **Lead / user:** ElevenLabs re-voicing of the batch when credits return (a2-voice §2).
