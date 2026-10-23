# a2-voice: VO pipeline and the voice-over batch

**Status:** **DONE, final QA passed.**
- 106 of 108 lines are voiced. 2 lines are held by the plan.
- **The shipped set is Kokoro (local), for both roles**, because ElevenLabs is out of credits. §2 explains how to re-voice it with ElevenLabs later.
- Independent final QA: **106/106 pass** (`assets-src/vo/QA-final.md`).
- Branch `a2-voice` · 2026-10-01
**Owns:** `tools/voice/**`, `assets-src/vo/**`, this file. Nothing else was touched.

## 1. Outcome

| Item | Result |
|---|---|
| Script | `tools/voice/lines.json`: **108 lines** = 60 advisor + 13 anchor (audio-plan §5.2), 17 UX lines (§5.3 / UX §9), 13 templated lines written here, 5 legacy tutorial steps. **2 held** by the plan (§8), **106 voiced**. |
| Legacy names | All 10 legacy `vo_*` names map to new files (`manifest.json` → `legacyMap`). 19 UX ids are aliases of §5.2 lines (`aliasMap`). |
| Voice | **Kokoro-82M (local, Apache-2.0) for both roles**: advisor `af_heart`, anchor `bm_george`. ElevenLabs has no credits left (§2). |
| Masters | `assets-src/vo/{advisor,anchor}/<id>.wav`: 48 kHz, mono, 16-bit, 120 ms head and tail, unmastered. Each has an `<id>.gen.json`. |
| Manifest | `assets-src/vo/manifest.json` |
| Final QA (independent) | **106/106 lines pass** every check in `assets-src/vo/QA-final.md`: coverage, decode, duration, pace, true peak, silences, per-role loudness spread (1.4 / 0.5 LU), one provider, model and voice per role, Whisper transcript, and "magnate". One line was re-phrased (`adv.cash.negative`) and one transcript failure was a false positive (`adv.rnd.rival_patent`); details in §6.1. |
| Generator QA | Advisor **93/93** inside the pace band, 92/93 exact transcripts. Anchor **12/13** in band, 13/13 exact. 0 hard QA failures (no clipping, no pause over 600 ms). "Magnate" is heard correctly in both lines. 6 lines want a human listen (§7). |
| Offline | **Proved.** The whole batch was re-rendered from scratch on 2026-10-01 with `node tools/voice/generate.mjs --provider kokoro --offline --no-cache --out tools/voice/.tmp/vo-offline`. That flag set means no network (`fetch` is disabled and Hugging Face runs offline) and no take cache. It made 324 Kokoro renders, including the Whisper search, in 33 min on a loaded machine, and **all 106 masters are byte-identical** to the committed ones (`node tools/voice/compare-outputs.mjs assets-src/vo tools/voice/.tmp/vo-offline` → identical 106, different 0, missing 0). |
| Cost | The batch billed **0 ElevenLabs credits**. Earlier in this workstream: 806 credits (3,368 characters): probe 11, model A/B 795. |

## 2. ElevenLabs is out of credits

- The key worked for the probe and the model A/B. Then every request returned `401 quota_exceeded`: "This request exceeds your quota of 55533. You have 0 credits remaining". **Re-checked four times this morning, last at 08:06 SAST: still 0 credits.** A rejected request costs nothing.
- The user's instruction is "use Kokoro if ElevenLabs is not available", and the rule is one provider per role. So the generator moved **each whole role** to Kokoro on its own, and logged why in `manifest.json` → `roles.<role>.fallback`.
- **Side effect:** the same key drives the spoken-updates tool (`~/.claude/voice/speak.sh`). Until credits return it falls back to the macOS system voices.
- The key cannot read its own balance (no `user_read`). The account had about 800 credits left when this work started.
- **To voice the batch with Hope and Daniel later**, add credits and run `node tools/voice/generate.mjs`. It re-voices both roles with ElevenLabs; nothing else needs to change.
  - `--dry-run`: 106 lines × 3 takes ≈ **20,250 characters ≈ 8,100 credits** at the 0.40 credits/character that `eleven_multilingual_v2` cost here. 13 of those takes are already cached from the A/B, so ≈ 7,800 credits are billed.
  - If credits run out halfway, the role stays whole: take 1 of every line is fetched first, and a role that cannot finish take 1 stays on Kokoro.

## 3. Regenerating

**One-time setup** (everything installs inside `tools/voice` and is gitignored):
```bash
cd tools/voice
npm ci                                                          # kokoro-js 1.2.1 → transformers.js 3 + onnxruntime-node (CPU), phonemizer (espeak-ng WASM)
python3 -m venv .venv && .venv/bin/pip install faster-whisper cmudict   # transcript QA (Whisper base.en) + CMUdict for the independent QA
```
- The first Kokoro run downloads the fp32 ONNX weights (≈ 320 MB) into `.cache/hf-js`.
- The first QA run downloads Whisper `base.en` (≈ 140 MB) into `.cache/whisper`.
- After that, `--offline` needs no network at all (proved in §5).

**The ElevenLabs key** comes from `ELEVENLABS_API_KEY`, else the file named by `ELEVENLABS_API_KEY_FILE`, else `~/.claude/voice/key`. It is sent only as the `xi-api-key` header and never logged or written.

| Task | Command (from the repo root) |
|---|---|
| Rebuild the script after editing the docs or `lines.authored.json` (incl. per-line `ttsOverrides`) | `node tools/voice/parse-script.mjs` (`--check` exits non-zero if `lines.json` is stale) |
| Check what a key can do (formats, models, dictionary; ≈ 36 characters) | `node tools/voice/probe-elevenlabs.mjs` |
| Whole batch: ElevenLabs per role, Kokoro for any role it can't voice | `node tools/voice/generate.mjs` |
| Whole batch locally, no network | `node tools/voice/generate.mjs --provider kokoro --offline` |
| Show the bill before spending | `node tools/voice/generate.mjs --dry-run` |
| Some lines, more takes (keep `--provider kokoro` while the set is Kokoro, so a role never mixes providers) | `node tools/voice/generate.mjs --provider kokoro --only adv.cash.negative,news.intro --takes 5` |
| Re-pick takes from the cache (no synthesis) | `node tools/voice/generate.mjs --reselect` |
| Render the two held tutorial lines once their text is final | `node tools/voice/generate.mjs --include-held` |
| QA tables (Markdown) | `node tools/voice/qa-summary.mjs` |
| Independent QA of the masters (re-measures everything with ffmpeg + Whisper; exit 1 on any failure) | `tools/voice/.venv/bin/python tools/voice/qa-independent.py` → `tools/voice/reports/qa-independent.json` |
| Compare two output dirs (e.g. an offline re-render) | `node tools/voice/compare-outputs.mjs assets-src/vo <dir>` |
| Model A/B | `node tools/voice/generate.mjs --ab` |
| Kokoro proof samples | `node tools/voice/generate.mjs --provider kokoro --samples [--role anchor --kokoro-voice am_michael]` |

Other flags: `--role advisor|anchor`, `--out <dir>`, `--force`, `--no-stt`, `--no-cache`, `--concurrency N` (default 2).

**Idempotence and billing:**
- A line is skipped with no API call when its `<id>.gen.json` holds the same `lineHash`. The hash covers the sent text, voice, model, settings, seeds, format, the QA thresholds, the pace target, the selection version and (Kokoro) the speed-search rule and config.
- Every take is cached in `tools/voice/.cache/tts/<provider>/` under `hash(sent text + voice + model + settings + seed/take + format)`, so an unchanged take is never billed twice.
- The ElevenLabs client:
  - retries 429, 5xx and network errors with exponential backoff (honouring `retry-after`, up to 5 retries);
  - runs 2 requests at a time (the tier allows 3; the spoken-updates tool needs the third);
  - treats `401`/`403`/quota errors as "provider unavailable", which triggers the per-role Kokoro fallback;
  - steps down the output formats (`wav_48000` → `pcm_48000` → `mp3_44100_192` → `mp3_44100_128`) if a format is refused mid-run. The probe picks the starting format. Tested against a mocked API, since the real one has no credits.

**Pipeline per line:**
1. **Render takes.**
   - ElevenLabs: 3 takes, seed = `crc32(id) + take`.
   - Kokoro is deterministic, so its takes search the speed instead: 3 takes, up to 6 while none is a keeper (§5).
2. **Convert** to 48 kHz mono s16 with ffmpeg 7.1 and soxr.
3. **Find the voiced span** on a 10 ms RMS envelope with adaptive thresholds.
4. **Trim** to 120 ms either side, zero-padding when the source has less, with 10 ms raised-cosine edge fades.
5. **Measure:** pace, longest internal pause, sample peak and clipping, EBU R128 LUFS-I, LRA and true peak.
   - **Pace is word-length-neutral:** syllables per second (espeak-ng phonemes) × 60 / the role's mean syllables per word (advisor 1.49, anchor 1.75), reported as "wpm-eq". A line of one-syllable words read at a calm rate would otherwise score 190 wpm, and a line of long words 130. The raw wpm is recorded too.
6. **Transcribe** with Whisper `base.en`. No prompt, so a mispronunciation can't be hidden.
   - Whisper sometimes keeps "talking" into the silent padding after a short clip ("We'll see you next week." ×3). A trailing segment with a raised no-speech probability and an impossible word rate (> 8 words/s) or a repetitive text is dropped and kept as `droppedTail`.
   - Homophones no listener can separate (cash/cache, loan/lone) and "a hundred" vs "100" are merged before comparing. "Magnate"/"magnet" are never merged.
7. **Score and keep the best take.**
   - Rejected outright: clipping, a pause over 600 ms, transcript CER over 0.08, or "magnate" heard as "magnet".
   - Among the rest, the score ranks pace (distance from the role band, then from its centre), then CER, low-confidence words (p < 0.3) and pause length.
   - Rejected takes go to `assets-src/vo/_takes/<id>/` (gitignored).

## 4. ElevenLabs probe and model decision

**Probe** (`tools/voice/reports/elevenlabs-probe.json`, phrase "Ready."):

| Check | Result |
|---|---|
| `wav_48000` | **OK → chosen** |
| `pcm_48000` | OK (the wrapper is implemented, as s16le mono 48k) |
| `mp3_44100_192` | 403 `output_format_not_allowed`: "only available on the Creator tier and above" |
| `mp3_44100_128` | OK |
| `eleven_multilingual_v2`, `eleven_v4` | both accepted |
| Daniel `onwK4e9ZLuTAKqWW03F9`, Hope `uYXf8XasLslADfZ2MB4u` | both OK |
| Pronunciation dictionary | 401 `missing_permissions` (`pronunciation_dictionaries_write`). The aliases are baked into the `tts` text instead: Magnate → "Mag-nate", IPO → "I.P.O.", R&D → "R and D", CFO → "C.F.O." (`tools/voice/pronunciation.json`). |
| Tier hints | `maximum-concurrent-requests: 3` and the 192 kbps refusal both point to the Starter tier. The quota is 55,533 credits. The `character-cost` header ran ≈ 0.40 credits/character on v2 and ≈ 0.11 on v4 (launch promo). |

**A/B** (`tools/voice/reports/model-ab.json`):
- Same 5 advisor lines for every variant: welcome, cash negative, IPO eligible (`tts` "I.P.O."), defeat bankrupt ("magnate"), price war. Same 3 anchor lines.
- Same seeds for every model. Objective proxies only.

| Round | Role | Variant | Takes | Pace, wpm-eq | Raw wpm | In band (pace) | Max pause | LUFS σ | Mean CER | Exact transcripts | Rejected | Credits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (plan settings) | advisor | v2 @ speed 0.92 | 10 | 187.1 | 178.2 | 1/10 | 440 | 1.48 | 0.025 | 7/10 | 1 | 260 |
| 1 | advisor | v4 @ 0.92 | 10 | 152.2 | 144.8 | 6/10 | 440 | 0.63 | 0.028 | 8/10 | 2 | 72 |
| 1 | advisor | v4 + delivery tag @ 0.92 | 5 | 156.3 | 148.7 | 3/5 | 340 | 2.17 | 0.015 | 4/5 | 0 | 40 |
| 1 | anchor | v2 @ 1.0 | 3 | 146.5 | 142.3 | 2/3 | 570 | 0.50 | **0** | 3/3 | 0 | 71 |
| 1 | anchor | v4 @ 1.0 | 3 | 142.9 | 138.7 | 2/3 | 430 | 0.26 | 0.019 | 2/3 | 0 | 20 |
| 2 (pace-calibrated) | advisor | **v2 @ 0.82** | 10 | **156.8** | 149.4 | 5/10 | 600 | 1.32 | **0.011** | 7/10 | **0** | 260 |
| 2 | advisor | v4 @ 1.0 | 10 | 152.1 | 144.8 | 6/10 | 380 | 0.72 | 0.164 | 9/10 | 1 | 72 |
| 2 | advisor | v4 + tag @ 1.0 | — | skipped: quota exhausted | | | | | | | | |
| 2 | anchor | v2 / v4 @ 1.1 | — | skipped: quota exhausted | | | | | | | | |

The advisor band is 150–165 (audio-plan §5.1). The anchor band is 140–170, a choice made here because the plan sets no anchor pace. "Rejected" counts takes with a hard QA failure.

**Locked: `eleven_multilingual_v2` for both roles. Advisor `speed` 0.82 instead of the plan's 0.92; anchor stays at 1.0** (`tools/voice/lib/config.mjs`).

Why:
1. **v2's pace follows `speed`.**
   - 0.92 gave 187 wpm-eq (178 raw), far above the band 0.92 was meant to hit; the plan derived it from the legacy files.
   - 0.82 gave 156.8 wpm-eq, the centre of the band.
   - **`eleven_v4` ignores `speed`:** 0.92 and 1.0 produced the same durations to within 0.05 s on all 10 takes. Its pace happens to sit near the band, but it can't be tuned without changing the text.
2. **Transcript accuracy and artefacts.**
   - v2 at the calibrated pace had **no rejected takes** and the lowest CER.
   - v4 had rejected takes in both runs:
     - take 2 of "welcome" left a trailing artefact both times. Whisper transcribed it as "Yes. Yes." in one run and as a 20-word hallucination in the other;
     - take 2 of "cash negative" ended in an echoed "…ability".
   - v2 at 0.92 showed the same "welcome" tail once.
   - On the anchor, v4 swapped "a recession" for "the recession", while v2 was exact on all three lines.
3. **Loudness spread favoured v4** (σ 0.6–0.7 vs 1.3–1.5 LU). That doesn't decide anything, because mastering normalises every line to −18 LUFS.
4. **Delivery tags** (`[warm] …`, v4 only) gave the best CER but the widest loudness spread, and no evidence that they help. They are off by default (`--tags`).
5. **Not run:** the anchor at speed 1.1 and the tags variant at 1.0. The anchor at 1.0 already reads inside its band (146.5 wpm-eq), so 1.0 stays. Re-run `--ab` once credits return to confirm.

The A/B takes are kept locally in `assets-src/vo/_ab/<variant>/<id>/` (gitignored) for listening.

## 5. Kokoro: the voice of this batch

| Item | Value |
|---|---|
| Runtime | `kokoro-js` 1.2.1 (npm), `onnx-community/Kokoro-82M-v1.0-ONNX`, fp32, `onnxruntime-node` on the CPU. Phonemes come from espeak-ng compiled to WASM. Apache-2.0 weights. |
| Install | Clean on this Intel i9 Mac. (The Python `kokoro` package needs torch, whose last x86_64 macOS wheel is 2.2; it was not needed.) |
| Advisor | `af_heart` (Kokoro's grade-A American female, warm), take-1 speed 0.84 |
| Anchor | `bm_george` (British male, the closest match to Daniel), take-1 speed 1.18 |
| Alternative anchor | `am_michael` (American male): samples beside the `bm_george` ones in `assets-src/vo/_kokoro_samples/anchor/*.am_michael.wav` |
| Proof samples | `assets-src/vo/_kokoro_samples/` (`samples.json`): 3 lines per role. All 6 transcribed exactly by Whisper, "magnate" recognised. The 3 `am_michael` alternates are exact too. |
| Throughput | ≈ 1–1.5 s per take (render + transcript) on an idle machine. This batch rendered 312 takes in 32 min under a load average of 12–30 from parallel workstreams (≈ 6 s per take). |
| Offline | **Proved.** The whole batch was re-rendered from scratch on 2026-10-01 with `node tools/voice/generate.mjs --provider kokoro --offline --no-cache --out tools/voice/.tmp/vo-offline`. That flag set means no network (`fetch` is disabled and Hugging Face runs offline) and no take cache. It made 324 Kokoro renders, including the Whisper search, in 33 min on a loaded machine, and **all 106 masters are byte-identical** to the committed ones (`node tools/voice/compare-outputs.mjs assets-src/vo tools/voice/.tmp/vo-offline` → identical 106, different 0, missing 0). |

**Kokoro's speed control is a staircase, which shaped the take scheme.** Each phoneme lasts `round(d / speed)` frames, and many tokens share d ≈ 2. So the pace jumps where 2/speed crosses x.5 (speed 0.80 and 1.33) and hardly moves in between. Measured voiced length:

| Line, voice | speed → voiced seconds |
|---|---|
| "The creditors have taken over…" `af_heart` | 0.78 → 5.43 · 0.795 → 5.36 · **0.80 → 5.09 · 0.805 → 4.68** · 0.82 → 4.43 · 0.84 → 4.35 · **0.88 → 4.25 · 0.90 → 4.25** · 1.00 → 3.85 |
| "Stocks plunge in heavy trading…" `bm_george` | 1.30 → 3.16 · 1.32 → 3.16 · **1.33 → 3.09 · 1.34 → 2.69** · 1.36 → 2.62 · 1.40 → 2.59 |

- A 1.3 % speed change around 0.80 shortens the line by 13 %, while 0.88 and 0.90 render the same length.
- The first Kokoro batch (3 fixed speeds, ×1.00/0.93/1.07 of 0.90 or 1.10) therefore put only **29 of 106** chosen takes inside the band, measured as above. Many lines jumped clean over the band between two of the fixed speeds.

**Take scheme (`kokoroTakes` in `generate.mjs`, `nextKokoroSpeed` in `lib/kokoro.mjs`):**
1. Take 1 renders at the role's base speed: the median speed the first batch needed for the band centre.
2. Each further take aims at the band centre: proportionally while every take sits on one side of it, then by regula falsi inside the tightest bracket.
3. Every take is measured and transcribed as it renders, through a long-lived Whisper worker (`stt.py --serve`).
4. The search stops when there are 3 takes and one is a **keeper** (in the band, no hard failure, transcript exact). Otherwise it continues up to 6 takes, and stops early when the bracket is narrower than 0.004 (the band sits inside one step) or the speed limits leave nothing new.
5. The normal selection then picks among all takes.

## 6. QA results (chosen takes)

Masters as committed (`tools/voice/reports/qa.json` has every line; `node tools/voice/qa-summary.mjs` prints this):

| Metric | Advisor (`af_heart`) | Anchor (`bm_george`) |
|---|---|---|
| Lines | 93 | 13 |
| Takes considered | 282 (3.0 per line) | 42 (3.2 per line) |
| Pace, wpm-eq: mean (range) | 157.9 (150.2–164.6) | 153.1 (136–158.6) |
| **Inside the band** | **93/93** (150–165) | **12/13** (140–170) |
| Raw wpm: mean (range) | 160.6 (94.5–235.3) | 155.8 (111.4–198.8) |
| Longest internal pause | 590 ms | 320 ms |
| LUFS-I range (unmastered) | −22.8 to −21.4 | −21.8 to −21.3 |
| Max true peak | −0.8 dBTP | −3.6 dBTP |
| Exact transcripts | 92/93 | 13/13 |
| CER ≤ 0.08 | 93/93 | 13/13 |
| Hard QA failures | 0 | 0 |
| Kokoro speed: min / median / max | 0.70 / 0.84 / 1.18 | 1.03 / 1.18 / 1.32 |
| Total length | 416.0 s | 49.4 s |

- The first Kokoro batch (3 fixed speeds, raw-wpm selection) had **29 of 106** chosen takes in the band; this one has **105 of 106**.
- **"Magnate":** `adv.end.defeat_bankrupt` → "…Every great magnate has a second act." and `vo_milestone_1b` → "…That's the mark of a true magnate." Both heard as "magnate", not "magnet".
- The raw-wpm extremes are the expected ones for word length: `vo_goal_generic` ("Objective complete.") reads at 94.5 raw wpm and the one-syllable `vo_deadline_12` ("One year left on the clock.") at 235.3, both at a normal syllable rate.

### 6.1 Final independent QA

`assets-src/vo/QA-final.md` has the report; `tools/voice/reports/qa-independent.json` has every line.

- **What was checked.** `tools/voice/qa-independent.py` re-measures every master without using the generator's numbers:
  - ffprobe: format;
  - ebur128: LUFS and true peak;
  - silencedetect at −45 dBFS;
  - CMUdict syllables for pace, instead of espeak;
  - Whisper `base.en` **with** VAD, a different decoding path from the generator's.
- **Result: 106/106 voiced lines pass.**
  - Durations 1.51–7.19 s.
  - True peak ≤ −0.8 dBTP.
  - Lead and tail silence ≤ 178 ms; internal pauses ≤ 609 ms.
  - LUFS spread: 1.4 LU (advisor) and 0.5 LU (anchor).
  - One provider, model and voice per role.
  - Pace 139–175 wpm-eq, all inside the 130–185 gate.
  - 105/106 exact transcripts.
  - "Magnate" heard as "magnate" in both lines.
- **Fixed: `adv.cash.negative`.** Kokoro read "…in the red costs, | interest and credibility", with a ≈ 0.35 s break that made "costs" sound like a list item. The fix is a spoken-text override: "…costs interest, and credibility." It was re-rendered with Kokoro, take 3 at speed 0.826. The subtitle is unchanged.
- **False positive: `adv.rnd.rival_patent`.** WER was 15.4 %, from "a rival" being heard as "arrival". The two are identical phonemes in connected speech.
  - "Ay rival" was tested and heard as "I rival"; "A, rival" was tested and adds a hesitation. Both are worse, so the audio is unchanged.
  - The QA normaliser now merges the pair, like cash/cache.
- **Raw wpm is reported, not gated.** 33 lines fall outside 130–185 raw wpm, from 98 to 241. All of them read at 145–167 wpm-eq: the raw number is about word length.
- **The two pace counters disagree by up to about 10 wpm-eq on some lines.** CMUdict puts 71/93 advisor lines inside the advisor's 150–165 target, while espeak puts 93/93 inside. Neither counter puts a line outside the gate.
- **Kokoro was proven to work offline.** It re-rendered the whole batch from scratch, with no network and no take cache: 324 renders in 33 min; all 106 masters byte-identical to the committed set (`compare-outputs.mjs`: identical 106, different 0, missing 0). `adv.cash.negative` was re-rendered into the same directory after its override, the same way.

## 7. Lines that need a human listen

Eight lines. Nothing failed a check; these are the ones a check could not clear on its own. `QA-final.md` has the same list.

| id | What to listen for |
|---|---|
| `adv.end.defeat_bankrupt` | "magnate" (the plan asks for a listen on every "magnate" line). Whisper hears "magnate". |
| `vo_milestone_1b` | Same. |
| `news.market_crash` | A little slow: 136 wpm-eq against the 140–170 band. Every in-band take (speed 1.256–1.305) was heard as "**Doc's** plunge…", so the clean take at 1.18 was kept. The `am_michael` alternative reads it cleanly inside the band (146 wpm-eq). |
| `vo_milestone_100m` | Rendered at the advisor's slowest allowed Kokoro speed (0.70), because `af_heart` rushes this line (208 wpm-eq at 0.84). Check that it doesn't drawl. |
| `adv.loan.repaid` | Whisper is unsure of the first word, "Loan" (p 0.16; another take was heard as the homophone "Lone"). Check the onset. |
| `adv.rnd.rival_patent` | Heard as "**Arrival** patented that technology…". "A rival" and "arrival" sound alike; check that the article is audible. |
| `adv.cash.negative` | Re-phrased in the final QA round (§6.1). Confirm the new read, "costs interest, and credibility", sounds natural. |
| `adv.sales.record_month` | Whisper hallucinates a word on the decaying "-ale" of "scale". It is tonal speech decaying into silence, not a breath or an artefact; confirm by ear. |

Listen in `assets-src/vo/{advisor,anchor}/`. To redo a line:
- more takes: `node tools/voice/generate.mjs --provider kokoro --only <id> --takes 6 --force`;
- different spoken text (a respelling, a comma): add `"<id>": "<text>"` to `ttsOverrides` in `tools/voice/lines.authored.json`, run `node tools/voice/parse-script.mjs`, then `generate.mjs --provider kokoro --only <id>`. The subtitle stays the doc text.
- **Always pass `--provider kokoro` with `--only` while the shipped set is Kokoro.** Without it, the generator tries ElevenLabs first, and if credits are back, that one line would come out in Hope's voice next to Kokoro lines.

## 8. Script decisions

- **Held: `vo_t1_intro` and `vo_victory_t1`.** Both quote the $6M / $10M tutorial economics, which audio-plan §5.3 says to record only after UX §12 Q4 is decided. MASTER-PLAN D4 rescales scenario cash, so the numbers will change. The lines are in `lines.json` with `hold`; render them with `--include-held` once the text is final.
- **Superseded UX ids** (§5.3 table, plus edits 1–2 for `vo_rival_enters` and `vo_cash_negative`) are **aliases** of the §5.2 lines. Nothing is recorded twice.
- **Legacy mapping:**
  - Five legacy lines map to their §5.2 replacements: `vo_welcome` → `adv.onboard.welcome`, `vo_tutorial_complete` → `adv.onboard.complete`, `vo_victory` → `adv.end.victory`, and `vo_defeat_*` → `adv.end.defeat_*`.
  - `vo_tutorial_step1..5` have no replacement (the UX §7 chapter supersedes them). They were **re-recorded verbatim** as `adv.legacy.tutorial_step1..5` (`legacyOnly`).
  - Their text was recovered by transcribing the legacy MP3s with local Whisper, with the STT slips corrected (the generation script that held the original text no longer exists). That transcription also confirms the old "you are a magnet".
- **Templated ids written here** (`needsReview`): the docs name these but script none of them. They are in the §5.1 persona ("we/our", points to the next action, 9–13 words):
  - `vo_building_first_<retail|farm|mine_well|warehouse|rd|media|seaport>`, phrased to fit both the "construction started" trigger (UX §8 #1) and "completed" (as `factory` = `adv.build.factory_complete` uses);
  - `vo_milestone_<1m|10m|100m|1b>`, which say the number their id encodes;
  - `vo_upgrade_first` and `vo_tech_max`.
  - Edit them in `tools/voice/lines.authored.json`.
- **Priority and delivery** for the 17 UX lines are proposals (UX §9 has neither), following the audio-plan §4.11 classes. `vo_loan_missed` is P0 (loan default); the tutorial lines are P1·T.
- **Word-count warnings** (parser, 4–16 words for advisor lines):
  - `vo_goal_generic` is 2 words ("Objective complete.", UX text kept as written).
  - The legacy steps 1–3 run to 17–19 words (verbatim legacy text).
- **Pronunciation:** "magnate" appears in `adv.end.defeat_bankrupt` and `vo_milestone_1b`. Both are spoken as "mag-nate" through the `tts` text and checked by Whisper.
- **Delivery** words from §5.2 are kept in `lines.json` and the manifest. Kokoro has no style control, so they did not change the reads; ElevenLabs v2 ignores them too (only v3/v4 take tags).

## 9. Files

| Path | What |
|---|---|
| `tools/voice/parse-script.mjs` | docs + `lines.authored.json` + `pronunciation.json` → `lines.json`, with validation (unique ids, 4–16 words, aliases, legacy coverage, persona checks) |
| `tools/voice/lines.json` | the canonical script (generated) |
| `tools/voice/generate.mjs`, `lib/*.mjs` | the generator: providers, cache, takes, Kokoro speed search, QA, selection, manifest |
| `tools/voice/probe-elevenlabs.mjs` | key capability probe |
| `tools/voice/stt.py` | local Whisper transcription (batch, or `--serve` for the Kokoro search) |
| `tools/voice/qa-summary.mjs`, `compare-outputs.mjs` | QA tables; output-dir comparison (offline proof) |
| `tools/voice/qa-independent.py` | the independent final QA (ffprobe, ebur128, silencedetect, CMUdict pace, Whisper with VAD) → `reports/qa-independent.json` |
| `assets-src/vo/QA-final.md` | the final QA report |
| `tools/voice/reports/` | `elevenlabs-probe.json`, `model-ab.json`, `qa.json` (every chosen take: metrics + transcript), `usage.json` |
| `assets-src/vo/manifest.json` | every line: `{id, role, file, text, tts?, duration, provider, model, voice, priority, legacyAlias?, aliases?, wpm, paceWpm, lufsI, truePeakDbtp, qa?}`, plus `legacyMap` and `aliasMap` |
| `assets-src/vo/{advisor,anchor}/` | masters + `.gen.json` (provider, model, voice, settings, seed, take, request id, duration, wpm, pace, peak, LUFS, transcript, rejected takes) |
| `assets-src/vo/_kokoro_samples/` | Kokoro proof samples |

## 10. Requests and decisions

1. **Lead / user: ElevenLabs credits.**
   - MASTER-PLAN D16 casts ElevenLabs "Hope" and "Daniel"; this batch is a Kokoro stand-in.
   - Top up the account or wait for the quota reset, then run `node tools/voice/generate.mjs` (≈ 7.8K credits) to replace Kokoro with Hope and Daniel.
   - Or ship Kokoro.
   - Until then the spoken-updates tool speaks with the macOS fallback voices.
2. **Lead / UX:** review the 13 templated lines (`needsReview`). Decide the tutorial economics, then unhold `vo_t1_intro` and `vo_victory_t1`.
3. **Anyone with ears:** the §7 list; it is short because the objective checks clear most lines.
4. **Audio engineer (a1-audio):** consume `assets-src/vo/manifest.json`.
   - The masters are unmastered 16-bit WAV with 120 ms head and tail. Apply the §2.4 VO chain (−18 LUFS-I, ≤ −1.5 dBTP) and encode Opus/m4a.
   - `text` is the subtitle; `news.*` ids take the broadcast chain.
   - Resolve old `vo_*` names through `legacyMap` and `aliasMap`.
   - Lines with `status: "held"` have `file: null`.
