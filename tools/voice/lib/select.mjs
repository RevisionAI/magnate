// Automatic take selection. Lower is better; any "hard" problem outranks every soft one.
import { QA } from './config.mjs';

export const SELECTION_VERSION = 5; // 5: Whisper hallucinated tails dropped, homophones merged (stt.py, lib/text.mjs)

export function scoreTake(m, target) {
  const flags = [];
  let hard = 0;
  let soft = 0;
  // pace (syllable-normalised wpm, see config.mjs): distance outside the band dominates, closeness to the band
  // centre breaks ties. Very short lines (< 6 syllables) give noisy figures, so their pace weighs less.
  const pace = m.paceWpm ?? m.wpm;
  const w = (m.syllables ?? 99) < 6 ? 0.3 : 1;
  const mid = (target.wpmMin + target.wpmMax) / 2;
  const outside = pace < target.wpmMin ? target.wpmMin - pace : pace > target.wpmMax ? pace - target.wpmMax : 0;
  soft += w * (outside / 10 + Math.abs(pace - mid) / 100);
  if (outside > 0) flags.push(`pace ${pace} wpm-eq, ${m.sylPerSec ?? '?'} syl/s (target ${target.wpmMin}–${target.wpmMax})`);
  if (m.maxGapMs > QA.maxGapMs) { hard++; flags.push(`internal pause ${m.maxGapMs} ms`); }
  else soft += Math.max(0, m.maxGapMs - 400) / 400; // mild preference for tighter reads
  if (m.samplePeakDbfs >= QA.clipDbfs || m.clippedSamples > 0) { hard++; flags.push(`clipping (peak ${m.samplePeakDbfs} dBFS, ${m.clippedSamples} samples)`); }
  if (m.stt) {
    if (m.stt.error) flags.push('no transcript');
    else {
      if (m.stt.cer > QA.maxCer) { hard++; flags.push(`transcript differs (CER ${m.stt.cer}): "${m.stt.text}"`); }
      soft += m.stt.cer * 20;
      if (m.stt.lowConf?.length) { soft += 0.5 * m.stt.lowConf.length; flags.push(`low-confidence words: ${m.stt.lowConf.join(', ')}`); }
      if (m.stt.magnate === 'magnet') { hard++; flags.push('"magnate" heard as "magnet"'); }
      else if (m.stt.magnate === 'unclear') { soft += 1; flags.push('"magnate" not recognised in transcript'); }
    }
  }
  return { hard, soft: Math.round(soft * 1000) / 1000, flags };
}

export function pickBest(takes) {
  return [...takes].sort((a, b) => a.score.hard - b.score.hard || a.score.soft - b.score.soft || a.job.take - b.job.take)[0];
}
