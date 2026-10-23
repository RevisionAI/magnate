# Magnate web client: audio plan (sound, music, voice)

**Author:** audio-plan (game audio director, research phase) · **Date:** 2026-09-30 · **Status:** proposal for implementation
**Scope:** audit of `client/assets/audio`, an ElevenLabs capability check, the Web Audio system for the Three.js client, the VO script, the SFX list and new music cues.
**Nothing in the project tree was changed except this file.** All measurements, test encodes and prototypes live in the session scratchpad: `…/scratchpad/audio-plan/` (scripts `measure.py`, `loopcheck.py`, `findloop.py`, `seamtest.py`, `master.py`, `vo_script.py`, `codec/test.html` + `codec/cdp.mjs`).
**Aligned with sibling reports:** `bridge-spec.md` (event kinds, `cityView` activity, runway formula, outcome rules), `ux-playability.md` §6.4, §6.15, §6.18, §6.21, §8 and §9 (pacing, settings defaults, alert policy, game-feel catalogue, VO ids), and `caplab-brief.md` (5-state climate, credit ratings, IPO, quarterly dividends, insolvency).

---

## 0. Summary: the decisions on one page

1. **Current assets: keep the music and most of the SFX, but fix them.** Three of the 11 SFX are broken:
   - `ui_click` is effectively silent: peak −58.3 dBFS, −66 LUFS.
   - `defeat` is sub-bass only (spectral centroid 86 Hz, −39 LUFS), so laptop and phone speakers can't play it.
   - `notify_warning` is a low thud (centroid 214 Hz, nothing above 2 kHz).

   **Loudness is all over the place:**
   - SFX momentary maxima span 60 dB.
   - Music varies by 6.4 LU; victory is 6.4 LU louder than gameplay.
   - VO varies by 4.8 LU.
   - Two SFX exceed 0 dBTP (inter-sample clipping).
2. **`gameplay_loop` is not a loop.**
   - It ends in a 6.5 s fade (−22 → −83 dBFS RMS) after the kick drops out at 104.5 s. The wrap jumps 65 dB (RMS −81.8 dBFS → −16.4 dBFS).
   - The MP3s have no Xing/LAME gapless header. Chrome decodes them with **+1,105 samples at the head and +431 at the tail** (measured).
   - **Verified fix:** loop region 25.8438 s → 95.6625 s. That is exactly 128 beats at 110 BPM (32 bars). The 250 ms equal-power seam matches the original envelope to within 0.75 dB mean (correlation 0.95).
   - The title theme also has a verified loop (12.5388 → 80.5429 s, 34 bars at 120 BPM). It needs a 1-bar baked seam.
3. **Delivery format: Ogg Opus 48 kHz**, with an **AAC `.m4a` fallback** picked by a runtime decode probe of a 197-byte file. There are no MP3s in the web build.
   - Measured in Chrome: Ogg/WebM Opus, Vorbis, FLAC, WAV and LAME-tagged MP3 all decode **sample-exact**. AAC adds 256 tail samples. MP3 without an Xing header adds 1,105 + 431.
   - Loops never wrap the whole buffer. They always use explicit `loopStart`/`loopEnd` inside the content, which makes them immune to codec padding.
   - The web skeleton's `web/public/audio` currently holds verbatim copies of the legacy MP3s. Replace them with the mastered outputs (§4.15).
4. **Loudness spec** (measured on the delivered file; prototype chain verified to ±0.1 LU):

   | Asset class | Target |
   |---|---|
   | Music | −20 LUFS-I |
   | VO | −18 LUFS-I, TP ≤ −1.5 dBTP |
   | Ambience beds | −26 LUFS-I |
   | Positional loops | −24 LUFS-I |
   | SFX (by class, momentary max) | UI −30, notices −26, economy −22, events and alerts −18, stingers −14 LUFS-M |

   With the UX default sliders (80/60/80/100/50) on a linear-amplitude taper, the mix lands at:

   | Element | Level |
   |---|---|
   | VO | ≈ −20 LUFS |
   | Music | ≈ −26 LUFS, ducked −10 dB under VO |
   | Ambience | ≈ −35 LUFS |
   | Events | ≈ −22 LUFS-M |
5. **ElevenLabs.** The key in `~/.claude/voice/key` is a **scoped key without `user_read`, `models_read` or `voices_read`**: all 5 free read endpoints returned 401. So tier, quota, the model list and the voice list could not be read.
   - It is almost certainly the TTS-only key used by the user's spoken-updates tool. That matches the 401s on music and SFX in `generation_log.txt`.
   - Music and SFX generation need the "second key" from phase 3.73 (user-provided, not on disk), or this key's scopes widened.
   - "Hope" = voice_id **`uYXf8XasLslADfZ2MB4u`**, taken from the Claude desktop ElevenLabs MCP config. It is unverifiable with this key.
   - The public API today has:
     - `eleven_v4` (launched 2026-09-28), `eleven_multilingual_v2` and `eleven_flash_v2_5`;
     - `eleven_text_to_sound_v2` with **`loop: true`**, 0.5–30 s;
     - `/v1/music` with `music_v1`, `music_v2` and `music_v2_5`, composition plans, and 3 s–10 min.
   - The whole plan costs **≈ $8 at list API prices**.
6. **Web audio system:**
   - One `AudioContext`, shared with three.js via `THREE.AudioContext.setContext`. The `AudioListener` output is re-routed into our bus graph.
   - **Buses:** music, ambient, world (3D), sfx, ui and voice. There are 5 user sliders (UX §6.18), persisted with zustand `persist`.
   - Scheduled ducking (VO −10 dB music, −6 ambience, −4 world, −3 sfx) and a safety limiter.
   - Gesture unlock (iOS silent buffer, re-armed when interrupted).
   - A **segment-based music director**: 8 states (title, calm, steady, growth, tension, recession, victory, defeat) plus rest and pause modifiers, with beat-quantized equal-power crossfades, key-compatible stingers and anti-fatigue rests.
   - An **ambience director** that mixes 12 beds from camera height, focus-area land use (summed-area tables), city preset, season and weather.
   - **Positional building emitters:** 8 virtual voices, `equalpower` panners, gain driven by `cityView.activity.utilization`, sales and transfers.
   - A **VO queue**: priorities P0–P3, TTLs, per-id cooldowns, a token bucket, at most one VO per month close, P0 pre-emption and subtitles.
7. **Content produced here:**
   - 60 advisor lines (4–16 words, no company names, no numbers) and 13 news-anchor lines, each with id, trigger, priority and limit;
   - 67 SFX ids: 38 procedural recipes with exact parameters, 23 GENERATE prompts and 6 KEEP;
   - 12 ambience beds and 14 positional loops (GENERATE, `loop:true`);
   - 5 new music cues with full `composition_plan` JSON, plus a defeat cue, a pressure layer and a 6-stinger pack.

---

## 1. Audit of the existing assets (`client/assets/audio`)

### 1.1 How the legacy Godot client uses them

- The 24 files are all ElevenLabs output: MP3, 128 kbps CBR, 44.1 kHz. Music and SFX are stereo; VO is mono. Encoder tag `Lavf60.16.101`.
- The Godot `.import` files have `loop=false`. `SoundManager.PlayMusicNow` forces looping on **every** music stream (`client/scripts/SoundManager.cs:56`, `SetLooping` at `:233-241`). **So `victory_theme` loops too, with its 0.52 s head and 1.6 s tail gap** (`Main.cs:962`).
- **Mix constants:**

  | Constant | Value | Where |
  |---|---|---|
  | Music | −8 dB | `SoundManager.cs:23` |
  | Duck (music under VO) | −18 dB | `:24` |
  | SFX | −4 dB | `:25` |
  | Voice | 0 dB | `:26` |
  | SFX pool | 8 | `:27` |
- **Call sites:**

  | Where | Line | Sound |
  |---|---|---|
  | TitleScreen | 47 | `ui_click` |
  | TitleScreen | 57 | `title_theme` |
  | TitleScreen | 61 | `vo_welcome` |
  | Main | 145, 946 | `gameplay_loop` |
  | Main | 815 | `month_tick`, only at ≥ 1 s/month |
  | Main | 828-862 | `notify_warning` / `cash_sale` / `notify_info` |
  | Main | 895 | `goal_achieved` |
  | Main | 962-964 | victory theme, fanfare **and** VO, all in the same frame |
  | Main | 969-971 | stop music, `defeat`, VO |
  | Manage | 501, 614 | `build_construct` |
  | Manage | 904 | `campaign_start` |
  | GuidedTutorial | 178-180 | step VO |
- **Low cash** is a fixed `< $1,000,000` (`Main.cs:840`). **Bankruptcy** is 6 consecutive negative months (`Main.cs:910`, `GameState.cs:186`).

### 1.2 Measurements

Tools: ffmpeg 7.1.1 `loudnorm` (integrated, TP), `ebur128` (momentary maximum), `astats`, `silencedetect` at −50 dB. Script: `measure.py`, output `measure.json`.

| File | Ch | Dur (s) | LUFS-I | M-max (LUFS) | True peak (dBTP) | LRA (LU) | Head/tail silence <−50 dB (s) |
|---|---|---|---|---|---|---|---|
| `music/gameplay_loop.mp3` | 2 | 120.033 | −17.4 | −14.2 | −1.3 | 2.6 | 0.00 / 2.69 |
| `music/title_theme.mp3` | 2 | 90.044 | −13.7 | −8.9 | −1.0 | 8.5 | 0.06 / 1.21 |
| `music/victory_theme.mp3` | 2 | 29.989 | −11.0 | −8.3 | −0.4 | 11.8 | **0.52** / 1.57 |
| `sfx/build_construct.mp3` | 2 | 1.515 | −10.1 | −7.5 | **+1.5** | — | 0 / 0 |
| `sfx/campaign_start.mp3` | 2 | 1.045 | −12.7 | −11.2 | −0.2 | — | 0 / 0 |
| `sfx/cash_sale.mp3` | 2 | 1.045 | −18.4 | −16.1 | −1.9 | — | 0 / 0 |
| `sfx/defeat.mp3` | 2 | 2.038 | **−39.0** | −32.8 | −22.5 | — | 0 / 0 |
| `sfx/goal_achieved.mp3` | 2 | 1.515 | −17.7 | −12.6 | −2.3 | — | 0 / 0 |
| `sfx/month_tick.mp3` | 2 | 0.522 | −25.1 | −25.1 | −8.8 | — | 0 / 0 |
| `sfx/notify_info.mp3` | 2 | 0.522 | −18.8 | −18.7 | −0.3 | — | 0 / 0 |
| `sfx/notify_warning.mp3` | 2 | 1.045 | −25.3 | −22.8 | −8.6 | — | 0 / 0 |
| `sfx/ui_click.mp3` | 2 | 0.522 | **−66.2** | −66.2 | **−54.9** | — | 0.48 / 0 |
| `sfx/upgrade.mp3` | 2 | 1.045 | −12.9 | −11.2 | −4.2 | — | 0 / 0 |
| `sfx/victory_fanfare.mp3` | 2 | 2.508 | −8.1 | −5.9 | **+0.8** | — | 0 / 1.00 |
| `vo/vo_defeat_bankrupt.mp3` | 1 | 5.982 | −24.5 | −20.5 | −3.4 | 1.9 | 0 / 0 |
| `vo/vo_defeat_timeup.mp3` | 1 | 4.075 | −25.1 | −18.4 | −2.5 | 4.4 | 0 / 0 |
| `vo/vo_tutorial_complete.mp3` | 1 | 3.239 | −24.4 | −21.5 | −5.1 | 0.6 | 0.08 / 0 |
| `vo/vo_tutorial_step1.mp3` | 1 | 6.165 | −24.3 | −17.9 | −2.5 | 4.7 | 0 / 0 |
| `vo/vo_tutorial_step2.mp3` | 1 | 5.982 | −23.6 | −16.0 | −1.7 | 4.0 | 0 / 0 |
| `vo/vo_tutorial_step3.mp3` | 1 | 5.616 | −23.4 | −17.7 | −1.4 | 4.0 | 0 / 0 |
| `vo/vo_tutorial_step4.mp3` | 1 | 4.415 | **−27.4** | −20.9 | −8.7 | 3.6 | 0.08 / 0 |
| `vo/vo_tutorial_step5.mp3` | 1 | 5.460 | −24.1 | −20.0 | −4.7 | 1.2 | 0 / 0.38 |
| `vo/vo_victory.mp3` | 1 | 3.161 | −22.6 | −16.7 | −0.7 | 1.8 | 0 / 0 |
| `vo/vo_welcome.mp3` | 1 | 4.075 | −24.3 | −20.9 | −5.2 | 1.0 | 0 / 0 |

SFX durations are whole MP3 frame counts (0.5/1.0/1.5/2.0/2.5 s requested), and all 24 files are unique (md5).

**Per-SFX spectral balance** (energy share by band; side/mid = stereo width):

| SFX | Peak dBFS | Centroid | <200 Hz | 200 Hz–2 kHz | 2–8 kHz | >8 kHz | Character |
|---|---|---|---|---|---|---|---|
| ui_click | −58.3 | 7.05 kHz | −9.9 | −10.5 | −5.6 | −2.8 | noise floor only: **broken** |
| month_tick | −9.2 | 7.57 kHz | −37.7 | −25.4 | −2.5 | −3.6 | bright tick, 0.28 s active |
| notify_info | −0.5 | 954 Hz | −9.8 | −1.1 | −29.1 | −19.1 | pluck with a transient, fine |
| notify_warning | −9.7 | **214 Hz** | −1.0 | −6.9 | −53.1 | −69.5 | low "bonk" with a 950→650 Hz blip; weak as an alert |
| cash_sale | −2.9 | 5.83 kHz | −19.9 | −8.9 | −1.3 | −9.1 | register bell (tines at 1.5/4.3/7 kHz), fine |
| campaign_start | −0.3 | 209 Hz | −2.1 | −4.2 | −35.7 | −66.6 | low whoosh-boom |
| upgrade | −5.0 | **9.31 kHz** | −30.5 | −30.3 | −7.0 | −1.0 | shimmer hiss; fatiguing top end |
| build_construct | −1.5 | 1.92 kHz | −6.5 | −4.4 | −5.2 | −16.2 | broadband swell and clang |
| goal_achieved | −2.4 | 5.63 kHz | −28.1 | −13.5 | −0.3 | −16.7 | chime, fine |
| defeat | −24.7 | **86 Hz** | −0.1 | −15.7 | −51.1 | −56.9 | sub rumble: **inaudible on small speakers** |
| victory_fanfare | −0.3 | 1.74 kHz | −28.9 | −1.3 | −6.1 | −21.5 | brass chord (partials 250/500/750/1000 Hz …), fine |

**VO** (female voice "Hope"; local Whisper `base.en` transcripts in `vo_transcripts.json`):

| Clip | Median F0 | Words | wpm (file) | Noise floor |
|---|---|---|---|---|
| welcome | 200 Hz | 12 | 178 | −58 dBFS |
| step1 | 181 | 17 | 166 | −57 |
| step2 | 193 | 19 | 192 | −60 |
| step3 | 180 | 17 | 183 | −61 |
| step4 | 206 | 16 | 220 | −61 |
| step5 | 168 | 15 | 166 | −63 |
| tutorial_complete | 188 | 11 | 206 | −59 |
| victory | 185 | 9 | 174 | −60 |
| defeat_timeup | 172 | 16 | **238** | −58 |
| defeat_bankrupt | 184 | 17 | 172 | −62 |

The clips have no head/tail padding (0–80 ms). Whisper hears "you are a **magnet**" in `vo_tutorial_complete`, while "Welcome to **Magnate**" is heard correctly.

### 1.3 Defects, most severe first

1. **`gameplay_loop` can't loop as delivered.** It plays for hours in the legacy client.
   - **Envelope (0.25 s RMS):**
     - −22 dBFS until 113.5 s, then a steady fade to −83 dBFS at 120 s.
     - The low band (40–120 Hz) collapses from −36 to −69 dB at **104.5–106 s**, so the kick and bass drop out 15 s before the end.
   - **At the wrap:** the last 200 ms are at −81.8 dBFS RMS and the first 200 ms at −16.4 dBFS. Log-spectrum cosine similarity is 0.247, and 2.69 s of the tail is under −50 dB.
   - **Players hear it** as an audible 6–8 s dip into silence followed by a hard restart, every 2 minutes.
2. **The MP3 music has no gapless metadata.** The files are an ID3v2 tag followed by raw frames: no Xing, Info or LAME tag. SFX and VO do have an Info tag (ffprobe `start_time 0.025057` = 1,105 samples).
   - Chrome's `decodeAudioData` on an MP3 without an Xing header returns **481,536 samples for a 480,000-sample source**: 1,105 leading and 431 trailing samples (§2.1).
   - The original `gameplay_loop.mp3` decodes to 5,761,567 samples at 48 kHz, with its first non-silent sample at 309.
3. **`ui_click` is silent** (peak −58.3 dBFS). Every legacy menu click plays nothing audible.
4. **`defeat` is inaudible on laptops and phones.** 99% of its energy is below 200 Hz and it sits at −39 LUFS.
5. **Loudness spread:**
   - SFX momentary maxima run from −5.9 to −66.2 LUFS.
   - Music runs from −11.0 to −17.4 LUFS-I, so the victory cue jumps +6.4 LU over gameplay and the title is +3.7 LU over gameplay.
   - VO runs from −22.6 to −27.4 LUFS-I; step4 is 4.8 LU quieter than victory.
6. **Inter-sample clipping:** `build_construct` +1.5 dBTP and `victory_fanfare` +0.8 dBTP.
7. **Victory timing:**
   - `victory_theme` starts with 0.52 s of silence.
   - The fanfare (M-max −5.9) fires in the same frame as the VO. Ducking only touches music, so the fanfare masks the first ~1.2 s of `vo_victory`.
8. **`notify_warning` is not an alert:**
   - it has nothing above 2 kHz;
   - on phone speakers it reads as a soft knock;
   - the music's 150–400 Hz pad masks it.
9. **VO pacing is brisk.** It runs at 166–238 wpm measured over the whole file; `defeat_timeup` is at 238. The target for a composed CFO is 150–165 wpm.
10. **The pronunciation of "Magnate" drifts:** "MAG-nət" vs "MAG-nayt". This needs a pronunciation-dictionary alias (§3.5).
11. **128 kbps MP3 low-pass at 16 kHz:** the spectrograms show nothing above 16 kHz. That is tolerable for this dark palette, but new masters must be lossless (48 kHz PCM or WAV).

### 1.4 Style characterisation (spectrograms: `png/spec_*.png`)

Key and tempo come from chroma (Krumhansl–Schmuckler) and onset autocorrelation (`loopcheck.py`, `findloop.py`).

| Track | Key (r) | Tempo / grid | Form | Palette |
|---|---|---|---|---|
| `title_theme` | A minor (0.90), relative of C | 120 BPM; first beat 0.060 s; loop body 136 beats | ABA. Intro 0–17.5 s of rhythmic chord stabs with bass hits. Full section 18–66 s: dense sustained harmonic stacks to 4–5 kHz, heavy low end, riser or cymbal swells every 8 bars (18, 33.5, 49.5, 66, 84 s). Outro 67–84 s returns to the intro texture. Fade 84.5–90 s. | Cinematic hybrid orchestral: strings, brass pads, big drums, "corporate epic". |
| `gameplay_loop` | F major (0.87) | 110 BPM; first beat 0.020 s; **32-bar form repeats (128-beat self-similarity)** | Pad plus a steady low pulse from 0 s. A plucked mallet or kalimba motif (450–1500 Hz, 2-bar phrases) enters at 18 s. Faint swells every ~23 s. Kick out at 104.5 s, fade from 113.5 s. | Warm, minimal electronic underscore. Energy sits at 150–400 Hz with almost nothing above 2.7 kHz. LRA 2.6 LU (very steady). |
| `victory_theme` | F major (0.88) | ~120 BPM; first beat 0.024 s | 0.52 s silence, then a tutti hit. Brass, strings and drums (crash at ~9 s) until 17 s, then a soft resolution (piano and strings), faded by 29 s. | Orchestral fanfare into a warm coda. |

**Consistency verdict:**
- **Title and victory** share one palette (orchestral hybrid, 120 BPM) and closely related keys (C/Am ↔ F).
- **Gameplay** sounds different (dark, electronic, minimal) but is **harmonically compatible** (F major).
- **House sound for new cues:** gameplay's warm pad plus mallet ostinato as the base, with title and victory strings and brass reserved for peaks and stingers. Everything stays in the **F major / D minor / G minor / C major** family, so crossfades and stingers never clash.

**SFX** have no shared palette:
- some are realistic (register bell, chime, brass chord), some abstract (shimmer, whoosh);
- UI coverage is only the broken click, with no hover, open, close, toggle or error.

### 1.5 Verdict per asset

| Asset | Verdict | Action (web build; `client/assets/audio` stays untouched for the Godot client) |
|---|---|---|
| title_theme | **KEEP + FIX** | Re-master to −20 LUFS (−6.3 dB). Play from 0 with loop points 12.5388–80.5429 s (§2.5). Optional ending: the outro from 80.54 s on the title → game transition. |
| gameplay_loop | **KEEP + FIX** | Re-master to −20 LUFS (−2.5 dB). Loop points 25.8438–95.6625 s. The intro 0–25.84 s plays once. Becomes state **STEADY**. The outro (104.5–120 s) is the "ending" used before a music rest. |
| victory_theme | **KEEP + FIX** | Trim 0.50 s from the head. Re-master (−9.0 dB). **One-shot, never looped.** |
| build_construct | KEEP + FIX | −10.5 dB to −18 LUFS-M (fixes the +1.5 dBTP). Construction started. |
| campaign_start | KEEP + FIX | −6.8 dB to −18 LUFS-M. |
| cash_sale | KEEP + FIX | −5.9 dB to −22 LUFS-M. Becomes variant **a** of `cash_register`. |
| goal_achieved | KEEP + FIX | −5.4 dB to −18 LUFS-M. |
| victory_fanfare | KEEP + FIX | −8.1 dB to −14 LUFS-M (fixes +0.8 dBTP). |
| upgrade | KEEP + FIX | −6.8 dB, plus a high shelf −4 dB at 8 kHz. |
| notify_info | KEEP + FIX | −7.3 dB to −26 LUFS-M. |
| month_tick | **RETIRE** | UX §8 removes the monthly metronome; `month_close_up/down` replace it. |
| ui_click | **REPLACE** | Procedural (§6). |
| notify_warning | **REPLACE** | Procedural two-tone (§6), same id. |
| defeat | **REPLACE** | `defeat_sting`, generated (§6/§7). |
| 10 VO lines | **KEEP (legacy only), then re-record** | Normalise for interim use (−18 LUFS). Re-record in the single §5 batch at 150–165 wpm with the pronunciation fix. |

---

## 2. Delivery formats, mastering and loudness

### 2.1 Browser decode test (measured)

**Setup:**
- Headless Chrome 154 through CDP (`codec/cdp.mjs`), `OfflineAudioContext` at 48 kHz, `decodeAudioData`.
- Source: a 10.000 s excerpt of `gameplay_loop` = **480,000 samples**.
- "Lead" is the lag of the best correlation with the PCM reference.

| Container / codec (ffmpeg 7.1.1) | Decoded length | Lead | Tail | Gapless? |
|---|---|---|---|---|
| WAV PCM | 480,000 | 0 | 0 | yes |
| FLAC | 480,000 | 0 | 0 | yes |
| **Ogg Opus** (libopus 128k) | 480,000 | 0 | 0 | **yes** |
| WebM Opus | 480,000 | 0 | 0 | yes |
| Ogg Vorbis | 480,000 | 0 | 0 | yes |
| AAC `.m4a` (`aac_at` 160k) | 480,256 | 0 | **+256** | head yes, tail padded |
| MP3 with LAME/Xing tag | 480,000 | 0 | 0 | yes |
| **MP3 without Xing** (like the ElevenLabs music) | 481,536 | **+1,105** | **+431** | no |

**Safari:**
- Ogg Opus and Ogg Vorbis playback arrived in Safari 18.4 (macOS 15.4 / iOS 18.4, 2025-03-31). WebM Opus arrived in 17.4.
- There are reports of incomplete Ogg support (for recording). Hence the runtime probe below.
- Firefox supports all of the above.

### 2.2 Format decision

| Class | Primary | Fallback | Notes |
|---|---|---|---|
| Music segments | Ogg Opus, 48 kHz stereo, **112 kbps `-vbr constrained`** | `.m4a` AAC-LC 128 kbps (`aac_at` on macOS, else `aac`) | Unconstrained VBR overshot to ~175 kbps on this dense pad content: 128k gave 2.62 MB per 120 s, while constrained 96k/112k/128k gave 1.42/1.66/1.90 MB. |
| Ambience beds | Ogg Opus 80 kbps stereo, constrained | m4a 96 kbps | 20–30 s loops |
| Positional loops | Ogg Opus 64 kbps **mono** | m4a 64 kbps | mono is required for panners |
| SFX | Ogg Opus 96 kbps (stereo only if the source is wide) | m4a 96 kbps | Head silence trimmed to ≤ 5 ms |
| VO | Ogg Opus 64 kbps mono, `-application audio` | m4a 96 kbps mono | 28–39 KB per line (measured) |
| Masters (source of truth, not shipped) | 48 kHz / 24-bit WAV + `*.gen.json` (prompt, model, seed, request id, date) | — | `audio-src/` outside `web/public` |

**Format selection at boot:**
- `decodeAudioData` a 197-byte Ogg Opus file (20 ms of silence; `ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 0.02 -c:a libopus -b:a 16k probe.ogg`, inlined as base64, 265 characters).
- If it succeeds, use `.ogg` for everything; if it throws, use `.m4a`.
- **Never** use `canPlayType`: WebKit once reported WebM Opus as playable while `decodeAudioData` failed (WebKit bug 226922, "Safari 15 breaks all Web Audio content using WebM Opus"; fixed in 2021).

**Loop safety rule:**
- Loops always use explicit `loopStart`/`loopEnd` (or segment scheduling, §4.7) **inside** the audio.
- Every file keeps ≥ 0.5 s of real audio before `loopStart` and after `loopEnd`, so AAC padding or an unknown decoder delay can't create a gap.

### 2.3 Loudness targets

All values are measured on the delivered `.ogg`; tolerance ±1 LU, CI-enforced (§4.14).

| Class | Metric | Target | True peak | Notes |
|---|---|---|---|---|
| Music cue / segment source | LUFS-I (whole cue) | **−20** | ≤ −1.5 dBTP | segments inherit the cue gain; no per-segment normalisation |
| Stinger (musical) | M-max | −14 | ≤ −1 | |
| VO (advisor, anchor) | LUFS-I | **−18** | ≤ −1.5 | chain: HPF 70 Hz → comp 2.5:1 at −24 dB → gain → 4× oversampled limiter |
| Ambience bed | LUFS-I | −26 | ≤ −6 | |
| Positional loop (pre-distance) | LUFS-I | −24 | ≤ −6 | mono |
| SFX `ui_micro` (hover, click, tick, toggle) | M-max | −30 | ≤ −12 dBFS sample peak | |
| SFX `ui_notice` (panel, notify, confirm) | M-max | −26 | ≤ −6 | |
| SFX `economy` (cash, coins, ticker, stamp) | M-max | −22 | ≤ −1.5 | |
| SFX `event` / `alert` (goal, construction, warnings) | M-max | −18 | ≤ −1.5 | |
| SFX `stinger` (fanfare, IPO bell, news sting, defeat) | M-max | −14 | ≤ −1 | |
| World one-shot (horn, beep, hiss; pre-distance) | M-max | −20 | ≤ −1.5 | |

**Resulting mix** at the UX defaults (Master 80, Music 60, SFX 80, Voice 100, Ambient 50):
- The taper is `gain = v` (linear amplitude) for v ≥ 0.1, with a quadratic tail below.
- Bus gains: master −1.9 dB, music −4.4, sfx −1.9, voice 0, ambient −6.0.

| Element | Level |
|---|---|
| VO | −19.9 LUFS |
| Music | −26.3 LUFS, falling to −36.3 while VO speaks |
| Ambience (3 layers) | ≈ −35 LUFS |
| Event SFX | −21.8 LUFS-M |
| UI clicks | −33.8 LUFS-M |
| Stingers | −17.8 LUFS-M |

**Why not a squared taper:** it would put music at −32.8 and ambience at ≈ −43 LUFS with these defaults, which is inaudible under the music.

### 2.4 Mastering chain (prototype `master.py`, verified)

```
VO     : highpass=f=70, acompressor=threshold=-24dB:ratio=2.5:attack=5:release=80:knee=4,
         volume=<−18 − measured_I>dB, aresample=192000,
         alimiter=limit=-2dB:attack=3:release=40:level=false:asc=1, aresample=48000, -ac 1
Music  : [atrim head], highpass=f=25, volume=<−20 − I>dB, aresample=192000, alimiter=…, aresample=48000
SFX    : highpass=f=30, volume=<target_Mmax − Mmax>dB, aresample=192000, alimiter=…, aresample=48000
Encode : libopus -b:a {64k|80k|96k|112k} -vbr constrained -application audio   |   aac_at -b:a {96k|128k}
```

**Prototype results** (loudness re-measured on the encoded Opus):

| Asset | Before | Gain | After |
|---|---|---|---|
| vo_welcome | −24.3 | +11.0 after compression | **−18.0 LUFS, −1.7 dBTP** |
| vo_victory | −22.6 | — | −18.0 / −1.9 |
| vo_defeat_timeup | −25.1 | — | −18.1 / −1.7 |
| vo_tutorial_step4 | −27.4 | — | −17.9 / −2.5 |
| gameplay_loop | −17.4 | −2.52 | **−20.0 LUFS, −3.8 dBTP** |
| victory_theme | −11.0 | trim 0.5 s, −8.99 | −20.0 / −8.8 |
| cash_sale | M −16.1 | −5.9 | **M −22.0** |
| victory_fanfare | M −5.9 | −8.1 | M −14.0, −6.9 dBTP |
| build_construct | M −7.5 | −10.5 | M −18.0, −7.6 dBTP |

**VO limiter load** at −18 LUFS without the compressor would be 2.2–6.1 dB of peak reduction. The 2.5:1 compressor removes most of it, which is why it comes first.

**Port to `tools/audio/`:**

| Tool | Job |
|---|---|
| `master.mjs` or `.py` | the chain above, driven by `audio-src/manifest.src.json` (class, trim, loop, fades) |
| `find-loops.py` | from `findloop.py` + `seamtest.py` |
| `segment-music.py` | cut at bar boundaries (§4.7) |
| `verify-loudness` | CI check (§4.14) |

**Tooling:**
- Use `/usr/local/bin/ffmpeg` 7.1.1. The Anaconda `ffmpeg` 4.2.2 that is first on `PATH` has no libvorbis and an old `loudnorm`.
- numpy 1.24, scipy 1.11 and soundfile are available.

### 2.5 Loop points and grid (manifest values; seconds from the first decoded sample of the current MP3)

| Cue | loopStart | loopEnd | Body | Grid | Seam QA (equal-power, baked) |
|---|---|---|---|---|---|
| `gameplay_loop` → **music.steady** | **25.8438** (44.1k sample 1,139,711) | **95.6625** (4,218,715) | 69.8187 s = 128 beats @ 110.00 BPM (error 0.5 ms) | first beat 0.020 s; beat 0.54545 s; downbeat unconfirmed (beat-position scores 1.00/0.81/0.84/0.92) | 250 ms seam. Envelope vs. a true continuation: mean \|Δ\| 0.75 dB, max 6.25 dB, r = 0.952. Onset r = 0.944 (2 s seam: 0.987). |
| `title_theme` → **music.title** | **12.5388** (552,961) | **80.5429** (3,551,942) | 68.0041 s = 136 beats @ 120 BPM (34 bars) | first beat 0.060 s | With a 250 ms seam: mean \|Δ\| 0.62 dB, r = 0.970, but onset r = **0.757**, which fails the rhythmic threshold (a drum-pattern variation). **Use a 1-bar (2.0 s) seam:** mean \|Δ\| 0.57 dB, r = 0.972, onset r = 0.941. The spectrogram shows no discontinuity. |
| `victory_theme` → **music.victory** | one-shot | — | 29.49 s after the 0.50 s trim | first beat 0.024 s (pre-trim) | — |

**Other candidates:**
- `gameplay_loop` ranks 5 alternative loops of the same length (all 69.817 s, starting at 21.13, 29.91, 16.81, 7.73 or 30.93 s), so the form really is 32 bars.
- These alternatives let the director start later loops at a different phrase for variety.

**Rules:**
- **The seam is baked into the delivered file** (`findloop.py`). Over the last *XF* seconds before `loopEnd`, the audio that precedes `loopStart` is mixed in with equal-power curves. A plain `loopStart`/`loopEnd` wrap, or the last loop segment followed by the first, is then seamless with no runtime crossfade.
- If the mastering chain trims the head, subtract the trim from every loop value.
- Recompute on the master WAV with `find-loops.py` whenever an asset is regenerated.
- **Acceptance for any new loop:** envelope correlation ≥ 0.93, onset correlation ≥ 0.85 (≥ 0.75 for non-rhythmic material), and a mean \|Δ\| ≤ 1.0 dB.

### 2.6 Download and memory budgets

**Download, Opus:**

| Group | Size | When |
|---|---|---|
| Title bundle: probe + UI procedural (0 bytes) + title theme | ≈ 1.2 MB | boot |
| Game bundle: steady cue segments ≈ 1.7 MB + 12 beds ≈ 3.3 MB + positional loops ≈ 1.2 MB + SFX ≈ 1.1 MB + VO ≈ 1.8 MB | ≈ 9 MB | lazy, after "New game" |
| New music cues | ≈ 12 MB | lazy per state |

- **Total ≈ 22 MB** Opus. Each client downloads a single format.
- Preload the next likely cue when its trigger is near: for example, `tension` when runway < 6 months.

**Decoded PCM** (Float32, 48 kHz):

| Content | Size |
|---|---|
| Stereo | 384 KB/s |
| Mono | 192 KB/s |
| A 16-bar segment at 110 BPM | 13.4 MB |
| A 20 s stereo bed | 7.7 MB |
| A 15 s mono positional loop | 2.9 MB |

| Budget (LRU by bytes) | Desktop | Mobile or `deviceMemory ≤ 4` |
|---|---|---|
| Music (2 decks × current + next segment) | 64 MB | 32 MB (8-bar segments) |
| Ambience beds (active + 30 s linger) | 48 MB | 24 MB (max 4 beds; decode via `OfflineAudioContext` at 32 kHz = −33%) |
| Positional loops | 32 MB | 16 MB (max 5 voices) |
| SFX + VO (VO released after play) | 24 MB | 12 MB |
| **Total** | **≈ 170 MB** | **≈ 85 MB** |

---

## 3. ElevenLabs capability check

### 3.1 Free read-only endpoints

**Key handling:**
- The key was read from `~/.claude/voice/key` into a shell variable and written to a mode-600 curl config inside the scratch dir.
- It was used with `curl -K`, and the config file was deleted immediately afterwards.
- It was never printed or logged, and no generation endpoint was called.

| Endpoint | HTTP | Response (`detail`) | request_id |
|---|---|---|---|
| `GET /v1/user` | 401 | `missing_permissions`: "missing the permission **user_read**" | 42554f3b86863e19646e5815cf6a5183 |
| `GET /v1/user/subscription` | 401 | missing **user_read** | b558c7809f037751f152d563923ca167 |
| `GET /v1/models` | 401 | missing **models_read** | 4f824d0539eb0534e3d02ba52d685b22 |
| `GET /v1/voices` | 401 | missing **voices_read** | d2094a343528ba1f00decb570fd4dce1 |
| `GET /v2/voices` | 401 | missing **voices_read** | 9f888ffd04fa7eacbad9a06261d566b2 |

**Not readable with this key:**
- tier, character quota and usage;
- which features the subscription includes;
- the model list;
- the voice list.

### 3.2 What can be inferred

- **It is a scoped ("restricted") API key**, used by the user's spoken-updates tool:
  - `~/.claude/voice/speak.sh` posts to `/v1/text-to-speech/{voice}` with `eleven_flash_v2_5` and `mp3_44100_128`.
  - Its `speak.log` shows only network timeouts, never a 401.
  - So it very likely has **`text_to_speech`**.
- **The first generation run in `generation_log.txt` matches this key's profile exactly:**
  - `tier: None | chars: None / None`, meaning the subscription read failed (no `user_read`);
  - music returned 401 `music_generation` and all 11 SFX returned 401 `sound_generation`;
  - all 10 VO lines succeeded.
- **The retry that succeeded** (`generation_log_retry.txt`) used a **second, user-provided key** with `music_generation` and `sound_generation` (`docs/plan/phase-3.73-status.md`). That key is not in `~/.claude/voice/key`.
- **Other keys on the machine:**
  - Two other ElevenLabs keys exist, in the Claude desktop MCP config and in the `~/.claude.json` `/Users/eddyh/ElevenLabs` project entry.
  - They were compared with the voice key **for equality only, in memory**. All three are distinct.
  - Neither was used or probed.
- **What the generation step needs:** a key with the scopes `text_to_speech`, `sound_generation`, `music_generation`, `voices_read`, `models_read`, `user_read` and `pronunciation_dictionaries_write`.
  - Either create one dedicated key, `magnate-audio-gen`, stored outside the repo (for example `~/.config/magnate/elevenlabs.key`, mode 600), and have the pipeline read it from `ELEVENLABS_API_KEY_FILE`;
  - or widen the scopes of an existing key in the ElevenLabs dashboard (Developers → API keys).
  - **Before the batch:** check the tier supports the 48 kHz PCM/WAV output formats and commercial music licensing (the pricing page says music commercial licensing is Starter+).

### 3.3 The voice "Hope"

- The existing VO voice is **"Hope" = `uYXf8XasLslADfZ2MB4u`**. Source: `~/Library/Application Support/Claude/claude_desktop_config.json` → `mcpServers.ElevenLabs.env`: `ELEVENLABS_VOICE_NAME=Hope`, `ELEVENLABS_VOICE_ID=uYXf8XasLslADfZ2MB4u`.
- The phase-3.73 status doc confirms "Voice: Hope (user's configured ElevenLabs default)".
- It could not be verified with `/v1/voices` because the key lacks `voices_read`.
  - **Verify first** with `GET /v1/voices/uYXf8XasLslADfZ2MB4u` using the generation key.
  - If Hope is a Voice Library voice that isn't in "My Voices", add it to the account first. Library voices can also be withdrawn by their owner, so save its settings and a reference clip in `audio-src/voices/hope.json`.
- Measured character: female, median F0 ≈ 185 Hz (range 168–206 across clips), clean (noise floor ≈ −60 dBFS).

### 3.4 Current API surface (docs fetched 2026-09-30)

**Text to speech: `POST /v1/text-to-speech/{voice_id}`**

| Parameter | Values |
|---|---|
| `model_id` | default `eleven_multilingual_v2` |
| `voice_settings` | `stability` (default 0.5), `similarity_boost` (0.75), `style` (0), `use_speaker_boost` (true), `speed` (1.0) |
| `seed` | 0–4,294,967,295 |
| continuity | `previous_text`, `next_text`, `previous_request_ids`, `next_request_ids` (≤ 3) |
| `pronunciation_dictionary_locators` | ≤ 3 |
| `apply_text_normalization` | `auto`, `on`, `off` |
| `output_format` | `mp3_*`, `opus_48000_{32,64,96,128,192}`, `pcm_{8000…48000}`, `wav_{8000…48000}` |
| logging | `enable_logging=false` gives zero retention |

| TTS model | Notes |
|---|---|
| **`eleven_v4`** | Released **2026-09-28**. Most expressive; 90+ languages; inline audio tags and natural-language direction; 10,000 chars per request. |
| `eleven_v4_turbo` | ~150 ms to first speech |
| `eleven_v3` | Audio tags; 5,000 chars |
| **`eleven_multilingual_v2`** | "most stable"; 10,000 chars |
| `eleven_flash_v2_5` | ~75 ms; 40,000 chars; half price |
| `eleven_turbo_v2_5` | deprecated |

**Sound effects: `POST /v1/sound-generation`**

| Field | Values |
|---|---|
| `text` | prompt |
| **`loop`** | seamless loop; `eleven_text_to_sound_v2` only |
| `duration_seconds` | 0.5–30, or auto |
| `prompt_influence` | 0–1, default 0.3 |
| `model_id` | `eleven_text_to_sound_v2` |
| `output_format` | includes `pcm_48000` and `opus_48000_*` |

**Music: `POST /v1/music`**
- Body: `prompt` **or** `composition_plan`.
- `composition_plan`:
  - `positive_global_styles[]` and `negative_global_styles[]`;
  - `sections[]`, each with `section_name`, `positive_local_styles[]`, `negative_local_styles[]`, `duration_ms` (3,000–120,000) and `lines[]` (≤ 30 lines of ≤ 200 characters).
- Other fields:

  | Field | Rule |
  |---|---|
  | `music_length_ms` | 3,000–600,000; prompt only |
  | `model_id` | `music_v1`, `music_v2` or `music_v2_5` |
  | `force_instrumental` | prompt only |
  | `respect_sections_durations` | `music_v1` only |
  | `seed` | composition plan only |
  | `store_for_inpainting` | — |
  | `sign_with_c2pa` | — |
  | `output_format` | includes `pcm_48000`, `mp3_48000_320` and `opus_48000_*` |

**API list prices** (elevenlabs.io/pricing/api, fetched 2026-09-30; re-check before a big batch):

| Item | Price |
|---|---|
| TTS, v4 | $0.08 per 1K chars (promo $0.022 until Oct 12) |
| TTS, v4 Turbo | $0.04 per 1K chars (promo $0.011) |
| TTS, v3 and Multilingual v2 | $0.08 per 1K chars |
| TTS, Flash | $0.04 per 1K chars |
| Music | $0.15 per minute |
| Sound effects | $0.12 per minute |
| Plans | Starter $6 through Business $990 a month |

### 3.5 Generation settings (for `tools/audio/generate-elevenlabs.mjs`)

**Advisor VO (Hope):**
- **Pick the model by A/B test.** Render 5 representative lines (about 300 characters, under $0.03) on `eleven_multilingual_v2` and on `eleven_v4`, then lock **one** model for the whole batch. The default is `eleven_multilingual_v2` for consistency with the legacy lines; switch to v4 if its delivery tags win.
- **Voice settings:** `stability 0.50`, `similarity_boost 0.75`, `style 0.20`, `use_speaker_boost true`, and **`speed 0.92`**. The measured pace is ~185 wpm; the target is 150–165.
- **Seed:** `crc32(lineId) + take`, 3 takes per line. Record the chosen take's seed and `request_id` in `audio-src/vo/<id>.gen.json`.
- **Text handling:**
  - `apply_text_normalization: "on"`;
  - `enable_logging: false` (optional);
  - send the `tts` override text where the script gives one (`I.P.O.`, `R and D`).
- **Pronunciation dictionary** (`POST /v1/pronunciation-dictionaries/add-from-rules`, alias rules):

  | Word | Alias |
  |---|---|
  | `Magnate` | `Mag-nate` |
  | `magnate` | `mag-nate` |
  | `CFO` | `C F O` |
  | `IPO` | `I P O` |
  | `R&D` | `R and D` |

  Attach it with `pronunciation_dictionary_locators`. Re-listen to every line containing "magnate".
- **Output:** `output_format=wav_48000`, or `pcm_48000` wrapped as s16le mono. If the tier rejects it, use `mp3_44100_192`.
- **Delivery tags (v3/v4 only):** prepend the §5 "delivery" word as a tag, for example `[warm] Welcome aboard…`. Tags are never shown in subtitles.

**News anchor:**
- **Voice:** a contrasting male broadcaster. The candidate is ElevenLabs premade **"Daniel"** (steady British broadcaster; premade id `onwK4e9ZLuTAKqWW03F9`). **Verify the id with `voices_read`.** The runtime broadcast filter is in §4.11.
  - Alternatives already used with this key by the user's speak tool (`~/.claude/voice/voices.conf`): "Bill – Wise, Mature, Balanced" (`pqHfZKP75CvOlQylNhV4`) and "Chris – Charming, Down-to-Earth" (`iP95p4xoKVk53GoZ742B`).
- **Settings:** `stability 0.65`, `similarity_boost 0.80`, `style 0.10`, `speed 1.0`.

**SFX:**
- `model_id eleven_text_to_sound_v2`.
- `prompt_influence 0.55` for one-shots, 0.40 for beds and loops.
- `duration_seconds` as listed in §6.
- **`loop: true`** for every bed and positional loop.
- `output_format=pcm_48000`. The channel count = bytes ÷ (48,000 × 2 × duration); wrap with `ffmpeg -f s16le -ar 48000 -ac N`.
- Takes: 3 per one-shot, 2 per loop.
- **Seam check** on every loop: `seamtest`-style RMS jump ≤ 1.5 dB and log-spectrum cosine ≥ 0.95. If it fails, bake a 1 s equal-power crossfade.

**Music:**
- `model_id music_v2_5` with the §7 `composition_plan`, a fixed `seed` per cue, `pcm_48000`, and 2 takes per cue.
- Run `find-loops.py` with the §2.5 acceptance criteria. If no take passes after 2 seeds, regenerate on `music_v1` with `respect_sections_durations: true`, where exact section lengths make loop points exact.

**Cost of the whole plan** at list prices:

| Batch | Volume | Cost |
|---|---|---|
| VO | 60 advisor + 13 anchor lines = 4,656 chars × 3 takes | ≈ $1.12 |
| SFX one-shots | ≈ 92 s × 3 takes | ≈ $0.55 |
| Beds + positional loops + pressure layer | ≈ 470 s × 2 | ≈ $1.88 |
| Music | 5 cues + defeat + 6 stingers ≈ 14.5 min × 2 | ≈ $4.36 |
| **Total** | | **≈ $7.90** |

---

## 4. The web audio system for the Three.js client

### 4.1 Modules and files

```
web/src/audio/
  AudioEngine.ts         context, bus graph, limiter, ducking, three.js listener routing
  lifecycle.ts           autoplay unlock, visibility, Safari 'interrupted', navigator.audioSession
  settings.ts            zustand slice (persist) + applySettings()
  manifest.ts            asset types, codec probe, URL resolution
  DecodeCache.ts         byte-budgeted LRU of AudioBuffers (one per class), in-flight de-dupe, pinning
  SegmentPlayer.ts       sample-accurate segment sequencing for one music deck
  MusicDirector.ts       state machine, transition scheduler, stingers, rests, pressure layer
  AmbienceDirector.ts    12 beds mixed from AudioFrame (zoom, focus land use, city, season, weather)
  EmitterManager.ts      positional building/vehicle emitters with virtual voices
  SfxPlayer.ts           one-shots (samples + procedural), variants, cooldowns, polyphony, batching
  synth/primitives.ts    env / tone / noise / mallet / bell / fm helpers
  synth/recipes.ts       the 38 procedural recipes of §6
  VoiceQueue.ts          VO priorities, TTL, cooldowns, token bucket, pre-emption, ducking, subtitles
  AudioEventRouter.ts    GameEventDto → SFX / VO / music actions, from data/audio-events.json
  data/manifest.json     generated by tools/audio (ids, files, loudness, loops, grid, segments)
  data/audio-events.json event → actions table (§4.12)
  data/vo-lines.json     id, text, tts, voice, priority, limits (§5)
  debug/AudioOverlay.tsx F9 overlay + /#/dev/audio sound-test page
web/public/audio/{music,stingers,layers,amb,loops,sfx,vo}/<id>[.<variant>].{ogg,m4a}
tools/audio/  generate-elevenlabs.mjs  master.(mjs|py)  find-loops.py  segment-music.py  verify-loudness.mjs  probe.ogg
audio-src/    lossless masters + *.gen.json provenance (not shipped)
```

- **Audio is presentation-only.** It never calls a mutating bridge method.
- It may use `Math.random()`: none of its randomness can reach the engine, so the determinism invariants are untouched.

### 4.2 The graph

```
 deck A ─┐                                                   (SegmentPlayer.out, equal-power crossfades)
 deck B ─┼─► musicIn ─► musicTone (LPF: pause 900 Hz / modal 3.5 kHz) ─► duck.music ─► user.music ───────┐
 stingers, pressure layer ─┘                                                                              │
 beds ×12 ─► bedGain_i ─► ambientIn ─► ambientAir (LPF by zoom) ─► duck.ambient ─┐                        │
 THREE.AudioListener.gain  (all PositionalAudio: emitters, world one-shots) ─► duck.world ─┴─► user.ambient ┤
 gameplay SFX ─► sfxIn ─► duck.sfx ─┐                                                                     │
 UI SFX (never ducked) ─► uiIn ─────┴─► user.sfx ─────────────────────────────────────────────────────────┤
 VO ─► [anchor: broadcast chain] ─► voiceIn ─► user.voice ────────────────────────────────────────────────┤
                                                                                                          ▼
                                             master (user) ─► monoFold ─► limiter ─► ctx.destination
```

| Node | Parameters |
|---|---|
| `limiter` | `DynamicsCompressorNode` threshold −3 dB, knee 0, ratio 20, attack 0.002 s, release 0.15 s. This is safety only; normal peaks are ≤ −6 dBFS. |
| `musicTone` | lowpass, Q 0.707, 20 kHz. **Paused:** 900 Hz (τ 0.1 s). **Full-screen overlay (Reports, Finance):** 3.5 kHz and −3 dB. |
| `ambientAir` | lowpass, Q 0.5, `f = 18000 · 2^(−2.8·zoom01)`: 18 kHz at street level, 2.6 kHz at the city view. |
| `duck.*` | music −10 dB (UX §8), ambient −6, world −4, sfx −3; UI never. Attack τ 0.04 s (−10 dB in ~120 ms); release τ 0.25 s, starting 0.25 s after the line ends. |
| `monoFold` | Mono setting on: `channelCount 1`, `channelCountMode 'explicit'` (downmix). Off: `2` / `'max'`. |
| Sample rate | Let the device choose (`new AudioContext({latencyHint:'interactive'})`); never force 44.1k. |

### 4.3 Engine bootstrap and the three.js integration

```ts
// web/src/audio/AudioEngine.ts
import * as THREE from 'three';

export type DuckBus = 'music' | 'ambient' | 'world' | 'sfx';
const DUCK_DB: Record<DuckBus, number> = { music: -10, ambient: -6, world: -4, sfx: -3 };
export const dbToGain = (db: number) => 10 ** (db / 20);

export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly master: GainNode; readonly monoFold: GainNode; readonly limiter: DynamicsCompressorNode;
  readonly user: { music: GainNode; sfx: GainNode; voice: GainNode; ambient: GainNode };
  readonly duck: Record<DuckBus, GainNode>;
  readonly musicIn: GainNode; readonly musicTone: BiquadFilterNode;
  readonly ambientIn: GainNode; readonly ambientAir: BiquadFilterNode;
  readonly sfxIn: GainNode; readonly uiIn: GainNode; readonly voiceIn: GainNode;
  readonly listener: THREE.AudioListener;

  constructor() {
    const c = this.ctx;
    THREE.AudioContext.setContext(c);               // must run before any THREE.Audio/AudioListener exists
    const g = (gain = 1) => new GainNode(c, { gain });
    this.limiter = new DynamicsCompressorNode(c, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.15 });
    this.master = g(); this.monoFold = g();
    this.master.connect(this.monoFold).connect(this.limiter).connect(c.destination);

    this.user = { music: g(), sfx: g(), voice: g(), ambient: g() };
    this.duck = { music: g(), ambient: g(), world: g(), sfx: g() };

    this.musicIn = g();
    this.musicTone = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.707 });
    this.musicIn.connect(this.musicTone).connect(this.duck.music).connect(this.user.music).connect(this.master);

    this.ambientIn = g();
    this.ambientAir = new BiquadFilterNode(c, { type: 'lowpass', frequency: 18000, Q: 0.5 });
    this.ambientIn.connect(this.ambientAir).connect(this.duck.ambient).connect(this.user.ambient);
    this.duck.world.connect(this.user.ambient);
    this.user.ambient.connect(this.master);

    this.sfxIn = g(); this.uiIn = g();
    this.sfxIn.connect(this.duck.sfx).connect(this.user.sfx);
    this.uiIn.connect(this.user.sfx);
    this.user.sfx.connect(this.master);

    this.voiceIn = g();
    this.voiceIn.connect(this.user.voice).connect(this.master);

    // three.js wires listener.gain straight to ctx.destination; re-route it through our buses.
    this.listener = new THREE.AudioListener();
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.duck.world);
  }

  /** Scheduled ducking: VO duration is known, so no sidechain is needed. */
  duckFor(startAt: number, durationSec: number): void {
    for (const bus of Object.keys(DUCK_DB) as DuckBus[]) {
      const p = this.duck[bus].gain;
      p.cancelScheduledValues(startAt);
      p.setValueAtTime(p.value, startAt);            // Firefox has no cancelAndHoldAtTime
      p.setTargetAtTime(dbToGain(DUCK_DB[bus]), startAt, 0.04);
      p.setTargetAtTime(1, startAt + durationSec + 0.25, 0.25);
    }
  }
  unduck(at = this.ctx.currentTime): void {
    for (const bus of Object.keys(DUCK_DB) as DuckBus[]) {
      const p = this.duck[bus].gain;
      p.cancelScheduledValues(at); p.setValueAtTime(p.value, at); p.setTargetAtTime(1, at, 0.2);
    }
  }
  setMusicTone(mode: 'normal' | 'modal' | 'paused'): void {
    const t = this.ctx.currentTime, f = { normal: 20000, modal: 3500, paused: 900 }[mode];
    this.musicTone.frequency.cancelScheduledValues(t);
    this.musicTone.frequency.setTargetAtTime(f, t, mode === 'normal' ? 0.08 : 0.1);
  }
}
```

**Listener rig:**
- `listenerRig` is an `Object3D` updated every frame before render:
  - `position = target + (camera.position − target) × 0.35`, where `target` is the orbit target on the ground;
  - `quaternion = camera.quaternion`.
- Parent the `AudioListener` to it. Its `updateMatrixWorld` pushes the position and orientation to WebAudio.
- Result: street zoom is intimate and city zoom is distant without being deaf. The beds cover the far view.

### 4.4 Settings (UX §6.18 defaults) and persistence

```ts
// web/src/audio/settings.ts
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';

export type AdvisorFrequency = 'all' | 'important' | 'off';
export interface AudioSettings {
  master: number; music: number; sfx: number; voice: number; ambient: number;   // 0–100
  muted: boolean; muteInBackground: boolean; advisor: AdvisorFrequency; subtitles: boolean;
  mono: boolean; reduceSudden: boolean; iosIgnoreSilentSwitch: boolean;
}
export const AUDIO_DEFAULTS: AudioSettings = {
  master: 80, music: 60, sfx: 80, voice: 100, ambient: 50,           // ux-playability §6.18
  muted: false, muteInBackground: true, advisor: 'important', subtitles: true,
  mono: false, reduceSudden: false, iosIgnoreSilentSwitch: false,
};
const mem = new Map<string, string>();
const safeStorage: StateStorage = {                                  // private mode / blocked storage
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
};
type Store = AudioSettings & { set: (p: Partial<AudioSettings>) => void; reset: () => void };
export const useAudioSettings = create<Store>()(persist(
  (set) => ({ ...AUDIO_DEFAULTS, set: (p) => set(p), reset: () => set(AUDIO_DEFAULTS) }),
  { name: 'magnate.audio', version: 1, storage: createJSONStorage(() => safeStorage),
    partialize: ({ set: _s, reset: _r, ...rest }) => rest,
    migrate: (old) => ({ ...AUDIO_DEFAULTS, ...(old as Partial<AudioSettings>) }) }));

/** 0–100 → gain. Linear amplitude above 10 % (defaults land on the §2.3 mix), quadratic tail to silence. */
export const sliderGain = (v: number) => { const x = Math.min(1, Math.max(0, v / 100)); return x >= 0.1 ? x : 10 * x * x; };

export function applySettings(e: AudioEngine, s: AudioSettings): void {
  const t = e.ctx.currentTime, tau = 0.05;
  e.master.gain.setTargetAtTime(s.muted ? 0 : sliderGain(s.master), t, tau);
  e.user.music.gain.setTargetAtTime(sliderGain(s.music), t, tau);
  e.user.sfx.gain.setTargetAtTime(sliderGain(s.sfx), t, tau);
  e.user.voice.gain.setTargetAtTime(sliderGain(s.voice), t, tau);
  e.user.ambient.gain.setTargetAtTime(sliderGain(s.ambient), t, tau);
  e.monoFold.channelCount = s.mono ? 1 : 2;
  e.monoFold.channelCountMode = s.mono ? 'explicit' : 'max';
}
// useAudioSettings.subscribe((s) => applySettings(engine, s));  Ctrl/⌘+M toggles `muted` (UX §6.18).
```

**How the other settings take effect:**
- `reduceSudden` is applied in `SfxPlayer`: −6 dB on the `stinger` and `alert` classes, plus a 30 ms attack ramp on stingers.
- `advisor` and `subtitles` are read by `VoiceQueue`.
- **Storage:**
  - Settings live in localStorage, per viewer; they are a convenience, not game state.
  - The "once per save" VO latches live in the bridge save (§4.11).

### 4.5 Autoplay unlock and lifecycle

```ts
// web/src/audio/lifecycle.ts
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;
export function installLifecycle(e: AudioEngine, onRunning: () => void, settings: () => AudioSettings): void {
  const ctx = e.ctx; let armed = false, suspendedByUs = false;
  const kick = () => {
    // iOS/WebKit: a buffer must *start* inside the gesture handler for the context to unlock.
    const s = new AudioBufferSourceNode(ctx, { buffer: ctx.createBuffer(1, 1, ctx.sampleRate) });
    s.connect(ctx.destination); s.start();
    void ctx.resume().then(() => { if (ctx.state === 'running') { disarm(); onRunning(); } });
  };
  const arm = () => { if (!armed) { GESTURES.forEach((g) => window.addEventListener(g, kick, { capture: true })); armed = true; } };
  const disarm = () => { GESTURES.forEach((g) => window.removeEventListener(g, kick, { capture: true })); armed = false; };
  ctx.addEventListener('statechange', () => {
    const st = ctx.state as string;                      // Safari also reports 'interrupted' (calls, Siri)
    if (st !== 'running' && !suspendedByUs && !document.hidden) arm();
  });
  document.addEventListener('visibilitychange', () => {
    if (!settings().muteInBackground) return;
    if (document.hidden) { suspendedByUs = true; void ctx.suspend(); }
    else { suspendedByUs = false; void ctx.resume().then(() => { if (ctx.state !== 'running') arm(); }); }
  });
  const nav = navigator as Navigator & { audioSession?: { type: string } };    // Safari 16.4+
  if (nav.audioSession) nav.audioSession.type = settings().iosIgnoreSilentSwitch ? 'playback' : 'auto';
  if (ctx.state === 'running') onRunning(); else arm();
}
```

**Before unlock:**

| Requester | What it keeps |
|---|---|
| MusicDirector | only the *latest* requested state; it starts on unlock |
| SfxPlayer | drops everything |
| VoiceQueue | keeps P0/P1 requests, with TTL still running |

**The title screen:**
- It shows "Click anywhere to start", and any click unlocks audio.
- If the context is still not running 3 s into gameplay, show a "🔇 Enable sound" chip in the HUD.
- `devicechange` (headphones swapped) needs no handling. WebAudio follows the default output.

### 4.6 Manifest, codec probe and decode cache

```ts
// web/src/audio/manifest.ts
export type AssetKind = 'music' | 'stinger' | 'layer' | 'bed' | 'loop3d' | 'sfx' | 'vo';
export type SfxClass = 'ui_micro' | 'ui_notice' | 'economy' | 'event' | 'alert' | 'stinger' | 'world';
export interface FileRef { ogg: string; m4a: string; lengthSamples: number }            // 48 kHz timeline
export interface MusicSegment extends FileRef { startSec: number; bars: number; tailSec: number }
export interface AudioAsset {
  id: string; kind: AssetKind; class?: SfxClass; channels: 1 | 2;
  files?: FileRef[];                                   // variants (shuffle-bag)
  segments?: MusicSegment[];                           // music cues (§4.7)
  loop?: { fromSegment: number; toSegment: number } | { startSec: number; endSec: number };
  grid?: { bpm: number; beatsPerBar: number; firstBeatSec: number; key: string };
  lufs?: number; mMax?: number; truePeak: number; gainDb?: number;       // measured on the .ogg
  pitchCents?: number; cooldownMs?: number; maxVoices?: number; priority?: number;
  text?: string; tts?: string; voice?: 'advisor' | 'anchor';            // VO
  preload?: 'boot' | 'title' | 'game' | 'lazy';
}
const PROBE_OGG = 'data:audio/ogg;base64,' + /* 265 chars: base64 of tools/audio/probe.ogg (§2.2) */ '';
export async function pickFormat(ctx: BaseAudioContext): Promise<'ogg' | 'm4a'> {
  try { await ctx.decodeAudioData(await (await fetch(PROBE_OGG)).arrayBuffer()); return 'ogg'; }
  catch { return 'm4a'; }
}
```

```ts
// web/src/audio/DecodeCache.ts: one instance per class, budgets from §2.6
export class DecodeCache {
  private map = new Map<string, { buf: AudioBuffer; bytes: number; pins: number }>();   // Map order = LRU
  private inflight = new Map<string, Promise<AudioBuffer>>();
  private used = 0;
  constructor(private budget: number, private fmt: 'ogg' | 'm4a', private decodeCtx: BaseAudioContext) {}
  async get(ref: FileRef): Promise<AudioBuffer> {
    const url = ref[this.fmt]; const hit = this.map.get(url);
    if (hit) { this.map.delete(url); this.map.set(url, hit); return hit.buf; }
    let p = this.inflight.get(url);
    if (!p) { p = fetch(url).then((r) => r.arrayBuffer()).then((a) => this.decodeCtx.decodeAudioData(a)); this.inflight.set(url, p); }
    const buf = await p; this.inflight.delete(url);
    if (!this.map.has(url)) { const bytes = buf.length * buf.numberOfChannels * 4; this.map.set(url, { buf, bytes, pins: 0 }); this.used += bytes; this.evict(); }
    return buf;
  }
  pin(url: string, d: 1 | -1) { const e = this.map.get(url); if (e) e.pins += d; }
  private evict() { for (const [k, v] of this.map) { if (this.used <= this.budget) break; if (v.pins > 0) continue; this.map.delete(k); this.used -= v.bytes; } }
}
```

**Memory trick:**
- Decode **beds** through `new OfflineAudioContext(2, 1, 32000)` to get 32 kHz buffers; they still play in the 48 kHz context, because the source resamples.
- This saves 33% of bed memory. The beds are low-passed by distance anyway.
- Music, VO and SFX decode at the context rate.

### 4.7 Music director

#### 4.7.1 Cues and playlists

| State | Playlist (rotated round-robin) | Tempo / key | Loop body | Source |
|---|---|---|---|---|
| `title` | `music.title` (plays from 0; loop 12.54 → 80.54 s) | 120, A minor | 68.0 s | existing (re-mastered) |
| `calm` | `music.calm_a` "Groundwork", `music.calm_b` "Ledger Lines" | 92 F major; 100 D minor → F | 125 s; 134 s | **new** (§7) |
| `steady` | `music.steady` (= `gameplay_loop`, intro once then 25.84 → 95.66 s), `music.calm_b` | 110, F major | 69.8 s | existing + new |
| `growth` | `music.growth` "Expansion" | 120, F major | 112 s | **new** |
| `tension` | `music.tension` "Red Ink" | 104, D minor | 73.8 s | **new** |
| `recession` | `music.recession` "Bear Market" | 76, G minor | 113.7 s | **new** |
| `victory` | `stinger` `victory_fanfare` → `music.victory` one-shot → 4 s silence → `music.title` from loopStart at −6 dB | 120, F major | — | existing |
| `defeat` | `defeat_sting` → `music.defeat` "Closing Bell" one-shot → rest (ambience −6 dB, city lights dim, UX §8 #38) | 70, D minor | — | **new** |
| modifier `rest` | silence for 45–90 s (uniform), ambience only | — | — | — |
| modifier `paused` | `musicTone` → 900 Hz; the ambience keeps playing | — | — | — |
| layer `pressure` | `layer.pressure` "Undertow": D-pedal low-string tremolo, free time, 30 s `loop:true` | key-neutral in F/Dm/Gm | 30 s | **new** |

**Coverage:**
- **"≥ 3 calm operations loops ≥ 3 min, rotated" (UX §8)** is met by `calm_a` (3:08), `calm_b` (3:12) and `steady`, plus rests.

#### 4.7.2 Inputs (from `snapshot`/`hud`, `monthSummaries` and `events`; re-evaluated at every month close, and every 5 s for live signals)

| Input | Definition |
|---|---|
| `runway` | bridge `cashRunwayMonths` = cash / −opCF3 when the 3-month average operating cash flow is < 0, else `null` (bridge-spec §4.6.9) |
| `cash`, `insolvencyMonthsLeft` | HUD insolvency countdown (UX §6.16), whatever the rule: 6 negative month-ends today, or 3 months of unpaid interest per caplab-brief |
| `climate` | EXT `macro`: `panic`, `recession`, `normal`, `prosperous` or `boom` (caplab-brief §macro); absent = `normal` |
| `revQoQ` | revenue of the last 3 closed months ÷ the previous 3, minus 1 |
| `underConstruction` | player buildings with status `underConstruction` |
| `buildings` | player building count |
| `events2m` | player-relevant `GameEventDto`s in the last 120 s of real time |
| `speed` | 0, 1, 2, 4 or 8 |
| `monthsElapsed` | months since the game started |
| `drawdown` | 1 − price ÷ max(price over 3 months), when listed |
| `warningActive` | any alert of Warning severity or worse is open (UX §6.21) |

```
intensity = clamp01( 0.30·min(underConstruction/3, 1) + 0.25·clamp01(revQoQ/0.25)
                   + 0.20·min(events2m/6, 1)          + 0.15·min(buildings/20, 1) + 0.10·[speed ≥ 4] )
```

#### 4.7.3 Desired-state rules (first match wins; hysteresis in brackets)

1. **Outcome** `won` → `victory`; `lost` → `defeat`. Terminal and immediate.
2. **`tension`** if any of these holds:
   - `cash < 0`;
   - `runway < 3`;
   - `insolvencyMonthsLeft ≤ 3`;
   - `climate = panic`;
   - `drawdown ≥ 0.40`.

   Exit only when all of these hold: 2 consecutive month closes with `cash ≥ 0`, `runway = null or > 6`, and `climate ≠ panic`; and at least 30 s real time in `tension`.
3. **`recession`** if `climate = recession`. Exit at the first close with `climate ∉ {recession, panic}`.
4. **`growth`** if `intensity ≥ 0.60`, or `climate = boom` and `intensity ≥ 0.45`. Exit to `steady` below 0.40, or below 0.30 during a boom.
5. **`calm`** if `monthsElapsed < 6` and `buildings < 4`, or `intensity < 0.20`.
6. Otherwise **`steady`**.
7. **Dwell and pressure layer:**
   - Changes among `calm`, `steady` and `growth` need ≥ 60 s real time in the current state.
   - The pressure layer fades in (4 s, to −8 dB relative to the cue) while `warningActive` is true in calm, steady, growth or recession, and fades out over 6 s.

#### 4.7.4 Transitions (equal-power `setValueCurveAtTime`, 64 points)

| From → To | Quantize | Crossfade | Stinger (next beat) |
|---|---|---|---|
| `title` → any game state | immediate (Start pressed) | 2.5 s | — |
| between `calm`, `steady` and `growth` | next beat ≥ 0.5 s ahead (next bar if the downbeat is known) | 4 s | — |
| any → `tension` | next beat | 1.5 s | `stinger.tension` (D minor low brass + timpani) |
| `tension` → calmer | next bar | 3 s | `stinger.recovery` (F major lift) |
| any → `recession` | next bar | 6 s | none (the anchor line `news.recession` carries it) |
| `recession` → `steady` or `growth` | next bar | 5 s | `stinger.recovery` |
| any → `victory` | immediate | outgoing fades over 0.8 s | `victory_fanfare`; the cue starts +0.4 s later; VO at +1.6 s |
| any → `defeat` | immediate | outgoing fades over 1.5 s | `defeat_sting`; `music.defeat` at +1.0 s; VO at +1.8 s |
| any → `rest` | play the cue's tail segment, or fade over 6 s | — | — |

**Event stingers** (music bus, next beat, at most 1 per 20 s; they duck the running deck −6 dB while playing):

| Stinger | Trigger |
|---|---|
| `stinger.triumph` | goal achieved, record month, market leader gained (UX "triumph sting") |
| `stinger.crash` | `news.market_crash` |
| `stinger.boom` | climate → boom |
| `stinger.ipo` | with `ipo_bell` |

**Anti-fatigue:**
- In calm, steady, growth and recession: after a cue plays **2 full loop bodies or 6 minutes**, whichever comes first, play its tail or fade out, then `rest` for 45–90 s, then the next cue in the state's playlist.
- The tension state has no rests.
- A rest is cut short by entering tension, victory or defeat, or by entering growth.

#### 4.7.5 Segment scheduling (sample-accurate, memory-bounded)

**Build time** (`segment-music.py`):
- Cut every cue master at **8-bar** boundaries (16 bars on desktop is also fine), using the detected grid.
- Each segment file carries a **100 ms tail** of the audio that follows it.
- The manifest stores `startSec`, `bars`, `lengthSamples` (without the tail), `loop.fromSegment` and `loop.toSegment`.
- Loop boundaries come from `find-loops.py` and are snapped to segment edges by choosing the segment grid phase so `loopStart` falls on a cut.

**Run time:**
- Each deck keeps ≥ 2.5 s scheduled ahead and pins its current and next segment in the music `DecodeCache`.
- Joins use a 10 ms **linear (equal-gain)** overlap into the tail. Both sides carry identical audio there, so equal-gain keeps the level constant.
- The overlap hides per-segment resampler edges on 44.1 kHz devices and the 256-sample AAC padding.
- **The segment that ends at `loopEnd` must take its 100 ms tail from `[loopStart, loopStart + 100 ms]`**, the audio that actually follows the wrap, not from the audio after `loopEnd`. `segment-music.py` does this.

```ts
// web/src/audio/SegmentPlayer.ts (core loop)
export class SegmentPlayer {
  readonly out: GainNode; private i = 0; private at = 0; private timer = 0;
  private started: { t0: number; seg: MusicSegment }[] = [];
  constructor(private e: AudioEngine, private cache: DecodeCache, private cue: AudioAsset) {
    this.out = new GainNode(e.ctx, { gain: 0 }); this.out.connect(e.musicIn);
  }
  start(when: number, fromSegment = 0) { this.i = fromSegment; this.at = when; this.timer = window.setInterval(() => void this.pump(), 250); void this.pump(); }
  private async pump() {
    const ctx = this.e.ctx, segs = this.cue.segments!, J = 0.010;
    while (this.at - ctx.currentTime < 2.5) {
      const seg = segs[this.i], buf = await this.cache.get(seg);
      const t0 = Math.max(this.at, ctx.currentTime + 0.02), len = seg.lengthSamples / 48000;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf }), g = new GainNode(ctx, { gain: 0 });
      src.connect(g).connect(this.out);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + J);            // join in
      g.gain.setValueAtTime(1, t0 + len); g.gain.linearRampToValueAtTime(0, t0 + len + J); // join out (into tail)
      src.start(t0); src.stop(t0 + len + J + 0.005);
      this.started.push({ t0, seg }); this.at = t0 + len;
      const L = this.cue.loop as { fromSegment: number; toSegment: number };
      this.i = this.i >= L.toSegment ? L.fromSegment : this.i + 1;
    }
    this.started = this.started.filter((s) => s.t0 + s.seg.lengthSamples / 48000 > ctx.currentTime - 1);
  }
  /** Context time of the next beat ≥ minAhead from now (bar if beatsPerBar and a known downbeat). */
  nextBeat(minAhead = 0.1, unit: 'beat' | 'bar' = 'beat'): number {
    const now = this.e.ctx.currentTime + minAhead, gr = this.cue.grid!;
    const cur = [...this.started].reverse().find((s) => s.t0 <= now) ?? this.started[0];
    const pos = cur.seg.startSec + (now - cur.t0), step = (60 / gr.bpm) * (unit === 'bar' ? gr.beatsPerBar : 1);
    const b = gr.firstBeatSec + Math.ceil((pos - gr.firstBeatSec) / step) * step;
    return now + (b - pos);        // may fall in the next segment: harmless, the timeline is continuous
  }
  fadeTo(target: number, at: number, dur: number) {
    const p = this.out.gain, n = 64, c = new Float32Array(n), from = target > 0.5 ? 0 : 1;
    for (let k = 0; k < n; k++) { const x = k / (n - 1); c[k] = from === 0 ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2); }
    p.cancelScheduledValues(at); p.setValueCurveAtTime(c, at, dur);
  }
  stop(at: number) { window.clearInterval(this.timer); /* stop live sources at `at`, unpin segments */ }
}
```

**v1 shortcut for the single-file cues** (`title`, `steady`):
- Use one decoded buffer with `AudioBufferSourceNode.loop = true`, `loopStart` and `loopEnd` from §2.5, and `start(when, 0)`, so the intro plays once and the body loops.
- **Cost:** the steady cue is 26.9 MB decoded at 48 kHz.
- **Keep ≥ 0.5 s of audio after `loopEnd` in the file.**

### 4.8 Ambience director

The renderer produces an `AudioFrame` 10 times a second. The director converts it to target gains and applies them with `setTargetAtTime(target, now, 0.8)`.
- Each bed is a looping source that starts at a random offset.
- A bed whose target stays below −60 dB for 5 s is stopped, then restarted on demand.

```ts
export interface AudioFrame {
  zoom01: number;                 // 0 = Street band … 1 = City band (UX §6.5 zoom bands), from camera distance
  focus: { x: number; z: number }; cityId: string; coastal: boolean; distToWaterPlots: number;
  timeOfDay: number | null;       // hours from the renderer's sun; null = fixed daylight (see note)
  month: number;                  // 0–11 from the game date (season)
  rain: number; wind: number;     // 0–1 cosmetic weather (0 if the renderer has none)
  area: { road: number; traffic: number; green: number; industrial: number; commercial: number;
          residential: number; construction: number; water: number };   // 0–1 within radius R of focus
}
```

**Focus-area statistics:**
- `R = max(6 plots, 0.8 × camera height in plots)`.
- At city load, build one **summed-area table** per land-use category over the plot grid, from `cityLayout` and `cityView`. Each square-window query is then O(1).
- `traffic = road × vehicleDensity`, where `vehicleDensity ∝ population^0.5`, the same as the renderer's agents (UX §6.5).

**Time of day:**
- UX §6.5 rules out a day/night cycle at 0.4 s per visual day.
- So `timeOfDay` must come from the **lighting state** (a fixed preset, or a slow cosmetic cycle of ≥ 8 minutes), never from the day clock.
- With `null`, `day = 1`.

**Curves:**

```
day(t)   = t == null ? 1 : smoothstep(5, 7, t) − smoothstep(19, 21, t);        night = 1 − day
dawn(t)  = t == null ? 1 : 0.4 + 0.6·max(gauss(t, 6.5, 1.2), 0.6·gauss(t, 18.5, 1.0))
birdsSeason   [Jan..Dec] = .30 .35 .60 .90 1 1 .90 .80 .60 .45 .35 .30
insectsSeason [Jan..Dec] = 0  0  .10 .30 .60 .90 1 1 .70 .30 .05 0
windSeason    [Jan..Dec] = 1 .90 .80 .60 .50 .40 .40 .45 .60 .80 .90 1
z = zoom01;  C = city preset (below)
```

| Bed (`amb_*`, −26 LUFS files) | Linear gain |
|---|---|
| `city_day` | (0.35 + 0.65·z) · day · C.bed |
| `city_night` | (0.35 + 0.65·z) · night · C.bed |
| `traffic_street` | (1 − z)^1.5 · area.traffic · (0.3 + 0.7·day) · C.traffic |
| `crowd` | (1 − z)^1.5 · area.commercial · day · C.crowd |
| `birds` | (1 − z)² · max(area.green, 0.15) · birdsSeason[m] · dawn(t) · (1 − rain) |
| `insects_night` | (1 − z) · area.green · insectsSeason[m] · night · (1 − rain) |
| `wind_high` | smoothstep(0.45, 1, z) · (0.4 + 0.6·max(wind, 0.6·windSeason[m])) · C.wind |
| `rain_light` | smoothstep(0.05, 0.4, rain) · (1 − smoothstep(0.6, 0.9, rain)) |
| `rain_heavy` | smoothstep(0.5, 0.9, rain) |
| `harbour` | coastal · (1 − smoothstep(0, 30, distToWaterPlots)) · (1 − 0.5·z) · C.harbour |
| `river` | area.water · (1 − z) · C.river |
| `industrial` | min(1, 2·area.industrial) · (1 − 0.6·z) · C.industrial |

**Zoom whoosh (optional):** add `0.3·min(1, |d(zoom01)/dt| / 0.8)` to `wind_high` while the camera zooms.

**City presets `C`** (content geography):

| City | Geography | bed | traffic | crowd | harbour | river | industrial | wind | One-shot rate multipliers |
|---|---|---|---|---|---|---|---|---|---|
| metropolis | coastal, 500k | 1.0 | 1.0 | 1.0 | 0.8 | 0 | 0.6 | 0.6 | siren ×1.5 |
| portbay | coastal, oil, 150k | 0.7 | 0.6 | 0.5 | 1.0 | 0 | 0.9 | 0.8 | ship_horn ×2 |
| riverside | mineral, 250k | 0.8 | 0.7 | 0.7 | 0 | 0.7 | 0.8 | 0.6 | — |
| eastside | arable, 200k | 0.8 | 0.6 | 0.6 | 0 | 0 | 0.4 | 0.6 | — |
| hilltown | arable, hills, 100k | 0.5 | 0.4 | 0.4 | 0 | 0 | 0.3 | 1.0 | birds ×1.2 |

**Random world one-shots:**
- A Poisson process, evaluated every 100 ms: fire when `Math.random() < 1 − exp(−λ/600)` and the minimum gap has passed.
- Rates halve at 4× and 8×.
- Positional ones use a pooled `PositionalAudio` (pool of 6).

| Sound | λ per minute | Min gap | Where |
|---|---|---|---|
| `car_horn` (3 variants) | 1.5 · area.traffic · (1 − z)² · (0.2 + 0.8·day) | 5 s | a random road plot within R |
| `truck_reverse` | 0.6 · min(1, (warehouses + factories in R) / 3) · day | 20 s | loading side of one of them |
| `forklift_beep` | 0.8 · min(1, warehouses in R / 2) | 12 s | a warehouse |
| `factory_hiss` (2) | 0.5 per operating factory in R, max 2/min in total | 8 s | that factory |
| `crane_winch` | 0.7 per construction site in R | 15 s | that site |
| `ship_horn` (2) | 0.25 · coastal · (1 − 0.5·z) · multiplier | 45 s | seaport or shoreline |
| `siren_distant` | (0.08 + 0.12·night) · multiplier | 90 s | non-positional, pan ±0.6 |
| `thunder` (2) | 0.6 · smoothstep(0.7, 1, rain) | 20 s | non-positional |

### 4.9 Positional building and vehicle emitters (`EmitterManager`)

**Source data:**
- The `cityView` buildings: `status`, `category`, footprint and placement.
- `activity`: `utilization`, `unitsSold`, `transfersIn` and `transfersOut` (bridge-spec §5.5).
- Every building emits, rivals included, so the city sounds alive. The player's buildings get +2 dB.

| Category (content) | Loop | Activity `a` ∈ [0, 1] | Day / night |
|---|---|---|---|
| factory (small, large) | `loop_factory` | operating: 0.25 + 0.75·(utilization ?? 0.6); idle 0.10; starved 0.30 (and the `factory_hiss` rate ×2) | ×1 / ×1 |
| mine (iron_mine) | `loop_mine` | as factory | ×1 / ×0.8 |
| oil_well | `loop_pumpjack` | operating 1.0; idle 0 (pumpjack stops) | ×1 / ×1 |
| farm, plantation | `loop_farm` | 0.3 + 0.7·(utilization ?? 0.6) | ×1 / ×0.2 |
| warehouse (small, large) | `loop_warehouse` | clamp01(log10(1 + transfersIn + transfersOut) / 6) | ×1 / ×0.4 |
| seaport | `loop_seaport` | 0.4 + 0.6·clamp01(log10(1 + transfersIn + transfersOut) / 6) | ×1 / ×0.7 |
| retail (convenience, supermarket, department) | `loop_retail` | clamp01(log10(1 + unitsSold) / 6.5); soldOut ×0.5; idle 0.1 | ×1 / ×0.15 |
| rd_center | `loop_lab` | 0.6 with R&D slots, else 0.2 | ×1 / ×1 |
| newspaper, magazine | `loop_press` | 0.7 (passive) | ×1 / ×1 |
| tv, radio | `loop_broadcast` | 0.5 (passive) | ×1 / ×1 |
| any `underConstruction` | `construct_loop.{hammer, mixer, crane}` (hash(id) mod 3) | 1.0 | ×1 / ×0.2 |
| delivery trucks (renderer agents on `supplyFlows` routes) | `truck_engine_loop` | 1.0, `playbackRate` 0.9–1.1 per truck | 3 nearest within 25 plots |

**Panner settings:**
- `THREE.PositionalAudio` with `panner.panningModel = 'equalpower'` (HRTF is reserved for ≤ 2 hero sounds).
- `setDistanceModel('inverse')`, `setRefDistance(1.2 × max(footprintW, footprintH) × PLOT_SIZE)` (`PLOT_SIZE` = 12 m, §4.15), `setRolloffFactor(1.3)`.
- `maxDistance` only matters for the linear model. Culling is done by the virtual-voice selection below.

**Virtual voices:**
- Every 250 ms, score each emitter: `s = a · base · ref / (ref + 1.3 · max(0, d − ref))`, where `d` is the distance to the listener rig.
- The **top N get real voices**: N = 8 on desktop, 5 on mobile.
- A newcomer replaces the weakest active voice only if `s > 1.25 × s_weakest`.
- Assignment fades out (0.4 s), then `stop`, `setBuffer`, move and `play()` at a random `offset`, then fades in (0.4 s).
- The random offsets stop identical loops from phase-locking.
- **Cost:** 8 sources plus 8 equal-power panners is negligible.

### 4.10 SFX player

**API:** `play(id, { at?: Vector3, delay?: number, detuneCents?: number, level?: number })`.
- Procedural ids resolve to `synth/recipes.ts`; the others are sample assets.
- **Variants:**
  - Chosen from a shuffle bag, so the same variant never plays twice in a row.
  - Random detune is **±30 cents** for non-musical sounds and **0** for musical ones (chimes, mallets, month close, stingers).
- **Polyphony:**

  | Class | Max per id |
  |---|---|
  | default | 3 |
  | UI | 2 |
  | world one-shots | 2 |
  | stingers | 1 |

  The **global cap is 24 voices**. Beyond it, steal the lowest-priority voice, then the oldest.
- **Cooldowns:**

  | Sound | Cooldown |
  |---|---|
  | `ui_hover` | 50 ms |
  | `ui_click` | 30 ms |
  | `slider_tick` | 35 ms |
  | `cash_register` | 250 ms |
  | `coins_small` / `coins_large` | 200 ms |
  | `notify_*` | 1.5 s |
  | `alert_critical` | 3 s |
  | stingers | 20 s (owned by the director) |
- **Month close** (UX §6.4 close sequence, step 7):
  - `month_close_up` when NI > 0, detuned **+100 cents × min(5, consecutive profitable months − 1)** (UX §8 #5).
  - `month_close_down` when NI < 0.
  - At 8×, only every other close sounds.
  - At 4× and 8×, a close plays at most: one month-close sound plus the two highest-severity alert sounds. World popups make no sound.
- **Positional one-shots:** passing `at` uses the pooled `PositionalAudio`. Without it, the sound goes to `sfxIn`; UI ids go to `uiIn`.

### 4.11 Voice queue (advisor and anchor)

| Rule | Value |
|---|---|
| Channel | one line at a time; advisor and anchor share it |
| Priorities | **P0** critical: insolvency, cash < 0, loan default, scenario end. **P1** important: goals, rival entered, credit downgrade, recession, IPO, bad quarter, tutorial (`P1·T`). **P2** informative: construction, first sale, patents, milestones, good news. **P3** hints and flavour. |
| Advisor frequency (UX §6.18) | `off`: no audio (subtitle toasts still appear). `important` (default): P0, P1 and tutorial. `all`: P0–P3. |
| Per month close | **≤ 1 line** (UX §6.21), ranked P0 > goal > rival > opportunity. A second P0 line is allowed only for scenario end. |
| TTL (dropped if not started) | P0 30 s · P1 20 s · P2 12 s · P3 6 s |
| Minimum silence since the last line | P0 0 s · P1 3 s · P2 8 s · P3 20 s |
| Token bucket | capacity 6, refill 1 token per 20 s; cost P0 0 · P1 1 · P2 2 · P3 3 |
| Queue | max 4; overflow drops the lowest priority, newest first |
| Pre-emption | P0 interrupts a playing P2 or P3 line (150 ms fade). P1 interrupts P3 only. |
| Speed gating | at 4× and 8×, P0–P1 only; P2 and P3 become subtitle toasts |
| Hints (P3) | only after ≥ 60 s with no player command, no VO in the last 90 s and no modal open; ≤ 1 hint per 3 min; per-hint cooldown 12 game-months |
| Chains | atomic sequences priced at their highest priority, for example `news_sting` → `news.recession` → 0.6 s → `adv.macro.recession` |
| Ducking | `engine.duckFor(start, duration)`; the line starts **120 ms after** the duck begins |
| Latches | "once per game" and "once per step per save" come from the bridge's persisted `EventDetector` latches (bridge-spec §4.2 `_events`; UX §6.17). The queue only keeps real-time cooldowns. Game-month cooldowns read the game clock from `monthSummaries`. |
| Subtitles | advisor toast with the portrait; text from `vo-lines.json`; shown for max(duration + 1 s, 3 s) |

```ts
// web/src/audio/VoiceQueue.ts (core)
type P = 0 | 1 | 2 | 3;
interface Req { ids: string[]; p: P; at: number; key: string; fromClose: boolean }  // ids: chain (anchor → advisor)
const TTL = [30_000, 20_000, 12_000, 6_000], GAP = [0, 3_000, 8_000, 20_000], COST = [0, 1, 2, 3];
export class VoiceQueue {
  private q: Req[] = []; private playing: { r: Req; src: AudioBufferSourceNode } | null = null;
  private lastEnd = -1e9; private tokens = 6; private refillAt = performance.now();
  private lastById = new Map<string, number>(); private closeBudget = 1;
  constructor(private deps: { engine: AudioEngine; load: (id: string) => Promise<AudioBuffer>;
    settings: () => AudioSettings; speed: () => number; subtitle: (id: string, sec: number) => void; toast: (id: string) => void }) {}
  onMonthClose() { this.closeBudget = 1; }
  request(ids: string[], p: P, cooldownMs = 10 * 60_000, fromClose = false): void {
    const now = performance.now(), s = this.deps.settings(), key = ids.join('>');
    const allowed = s.advisor === 'all' || (s.advisor === 'important' && p <= 1);
    if (!allowed || (this.deps.speed() >= 4 && p >= 2)) return this.deps.toast(ids[ids.length - 1]);
    if (now - (this.lastById.get(key) ?? -1e12) < cooldownMs) return;
    if (this.playing && p === 0 && this.playing.r.p >= 2) this.interrupt();
    if (this.playing && p === 1 && this.playing.r.p === 3) this.interrupt();
    this.q.push({ ids, p, at: now, key, fromClose });
    this.q.sort((a, b) => a.p - b.p || a.at - b.at); if (this.q.length > 4) this.q.length = 4;
    void this.pump();
  }
  private async pump(): Promise<void> {
    if (this.playing) return;
    const now = performance.now();
    this.tokens = Math.min(6, this.tokens + (now - this.refillAt) / 20_000); this.refillAt = now;
    this.q = this.q.filter((r) => now - r.at < TTL[r.p]);
    const r = this.q.find((x) => now - this.lastEnd >= GAP[x.p] && this.tokens >= COST[x.p] && (x.p === 0 || !x.fromClose || this.closeBudget > 0));   // budget = lines raised by the month close
    if (!r) { if (this.q.length) setTimeout(() => void this.pump(), 500); return; }
    this.q.splice(this.q.indexOf(r), 1); this.tokens -= COST[r.p]; if (r.fromClose && r.p > 0) this.closeBudget--;
    this.lastById.set(r.key, now);
    const e = this.deps.engine, ctx = e.ctx; let t = ctx.currentTime + 0.12;
    const bufs = await Promise.all(r.ids.map(this.deps.load));
    const total = bufs.reduce((s, b) => s + b.duration, 0) + 0.6 * (bufs.length - 1);
    e.duckFor(ctx.currentTime, total + 0.12);
    let last: AudioBufferSourceNode | null = null;
    bufs.forEach((b, k) => { const src = new AudioBufferSourceNode(ctx, { buffer: b });
      src.connect(r.ids[k].startsWith('news.') ? broadcastChain(e) : e.voiceIn); src.start(t);
      this.deps.subtitle(r.ids[k], b.duration); t += b.duration + 0.6; last = src; });
    this.playing = { r, src: last! };
    last!.onended = () => { this.playing = null; this.lastEnd = performance.now(); void this.pump(); };
  }
  private interrupt() { /* 150 ms fade on the voice source, stop, unduck, clear playing */ }
}
```

**Anchor "broadcast" chain:**
- `highpass 160 Hz (Q 0.7)` → `peaking 3 kHz +3 dB (Q 1)` → `lowpass 7.5 kHz (Q 0.7)` → `DynamicsCompressor(−24 dB, 3:1, 5 ms / 100 ms)` → `+2 dB` → `voiceIn`.
- It is always preceded by `news_sting`, with the line starting 0.3 s before the sting ends.

### 4.12 Event routing (`data/audio-events.json`)

**Event naming:**
- Kinds follow the bridge's camelCase `GameEventKind` style. Bridge-spec §5.4 already names `goalAchieved`, `scenarioWon`, `scenarioLost`, `cashNegative`, `rivalEnteredMarket` and `news`.
- Kinds marked **\*** are proposed here and must be reconciled with bridge-spec §7 when it is written.
- The finance, stock and macro kinds depend on the EXT features (bridge-spec §8).

| Event kind | Condition | SFX | VO | Music |
|---|---|---|---|---|
| `gameStarted`* | new or loaded game | `confirm` | `adv.onboard.welcome` (new only) | title → evaluate |
| `speedChanged`* (client) | 0/1/2/4/8 | `pause` / `speed_up` / `speed_down` | — | pause → `setMusicTone('paused')` |
| month close (`monthSummaries`) | NI sign | `month_close_up` / `month_close_down` | — | re-evaluate |
| `quarterClosed`* | §5 rules | `quarter_close` | `adv.quarter.*` | re-evaluate |
| `constructionStarted`* | player | `build_construct` (at site) | `adv.build.started` / `started_tight` | intensity input |
| `constructionCompleted`* | player | `ribbon_cut` (at site) | `adv.build.complete` / `factory_complete` | — |
| `buildingUpgraded`* | | `upgrade` | (UX `vo_upgrade_first`) | — |
| `buildingDemolished`* | | `demolish` | — | — |
| `firstSale`* | | `cash_register` + `coins_small` | `adv.sales.first` | — |
| `recordMonth`* | NI > max × 1.10 and ≥ $100K | `coins_large` | `adv.sales.record_month` | `stinger.triumph` |
| `stockOut`* / `overstock`* | UX §6.15 thresholds | `stockout` / `notify_warning` | `adv.ops.*` | warningActive |
| `lowRunway` (bridge advisor hint code; as an event kind: \*) | runway < 3 | `heartbeat_soft` ×3 | `adv.cash.runway_low` | → tension |
| `cashNegative` | month-end cash < 0 | `alert_critical` | `adv.cash.negative` | → tension |
| `cashRecovered`* | | `rating_up` | `adv.cash.recovered` | tension exit check |
| `insolvencyWarning`* | monthsLeft ≤ 3, = 1 | `alert_critical` | `adv.bankruptcy.warning` / `final` | tension |
| `loanApproved`* / `loanDenied`* / `loanRepaid`* | | `loan_approved` / `error` / `stamp` | `adv.loan.*` | — |
| `loanPaymentMissed`* | | `alert_critical` | (UX `vo_loan_missed`) | tension |
| `creditRatingChanged`* | from → to | `rating_up` / `rating_down` | `adv.credit.*` | ≤ B → tension input |
| `taxPaid`* | | `tax_paid` | `adv.tax.paid` | — |
| `policyRateChanged`* | \|Δ\| ≥ 0.5 pp | `news_sting` | `news.rates_*` (+ `adv.rates.up`) | — |
| `climateChanged`* | | `newspaper` | `news.recession/recovery/boom` → `adv.macro.*` | → recession / boom |
| `ipoEligible`* / `ipoCompleted`* | | `notify_opportunity` / `ipo_bell` | `adv.ipo.*` (after `news.ipo_debut`) | `stinger.ipo` |
| `dividendDeclared`* | | `coins_small` | `adv.dividend.declared` | — |
| `sharePriceMove`* | ≥ +15% / ≤ −20% per month | `ticker_up` / `ticker_down` | `adv.stock.surge` / `crash` | crash → drawdown input |
| `indexMove`* | ≤ −10% / ≥ +8% | `news_sting` | `news.market_crash` / `rally` | `stinger.crash` |
| `stakeAlert`* | rival ≥ 20%, 35% | `rival_alert` | `adv.stock.takeover_threat` | warningActive |
| `rivalEnteredMarket` | first per rival × city | `rival_alert` | `adv.market.competitor_entered` | auto-pause (UX) |
| `priceUndercut`* | ≥ 5% below and share −5 pts | `price_war` | `adv.market.price_war` | warningActive |
| `marketLeaderGained`* / `Lost`* | | `overtake` / `notify_warning` | `adv.market.leader` / `lost_lead` | triumph (gained) |
| `shareMilestone`* | 10/25/50% | `milestone_small` | `adv.market.share_*` | — |
| `brandMilestone`* | 30/50/70 | `brand_up` | (UX `vo_brand_*`) | — |
| `techLevelUp`* | player | `tech_up` | `adv.rnd.breakthrough` | — |
| `patentGranted`* / `patentBlocked`* | | `stamp` (pitched 0.85) + `confirm` / `notify_warning` | `adv.rnd.*` | — |
| `news` | Major / Notable / Info | `newspaper` / `news_sting` / `notify_info` | anchor per §5.2 content mapping | — |
| `companyBankrupt`* (AI) | | `news_sting` | `news.corporate_bankruptcy` | — |
| `campaignStarted`* | | `campaign_start` | `adv.onboard.first_ad` (first) | — |
| `goalAchieved` | latched | `goal_achieved` | goal-specific / (UX `vo_goal_generic`) | `stinger.triumph` |
| `scenarioWon` / `scenarioLost` | | `victory_fanfare` / `defeat_sting` | `adv.end.*` | victory / defeat |
| `playerIdle`* (client) | ≥ 60 s with no command | — | `adv.hint.*` (whichever rule holds) | — |

### 4.13 Accessibility

- **Nothing is sound-only.** Every cue has a visual counterpart (UX §8), and subtitles are on by default.
- **Sliders and toggles:**
  - separate voice slider;
  - mono downmix;
  - "reduce sudden sounds";
  - mute on Ctrl/⌘+M;
  - "keep playing in background" (the inverse of `muteInBackground`).
- **Frequency ranges:**
  - Alerts sit in **500 Hz – 3 kHz**, so they survive phone speakers and presbycusis. The old `notify_warning` (214 Hz) and `defeat` (86 Hz) failed this.
  - No critical cue relies on content above 8 kHz or below 150 Hz.
- **Screen readers:** subtitles use `aria-live="polite"` only for P0 and P1 lines, alongside the month-close summary (UX §6.18).

### 4.14 QA and tests

**Unit tests** (vitest, fake timers and a mocked `AudioContext`):
- `VoiceQueue`: TTL, token bucket, month-close budget, pre-emption and speed gating.
- `MusicDirector`: a table-driven `desiredState(inputs, current)` covering every rule and hysteresis edge.
- `EmitterManager`: voice selection with hysteresis.
- `sliderGain`.

**Offline render tests:**
- Render every procedural recipe in `OfflineAudioContext(1, 96000, 48000)`.
- Approximate K-weighting with `highpass 38 Hz Q 0.5` and `highshelf 1,682 Hz +4 dB`, then take the 400 ms maximum RMS as M-max.
- Assert it is within **±2 dB of the class target**, below the class peak ceiling, with no NaN and a duration ≤ the declared length.

**Asset CI** (`tools/audio/verify-loudness.mjs`, ffmpeg `ebur128`):
- For every file in `web/public/audio`: LUFS-I or M-max within ±1 LU of target, true peak within its limit, SFX head silence ≤ 5 ms.
- Manifest loop metrics must meet the §2.5 acceptance.
- Every manifest id must exist in both formats.

**In-app tools:**
- **F9 overlay:** context state, `sampleRate`, `baseLatency`, music state, cue, segment and next transition time, deck gains, per-bus RMS meters (`AnalyserNode`), active emitters and voices, VO queue and tokens, `DecodeCache` bytes per class.
- **`/#/dev/audio`:** plays every asset and recipe, and simulates every event kind.

**Manual matrix:**
- Chrome, Edge, Firefox and Safari 18.4+ on desktop; iOS Safari; Android Chrome.
- Check: unlock, background and foreground, a phone call interruption (Safari `interrupted`), and the mono toggle.
- Check the 44.1 kHz and 48 kHz devices for segment joins.

### 4.15 Fitting into the current web skeleton (read-only check, 2026-09-30)

**What exists:**
- `web/package.json` pins `three ^0.186.1`, `zustand ^5.0.15`, React 19 and vitest 3. The code in this plan targets those APIs: zustand v5 `persist` with `createJSONStorage`, and three r186 `AudioListener`/`PositionalAudio`.
- `web/src/audio/` exists and is empty. Put the §4.1 modules there.
- `web/public/audio/{music,sfx,vo}` holds **verbatim copies of the legacy MP3s**, including the silent `ui_click`, the sub-bass `defeat` and the non-looping `gameplay_loop`. Replace them with the mastered `{ogg,m4a}` outputs in the §4.1 layout, and remove the MP3s from the build.

**Units** (`web/src/scene/units.ts`): **1 unit = 1 m, `PLOT_SIZE = 12`**.
- Positional `refDistance = 1.2 × max(footprintW, footprintH) × 12 m`: 14.4 m for a convenience store, 43 m for a small factory, 72 m for a large factory.
- The focus radius `R = max(72 m, 0.8 × camera distance)`.

**Camera** (`web/src/scene/CityScene.ts:45-57`):
- `MapControls` with `minDistance 40`, `maxDistance 1800`, polar angle 12°–78°, `zoomToCursor`.
- Use a log mapping, **`zoom01 = clamp01(ln(d / 40) / ln(45))`**, where `d = |camera.position − controls.target|`. That gives 0 at 40 m, 0.5 at 268 m and 1 at 1,800 m.
- **Resulting listener rig height:** 14 m at street zoom, 94 m at mid zoom, 630 m at full zoom.
- **Resulting small-factory emitter gain** (inverse model, rolloff 1.3): about −8 dB at mid zoom and about −25 dB at city zoom. The beds take over there, as intended.

**Scene hook** (`web/src/scene/SceneContext.ts`):
- Implement an `AudioSceneModule` (`name: 'audio'`).
- **`init(ctx)`:** add the `listenerRig` (holding `engine.listener`) and the emitter pool to `ctx.scene`.
- **`update(frame)`, every frame:** move the rig.
- **`update(frame)`, throttled to 10 Hz:** build the `AudioFrame` from `ctx.camera`, `ctx.controls.target` and `plotAt()`, then run `AmbienceDirector` and `EmitterManager`.
- **Inputs from `FrameInfo`:** `frame.speed` drives speed gating and the pause filter; `frame.monthProgress` can drive construction-loop intensity.
- The scene comment lists a planned day/night module. If it exists, it is the source of `timeOfDay`.

**Settings:** keep them in their own store (`useAudioSettings`), separate from `web/src/state/gameStore.ts`. Game state and viewer preferences have different lifetimes.

---

## 5. VO script

### 5.1 Voice direction

**Advisor persona:**
- A warm, confident finance chief: "we", "our", "let's".
- Calm under pressure, and every line points to the next action.
- **No company names and no numbers or rules** (numbers go in subtitles and toasts), so lines survive balance changes and the insolvency-rule decision.
- Target pace 150–165 wpm (`speed 0.92`); 4–16 words per line, validated by `vo_script.py`.

**Casting:**

| Role | Voice | Treatment |
|---|---|---|
| Advisor | **Hope** (`uYXf8XasLslADfZ2MB4u`) | — |
| News anchor | contrasting male broadcaster (candidate: premade "Daniel") | runtime broadcast chain (§4.11), always after `news_sting` |

**Batch facts:**
- 60 advisor lines, 13 anchor lines, 4,656 characters in total.
- Estimated durations: 2.7–5.2 s.

**Table conventions:**
- `P1·T` = tutorial line, which plays even when Advisor frequency = Important.
- Kinds marked **\*** are proposed bridge event kinds (§4.12).

### 5.2 Advisor lines (60) and news-anchor lines (13)

| # | id | Line (spoken = subtitle unless noted) | W | Trigger (bridge event; * = kind proposed here) | P | Limit | Delivery | UX §8/§9 alias |
|---|---|---|---|---|---|---|---|---|
| 1 | `adv.onboard.welcome` | Welcome aboard. Let's build a company that lasts. | 8 | `gameStarted` (new game) after the opening camera move | P1 | once per profile; tutorial: once per save | warm, welcoming | vo_welcome (legacy) |
| 2 | `adv.onboard.first_plot` | Pick a plot near busy roads. Traffic brings customers through the door. | 12 | Build mode opened with 0 player buildings (tutorial step `build`) | P1·T | once per save | helpful | vo_t1_build |
| 3 | `adv.onboard.first_store` | Every empire starts with one good store. Let's place ours. | 10 | tutorial step `build-store`, or first hover on Retail in Build mode | P1·T | once per save | encouraging | — |
| 4 | `adv.onboard.set_price` | Set a price with a healthy margin, but keep an eye on rivals. | 13 | inspector Setup opened on the first retail line | P1·T | once per save | practical | vo_t1_price |
| 5 | `adv.onboard.restock` | Empty shelves earn nothing. Set a restock target so we never run dry. | 13 | first retail line still has no stock policy 20 s after Setup opened | P2 | once per save | practical | — |
| 6 | `adv.onboard.press_play` | Press play and let a month run. The books will tell the story. | 13 | tutorial setup complete and the game paused ≥ 10 s | P2 | once per save | light | (vo_t1_speed) |
| 7 | `adv.onboard.read_books` | Revenue is vanity, profit is sanity, and cash is king. | 10 | first month close, then Reports opened (or tutorial step `books`) | P2 | once per save | wry | vo_t1_books |
| 8 | `adv.onboard.first_ad` | Nobody buys what they've never heard of. Let's advertise. | 9 | tutorial step `run-campaign`, or month ≥ 4 with no campaign and brand < 10 | P2 | once per save | confident | vo_t1_advertise / vo_campaign_first |
| 9 | `adv.onboard.complete` | You've got the fundamentals. From here, every decision compounds. | 9 | tutorial chapter complete | P1 | once per save | proud | vo_tutorial_complete |
| 10 | `adv.build.started` | Ground is broken. That capital is committed, so let's make it earn. | 12 | `constructionStarted`* by the player | P2 | first 2 per game, then ≤ 1 per 12 game-months | brisk | (UX §8 #1) |
| 11 | `adv.build.started_tight` | That build stretches our cash thin. Make sure it pays back fast. | 12 | `constructionStarted`* with post-build runway < 4 months (replaces build.started) | P1 | ≤ 1 per 6 game-months | cautious | — |
| 12 | `adv.build.complete` | Construction complete. Staff it, stock it, and put it to work. | 11 | `constructionCompleted`* (not a factory) | P2 | first 3 per game, then every 5th | satisfied | (UX §8 #3) |
| 13 | `adv.build.factory_complete` | The factory is finished. Line up supply so it never sits idle. | 12 | first factory completed | P2 | once per game | practical | vo_building_first_factory |
| 14 | `adv.sales.first` | Our first sale! Small number, big moment. Now let's make it repeatable. | 12 | `firstSale`* | P1 | once per game | delighted | vo_first_sale |
| 15 | `adv.sales.record_month` | Record revenue this month. Watch our margins as we scale. | 10 | `recordMonth`* (NI > previous max × 1.10 and ≥ $100K) | P2 | ≤ 1 per 12 game-months | proud | vo_record_month |
| 16 | `adv.ops.stockout` | We're selling out. Empty shelves send customers straight to competitors. | 10 | `stockOut`* (a line lost > 5% of demand) | P1 | first per game, then ≤ 1 per 6 game-months | urgent, not alarmed | vo_stockout |
| 17 | `adv.ops.overstock` | Inventory is piling up. That's cash sitting on shelves, not in the bank. | 13 | `overstock`* (cover > 3 months) | P3 | ≤ 1 per 12 game-months | measured | — |
| 18 | `adv.cash.runway_low` | Our cash runway is getting short. Trim costs or line up financing. | 12 | `lowRunway` (`cashRunwayMonths` < 3, entering) | P1 | once per episode; re-arm at runway > 6 or null | concerned | vo_low_runway |
| 19 | `adv.cash.negative` | We're overdrawn. Every month in the red costs interest and credibility. | 11 | `cashNegative` (month-end cash < 0, entering) | P0 | once per episode; re-arm after 2 months ≥ 0 | serious | vo_cash_negative |
| 20 | `adv.cash.recovered` | Cash is positive again. Nicely done. Let's keep a healthy buffer. | 11 | `cashRecovered`* (cash ≥ 0 after an episode and runway ≥ 3 or null) | P2 | once per episode | relieved | — |
| 21 | `adv.loan.approved` | Loan approved. Borrowed money is a tool; make it earn more than it costs. | 14 | `loanApproved`* | P2 | first 2 per game, then ≤ 1 per 12 game-months | confident | vo_loan_approved |
| 22 | `adv.loan.denied` | The bank said no. Strengthen our margins and credit, then ask again. | 12 | `loanDenied`* | P1 | ≤ 1 per 6 game-months | frank | — |
| 23 | `adv.loan.repaid` | Loan repaid in full. Less interest, stronger balance sheet. | 9 | `loanRepaid`* (fully repaid) | P2 | ≤ 1 per 12 game-months | satisfied | — |
| 24 | `adv.credit.downgrade` | Our credit rating was downgraded. Borrowing just got more expensive. | 10 | `creditRatingChanged`* with to < from | P1 | each; ≥ 3 game-months apart | serious | (UX §8 #29, down only) |
| 25 | `adv.credit.upgrade` | Credit rating upgraded. Lenders like what they see. | 8 | `creditRatingChanged`* with to > from | P2 | ≥ 6 game-months apart | pleased | — |
| 26 | `adv.rates.up` | Interest rates are climbing. Our variable-rate debt just got pricier. | 10 | `policyRateChanged`* by ≥ +0.5 pp while the player holds variable-rate debt | P2 | ≤ 1 per 12 game-months | matter-of-fact | — |
| 27 | `adv.ipo.eligible` | We qualify for a public listing. An IPO could fund real growth. *(TTS: “We qualify for a public listing. An I.P.O. could fund real growth.”)* | 12 | `ipoEligible`* | P2 | once per game | enticing | — |
| 28 | `adv.ipo.complete` | We're officially public. From now on, every quarter is a report card. | 12 | `ipoCompleted`* (chained after news.ipo_debut) | P1 | once per game | elated, controlled | vo_ipo |
| 29 | `adv.stock.surge` | Our share price is surging. The market believes in our story. | 11 | `sharePriceMove`* 1-month ≥ +15% | P2 | ≤ 1 per 6 game-months | upbeat | — |
| 30 | `adv.stock.crash` | Our shares took a beating. Stay calm, and let earnings do the talking. | 13 | `sharePriceMove`* 1-month ≤ −20% | P1 | ≤ 1 per 6 game-months | steady, reassuring | — |
| 31 | `adv.dividend.declared` | Dividend declared. Shareholders love a steady, reliable return. | 8 | `dividendDeclared`* (first time, or the payout ratio changed) | P3 | first + ≤ 1 per 12 game-months | warm | — |
| 32 | `adv.stock.takeover_threat` | Someone is quietly buying up our shares. Watch for a takeover bid. | 12 | `stakeAlert`* rival stake ≥ 20% (again at 35%) | P1 | once per threshold | alert | — |
| 33 | `adv.market.competitor_entered` | A new competitor just entered one of our markets. Expect pressure on price. | 13 | `rivalEnteredMarket` (first per rival × city) | P1 | ≤ 1 per 6 game-months globally | alert | vo_rival_enters (replace: names LocalCo) |
| 34 | `adv.market.share_10` | We've captured ten percent of this market. That's a real foothold. | 11 | `shareMilestone`* 10%, first in the game | P2 | once per game | pleased | — |
| 35 | `adv.market.share_25` | A quarter of this market is ours. Competitors will be noticing. | 11 | `shareMilestone`* 25% | P2 | once per game | pleased | (UX §8 #18) |
| 36 | `adv.market.share_50` | We own half this market now. Defend it with quality and brand. | 12 | `shareMilestone`* 50% | P1 | once per game | proud, firm | (UX §8 #18) |
| 37 | `adv.market.leader` | We're the market leader here. Now the hard part: staying there. | 11 | `marketLeaderGained`* | P2 | ≤ 1 per 6 game-months | proud | vo_overtake |
| 38 | `adv.market.lost_lead` | We've lost market leadership here. Time to review price and quality. | 11 | `marketLeaderLost`* | P1 | ≤ 1 per 6 game-months | determined | — |
| 39 | `adv.market.price_war` | It's a price war. Protect our margins; winning at a loss isn't winning. | 13 | `priceUndercut`* (rival ≥ 5% below us and our share −5 pts) | P1 | first per game, then ≤ 1 per 12 game-months | firm | vo_price_war |
| 40 | `adv.rnd.breakthrough` | Research breakthrough! Our technology just moved up a level. | 9 | `techLevelUp`* (player): first time, and at max − 1 | P2 | ≥ 3 game-months apart | excited | vo_tech_up |
| 41 | `adv.rnd.patent_granted` | Patent granted. For now, that technology is ours alone. | 9 | `patentGranted`* (player) | P1 | each | triumphant, light | vo_patent |
| 42 | `adv.rnd.rival_patent` | A rival patented that technology. We'll need a license or a new path. | 13 | `patentBlocked`* (first blocked month) | P1 | once per product | pragmatic | vo_patent_blocked |
| 43 | `adv.macro.recession` | A recession is here. Conserve cash and protect our core markets. | 11 | `climateChanged`* → recession or panic (chained after news.recession) | P1 | each | calm, serious | — |
| 44 | `adv.macro.recovery` | The economy is recovering. Assets are cheap; a good time to invest. | 12 | `climateChanged`* recession/panic → normal or better | P2 | each | hopeful | — |
| 45 | `adv.macro.boom` | The economy is booming. Demand is strong, so let's add capacity. | 11 | `climateChanged`* → boom | P2 | each | energised | — |
| 46 | `adv.quarter.good` | Strong quarter. Revenue and profit are both up. The board is pleased. | 12 | `quarterClosed`* NI > 0, revenue QoQ ≥ +5% and NI QoQ ≥ +5% | P2 | ≤ 1 per 2 quarters | pleased | — |
| 47 | `adv.quarter.bad` | A tough quarter. We lost money. Let's find what's dragging us down. | 12 | `quarterClosed`* NI < 0 after a profitable quarter, or revenue QoQ ≤ −10% | P1 | ≤ 1 per 2 quarters | candid | — |
| 48 | `adv.quarter.record` | Best quarterly profit yet. That's disciplined execution. | 7 | `quarterClosed`* all-time-high NI with ≥ 4 quarters played (replaces quarter.good) | P2 | ≤ 1 per 4 quarters | proud | — |
| 49 | `adv.tax.paid` | The tax bill is paid. Remember, it's what we keep that counts. | 12 | `taxPaid`*: first time, then only when tax ≥ 25% of cash | P3 | ≤ 1 per 12 game-months | wry | — |
| 50 | `adv.bankruptcy.warning` | We're edging toward bankruptcy. Raise cash now: borrow, cut costs, or sell assets. | 13 | `insolvencyWarning`* monthsLeft ≤ 3 (under any insolvency rule) | P0 | once per episode | urgent | (UX insolvency countdown) |
| 51 | `adv.bankruptcy.final` | One more month in the red and the creditors take control. | 11 | `insolvencyWarning`* monthsLeft = 1 | P0 | once per episode | grave | — |
| 52 | `adv.end.victory` | Every objective met. That's a business built to last. Congratulations. | 10 | `scenarioWon` | P0 | once | proud, warm | vo_victory |
| 53 | `adv.end.defeat_bankrupt` | The creditors have taken over. Every great magnate has a second act. | 12 | `scenarioLost` reason insolvency | P0 | once | kind | vo_defeat_bankrupt |
| 54 | `adv.end.defeat_timeup` | Time's up. We missed the targets, but the lessons are ours to keep. | 13 | `scenarioLost` reason deadline | P0 | once | kind | vo_defeat_timeup |
| 55 | `adv.hint.idle_cash` | We're sitting on idle cash. Money that isn't invested isn't working. | 11 | cash > 35% of total assets, no capex for 6 game-months, ≥ 12 months played | P3 | hint rules (§4.11) | curious | — |
| 56 | `adv.hint.no_ads` | Our brand awareness is fading. A modest ad campaign would help. | 11 | selling in a (product, city) with brand < 20 and no campaign for 3 game-months | P3 | hint rules | suggestive | — |
| 57 | `adv.hint.no_rnd` | Rivals are out-innovating us. Consider building an R&D center. *(TTS: “Rivals are out-innovating us. Consider building an R and D center.”)* | 9 | advisor rule `Tech gap` (rival tech ≥ ours + 2, contested product) and no R&D building | P3 | hint rules | suggestive | — |
| 58 | `adv.hint.idle_factory` | One of our factories is idle. Idle capacity is pure overhead. | 11 | advisor `activateIdle` on a factory, or utilization 0 for 2 months | P3 | hint rules | frank | — |
| 59 | `adv.hint.new_city` | This city is working well. Consider expanding into another one. | 10 | ≥ 12 months played, one city only, trailing-6-month NI > 0, cash > 2 × supermarket cost | P3 | hint rules | ambitious | — |
| 60 | `adv.hint.make_vs_buy` | Suppliers are taking a fat margin. Could we make it ourselves? | 11 | a purchased input > 20% of COGS for 3 months and no owned upstream producer | P3 | hint rules | shrewd | — |

| # | id | Line | W | Trigger | P | Limit |
|---|---|---|---|---|---|---|
| 1 | `news.intro` | Good evening. Here's what's moving the markets tonight. | 8 | first anchor line of a session (prefixes the first Major news item) | P1 | once per session |
| 2 | `news.recession` | Breaking news: the economy has officially entered a recession. | 9 | `climateChanged`* → recession or panic | P1 | each |
| 3 | `news.recovery` | Economists say the recession is over as hiring picks up nationwide. | 11 | `climateChanged`* recession/panic → normal or prosperous | P2 | each |
| 4 | `news.boom` | Consumer spending hits a record high as the boom rolls on. | 11 | `climateChanged`* → boom | P2 | each |
| 5 | `news.rates_up` | The central bank has raised interest rates, effective immediately. | 9 | `policyRateChanged`* Δ ≥ +0.5 pp | P2 | ≥ 6 game-months apart |
| 6 | `news.rates_down` | The central bank cuts interest rates to kick-start growth. | 9 | `policyRateChanged`* Δ ≤ −0.5 pp | P2 | ≥ 6 game-months apart |
| 7 | `news.market_crash` | Stocks plunge in heavy trading as panic sweeps the exchange. | 10 | market index 1-month ≤ −10%, or climate → panic | P1 | ≥ 6 game-months apart |
| 8 | `news.market_rally` | Stocks close sharply higher in a broad market rally. | 9 | market index 1-month ≥ +8% | P2 | ≥ 6 game-months apart |
| 9 | `news.commodity_spike` | Commodity prices spike as supply shortages hit world markets. | 9 | `news` with a price multiplier > 1 and severity ≥ Notable (content: cocoa_blight ×1.5, tariff_announcement ×1.2, wheat_drought ×1.35) | P2 (Major: P1) | ≥ 90 s real time apart |
| 10 | `news.commodity_drop` | Commodity prices tumble on a global supply glut. | 8 | `news` with a price multiplier < 1 (oil_glut ×0.7, cotton_harvest_bumper ×0.75) | P2 (Major: P1) | ≥ 90 s apart |
| 11 | `news.ipo_debut` | A hotly anticipated newcomer debuts on the exchange today. | 9 | any IPO; for the player's own it chains into adv.ipo.complete | P2 | ≤ 1 per 12 game-months for AI IPOs |
| 12 | `news.corporate_bankruptcy` | Another corporate bankruptcy rattles investors this morning. | 7 | an AI company is liquidated (`companyBankrupt`*) | P2 | each |
| 13 | `news.tech_breakthrough` | Scientists unveil a breakthrough that could reshape the industry. | 9 | content event `tech_breakthrough` (headline), or a rival reaches max tech (`techMax`*) | P2 | ≤ 1 per 12 game-months |

**Mapping from `news` content events** (`content/data/events/seed.json`):

| Rule | Treatment | Content events |
|---|---|---|
| `price_multiplier` > 1 | `news.commodity_spike` | `cocoa_blight` (Notable), `tariff_announcement` (Major), `wheat_drought` (Notable) |
| `price_multiplier` < 1 | `news.commodity_drop` | `oil_glut` (Major), `cotton_harvest_bumper` (Notable) |
| headline-only `tech_breakthrough` | `news.tech_breakthrough` | — |
| `brand_shift` and Info headlines | `notify_info` only, no anchor | `viral_ad_spot`, `soft_drink_health_scare`, `trade_summit_optimism`, `consumer_electronics_craze` |

`soft_drink_health_scare` also plays `notify_warning` when the player sells soft drinks in Eastside.

**Anchor rules:**
- ≤ 1 anchor line per 90 s of real time.
- Info-severity news is never voiced.
- At 4× and 8×, only Major news is voiced.

### 5.3 Lines owned by `ux-playability.md` §9: record in the same batch

To keep **one voice, one model, one session**, record these UX lines alongside §5.2:
- **Tutorial:** `vo_t1_intro`, `vo_t1_city`, `vo_t1_speed`, `vo_t1_readstore`, `vo_t1_sharedrop`, `vo_t1_loan`, `vo_t1_expand`, `vo_t1_almost`, `vo_victory_t1`.
- **Advisor extras:** `vo_below_cost`, `vo_brand_milestone`, `vo_brand_household`, `vo_news_major`, `vo_loan_missed`, `vo_goal_generic`, `vo_deadline_12`, `vo_deadline_3`.
- **Templated lines:**
  - `vo_building_first_<retail|factory|farm|mine_well|warehouse|rd|media|seaport>` (8; `factory` = `adv.build.factory_complete`);
  - `vo_milestone_<1m|10m|100m|1b>` (4);
  - `vo_upgrade_first`;
  - `vo_tech_max`.

**Edits required before recording:**
1. `vo_rival_enters` names a company ("LocalCo"): use `adv.market.competitor_entered`.
2. `vo_cash_negative` hard-codes "Six months" (the insolvency rule may change; caplab-brief proposes 3 months of unpaid interest): use `adv.cash.negative`.
3. The tutorial lines that quote $6M / $10M (`vo_t1_intro`, `vo_victory_t1`): record only after the tutorial economics decision (UX §12 Q4).
4. Superseded by §5.2 ids, no separate recording needed:

   | UX id | Replaced by |
   |---|---|
   | `vo_low_runway` | `adv.cash.runway_low` |
   | `vo_first_sale` | `adv.sales.first` |
   | `vo_record_month` | `adv.sales.record_month` |
   | `vo_stockout` | `adv.ops.stockout` |
   | `vo_price_war` | `adv.market.price_war` |
   | `vo_overtake` | `adv.market.leader` |
   | `vo_tech_up` | `adv.rnd.breakthrough` |
   | `vo_patent` | `adv.rnd.patent_granted` |
   | `vo_patent_blocked` | `adv.rnd.rival_patent` |
   | `vo_loan_approved` | `adv.loan.approved` |
   | `vo_ipo` | `adv.ipo.complete` |
   | `vo_campaign_first` / `vo_t1_advertise` | `adv.onboard.first_ad` |
   | `vo_t1_books` | `adv.onboard.read_books` |
   | `vo_t1_price` | `adv.onboard.set_price` |
   | `vo_t1_build` | `adv.onboard.first_plot` |
   | `vo_tutorial_complete` | `adv.onboard.complete` |
   | `vo_victory` | `adv.end.victory` |
   | `vo_defeat_*` | `adv.end.defeat_*` |

**Legacy 10 lines:**
- Keep the files in `client/assets/audio/vo` untouched for the Godot client.
- The web build uses the new ids.
- `vo_welcome` and the `vo_tutorial_step*` lines are superseded by the tutorial chapter script (UX §7).

---

## 6. SFX list (67 ids: 38 PROCEDURAL, 23 GENERATE, 6 KEEP)

### 6.1 Procedural kit (`synth/primitives.ts`) and notation

```ts
export function env(p: AudioParam, t: number, pk: number, a: number, d: number) {   // seconds
  p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(pk, t + a); p.exponentialRampToValueAtTime(0.0001, t + a + d);
}
let NOISE: AudioBuffer | null = null;
export const noiseBuf = (c: BaseAudioContext) => {
  if (!NOISE || NOISE.sampleRate !== c.sampleRate) { NOISE = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return NOISE;
};
export function tone(c: BaseAudioContext, out: AudioNode, o: { type?: OscillatorType; f: number; f2?: number; t: number; a: number; d: number; pk: number; detune?: number }) {
  const osc = new OscillatorNode(c, { type: o.type ?? 'sine', frequency: o.f, detune: o.detune ?? 0 });
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + o.a + o.d);
  const g = new GainNode(c, { gain: 0 }); env(g.gain, o.t, o.pk, o.a, o.d);
  osc.connect(g).connect(out); osc.start(o.t); osc.stop(o.t + o.a + o.d + 0.02);
}
export function noise(c: BaseAudioContext, out: AudioNode, o: { t: number; a: number; d: number; pk: number; type: BiquadFilterType; f: number; f2?: number; sweep?: number; q?: number }) {
  const src = new AudioBufferSourceNode(c, { buffer: noiseBuf(c), loop: true });
  const flt = new BiquadFilterNode(c, { type: o.type, frequency: o.f, Q: o.q ?? 0.707 });
  if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, o.t + (o.sweep ?? o.a + o.d));
  const g = new GainNode(c, { gain: 0 }); env(g.gain, o.t, o.pk, o.a, o.d);
  src.connect(flt).connect(g).connect(out); src.start(o.t, Math.random() * 0.9); src.stop(o.t + o.a + o.d + 0.02);
}
export const mallet = (c: BaseAudioContext, out: AudioNode, f: number, t: number, pk: number, d = 0.26) => {
  tone(c, out, { f, t, a: 0.002, d, pk }); tone(c, out, { f: 4 * f, t, a: 0.001, d: 0.06, pk: 0.25 * pk });
  tone(c, out, { f: 10 * f, t, a: 0.001, d: 0.015, pk: 0.1 * pk });
};
export const bell = (c: BaseAudioContext, out: AudioNode, f: number, t: number, pk: number, d = 0.9) =>
  ([[1, 1, 1], [2.76, 0.4, 0.45], [5.4, 0.2, 0.17], [8.93, 0.1, 0.07]] as const)
    .forEach(([m, g, k]) => tone(c, out, { f: f * m, t, a: 0.001, d: d * k, pk: pk * g }));
export function fm(c: BaseAudioContext, out: AudioNode, fc: number, ratio: number, index: number, t: number, pk: number, d: number) {
  const car = new OscillatorNode(c, { frequency: fc }), mod = new OscillatorNode(c, { frequency: fc * ratio });
  const depth = new GainNode(c, { gain: index * fc * ratio });
  depth.gain.setValueAtTime(index * fc * ratio, t); depth.gain.exponentialRampToValueAtTime(1, t + d);
  mod.connect(depth).connect(car.frequency);
  const g = new GainNode(c, { gain: 0 }); env(g.gain, t, pk, 0.001, d);
  car.connect(g).connect(out); [car, mod].forEach((o) => { o.start(t); o.stop(t + d + 0.05); });
}
// recipes.ts: two examples; the rest follow the table below 1:1
export const RECIPES: Record<string, (c: BaseAudioContext, out: AudioNode, t: number, v?: number) => void> = {
  ui_click: (c, o, t) => { noise(c, o, { t, a: 0.001, d: 0.010, pk: 0.22, type: 'bandpass', f: 2800, q: 1.4 });
                           tone(c, o, { f: 1250, f2: 880, t, a: 0.001, d: 0.028, pk: 0.16 }); },
  confirm:  (c, o, t) => { mallet(c, o, 1046.5, t, 0.10); mallet(c, o, 1396.91, t + 0.07, 0.09); },
};
```

**Notation** (times in ms):

| Symbol | Meaning |
|---|---|
| `S(f)` / `T(f)` / `Q(f)` / `W(f)` | sine / triangle / square / sawtooth |
| `a→b` | exponential glide over the whole note |
| `env(a, d, pk)` | exponential attack to `pk`, then exponential decay |
| `N[type f Qq]` | white noise through that biquad; `f1→f2/ms` is a filter sweep |
| `M(f, pk[, d])` | mallet: partials 1/4/10, decays d = 260/60/15 |
| `B(f, pk[, d])` | bell: partials 1/2.76/5.40/8.93, decays d = 900 × 1/.45/.17/.07 |
| `FM(fc, ratio, index, d, pk)` | two-operator FM |
| `@t` | start offset |
| `×n` | repeats |
| `±c` | random detune per trigger |

**Pitch set** (the F major family, so the music and UI never clash):

| Note | Hz |
|---|---|
| D4 | 293.66 |
| F4 | 349.23 |
| D5 | 587.33 |
| F5 | 698.46 |
| G5 | 783.99 |
| Ab5 | 830.61 |
| A5 | 880 |
| C6 | 1046.50 |
| D6 | 1174.66 |
| E6 | 1318.51 |
| F6 | 1396.91 |
| G6 | 1567.98 |
| A6 | 1760 |
| C7 | 2093 |
| D7 | 2349.32 |
| F7 | 2793.83 |

**Calibration:** `pk` values are starting points. Calibrate each recipe to its class target (§2.3) with the offline render test (§4.14).

### 6.2 The list

| # | id | Class | Mode | Recipe (PROCEDURAL) or prompt (GENERATE: `eleven_text_to_sound_v2`) | Dur | Var | Trigger / notes |
|---|---|---|---|---|---|---|---|
| 1 | `ui_hover` | ui_micro | PROC | S(1760) env(2,40,.03) + N[hp 6000 Q.7] env(1,8,.012); ±25 c | 50 ms | — | primary buttons and cards only; cooldown 50 ms |
| 2 | `ui_click` | ui_micro | PROC | N[bp 2800 Q1.4] env(1,10,.22) + S(1250→880) env(1,28,.16); ±30 c | 40 ms | — | replaces the silent `ui_click.mp3` |
| 3 | `panel_open` | ui_notice | PROC | N[bp 500→2400/160 Q1] env(20,180,.09) + S(587→880) env(5,90,.05) @40 | 220 ms | — | drawer or overlay opens |
| 4 | `panel_close` | ui_notice | PROC | N[bp 2400→500/140 Q1] env(10,150,.08) + S(880→587) env(5,80,.045) | 170 ms | — | |
| 5 | `tab_switch` | ui_micro | PROC | N[bp 4200 Q3] env(1,6,.12) + S(2093) env(1,18,.05) | 25 ms | — | |
| 6 | `toggle_on` | ui_micro | PROC | T(783.99) env(2,55,.08) + T(1174.66) env(2,70,.08) @45 | 120 ms | — | |
| 7 | `toggle_off` | ui_micro | PROC | T(1174.66) env(2,55,.08) + T(783.99) env(2,70,.07) @45 | 120 ms | — | |
| 8 | `slider_tick` | ui_micro | PROC | S(1800 + 1800·v) env(1,10,.025); v = slider 0–1 | 12 ms | — | throttle 35 ms |
| 9 | `confirm` | ui_notice | PROC | M(1046.5,.10) + M(1396.91,.09) @70 | 330 ms | — | commit (C6 → F6 resolves to the tonic) |
| 10 | `error` | ui_notice | PROC | [Q(196) + Q(207.65)] → lp 1400 Q.7, env(3,85,.05) ×2 @0/@140 | 230 ms | — | denied action; `loanDenied` |
| 11 | `speed_up` | ui_notice | PROC | W(220→440) → lp 1500 Q2, env(5,110,.04) | 115 ms | — | also used on resume |
| 12 | `speed_down` | ui_notice | PROC | W(440→220) → lp 1500 Q2, env(5,110,.04) | 115 ms | — | |
| 13 | `pause` | ui_notice | PROC | W(330→165) → lp 900 Q1, env(5,160,.04) + `setMusicTone('paused')` | 165 ms | — | |
| 14 | `select_retail` | ui_notice | PROC | M(880,.07,120) + B(1760,.02,300) | 300 ms | — | building clicked, by category |
| 15 | `select_industrial` | ui_notice | PROC | N[bp 900 Q6] env(1,40,.20) + S(140→110) env(2,80,.12) | 120 ms | — | factory, mine, well, warehouse, port |
| 16 | `select_agri` | ui_notice | PROC | N[bp 600 Q8] env(1,30,.18) + S(330) env(2,60,.06) | 90 ms | — | farm, plantation |
| 17 | `select_knowledge` | ui_notice | PROC | S(1318.51) env(2,90,.05) + S(1975.53) env(2,90,.03) | 95 ms | — | R&D, media |
| 18 | `place_ok` | event | PROC | N[lp 180 Q1] env(2,120,.30) + N[bp 2000 Q2] env(1,25,.08) + S(90→60) env(2,140,.25); ±50 c | 150 ms | — | placement confirmed (ghost snaps) |
| 19 | `place_invalid` | ui_notice | PROC | W(110) → lp 800 Q1, env(3,110,.06) ×2 @0/@150 | 260 ms | — | blocked plot |
| 20 | `price_tag` | ui_micro | PROC | N[bp 3000→1500/60 Q2] env(2,60,.10) + S(1567.98) env(1,40,.03) @30 | 90 ms | — | price applied at close (UX §8 #12) |
| 21 | `notify_info` | ui_notice | KEEP | existing `notify_info.mp3`, −7.3 dB | 0.5 s | — | Info severity |
| 22 | `notify_opportunity` | ui_notice | PROC | M(1046.5,.07) + M(1396.91,.07) @60 + M(1760,.06) @120 | 400 ms | — | Opportunity severity (UX §6.21) |
| 23 | `notify_warning` | alert | PROC | [T(880) + 0.3·S(1760)] env(4,140,.10) + [T(698.46) + 0.3·S(1396.91)] env(4,180,.10) @160 → hp 300 | 350 ms | — | **replaces** the 214 Hz thud; same id |
| 24 | `alert_critical` | alert | PROC | [W(440) + W(446)] → lp 2400 Q1, env(3,120,.07) ×3 @0/210/420, + S(110) env(2,120,.12) on each pulse | 560 ms | — | Critical severity; cooldown 3 s |
| 25 | `heartbeat_soft` | alert | PROC | S(110→70) env(3,90,.25) + N[lp 900] env(1,20,.05); second beat @180 at ×0.7; ×3 at 1 Hz | 2.3 s | — | low runway (UX §8 #32) |
| 26 | `newspaper` | event | GEN | "A rolled newspaper spinning through the air and landing with a slap on a wooden desk, paper whoosh, close, dry, no voices" | 1.2 s | 2 | Major news (UX §8 #25) |
| 27 | `news_sting` | stinger | GEN | "Short TV news bulletin sting: urgent rising synth pulse into a bright brass and timpani hit, modern broadcast, clean ending, no voice" (prompt_influence 0.7) | 2.5 s | 2 | before every anchor line |
| 28 | `month_close_up` | economy | PROC | M(1396.91,.06) + FM(2637, 1.4, 2.5, 350, .03) @40; detune +100 c × min(5, streak − 1) | 450 ms | — | NI > 0 (UX §8 #5) |
| 29 | `month_close_down` | economy | PROC | T(349.23→329.63) env(5,240,.06) + T(293.66) env(5,300,.05) @90 → lp 800 | 420 ms | — | NI < 0 (UX §8 #6) |
| 30 | `cash_register` | economy | GEN (+ KEEP a) | "Vintage mechanical cash register: one key press, bright bell ka-ching, cash drawer sliding open, close-miked, dry studio, no music" | 1.2 s | 3 (a = `cash_sale.mp3`) | `firstSale`, large sales |
| 31 | `coins_small` | economy | GEN | "A handful of coins dropped onto a wooden counter, short bright jingle, close-miked, dry" | 0.8 s | 3 | dividends, `firstSale` layer |
| 32 | `coins_large` | economy | GEN | "A stream of gold coins pouring into a metal tray, rich satisfying jingle, close, dry" | 1.8 s | 2 | record month, IPO |
| 33 | `ticker_up` | economy | PROC | M(698.46,.07) + M(880,.07) @55 + M(1046.5,.07) @110 | 380 ms | — | share price up |
| 34 | `ticker_down` | economy | PROC | M(1046.5,.06) + M(830.61,.06) @60 + M(698.46,.06) @120 → lp 3000 | 380 ms | — | share price down |
| 35 | `rating_up` | economy | PROC | M(880,.07) + M(1318.51,.07) @80 + B(2637,.015,400) @80 | 500 ms | — | credit upgrade, cash recovered |
| 36 | `rating_down` | economy | PROC | M(830.61,.06) + M(698.46,.06) @90 → lp 2500 | 400 ms | — | credit downgrade |
| 37 | `stamp` | economy | GEN | "Heavy rubber stamp slammed once onto paper on a wooden desk, single solid thump, close-miked, dry" | 0.6 s | 2 | loan documents; patent (playbackRate 0.85, + `confirm` @180) |
| 38 | `loan_approved` | economy | GEN | "Rubber stamp thump on a document followed by a bank-note counting machine riffling bills quickly, close, dry" | 1.6 s | 2 | UX §8 #27 |
| 39 | `ipo_bell` | stinger | GEN | "Stock exchange opening bell ringing continuously for two seconds, large brass bell in a big trading hall, no crowd, no voices" | 3.0 s | 2 | IPO (UX §8 #30), with `stinger.ipo` |
| 40 | `quarter_close` | economy | GEN | "Heavy leather-bound ledger book closing with a soft thud, pages settling, quiet office, close, dry" | 1.0 s | 2 | quarter end |
| 41 | `tax_paid` | economy | GEN | "Paper envelope torn open and a letter unfolded, close-miked, dry, quiet room" | 1.2 s | 2 | annual tax |
| 42 | `rival_alert` | alert | PROC | T(587.33) env(3,120,.08) + T(698.46) env(3,220,.08) @130 + S(1174.66) env(2,180,.02) @130; feedback delay 180 ms, fb .25, lp 2 kHz | 600 ms | — | rival enters, stake alert (UX §8 #15) |
| 43 | `price_war` | alert | GEN | "Two steel swords clashing once, bright metallic ring, short, close, dry" | 0.8 s | 2 | undercut (UX §8 #16) |
| 44 | `overtake` | event | PROC | M(698.46) M(783.99) @50 M(880) @100 M(1046.5) @150 M(1396.91) @200, pk .08 each | 460 ms | — | became #1 (UX §8 #17) |
| 45 | `milestone_small` | event | PROC | M(1046.5,.08) + M(1396.91,.08) @90 + B(2793.83,.015,500) @90 | 600 ms | — | share milestones |
| 46 | `brand_up` | event | GEN | "Large mechanical rotating billboard panels flipping with a clack, then a neon sign buzzing on, outdoor, medium distance" | 1.5 s | 2 | brand milestones (UX §8 #20) |
| 47 | `stockout` | alert | PROC | N[bp 800 Q6] env(1,40,.18) + N[bp 600 Q6] env(1,40,.16) @120 + T(349.23→293.66) env(5,200,.05) @60 | 320 ms | — | UX §8 #9 |
| 48 | `tech_up` | event | PROC | N[bp 400→3000/400 Q4] env(150,250,.05) + 7 grains S(fᵢ) env(2,140,.035) @40·i, fᵢ drawn from {F6, G6, A6, C7, D7, F7} | 700 ms | — | tech level up (UX §8 #22) |
| 49 | `build_construct` | event | KEEP | existing, −10.5 dB (fixes +1.5 dBTP), positional at the site | 1.5 s | — | construction started |
| 50 | `construct_loop` | world loop | GEN `loop:true` | hammer: "Construction site: two workers hammering nails into wooden framing, irregular rhythm, outdoor, medium distance, no music, no voices" · mixer: "Cement mixer truck drum rotating with the diesel engine idling, outdoor, medium distance" · crane: "Tower crane electric motor humming with slow steel cable winding and occasional chain clinks, outdoor" | 10 s each | 3 | positional, within district zoom (UX §8 #2) |
| 51 | `crane_winch` | world | GEN | "Tower crane winch motor whirring as a steel cable tightens, ending with a heavy chain clank, outdoor, medium distance" | 4.0 s | 2 | random, per construction site |
| 52 | `ribbon_cut` | event | GEN + PROC | GEN: "Large ceremonial scissors cutting a ribbon, one crisp snip, followed by brief polite applause from a small crowd outdoors" · PROC layer: M(698.46) M(880) @80 M(1046.5) @160 M(1396.91) @240, pk .10 → convolver (procedural 1.2 s decaying-noise IR, wet .15) | 2.0 s | 2 | construction completed (UX §8 #3) |
| 53 | `upgrade` | event | KEEP | existing, −6.8 dB and a −4 dB high shelf at 8 kHz | 1.0 s | — | UX §8 #35 |
| 54 | `demolish` | event | GEN | "Small brick building collapsing after demolition, walls crumbling, rubble falling, dust settling, outdoor, medium distance, no music" | 2.5 s | 2 | UX §8 #36 |
| 55 | `goal_achieved` | event | KEEP | existing, −5.4 dB | 1.5 s | — | plus `stinger.triumph` |
| 56 | `campaign_start` | event | KEEP | existing, −6.8 dB | 1.0 s | — | |
| 57 | `victory_fanfare` | stinger | KEEP | existing, −8.1 dB (fixes +0.8 dBTP) | 2.5 s | — | then `music.victory` +0.4 s, VO +1.6 s |
| 58 | `defeat_sting` | stinger | GEN (music API §7.3; SFX API fallback) | SFX fallback: "Somber orchestral sting: low strings swell into a soft minor piano chord, resolving downward, clean ending" | 4.0 s | 2 | **replaces** `defeat.mp3` |
| 59 | `car_horn` | world | GEN | a "Single short car horn honk from a small sedan on a city street, medium distance, slight street reverb" · b "Two quick car horn beeps, city street, medium distance" · c "One long frustrated car horn honk, city street, medium distance" | 0.6–1.0 s | 3 | Poisson (§4.8) |
| 60 | `truck_reverse` | world | PROC | Q(1040) gated 450 ms on / 450 ms off (5 ms ramps) → bp 1040 Q6, pk .05; 3–6 cycles; ±2% f | 3–5 s | — | loading docks |
| 61 | `forklift_beep` | world | PROC | S(2700) env(2,110,.04) ×3 @0/400/800 | 0.9 s | — | warehouses |
| 62 | `factory_hiss` | world | GEN | "Industrial pneumatic steam valve releasing a sharp hiss, factory yard, outdoor, medium distance" | 1.5 s | 2 | factories; ×2 when starved |
| 63 | `ship_horn` | world | GEN | "Distant cargo ship horn, one deep long blast across a harbour, water lapping, faint seagulls" | 4.0 s | 2 | coastal cities only |
| 64 | `siren_distant` | world | GEN | "Police siren passing far away across a city at night, distant and reverberant" | 6.0 s | 1 | mostly at night |
| 65 | `door_chime` | world | PROC | B(1318.51,.05) + B(1046.5,.05) @350 | 1.3 s | — | busy retail at street zoom, λ = 0.4/min per store |
| 66 | `thunder` | world | GEN | "Distant rolling thunder rumbling over a city, no rain sound" | 6.0 s | 2 | only if the renderer has weather |
| 67 | `truck_engine_loop` | world loop | GEN `loop:true` | "Delivery truck diesel engine driving at low city speed, steady, no horn" | 8 s | 1 | 3 nearest trucks (UX §8 #14) |

**Post-processing for every GENERATE item:**
1. Trim the head to ≤ 5 ms and add a 5 ms fade-in; trim the tail to −60 dB and add a 20 ms fade-out.
2. Apply a 30 Hz high-pass.
3. Normalise to the class target (§2.3).
4. Keep mono for world and positional sounds.

### 6.3 Ambience beds and positional loops (GENERATE, `loop: true`, `prompt_influence 0.4`)

| id | Prompt (every prompt ends with "…, seamless loop") | Dur | Ch |
|---|---|---|---|
| `amb_city_day` | "Daytime city ambience heard from a rooftop: distant traffic hum, far-off car horns, faint crowd murmur, gentle wind, no music, no close voices" | 30 s | 2 |
| `amb_city_night` | "Quiet city at night from a rooftop: sparse distant traffic, air-conditioning hum, a very occasional distant siren, no music" | 30 s | 2 |
| `amb_traffic_street` | "Street-level city traffic: cars passing in both directions at moderate speed, tyres on asphalt, an occasional bus, no horns, no voices" | 20 s | 2 |
| `amb_crowd` | "Busy shopping street: indistinct crowd murmur and footsteps, distant shop door chimes, no clear words" | 20 s | 2 |
| `amb_birds` | "City park in the morning: sparrows and songbirds chirping, light breeze in the trees, traffic very faint" | 20 s | 2 |
| `amb_insects_night` | "Summer night: crickets and cicadas chirping steadily, very faint distant traffic" | 20 s | 2 |
| `amb_wind_high` | "High-altitude wind over a city: steady airy wind with soft gusts, no whistling, no traffic" | 20 s | 2 |
| `amb_rain_light` | "Light steady rain falling on city streets and rooftops, gentle drips, no thunder" | 20 s | 2 |
| `amb_rain_heavy` | "Heavy rain downpour on city rooftops and streets, water gushing in gutters, no thunder" | 20 s | 2 |
| `amb_harbour` | "Busy harbour: water lapping against a concrete pier, seagulls calling, distant ship engine rumble, occasional chain clank, no voices" | 30 s | 2 |
| `amb_river` | "Wide river flowing steadily past a stone embankment, gentle water movement, no birds" | 20 s | 2 |
| `amb_industrial` | "Industrial district heard from a distance: low factory machinery hum, rhythmic distant stamping press, ventilation fans" | 20 s | 2 |
| `loop_factory` | "Factory exterior: steady machinery hum, conveyor rattle, a rhythmic pneumatic press every two seconds, no voices" | 15 s | 1 |
| `loop_mine` | "Open-pit iron mine: heavy diesel excavator engine, rock crusher grinding, conveyor belt rumble, outdoor" | 15 s | 1 |
| `loop_pumpjack` | "Oil pumpjack slowly rocking: rhythmic metallic creak every five seconds and a low electric motor hum, outdoor" | 10 s | 1 |
| `loop_farm` | "Farmland: a distant tractor working a field, occasional cow moo and chickens, gentle breeze" | 15 s | 1 |
| `loop_warehouse` | "Warehouse loading dock: electric forklift whine, pallets set down, roller door rattling, no voices" | 15 s | 1 |
| `loop_seaport` | "Container port: gantry crane motors, containers clanking, ship engine idling, seagulls, water lapping" | 20 s | 1 |
| `loop_retail` | "Outside a busy supermarket entrance: automatic doors sliding, shopping carts rattling, indistinct shopper murmur" | 15 s | 1 |
| `loop_lab` | "Modern research laboratory exterior: server-room hum, ventilation, soft electronic beeps, clean and quiet" | 12 s | 1 |
| `loop_press` | "Newspaper printing press running: rhythmic mechanical thumping and paper-feed whirr" | 12 s | 1 |
| `loop_broadcast` | "Broadcast station exterior: electrical transformer hum, cooling fans, faint radio static" | 12 s | 1 |
| `layer.pressure` | "Low string section tremolo sustaining a single D note with slow swelling dynamics, dark and tense but quiet, no rhythm, no melody" | 30 s | 2 |

**Checks and processing:**
- Every loop passes the seam check (§3.5) and is normalised to −26 LUFS (beds) or −24 LUFS (positional).
- `layer.pressure` is key-neutral: a D pedal fits F major, D minor and G minor.
- **If the renderer has no weather and no night lighting**, drop `amb_city_night`, `amb_insects_night`, `amb_rain_*` and `thunder` (open question 7).

---

## 7. Music: five new cues, plus short forms

### 7.1 House style (derived from §1.4)

These `composition_plan` fields are shared by every cue:

```json
{
  "positive_global_styles": ["instrumental cinematic corporate underscore", "modern orchestral-electronic hybrid",
    "warm analog synth pad", "plucked mallet ostinato (marimba, kalimba, celesta)", "soft felt piano",
    "light string ensemble", "polished warm mix with a slightly dark top end", "steady tempo throughout, loop-friendly"],
  "negative_global_styles": ["vocals", "choir", "lyrics", "spoken word", "EDM drop", "dubstep", "trap hi-hats",
    "distorted electric guitar", "vinyl crackle", "saxophone solo", "tempo changes", "ritardando", "fade out", "long silence"]
}
```

**Plan rules:**
- Every loopable plan follows **Intro → A → B → (C) → A reprise (restates A exactly) → Tail (continues A, no ending)**.
- The loop body is **[A start, A-reprise start)**; the reprise and the tail give the loop finder its matching material.
- Keys stay in the F major family, so every crossfade and stinger is consonant.
- Durations are exact bar multiples: `bar_ms = 240000 / BPM`.

### 7.2 Cues

| id | Title | Role | Key / BPM | Plan (bars) | Total | Loop body | Seed |
|---|---|---|---|---|---|---|---|
| `music.calm_a` | Groundwork | calm (early game) | F major / 92 | 4 + 16 + 16 + 16 + 16 + 4 | 3:07.8 (187,826 ms) | 48 bars = 125.2 s | 71001 |
| `music.calm_b` | Ledger Lines | calm and steady rotation | D minor → F / 100 | 4 + 16 + 16 + 24 + 16 + 4 | 3:12.0 (192,000 ms) | 56 bars = 134.4 s | 71002 |
| `music.growth` | Expansion | growth / busy | F major / 120 | 4 + 16 + 16 + 16 + 8 + 16 + 4 | 2:40.0 (160,000 ms) | 56 bars = 112 s | 71003 |
| `music.tension` | Red Ink | crisis / low cash | D minor / 104 | 2 + 16 + 16 + 16 + 2 | 2:00.0 (119,999 ms) | 32 bars = 73.8 s | 71004 |
| `music.recession` | Bear Market | recession | G minor / 76 | 2 + 12 + 12 + 12 + 12 + 2 | 2:44.2 (164,212 ms) | 36 bars = 113.7 s | 71005 |

**Short forms:**

| id | Title | Key / BPM | Plan | Length | Seed |
|---|---|---|---|---|---|
| `music.defeat` | Closing Bell | D minor / 70 | 4 + 3 bars | 24.0 s, one-shot | 71006 |
| `stinger.*` | 6 stingers | — | — | 3–5 s | 71011–71016 |
| `layer.pressure` | — | — | — | 30 s (SFX API, §6.3) | — |

### 7.3 Composition plans

Send `POST /v1/music?output_format=pcm_48000` with `{"model_id":"music_v2_5","seed":<seed>,"composition_plan":{…}}`. The shared styles from §7.1 are written as `…`.

```json
{ "id": "music.calm_a", "composition_plan": {
  "positive_global_styles": ["…house…", "F major", "92 BPM", "calm, optimistic, focused", "soft brushed percussion, no kick drum"],
  "negative_global_styles": ["…house…", "brass fanfare"],
  "sections": [
    {"section_name": "Intro", "positive_local_styles": ["warm pad and felt piano chords only", "sparse"], "negative_local_styles": ["drums"], "duration_ms": 10435, "lines": []},
    {"section_name": "Theme A", "positive_local_styles": ["marimba ostinato enters", "gentle shaker", "felt piano melody", "I–V–vi–IV progression"], "negative_local_styles": ["brass"], "duration_ms": 41739, "lines": []},
    {"section_name": "Theme B", "positive_local_styles": ["light pizzicato strings join", "warmer and fuller", "same groove"], "negative_local_styles": ["key change"], "duration_ms": 41739, "lines": []},
    {"section_name": "Theme C", "positive_local_styles": ["new piano counter-melody over the Theme A chords", "celesta sparkles"], "negative_local_styles": ["key change"], "duration_ms": 41739, "lines": []},
    {"section_name": "Theme A reprise", "positive_local_styles": ["restate Theme A exactly: same chords, melody and instrumentation"], "negative_local_styles": ["ending", "ritardando"], "duration_ms": 41739, "lines": []},
    {"section_name": "Tail", "positive_local_styles": ["continue the Theme A groove unresolved"], "negative_local_styles": ["final chord", "fade out"], "duration_ms": 10435, "lines": []}
  ] } }
```

```json
{ "id": "music.calm_b", "composition_plan": {
  "positive_global_styles": ["…house…", "D minor moving to F major", "100 BPM", "bittersweet but steady, thoughtful", "soft pulsing synth bass in eighth notes", "kalimba motif"],
  "negative_global_styles": ["…house…"],
  "sections": [
    {"section_name": "Intro", "positive_local_styles": ["pad and kalimba motif"], "negative_local_styles": ["drums"], "duration_ms": 9600, "lines": []},
    {"section_name": "Theme A", "positive_local_styles": ["Dm–Bb–F–C progression", "pulsing bass", "light rim-click percussion"], "negative_local_styles": [], "duration_ms": 38400, "lines": []},
    {"section_name": "Theme B", "positive_local_styles": ["string pad swells", "piano doubles the kalimba"], "negative_local_styles": ["key change"], "duration_ms": 38400, "lines": []},
    {"section_name": "Theme C", "positive_local_styles": ["brighter, resolves toward F major", "celesta counter-line"], "negative_local_styles": ["tempo change"], "duration_ms": 57600, "lines": []},
    {"section_name": "Theme A reprise", "positive_local_styles": ["restate Theme A exactly"], "negative_local_styles": ["ending"], "duration_ms": 38400, "lines": []},
    {"section_name": "Tail", "positive_local_styles": ["continue Theme A unresolved"], "negative_local_styles": ["final chord", "fade out"], "duration_ms": 9600, "lines": []}
  ] } }
```

```json
{ "id": "music.growth", "composition_plan": {
  "positive_global_styles": ["…house…", "F major", "120 BPM", "driving, optimistic momentum", "tight kick and snare", "eighth-note synth pulse", "pizzicato strings"],
  "negative_global_styles": ["…house…"],
  "sections": [
    {"section_name": "Intro", "positive_local_styles": ["synth pulse and mallets"], "negative_local_styles": [], "duration_ms": 8000, "lines": []},
    {"section_name": "Theme A", "positive_local_styles": ["full groove", "marimba hook"], "negative_local_styles": [], "duration_ms": 32000, "lines": []},
    {"section_name": "Theme B", "positive_local_styles": ["strings carry the melody", "riser into the next section"], "negative_local_styles": [], "duration_ms": 32000, "lines": []},
    {"section_name": "Lift", "positive_local_styles": ["brass swells every 8 bars like a corporate title theme", "cymbal swells"], "negative_local_styles": ["key change"], "duration_ms": 32000, "lines": []},
    {"section_name": "Breakdown", "positive_local_styles": ["drums drop to hi-hat and pulse", "tension building back"], "negative_local_styles": ["silence"], "duration_ms": 16000, "lines": []},
    {"section_name": "Theme A reprise", "positive_local_styles": ["restate Theme A exactly"], "negative_local_styles": ["ending"], "duration_ms": 32000, "lines": []},
    {"section_name": "Tail", "positive_local_styles": ["continue Theme A"], "negative_local_styles": ["final chord", "fade out"], "duration_ms": 8000, "lines": []}
  ] } }
```

```json
{ "id": "music.tension", "composition_plan": {
  "positive_global_styles": ["…house…", "D minor", "104 BPM", "tense but controlled, urgent problem-solving, not horror", "low string ostinato", "ticking sixteenth-note hi-hat", "pulsing sub bass", "muted piano stabs"],
  "negative_global_styles": ["…house…", "brass fanfare", "jump scares", "major key"],
  "sections": [
    {"section_name": "Intro", "positive_local_styles": ["ticking hi-hat and sub pulse"], "negative_local_styles": [], "duration_ms": 4615, "lines": []},
    {"section_name": "Theme A", "positive_local_styles": ["string ostinato enters", "piano stabs on the offbeat"], "negative_local_styles": [], "duration_ms": 36923, "lines": []},
    {"section_name": "Theme B", "positive_local_styles": ["intensifies with low brass pads and taiko hits", "same tempo"], "negative_local_styles": ["key change"], "duration_ms": 36923, "lines": []},
    {"section_name": "Theme A reprise", "positive_local_styles": ["restate Theme A exactly"], "negative_local_styles": ["ending"], "duration_ms": 36923, "lines": []},
    {"section_name": "Tail", "positive_local_styles": ["continue Theme A"], "negative_local_styles": ["final chord", "fade out"], "duration_ms": 4615, "lines": []}
  ] } }
```

```json
{ "id": "music.recession", "composition_plan": {
  "positive_global_styles": ["…house…", "G minor", "76 BPM", "melancholic and reflective with a hopeful undertone", "sparse muted felt piano", "solo cello", "brushed snare on 2 and 4"],
  "negative_global_styles": ["…house…", "heavy drums"],
  "sections": [
    {"section_name": "Intro", "positive_local_styles": ["solo piano"], "negative_local_styles": ["drums"], "duration_ms": 6316, "lines": []},
    {"section_name": "Theme A", "positive_local_styles": ["Gm–Eb–Bb–F progression", "cello melody", "brushes enter"], "negative_local_styles": [], "duration_ms": 37895, "lines": []},
    {"section_name": "Theme B", "positive_local_styles": ["warm pad", "piano counter-melody"], "negative_local_styles": ["key change"], "duration_ms": 37895, "lines": []},
    {"section_name": "Theme C", "positive_local_styles": ["brief lift toward Bb major", "light strings"], "negative_local_styles": ["tempo change"], "duration_ms": 37895, "lines": []},
    {"section_name": "Theme A reprise", "positive_local_styles": ["restate Theme A exactly"], "negative_local_styles": ["ending"], "duration_ms": 37895, "lines": []},
    {"section_name": "Tail", "positive_local_styles": ["continue Theme A"], "negative_local_styles": ["final chord", "fade out"], "duration_ms": 6316, "lines": []}
  ] } }
```

```json
{ "id": "music.defeat", "composition_plan": {
  "positive_global_styles": ["…house…", "D minor", "70 BPM", "somber and dignified", "solo piano and low strings"],
  "negative_global_styles": ["…house… minus 'fade out'", "drums"],
  "sections": [
    {"section_name": "Statement", "positive_local_styles": ["slow descending piano theme over low strings"], "negative_local_styles": [], "duration_ms": 13714, "lines": []},
    {"section_name": "Resolution", "positive_local_styles": ["settle on a sustained open D fifth", "clean ending with natural decay"], "negative_local_styles": ["abrupt cut"], "duration_ms": 10286, "lines": []}
  ] } }
```

**Stingers:**
- Each stinger is one section, using the house styles minus "loop-friendly", plus a local negative style "reverb tail longer than one second".
- `seed` 71011–71016.
- If `music_v2_5` handles 3 s pieces poorly, generate the same prompt on the SFX API (0.5–30 s).

| id | Key | ms | positive_local_styles |
|---|---|---|---|
| `stinger.tension` | D minor | 3000 | "single dramatic low brass and timpani hit, short dark tail, clean ending" |
| `stinger.recovery` | F major | 4000 | "rising string swell resolving to a bright F major chord with a soft chime" |
| `stinger.triumph` | F major | 4000 | "short triumphant brass fanfare flourish, strings and timpani, like the victory theme" |
| `stinger.crash` | D minor | 4000 | "descending brass and low strings, falling motif, ominous" |
| `stinger.boom` | F major | 3000 | "bright pizzicato and brass lift, energetic rising motif" |
| `stinger.ipo` | F major | 5000 | "celebratory orchestral swell with a celesta top, grand but short" |

### 7.4 After generation

1. Wrap the PCM into WAV (`ffmpeg -f s16le -ar 48000 -ac 2`) and write a `*.gen.json` (plan, seed, model, request id, date).
2. Run `find-loops.py`:
   - search the start in A and the end in the A reprise;
   - look for a minimum length equal to the loop body − 1 bar;
   - apply the §2.5 acceptance criteria;
   - if no take passes after 2 seeds, fall back to `music_v1` with `respect_sections_durations: true`.
3. Estimate the grid: BPM, first beat, and a downbeat confirmed by ear.
4. Master to −20 LUFS-I (§2.4).
5. Run `segment-music.py`: 8-bar segments with 100 ms tails, loop segments aligned to the loop points.
6. Encode Opus and m4a.
7. `verify-loudness`.
8. Generate the manifest.
9. **Listening test:** at least 3 full loops per cue on laptop speakers and on headphones; check the seam, the pressure layer over the cue, and every stinger over the cue.

---

## 8. Implementation order

| Phase | Work | Size | Exit criteria |
|---|---|---|---|
| **A: foundation** | `AudioEngine`, lifecycle, settings, manifest and probe, `DecodeCache`; `tools/audio/master` + `find-loops`; re-master the KEEP assets and the 3 music tracks with loop points; the 38 procedural recipes; `SfxPlayer`; `VoiceQueue` running on the normalised legacy VO; `AudioEventRouter` for the existing event kinds; F9 overlay | ~3 dev-days | Steady and title loops seamless in Chrome and Safari; the iOS unlock works; settings persist; recipe offline tests pass. |
| **B: adaptive city** | `MusicDirector` (v1: single-buffer title, steady and victory) + state rules + pressure layer; generate the 5 cues, the defeat cue and the stingers; `segment-music.py` + `SegmentPlayer`; `AmbienceDirector` + beds; `EmitterManager` + positional loops; world one-shots | ~4–5 dev-days | The §4.7 table-driven tests pass; memory stays inside the §2.6 budgets on an iPad (Safari Web Inspector); no seam or join clicks on 44.1 kHz or 48 kHz devices. |
| **C: voice and polish** | Generation key; pronunciation dictionary; one VO batch (§5.2 + §5.3); anchor chain; the remaining GENERATE SFX; loudness CI; accessibility options; manual QA matrix (§4.14) | ~3 dev-days + listening | Every asset passes `verify-loudness`; "Important only" produces ≤ 1 line per close in a 60-month autoplay; no VO overlaps. |

**Dependencies on other workstreams:**
- **Bridge §7:** `GameEventKind` list, including the kinds marked **\***.
- **EXT flags:** finance (loans, credit, tax, IPO, dividends, stock) and macro (climate, policy rate), all from bridge-spec §8.
- **Renderer:** `AudioFrame` (zoom bands, focus, the land-use grid for the summed-area tables, lighting and weather), plus truck agents.
- **Advisor rules** (UX §6.15, bridge-spec §4.6.9): the hint predicates.

---

## 9. Open questions (decisions for the lead or the user)

1. **ElevenLabs key and tier.**
   - The key in `~/.claude/voice/key` can't read the account, models or voices, and most likely can't generate music or SFX.
   - Options: provide or create a generation key with the §3.2 scopes, or widen this one.
   - Also confirm the tier allows 48 kHz PCM/WAV output and commercial music use.
   - Can one of the two other configured ElevenLabs keys (desktop MCP, `~/.claude.json`) be used? I did not use or probe them.
2. **Advisor persona.**
   - The UX report suggests "Morgan, your COO"; this brief asks for a CFO/advisor tone; caplab-brief adds a CFO role.
   - The lines here avoid any title, so only the UI name and portrait need a decision.
   - Keep Hope as the voice? Recommended: yes, for continuity with the legacy lines.
3. **Cast.**
   - Proposed: advisor plus news anchor.
   - UX §12 Q7 also floats a banker voice, which would add ~10 lines for loans and credit.
4. **TTS model for the batch.**
   - `eleven_multilingual_v2`: consistent with the legacy lines and proven.
   - `eleven_v4`: released 2026-09-28, more expressive, promo price until Oct 12.
   - Recommendation: A/B 5 lines and lock one.
5. **Legacy VO.** Re-record the 10 legacy lines in the new batch for the web client (recommended; the Godot client keeps the old files), or reuse them normalised?
6. **Event contract and insolvency rule.**
   - Adopt the \* event kinds in bridge-spec §7.
   - Decide the insolvency rule: 6 negative month-ends today, or 3 months of unpaid interest. The VO is rule-agnostic, but the countdown and `insolvencyWarning` need one definition.
7. **Renderer inputs.**
   - Will there be a time-of-day lighting state and cosmetic weather?
   - If not, drop the night, insect, rain and thunder assets (7 generations) and hard-wire `day = 1`.
8. **Zoom bands.** The plot size is settled (12 m, `web/src/scene/units.ts`). Confirm the Street, District and City zoom-band distances; this plan assumes the log mapping over `MapControls` 40–1,800 m (§4.15).
9. **Rival buildings.** Should they emit city sound? Proposed: yes, with the player's buildings at +2 dB.
10. **Optional lounge playlist.** A "lounge radio" music mode (a light-jazz playlist) as a nod to classic tycoon games, selectable in Settings. Not planned; say if wanted.

---

## Appendix A: reproducing the measurements (scratch only)

```
S=/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/audio-plan
python3 $S/measure.py                         # loudness/TP/LRA/M-max/silence → measure.json (ffmpeg 7.1.1 at /usr/local/bin)
python3 $S/loopcheck.py                       # head/tail envelopes, seam spectra, tempo candidates
python3 $S/findloop.py gameplay_loop 1,45 60,103 50 ; python3 $S/seamtest.py gameplay_loop 25.8438 95.6620
python3 $S/findloop.py title_theme 1,40 40,86 40    ; python3 $S/seamtest.py title_theme 12.5388 80.5388
python3 $S/master.py <in> <out> vo|music|sfx:<M-target> [trimHeadSec]   # verified mastering chain
cd $S/codec && python3 -m http.server 8767 & node cdp.mjs              # browser decode test (headless Chrome 154)
python3 $S/vo_script.py && python3 $S/vo_tables.py                    # VO word counts + tables
```

The spectrograms are in `$S/png/` (`spec_*.png`, `wave_*.png`, `spec_*_seam.png`). The Whisper transcripts are in `$S/vo_transcripts.json`.

## Sources

- ElevenLabs API reference:
  - [Sound generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
  - [Music compose](https://elevenlabs.io/docs/api-reference/music/compose)
  - [Text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
  - [Models](https://elevenlabs.io/docs/overview/models)
  - [API pricing](https://elevenlabs.io/pricing/api)
  - [Eleven v4 announcement](https://elevenlabs.io/blog/eleven-v4)
- WebKit:
  - [WebKit features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) (Ogg Opus and Vorbis)
  - [WebKit bug 226922](https://bugs.webkit.org/show_bug.cgi?id=226922) (`decodeAudioData` vs WebM Opus)
  - [Frequal: Ogg Opus in Safari 18.4](https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html) (recording gaps)
- three.js docs: [AudioListener](https://threejs.org/docs/pages/AudioListener.html), [AudioContext.setContext](https://threejs.org/docs/pages/AudioContext.html), [PositionalAudio](https://threejs.org/docs/pages/PositionalAudio.html), [Audio.setLoopStart](https://threejs.org/docs/pages/Audio.html)
