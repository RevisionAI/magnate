#!/usr/bin/env node
// Builds tools/voice/lines.json, the canonical VO script, from the research docs:
//   docs/overhaul/research/audio-plan.md   §5.2 (60 advisor + 13 anchor lines) and §5.3 (UX lines to record, superseded ids, holds)
//   docs/overhaul/research/ux-playability.md §9 (text of the UX-owned lines)
//   tools/voice/lines.authored.json          (what the docs do not script: UX priorities/delivery, templated lines, legacy steps)
//   tools/voice/pronunciation.json           (aliases baked into the `tts` text)
// Re-run after editing any of them:  node tools/voice/parse-script.mjs [--check]
// --check exits non-zero if lines.json would change (for CI) or on validation errors.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const AUDIO_PLAN = join(ROOT, 'docs/overhaul/research/audio-plan.md');
const UX = join(ROOT, 'docs/overhaul/research/ux-playability.md');
const AUTHORED = join(HERE, 'lines.authored.json');
const PRON = join(HERE, 'pronunciation.json');
const LEGACY_DIR = join(ROOT, 'client/assets/audio/vo');
const OUT = join(HERE, 'lines.json');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ---------- markdown helpers ----------
function section(md, startRe, endRe) {
  const lines = md.split('\n');
  const s = lines.findIndex((l) => startRe.test(l));
  if (s < 0) throw new Error(`section not found: ${startRe}`);
  let e = lines.findIndex((l, i) => i > s && endRe.test(l));
  if (e < 0) e = lines.length;
  return lines.slice(s + 1, e);
}

// Returns an array of tables; each table = { header: [...], rows: [[...]] }
function tables(lines) {
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l.startsWith('|')) { cur = null; continue; }
    const cells = splitRow(l);
    if (!cur) { cur = { header: cells, rows: [] }; out.push(cur); continue; }
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // separator
    cur.rows.push(cells);
  }
  return out;
}

function splitRow(l) {
  const inner = l.replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let buf = '';
  let tick = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') { buf += '|'; i++; continue; }
    if (ch === '`') tick = !tick;
    if (ch === '|' && !tick) { cells.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

const unTick = (s) => s.replace(/`/g, '').trim();
const ids = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

export function wordCount(text) {
  return text
    .replace(/\*\(.*?\)\*/g, '')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

// ---------- pronunciation ----------
const pron = JSON.parse(readFileSync(PRON, 'utf8'));
function applyAliases(text) {
  let out = text;
  for (const r of pron.rules) {
    const esc = r.match.replace(/[.*+?^${}()|[\]\\&]/g, (c) => (c === '&' ? '&' : `\\${c}`));
    // whole word: not preceded/followed by a letter/digit
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'g'), r.ttsAlias);
  }
  return out;
}

// ---------- legacy names (the 10 Godot lines) ----------
const legacyNames = existsSync(LEGACY_DIR)
  ? readdirSync(LEGACY_DIR).filter((f) => f.endsWith('.mp3')).map((f) => f.replace(/\.mp3$/, '')).sort()
  : [];
if (legacyNames.length !== 10) warn(`expected 10 legacy VO files in ${relative(ROOT, LEGACY_DIR)}, found ${legacyNames.length}`);
const isLegacy = (n) => legacyNames.includes(n);

// ---------- audio-plan §5.2 ----------
const ap = readFileSync(AUDIO_PLAN, 'utf8');
const s52 = section(ap, /^### 5\.2 /, /^### 5\.3 /);
// the line tables are the ones with an `id` column; §5.2 also holds a news-mapping table (Rule | Treatment | ...)
const t52 = tables(s52).filter((t) => t.header.some((h) => h.toLowerCase() === 'id'));
if (t52.length !== 2) throw new Error(`§5.2: expected 2 line tables (advisor, anchor), found ${t52.length}`);
const advT = t52.find((t) => t.header.some((h) => /^delivery/i.test(h)));
const ancT = t52.find((t) => t !== advT);
if (!advT || !ancT) throw new Error('§5.2: could not tell the advisor table (has Delivery) from the anchor table');

const lines = [];
function parsePriority(p) {
  const m = p.match(/P([0-3])/);
  if (!m) { err(`bad priority "${p}"`); return { priority: p }; }
  const o = { priority: `P${m[1]}` };
  if (/·\s*T/.test(p)) o.tutorial = true;
  const extra = p.replace(/^P[0-3](·T)?\s*/, '').trim();
  if (extra) o.priorityNote = extra.replace(/^\(|\)$/g, '');
  return o;
}

function parseLineCell(cell) {
  const m = cell.match(/\*\(TTS:\s*[“"](.+?)[”"]\)\*/);
  const text = cell.replace(/\s*\*\(TTS:.*?\)\*\s*/, '').trim();
  return { text, tts: m ? m[1].trim() : undefined };
}

function parseAliasCell(cell) {
  const aliases = [];
  const related = [];
  const notes = [];
  if (!cell || cell === '—') return { aliases, related, notes };
  // parenthesised groups are references, not aliases
  const paren = [...cell.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const bare = cell.replace(/\([^)]*\)/g, ' ');
  for (const tok of bare.split(/[\s/]+/).filter(Boolean)) {
    if (/^vo_[a-z0-9_]+$/.test(tok)) aliases.push(tok);
  }
  for (const p of paren) {
    const vos = p.match(/vo_[a-z0-9_]+/g);
    if (vos && p.trim() === vos.join(' ')) related.push(...vos);
    else notes.push(p.trim());
  }
  return { aliases, related, notes };
}

{
  const h = advT.header.map((x) => x.toLowerCase());
  const col = (name) => h.findIndex((x) => x.startsWith(name));
  const C = { n: col('#'), id: col('id'), line: col('line'), w: col('w'), trig: col('trigger'), p: col('p'), lim: col('limit'), del: col('delivery'), alias: col('ux') };
  for (const [k, v] of Object.entries(C)) if (v < 0) throw new Error(`§5.2 advisor table: column ${k} missing`);
  for (const r of advT.rows) {
    if (r.length !== advT.header.length) { err(`§5.2 advisor row has ${r.length} cells: ${r.join(' | ').slice(0, 80)}`); continue; }
    const { text, tts } = parseLineCell(r[C.line]);
    const a = parseAliasCell(r[C.alias]);
    const legacy = a.aliases.filter(isLegacy);
    lines.push({
      id: unTick(r[C.id]),
      role: 'advisor',
      text,
      ...(tts ? { tts } : {}),
      docWords: Number(r[C.w]),
      delivery: r[C.del],
      trigger: unTick(r[C.trig]),
      ...parsePriority(r[C.p]),
      limit: r[C.lim],
      aliases: a.aliases.filter((x) => !isLegacy(x)),
      ...(legacy.length ? { legacyAlias: legacy[0] } : {}),
      ...(a.related.length ? { related: a.related } : {}),
      ...(a.notes.length ? { refs: a.notes } : {}),
      source: `audio-plan §5.2 advisor #${r[C.n]}`,
    });
    if (legacy.length > 1) err(`${r[C.id]}: more than one legacy alias`);
  }
}
{
  const h = ancT.header.map((x) => x.toLowerCase());
  const col = (name) => h.findIndex((x) => x.startsWith(name));
  const C = { n: col('#'), id: col('id'), line: col('line'), w: col('w'), trig: col('trigger'), p: col('p'), lim: col('limit') };
  for (const [k, v] of Object.entries(C)) if (v < 0) throw new Error(`§5.2 anchor table: column ${k} missing`);
  for (const r of ancT.rows) {
    if (r.length !== ancT.header.length) { err(`§5.2 anchor row has ${r.length} cells`); continue; }
    const { text, tts } = parseLineCell(r[C.line]);
    lines.push({
      id: unTick(r[C.id]),
      role: 'anchor',
      text,
      ...(tts ? { tts } : {}),
      docWords: Number(r[C.w]),
      delivery: 'steady broadcaster',
      trigger: unTick(r[C.trig]),
      ...parsePriority(r[C.p]),
      limit: r[C.lim],
      aliases: [],
      source: `audio-plan §5.2 anchor #${r[C.n]}`,
    });
  }
}

// ---------- audio-plan §5.3 ----------
const s53 = section(ap, /^### 5\.3 /, /^(---|## )/);
const s53text = s53.join('\n');
function bulletIds(label) {
  const l = s53.find((x) => x.includes(`**${label}:**`));
  if (!l) throw new Error(`§5.3: bullet "${label}" not found`);
  return ids(l);
}
const uxTutorial = bulletIds('Tutorial');
const uxExtras = bulletIds('Advisor extras');
// templated: sub-bullets after "**Templated lines:**"
const tStart = s53.findIndex((x) => x.includes('**Templated lines:**'));
const templated = [];
const templatedSuperseded = {};
for (let i = tStart + 1; i < s53.length && /^\s+-\s/.test(s53[i]); i++) {
  const l = s53[i];
  const first = ids(l)[0];
  const m = first.match(/^(.*)<([^>]+)>(.*)$/);
  const expanded = m ? m[2].split('|').map((v) => `${m[1]}${v}${m[3]}`) : [first];
  templated.push(...expanded);
  // "`factory` = `adv.build.factory_complete`"
  for (const mm of l.matchAll(/`([a-z0-9_]+)`\s*=\s*`([a-z0-9_.]+)`/g)) {
    if (m) templatedSuperseded[`${m[1]}${mm[1]}${m[3]}`] = mm[2];
  }
}
// holds: "...(`vo_t1_intro`, `vo_victory_t1`): record only after ..."
const holds = {};
for (const l of s53) {
  if (/record only after/i.test(l)) {
    const reason = l.replace(/^\s*\d+\.\s*/, '').replace(/`/g, '').trim();
    for (const id of ids(l.split(':')[0])) holds[id] = reason;
  }
}
// superseded: the "Edits required" items ("1. `vo_rival_enters` names a company …: use `adv.market.competitor_entered`.")
const superseded = { ...templatedSuperseded };
for (const l of s53) {
  const m = l.match(/^\s*\d+\.\s*`(vo_[a-z0-9_]+)`.*?:\s*use\s+`([a-z0-9_.]+)`/);
  if (m) superseded[m[1]] = m[2];
}
// … and the superseded table
for (const t of tables(s53)) {
  if (!/ux id/i.test(t.header[0])) continue;
  for (const r of t.rows) {
    const from = ids(r[0]);
    const to = ids(r[1]);
    for (let k = 0; k < from.length; k++) {
      const f = from[k];
      const target = to[Math.min(k, to.length - 1)];
      if (f.endsWith('*') && target.endsWith('*')) {
        const fp = f.slice(0, -1);
        const tp = target.slice(0, -1);
        for (const ln of lines) if (ln.id.startsWith(tp)) superseded[fp + ln.id.slice(tp.length)] = ln.id;
      } else superseded[f] = target;
    }
  }
}

// ---------- ux-playability §9 ----------
const ux = readFileSync(UX, 'utf8');
const s9 = section(ux, /^## 9\. /, /^## 10\. /);
const uxTable = tables(s9)[0];
const uxLines = {};
for (const r of uxTable.rows) {
  const [id, trig, line] = r;
  uxLines[unTick(id)] = { trigger: trig, text: line.replace(/^["“]|["”]$/g, '').trim() };
}

const authored = JSON.parse(readFileSync(AUTHORED, 'utf8'));

// supersession consistency: every superseded UX id must point at an existing line, and §5.2 alias columns agree
const byId = () => new Map(lines.map((l) => [l.id, l]));
{
  const map = byId();
  for (const [ux, target] of Object.entries(superseded)) {
    const t = map.get(target);
    if (!t) { err(`§5.3 superseded ${ux} -> ${target}: target id not in §5.2`); continue; }
    if (isLegacy(ux)) {
      if (t.legacyAlias && t.legacyAlias !== ux) err(`${target}: legacy alias conflict ${t.legacyAlias} vs ${ux}`);
      t.legacyAlias = ux;
    } else if (!t.aliases.includes(ux)) {
      t.aliases.push(ux);
    }
  }
  // the §5.3 superseded list should cover the §5.2 alias column (report drift both ways)
  for (const l of lines) for (const a of l.aliases) if (!superseded[a] && !templatedSuperseded[a]) warn(`${l.id}: alias ${a} is in the §5.2 alias column but not in the §5.3 superseded table`);
}

// §5.3 UX lines to record
for (const id of [...uxTutorial, ...uxExtras]) {
  if (superseded[id]) { warn(`§5.3 lists ${id} for recording but also as superseded by ${superseded[id]}; using the §5.2 line`); continue; }
  const u = uxLines[id];
  if (!u) { err(`§5.3 lists ${id} but ux-playability §9 has no text for it`); continue; }
  const meta = authored.uxMeta[id] ?? {};
  if (!authored.uxMeta[id]) warn(`${id}: no priority/delivery in lines.authored.json uxMeta (defaulting to P2)`);
  lines.push({
    id,
    role: 'advisor',
    text: u.text,
    delivery: meta.delivery ?? 'neutral',
    trigger: u.trigger + (meta.trigger ? ` — ${meta.trigger}` : ''),
    priority: meta.priority ?? 'P2',
    ...(meta.tutorial ? { tutorial: true } : {}),
    ...(meta.limit ? { limit: meta.limit } : uxTutorial.includes(id) ? { limit: 'once per step per save' } : {}),
    aliases: [],
    ...(holds[id] ? { hold: holds[id] } : {}),
    source: `ux-playability §9 (audio-plan §5.3 ${uxTutorial.includes(id) ? 'tutorial' : 'advisor extras'})`,
  });
}
for (const id of templated) {
  if (superseded[id]) continue;
  const a = authored.templated[id];
  if (!a) { err(`templated ${id}: no text in lines.authored.json`); continue; }
  const metaKey = Object.keys(authored.templatedMeta).find((k) => id.startsWith(k));
  const meta = authored.templatedMeta[metaKey] ?? {};
  lines.push({
    id,
    role: 'advisor',
    text: a.text,
    ...(a.tts ? { tts: a.tts } : {}),
    delivery: a.delivery,
    trigger: meta.trigger ?? '',
    priority: meta.priority ?? 'P2',
    ...(meta.limit ? { limit: meta.limit } : {}),
    aliases: [],
    authored: true,
    needsReview: 'text written by a2-voice: the docs name this id but give no line',
    source: 'audio-plan §5.3 templated (text: lines.authored.json)',
  });
}
for (const a of authored.legacy) {
  lines.push({
    id: a.id,
    role: 'advisor',
    text: a.text,
    ...(a.tts ? { tts: a.tts } : {}),
    delivery: a.delivery,
    trigger: a.trigger,
    priority: 'P1',
    tutorial: true,
    limit: 'legacy client only (superseded by the UX §7 tutorial chapter)',
    aliases: [],
    legacyAlias: a.legacyAlias,
    legacyOnly: true,
    source: 'legacy client/assets/audio/vo (verbatim, re-recorded; lines.authored.json)',
  });
}
// UX ids not covered anywhere (only report; they may be intentionally dropped)
for (const id of Object.keys(uxLines)) {
  const covered = lines.some((l) => l.id === id || l.aliases.includes(id) || l.legacyAlias === id);
  if (!covered) warn(`ux-playability §9 id ${id} is neither recorded nor superseded`);
}

// ---------- derive tts, words, validate ----------
const seen = new Set();
const aliasOwner = new Map();
const ttsOverrides = authored.ttsOverrides ?? {};
for (const id of Object.keys(ttsOverrides)) if (!id.startsWith('_') && !lines.some((l) => l.id === id)) err(`lines.authored.json ttsOverrides: unknown id ${id}`);
for (const l of lines) {
  if (seen.has(l.id)) err(`duplicate id ${l.id}`);
  seen.add(l.id);
  const spoken = applyAliases(ttsOverrides[l.id] ?? l.tts ?? l.text);
  if (spoken !== l.text) l.tts = spoken; else delete l.tts;
  l.words = wordCount(l.text);
  if (l.docWords !== undefined) {
    if (l.docWords !== l.words) warn(`${l.id}: doc says ${l.docWords} words, counted ${l.words}`);
    delete l.docWords;
  }
  if (l.role === 'advisor' && (l.words < 4 || l.words > 16)) warn(`${l.id}: advisor line has ${l.words} words (target 4–16)`);
  if (l.role === 'advisor' && !l.legacyOnly && /\d/.test(l.text)) warn(`${l.id}: contains digits (persona rule §5.1: no numbers in advisor lines)`);
  if (/LocalCo/.test(l.text)) err(`${l.id}: names a company`);
  for (const a of [...l.aliases, ...(l.legacyAlias ? [l.legacyAlias] : [])]) {
    if (aliasOwner.has(a)) err(`alias ${a} maps to both ${aliasOwner.get(a)} and ${l.id}`);
    aliasOwner.set(a, l.id);
  }
  if (!l.aliases.length) delete l.aliases;
}
for (const a of aliasOwner.keys()) if (seen.has(a)) err(`alias ${a} is also a line id`);
for (const n of legacyNames) if (!aliasOwner.has(n)) err(`legacy ${n} is not mapped to any new line`);
for (const id of Object.keys(holds)) if (!seen.has(id)) warn(`hold for unknown id ${id}`);

// stable key order
const ORDER = ['id', 'role', 'text', 'tts', 'words', 'delivery', 'trigger', 'priority', 'tutorial', 'priorityNote', 'limit', 'legacyAlias', 'aliases', 'related', 'refs', 'hold', 'authored', 'needsReview', 'legacyOnly', 'source'];
const ordered = lines.map((l) => Object.fromEntries(ORDER.filter((k) => l[k] !== undefined).map((k) => [k, l[k]])));

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
const count = (pred) => ordered.filter(pred).length;
const doc = {
  _doc: 'GENERATED by tools/voice/parse-script.mjs — do not edit by hand. Edit the research docs or lines.authored.json and re-run.',
  sources: {
    'docs/overhaul/research/audio-plan.md': sha(AUDIO_PLAN),
    'docs/overhaul/research/ux-playability.md': sha(UX),
    'tools/voice/lines.authored.json': sha(AUTHORED),
    'tools/voice/pronunciation.json': sha(PRON),
  },
  counts: {
    total: ordered.length,
    advisor: count((l) => l.role === 'advisor'),
    anchor: count((l) => l.role === 'anchor'),
    plan52: count((l) => l.source.startsWith('audio-plan §5.2')),
    ux53: count((l) => l.source.startsWith('ux-playability')),
    templated: count((l) => l.authored),
    legacyRerecord: count((l) => l.legacyOnly),
    held: count((l) => l.hold),
    withTts: count((l) => l.tts),
  },
  legacyMap: Object.fromEntries(legacyNames.map((n) => [n, aliasOwner.get(n) ?? null])),
  aliasMap: Object.fromEntries([...aliasOwner.entries()].filter(([a]) => !isLegacy(a)).sort()),
  warnings,
  lines: ordered,
};

const json = JSON.stringify(doc, null, 2) + '\n';
const check = process.argv.includes('--check');
for (const w of warnings) console.warn(`warn: ${w}`);
for (const e of errors) console.error(`ERROR: ${e}`);
console.log(`lines: ${doc.counts.total} (advisor ${doc.counts.advisor}, anchor ${doc.counts.anchor}; §5.2 ${doc.counts.plan52}, UX ${doc.counts.ux53}, templated ${doc.counts.templated}, legacy ${doc.counts.legacyRerecord}, held ${doc.counts.held}, tts ${doc.counts.withTts}); ${warnings.length} warnings, ${errors.length} errors`);
if (errors.length) process.exit(1);
if (check) {
  const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (prev !== json) { console.error('lines.json is out of date: run node tools/voice/parse-script.mjs'); process.exit(2); }
  console.log('lines.json up to date');
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${relative(ROOT, OUT)}`);
}
