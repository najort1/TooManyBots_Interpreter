/**
 * Governança Centralizada de LLM do bot Fun.
 *
 * Controla o Master Switch (`zenEnabled`) e os switches granulares por funcionalidade (`llmFeatures`),
 * permitindo ligar/desligar IA de forma global ou cirúrgica pelo dashboard.
 */

import { DEFAULT_LLM_FEATURES } from '../constants.js';

export { DEFAULT_LLM_FEATURES };

export const LLM_FEATURE_METADATA = Object.freeze({
  persona: {
    id: 'persona',
    name: 'Conversa & Persona',
    category: 'Chat & Social',
    description: 'Respostas conversacionais e interação inteligente do bot no grupo.',
    fallback: 'Não responde ou usa resposta pré-configurada sem acionar IA.',
  },
  memory: {
    id: 'memory',
    name: 'Memória & Fatos do Grupo',
    category: 'Memória',
    description: 'Extração automática de fatos, lore e histórico dos membros.',
    fallback: 'Pula a extração por IA preservando fatos já salvos.',
  },
  socialHints: {
    id: 'socialHints',
    name: 'Dicas Sociais',
    category: 'Memória',
    description: 'Inferência de afinidades e dinâmicas sociais da conversa.',
    fallback: 'Pula a inferência de novas pistas sociais.',
  },
  loreReconciliation: {
    id: 'loreReconciliation',
    name: 'Reconciliação de Lore',
    category: 'Memória',
    description: 'Resolução de fatos contraditórios sobre membros ou o grupo.',
    fallback: 'Mantém fatos existentes sem resolução automática por IA.',
  },
  flavor: {
    id: 'flavor',
    name: 'Falas de Jogos & Caos',
    category: 'Jogos & Economia',
    description: 'Comentários dinâmicos de vitória, cassino, roast e assaltos.',
    fallback: 'Usa catálogo de frases e templates estáticos locais instantâneos.',
  },
  groupNews: {
    id: 'groupNews',
    name: 'Jornal do Grupo (Group Times)',
    category: 'Chat & Social',
    description: 'Crônica jornalística periódica com fofocas e eventos do grupo.',
    fallback: 'Gera manchetes e crônica a partir de templates estáticos.',
  },
  levelUp: {
    id: 'levelUp',
    name: 'Mensagens de XP / Level Up',
    category: 'Jogos & Economia',
    description: 'Comentários dinâmicos e personalizados gerados por IA quando alguém sobe de nível.',
    fallback: 'Exibe o anúncio padrão de subida de nível sem o comentário adicional da IA.',
  },
  market: {
    id: 'market',
    name: 'Bolsa de Valores & Mercado',
    category: 'Jogos & Economia',
    description: 'Invenção de novas empresas fictícias e reescrita de notícias financeiras.',
    fallback: 'Sorteia empresas da base fixa e emite notícias sem jornalista IA.',
  },
  dailyChallenge: {
    id: 'dailyChallenge',
    name: 'Desafios Diários',
    category: 'Jogos & Economia',
    description: 'Geração de enigmas (guess_game), charadas (riddle) e dicas de Pokémon.',
    fallback: 'Utiliza banco de dados local com centenas de desafios estáticos.',
  },
  tarot: {
    id: 'tarot',
    name: 'Tarô Místico',
    category: 'Jogos & Economia',
    description: 'Interpretação personalizada das cartas e respostas a dúvidas.',
    fallback: 'Usa leituras clássicas pré-definidas para cada combinação de cartas.',
  },
  qmp: {
    id: 'qmp',
    name: 'Quem é Mais Provável',
    category: 'Jogos & Economia',
    description: 'Formulação de dilemas e perguntas adaptadas aos participantes.',
    fallback: 'Usa catálogo com centenas de perguntas pré-cadastradas.',
  },
  quizRoyale: {
    id: 'quizRoyale',
    name: 'Quiz Royale Multiplayer',
    category: 'Jogos & Economia',
    description: 'Geração de perguntas inéditas e temáticas para as rodadas do quiz.',
    fallback: 'Usa banco categorizado com dezenas de perguntas de fallback.',
  },
  events: {
    id: 'events',
    name: 'Extração de Eventos',
    category: 'Chat & Social',
    description: 'Detecção no chat de rolês, festas e compromissos marcados.',
    fallback: 'Pula extração de novos eventos da conversa.',
  },
  selfHeal: {
    id: 'selfHeal',
    name: 'Auto-Cura / Auditoria',
    category: 'Sistema',
    description: 'Auditoria autônoma e limpeza de inconsistências nos dados do bot.',
    fallback: 'Pula verificação por IA (apenas regras heurísticas de código).',
  },
  profile: {
    id: 'profile',
    name: 'Perfil do Usuário',
    category: 'Chat & Social',
    description: 'Extração inteligente de bio e extras no cadastro do usuário.',
    fallback: 'Extrai campos estritamente via regex e regras fixas sem IA.',
  },
});

/**
 * Normaliza o mapa de features booleanas de LLM.
 *
 * @param {object} [rawInput]
 * @returns {Record<string, boolean>}
 */
export function normalizeLlmFeatures(rawInput) {
  const raw = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  const normalized = {};

  for (const key of Object.keys(DEFAULT_LLM_FEATURES)) {
    if (Object.hasOwn(raw, key)) {
      normalized[key] = Boolean(raw[key]);
    } else {
      normalized[key] = DEFAULT_LLM_FEATURES[key];
    }
  }

  return normalized;
}

/**
 * Verifica se o LLM está habilitado para uma determinada funcionalidade.
 *
 * Regra:
 * 1. Se o Master Switch (zenEnabled) estiver desligado (`false`), NENHUMA função usa LLM.
 * 2. Se a flag específica da feature estiver `false`, ela não usa LLM.
 * 3. Caso contrário, retorna `true`.
 *
 * @param {object} [funConfig] Configuração atual do bot Fun.
 * @param {string} [featureKey] Identificador da funcionalidade (ex: 'persona', 'tarot', 'quizRoyale').
 * @returns {boolean}
 */
export function isLlmFeatureEnabled(funConfig = {}, featureKey = '') {
  // Master Switch
  if (funConfig.zenEnabled === false) {
    return false;
  }

  // Feature individual
  if (featureKey && Object.hasOwn(DEFAULT_LLM_FEATURES, featureKey)) {
    const features = funConfig.llmFeatures || {};
    if (features[featureKey] === false) {
      return false;
    }
  }

  return true;
}

/**
 * Retorna o status completo das funcionalidades de LLM com metadados para API e Dashboard.
 *
 * @param {object} [funConfig]
 * @returns {object}
 */
export function getLlmFeaturesStatus(funConfig = {}) {
  const masterEnabled = funConfig.zenEnabled !== false;
  const features = normalizeLlmFeatures(funConfig.llmFeatures);

  const list = Object.entries(LLM_FEATURE_METADATA).map(([key, meta]) => {
    const featureEnabled = features[key] !== false;
    const effectiveActive = masterEnabled && featureEnabled;
    return {
      ...meta,
      enabled: featureEnabled,
      active: effectiveActive,
    };
  });

  return {
    masterEnabled,
    features,
    items: list,
  };
}
