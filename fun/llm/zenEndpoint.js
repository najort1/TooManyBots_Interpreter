/**
 * Resolução centralizada do endpoint Zen (url + model + apiKey).
 *
 * Fonte única de verdade: o funConfig normalizado em `fun/config.js`,
 * que por padrão popula `zenBaseUrl`/`zenModel` com os defaults de
 * `constants.js` (`localhost:20128/v1` + `bot-zap`). Nenhum serviço deve
 * ter fallbacks próprios para `:3300`/`glm_5_2`/`gpt-oss` — tudo passa
 * por aqui.
 *
 * Suporta resolução inteligente de chaves a partir de variáveis de ambiente:
 * OPENROUTER_API_KEY, DEEPSEEK_API_KEY, ZEN_API_KEY e OPENAI_API_KEY.
 */
import { DEFAULT_FUN_CONFIG } from '../constants.js';
import { resolveProviderApiKey, detectProviderFromUrl, PROVIDER_IDS } from './providers.js';

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
  const baseUrl = toStr(cfg.zenBaseUrl, DEFAULT_FUN_CONFIG.zenBaseUrl);
  const model = toStr(cfg.zenModel, DEFAULT_FUN_CONFIG.zenModel);

  // 1. Chave explícita na configuração
  let apiKey = toStr(cfg.zenApiKey, '');

  // 2. Chave correspondente ao provedor detectado na URL
  if (!apiKey) {
    apiKey = resolveProviderApiKey(baseUrl, process.env);
  }

  // 3. Fallbacks gerais de ambiente (ignorado para provedores estritamente locais como Ollama e LM Studio)
  if (!apiKey) {
    const provId = detectProviderFromUrl(baseUrl);
    const isLocalProvider = provId === PROVIDER_IDS.OLLAMA || provId === PROVIDER_IDS.LMSTUDIO;
    if (!isLocalProvider) {
      apiKey = toStr(
        process.env.ZEN_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '',
        ''
      );
    }
  }

  return {
    baseUrl,
    model,
    apiKey,
  };
}

export default resolveZenEndpoint;
