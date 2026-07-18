/**
 * Cliente OpenAI-compatible (OpenCode Zen Proxy, etc.).
 * POST /v1/chat/completions
 */

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || 'http://127.0.0.1:3300').replace(/\/+$/, '');
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

  // meta / planning / raciocínio em inglês (DeepSeek thinking)
  if (
    /\b(I need|we are|the user|therefore|let me|shouldn'?t|in Portuguese|as an AI|the answer|funny line|write a|thinking|as listed|the list shows|we need to|we should|valid archetypes|prefer(ence)? is|avoid simply|generate a single|JSON event|itself\?|Actually|That's \d|Count characters|All good|Now output)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(category uma das|companyId DEVE|coerente com a empresa|archetype DEVE)\b/i.test(s)) {
    return true;
  }
  // trecho curto de inglês sem pt-BR (rascunho de reasoning)
  if (
    s.length < 80 &&
    !/[áàâãéêíóôõúç]/i.test(s) &&
    /\b(the|list|shows|exactly|should|would|could|must)\b/i.test(s)
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
  // preâmbulo de assistente / eco do pedido
  if (
    /^(aqui vai|segue (o )?(roteiro|texto)|roteiro besteirol|no tom (que|pastel)|como (voc[eê] )?pediu|conforme o pedido)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\bno tom (pastel[aã]o )?que voc[eê] pediu\b/i.test(s)) return true;

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
 * Extrai objeto JSON embutido em prosa/reasoning (DeepSeek thinking).
 * Preferência: último bloco {...} parseável com chaves úteis.
 */
export function extractJsonBlob(text) {
  const s = String(text || '');
  if (!s.includes('{')) return '';
  // fenced ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      /* try brace scan */
    }
  }
  let best = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = s.slice(i, j + 1);
          try {
            const obj = JSON.parse(slice);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
              // rejeita schema de exemplo do prompt: {"title":"..."}
              const values = Object.values(obj).map((v) => String(v ?? ''));
              if (values.every((v) => !v || v === '...' || /^\.+$/.test(v))) continue;
              if (values.some((v) => /\|/.test(v) && /combustivel|municao|arma/.test(v))) continue;
              const keys = Object.keys(obj);
              if (keys.some((k) => /^(title|body|archetype|category|companyId)$/i.test(k))) {
                const title = String(obj.title || '');
                if (title && !/DEVE|one of|listados|omit/i.test(title)) {
                  best = slice;
                }
              } else if (!best && keys.length >= 2) {
                best = slice;
              }
            }
          } catch {
            /* keep scanning */
          }
          break;
        }
      }
    }
  }
  return best;
}

/**
 * Só JSON de invent/market — nunca prosa de reasoning (evita eco do system).
 */
export function extractJsonFromChat(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return '';
  const msg = choice.message || {};
  const content = normalizeContent(msg.content ?? choice.text ?? '');
  const reasoning = normalizeContent(
    msg.reasoning_content || msg.reasoning || msg.thinking || choice.reasoning || ''
  );
  return (
    extractJsonBlob(content) ||
    extractJsonBlob(reasoning) ||
    extractJsonBlob(`${content}\n${reasoning}`) ||
    ''
  );
}

/**
 * Extrai texto final. Modelos free (DeepSeek) costumam encher reasoning_content
 * e deixar content vazio ou com fragmento — NÃO devolver rascunho.
 * Thinking models: JSON de invent costuma estar no content ou no fim do reasoning.
 */
export function extractChatText(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return '';

  const msg = choice.message || {};
  const content = normalizeContent(msg.content ?? choice.text ?? '');
  const reasoning = normalizeContent(
    msg.reasoning_content || msg.reasoning || msg.thinking || choice.reasoning || ''
  );

  // 1) JSON em content ou reasoning (prioridade absoluta p/ invent/market)
  const onlyJson = extractJsonFromChat(data);
  if (onlyJson) return onlyJson;

  // 2) content limpo (flavor pt-BR) — nunca eco de regras
  if (content && !looksLikeIncompleteOrMeta(content)) return content;

  // 3) reasoning com frase final boa (só flavor; invent usa extractJsonFromChat)
  if (reasoning) {
    const fromReason = pickBestFromReasoning(reasoning);
    if (fromReason && !looksLikeIncompleteOrMeta(fromReason)) return fromReason;
  }

  // content incompleto / meta: rejeita (cascade Ollama/template)
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
/**
 * Proxies com modelo pré-configurado (ex. glm_5_2 em :3300) ignoram sampling.
 * sendSamplingParams=false → body só model+messages (+ response_format se jsonMode).
 */
export async function openaiChatComplete({
  baseUrl = 'http://127.0.0.1:3300',
  model = 'glm_5_2',
  prompt,
  system = '',
  timeoutMs = 20_000,
  maxTokens = 400,
  temperature = 0.85,
  apiKey = '',
  /** Força resposta JSON (OpenAI-compat: response_format json_object). */
  jsonMode = false,
  /**
   * true = só devolve JSON (invent/market). Sem prosa de reasoning.
   * Evita eco "category uma das…" virar invent.
   */
  jsonOnly = false,
  /**
   * false = não envia temperature/top_p (modelo fixo no proxy, ex. glm :3300).
   * max_tokens ainda é enviado (orçamento de saída da completion, não “criatividade”).
   * default true; Fun passa false via config.zenSendSamplingParams.
   */
  sendSamplingParams = true,
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
    const body = {
      model: String(model || 'glm_5_2'),
      messages,
      stream: false,
      // limite de tokens de saída (útil mesmo com modelo pré-fixurado)
      max_tokens: Math.max(32, Math.min(4000, Math.floor(Number(maxTokens) || 400))),
    };
    if (sendSamplingParams !== false) {
      body.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.85;
    }
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetchFn(joinUrl(baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`openai-http-${res.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`);
    }

    const data = await res.json();
    if (jsonOnly || jsonMode) {
      const only = extractJsonFromChat(data);
      if (only) return only;
      // content truncado sem fechar } — ainda tenta extractChatText/json blob
      const content = normalizeContent(data?.choices?.[0]?.message?.content || '');
      if (content && content.includes('{')) return content;
      return '';
    }
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
  baseUrl = 'http://127.0.0.1:3300',
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
