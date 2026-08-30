/**
 * ParseGuard: Camada de pós-validação e enriquecimento de fatos extraídos de um batch.
 *
 * Responsabilidades:
 * - Detectar conflitos internos dentro do mesmo batch (ex.: fatos contraditórios no mesmo índice)
 * - Normalizar tipos/kinds estendidos para o catálogo canônico
 * - Calcular score de confiança composto
 * - Anexar trace e avisos de integridade sem quebrar o formato original
 */

import { normalizeKey, tokenSet, jaccard } from '../../utils/textSimilarity.js';

const EXTENDED_KIND_MAP = new Map([
  ['humor', 'running_gag'],
  ['piada', 'running_gag'],
  ['meme', 'running_gag'],
  ['zoeira', 'running_gag'],
  ['briga', 'rivalry'],
  ['treta', 'rivalry'],
  ['disputa', 'rivalry'],
  ['bordao', 'catchphrase'],
  ['frase', 'catchphrase'],
  ['mico', 'epic_fail'],
  ['vergonha', 'epic_fail'],
  ['derrota', 'epic_fail'],
  ['casal', 'ship_lore'],
  ['romance', 'ship_lore'],
  ['ship', 'ship_lore'],
  ['apelido', 'nickname'],
  ['alcunha', 'nickname'],
  ['acontecimento', 'event'],
  ['noticia', 'event'],
  ['fato', 'event'],
]);

const CANONICAL_KINDS = new Set([
  'running_gag',
  'rivalry',
  'catchphrase',
  'epic_fail',
  'ship_lore',
  'nickname',
  'event',
]);

/**
 * Normaliza um kind qualquer para um dos 7 canônicos.
 *
 * @param {string} rawKind
 * @returns {string}
 */
export function normalizeGuardKind(rawKind) {
  const k = normalizeKey(rawKind);
  if (CANONICAL_KINDS.has(k)) return k;
  if (EXTENDED_KIND_MAP.has(k)) return EXTENDED_KIND_MAP.get(k);
  return 'event';
}

/**
 * Calcula score de confiança composto (0-100) baseado em evidências estruturais.
 *
 * @param {object} fact
 * @returns {number}
 */
export function computeFactConfidence(fact) {
  let confidence = Number(fact.score) || 50;
  const summary = String(fact.summary || '');
  const subjects = Array.isArray(fact.subjects) ? fact.subjects : [];

  // Recompensa summaries com tamanho descritivo adequado (entre 30 e 140 chars)
  if (summary.length >= 30 && summary.length <= 140) {
    confidence += 5;
  } else if (summary.length < 20) {
    confidence -= 10;
  }

  // Se tiver subject numérico explícito mapeado
  if (subjects.length > 0) {
    confidence += 5;
  } else {
    confidence -= 15;
  }

  // Keywords presentes
  if (Array.isArray(fact.keywords) && fact.keywords.length >= 2) {
    confidence += 5;
  }

  return Math.max(10, Math.min(100, Math.round(confidence)));
}

/**
 * Executa a guarda de validação cruzada sobre a lista de fatos de um batch.
 *
 * @param {Array<object>} facts Lista de fatos retornada por parseFactsJson
 * @param {object} [options={}]
 * @returns {Array<object>} Fatos enriquecidos e sanitizados
 */
export function guardBatchFacts(facts = [], options = {}) {
  if (!Array.isArray(facts) || !facts.length) return [];

  const traceId = options.traceId || `guard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const validated = [];
  const subjectIndexMap = new Map(); // subject_index -> Array<summary>

  for (const rawFact of facts) {
    if (!rawFact || typeof rawFact !== 'object') continue;

    const summary = String(rawFact.summary || '').trim();
    if (!summary || summary.length < 12) continue;

    const canonicalKind = normalizeGuardKind(rawFact.kind);
    const warnings = [];
    const subjects = Array.isArray(rawFact.subjects) ? rawFact.subjects : [];

    // Detecção de conflitos/duplicações no mesmo batch
    for (const subj of subjects) {
      if (typeof subj === 'number') {
        const previousSummaries = subjectIndexMap.get(subj) || [];
        for (const prev of previousSummaries) {
          const sim = jaccard(summary, prev);
          // Se muito similar no mesmo batch, marca aviso de redundância
          if (sim > 0.7) {
            warnings.push(`redundant_with_subject_${subj}`);
          }
        }
        previousSummaries.push(summary);
        subjectIndexMap.set(subj, previousSummaries);
      }
    }

    const confidence = computeFactConfidence({
      ...rawFact,
      summary,
      kind: canonicalKind,
      subjects,
    });

    validated.push({
      ...rawFact,
      kind: canonicalKind,
      summary,
      subjects,
      score: confidence,
      _parseGuard: {
        traceId,
        validatedAt: Date.now(),
        warnings,
        confidence,
      },
    });
  }

  return validated;
}
