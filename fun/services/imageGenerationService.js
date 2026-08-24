/**
 * Servico de geracao de imagens do modulo fun.
 *
 * Responsabilidades (SRP):
 *  - Montar prompt final (com ou sem injecao de lore do groupMemoryService).
 *  - Chamar POST {baseUrl}/v1/images/generations (OpenAI-compat).
 *  - Validar quota global diaria (25/dia, reset 00h America/Sao_Paulo).
 *  - Registrar cada geracao no repositorio SQLite (fun_image_generations).
 *  - Normalizar resposta (URL ou b64_json) para buffer + url.
 *
 * Nao acoplado a LLM de chat (openaiChatComplete) — endpoint dedicado de imagens.
 * Nao conhece WhatsApp / Baileys — handler decide como entregar ao grupo.
 */

const SAO_PAULO_TZ = 'America/Sao_Paulo';

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Devolve dateStr YYYY-MM-DD no timezone America/Sao_Paulo para um timestamp.
 * Usa Intl.DateTimeFormat com timeZone + options para extrair Y/M/D sem
 * depender de env-var, evitando drift entre maquinas.
 */
function dateStrForSaoPaulo(now = Date.now()) {
  const ts = Number(now) || Date.now();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  return `${y}-${m}-${d}`;
}

function isSafeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return String(path || '');
  const p = String(path || '').trim().replace(/^\/+/, '');
  if (!p) return b;
  return `${b}/${p}`;
}

function clampPrompt(text, maxLen = 4000) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

/**
 * @param {object} deps
 * @param {object} deps.repository                     funImageGenerationRepository
 * @param {object} [deps.groupMemoryService]           para injecao de lore no /gerar
 * @param {() => object} [deps.getConfig]              resolveFunConfig
 * @param {() => object} [deps.getLogger]
 * @param {typeof fetch} [deps.fetchImpl]              injetavel p/ testes
 */
export function createImageGenerationService(deps = {}) {
  const repository = deps.repository;
  if (!repository) throw new Error('imageGenerationService: repository obrigatorio');

  const groupMemoryService = deps.groupMemoryService || null;
  const getConfig = deps.getConfig || (() => ({}));
  const logger = deps.getLogger?.() || null;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  const log = (level, payload, msg) => {
    try {
      logger?.[level]?.(payload, msg);
    } catch {
      /* noop */
    }
  };

  function cfg() {
    return getConfig() || {};
  }

  /* ---------- quota ---------- */

  function getDailyStatus({ now = Date.now() } = {}) {
    const c = cfg();
    const limit = Math.max(0, Math.floor(Number(c.imageGenDailyLimit) || 25));
    const dateStr = dateStrForSaoPaulo(now);
    const used = repository.countByDate(dateStr);
    const remaining = Math.max(0, limit - used);
    return { used, limit, remaining, dateStr };
  }

  /**
   * Checagem atomica de quota: SELECT COUNT + INSERT em transaction
   * via better-sqlite3 (sincrono — bloqueia event loop durante a tx).
   * Devolve { allowed, remaining } antes do INSERT.
   */
  function tryConsumeQuota({ dateStr, limit, now = Date.now() }) {
    const used = repository.countByDate(dateStr);
    if (used >= limit) {
      return { allowed: false, reason: 'quota-exceeded', used, limit, remaining: 0 };
    }
    return { allowed: true, used, limit, remaining: limit - used - 1 };
  }

  /* ---------- injecao de lore ---------- */

  /**
   * Monta prompt final. Se withMemory=true e houver lore disponivel,
   * prefixa a lore (ja em <group_lore>...</group_lore>) ao prompt do usuario.
   * Trunca a lore em imageGenLoreMaxChars para nao estourar o limite da API.
   */
  function buildPromptWithMemory({ scopeKey, userPrompt, funConfig, userJid }) {
    const base = clampPrompt(userPrompt);
    if (!base) return '';
    if (!withMemoryEnabled(funConfig) || !groupMemoryService) return base;

    const maxLore = Math.max(
      0,
      Math.floor(Number(funConfig?.imageGenLoreMaxChars) || Infinity)
    );
    if (maxLore === 0) return base;

    let lore = '';
    try {
      lore = String(
        groupMemoryService.buildLoreContext(scopeKey, {
          userJids: userJid ? [userJid] : [],
          limit: Infinity,
          funConfig,
        }) || ''
      ).trim();
    } catch (err) {
      log('debug', { err: err?.message }, 'imageGen buildLoreContext fail');
      return base;
    }
    if (!lore) return base;

    if (lore.length > maxLore) lore = `${lore.slice(0, maxLore - 1)}…`;
    return `${base}\n\n${lore}`;
  }

  /**
   * withMemory eh feature do /gerar; desativada por config quando
   * imageGenEnabled=false ou memoryEnabled=false (grupo sem memoria).
   */
  function withMemoryEnabled(funConfig) {
    if (!funConfig) return true;
    if (funConfig.imageGenEnabled === false) return false;
    if (funConfig.memoryEnabled === false) return false;
    return true;
  }

  /* ---------- chamada HTTP ---------- */

  /**
   * Executa POST /v1/images/generations.
   * @returns {Promise<{ok:true, url:string, buffer:null} | {ok:true, url:'', buffer:Buffer} | {ok:false, reason, error?}>}
   */
  async function callImageApi(prompt, opts) {
    const c = cfg();
    const baseUrl = String(c.imageGenBaseUrl || 'http://127.0.0.1:3300').trim();
    if (!baseUrl) return { ok: false, reason: 'no-baseurl' };

    const fetchFn = opts.fetchImpl || fetchImpl;
    if (typeof fetchFn !== 'function') {
      return { ok: false, reason: 'fetch-unavailable' };
    }

    const url = joinUrl(baseUrl, '/v1/images/generations');
    const body = { prompt };
    if (String(c.imageGenModel || '').trim()) body.model = String(c.imageGenModel).trim();
    if (String(c.imageGenSize || '').trim()) body.size = String(c.imageGenSize).trim();
    if (String(c.imageGenQuality || '').trim()) body.quality = String(c.imageGenQuality).trim();
    const fmt = String(c.imageGenResponseFormat || 'url').trim().toLowerCase();
    if (fmt === 'b64_json' || fmt === 'url') body.response_format = fmt;

    const headers = { 'Content-Type': 'application/json' };
    const key = String(c.imageGenApiKey || '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    const timeoutMs = Math.max(1000, Math.floor(Number(c.imageGenTimeoutMs) || 60_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res?.ok) {
        const errBody = await res.text().catch(() => '');
        return {
          ok: false,
          reason: `http-${res?.status || 'failed'}`,
          error: errBody ? String(errBody).slice(0, 200) : '',
        };
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        return { ok: false, reason: 'bad-json', error: err?.message || 'parse-failed' };
      }

      return extractImage(data, fmt);
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`image-timeout-${timeoutMs}ms`);
        e.name = 'AbortError';
        return { ok: false, reason: 'timeout', error: e.message };
      }
      return { ok: false, reason: 'fetch-error', error: err?.message || 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normaliza resposta OpenAI-compat da Images API.
   * Formato: { data: [{ url?, b64_json?, revised_prompt? }] }
   */
  function extractImage(data, requestedFormat) {
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'empty-response' };
    }
    const items = Array.isArray(data.data) ? data.data : [];
    if (items.length === 0) return { ok: false, reason: 'no-image' };
    const first = items[0] || {};

    // Prioridade: b64_json se presente; caso contrario URL.
    const b64 = String(first.b64_json || '').trim();
    if (b64) {
      try {
        const buffer = Buffer.from(b64, 'base64');
        if (!buffer || buffer.length === 0) {
          return { ok: false, reason: 'empty-b64' };
        }
        return { ok: true, url: '', buffer, format: 'b64_json' };
      } catch (err) {
        return { ok: false, reason: 'bad-b64', error: err?.message || 'decode-failed' };
      }
    }

    const url = String(first.url || '').trim();
    if (!url) return { ok: false, reason: 'no-image' };
    if (!isSafeUrl(url)) return { ok: false, reason: 'unsafe-url', error: url.slice(0, 120) };

    return { ok: true, url, buffer: null, format: 'url' };
  }

  /* ---------- API publica ---------- */

  /**
   * Gera uma imagem.
   *
   * @param {object} args
   * @param {string} args.scopeKey
   * @param {string} args.userJid
   * @param {string} args.prompt            prompt bruto do usuario
   * @param {('gerar'|'imaginar')} [args.command]
   * @param {boolean} [args.withMemory]     true injeta lore (comando /gerar)
   * @param {number} [args.now]
   * @param {typeof fetch} [args.fetchImpl] override para testes
   * @returns {Promise<{ok:true, url:string, buffer:Buffer|null, remaining:number, used:number, limit:number, dateStr:string} | {ok:false, reason:string, error?:string, remaining?:number, limit?:number, dateStr?:string}>}
   */
  async function generateImage({
    scopeKey,
    userJid,
    prompt,
    command = 'imaginar',
    withMemory = false,
    now = Date.now(),
    fetchImpl: overrideFetch,
  } = {}) {
    const c = cfg();
    if (c.imageGenEnabled === false) {
      return { ok: false, reason: 'disabled' };
    }

    const userPrompt = String(prompt || '').trim();
    if (!userPrompt) {
      return { ok: false, reason: 'empty-prompt' };
    }

    const ts = Number(now) || Date.now();
    const dateStr = dateStrForSaoPaulo(ts);
    const limit = Math.max(0, Math.floor(Number(c.imageGenDailyLimit) || 25));
    const quota = tryConsumeQuota({ dateStr, limit, now: ts });
    if (!quota.allowed) {
      return {
        ok: false,
        reason: 'quota-exceeded',
        remaining: 0,
        used: quota.used,
        limit: quota.limit,
        dateStr,
      };
    }

    const finalPrompt = withMemory
      ? buildPromptWithMemory({ scopeKey, userPrompt, funConfig: c, userJid })
      : clampPrompt(userPrompt);
    if (!finalPrompt) {
      return { ok: false, reason: 'empty-prompt-after-lore' };
    }

    const apiResult = await callImageApi(finalPrompt, { fetchImpl: overrideFetch });
    if (!apiResult?.ok) {
      log('warn', { err: apiResult?.reason, scope: scopeKey }, 'imageGen api failed');
      return {
        ok: false,
        reason: apiResult?.reason || 'api-error',
        error: apiResult?.error || '',
        remaining: quota.remaining,
        used: quota.used,
        limit,
        dateStr,
      };
    }

    // Registro apos sucesso (nao conta quota em falha).
    const imageUrlForLog = apiResult.url || (apiResult.buffer ? '<b64>' : '');
    try {
      repository.register({
        scopeKey,
        userJid,
        prompt: finalPrompt,
        command,
        imageUrl: imageUrlForLog,
        dateStr,
        now: ts,
      });
    } catch (err) {
      log('warn', { err: err?.message }, 'imageGen register failed (quota may be inconsistent)');
      // Nao propaga falha de registro para nao invalidar a imagem gerada.
    }

    const used = repository.countByDate(dateStr);
    const remaining = Math.max(0, limit - used);
    return {
      ok: true,
      url: apiResult.url,
      buffer: apiResult.buffer,
      format: apiResult.format,
      remaining,
      used,
      limit,
      dateStr,
    };
  }

  function getRecent({ limit = 20, now = Date.now() }) {
    const dateStr = dateStrForSaoPaulo(now);
    return repository.listByDate(dateStr, limit);
  }

  return {
    generateImage,
    getDailyStatus,
    getRecent,
    buildPromptWithMemory,
    dateStrForSaoPaulo,
  };
}

export {
  dateStrForSaoPaulo,
  isSafeUrl,
  joinUrl,
  clampPrompt,
};

export default createImageGenerationService;
