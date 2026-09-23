import { DEFAULT_FUN_CONFIG } from '../constants.js';

/**
 * Remove barras finais de uma URL.
 */
function cleanUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Resolve o endpoint do Laya Decision Service centralizadamente.
 *
 * @param {object} funConfig - Configurações ativas do módulo fun
 * @returns {{ baseUrl: string, model: string, timeoutMs: number }}
 */
export function resolveLayaEndpoint(funConfig = {}) {
  const rawBase = funConfig.layaBaseUrl || DEFAULT_FUN_CONFIG.layaBaseUrl || 'http://127.0.0.1:20129';
  const baseUrl = cleanUrl(rawBase);
  const model = String(funConfig.layaModel || DEFAULT_FUN_CONFIG.layaModel || 'aac6fef/laya-mlx').trim();
  const timeoutMs = Math.max(50, Math.min(30_000, Number(funConfig.layaTimeoutMs) || DEFAULT_FUN_CONFIG.layaTimeoutMs || 250));

  return {
    baseUrl,
    model,
    timeoutMs,
  };
}
