// ElevenLabs REST client for text-to-speech (+ pronunciation dictionaries), with retry/backoff.
// The API key travels only in the `xi-api-key` header; it is never logged or written anywhere.
const API = 'https://api.elevenlabs.io';

export class ProviderUnavailable extends Error {
  constructor(msg, info) { super(msg); this.name = 'ProviderUnavailable'; this.info = info; }
}
export class FormatRejected extends Error {
  constructor(msg, info) { super(msg); this.name = 'FormatRejected'; this.info = info; }
}
export class ModelRejected extends Error {
  constructor(msg, info) { super(msg); this.name = 'ModelRejected'; this.info = info; }
}
export class RequestRejected extends Error {
  constructor(msg, info) { super(msg); this.name = 'RequestRejected'; this.info = info; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Response headers worth keeping (no secrets are ever returned in headers).
function keepHeaders(h) {
  const out = {};
  for (const [k, v] of h.entries()) {
    if (/^(request-id|x-request-id|history-item-id|character-cost|x-character-count|tts-latency-ms|x-region|current-concurrent-requests|maximum-concurrent-requests|content-type)$/i.test(k)) out[k.toLowerCase()] = v;
  }
  return out;
}

function classify(status, body) {
  const d = body?.detail ?? body ?? {};
  const code = String(d.status ?? d.code ?? '').toLowerCase();
  const msg = String(d.message ?? (typeof d === 'string' ? d : JSON.stringify(d))).slice(0, 300);
  const info = { status, code, message: msg, requestId: d.request_id };
  const text = `${code} ${msg}`.toLowerCase();
  if (status === 429 || status >= 500) return { retry: true, info };
  if (/output[_ ]?format|sample[_ ]?rate|pcm|wav|192|tier/.test(text) && status !== 401) return { err: new FormatRejected(`output format rejected (${status} ${code}): ${msg}`, info) };
  if (/model/.test(text) && /(not[_ ]?found|invalid|unsupported|does not exist|not available|access)/.test(text)) return { err: new ModelRejected(`model rejected (${status} ${code}): ${msg}`, info) };
  if (status === 401 || status === 403 || status === 402 || /quota|credit|limit_reached|missing_permissions|unauthorized|payment/.test(text)) {
    return { err: new ProviderUnavailable(`ElevenLabs unavailable (${status} ${code}): ${msg}`, info) };
  }
  return { err: new RequestRejected(`request rejected (${status} ${code}): ${msg}`, info) };
}

async function call(method, path, { key, json, query, retries = 5, accept = 'application/json' }) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let lastInfo = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      lastInfo = { status: 0, code: 'network', message: String(e?.cause?.code ?? e?.name ?? e) };
      if (attempt < retries) { await sleep(backoff(attempt)); continue; }
      throw new ProviderUnavailable(`ElevenLabs unreachable after ${retries + 1} attempts: ${lastInfo.message}`, lastInfo);
    }
    if (res.ok) return res;
    let body = null;
    const raw = await res.text();
    try { body = JSON.parse(raw); } catch { body = { detail: { message: raw.slice(0, 300) } }; }
    const c = classify(res.status, body);
    if (c.retry) {
      lastInfo = c.info;
      if (attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
        continue;
      }
      throw new ProviderUnavailable(`ElevenLabs kept failing (${c.info.status} ${c.info.code}) after ${retries + 1} attempts: ${c.info.message}`, c.info);
    }
    throw c.err;
  }
  throw new ProviderUnavailable('unreachable', lastInfo);
}

const backoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/**
 * POST /v1/text-to-speech/{voice_id}. Returns { audio: Buffer, headers, requestId, contentType }.
 */
export async function textToSpeech({ key, voiceId, modelId, text, settings, seed, outputFormat, normalization = 'on', dictionaries }) {
  const json = {
    text,
    model_id: modelId,
    voice_settings: settings,
    ...(seed !== undefined ? { seed } : {}),
    ...(normalization ? { apply_text_normalization: normalization } : {}),
    ...(dictionaries?.length ? { pronunciation_dictionary_locators: dictionaries } : {}),
  };
  const res = await call('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}`, { key, json, query: { output_format: outputFormat }, accept: '*/*' });
  const audio = Buffer.from(await res.arrayBuffer());
  const headers = keepHeaders(res.headers);
  return { audio, headers, requestId: headers['request-id'] ?? headers['x-request-id'] ?? null, contentType: headers['content-type'] ?? null };
}

/** POST /v1/pronunciation-dictionaries/add-from-rules (alias rules). Returns { id, version_id } or throws. */
export async function createAliasDictionary({ key, name, rules }) {
  const res = await call('POST', '/v1/pronunciation-dictionaries/add-from-rules', {
    key,
    retries: 2,
    json: { name, rules: rules.map((r) => ({ type: 'alias', string_to_replace: r.match, alias: r.dictAlias })) },
  });
  const body = await res.json();
  return { id: body.id, versionId: body.version_id, headers: keepHeaders(res.headers) };
}
