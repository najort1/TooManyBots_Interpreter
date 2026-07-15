/**
 * Cliente HTTP mínimo para Ollama local.
 * Suporta keep_alive, think:false (Gemma4), fila serial e extração de thinking.
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
 */
export function normalizeKeepAlive(value, fallback = -1) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return fallback;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+(\.\d+)?(ms|s|m|h)$/i.test(s)) return s;
  return fallback;
}

/** Fila serial — evita 2 generates simultâneos estourando timeout no mesmo modelo. */
let generateChain = Promise.resolve();

function enqueueGenerate(fn) {
  const run = generateChain.then(fn, fn);
  // não deixa rejeição quebrar a cadeia
  generateChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function extractTextFromOllamaPayload(data) {
  if (!data || typeof data !== 'object') return '';
  let text = String(data.response ?? '').trim();
  if (text) return text;

  // chat-style
  if (data.message?.content) {
    text = String(data.message.content).trim();
    if (text) return text;
  }

  // thinking models às vezes deixam a frase no final do thinking
  const thinking = String(data.thinking ?? data.message?.thinking ?? '').trim();
  if (thinking) {
    const lines = thinking
      .split(/\n+/)
      .map(l => l.trim())
      .filter(Boolean);
    // pega última linha “humana” (não meta)
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const l = lines[i]
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .replace(/^(final|answer|resposta)\s*:\s*/i, '')
        .trim();
      if (l.length >= 8 && !/^(thinking|raciocínio|step)/i.test(l)) {
        return l;
      }
    }
  }
  return '';
}

async function postGenerate(body, { baseUrl, timeoutMs, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch-unavailable');
  }

  const controller = new AbortController();
  const ms = Math.max(500, Math.floor(Number(timeoutMs) || 25_000));
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
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error(`ollama-timeout-${ms}ms`);
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<string>}
 */
export async function ollamaGenerate({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:latest',
  prompt,
  system = '',
  timeoutMs = 25_000,
  numPredict = 400,
  temperature = 0.85,
  keepAlive = -1,
  think = false,
  fetchImpl,
  serialize = true,
} = {}) {
  const text = String(prompt ?? '').trim();
  if (!text) return '';

  const run = async () => {
    const body = {
      model: String(model || 'gemma4:latest'),
      prompt: text,
      system: String(system || ''),
      stream: false,
      // Gemma4 / modelos com thinking: evita gastar tokens só no raciocínio
      think: think === true,
      keep_alive: normalizeKeepAlive(keepAlive, -1),
      options: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85,
        num_predict: Math.max(16, Math.min(2000, Math.floor(Number(numPredict) || 400))),
      },
    };

    const data = await postGenerate(body, { baseUrl, timeoutMs, fetchImpl });
    return extractTextFromOllamaPayload(data);
  };

  if (serialize === false) return run();
  return enqueueGenerate(run);
}

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
    // load com generate mínimo (prompt vazio às vezes não carrega KV em algumas builds)
    await postGenerate(
      {
        model: modelName,
        prompt: '.',
        system: '',
        stream: false,
        think: false,
        keep_alive: normalizeKeepAlive(keepAlive, -1),
        options: { num_predict: 1, temperature: 0 },
      },
      { baseUrl, timeoutMs, fetchImpl }
    );
    return { ok: true, model: modelName, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      model: modelName,
      ms: Date.now() - started,
      reason: err?.name === 'AbortError' ? err.message || 'timeout' : err?.message || 'error',
    };
  }
}

export async function ollamaTouch(opts = {}) {
  return ollamaWarmup({ ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
}

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
