/**
 * Cliente HTTP mínimo para Ollama local.
 * Suporta keep_alive (modelo residente) + warmup sem gerar texto.
 */

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Normaliza keep_alive do Ollama:
 * - number: segundos (negativo = forever, 0 = unload)
 * - string: "30m", "24h", "-1"
 * - default: -1 (ficar carregado)
 */
export function normalizeKeepAlive(value, fallback = -1) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return fallback;
  if (/^-?\d+$/.test(s)) return Number(s);
  // duração Ollama: 10m, 24h, 30s
  if (/^-?\d+(\.\d+)?(ms|s|m|h)$/i.test(s)) return s;
  return fallback;
}

async function postGenerate(body, { baseUrl, timeoutMs, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch-unavailable');
  }

  const controller = new AbortController();
  const ms = Math.max(500, Math.floor(Number(timeoutMs) || 8_000));
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetchFn(joinUrl(baseUrl, '/api/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ollama-http-${res.status}${errBody ? `: ${errBody.slice(0, 120)}` : ''}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.model]
 * @param {string} opts.prompt
 * @param {string} [opts.system]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.numPredict]
 * @param {number} [opts.temperature]
 * @param {string|number} [opts.keepAlive] — default -1 (não descarregar)
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<string>}
 */
export async function ollamaGenerate({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:latest',
  prompt,
  system = '',
  timeoutMs = 8_000,
  numPredict = 72,
  temperature = 0.85,
  keepAlive = -1,
  fetchImpl,
} = {}) {
  const text = String(prompt ?? '').trim();
  if (!text) return '';

  const data = await postGenerate(
    {
      model: String(model || 'gemma4:latest'),
      prompt: text,
      system: String(system || ''),
      stream: false,
      keep_alive: normalizeKeepAlive(keepAlive, -1),
      options: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85,
        num_predict: Math.max(16, Math.min(200, Math.floor(Number(numPredict) || 72))),
      },
    },
    { baseUrl, timeoutMs, fetchImpl }
  );

  return String(data?.response ?? '').trim();
}

/**
 * Carrega o modelo na VRAM/RAM e deixa residente (sem gerar texto útil).
 * Docs Ollama: POST /api/generate { model, keep_alive: -1 }
 *
 * @returns {Promise<{ ok: boolean, model: string, ms: number, reason?: string }>}
 */
export async function ollamaWarmup({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:latest',
  keepAlive = -1,
  timeoutMs = 120_000,
  fetchImpl,
} = {}) {
  const started = Date.now();
  const modelName = String(model || 'gemma4:latest');
  try {
    await postGenerate(
      {
        model: modelName,
        // prompt vazio + keep_alive carrega e mantém o modelo
        keep_alive: normalizeKeepAlive(keepAlive, -1),
        stream: false,
      },
      { baseUrl, timeoutMs, fetchImpl }
    );
    return { ok: true, model: modelName, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      model: modelName,
      ms: Date.now() - started,
      reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'error',
    };
  }
}

/**
 * Refresh leve do keep_alive (reafirma residência sem inferência pesada).
 */
export async function ollamaTouch({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:latest',
  keepAlive = -1,
  timeoutMs = 30_000,
  fetchImpl,
} = {}) {
  return ollamaWarmup({ baseUrl, model, keepAlive, timeoutMs, fetchImpl });
}

/**
 * Health check leve (lista tags).
 */
export async function ollamaPing({
  baseUrl = 'http://127.0.0.1:11434',
  timeoutMs = 3_000,
  fetchImpl,
} = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'fetch-unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    const res = await fetchFn(joinUrl(baseUrl, '/api/tags'), {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models.map(m => m?.name).filter(Boolean) : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'error' };
  } finally {
    clearTimeout(timer);
  }
}
