/**
 * Utilitários puros para normalização, tokenização e cálculo de similaridade de texto.
 * Compartilhados entre o parser de memória, filtros de deduplicação e adaptadores de extração.
 */

/**
 * Normaliza uma string para comparação de chaves:
 * - Converte para minúsculas
 * - Remove acentos (NFD)
 * - Substitui caracteres não-alfanuméricos por espaços
 * - Colapsa múltiplos espaços em um único
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai um conjunto (Set) de tokens significativos (comprimento >= minLength) de um texto.
 *
 * @param {string} text
 * @param {number} [minLength=3]
 * @returns {Set<string>}
 */
export function tokenSet(text, minLength = 3) {
  const min = Number.isFinite(minLength) && minLength > 0 ? minLength : 3;
  return new Set(
    normalizeKey(text)
      .split(' ')
      .filter((t) => t.length >= min)
  );
}

/**
 * Calcula a similaridade de Jaccard entre dois conjuntos de tokens ou textos.
 * Aceita tanto Sets pré-construídos quanto strings diretas.
 *
 * @param {Set<string>|string} a
 * @param {Set<string>|string} b
 * @returns {number} Coeficiente entre 0.0 e 1.0
 */
export function jaccard(a, b) {
  const setA = a instanceof Set ? a : tokenSet(String(a || ''));
  const setB = b instanceof Set ? b : tokenSet(String(b || ''));

  if (!setA.size || !setB.size) return 0;

  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter += 1;
  }

  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Gera uma assinatura compacta para busca/dedup baseada nos top-N tokens/palavras-chave ordenados.
 *
 * @param {string[]} [keywords=[]]
 * @param {string} [summary='']
 * @param {number} [topN=3]
 * @returns {string}
 */
export function keywordSignature(keywords = [], summary = '', topN = 3) {
  const n = Number.isFinite(topN) && topN > 0 ? topN : 3;
  const fromKw = (keywords || []).map(normalizeKey).filter((t) => t.length >= 3);
  const fromSum = [...tokenSet(summary)];
  const toks = [...new Set([...fromKw, ...fromSum])].sort();
  return toks.slice(0, n).join('|');
}
