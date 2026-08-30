/**
 * EvidenceEnricher: Enriquecedor de metadados de evidência para fatos de memória.
 *
 * Associa ao fato dados estruturados da mensagem de origem (messageId, authorJid, timestamp, textOffset, snippet).
 */

import { normalizeKey, jaccard } from '../../utils/textSimilarity.js';

/**
 * Enriquece uma lista de fatos associando metadados de evidência com base nas mensagens originais do batch.
 *
 * @param {Array<object>} facts Fatos extraídos
 * @param {Array<{ messageId?: string, userJid?: string, text?: string, at?: number }>} rawBatch Mensagens originais do batch
 * @param {string} scopeKey Escopo do grupo
 * @returns {Array<object>} Fatos com campo `evidence` estruturado anexado
 */
export function enrichFactsWithEvidence(facts = [], rawBatch = [], scopeKey = '') {
  if (!Array.isArray(facts) || !facts.length) return [];
  if (!Array.isArray(rawBatch) || !rawBatch.length) return facts;

  return facts.map((fact) => {
    const subjects = Array.isArray(fact.subjects) ? fact.subjects : [];
    let matchedMessage = null;
    let matchConfidence = 0.5;

    // 1. Se subjects contiver índice numérico
    const primaryIndex = subjects.find((s) => typeof s === 'number' && s >= 0 && s < rawBatch.length);
    if (primaryIndex != null && rawBatch[primaryIndex]) {
      matchedMessage = rawBatch[primaryIndex];
      matchConfidence = 0.95;
    }

    // 2. Se subjects já contiver JIDs mapeados
    if (!matchedMessage) {
      const subjectJids = subjects.filter((s) => typeof s === 'string' && s.includes('@'));
      if (subjectJids.length > 0) {
        // Encontra mensagem no batch com esse autor e maior similaridade
        const factSummary = String(fact.summary || '');
        let bestSim = 0;
        let candidateMsg = null;

        for (const msg of rawBatch) {
          if (subjectJids.includes(msg.userJid)) {
            const sim = jaccard(factSummary, msg.text || '');
            if (sim >= bestSim) {
              bestSim = sim;
              candidateMsg = msg;
            }
          }
        }

        if (candidateMsg) {
          matchedMessage = candidateMsg;
          matchConfidence = 0.9;
        }
      }
    }

    // 3. Fallback puro por similaridade textual
    if (!matchedMessage) {
      const factSummary = String(fact.summary || '');
      let bestSim = 0;
      let bestMsg = null;

      for (const msg of rawBatch) {
        const sim = jaccard(factSummary, msg.text || '');
        if (sim > bestSim) {
          bestSim = sim;
          bestMsg = msg;
        }
      }

      if (bestSim >= 0.2) {
        matchedMessage = bestMsg;
        matchConfidence = Math.min(0.85, 0.3 + bestSim);
      }
    }

    if (!matchedMessage) {
      return {
        ...fact,
        evidence: {
          scopeKey: String(scopeKey || ''),
          status: 'unlinked',
          matchConfidence: 0,
        },
      };
    }

    return {
      ...fact,
      evidence: {
        scopeKey: String(scopeKey || ''),
        messageId: String(matchedMessage.messageId || ''),
        authorJid: String(matchedMessage.userJid || ''),
        timestamp: Number(matchedMessage.at) || Date.now(),
        snippet: String(matchedMessage.text || '').slice(0, 160),
        status: 'linked',
        matchConfidence,
      },
    };
  });
}
