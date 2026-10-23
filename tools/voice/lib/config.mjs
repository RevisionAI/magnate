// Per-role voice configuration (audio-plan §3.5, §5.1). One provider and one model per role for the whole batch.
export const ROLES = {
  advisor: {
    elevenlabs: {
      voiceId: 'uYXf8XasLslADfZ2MB4u', // "Hope", same voice as the 10 legacy lines
      voiceName: 'Hope',
      // Locked by the A/B (reports/model-ab.json): v2 had no rejected takes and the most accurate transcripts, and its
      // pace follows `speed` (0.82 -> 157 wpm-eq / 149 raw wpm, 0.92 -> 187 / 178), while eleven_v4 ignores `speed`
      // (identical durations at 0.92 and 1.0) and left trailing artefacts on some takes. speed 0.82 replaces the plan's
      // 0.92: it put the A/B lines at the centre of the 150–165 band (syllable-normalised pace, see `target`), where 0.92
      // read 25 % too fast. The A/B's 10 takes at 0.82 sit in the cache and are reused by the batch.
      model: 'eleven_multilingual_v2',
      settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true, speed: 0.82 },
    },
    kokoro: {
      voice: 'af_heart', // Kokoro's grade-A American female: warm, confident
      // Speed of take 1. Kokoro is deterministic, so further takes search the speed for the pace band
      // (generate.mjs → kokoroTakes). 0.84 is the median speed the first Kokoro batch needed for the band centre
      // (at 0.90 the median line read at 169 wpm-eq).
      speed: 0.84,
      minSpeed: 0.7,
      maxSpeed: 1.2,
      maxTakes: 6, // takes 4–6 render only while no take is in the pace band (rendering is local and free)
    },
    // composed CFO pace (audio-plan §1.3 #9, §5.1). Pace is measured word-length-neutral: syllables per second
    // (espeak-ng phonemes) × 60 / refSpw, where refSpw = mean syllables per word of this role's script (1.49 on
    // 2026-10-01). So "150–165 wpm" means 3.7–4.1 syllables/s for every line, short words or long.
    target: { wpmMin: 150, wpmMax: 165, refSpw: 1.49 },
    takes: 3,
  },
  anchor: {
    elevenlabs: {
      voiceId: 'onwK4e9ZLuTAKqWW03F9', // premade "Daniel", steady British broadcaster
      voiceName: 'Daniel',
      model: 'eleven_multilingual_v2', // A/B: 3/3 exact transcripts (eleven_v4 swapped "a recession" for "the recession")
      settings: { stability: 0.65, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 1.0 },
    },
    kokoro: {
      voice: 'bm_george', // British male broadcaster timbre (closest to "Daniel")
      speed: 1.18, // bm_george is slow: the first batch's median line needed 1.18 for the band centre (144 wpm-eq at 1.10)
      minSpeed: 0.9,
      maxSpeed: 1.45,
      maxTakes: 6,
    },
    // steady broadcaster; the audio plan sets no anchor pace (Daniel at 1.0 read 129–169 wpm). refSpw 1.75.
    target: { wpmMin: 140, wpmMax: 170, refSpw: 1.75 },
    takes: 3,
  },
};

// Take selection thresholds (generate.mjs → lib/select.mjs)
export const QA = {
  padMs: 120, // leading/trailing silence kept after trimming
  fadeMs: 10, // raised-cosine edge fades (inside the silence padding)
  maxGapMs: 600, // an internal pause longer than this rejects a take
  clipDbfs: -0.1, // sample peak at or above this counts as clipping
  maxCer: 0.08, // compact character error rate vs the script above which a transcript "differs materially"
};

// Output format preference (probe-elevenlabs.mjs picks the first one the key's tier accepts).
export const FORMAT_PREFERENCE = ['wav_48000', 'pcm_48000', 'mp3_44100_192', 'mp3_44100_128'];
