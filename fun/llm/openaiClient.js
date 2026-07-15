/**
 * Cliente OpenAI-compatible (OpenCode Zen Proxy, etc.).
 * POST /v1/chat/completions
 */

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function normalizeContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return String(part.text || '');
        return String(part?.text || part?.content || '');
      })
      .join('')
      .trim();
  }
  if (content == null) return '';
  return String(content).trim();
}

/**
 * Extrai texto final. Alguns modelos free (ex. deepseek) enchem max_tokens em
 * reasoning_content e deixam content vazio — aí usamos a última linha do raciocínio.
 */
function extractChatText(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return '';

  const msg = choice.message || {};
  let text = normalizeContent(msg.content ?? choice.text ?? '');
  if (text) return text;

  // reasoning / thinking fields
  const reasoning = normalizeContent(
    msg.reasoning_content || msg.reasoning || msg.thinking || ''
  );
  if (!reasoning) return '';

  const lines = reasoning
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let l = lines[i]
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .replace(/^(final|answer|resposta|frase)\s*:\s*/i, '')
      .trim();
    // pula meta de raciocínio
    if (l.length < 8) continue;
    if (/^(we are|the user|so the|therefore|passo|thinking)/i.test(l)) continue;
    // tira trechos muito longos de raciocínio
    if (l.length > 200) l = `${l.slice(0, 160).trim()}…`;
    return l;
  }
  return '';
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl] — ex. http://127.0.0.1:3000
 * @param {string} [opts.model]
 * @param {string} opts.prompt
 * @param {string} [opts.system]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {string} [opts.apiKey]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<string>}
 */
export async function openaiChatComplete({
  baseUrl = 'http://127.0.0.1:3000',
  model = 'deepseek-v4-flash-free',
  prompt,
  system = '',
  timeoutMs = 20_000,
  maxTokens = 400,
  temperature = 0.85,
  apiKey = '',
  fetchImpl,
} = {}) {
  const userText = String(prompt ?? '').trim();
  if (!userText) return '';

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch-unavailable');
  }

  const messages = [];
  if (String(system || '').trim()) {
    messages.push({ role: 'system', content: String(system).trim() });
  }
  messages.push({ role: 'user', content: userText });

  const headers = {
    'Content-Type': 'application/json',
  };
  const key = String(apiKey || '').trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const controller = new AbortController();
  const ms = Math.max(500, Math.floor(Number(timeoutMs) || 20_000));
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetchFn(joinUrl(baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: String(model || 'deepseek-v4-flash-free'),
        messages,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85,
        max_tokens: Math.max(16, Math.min(2000, Math.floor(Number(maxTokens) || 400))),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`openai-http-${res.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`);
    }

    const data = await res.json();
    return extractChatText(data);
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error(`openai-timeout-${ms}ms`);
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check do proxy Zen.
 */
export async function openaiPing({
  baseUrl = 'http://127.0.0.1:3000',
  timeoutMs = 3_000,
  fetchImpl,
} = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'fetch-unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    // prefer /health, fallback /v1/models
    let res = await fetchFn(joinUrl(baseUrl, '/health'), {
      method: 'GET',
      signal: controller.signal,
    }).catch(() => null);

    if (!res || !res.ok) {
      res = await fetchFn(joinUrl(baseUrl, '/v1/models'), {
        method: 'GET',
        signal: controller.signal,
      });
    }
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'error',
    };
  } finally {
    clearTimeout(timer);
  }
}
