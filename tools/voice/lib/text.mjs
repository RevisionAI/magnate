// Text utilities for QA: normalisation for transcript comparison, WER/CER, word counts, CRC-32 seeds, hashes.
import { createHash } from 'node:crypto';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) out.push(ONES[n]); } else if (n || !out.length) out.push(ONES[n]);
  return out.join(' ');
}
export function numberToWords(n) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return String(n);
  if (n === 0) return 'zero';
  const parts = [];
  for (const [v, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) { parts.push(`${under1000(Math.floor(n / v))} ${name}`); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

const SPELLING = { recognise: 'recognize', recognising: 'recognizing', energised: 'energized', savour: 'savor', savouring: 'savoring', colour: 'color', favour: 'favor', centre: 'center', programme: 'program', organise: 'organize', optimise: 'optimize', analyse: 'analyze', behaviour: 'behavior', labour: 'labor' };
// Homophones no listener (or transcriber) can tell apart; Whisper picked the wrong spelling on these script words.
// "magnate"/"magnet" are NOT homophones and are never merged (see magnateCheck).
const HOMOPHONES = { cache: 'cash', lone: 'loan' };

/** Lower-case, spell out numbers/currency/percent, drop punctuation, unify spelling. */
export function normalize(s) {
  let t = ` ${s} `.toLowerCase();
  t = t.replace(/\[[^\]]*\]/g, ' '); // delivery tags never count
  t = t.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/(\d),(?=\d{3})/g, '$1');
  t = t.replace(/\$\s?(\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion|[kmb]n?)?\b/g, (_, n, mag) => {
    const m = { k: 'thousand', m: 'million', mn: 'million', b: 'billion', bn: 'billion' }[mag] ?? mag;
    return ` ${n}${m ? ` ${m}` : ''} dollars `;
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, ' $1 percent ');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/\b((?:[a-z]\.){2,})/g, (m) => m.replace(/\./g, '')); // i.p.o. -> ipo
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
  t = t.replace(/\ba (hundred|thousand|million|billion|trillion)\b/g, 'one $1'); // "a hundred million" == "100 million"
  t = t.replace(/\d+(?:\.\d+)?/g, (m) => (m.includes('.') ? m.split('.').map((x) => numberToWords(Number(x))).join(' point ') : numberToWords(Number(m))));
  t = t.replace(/-/g, ' ');
  t = t.replace(/[^a-z' ]+/g, ' ');
  t = t.replace(/(^|\s)'|'(\s|$)/g, ' ');
  t = t.split(/\s+/).filter(Boolean).map((w) => HOMOPHONES[SPELLING[w] ?? w] ?? SPELLING[w] ?? w).join(' ');
  return t;
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Word error rate and "compact" character error rate (spaces removed, so "kick start" == "kickstart"). */
export function compare(reference, hypothesis) {
  const r = normalize(reference);
  const h = normalize(hypothesis);
  const rw = r.split(' ').filter(Boolean);
  const hw = h.split(' ').filter(Boolean);
  const rc = r.replace(/[ ']/g, '');
  const hc = h.replace(/[ ']/g, '');
  return {
    wer: rw.length ? Math.round((lev(rw, hw) / rw.length) * 1000) / 1000 : 0,
    cer: rc.length ? Math.round((lev([...rc], [...hc]) / rc.length) * 1000) / 1000 : 0,
    ref: r,
    hyp: h,
  };
}

/** "ok" when the transcript says magnate, "magnet" when Whisper hears the old mispronunciation, else "unclear". */
export function magnateCheck(hypothesis) {
  const h = normalize(hypothesis);
  if (/\bmagnates?\b/.test(h) || /\bmag nates?\b/.test(h)) return 'ok';
  if (/\bmagnets?\b/.test(h)) return 'magnet';
  return 'unclear';
}

export function wordCount(text) {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

let CRC_TABLE = null;
export function crc32(str) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of Buffer.from(str, 'utf8')) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** audio-plan §3.5: seed = crc32(lineId) + take, kept inside ElevenLabs' 0..4294967295 range. */
export const seedFor = (id, take) => (crc32(id) + take) % 4294967296;

export function hashOf(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 24);
}
