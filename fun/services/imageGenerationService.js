/**
 * Servico de geracao de imagens do modulo fun.
 *
 * Responsabilidades (SRP):
 *  - Montar prompt final (com ou sem injecao de lore do groupMemoryService).
 *  - Gerar imagem via Google GenAI (@google/genai interactions API) ou OpenAI-compat.
 *  - Validar quota global diaria (25/dia, reset 00h America/Sao_Paulo).
 *  - Registrar cada geracao no repositorio SQLite (fun_image_generations).
 *  - Normalizar resposta (Buffer ou URL) para buffer + url.
 *
 * Nao acoplado a LLM de chat (openaiChatComplete) — endpoint dedicado de imagens.
 * Nao conhece WhatsApp / Baileys — handler decide como entregar ao grupo.
 */

import { GoogleGenAI } from '@google/genai';

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
  let p = String(path || '').trim().replace(/^\/+/, '');
  if (/\/v1$/i.test(b) && /^v1\//i.test(p)) p = p.slice(3);
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
 * @param {object} [deps.aiClient]                     injetavel p/ testes do Gemini
 */
export function createImageGenerationService(deps = {}) {
  const repository = deps.repository;
  if (!repository) throw new Error('imageGenerationService: repository obrigatorio');

  const groupMemoryService = deps.groupMemoryService || null;
  const getConfig = deps.getConfig || (() => ({}));
  const logger = deps.getLogger?.() || null;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const injectedAiClient = deps.aiClient || null;

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
  function tryConsumeQuota({ dateStr, limit }) {
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
  function buildPromptWithMemory({
    scopeKey,
    userPrompt,
    funConfig,
    userJid,
    withMemory = true,
    mentionedContext = '',
  }) {
    const base = clampPrompt(userPrompt);
    if (!base) return '';

    const parts = [base];
    if (withMemory && withMemoryEnabled(funConfig) && groupMemoryService) {
      const maxLore = Math.max(
        0,
        Math.floor(Number(funConfig?.imageGenLoreMaxChars) || Infinity)
      );
      if (maxLore > 0) {
        try {
          let lore = String(
            groupMemoryService.buildLoreContext(scopeKey, {
              userJids: userJid ? [userJid] : [],
              limit: Infinity,
              funConfig,
            }) || ''
          ).trim();
          if (lore.length > maxLore) lore = `${lore.slice(0, maxLore - 1)}…`;
          if (lore) parts.push(lore);
        } catch (err) {
          log('debug', { err: err?.message }, 'imageGen buildLoreContext fail');
        }
      }
    }

    const mentionBlock = String(mentionedContext || '').trim().slice(0, 2_000);
    if (mentionBlock) parts.push(mentionBlock);
    return parts.join('\n\n');
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

  /* ---------- chamada Gemini API (@google/genai) ---------- */

  async function callGeminiApi(prompt, opts = {}) {
    const c = cfg();
    const apiKey = String(c.imageGenApiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey && !opts.aiClient && !injectedAiClient) {
      return { ok: false, reason: 'no-apikey', error: 'Gemini API Key não configurada.' };
    }

    const ai =
      opts.aiClient ||
      injectedAiClient ||
      new GoogleGenAI({
        apiKey,
      });

    const rawModel = String(c.imageGenModel || 'models/gemini-3.1-flash-lite-image').trim();
    const model = rawModel.startsWith('models/') ? rawModel : `models/${rawModel}`;

    const generationConfig = {
      temperature: 1,
      max_output_tokens: 65536,
      top_p: 0.95,
      thinking_level: c.imageGenThinkingLevel || 'minimal',
      image_config: {
        image_size: c.imageGenSize || '1K',
      },
    };

    const timeoutMs = Math.max(1000, Math.floor(Number(c.imageGenTimeoutMs) || 60_000));

    try {
      const callPromise = ai.interactions.create({
        model,
        input: prompt,
        generation_config: generationConfig,
        response_modalities: ['image', 'text'],
      });

      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error(`image-timeout-${timeoutMs}ms`);
          err.name = 'AbortError';
          reject(err);
        }, timeoutMs);
      });

      const interaction = await Promise.race([callPromise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutHandle);
      });

      let imageBuffer = null;
      let textOutput = '';

      if (interaction?.steps && Array.isArray(interaction.steps)) {
        for (const step of interaction.steps) {
          if (step?.type === 'model_output' && Array.isArray(step.content)) {
            for (const part of step.content) {
              if (part?.type === 'text' && part.text) {
                textOutput += part.text;
              } else if (part?.type === 'image' && part.data) {
                try {
                  imageBuffer = Buffer.from(part.data, 'base64');
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        return { ok: false, reason: 'no-image', error: 'Nenhuma imagem retornada pelo modelo.' };
      }

      return {
        ok: true,
        url: '',
        buffer: imageBuffer,
        text: textOutput.trim(),
        format: 'b64_json',
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, reason: 'timeout', error: `image-timeout-${timeoutMs}ms` };
      }

      const errMsg = String(err?.message || '');
      const errStatus = err?.status || err?.statusCode;

      if (
        errStatus === 429 ||
        errMsg.includes('429') ||
        errMsg.includes('quota') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('rate-limits')
      ) {
        return { ok: false, reason: 'quota-exceeded', error: errMsg };
      }

      return { ok: false, reason: 'api-error', error: errMsg };
    }
  }

  /* ---------- chamada HTTP OpenAI-compat (fallback) ---------- */

  /**
   * Executa POST /v1/images/generations.
   * @returns {Promise<{ok:true, url:string, buffer:null} | {ok:true, url:'', buffer:Buffer} | {ok:false, reason, error?}>}
   */
  async function callOpenAiImageApi(prompt, opts) {
    const c = cfg();
    const baseUrl = String(c.imageGenBaseUrl || c.zenBaseUrl || 'http://localhost:20128/v1').trim();
    if (!baseUrl) return { ok: false, reason: 'no-baseurl' };

    const fetchFn = opts.fetchImpl || fetchImpl;
    if (typeof fetchFn !== 'function') {
      return { ok: false, reason: 'fetch-unavailable' };
    }

    const url = joinUrl(baseUrl, '/v1/images/generations');
    const primaryModel = String(c.imageGenModel || '').trim();
    const fallbackModels = Array.isArray(c.imageGenFallbackModels)
      ? c.imageGenFallbackModels.map((model) => String(model || '').trim()).filter(Boolean)
      : [];
    const uniqueFallbacks = [...new Set(fallbackModels.filter((model) => model !== primaryModel))];
    const primaryAttempts = Math.max(1, Math.min(10, Number(c.imageGenPrimaryAttempts) || 5));
    const models = [
      ...Array(primaryAttempts).fill(primaryModel),
      ...uniqueFallbacks,
      primaryModel,
    ].filter(Boolean);
    const headers = { 'Content-Type': 'application/json' };
    const key = String(c.imageGenApiKey || c.zenApiKey || '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    const timeoutMs = Math.max(1000, Math.floor(Number(c.imageGenTimeoutMs) || 60_000));
    const useBinaryResponse = /localhost:20128/i.test(baseUrl);
    const emptyResponses = [];

    const buildBody = (model) => {
      const body = { prompt, model };
      if (String(c.imageGenSize || '').trim()) body.size = String(c.imageGenSize).trim();
      if (String(c.imageGenQuality || '').trim()) body.quality = String(c.imageGenQuality).trim();
      if (!useBinaryResponse) {
        const fmt = String(c.imageGenResponseFormat || 'b64_json').trim().toLowerCase();
        if (fmt === 'b64_json' || fmt === 'url') body.response_format = fmt;
      }
      return body;
    };

    for (let attempt = 0; attempt < models.length; attempt += 1) {
      const model = models[attempt];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestUrl = useBinaryResponse
          ? `${url}?response_format=binary`
          : url;
        const response = await fetchFn(requestUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(model)),
          signal: controller.signal,
        });
        const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();

        if (response?.ok && contentType.startsWith('image/')) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 0) return { ok: true, url: '', buffer, format: 'binary', model, attempts: attempt + 1 };
          emptyResponses.push(`${model}:empty-binary`);
        } else if (response?.ok) {
          let data;
          try {
            data = await response.json();
          } catch (error) {
            emptyResponses.push(`${model}:bad-json`);
            continue;
          }
          const image = extractImage(data);
          if (image.ok) return { ...image, model, attempts: attempt + 1 };
          const dataCount = Array.isArray(data?.data) ? data.data.length : 0;
          const firstKeys = dataCount && data.data[0] && typeof data.data[0] === 'object'
            ? Object.keys(data.data[0]).join(',')
            : '';
          emptyResponses.push(`${model}:dataCount=${dataCount},firstKeys=${firstKeys || '-'}`);
        } else {
          const errorBody = await response?.text?.().catch(() => '');
          const status = Number(response?.status) || 0;
          if (status === 401 || status === 403) {
            return { ok: false, reason: `http-${status}`, error: String(errorBody || '').slice(0, 200) };
          }
          emptyResponses.push(`${model}:http-${status || 'failed'}`);
        }
      } catch (error) {
        emptyResponses.push(`${model}:${error?.name === 'AbortError' ? 'timeout' : 'fetch-error'}`);
      } finally {
        clearTimeout(timer);
      }
      logger?.debug?.({ scope: opts.scopeKey, model, attempt: attempt + 1, totalAttempts: models.length }, 'imageGen attempt failed; trying next model');
    }

    return {
      ok: false,
      reason: 'no-image',
      error: `image-attempts-exhausted ${emptyResponses.join(' | ')}`,
    };
  }

  /**
   * Normaliza resposta OpenAI-compat da Images API.
   * Formato: { data: [{ url?, b64_json?, revised_prompt? }] }
   */
  function extractImage(data) {
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

  async function callImageApi(prompt, opts = {}) {
    const c = cfg();
    const provider = String(c.imageGenProvider || '').toLowerCase().trim();

    // Se aiClient for explicitamente passado ou provider for gemini (ou default com chave gemini), usa Gemini
    if (opts.aiClient || injectedAiClient || provider === 'gemini') {
      return callGeminiApi(prompt, opts);
    }

    // Se provider for openai ou houver override de fetchImpl em ambiente sem aiClient
    if (provider === 'openai' || opts.fetchImpl) {
      return callOpenAiImageApi(prompt, opts);
    }

    // Fallback: se apiKey comecar com AIza usa Gemini, senao OpenAI
    const apiKey = String(c.imageGenApiKey || '').trim();
    if (apiKey.startsWith('AIza')) {
      return callGeminiApi(prompt, opts);
    }

    return callOpenAiImageApi(prompt, opts);
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
   * @param {string} [args.mentionedContext] perfil e lore confirmada das pessoas marcadas
   * @param {number} [args.now]
   * @param {typeof fetch} [args.fetchImpl] override para testes
   * @param {object} [args.aiClient]        override para testes do Gemini
   * @returns {Promise<{ok:true, url:string, buffer:Buffer|null, text?:string, remaining:number, used:number, limit:number, dateStr:string} | {ok:false, reason:string, error?:string, remaining?:number, limit?:number, dateStr?:string}>}
   */
  async function generateImage({
    scopeKey,
    userJid,
    prompt,
    command = 'imaginar',
    withMemory = false,
    mentionedContext = '',
    now = Date.now(),
    fetchImpl: overrideFetch,
    aiClient: overrideAiClient,
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

    const finalPrompt = buildPromptWithMemory({
      scopeKey,
      userPrompt,
      funConfig: c,
      userJid,
      withMemory,
      mentionedContext,
    });
    if (!finalPrompt) {
      return { ok: false, reason: 'empty-prompt-after-lore' };
    }

    const apiResult = await callImageApi(finalPrompt, {
      fetchImpl: overrideFetch,
      aiClient: overrideAiClient,
    });

    if (!apiResult?.ok) {
      log('warn', { err: apiResult?.reason, error: apiResult?.error, scope: scopeKey }, 'imageGen api failed');
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
      text: apiResult.text || '',
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
