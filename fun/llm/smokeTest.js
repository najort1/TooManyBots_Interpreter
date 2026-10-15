/**
 * Teste de conectividade e micro-inferência em tempo real para endpoints LLM (OpenAI-compatíveis).
 *
 * Inspirado no padrão de auto-diagnóstico do Hermes:
 * - Dispara micro-completion "Say 'OK'" com max_tokens: 8
 * - Mede latência real de ida e volta (ms)
 * - Classifica diagnósticos e falhas (401, 402, 429, 404, ECONNREFUSED, timeout)
 * - Retorna orientações concretas de remediação e links diretos para portais
 */

import { detectProviderFromUrl, getProvider } from './providers.js';

/**
 * Normaliza a URL base para o endpoint /chat/completions.
 * @param {string} baseUrl
 * @returns {string}
 */
export function buildCompletionsUrl(baseUrl) {
  const base = String(baseUrl || 'http://localhost:20128/v1').trim().replace(/\/+$/, '');

  if (/\/chat\/completions$/i.test(base)) {
    return base;
  }

  if (/\/v1$/i.test(base)) {
    return `${base}/chat/completions`;
  }

  if (/\/v1\//i.test(base)) {
    return `${base}/chat/completions`;
  }

  // Endpoints locais comuns sem /v1 (ex: http://localhost:11434 ou http://localhost:1234)
  if (base.includes(':11434') || base.includes(':1234')) {
    return `${base}/v1/chat/completions`;
  }

  // DeepSeek aceita tanto /chat/completions quanto /v1/chat/completions
  if (base.includes('deepseek.com')) {
    return `${base}/chat/completions`;
  }

  // Padrão geral OpenAI-compatível
  return `${base}/v1/chat/completions`;
}

/**
 * Classifica erros HTTP e falhas de rede com diagnósticos práticos para o usuário.
 *
 * @param {object} params
 * @param {number} [params.status]
 * @param {string} [params.responseBody]
 * @param {Error|any} [params.error]
 * @param {string} [params.baseUrl]
 * @param {string} [params.model]
 * @returns {{ code: string, reason: string, advice: string, portalUrl: string }}
 */
export function classifyLlmError({ status, responseBody = '', error = null, baseUrl = '', model = '' } = {}) {
  const providerId = detectProviderFromUrl(baseUrl);
  const provider = getProvider(providerId);
  const providerName = provider?.name || 'Provedor';
  const portalUrl = provider?.portalUrl || '';
  const bodyText = String(responseBody || '').toLowerCase();

  if (status === 401 || bodyText.includes('invalid_api_key') || bodyText.includes('unauthorized')) {
    return {
      code: 'UNAUTHORIZED',
      reason: 'unauthorized-key',
      advice: `Chave de API inválida, expirada ou ausente para ${providerName}. Verifique sua chave nas configurações ou gere uma nova em: ${portalUrl || 'portal do provedor'}`,
      portalUrl,
    };
  }

  if (
    status === 402 ||
    bodyText.includes('insufficient_quota') ||
    bodyText.includes('credit_balance_too_low') ||
    bodyText.includes('payment_required') ||
    bodyText.includes('exceeded your current quota')
  ) {
    return {
      code: 'PAYMENT_REQUIRED',
      reason: 'insufficient-credits',
      advice: `Créditos esgotados ou saldo insuficiente na sua conta ${providerName}. Recarregue seus créditos em: ${portalUrl || 'portal do provedor'}`,
      portalUrl,
    };
  }

  if (status === 429 || bodyText.includes('rate_limit') || bodyText.includes('too many requests')) {
    return {
      code: 'RATE_LIMIT',
      reason: 'rate-limit-exceeded',
      advice: `Limite de taxa por minuto (RPM) ou cota diária excedida no ${providerName}. Aguarde alguns minutos ou consulte: ${portalUrl || 'portal do provedor'}`,
      portalUrl,
    };
  }

  if (status === 404 || bodyText.includes('model_not_found') || bodyText.includes('does not exist')) {
    return {
      code: 'NOT_FOUND',
      reason: 'model-or-endpoint-not-found',
      advice: `Modelo '${model}' não encontrado ou caminho do endpoint inválido (${baseUrl}). Verifique a grafia do modelo ou certifique-se de que a URL inclui '/v1'.`,
      portalUrl,
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      reason: 'provider-server-error',
      advice: `O servidor do ${providerName} retornou erro interno HTTP ${status}. Tente novamente em alguns instantes.`,
      portalUrl,
    };
  }

  // Falhas de rede ou timeout
  const errCode = error?.code || error?.cause?.code || '';
  const errMsg = String(error?.message || error || '').toLowerCase();

  if (error?.name === 'AbortError' || errCode === 'ETIMEDOUT' || errMsg.includes('timeout') || errMsg.includes('abort')) {
    return {
      code: 'TIMEOUT',
      reason: 'timeout',
      advice: `Tempo limite de conexão esgotado ao contatar ${baseUrl}. Verifique sua conexão com a internet ou aumente o timeout.`,
      portalUrl,
    };
  }

  if (
    errCode === 'ECONNREFUSED' ||
    errMsg.includes('econnrefused') ||
    errMsg.includes('connection refused') ||
    errMsg.includes('fetch failed')
  ) {
    return {
      code: 'CONNECTION_REFUSED',
      reason: 'server-offline',
      advice: `Não foi possível conectar em ${baseUrl} (conexão recusada). Se for um provedor local (${providerName}), certifique-se de que o aplicativo ou serviço está aberto e rodando.`,
      portalUrl,
    };
  }

  if (errCode === 'ENOTFOUND' || errMsg.includes('enotfound')) {
    return {
      code: 'DNS_ERROR',
      reason: 'host-not-found',
      advice: `Endereço de rede não encontrado (${baseUrl}). Verifique se a URL foi digitada corretamente.`,
      portalUrl,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    reason: status ? `http-${status}` : 'network-error',
    advice: `Falha na comunicação com ${baseUrl} (${status ? `HTTP ${status}` : error?.message || 'Erro desconhecido'}).`,
    portalUrl,
  };
}

/**
 * Executa ping de micro-conclusão e diagnóstico completo do endpoint LLM.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl='http://localhost:20128/v1']
 * @param {string} [options.model='bot-zap']
 * @param {string} [options.apiKey='']
 * @param {number} [options.timeoutMs=5000]
 * @param {boolean} [options.sendSamplingParams=true]
 * @param {string} [options.prompt="Say 'OK'"]
 * @returns {Promise<{
 *   ok: boolean,
 *   latencyMs: number,
 *   status?: number,
 *   reply?: string,
 *   model: string,
 *   baseUrl: string,
 *   code?: string,
 *   reason?: string,
 *   advice?: string,
 *   portalUrl?: string,
 *   error?: string
 * }>}
 */
export async function smokeTestLlm(options = {}) {
  const baseUrl = String(options.baseUrl || 'http://localhost:20128/v1').trim();
  const model = String(options.model || 'bot-zap').trim();
  const apiKey = String(options.apiKey || '').trim();
  const timeoutMs = Math.max(500, Math.min(30000, Number(options.timeoutMs) || 5000));
  const prompt = String(options.prompt || "Say 'OK'").trim();

  const providerId = detectProviderFromUrl(baseUrl);
  const provider = getProvider(providerId);

  const shouldSendSampling = options.sendSamplingParams !== undefined
    ? Boolean(options.sendSamplingParams)
    : (provider?.sendSamplingParams !== false);

  const completionsUrl = buildCompletionsUrl(baseUrl);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Metadados recomendados para OpenRouter
  if (baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/TooManyBots/TooManyBots_Interpreter';
    headers['X-Title'] = 'TooManyBots Fun';
  }

  const payload = {
    model,
    messages: [
      { role: 'user', content: prompt },
    ],
    max_tokens: 8,
  };

  if (shouldSendSampling) {
    payload.temperature = 0.1;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const res = await fetch(completionsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const reply = data?.choices?.[0]?.message?.content?.trim() || 'OK';

      return {
        ok: true,
        latencyMs,
        status: res.status,
        model,
        reply,
        baseUrl,
        provider: providerId,
      };
    }

    // Status HTTP de erro
    const responseBody = await res.text().catch(() => '');
    const classification = classifyLlmError({
      status: res.status,
      responseBody,
      baseUrl,
      model,
    });

    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: responseBody || `HTTP ${res.status}`,
      baseUrl,
      model,
      provider: providerId,
      ...classification,
    };
  } catch (error) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    const classification = classifyLlmError({
      error,
      baseUrl,
      model,
    });

    return {
      ok: false,
      latencyMs,
      error: String(error?.message || error),
      baseUrl,
      model,
      provider: providerId,
      ...classification,
    };
  }
}

export default smokeTestLlm;
