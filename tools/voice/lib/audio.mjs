// Audio helpers: format conversion (ffmpeg), WAV I/O, speech-span analysis, trimming and loudness.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { FFMPEG } from './env.mjs';

const pexec = promisify(execFile);

export async function ffmpeg(args) {
  if (!FFMPEG) throw new Error('ffmpeg >= 5 not found (set FFMPEG=/path/to/ffmpeg)');
  const { stderr } = await pexec(FFMPEG, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stderr;
}

/**
 * Convert any provider output to the master format: 48 kHz, mono, 16-bit PCM WAV.
 * `raw` = { sampleRate, channels } for headerless s16le PCM (ElevenLabs pcm_* formats).
 */
export async function toMasterWav(input, output, { raw = null } = {}) {
  const inArgs = raw ? ['-f', 's16le', '-ar', String(raw.sampleRate), '-ac', String(raw.channels), '-i', input] : ['-i', input];
  await ffmpeg(['-loglevel', 'error', '-y', ...inArgs, '-af', 'aresample=48000:resampler=soxr:precision=28:dither_method=triangular', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', output]);
}

export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${path}: not a RIFF/WAVE file`);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('latin1', off, off + 4);
    let size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'data' && (size === 0 || size === 0xffffffff || body + size > b.length)) size = b.length - body; // streamed WAVs
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    if (id === 'data') { data = b.subarray(body, body + size); break; }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt/data chunk`);
  if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`${path}: expected 16-bit mono PCM, got fmt=${fmt.format} bits=${fmt.bits} ch=${fmt.channels}`);
  const samples = new Int16Array(data.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate: fmt.sampleRate, samples };
}

export function writeWav(path, samples, sampleRate = 48000) {
  const dataBytes = samples.length * 2;
  const b = Buffer.alloc(44 + dataBytes);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2);
  writeFileSync(path, b);
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/**
 * Finds the voiced span and the internal pauses on a 10 ms RMS envelope.
 * Thresholds adapt to the take: edge = max(floor+8, loud-50, -70) dBFS; pause = max(floor+10, loud-40) dBFS,
 * where floor = 5th and loud = 98th percentile of the frame levels.
 */
export function analyze(samples, sampleRate) {
  const frame = Math.round(sampleRate * 0.01);
  const n = Math.floor(samples.length / frame);
  const lv = new Float64Array(n);
  let peak = 0;
  let clipped = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 32767) { run++; if (run === 2) clipped += 2; else if (run > 2) clipped++; } else run = 0;
  }
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) s += samples[i] * samples[i];
    lv[f] = db(Math.sqrt(s / frame) / 32768);
  }
  const sorted = Array.from(lv).sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(n - 1, Math.max(0, Math.floor(n * p)))];
  const floor = pct(0.05);
  const loud = pct(0.98);
  const edgeThr = Math.max(floor + 8, loud - 50, -70);
  const gapThr = Math.max(floor + 10, loud - 40);
  let start = 0;
  while (start < n - 1 && !(lv[start] > edgeThr && lv[start + 1] > edgeThr)) start++;
  let end = n - 1;
  while (end > 0 && !(lv[end] > edgeThr && lv[end - 1] > edgeThr)) end--;
  if (end <= start) { start = 0; end = n - 1; }
  const pauses = [];
  let g = -1;
  for (let f = start; f <= end; f++) {
    if (lv[f] < gapThr) { if (g < 0) g = f; } else if (g >= 0) {
      const ms = (f - g) * 10;
      if (ms >= 150) pauses.push({ atMs: g * 10, ms });
      g = -1;
    }
  }
  const startSample = start * frame;
  const endSample = Math.min(samples.length, (end + 1) * frame);
  return {
    durationSec: samples.length / sampleRate,
    speechStartSec: startSample / sampleRate,
    speechEndSec: endSample / sampleRate,
    speechSec: (endSample - startSample) / sampleRate,
    pauses,
    maxGapMs: pauses.reduce((m, p) => Math.max(m, p.ms), 0),
    samplePeakDbfs: Math.round(db(peak / 32768) * 100) / 100,
    clippedSamples: clipped,
    floorDb: Math.round(floor * 10) / 10,
    thresholds: { edge: Math.round(edgeThr * 10) / 10, pause: Math.round(gapThr * 10) / 10 },
    startSample,
    endSample,
  };
}

/** Keeps the voiced span plus `padMs` either side (zero-padding when the source has less), with raised-cosine edge fades. */
export function trim(samples, sampleRate, a, { padMs = 120, fadeMs = 10 } = {}) {
  const pad = Math.round((sampleRate * padMs) / 1000);
  const from = a.startSample - pad;
  const to = a.endSample + pad;
  const out = new Int16Array(to - from);
  for (let i = 0; i < out.length; i++) {
    const src = from + i;
    out[i] = src >= 0 && src < samples.length ? samples[src] : 0;
  }
  const fade = Math.min(Math.round((sampleRate * fadeMs) / 1000), out.length >> 1);
  for (let i = 0; i < fade; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    out[i] = Math.round(out[i] * g);
    out[out.length - 1 - i] = Math.round(out[out.length - 1 - i] * g);
  }
  return { samples: out, headTrimmedMs: Math.round((from / sampleRate) * 1000), tailTrimmedMs: Math.round(((samples.length - to) / sampleRate) * 1000) };
}

/** EBU R128 integrated loudness, LRA and true peak (ffmpeg ebur128, 4x oversampled true peak). */
export async function loudness(path) {
  const err = await ffmpeg(['-i', path, '-filter_complex', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const sum = err.slice(err.lastIndexOf('Summary:'));
  const num = (re) => { const m = sum.match(re); return m ? Number(m[1]) : null; };
  return { lufsI: num(/I:\s+(-?[\d.]+|-inf) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}
