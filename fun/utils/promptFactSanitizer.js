/**
 * Sanitizador de fatos que vão para prompts da persona.
 *
 * O pipeline de extração (LLM ou regex) às vezes gera texto corrompido:
 * placeholder "?" vazando no lugar de um referente não resolvido
 * ("Adora comer ? e não informa quem adora", "gosto:comer ?") ou
 * meta-comentário sobre informação ausente. Esses textos envenenam o
 * prompt: o modelo tenta usá-los como fato real e sai resposta sem nexo.
 *
 * Regra centralizada aqui para personaService, profileService e
 * memoryIngestionService compartilharem o mesmo critério.
 */

const CORRUPTED_FACT_RE = /(\?|n[ãa]o\s+informa|n[ãa]o\s+identificad|desconhecid[oa]s?\b|sem\s+informa[çc][ãa]o|refer[êe]ncia\s+n[ãa]o\s+resolvida)/iu;

/**
 * @param {string} value texto de fato/bio/extra candidato ao prompt
 * @returns {boolean} true se é seguro colocar no prompt
 */
export function isUsablePromptFact(value) {
  const t = String(value || '').trim();
  return Boolean(t) && !CORRUPTED_FACT_RE.test(t);
}
