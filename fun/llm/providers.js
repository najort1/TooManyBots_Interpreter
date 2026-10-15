/**
 * Registro Central de Provedores LLM para TooManyBots Fun.
 *
 * Fornece metadados, esquemas, modelos selecionados, URLs padrão e resolvedores
 * de variáveis de ambiente para OpenRouter, DeepSeek, OpenAI, Ollama, LM Studio,
 * Zen Proxy e endpoints compatíveis arbitrários.
 */

export const PROVIDER_IDS = {
  OPENROUTER: 'openrouter',
  DEEPSEEK: 'deepseek',
  OPENAI: 'openai',
  OLLAMA: 'ollama',
  LMSTUDIO: 'lmstudio',
  ZEN: 'zen',
  CUSTOM: 'custom',
};

export const PROVIDERS = {
  [PROVIDER_IDS.OPENROUTER]: {
    id: PROVIDER_IDS.OPENROUTER,
    name: 'OpenRouter',
    description: 'Acesso unificado a centenas de modelos (DeepSeek, Llama, Claude, etc.)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    portalUrl: 'https://openrouter.ai/keys',
    requiresApiKey: true,
    supportsModelDiscovery: false,
    defaultModel: 'deepseek/deepseek-chat',
    curatedModels: [
      { id: 'openrouter/auto', name: 'OpenRouter Auto (Roteamento Inteligente)' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat V3 (Excelente Custo/Benefício)' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Raciocínio Avançado)' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct' },
    ],
    sendSamplingParams: true,
  },
  [PROVIDER_IDS.DEEPSEEK]: {
    id: PROVIDER_IDS.DEEPSEEK,
    name: 'DeepSeek',
    description: 'API oficial da DeepSeek (baixo custo e altíssimo raciocínio)',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    portalUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    supportsModelDiscovery: false,
    defaultModel: 'deepseek-chat',
    curatedModels: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
    ],
    sendSamplingParams: true,
  },
  [PROVIDER_IDS.OPENAI]: {
    id: PROVIDER_IDS.OPENAI,
    name: 'OpenAI',
    description: 'Modelos GPT oficiais da OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    portalUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    supportsModelDiscovery: false,
    defaultModel: 'gpt-4o-mini',
    curatedModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Rápido e Econômico)' },
      { id: 'gpt-4o', name: 'GPT-4o (Omni Flagship)' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o3-mini', name: 'o3-mini (Raciocínio Rápido)' },
    ],
    sendSamplingParams: true,
  },
  [PROVIDER_IDS.OLLAMA]: {
    id: PROVIDER_IDS.OLLAMA,
    name: 'Ollama',
    description: 'Modelos locais rodando no computador (100% gratuito e offline)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    envKey: 'OLLAMA_API_KEY',
    portalUrl: 'https://ollama.com/download',
    requiresApiKey: false,
    supportsModelDiscovery: true,
    discoveryEndpoint: 'http://localhost:11434/api/tags',
    defaultModel: 'llama3.2',
    curatedModels: [
      { id: 'llama3.2', name: 'Llama 3.2 (Leve e Rápido)' },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B' },
      { id: 'mistral', name: 'Mistral 7B' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B' },
      { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B' },
      { id: 'phi4', name: 'Phi-4 (14B)' },
    ],
    sendSamplingParams: true,
  },
  [PROVIDER_IDS.LMSTUDIO]: {
    id: PROVIDER_IDS.LMSTUDIO,
    name: 'LM Studio',
    description: 'Servidor local com interface visual (gratuito e offline)',
    defaultBaseUrl: 'http://localhost:1234/v1',
    envKey: 'LMSTUDIO_API_KEY',
    portalUrl: 'https://lmstudio.ai/download',
    requiresApiKey: false,
    supportsModelDiscovery: true,
    discoveryEndpoint: 'http://localhost:1234/v1/models',
    defaultModel: 'local-model',
    curatedModels: [
      { id: 'local-model', name: 'Modelo atualmente carregado no LM Studio' },
    ],
    sendSamplingParams: true,
  },
  [PROVIDER_IDS.ZEN]: {
    id: PROVIDER_IDS.ZEN,
    name: 'Zen Proxy (TooManyBots)',
    description: 'Proxy local OpenCode Zen / TooManyBots',
    defaultBaseUrl: 'http://localhost:20128/v1',
    envKey: 'ZEN_API_KEY',
    portalUrl: 'http://localhost:20128',
    requiresApiKey: false,
    supportsModelDiscovery: false,
    defaultModel: 'bot-zap',
    curatedModels: [
      { id: 'bot-zap', name: 'bot-zap (Modelo Padrão Zen)' },
    ],
    sendSamplingParams: false,
  },
  [PROVIDER_IDS.CUSTOM]: {
    id: PROVIDER_IDS.CUSTOM,
    name: 'Custom (OpenAI Compatível)',
    description: 'Endpoint personalizado compatível com a API OpenAI',
    defaultBaseUrl: '',
    envKey: 'OPENAI_API_KEY',
    portalUrl: '',
    requiresApiKey: false,
    supportsModelDiscovery: false,
    defaultModel: '',
    curatedModels: [],
    sendSamplingParams: true,
  },
};

/**
 * Retorna a lista completa de provedores suportados.
 * @returns {Array<object>}
 */
export function listProviders() {
  return [
    PROVIDERS[PROVIDER_IDS.OPENROUTER],
    PROVIDERS[PROVIDER_IDS.DEEPSEEK],
    PROVIDERS[PROVIDER_IDS.OPENAI],
    PROVIDERS[PROVIDER_IDS.OLLAMA],
    PROVIDERS[PROVIDER_IDS.LMSTUDIO],
    PROVIDERS[PROVIDER_IDS.ZEN],
    PROVIDERS[PROVIDER_IDS.CUSTOM],
  ].map((p) => ({ ...p, curatedModels: [...p.curatedModels] }));
}

/**
 * Obtém os metadados de um provedor por id ou nome normalizado.
 * @param {string} idOrName
 * @returns {object|null}
 */
export function getProvider(idOrName) {
  if (!idOrName) return null;
  const key = String(idOrName).trim().toLowerCase().replace(/[-_\s]/g, '');

  for (const [id, prov] of Object.entries(PROVIDERS)) {
    const rawId = id.toLowerCase().replace(/[-_\s]/g, '');
    const rawName = prov.name.toLowerCase().replace(/[-_\s]/g, '');
    if (key === rawId || rawName.includes(key) || key.includes(rawId)) {
      return { ...prov, curatedModels: [...prov.curatedModels] };
    }
  }

  return null;
}

/**
 * Detecta o provedor mais provável a partir de uma URL base informada.
 * @param {string} url
 * @returns {string} ID do provedor ('openrouter' | 'deepseek' | 'openai' | 'ollama' | 'lmstudio' | 'zen' | 'custom')
 */
export function detectProviderFromUrl(url) {
  if (!url || typeof url !== 'string') return PROVIDER_IDS.CUSTOM;
  const u = url.trim().toLowerCase();

  if (u.includes('openrouter.ai')) return PROVIDER_IDS.OPENROUTER;
  if (u.includes('deepseek.com')) return PROVIDER_IDS.DEEPSEEK;
  if (u.includes('openai.com')) return PROVIDER_IDS.OPENAI;
  if (u.includes('11434') || u.includes('ollama')) return PROVIDER_IDS.OLLAMA;
  if (u.includes(':1234') || u.includes('lmstudio')) return PROVIDER_IDS.LMSTUDIO;
  if (u.includes(':20128') || u.includes(':3300') || u.includes('zen')) return PROVIDER_IDS.ZEN;

  return PROVIDER_IDS.CUSTOM;
}

/**
 * Resolve a chave de API de um provedor com base no ID do provedor ou na URL base,
 * consultando o ambiente de variáveis fornecido (padrão: process.env).
 *
 * @param {string} providerOrUrl - ID do provedor ou URL base
 * @param {object} [env=process.env]
 * @returns {string}
 */
export function resolveProviderApiKey(providerOrUrl, env = process.env) {
  const e = env || {};
  let providerId = PROVIDER_IDS.CUSTOM;

  if (providerOrUrl && typeof providerOrUrl === 'string') {
    const trimmed = providerOrUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('/') || trimmed.includes(':')) {
      providerId = detectProviderFromUrl(trimmed);
    } else {
      const found = getProvider(trimmed);
      providerId = found ? found.id : PROVIDER_IDS.CUSTOM;
    }
  }

  let resolved = '';
  switch (providerId) {
    case PROVIDER_IDS.OPENROUTER:
      resolved = e.OPENROUTER_API_KEY || e.ZEN_API_KEY || e.OPENAI_API_KEY || '';
      break;
    case PROVIDER_IDS.DEEPSEEK:
      resolved = e.DEEPSEEK_API_KEY || e.ZEN_API_KEY || e.OPENAI_API_KEY || '';
      break;
    case PROVIDER_IDS.OPENAI:
      resolved = e.OPENAI_API_KEY || e.ZEN_API_KEY || '';
      break;
    case PROVIDER_IDS.OLLAMA:
      resolved = e.OLLAMA_API_KEY || '';
      break;
    case PROVIDER_IDS.LMSTUDIO:
      resolved = e.LMSTUDIO_API_KEY || '';
      break;
    case PROVIDER_IDS.ZEN:
      resolved = e.ZEN_API_KEY || e.OPENAI_API_KEY || '';
      break;
    case PROVIDER_IDS.CUSTOM:
    default:
      resolved =
        e.OPENAI_API_KEY ||
        e.ZEN_API_KEY ||
        e.OPENROUTER_API_KEY ||
        e.DEEPSEEK_API_KEY ||
        '';
      break;
  }

  return String(resolved || '').trim();
}

export default {
  PROVIDER_IDS,
  PROVIDERS,
  listProviders,
  getProvider,
  detectProviderFromUrl,
  resolveProviderApiKey,
};
