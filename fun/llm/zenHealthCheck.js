/**
 * Verificação proativa de conectividade com o endpoint Zen / OpenAI compatível.
 *
 * Utiliza o smokeTestLlm para checar autenticação real e latência no boot.
 * Se o endpoint estiver inacessível ou com chave incorreta (HTTP 401/403),
 * permite ao sistema chavear graciosamente para o Modo Econômico (100% templates
 * mockados) em memória, eliminando lags de timeout e erros em cascata.
 */

import { resolveZenEndpoint } from './zenEndpoint.js';
import { smokeTestLlm } from './smokeTest.js';

/**
 * @param {object} funConfig
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   online: boolean,
 *   reason?: string,
 *   baseUrl: string,
 *   model: string,
 *   status?: number,
 *   latencyMs?: number,
 *   advice?: string,
 *   portalUrl?: string,
 *   error?: string
 * }>}
 */
export async function checkZenConnectivity(funConfig = {}, options = {}) {
  const timeoutMs = Math.max(500, Math.min(10000, Number(options.timeoutMs) || 1500));
  const ep = resolveZenEndpoint(funConfig);

  if (funConfig.zenEnabled === false || process.env.FUN_DISABLE_LIVE_LLM === '1') {
    return {
      online: false,
      reason: 'explicitly-disabled',
      baseUrl: ep.baseUrl,
      model: ep.model,
    };
  }

  const result = await smokeTestLlm({
    baseUrl: ep.baseUrl,
    model: ep.model,
    apiKey: ep.apiKey,
    timeoutMs,
  });

  if (result.ok) {
    return {
      online: true,
      baseUrl: ep.baseUrl,
      model: ep.model,
      status: result.status,
      latencyMs: result.latencyMs,
      reply: result.reply,
    };
  }

  // Chaves não autorizadas ou inválidas devem ser explicitamente reportadas como offline
  if (result.status === 401 || result.status === 403 || result.reason === 'unauthorized-key') {
    return {
      online: false,
      reason: 'unauthorized-key',
      baseUrl: ep.baseUrl,
      model: ep.model,
      status: result.status,
      advice: result.advice,
      portalUrl: result.portalUrl,
    };
  }

  return {
    online: false,
    reason: result.reason || 'unreachable',
    error: result.error,
    baseUrl: ep.baseUrl,
    model: ep.model,
    status: result.status,
    advice: result.advice,
    portalUrl: result.portalUrl,
  };
}

export default checkZenConnectivity;
