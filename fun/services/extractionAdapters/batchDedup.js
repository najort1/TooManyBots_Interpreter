/**
 * BatchDedup: Pré-filtragem e deduplicação de mensagens de chat antes da invocação do LLM.
 *
 * Filtra mensagens repetitivas ou que apenas repetem fatos de alta confiança já consolidados no banco
 * nas últimas N horas, reduzindo consumo desnecessário de tokens e tempo de inferência.
 */

import { tokenSet, jaccard } from '../../utils/textSimilarity.js';

/**
 * Filtra e compacta um batch de mensagens antes da chamada de extração LLM.
 *
 * @param {Array<{ messageId?: string, userJid?: string, text?: string, at?: number }>} rawMessages Mensagens do buffer
 * @param {Array<{ summary: string, score: number, last_seen_at?: number }>} knownFacts Fatos já conhecidos do escopo
 * @param {object} [options={}]
 * @param {number} [options.minScore=80] Score mínimo do fato conhecido para justificar filtragem
 * @param {number} [options.windowHours=24] Janela de tempo de fatos recentes considerados
 * @param {number} [options.similarityThreshold=0.85] Limiar de similaridade Jaccard para descarte
 * @param {number} [options.now=Date.now()] Timestamp de referência
 * @returns {{ filteredBatch: Array<object>, droppedCount: number }}
 */
export function dedupBatchBeforeExtract(rawMessages = [], knownFacts = [], options = {}) {
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    return { filteredBatch: [], droppedCount: 0 };
  }

  const minScore = Number(options.minScore) || 80;
  const windowMs = (Number(options.windowHours) || 24) * 60 * 60 * 1000;
  const threshold = Number(options.similarityThreshold) || 0.85;
  const now = Number(options.now) || Date.now();
  const cutoff = now - windowMs;

  // Filtra fatos consolidados recentes com alto score
  const activeRecentFacts = (knownFacts || []).filter((f) => {
    const score = Number(f.score) || 0;
    const lastSeen = Number(f.last_seen_at) || 0;
    return score >= minScore && (!lastSeen || lastSeen >= cutoff);
  });

  const factTokenSets = activeRecentFacts.map((f) => ({
    summary: f.summary,
    tokens: tokenSet(f.summary),
  }));

  const filteredBatch = [];
  let droppedCount = 0;
  const seenInBatchTokens = [];

  for (const msg of rawMessages) {
    const text = String(msg?.text || '').trim();
    if (!text || text.length < 12) {
      // Mensagens muito curtas passam para manter integridade do índice de batch
      filteredBatch.push(msg);
      continue;
    }

    const msgTokens = tokenSet(text);
    let isRedundant = false;

    // 1. Checa contra fatos conhecidos recentes de alta confiança
    for (const fact of factTokenSets) {
      if (jaccard(msgTokens, fact.tokens) >= threshold) {
        isRedundant = true;
        break;
      }
    }

    // 2. Checa contra repetições idênticas dentro do próprio batch atual (ex.: spam ou eco)
    if (!isRedundant) {
      for (const prevTokens of seenInBatchTokens) {
        if (jaccard(msgTokens, prevTokens) >= 0.95) {
          isRedundant = true;
          break;
        }
      }
    }

    if (isRedundant) {
      droppedCount += 1;
    } else {
      seenInBatchTokens.push(msgTokens);
      filteredBatch.push(msg);
    }
  }

  return {
    filteredBatch,
    droppedCount,
  };
}
