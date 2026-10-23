# tools/audio — Magnate audio mastering pipeline

Turns the source audio into the files the web client ships, with loudness, true peak and loop points
under control. Spec: `docs/overhaul/research/audio-plan.md` §2 (formats, loudness, mastering, loop points).

```
python3 tools/audio/master.py            # incremental build (unchanged assets are reused byte-for-byte)
python3 tools/audio/master.py --force    # rebuild everything (bit-exact: same bytes as before)
python3 tools/audio/master.py --only music.title,upgrade
python3 tools/audio/verify_loudness.py   # CI check of what is in web/public/audio (exit 1 on failure)
python3 tools/audio/vo_level_report.py   # ebur128 level report of the mastered VO → tools/audio/reports/vo-levels.{md,json}

# procedural audio (needs a build: cd web && npx vite build)
node tools/audio/recipe-levels.mjs                 # verify every recipe / bed / loop against its class target
node tools/audio/recipe-levels.mjs --calibrate     # re-derive the per-recipe trims after editing recipes
node tools/audio/audiolab-check.mjs                # live engine check in headless Chrome (+ screenshot)
node tools/audio/game-audio-trace.mjs              # play the real game and capture the router's decision trace
                                                   #   [--months 24] [--economy-months 36] [--advisor important|all|off]
```

Requirements: python3 with numpy + scipy (the Anaconda python on this machine has both) and an
**ffmpeg ≥ 5 with libopus**. The script finds `$FFMPEG`, `/usr/local/bin/ffmpeg`,
`/opt/homebrew/bin/ffmpeg`, then `PATH`, and skips builds without libopus (the Anaconda ffmpeg 4.2 that
may be first on `PATH` is one of those). On macOS the AAC fallback uses AudioToolbox (`aac_at`), else
ffmpeg's native `aac`.

## Files

| File | Role |
|---|---|
| `sources.json` | Source registry: class targets (§2.3), every kept asset (source path, class, trims, loop points, grid, subtitle text), the **VO sets** (`voSets`: the a2 batch in `assets-src/vo/manifest.json`), retired assets and provenance. **Edit this, not the manifest.** |
| `master.py` | The pipeline (below). Writes `web/public/audio/**`, `web/public/audio/manifest.json` and `web/src/audio/assets/probe.generated.ts`. |
| `verify_loudness.py` | Decodes every delivered `.ogg` and `.m4a`, measures them with ffmpeg `ebur128` (true-peak mode) and checks targets ±1 LU, true-peak ceilings, SFX head silence ≤ 5 ms, sample-exact Opus length and loop QA. |
| `audiolib.py` | Shared helpers: ffmpeg discovery and PCM I/O, a numpy BS.1770-4 meter (K-weighting, gating, M-max, 4× true peak), seam baking and seam QA. |
| `probe.ogg` | 20 ms of silent Ogg Opus. Its base64 is the runtime codec probe (`decodeAudioData` succeeds → use `.ogg`, else `.m4a`). |
| `recipe-levels.mjs` | Offline level test of the **procedural** audio in headless Chrome (through the AudioLab): every recipe rendered through its live chain (calibrated trim + class peak guard) and measured with the BS.1770 meter; every procedural bed / positional loop / music layer checked for LUFS-I, true peak and a click-free wrap. `--calibrate` re-derives `web/src/audio/synth/calibration.json` (`--only a,b` for a few recipes). |
| `audiolab-check.mjs` | Live end-to-end check of the running engine in headless Chrome: unlock by a real click, manifest + codec probe, SFX on the bus meters, music states driven by synthetic game events, an advisor line with its subtitle and the −10 dB music duck, the anchor chain after the news sting, the voice-line browser, then a screenshot. |
| `vo_level_report.py` | ffmpeg `ebur128` (true peak, dual-mono) on every mastered VO line in both formats, plus LRA, head/tail silence and the trim applied → `reports/vo-levels.{md,json}`; exit 1 outside −18 ±1 LU / −1.5 dBTP. |
| `game-audio-trace.mjs` | Plays the real game (tutorial through the UI, then an autopilot economy game) at 8× and dumps the audio decision trace (`window.__magnateAudio`) → `web/test-results/audio-trace/{summary.md,trace.json,game.png}`. |

## Chains (48 kHz float throughout)

| Class | Chain | Target (measured on the delivered file) |
|---|---|---|
| music | [head trim] → highpass 25 Hz → **bake loop seam** → gain → 4× oversampled limiter −2 dB | −20 LUFS-I, ≤ −1.5 dBTP |
| vo | highpass 70 Hz → compressor 2.5:1 at −24 dB (5/80 ms, knee 4) → gain → limiter −2 dB | −18 LUFS-I **dual-mono**, ≤ −1.5 dBTP |
| sfx | head silence → ≤ 5 ms, tail cut at −60 dB + 20 ms fade → highpass 30 Hz → [eq] → gain → limiter | M-max per class: ui_micro −30, ui_notice −26, economy −22, event/alert −18, stinger −14, world −20 |
| bed / loop3d | (ready for GENERATE assets) | −26 / −24 LUFS-I |

* Gains come from the numpy meter; the encoded `.ogg` is then decoded and re-measured with ffmpeg
  `ebur128`. If it misses the target by > 0.3 LU or exceeds the true-peak ceiling, the asset is re-rendered
  with a corrected gain / lower limiter ceiling (≤ 4 passes).
* **Dual-mono:** a mono file played on the stereo bus without a panner is duplicated into L and R, i.e.
  3 dB louder than a single-channel BS.1770 reading. VO and non-positional SFX are therefore measured
  with `ebur128=dualmono=true`; positional mono loops (equal-power panner) are measured single-channel.
* SFX with `"channels": "auto"` are folded to mono when their side/mid energy is below −25 dB.
* Encodes: Ogg Opus (`libopus`, constrained VBR, `-application audio`, 20 ms frames) and `.m4a`.
  `-fflags +bitexact` makes the outputs byte-identical across runs (no random Ogg serials, no encoder tags).

## Voice-over (VO sets)

`sources.json` → `voSets` names VO batches instead of listing lines one by one. Today there is one: the a2-voice batch
(`assets-src/vo/manifest.json`, 108 lines, 106 voiced; Kokoro stand-ins, see `docs/overhaul/status/a2-voice.md`). For
every line with a `file`, `master.py` adds a `vo` asset:

* id `vo.<line id>`, files `vo/<line id>.{ogg,m4a}`, class `vo` (Opus 64 kbps mono / AAC 96 kbps);
* chain: **edge trim** (keep 30 ms before the first and 150 ms after the last 5 ms window above −50 dBFS; 5 ms / 20 ms
  edge fades — the masters carry 120 ms pads), then the VO chain above to −18 LUFS-I dual-mono, ≤ −1.5 dBTP;
* manifest fields: `line`, `role` (advisor | anchor), `text` (the subtitle), `durationSec`, `priority`, `legacyAlias`,
  `aliases`, `tts` when the spoken text differs, `trimmedFromSec`, and per-line provenance (provider, model, voice,
  why ElevenLabs was not used).

The manifest's top-level `vo` section lists held lines (`file: null`, shown as subtitles only) and maps the legacy Godot
names (`legacyMap`, e.g. `vo_welcome` → `vo.adv.onboard.welcome`) and the superseded UX ids (`aliasMap`). The ten legacy
Godot takes are no longer shipped to the web build (they stay in `client/assets/audio/vo` for the Godot client).

Re-voicing (e.g. ElevenLabs once credits return): regenerate with `tools/voice`, then `python3 tools/audio/master.py`
— changed sources are re-mastered (content-hash keys), nothing else changes. Runtime routing lives in
`web/src/audio/data/vo-lines.json` (priorities, limits) and `data/audio-events.json` (which events raise which line).

## Loops (§2.5)

Loop points in `sources.json` are seconds from the first sample of ffmpeg's decode of the *source*
(head trims are subtracted automatically). The seam is **baked into the file**: over the last `seamSec`
before `loopEnd`, the audio that precedes `loopStart` is mixed in with equal-power curves, so a plain
`AudioBufferSourceNode` `loopStart`/`loopEnd` wrap is seamless with no runtime crossfade. The runtime
never wraps the whole buffer, which makes loops immune to codec padding (AAC adds 256 tail samples, MP3
without a Xing header adds 1,105 + 431). The original continuation after `loopEnd` stays in the file as
the cue's ending (`tail` in the manifest).

`manifest.json` records per loop `startSec/endSec`, the exact 48 kHz sample indices and the seam QA
measured on the decoded Opus: envelope correlation and mean |Δ| dB against the true continuation through
`loopStart`, spectral-flux onset correlation, and the sample jump at the wrap vs the 99th percentile of
normal sample-to-sample motion. Acceptance: env r ≥ 0.93, mean |Δ| ≤ 1.0 dB, onset r ≥ 0.85.

## Adding an asset

1. Put the lossless master somewhere stable (GENERATE assets: keep the `*.gen.json` provenance next to it).
2. Add an entry to `sources.json` (`id`, `kind`, `class`, `src`, `out`, `channels`, optional `loop`, `grid`,
   `trimHeadSec`, `eq`, `text`, `variant`, `preload`).
3. Run `master.py`. The runtime picks the asset up from the manifest by id; procedural fallbacks
   (`web/src/audio/synth/`) are used only while an id has no file.

Nothing here calls ElevenLabs or any other paid API; generation is a separate, user-approved step
(audio-plan §3, §8 phase C).

## Procedural audio levels

The 38 §6.2 recipes, the procedural stand-ins for GENERATE assets and the stingers are synthesised at run
time (`web/src/audio/synth/`). Their levels follow the same §2.3 class targets as the files:

* `recipe-levels.mjs --calibrate` renders each recipe raw (8 renders; 40 when the peak is close to binding)
  and stores a per-recipe trim in `calibration.json`, compiled into the client.
* Every procedural voice plays through `trim → peak guard → voice gain`. The guard (a WaveShaper that is
  the identity below −3.1 dB under the class ceiling and a tanh shoulder above it) turns the class peak
  ceiling into a guarantee: noise-based transients have a 2–5 dB random spread of sample peak from
  trigger to trigger, which a fixed trim cannot hold.
* **Transients** (declared length < 0.4 s, the momentary window) that cannot reach their M-max target
  under the ceiling are calibrated 0.5 dB under it and flagged `peakLimited` ("peak-bound"); a 25 ms click
  physically cannot read −30 LUFS-M with peaks ≤ −12 dBFS. **Longer sounds** must land within ±2 dB; they
  may lean on the guard by up to 1.5 dB on their loudest render, and a long sound that still cannot reach
  its target is a recipe to fix (lower its crest factor), not a calibration to relax.
* The JS meter (`web/src/audio/synth/loudness.ts`) is BS.1770-4 exact (EBU Tech 3341 case 1 reads −23.0)
  and agrees with ffmpeg `ebur128` to ≤ 0.05 LU on the shipped files.
