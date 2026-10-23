#!/usr/bin/env node
// Compares the masters of two VO output dirs, e.g. the committed batch and an offline re-render:
//   node tools/voice/generate.mjs --provider kokoro --offline --no-cache --out tools/voice/.tmp/vo-offline
//   node tools/voice/compare-outputs.mjs assets-src/vo tools/voice/.tmp/vo-offline
// Prints how many masters are byte-identical, and for the others the chosen take/speed and the largest sample difference.
// Exits 1 when any voiced line differs or is missing.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VOICE_DIR } from './lib/env.mjs';
import { readWav } from './lib/audio.mjs';

const [a, b] = process.argv.slice(2).map((p) => resolve(process.cwd(), p));
if (!a || !b) { console.error('usage: compare-outputs.mjs <dirA> <dirB>'); process.exit(2); }
const script = JSON.parse(readFileSync(join(VOICE_DIR, 'lines.json'), 'utf8'));
let same = 0;
let missing = 0;
const diffs = [];
for (const l of script.lines) {
  const pa = join(a, l.role, `${l.id}.wav`);
  const pb = join(b, l.role, `${l.id}.wav`);
  if (!existsSync(pa) && !existsSync(pb)) continue; // e.g. held lines
  if (!existsSync(pa) || !existsSync(pb)) { missing++; diffs.push(`${l.id}: only in ${existsSync(pa) ? 'A' : 'B'}`); continue; }
  const ba = readFileSync(pa);
  const bb = readFileSync(pb);
  if (ba.equals(bb)) { same++; continue; }
  const ga = JSON.parse(readFileSync(pa.replace(/\.wav$/, '.gen.json'), 'utf8'));
  const gb = JSON.parse(readFileSync(pb.replace(/\.wav$/, '.gen.json'), 'utf8'));
  const wa = readWav(pa).samples;
  const wb = readWav(pb).samples;
  let maxd = 0;
  for (let i = 0; i < Math.min(wa.length, wb.length); i++) maxd = Math.max(maxd, Math.abs(wa[i] - wb[i]));
  diffs.push(`${l.id}: take ${ga.take}/${gb.take}, speed ${ga.settings?.speed}/${gb.settings?.speed}, samples ${wa.length}/${wb.length}, max |Δ| ${maxd}, transcripts ${JSON.stringify(ga.stt?.text)} / ${JSON.stringify(gb.stt?.text)}`);
}
console.log(JSON.stringify({ identical: same, different: diffs.length - missing, missing }));
for (const d of diffs) console.log(`  ${d}`);
process.exit(diffs.length ? 1 : 0);
