# VO batch: final QA

**Date:** 2026-10-01 · **Branch:** `a2-voice` · **Verdict: PASS. 106 of 106 voiced lines pass; 2 lines are held by the plan.**

**The shipped set is Kokoro, not ElevenLabs.** ElevenLabs had 0 credits, so, per the user's rule ("use Kokoro if ElevenLabs is not available"), every line of both roles is Kokoro-82M, rendered locally. To re-voice it with ElevenLabs "Hope" and "Daniel" once credits exist, see "Re-rendering with ElevenLabs" at the end.

## How this QA was run

The masters were re-measured from scratch by `tools/voice/qa-independent.py`. It takes no numbers from `generate.mjs` or the `.gen.json` files; it reads `gen.json` only for provider, model and voice.

| Check | Tool |
|---|---|
| Format and duration | ffprobe 7.1 |
| Loudness and true peak | ffmpeg `ebur128=peak=true` |
| Silences | ffmpeg `silencedetect` at −45 dBFS. Lead and tail must be ≤ 300 ms; internal pauses ≤ 700 ms. |
| Pace | Syllables come from the CMU Pronouncing Dictionary, not from the generator's espeak-ng. |
| Transcript | faster-whisper `base.en` with Silero VAD on, beam 5 and no prompt. The generator transcribes with VAD off and drops hallucinated tails, so this is a separate decoding path. |

Command: `tools/voice/.venv/bin/python tools/voice/qa-independent.py`. The full per-line results are in `tools/voice/reports/qa-independent.json`.

## Results

| Check | Advisor (`af_heart`) | Anchor (`bm_george`) | Gate | Result |
|---|---|---|---|---|
| Coverage: `lines.json` ↔ manifest ↔ disk | 93 voiced | 13 voiced | exactly one file per non-held id, no orphans | **pass.** 108 ids: 106 voiced, 2 held (`vo_t1_intro`, `vo_victory_t1`, `file: null`), 0 missing, 0 orphans |
| Decode | 93/93 | 13/13 | decodes; mono; 44.1–48 kHz | **pass.** Every file is PCM s16le, 48 kHz, mono. |
| Duration | 1.51–7.19 s | 2.91–4.78 s | 1.2–8 s | **pass** |
| True peak | max −0.8 dBTP | max −3.6 dBTP | ≤ −0.5 dBTP | **pass** |
| Leading / trailing silence | max 151 / 178 ms | max 134 / 171 ms | ≤ 300 ms | **pass** |
| Longest internal silence | 609 ms (`adv.legacy.tutorial_step1`) | 354 ms | ≤ 700 ms | **pass** |
| Integrated loudness spread | −22.8 to −21.4 LUFS (**1.4 LU**) | −21.8 to −21.3 LUFS (**0.5 LU**) | ≤ 4 LU per role | **pass** |
| Provider / model / voice | kokoro / Kokoro-82M-v1.0-ONNX fp32 / `af_heart`, all 93 | kokoro / same / `bm_george`, all 13 | one of each per role | **pass** |
| Pace, wpm-eq (CMUdict) | mean 160.0 (139.0–174.9) | mean 155.9 (138.9–161.7) | 130–185 | **pass**, 106/106 |
| Transcript WER | 92/93 exact after normalisation. 1 at 10 %. | 13/13 exact | WER ≤ 15 % | **pass**, 106/106 |
| "Magnate" | `adv.end.defeat_bankrupt`, `vo_milestone_1b` | — | heard as "magnate", not "magnet" | **pass**, 2/2 |
| Kokoro fallback really works | — | — | render with the documented command | **pass.** `generate.mjs --provider kokoro --offline --no-cache --out tools/voice/.tmp/vo-offline` re-rendered every line with no network and no take cache: 324 renders, and **106/106 masters are byte-identical** to the committed ones (`compare-outputs.mjs`). Kokoro is deterministic on this machine. |

### About the pace numbers

**The gate uses a word-length-neutral measure.** "wpm-eq" means syllables per second × 60 ÷ the role's mean syllables per word. The script's mean is 1.48 for the advisor and 1.73 for the anchor, both by CMUdict.

**Raw words per minute would give false failures.** 33 lines fall outside 130–185 raw wpm, from `vo_goal_generic` at 98 ("Objective complete.") to `vo_deadline_12` at 241 ("One year left on the clock."). Every one of those 33 lines speaks at a normal 145–167 wpm-eq. The raw figure mostly reflects how long the words are, not how fast they are spoken.

**Against the narrower role targets** (advisor 150–165, anchor 140–170), this measure puts 71/93 advisor and 12/13 anchor lines inside.
- The generator's own espeak-ng syllable count gives 93/93 and 12/13.
- The two counters disagree by about ±10 wpm-eq on some lines. Examples: "every" (2 or 3 syllables), "interest" (2 or 3), "household".
- No line falls outside the 130–185 gate under either counter.

**Lines outside the target:**
- Slowest (138–145): `news.market_crash` and `adv.hint.idle_cash`.
- Fastest (170–175): `adv.ipo.complete`, `adv.rnd.patent_granted` and `vo_below_cost`.

## Failures found and what was done

| id | Finding | Action |
|---|---|---|
| `adv.cash.negative` | **Prosody misparse.** Kokoro read "…every month in the red **costs, \| interest** and credibility": a ≈ 0.35 s break after "costs" turned the verb into a list item. Whisper punctuated it that way in both QA paths. Every metric still passed, so only listening for meaning catches this. | **Fixed.** Spoken-text override in `tools/voice/lines.authored.json` → `ttsOverrides`: "…in the red costs interest, and credibility." Re-rendered with Kokoro (`--provider kokoro --offline --only adv.cash.negative`, take 3 at speed 0.826). The break now falls before "and credibility" (190 ms), with no gap after "costs". Whisper hears "…in the red cost's interest and credibility" (WER 0). The subtitle text is unchanged. |
| `adv.rnd.rival_patent` | WER 15.4 % (> 15 %): heard as "**Arrival** patented that technology…" | **QA false positive. The audio was left as is.** "A rival" and "arrival" are the same phonemes (/əˈraɪvəl/) in connected speech. A human reader produces them identically too; context separates them. Two spoken-text variants were tested: "Ay rival" was heard as "I rival", and "A, rival" inserts an unnatural hesitation. Both are worse than the natural read. The QA normaliser now merges "arrival" with "a rival", like the cash/cache and loan/lone homophones. |
| `adv.sales.record_month` | WER 10 % (passes): VAD-on Whisper adds "You" after "scale"; VAD-off Whisper adds "Inhale ×4". | **Not a defect.** The last 230 ms is the tonal /eɪl/ of "scale" decaying (spectral flatness 0.02, periodic). It is not a breath or noise, and the audio is digital silence after it. Whisper's word timestamps end "scale" too early and it hallucinates on the decay. Listed for a listen. |

## Lines worth a human listen (none fail)

| id | Why |
|---|---|
| `adv.end.defeat_bankrupt`, `vo_milestone_1b` | Contain "magnate". The plan asks for a listen on each. Both QA paths hear "magnate". |
| `adv.cash.negative` | Re-phrased in this round. Confirm the new read sounds natural. |
| `adv.rnd.rival_patent` | Confirm the article "a" is audible in "a rival". |
| `news.market_crash` | Slowest anchor line (136–139 wpm-eq). In-band Kokoro takes were heard as "Doc's plunge…". The alternative voice `am_michael` reads it in band (`_kokoro_samples/`). |
| `vo_milestone_100m` | Rendered at the advisor's slowest Kokoro speed (0.70). Check it doesn't drawl. |
| `adv.loan.repaid` | Whisper is unsure of the first word, "Loan" (p 0.16). |
| `adv.sales.record_month` | The tail of "scale" (see above). |

## Re-rendering with ElevenLabs

The pipeline is ready for ElevenLabs; only the credits are missing.

1. Top up the ElevenLabs account. The key is read from `ELEVENLABS_API_KEY`, else the file named by `ELEVENLABS_API_KEY_FILE`, else `~/.claude/voice/key`.
2. `node tools/voice/generate.mjs --dry-run` shows the bill: ≈ 20K characters ≈ 7.8K credits with `eleven_multilingual_v2`.
3. Run `node tools/voice/generate.mjs`. Without `--provider` it voices each role with ElevenLabs:
   - advisor: "Hope", `eleven_multilingual_v2`, speed 0.82;
   - anchor: "Daniel", same model, speed 1.0.

   It writes the same files and manifest. If credits run out partway, that role stays entirely on Kokoro.
4. Re-run this QA: `tools/voice/.venv/bin/python tools/voice/qa-independent.py`.

Do **not** use `--only` for an ElevenLabs run on a Kokoro role: it would mix providers within the role.
