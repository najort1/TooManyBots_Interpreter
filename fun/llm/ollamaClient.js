/**
 * Cliente HTTP mínimo para Ollama local.
 * Nunca lança para o caller de gameplay — timeout e erros sobem como rejeição
 * e o flavorService faz fallback estático.
 */

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
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
  fetchImpl,
} = {}) {
  const text = String(prompt ?? '').trim();
  if (!text) return '';

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
      body: JSON.stringify({
        model: String(model || 'gemma4:latest'),
        prompt: text,
        system: String(system || ''),
        stream: false,
        options: {
          temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85,
          num_predict: Math.max(16, Math.min(200, Math.floor(Number(numPredict) || 72))),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ollama-http-${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }

    const data = await res.json();
    return String(data?.response ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check leve (lista tags). Útil em boot/debug.
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
