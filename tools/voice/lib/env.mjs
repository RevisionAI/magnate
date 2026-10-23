// Paths, tool discovery and secret loading for the VO pipeline.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VOICE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = join(VOICE_DIR, '..', '..');
export const CACHE_DIR = join(VOICE_DIR, '.cache');
export const TMP_DIR = join(VOICE_DIR, '.tmp');
export const REPORTS_DIR = join(VOICE_DIR, 'reports');
export const OUT_DIR = join(ROOT, 'assets-src', 'vo');
export const VENV_PY = join(VOICE_DIR, '.venv', 'bin', 'python');

// ffmpeg: prefer a modern build (the Anaconda ffmpeg 4.2 first on PATH has an old loudnorm; audio-plan §2.4).
function pick(names) {
  for (const p of names) {
    try {
      const v = execFileSync(p, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = v.match(/version n?(\d+)\./);
      if (m && Number(m[1]) >= 5) return p;
    } catch { /* try next */ }
  }
  return null;
}
export const FFMPEG = process.env.FFMPEG ?? pick(['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', 'ffmpeg']);
export const FFPROBE = process.env.FFPROBE ?? pick(['/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe', 'ffprobe']);

// The ElevenLabs key: ELEVENLABS_API_KEY, else the file named by ELEVENLABS_API_KEY_FILE, else ~/.claude/voice/key.
// The value is only ever placed in a request header; never log it.
export function loadElevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const file = process.env.ELEVENLABS_API_KEY_FILE ?? join(homedir(), '.claude', 'voice', 'key');
  if (!existsSync(file)) return null;
  const k = readFileSync(file, 'utf8').trim();
  return k || null;
}

export function hasStt() {
  return existsSync(VENV_PY);
}
