/**
 * Sanitizador de saídas brutas de LLM.
 * Remove blocos de reasoning/pensamento (<think>...</think>), tags especiais de modelos,
 * instruções vazadas e normaliza delimitadores JSON.
 */

/**
 * Remove blocos explícitos de raciocínio de modelos (como DeepSeek R1 <think>...).
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripReasoningBlocks(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw;

  // Remove <think>...</think> (com ou sem fechamento)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, ''); // Se foi cortado no meio

  // Remove tags especiais do tipo <|im_start|>, <|im_end|>, [INST], [/INST], etc.
  cleaned = cleaned.replace(/<\|[a-zA-Z0-9_-]+\|>/g, '');
  cleaned = cleaned.replace(/\[\/?INST\]/gi, '');

  return cleaned.trim();
}

/**
 * Higieniza o payload de resposta antes do parsing de fatos ou JSON.
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeLlmPayload(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let text = stripReasoningBlocks(raw);

  // Remove preâmbulos conversacionais comuns de LLM antes do JSON
  // Ex: "Aqui estão os fatos extraídos: {"facts": ...}" -> "{"facts": ...}"
  const firstJsonCharIndex = text.search(/[{\[]/);
  if (firstJsonCharIndex > 0) {
    const preamble = text.slice(0, firstJsonCharIndex).toLowerCase();
    if (
      preamble.includes('fato') ||
      preamble.includes('json') ||
      preamble.includes('aqui') ||
      preamble.includes('segue') ||
      preamble.includes('extra') ||
      preamble.includes('resultado')
    ) {
      text = text.slice(firstJsonCharIndex);
    }
  }

  return text.trim();
}
