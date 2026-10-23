#!/usr/bin/env node
// Magnate VO generator: lines.json -> takes (ElevenLabs or Kokoro) -> trim/measure/transcribe -> best take per line
// -> assets-src/vo/<role>/<id>.wav (+ .gen.json) and assets-src/vo/manifest.json.
//
//   node tools/voice/generate.mjs                      # whole batch; ElevenLabs per role, Kokoro if a role can't be voiced
//   node tools/voice/generate.mjs --provider kokoro    # whole batch locally with Kokoro (add --offline to forbid network)
//   node tools/voice/generate.mjs --only adv.cash.negative,news.intro --takes 5
//   node tools/voice/generate.mjs --ab                 # model A/B (eleven_multilingual_v2 vs eleven_v4) -> reports/model-ab.json
//   node tools/voice/generate.mjs --provider kokoro --samples   # 3 lines per role -> assets-src/vo/_kokoro_samples
//                                   (--role anchor --kokoro-voice am_michael renders an alternative voice beside them)
//   other flags: --role advisor|anchor  --out <dir>  --force  --reselect  --dry-run  --no-stt  --include-held  --concurrency N
//                --no-cache (re-render even cached takes)  --offline (Kokoro: cached weights only, network disabled)
//
// Takes: ElevenLabs renders 3 per line (seed = crc32(id) + take). Kokoro is deterministic, so its 3–6 takes search the
// speed for the role's pace band instead, transcribing each take as it renders (kokoroTakes below).
// Idempotent: a line whose <id>.gen.json carries the same lineHash is skipped without any API call, and every take is
// cached in tools/voice/.cache/tts by hash(sent text + voice + model + settings + seed/take + format), so unchanged
// takes are never billed twice. Rejected takes go to assets-src/vo/_takes (gitignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, dirname, resolve } from 'node:path';
import { ROOT, VOICE_DIR, CACHE_DIR, TMP_DIR, REPORTS_DIR, OUT_DIR, VENV_PY, loadElevenLabsKey, hasStt } from './lib/env.mjs';
import { ROLES, QA, FORMAT_PREFERENCE } from './lib/config.mjs';
import { textToSpeech, ProviderUnavailable, FormatRejected } from './lib/elevenlabs.mjs';
import { kokoroSynth, floatWav, nextKokoroSpeed, KOKORO_MODEL, KOKORO_DTYPE } from './lib/kokoro.mjs';
import { toMasterWav, readWav, writeWav, analyze, trim, loudness } from './lib/audio.mjs';
import { compare, magnateCheck, wordCount, seedFor, hashOf } from './lib/text.mjs';
import { scoreTake, pickBest, SELECTION_VERSION } from './lib/select.mjs';
import { syllables } from './lib/syllables.mjs';

const pexec = promisify(execFile);

// ---------------- CLI ----------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const args = {
  provider: opt('provider', null),
  roles: opt('role', 'advisor,anchor').split(','),
  only: opt('only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
  takes: opt('takes', null) ? Number(opt('takes')) : null,
  model: opt('model', null),
  out: opt('out', null) ? resolve(process.cwd(), opt('out')) : OUT_DIR,
  concurrency: Number(opt('concurrency', 2)),
  force: flag('force'),
  reselect: flag('reselect'),
  dryRun: flag('dry-run'),
  stt: !flag('no-stt'),
  includeHeld: flag('include-held'),
  offline: flag('offline'),
  ab: flag('ab'),
  samples: flag('samples'),
  tags: flag('tags'),
  noCache: flag('no-cache'),
};
if (flag('help') || flag('h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  console.log(src.slice(0, src.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
if (args.provider && !['elevenlabs', 'kokoro'].includes(args.provider)) throw new Error(`--provider must be elevenlabs or kokoro`);

const script = JSON.parse(readFileSync(join(VOICE_DIR, 'lines.json'), 'utf8'));
const probePath = join(REPORTS_DIR, 'elevenlabs-probe.json');
const probe = existsSync(probePath) ? JSON.parse(readFileSync(probePath, 'utf8')) : null;
const log = (...a) => console.log(...a);
const round = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// usage accounting for this run
const usage = { requests: 0, cachedTakes: 0, charactersSent: 0, creditsCharged: 0, kokoroRenders: 0 };

// ---------------- jobs ----------------
const usesTags = (model) => /^eleven_v(3|4)/.test(model);
const spokenText = (line) => line.tts ?? line.text;
const tagFor = (line) => line.delivery.split(',')[0].trim();

// Output format: the probe's choice (reports/elevenlabs-probe.json), else the first preference. If ElevenLabs refuses
// it mid-run (tier change), fetchTake() steps down FORMAT_PREFERENCE and every later request uses the new format.
let formatOverride = null;
function elevenFormat() {
  return formatOverride ?? probe?.chosenFormat ?? FORMAT_PREFERENCE[0];
}
const elevenHash = (job) => hashOf({ provider: 'elevenlabs', voice: job.voiceId, model: job.model, text: job.sent, settings: job.settings, seed: job.seed, format: job.format, normalization: 'on', dictionary: null });

function makeJob(line, provider, take, o = {}) {
  const R = ROLES[line.role];
  if (provider === 'elevenlabs') {
    const model = o.model ?? args.model ?? R.elevenlabs.model;
    const tags = o.tags ?? args.tags;
    const sent = (usesTags(model) && tags ? `[${tagFor(line)}] ` : '') + spokenText(line);
    const settings = o.speed !== undefined ? { ...R.elevenlabs.settings, speed: o.speed } : R.elevenlabs.settings;
    const seed = seedFor(line.id, take);
    const format = o.format ?? elevenFormat();
    const job = { line, provider, take, model, voiceId: R.elevenlabs.voiceId, voiceName: R.elevenlabs.voiceName, settings, seed, sent, format, tags: !!(usesTags(model) && tags) };
    return { ...job, hash: elevenHash(job) };
  }
  const K = R.kokoro;
  const voice = o.kokoroVoice ?? K.voice;
  const speed = o.speed ?? K.speed; // takes 2+ get their speed from kokoroTakes()
  const sent = spokenText(line);
  const key = { provider, voice, model: KOKORO_MODEL, dtype: KOKORO_DTYPE, text: sent, speed };
  return { line, provider, take, model: `${KOKORO_MODEL} (${KOKORO_DTYPE})`, voiceId: voice, voiceName: voice, settings: { speed }, seed: null, sent, format: 'f32le_24000', tags: false, hash: hashOf(key) };
}

function takesFor(role, provider) {
  return args.takes ?? ROLES[role].takes;
}

const KOKORO_SEARCH = 'bracket-stt-v2'; // how Kokoro takes 2+ choose their speed (bump to re-render every Kokoro line)

function lineHash(line, provider, takes, o = {}) {
  // Kokoro takes 2+ derive their speed from the takes before them, so take 1 + the search rule + its config identify the set
  const jobs = provider === 'kokoro' ? [makeJob(line, provider, 1, o).hash, KOKORO_SEARCH, takes, ROLES[line.role].kokoro] : Array.from({ length: takes }, (_, i) => makeJob(line, provider, i + 1, o).hash);
  return hashOf({ jobs, text: line.text, selection: SELECTION_VERSION, qa: QA, target: ROLES[line.role].target });
}

// ---------------- fetching (with cache) ----------------
const extFor = (fmt) => (fmt.startsWith('wav_') ? 'wav' : fmt.startsWith('pcm_') ? 'pcm' : fmt.startsWith('mp3_') ? 'mp3' : 'bin');
let apiKey;

async function fetchTake(job) {
  if (job.provider === 'elevenlabs' && formatOverride && FORMAT_PREFERENCE.indexOf(job.format) < FORMAT_PREFERENCE.indexOf(formatOverride)) {
    job.format = formatOverride;
    job.hash = elevenHash(job);
  }
  const dir = join(CACHE_DIR, 'tts', job.provider);
  mkdirSync(dir, { recursive: true });
  const audioPath = join(dir, `${job.hash}.${job.provider === 'kokoro' ? 'wav' : extFor(job.format)}`);
  const metaPath = join(dir, `${job.hash}.json`);
  if (!args.noCache && existsSync(audioPath) && existsSync(metaPath)) {
    usage.cachedTakes++;
    return { audioPath, meta: JSON.parse(readFileSync(metaPath, 'utf8')), cached: true };
  }
  if (args.reselect) throw new Error(`--reselect: ${job.line.id} take ${job.take} is not cached`);
  let meta;
  if (job.provider === 'elevenlabs') {
    if (apiKey === undefined) apiKey = loadElevenLabsKey();
    if (!apiKey) throw new ProviderUnavailable('no ElevenLabs key available', { status: 0, code: 'no_key' });
    let r;
    try {
      r = await textToSpeech({ key: apiKey, voiceId: job.voiceId, modelId: job.model, text: job.sent, settings: job.settings, seed: job.seed, outputFormat: job.format, normalization: 'on' });
    } catch (e) {
      const next = FORMAT_PREFERENCE[FORMAT_PREFERENCE.indexOf(job.format) + 1];
      if (!(e instanceof FormatRejected) || !next) throw e;
      if (formatOverride !== next) log(`  ElevenLabs refused ${job.format} (${e.info?.code ?? e.message}); using ${next} from now on`);
      formatOverride = next;
      usage.formatFallback = { from: probe?.chosenFormat ?? FORMAT_PREFERENCE[0], to: next, reason: e.message };
      return fetchTake(job);
    }
    writeFileSync(audioPath, r.audio);
    const cost = Number(r.headers['character-cost']);
    meta = { provider: 'elevenlabs', at: new Date().toISOString(), requestId: r.requestId, historyItemId: r.headers['history-item-id'] ?? null, characterCost: Number.isFinite(cost) ? cost : null, characters: job.sent.length, contentType: r.contentType, format: job.format, bytes: r.audio.length };
    usage.requests++;
    usage.charactersSent += job.sent.length;
    if (Number.isFinite(cost)) usage.creditsCharged += cost;
  } else {
    const r = await kokoroSynth({ text: job.sent, voice: job.voiceId, speed: job.settings.speed, offline: args.offline });
    writeFileSync(audioPath, floatWav(r.samples, r.sampleRate));
    meta = { provider: 'kokoro', at: new Date().toISOString(), sampleRate: r.sampleRate, modelLoadMs: r.loadMs };
    usage.kokoroRenders++;
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  return { audioPath, meta, cached: false };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (next < items.length && !failure) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { failure = failure ?? e; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  if (failure) throw failure;
  return results;
}

// ---------------- processing ----------------
async function processTake(job, fetched, workDir) {
  mkdirSync(join(TMP_DIR, 'raw48'), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const raw48 = join(TMP_DIR, 'raw48', `${job.hash}.wav`);
  if (args.noCache || !existsSync(raw48)) {
    const raw = job.provider === 'elevenlabs' && job.format.startsWith('pcm_') ? { sampleRate: Number(job.format.split('_')[1]), channels: 1 } : null;
    await toMasterWav(fetched.audioPath, raw48, { raw });
  }
  const { samples, sampleRate } = readWav(raw48);
  const a = analyze(samples, sampleRate);
  const t = trim(samples, sampleRate, a, QA);
  const path = join(workDir, `t${job.take}.wav`);
  writeWav(path, t.samples, sampleRate);
  const loud = await loudness(path);
  const spoken = spokenText(job.line).replace(/\[[^\]]*\]/g, '');
  const words = wordCount(spoken);
  const syl = await syllables(spoken);
  const sylPerSec = syl / a.speechSec;
  return {
    job,
    path,
    fetchedMeta: fetched.meta,
    metrics: {
      durationSec: round(t.samples.length / sampleRate, 3),
      speechSec: round(a.speechSec, 3),
      words,
      syllables: syl,
      wpm: round(words / (a.speechSec / 60)),
      sylPerSec: round(sylPerSec, 2),
      paceWpm: round((sylPerSec * 60) / ROLES[job.line.role].target.refSpw),
      maxGapMs: a.maxGapMs,
      pauses: a.pauses,
      samplePeakDbfs: a.samplePeakDbfs,
      clippedSamples: a.clippedSamples,
      truePeakDbtp: loud.truePeakDbtp,
      lufsI: loud.lufsI,
      lra: loud.lra,
      noiseFloorDb: a.floorDb,
      headTrimmedMs: t.headTrimmedMs,
      tailTrimmedMs: t.tailTrimmedMs,
    },
  };
}

const STT_MODEL = 'base.en';
const sttEnv = () => ({ ...process.env, PYTHONWARNINGS: 'ignore', ...(args.offline ? { HF_HUB_OFFLINE: '1' } : {}) });

// transcript -> QA metrics on the take (compared with the subtitle text, so a `tts` alias must still read as the text)
function applyStt(r, s, model) {
  if (!s || s.error) { r.metrics.stt = { error: s?.error ?? 'missing' }; return; }
  const c = compare(r.job.line.text, s.text);
  const lowConf = (s.words ?? []).filter((w) => w.p < 0.3).map((w) => `${w.w} (p ${w.p})`);
  r.metrics.stt = { model, text: s.text, wer: c.wer, cer: c.cer, ...(lowConf.length ? { lowConf } : {}), ...(s.droppedTail ? { droppedTail: s.droppedTail } : {}), ...(/magnate/i.test(r.job.line.text) ? { magnate: magnateCheck(s.text) } : {}) };
}

// Batch transcription of every take not transcribed yet (one Python process, model loaded once).
async function transcribe(results) {
  if (!args.stt || !hasStt()) return null;
  const todo = results.filter((r) => !r.metrics.stt);
  if (!todo.length) return results.length ? STT_MODEL : null;
  mkdirSync(TMP_DIR, { recursive: true });
  const list = join(TMP_DIR, `stt-in-${process.pid}.json`);
  const out = join(TMP_DIR, `stt-out-${process.pid}.json`);
  writeFileSync(list, JSON.stringify(todo.map((r) => ({ key: r.path, path: r.path }))));
  log(`stt: transcribing ${todo.length} takes (faster-whisper ${STT_MODEL}, CPU)…`);
  await pexec(VENV_PY, [join(VOICE_DIR, 'stt.py'), '--in', list, '--out', out, '--model', STT_MODEL], { maxBuffer: 64 * 1024 * 1024, env: sttEnv() });
  const stt = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(list, { force: true });
  rmSync(out, { force: true });
  for (const r of todo) applyStt(r, stt.results[r.path], stt.model);
  return stt.model;
}

// Long-lived transcriber for takes that are judged as they render (the Kokoro speed search). Requests are answered in
// order, one JSON line each; the process exits when its stdin closes.
let sttWorker = null;
function sttServer() {
  if (sttWorker) return sttWorker;
  const proc = spawn(VENV_PY, [join(VOICE_DIR, 'stt.py'), '--serve', '--model', STT_MODEL], { stdio: ['pipe', 'pipe', 'ignore'], env: sttEnv() });
  const waiting = [];
  let buf = '';
  let failed = null;
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  const fail = (e) => { failed = e; markReady(); while (waiting.length) waiting.shift().reject(e); };
  proc.on('error', fail);
  proc.on('exit', (code) => fail(new Error(`stt worker exited (${code})`)));
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const lineText = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!lineText.startsWith('{')) continue; // stray library output on stdout
      const msg = JSON.parse(lineText);
      if (msg.ready) { markReady(); continue; }
      waiting.shift()?.resolve(msg);
    }
  });
  sttWorker = {
    async transcribe(r) {
      await ready;
      if (failed) throw failed;
      const p = new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      proc.stdin.write(JSON.stringify({ key: r.path, path: r.path }) + '\n');
      applyStt(r, await p, STT_MODEL);
    },
    close() { proc.removeAllListeners('exit'); proc.stdin.end(); sttWorker = null; },
  };
  return sttWorker;
}

// ---------------- selection + outputs ----------------
function relOut(p) { return relative(args.out, p).split('\\').join('/'); }

function writeLineOutputs(line, results, hashOfLine, roleStatus) {
  const target = ROLES[line.role].target;
  for (const r of results) r.score = scoreTake(r.metrics, target);
  const best = pickBest(results);
  const roleDir = join(args.out, line.role);
  mkdirSync(roleDir, { recursive: true });
  const master = join(roleDir, `${line.id}.wav`);
  copyFileSync(best.path, master);
  rmSync(best.path, { force: true });
  const takesDir = dirname(best.path);
  if (existsSync(takesDir) && readdirSync(takesDir).length === 0) rmSync(takesDir, { recursive: true, force: true });
  const j = best.job;
  const m = best.metrics;
  const gen = {
    id: line.id,
    role: line.role,
    text: line.text,
    ...(line.tts ? { tts: line.tts } : {}),
    sentText: j.sent,
    provider: j.provider,
    model: j.model,
    voice: { id: j.voiceId, name: j.voiceName },
    settings: j.settings,
    ...(j.provider === 'elevenlabs' ? { applyTextNormalization: 'on', pronunciationDictionary: null, outputFormat: j.format, deliveryTag: j.tags ? tagFor(line) : null } : { outputFormat: 'kokoro f32 24 kHz' }),
    seed: j.seed,
    take: j.take,
    takesConsidered: results.length,
    requestId: best.fetchedMeta?.requestId ?? null,
    historyItemId: best.fetchedMeta?.historyItemId ?? null,
    characterCost: best.fetchedMeta?.characterCost ?? null,
    generatedAt: best.fetchedMeta?.at ?? null,
    file: `${line.id}.wav`,
    format: { sampleRate: 48000, channels: 1, bitDepth: 16, mastered: false },
    durationSec: m.durationSec,
    speechSec: m.speechSec,
    wpm: m.wpm,
    syllables: m.syllables,
    sylPerSec: m.sylPerSec,
    paceWpm: m.paceWpm,
    paceTarget: target,
    maxGapMs: m.maxGapMs,
    samplePeakDbfs: m.samplePeakDbfs,
    truePeakDbtp: m.truePeakDbtp,
    lufsI: m.lufsI,
    lra: m.lra,
    trim: { padMs: QA.padMs, fadeMs: QA.fadeMs, headTrimmedMs: m.headTrimmedMs, tailTrimmedMs: m.tailTrimmedMs },
    stt: m.stt ?? null,
    score: best.score,
    flags: best.score.flags,
    ...(roleStatus.fallback ? { fallback: roleStatus.fallback } : {}),
    rejected: results.filter((r) => r !== best).map((r) => ({ take: r.job.take, seed: r.job.seed, settings: r.job.provider === 'kokoro' ? r.job.settings : undefined, wpm: r.metrics.wpm, paceWpm: r.metrics.paceWpm, maxGapMs: r.metrics.maxGapMs, lufsI: r.metrics.lufsI, cer: r.metrics.stt?.cer ?? null, transcript: r.metrics.stt?.text ?? null, score: r.score, file: relOut(r.path) })),
    lineHash: hashOfLine,
  };
  writeFileSync(join(roleDir, `${line.id}.gen.json`), JSON.stringify(gen, null, 2) + '\n');
  return gen;
}

function readGen(line) {
  const p = join(args.out, line.role, `${line.id}.gen.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function writeManifest(roleStatus) {
  const lines = [];
  for (const line of script.lines) {
    const base = { id: line.id, role: line.role, text: line.text, ...(line.tts ? { tts: line.tts } : {}), priority: line.priority, ...(line.tutorial ? { tutorial: true } : {}), delivery: line.delivery, ...(line.legacyAlias ? { legacyAlias: line.legacyAlias } : {}), ...(line.aliases ? { aliases: line.aliases } : {}) };
    if (line.hold && !existsSync(join(args.out, line.role, `${line.id}.wav`))) { lines.push({ ...base, file: null, status: 'held', hold: line.hold }); continue; }
    const g = readGen(line);
    if (!g || !existsSync(join(args.out, line.role, `${line.id}.wav`))) { lines.push({ ...base, file: null, status: 'missing' }); continue; }
    lines.push({
      ...base,
      file: `${line.role}/${line.id}.wav`,
      duration: g.durationSec,
      provider: g.provider,
      model: g.model,
      voice: g.voice.name,
      wpm: g.wpm,
      paceWpm: g.paceWpm,
      lufsI: g.lufsI,
      truePeakDbtp: g.truePeakDbtp,
      ...(g.flags.length ? { qa: g.flags } : {}),
      ...(line.needsReview ? { needsReview: line.needsReview } : {}),
      ...(line.hold ? { hold: line.hold } : {}),
      ...(line.legacyOnly ? { legacyOnly: true } : {}),
    });
  }
  const providers = {};
  for (const role of ['advisor', 'anchor']) {
    const ls = lines.filter((l) => l.role === role && l.file);
    const set = [...new Set(ls.map((l) => `${l.provider} / ${l.model} / ${l.voice}`))];
    // fallback reason: from this run, else from the masters themselves (a later run may touch only one role)
    const fb = roleStatus[role]?.fallback ?? script.lines.filter((l) => l.role === role).map(readGen).find((g) => g?.fallback && g.provider === 'kokoro')?.fallback;
    providers[role] = { voicedBy: set, ...(fb ? { fallback: fb } : {}) };
  }
  const manifest = {
    _doc: 'GENERATED by tools/voice/generate.mjs. Clean, trimmed, unmastered 48 kHz / mono / 16-bit WAV masters (lead-in and tail ≈ 120 ms). Loudness mastering (−18 LUFS-I, ≤ −1.5 dBTP) and Opus/m4a encoding happen in the audio mastering pipeline. `text` is the subtitle; `tts` the spoken text when different.',
    version: 1,
    format: { container: 'wav', sampleRate: 48000, channels: 1, bitDepth: 16, mastered: false, padMs: QA.padMs },
    roles: providers,
    counts: { lines: lines.length, voiced: lines.filter((l) => l.file).length, held: lines.filter((l) => l.status === 'held').length, missing: lines.filter((l) => l.status === 'missing').length },
    legacyMap: Object.fromEntries(Object.entries(script.legacyMap).map(([k, v]) => [k, v ? `${script.lines.find((l) => l.id === v).role}/${v}.wav` : null])),
    aliasMap: script.aliasMap,
    lines,
  };
  writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// ---------------- generation of one role ----------------
// Kokoro is deterministic (no seed), so its takes vary the speed instead, searching for the role's pace band.
// Kokoro's speed -> pace curve is a staircase, not a line: each phoneme lasts round(d / speed) frames and many tokens
// share d ≈ 2, so the pace jumps 10–15 % near speed 0.80 and 1.33 and hardly moves between the steps (0.88 and 0.90
// render the same length). Take 1 uses the role's base speed. Each further take aims at the band centre: proportionally
// while every take sits on one side of it, then by regula falsi inside the tightest bracket (lib/kokoro.mjs). Every
// take is measured and transcribed as it renders. The search ends when `takes` takes exist and one is a keeper (in the
// band, no hard QA failure, transcript exact), when the bracket is narrower than 0.004 (the band falls inside one step),
// when the speed limits leave nothing new to try, or at `maxTakes`. pickBest() then chooses among all of them.
async function kokoroTakes(lines, o, takes, workRoot) {
  const fetched = new Map();
  const processed = new Map();
  const jobs = [];
  let rendered = 0;
  const stt = args.stt && hasStt() ? sttServer() : null;
  for (const line of lines) {
    const K = ROLES[line.role].kokoro;
    const band = ROLES[line.role].target;
    const maxTakes = Math.max(takes, K.maxTakes ?? takes);
    const tried = [];
    let speed = o.speed ?? K.speed;
    for (let take = 1; take <= maxTakes && speed !== null; take++) {
      const job = makeJob(line, 'kokoro', take, { ...o, speed });
      const f = await fetchTake(job);
      const r = await processTake(job, f, join(workRoot, line.id));
      jobs.push(job);
      fetched.set(job, f);
      processed.set(job, r);
      if (stt) await stt.transcribe(r);
      const sc = scoreTake(r.metrics, band);
      const inBand = r.metrics.paceWpm >= band.wpmMin && r.metrics.paceWpm <= band.wpmMax;
      // a keeper: in the band, no hard QA failure, and (when STT runs) a transcript that matches the script exactly
      tried.push({ speed, pace: r.metrics.paceWpm, keeper: inBand && sc.hard === 0 && (!stt || r.metrics.stt?.cer === 0) });
      if (!f.cached && ++rendered % 25 === 0) log(`  kokoro ${line.role}: ${rendered} takes rendered (line ${lines.indexOf(line) + 1}/${lines.length})`);
      if (take >= takes && tried.some((x) => x.keeper)) break;
      speed = nextKokoroSpeed(tried, K, band);
    }
  }
  return { jobs, fetched, processed, partial: null };
}

async function generateLines(lines, provider, o = {}) {
  const takes = o.takes ?? takesFor(lines[0].role, provider);
  if (provider === 'kokoro') return kokoroTakes(lines, o, takes, o.workRoot ?? join(TMP_DIR, 'kokoro-work'));
  const jobs = [];
  for (let t = 1; t <= takes; t++) for (const line of lines) jobs.push(makeJob(line, provider, t, o));
  const conc = provider === 'kokoro' ? 1 : args.concurrency;
  // pass 1 = take 1 of every line (so a quota stop still leaves a complete one-provider set), then the remaining takes
  const fetched = new Map();
  const first = jobs.filter((j) => j.take === 1);
  const rest = jobs.filter((j) => j.take > 1);
  let done = 0;
  const step = async (j) => {
    const f = await fetchTake(j);
    fetched.set(j, f);
    done++;
    if (!f.cached && (done % 10 === 0 || done === jobs.length)) log(`  ${provider} ${lines[0].role}: ${done}/${jobs.length} takes`);
  };
  await pool(first, conc, step);
  let partial = null;
  try {
    await pool(rest, conc, step);
  } catch (e) {
    if (!(e instanceof ProviderUnavailable) || o.strict) throw e;
    partial = `stopped after ${fetched.size}/${jobs.length} takes: ${e.message}`;
    log(`  WARNING ${partial} — selecting among the takes already received`);
  }
  return { jobs: jobs.filter((j) => fetched.has(j)), fetched, partial };
}

async function processAndSelect(lines, gen, roleStatus, hashes, workRoot) {
  const results = await pool(gen.jobs, 4, (j) => gen.processed?.get(j) ?? processTake(j, gen.fetched.get(j), join(workRoot, j.line.id)));
  const sttModel = await transcribe(results);
  const out = [];
  for (const line of lines) {
    const rs = results.filter((r) => r.job.line === line);
    if (!rs.length) continue;
    out.push(writeLineOutputs(line, rs, hashes.get(line.id), roleStatus));
  }
  return { gens: out, sttModel };
}

async function runRole(role, roleStatus) {
  const roleLines = script.lines.filter((l) => l.role === role && (args.includeHeld || !l.hold || (args.only && args.only.includes(l.id))));
  let lines = args.only ? roleLines.filter((l) => args.only.includes(l.id)) : roleLines;
  if (!lines.length) return [];
  let provider = args.provider ?? 'elevenlabs';
  const status = (roleStatus[role] = { provider, fallback: null, partial: null });
  const plan = (p) => {
    const hashes = new Map(lines.map((l) => [l.id, lineHash(l, p, takesFor(role, p))]));
    const todo = lines.filter((l) => {
      if (args.force || args.reselect) return true;
      const g = readGen(l);
      return !(g && g.lineHash === hashes.get(l.id) && existsSync(join(args.out, role, `${l.id}.wav`)));
    });
    return { hashes, todo };
  };
  let { hashes, todo } = plan(provider);
  log(`${role}: ${lines.length} lines, ${todo.length} to (re)generate with ${provider}${provider === 'elevenlabs' ? ` (${args.model ?? ROLES[role].elevenlabs.model}, ${elevenFormat()})` : ''}`);
  if (!todo.length) return [];
  if (args.dryRun) {
    const takes = takesFor(role, provider);
    const chars = todo.reduce((s, l) => s + spokenText(l).length, 0) * takes;
    log(`  dry run: ${todo.length} lines × ${takes} takes ≈ ${chars} characters (before cache hits)`);
    return [];
  }
  const workRoot = join(args.out, '_takes');
  const clearTakes = (ls) => { for (const l of ls) rmSync(join(workRoot, l.id), { recursive: true, force: true }); };
  clearTakes(todo); // drop stale takes
  let gen;
  try {
    gen = await generateLines(todo, provider, { workRoot });
  } catch (e) {
    if (provider !== 'elevenlabs' || !(e instanceof ProviderUnavailable)) throw e;
    // one provider per role: re-voice the ENTIRE role with Kokoro
    status.fallback = { from: 'elevenlabs', to: 'kokoro', reason: e.message, at: new Date().toISOString() };
    log(`  ElevenLabs unavailable for ${role} (${e.message}); re-voicing all ${lines.length} ${role} lines with Kokoro`);
    provider = status.provider = 'kokoro';
    // the whole role ends up on Kokoro (even with --only): every line not already an up-to-date Kokoro master is rendered
    lines = roleLines;
    ({ hashes, todo } = plan(provider));
    log(`  kokoro ${role}: ${todo.length} of ${lines.length} lines need rendering`);
    if (!todo.length) return [];
    clearTakes(todo);
    gen = await generateLines(todo, provider, { workRoot });
  }
  status.partial = gen.partial;
  const { gens, sttModel } = await processAndSelect(todo, gen, status, hashes, workRoot);
  status.sttModel = sttModel;
  return gens;
}

// ---------------- A/B and samples modes ----------------
async function runAB() {
  // Round 1 uses the audio-plan §3.5 settings as written (advisor speed 0.92, anchor 1.0). Round 2 re-runs the same
  // lines with each model's speed calibrated from round 1 toward the pace band, so the models are compared at equal
  // pace rather than penalised for a speed value tuned on the legacy files. v2/v4 get 2 seeds for the advisor (the
  // winner's takes are reused by the batch through the cache); v4 with a delivery tag ("[warm] …") gets one seed.
  const rounds = {
    1: {
      advisor: [
        { name: 'eleven_multilingual_v2@0.92', model: 'eleven_multilingual_v2', tags: false, takes: 2, speed: 0.92 },
        { name: 'eleven_v4@0.92', model: 'eleven_v4', tags: false, takes: 2, speed: 0.92 },
        { name: 'eleven_v4+tags@0.92', model: 'eleven_v4', tags: true, takes: 1, speed: 0.92 },
      ],
      anchor: [
        { name: 'eleven_multilingual_v2@1.0', model: 'eleven_multilingual_v2', tags: false, takes: 1, speed: 1.0 },
        { name: 'eleven_v4@1.0', model: 'eleven_v4', tags: false, takes: 1, speed: 1.0 },
      ],
    },
    2: {
      advisor: [
        { name: 'eleven_multilingual_v2@0.82', model: 'eleven_multilingual_v2', tags: false, takes: 2, speed: 0.82 },
        { name: 'eleven_v4@1.0', model: 'eleven_v4', tags: false, takes: 2, speed: 1.0 },
        { name: 'eleven_v4+tags@1.0', model: 'eleven_v4', tags: true, takes: 1, speed: 1.0 },
      ],
      anchor: [
        { name: 'eleven_multilingual_v2@1.1', model: 'eleven_multilingual_v2', tags: false, takes: 1, speed: 1.1 },
        { name: 'eleven_v4@1.1', model: 'eleven_v4', tags: false, takes: 1, speed: 1.1 },
      ],
    },
  };
  const ids = {
    advisor: ['adv.onboard.welcome', 'adv.cash.negative', 'adv.ipo.eligible', 'adv.end.defeat_bankrupt', 'adv.market.price_war'],
    anchor: ['news.intro', 'news.recession', 'news.commodity_spike'],
  };
  const wanted = (opt('ab-rounds', '1,2')).split(',');
  const reportPath = join(REPORTS_DIR, 'model-ab.json');
  const report = existsSync(reportPath) && JSON.parse(readFileSync(reportPath, 'utf8')).rounds ? JSON.parse(readFileSync(reportPath, 'utf8')) : { rounds: {} };
  report.date = new Date().toISOString();
  report.method = 'Objective proxies only (no listening): pace vs the role band (advisor 150–165 wpm, anchor 155–175), longest internal pause (> 600 ms rejects), loudness spread (LUFS-I std across lines), transcript CER vs the script (faster-whisper base.en, no prompt), low-confidence transcript words, and the "magnate" check. Same seeds (crc32(id)+take) for every model.';
  report.lines = ids;
  for (const rn of wanted) {
    const roundDef = rounds[rn];
    report.rounds[rn] = { results: {}, summary: {} };
    for (const role of Object.keys(roundDef)) {
      const lines = ids[role].map((id) => script.lines.find((l) => l.id === id));
      report.rounds[rn].results[role] = {};
      report.rounds[rn].summary[role] = {};
      for (const v of roundDef[role]) {
        let gen;
        try {
          gen = await generateLines(lines, 'elevenlabs', { model: v.model, tags: v.tags, takes: v.takes, speed: v.speed, strict: true });
        } catch (e) {
          if (!(e instanceof ProviderUnavailable)) throw e;
          report.rounds[rn].summary[role][v.name] = { model: v.model, speed: v.speed, tags: v.tags, skipped: e.message };
          log(`round ${rn} ${role} ${v.name}: SKIPPED (${e.message})`);
          continue;
        }
        const results = await pool(gen.jobs, 4, (j) => processTake(j, gen.fetched.get(j), join(args.out, '_ab', v.name, j.line.id)));
        await transcribe(results);
        const target = ROLES[role].target;
        const rows = results.map((r) => ({ id: r.job.line.id, take: r.job.take, seed: r.job.seed, sent: r.job.sent, settings: r.job.settings, ...r.metrics, pauses: undefined, score: scoreTake(r.metrics, target), requestId: r.fetchedMeta?.requestId, characterCost: r.fetchedMeta?.characterCost }));
        report.rounds[rn].results[role][v.name] = rows;
        const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
        const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
        const outside = (w) => (w < target.wpmMin ? target.wpmMin - w : w > target.wpmMax ? w - target.wpmMax : 0);
        report.rounds[rn].summary[role][v.name] = {
          model: v.model,
          speed: v.speed,
          tags: v.tags,
          takes: rows.length,
          meanWpm: round(mean(rows.map((r) => r.wpm))),
          inBand: rows.filter((r) => outside(r.wpm) === 0).length,
          meanWpmOutsideBand: round(mean(rows.map((r) => outside(r.wpm)))),
          maxPauseMs: Math.max(...rows.map((r) => r.maxGapMs)),
          takesWithPauseOver600: rows.filter((r) => r.maxGapMs > QA.maxGapMs).length,
          lufsMean: round(mean(rows.map((r) => r.lufsI))),
          lufsStd: round(sd(rows.map((r) => r.lufsI)), 2),
          meanCer: round(mean(rows.map((r) => r.stt?.cer ?? 0)), 3),
          exactTranscripts: rows.filter((r) => (r.stt?.cer ?? 1) === 0).length,
          transcriptsDiffering: rows.filter((r) => (r.stt?.cer ?? 0) > QA.maxCer).length,
          lowConfidenceWords: rows.reduce((a, r) => a + (r.stt?.lowConf?.length ?? 0), 0),
          magnate: rows.filter((r) => r.stt?.magnate).map((r) => r.stt.magnate),
          hardFlags: rows.reduce((a, r) => a + r.score.hard, 0),
          meanScore: round(mean(rows.map((r) => r.score.soft)), 3),
          creditsCharged: rows.reduce((a, r) => a + (r.characterCost ?? 0), 0),
          charactersSent: rows.reduce((a, r) => a + r.sent.length, 0),
        };
        log(`round ${rn} ${role} ${v.name}: ${JSON.stringify(report.rounds[rn].summary[role][v.name])}`);
      }
    }
  }
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  log(`wrote ${relative(ROOT, reportPath)}`);
}

async function runSamples() {
  const sets = { advisor: ['adv.onboard.welcome', 'adv.ipo.eligible', 'adv.end.defeat_bankrupt'], anchor: ['news.intro', 'news.recession', 'news.market_crash'] };
  const outRoot = join(OUT_DIR, '_kokoro_samples');
  const voiceOverride = opt('kokoro-voice', null);
  const summary = { _doc: 'Proof that the Kokoro fallback works on this machine: 3 lines per role rendered locally by tools/voice/generate.mjs --provider kokoro --samples (best of the speed takes), transcribed by faster-whisper base.en.', model: `${KOKORO_MODEL} (${KOKORO_DTYPE})`, runtime: 'kokoro-js + onnxruntime-node (CPU)', samples: [] };
  for (const [role, ids] of Object.entries(sets)) {
    if (!args.roles.includes(role)) continue;
    const lines = ids.map((id) => script.lines.find((l) => l.id === id));
    const o = voiceOverride ? { kokoroVoice: voiceOverride } : {};
    const t0 = Date.now();
    const gen = await generateLines(lines, 'kokoro', { ...o, workRoot: join(TMP_DIR, 'samples', role) });
    const renderMs = Date.now() - t0;
    const results = await pool(gen.jobs, 4, (j) => gen.processed?.get(j) ?? processTake(j, gen.fetched.get(j), join(TMP_DIR, 'samples', role, j.line.id)));
    await transcribe(results);
    mkdirSync(join(outRoot, role), { recursive: true });
    for (const line of lines) {
      const rs = results.filter((r) => r.job.line === line);
      for (const r of rs) r.score = scoreTake(r.metrics, ROLES[role].target);
      const best = pickBest(rs);
      const file = `${role}/${line.id}${voiceOverride ? `.${voiceOverride}` : ''}.wav`;
      copyFileSync(best.path, join(outRoot, file));
      summary.samples.push({ id: line.id, role, file, text: line.text, sentText: best.job.sent, voice: best.job.voiceId, speed: best.job.settings.speed, durationSec: best.metrics.durationSec, wpm: best.metrics.wpm, paceWpm: best.metrics.paceWpm, sylPerSec: best.metrics.sylPerSec, maxGapMs: best.metrics.maxGapMs, lufsI: best.metrics.lufsI, truePeakDbtp: best.metrics.truePeakDbtp, transcript: best.metrics.stt?.text ?? null, cer: best.metrics.stt?.cer ?? null, magnate: best.metrics.stt?.magnate, flags: best.score.flags, allTakes: rs.map((r) => ({ speed: r.job.settings.speed, wpm: r.metrics.wpm, paceWpm: r.metrics.paceWpm, cer: r.metrics.stt?.cer })) });
    }
    log(`${role}: ${gen.jobs.length} Kokoro takes (cached or rendered) in ${(renderMs / 1000).toFixed(1)} s, incl. model load`);
  }
  const sumPath = join(outRoot, voiceOverride ? `samples.${voiceOverride}.json` : 'samples.json');
  writeFileSync(sumPath, JSON.stringify(summary, null, 2) + '\n');
  for (const s of summary.samples) log(`  ${s.file}: ${s.wpm} wpm (pace ${s.paceWpm}), speed ${s.speed}, CER ${s.cer}, "${s.transcript}"${s.flags.length ? ` [${s.flags.join('; ')}]` : ''}`);
  log(`wrote ${relative(ROOT, sumPath)}`);
}

// ---------------- main ----------------
async function main() {
  if (args.ab) return runAB();
  if (args.samples) return runSamples();
  const roleStatus = {};
  const all = [];
  for (const role of args.roles) all.push(...(await runRole(role, roleStatus)));
  if (args.dryRun) return;
  const manifest = writeManifest(roleStatus);
  // QA summary for humans
  const qa = { date: new Date().toISOString(), out: relative(ROOT, args.out), roleStatus, usage, lines: [] };
  for (const line of script.lines) {
    const g = readGen(line);
    if (!g) continue;
    qa.lines.push({ id: line.id, role: line.role, provider: g.provider, model: g.model, take: g.take, settings: g.settings, wpm: g.wpm, paceWpm: g.paceWpm, sylPerSec: g.sylPerSec, maxGapMs: g.maxGapMs, lufsI: g.lufsI, truePeakDbtp: g.truePeakDbtp, cer: g.stt?.cer ?? null, wer: g.stt?.wer ?? null, transcript: g.stt?.text ?? null, magnate: g.stt?.magnate, flags: g.flags, ...(line.needsReview ? { needsReview: true } : {}) });
  }
  // the QA report of the committed masters lives in reports/; a run into another --out keeps its report there
  const qaPath = args.out === OUT_DIR ? join(REPORTS_DIR, 'qa.json') : join(args.out, 'qa.json');
  mkdirSync(dirname(qaPath), { recursive: true });
  writeFileSync(qaPath, JSON.stringify(qa, null, 2) + '\n');
  const usageLog = join(REPORTS_DIR, 'usage.json');
  const prev = existsSync(usageLog) ? JSON.parse(readFileSync(usageLog, 'utf8')) : { runs: [] };
  if (usage.requests || usage.kokoroRenders) {
    prev.runs.push({ date: new Date().toISOString(), out: relative(ROOT, args.out), roles: Object.fromEntries(Object.entries(roleStatus).map(([r, s]) => [r, s.provider])), ...usage });
    prev.totals = prev.runs.reduce((t, r) => ({ requests: t.requests + r.requests, charactersSent: t.charactersSent + r.charactersSent, creditsCharged: t.creditsCharged + r.creditsCharged, kokoroRenders: t.kokoroRenders + r.kokoroRenders }), { requests: 0, charactersSent: 0, creditsCharged: 0, kokoroRenders: 0 });
    writeFileSync(usageLog, JSON.stringify(prev, null, 2) + '\n');
  }
  const flagged = qa.lines.filter((l) => l.flags.length);
  log(`\nmanifest: ${manifest.counts.voiced}/${manifest.counts.lines} voiced, ${manifest.counts.held} held, ${manifest.counts.missing} missing -> ${relative(ROOT, join(args.out, 'manifest.json'))}`);
  log(`this run: ${usage.requests} API requests, ${usage.charactersSent} characters sent, ${usage.creditsCharged} credits charged, ${usage.cachedTakes} cached takes, ${usage.kokoroRenders} Kokoro renders`);
  for (const [r, s] of Object.entries(roleStatus)) log(`${r}: ${s.provider}${s.fallback ? ` (FALLBACK: ${s.fallback.reason})` : ''}${s.partial ? ` (PARTIAL TAKES: ${s.partial})` : ''}`);
  if (flagged.length) {
    log(`\n${flagged.length} lines with QA flags on the chosen take:`);
    for (const l of flagged) log(`  ${l.id}: ${l.flags.join('; ')}`);
  }
}

main()
  .then(() => sttWorker?.close())
  .catch((e) => {
    console.error(`FAILED: ${e.name}: ${e.message}`);
    process.exit(1);
  });
