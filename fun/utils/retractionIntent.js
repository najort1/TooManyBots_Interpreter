/**
 * fun/utils/retractionIntent.js
 *
 * Detector robusto de intenção de retratação, esquecimento ou remoção de fatos de lore.
 * Reconhece gírias, expressões idiomáticas e coloquialismos em pt-BR de WhatsApp,
 * incluindo rejeição por incômodo, alegações de falsidade, fatos antigos/superados
 * e respostas em mensagens citadas (quote).
 */

import { normalizeKey } from './textSimilarity.js';

// Verbos explícitos de remoção / esquecimento
const DIRECT_REMOVAL_RE = /\b(tira|tirar|tirem|tire|tiram|arranca|arrancar|apaga|apagar|apaguem|apague|deleta|deletar|deletem|delete|exclui|excluir|excluam|remove|remover|removam|esquece|esquecer|esquecam|limpa|limpar|limpem|cancela|cancelar)\b/i;
const PHRASE_REMOVAL_RE = /\b(some com|sumir com)\b/i;

// Rejeição por desgosto, incômodo, chatice ou cansaço
const DISLIKE_RE = /\b(nao gosto|nao gostei|odeio|detesto|nao quero mais)\b/i;
const ANNOYANCE_RE = /\b(para de falar|pare de falar|para com essa|pare com essa|para com isso|chega de|chega dessa|chega desse papo|chega dessa piada|para de zoar|nao aguento mais|ninguem aguenta mais|sem graca|perdeu a graca|bagulho chato|chato pra caralho|muito constrangedor|constrangedor)\b/i;

// Contestação, desmentido, erro ou alegação de falsidade
const FALSEHOOD_RE = /\b(mentira|mentiroso|fake|fake news|falso|falsa|inventou|inventado|inventada|viajou|nem e verdade|nao e verdade|nunca aconteceu|nao aconteceu|nada a ver|nada haver|ta tudo errado|ta errado|fato falso|historia inventada)\b/i;

// Fatos antigos, superados, desatualizados ou no passado
const STALE_SPECIFIC_RE = /\b(isso ja e passado|ja e passado|isso ja passou|ja passou|ja era essa historia|ja era|supera isso|superem|supera|desatualizado|desatualizada|ja mudei)\b/i;
const STALE_COMBINED_RE = /\b(fato|lore|historia|piada|coisa|zoeira|relato)?\s*(e|ja)?\s*(muito|super|bem|demais)?\s*(antigo|antiga|velho|velha)\s*(ja|demais|faz tempo)?\b/i;
const STALE_TIME_RE = /\b(faz anos|faz tempo|anos atras)\b.*\b(apaga|tira|esquece|supera|ja era)\b/i;

// Respostas curtas aceitáveis quando há mensagem citada (quote)
const SHORT_QUOTE_REACTION_RE = /^(tira|apaga|mentira|fake|supera|chega|para|nada a ver|nada haver|deleta|exclui|esquece)(!|\?|\.|\s|$)/i;

/**
 * Avalia se o texto (e opcionalmente a mensagem citada) expressa intenção
 * de retirar, contestar, apagar ou desconsiderar um fato da lore.
 *
 * @param {string} text Texto da mensagem do usuário
 * @param {object} [options]
 * @param {string} [options.quotedText] Texto da mensagem citada (se for reply)
 * @returns {boolean}
 */
export function hasRetractionIntent(text, { quotedText = '' } = {}) {
  const norm = normalizeKey(text);
  if (!norm) return false;

  // 1. Respostas curtas direcionadas a mensagem citada
  if (quotedText && String(quotedText).trim()) {
    if (SHORT_QUOTE_REACTION_RE.test(norm)) {
      return true;
    }
  }

  // 2. Verbos diretos de remoção
  if (DIRECT_REMOVAL_RE.test(norm) || PHRASE_REMOVAL_RE.test(norm)) {
    return true;
  }

  // 3. Rejeição e incômodo
  if (DISLIKE_RE.test(norm) || ANNOYANCE_RE.test(norm)) {
    return true;
  }

  // 4. Contestação e falsidade
  if (FALSEHOOD_RE.test(norm)) {
    return true;
  }

  // 5. Antiguidade e superação de lore
  if (STALE_SPECIFIC_RE.test(norm) || STALE_TIME_RE.test(norm)) {
    return true;
  }

  // Para termos como "antigo" ou "velho", exige que esteja contextualizado com lore/fato/história
  // ou qualificado com "muito antigo", "antigo já", "velha demais", etc.
  if (/\b(antigo|antiga|velho|velha)\b/.test(norm)) {
    if (
      /\b(muito|super|demais|ja|fato|historia|lore|piada|relato|coisa)\b/.test(norm) &&
      STALE_COMBINED_RE.test(norm)
    ) {
      return true;
    }
  }

  return false;
}
