#!/usr/bin/env node
// Prints a Markdown QA summary of the chosen takes (reads assets-src/vo/**/<id>.gen.json via lines.json):
// a per-role table, the "magnate" check, and the lines that need a human listen, with the reason for each.
// Usage: node tools/voice/qa-summary.mjs [--out assets-src/vo]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VOICE_DIR, OUT_DIR } from './lib/env.mjs';
import { ROLES, QA } from './lib/config.mjs';

const i = process.argv.indexOf('--out');
const out = i > 0 ? resolve(process.cwd(), process.argv[i + 1]) : OUT_DIR;
const script = JSON.parse(readFileSync(join(VOICE_DIR, 'lines.json'), 'utf8'));
const gens = script.lines
  .map((l) => ({ l, p: join(out, l.role, `${l.id}.gen.json`) }))
  .filter((x) => existsSync(x.p))
  .map((x) => ({ line: x.l, g: JSON.parse(readFileSync(x.p, 'utf8')) }));

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const r1 = (x) => Math.round(x * 10) / 10;
const pace = (g) => g.paceWpm ?? g.wpm;
const inBand = (g, t) => pace(g) >= t.wpmMin && pace(g) <= t.wpmMax;

console.log('| Role | Lines | Provider / voice | Takes | Pace, wpm-eq: mean (range) | In band | Raw wpm: mean (range) | Longest pause | LUFS-I range | Max true peak | Exact transcripts | CER ≤ 0.08 | Hard QA failures |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const role of ['advisor', 'anchor']) {
  const gs = gens.filter((x) => x.line.role === role).map((x) => x.g);
  if (!gs.length) continue;
  const t = ROLES[role].target;
  const p = gs.map(pace);
  const w = gs.map((g) => g.wpm);
  const voices = [...new Set(gs.map((g) => `${g.provider} ${g.voice.name}`))].join(', ');
  const takes = gs.reduce((a, g) => a + (g.takesConsidered ?? 1), 0);
  console.log(`| ${role} | ${gs.length} | ${voices} | ${takes} (${r1(takes / gs.length)} per line) | ${r1(mean(p))} (${Math.min(...p)}–${Math.max(...p)}) | ${gs.filter((g) => inBand(g, t)).length}/${gs.length} (${t.wpmMin}–${t.wpmMax}) | ${r1(mean(w))} (${Math.min(...w)}–${Math.max(...w)}) | ${Math.max(...gs.map((g) => g.maxGapMs))} ms | ${Math.min(...gs.map((g) => g.lufsI))} to ${Math.max(...gs.map((g) => g.lufsI))} | ${Math.max(...gs.map((g) => g.truePeakDbtp))} dBTP | ${gs.filter((g) => g.stt && g.stt.cer === 0).length}/${gs.length} | ${gs.filter((g) => g.stt && g.stt.cer <= QA.maxCer).length}/${gs.length} | ${gs.filter((g) => g.score.hard > 0).length} |`);
}

const magn = gens.filter((x) => /magnate/i.test(x.line.text));
console.log(`\n"magnate" lines: ${magn.map((x) => `\`${x.line.id}\` → **${x.g.stt?.magnate ?? 'n/a'}** ("${x.g.stt?.text ?? ''}")`).join('; ')}`);

// Lines that need a human listen: anything an objective check could not clear.
const listen = [];
for (const { line, g } of gens) {
  const t = ROLES[line.role].target;
  const why = [];
  if (g.score.hard > 0) why.push(`**hard QA failure**: ${g.flags.join('; ')}`);
  if (g.stt && !g.stt.error && g.stt.cer > 0) why.push(`transcript differs (WER ${g.stt.wer}, CER ${g.stt.cer})`);
  if (g.stt?.error) why.push('no transcript');
  if (!inBand(g, t)) why.push(`pace ${pace(g)} wpm-eq (band ${t.wpmMin}–${t.wpmMax})`);
  if (g.stt?.lowConf?.length) why.push(`low-confidence words: ${g.stt.lowConf.join(', ')}`);
  if (/magnate/i.test(line.text)) why.push(`"magnate": ${g.stt?.magnate ?? 'unchecked'}`);
  const K = ROLES[line.role].kokoro;
  if (g.provider === 'kokoro' && (g.settings.speed <= K.minSpeed || g.settings.speed >= K.maxSpeed)) why.push(`Kokoro speed ${g.settings.speed} at the role's limit (${K.minSpeed}–${K.maxSpeed})`);
  if (why.length) listen.push({ line, g, why });
}
console.log(`\nLines that need a human listen: ${listen.length} of ${gens.length}\n`);
console.log('| id | Pace (raw wpm) | Transcript (Whisper base.en) | Why |');
console.log('|---|---|---|---|');
for (const { line, g, why } of listen) console.log(`| \`${line.id}\` | ${pace(g)} (${g.wpm}) | ${g.stt?.text ?? '—'} | ${why.join('; ')} |`);
