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
 * Detecta rascunho / raciocínio incompleto (comum em DeepSeek free).
 * Ex.: "Mas \"cair duro\" pode ser" · "Assim, em português"
 */
export function looksLikeIncompleteOrMeta(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.length < 12) return true;

  // meta / planning
  if (
    /\b(I need|we are|the user|therefore|let me|shouldn'?t|in Portuguese|as an AI|the answer|funny line|write a|thinking)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (
    /\b(em português|em portugues|assim,?$|outra ideia|posso (escrever|dizer|brincar)|vou (escrever|criar|focar)|preciso (escrever|criar|gerar)|a frase (poderia|seria|tem)|algo como|tipo assim|respond[ae] somente|só o texto|so o texto)\b/i.test(
      s
    )
  ) {
    return true;
  }
  // fragmento de brainstorm
  if (/\b(pode ser|seria|talvez)\s*$/i.test(s)) return true;
  if (/^(mas|assim|então|entao|tipo|algo|talvez|porque|pois)\b/i.test(s) && s.length < 55) {
    return true;
  }
  // aspas abertas / frase cortada
  const quotes = (s.match(/["“”']/g) || []).length;
  if (quotes % 2 === 1) return true;
  if (/[,:;]\s*$/.test(s) && !/[.!?…)]$/.test(s) && s.length < 80) return true;
  // só instrução curta
  if (/^(ok|certo|claro|sim|não|nao)[.!]?\s*$/i.test(s)) return true;
  // eco de system prompt (lista de features)
  if (/\bcen[aá]rios?\s*:/i.test(s)) return true;
  if (/cancelamento absurdo/i.test(s) && /fofoca|or[aá]culo|roleta/i.test(s)) return true;
  if (/fofoca falsa.*or[aá]culo|or[aá]culo insano.*conspir/i.test(s)) return true;
  // eco de instrução de formato
  if (/\b\d\s*[–-]\s*\d\s*frases?\b/i.test(s) && s.length < 80) return true;
  if (/\b(frases?\s+completas?|s[oó]\s+o\s+texto\s+final|m[aá]x\.?\s*\d+\s*chars?)\b/i.test(s) && s.length < 100) {
    return true;
  }

  return false;
}

/**
 * Escolhe a melhor linha “final” de um bloco de reasoning.
 */
function pickBestFromReasoning(reasoning) {
  const block = String(reasoning || '').trim();
  if (!block) return '';

  // 1) marcadores explícitos de resposta final
  const marked = block.match(
    /(?:^|\n)\s*(?:resposta|final|frase|output|answer)\s*[:：]\s*(.+)$/im
  );
  if (marked?.[1]) {
    const c = marked[1].replace(/^["'“”]+|["'“”]+$/g, '').trim();
    if (c && !looksLikeIncompleteOrMeta(c)) return c.slice(0, 400);
  }

  // 2) última linha entre aspas que pareça frase completa
  const quoted = [...block.matchAll(/["“]([^"”\n]{16,200})["”]/g)].map((m) => m[1].trim());
  for (let i = quoted.length - 1; i >= 0; i -= 1) {
    if (!looksLikeIncompleteOrMeta(quoted[i])) return quoted[i];
  }

  // 3) linhas de trás pra frente: completa, pt-BR, sem meta
  const lines = block
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
        .replace(/^(final|answer|resposta|frase|output)\s*[:：]\s*/i, '')
        .trim()
    )
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let l = lines[i];
    if (l.length < 16 || l.length > 320) continue;
    if (looksLikeIncompleteOrMeta(l)) continue;
    // prefere frase que “fecha” e não é inglês de raciocínio
    if (/\b(I |we |the user|need |should |would )\b/i.test(l) && !/[áàâãéêíóôõúç]/i.test(l)) {
      continue;
    }
    if (/[.!?…)]$|kkk|rs\b|haha/i.test(l) || l.length >= 28) {
      return l;
    }
  }

  // 4) nenhuma linha boa → vazio (cascade usa Ollama/template)
  return '';
}

/**
 * Extrai texto final. Modelos free (DeepSeek) costumam encher reasoning_content
 * e deixar content vazio ou com fragmento — NÃO devolver rascunho.
 */
export function extractChatText(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return '';

  const msg = choice.message || {};
  const content = normalizeContent(msg.content ?? choice.text ?? '');
  if (content && !looksLikeIncompleteOrMeta(content)) {
    return content;
  }

  // content lixo/vazio → tenta reasoning com filtro rígido
  const reasoning = normalizeContent(
    msg.reasoning_content || msg.reasoning || msg.thinking || choice.reasoning || ''
  );
  if (reasoning) {
    const fromReason = pickBestFromReasoning(reasoning);
    if (fromReason) return fromReason;
  }

  // content incompleto mas era o único: ainda rejeita (melhor template)
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
  model = 'mimo-v2.5-free',
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
        model: String(model || 'mimo-v2.5-free'),
        messages,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85,
        max_tokens: Math.max(32, Math.min(2000, Math.floor(Number(maxTokens) || 400))),
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
