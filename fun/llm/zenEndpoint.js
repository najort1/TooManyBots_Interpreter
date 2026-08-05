/**
 * Resolução centralizada do endpoint Zen (url + model + apiKey).
 *
 * Fonte única de verdade: o funConfig normalizado em `fun/config.js`,
 * que por padrão popula `zenBaseUrl`/`zenModel` com os defaults de
 * `constants.js` (`localhost:20128/v1` + `bot-zap`). Nenhum serviço deve
 * ter fallbacks próprios para `:3300`/`glm_5_2`/`gpt-oss` — tudo passa
 * por aqui.
 */
import { DEFAULT_FUN_CONFIG } from '../constants.js';

function toStr(value, fallback) {
  const s = String(value ?? '').trim();
  return s || String(fallback ?? '').trim();
}

/**
 * @param {object} [funConfig] config normalizado (resolveFunConfig) — aceita {} p/ testes
 * @returns {{ baseUrl: string, model: string, apiKey: string }}
 */
export function resolveZenEndpoint(funConfig = {}) {
  const cfg = funConfig && typeof funConfig === 'object' ? funConfig : {};
  return {
    baseUrl: toStr(cfg.zenBaseUrl, DEFAULT_FUN_CONFIG.zenBaseUrl),
    model: toStr(cfg.zenModel, DEFAULT_FUN_CONFIG.zenModel),
    apiKey: toStr(cfg.zenApiKey, ''),
  };
}

export default resolveZenEndpoint;
