// Web Audio playback for the VoiceQueue (audio-plan §4.11): decodes the takes, ducks the other buses
// for the known duration (line starts 120 ms after the duck begins), plays chains with 0.6 s gaps,
// puts the anchor through the "broadcast" chain and prefixes anchor chains with the news sting
// (the line enters 0.3 s before the sting ends).

import { dbToGain } from '../core/math';
import type { AudioEngine } from '../core/AudioEngine';
import type { AssetLoader } from '../assets/AssetLoader';
import type { PlaybackHandle, VoiceLine } from './VoiceQueue';

const LEAD = 0.12;
const CHAIN_GAP = 0.6;

export interface VoicePlayerDeps {
  engine: AudioEngine;
  assets: AssetLoader;
  /** Play the news sting now (music/SFX side) and return its duration in seconds (0 if none). */
  newsSting?: () => number;
}

export class VoicePlayer {
  constructor(private readonly deps: VoicePlayerDeps) {}

  async play(lines: VoiceLine[], onEnded: () => void): Promise<PlaybackHandle | null> {
    const { engine, assets } = this.deps;
    const ctx = engine.ctx;
    const buffers: (AudioBuffer | null)[] = await Promise.all(
      lines.map(async (l) => {
        const file = l.take ? assets.manifest.get(l.take)?.variants[0] : undefined;
        return file ? assets.tryLoad(file) : null;
      }),
    );
    if (!buffers.some((b) => b)) return null;
    let t = ctx.currentTime + LEAD;
    const startOffsets: number[] = [];
    const lineDurations: number[] = [];
    if (lines[0]?.voice === 'anchor' && this.deps.newsSting) {
      const sting = this.deps.newsSting();
      if (sting > 0) t += Math.max(0, sting - 0.3);
    }
    const sources: AudioBufferSourceNode[] = [];
    const out = new GainNode(ctx, { gain: 1 });
    out.connect(engine.voiceIn);
    const now = ctx.currentTime;
    lines.forEach((line, i) => {
      const buf = buffers[i];
      startOffsets.push(t - now);
      lineDurations.push(buf?.duration ?? 0);
      if (!buf) return;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf });
      src.connect(line.voice === 'anchor' ? this.broadcastChain(out) : out);
      src.start(t);
      sources.push(src);
      t += buf.duration + CHAIN_GAP;
    });
    const end = t - CHAIN_GAP;
    const duration = end - now;
    engine.duckFor(now, duration);
    const last = sources[sources.length - 1] as AudioBufferSourceNode;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(() => out.disconnect(), 300);
      onEnded();
    };
    last.onended = finish;
    return {
      duration,
      lineDurations,
      startOffsets,
      stop: (fadeSec: number) => {
        const t0 = ctx.currentTime;
        out.gain.cancelScheduledValues(t0);
        out.gain.setValueAtTime(out.gain.value, t0);
        out.gain.linearRampToValueAtTime(0, t0 + fadeSec);
        for (const s of sources) {
          try {
            s.stop(t0 + fadeSec + 0.01);
          } catch {
            // not started yet / already stopped
          }
        }
        engine.unduck(t0 + fadeSec);
        done = true;
        setTimeout(() => out.disconnect(), (fadeSec + 0.3) * 1000);
      },
    };
  }

  /** highpass 160 → peaking 3 kHz +3 dB → lowpass 7.5 kHz → compressor 3:1 @ −24 dB → +2 dB. */
  private broadcastChain(dest: AudioNode): AudioNode {
    const ctx = this.deps.engine.ctx;
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 160, Q: 0.7 });
    const pk = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3000, Q: 1, gain: 3 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7500, Q: 0.7 });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 3, attack: 0.005, release: 0.1, knee: 6 });
    const g = new GainNode(ctx, { gain: dbToGain(2) });
    hp.connect(pk).connect(lp).connect(comp).connect(g).connect(dest);
    return hp;
  }
}
