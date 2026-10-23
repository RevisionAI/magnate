// Syllable counts from espeak-ng phonemes (the same WASM phonemiser Kokoro uses), for word-length-neutral pace.
// A line of one-syllable words read at a natural rate scores a high wpm; normalising by syllables per word keeps the
// 150–165 wpm target meaningful for every line (see paceBand()).
import { phonemize } from 'phonemizer';

const VOWELS = new Set([...'aeiouyæɑɒɔəɚɛɜɝɪʊʌɐᵻøœɤɯɨʉɘɵɞɶ']);
const DIPHTHONGS = new Set(['aɪ', 'eɪ', 'oʊ', 'aʊ', 'ɔɪ', 'əʊ']); // en-us/en-gb closing diphthongs count once
const cache = new Map();

export function countNuclei(ipa) {
  const s = ipa.replace(/[ˈˌːˑ̃͡]/g, '');
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (!VOWELS.has(s[i])) continue;
    n++;
    if (i + 1 < s.length && DIPHTHONGS.has(s[i] + s[i + 1])) i++;
  }
  return n;
}

export async function syllables(text) {
  const key = text.replace(/\[[^\]]*\]/g, '').trim();
  if (cache.has(key)) return cache.get(key);
  const ipa = (await phonemize(key.replace(/(?<=[A-Z])\.(?=[A-Z])/g, '-'), 'en-us')).join(' ');
  const n = countNuclei(ipa);
  cache.set(key, n);
  return n;
}
