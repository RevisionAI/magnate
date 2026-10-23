// Kokoro-82M (hexgrad, Apache-2.0) via kokoro-js + onnxruntime-node on the CPU. Fully local once the weights are
// cached in tools/voice/.cache/hf-js (first run downloads ~320 MB of fp32 ONNX weights from Hugging Face).
// The voices ship inside node_modules/kokoro-js/voices, and phonemisation is espeak-ng compiled to WASM.
import { join } from 'node:path';
import { CACHE_DIR } from './env.mjs';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_DTYPE = 'fp32';
let loading = null;

async function load({ offline }) {
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = join(CACHE_DIR, 'hf-js');
  if (offline) {
    env.allowRemoteModels = false; // cache only
    globalThis.fetch = async (url) => { throw new Error(`network disabled (--offline): ${url}`); };
  }
  const { KokoroTTS } = await import('kokoro-js');
  const t0 = Date.now();
  const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE, device: 'cpu' });
  return { tts, loadMs: Date.now() - t0 };
}

/** Returns { samples: Float32Array, sampleRate: 24000, loadMs } */
export async function kokoroSynth({ text, voice, speed, offline = false }) {
  if (!loading) loading = load({ offline });
  const { tts, loadMs } = await loading;
  const audio = await tts.generate(text, { voice, speed });
  return { samples: audio.audio, sampleRate: audio.sampling_rate, loadMs };
}

export function floatWav(samples, sampleRate) {
  const b = Buffer.alloc(44 + samples.length * 4);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + samples.length * 4, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) b.writeFloatLE(samples[i], 44 + i * 4);
  return b;
}

// Speed search for Kokoro takes (generate.mjs → kokoroTakes). `tried` = [{ speed, pace }], `K` = the role's kokoro
// config, `band` = { wpmMin, wpmMax }. Returns the next speed to render, or null when nothing new is worth trying.
export function nextKokoroSpeed(tried, K, band) {
  const goal = (band.wpmMin + band.wpmMax) / 2;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const below = tried.filter((x) => x.pace < goal).sort((a, b) => b.speed - a.speed)[0]; // fastest take under the goal
  const above = tried.filter((x) => x.pace >= goal).sort((a, b) => a.speed - b.speed)[0]; // slowest take at/over it
  let next;
  if (below && above && below.speed < above.speed) {
    const w = above.speed - below.speed;
    if (w < 0.004) return null;
    next = below.speed + ((goal - below.pace) * w) / (above.pace - below.pace);
    next = Math.min(above.speed - 0.15 * w, Math.max(below.speed + 0.15 * w, next)); // keep clear of the bracket ends
  } else {
    const c = [...tried].sort((a, b) => Math.abs(a.pace - goal) - Math.abs(b.pace - goal))[0];
    const dir = c.pace < goal ? 1 : -1;
    next = (c.speed * goal) / c.pace;
    if ((next - c.speed) * dir < 0.015) next = c.speed + 0.015 * dir; // a flat stair: move at least 0.015
  }
  next = r3(Math.min(K.maxSpeed, Math.max(K.minSpeed, next)));
  return tried.some((x) => Math.abs(x.speed - next) < 0.0005) ? null : next;
}
