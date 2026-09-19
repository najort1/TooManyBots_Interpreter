/**
 * Verificação proativa de conectividade com o endpoint Zen / OpenAI compatível.
 *
 * Se o endpoint configurado (ex: localhost:20128) estiver inacessível no boot,
 * permite ao sistema chavear graciosamente para o Modo Econômico (100% templates
 * mockados) em memória, eliminando lags de timeout e retentativas desnecessárias.
 */

import { resolveZenEndpoint } from './zenEndpoint.js';

/**
 * @param {object} funConfig
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ online: boolean, reason?: string, baseUrl: string, model: string }>}
 */
export async function checkZenConnectivity(funConfig = {}, options = {}) {
  const timeoutMs = Math.max(500, Math.min(5000, Number(options.timeoutMs) || 1500));
  const ep = resolveZenEndpoint(funConfig);

  if (funConfig.zenEnabled === false || process.env.FUN_DISABLE_LIVE_LLM === '1') {
    return {
      online: false,
      reason: 'explicitly-disabled',
      baseUrl: ep.baseUrl,
      model: ep.model,
    };
  }

  // Normaliza URL para teste
  let pingUrl = ep.baseUrl.replace(/\/+$/, '');
  if (!pingUrl.endsWith('/v1')) {
    pingUrl = `${pingUrl}/v1`;
  }
  const modelsUrl = `${pingUrl}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    if (ep.apiKey) {
      headers.Authorization = `Bearer ${ep.apiKey}`;
    }

    // Tenta /models; se retornar 200..299 ou mesmo 401/403 (servidor existe e respondeu HTTP)
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    }).catch(async () => {
      // Fallback: ping na raiz da URL base
      return fetch(ep.baseUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    });

    clearTimeout(timer);

    if (response && (response.ok || response.status === 401 || response.status === 403 || response.status === 404)) {
      return {
        online: true,
        baseUrl: ep.baseUrl,
        model: ep.model,
        status: response.status,
      };
    }

    return {
      online: false,
      reason: 'unexpected-http-status',
      baseUrl: ep.baseUrl,
      model: ep.model,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      online: false,
      reason: error?.name === 'AbortError' ? 'timeout' : error?.code || 'unreachable',
      error: String(error?.message || error),
      baseUrl: ep.baseUrl,
      model: ep.model,
    };
  }
}

export default checkZenConnectivity;
