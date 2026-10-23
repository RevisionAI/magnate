#!/usr/bin/env node
// Probes what this ElevenLabs key may do, cheaply (a 6-character test phrase per request), and records it in
// reports/elevenlabs-probe.json, which generate.mjs reads:
//   - output formats in preference order wav_48000 > pcm_48000 > mp3_44100_192 > mp3_44100_128 (audio-plan §3.5)
//   - whether an alias pronunciation dictionary can be created (needs pronunciation_dictionaries_write)
//   - which TTS models are accepted (eleven_multilingual_v2, eleven_v4)
//   - both role voices
// Usage: node tools/voice/probe-elevenlabs.mjs [--no-dictionary]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadElevenLabsKey, REPORTS_DIR, VOICE_DIR } from './lib/env.mjs';
import { textToSpeech, createAliasDictionary } from './lib/elevenlabs.mjs';
import { ROLES } from './lib/config.mjs';

const key = loadElevenLabsKey();
if (!key) { console.error('no ElevenLabs key (ELEVENLABS_API_KEY / ELEVENLABS_API_KEY_FILE / ~/.claude/voice/key)'); process.exit(1); }

const PHRASE = 'Ready.';
const FORMATS = ['wav_48000', 'pcm_48000', 'mp3_44100_192', 'mp3_44100_128'];
const MODELS = ['eleven_multilingual_v2', 'eleven_v4'];
const report = { date: new Date().toISOString(), phrase: PHRASE, formats: {}, models: {}, voices: {}, dictionary: null, charactersBilled: 0 };

async function attempt(label, args) {
  try {
    const r = await textToSpeech({ key, text: PHRASE, normalization: 'on', ...args });
    report.charactersBilled += PHRASE.length;
    const out = { ok: true, bytes: r.audio.length, contentType: r.contentType, requestId: r.requestId, headers: r.headers, head: r.audio.subarray(0, 4).toString('latin1').replace(/[^\x20-\x7e]/g, '.') };
    console.log(`${label}: OK ${out.bytes} B ${out.contentType ?? ''} req=${out.requestId ?? '-'}`);
    return out;
  } catch (e) {
    console.log(`${label}: ${e.name} ${e.message}`);
    return { ok: false, error: e.name, ...(e.info ?? { message: e.message }) };
  }
}

const adv = ROLES.advisor.elevenlabs;
const anc = ROLES.anchor.elevenlabs;
for (const f of FORMATS) {
  report.formats[f] = await attempt(`format ${f}`, { voiceId: adv.voiceId, modelId: 'eleven_multilingual_v2', settings: adv.settings, seed: 1, outputFormat: f });
}
report.chosenFormat = FORMATS.find((f) => report.formats[f].ok) ?? null;
const fmt = report.chosenFormat ?? 'mp3_44100_128';
for (const m of MODELS) {
  report.models[m] = await attempt(`model ${m}`, { voiceId: adv.voiceId, modelId: m, settings: adv.settings, seed: 1, outputFormat: fmt });
}
report.voices.anchor = await attempt(`anchor voice ${anc.voiceId}`, { voiceId: anc.voiceId, modelId: 'eleven_multilingual_v2', settings: anc.settings, seed: 1, outputFormat: fmt });
report.voices.advisor = report.formats[fmt] ?? null;

if (!process.argv.includes('--no-dictionary')) {
  const pron = JSON.parse(readFileSync(join(VOICE_DIR, 'pronunciation.json'), 'utf8'));
  try {
    const d = await createAliasDictionary({ key, name: pron.dictionaryName, rules: pron.rules });
    report.dictionary = { ok: true, id: d.id, versionId: d.versionId };
    console.log(`dictionary: OK id=${d.id} version=${d.versionId}`);
  } catch (e) {
    report.dictionary = { ok: false, error: e.name, ...(e.info ?? { message: e.message }) };
    console.log(`dictionary: ${e.name} ${e.message}`);
  }
}

mkdirSync(REPORTS_DIR, { recursive: true });
writeFileSync(join(REPORTS_DIR, 'elevenlabs-probe.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`chosen format: ${report.chosenFormat}; characters billed by the probe: ${report.charactersBilled}`);
